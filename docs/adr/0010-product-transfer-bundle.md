# ADR-0010 — Structural change happens by export and reload, not by migration

- Status: accepted
- Date: 2026-08-27

## Context

Two problems arrived together and have one answer.

**Environments cannot share data.** There is one Amplify branch, `stage`. When a
production branch is created it gets its own Cognito pool, its own DynamoDB
tables and its own S3 bucket. Nothing bridges them. Some products on stage
should reach production and some should not, and today there is no way to move
one.

**Structural change has no safe path.** ADR-0009 changes what a product's
primary key looks like. DynamoDB cannot update a primary key, so any in-place
migration is delete-and-recreate against live data, with a window in which the
product exists in neither form.

`scripts/export.mjs` already exports the graph as Turtle or as ArchiMate Open
Exchange XML. It does not export the product: the `Project` row — name,
description, group — is not in either format, and cannot be, because Open
Exchange has no place for it.

Three facts made the scope smaller than expected:

- **Views are never persisted.** The `View` model is declared but nothing writes
  it; the Views page generates D2 and Mermaid live from the graph. A complete
  product is one DynamoDB row, one S3 object, and one Cognito group.
- **Open Exchange already carries our properties.** `oef.ts` emits
  `propertyDefinitions` plus per-concept `property`, and
  `verify-archi-roundtrip.mjs` asserts they survive a round-trip through a real
  Archi installation. The interchange half is already trustworthy.
- **The Turtle serializer is byte-stable.** Two exports of an unchanged model
  are identical, so a bundle is diffable and a round-trip is verifiable by
  comparing bytes rather than by parsing and hoping.

## Decision

**A product transfer bundle is the unit of movement between environments, and
the mechanism for structural change.**

```
<product>/
  MANIFEST.json    format version, source environment, exported-at, checksums,
                   and what was WITHHELD
  product.json     the Project row, minus environment-local fields
  model.ttl        authoritative — byte-stable
  model.xml        ArchiMate Open Exchange, for Archi and everything else
  documents/
    <docId>/source.md      the record, as uploaded
    <docId>/annotated.md   the working copy, when there is one
```

**Format version 2** added `documents/`. A v1 bundle is still readable; it
simply has none.

`model.ttl` is authoritative and `MANIFEST.json` says so. The importer
re-derives the Open Exchange XML from the Turtle and compares it to
`model.xml`; a mismatch fails the import. Carrying a derived artifact in a
transfer format otherwise invites someone to edit the XML and silently lose it.

**What a bundle deliberately does not carry:**

| Field | | Why |
|---|---|---|
| `version` | reset to 0 | A local revision counter; it means nothing in another environment |
| `lockedBy`, `lockedAt` | dropped | A stale lock from stage would park the product in production for 30 minutes |
| Cognito group membership | dropped | Stage testers are not production users. Groups are created empty and the importing administrator is added, exactly as at creation |

`group` and `ttlKey` are recomputed from the id on import rather than carried,
because they are derived values that must agree with the environment they land
in.

**Documents travel only as far as their classification allows** (ADR-0011).
`--include` defaults to `shared`, so the bundle produced without thinking is
the one that is safe to commit — because that is the bundle someone will commit
without thinking. `--include collaboration` adds the middle tier.
**Confidential documents never travel, and there is deliberately no flag for
it**; the rule fails closed on any classification the tool does not recognise.

The manifest records what was **withheld**, not only what was carried, and both
the exporter and the importer print it. A bundle that silently omits half a
product's records is indistinguishable from one whose product had none, and the
difference matters to whoever reloads it. Nothing of a withheld document is in
the bundle — not its text and not its id in a file list, since naming a document
you do not carry still discloses that it exists.

**Structural change is an import-time transform.** `import --reid` mints a fresh
opaque id, recomputes `group` and `ttlKey`, and writes a new row. ADR-0009's
change of identity is applied this way, not by a script that mutates primary
keys. The old environment is wiped afterwards, as a separate act.

**Destruction is gated.** A wipe spans three services and S3 objects do not come
back. `--dry-run` is the default; destruction requires an explicit
`--yes-destroy <env>` and refuses to run unless a verified bundle already
exists on disk for every product it would delete.

## Consequences

**Re-identifying a product is an IRI rewrite, and it is free.** Every IRI in
the Turtle embeds the product id — `https://blueprinting.dlab5.net/i/<id>/…` —
so a new id means rewriting all of them; the platform's own model has 580. This
is safe only because IRIs are *derived* from `model.projectSlug` when the model
is serialized, never stored: parsing under the old id and serializing under the
new one regenerates every one of them. A unit test in `packages/core` asserts
that property directly, because everything else here depends on it.

It also means re-identification must never be done by search and replace. The
platform's own model contains an element whose id is `dlab5-blueprint-blockly`;
replacing the string `dlab5-blueprint` would corrupt it. The first version of
the round-trip check made exactly that mistake in its assertion, and finding it
is the reason this paragraph exists.

**A product becomes portable, and reviewable.** A bundle is four files, one of
them byte-stable Turtle, so a transfer can be inspected in a diff before it is
applied and kept in version control if that is useful.

**Migrations stop being written.** The class of change that would previously
have needed a bespoke script against live tables — re-keying, re-grouping,
splitting a product — becomes export, transform the bundle, reload. The
transform is inspectable as a file diff, and the previous state is still on
disk if it goes wrong.

**Documents are restored after the model, and never fatally.** A product whose
model landed but whose notes did not is recoverable; one that fails halfway
through provisioning is not. Classification is carried across unchanged — a
document does not become more shareable by being moved to another environment.

**A document id is unique within a product, not across all of them.** It was
global at first, which meant two products could not both hold a "sprint-notes"
and that copying a product into another environment failed the moment one id
was already taken — which is exactly what a copy does. Found by reordering the
round-trip check so documents existed *before* the export; seeded afterwards,
as it was first written, no import ever saw one and the restore path was
unproven.

**Group membership cannot be restored.** This is the one thing no bundle holds.
After a wipe, every member of every `bp-*` group must be re-added by hand. An
opt-in `--with-members` flag can carry them, kept out of the default because
the common case — stage to production — is exactly the case where copying
accounts would be wrong.

**The round-trip must be proved before it is trusted.** An exporter and an
importer that agree with each other prove nothing; this is the same trap
`verify:archi` and `verify:mcp-client` exist to avoid. The check exports a real
product, imports it as a scratch product, and compares the Turtle byte for
byte — then deletes the scratch product, as `verify:model-store` already does.

**Two formats can drift, and the manifest is what stops them.** The checksum
comparison is not a nicety: without it the bundle has two sources of truth and
no way to tell which one an importer used.
