import type { AbModel, AbElement } from "../types.js";
import {
  derivePlateauDates,
  isoDate,
  orderedPlateaus,
  toScheduleGraph,
} from "../schedule.js";

/**
 * Turns an ArchiMate Implementation & Migration model into a Mermaid Gantt.
 *
 * The mapping is not arbitrary — it reads the graph the specification already
 * gives us rather than inventing scheduling fields:
 *
 *   Plateau              a section. Which section a work package belongs to is
 *                        derived, not stored: WorkPackage -realization->
 *                        Deliverable -realization-> Plateau. That chain is the
 *                        ArchiMate way of saying "this work brings about that
 *                        state", so the Gantt groups by it.
 *   WorkPackage          a task, dated from its ArchiMate Properties.
 *   ImplementationEvent  a milestone.
 *   triggering           an `after` dependency between tasks.
 *
 * Everything else in the model is ignored. A Gantt is a schedule, and a
 * Deliverable or a Gap has no duration.
 */

export interface GanttOptions {
  title?: string;
  /** Days to give a task that has no endDate. */
  defaultDurationDays?: number;
  /** Rendered when the model has nothing datable in it. */
  emptyMessage?: string;
}

const UNPLACED = "__unplaced__";

/**
 * Mermaid splits a task line on ":" and treats "#" as a comment, so neither
 * can survive in a label. Newlines would end the statement.
 */
function label(text: string): string {
  return text
    .replace(/[:#;]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Mermaid task ids appear bare in `after <id>`, so they are restricted to
 * word characters. Our element ids are already [a-z0-9-]; the hyphens are what
 * need replacing.
 */
function taskId(id: string): string {
  return `t_${id.replace(/[^A-Za-z0-9_]/g, "_")}`;
}

/** ISO date, or undefined if the property is missing or not a date. */
/**
 * Mermaid's own status tags. `done` and `active` change the bar's fill, which
 * is what makes a roadmap readable at a glance, so they are driven from the
 * `status` property rather than from dates being in the past.
 */
function statusTag(el: AbElement): string | undefined {
  switch (el.properties.status) {
    case "done":
    case "closed":
      return "done";
    case "in-progress":
    case "active":
      return "active";
    case "at-risk":
    case "critical":
      return "crit";
    default:
      return undefined;
  }
}

export function toMermaidGantt(
  model: AbModel,
  options: GanttOptions = {}
): string {
  const {
    title = "Roadmap",
    defaultDurationDays = 5,
    emptyMessage = "No scheduled work in this model yet.",
  } = options;

  const byId = new Map(model.elements.map((e) => [e.id, e]));

  const workPackages = model.elements.filter((e) => e.type === "WorkPackage");
  const events = model.elements.filter((e) => e.type === "ImplementationEvent");

  if (workPackages.length === 0 && events.length === 0) {
    // Mermaid rejects an empty gantt, and a diagram saying nothing is worse
    // than a sentence saying so.
    return `%% ${label(emptyMessage)}\ngantt\n    title ${label(title)}\n    dateFormat YYYY-MM-DD\n    section ${label(emptyMessage)}\n`;
  }

  /* -- the scheduling graph ------------------------------------------------ */

  // Derived in ../schedule.ts rather than here, because the editor needs the
  // same answers and two implementations of one rule is how they come to
  // disagree.
  const { plateauOf, predecessorOf, parentOf } = toScheduleGraph(model);

  /* -- order the sections -------------------------------------------------- */

  // A plateau carries no date of its own: it is reached when the work
  // realising it finishes, so the order comes from that rather than from a
  // stored field somebody has to keep in step.
  const plateauDates = derivePlateauDates(model, {
    plateauOf,
    predecessorOf,
    parentOf,
  });

  // Ordered by when each plateau is REACHED, not when work towards it starts.
  // A plateau is a state, and the state exists once the work finishes; a long
  // work package begun early does not make its plateau an early one. Sorting
  // by start put P3 ahead of P2 in the platform's own roadmap, because WP11
  // began a day before WP2 — true, and not what a reader means by the order
  // of the plateaus. Start breaks a tie, name breaks that.
  const plateaus = orderedPlateaus(model, plateauDates);

  const sections: Array<{ id: string; name: string; items: AbElement[] }> =
    plateaus.map((p) => ({ id: p.id, name: p.name, items: [] }));
  sections.push({ id: UNPLACED, name: "Unscheduled", items: [] });

  const sectionById = new Map(sections.map((s) => [s.id, s]));

  const place = (el: AbElement, plateauId: string | undefined) => {
    const section =
      (plateauId && sectionById.get(plateauId)) || sectionById.get(UNPLACED)!;
    section.items.push(el);
  };

  // A work package with no deliverable of its own inherits a plateau from its
  // parent, or failing that from whatever triggers it. Planned work is usually
  // specified as "break this down" or "then this", long before anyone writes
  // down which deliverable it produces, and burying the planned tail in
  // "Unscheduled" would make the roadmap useless precisely where it is most
  // needed. Resolved iteratively so a chain or a nesting several deep all
  // inherit from the nearest declared ancestor.
  for (let pass = 0; pass < workPackages.length; pass++) {
    let changed = false;
    for (const wp of workPackages) {
      if (plateauOf.has(wp.id)) continue;
      const parent = parentOf.get(wp.id);
      const trigger = predecessorOf.get(wp.id);
      const inherited =
        (parent ? plateauOf.get(parent) : undefined) ??
        (trigger ? plateauOf.get(trigger) : undefined);
      if (inherited) {
        plateauOf.set(wp.id, inherited);
        changed = true;
      }
    }
    if (!changed) break;
  }

  for (const wp of workPackages) place(wp, plateauOf.get(wp.id));
  // An event sits with whatever triggered it, so a milestone lands beside the
  // work that produced it rather than in a bucket of its own.
  for (const ev of events) {
    const trigger = predecessorOf.get(ev.id);
    place(ev, trigger ? plateauOf.get(trigger) : undefined);
  }

  /* -- emit ---------------------------------------------------------------- */

  const lines = [
    "gantt",
    `    title ${label(title)}`,
    "    dateFormat YYYY-MM-DD",
    "    axisFormat %d %b",
  ];

  // The earliest real date anywhere, used only as a last-resort anchor for a
  // model that has no dates at all.
  const earliest =
    model.elements
      .map((e) => isoDate(e.properties.startDate))
      .filter((d): d is string => Boolean(d))
      .sort()[0] ?? new Date().toISOString().slice(0, 10);

  // Emitted task ids, in order, so an undated task with no trigger can hang
  // off the previous one rather than float.
  let lastEmitted: string | undefined;
  const emitted = new Set<string>();

  const sortByStart = (a: AbElement, b: AbElement) => {
    const da = isoDate(a.properties.startDate) ?? "9999-99-99";
    const db = isoDate(b.properties.startDate) ?? "9999-99-99";
    if (da !== db) return da.localeCompare(db);
    // On the same day, the work comes before the milestone it produced.
    const ma = a.type === "ImplementationEvent" ? 1 : 0;
    const mb = b.type === "ImplementationEvent" ? 1 : 0;
    if (ma !== mb) return ma - mb;
    // Numeric-aware, or WP10 sorts before WP5.
    return a.name.localeCompare(b.name, "en", { numeric: true });
  };

  for (const section of sections) {
    if (section.items.length === 0) continue;
    lines.push(`    section ${label(section.name)}`);

    for (const el of section.items.slice().sort(sortByStart)) {
      const id = taskId(el.id);
      const start = isoDate(el.properties.startDate);
      const end = isoDate(el.properties.endDate);
      const tags: string[] = [];

      const status = statusTag(el);
      if (status) tags.push(status);
      if (el.type === "ImplementationEvent") tags.push("milestone");

      let when: string;
      if (start && end && start !== end) {
        when = `${start}, ${end}`;
      } else if (start && end) {
        // Same start and end. Mermaid takes that literally and draws a bar of
        // zero width, leaving the label floating over the chart with nothing
        // under it — which reads as a rendering fault rather than as a short
        // task. A work package that began and finished on one day lasted a
        // day, so that is what is emitted. An ImplementationEvent is a moment
        // by definition and keeps its zero duration.
        when =
          el.type === "ImplementationEvent" ? `${start}, 0d` : `${start}, 1d`;
      } else if (start) {
        when = el.type === "ImplementationEvent"
          ? `${start}, 0d`
          : `${start}, ${defaultDurationDays}d`;
      } else {
        // No dates. Anchor to whatever triggers it, which is how the planned
        // tail of a roadmap stays in sequence without inventing dates. Falling
        // back to the previously emitted task keeps an untriggered one in
        // order; `after` must never name a task that was not emitted, which
        // Mermaid renders as a task starting at the epoch.
        const trigger = predecessorOf.get(el.id);
        const predecessor =
          trigger && emitted.has(trigger) ? taskId(trigger) : lastEmitted;
        const duration =
          el.type === "ImplementationEvent" ? "0d" : `${defaultDurationDays}d`;
        when = predecessor
          ? `after ${predecessor}, ${duration}`
          : `${earliest}, ${duration}`;
      }

      const prefix = tags.length ? `${tags.join(", ")}, ` : "";
      lines.push(`    ${label(el.name)} :${prefix}${id}, ${when}`);
      emitted.add(el.id);
      lastEmitted = id;
    }
  }

  return lines.join("\n") + "\n";
}
