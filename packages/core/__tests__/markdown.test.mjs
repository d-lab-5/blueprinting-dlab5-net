import { test } from "node:test";
import assert from "node:assert/strict";

import { fromAnnotatedMarkdown } from "../dist/index.js";

const read = (source, options) =>
  fromAnnotatedMarkdown(source, "p-test", options);

const byId = (result, id) => result.model.elements.find((e) => e.id === id);

/* -- the shape of a document ----------------------------------------------- */

test("an annotated section becomes an element, named by its heading", () => {
  const r = read(`# Stakeholder review

<!-- am element type=Stakeholder id=cfo -->
## Chief Financial Officer
Wants cost per transaction below EUR 0.02 by Q3.
`);

  assert.equal(r.elements, 1);
  assert.deepEqual(r.skipped, []);
  const cfo = byId(r, "cfo");
  assert.equal(cfo.type, "Stakeholder");
  assert.equal(cfo.name, "Chief Financial Officer");
  assert.equal(cfo.documentation, "Wants cost per transaction below EUR 0.02 by Q3.");
});

test("name= overrides the heading", () => {
  const r = read(`<!-- am element type=Stakeholder id=cfo name="Group CFO" -->
## Chief Financial Officer, Northern Europe
`);
  assert.equal(byId(r, "cfo").name, "Group CFO");
});

test("an unannotated heading contributes nothing", () => {
  const r = read(`# Introduction
Background that is not a model element.

<!-- am element type=Driver id=cost -->
## Cost
`);
  assert.equal(r.elements, 1);
  assert.equal(byId(r, "cost").documentation, undefined);
});

test("the document id and section are recorded on every element", () => {
  const r = read(`<!-- am element type=Stakeholder id=cfo -->
## Chief Financial Officer
`, { documentId: "stakeholder-review-2026-08" });

  assert.equal(byId(r, "cfo").properties.sourceDocument, "stakeholder-review-2026-08");
  assert.equal(byId(r, "cfo").properties.sourceSection, "chief-financial-officer");
});

test("prose stops at the next heading, so no text lands in two elements", () => {
  // Running to the next same-or-higher heading instead would put "Detail
  // under the CFO" into both cfo and detail.
  const r = read(`<!-- am element type=Stakeholder id=cfo -->
## Chief Financial Officer
Owns the cost line.

<!-- am element type=Driver id=detail -->
### Detail under the CFO
Something more specific.
`);
  assert.equal(byId(r, "cfo").documentation, "Owns the cost line.");
  assert.equal(byId(r, "detail").documentation, "Something more specific.");
});

test("an annotation is never part of the prose it introduces", () => {
  const r = read(`<!-- am element type=Stakeholder id=cfo -->
## CFO
Real text.
<!-- am element type=Driver id=d -->
## Driver
`);
  assert.equal(byId(r, "cfo").documentation, "Real text.");
});

test("ignore is distinguishable from simply not annotating", () => {
  const r = read(`<!-- am ignore -->
## Appendix A
Boilerplate nobody wants in the model.
`);
  assert.equal(r.ignored, 1);
  assert.equal(r.elements, 0);
  assert.deepEqual(r.skipped, []);
});

/* -- relationships --------------------------------------------------------- */

test("a relationship gets an endpoint-derived id, so re-import matches it", () => {
  const r = read(`<!-- am element type=Stakeholder id=cfo -->
## CFO

<!-- am element type=Driver id=cost-per-txn -->
## Cost per transaction

<!-- am rel type=influence from=cfo to=cost-per-txn -->
`);
  assert.equal(r.relationships, 1);
  const [rel] = r.model.relationships;
  // The scheme used by ttl.ts, RoadmapEditor and the MCP tools.
  assert.equal(rel.id, "cfo-influence-cost-per-txn");
  assert.equal(rel.source, "cfo");
  assert.equal(rel.target, "cost-per-txn");
});

test("a relationship may be declared before the elements it names", () => {
  const r = read(`<!-- am rel type=influence from=cfo to=cost -->

<!-- am element type=Stakeholder id=cfo -->
## CFO

<!-- am element type=Driver id=cost -->
## Cost
`);
  assert.equal(r.relationships, 1);
  assert.deepEqual(r.skipped, []);
});

test("a relationship ArchiMate forbids is rejected, and says why", () => {
  // An agent will occasionally propose one. It has to surface as a rejected
  // annotation rather than a corrupt model.
  const r = read(`<!-- am element type=Stakeholder id=cfo -->
## CFO

<!-- am element type=Driver id=cost -->
## Cost

<!-- am rel type=composition from=cost to=cfo -->
`);
  assert.equal(r.relationships, 0);
  assert.equal(r.skipped.length, 1);
  assert.match(r.skipped[0].reason, /does not allow composition from Driver to Stakeholder/);
});

test("an endpoint outside the document is kept, for validateModel to judge", () => {
  // It may already be in the model. Its type is unknown here, and duplicating
  // the metamodel rule to guess would be exactly what constraint 11 forbids.
  const r = read(`<!-- am element type=Stakeholder id=cfo -->
## CFO

<!-- am rel type=influence from=cfo to=already-in-the-model -->
`);
  assert.equal(r.relationships, 1);
  assert.deepEqual(r.skipped, []);
});

/* -- what is refused, and why ---------------------------------------------- */

test("an element annotation without id= is refused, not guessed at", () => {
  const r = read(`<!-- am element type=Stakeholder -->
## CFO
`);
  assert.equal(r.elements, 0);
  assert.equal(r.skipped.length, 1);
  assert.match(r.skipped[0].reason, /needs id=/);
  assert.equal(r.skipped[0].line, 1);
});

test("a type the metamodel does not have is refused", () => {
  const r = read(`<!-- am element type=Stakeholders id=cfo -->
## CFO
`);
  assert.equal(r.elements, 0);
  assert.match(r.skipped[0].reason, /not an ArchiMate element type/);
});

test("the same id twice in one document is refused the second time", () => {
  const r = read(`<!-- am element type=Stakeholder id=cfo -->
## CFO

<!-- am element type=Stakeholder id=cfo -->
## CFO again
`);
  assert.equal(r.elements, 1);
  assert.equal(r.skipped.length, 1);
  assert.match(r.skipped[0].reason, /more than once/);
});

test("an annotation with no heading after it is reported, with its line", () => {
  const r = read(`## Already past

<!-- am element type=Stakeholder id=cfo -->

Just prose, no heading follows.
`);
  assert.equal(r.elements, 0);
  assert.equal(r.skipped.length, 1);
  assert.equal(r.skipped[0].line, 3);
  assert.match(r.skipped[0].reason, /no heading followed/);
});

test("two element annotations in a row report the orphaned one", () => {
  const r = read(`<!-- am element type=Stakeholder id=a -->
<!-- am element type=Driver id=b -->
## Only one heading
`);
  assert.equal(r.elements, 1);
  assert.equal(byId(r, "b").name, "Only one heading");
  assert.equal(r.skipped.length, 1);
  assert.equal(r.skipped[0].line, 1);
});

/* -- robustness on documents nobody wrote for us --------------------------- */

test("an ordinary document with no annotations imports nothing and errors nothing", () => {
  const r = read(`# Quarterly review

Some prose. A list:

- one
- two

## A section

<!-- an ordinary comment -->

More prose with a # hash inside it.
`);
  assert.equal(r.elements, 0);
  assert.equal(r.relationships, 0);
  assert.deepEqual(r.skipped, []);
});

test("Windows line endings do not change the result", () => {
  const unix = `<!-- am element type=Stakeholder id=cfo -->\n## CFO\nText.\n`;
  const dos = unix.replace(/\n/g, "\r\n");
  assert.deepEqual(read(dos).model, read(unix).model);
});

test("a fenced code block containing a heading does not create an element", () => {
  // Known limitation, asserted so it is a decision rather than a surprise:
  // the scanner does not track fences, so an annotation inside one would
  // still bind. What must NOT happen is a bare # in code becoming a section
  // that swallows an element's prose.
  const r = read(`<!-- am element type=Stakeholder id=cfo -->
## CFO
Text before.

\`\`\`
# not a heading
\`\`\`
`);
  assert.equal(r.elements, 1);
  assert.match(byId(r, "cfo").documentation, /Text before\./);
});

/* -- found on real documents ----------------------------------------------- */

test("inline markdown is stripped from a heading used as a name", () => {
  // A real plan of record had `### Phase B — Odoo extract *(blocked on API key)*`.
  // Carried through verbatim the asterisks reach every diagram and the Archi
  // export. Emphasis is formatting, not part of what the thing is called.
  const r = read(`<!-- am element type=WorkPackage id=phase-b -->
### Phase B — Odoo extract *(blocked on API key)*
`);
  assert.equal(byId(r, "phase-b").name, "Phase B — Odoo extract (blocked on API key)");
});

test("code spans and links in a heading are reduced to their text", () => {
  const r = read(`<!-- am element type=DataObject id=pt -->
### \`product.template\` and [the docs](https://example.com/x)
`);
  assert.equal(byId(r, "pt").name, "product.template and the docs");
});

test("stripping does not touch the documentation, which stays markdown", () => {
  const r = read(`<!-- am element type=WorkPackage id=w -->
### Work *emphasised*
Body with *emphasis* and \`code\` that must survive.
`);
  assert.equal(byId(r, "w").name, "Work emphasised");
  assert.equal(byId(r, "w").documentation, "Body with *emphasis* and `code` that must survive.");
});

/* -- annotations that bring their own name --------------------------------- */

test("two named annotations before one heading both land", () => {
  // A real field-mapping document whose headings name a PAIR. Before this,
  // only one annotation could bind per heading and the other was reported as
  // orphaned, so the document could not be annotated at all.
  const r = read(`<!-- am element type=DataObject id=odoo-pt name="product.template" -->
<!-- am element type=DataObject id=shopify-p name="Shopify product" -->
<!-- am rel type=association from=odoo-pt to=shopify-p -->
### \`product.template\` → Shopify product
`);
  assert.equal(r.elements, 2);
  assert.equal(r.relationships, 1);
  assert.deepEqual(r.skipped, []);
  assert.equal(byId(r, "odoo-pt").name, "product.template");
  assert.equal(byId(r, "shopify-p").name, "Shopify product");
});

test("a named annotation does not claim the heading's prose", () => {
  // It sits beside a heading it does not own. Borrowing that section would
  // attribute someone else's text to it.
  const r = read(`<!-- am element type=DataObject id=pair name="One of a pair" -->
## A heading that belongs to nobody
Prose under the heading.
`);
  assert.equal(byId(r, "pair").documentation, undefined);
  assert.equal(byId(r, "pair").properties.sourceSection, undefined);
});

test("a named annotation needs no heading at all", () => {
  const r = read(`Just prose.

<!-- am element type=Driver id=d name="Standalone" -->

More prose, no heading anywhere.
`);
  assert.equal(r.elements, 1);
  assert.deepEqual(r.skipped, []);
});

test("an unnamed annotation still binds to the next heading", () => {
  const r = read(`<!-- am element type=Stakeholder id=cfo -->
## Chief Financial Officer
Owns the cost line.
`);
  assert.equal(byId(r, "cfo").name, "Chief Financial Officer");
  assert.equal(byId(r, "cfo").documentation, "Owns the cost line.");
  assert.equal(byId(r, "cfo").properties.sourceSection, "chief-financial-officer");
});

test("a named and an unnamed annotation can share a heading", () => {
  const r = read(`<!-- am element type=DataObject id=named name="Named one" -->
<!-- am element type=DataObject id=bound -->
### The heading
Prose.
`);
  assert.equal(r.elements, 2);
  assert.deepEqual(r.skipped, []);
  assert.equal(byId(r, "named").name, "Named one");
  assert.equal(byId(r, "bound").name, "The heading");
  assert.equal(byId(r, "bound").documentation, "Prose.");
});
