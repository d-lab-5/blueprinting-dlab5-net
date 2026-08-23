# ADR-0002 — Cognito for everything, no guest tier, one gate

- Status: accepted
- Date: 2026-08-23

## Context

The spec: *"No guest, landing page is login (user setup directly in cognito for
the moment)"*, and *"Each project has its own group in cognito to allow team
work"*.

The DHC Portal models the opposite — a three-state
`loading | demo | authenticated` session where unauthenticated users get a demo
experience — and guards routes with a copy-pasted
`useEffect(() => navigate("/signin"))` in each page.

## Decision

1. One `<AuthGate>` in `gatsby-browser`'s `wrapPageElement` wraps every page.
   There is no per-page guard and no `<PrivateRoute>` to remember to use.
2. `gatsby-ssr` mounts the same gate but does **not** configure Amplify. The
   gate short-circuits to a neutral frame whenever there is no `window`, so
   page components never execute during the build. The static artefact
   therefore contains no authenticated data and cannot break on a missing
   `amplify_outputs.json`.
3. Guest access is removed rather than hidden:
   `allowUnauthenticatedIdentities = false` on the identity pool, no API key on
   AppSync, `defaultAuthorizationMode: "userPool"`.
4. Self-signup is closed at the user pool with
   `adminCreateUserConfig.allowAdminCreateUserOnly = true`.
5. One static group, `bp-admins`. Per-project groups are named `bp-<slug>` and
   are created by hand in the Cognito console — declaring them in `defineAuth`
   would mean a backend deploy per new project.

## Consequences

`AuthGate` renders nothing while the session is unknown rather than rendering
the shell optimistically. That is a deliberate blank frame: swapping a rendered
shell for a sign-in form is exactly the flash of authenticated content the gate
exists to prevent. It doubles as the SSR output and as the client's first
render, so hydration matches with no extra work.

An earlier draft left the gate out of `gatsby-ssr` entirely, reasoning that a
gate has nothing to do during a build. That broke the build: without it, Gatsby
rendered page components directly and `useSession()` threw. The gate is not an
add-on to SSR safety, it is the mechanism — which is why both lifecycle files
import one shared `wrapPageElement`.

Because per-project groups are not known at deploy time, Amplify's static
`defineStorage` rules cannot express them. That is what forces the
storage-proxy Lambda in ADR-0003 — the two decisions are linked, and reversing
this one changes that one.

Adding a user to a group does not change their existing tokens. The UI must
call `fetchAuthSession({ forceRefresh: true })` after a group change, or the
user will not see the new project until their token expires.
