import type { AbElement, AbModel } from "../types.js";
import {
  derivePlateauDates,
  orderedPlateaus,
  toScheduleGraph,
} from "../schedule.js";

/**
 * An Implementation & Migration model drawn as a git graph.
 *
 * The mapping is the one in `temp/body-of-knowledge/archimate_git_product_mapping.pdf`,
 * read for a 3.2 model:
 *
 *   main                 the release train — the sequence of architectural
 *                        states the platform actually passes through.
 *   Plateau              a commit on main. A plateau is a frozen, stable
 *                        baseline, which is what a release commit is.
 *   WorkPackage          a branch off main, merged back. Work happens away
 *                        from the baseline and lands in one move.
 *   ImplementationEvent  the tag on the merge that its work package triggers,
 *                        or a plain commit when nothing triggers it.
 *
 * **A visualisation, not an integration.** Nothing here reads a repository,
 * and no commit id corresponds to a real SHA. It borrows git's vocabulary
 * because a release train genuinely has git's shape, and an engineer reads a
 * branch-and-merge picture faster than a list of realization relationships.
 *
 * The plateau order is derived, never stored — the same rule the Gantt uses,
 * from ../schedule.js, so the two cannot disagree about when a state is
 * reached.
 *
 * Mermaid's gitGraph has two rules this generator has to respect, both found
 * by feeding it deliberately wrong input rather than by reading the docs:
 *
 *   - A branch cannot be merged until it has a commit of its own. Merging
 *     straight after `branch` fails with "Both branches have same head".
 *   - Branch names must be unique. A repeated name fails outright.
 *   - main itself must have a commit before anything can merge into it, or
 *     mermaid reports "Current branch (main) has no commits". A model whose
 *     first plateau already has work realising it would otherwise open with a
 *     merge onto an empty trunk.
 */

export interface GitgraphOptions {
  title?: string;
  /** Rendered when the model has nothing to place. */
  emptyMessage?: string;
  /**
   * The root commit, when the model does not supply one.
   *
   * A git graph has to start somewhere, and mermaid refuses to merge onto a
   * trunk with no commits. When the earliest plateau already has work
   * realising it there is no state to open with, so one is drawn. It is a
   * rendering artefact and not an element — the same status as the Gantt's
   * "Unscheduled" lane.
   */
  rootLabel?: string;
}

/**
 * A branch label.
 *
 * Mermaid accepts a quoted branch name, so this is the work package's actual
 * name rather than its id — an id-derived token reads as
 * "wp6-4-embed-the-editor-in-the-app" in the gutter, which is the id showing
 * through into the picture.
 *
 * Names must still be unique, and "main" is the trunk: a work package called
 * that would redefine it.
 */
function branchName(name: string, taken: Set<string>): string {
  const base = name.trim().replace(/"/g, "") || "Work";
  let unique = base.toLowerCase() === "main" ? `${base} (work)` : base;
  let n = 2;
  while (taken.has(unique)) unique = `${base} (${n++})`;
  taken.add(unique);
  return unique;
}

/** Mermaid quotes ids, so an embedded quote has to be escaped. */
const label = (value: string) => value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

export function toMermaidGitgraph(
  model: AbModel,
  options: GitgraphOptions = {}
): string {
  const {
    title,
    emptyMessage = "No plateaus or work packages to draw yet",
    rootLabel = "Initial state",
  } = options;

  const byId = new Map(model.elements.map((e) => [e.id, e]));
  const { plateauOf, predecessorOf } = toScheduleGraph(model);
  const dates = derivePlateauDates(model);

  const plateaus = orderedPlateaus(model, dates);

  const workPackages = model.elements.filter((e) => e.type === "WorkPackage");

  const byPlateau = new Map<string, AbElement[]>();
  const unplaced: AbElement[] = [];
  for (const wp of workPackages) {
    const plateau = plateauOf.get(wp.id);
    if (plateau && byId.has(plateau)) {
      const bucket = byPlateau.get(plateau);
      if (bucket) bucket.push(wp);
      else byPlateau.set(plateau, [wp]);
    } else {
      unplaced.push(wp);
    }
  }

  /** Events keyed by the work package that triggers them. */
  const eventOf = new Map<string, AbElement>();
  const looseEvents: AbElement[] = [];
  for (const event of model.elements) {
    if (event.type !== "ImplementationEvent") continue;
    const trigger = predecessorOf.get(event.id);
    const source = trigger ? byId.get(trigger) : undefined;
    if (source?.type === "WorkPackage" && !eventOf.has(source.id)) {
      eventOf.set(source.id, event);
    } else {
      looseEvents.push(event);
    }
  }

  /** What a work package realises, when the model says so. */
  const producedBy = (wp: AbElement): string | undefined => {
    const deliverables = model.relationships
      .filter((r) => r.type === "realization" && r.source === wp.id)
      .map((r) => byId.get(r.target))
      .filter((e): e is AbElement => e?.type === "Deliverable");
    // Only when there is exactly one. Two deliverables on one commit would
    // need a label naming both, and a picked-arbitrarily first is worse than
    // falling back to the work package's own name.
    return deliverables.length === 1 ? deliverables[0]!.name : undefined;
  };

  const lines: string[] = ["gitGraph"];
  if (title) lines.push(`    title ${label(title)}`);

  if (plateaus.length === 0 && workPackages.length === 0) {
    lines.push(`    commit id: "${label(emptyMessage)}"`);
    return lines.join("\n") + "\n";
  }

  const taken = new Set<string>(["main"]);

  // main needs a commit before the first merge lands on it. If the earliest
  // plateau is realised by nothing then its own commit roots the graph and
  // no artefact is needed; otherwise one is.
  const firstPlateauHasWork =
    plateaus.length > 0 && (byPlateau.get(plateaus[0]!.id) ?? []).length > 0;
  if (firstPlateauHasWork || plateaus.length === 0) {
    lines.push(`    commit id: "${label(rootLabel)}"`);
  }

  const land = (wp: AbElement) => {
    const branch = branchName(wp.name, taken);
    const event = eventOf.get(wp.id);
    lines.push(`    branch "${label(branch)}"`);
    lines.push(`    checkout "${label(branch)}"`);
    // The branch must carry a commit before it can be merged; mermaid rejects
    // a merge whose branches share a head.
    //
    // The commit says what the work PRODUCED where the model records it. The
    // branch label already names the work package, so repeating it here would
    // print the same string twice in the same lane.
    lines.push(`    commit id: "${label(producedBy(wp) ?? wp.name)}"`);
    lines.push(`    checkout main`);
    lines.push(
      event
        ? `    merge "${label(branch)}" tag: "${label(event.name)}"`
        : `    merge "${label(branch)}"`
    );
  };

  for (const plateau of plateaus) {
    for (const wp of byPlateau.get(plateau.id) ?? []) land(wp);

    const date = dates.get(plateau.id);
    const tag = date?.end ? ` tag: "${date.end}"` : "";
    // HIGHLIGHT marks the baseline: on a busy graph the plateaus are the
    // commits a reader is looking for.
    lines.push(`    commit id: "${label(plateau.name)}" type: HIGHLIGHT${tag}`);
  }

  for (const event of looseEvents) {
    lines.push(`    commit id: "${label(event.name)}"`);
  }

  // Work with no plateau is drawn as a branch that is never merged, which is
  // what it is: in flight, not yet part of any baseline. Placing it on main
  // would claim it had landed.
  for (const wp of unplaced) {
    const branch = branchName(wp.name, taken);
    lines.push(`    branch "${label(branch)}"`);
    lines.push(`    checkout "${label(branch)}"`);
    lines.push(`    commit id: "${label(producedBy(wp) ?? wp.name)}"`);
    lines.push(`    checkout main`);
  }

  return lines.join("\n") + "\n";
}
