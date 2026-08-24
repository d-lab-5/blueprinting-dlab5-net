import { ELEMENTS, isAllowed } from "@dlab5/archimate-metamodel";
import type { ElementTypeId } from "@dlab5/archimate-metamodel";
import type { AbElement, AbModel } from "./types.js";

/**
 * The Technology Radar, derived from the ArchiMate model rather than kept
 * beside it.
 *
 * This is what makes the radar and the architecture one source of truth: an
 * entry on the radar IS the element the architecture uses, so a component
 * cannot appear on a diagram at ADOPT while the radar still says ASSESS. The
 * radar becomes a query, not a second dataset.
 *
 * ## The modelling convention
 *
 * **Quadrant is a Grouping, not the element type.** The intuitive mapping —
 * quadrant to ArchiMate type — is lossy: Thoughtworks puts both "Languages &
 * Frameworks" and "Tools" on ApplicationComponent, so the type cannot tell you
 * which quadrant an entry is in. A Grouping can, and it is the specification's
 * own construct for exactly this: "aggregates concepts that belong together
 * based on some common characteristic". `Grouping --aggregation--> X` is a
 * DIRECT relationship for every type a radar entry can be.
 *
 * The element type still carries real meaning — it is what makes an entry
 * usable in an architecture diagram — it just is not what defines the
 * quadrant:
 *
 *   Languages & Frameworks   ApplicationComponent
 *   Platforms                Node, SystemSoftware
 *   Tools                    ApplicationComponent
 *   Techniques               BusinessProcess, Capability, CourseOfAction
 *
 * **Ring is an ArchiMate Property**, like the scheduling dates in Layer 7.
 * ArchiMate has no notion of adoption status, and Properties are the
 * specification's sanctioned escape hatch — they also round-trip through the
 * Open Exchange format into Archi.
 *
 *   radarRing    adopt | trial | assess | hold
 *   radarMoved   in | out | none        (movement since the last radar)
 */

export const RADAR_RINGS = ["adopt", "trial", "assess", "hold"] as const;
export type RadarRing = (typeof RADAR_RINGS)[number];

export const RADAR_MOVED = ["in", "out", "none"] as const;
export type RadarMoved = (typeof RADAR_MOVED)[number];

/** Property keys, so nothing downstream spells them by hand. */
export const RADAR_PROPS = {
  ring: "radarRing",
  moved: "radarMoved",
} as const;

/**
 * Element types that may sit on a radar.
 *
 * Deliberately a short list. A radar entry has to be something a team adopts
 * or holds — a Plateau or a Gap is neither, and offering every one of the 60
 * element types would make the convention meaningless.
 */
export const RADAR_ELEMENT_TYPES: ElementTypeId[] = [
  "ApplicationComponent",
  "Node",
  "SystemSoftware",
  "TechnologyService",
  "BusinessProcess",
  "Capability",
  "CourseOfAction",
];

export interface RadarEntry {
  /** The element's id — an entry IS an element, not a copy of one. */
  id: string;
  label: string;
  /** Name of the Grouping that aggregates it. */
  quadrant: string;
  ring: RadarRing;
  moved: RadarMoved;
  /** ArchiMate type, which is what makes the entry usable in a diagram. */
  type: ElementTypeId;
  description?: string;
}

export interface RadarQuadrant {
  /** The Grouping's id. */
  id: string;
  name: string;
  entries: RadarEntry[];
}

function ringOf(el: AbElement): RadarRing | undefined {
  const value = el.properties[RADAR_PROPS.ring]?.toLowerCase();
  return (RADAR_RINGS as readonly string[]).includes(value ?? "")
    ? (value as RadarRing)
    : undefined;
}

function movedOf(el: AbElement): RadarMoved {
  const value = el.properties[RADAR_PROPS.moved]?.toLowerCase();
  return (RADAR_MOVED as readonly string[]).includes(value ?? "")
    ? (value as RadarMoved)
    : "none";
}

/**
 * Reads the radar out of a model.
 *
 * An element appears exactly when both halves of the convention are present:
 * it carries a `radarRing` property, and some Grouping aggregates it. One
 * without the other is reported by `validateRadar` rather than silently
 * dropped — a half-modelled entry is a mistake, not an absence.
 */
export function toRadar(model: AbModel): RadarQuadrant[] {
  const byId = new Map(model.elements.map((e) => [e.id, e]));

  const quadrants = new Map<string, RadarQuadrant>();

  for (const rel of model.relationships) {
    if (rel.type !== "aggregation") continue;
    const grouping = byId.get(rel.source);
    const member = byId.get(rel.target);
    if (grouping?.type !== "Grouping" || !member) continue;

    const ring = ringOf(member);
    if (!ring) continue;

    if (!quadrants.has(grouping.id)) {
      quadrants.set(grouping.id, {
        id: grouping.id,
        name: grouping.name,
        entries: [],
      });
    }
    quadrants.get(grouping.id)!.entries.push({
      id: member.id,
      label: member.name,
      quadrant: grouping.name,
      ring,
      moved: movedOf(member),
      type: member.type,
      description: member.documentation,
    });
  }

  const ordered = [...quadrants.values()].sort((a, b) =>
    a.name.localeCompare(b.name)
  );
  for (const q of ordered) {
    q.entries.sort(
      (a, b) =>
        RADAR_RINGS.indexOf(a.ring) - RADAR_RINGS.indexOf(b.ring) ||
        a.label.localeCompare(b.label)
    );
  }
  return ordered;
}

export interface RadarFinding {
  severity: "error" | "warning";
  code: string;
  message: string;
  subject: string;
}

/**
 * Checks the radar convention.
 *
 * Separate from validateModel: these are not ArchiMate errors. A model with a
 * half-modelled radar entry is perfectly valid ArchiMate, it just will not
 * render the radar anyone expected — so this reports, and never blocks a save.
 */
export function validateRadar(model: AbModel): RadarFinding[] {
  const findings: RadarFinding[] = [];
  const byId = new Map(model.elements.map((e) => [e.id, e]));

  const aggregated = new Set<string>();
  for (const rel of model.relationships) {
    if (rel.type !== "aggregation") continue;
    if (byId.get(rel.source)?.type === "Grouping") aggregated.add(rel.target);
  }

  for (const el of model.elements) {
    const hasRing = Boolean(el.properties[RADAR_PROPS.ring]);
    const rawRing = el.properties[RADAR_PROPS.ring];

    if (rawRing && !ringOf(el)) {
      findings.push({
        severity: "error",
        code: "radar-bad-ring",
        message:
          `"${el.name}" has radarRing "${rawRing}", which is not one of ` +
          RADAR_RINGS.join(", "),
        subject: el.id,
      });
      continue;
    }

    if (hasRing && !aggregated.has(el.id)) {
      findings.push({
        severity: "warning",
        code: "radar-no-quadrant",
        message:
          `"${el.name}" has a radar ring but no Grouping aggregates it, so it ` +
          "has no quadrant and will not appear on the radar",
        subject: el.id,
      });
    }

    if (hasRing && !RADAR_ELEMENT_TYPES.includes(el.type)) {
      findings.push({
        severity: "warning",
        code: "radar-odd-type",
        message:
          `"${el.name}" is a ${ELEMENTS[el.type].label}, which is not a kind ` +
          "of thing a team adopts or holds",
        subject: el.id,
      });
    }
  }

  return findings;
}

/**
 * Whether a Grouping may aggregate this element type at all.
 *
 * Asked of the generated metamodel rather than assumed, so that a re-pinned
 * ontology cannot leave this convention quietly illegal.
 */
export function canBeRadarEntry(type: ElementTypeId): boolean {
  return isAllowed("Grouping", "aggregation", type);
}
