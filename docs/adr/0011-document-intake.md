# ADR-0011 — Documents are annotated in place, and held as records

- Status: accepted
- Date: 2026-08-27

## Context

Information about a product does not arrive as ArchiMate. It arrives as a
report, a plan of record, a decision log — prose that *mentions* an
architecture. Until now the only route from one into the model was to retype it.

`fromMermaidGantt` is the precedent, and its framing carries over: an on-ramp
for someone who already has a chart, not a round-trip. A report carries
motivation and process, not a model, so intake is one-way and lossy on purpose.

Two things made this more than a parser.

**Some documents cannot live in a repository.** A real example set arrived with
a README saying the folder is never committed anywhere and that nothing in it
should be copied into a public repo — commercial terms, supplier relationships,
pricing. Those need somewhere that is neither a public repo nor a laptop.

**A second reading of a revised document is the hard part.** Reading a document
once is easy. Deciding what it means when the same document comes back changed
is not, and getting it wrong silently destroys work.

## Decision

**Annotations are inline HTML comments.**

```markdown
<!-- am element type=Stakeholder id=cfo -->
## Chief Financial Officer
Wants cost per transaction below EUR 0.02 by Q3.

<!-- am rel type=influence from=cfo to=cost-per-txn -->
```

Not front-matter and not a sidecar, because every sidecar needs a key into the
document — heading slug, line number, path — and every one of those breaks the
moment somebody edits a heading, which is most of what revising a report
consists of. A comment sits where the thing is. It is invisible to every
renderer, so the document still reads and prints as itself.

**Ids are supplied, never generated.** `id=` is what makes a second import
update an element rather than create a twin, so an annotation without one is
refused rather than guessed at. Relationships need no id: theirs is derived
from their endpoints, matching the scheme already used across the codebase.

**The metamodel is asked, never second-guessed.** `type=` goes through
`isElementType`, `rel` through `isAllowed`. This caught a relationship the
author of this ADR proposed and ArchiMate forbids, before it reached a model.

**Two files per document.** `source.md` is exactly what was uploaded and is
never rewritten — that is what makes it a record. `annotated.md` is the working
copy. Same authoritative-plus-derived split as the transfer bundle.

**Classification decides where a document may go**, and the axis is destination
rather than sensitivity:

|  | in a bundle | safe in a public repo |
|---|---|---|
| `confidential` | no | no |
| `collaboration` | yes | no |
| `shared` | yes | yes |

The middle tier is easy to omit and expensive to lack: sprint notes must travel
with the product between environments and must never reach a public page, and
no two-valued field says both. **The default is confidential**, because sharing
is a decision someone makes and not-sharing is what happens when nobody does.

**Credentials are refused, not warned about.** A document whose text matches a
credential shape is rejected outright. A warning gets clicked through, and a
token in a document would be copied into an element's documentation, exported,
and read by everyone the product is shared with.

## Consequences

**Update is a plan, not an action.** Three cases, and only two are easy: create,
unchanged, and "the document and the model disagree". The third cannot be
settled by a rule, so it is reported per element and a person chooses.
`GanttImport`'s collision-renaming must never be reused here — it is right for
adding a chart and catastrophic for a document, where it would create a second
CFO on every import.

**Properties are merged on update, never replaced.** An element may carry a
radar ring, an owner or a debt score the document knows nothing about, and an
import that dropped them would quietly empty the radar.

**Nothing is ever deleted by an import.** An element gone from a revised
document may have been cut for length or moved elsewhere. Orphans are reported,
found by the `sourceDocument` property every imported element carries.

**A type change is refused rather than offered.** It is a different element
wearing the same id, and applying it would silently invalidate every
relationship the old one takes part in.

**Most of a document should not be modelled.** Anything unannotated is ignored,
and that is the common case: of twelve real documents examined, roughly half
were glossaries, open questions or working notes that would only have filled
the model with vocabulary. Intake's value is partly in what it declines.

**Rendering is a security boundary.** Documents are pasted in from elsewhere and
render for everyone in a product's group. Markdown becomes HTML by stripping
annotations, escaping what remains, and only then converting — in that order —
and link hrefs go through a protocol allow-list, because marked does not
sanitize URLs and `[click](javascript:…)` otherwise produces a live anchor.
