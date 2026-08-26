# Engineering patterns

An ArchiMate model of how D-LAB-5 builds things, held in the platform and
seeded from `engineering-patterns.ttl`.

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
