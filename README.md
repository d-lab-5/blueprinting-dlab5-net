# D-Lab-5 Blueprinting Platform

An open-source, lightweight engineering governance and architecture planning
suite built for [blueprinting.dlab5.net](https://blueprinting.dlab5.net). Maps
technical state, architecture structure, and tactical roadmaps over an
ArchiMate 3.2 semantic ABox backend.

## What "blueprinting" means here

A blueprint is not a static network diagram. It is the multi-dimensional
mapping of a technology's **state**, **structure** and **schedule**, kept as one
living model rather than three drifting documents:

| Dimension | Question | Rendered as |
|---|---|---|
| Technology Radar | Is this adopted, trialled, assessed or held? | Radar |
| Architecture | How do these services actually interact? | D2 (layers 4–6), Mermaid sequence (layer 3) |
| Roadmap | When does this reach production? | Mermaid Gantt (layer 7) |

All three read from one ArchiMate 3.2 model, so the roadmap can only schedule
components the architecture defines, and the architecture can only use
technologies the radar permits.

## Status

Early. The foundation is in place — authenticated Gatsby shell, Amplify Gen 2
backend, project entity — and the first feature under construction is the
Layer 7 roadmap view, seeded with the plan for building this platform.

## Stack

Gatsby 5 / React 18 · AWS Amplify Gen 2 · Cognito · DynamoDB · S3 ·
ArchiMate 3.2 ABox in Turtle · Mermaid and D2 · an MCP server exposing the
model to LLM agents.

## Getting started

```bash
nvm use                              # Node 22
npm ci && npm --prefix backend ci    # the backend has its own dependency tree
npm run backend:sandbox              # provision a personal AWS sandbox
npm run backend:sync-outputs
npm run dev:web                      # http://localhost:8000
```

There is no guest access: the landing page is the sign-in page. Create a user
in the Cognito console and add them to `bp-admins`.

See [`CLAUDE.md`](CLAUDE.md) for the constraints that are not obvious from the
code, [`docs/adr/`](docs/adr/) for why things are the way they are, and
[`SECURITY.md`](SECURITY.md) before committing — this repository is public.

## Credits

The ArchiMate ontology backbone is
[AlbertoDMendoza/archimate_ontology](https://github.com/AlbertoDMendoza/archimate_ontology)
(Apache-2.0). ArchiMate® is a registered trademark of The Open Group.

## Licence

MIT — see [LICENSE](LICENSE).
