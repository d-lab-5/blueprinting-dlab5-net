# Engineering patterns

An ArchiMate model of how D-LAB-5 builds things, held in the platform and
seeded from `engineering-patterns.ttl`.

> **Now held in the Engineering practices product.** On 2026-10-09 this file,
> `cloud-edge-platform.ttl` and `technology-radar.ttl` were merged into the
> `engineering-practices` product with `scripts/merge-models.mjs`, so every
> MCP client can read them. **The product is authoritative from here on:**
> edit it in the app or over MCP, and bring it back with
> `npm run export -- --project engineering-practices`. These files stay as the
> record of what was loaded, and as test fixtures (`verify-views`,
> `views.test` read `engineering-patterns.ttl`). Products built from a pattern
> are named in its `reference` (e.g. `product: Mediathek`), never by id.
>
> To merge a model file into a product, use `merge-models`, not `seed --merge`.
> Model files number relationships `r1, r2, …`, and `seed --merge` matches by
> id, so it would drop them silently:
>
> ```bash
> BP_USER=… BP_PASSWORD=… node scripts/merge-models.mjs \
>   --into engineering-practices --from docs/patterns/<file>.ttl --dry-run
> ```

```bash
BP_USER=… BP_PASSWORD=… npm run seed -- \
  --project patterns --from docs/patterns/engineering-patterns.ttl \
  --name "Engineering patterns"
```

## The shape

A pattern is an ArchiMate **Grouping** aggregating two things: the practice and
the architecture it applies to.

```
Grouping "Pattern: …"
  aggregates  Principle    a guideline
              Constraint   a restriction, and why it exists
              Assessment   the evidence, usually a failure that taught it
              ApplicationComponent / Artifact / SystemSoftware
                           the reference architecture

  a component realizes the constraints it satisfies
  a product's component specializes the reference one
```

This is not ArchiMate bent to fit. `Principle` is defined by the specification
as "a fundamental guideline for architecture decision-making" and `Constraint`
as "a limitation or restriction affecting architecture decisions". The
Motivation layer is where practices belong.

## What goes here and what does not

**ArchiMate is the index; the prose lives elsewhere.** Every element carries a
`reference` property pointing at the ADR, Claude Code skill or package that
holds the detail. Query the model for *what applies and why*; follow the
reference for *how*.

A runbook is not an ArchiMate concept and putting one in a `documentation`
field would turn this into a worse wiki. A skill loads itself by
description-matching at the moment an agent needs it, which no model can do.
Neither medium is asked to do what it is bad at.

## The bar: promote on the second instance

One instance is a decision and belongs in an ADR. Two is evidence the shape
generalises. The `instances` property names the repositories that prove each
pattern, so the bar stays visible in the data rather than in someone's memory.

Three patterns qualify today. Several of the strongest ideas in the platform —
verifying against a foreign tool rather than our own reader, an MCP server that
serves the specification and not only the data, ETag-guarded whole-file writes
— have exactly one instance and are deliberately **not** here. Recording that
exclusion is the point: without the bar this becomes a list of everything
anyone has done, which nobody trusts and nobody reads.

## The cloud and edge platform

`cloud-edge-platform.ttl` is a second, larger grouping: the **blueprint** for
products made of a cloud and the edges that link to it. It aggregates four
patterns, each with two instances (the Mediathek and DigitalHome.Cloud):

| Pattern | What it settles |
|---|---|
| A tenant with spaces | one minted tenant id per family, home or team; spaces decide who reads what; operators read no content |
| An edge linked by device flow | a person approves every edge (RFC 8628); a version gate (426); a deleted item is not a revoke (410 with its own code) |
| Knowledge as a graph per space | an A-Box per space, typed by a versioned ontology, synced three ways (409 on a stale write) |
| A local agent on the edge, over MCP | the agent proposes, a person confirms; private data stays on the edge |

The edge comes in three kinds, each a specialization of the `Edge` node: a
**human** edge (a PC app), an **IoT** edge (Node-RED backbone) and a **robot**
edge (ROS 2 backbone). The robot edge has no instance yet and is marked
`status: candidate`, by the bar above.

Two artifacts realize the blueprint, and a new product starts from them:
`template-dlab5-cloud` and `template-dlab5-edge`.

```bash
BP_USER=… BP_PASSWORD=… npm run seed -- \
  --project cloud-edge --from docs/patterns/cloud-edge-platform.ttl \
  --name "Cloud and edge platform"
```

It carries ten deliberate `derived-relationship` warnings, for the same reason
as above: a reference architecture states that a component accesses a data
object or that a template realizes a component, without modelling the
functions and interfaces in between.

## Regenerating

`engineering-patterns.ttl` is written by `packages/core`'s Turtle writer, so it
is normalised and byte-stable. Edit it in the platform and export:

```bash
BP_USER=… BP_PASSWORD=… npm run export -- \
  --project patterns --out docs/patterns/engineering-patterns.ttl
```

It carries one deliberate validation warning: a derived `serving` between two
application components. In a reference architecture the intermediate
interfaces are not modelled, so the derived relationship is the useful
statement.
