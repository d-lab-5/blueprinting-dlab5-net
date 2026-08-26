import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";

import {
  PLATFORM_ROADMAP,
  emptyModel,
  parseAbox,
  toD2,
  toMermaidSequence,
} from "../dist/index.js";

/**
 * Mermaid is checked here against the real parser, as the Gantt tests are.
 *
 * The equivalent D2 checks live in scripts/verify-views.mjs instead. The D2
 * WASM wrapper spawns a worker that keeps the event loop alive, so `node
 * --test` never exits with it loaded. That is a property of the tool rather
 * than a reason to skip the verification: the script compiles AND renders with
 * the real d2, and is run the same way as verify-archi.
 *
 * What stays here for D2 is what can be asserted on the source itself —
 * escaping, and that a filtered view leaves no edge dangling.
 */
const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  pretendToBeVisual: true,
});
globalThis.window = dom.window;
globalThis.document = dom.window.document;
Object.defineProperty(globalThis, "navigator", {
  value: dom.window.navigator,
  configurable: true,
});
const mermaid = (await import("mermaid")).default;
mermaid.initialize({ startOnLoad: false });

const parsesAsMermaid = async (src) => {
  try {
    await mermaid.parse(src);
    return null;
  } catch (err) {
    return err.message ?? String(err);
  }
};

/** The pattern library: a real model spanning motivation and core domains. */
const patterns = parseAbox(
  readFileSync(
    new URL("../../../docs/patterns/engineering-patterns.ttl", import.meta.url),
    "utf8"
  ),
  "patterns"
);

/** A Layer 3 flow, which no committed model has yet. */
const flow = {
  projectSlug: "flow",
  elements: [
    { id: "customer", type: "BusinessActor", name: "Customer", properties: {} },
    { id: "agent", type: "ApplicationComponent", name: "Support agent", properties: {} },
    { id: "crm", type: "ApplicationComponent", name: "CRM", properties: {} },
    { id: "raise", type: "BusinessProcess", name: "Raise a request", properties: {} },
    { id: "triage", type: "ApplicationProcess", name: "Triage", properties: {} },
    { id: "record", type: "ApplicationProcess", name: "Record the case", properties: {} },
    { id: "notify", type: "BusinessProcess", name: "Notify the customer", properties: {} },
  ],
  relationships: [
    { id: "a1", type: "assignment", source: "customer", target: "raise", properties: {} },
    { id: "a2", type: "assignment", source: "agent", target: "triage", properties: {} },
    { id: "a3", type: "assignment", source: "crm", target: "record", properties: {} },
    { id: "a4", type: "assignment", source: "agent", target: "notify", properties: {} },
    { id: "t1", type: "triggering", source: "raise", target: "triage", properties: {} },
    { id: "t2", type: "triggering", source: "triage", target: "record", properties: {} },
    { id: "f1", type: "flow", source: "record", target: "notify", name: "case id", properties: {} },
  ],
};

/* -- D2 source ------------------------------------------------------------- */

test("domains become containers in the standard layer colours", () => {
  const src = toD2(patterns);
  assert.match(src, /^motivation: "Motivation" \{/m);
  assert.match(src, /^application: "Application" \{/m);
  // The ArchiMate motivation pastel, the same value the CSS tokens and the
  // Blockly blocks use.
  assert.match(src, /style\.stroke: "#ccccff"/);
});

test("shape follows the ArchiMate aspect, not the element name", () => {
  const src = toD2(patterns);
  const principle = src.split("principle-upstream-immutable")[1].split("}")[0];
  assert.match(principle, /shape: hexagon/);
  const component = src.split("component-ontology-generator")[1].split("}")[0];
  assert.match(component, /shape: rectangle/);
});

test("names containing d2's own delimiters are escaped", () => {
  const model = {
    projectSlug: "x",
    elements: [
      { id: "a", type: "ApplicationComponent", name: 'The "billing" service: v2 {beta}', properties: {} },
      { id: "b", type: "Node", name: "host-01.example.com", properties: {} },
    ],
    relationships: [
      { id: "r", type: "serving", source: "b", target: "a", name: "hosts; runs", properties: {} },
    ],
  };
  const src = toD2(model);
  // A raw inner quote would end the label and leave the rest as syntax.
  assert.ok(!src.includes('"The "billing"'));
  assert.match(src, /"The 'billing' service: v2 \{beta\}"/);
  // A dot in an identifier is a path separator in d2. Element ids cannot
  // contain one — IdSchema forbids it — but the sanitiser is what guarantees
  // that rather than the schema being remembered.
  assert.match(src, /^\s*b: "host-01\.example\.com"/m);
});

test("a filtered view leaves no edge pointing at a node it does not draw", () => {
  const src = toD2(patterns, { domains: ["motivation"] });
  assert.ok(!src.includes("application."), "no cross-domain edge survives");
  assert.ok(!src.includes("technology."));
});

test("an empty model produces something rather than nothing", () => {
  const src = toD2(emptyModel("x"));
  assert.match(src, /Nothing to draw/);
});

/* -- sequence -------------------------------------------------------------- */

test("mermaid itself parses the sequence diagram", async () => {
  const error = await parsesAsMermaid(toMermaidSequence(flow, { title: "Support" }));
  assert.equal(error, null, `mermaid rejected the diagram:\n${error}`);
});

test("participants come from assignment, not from the behaviours themselves", () => {
  const src = toMermaidSequence(flow);
  assert.match(src, /actor p_customer as Customer/);
  assert.match(src, /actor p_agent as Support agent/);
  assert.match(src, /actor p_crm as CRM/);
  assert.ok(!/participant p_triage/.test(src), "a behaviour is not a participant");
});

test("messages follow triggering and flow, in order", () => {
  const src = toMermaidSequence(flow);
  const messages = src.split("\n").filter((l) => l.includes("->>"));
  assert.equal(messages.length, 3);
  // Depth-first from the step nothing triggers.
  assert.match(messages[0], /p_customer->>p_agent: Triage/);
  assert.match(messages[1], /p_agent->>p_crm: Record the case/);
  // flow is dashed, and its name is carried.
  assert.match(messages[2], /p_crm-->>p_agent: Notify the customer \(case id\)/);
});

test("a model with genuinely no behaviour says so", async () => {
  const structural = {
    projectSlug: "x",
    elements: [
      { id: "p", type: "Plateau", name: "Target", properties: {} },
      { id: "d", type: "Deliverable", name: "Thing", properties: {} },
    ],
    relationships: [
      { id: "r", type: "realization", source: "d", target: "p", properties: {} },
    ],
  };
  const src = toMermaidSequence(structural);
  assert.equal(await parsesAsMermaid(src), null);
  assert.match(src, /No process flow/);
});

test("the roadmap does yield a sequence, because a work package is behaviour", async () => {
  // ArchiMate classes WorkPackage as InternalBehavior, so the triggering
  // chain is a legitimate flow. It is not the most useful view of Layer 7 —
  // the Gantt is — but it must be correct rather than empty.
  const src = toMermaidSequence(PLATFORM_ROADMAP);
  assert.equal(await parsesAsMermaid(src), null);
  assert.match(src, /p_wp1->>p_wp2: triggering/);
  // No message repeats the lifeline it points at.
  for (const line of src.split("\n").filter((l) => l.includes(">>"))) {
    const [, target, text] = line.match(/>>(p_\w+): (.*)$/) ?? [];
    if (!target) continue;
    assert.notEqual(text, target.replace(/^p_/, ""), line);
  }
});

test("a behaviour nobody is assigned to still appears", () => {
  // Otherwise an unassigned step vanishes, which reads as if it does not
  // exist rather than as if nobody owns it.
  const orphaned = {
    ...flow,
    relationships: flow.relationships.filter((r) => r.id !== "a2"),
  };
  const src = toMermaidSequence(orphaned);
  assert.match(src, /participant p_triage as Triage/);
});

test("a cycle does not lose steps or hang", async () => {
  const cyclic = {
    projectSlug: "x",
    elements: [
      { id: "a", type: "BusinessProcess", name: "A", properties: {} },
      { id: "b", type: "BusinessProcess", name: "B", properties: {} },
    ],
    relationships: [
      { id: "r1", type: "triggering", source: "a", target: "b", properties: {} },
      { id: "r2", type: "triggering", source: "b", target: "a", properties: {} },
    ],
  };
  const src = toMermaidSequence(cyclic);
  assert.equal(src.split("\n").filter((l) => l.includes("->>")).length, 2);
  assert.equal(await parsesAsMermaid(src), null);
});

test("`from` draws only the flow it reaches, not the whole model", async () => {
  // Two unrelated chains in one model, which is what happens when a product's
  // roadmap and its runtime sequence live in the same ABox.
  const model = {
    projectSlug: "t",
    elements: [
      { id: "actorA", type: "ApplicationComponent", name: "A", properties: {} },
      { id: "actorB", type: "ApplicationComponent", name: "B", properties: {} },
      { id: "a1", type: "ApplicationProcess", name: "A one", properties: {} },
      { id: "a2", type: "ApplicationProcess", name: "A two", properties: {} },
      { id: "b1", type: "ApplicationProcess", name: "B one", properties: {} },
      { id: "b2", type: "ApplicationProcess", name: "B two", properties: {} },
    ],
    relationships: [
      { id: "x1", type: "assignment", source: "actorA", target: "a1", properties: {} },
      { id: "x2", type: "assignment", source: "actorA", target: "a2", properties: {} },
      { id: "x3", type: "assignment", source: "actorB", target: "b1", properties: {} },
      { id: "x4", type: "assignment", source: "actorB", target: "b2", properties: {} },
      { id: "t1", type: "triggering", source: "a1", target: "a2", properties: {} },
      { id: "t2", type: "triggering", source: "b1", target: "b2", properties: {} },
    ],
  };

  const everything = toMermaidSequence(model);
  assert.match(everything, /A two/);
  assert.match(everything, /B two/, "with no start, both flows are drawn");

  const justA = toMermaidSequence(model, { from: "a1" });
  assert.match(justA, /A two/);
  assert.doesNotMatch(justA, /B two/, "the other flow must not be appended");
});

test("without `from`, a cycle still leaves nothing undrawn", () => {
  const model = {
    projectSlug: "t",
    elements: [
      { id: "c", type: "ApplicationComponent", name: "C", properties: {} },
      { id: "p1", type: "ApplicationProcess", name: "One", properties: {} },
      { id: "p2", type: "ApplicationProcess", name: "Two", properties: {} },
    ],
    relationships: [
      { id: "a1", type: "assignment", source: "c", target: "p1", properties: {} },
      { id: "a2", type: "assignment", source: "c", target: "p2", properties: {} },
      // A cycle: neither step is a root, so the walk finds no entry point.
      { id: "t1", type: "triggering", source: "p1", target: "p2", properties: {} },
      { id: "t2", type: "triggering", source: "p2", target: "p1", properties: {} },
    ],
  };
  const out = toMermaidSequence(model);
  assert.match(out, /One/);
  assert.match(out, /Two/);
});
