import { test } from "node:test";
import assert from "node:assert/strict";

import { DIAGRAM_TOOLS, ALL_TOOLS, METAMODEL_TOOLS, MODEL_TOOLS } from "../dist/tools.js";
import { describeForScaffold } from "../dist/sapDiagrams.js";

/**
 * The metamodel tools need no backend and no credentials, which is exactly
 * why they are worth testing here: they are the half of this server that makes
 * an agent produce valid ArchiMate rather than plausible-looking ArchiMate.
 *
 * The model tools are covered by scripts/verify-mcp.mjs against a live
 * backend — mocking AppSync would only test the mock.
 */

const byName = new Map(ALL_TOOLS.map((t) => [t.name, t]));
const run = (name, args = {}) => byName.get(name).run(args);
const parse = async (name, args) => JSON.parse(await run(name, args));

test("every tool is named, described and schema'd", () => {
  for (const tool of ALL_TOOLS) {
    assert.match(tool.name, /^[a-z][a-z0-9_]*$/, `${tool.name} is snake_case`);
    assert.ok(tool.description.length > 40, `${tool.name} explains itself`);
    assert.equal(typeof tool.schema, "object");
    assert.equal(typeof tool.run, "function");
  }
  assert.equal(new Set(ALL_TOOLS.map((t) => t.name)).size, ALL_TOOLS.length);
  // Three groups now: needs nothing, needs the draw.io toolchain, needs a
  // backend. This assertion exists so a tool cannot be added to ALL_TOOLS
  // without landing in exactly one of them.
  assert.equal(
    ALL_TOOLS.length,
    METAMODEL_TOOLS.length + DIAGRAM_TOOLS.length + MODEL_TOOLS.length
  );
});

test("metamodel tools need no backend", async () => {
  // Nothing has called connect(). If any of these reached for the API they
  // would throw "not connected", which is the property being asserted.
  for (const tool of METAMODEL_TOOLS) {
    const args = Object.fromEntries(
      Object.keys(tool.schema).map((k) => [
        k,
        k === "relationship" ? "realization" : "WorkPackage",
      ])
    );
    const out = await tool.run(args);
    assert.equal(typeof out, "string");
    assert.ok(!/not connected/.test(out), `${tool.name} needed a backend`);
  }
});

test("an agent can discover the element types of a domain", async () => {
  const layer7 = await parse("archimate_list_element_types", {
    domain: "implementation",
  });
  assert.deepEqual(
    layer7.map((e) => e.type).sort(),
    ["Deliverable", "Gap", "ImplementationEvent", "Plateau", "WorkPackage"]
  );
  // Definitions come through, so the agent can choose rather than guess.
  assert.ok(layer7.every((e) => e.definition.length > 10));
});

test("an unknown domain is answered, not thrown", async () => {
  const out = await run("archimate_list_element_types", { domain: "nonsense" });
  assert.match(out, /Unknown domain/);
  assert.match(out, /implementation/);
});

test("the specification's non-obvious rules are answerable", async () => {
  // The whole reason this tool exists. Both of these read plausibly; only one
  // is legal, and no amount of guessing gets it right.
  const wrong = await parse("archimate_check_relationship", {
    source: "Plateau",
    relationship: "composition",
    target: "Deliverable",
  });
  assert.equal(wrong.allowed, false);
  // ...and it says what to do instead, which is the useful part.
  assert.ok(wrong.permittedInTheOtherDirection.includes("realization"));

  const right = await parse("archimate_check_relationship", {
    source: "Deliverable",
    relationship: "realization",
    target: "Plateau",
  });
  assert.equal(right.allowed, true);
});

test("direction is reported distinctly in each direction", async () => {
  const forward = await parse("archimate_check_relationship", {
    source: "WorkPackage",
    relationship: "realization",
    target: "Deliverable",
  });
  const backward = await parse("archimate_check_relationship", {
    source: "Deliverable",
    relationship: "realization",
    target: "WorkPackage",
  });
  assert.equal(forward.allowed, true);
  assert.equal(backward.allowed, false);
});

test("a bad type or relationship gets a usable message, not a stack trace", async () => {
  const a = await run("archimate_check_relationship", {
    source: "Wormhole",
    relationship: "realization",
    target: "Deliverable",
  });
  assert.match(a, /not an element type/);

  const b = await run("archimate_check_relationship", {
    source: "WorkPackage",
    relationship: "entangles",
    target: "Deliverable",
  });
  assert.match(b, /not a relationship type/);
  // It lists the real ones so the agent can correct itself in one step.
  assert.match(b, /realization/);
});

test("describe_element_type gives the definition and what it connects to", async () => {
  const wp = await parse("archimate_describe_element_type", {
    type: "WorkPackage",
  });
  assert.equal(wp.domain, "implementation");
  assert.ok(wp.definition.length > 10);
  // The complete list, so the agent never has to guess about a type that fell
  // outside a sample.
  assert.ok(wp.outgoingRelationships.realization.includes("Deliverable"));
  assert.ok(!wp.outgoingRelationships.composition?.includes("Plateau"));
});

test("allowed_targets is filtered to the specification, not to everything", async () => {
  const { targets } = await parse("archimate_allowed_targets", {
    source: "WorkPackage",
    relationship: "realization",
  });
  assert.ok(targets.includes("Deliverable"));
  assert.ok(targets.length < 60, "not simply every element type");
});

test("the platform's own conventions are discoverable", async () => {
  const out = await parse("archimate_describe_conventions", {});
  const keys = out.conventions.map((c) => c.propertyKey);
  for (const k of ["startDate", "endDate", "status", "radarRing", "radarMoved"]) {
    assert.ok(keys.includes(k), `${k} is documented`);
  }
  const ring = out.conventions.find((c) => c.propertyKey === "radarRing");
  assert.deepEqual(ring.permittedValues, ["adopt", "trial", "assess", "hold"]);
  assert.equal(out.archimateVersion, "3.2");
});

test("model tools refuse clearly when there is no backend", async () => {
  for (const tool of MODEL_TOOLS) {
    await assert.rejects(
      () => tool.run({ project: "x", id: "y", source: "a", target: "b", type: "Node", name: "n", relationship: "serving", properties: {} }),
      /not connected/,
      `${tool.name} should say it is not connected`
    );
  }
});

test("diagram tools need the toolchain, not a backend", async () => {
  // Nothing has called connect(), and these must not care. What they do need
  // is the vendored scripts — and when those are absent the refusal has to say
  // how to get them, because "not installed" with no instruction is a dead end.
  const previous = process.env.BP_SAP_DIAGRAM_SCRIPTS;
  process.env.BP_SAP_DIAGRAM_SCRIPTS = "/nonexistent-on-purpose";
  try {
    for (const tool of DIAGRAM_TOOLS) {
      await assert.rejects(
        () => tool.run({ file: "x.drawio", out: "y.drawio", description: "a" }),
        /setup-sap-diagrams|BP_SAP_DIAGRAM_SCRIPTS/,
        `${tool.name} should say how to install the toolchain`
      );
    }
  } finally {
    if (previous === undefined) delete process.env.BP_SAP_DIAGRAM_SCRIPTS;
    else process.env.BP_SAP_DIAGRAM_SCRIPTS = previous;
  }
});

test("a diagram tool with no path refuses instead of writing to 'undefined'", async () => {
  // String(undefined) is "undefined", which is a valid filename — so a missing
  // argument once wrote a 387 kB diagram to a file called `undefined` and it
  // turned up staged for commit. The refusal has to come before the toolchain
  // check, or this passes for the wrong reason on a machine without it.
  const previous = process.env.BP_SAP_DIAGRAM_SCRIPTS;
  delete process.env.BP_SAP_DIAGRAM_SCRIPTS;
  try {
    for (const tool of DIAGRAM_TOOLS) {
      await assert.rejects(
        () => tool.run({ description: "an architecture" }),
        /required|not installed/,
        `${tool.name} should refuse a missing path`
      );
    }
  } finally {
    if (previous !== undefined) process.env.BP_SAP_DIAGRAM_SCRIPTS = previous;
  }
});

/* -- the description the scaffolder ranks templates against ---------------- */

const sapModel = {
  projectSlug: "sap-test",
  elements: [
    { id: "ecc", type: "SystemSoftware", name: "SAP ECC 6.0", properties: {} },
    { id: "db2", type: "SystemSoftware", name: "IBM Db2", properties: {} },
    { id: "svc", type: "TechnologyService", name: "ZS2 runtime", properties: {} },
    { id: "vm1", type: "Node", name: "App server 1", properties: {} },
    { id: "goal", type: "Goal", name: "Reduce cost", properties: {} },
    { id: "wp", type: "WorkPackage", name: "Phase A", properties: {} },
  ],
  relationships: [
    { id: "a", type: "assignment", source: "vm1", target: "svc", properties: {} },
    { id: "b", type: "association", source: "ecc", target: "db2", properties: {} },
  ],
};

test("the scaffold description is drawn from what a solution diagram shows", () => {
  const out = describeForScaffold(sapModel);
  for (const name of ["SAP ECC 6.0", "IBM Db2", "ZS2 runtime", "App server 1"]) {
    assert.ok(out.includes(name), `${name} should be described`);
  }
  // Motivation and implementation elements say why and when, not what is
  // deployed. Including them skews the template match towards the wrong
  // references, which is the whole thing this selection exists to avoid.
  assert.ok(!out.includes("Reduce cost"), "a Goal is not on a solution diagram");
  assert.ok(!out.includes("Phase A"), "a WorkPackage is not on a solution diagram");
});

test("it carries relationships, so the ranking sees structure and not only nouns", () => {
  const out = describeForScaffold(sapModel);
  assert.match(out, /App server 1 assignment ZS2 runtime/);
});

test("the limit is honoured, so a large model does not become a wall of nouns", () => {
  const all = ["SAP ECC 6.0", "IBM Db2", "ZS2 runtime", "App server 1"];
  const two = describeForScaffold(sapModel, { limit: 2 });
  assert.equal(
    all.filter((n) => two.includes(n)).length,
    2,
    `expected two of the four drawable elements, got: ${two}`
  );
  const four = describeForScaffold(sapModel, { limit: 4 });
  assert.equal(all.filter((n) => four.includes(n)).length, 4);
});

test("a model with nothing to draw refuses, and says what is missing", () => {
  assert.throws(
    () =>
      describeForScaffold({
        projectSlug: "roadmap-only",
        elements: [{ id: "wp", type: "WorkPackage", name: "Phase A", properties: {} }],
        relationships: [],
      }),
    /nothing a solution diagram is drawn from/
  );
});
