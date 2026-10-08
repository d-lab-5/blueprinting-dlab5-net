# ADR-0009 — A product's identity is opaque; its name is mutable metadata

- Status: accepted
- Date: 2026-08-27

## Context

A blueprint belongs to a *Product* (CLAUDE.md, house conventions). Until now the
product's identity was derived from its name at creation: `NewProjectForm`
slugified "SAP ECC Modernization" into `sap-ecc-modernization`, and
`projectAdmin` derived three more things from that slug — the Cognito group
`bp-<slug>`, the S3 key `projects/<slug>/abox.ttl`, and the DynamoDB primary
key.

Products get renamed. It is an ordinary event in a product life cycle, not an
error to be prevented. But renaming was impossible in practice:

- `Project.identifier(["slug"])` is the DynamoDB partition key, and DynamoDB
  cannot update a primary key. Renaming meant delete-and-recreate, with a
  window in which the product was half-gone.
- Every derived name became a lie the moment the product was renamed. A product
  called "Core Banking Platform" would still live at
  `projects/sap-ecc-modernization/abox.ttl`, behind a group named
  `bp-sap-ecc-modernization`.

Two things were already decoupled and made this smaller than it looked.
`group` and `ttlKey` are **stored** fields, not derived at read time:
`modelStorageProxy` reads `Item.ttlKey` from the row and only falls back to
deriving it. So the storage layer never actually needed the slug to mean
anything.

One thing was worse than it looked: `p.tsx` rendered `<h1>{slug}</h1>`. The
product page titled itself with its slug, and no code path loaded the product's
`name` at all. Renaming would have appeared to do nothing.

## Decision

**A product is identified by an opaque id. Its name and description are
mutable metadata.**

- New products get `p-<10 lowercase base32 characters>`, minted at creation and
  never derived from the name. It satisfies the existing
  `^[a-z0-9-]{3,50}$` validator, so nothing downstream changes shape.
- `name` and `description` become editable by `bp-admins` through the
  already-generated `updateProject` mutation. No schema change is required —
  the fields were always mutable and always admin-authorized; nothing called it.
- The id appears in the URL: `/p/p-7f3a2b9c4d/`. This needs no Amplify Hosting
  rewrite, because the rule in constraint 12 is already the wildcard
  `/p/<*> -> /p/index.html 200`.
- The name becomes authoritative everywhere a person reads it. The id is shown
  only where identity is the point — a settings panel, a bundle manifest.
- Renaming also updates the Cognito group's `Description`, which
  `projectAdmin` sets once at creation to `Members of the ${name} blueprint`
  and would otherwise go stale.

Existing products keep their readable slugs. The primary key is a free string,
so `dlab5-blueprint` and `p-7f3a2b9c4d` coexist without a migration. Where the
older three are reissued with opaque ids, it happens through the export/reload
path of ADR-0010, not through a script that mutates keys in place.

## Consequences

**Renaming becomes free, and that is the whole point.** Nothing derived from
the name survives creation, so nothing can contradict a rename. The lifecycle
event the tool exists to model is now one the tool itself supports.

**URLs stop being readable.** `/p/p-7f3a2b9c4d/` cannot be typed from memory or
guessed, and cannot be read aloud. This is a real cost, accepted deliberately:
navigation is through the product switcher, and the alternative — a readable
prefix with an opaque suffix, Notion-style — buys legibility for a URL-parsing
layer that three products do not justify. It can be adopted later without
another migration, because the id is already the key.

**The Cognito console gets harder to read.** Groups become `bp-p-7f3a2b9c4d`,
and an administrator looking at the group list cannot tell which product is
which. The group `Description` carries the product name, which is why keeping
it in step with renames is part of this decision rather than a nicety.

**The id must never be shown as a name.** The failure this ADR corrects —
`<h1>{slug}</h1>` — becomes much more visible with opaque ids, and much worse:
a stale readable slug is merely wrong, whereas `p-7f3a2b9c4d` is unusable. Any
new surface that displays a product must load the `Project` row. `verify:ui`
asserts that no product page titles itself with its id.

**Collisions are already handled.** `projectAdmin` writes the row with
`ConditionExpression: "attribute_not_exists(slug)"` before creating any Cognito
group, so a collision fails cleanly and leaves nothing behind. A 10-character
base32 id gives 2^50 values; at this scale the condition is a correctness
backstop that will not fire.

**The field is still called `slug`.** Renaming it to `id` would be a migration
across every stored row, the GraphQL API, the MCP tool names and six Cognito
groups — for a word. This is the same split CLAUDE.md already records for
Product versus Project: the interface says what a person means, the schema
keeps what it has. Do not fix one side without doing all of it.
