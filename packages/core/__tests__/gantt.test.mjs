import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

import {
  PLATFORM_ROADMAP,
  emptyModel,
  toMermaidGantt,
} from "../dist/index.js";

/**
 * Mermaid is a devDependency here purely so these tests can put the generated
 * diagram through the real parser. Asserting on the string we just built
 * proves only that the code does what it does; it says nothing about whether
 * Mermaid will accept it. The rendering package stays out of core at runtime.
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

const parses = async (src) => {
  try {
    await mermaid.parse(src);
    return null;
  } catch (err) {
    return err.message ?? String(err);
  }
};

test("mermaid itself accepts the platform roadmap", async () => {
  const error = await parses(
    toMermaidGantt(PLATFORM_ROADMAP, { title: "D-LAB-5 Blueprinting Platform" })
  );
  assert.equal(error, null, `mermaid rejected the diagram:\n${error}`);
});

test("mermaid accepts a model with no dates at all", async () => {
  // The realistic shape of a brand-new roadmap: sequence known, dates not.
  const model = {
    projectSlug: "x",
    elements: [
      { id: "a", type: "WorkPackage", name: "First", properties: {} },
      { id: "b", type: "WorkPackage", name: "Second", properties: {} },
      { id: "c", type: "WorkPackage", name: "Orphan", properties: {} },
    ],
    relationships: [
      { id: "r", type: "triggering", source: "a", target: "b", properties: {} },
    ],
  };
  const error = await parses(toMermaidGantt(model));
  assert.equal(error, null, `mermaid rejected the diagram:\n${error}`);
});

test("mermaid accepts an empty model", async () => {
  const error = await parses(toMermaidGantt(emptyModel("x")));
  assert.equal(error, null, `mermaid rejected the diagram:\n${error}`);
});

test("mermaid accepts names containing its own delimiters", async () => {
  // ":" separates a task's fields and "#" starts a comment, so a name like
  // "Phase 2: migrate" would silently corrupt the line if it were not escaped.
  const model = {
    projectSlug: "x",
    elements: [
      {
        id: "a",
        type: "WorkPackage",
        name: "Phase 2: migrate #1; then stop",
        properties: { startDate: "2026-01-01", endDate: "2026-01-05" },
      },
    ],
    relationships: [],
  };
  const out = toMermaidGantt(model);
  assert.ok(!/Phase 2:/.test(out), "the colon must not survive into the label");
  assert.equal(await parses(out), null);
});

/* -- the mapping ---------------------------------------------------------- */

test("plateaus become sections, in date order", () => {
  const out = toMermaidGantt(PLATFORM_ROADMAP);
  const sections = [...out.matchAll(/^ {4}section (.+)$/gm)].map((m) => m[1]);
  assert.deepEqual(sections, [
    "P1 Authenticated Shell",
    "P2 Semantic Backbone",
    "P3 Blueprinting Platform",
  ]);
  // P0 has no work package pointing at it, so it earns no section. An empty
  // lane would be noise.
  assert.ok(!sections.includes("P0 Empty Repo"));
});

test("a work package lands in the plateau its deliverable realizes", () => {
  const out = toMermaidGantt(PLATFORM_ROADMAP);
  const p2 = out.split("section P2 Semantic Backbone")[1].split("section")[0];
  // WP2 -realization-> d-metamodel -realization-> P2
  assert.match(p2, /WP2 Metamodel from ontology/);
  assert.match(p2, /WP3 Turtle ABox store/);
});

test("a work package with no deliverable inherits the plateau that triggers it", () => {
  // WP5 has no deliverable; it is triggered by WP4, which realizes P3.
  const out = toMermaidGantt(PLATFORM_ROADMAP);
  const p3 = out.split("section P3 Blueprinting Platform")[1];
  assert.match(p3, /WP5 Open Exchange XML/);
  assert.ok(
    !out.includes("section Unscheduled"),
    "nothing should fall through to Unscheduled in this model"
  );
});

test("status drives the bar, and events become milestones", () => {
  // Its own fixture rather than the platform roadmap. That model is live
  // planning data now — statuses move as work lands — and a test that pins
  // them would fail every time the plan is honest.
  const out = toMermaidGantt({
    projectSlug: "x",
    elements: [
      { id: "a", type: "WorkPackage", name: "Finished", properties: { startDate: "2026-01-01", endDate: "2026-01-05", status: "done" } },
      { id: "b", type: "WorkPackage", name: "Running", properties: { startDate: "2026-01-05", status: "in-progress" } },
      { id: "c", type: "WorkPackage", name: "Later", properties: { status: "planned" } },
      { id: "d", type: "WorkPackage", name: "Wobbling", properties: { startDate: "2026-01-05", status: "at-risk" } },
      { id: "e", type: "ImplementationEvent", name: "Go live", properties: { startDate: "2026-01-06", status: "done" } },
    ],
    relationships: [],
  });
  assert.match(out, /Finished :done,/);
  assert.match(out, /Running :active,/);
  assert.match(out, /Wobbling :crit,/);
  assert.match(out, /Go live :done, milestone,/);
  // Planned work carries no status tag.
  assert.match(out, /Later :t_c,/);
});

test("triggering becomes an after dependency", () => {
  const out = toMermaidGantt(PLATFORM_ROADMAP);
  assert.match(out, /WP7 D2 and sequence views :t_wp7, after t_wp6/);
});

test("every `after` names a task that was actually emitted", () => {
  // A dangling `after` is not a parse error — mermaid silently places the task
  // at the epoch, which looks like data corruption rather than a bug.
  const out = toMermaidGantt(PLATFORM_ROADMAP);
  const defined = new Set(
    [...out.matchAll(/:(?:[a-z, ]*?)?(t_[A-Za-z0-9_]+),/g)].map((m) => m[1])
  );
  const referenced = [...out.matchAll(/after (t_[A-Za-z0-9_]+)/g)].map(
    (m) => m[1]
  );
  assert.ok(referenced.length > 0, "the fixture should exercise dependencies");
  for (const ref of referenced) {
    assert.ok(defined.has(ref), `after ${ref} names an undefined task`);
  }
});

test("work packages sort naturally, not lexically", () => {
  const out = toMermaidGantt({
    projectSlug: "x",
    elements: [
      { id: "wp9", type: "WorkPackage", name: "WP9 Ninth", properties: {} },
      { id: "wp10", type: "WorkPackage", name: "WP10 Tenth", properties: {} },
    ],
    relationships: [],
  });
  assert.ok(
    out.indexOf("WP9 Ninth") < out.indexOf("WP10 Tenth"),
    "WP10 must not sort before WP9"
  );
});

test("on the same day, work comes before the milestone it produced", () => {
  const out = toMermaidGantt({
    projectSlug: "x",
    elements: [
      { id: "wp", type: "WorkPackage", name: "The work", properties: { startDate: "2026-01-01", endDate: "2026-01-02" } },
      { id: "ev", type: "ImplementationEvent", name: "The milestone", properties: { startDate: "2026-01-01" } },
    ],
    relationships: [],
  });
  assert.ok(out.indexOf("The work") < out.indexOf("The milestone"));
});

test("a sub work package inherits its parent's plateau", () => {
  // Found by planning WP6 through the MCP server: breaking a work package into
  // WP6.1..6.4 scattered the children into "Unscheduled" because only
  // triggering conferred a plateau, and composition is how a breakdown is
  // expressed. A breakdown must not move the work off the roadmap.
  const out = toMermaidGantt({
    projectSlug: "x",
    elements: [
      { id: "p", type: "Plateau", name: "Target", properties: { startDate: "2026-01-01" } },
      { id: "wp", type: "WorkPackage", name: "Parent", properties: { startDate: "2026-01-01" } },
      { id: "d", type: "Deliverable", name: "Thing", properties: {} },
      { id: "sub1", type: "WorkPackage", name: "Child one", properties: { startDate: "2026-01-02" } },
      { id: "sub2", type: "WorkPackage", name: "Child two", properties: { startDate: "2026-01-03" } },
      { id: "deep", type: "WorkPackage", name: "Grandchild", properties: { startDate: "2026-01-04" } },
    ],
    relationships: [
      { id: "r1", type: "realization", source: "wp", target: "d", properties: {} },
      { id: "r2", type: "realization", source: "d", target: "p", properties: {} },
      { id: "r3", type: "composition", source: "wp", target: "sub1", properties: {} },
      { id: "r4", type: "composition", source: "wp", target: "sub2", properties: {} },
      { id: "r5", type: "composition", source: "sub2", target: "deep", properties: {} },
    ],
  });
  assert.ok(!out.includes("section Unscheduled"), "nothing should be unscheduled");
  const target = out.split("section Target")[1];
  for (const name of ["Child one", "Child two", "Grandchild"]) {
    assert.match(target, new RegExp(name), `${name} sits with its parent`);
  }
});
