import type { AbElement, AbModel, AbRelationship } from "../types.js";

/**
 * What importing a document would do to a model, before it does it.
 *
 * This exists separately from the parser because the interesting half of
 * intake is not reading the document — it is deciding what a SECOND reading of
 * a revised document means. Three cases, and only two are easy:
 *
 *   in the document, not in the model    create
 *   in both, identical                   nothing
 *   in both, different                   the document and the model disagree
 *
 * The third cannot be settled by a rule. `seed --merge` never overwrites,
 * because "overwriting would silently discard edits made in the app"; a
 * document re-import wants the opposite. So the disagreement is reported per
 * element and someone chooses.
 *
 * **Matching is by id, never by position or name.** `GanttImport` renames on
 * collision — `while (taken.has(id)) id = ...` — which is right for adding a
 * chart and catastrophic here: it would create a second CFO on every import of
 * the same document.
 *
 * **Nothing is ever deleted.** An element disappearing from a revised document
 * is not evidence that it should leave the model; the section may have been
 * cut for length, or moved to another document. Orphans are reported.
 */

export type ChangeKind = "create" | "update" | "unchanged";

export interface ElementChange {
  kind: ChangeKind;
  /** What the document says. */
  incoming: AbElement;
  /** What the model holds, when there is something to compare. */
  existing?: AbElement;
  /** Which fields differ — "name", "documentation", "type", or a property key. */
  differing: string[];
}

export interface RelationshipChange {
  kind: "create" | "unchanged";
  incoming: AbRelationship;
}

export interface ImportPlan {
  elements: ElementChange[];
  relationships: RelationshipChange[];
  /**
   * Elements the model holds that carry this document's id but are no longer
   * in it. Reported, never removed.
   */
  orphaned: AbElement[];
  /** A type change is refused rather than offered — see `planImport`. */
  refused: Array<{ incoming: AbElement; existing: AbElement; reason: string }>;
}

const SOURCE_DOCUMENT = "sourceDocument";

/** Fields that differ between what the document says and what the model holds. */
function differingFields(incoming: AbElement, existing: AbElement): string[] {
  const out: string[] = [];
  if (incoming.name !== existing.name) out.push("name");
  if ((incoming.documentation ?? "") !== (existing.documentation ?? "")) {
    out.push("documentation");
  }
  for (const [key, value] of Object.entries(incoming.properties)) {
    // sourceSection changing is a consequence of a renamed heading, not an
    // edit anyone made to the model. It is carried, but it is not a conflict
    // worth putting in front of someone.
    if (key === "sourceSection" || key === SOURCE_DOCUMENT) continue;
    if (existing.properties[key] !== value) out.push(key);
  }
  return out;
}

export function planImport(
  current: AbModel,
  incoming: AbModel,
  documentId?: string
): ImportPlan {
  const currentById = new Map(current.elements.map((e) => [e.id, e]));

  const elements: ElementChange[] = [];
  const refused: ImportPlan["refused"] = [];

  for (const el of incoming.elements) {
    const existing = currentById.get(el.id);
    if (!existing) {
      elements.push({ kind: "create", incoming: el, differing: [] });
      continue;
    }

    // Changing an element's type is not an edit — it is a different element
    // wearing the same id, and applying it would silently invalidate every
    // relationship the old one takes part in. Refused, and said out loud.
    if (existing.type !== el.type) {
      refused.push({
        incoming: el,
        existing,
        reason:
          `"${el.id}" is a ${existing.type} in the model and a ${el.type} in ` +
          `the document. Changing an element's type would invalidate its ` +
          `relationships; give the new element a different id.`,
      });
      continue;
    }

    const differing = differingFields(el, existing);
    elements.push({
      kind: differing.length ? "update" : "unchanged",
      incoming: el,
      existing,
      differing,
    });
  }

  const currentRelIds = new Set(current.relationships.map((r) => r.id));
  const relationships: RelationshipChange[] = incoming.relationships.map((r) => ({
    kind: currentRelIds.has(r.id) ? "unchanged" : "create",
    incoming: r,
  }));

  // Orphans are found by the property the importer stamps, which is why every
  // imported element carries it. Without it there is no way to tell an element
  // this document created from one somebody drew by hand.
  const inDocument = new Set(incoming.elements.map((e) => e.id));
  const orphaned = documentId
    ? current.elements.filter(
        (e) => e.properties[SOURCE_DOCUMENT] === documentId && !inDocument.has(e.id)
      )
    : [];

  return { elements, relationships, orphaned, refused };
}

/**
 * Applies a plan, taking only the changes named in `accept`.
 *
 * Creates and updates are both opt-in by id, so "import everything except that
 * one paragraph someone fixed in the app" is expressible. Anything not named
 * is left exactly as it was.
 */
export function applyImport(
  current: AbModel,
  plan: ImportPlan,
  accept: Set<string>
): AbModel {
  const byId = new Map(current.elements.map((e) => [e.id, e]));

  for (const change of plan.elements) {
    if (change.kind === "unchanged") continue;
    if (!accept.has(change.incoming.id)) continue;

    const existing = byId.get(change.incoming.id);
    if (!existing) {
      byId.set(change.incoming.id, change.incoming);
      continue;
    }

    // Properties are merged, not replaced. An element may carry `owner`,
    // `debt` or a radar ring that the document knows nothing about, and an
    // import that silently dropped them would destroy work in a way nobody
    // would notice until the radar emptied.
    byId.set(change.incoming.id, {
      ...existing,
      name: change.incoming.name,
      documentation: change.incoming.documentation ?? existing.documentation,
      properties: { ...existing.properties, ...change.incoming.properties },
    });
  }

  const relById = new Map(current.relationships.map((r) => [r.id, r]));
  for (const change of plan.relationships) {
    if (change.kind !== "create") continue;
    if (!accept.has(change.incoming.id)) continue;
    relById.set(change.incoming.id, change.incoming);
  }

  return {
    ...current,
    elements: [...byId.values()],
    relationships: [...relById.values()],
  };
}

/** Every id a plan could apply, for an "accept all" that is still explicit. */
export function everyChange(plan: ImportPlan): Set<string> {
  return new Set([
    ...plan.elements.filter((c) => c.kind !== "unchanged").map((c) => c.incoming.id),
    ...plan.relationships.filter((c) => c.kind === "create").map((c) => c.incoming.id),
  ]);
}
