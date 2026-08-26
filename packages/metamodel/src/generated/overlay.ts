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
  /**
   * Element types this convention is meaningful on, or null for all of them.
   *
   * An editor that offers an end date on a Gap is offering nonsense, and the
   * answer to which types take which property belongs beside the term in the
   * ontology rather than in a list inside a form component — so the editor,
   * the Blockly palette and the MCP server all learn it from one place.
   */
  readonly appliesTo: readonly string[] | null;
}

/**
 * The ArchiMate specification version the pinned ontology expresses.
 *
 * Every model written by this platform is stamped with it, so an export can
 * name what it conforms to rather than leaving a reader to guess. See ADR-0007.
 */
export const LANGUAGE_VERSION = "3.2";

export const CONVENTIONS = {
  cost: {
    term: "cost",
    propertyKey: "cost",
    label: "Cost",
    comment: "Forecast cost of a work package, as a bare number. The currency is a property of the project rather than of each element: a mixed-currency roll-up needs conversion rates and a date to convert on, which is a different feature from the one this serves. Like bp:debt it is an estimate, and rolling it up over sub-packages is arithmetic on estimates — useful for comparison, not for a budget.",
    values: null,
    defaultValue: null,
    appliesTo: ["WorkPackage"],
  },
  debt: {
    term: "debt",
    propertyKey: "debt",
    label: "Technical debt",
    comment: "A number from 0 to 1, where 0 is clean and 1 is unsustainable. Deliberately coarse and deliberately a judgement: it is an architect's assessment for sorting and colouring, not a measurement, and treating it as one would be false precision.",
    values: null,
    defaultValue: null,
    appliesTo: null,
  },
  endDate: {
    term: "endDate",
    propertyKey: "endDate",
    label: "End date",
    comment: "ISO 8601 date. Work packages only — see bp:startDate for why an event and a plateau do not have one.",
    values: null,
    defaultValue: null,
    appliesTo: ["WorkPackage"],
  },
  instances: {
    term: "instances",
    propertyKey: "instances",
    label: "Instances",
    comment: "The repositories that prove a pattern. Promotion requires a second instance — one instance is a decision, not a pattern — and keeping the evidence in the data is what stops that bar quietly slipping.",
    values: null,
    defaultValue: null,
    appliesTo: null,
  },
  owner: {
    term: "owner",
    propertyKey: "owner",
    label: "Owner",
    comment: "The team accountable for this element. A free-text team name rather than a person: people move, and an element with a former employee's name on it is worse than one with none. ArchiMate can model this properly as a BusinessRole with an assignment, and a mature model should; this property is the pragmatic form for a model that has not drawn its organisation yet.",
    values: null,
    defaultValue: null,
    appliesTo: null,
  },
  radarMoved: {
    term: "radarMoved",
    propertyKey: "radarMoved",
    label: "Radar movement",
    comment: "Movement since the previous radar.",
    values: ["in","out","none"],
    defaultValue: "none",
    appliesTo: null,
  },
  radarRing: {
    term: "radarRing",
    propertyKey: "radarRing",
    label: "Radar ring",
    comment: "Adoption status. Presence of this property is what puts an element on the radar.",
    values: ["adopt","trial","assess","hold"],
    defaultValue: null,
    appliesTo: null,
  },
  reference: {
    term: "reference",
    propertyKey: "reference",
    label: "Reference",
    comment: "Where the detail lives: an ADR path, a Claude Code skill name, or a package. ArchiMate says what applies and why; the reference says how.",
    values: null,
    defaultValue: null,
    appliesTo: null,
  },
  startDate: {
    term: "startDate",
    propertyKey: "startDate",
    label: "Start date",
    comment: "ISO 8601 date. Read by the Layer 7 Gantt. An ImplementationEvent carries this and no end date: it is a moment, not a duration. A Plateau carries neither — its date is DERIVED from the work packages that realise it, because a state is reached when the work bringing it about finishes, and storing that separately only creates something to contradict.",
    values: null,
    defaultValue: null,
    appliesTo: ["WorkPackage","ImplementationEvent"],
  },
  status: {
    term: "status",
    propertyKey: "status",
    label: "Status",
    comment: "Drives the Gantt bar style. Anything outside this list renders untagged.",
    values: ["planned","in-progress","done","at-risk","open","closed"],
    defaultValue: null,
    appliesTo: null,
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
