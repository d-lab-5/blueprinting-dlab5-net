# ADR-0013 — A shared document store beside the platform, keyed by product

- Status: accepted
- Date: 2026-10-08

## Context

Working material for a product lives in two places that cannot see each other:
a claude.ai Project, where a design conversation happens, and a repository,
where Claude Code works. Design notes, `.ttl` ontologies and handoffs get copied
by hand between them, and the copies drift.

The platform already holds documents per product (ADR-0011). They are not the
right home for this material, for three reasons:

- They are **records**: a write-once `source.md` plus an annotated copy, read
  for ArchiMate annotations. Working files are edited all the time and are not
  all Markdown. A `.ttl` file or a folder of them has no place in that shape.
- They are reached through `packages/mcp`, which speaks **stdio** only.
  claude.ai can only reach a remote server, and ADR-0012 left open whether a
  hosted transport should expose the platform's write path to the internet at
  all.
- claude.ai needs **OAuth** for a custom connector. The platform's Cognito
  pool could provide it, but that is a larger change to a live auth stack than
  a file share justifies.

## Decision

**A separate, small store: `mcp/project-docs/`.** One Python Lambda behind a
Function URL serves MCP over stateless streamable HTTP, over one private,
versioned S3 bucket. It is its own SAM stack, outside the Amplify app, and it
changes no platform resource.

**A space is a product.** Paths are `docs/<product-id>/<path>`. The server reads
blueprinting's `Project` table to list spaces by name and to refuse writes to a
space that isn't a product. One claude.ai Project, one blueprinting product and
one folder are the same thing. The id is in the path, never the name (ADR-0009).

**Writes are conditional, never blind.** With an etag, `If-Match`. Without one,
`If-None-Match: *`, so a write without an etag can only create. A conflict
returns the current etag so the caller re-reads and merges.

**A bearer key in phase 1.** The Function URL has no AWS auth, so the app checks
`Authorization: Bearer` on every request in constant time. The key is an SSM
SecureString, the only thing created by hand.

## Consequences

**A leaked key can overwrite, but cannot destroy.** The Lambda role has no
`DeleteObject`, the bucket is versioned, and stack deletion retains it. This
answers ADR-0012's open question for this store only, not for `packages/mcp`.

**One key sees every product's space.** Per-product access arrives with phase 2:
a Cognito token carries `bp-<id>` groups, and the same rule the platform uses
can then filter spaces. Until then, anyone holding the key is trusted with all
of them, which is why it goes only to Frank-Uwe's own clients.

**The store is tied to one blueprinting environment.** Each Amplify
environment has its own Project table, and the stack is pointed at one table
at deploy time.

**A product created in the app appears within a minute.** Product names are
cached per Lambda instance and re-read on an unknown id, at most once a minute,
so guessing ids cannot turn every request into a table scan.

**Shared files are visible in the app, read-only.** A product's Documents
page lists its space below the product's own documents, and opens or
downloads a file, for members of `bp-<id>` only, through the same check the
document functions use (`functions/shared/product-access.ts`). Content comes
back through AppSync rather than a pre-signed URL: files are at most 1 MB, so
the bucket needs no CORS and gains no new public path. The app finds the
bucket through the `/project-docs-mcp/bucket-name` SSM parameter at runtime,
so no stack references another and an environment without the store says so
rather than failing. Editing stays in claude.ai and Claude Code.

**Two document stores now exist.** The rule for which to use: a record about
the architecture, to be annotated and modelled, goes to the product (ADR-0011).
Working material shared between Claude clients goes here. A `publish_doc` that
copies one into the other is the obvious next step and is deliberately not
built yet.

**The MCP Python SDK is at v2.** `FastMCP` is now `MCPServer`, and its
DNS-rebinding guard defaults on and rejects any non-localhost `Host`. Behind a
Function URL with a key on every request, that guard protects nothing, so it is
off on Lambda and on for local runs.
