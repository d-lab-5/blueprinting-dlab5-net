# ADR-0004 — The ArchiMate metamodel is generated, not hand-written

- Status: accepted
- Date: 2026-08-23

## Context

ArchiMate 3.2 has 60 element types across seven layers, 11 relationship types,
and an Appendix B matrix saying which relationships are permitted between which
element types in which direction. Every part of this platform needs that
knowledge: the element palette, the relationship editor's target list, the
Blockly toolbox and its connection checks, the Turtle reader and writer, the
MCP tool schemas, and the diagram generators.

Typing it in by hand would be several thousand lines of error-prone
transcription that silently rots.

## Decision

Vendor a pinned copy of
[AlbertoDMendoza/archimate_ontology](https://github.com/AlbertoDMendoza/archimate_ontology)
(Apache-2.0) under `ontology/upstream/`, and generate
`packages/metamodel/src/generated/` from it with `scripts/gen-metamodel.mjs`.
The generated TypeScript is **committed**.

Two upstream files carry everything needed: `archimate.ttl` for the vocabulary
(labels, definitions, layer and aspect membership) and `relationships.xml` for
Appendix B, encoded one letter per relationship with **uppercase = direct,
lowercase = derived**.

## Consequences

Committing the output means Amplify Hosting needs neither the ontology nor an
RDF toolchain, and a build can never drift because upstream moved. The cost is
that regeneration must be verified in CI — `node scripts/gen-metamodel.mjs &&
git diff --exit-code packages/metamodel/src/generated` — or the two can
silently diverge.

**"Concrete element type" required a judgement call.** Neither source is
correct alone. The TTL's `subClassOf archimate:Element` closure includes
`CompositeElement` and `LayerComposite`, organisational classes that upstream
did not flag `archimate:abstract true`. The matrix's concept list includes
`Relationship`, which is not an element — it is there because ArchiMate permits
associating *with* a relationship. An element type is therefore one that
appears in **both**: 61 Appendix B concepts less `Relationship` = **60 element
types**, distributed 10/4/13/9/13/4/5 across motivation, strategy, business,
application, technology, physical and implementation, plus 2 composites
(Grouping, Location). `Junction` is a relationship connector and appears in
neither.

The tests in `packages/metamodel/__tests__/` assert against the specification,
not against a previous run. If re-pinning the ontology breaks one, the upgrade
changed the language's semantics and needs a human decision — a changed matrix
can make a previously valid model invalid. Do not update the test to match new
output.

Full SHACL validation is deliberately out of scope for now. Upstream's shapes
use RDF-Star for relationship metadata, which the JavaScript SHACL engines
handle poorly, and the matrix plus zod schemas catch the common errors at no
cost. `ontology/README.md` records what was left behind.

The TTL is read with a small hand-rolled block reader rather than `n3`. The
file is machine-generated and uniform, and the alternative is making an RDF
parser a dependency of a script that runs a few times a year. The generator
fails loudly on any count that does not match the specification rather than
emitting a plausible-looking but wrong metamodel.
