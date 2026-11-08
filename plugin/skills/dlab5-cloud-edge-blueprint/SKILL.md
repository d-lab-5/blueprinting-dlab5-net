---
name: dlab5-cloud-edge-blueprint
description: Designing a new D-LAB-5 product as a CLOUD plus EDGES, from the ArchiMate blueprint `cloud-edge-platform.ttl` in blueprinting-dlab5-net — four patterns (a tenant with spaces; an edge linked by device flow; knowledge as an RDF graph per space synced with the edge; a local agent on the edge over MCP) and three edge kinds (human, IoT with Node-RED, robot with ROS 2). Use when someone wants a new product, platform or app that has a web site plus something local (a PC tool, a home server, a robot, an AI chat that works on local data), asks "can we make this a template/pattern", asks which parts to reuse, or asks how the Mediathek / DigitalHome are built. Walks from the questions to the patterns, records the product as an instance in the blueprint, and then generates from template-dlab5-cloud and template-dlab5-edge.
---

# The cloud-and-edge blueprint

`docs/patterns/cloud-edge-platform.ttl` in **blueprinting-dlab5-net** (stage)
is an ArchiMate model of how D-LAB-5 builds products with a cloud and edges.
It is the index; the detail lives in the templates' ADRs and these skills:

| Pattern | Settles | Where it is built |
|---|---|---|
| **A tenant with spaces** | one minted tenant id per family/home/team; spaces decide who reads what; operators read no content; two-step sign-in for admins | template-dlab5-cloud ADR-0005 (skill dlab5-cloud-template) |
| **An edge linked by device flow** | a person approves every edge (RFC 8628); version gate 426; a bare 410 is a revoke, an item's 410 carries its own code | ADR-0006, docs/specs/edge-cloud-api.md; template-dlab5-edge `edge/cloud.py` |
| **Knowledge as a graph per space** | A-Box per space, SHACL-validated, versioned, three-way merged | ADR-0007; `packages/ontology`; `edge/sync.py` |
| **A local agent on the edge, over MCP** | the agent proposes, a person confirms; private data stays on the edge | `edge/chat.py`, `edge/mcp_tools.py` (skill dlab5-edge-template) |

Edge kinds: **human** (a PC app; instance: the Mediathek edge), **IoT**
(Node-RED backbone; instance: digitalhome-edge), **robot** (ROS 2; a
*candidate* — no instance yet, promote it when the first exists).

Instances today: the Mediathek (household/vault) and DigitalHome.Cloud
(SmartHome). The bar: a pattern needs **two** instances; one is an ADR.

## Designing a product

1. **Ask what the tenant and the spaces are** in the product's words
   (household/vault, home/room, team/board). Who administers a tenant? What
   must some members not see (that is a private space)?
2. **Ask what the edge is**: who runs it (a person, a box, a robot), what it
   produces, and what must **never** leave it (biometrics, raw sensor data,
   private files). That list is the privacy contract; write it into the
   product's README and the chat's prompt.
3. **Ask what the tenant knows** that is not content: people, places, rooms,
   devices, events. That is the T-Box (`packages/ontology`): reuse schema.org,
   FOAF, SKOS first; add only what they lack; English master, de and fr.
4. **Check the patterns fit.** A product that needs something else (media
   delivery through a CDN, physical items, payments) adds its own ADR; if a
   second product needs it too, propose it as a pattern in the blueprint.
5. **Record the product** in blueprinting-dlab5-net: add its repositories to
   the `instances` property of each pattern it uses (seed the project,
   edit in the platform, `npm run export` back to the .ttl), and a short
   architecture of its own if it has more than the patterns.
6. **Generate**: the cloud with dlab5-cloud-template (`rename.mjs … --tenant
   --space`), the edge with dlab5-edge-template (`edge_kind`, `cloud_name`,
   `tenant_noun`, `space_noun`). Link the edge to a sandbox and prove the
   flow before building the product's own screens.

## Changing the blueprint

The .ttl is written by blueprinting's own Turtle writer (byte-stable). Build
or edit the model in code or in the platform, validate with
`validateModel` (no errors; derived-relationship warnings are deliberate in a
reference architecture), write it with `serializeAbox`, check it reads back
byte-identical, and say why in `docs/patterns/README.md`. The repo is public:
no real names, hosts or account ids.
