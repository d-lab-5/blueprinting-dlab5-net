# Knowledge seeds

ArchiMate models of things that exist outside this platform: technology
landscapes, vendor product families, reference structures. They are seeds, not
truth — you import one into a product and then own what you imported.

They differ from `docs/practices/` (how to model well) and `docs/patterns/`
(shapes this project proved). This directory answers "what is out there".

## The licence boundary, which is load-bearing

`sap-landscape.ttl` was written **from** the SAP skills at
[sap-ai-skills.com](https://sap-ai-skills.com), maintained by Eduard Jiglau.

**Those skills are GPL-3.0. This repository is MIT and public.** GPL-3.0 is
copyleft and MIT is not compatible in that direction, so none of them is in
this repository and none ever will be — not the files, not excerpts, and not
paraphrases close enough to be derivative.

What is here is the other thing: **which SAP products exist and how they relate
is fact, and facts are not copyrightable.** The expression is his; the
landscape is not. Every element cites the skill it was learned from by name, in
a `reference` property, the way `docs/practices/engineering-practices.ttl`
cites a licensed book it likewise never reproduces.

To use the skills themselves, run `scripts/link-sap-skills.sh`. It creates
symlinks under `.claude/skills/`, which is gitignored. Using software triggers
no obligation; distributing it triggers all of them.

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
