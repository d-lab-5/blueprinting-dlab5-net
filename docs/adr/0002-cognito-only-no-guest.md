# ADR-0002 — Cognito for everything, no guest tier, one gate

- Status: accepted, amended 2026-08-25 (see *Amendment* below)
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

## Amendment — 2026-08-25: a visitor sees a landing page, not a bare form

WP11's design handoff replaces the sign-in form on an empty background with a
landing page: a heading, a sentence about what the platform is, a drawing of
the ArchiMate metamodel, and the sign-in card within it.

**This amends the presentation, not the access control.** Everything this ADR
decided about who may reach what is unchanged, and deliberately so:

- `allowUnauthenticatedIdentities` stays `false`. There is still no guest
  identity, no demo pool, and no anonymous credential of any kind.
- Self-signup stays closed. Accounts are still created by an administrator.
- There is still one gate wrapping every page, and it still renders the
  landing page for *every* route rather than only for `/`. A visitor typing
  `/p/<slug>/` sees the landing page, not that project.
- **No data is fetched before sign-in.** The constellation on the landing page
  is drawn from `@dlab5/archimate-metamodel`, which is compiled into the
  bundle. It is the published ArchiMate 3.2 specification — sixty element
  types and the relationships Appendix B permits between them — and it is
  identical for every visitor. It reveals no project, no element, no name.

The original wording, *"No guest, landing page is login"*, was a decision about
access. Reading it as a decision that a visitor must be shown nothing but a
password box reads more into it than it says, and cost the product the one page
that can explain what it is. The three-state `loading | demo | authenticated`
session this ADR rejected is still rejected: there is no `demo` state, no
demo data, and `AuthGate` still has exactly the states it had before.

What did change in the code: `SignInForm` no longer owns the page. It renders
inside `GuestLanding`, its `<h1>` became an `<h2>` so the page keeps a single
heading, and its provisioning note moved to the landing page's footer where it
is stated once.
