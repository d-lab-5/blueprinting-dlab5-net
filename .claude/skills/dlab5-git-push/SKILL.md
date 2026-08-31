---
name: dlab5-git-push
description: |
  Quality gate for blueprinting.dlab5.net, run when PUSHING rather than on every
  commit. Use before `git push`, when preparing a promotion PR, or when asked
  whether a change is ready. Selects checks by what actually changed — TypeScript,
  stylesheets, the backend, the ontology, the MCP server, Turtle seeds, docs — and
  names the documentation each kind of change obliges you to update. Includes the
  secret and licence sweep that a public repository needs, and the cleanup audit
  that live checks require.
license: GPL-3.0-or-later
metadata:
  maintainer: "Systems LAB 5"
  repository: "https://github.com/d-lab-5/blueprinting-dlab5-net"
  last_verified: "2026-08-29"
---

# Pushing to blueprinting.dlab5.net

## Why this runs on push and not on commit

The checks that matter here are slow and some are live: `verify:ui` drives a
real browser, `verify:bundle` writes to AWS and deletes what it wrote, a clean
build takes minutes. Running that on every commit would make committing
something to avoid, and commits are how the work is recorded.

A push is where the cost is justified: it is the first moment the work leaves
this machine, and on `stage` it deploys.

**Commit freely. Gate the push.**

## Pick the checks from the diff

```bash
git diff --stat origin/stage..HEAD    # or --cached before committing
```

| What changed | Run |
|---|---|
| anything at all | `npm test`, then the sweep below |
| `packages/**/*.ts(x)` | `npx tsc --noEmit -p packages/site/tsconfig.json` |
| `packages/site/src/styles/*.css` | **clean build** — see below, this has cost time twice |
| `packages/site/**` | `npm run build` then `npm run verify:ui` |
| `backend/**` | `npm run backend:typecheck` |
| `ontology/overlay/**` | `npm run gen:metamodel && git diff --exit-code packages/metamodel/src/generated` |
| `packages/mcp/**` | `npm run verify:mcp` and `npm run verify:mcp-client` |
| `docs/**/*.ttl` | parse and validate it; `npm run verify:archi` if the shape changed |
| `packages/core/src/diagrams/**` | `npm run verify:views` |
| auth, keys, documents, bundles | the matching `verify:*`, live |
| `scripts/verify-*.mjs` | run the one you changed, and read its output rather than its exit code |

Anything touching Cognito, S3 or DynamoDB needs credentials:

```bash
set -a; source ./.env.local; set +a
```

## The stylesheet trap

`npm run build` reuses the cached stylesheet and emits the **identical content
hash**, so the page renders with the old CSS and the edit looks like it did
nothing. CLAUDE.md constraint 14. Before building after a CSS change:

```bash
rm -rf packages/site/.cache packages/site/public && npm run build
grep -ro "your-new-class{[^}]*}" packages/site/public/*.css
```

More than one `styles.*.css` in `public/` is the symptom.

## Before a push to a public repository

```bash
# Secrets. GitHub's push protection will reject the push anyway — better to
# find it here than to be told by a rejected push, and never bypass it.
git diff origin/stage..HEAD | grep -nE '(sk|pk|rk)_(live|test)_[A-Za-z0-9]{16,}|AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9]{36,}|-----BEGIN [A-Z ]*PRIVATE KEY-----'

# amplify_outputs.json, account ids, ARNs, .env, real hostnames. SECURITY.md.
git diff --cached --name-only | grep -E 'amplify_outputs|\.env'
```

If a secret is found in a file from an upstream, redact it, state the
modification as GPL-3.0 §5 requires, and **rewrite the commit rather than
bypassing the block**. The bypass is the repository owner's decision.

## What a change obliges you to update

This is the half that gets forgotten, and a wrong document is worse than a
missing one.

| You added | Update |
|---|---|
| an `npm run` script | the commands block in `CLAUDE.md` |
| a constraint you learned the hard way | the numbered constraints in `CLAUDE.md` |
| a decision with consequences | an ADR in `docs/adr/`, numbered, **with the consequences section filled in** |
| a third-party source | `NOTICE`, and a `LICENSE` beside the files if its terms require one |
| a skill | `docs/skills-catalog.md` — regenerate with `npm run gen:skills-catalog` |
| a property key | `ontology/overlay/`, then regenerate. Never hard-code one (constraint 11) |
| an element or relationship rule | nowhere — ask the metamodel, never restate it |

Check for dangling references before pushing:

```bash
grep -rno "ADR-[0-9]\{4\}" --include="*.ts" --include="*.tsx" --include="*.md" . \
  | grep -v node_modules | grep -oE "ADR-[0-9]{4}" | sort -u \
  | while read a; do ls docs/adr/${a#ADR-}-*.md >/dev/null 2>&1 || echo "dangling $a"; done
```

## After a live check, audit — do not trust its output

Three cleanup gaps were found in one session, none of them by the script that
caused them:

- a verifier signed out halfway through its own cleanup, so the delete after it
  failed and left a product behind;
- a manual run was never tidied up at all;
- two verifiers deleted their DynamoDB rows and left the S3 objects, which
  nothing pointed at and nothing complained about.

So after any live run, look at the environment rather than the log:

```bash
# products, documents, keys — expect only what you meant to be there
# S3 prefixes under projects/
# Cognito groups without a matching product row
```

## Render UI changes and look at them

Every UI defect this project has found was found that way and **none by an
assertion**. A duplicated heading, a Save button under a list of documents, a
6px gap, an id shown where a name belongs — all found by opening a screenshot.

`node scripts/verify-ui.mjs --shots /tmp/shots` writes one per route.

## Watch the deployment

A push to `stage` deploys. It is not finished until the build is:

```bash
aws amplify list-jobs --app-id <id> --branch-name stage --max-results 1 \
  --query "jobSummaries[].[jobId,status]" --output text
```

A build failing after a green local run is usually one of two things: a
CloudFormation cycle from a new cross-stack reference (ADR-0006), or a
generated GraphQL name being redeclared — `a.model("X")` already generates
`createX`, `updateX`, `deleteX`, and redeclaring one fails the CDK assembly.

## Then, and only then, say it works

Say what was checked and **say what was not**. "Not verified" is a finding;
silence about it is not. If a check was skipped because a tool is missing, say
which half of the thing is therefore unproven.

Never describe something as working before the check that proves it has run.
