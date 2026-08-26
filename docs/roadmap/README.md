# The platform's own roadmap

`platform-roadmap.ttl` is the current state of the plan, exported from the
tool. It is the record, not the source: the source is the model in the
platform, and this file is what makes it reviewable in a pull request.

Refresh it after planning:

```bash
BP_USER=… BP_PASSWORD=… npm run export -- \
  --project <slug> --out docs/roadmap/platform-roadmap.ttl
```

`packages/core/src/seed/platform-roadmap.ts` is a different thing: the
*bootstrap* seed, used to give a brand-new project something to start from and
as a fixture for tests. Once a project is live, the tool holds the truth and
this export is the record of it. Expect the two to diverge — that is the
correct behaviour, not drift to be fixed.
