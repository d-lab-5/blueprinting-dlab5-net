# ADR-0008 — ArchiMate 4 is a metamodel restructuring, not a version bump

- Status: accepted (findings); the migration itself is not started
- Date: 2026-08-24

## Context

The ArchiMate 4 Specification (The Open Group, April 2026, 203 pages) was
reviewed to work out what supporting it would mean. ADR-0007 had assumed a
future version would mostly add and rename element types, with the overlay
absorbing the difference.

That assumption is wrong, and it is worth recording why before anyone plans
around it.

## Findings

**Layers become domains, and a Common Domain is added.** The chapter structure
is Common, Motivation, Strategy, Business, Application, Technology,
Implementation & Migration.

**The per-domain behaviour triplets are gone.** 3.2 repeats Service, Process,
Function, Event, Role, Collaboration and Interaction once per layer —
`BusinessProcess`, `ApplicationProcess`, `TechnologyProcess`. In 4 these are
factored out into the Common Domain as a single generic `Process`, `Service`,
`Function`, `Event`, `Role`, `Collaboration` and `Path`. What remains
domain-specific is only the structure:

| Domain | Elements in 4 |
|---|---|
| Business | Business Actor, Business Interface, Business Object, Product |
| Application | Application Component, Application Interface, Data Object |
| Technology | Node, Technology Interface, Device, System Software, Equipment, Facility, Communication Network, … |

**Physical is folded into Technology.** Equipment and Facility appear under the
Technology Domain rather than a Physical Layer of their own.

**Grouping and Location move into the Common Domain**, which is a better home
than 3.2's "composite elements that fit no single layer".

**Implementation & Migration shrinks** to Work Package, Deliverable and
Plateau. Gap and Implementation Event do not appear among its element
sections — Implementation Event is presumably subsumed by the Common `Event`.
Stated as an observation of the chapter structure; the body text was not
confirmed, and this one matters most to us because the Layer 7 roadmap uses
both.

## Decision

Adopt ArchiMate 4's **word** now and nothing else. Element groupings are
labelled "domain" rather than "layer", and 3.2's composite pair is labelled
Common, since the two schemes line up one-for-one for everything 3.2 has. The
identifiers keep their 3.2 names; renaming them would be churn with no reader
benefit.

Do **not** attempt to support ArchiMate 4 yet.

### Amendment, same day: Implementation & Migration stays as 3.2 has it

Gap and Implementation Event are kept, and the roadmap keeps using them, even
though they appear to be absent from ArchiMate 4.

Implementation & Migration is peripheral to the language — it is the schedule
around an architecture rather than part of it — and it is where this platform
does its most concrete work. Dropping Gap to pre-empt a migration would remove
a modelling concept that is doing real work today in exchange for a saving in
a migration nobody can yet plan. When 4 becomes supportable, a Gap maps to an
annotation or a Common element and the answer will be obvious with the
specification's own migration guidance in hand.

## Consequences

Two things block it, and neither is effort:

1. **There is no machine-readable ArchiMate 4 source.** The whole metamodel is
   generated (ADR-0004) from an OWL ontology plus Appendix B as XML. The
   ontology we pin covers 3.2 only. Deriving 60-odd element types and a
   relationship matrix by hand from a PDF would produce exactly the
   error-prone transcription that ADR-0004 exists to avoid.
2. **The copy we have is an evaluation copy marked not for redistribution.**
   Nothing derived from it can be committed to a public repository. Element
   type names are terminology and safe to use; the specification's own content
   is not ours to vendor.

The path forward is to wait for a published ArchiMate 4 ontology or an official
machine-readable exchange schema, then pin it alongside 3.2 exactly as
ADR-0007 describes.

**ADR-0007's mechanism still holds, and is worth more than it looked.** Because
a model is stamped with `bp:languageVersion` and the conventions live in an
overlay rather than in TypeScript, a 3.2 model stays readable and exportable as
3.2 after 4 arrives. What ADR-0007 does *not* solve is the model-level
migration: turning a `BusinessProcess` into a Common `Process` is a content
change to every affected model, and how a 4 model expresses "this process is a
business one" — by assignment, by nesting, by specialization — is a question
this ADR does not answer.

That is the real reason to keep version stamping strict. Coexistence is
achievable; silent reinterpretation is not.
