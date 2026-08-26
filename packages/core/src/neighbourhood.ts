import type { AbModel, AbRelationship } from "./types.js";

/**
 * What connects to and from one element, within a few hops.
 *
 * A model of any size is unreadable whole. The question a reader actually has
 * is "what touches this?", and neither the layer filter on the diagram views
 * nor the Gantt answers it.
 *
 * Lifted out of the MCP server's `query_elements`, which had the only
 * implementation. An agent asking "what depends on this component?" and a
 * person clicking an element are asking the same question, and the answer
 * should not depend on which one asked.
 *
 * **Direction is not followed.** A relationship is traversed both ways, because
 * "what touches this" includes what points at it. Direction is preserved in
 * the returned relationships so a caller can still draw the arrow correctly.
 */

export interface Neighbourhood {
  /** The element the walk started from. */
  start: string;
  /** Hops from the start, including the start itself at 0. */
  distance: Map<string, number>;
  /** Every relationship with both ends inside the neighbourhood. */
  relationships: AbRelationship[];
}

/** Hops are clamped to this; beyond it a neighbourhood is the whole model. */
export const MAX_DEPTH = 5;

export function neighbourhood(
  model: AbModel,
  start: string,
  depth = 1
): Neighbourhood {
  const distance = new Map<string, number>();

  const exists = model.elements.some((e) => e.id === start);
  if (!exists) {
    // An id that is not in the model yields an empty neighbourhood rather than
    // throwing: a stale selection is a normal thing for a UI to hold.
    return { start, distance, relationships: [] };
  }

  distance.set(start, 0);
  const hops = Math.max(1, Math.min(MAX_DEPTH, Math.floor(depth) || 1));

  for (let hop = 1; hop <= hops; hop++) {
    // Collected per pass and merged after, never during. Adding to the set
    // while iterating lets an element found in this pass be followed in the
    // same one, which quietly turns one hop into a full transitive closure.
    const found = new Set<string>();
    for (const rel of model.relationships) {
      if (distance.has(rel.source) && !distance.has(rel.target)) {
        found.add(rel.target);
      }
      if (distance.has(rel.target) && !distance.has(rel.source)) {
        found.add(rel.source);
      }
    }
    if (found.size === 0) break;
    for (const id of found) distance.set(id, hop);
  }

  const relationships = model.relationships.filter(
    (r) => distance.has(r.source) && distance.has(r.target)
  );

  return { start, distance, relationships };
}
