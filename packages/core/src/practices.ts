import {
  ELEMENTS,
  allowedRelationships,
  isDerived,
} from "@dlab5/archimate-metamodel";
import type { ElementTypeId } from "@dlab5/archimate-metamodel";
import type { AbModel } from "./types.js";
import type { Finding } from "./validate.js";

/**
 * Checks that come from practice rather than from the specification.
 *
 * validateModel answers "is this legal ArchiMate?". These answer "is this a
 * good idea?" — a model can be entirely valid and still be one an experienced
 * modeller would push back on. Everything here is a warning by construction:
 * none of it makes a model wrong.
 *
 * Each rule cites where it comes from. That is deliberate and it is a citation,
 * never a quotation: the published arguments are under copyright, this
 * repository is public, and a reader who wants the reasoning should be sent to
 * the source rather than given a paraphrase of it.
 *
 * Rules live here as TypeScript rather than as SHACL shapes because the ones
 * worth having need Appendix B — "is a more specific relation available
 * between these two element types?" is a question about the relationship
 * matrix, and a SHACL engine cannot see it without the whole matrix being
 * regenerated as shapes. See ADR-0004.
 */

/**
 * Relations that carry no meaning of their own.
 *
 * `association` is the catch-all: permitted between everything, and therefore
 * a statement that the modeller has not decided what the relationship actually
 * is. It is the only one — specialization and the rest all say something.
 */
const VAGUE = new Set(["association"]);

/**
 * Element types that represent a party.
 *
 * A property naming one of these is the case worth flagging: it is a
 * relationship that has been flattened into text.
 */
const PARTY_TYPES = new Set<string>([
  "BusinessActor",
  "BusinessRole",
  "BusinessCollaboration",
  "Stakeholder",
]);

export interface PracticeOptions {
  /**
   * Property keys to check for shadowed elements.
   *
   * Defaults to the ones that name a party. Passing an empty array disables
   * the check rather than silently checking everything, which on a large model
   * would produce a finding for every coincidental string match.
   */
  partyProperties?: readonly string[];
}

/**
 * An association where the language offers something more precise.
 *
 * The association relation is permitted between every pair of concepts, which
 * makes it always available and rarely the right answer: reaching for it is
 * usually a sign the modeller has not worked out what the relation is.
 *
 * There are three cases, and they need different advice:
 *
 *   - **A direct alternative exists.** Name it. WorkPackage to Deliverable
 *     takes a realization, and an association there is simply the weaker
 *     statement.
 *   - **Only DERIVED alternatives exist.** Do not name them — a derived
 *     relation asserted directly is what validateModel's
 *     `derived-relationship` warns about, so recommending one would have this
 *     tool advising exactly what it criticises a line later. What the derived
 *     chain actually says is that an intermediate element is missing:
 *     Application Component to Application Service is derived precisely
 *     because the Application Function between them has not been drawn.
 *   - **Nothing else is permitted.** The association is right; say nothing.
 *
 * The three cases are the three bullets in Mastering ArchiMate §16.2. The
 * first draft of this check collapsed them into one and recommended derived
 * relations; running it against a real 44-element model is what showed it.
 */
function vagueRelations(model: AbModel): Finding[] {
  const byId = new Map(model.elements.map((e) => [e.id, e]));
  const findings: Finding[] = [];

  for (const rel of model.relationships) {
    if (!VAGUE.has(rel.type)) continue;
    const source = byId.get(rel.source);
    const target = byId.get(rel.target);
    if (!source || !target) continue; // validateModel already reports these

    const alternatives = allowedRelationships(source.type, target.type).filter(
      (r) => !VAGUE.has(r)
    );
    if (alternatives.length === 0) continue;

    const direct = alternatives.filter(
      (r) => !isDerived(source.type, r, target.type)
    );

    findings.push(
      direct.length > 0
        ? {
            severity: "warning",
            code: "vague-relationship",
            message:
              `"${source.name}" is associated with "${target.name}", but ` +
              `ArchiMate defines something more precise between a ` +
              `${ELEMENTS[source.type].label} and a ` +
              `${ELEMENTS[target.type].label}: ${direct.join(", ")}. An ` +
              `association where a specific relation exists usually means the ` +
              `relationship has not been decided yet`,
            subject: rel.id,
            source: "Mastering ArchiMate §16.2",
          }
        : {
            severity: "warning",
            code: "association-hides-an-element",
            message:
              `"${source.name}" is associated with "${target.name}". ArchiMate ` +
              `only relates a ${ELEMENTS[source.type].label} to a ` +
              `${ELEMENTS[target.type].label} through an intermediate element, ` +
              `so the association is standing in for something that has not ` +
              `been drawn — usually the behaviour between them`,
            subject: rel.id,
            source: "Mastering ArchiMate §16.2",
          }
    );
  }

  return findings;
}

/**
 * A property whose value names an element that already exists.
 *
 * A property is text. It cannot be traversed, counted, or drawn, and nothing
 * connects it to the element it names — so recording "owner: Platform guild"
 * on a component, while a real Platform guild exists in the model as a
 * BusinessActor, quietly creates two unrelated facts about the same thing.
 *
 * **This deliberately catches our own bp:owner convention.** The overlay
 * documents it as the pragmatic form for a model that has not drawn its
 * organisation yet, which is a fair reason to have it and not a reason to
 * exempt it from the rule. A tool that applied its principles to everyone
 * except itself would be worth less.
 *
 * Cites Mastering ArchiMate §16.3.
 */
function shadowedElements(
  model: AbModel,
  keys: readonly string[]
): Finding[] {
  if (keys.length === 0) return [];

  // Names are matched case-insensitively and trimmed: "Platform guild" and
  // "platform guild " are the same team to a reader, and the point of the
  // check is what a reader would notice.
  const parties = new Map<string, { id: string; name: string; type: string }>();
  for (const el of model.elements) {
    if (!PARTY_TYPES.has(el.type)) continue;
    parties.set(el.name.trim().toLowerCase(), {
      id: el.id,
      name: el.name,
      type: el.type,
    });
  }
  if (parties.size === 0) return [];

  const findings: Finding[] = [];
  for (const el of model.elements) {
    for (const key of keys) {
      const value = el.properties[key]?.trim();
      if (!value) continue;
      const match = parties.get(value.toLowerCase());
      if (!match || match.id === el.id) continue;

      findings.push({
        severity: "warning",
        code: "property-shadows-element",
        message:
          `"${el.name}" records ${key} as "${value}" in a property, and ` +
          `"${match.name}" already exists in this model as a ` +
          `${ELEMENTS[match.type as ElementTypeId].label}. A property cannot ` +
          `be traversed or counted, so the two facts stay unconnected — an ` +
          `assignment relationship would say it once`,
        subject: el.id,
        source: "Mastering ArchiMate §16.3",
      });
    }
  }

  return findings;
}

/**
 * Every practice check, in one pass.
 *
 * Returns the same Finding shape validateModel does, so a caller merges the
 * two lists and the findings panel renders them without knowing the
 * difference.
 */
export function checkPractices(
  model: AbModel,
  options: PracticeOptions = {}
): Finding[] {
  const { partyProperties = ["owner"] } = options;
  return [...vagueRelations(model), ...shadowedElements(model, partyProperties)];
}
