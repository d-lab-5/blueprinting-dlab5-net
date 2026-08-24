import { test } from "node:test";
import assert from "node:assert/strict";

import {
  RADAR_ELEMENT_TYPES,
  RADAR_RINGS,
  canBeRadarEntry,
  hasErrors,
  parseAbox,
  serializeAbox,
  toRadar,
  validateModel,
  validateRadar,
} from "../dist/index.js";

/** A radar modelled the sanctioned way: Groupings for quadrants, rings as properties. */
const model = {
  projectSlug: "radar",
  elements: [
    { id: "q-lang", type: "Grouping", name: "Languages & Frameworks", properties: {} },
    { id: "q-plat", type: "Grouping", name: "Platforms", properties: {} },
    { id: "q-tools", type: "Grouping", name: "Tools", properties: {} },
    { id: "q-tech", type: "Grouping", name: "Techniques", properties: {} },

    {
      id: "typescript",
      type: "ApplicationComponent",
      name: "TypeScript",
      properties: { radarRing: "adopt" },
    },
    {
      id: "gatsby",
      type: "ApplicationComponent",
      name: "Gatsby 5",
      properties: { radarRing: "trial", radarMoved: "in" },
    },
    {
      id: "amplify",
      type: "SystemSoftware",
      name: "AWS Amplify Gen 2",
      documentation: "Backend-as-code for the platform.",
      properties: { radarRing: "adopt" },
    },
    {
      id: "archi",
      type: "ApplicationComponent",
      name: "Archi",
      properties: { radarRing: "assess" },
    },
    {
      id: "dac",
      type: "BusinessProcess",
      name: "Diagram-as-code",
      properties: { radarRing: "adopt" },
    },
    {
      id: "rdfstar",
      type: "ApplicationComponent",
      name: "RDF-Star in JavaScript",
      documentation: "N3.js discards it silently. See ADR-0005.",
      properties: { radarRing: "hold", radarMoved: "out" },
    },
  ],
  relationships: [
    { id: "a1", type: "aggregation", source: "q-lang", target: "typescript", properties: {} },
    { id: "a2", type: "aggregation", source: "q-lang", target: "gatsby", properties: {} },
    { id: "a3", type: "aggregation", source: "q-plat", target: "amplify", properties: {} },
    { id: "a4", type: "aggregation", source: "q-tools", target: "archi", properties: {} },
    { id: "a5", type: "aggregation", source: "q-tech", target: "dac", properties: {} },
    { id: "a6", type: "aggregation", source: "q-tools", target: "rdfstar", properties: {} },
  ],
};

test("the convention is legal ArchiMate, not just plausible", () => {
  // If a future ontology pin made Grouping -aggregation-> X illegal, the whole
  // convention would be quietly invalid. Ask the metamodel, do not assume.
  for (const type of RADAR_ELEMENT_TYPES) {
    assert.ok(canBeRadarEntry(type), `Grouping cannot aggregate ${type}`);
  }
  assert.equal(hasErrors(validateModel(model)), false);
});

test("the radar reads out of the model", () => {
  const radar = toRadar(model);
  assert.deepEqual(
    radar.map((q) => q.name),
    ["Languages & Frameworks", "Platforms", "Techniques", "Tools"]
  );

  const lang = radar.find((q) => q.name === "Languages & Frameworks");
  assert.deepEqual(
    lang.entries.map((e) => [e.label, e.ring]),
    [
      ["TypeScript", "adopt"],
      ["Gatsby 5", "trial"],
    ]
  );
});

test("two quadrants can share an ArchiMate type", () => {
  // The reason quadrant is a Grouping rather than the element type: both of
  // these are ApplicationComponent, and the type cannot tell them apart.
  const radar = toRadar(model);
  const tools = radar.find((q) => q.name === "Tools");
  const lang = radar.find((q) => q.name === "Languages & Frameworks");
  assert.ok(tools.entries.some((e) => e.label === "Archi"));
  assert.ok(lang.entries.some((e) => e.label === "TypeScript"));
  assert.equal(
    tools.entries.find((e) => e.label === "Archi").type,
    lang.entries.find((e) => e.label === "TypeScript").type
  );
});

test("entries are ordered by ring, adopt outward", () => {
  const radar = toRadar(model);
  for (const q of radar) {
    const positions = q.entries.map((e) => RADAR_RINGS.indexOf(e.ring));
    assert.deepEqual(positions, positions.slice().sort((a, b) => a - b));
  }
});

test("movement is carried through, defaulting to none", () => {
  const radar = toRadar(model);
  const all = radar.flatMap((q) => q.entries);
  assert.equal(all.find((e) => e.label === "Gatsby 5").moved, "in");
  assert.equal(all.find((e) => e.label === "RDF-Star in JavaScript").moved, "out");
  assert.equal(all.find((e) => e.label === "TypeScript").moved, "none");
});

test("an entry keeps its identity as a model element", () => {
  // The whole point: a radar entry IS the element the architecture uses, so it
  // can be pointed at from a diagram. Not a copy with its own id.
  const radar = toRadar(model);
  const amplify = radar
    .flatMap((q) => q.entries)
    .find((e) => e.label === "AWS Amplify Gen 2");
  assert.equal(amplify.id, "amplify");
  assert.equal(amplify.type, "SystemSoftware");
  assert.equal(amplify.description, "Backend-as-code for the platform.");
  assert.ok(model.elements.some((e) => e.id === amplify.id));
});

test("the radar survives a Turtle round trip", async () => {
  const back = parseAbox(await serializeAbox(model), "radar");
  assert.deepEqual(toRadar(back), toRadar(model));
});

/* -- the convention's own validation -------------------------------------- */

test("a ring with no quadrant is reported, not silently dropped", () => {
  const orphan = {
    ...model,
    elements: [
      ...model.elements,
      { id: "lonely", type: "ApplicationComponent", name: "Lonely", properties: { radarRing: "trial" } },
    ],
  };
  const findings = validateRadar(orphan);
  assert.ok(findings.some((f) => f.code === "radar-no-quadrant" && f.subject === "lonely"));
  // ...and it does not appear on the radar.
  assert.ok(!toRadar(orphan).flatMap((q) => q.entries).some((e) => e.id === "lonely"));
});

test("a misspelled ring is an error", () => {
  const bad = {
    ...model,
    elements: model.elements.map((e) =>
      e.id === "typescript" ? { ...e, properties: { radarRing: "ADOPTED" } } : e
    ),
  };
  assert.ok(validateRadar(bad).some((f) => f.code === "radar-bad-ring"));
});

test("a ring on something nobody adopts is a warning", () => {
  const odd = {
    ...model,
    elements: [
      ...model.elements,
      { id: "p", type: "Plateau", name: "Target state", properties: { radarRing: "adopt" } },
    ],
    relationships: [
      ...model.relationships,
      { id: "a7", type: "aggregation", source: "q-tools", target: "p", properties: {} },
    ],
  };
  const findings = validateRadar(odd);
  assert.ok(findings.some((f) => f.code === "radar-odd-type" && f.subject === "p"));
  // A warning, never an error — it is still valid ArchiMate.
  assert.ok(!findings.some((f) => f.severity === "error"));
});

test("a clean radar reports nothing", () => {
  assert.deepEqual(validateRadar(model), []);
});

/* -- the overlay is the source, not a copy -------------------------------- */

test("the radar convention comes from the ontology, not from TypeScript", async () => {
  const { readFileSync } = await import("node:fs");
  // Comments stripped first. The overlay's own § Spec versions section shows
  // an illustrative `archimate:SomeNewElement bp:radarEligible true`, and a
  // naive read of the file picks it up. The generator does not — it anchors
  // its subject match at the start of a line — but this test must not either.
  const overlay = readFileSync(
    new URL("../../../ontology/overlay/blueprinting-app-metadata.ttl", import.meta.url),
    "utf8"
  )
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("#"))
    .join("\n");

  // Every ring the code accepts must be declared in the overlay's sh:in list.
  // If someone adds a ring in TypeScript, this fails; the overlay is the only
  // place a convention is declared. See ADR-0007.
  const declared = overlay
    .match(/bp:radarRing[\s\S]*?sh:in\s*\(([^)]*)\)/)[1]
    .match(/"([^"]*)"/g)
    .map((s) => s.replaceAll('"', ""));
  assert.deepEqual([...RADAR_RINGS], declared);

  // Likewise the eligible types.
  const eligible = [...overlay.matchAll(/archimate:(\w+)\s+bp:radarEligible\s+true/g)]
    .map((m) => m[1])
    .sort();
  assert.deepEqual([...RADAR_ELEMENT_TYPES].sort(), eligible);
});
