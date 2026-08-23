# ADR-0003 — Turtle in S3 is the source of truth for the ABox

- Status: accepted
- Date: 2026-08-23

## Context

The spec names Turtle as the "Data and Model Backbone" and, separately, gives
DynamoDB "metadata and core structural graph references" and S3 the "raw
.mmd/.d2 script configurations and branding assets".

Two readings were possible: model the ArchiMate graph as DynamoDB rows with
Turtle as an export, or keep one `.ttl` per project in S3 and let DynamoDB hold
only pointers.

## Decision

One `projects/<slug>/abox.ttl` per project in S3 is the source of truth, parsed
with `n3`. DynamoDB holds the `Project` row (`ttlKey`, `version`, `lockedBy`,
`lockedAt`) and the `View` rows. Turtle is the storage format, not an export
format — which means Archi, `rdflib`, SPARQL tooling and the MCP server all
read the real thing with no export step, and a model is reviewable as a diff.

## Consequences

Two costs follow, and both are designed for rather than discovered:

**Per-project authorization moves into a Lambda.** `defineStorage` access rules
are fixed at deploy time and cannot reference a Cognito group created by hand
next month (ADR-0002). So the browser never touches S3 directly: the
`requestModelReadUrl` / `requestModelWriteUrl` mutations call a proxy that
checks the caller's `cognito:groups` against `Project.group` and returns a
five-minute pre-signed URL. This is the `dhcDesignStorageProxy` pattern from
DHC Designer.

**Every write is a whole-file read-modify-write, so it needs concurrency
control.** Two layers, matching what the DHC apps converged on:

- An **S3 `If-Match` ETag precondition** on the PUT. This is the correctness
  mechanism. A lost update fails with 412 and is surfaced to the user; it never
  silently wins.
- An advisory `Project.lockedBy` / `lockedAt` lock, stale after 30 minutes.
  This is a UX mechanism only. Disabling it must not make concurrent writes
  unsafe — that is a test, not an assumption.

Also accepted: reads parse the whole graph. For the model sizes in view this is
cheap, and the parsed graph is cached client-side per project.

Rejected alternative: DynamoDB rows as source of truth with `.ttl` mirrored on
write. It would have given per-element authorization and incremental writes,
but at the cost of a second consistency problem and an ArchiMate metamodel
smeared across a DynamoDB schema.
