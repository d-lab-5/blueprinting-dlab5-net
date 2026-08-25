import { test } from "node:test";
import assert from "node:assert/strict";

import {
  PLATFORM_ROADMAP,
  derivePlateauDates,
  isoDate,
  toScheduleGraph,
} from "../dist/index.js";

const el = (id, type, properties = {}) => ({ id, type, name: id, properties });
const rel = (id, type, source, target) => ({ id, type, source, target, properties: {} });
const model = (elements, relationships = []) => ({
  projectSlug: "t",
  elements,
  relationships,
});

test("isoDate accepts a well-formed date and rejects anything else", () => {
  assert.equal(isoDate("2026-08-24"), "2026-08-24");
  assert.equal(isoDate("24/08/2026"), undefined);
  assert.equal(isoDate("2026-8-4"), undefined);
  assert.equal(isoDate(""), undefined);
  assert.equal(isoDate(undefined), undefined);
});

test("a work package realising a plateau directly is attributed to it", () => {
  const { plateauOf } = toScheduleGraph(
    model(
      [el("wp", "WorkPackage"), el("p", "Plateau")],
      [rel("r", "realization", "wp", "p")]
    )
  );
  assert.equal(plateauOf.get("wp"), "p");
});

test("a work package realising a deliverable inherits that deliverable's plateau", () => {
  const { plateauOf } = toScheduleGraph(
    model(
      [el("wp", "WorkPackage"), el("d", "Deliverable"), el("p", "Plateau")],
      [rel("r1", "realization", "wp", "d"), rel("r2", "realization", "d", "p")]
    )
  );
  assert.equal(plateauOf.get("wp"), "p", "WP -> Deliverable -> Plateau");
});

test("a plateau's end is the latest end among the work realising it", () => {
  const dates = derivePlateauDates(
    model(
      [
        el("a", "WorkPackage", { startDate: "2026-01-05", endDate: "2026-01-10" }),
        el("b", "WorkPackage", { startDate: "2026-01-02", endDate: "2026-01-20" }),
        el("p", "Plateau"),
      ],
      [rel("r1", "realization", "a", "p"), rel("r2", "realization", "b", "p")]
    )
  );
  assert.deepEqual(dates.get("p"), {
    start: "2026-01-02",
    end: "2026-01-20",
    from: 2,
  });
});

test("a work package with only a start still contributes, without looking finished", () => {
  const dates = derivePlateauDates(
    model(
      [el("a", "WorkPackage", { startDate: "2026-03-01" }), el("p", "Plateau")],
      [rel("r", "realization", "a", "p")]
    )
  );
  // The plateau cannot be reached before the work begins, so the start counts;
  // the end falls back to it rather than being invented.
  assert.deepEqual(dates.get("p"), { start: "2026-03-01", end: "2026-03-01", from: 1 });
});

test("a plateau with nothing scheduled reports no date rather than a wrong one", () => {
  const dates = derivePlateauDates(
    model([el("wp", "WorkPackage"), el("p", "Plateau")], [rel("r", "realization", "wp", "p")])
  );
  assert.deepEqual(dates.get("p"), { from: 0 });
});

test("a plateau nothing realises is still listed, as unscheduled", () => {
  const dates = derivePlateauDates(model([el("p", "Plateau")]));
  assert.deepEqual(dates.get("p"), { from: 0 });
});

test("a malformed date is ignored rather than propagated", () => {
  const dates = derivePlateauDates(
    model(
      [
        el("a", "WorkPackage", { startDate: "soon", endDate: "later" }),
        el("b", "WorkPackage", { startDate: "2026-05-01", endDate: "2026-05-09" }),
        el("p", "Plateau"),
      ],
      [rel("r1", "realization", "a", "p"), rel("r2", "realization", "b", "p")]
    )
  );
  assert.deepEqual(dates.get("p"), { start: "2026-05-01", end: "2026-05-09", from: 1 });
});

test("sub-packages are linked to their parent by composition and aggregation", () => {
  const { parentOf } = toScheduleGraph(
    model(
      [el("wp6", "WorkPackage"), el("wp61", "WorkPackage"), el("wp62", "WorkPackage")],
      [
        rel("r1", "composition", "wp6", "wp61"),
        rel("r2", "aggregation", "wp6", "wp62"),
      ]
    )
  );
  assert.equal(parentOf.get("wp61"), "wp6");
  assert.equal(parentOf.get("wp62"), "wp6");
});

test("only the first trigger of an element is kept", () => {
  const { predecessorOf } = toScheduleGraph(
    model(
      [el("a", "WorkPackage"), el("b", "WorkPackage"), el("c", "WorkPackage")],
      [rel("r1", "triggering", "a", "c"), rel("r2", "triggering", "b", "c")]
    )
  );
  assert.equal(predecessorOf.get("c"), "a", "a fan-in collapses to one antecedent");
});

test("the platform's own roadmap derives a date for every plateau it schedules", () => {
  const dates = derivePlateauDates(PLATFORM_ROADMAP);
  // P0 is the empty repo: nothing realises it, so it has no date. The rest do.
  const scheduled = [...dates.values()].filter((d) => d.from > 0);
  assert.ok(scheduled.length >= 3, `expected 3+ scheduled plateaus, got ${scheduled.length}`);
  for (const d of scheduled) {
    assert.ok(d.start && d.end, "a scheduled plateau needs both ends");
    assert.ok(d.start <= d.end, "a plateau cannot end before it starts");
  }
});
