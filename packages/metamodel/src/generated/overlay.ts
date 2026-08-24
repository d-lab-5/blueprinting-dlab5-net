// GENERATED FILE — DO NOT EDIT.
//
// Produced by scripts/gen-metamodel.mjs from the ontology pinned at
// a0f6e86bf6f211ab07d712ff16c8c8adb9471dd4. To change anything here, change the ontology pin or the
// generator and run `npm run gen:metamodel`.

/**
 * Platform conventions, declared in ontology/overlay/ and emitted here.
 *
 * These are NOT part of the ArchiMate language — they are what this platform
 * layers on top of it. Keeping them in the ontology rather than in TypeScript
 * means one place declares them and one place changes them, and it is what
 * makes more than one language version possible at once. See ADR-0007.
 */
export interface Convention {
  /** Term local name in the bp: namespace. */
  readonly term: string;
  /** Key used when stored as an ArchiMate Property on an element. */
  readonly propertyKey: string;
  readonly label: string;
  readonly comment: string;
  /** Permitted values from sh:in, or null when the value is free text. */
  readonly values: readonly string[] | null;
  readonly defaultValue: string | null;
}

/**
 * The ArchiMate specification version the pinned ontology expresses.
 *
 * Every model written by this platform is stamped with it, so an export can
 * name what it conforms to rather than leaving a reader to guess. See ADR-0007.
 */
export const LANGUAGE_VERSION = "3.2";

export const CONVENTIONS = {
  endDate: {
    term: "endDate",
    propertyKey: "endDate",
    label: "End date",
    comment: "",
    values: null,
    defaultValue: null,
  },
  radarMoved: {
    term: "radarMoved",
    propertyKey: "radarMoved",
    label: "Radar movement",
    comment: "Movement since the previous radar.",
    values: ["in","out","none"],
    defaultValue: "none",
  },
  radarRing: {
    term: "radarRing",
    propertyKey: "radarRing",
    label: "Radar ring",
    comment: "Adoption status. Presence of this property is what puts an element on the radar.",
    values: ["adopt","trial","assess","hold"],
    defaultValue: null,
  },
  startDate: {
    term: "startDate",
    propertyKey: "startDate",
    label: "Start date",
    comment: "ISO 8601 date. Read by the Layer 7 Gantt.",
    values: null,
    defaultValue: null,
  },
  status: {
    term: "status",
    propertyKey: "status",
    label: "Status",
    comment: "Drives the Gantt bar style. Anything outside this list renders untagged.",
    values: ["planned","in-progress","done","at-risk","open","closed"],
    defaultValue: null,
  },
} as const satisfies Record<string, Convention>;

export type ConventionId = keyof typeof CONVENTIONS;

/** Element types that name something a team can adopt or hold. */
export const RADAR_ELIGIBLE_TYPES = ["ApplicationComponent","BusinessProcess","Capability","CourseOfAction","Node","SystemSoftware","TechnologyService"] as const;

/** Element types the Layer 7 Gantt places on a timeline. */
export const SCHEDULABLE_TYPES = ["ImplementationEvent","Plateau","WorkPackage"] as const;

/** Translated element labels, by element type then language tag. */
export const ELEMENT_LABELS_I18N: Record<string, Record<string, string>> = {
  ApplicationComponent: {"de":"Anwendungskomponente"},
  BusinessProcess: {"de":"Geschäftsprozess"},
  Capability: {"de":"Fähigkeit"},
  ImplementationEvent: {"de":"Implementierungsereignis"},
  Node: {"de":"Knoten"},
  Plateau: {"de":"Plateau"},
  SystemSoftware: {"de":"Systemsoftware"},
  WorkPackage: {"de":"Arbeitspaket"},
};
