# CLAUDE.md — D-LAB-5 Blueprinting Platform

Guidance for Claude Code working in this repository.

## What this is

`blueprinting.dlab5.net` — engineering governance and architecture planning
over an **ArchiMate 3.2 semantic model**. Three dimensions of one blueprint:

- **Technology Radar** — the *state*: what is adopted, trialled, assessed, held.
- **Architecture diagrams** — the *structure*: how services actually interact.
- **Tactical roadmaps** — the *schedule*: when the blocks reach production.

The platform is being built starting from ArchiMate Layer 7 (Implementation &
Migration) so that **the first blueprint stored in the platform is the plan for
building the platform**. `packages/core/src/seed/platform-roadmap.ttl` is that
model. Keep it current — it is documentation and test fixture at once.

> **This repository is public.** Read `SECURITY.md` before committing anything.
> Never commit `amplify_outputs.json`, AWS account IDs or ARNs, `.env` files, or
> real names, emails and hostnames in seed models.

## Layout

```
backend/          Amplify Gen 2 backend. NOT an npm workspace — see ADR-0001.
packages/metamodel/  ArchiMate 3.2 as TypeScript. Generated; see ADR-0004.
packages/core/    ABox model, Turtle I/O, validation. Pure TS, no React, no AWS.
packages/site/    The Gatsby 5 app (@dlab5/blueprint-site).
ontology/         Pinned Apache-2.0 copy of the ArchiMate OWL/SHACL ontology.
docs/adr/         Architecture Decision Records. Read these first.
docs/audits/      Security audit reports, YYYY-MM-DD-audit.md.
```

Planned packages, added when their work package starts, not scaffolded empty:
`react`, `exchange` (Archi Open Exchange XML), `blockly`, `mcp`.

## Commands

```bash
npm ci && npm --prefix backend ci   # two installs; the backend has its own tree
npm --prefix backend run sandbox:once   # deploy a personal AWS sandbox + sync outputs
npm run backend:sync-outputs        # copies amplify_outputs.json into the site
npm run dev:web                     # http://localhost:8000
npm run build                       # must pass with NO amplify_outputs.json
npm run backend:typecheck
npm test                            # metamodel assertions

npm run gen:metamodel               # regenerate from ontology/upstream/

BP_USER=… BP_PASSWORD=… npm run verify:auth          # ADR-0002 invariants, live
BP_USER=… BP_PASSWORD=… npm run verify:model-store   # ADR-0003 invariants, live
BP_USER=… BP_PASSWORD=… npm run seed                 # the platform's own roadmap
BP_USER=… BP_PASSWORD=… npm run export -- --project <slug> [--format ttl|oef]

npm run verify:archi                # round-trip through Archi itself

BP_USER=… BP_PASSWORD=… npm run bundle:export -- --product <id> --out <dir>
BP_USER=… BP_PASSWORD=… npm run bundle:import -- --in <dir> [--reid] [--dry-run]
BP_USER=… BP_PASSWORD=… npm run verify:bundle   # the whole round trip, live
BP_USER=… BP_PASSWORD=… npm run verify:documents # the document store, live

npm run setup:python                # once: a venv for the MCP client check
npm run verify:mcp-client           # drives the MCP server over stdio, from Python
```

The MCP server takes `BP_USER`/`BP_PASSWORD`, or **`BP_REFRESH_TOKEN`** for a
server running where nobody can type a password. The refresh token carries the
user's own identity and groups, so every authorization check downstream behaves
exactly as it does in the app — but it IS the account for thirty days, not a
scoped key. Revoke it with Cognito's `RevokeToken`; signing out of the app
revokes it too, which is worth knowing in both directions.

`verify:mcp-client` is the only thing that exercises the MCP **protocol**.
Everything else calls `tool.run(args)` directly, which skips the stdio framing,
the registration and the zod-to-JSON-Schema conversion. It is Python against
the official SDK deliberately: a second implementation in another language
cannot share our misunderstandings. Without credentials it verifies the
degraded, metamodel-only path, which is a feature rather than a lesser run.

`verify:archi` drives a real Archi installation: it imports our Open Exchange
export, re-exports it, and compares. Schema validity says a document matches
the XSD; it does not say Archi will open it or that anything survives. Install
Archi from archimatetool.com — a user-local unpack under `~/opt/Archi` is
enough — and the check skips cleanly when it is absent.

A **product transfer bundle** is how a product moves between environments and
how structural changes are made: export, transform the files, reload. Four
files — `MANIFEST.json`, `product.json`, `model.ttl`, `model.xml` — with the
Turtle authoritative and the XML re-derived and compared on import. `--reid`
mints a fresh id, which is how a re-identification happens; DynamoDB cannot
update a primary key, so there is no in-place path. ADR-0010.

`verify:bundle` exports a real product, imports it under a minted id, exports
THAT, and compares the Turtle byte for byte. Going back out through S3 is the
point: an exporter and an importer that agree with each other prove nothing.
It creates and deletes a scratch product and its Cognito group.

A product also holds **documents** — reports, plans, decision records — beside
its model. They are evidence about an architecture rather than part of one, so
they live in S3 under `projects/<id>/documents/` with a `Document` row as the
index. `classification` decides how far one travels: `shared` goes with the
model, `confidential` never leaves in an export and comes out only as a local
download. **Unclassified means confidential** — sharing is a decision someone
makes. A document whose text matches a credential shape is refused outright,
and a stored source is never rewritten.

`verify:documents` proves those four promises against a real backend, because
each of them is something the UI claims and only the Lambda can keep.

`verify:model-store` creates a scratch project, proves the authorization
boundary and the ETag conflict against real AWS, then deletes it. Both live
checks target whatever `backend/amplify_outputs.json` points at — for the
deployed branch, regenerate it first with
`cd backend && npx ampx generate outputs --app-id <id> --branch stage`.

`verify:auth` drives the real `aws-amplify/auth` client through the same
sequence `AuthGate` uses — `signIn`, the new-password challenge,
`confirmSignIn`, `fetchAuthSession`, `cognito:groups` — against whatever
backend `backend/amplify_outputs.json` points at. Add `--new-password '…'` for
an account still in `FORCE_CHANGE_PASSWORD`. Run it after any change to
`auth/resource.ts`, `backend.ts` or `AuthGate.tsx`.

Regeneration must be a no-op on a clean tree:

```bash
npm run gen:metamodel && git diff --exit-code packages/metamodel/src/generated
```

## Non-obvious constraints

These are things that will bite. Each is load-bearing and has cost someone time.

1. **`backend/` must not become an npm workspace.** Gatsby needs graphql 16 and
   the Amplify data construct needs graphql 15; one hoisted tree cannot satisfy
   both. ADR-0001.
2. **`graphql: ^16` is a direct dependency of `packages/site` on purpose.**
   `aws-amplify` v6 drags in graphql 15 transitively. Whichever npm hoists to
   the root is what `graphql-compose` resolves, and if 15 wins, `gatsby build`
   dies in `buildSchema` with *"Cannot create as TypeComposer …
   GraphQLScalarType(Date)"*. Naming it makes 16 win deterministically. Do not
   "clean up" that dependency.
3. **`AuthGate` is mounted in `gatsby-ssr` as well as `gatsby-browser`**, via
   one shared `src/wrap-page-element.tsx`. Leaving it out of SSR breaks the
   build, because page components call `useSession()` and Gatsby would render
   them directly. The gate short-circuits on `typeof window === "undefined"`.
   ADR-0002.
4. **Amplify is configured in `gatsby-browser` only, never in `gatsby-ssr`.**
   `src/lib/amplify.ts` uses `require`, not `import … with { type: "json" }`,
   which Gatsby's Babel pipeline rejects. The missing-file warning during a
   build with no outputs is expected and handled.
5. **The build must succeed without `amplify_outputs.json`.** A frontend-only
   rebuild has no backend phase. `amplify.yml` tolerates the copy failing.
6. **Per-project Cognito groups are `bp-<slug>`, created by hand.** They cannot
   be declared in `defineAuth` (a deploy per project) and cannot be referenced
   from `defineStorage` (rules are static at deploy time). That is exactly why
   S3 goes through a proxy Lambda. ADR-0002, ADR-0003.
7. **Adding a user to a group does not change their existing tokens.** Call
   `fetchAuthSession({ forceRefresh: true })` after a group change.
8. **The ABox is Turtle in S3, not DynamoDB rows.** DynamoDB holds the `Project`
   pointer row and `View` metadata only. Writes are whole-file, so they carry an
   S3 `If-Match` ETag precondition — that, not the advisory lock, is the
   correctness mechanism. ADR-0003.
9. **`GATSBY_`-prefixed environment variables are public.** They are inlined
   into the bundle.
10. **Local dev needs raised inotify limits.** Gatsby exhausts the default and
    dies with `ENOSPC: System limit for number of file watchers reached`;
    `sudo sysctl -w fs.inotify.max_user_watches=524288 fs.inotify.max_user_instances=1024`.
    Amplify's build container is unaffected.
11. **`packages/metamodel/src/generated/` is committed, and is generated.** Never
    hand-edit it, and never hard-code an element type, layer or relationship
    rule anywhere else — that module is the only place the ArchiMate
    specification enters the codebase. ADR-0004.
12. **Client-only routes need an Amplify Hosting rewrite, which lives outside
    this repo.** `/p/*` is a `matchPath` route, so no file exists at
    `/p/<slug>/`. The catch-all rule serves the right HTML but returns 404,
    which needs an explicit 200 rewrite *ahead* of it — order matters:

    ```
    /p/<*>  ->  /p/index.html   200
    /<*>    ->  /index.html     404-200
    ```

    Adding another client-only route means adding another rule. There is no
    file in the repository that captures this; it is app configuration, set
    with `aws amplify update-app --custom-rules`.
13. **The Amplify client in `packages/site` is deliberately untyped.**
    Importing `Schema` from `backend/amplify/data/resource` would pull
    `@aws-amplify/backend` — and graphql 15 — into the site's TypeScript
    program, undoing constraint 1. The result shapes in `src/lib/data.ts` are
    hand-written for that reason and must be kept in step with
    `data/resource.ts` by hand. Check with:
    `npx tsc --noEmit -p packages/site/tsconfig.json --listFiles | grep -c '@aws-amplify/backend/'` — must be 0.
14. **A change to `global.css` needs a clean build to appear.** `npm run build`
    reuses the cached stylesheet and emits the *identical* content hash, so the
    page renders with the old CSS and the edit looks like it did nothing. This
    has cost time twice. Before building after a stylesheet change:

    ```bash
    rm -rf packages/site/.cache packages/site/public && npm run build
    ```

    Confirm the change actually shipped rather than trusting the build:
    `grep -ro "bp-your-class{[^}]*}" packages/site/public/*.css`. More than one
    `styles.*.css` in `public/` is the symptom.

## House conventions

- **TypeScript**, npm workspaces, Node 22 (`.nvmrc`).
- Package split follows `d-lab-5/gatsby-techradar`: a pure-TS `core` with no
  React, a presentational `react`, a thin `site`.
- Plain CSS with custom-property tokens in `packages/site/src/styles/tokens.css`.
  No Tailwind, no CSS-in-JS. **The ArchiMate layer colours are not free
  choices** — they are the standard pastels Archi uses, so a Blockly block, a
  D2 node and a legend swatch all agree with what a reader sees in Archi.
- One shell component. The DHC Portal ended up with two and the seam still shows.
- **A product's id is minted, never derived from its name.** `p-` plus ten
  characters, from `mintProductId()`. Names change; ids cannot, because the id
  is the DynamoDB partition key, the Cognito group and the S3 prefix are
  computed from it, and every IRI in the model embeds it. **Never show an id
  where a name belongs** — `verify:ui` asserts no product page renders its own
  id as text. The settings panel is the one exception, and it is asserted too,
  so that the first assertion cannot pass by the panel failing to render.
  ADR-0009.
- **A blueprint belongs to a *Product*, and the code calls it a `Project`.**
  The interface says Product everywhere a person reads it; the schema, the
  GraphQL API, the MCP tool names, the `/p/<slug>/` route and the `bp-<slug>`
  Cognito groups all still say project. That split is deliberate — renaming
  the data model would be a migration across six live groups and every stored
  row, for a word. Do not "fix" one side to match the other without doing all
  of it.
- Record decisions as ADRs in `docs/adr/`, numbered, with the *consequences*
  section actually filled in.
- Commits: see the `git-commit` skill. `stage` is the integration branch; `main`
  is only updated by a promotion PR.

## Related repos worth reading before inventing something

| Repo | Why |
|---|---|
| `~/D-LAB-5/atmanyoga-fullstack` | The topology this repo copies: workspace + non-workspace backend, `amplify.yml`, SSR-safe Amplify config, Cognito sign-in with the new-password challenge. |
| `d-lab-5/gatsby-techradar` (GitHub) | The package split, and the Tech Radar itself for WP9. |
| `~/digitalhomeCloud/digitalhome-cloud-darkfactory` | `repos/core/amplify/` for Gen 2 patterns and the storage-proxy Lambda; `repos/core/blockly/` and `repos/designer/src/blockly/` for the Blockly-as-ontology-editor patterns; `repos/modeler/src/utils/blocklyGenerator.js` for generating blocks from a T-Box. Skills: `dhc-amplify-gen2`, `dhc-security-audit`. |
| `AlbertoDMendoza/archimate_ontology` | Apache-2.0. `ontology/archimate.ttl` and `derivation/relationships.xml` — the machine-readable ArchiMate 3.2 relationship matrix the metamodel is generated from. |
