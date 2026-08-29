# Knowledge seeds

ArchiMate models of things that exist outside this platform: technology
landscapes, vendor product families, reference structures. They are seeds, not
truth — you import one into a product and then own what you imported.

They differ from `docs/practices/` (how to model well) and `docs/patterns/`
(shapes this project proved). This directory answers "what is out there".

## Where this came from

`sap-landscape.ttl` was written **from** the SAP skills in `.claude/skills/`,
maintained by Eduard Jiglau at [sap-ai-skills.com](https://sap-ai-skills.com)
and licensed GPL-3.0 — the reason this repository is GPL-3.0-or-later rather
than MIT.

It is not a copy of them, and would not be even if copying were the point.
Which SAP products exist and how they group is fact; the skills' prose is their
authors' expression. Every element here cites the skill its existence was
learned from in a `reference` property, the same way
`docs/practices/engineering-practices.ttl` cites a book it never reproduces.

Regenerate with `npm run gen:sap-landscape` after editing
`scripts/gen-sap-landscape.mjs`. The file is generated so that its Turtle
matches byte for byte what the application writes, which is what lets a seed be
diffed against an exported model.

## No radar rings

The elements are radar-*eligible* by type — `SystemSoftware`,
`TechnologyService`, `ApplicationComponent` — and carry no ring.

A ring says adopt, trial, assess or hold. That is a decision an organisation
makes about its own estate, not a fact about a product, and shipping one here
would put a judgement nobody made onto somebody's radar. Set them after you
import.

## Importing one

```bash
BP_USER=… BP_PASSWORD=… npm run seed -- \
  --from docs/knowledge/sap-landscape.ttl --project <product-id> --merge
```

`--merge` adds and never overwrites, so importing into a product that already
models part of the same landscape leaves your version of a shared element
alone and tells you which ones differed.
