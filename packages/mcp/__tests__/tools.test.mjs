import { test } from "node:test";
import assert from "node:assert/strict";

import { ALL_TOOLS, METAMODEL_TOOLS, MODEL_TOOLS } from "../dist/tools.js";

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
  assert.equal(ALL_TOOLS.length, METAMODEL_TOOLS.length + MODEL_TOOLS.length);
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
