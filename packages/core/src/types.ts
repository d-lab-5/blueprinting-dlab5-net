import type {
  ElementTypeId,
  RelationshipTypeId,
} from "@dlab5/archimate-metamodel";

/**
 * ArchiMate Properties — the specification's own key/value escape hatch
 * (section 2.2). Scheduling data lives here rather than in bespoke fields,
 * because this is what round-trips through the Open Exchange format into
 * Archi: `startDate`, `endDate`, `status`, `progress`.
 */
export type Properties = Record<string, string>;

export interface AbElement {
  /** Stable within a project. Appears in the IRI and survives edits. */
  id: string;
  type: ElementTypeId;
  name: string;
  documentation?: string;
  properties: Properties;
}

export interface AbRelationship {
  id: string;
  type: RelationshipTypeId;
  /** Element id, not IRI. */
  source: string;
  /** Element id, not IRI. */
  target: string;
  name?: string;
  documentation?: string;
  properties: Properties;
}

/** One project's ArchiMate ABox: the whole graph, as read from its .ttl. */
export interface AbModel {
  projectSlug: string;
  elements: AbElement[];
  relationships: AbRelationship[];
}

export function emptyModel(projectSlug: string): AbModel {
  return { projectSlug, elements: [], relationships: [] };
}
