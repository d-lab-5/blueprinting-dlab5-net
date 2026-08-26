# ADR-0005 — Relationship identity without RDF-Star

- Status: accepted
- Date: 2026-08-23

## Context

The ABox is Turtle in S3 (ADR-0003), so the file has to carry everything the
editor needs — including stable identity for relationships, so one can be
renamed or deleted rather than only added.

The upstream ontology models relationships as `owl:ObjectProperty`, not
classes, and states the intent plainly: relationship metadata attaches "via
RDF-Star quoted triples". A realization is `<source> archimate:realization
<target>`, and its name or properties would hang off a quoted triple.

## Decision

Do not use RDF-Star. Write two things per relationship:

1. **The plain triple**, exactly as the ontology intends —
   `bpi:WorkPackage/wp1 archimate:realization bpi:Deliverable/d1`. This is what
   any ArchiMate-aware or RDF consumer reads, and it is unambiguous on its own.
2. **A descriptor resource** carrying identity and metadata, typed
   `archimate:Relationship` — a class the ontology defines for exactly this,
   "solely for metadata inheritance purposes", so that relationship instances
   can carry `identifier`, `name` and `documentation`.

The descriptor needs three terms the ontology does not define, so they live in
our own namespace and are named as ours: `bp:relationshipType`, `bp:source`,
`bp:target`. Everything else uses `archimate:`.

## Consequences

The reason is not preference. **N3.js 2.2.15 silently discards RDF-Star.** It
parses both `<< s p o >> ...` and the `{| ... |}` annotation form without
raising, and returns zero quads with a quoted-triple subject — the metadata is
gone with no error to notice. Verified across three syntaxes and both the
default and `text/turtle*` parser formats.

A format that loses data quietly is worse than one that fails loudly,
especially for a file that is the source of truth. Switching parsers was
considered and rejected: RDF-Star support across the JavaScript ecosystem is
thin, the same gap already rules out SHACL validation here (ADR-0004), and the
MCP server and the browser both have to read this file.

The cost is redundancy. The relationship appears twice, and a hand-edited file
could disagree with itself. `parseAbox` therefore treats the **plain triple as
authoritative** and the descriptor as decoration: a descriptor with no matching
triple is dropped, and a triple with no descriptor still yields a relationship
with a generated id. `validateModel` reports the mismatch. Round-tripping
through the writer always re-establishes agreement.

Reconsider if a JavaScript parser gains real RDF-Star support, or if the
platform ever moves the ABox into a triplestore, at which point the descriptor
becomes redundant rather than merely duplicative.
