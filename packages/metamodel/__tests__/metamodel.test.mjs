import { test } from "node:test";
import assert from "node:assert/strict";

import {
  ELEMENTS,
  ELEMENT_TYPE_IDS,
  RELATIONSHIPS,
  RELATIONSHIP_TYPE_IDS,
  LAYER_ORDER,
  allowedRelationships,
  allowedSources,
  allowedTargets,
  elementsByLayer,
  elementsGroupedByLayer,
  isAllowed,
  isDerived,
  isElementType,
  isRelationshipType,
  layerOf,
} from "../dist/index.js";

/*
 * These assertions are taken from the ArchiMate 3.2 specification, not from a
 * previous run of the generator. If re-pinning the ontology breaks one, the
 * upgrade changed the language's semantics and needs a human decision — do not
 * "fix" the test to match the new output.
 */

test("the element inventory matches the specification", () => {
  assert.equal(ELEMENT_TYPE_IDS.length, 60);
  assert.equal(RELATIONSHIP_TYPE_IDS.length, 11);

  // The counts per layer, from the specification's own chapter structure.
  const expected = {
    motivation: 10,
    strategy: 4,
    business: 13,
    application: 9,
    technology: 13,
    physical: 4,
    implementation: 5,
    composite: 2,
  };
  for (const [layer, count] of Object.entries(expected)) {
    assert.equal(elementsByLayer(layer).length, count, `${layer} layer`);
  }
});

test("layer 7 holds exactly the five scheduling elements", () => {
  assert.deepEqual(
    elementsByLayer("implementation")
      .map((e) => e.id)
      .sort(),
    ["Deliverable", "Gap", "ImplementationEvent", "Plateau", "WorkPackage"]
  );
});

test("the eleven relationship types are the specification's", () => {
  assert.deepEqual(RELATIONSHIP_TYPE_IDS.slice().sort(), [
    "access",
    "aggregation",
    "assignment",
    "association",
    "composition",
    "flow",
    "influence",
    "realization",
    "serving",
    "specialization",
    "triggering",
  ]);
});

test("every element carries usable metadata", () => {
  for (const id of ELEMENT_TYPE_IDS) {
    const e = ELEMENTS[id];
    assert.ok(e.label.length > 0, `${id} has a label`);
    assert.ok(e.comment.length > 10, `${id} has a definition`);
    assert.ok(LAYER_ORDER.includes(e.layer), `${id} has a known layer`);
    assert.equal(e.iri, `https://purl.org/archimate#${id}`);
  }
});

test("permitted relationships hold", () => {
  // A work package produces a deliverable.
  assert.ok(isAllowed("WorkPackage", "realization", "Deliverable"));
  // A plateau is composed of the elements that make up that architectural state.
  assert.ok(isAllowed("Plateau", "composition", "ApplicationComponent"));
  // Work packages are sequenced by triggering, which is what a Gantt "after"
  // dependency is generated from.
  assert.ok(isAllowed("WorkPackage", "triggering", "WorkPackage"));
  // An application component realizes an application service.
  assert.ok(isAllowed("ApplicationComponent", "realization", "ApplicationService"));
  // A node is assigned the technology function it performs.
  assert.ok(isAllowed("Node", "assignment", "TechnologyFunction"));
});

test("forbidden relationships are refused", () => {
  // A business actor cannot be composed of an architectural state.
  assert.ok(!isAllowed("BusinessActor", "composition", "Plateau"));
  // A deliverable is passive; it triggers nothing.
  assert.ok(!isAllowed("Deliverable", "triggering", "WorkPackage"));
  // Direction matters: the reverse of a valid pair is not automatically valid.
  assert.ok(isAllowed("WorkPackage", "realization", "Deliverable"));
  assert.ok(!isAllowed("Deliverable", "realization", "WorkPackage"));
});

test("unknown names are refused rather than throwing", () => {
  assert.equal(isAllowed("NotAnElement", "serving", "WorkPackage"), false);
  assert.equal(isAllowed("WorkPackage", "notARelationship", "Deliverable"), false);
  assert.deepEqual(allowedRelationships("NotAnElement", "WorkPackage"), []);
});

test("derived relationships are distinguished from direct ones", () => {
  // Specialization between two elements of the same type is direct.
  assert.ok(isAllowed("WorkPackage", "specialization", "WorkPackage"));
  assert.ok(!isDerived("WorkPackage", "specialization", "WorkPackage"));

  // Somewhere in the matrix there must be both kinds, or the uppercase and
  // lowercase encoding is being lost.
  let direct = 0;
  let derived = 0;
  for (const source of ELEMENT_TYPE_IDS) {
    for (const target of ELEMENT_TYPE_IDS) {
      for (const rel of allowedRelationships(source, target)) {
        if (isDerived(source, rel, target)) derived++;
        else direct++;
      }
    }
  }
  assert.ok(direct > 100, `expected many direct relationships, got ${direct}`);
  assert.ok(derived > 100, `expected many derived relationships, got ${derived}`);
});

test("isDerived reports false for relationships that are not permitted", () => {
  assert.ok(!isAllowed("Deliverable", "triggering", "WorkPackage"));
  assert.ok(!isDerived("Deliverable", "triggering", "WorkPackage"));
});

test("allowedTargets and allowedSources agree with isAllowed", () => {
  const targets = allowedTargets("WorkPackage", "realization");
  assert.ok(targets.includes("Deliverable"));
  for (const t of targets) {
    assert.ok(isAllowed("WorkPackage", "realization", t), `${t}`);
  }

  const sources = allowedSources("realization", "Deliverable");
  assert.ok(sources.includes("WorkPackage"));
  for (const s of sources) {
    assert.ok(isAllowed(s, "realization", "Deliverable"), `${s}`);
  }
});

test("grouping helpers cover every element exactly once", () => {
  const grouped = elementsGroupedByLayer();
  const seen = grouped.flatMap((g) => g.elements.map((e) => e.id));
  assert.equal(seen.length, ELEMENT_TYPE_IDS.length);
  assert.equal(new Set(seen).size, ELEMENT_TYPE_IDS.length);

  // Layers come out in specification order, top-down.
  const order = grouped.map((g) => g.layer);
  assert.deepEqual(
    order,
    LAYER_ORDER.filter((l) => order.includes(l))
  );

  for (const id of ELEMENT_TYPE_IDS) {
    assert.equal(layerOf(id), ELEMENTS[id].layer);
  }
});

test("type guards", () => {
  assert.ok(isElementType("WorkPackage"));
  assert.ok(!isElementType("Relationship"));
  assert.ok(!isElementType("toString"));
  assert.ok(isRelationshipType("serving"));
  assert.ok(!isRelationshipType("hasProperty"));
});
