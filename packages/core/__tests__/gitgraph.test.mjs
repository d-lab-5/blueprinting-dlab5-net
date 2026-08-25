import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

import {
  PLATFORM_ROADMAP,
  emptyModel,
  toMermaidGitgraph,
} from "../dist/index.js";

/**
 * Same harness as the Gantt tests: the generated diagram goes through the real
 * Mermaid parser. Asserting on the string we just built proves only that the
 * code does what it does — Mermaid's gitGraph has rules that are not obvious
 * and are not in its documentation, and this is what finds them.
 */
const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  pretendToBeVisual: true,
});
globalThis.window = dom.window;
globalThis.document = dom.window.document;
Object.defineProperty(globalThis, "navigator", {
  value: dom.window.navigator,
  configurable: true,
});
const mermaid = (await import("mermaid")).default;
mermaid.initialize({ startOnLoad: false });

const parses = async (src) => {
  try {
    await mermaid.parse(src);
    return null;
  } catch (err) {
    return err.message ?? String(err);
  }
};

const el = (id, type, name, properties = {}) => ({ id, type, name, properties });
const rel = (id, type, source, target) => ({ id, type, source, target, properties: {} });
const model = (elements, relationships = []) => ({
  projectSlug: "t",
  elements,
  relationships,
});

/** One plateau realised by one work package, which triggers one event. */
const simple = model(
  [
    el("p1", "Plateau", "P1 Authenticated Shell"),
    el("wp1", "WorkPackage", "WP1 Foundation", {
      startDate: "2026-01-01",
      endDate: "2026-01-10",
    }),
    el("ev", "ImplementationEvent", "stage builds green"),
  ],
  [
    rel("r1", "realization", "wp1", "p1"),
    rel("r2", "triggering", "wp1", "ev"),
  ]
);

test("mermaid accepts the platform's own roadmap as a git graph", async () => {
  const error = await parses(toMermaidGitgraph(PLATFORM_ROADMAP));
  assert.equal(error, null, `mermaid rejected the diagram:\n${error}`);
});

test("mermaid accepts an empty model", async () => {
  const error = await parses(toMermaidGitgraph(emptyModel("t")));
  assert.equal(error, null, `mermaid rejected the diagram:\n${error}`);
});

test("a plateau becomes a highlighted commit on main, tagged with its date", () => {
  const out = toMermaidGitgraph(simple);
  assert.match(out, /commit id: "P1 Authenticated Shell" type: HIGHLIGHT tag: "2026-01-10"/);
});

test("a plateau with no scheduled work carries no date tag", () => {
  const out = toMermaidGitgraph(
    model([el("p1", "Plateau", "P0 Empty Repo")])
  );
  assert.match(out, /commit id: "P0 Empty Repo" type: HIGHLIGHT\n/);
});

test("a work package becomes a branch that is committed to and merged back", () => {
  const out = toMermaidGitgraph(simple);
  const lines = out.split("\n").map((l) => l.trim());
  const branch = lines.findIndex((l) => l.startsWith("branch "));
  assert.ok(branch > -1, "expected a branch");
  assert.equal(lines[branch + 1], `checkout ${lines[branch].slice(7)}`);
  assert.equal(lines[branch + 2], 'commit id: "WP1 Foundation"');
  assert.equal(lines[branch + 3], "checkout main");
  assert.match(lines[branch + 4], /^merge /);
});

test("a branch always has a commit before it is merged", async () => {
  // Mermaid rejects a merge whose two branches share a head with
  // "Both branches have same head". Emitting `branch` then `merge` with
  // nothing between is the natural mistake, and it does not parse.
  const out = toMermaidGitgraph(simple);
  const lines = out.split("\n").map((l) => l.trim());
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].startsWith("branch ")) continue;
    const name = lines[i].slice(7);
    const merge = lines.findIndex((l, j) => j > i && l === `merge ${name}`);
    if (merge === -1) continue;
    const between = lines.slice(i + 1, merge);
    assert.ok(
      between.some((l) => l.startsWith("commit ")),
      `branch ${name} is merged with no commit of its own`
    );
  }
  assert.equal(await parses(out), null);
});

test("the event a work package triggers becomes the tag on its merge", () => {
  const out = toMermaidGitgraph(simple);
  assert.match(out, /merge "[^"]+" tag: "stage builds green"/);
});

test("an event nothing triggers becomes a plain commit, not a tag", () => {
  const out = toMermaidGitgraph(
    model([el("ev", "ImplementationEvent", "first model stored"),
           el("p", "Plateau", "P1")])
  );
  assert.match(out, /commit id: "first model stored"\n/);
  assert.doesNotMatch(out, /tag: "first model stored"/);
});

test("work with no plateau is branched but never merged", () => {
  const out = toMermaidGitgraph(
    model([
      el("p1", "Plateau", "P1"),
      el("loose", "WorkPackage", "WP unplaced"),
    ])
  );
  assert.match(out, /commit id: "WP unplaced"/);
  const lines = out.split("\n").map((l) => l.trim());
  const branch = lines.find((l) => l.startsWith("branch "));
  assert.ok(branch, "expected a branch for the unplaced work");
  assert.ok(
    !lines.includes(`merge ${branch.slice(7)}`),
    "unplaced work has not landed, so it must not be merged onto main"
  );
});

test("branch names are unique, which mermaid requires", async () => {
  // Two work packages whose ids sanitise to the same token would otherwise
  // collide, and mermaid refuses to create an existing branch.
  const out = toMermaidGitgraph(
    model(
      [
        el("p", "Plateau", "P"),
        el("wp a", "WorkPackage", "A"),
        el("wp-a", "WorkPackage", "B"),
        el("wp/a", "WorkPackage", "C"),
      ],
      [
        rel("r1", "realization", "wp a", "p"),
        rel("r2", "realization", "wp-a", "p"),
        rel("r3", "realization", "wp/a", "p"),
      ]
    )
  );
  const names = out
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("branch "))
    .map((l) => l.slice(7));
  assert.equal(names.length, 3);
  assert.equal(new Set(names).size, 3, `collided: ${names.join(", ")}`);
  assert.equal(await parses(out), null);
});

test("a work package called main does not redefine the trunk", () => {
  const out = toMermaidGitgraph(
    model(
      [el("p", "Plateau", "P"), el("main", "WorkPackage", "Main line")],
      [rel("r", "realization", "main", "p")]
    )
  );
  assert.doesNotMatch(out, /^\s*branch main$/m);
});

test("plateaus come out in the order they are reached", () => {
  const out = toMermaidGitgraph(
    model(
      [
        el("late", "Plateau", "Later"),
        el("early", "Plateau", "Earlier"),
        el("w1", "WorkPackage", "W1", { startDate: "2026-03-01", endDate: "2026-03-05" }),
        el("w2", "WorkPackage", "W2", { startDate: "2026-01-01", endDate: "2026-01-05" }),
      ],
      [
        rel("r1", "realization", "w1", "late"),
        rel("r2", "realization", "w2", "early"),
      ]
    )
  );
  assert.ok(
    out.indexOf('id: "Earlier"') < out.indexOf('id: "Later"'),
    "the plateau reached first must come first"
  );
});

test("a name containing a quote is escaped rather than breaking the syntax", async () => {
  const out = toMermaidGitgraph(
    model([el("p", "Plateau", 'The "final" state')])
  );
  assert.match(out, /commit id: "The \\"final\\" state"/);
  assert.equal(await parses(out), null);
});

test("the diagram is deterministic", () => {
  assert.equal(toMermaidGitgraph(simple), toMermaidGitgraph(simple));
});

test("a root commit is drawn only when the model supplies no starting state", () => {
  // First plateau realised by work: main would otherwise open with a merge
  // onto an empty trunk, which mermaid refuses.
  const needsRoot = toMermaidGitgraph(simple);
  assert.match(needsRoot, /commit id: "Initial state"/);

  // First plateau realised by nothing: its own commit roots the graph, so
  // inventing one would put a node on the canvas that is not in the model.
  const suppliesRoot = toMermaidGitgraph(
    model(
      [
        el("p0", "Plateau", "P0 Empty Repo"),
        el("p1", "Plateau", "P1 Shell"),
        el("wp", "WorkPackage", "WP1", { startDate: "2026-02-01", endDate: "2026-02-09" }),
      ],
      [rel("r", "realization", "wp", "p1")]
    )
  );
  assert.doesNotMatch(suppliesRoot, /Initial state/);
  assert.ok(
    suppliesRoot.indexOf('id: "P0 Empty Repo"') < suppliesRoot.indexOf("branch "),
    "the model's own first plateau must root the graph"
  );
});

test("the root label can be replaced without touching the generator", () => {
  const out = toMermaidGitgraph(simple, { rootLabel: "Greenfield" });
  assert.match(out, /commit id: "Greenfield"/);
  assert.doesNotMatch(out, /Initial state/);
});

test("a branch is labelled with the work package's name, not its id", () => {
  const out = toMermaidGitgraph(
    model(
      [
        el("p", "Plateau", "P"),
        el("wp6-4-embed-the-editor-in-the-app", "WorkPackage", "WP6.4 Embed the editor"),
      ],
      [rel("r", "realization", "wp6-4-embed-the-editor-in-the-app", "p")]
    )
  );
  assert.match(out, /branch "WP6\.4 Embed the editor"/);
  assert.doesNotMatch(out, /wp6-4-embed/, "the id must not show through into the picture");
});

test("the commit on a branch names what the work produced", () => {
  const out = toMermaidGitgraph(
    model(
      [
        el("p", "Plateau", "P"),
        el("wp", "WorkPackage", "WP3 Turtle ABox store"),
        el("d", "Deliverable", "Model store with ETag-guarded writes"),
      ],
      [rel("r1", "realization", "wp", "d"), rel("r2", "realization", "d", "p")]
    )
  );
  assert.match(out, /branch "WP3 Turtle ABox store"/);
  assert.match(out, /commit id: "Model store with ETag-guarded writes"/);
});

test("a work package with two deliverables falls back to its own name", () => {
  // Naming one of them would be picking arbitrarily, which is worse than
  // saying less.
  const out = toMermaidGitgraph(
    model(
      [
        el("p", "Plateau", "P"),
        el("wp", "WorkPackage", "WP7 Two things"),
        el("d1", "Deliverable", "First"),
        el("d2", "Deliverable", "Second"),
      ],
      [
        rel("r1", "realization", "wp", "d1"),
        rel("r2", "realization", "wp", "d2"),
        rel("r3", "realization", "d1", "p"),
      ]
    )
  );
  assert.match(out, /commit id: "WP7 Two things"/);
});

test("two work packages with the same name get distinct branches", async () => {
  const out = toMermaidGitgraph(
    model(
      [
        el("p", "Plateau", "P"),
        el("a", "WorkPackage", "Review"),
        el("b", "WorkPackage", "Review"),
      ],
      [rel("r1", "realization", "a", "p"), rel("r2", "realization", "b", "p")]
    )
  );
  const names = out
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("branch "))
    .map((l) => l.slice(7));
  assert.equal(new Set(names).size, 2, `collided: ${names.join(", ")}`);
  assert.equal(await parses(out), null);
});
