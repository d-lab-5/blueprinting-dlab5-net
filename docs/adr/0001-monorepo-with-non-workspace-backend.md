# ADR-0001 — Single repo, npm workspaces, backend outside the workspace

- Status: accepted
- Date: 2026-08-23

## Context

The spec asks for front and backend in the same repository. Three in-house
topologies were available:

- `digitalhome-cloud-darkfactory` — umbrella repo with git submodules, one
  backend owned by a `core` submodule, three frontends. Rich, but heavy: four
  repos to keep in step for one product.
- `gatsby-techradar` — npm workspaces with `amplify/` at the repo root inside
  the workspace. Clean, and the source of the package split we adopt.
- `atmanyoga-fullstack` — npm workspaces for the frontend, with `backend/`
  deliberately outside the workspace and holding its own lockfile.

## Decision

Follow `atmanyoga-fullstack`. One repo, `packages/*` as npm workspaces, and
`backend/` outside the workspace with its own `package.json`, lockfile and
`node_modules`.

## Consequences

The reason `backend/` is not a workspace is recorded in `amplify.yml` and is
load-bearing: **Gatsby needs graphql 16 and the Amplify data construct needs
graphql 15, and one hoisted dependency tree cannot satisfy both.** Making
`backend/` a workspace to tidy the layout will reintroduce that conflict.

Costs accepted: two installs (`npm ci` and `npm --prefix backend ci`), two
lockfiles, and `amplify_outputs.json` has to be copied from `backend/` into
`packages/site/src/` rather than resolved through the module graph. The copy is
tolerated to fail so that a frontend-only rebuild still succeeds.

Not adopted from darkfactory: submodules. There is one frontend here, so the
"amplify on two levels of a repo" problem that forced the backend into a
submodule there does not arise.
