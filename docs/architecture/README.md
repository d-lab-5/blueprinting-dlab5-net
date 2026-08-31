# Architecture models

The platform's own components, modelled in the platform. Seeded from Turtle
here, edited in the app, exported back.

```bash
set -a; source .env.local; set +a
npm run seed -- --project mcp-server \
  --from docs/architecture/mcp-server.ttl \
  --name "MCP server" --group bp-engineers
```

## `mcp-server.ttl`

Nineteen elements across three layers, answering "what is this thing and what
does it need to run".

**Application.** The server composed of three components and one interface:
metamodel tools, model tools, backend client. Each performs a function; the
functions realize the two services an agent actually consumes — a
*specification* service that needs no account, and a *model* service that does.
The split is the architecture's one real idea, and the model makes it visible:
nothing connects the metamodel half to the backend client.

**Interface.** One `ApplicationInterface` — stdio carrying JSON-RPC. It serves
the agent directly, which is why there is no endpoint, no certificate and no
token at rest anywhere in this picture.

**Technology.** A workstation running Node.js 22, which is assigned the built
artifact and the standard I/O streams. Cognito and AppSync serve the backend
client. The agent host and the server are the same machine — that is what makes
stdio sufficient, and the model says so rather than leaving it implied.

## Its validation warnings are deliberate

Five, all `derived-relationship`, and each is a case where ArchiMate defines
the relation only as a derivation:

| Relation | Why it is drawn anyway |
|---|---|
| Artifact realizes Application Component | The standard deployment statement. The chain runs through elements this model does not draw because they add nothing here. |
| Technology Service serves Application Function (×2) | Cognito and AppSync reaching the backend client. Modelling the intermediate technology behaviour would say less, not more. |
| Technology Service serves Application Interface | stdio carrying the tool interface. |
| Application Function serves Application Function | Authentication serving model access — a real ordering, and the honest way to say it. |

`docs/patterns/engineering-patterns.ttl` carries a deliberate derived warning
for the same reason. The rule the checker enforces is *"a derived relation is
implied, not asserted"*, and the right response to it is sometimes to assert it
anyway and say why — which is what this table is.

It raises **no** practice findings: no vague associations, no property standing
in for an element.

## Regenerating

```bash
set -a; source .env.local; set +a
npm run export -- --project mcp-server --out docs/architecture/mcp-server.ttl
```
