# ADR-0007 — Platform conventions live in an overlay ontology, not in TypeScript

- Status: accepted
- Date: 2026-08-24

## Context

The platform layers conventions on top of ArchiMate that the language has no
opinion about: scheduling dates on Layer 7 elements, Technology Radar rings and
quadrants, and the descriptor terms that give a relationship an identity
(ADR-0005). Each was first written directly into TypeScript — a `RADAR_RINGS`
array here, a `RADAR_ELEMENT_TYPES` list there.

That works until the same convention is needed in a second place. The Blockly
toolbox (WP6), the Open Exchange exporter (WP5) and the MCP tool schemas (WP8)
all need to know that `radarRing` is one of four values, and none of them
should learn it by importing a constant from a React app.

`digitalhome-cloud-core` had already solved this. Its
`schema/tbox/dhc-app-metadata.ttl` annotates classes of a vendored, untouched
Brick / REC / s223 ontology from a separate file — `dhc:designView`,
`dhc:blocklyDisposition`, `sh:in` enumerations, localized labels — and says of
itself: *"This file is NOT part of the domain ontology — it skins the T-Box for
the human user."*

## Decision

Adopt the same split.

- `ontology/upstream/` stays byte-identical to what the ArchiMate ontology
  publishes. Never edited.
- `ontology/overlay/blueprinting-app-metadata.ttl` declares this platform's
  conventions as `owl:AnnotationProperty` terms in the `bp:` namespace, with
  `sh:in` for enumerations and `sh:defaultValue` for defaults, and annotates
  the upstream classes they apply to.
- `scripts/gen-metamodel.mjs` reads both and emits
  `packages/metamodel/src/generated/overlay.ts` alongside the language itself.

## Consequences

A convention is declared once, in the ontology, and every consumer reads it
from the generated metamodel. `packages/core/src/radar.ts` no longer contains
the ring list — it reads `CONVENTIONS.radarRing.values`. A test asserts the two
agree, so adding a ring in TypeScript fails rather than silently diverging.

The generator refuses an overlay that annotates a class the language does not
define, which catches a typo at generation time instead of at runtime. That
guard immediately earned itself: the illustrative example inside the overlay's
own comments was picked up by a naive reader, and the generator's line-anchored
match was what distinguished a real annotation from a commented one.

Localized labels come along for free — the DHC file carries `@de` and `@fr`,
and there is no reason element labels here should not.

**This is also the mechanism for more than one language version.** Nothing in
the overlay currently names a version, which means every version the platform
knows — today only 3.2. When a second has to coexist:

- `ontology/upstream/` gains a directory per version.
- The overlay stays one file. Terms that differ carry `bp:specVersion`; terms
  that do not — most of them, since the radar and scheduling conventions are
  ours rather than the language's — stay untouched.
- The generator emits one metamodel per version.
- A project's `.ttl` records the version it conforms to, so two projects on
  different versions coexist rather than forcing a big-bang migration.

That last part is **designed for, not built**. No second version is pinned and
no code branches on `specVersion` yet. Worth stating plainly: this decision is
what makes the migration cheap when it is needed, and it is not itself the
migration. It is also independent of any particular future version of
ArchiMate — the mechanism is version-agnostic, which matters because the shape
of a future release is not something this repository should assume.

Rejected alternative: editing the upstream ontology in place to add our terms.
It makes re-pinning a merge instead of a swap, and it publishes our private
conventions as though they were part of the language.
