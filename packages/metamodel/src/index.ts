/**
 * The ArchiMate 3.2 metamodel, as data.
 *
 * Everything here is derived from the pinned ontology in `ontology/upstream/`
 * by `scripts/gen-metamodel.mjs`. Nothing in this package is hand-maintained,
 * and nothing downstream should hard-code an element type, a layer or a
 * relationship rule: this module is the single place the specification enters
 * the codebase.
 */
export {
  ELEMENTS,
  LAYER_ORDER,
  LAYER_LABELS,
  type ElementType,
  type ElementTypeId,
  type LayerId,
} from "./generated/elements.js";

export {
  RELATIONSHIPS,
  LETTER_TO_RELATIONSHIP,
  type RelationshipType,
  type RelationshipTypeId,
} from "./generated/relationships.js";

export { MATRIX } from "./generated/matrix.js";

import { ELEMENTS, LAYER_ORDER } from "./generated/elements.js";
import type {
  ElementType,
  ElementTypeId,
  LayerId,
} from "./generated/elements.js";
import {
  RELATIONSHIPS,
  LETTER_TO_RELATIONSHIP,
} from "./generated/relationships.js";
import type { RelationshipTypeId } from "./generated/relationships.js";
import { MATRIX } from "./generated/matrix.js";

/** Every element type id, in a stable order. */
export const ELEMENT_TYPE_IDS = Object.keys(ELEMENTS) as ElementTypeId[];

/** Every relationship type id, in a stable order. */
export const RELATIONSHIP_TYPE_IDS = Object.keys(
  RELATIONSHIPS
) as RelationshipTypeId[];

/** Reverse of LETTER_TO_RELATIONSHIP, built once. */
const RELATIONSHIP_TO_LETTER: Record<string, string> = Object.fromEntries(
  Object.entries(LETTER_TO_RELATIONSHIP).map(([letter, id]) => [id, letter])
);

/** Element types belonging to one layer, in declaration order. */
export function elementsByLayer(layer: LayerId): ElementType[] {
  return ELEMENT_TYPE_IDS.map((id) => ELEMENTS[id]).filter(
    (e) => e.layer === layer
  );
}

export function layerOf(element: ElementTypeId): LayerId {
  return ELEMENTS[element].layer;
}

/** Element types grouped by layer, layers in specification order. */
export function elementsGroupedByLayer(): Array<{
  layer: LayerId;
  elements: ElementType[];
}> {
  return LAYER_ORDER.map((layer) => ({
    layer,
    elements: elementsByLayer(layer),
  })).filter((g) => g.elements.length > 0);
}

/**
 * The raw Appendix B cell for an ordered pair, or "" when the specification
 * permits nothing between them in that direction.
 */
function cell(source: string, target: string): string {
  return MATRIX[source]?.[target] ?? "";
}

/**
 * Does the specification permit `source --relationship--> target`?
 *
 * Direction matters. `isAllowed("WorkPackage", "realization", "Deliverable")`
 * is true; the reverse is not.
 */
export function isAllowed(
  source: string,
  relationship: RelationshipTypeId,
  target: string
): boolean {
  const letter = RELATIONSHIP_TO_LETTER[relationship];
  if (!letter) return false;
  const permitted = cell(source, target);
  return permitted.includes(letter) || permitted.includes(letter.toUpperCase());
}

/**
 * Is the relationship *derived* rather than directly permitted?
 *
 * A derived relationship is valid to assert but is implied by a chain of
 * others — Appendix B writes it lowercase. Editors may want to offer direct
 * relationships first and derived ones behind a disclosure.
 *
 * Returns false when the relationship is not permitted at all; check
 * `isAllowed` first if you need to tell those cases apart.
 */
export function isDerived(
  source: string,
  relationship: RelationshipTypeId,
  target: string
): boolean {
  const letter = RELATIONSHIP_TO_LETTER[relationship];
  if (!letter) return false;
  const permitted = cell(source, target);
  return permitted.includes(letter) && !permitted.includes(letter.toUpperCase());
}

/** Every relationship permitted from `source` to `target`, in a stable order. */
export function allowedRelationships(
  source: string,
  target: string
): RelationshipTypeId[] {
  const permitted = cell(source, target);
  return RELATIONSHIP_TYPE_IDS.filter((id) => {
    const letter = RELATIONSHIP_TO_LETTER[id];
    return (
      permitted.includes(letter) || permitted.includes(letter.toUpperCase())
    );
  });
}

/**
 * Every element type that may be the target of `relationship` from `source`.
 *
 * This is what a relationship editor's target dropdown is filtered by, and
 * what a Blockly `field_variable`'s `variableTypes` is generated from — so an
 * illegal relationship cannot be expressed rather than merely being rejected
 * after the fact.
 */
export function allowedTargets(
  source: string,
  relationship: RelationshipTypeId
): ElementTypeId[] {
  return ELEMENT_TYPE_IDS.filter((target) =>
    isAllowed(source, relationship, target)
  );
}

/** Every element type that may be the source of `relationship` into `target`. */
export function allowedSources(
  relationship: RelationshipTypeId,
  target: string
): ElementTypeId[] {
  return ELEMENT_TYPE_IDS.filter((source) =>
    isAllowed(source, relationship, target)
  );
}

/** True when `id` names a real ArchiMate element type. */
export function isElementType(id: string): id is ElementTypeId {
  return Object.prototype.hasOwnProperty.call(ELEMENTS, id);
}

/** True when `id` names a real ArchiMate relationship type. */
export function isRelationshipType(id: string): id is RelationshipTypeId {
  return Object.prototype.hasOwnProperty.call(RELATIONSHIPS, id);
}

