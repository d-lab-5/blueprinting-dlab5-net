# ArchiMate ontology

The semantic backbone of the platform: the ArchiMate 3.2 metamodel as OWL, plus
the machine-readable relationship matrix.

## What is here

| File | What it is |
|---|---|
| `upstream/archimate.ttl` | The OWL ontology — 61 element classes and 11 relationship classes, each carrying `rdfs:label`, `rdfs:comment` and its layer via `rdfs:subClassOf archimate:<Layer>`. |
| `upstream/relationships.xml` | Appendix B of the specification as data: for every ordered pair of element types, which relationships are permitted, with **UPPERCASE = direct** and **lowercase = derived**. |
| `upstream/LICENSE` | Apache-2.0. |
| `upstream/.pinned-commit` | The upstream commit this copy was taken from. |

## Why it is vendored rather than a submodule

`packages/metamodel` is **generated** from these files by
`scripts/gen-metamodel.mjs`, and the generated TypeScript is committed. Amplify
Hosting therefore needs neither these files nor an RDF toolchain at build time,
and a build can never drift because upstream moved. Vendoring a pinned copy
also keeps the provenance visible in the diff, which a submodule pointer does
not.

## Re-pinning

```bash
node scripts/update-ontology.mjs        # fetches HEAD, rewrites .pinned-commit
npm run gen:metamodel                   # regenerate
npm test -w @dlab5/archimate-metamodel  # the matrix assertions must still hold
git diff packages/metamodel/src/generated   # review what the upgrade changed
```

Treat a change to the generated matrix as a semantic change, not a dependency
bump: it can make a previously valid model invalid.

## Not vendored (yet)

The upstream `validation/` SHACL shapes and `derivation/` rule files. The
shapes use RDF-Star for relationship metadata, which the JavaScript SHACL
engines handle poorly. The relationship matrix plus zod schemas cover the
common modelling errors at no cost; full SHACL validation is deferred until the
models are large enough to need it.
