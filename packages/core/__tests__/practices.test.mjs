import { test } from "node:test";
import assert from "node:assert/strict";

import { PLATFORM_ROADMAP, checkPractices, validateModel } from "../dist/index.js";
import { isDerived } from "@dlab5/archimate-metamodel";

const el = (id, type, name, properties = {}) => ({ id, type, name, properties });
const rel = (id, type, source, target) => ({ id, type, source, target, properties: {} });
const model = (elements, relationships = []) => ({
  projectSlug: "t",
  elements,
  relationships,
});

const codes = (findings) => findings.map((f) => f.code).sort();

/* -- vague relationships --------------------------------------------------- */

test("an association is flagged when a DIRECT alternative exists, and names it", () => {
  // WorkPackage to Deliverable takes a realization directly.
  const findings = checkPractices(
    model(
      [el("a", "WorkPackage", "WP1"), el("b", "Deliverable", "The thing")],
      [rel("r", "association", "a", "b")]
    )
  );
  assert.deepEqual(codes(findings), ["vague-relationship"]);
  assert.match(findings[0].message, /realization/);
});

test("only DERIVED alternatives means an element is missing, and none are named", () => {
  // ApplicationComponent to ApplicationService is derived: the component is
  // assigned to a function, and the function realizes the service. Naming
  // "realization" here would recommend precisely what validateModel warns
  // about as derived-relationship.
  const findings = checkPractices(
    model(
      [
        el("a", "ApplicationComponent", "Portal"),
        el("b", "ApplicationService", "Sign-in"),
      ],
      [rel("r", "association", "a", "b")]
    )
  );
  assert.deepEqual(codes(findings), ["association-hides-an-element"]);
  assert.match(findings[0].message, /intermediate element/);
  assert.doesNotMatch(
    findings[0].message,
    /\brealization\b|\bserving\b|\bassignment\b/,
    "must not recommend a derived relation"
  );
});

test("nothing this check recommends is something validateModel then warns about", () => {
  // The guarantee that keeps the two consistent: every relation named in a
  // vague-relationship message must be direct between those types.
  const cases = [
    ["WorkPackage", "Deliverable"],
    ["ApplicationComponent", "ApplicationService"],
    ["Plateau", "Deliverable"],
    ["BusinessActor", "BusinessRole"],
    ["Node", "Artifact"],
  ];
  for (const [s, t] of cases) {
    const findings = checkPractices(
      model([el("a", s, "A"), el("b", t, "B")], [rel("r", "association", "a", "b")])
    );
    const vague = findings.find((f) => f.code === "vague-relationship");
    if (!vague) continue;
    for (const name of ["realization", "serving", "assignment", "access", "flow", "triggering"]) {
      if (!vague.message.includes(name)) continue;
      assert.ok(
        !isDerived(s, name, t),
        `${s} -> ${t}: recommended ${name}, which is derived`
      );
    }
  }
});

test("the flagged association names the relationship, not the elements", () => {
  const findings = checkPractices(
    model(
      [el("a", "ApplicationComponent", "Portal"), el("b", "ApplicationService", "S")],
      [rel("the-rel", "association", "a", "b")]
    )
  );
  assert.equal(findings[0].subject, "the-rel");
});

test("an association is left alone when nothing more specific is permitted", () => {
  // Two Plateaus: ArchiMate allows association between them and little else,
  // which is exactly when an association is the right answer.
  const findings = checkPractices(
    model(
      [el("p1", "Plateau", "P1"), el("g", "Gap", "A gap")],
      [rel("r", "association", "p1", "g")]
    )
  );
  assert.deepEqual(
    findings.filter((f) => f.code === "vague-relationship"),
    []
  );
});

test("a specific relationship is never flagged as vague", () => {
  const findings = checkPractices(
    model(
      [el("a", "WorkPackage", "WP"), el("b", "Deliverable", "D")],
      [rel("r", "realization", "a", "b")]
    )
  );
  assert.deepEqual(codes(findings), []);
});

test("a dangling association is left to validateModel", () => {
  // validateModel already reports dangling-source/target; reporting it twice
  // in two vocabularies would be worse than reporting it once.
  const findings = checkPractices(
    model([el("a", "ApplicationComponent", "Portal")], [rel("r", "association", "a", "ghost")])
  );
  assert.deepEqual(codes(findings), []);
});

/* -- properties that shadow an element ------------------------------------- */

test("an owner property naming a real actor is flagged", () => {
  const findings = checkPractices(
    model([
      el("c", "ApplicationComponent", "Portal", { owner: "Platform guild" }),
      el("a", "BusinessActor", "Platform guild"),
    ])
  );
  assert.deepEqual(codes(findings), ["property-shadows-element"]);
  assert.equal(findings[0].subject, "c");
  assert.match(findings[0].message, /assignment relationship/);
});

test("matching ignores case and surrounding space", () => {
  const findings = checkPractices(
    model([
      el("c", "ApplicationComponent", "Portal", { owner: "  platform GUILD " }),
      el("a", "BusinessRole", "Platform guild"),
    ])
  );
  assert.equal(findings.length, 1);
});

test("an owner naming nobody in the model is not flagged", () => {
  const findings = checkPractices(
    model([
      el("c", "ApplicationComponent", "Portal", { owner: "Some other team" }),
      el("a", "BusinessActor", "Platform guild"),
    ])
  );
  assert.deepEqual(codes(findings), []);
});

test("a model with no parties at all raises nothing", () => {
  const findings = checkPractices(
    model([el("c", "ApplicationComponent", "Portal", { owner: "Platform guild" })])
  );
  assert.deepEqual(codes(findings), []);
});

test("only party element types count as shadowed", () => {
  // A Deliverable happening to share a name with an owner string is a
  // coincidence, not a flattened relationship.
  const findings = checkPractices(
    model([
      el("c", "ApplicationComponent", "Portal", { owner: "Platform guild" }),
      el("d", "Deliverable", "Platform guild"),
    ])
  );
  assert.deepEqual(codes(findings), []);
});

test("the properties checked can be changed, and emptied to disable", () => {
  const m = model([
    el("c", "ApplicationComponent", "Portal", { steward: "Platform guild" }),
    el("a", "BusinessActor", "Platform guild"),
  ]);
  assert.deepEqual(codes(checkPractices(m)), [], "owner is the default, not steward");
  assert.deepEqual(codes(checkPractices(m, { partyProperties: ["steward"] })), [
    "property-shadows-element",
  ]);
  assert.deepEqual(codes(checkPractices(m, { partyProperties: [] })), []);
});

/* -- the shape of what comes back ------------------------------------------ */

test("every practice finding is a warning and carries a citation", () => {
  const findings = checkPractices(
    model(
      [
        el("c", "ApplicationComponent", "Portal", { owner: "Platform guild" }),
        el("a", "BusinessActor", "Platform guild"),
        el("s", "ApplicationService", "Sign-in"),
      ],
      [rel("r", "association", "c", "s")]
    )
  );
  assert.equal(findings.length, 2);
  for (const f of findings) {
    // None of this makes a model wrong — it is all "worth reconsidering".
    assert.equal(f.severity, "warning");
    assert.ok(f.source, `${f.code} has no citation`);
    assert.ok(f.subject, `${f.code} attaches to nothing`);
  }
});

test("practice findings merge with validateModel's without collision", () => {
  const m = model(
    [
      el("c", "ApplicationComponent", "Portal", { owner: "Platform guild" }),
      el("a", "BusinessActor", "Platform guild"),
      el("s", "ApplicationService", "Sign-in"),
    ],
    [rel("r", "association", "c", "s")]
  );
  const all = [...validateModel(m), ...checkPractices(m)];
  const seen = new Set(all.map((f) => f.code));
  assert.ok(seen.has("property-shadows-element"));
  assert.ok(seen.has("vague-relationship") || seen.has("association-hides-an-element"));
});

test("the platform's own roadmap is checked without throwing", () => {
  const findings = checkPractices(PLATFORM_ROADMAP);
  for (const f of findings) assert.equal(f.severity, "warning");
});

test("an empty model raises nothing", () => {
  assert.deepEqual(checkPractices(model([])), []);
});
