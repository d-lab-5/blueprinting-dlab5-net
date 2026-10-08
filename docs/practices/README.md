# Engineering practices

An ArchiMate model of **how to model** — the body of knowledge the platform
checks against — held in the platform and seeded from
`engineering-practices.ttl`.

```bash
BP_USER=… BP_PASSWORD=… npm run seed -- \
  --project engineering-practices \
  --from docs/practices/engineering-practices.ttl \
  --name "Engineering practices"
```

The Cognito group is made by hand, as for every project. This one is
`bp-engineers` rather than `bp-engineering-practices`: it is read across
projects rather than owned by one, and the name should say so.

## How this differs from `docs/patterns/`

Two libraries, two subjects, and the distinction is worth keeping:

| | Subject | Bar for inclusion |
|---|---|---|
| `docs/patterns/` | how **D-LAB-5 builds software** | two instances in our own repositories |
| `docs/practices/` | how **anyone should model in ArchiMate** | published, and cited |

The patterns library earns entries by evidence we generated. This one earns
them by pointing at an argument someone else already made and defended.

## What the checker uses

Four of these are enforced, in `packages/core/src/practices.ts` and
`validate.ts`:

- prefer the specific relation → `vague-relationship`
- an association hiding a missing element → `association-hides-an-element`
- a derived relation asserted directly → `derived-relationship`
- a party held as a property → `property-shadows-element`

The rest are guidance about the modeller rather than the model — a tool that
offers relations the specification does not, a viewpoint constraining silently
— and no check can catch them. They are here because the library would be
dishonest if it only contained what happens to be automatable.

## Where the entries come from

Most cite a published argument. Two do not: the pair under **what belongs on a
radar** were settled in practice on this platform and are marked as D-LAB-5
practice rather than dressed up with a citation they do not have. A library
that pretends every rule came from a book is less trustworthy, not more.

## Sources, and what may not be copied

Every element carries a `reference` property naming where the argument lives.
Two sources so far:

- **Mastering ArchiMate, 3rd edition** (Gerben Wierda). Chapter 11's beginners'
  pitfalls, §14.6 on labels, §16.2 on the association relation, §16.3 on
  properties.
- **ArchiMate to explain SAP** (Wim Van Hooste, 2020), a published article on
  modelling a packaged system.

> **This repository is public and Mastering ArchiMate is licensed per reader.**
> Every sentence in the model is written from scratch. Nothing quotes it, no
> diagram is reproduced, and the structure of its catalogue is not copied. The
> ideas are cited so a reader can go and read the argument in full — which is
> the only honest way to use a source you cannot republish.
>
> If you extend this library from a licensed source, write the entry yourself
> and cite the section. Do not paste.

## Regenerating

Written by `packages/core`'s Turtle writer, so it is normalised and
byte-stable. Edit it in the platform and export:

```bash
BP_USER=… BP_PASSWORD=… npm run export -- \
  --project engineering-practices \
  --out docs/practices/engineering-practices.ttl
```

It raises no validation warnings and no practice findings against itself —
which is the least it can do, given what it asserts about everyone else.
