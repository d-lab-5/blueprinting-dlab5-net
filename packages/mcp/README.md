# @dlab5/archimate-mcp

An MCP server over an ArchiMate 3.2 model — and over the ArchiMate
specification itself.

## Why the specification matters as much as the model

Read access to a model lets an agent describe an architecture. Read access to
the *language* lets it change one correctly. ArchiMate is not guessable:

```
Plateau --composition--> Deliverable      reads plausibly, is forbidden
Deliverable --realization--> Plateau      reads oddly, is correct
```

The metamodel tools answer that from Appendix B rather than from intuition,
and the mutating tools refuse an illegal change *before* writing, saying what
would have been legal instead. An agent cannot leave an invalid model behind.

## Tools

**Metamodel** — no backend, no credentials:

| Tool | Answers |
|---|---|
| `archimate_list_element_types` | What element types exist, by domain |
| `archimate_describe_element_type` | Definition, domain, and every permitted target |
| `archimate_check_relationship` | Is `A --rel--> B` legal? If not, what is? |
| `archimate_allowed_targets` | What may `A` connect to with `rel` |
| `archimate_describe_conventions` | Property keys for scheduling and the radar |

**Model** — needs credentials:

`list_projects`, `get_model`, `query_elements`, `add_element`,
`add_relationship`, `set_element_properties`, `remove_element`,
`validate_model`, `render_roadmap`, `get_radar`, `export_open_exchange`

## Install

```bash
npm run build
claude mcp add archimate \
  --env BP_USER=you@example.com \
  --env BP_PASSWORD=… \
  -- node /absolute/path/to/packages/mcp/dist/index.js
```

Without `BP_USER`/`BP_PASSWORD` the server still starts and serves the five
metamodel tools, which need no backend — useful for asking ArchiMate questions
with no project to hand.

`BP_OUTPUTS` points at an `amplify_outputs.json` other than the repo's, which
is how you aim it at a deployed branch rather than a sandbox.

## Design notes

**stdio, not HTTP.** The server runs beside the agent: no endpoint to secure,
no token parked anywhere, and a change to the tool surface costs a restart
rather than a deploy. A hosted transport is the next step once the tools settle.

**It goes through AppSync, not around it.** Every read and write uses the same
mutations the browser uses, so an agent inherits the per-project Cognito group
check and the S3 ETag precondition. A privileged path for agents would be a
second security boundary, and the one nobody audits.

**No retry on write conflict.** A retry would fetch the newer model and
overwrite it with edits computed against the older one — exactly the lost
update the precondition prevents. The agent is told to read again and redecide.

## Verifying

```bash
npm test -w @dlab5/archimate-mcp          # metamodel tools
BP_USER=… BP_PASSWORD=… npm run verify:mcp  # model tools, live backend
```

## Testing it

Three layers, and they test different things:

| | What it covers |
|---|---|
| `packages/mcp/__tests__` | the tool functions, called directly |
| `npm run verify:mcp` | the same functions against a live backend — the group check and the ETag precondition, which cannot be mocked without testing the mock |
| `npm run verify:mcp-client` | **the protocol**, from a Python client |

The third exists because the first two both call `tool.run(args)` and never
send a `tools/list` or a `tools/call`. That skips the stdio framing, the
registration, and whether each zod schema converts into a JSON Schema a client
can actually read — so a miswired `registerTool` or a schema that fails to
serialise would leave every existing test passing and the server broken for
every real client.

It is written in Python against the official SDK on purpose. A second
implementation in another language cannot share our misunderstandings, which is
the same reason Turtle is checked with rdflib, Open Exchange with Archi, and D2
with the real compiler. It found the difference immediately: the Python SDK
exposes `server_info`, `is_error` and `input_schema` where the wire format has
`serverInfo`, `isError` and `inputSchema`.

```bash
npm run setup:python        # once — a venv, gitignored
npm run verify:mcp-client   # 13 checks, metamodel only

BP_USER=… BP_PASSWORD=… npm run verify:mcp-client   # 17 checks, all 16 tools
```

Running it **without** credentials is not a lesser run: it verifies the
degraded path, which is a real feature. An agent asking what ArchiMate permits
needs no account, and the check asserts that no model tool is offered when
there is no backend to serve it.
