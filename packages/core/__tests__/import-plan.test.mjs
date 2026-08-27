import { test } from "node:test";
import assert from "node:assert/strict";

import {
  applyImport,
  everyChange,
  fromAnnotatedMarkdown,
  planImport,
} from "../dist/index.js";

const el = (id, type, name, properties = {}, documentation) => ({
  id,
  type,
  name,
  properties,
  ...(documentation === undefined ? {} : { documentation }),
});

const model = (elements = [], relationships = []) => ({
  projectSlug: "p-test",
  elements,
  relationships,
});

const DOC = "stakeholder-review";

const read = (source) => fromAnnotatedMarkdown(source, "p-test", { documentId: DOC }).model;

/* -- the three cases ------------------------------------------------------- */

test("an element not in the model is a create", () => {
  const plan = planImport(model(), read(`<!-- am element type=Stakeholder id=cfo -->
## CFO
`), DOC);
  assert.equal(plan.elements.length, 1);
  assert.equal(plan.elements[0].kind, "create");
});

test("an identical element is unchanged, and applying does nothing", () => {
  const incoming = read(`<!-- am element type=Stakeholder id=cfo -->
## CFO
Owns the cost line.
`);
  const current = model([...incoming.elements]);

  const plan = planImport(current, incoming, DOC);
  assert.equal(plan.elements[0].kind, "unchanged");
  assert.deepEqual(plan.elements[0].differing, []);

  const after = applyImport(current, plan, everyChange(plan));
  assert.deepEqual(after.elements, current.elements);
});

test("a changed heading is an update, and names the field that differs", () => {
  const current = model([
    el("cfo", "Stakeholder", "CFO", { sourceDocument: DOC }, "Owns the cost line."),
  ]);
  const plan = planImport(current, read(`<!-- am element type=Stakeholder id=cfo -->
## Group Chief Financial Officer
Owns the cost line.
`), DOC);

  assert.equal(plan.elements[0].kind, "update");
  assert.deepEqual(plan.elements[0].differing, ["name"]);
  assert.equal(plan.elements[0].existing.name, "CFO");
});

/* -- the defect most likely to ship unnoticed ------------------------------ */

test("importing the same document twice changes nothing the second time", () => {
  // If matching is broken this produces a second CFO, and nobody notices until
  // the model has two of everything.
  const source = `<!-- am element type=Stakeholder id=cfo -->
## CFO
Owns the cost line.

<!-- am element type=Driver id=cost -->
## Cost per transaction
Below EUR 0.02.

<!-- am rel type=influence from=cfo to=cost -->
`;

  const first = planImport(model(), read(source), DOC);
  const once = applyImport(model(), first, everyChange(first));
  assert.equal(once.elements.length, 2);
  assert.equal(once.relationships.length, 1);

  const second = planImport(once, read(source), DOC);
  assert.ok(
    second.elements.every((c) => c.kind === "unchanged"),
    `second import proposed: ${JSON.stringify(second.elements.map((c) => c.kind))}`
  );
  assert.ok(second.relationships.every((c) => c.kind === "unchanged"));

  const twice = applyImport(once, second, everyChange(second));
  assert.equal(twice.elements.length, 2);
  assert.equal(twice.relationships.length, 1);
  assert.deepEqual(twice.elements.map((e) => e.id).sort(), ["cfo", "cost"]);
});

/* -- what an import must never destroy ------------------------------------- */

test("properties the document knows nothing about survive an update", () => {
  // The radar reads radarRing. An import that replaced properties instead of
  // merging them would empty the radar, and nobody would connect the two.
  const current = model([
    el("ecc", "SystemSoftware", "SAP ECC", {
      radarRing: "hold",
      owner: "Platform team",
      sourceDocument: DOC,
    }),
  ]);
  const plan = planImport(current, read(`<!-- am element type=SystemSoftware id=ecc -->
## SAP ECC 6.0
`), DOC);

  const after = applyImport(current, plan, everyChange(plan));
  const ecc = after.elements[0];
  assert.equal(ecc.name, "SAP ECC 6.0", "the name should be updated");
  assert.equal(ecc.properties.radarRing, "hold", "radarRing was destroyed");
  assert.equal(ecc.properties.owner, "Platform team", "owner was destroyed");
});

test("a change not accepted is left exactly as it was", () => {
  const current = model([
    el("cfo", "Stakeholder", "CFO", { sourceDocument: DOC }, "Hand-edited in the app."),
  ]);
  const plan = planImport(current, read(`<!-- am element type=Stakeholder id=cfo -->
## CFO
Replaced by the document.
`), DOC);

  assert.equal(plan.elements[0].kind, "update");
  const after = applyImport(current, plan, new Set()); // accept nothing
  assert.equal(after.elements[0].documentation, "Hand-edited in the app.");
});

test("an element dropped from the document is reported, never deleted", () => {
  const current = model([
    el("cfo", "Stakeholder", "CFO", { sourceDocument: DOC }),
    el("coo", "Stakeholder", "COO", { sourceDocument: DOC }),
  ]);
  const plan = planImport(current, read(`<!-- am element type=Stakeholder id=cfo -->
## CFO
`), DOC);

  assert.deepEqual(plan.orphaned.map((e) => e.id), ["coo"]);
  const after = applyImport(current, plan, everyChange(plan));
  assert.equal(after.elements.length, 2, "an orphan must not be removed");
});

test("an element from another document is not an orphan of this one", () => {
  const current = model([
    el("cfo", "Stakeholder", "CFO", { sourceDocument: DOC }),
    el("other", "Stakeholder", "From elsewhere", { sourceDocument: "another-doc" }),
    el("drawn", "Stakeholder", "Drawn by hand", {}),
  ]);
  const plan = planImport(current, read(`<!-- am element type=Stakeholder id=cfo -->
## CFO
`), DOC);
  assert.deepEqual(plan.orphaned.map((e) => e.id), []);
});

/* -- refusals -------------------------------------------------------------- */

test("changing an element's type is refused, not offered as an update", () => {
  // It is a different element wearing the same id, and applying it would
  // silently invalidate every relationship the old one takes part in.
  const current = model([el("cfo", "Stakeholder", "CFO", { sourceDocument: DOC })]);
  const plan = planImport(current, read(`<!-- am element type=BusinessActor id=cfo -->
## CFO
`), DOC);

  assert.equal(plan.elements.length, 0);
  assert.equal(plan.refused.length, 1);
  assert.match(plan.refused[0].reason, /would invalidate its relationships/);

  const after = applyImport(current, plan, everyChange(plan));
  assert.equal(after.elements[0].type, "Stakeholder", "the type was changed anyway");
});

test("a renamed heading alone is not a conflict", () => {
  // sourceSection follows the heading text, so editing a heading would
  // otherwise put every element in front of someone as a conflict.
  const current = model([
    el("cfo", "Stakeholder", "CFO", { sourceDocument: DOC, sourceSection: "cfo" }),
  ]);
  const plan = planImport(current, read(`<!-- am element type=Stakeholder id=cfo name=CFO -->
## Chief Financial Officer
`), DOC);
  assert.equal(plan.elements[0].kind, "unchanged");
});
