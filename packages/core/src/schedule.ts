import type { AbModel } from "./types.js";

/**
 * Reading a schedule out of an Implementation & Migration model.
 *
 * ArchiMate has no schedule fields, so a roadmap is derived from the graph the
 * specification does give: which work brings about which state, and what
 * triggers what. That derivation used to live inside the Gantt generator,
 * where nothing else could reach it. The editor needs the same answers — a
 * plateau has to show the date it is reached — and two implementations of one
 * rule is how they come to disagree.
 *
 * **A plateau stores no date.** A plateau is a state, and a state is reached
 * when the work bringing it about finishes. Storing that separately only
 * creates something that can contradict the work packages underneath it, and
 * the contradiction is silent. So it is computed, and the editor shows it
 * read-only.
 */

/** An ISO date, or undefined if the value is missing or malformed. */
export function isoDate(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : undefined;
}

export interface ScheduleGraph {
  /** WorkPackage id -> the Plateau it brings about. */
  plateauOf: Map<string, string>;
  /** Element id -> the id of the element that triggers it. */
  predecessorOf: Map<string, string>;
  /** Child WorkPackage id -> parent, from composition and aggregation. */
  parentOf: Map<string, string>;
}

/**
 * The scheduling relationships, read once.
 *
 * `WorkPackage -realization-> Deliverable -realization-> Plateau` is the
 * ArchiMate way of saying "this work brings about that state". A work package
 * may also realise a plateau directly, which is the shorter form of the same
 * statement, so both are followed.
 */
export function toScheduleGraph(model: AbModel): ScheduleGraph {
  const byId = new Map(model.elements.map((e) => [e.id, e]));

  const deliverableToPlateau = new Map<string, string>();
  for (const rel of model.relationships) {
    if (rel.type !== "realization") continue;
    const source = byId.get(rel.source);
    const target = byId.get(rel.target);
    if (target?.type === "Plateau" && source?.type === "Deliverable") {
      deliverableToPlateau.set(source.id, target.id);
    }
  }

  const plateauOf = new Map<string, string>();
  for (const rel of model.relationships) {
    if (rel.type !== "realization") continue;
    const source = byId.get(rel.source);
    const target = byId.get(rel.target);
    if (source?.type !== "WorkPackage") continue;
    const plateau =
      target?.type === "Plateau"
        ? target.id
        : target?.type === "Deliverable"
          ? deliverableToPlateau.get(target.id)
          : undefined;
    if (plateau) plateauOf.set(source.id, plateau);
  }

  const predecessorOf = new Map<string, string>();
  for (const rel of model.relationships) {
    if (rel.type !== "triggering") continue;
    const source = byId.get(rel.source);
    const target = byId.get(rel.target);
    if (!source || !target) continue;
    // Only the first predecessor is kept: a task with one clear antecedent
    // reads better than one with a fan-in, and Mermaid renders it better too.
    if (!predecessorOf.has(target.id)) predecessorOf.set(target.id, source.id);
  }

  const parentOf = new Map<string, string>();
  for (const rel of model.relationships) {
    if (rel.type !== "composition" && rel.type !== "aggregation") continue;
    const parent = byId.get(rel.source);
    const child = byId.get(rel.target);
    if (parent?.type !== "WorkPackage" || child?.type !== "WorkPackage") continue;
    if (!parentOf.has(child.id)) parentOf.set(child.id, parent.id);
  }

  return { plateauOf, predecessorOf, parentOf };
}

export interface PlateauDate {
  /** Earliest start among the work packages realising this plateau. */
  start?: string;
  /** Latest end — the date the plateau is reached. */
  end?: string;
  /**
   * How many work packages contributed a date. Zero means nothing is
   * scheduled yet, which is what the editor reports.
   */
  from: number;
  /**
   * How many work packages realise this plateau at all, dated or not.
   *
   * Distinct from `from` on purpose: a plateau whose work carries no dates is
   * PLANNED and unscheduled, while one that nothing realises is where the plan
   * begins. Both have no date, and only this tells them apart.
   */
  realisedBy: number;
}

/**
 * The date each Plateau is reached, derived from the work that realises it.
 *
 * A work package with no end date contributes its start, because a plateau
 * cannot be reached before the work towards it begins — but it does not make
 * the plateau look finished. A plateau with nothing scheduled reports `from:
 * 0` rather than a date, so a caller can say "not yet scheduled" instead of
 * showing a confident wrong answer.
 */
export function derivePlateauDates(
  model: AbModel,
  graph: ScheduleGraph = toScheduleGraph(model)
): Map<string, PlateauDate> {
  const byId = new Map(model.elements.map((e) => [e.id, e]));
  const dates = new Map<string, PlateauDate>();

  for (const plateau of model.elements) {
    if (plateau.type === "Plateau") {
      dates.set(plateau.id, { from: 0, realisedBy: 0 });
    }
  }

  for (const [workPackageId, plateauId] of graph.plateauOf) {
    const entry = dates.get(plateauId);
    const workPackage = byId.get(workPackageId);
    if (!entry || !workPackage) continue;

    entry.realisedBy++;

    const start = isoDate(workPackage.properties.startDate);
    const end = isoDate(workPackage.properties.endDate) ?? start;
    if (!start && !end) continue;

    entry.from++;
    if (start && (!entry.start || start < entry.start)) entry.start = start;
    if (end && (!entry.end || end > entry.end)) entry.end = end;
  }

  return dates;
}

/**
 * Plateaus in the order a reader should meet them.
 *
 * Ordered by when each is REACHED, not when work towards it starts: a long
 * work package begun early does not make its plateau an early one.
 *
 * Two kinds of plateau carry no date, and they belong at opposite ends:
 *
 *   - **Nothing realises it** (`from === 0`). No planned work produces this
 *     state, so it is not somewhere the plan arrives at — it is where the plan
 *     begins. "P0 Empty Repo" is exactly this. These come first.
 *   - **Work realises it, but that work has no dates** (`from > 0`, no end).
 *     The state is planned and unscheduled, so it cannot be placed. These come
 *     last.
 *
 * The distinction is a reading, not something the specification fixes, and it
 * can be wrong: a far-future plateau nobody has started planning also has
 * nothing realising it and will sort to the front. Dating the work is what
 * resolves it.
 *
 * Shared so the Gantt's sections and the git graph's commits cannot disagree
 * about the order of the same plateaus.
 */
export function orderedPlateaus(
  model: AbModel,
  dates: Map<string, PlateauDate> = derivePlateauDates(model)
): AbModel["elements"] {
  const rank = (id: string) => {
    const date = dates.get(id);
    if (!date || date.realisedBy === 0) return 0; // where the plan begins
    if (!date.end) return 2; // planned, but nothing dated
    return 1;
  };

  return model.elements
    .filter((e) => e.type === "Plateau")
    .sort((a, b) => {
      const ra = rank(a.id);
      const rb = rank(b.id);
      if (ra !== rb) return ra - rb;

      const da = dates.get(a.id);
      const db = dates.get(b.id);
      const ea = da?.end ?? "";
      const eb = db?.end ?? "";
      if (ea !== eb) return ea.localeCompare(eb);
      const sa = da?.start ?? "";
      const sb = db?.start ?? "";
      if (sa !== sb) return sa.localeCompare(sb);
      return a.name.localeCompare(b.name);
    });
}
