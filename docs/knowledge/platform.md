# The D-LAB-5 platform, as a model

`scripts/gen-platform-model.mjs` reads the machine it runs on and writes an
ArchiMate 3.2 model of the platform: the workstation, the software installed on
it, the path a change takes from an editor to a deployed site, and the AWS
services it lands on.

```bash
BP_USER=… BP_PASSWORD=… node scripts/gen-platform-model.mjs \
  --out /tmp/platform.ttl --slug <product-id>
```

## Why the platform is its own product

`blueprinting.dlab5.net` is a **product ON the platform**, not part of it. The
platform is the pipeline; the product is one thing that travels it. Modelling
them together would say the pipeline exists to serve this one product, which is
the opposite of what a platform is.

So the model states that relationship explicitly: a `Product` composed of the
`ApplicationService` it offers, sitting in its own grouping beside — never
inside — the pipeline that carries it.

## Read, not written

Versions drift. `~/pc-configurations` recorded Node 22.22.2 while 22.23.2 was
installed, and a hand-written model would have recorded whichever the author
last looked at. The generator asks the machine.

It also reads `~/pc-configurations/devices/DLAB5-W541-01/config.yaml`, which is
already a deliberately public file — "no sensitive data (serials, MACs,
credentials)" — for the hardware facts a running command cannot give.

## Why the output is not committed

It names a workstation, an operator and an AWS region. CLAUDE.md forbids real
names, emails and hostnames in seed models here, and this repository is public.
The **generator** is committed; what it produces goes to S3 behind the
product's own Cognito group, exactly as the SAP ECC estate does.

`--anonymous` replaces the operator with a role, for a model shown to somebody
else.

## What the metamodel refused

Three relationships that seemed natural are not permitted, and each refusal
improved the model:

- `TechnologyProcess -realization-> Product` — a pipeline does not *realize* a
  product. It serves it.
- `ApplicationComponent -realization-> Product` — ArchiMate composes a Product
  from the **ApplicationService** it offers; the component realizes the
  service, not the product.
- `BusinessRole -assignment-> TechnologyProcess` — a role is assigned to a
  business process, not a technology one.

The pipeline stages are therefore all `TechnologyProcess`, chained by
`triggering`, which is direct. Modelling the human ones as `BusinessProcess`
would have needed a triggering relationship ArchiMate marks derived, for no
gain in truth.

The generator asks `isAllowed` before adding any relationship and throws if the
answer is no, so this cannot drift.
