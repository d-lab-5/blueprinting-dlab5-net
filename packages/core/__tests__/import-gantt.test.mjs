import { test } from "node:test";
import assert from "node:assert/strict";

import {
  PLATFORM_ROADMAP,
  fromMermaidGantt,
  toMermaidGantt,
  validateModel,
} from "../dist/index.js";

const SAMPLE = `gantt
    title A plan
    dateFormat YYYY-MM-DD
    axisFormat %d %b
    %% a comment
    section Foundations
    Lay the slab :done, t1, 2026-01-01, 2026-01-10
    Slab cured :milestone, m1, 2026-01-10, 0d
    section Walls
    Raise the walls :active, t2, after t1, 20d
    Fit the roof :t3, 2026-02-01, 2026-02-20
`;

test("a section becomes a Plateau", () => {
  const { model, sections } = fromMermaidGantt(SAMPLE, "build");
  assert.equal(sections, 2);
  const plateaus = model.elements.filter((e) => e.type === "Plateau");
  assert.deepEqual(plateaus.map((p) => p.name), ["Foundations", "Walls"]);
});

test("a task becomes a WorkPackage carrying its dates and status", () => {
  const { model, tasks } = fromMermaidGantt(SAMPLE, "build");
  assert.equal(tasks, 3);
  const slab = model.elements.find((e) => e.name === "Lay the slab");
  assert.equal(slab.type, "WorkPackage");
  assert.deepEqual(slab.properties, {
    startDate: "2026-01-01",
    endDate: "2026-01-10",
    status: "done",
  });
});

test("mermaid's tags map onto the overlay's status vocabulary", () => {
  const { model } = fromMermaidGantt(SAMPLE, "build");
  const walls = model.elements.find((e) => e.name === "Raise the walls");
  assert.equal(walls.properties.status, "in-progress", "active is in-progress");
});

test("a milestone becomes an ImplementationEvent with no end date", () => {
  const { model, milestones } = fromMermaidGantt(SAMPLE, "build");
  assert.equal(milestones, 1);
  const cured = model.elements.find((e) => e.name === "Slab cured");
  assert.equal(cured.type, "ImplementationEvent");
  assert.equal(cured.properties.startDate, "2026-01-10");
  assert.ok(!("endDate" in cured.properties), "a moment has no duration");
});

test("a work package is attached to the plateau of the section it sits in", () => {
  const { model } = fromMermaidGantt(SAMPLE, "build");
  const walls = model.elements.find((e) => e.name === "Raise the walls");
  const plateau = model.elements.find((e) => e.name === "Walls");
  assert.ok(
    model.relationships.some(
      (r) => r.type === "realization" && r.source === walls.id && r.target === plateau.id
    )
  );
});

test("`after` becomes a triggering relationship", () => {
  const { model } = fromMermaidGantt(SAMPLE, "build");
  const slab = model.elements.find((e) => e.name === "Lay the slab");
  const walls = model.elements.find((e) => e.name === "Raise the walls");
  assert.ok(
    model.relationships.some(
      (r) => r.type === "triggering" && r.source === slab.id && r.target === walls.id
    )
  );
});

test("`after` naming an unknown task is dropped rather than dangling", () => {
  const { model } = fromMermaidGantt(
    "gantt\n  section S\n  A task :t1, after nothing, 2d\n",
    "p"
  );
  assert.deepEqual(model.relationships.filter((r) => r.type === "triggering"), []);
});

test("directives and comments are ignored, not reported as unreadable", () => {
  const { skipped } = fromMermaidGantt(SAMPLE, "build");
  assert.deepEqual(skipped, []);
});

test("a line that cannot be read is reported with its number", () => {
  const { skipped } = fromMermaidGantt(
    "gantt\n  section S\n  this line has no colon\n",
    "p"
  );
  assert.equal(skipped.length, 1);
  assert.equal(skipped[0].line, 3);
});

test("the imported model is structurally valid", () => {
  const { model } = fromMermaidGantt(SAMPLE, "build");
  const errors = validateModel(model).filter((f) => f.severity === "error");
  assert.deepEqual(errors, [], JSON.stringify(errors));
});

test("importing our own Gantt keeps every work package and milestone", () => {
  const chart = toMermaidGantt(PLATFORM_ROADMAP, { title: "roundtrip" });
  const { model } = fromMermaidGantt(chart, "roundtrip");

  const count = (m, type) => m.elements.filter((e) => e.type === type).length;

  assert.equal(
    count(model, "WorkPackage"),
    count(PLATFORM_ROADMAP, "WorkPackage"),
    "every work package survives"
  );
  assert.equal(
    count(model, "ImplementationEvent"),
    count(PLATFORM_ROADMAP, "ImplementationEvent"),
    "every milestone survives"
  );
});

test("importing our own Gantt LOSES deliverables and gaps, as documented", () => {
  // Not a defect — the assertion exists so the loss stays deliberate. If a
  // later change made the import appear lossless, that would be the thing to
  // distrust: a Mermaid chart does not contain these.
  const chart = toMermaidGantt(PLATFORM_ROADMAP, { title: "roundtrip" });
  const { model } = fromMermaidGantt(chart, "roundtrip");

  assert.ok(
    PLATFORM_ROADMAP.elements.some((e) => e.type === "Deliverable"),
    "the source has deliverables to lose"
  );
  assert.equal(
    model.elements.filter((e) => e.type === "Deliverable").length,
    0,
    "Mermaid cannot express a Deliverable"
  );
  assert.equal(
    model.elements.filter((e) => e.type === "Gap").length,
    0,
    "nor a Gap"
  );
});

test("an empty or non-gantt input yields an empty model rather than throwing", () => {
  const { model, sections, tasks } = fromMermaidGantt("", "p");
  assert.deepEqual(model.elements, []);
  assert.equal(sections + tasks, 0);
});

test("two tasks with the same label get distinct ids", () => {
  const { model } = fromMermaidGantt(
    "gantt\n  section S\n  Review :a, 2026-01-01, 1d\n  Review :b, 2026-02-01, 1d\n",
    "p"
  );
  const ids = model.elements.filter((e) => e.name === "Review").map((e) => e.id);
  assert.equal(ids.length, 2);
  assert.equal(new Set(ids).size, 2, "ids must not collide");
});
