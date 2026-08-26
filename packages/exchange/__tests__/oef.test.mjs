import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { PLATFORM_ROADMAP, validateModel, hasErrors } from "@dlab5/blueprint-core";
import { fromOpenExchange, toOpenExchange } from "../dist/index.js";

/**
 * The important assertions here go through xmllint and the Open Group's own
 * XSD, not through our own reader. A round trip that only proves our exporter
 * and our importer agree with each other proves nothing about whether Archi
 * will open the file.
 *
 * The schema is fetched on demand into a gitignored cache rather than vendored
 * — it belongs to The Open Group — and the schema-dependent tests skip when it
 * is unavailable, so the suite still runs offline.
 */
const CACHE = join(process.cwd(), "..", "..", ".xsd-cache");
const XSD = join(CACHE, "archimate3_Model.xsd");
const XSD_URL =
  "https://www.opengroup.org/xsd/archimate/3.0/archimate3_Model.xsd";

let xmllint = true;
try {
  execFileSync("xmllint", ["--version"], { stdio: "ignore" });
} catch {
  xmllint = false;
}

if (!existsSync(XSD)) {
  try {
    mkdirSync(CACHE, { recursive: true });
    const res = await fetch(XSD_URL);
    if (res.ok) writeFileSync(XSD, await res.text());
  } catch {
    /* offline; the schema tests will skip */
  }
}
const haveSchema = xmllint && existsSync(XSD);

const tmp = mkdtempSync(join(tmpdir(), "oef-"));
const writeTmp = (name, content) => {
  const p = join(tmp, name);
  writeFileSync(p, content);
  return p;
};

/** Validates against the official XSD. Returns null when valid. */
function schemaErrors(xml) {
  try {
    execFileSync("xmllint", ["--noout", "--schema", XSD, writeTmp("m.xml", xml)], {
      stdio: ["ignore", "ignore", "pipe"],
    });
    return null;
  } catch (err) {
    return (err.stderr?.toString() ?? String(err)).trim();
  }
}

/* -------------------------------------------------------------------------- */

test(
  "the platform roadmap validates against the Open Group schema",
  { skip: haveSchema ? false : "xmllint or the XSD is unavailable" },
  () => {
    const xml = toOpenExchange(PLATFORM_ROADMAP, {
      name: "D-LAB-5 Blueprinting Platform",
    });
    assert.equal(schemaErrors(xml), null);
  }
);

test(
  "a model using every relationship type validates",
  { skip: haveSchema ? false : "xmllint or the XSD is unavailable" },
  () => {
    // Each of the 11 has its own complexType in the schema, and our ids are
    // lowerCamelCase where the format is PascalCase. Exercise all of them so a
    // mapping mistake cannot hide behind the four the roadmap happens to use.
    const types = [
      "access", "aggregation", "assignment", "association", "composition",
      "flow", "influence", "realization", "serving", "specialization",
      "triggering",
    ];
    const model = {
      projectSlug: "all-rels",
      elements: [
        { id: "a", type: "ApplicationComponent", name: "A", properties: {} },
        { id: "b", type: "ApplicationComponent", name: "B", properties: {} },
      ],
      relationships: types.map((type, i) => ({
        id: `r${i}`,
        type,
        source: "a",
        target: "b",
        properties: {},
      })),
    };
    assert.equal(schemaErrors(toOpenExchange(model)), null);
  }
);

test(
  "an id that is not a valid XML name still produces a valid document",
  { skip: haveSchema ? false : "xmllint or the XSD is unavailable" },
  () => {
    // xs:ID is an NCName and may not start with a digit, but "3rd party
    // gateway" is a perfectly reasonable thing to model. The prefix is what
    // makes this safe.
    const model = {
      projectSlug: "x",
      elements: [
        { id: "3rd-party-gateway", type: "Node", name: "3rd party gateway", properties: {} },
        { id: "9", type: "Node", name: "Nine", properties: {} },
      ],
      relationships: [
        { id: "1", type: "association", source: "3rd-party-gateway", target: "9", properties: {} },
      ],
    };
    assert.equal(schemaErrors(toOpenExchange(model)), null);
  }
);

test(
  "text needing XML escaping validates and survives",
  { skip: haveSchema ? false : "xmllint or the XSD is unavailable" },
  () => {
    const model = {
      projectSlug: "x",
      elements: [
        {
          id: "a",
          type: "WorkPackage",
          name: 'Migrate <legacy> & "quoted" stuff',
          documentation: "if a < b && c > d then <report/>",
          properties: { "note<>&": 'a "value" & more' },
        },
      ],
      relationships: [],
    };
    const xml = toOpenExchange(model);
    assert.equal(schemaErrors(xml), null);

    const { model: back } = fromOpenExchange(xml, "x");
    assert.equal(back.elements[0].name, 'Migrate <legacy> & "quoted" stuff');
    assert.equal(back.elements[0].documentation, "if a < b && c > d then <report/>");
    assert.deepEqual(back.elements[0].properties, { "note<>&": 'a "value" & more' });
  }
);

/* -- round trip ------------------------------------------------------------ */

test("a model survives export and re-import unchanged", () => {
  const xml = toOpenExchange(PLATFORM_ROADMAP);
  const { model: back, warnings } = fromOpenExchange(xml, "blueprinting");

  assert.deepEqual(warnings, []);
  assert.equal(back.elements.length, PLATFORM_ROADMAP.elements.length);
  assert.equal(
    back.relationships.length,
    PLATFORM_ROADMAP.relationships.length
  );

  const sortById = (a, b) => a.id.localeCompare(b.id);
  assert.deepEqual(
    back.elements.slice().sort(sortById),
    PLATFORM_ROADMAP.elements
      .slice()
      .sort(sortById)
      .map((e) => ({ documentation: undefined, ...e }))
  );

  for (const original of PLATFORM_ROADMAP.relationships) {
    const got = back.relationships.find((r) => r.id === original.id);
    assert.ok(got, `relationship ${original.id} survived`);
    assert.equal(got.type, original.type);
    assert.equal(got.source, original.source);
    assert.equal(got.target, original.target);
  }

  // And the re-imported model is still legal ArchiMate.
  assert.equal(hasErrors(validateModel(back)), false);
});

test("scheduling properties round-trip, which is the point of using Properties", () => {
  const xml = toOpenExchange(PLATFORM_ROADMAP);
  const { model: back } = fromOpenExchange(xml, "blueprinting");
  const wp1 = back.elements.find((e) => e.id === "wp1");
  assert.equal(wp1.properties.startDate, "2026-08-23");
  assert.equal(wp1.properties.status, "done");
});

test("an empty model produces a valid, minimal document", () => {
  const xml = toOpenExchange({ projectSlug: "x", elements: [], relationships: [] });
  assert.match(xml, /<model/);
  assert.ok(!xml.includes("<elements>"));
  const { model: back } = fromOpenExchange(xml, "x");
  assert.deepEqual(back, { projectSlug: "x", elements: [], relationships: [] });
});

/* -- importing what Archi produces ---------------------------------------- */

test("concepts this platform cannot represent are reported, not dropped silently", () => {
  // What an Archi file actually contains: junctions, views, geometry.
  const archiLike = `<?xml version="1.0" encoding="UTF-8"?>
<model xmlns="http://www.opengroup.org/xsd/archimate/3.0/"
       xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
       identifier="m1">
  <name xml:lang="en">From Archi</name>
  <elements>
    <element identifier="id-1" xsi:type="ApplicationComponent">
      <name xml:lang="en">Billing</name>
    </element>
    <element identifier="id-2" xsi:type="ApplicationService">
      <name xml:lang="en">Invoicing</name>
    </element>
    <element identifier="id-j" xsi:type="AndJunction">
      <name xml:lang="en">Fan out</name>
    </element>
  </elements>
  <relationships>
    <relationship identifier="id-r1" source="id-1" target="id-2" xsi:type="Realization" />
    <relationship identifier="id-r2" source="id-1" target="id-j" xsi:type="Triggering" />
  </relationships>
  <views>
    <diagrams>
      <view identifier="id-v1" xsi:type="Diagram"><name xml:lang="en">Layout</name></view>
    </diagrams>
  </views>
</model>`;

  const { model, warnings } = fromOpenExchange(archiLike, "imported");

  // The two real elements and the one relationship between them come through.
  assert.equal(model.elements.length, 2);
  assert.deepEqual(
    model.elements.map((e) => e.name).sort(),
    ["Billing", "Invoicing"]
  );
  assert.equal(model.relationships.length, 1);
  assert.equal(model.relationships[0].type, "realization");

  // The junction, the relationship to it, and the view are each accounted for.
  assert.ok(warnings.some((w) => /AndJunction/.test(w)));
  assert.ok(warnings.some((w) => /endpoint was not imported/.test(w)));
  assert.ok(warnings.some((w) => /view/.test(w)));
});

test("identifiers Archi generates are preserved, not mangled", () => {
  // Archi uses opaque ids like "id-4f8a...". Only prefixes this exporter added
  // are stripped, so a file that did not come from here keeps its identity.
  const foreign = `<?xml version="1.0" encoding="UTF-8"?>
<model xmlns="http://www.opengroup.org/xsd/archimate/3.0/"
       xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" identifier="m1">
  <name xml:lang="en">x</name>
  <elements>
    <element identifier="4f8a9c" xsi:type="Node"><name xml:lang="en">Host</name></element>
  </elements>
</model>`;
  const { model } = fromOpenExchange(foreign, "x");
  assert.equal(model.elements[0].id, "4f8a9c");
});
