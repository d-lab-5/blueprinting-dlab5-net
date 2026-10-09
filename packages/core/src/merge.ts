import { uniqueId } from "./iri.js";
import type { AbElement, AbModel, AbRelationship } from "./types.js";

/**
 * Several models into one, adding and never overwriting.
 *
 * Elements are matched by id, which is descriptive and scoped to a project,
 * so the same element in two files is the same element. Relationship ids are
 * NOT descriptive: model files number them r1, r2, …, so the same id in two
 * files names two different relationships. They are matched by what they
 * connect instead — type, source and target — and a new one gets the id
 * add_relationship would give it, `<source>-<type>-<target>`.
 *
 * An element present on both sides with different content is a conflict. It
 * is reported and the merge does not happen: which version is right is a
 * decision, and a merge that picked one would make it silently.
 */

export interface MergeConflict {
  id: string;
  existing: AbElement;
  incoming: AbElement;
}

export interface MergeResult {
  model: AbModel;
  addedElements: number;
  addedRelationships: number;
  skippedElements: number;
  skippedRelationships: number;
  conflicts: MergeConflict[];
}

const sameElement = (a: AbElement, b: AbElement) =>
  a.type === b.type &&
  a.name === b.name &&
  (a.documentation ?? "") === (b.documentation ?? "") &&
  JSON.stringify(sortKeys(a.properties)) === JSON.stringify(sortKeys(b.properties));

function sortKeys(o: Record<string, string>) {
  return Object.fromEntries(Object.entries(o ?? {}).sort(([x], [y]) => x.localeCompare(y)));
}

const edge = (r: AbRelationship) => `${r.type}|${r.source}|${r.target}`;

export function mergeModels(current: AbModel, incoming: AbModel[]): MergeResult {
  const elements = new Map(current.elements.map((e) => [e.id, e]));
  const relationships = [...current.relationships];
  const edges = new Set(relationships.map(edge));
  const conflicts: MergeConflict[] = [];
  let addedElements = 0;
  let skippedElements = 0;
  let addedRelationships = 0;
  let skippedRelationships = 0;

  for (const model of incoming) {
    for (const element of model.elements) {
      const existing = elements.get(element.id);
      if (!existing) {
        elements.set(element.id, element);
        addedElements++;
      } else if (sameElement(existing, element)) {
        skippedElements++;
      } else {
        conflicts.push({ id: element.id, existing, incoming: element });
      }
    }
  }

  for (const model of incoming) {
    for (const relationship of model.relationships) {
      if (edges.has(edge(relationship))) {
        skippedRelationships++;
        continue;
      }
      const id = uniqueId(
        `${relationship.source}-${relationship.type}-${relationship.target}`,
        relationships.map((r) => r.id)
      );
      relationships.push({ ...relationship, id });
      edges.add(edge(relationship));
      addedRelationships++;
    }
  }

  return {
    model: { ...current, elements: [...elements.values()], relationships },
    addedElements,
    addedRelationships,
    skippedElements,
    skippedRelationships,
    conflicts,
  };
}
