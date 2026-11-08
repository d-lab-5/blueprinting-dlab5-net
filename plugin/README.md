# dlab5-cloud-edge-blueprint

Designing a new D-LAB-5 product as a cloud, edges, or both, from the ArchiMate blueprint `docs/patterns/cloud-edge-platform.ttl` in this repository. It lives here because the blueprint does.

**Install** from the D-LAB-5 catalogue:

```
/plugin marketplace add d-lab-5/agent-skills
/plugin install dlab5-cloud-edge-blueprint@d-lab-5
```

**Change a skill** here, in its one home. Then bump `version` in
`.claude-plugin/plugin.json`, or installed copies never see the change. Try a
working copy with `claude --plugin-dir plugin`. Never copy this skill into
another repository: point to it instead.
