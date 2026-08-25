import * as React from "react";
import type { AbModel } from "@dlab5/blueprint-core";
import { GANTT_TOKENS, token } from "../lib/gantt-palette";

/**
 * A legend for the roadmap.
 *
 * The swatch colours come from src/lib/gantt-palette.ts, which is also what
 * configures Mermaid. They used to be Mermaid's own dark-theme fills copied in
 * as hex, with a note asking whoever changed the theme to change them too —
 * and then the light theme arrived and they were wrong in one theme out of
 * two. A legend whose colours do not match the chart is worse than no legend,
 * so now neither side owns the palette and they cannot drift.
 *
 * Entries are derived from the model, not fixed. A roadmap with nothing at
 * risk should not have a red "at risk" swatch inviting the reader to hunt for
 * one that is not there.
 */

interface Entry {
  key: string;
  label: string;
  meaning: string;
  /** A CSS custom property reference, resolved by the theme in force. */
  fill: string;
  stroke?: string;
  milestone?: boolean;
}

const ENTRIES: Entry[] = [
  {
    key: "done",
    label: "Done",
    meaning: "status: done",
    fill: token(GANTT_TOKENS.done),
  },
  {
    key: "active",
    label: "In progress",
    meaning: "status: in-progress",
    fill: token(GANTT_TOKENS.active),
  },
  {
    key: "crit",
    label: "At risk",
    meaning: "status: at-risk",
    fill: token(GANTT_TOKENS.crit),
  },
  {
    key: "planned",
    label: "Planned",
    meaning: "no status, or status: planned",
    fill: token(GANTT_TOKENS.planned),
    stroke: token("--bp-border-strong"),
  },
  {
    key: "milestone",
    label: "Milestone",
    meaning: "an Implementation Event — a moment, not a duration",
    fill: token(GANTT_TOKENS.milestone),
    milestone: true,
  },
];

/** Which legend entries this particular model actually needs. */
function present(model: AbModel): Entry[] {
  const statuses = new Set<string>();
  let hasMilestone = false;
  let hasPlain = false;

  for (const el of model.elements) {
    if (el.type === "ImplementationEvent") hasMilestone = true;
    if (el.type !== "WorkPackage" && el.type !== "ImplementationEvent") continue;
    const status = el.properties.status;
    if (status === "done" || status === "closed") statuses.add("done");
    else if (status === "in-progress" || status === "active") statuses.add("active");
    else if (status === "at-risk" || status === "critical") statuses.add("crit");
    else hasPlain = true;
  }

  return ENTRIES.filter(
    (e) =>
      statuses.has(e.key) ||
      (e.key === "planned" && hasPlain) ||
      (e.key === "milestone" && hasMilestone)
  );
}

export function GanttLegend({ model }: { model: AbModel }) {
  const entries = present(model);
  if (entries.length === 0) return null;

  return (
    <div className="bp-legend">
      <ul className="bp-legend__items">
        {entries.map((e) => (
          <li key={e.key} className="bp-legend__item">
            <span
              className={`bp-legend__swatch${
                e.milestone ? " bp-legend__swatch--milestone" : ""
              }`}
              style={{
                background: e.fill,
                border: e.stroke ? `1px solid ${e.stroke}` : undefined,
              }}
              aria-hidden="true"
            />
            <span className="bp-legend__label">{e.label}</span>
            <span className="bp-legend__meaning">{e.meaning}</span>
          </li>
        ))}
      </ul>
      <p className="bp-legend__note">
        Sections are <strong>Plateaus</strong> — the architectural states the
        work brings about. A work package sits in the plateau its deliverable
        realizes, or the one it inherits from its parent or predecessor. Bars
        without dates are placed <code>after</code> whatever triggers them.
      </p>
    </div>
  );
}
