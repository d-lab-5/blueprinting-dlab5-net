import { test } from "node:test";
import assert from "node:assert/strict";
import * as Blockly from "blockly";

import { ELEMENTS, RELATIONSHIPS, isAllowed } from "@dlab5/archimate-metamodel";
import { PLATFORM_ROADMAP, hasErrors, validateModel } from "@dlab5/blueprint-core";
import {
  aboxToWorkspace,
  elementBlockType,
  generateBlocks,
  generateToolbox,
  relationshipBlockType,
  workspaceToAbox,
} from "../dist/index.js";

/**
 * These run against real Blockly, headless — a plain Workspace needs no DOM.
 * Asserting on the generated JSON alone would only prove the generator does
 * what it does; loading it into Blockly proves the definitions are ones
 * Blockly accepts, which is the claim that matters.
 */
const blocks = generateBlocks();
Blockly.defineBlocksWithJsonArray(blocks);

test("a block is generated for every element and relationship type", () => {
  const types = new Set(blocks.map((b) => b.type));
  for (const id of Object.keys(ELEMENTS)) {
    assert.ok(types.has(elementBlockType(id)), `no block for ${id}`);
  }
  for (const id of Object.keys(RELATIONSHIPS)) {
    assert.ok(types.has(relationshipBlockType(id)), `no block for ${id}`);
  }
  assert.equal(
    blocks.length,
    Object.keys(ELEMENTS).length + Object.keys(RELATIONSHIPS).length
  );
});

test("Blockly accepts every generated definition", () => {
  // defineBlocksWithJsonArray above would have thrown on a malformed one, but
  // a definition can be accepted and still fail to instantiate.
  const ws = new Blockly.Workspace();
  for (const def of blocks) {
    assert.doesNotThrow(() => ws.newBlock(def.type), `${def.type} would not instantiate`);
  }
});

test("blocks carry their ontology anchor and the domain colour", () => {
  const wp = blocks.find((b) => b.type === elementBlockType("WorkPackage"));
  assert.equal(wp.data, "archimate:WorkPackage");
  assert.equal(wp.helpUrl, ELEMENTS.WorkPackage.iri);
  // The standard ArchiMate Implementation & Migration pastel.
  assert.equal(wp.colour, "#ffe0e0");
  assert.equal(wp.tooltip, ELEMENTS.WorkPackage.comment);
});

test("scheduling fields appear only on element types that carry a schedule", () => {
  const fieldNames = (type) => {
    const def = blocks.find((b) => b.type === elementBlockType(type));
    return Object.keys(def)
      .filter((k) => k.startsWith("args"))
      .flatMap((k) => def[k])
      .map((a) => a.name);
  };
  assert.ok(fieldNames("WorkPackage").includes("startDate"));
  assert.ok(fieldNames("Plateau").includes("status"));
  // A business actor has no schedule; offering it dates would be noise.
  assert.ok(!fieldNames("BusinessActor").includes("startDate"));
});

test("radar fields appear, and their values come from the ontology", () => {
  const def = blocks.find((b) => b.type === elementBlockType("ApplicationComponent"));
  const args = Object.keys(def)
    .filter((k) => k.startsWith("args"))
    .flatMap((k) => def[k]);
  const ring = args.find((a) => a.name === "radarRing");
  assert.ok(ring, "radarRing is offered");
  assert.deepEqual(
    ring.options.map(([, v]) => v),
    ["", "adopt", "trial", "assess", "hold"]
  );
});

test("the toolbox has a category per domain, in specification order", () => {
  const toolbox = generateToolbox();
  const names = toolbox.contents.map((c) => c.name);
  assert.deepEqual(names, [
    "Motivation",
    "Strategy",
    "Business",
    "Application",
    "Technology",
    "Physical",
    "Implementation & Migration",
    "Common",
    "Relationships",
  ]);
  const impl = toolbox.contents.find((c) => c.name === "Implementation & Migration");
  assert.equal(impl.contents.length, 5);
});

test("a toolbox can be narrowed to one domain", () => {
  const toolbox = generateToolbox(["implementation"]);
  assert.deepEqual(
    toolbox.contents.map((c) => c.name),
    ["Implementation & Migration", "Relationships"]
  );
});

/* -- the property the whole design exists for ----------------------------- */

test("a relationship block only offers targets ArchiMate permits", () => {
  // realization may reach a Deliverable; it may not reach a Junction-like or
  // any type nothing can realize. variableTypes is what Blockly filters the
  // variable dropdown by, so this is the mechanism, not a description of one.
  const def = blocks.find((b) => b.type === relationshipBlockType("realization"));
  const permitted = new Set(def.args0[0].variableTypes);

  assert.ok(permitted.has("Deliverable"));
  assert.ok(permitted.has("Plateau"));

  // Every type it offers must be a legal target of realization from something.
  for (const target of permitted) {
    const reachable = Object.keys(ELEMENTS).some((source) =>
      isAllowed(source, "realization", target)
    );
    assert.ok(reachable, `${target} is offered but nothing may realize it`);
  }

  // And every legal target must be offered, or the palette would be lying by
  // omission.
  for (const target of Object.keys(ELEMENTS)) {
    const reachable = Object.keys(ELEMENTS).some((source) =>
      isAllowed(source, "realization", target)
    );
    if (reachable) assert.ok(permitted.has(target), `${target} is missing`);
  }
});

test("Blockly refuses a variable of the wrong type in a relationship field", () => {
  const ws = new Blockly.Workspace();
  const rel = ws.newBlock(relationshipBlockType("access"));
  const field = rel.getField("TARGET");
  const permitted = field.getVariableTypes();

  // access reaches passive structure. A Plateau is passive structure and is
  // permitted; a Gap is too. Something behavioural is not.
  assert.ok(permitted.includes("DataObject"));
  assert.ok(!permitted.includes("BusinessProcess"));
});

/* -- round trip ------------------------------------------------------------ */

test("a model becomes a workspace Blockly can load, and comes back unchanged", () => {
  const state = aboxToWorkspace(PLATFORM_ROADMAP);

  // Real Blockly must accept it. A hand-built state that Blockly rejects is
  // the failure mode this test exists to catch.
  const ws = new Blockly.Workspace();
  assert.doesNotThrow(() => Blockly.serialization.workspaces.load(state, ws));
  assert.equal(
    ws.getAllBlocks().length,
    PLATFORM_ROADMAP.elements.length + PLATFORM_ROADMAP.relationships.length
  );

  // Round trip through Blockly's own serializer, not just our object.
  const saved = Blockly.serialization.workspaces.save(ws);
  const { model, warnings } = workspaceToAbox(saved, "blueprinting");

  assert.deepEqual(warnings, []);
  assert.equal(model.elements.length, PLATFORM_ROADMAP.elements.length);
  assert.equal(model.relationships.length, PLATFORM_ROADMAP.relationships.length);
  assert.equal(hasErrors(validateModel(model)), false);

  for (const original of PLATFORM_ROADMAP.elements) {
    const got = model.elements.find((e) => e.id === original.id);
    assert.ok(got, `${original.id} survived`);
    assert.equal(got.type, original.type);
    assert.equal(got.name, original.name);
    assert.deepEqual(got.properties, original.properties);
  }

  for (const original of PLATFORM_ROADMAP.relationships) {
    const got = model.relationships.find(
      (r) => r.source === original.source && r.target === original.target && r.type === original.type
    );
    assert.ok(got, `${original.id} survived`);
  }
});

test("every element declares a typed variable, which is its identity", () => {
  const state = aboxToWorkspace(PLATFORM_ROADMAP);
  assert.equal(state.variables.length, PLATFORM_ROADMAP.elements.length);
  for (const el of PLATFORM_ROADMAP.elements) {
    const v = state.variables.find((x) => x.id === el.id);
    assert.ok(v, `${el.id} has a variable`);
    assert.equal(v.type, el.type, "typed with its ArchiMate type");
    assert.equal(v.name, el.name);
  }
});

test("an empty model produces an empty but loadable workspace", () => {
  const state = aboxToWorkspace({ projectSlug: "x", elements: [], relationships: [] });
  const ws = new Blockly.Workspace();
  assert.doesNotThrow(() => Blockly.serialization.workspaces.load(state, ws));
  const { model } = workspaceToAbox(Blockly.serialization.workspaces.save(ws), "x");
  assert.deepEqual(model, { projectSlug: "x", elements: [], relationships: [] });
});

test("a relationship the specification forbids is dropped and reported", () => {
  // Unreachable through the palette, reachable through a hand-edited or older
  // workspace file — which is exactly why it must not pass silently.
  const state = {
    variables: [
      { name: "A deliverable", id: "d1", type: "Deliverable" },
      { name: "A work package", id: "w1", type: "WorkPackage" },
    ],
    blocks: {
      languageVersion: 0,
      blocks: [
        {
          type: elementBlockType("Deliverable"),
          id: "d1",
          fields: { ID: { id: "d1" } },
          inputs: {
            relationships: {
              block: {
                type: relationshipBlockType("realization"),
                id: "bad",
                fields: { TARGET: { id: "w1" } },
              },
            },
          },
        },
        {
          type: elementBlockType("WorkPackage"),
          id: "w1",
          fields: { ID: { id: "w1" } },
        },
      ],
    },
  };

  const { model, warnings } = workspaceToAbox(state, "x");
  assert.equal(model.relationships.length, 0, "the illegal relationship is dropped");
  assert.ok(warnings.some((w) => /does not permit/.test(w)), warnings.join("; "));
  assert.equal(hasErrors(validateModel(model)), false);
});

test("an unknown block type is reported rather than crashing", () => {
  const state = {
    variables: [],
    blocks: { languageVersion: 0, blocks: [{ type: "am:Wormhole", id: "x" }] },
  };
  const { model, warnings } = workspaceToAbox(state, "x");
  assert.equal(model.elements.length, 0);
  assert.ok(warnings.some((w) => /not an ArchiMate element type/.test(w)));
});

test("a property the block set does not model still survives the round trip", () => {
  // Property keys are user-defined: the forms editor and the MCP server can
  // write anything. A block with a fixed field set will always meet one it has
  // no home for, and dropping it would be data loss dressed up as a rendering
  // choice. Found by the roadmap round trip, where a Gap's status vanished.
  const model = {
    projectSlug: "x",
    elements: [
      {
        id: "g",
        type: "Gap",
        name: "A gap",
        properties: { status: "closed", owner: "platform team", costCentre: "42" },
      },
    ],
    relationships: [],
  };
  const ws = new Blockly.Workspace();
  Blockly.serialization.workspaces.load(aboxToWorkspace(model), ws);
  const { model: back, warnings } = workspaceToAbox(
    Blockly.serialization.workspaces.save(ws),
    "x"
  );
  assert.deepEqual(warnings, []);
  assert.deepEqual(back.elements[0].properties, model.elements[0].properties);
});

test("a corrupt carrier field is reported, not thrown", () => {
  const state = {
    variables: [{ name: "A gap", id: "g", type: "Gap" }],
    blocks: {
      languageVersion: 0,
      blocks: [
        {
          type: elementBlockType("Gap"),
          id: "g",
          fields: { ID: { id: "g" }, otherProperties: "{not json" },
        },
      ],
    },
  };
  const { model, warnings } = workspaceToAbox(state, "x");
  assert.equal(model.elements.length, 1, "the element still loads");
  assert.ok(warnings.some((w) => /otherProperties/.test(w)));
});
