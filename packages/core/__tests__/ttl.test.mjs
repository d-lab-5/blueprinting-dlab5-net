import { test } from "node:test";
import assert from "node:assert/strict";

import {
  emptyModel,
  hasErrors,
  parseAbox,
  serializeAbox,
  slugifyId,
  uniqueId,
  validateModel,
} from "../dist/index.js";

/** A small but complete Layer 7 model: every field exercised at least once. */
const roadmap = {
  projectSlug: "blueprinting",
  elements: [
    {
      id: "p0",
      type: "Plateau",
      name: "P0 Empty Repo",
      documentation: "Two commits and a README.",
      properties: { startDate: "2026-08-23", status: "done" },
    },
    {
      id: "p1",
      type: "Plateau",
      name: "P1 Authenticated Shell",
      properties: { startDate: "2026-08-23", endDate: "2026-08-24" },
    },
    {
      id: "wp1",
      type: "WorkPackage",
      name: "Foundation",
      documentation: "Gatsby shell on an Amplify Gen 2 backend.",
      properties: { startDate: "2026-08-23", endDate: "2026-08-24" },
    },
    {
      id: "d1",
      type: "Deliverable",
      name: "Deployed authenticated shell",
      properties: {},
    },
    {
      id: "golive",
      type: "ImplementationEvent",
      name: "stage goes green",
      properties: { startDate: "2026-08-24" },
    },
  ],
  relationships: [
    {
      id: "r1",
      type: "realization",
      source: "wp1",
      target: "d1",
      name: "produces",
      properties: { confidence: "high" },
    },
    { id: "r2", type: "triggering", source: "wp1", target: "golive", properties: {} },
    { id: "r3", type: "realization", source: "d1", target: "p1", properties: {} },
  ],
};

test("a model survives a serialize/parse round trip", async () => {
  const ttl = await serializeAbox(roadmap);
  const back = parseAbox(ttl, "blueprinting");

  assert.equal(back.projectSlug, "blueprinting");
  assert.equal(back.elements.length, roadmap.elements.length);
  assert.equal(back.relationships.length, roadmap.relationships.length);

  const sortById = (a, b) => a.id.localeCompare(b.id);
  assert.deepEqual(
    back.elements.slice().sort(sortById),
    roadmap.elements
      .slice()
      .sort(sortById)
      .map((e) => ({ documentation: undefined, ...e })),
  );

  for (const original of roadmap.relationships) {
    const got = back.relationships.find((r) => r.id === original.id);
    assert.ok(got, `relationship ${original.id} survived`);
    assert.equal(got.type, original.type);
    assert.equal(got.source, original.source);
    assert.equal(got.target, original.target);
    assert.deepEqual(got.properties, original.properties);
    assert.equal(got.name, original.name);
  }
});

test("serialisation is byte-stable, so a no-op edit is not a diff", async () => {
  const once = await serializeAbox(roadmap);
  const twice = await serializeAbox(parseAbox(once, "blueprinting"));
  assert.equal(once, twice);

  // Property order in the input must not change the output either — an ETag
  // precondition would otherwise reject a save that changed nothing.
  const reordered = {
    ...roadmap,
    elements: roadmap.elements
      .slice()
      .reverse()
      .map((e) => ({
        ...e,
        properties: Object.fromEntries(Object.entries(e.properties).reverse()),
      })),
  };
  assert.equal(await serializeAbox(reordered), once);
});

test("the output is real Turtle using the ArchiMate vocabulary", async () => {
  const ttl = await serializeAbox(roadmap);
  assert.match(ttl, /@prefix archimate: <https:\/\/purl\.org\/archimate#>/);
  // The plain, ArchiMate-faithful triple any consumer reads.
  assert.match(ttl, /archimate:realization/);
  // Layer 7 types are written as their real class IRIs, not strings.
  assert.match(ttl, /a archimate:WorkPackage/);
  assert.match(ttl, /a archimate:Plateau/);
  // Scheduling data rides on ArchiMate Properties, which is what round-trips
  // into Archi through the Open Exchange format.
  assert.match(ttl, /archimate:propertyKey "startDate"/);
});

test("a file that knows nothing about bp: still round-trips", async () => {
  // Exactly what an external tool or a hand edit would produce: plain triples,
  // no descriptors. Relationships must survive, with generated ids.
  const plain = `
    @prefix archimate: <https://purl.org/archimate#> .

    <https://blueprinting.dlab5.net/i/demo/WorkPackage/wp1>
        a archimate:WorkPackage ;
        archimate:identifier "wp1" ;
        archimate:name "Foundation" ;
        archimate:realization <https://blueprinting.dlab5.net/i/demo/Deliverable/d1> .

    <https://blueprinting.dlab5.net/i/demo/Deliverable/d1>
        a archimate:Deliverable ;
        archimate:identifier "d1" ;
        archimate:name "Shell" .
  `;
  const model = parseAbox(plain, "demo");
  assert.equal(model.elements.length, 2);
  assert.equal(model.relationships.length, 1);
  assert.equal(model.relationships[0].type, "realization");
  assert.equal(model.relationships[0].source, "wp1");
  assert.equal(model.relationships[0].target, "d1");
  assert.equal(model.relationships[0].id, "wp1-realization-d1");

  // And re-serialising it produces a file that parses back the same way.
  const back = parseAbox(await serializeAbox(model), "demo");
  assert.deepEqual(back.relationships, model.relationships);
});

test("a descriptor with no matching triple is ignored", async () => {
  // The plain triple is authoritative (ADR-0005). A stale descriptor left
  // behind by a bad edit must not conjure a relationship that is not asserted.
  const stale = `
    @prefix archimate: <https://purl.org/archimate#> .
    @prefix bp: <https://blueprinting.dlab5.net/ns#> .

    <https://blueprinting.dlab5.net/i/demo/WorkPackage/wp1>
        a archimate:WorkPackage ; archimate:identifier "wp1" .
    <https://blueprinting.dlab5.net/i/demo/Deliverable/d1>
        a archimate:Deliverable ; archimate:identifier "d1" .

    <https://blueprinting.dlab5.net/i/demo/realization/ghost>
        a archimate:Relationship ;
        archimate:identifier "ghost" ;
        bp:relationshipType archimate:realization ;
        bp:source <https://blueprinting.dlab5.net/i/demo/WorkPackage/wp1> ;
        bp:target <https://blueprinting.dlab5.net/i/demo/Deliverable/d1> .
  `;
  assert.equal(parseAbox(stale, "demo").relationships.length, 0);
});

test("an empty model round-trips", async () => {
  const model = emptyModel("demo");
  const back = parseAbox(await serializeAbox(model), "demo");
  assert.deepEqual(back, model);
});

/* -- validation ----------------------------------------------------------- */

test("a well-formed model validates clean of errors", () => {
  const findings = validateModel(roadmap);
  assert.equal(hasErrors(findings), false, JSON.stringify(findings, null, 2));
});

test("a relationship ArchiMate forbids is an error", () => {
  const bad = {
    ...roadmap,
    relationships: [
      ...roadmap.relationships,
      { id: "bad", type: "composition", source: "d1", target: "wp1", properties: {} },
    ],
  };
  const findings = validateModel(bad);
  assert.ok(hasErrors(findings));
  assert.ok(findings.some((f) => f.code === "forbidden-relationship"));
});

test("a dangling endpoint is an error, and does not reach the writer", async () => {
  const bad = {
    ...roadmap,
    relationships: [
      ...roadmap.relationships,
      { id: "orphan", type: "realization", source: "wp1", target: "nope", properties: {} },
    ],
  };
  const findings = validateModel(bad);
  assert.ok(findings.some((f) => f.code === "dangling-target"));

  // Serialising must not emit a broken graph for it.
  const back = parseAbox(await serializeAbox(bad), "blueprinting");
  assert.ok(!back.relationships.some((r) => r.id === "orphan"));
});

test("duplicate ids are errors", () => {
  const dup = {
    ...roadmap,
    elements: [...roadmap.elements, { ...roadmap.elements[0] }],
  };
  assert.ok(
    validateModel(dup).some((f) => f.code === "duplicate-element-id")
  );
});

test("an unknown element type is rejected by the schema", () => {
  const bogus = {
    ...roadmap,
    elements: [
      ...roadmap.elements,
      { id: "x", type: "Wormhole", name: "x", properties: {} },
    ],
  };
  const findings = validateModel(bogus);
  assert.ok(hasErrors(findings));
  assert.ok(findings.some((f) => f.code === "schema"));
});

test("ids are constrained to what an IRI segment can hold", () => {
  assert.equal(slugifyId("Work Package 1"), "work-package-1");
  assert.equal(slugifyId("a/b"), "a-b");
  assert.equal(slugifyId("!!!"), "x");
  assert.equal(uniqueId("wp", ["wp"]), "wp-2");
  assert.equal(uniqueId("wp", ["wp", "wp-2"]), "wp-3");
});
