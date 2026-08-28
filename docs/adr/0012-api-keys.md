# ADR-0012 — An API key is a Cognito credential, not a second way in

- Status: accepted
- Date: 2026-08-28

## Context

The MCP server could only sign in with a password, which rules out running it
anywhere unattended — a hosted agent, a CI job, a colleague's machine. What is
wanted is a key tied to a user account, usable for the MCP server and the API,
that can be named, listed, revoked and scoped.

`BP_REFRESH_TOKEN` already covers the narrow case: refresh tokens last thirty
days, carry the user's own groups, and revoke cleanly. But a refresh token is
the whole account, cannot be named or listed, and cannot be read-only.

### The option that looks obvious and is wrong

**An AppSync API key.** AppSync supports one natively, and it would be an
afternoon's work. It also has no user identity at all. Every authorization rule
in this system reads the caller's `cognito:groups` —
`allow.groupDefinedIn("group")` on three models, and an explicit check in five
Lambdas. A key with no identity turns per-product access into "anyone with the
key sees everything", which is the opposite of the model this platform is built
on. It is a key for the API, not for an account.

**A Lambda authorizer** fails for a subtler reason. AppSync would pass its
result as `$ctx.identity.resolverContext`, while Amplify's *generated* model
rules read `$ctx.identity.claims["cognito:groups"]`. The five hand-written
Lambdas could be taught to read either; `listProjects` could not, and the MCP
server needs it.

## Decision

**An API key authenticates to Cognito and yields an ordinary session.**

Cognito custom authentication: the client calls `InitiateAuth` with
`CUSTOM_AUTH`, and answers the challenge with the key. Three triggers —
`DefineAuthChallenge`, `CreateAuthChallenge`, `VerifyAuthChallengeResponse` —
validate it against a hashed record. What comes back is a normal Cognito token
carrying the user's real groups, so **every authorization check downstream is
untouched**. That is the whole point of choosing this over the alternatives.

Keys are stored hashed, never in full. The full value is shown once at
creation and cannot be recovered afterwards, because a key a system can show
you twice is a key that system is storing.

### Read-only has to be real

A scope that only the client honours is not a scope. Enforcing it needs the
token to say so, in a way the caller cannot forge, and needs the *generated*
model mutations to respect it as well as the hand-written Lambdas.

Two mechanisms, together:

1. **A separate app client for key authentication.** Its id appears in the
   token as `client_id`, set by Cognito and not by the caller, so a Lambda can
   tell a key session from a browser session with certainty.
2. **A `bp:scope` claim**, added by a `PreTokenGeneration` trigger, which knows
   the key's scope because the same trigger chain validated it.

Generated model mutations are closed separately, by tightening their rules:
member access to `Project`, `Document` and `View` rows becomes read-only, and
writing a row becomes an administrator's act. That is a correction on its own
merits — members were never meant to delete a `Document` row directly, they are
meant to call `purgeDocument`, which also removes the objects. A read-only key
then cannot write a row because nobody but an admin can, and an admin's key
carries `bp:scope: read` which the Lambdas refuse.

**Read-only is the default at creation.** A write key is a deliberate choice.

## Consequences

**Downstream code barely changes.** Five Lambdas gain one check. Nothing else
learns that API keys exist, because by the time a request reaches anything the
credential is an ordinary Cognito token — which is the property that made this
design worth the extra work over an AppSync key.

**Two app clients now exist**, and the second must never be usable for password
authentication. It allows `CUSTOM_AUTH` only.

**A leaked read key is still a data leak.** It cannot change the model, but it
can read every product its owner can. Scope limits damage; it does not remove
it. Keys expire, and the expiry is not optional.

**Tightening the model rules is a behaviour change** beyond API keys: a member
who could previously delete a `Document` row through the generated API can no
longer do so. Nothing in the application did that — the UI calls
`purgeDocument` — but a script someone wrote might.

**This is not yet a public MCP endpoint.** The key solves authentication; the
endpoint is separate work, and a hosted transport still needs the streamable
HTTP transport, rate limiting, and a decision about exposing a write path to
the internet at all. Read-only keys exist partly so that decision has a safe
answer.
