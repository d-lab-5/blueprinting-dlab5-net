// GENERATED FILE — DO NOT EDIT.
//
// Produced by scripts/gen-metamodel.mjs from the ontology pinned at
// a0f6e86bf6f211ab07d712ff16c8c8adb9471dd4. To change anything here, change the ontology pin or the
// generator and run `npm run gen:metamodel`.

export interface RelationshipType {
  /** lowerCamelCase local name, e.g. "realization". */
  readonly id: string;
  readonly label: string;
  readonly comment: string;
  readonly iri: string;
}

export const RELATIONSHIPS = {
  access: {
    id: "access",
    label: "access",
    comment: "Models access of behavior elements to passive structure elements.",
    iri: "https://purl.org/archimate#access",
  },
  aggregation: {
    id: "aggregation",
    label: "aggregation",
    comment: "Models a whole-part relationship where parts can exist independently.",
    iri: "https://purl.org/archimate#aggregation",
  },
  assignment: {
    id: "assignment",
    label: "assignment",
    comment: "Links active structure elements with behavior that they perform or roles they fulfill.",
    iri: "https://purl.org/archimate#assignment",
  },
  association: {
    id: "association",
    label: "association",
    comment: "Models a relationship not covered by other specific relationship types.",
    iri: "https://purl.org/archimate#association",
  },
  composition: {
    id: "composition",
    label: "composition",
    comment: "Models a whole-part relationship where parts cannot exist without the whole.",
    iri: "https://purl.org/archimate#composition",
  },
  flow: {
    id: "flow",
    label: "flow",
    comment: "Models transfer of information, materials, or energy between behavior elements.",
    iri: "https://purl.org/archimate#flow",
  },
  influence: {
    id: "influence",
    label: "influence",
    comment: "Models how one element influences another element.",
    iri: "https://purl.org/archimate#influence",
  },
  realization: {
    id: "realization",
    label: "realization",
    comment: "Indicates that an entity realizes or implements another entity.",
    iri: "https://purl.org/archimate#realization",
  },
  serving: {
    id: "serving",
    label: "serving",
    comment: "Models that an element provides functionality to another element.",
    iri: "https://purl.org/archimate#serving",
  },
  specialization: {
    id: "specialization",
    label: "Specialization",
    comment: "Instance-level ArchiMate relationship: an element is a particular kind of another element of the same type (spec Section 5.4). For class-level profile declarations, use archimate:profileSpecialization instead.",
    iri: "https://purl.org/archimate#specialization",
  },
  triggering: {
    id: "triggering",
    label: "triggering",
    comment: "Models temporal or causal relationships where one behavior triggers another.",
    iri: "https://purl.org/archimate#triggering",
  },
} as const satisfies Record<string, RelationshipType>;

export type RelationshipTypeId = keyof typeof RELATIONSHIPS;

/**
 * The single-letter codes used by the matrix. Uppercase means the relationship
 * is direct; lowercase means it is derived.
 */
export const LETTER_TO_RELATIONSHIP: Record<string, RelationshipTypeId> = {
  "a": "access",
  "c": "composition",
  "f": "flow",
  "g": "aggregation",
  "i": "assignment",
  "n": "influence",
  "o": "association",
  "r": "realization",
  "s": "specialization",
  "t": "triggering",
  "v": "serving"
};
