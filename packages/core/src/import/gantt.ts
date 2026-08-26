import { slugifyId, uniqueId } from "../iri.js";
import type { AbElement, AbModel, AbRelationship } from "../types.js";

/**
 * A Mermaid Gantt chart, read into an ArchiMate model.
 *
 * **One way, and lossy on purpose.** A Gantt is a schedule; an ArchiMate
 * Implementation & Migration model is a schedule plus the structure that gives
 * it meaning. Mermaid has no Deliverable, no Gap, and no realization chain, so
 * what comes back is work packages, sections as plateaus, and milestones —
 * and nothing else. This is an on-ramp for someone who already has a chart, not
 * a round-trip, and it must never be offered as one: exporting the result and
 * re-importing it would not return the model it came from.
 *
 * A work package is attached to its section's plateau with a realization,
 * which Appendix B permits but marks derived — the full form is
 * WorkPackage -> Deliverable -> Plateau. Asserting the shortcut is deliberate:
 * validateModel warns about a directly-asserted derived relationship, and that
 * warning is exactly the right thing to tell someone who has just imported a
 * chart. Inventing a Deliverable per section to avoid it would be inventing
 * data the source does not contain.
 */

export interface GanttImportResult {
  model: AbModel;
  /** What was recognised, for reporting back to whoever asked. */
  sections: number;
  tasks: number;
  milestones: number;
  /** Lines that were not understood, with their 1-based numbers. */
  skipped: Array<{ line: number; text: string }>;
}

const TAGS = new Set(["done", "active", "crit", "milestone", "vert"]);

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DURATION = /^\d+(\.\d+)?[dhwms]$/i;
const AFTER = /^after\s+(.+)$/i;

/** Directives that carry no elements; recognised so they are not "skipped". */
const DIRECTIVES = new Set([
  "gantt",
  "title",
  "dateformat",
  "axisformat",
  "excludes",
  "includes",
  "todaymarker",
  "tickinterval",
  "weekday",
  "inclusiveenddates",
  "topaxis",
  "displaymode",
]);

/** Mermaid's task tags, as our status vocabulary. */
function statusOf(tags: string[]): string | undefined {
  if (tags.includes("done")) return "done";
  if (tags.includes("active")) return "in-progress";
  if (tags.includes("crit")) return "at-risk";
  return undefined;
}

interface Parsed {
  label: string;
  tags: string[];
  id?: string;
  start?: string;
  after?: string;
  end?: string;
  duration?: string;
}

/**
 * Splits the part after the colon.
 *
 * Mermaid's grammar is positional but the positions are optional, so each
 * token is classified by what it looks like rather than by where it sits.
 * That is what lets `:done, t1, 2026-01-01, 5d` and `:t1, after t0, 3d` both
 * read correctly.
 */
function parseSpec(label: string, spec: string): Parsed {
  const parsed: Parsed = { label, tags: [] };

  for (const raw of spec.split(",")) {
    const token = raw.trim();
    if (!token) continue;

    const lower = token.toLowerCase();
    if (TAGS.has(lower)) {
      parsed.tags.push(lower);
    } else if (DATE.test(token)) {
      if (!parsed.start) parsed.start = token;
      else parsed.end = token;
    } else if (AFTER.test(token)) {
      parsed.after = AFTER.exec(token)![1].trim();
    } else if (DURATION.test(token)) {
      parsed.duration = token;
    } else if (!parsed.id) {
      parsed.id = token;
    }
  }

  return parsed;
}

export function fromMermaidGantt(
  source: string,
  projectSlug: string
): GanttImportResult {
  const elements: AbElement[] = [];
  const relationships: AbRelationship[] = [];
  const skipped: Array<{ line: number; text: string }> = [];
  const taken: string[] = [];

  /** Mermaid task id -> our element id, for resolving `after`. */
  const byTaskId = new Map<string, string>();
  /** Our element id, in emission order, for an `after` with no id to name. */
  const order: string[] = [];

  let currentPlateau: string | undefined;
  let sections = 0;
  let tasks = 0;
  let milestones = 0;

  const add = (name: string, type: AbElement["type"], properties: Record<string, string>) => {
    const id = uniqueId(name, taken);
    taken.push(id);
    elements.push({ id, type, name, properties });
    return id;
  };

  const lines = source.split("\n");

  lines.forEach((raw, index) => {
    const line = raw.trim();
    if (!line || line.startsWith("%%")) return;

    const firstWord = line.split(/[\s:]/)[0]!.toLowerCase();

    if (firstWord === "section") {
      const name = line.slice(line.toLowerCase().indexOf("section") + 7).trim();
      if (!name) {
        skipped.push({ line: index + 1, text: raw });
        return;
      }
      currentPlateau = add(name, "Plateau", {});
      sections++;
      return;
    }

    if (DIRECTIVES.has(firstWord)) return;

    const colon = line.indexOf(":");
    if (colon === -1) {
      skipped.push({ line: index + 1, text: raw });
      return;
    }

    const label = line.slice(0, colon).trim();
    if (!label) {
      skipped.push({ line: index + 1, text: raw });
      return;
    }

    const spec = parseSpec(label, line.slice(colon + 1));
    const isMilestone = spec.tags.includes("milestone");

    const properties: Record<string, string> = {};
    if (spec.start) properties.startDate = spec.start;
    // A milestone is a moment, so it never takes an end date even when the
    // chart gives it one — which Mermaid's own `0d` duration already says.
    if (spec.end && !isMilestone) properties.endDate = spec.end;
    const status = statusOf(spec.tags);
    if (status) properties.status = status;

    const id = add(
      label,
      isMilestone ? "ImplementationEvent" : "WorkPackage",
      properties
    );
    order.push(id);
    if (spec.id) byTaskId.set(spec.id, id);
    if (isMilestone) milestones++;
    else tasks++;

    if (currentPlateau && !isMilestone) {
      relationships.push({
        id: uniqueId(`${id}-realizes`, taken),
        type: "realization",
        source: id,
        target: currentPlateau,
        properties: {},
      });
      taken.push(`${id}-realizes`);
    }

    if (spec.after) {
      // `after` may name several ids; Mermaid starts at the latest of them,
      // and we keep the first that resolves — one clear antecedent, matching
      // what the Gantt generator emits going the other way.
      for (const name of spec.after.split(/\s+/)) {
        const predecessor = byTaskId.get(name);
        if (!predecessor) continue;
        relationships.push({
          id: uniqueId(`${predecessor}-triggers-${id}`, taken),
          type: "triggering",
          source: predecessor,
          target: id,
          properties: {},
        });
        taken.push(`${predecessor}-triggers-${id}`);
        break;
      }
    }
  });

  return {
    model: { projectSlug: slugifyId(projectSlug), elements, relationships },
    sections,
    tasks,
    milestones,
    skipped,
  };
}
