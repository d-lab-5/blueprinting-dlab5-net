# ADR-0014 — The blueprint MCP, hosted, with the caller's own key

- Status: accepted
- Date: 2026-10-09

## Context

claude.ai can only reach a remote MCP server, and the blueprint server
(`packages/mcp`) spoke stdio. ADR-0012 left the hosted endpoint open: "a hosted
transport still needs the streamable HTTP transport, rate limiting, and a
decision about exposing a write path to the internet at all".

Two facts made it more than a transport swap:

- **The server held one identity per process.** Amplify keeps its session in
  process-wide state, and a Lambda serves many requests from one process. Two
  keys would have shared whichever token was stored last.
- **A key alone cannot sign in.** Cognito's custom auth needs a USERNAME, and a
  key (`bp_<keyId>_<secret>`) does not carry one.

## Decision

**The caller's blueprinting API key is the identity, per request.** claude.ai
sends `Authorization: Bearer bp_…` as a connector request header. The server
reads that key's row for its owner's `sub` (the pool's username for e-mail
sign-in) and its scope, then runs the same custom-auth exchange the stdio
server does, on the read or write client the scope names. Cognito's verifier
still checks everything: the hash, the owner, revoked, expired, and a read key
on the write client.

**Every call goes to AppSync with that token** (`src/appsync.ts`, plain
GraphQL over fetch). Product groups, `bp:scope` and the bp-admins strip apply
exactly as in the app. The Lambda's own role can read a key's owner and scope,
and nothing else.

**Per-request client, not per-process.** The data calls (`src/data.ts`) no
longer import Amplify. Over stdio the process's one session is set once; hosted,
each request runs inside `withClient`, an `AsyncLocalStorage` binding, so a
call can only ever see its own request's client. The tools did not change.

**Stateless.** A fresh MCP server per request, JSON responses, no sessions, on
the SDK's web-standard transport. The only state is a token cache keyed by
sha256 of the key, until five minutes before the token lapses.

**Rate limit: reserved concurrency 5.** At most five requests at once.

**Its own SAM stack**, `blueprint-mcp` (`packages/mcp/hosted/`), outside the
Amplify app, because the backend is not a workspace (ADR-0001). The bundle is
esbuild, 1.3 MB, with no Amplify in it.

## Consequences

**A write path is on the internet, and it is exactly as wide as a key.** A
write key can do what its owner can, minus bp-admins; a read key cannot write
at all, which `verify:mcp-hosted` checks live. ADR-0012's "safe answer" is
used as intended: give an agent a read key unless it must edit.

**A key reaches every product its owner can.** Scoping a key to chosen
products is WP14; until then, an agent that should see one product gets a
dedicated user in that product's group, holding its own key.

**The four SAP diagram tools are not served.** They run python3 on a vendored
toolchain and read and write the server's own disk. They stay on stdio.

**Two ways to the same tools.** stdio for an agent on this machine, HTTP for
claude.ai and for any Claude Code that would rather hold one URL and a key.
Both are covered: `verify:mcp` and `verify:mcp-client` over stdio,
`verify:mcp-hosted` over HTTP with the official Python SDK and scratch keys.

**Configuration stays out of git.** The AppSync URL, the two key clients and
the key table are SAM parameters in a gitignored `samconfig.toml`.
