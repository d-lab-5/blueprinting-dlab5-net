import {
  CONVENTIONS,
  ELEMENTS,
  LANGUAGE_VERSION,
  LAYER_LABELS,
  LAYER_ORDER,
  RELATIONSHIPS,
  allowedRelationships,
  elementsByLayer,
  isAllowed,
} from "@dlab5/archimate-metamodel";
import type { ElementTypeId, LayerId } from "@dlab5/archimate-metamodel";

/**
 * Blockly block and toolbox definitions, generated from the ArchiMate
 * metamodel.
 *
 * Same idea as the DHC Modeler's blocklyGenerator.js, which builds its palette
 * from a T-Box: nothing here is hand-written, so re-pinning the ontology
 * regenerates the palette instead of starting an editing job.
 *
 * ## The graph-in-a-tree problem
 *
 * ArchiMate is a graph and Blockly is a tree, so the two have to be bridged
 * deliberately rather than by nesting everything:
 *
 * **Each element is its own top-level block** and declares a Blockly variable
 * typed with its ArchiMate type. That variable is the element's identity, and
 * it is what other blocks refer to. Nesting is not used for identity, because
 * an element referenced from three places cannot be nested in three places.
 *
 * **Relationships are child blocks holding a typed variable reference.** One
 * block per relationship type, with a `field_variable` whose `variableTypes`
 * are exactly the element types the specification permits as targets. Blockly
 * itself then refuses to offer an illegal target, so an invalid relationship
 * is not something the editor rejects afterwards — it is not offerable.
 *
 * That last property is the whole point. A validator that complains after the
 * fact teaches a user that the tool is annoying; a palette that cannot express
 * the mistake teaches them the language.
 */

export interface BlocklyBlockDefinition {
  type: string;
  message0: string;
  args0?: unknown[];
  [key: string]: unknown;
}

export interface BlocklyToolboxCategory {
  kind: "category";
  name: string;
  colour?: string;
  contents: Array<{ kind: "block"; type: string }>;
}

export interface BlocklyToolbox {
  kind: "categoryToolbox";
  contents: BlocklyToolboxCategory[];
}

/** `WorkPackage` -> `am:WorkPackage`. Namespaced like the DHC `dhcb:` blocks. */
export const ELEMENT_BLOCK_PREFIX = "am:";
export const RELATIONSHIP_BLOCK_PREFIX = "amr:";

export const elementBlockType = (type: string) => `${ELEMENT_BLOCK_PREFIX}${type}`;
export const relationshipBlockType = (type: string) =>
  `${RELATIONSHIP_BLOCK_PREFIX}${type}`;

/**
 * The standard ArchiMate layer pastels, as Blockly hex colours.
 *
 * Deliberately the same values as the CSS tokens the rest of the app uses, so
 * a block, a diagram node and a legend swatch agree — and agree with what a
 * reader sees in Archi.
 */
export const DOMAIN_COLOURS: Record<LayerId, string> = {
  motivation: "#ccccff",
  strategy: "#f5deaa",
  business: "#ffffb5",
  application: "#b5ffff",
  technology: "#c9e7b7",
  physical: "#c9e7b7",
  implementation: "#ffe0e0",
  composite: "#e8e8e8",
};

/**
 * Convention properties offered as fields on an element block, keyed by the
 * element types they make sense for.
 *
 * Read from the generated overlay rather than listed here, so adding a
 * convention to the ontology adds a field to the palette. A property with an
 * `sh:in` list becomes a dropdown; anything else a text field.
 */
function conventionFields(type: ElementTypeId): unknown[] {
  const fields: unknown[] = [];
  // Dates only make sense on something with a duration or a moment. `status`
  // is offered everywhere: a Gap is open or closed, a Deliverable is done or
  // planned, and withholding the field was silently dropping the value on a
  // round trip.
  const dateable =
    type === "WorkPackage" ||
    type === "ImplementationEvent" ||
    type === "Plateau";

  for (const convention of Object.values(CONVENTIONS)) {
    const key = convention.propertyKey;
    const isDate = key === "startDate" || key === "endDate";
    if (isDate && !dateable) continue;
    if (!isDate && key !== "status" && !RADAR_KEYS.has(key)) continue;

    fields.push(
      convention.values
        ? {
            type: "field_dropdown",
            name: key,
            options: [
              ["—", ""],
              ...convention.values.map((v) => [v, v] as [string, string]),
            ],
          }
        : { type: "field_input", name: key, text: "" }
    );
  }
  return fields;
}

const RADAR_KEYS = new Set(["radarRing", "radarMoved"]);

/**
 * One block per element type.
 *
 * The block declares a variable of its own ArchiMate type — that is the
 * element's identity in the workspace — plus a name, any convention fields
 * that apply, and a statement input for its outgoing relationships.
 */
export function generateElementBlocks(): BlocklyBlockDefinition[] {
  return (Object.keys(ELEMENTS) as ElementTypeId[]).sort().map((type) => {
    const element = ELEMENTS[type];
    const fields = conventionFields(type);

    const block: BlocklyBlockDefinition = {
      type: elementBlockType(type),
      // The variable field is first: it is the element's identity, and every
      // reference elsewhere in the workspace points at it.
      message0: `${element.label} %1`,
      args0: [
        {
          type: "field_variable",
          name: "ID",
          variable: element.label,
          variableTypes: [type],
          defaultType: type,
        },
      ],
      message1: "documentation %1",
      args1: [{ type: "field_input", name: "documentation", text: "" }],
      colour: DOMAIN_COLOURS[element.layer],
      tooltip: element.comment,
      helpUrl: element.iri,
      // The ontology anchor, in the same place DHC puts it, so a serialiser
      // can recover the type without parsing the block type string.
      data: `archimate:${type}`,
      // Top-level and stackable. Elements are peers; nesting is not identity.
      previousStatement: "archimate:Element",
      nextStatement: "archimate:Element",
    };

    let slot = 2;

    // Anything the block set does not model, carried verbatim.
    //
    // Property keys are user-defined — the forms editor and the MCP server can
    // both write arbitrary ones — so a block with a fixed field set will always
    // meet properties it has no home for. Without this they vanish on a round
    // trip, which is data loss disguised as a rendering choice. Normally empty
    // and therefore invisible.
    fields.push({ type: "field_input", name: "otherProperties", text: "" });

    if (fields.length) {
      block[`message${slot}`] = fields.map((_, i) => `%${i + 1}`).join(" ");
      block[`args${slot}`] = fields;
      slot++;
    }

    // Only offered when the element type can actually be a relationship
    // source, which every element type can — but the check keeps the
    // generator honest if a future language version changes that.
    if (canBeSource(type)) {
      block[`message${slot}`] = "relationships %1";
      block[`args${slot}`] = [
        { type: "input_statement", name: "relationships", check: "archimate:Relationship" },
      ];
    }

    return block;
  });
}

function canBeSource(type: ElementTypeId): boolean {
  return (Object.keys(ELEMENTS) as ElementTypeId[]).some(
    (target) => allowedRelationships(type, target).length > 0
  );
}

/**
 * One block per relationship type.
 *
 * `variableTypes` is every element type the specification permits as a target
 * of this relationship from any source. That is wider than the truth for a
 * specific source, which a connection check narrows at connect time — see
 * checkRelationshipBlock. Blockly cannot vary a block's variableTypes per
 * parent, so the two-stage check is the honest way to get precision without
 * generating 60 x 11 blocks.
 */
export function generateRelationshipBlocks(): BlocklyBlockDefinition[] {
  return Object.keys(RELATIONSHIPS)
    .sort()
    .map((rel) => {
      const targets = (Object.keys(ELEMENTS) as ElementTypeId[]).filter((target) =>
        (Object.keys(ELEMENTS) as ElementTypeId[]).some((source) =>
          isAllowed(source, rel as never, target)
        )
      );
      return {
        type: relationshipBlockType(rel),
        message0: `${RELATIONSHIPS[rel as keyof typeof RELATIONSHIPS].label} %1`,
        args0: [
          {
            type: "field_variable",
            name: "TARGET",
            variableTypes: targets,
            defaultType: targets[0],
          },
        ],
        colour: "#9aa5b1",
        tooltip: RELATIONSHIPS[rel as keyof typeof RELATIONSHIPS].comment,
        data: `archimate:${rel}`,
        previousStatement: "archimate:Relationship",
        nextStatement: "archimate:Relationship",
      } satisfies BlocklyBlockDefinition;
    });
}

export function generateBlocks(): BlocklyBlockDefinition[] {
  return [...generateElementBlocks(), ...generateRelationshipBlocks()];
}

/**
 * A toolbox with one category per ArchiMate domain, plus relationships.
 *
 * Domains come out in specification order, so the palette reads top-down the
 * way the language is presented.
 */
export function generateToolbox(domains?: LayerId[]): BlocklyToolbox {
  const wanted = domains ?? LAYER_ORDER;
  const categories: BlocklyToolboxCategory[] = wanted
    .filter((layer) => elementsByLayer(layer).length > 0)
    .map((layer) => ({
      kind: "category" as const,
      name: LAYER_LABELS[layer],
      colour: DOMAIN_COLOURS[layer],
      contents: elementsByLayer(layer).map((e) => ({
        kind: "block" as const,
        type: elementBlockType(e.id),
      })),
    }));

  categories.push({
    kind: "category",
    name: "Relationships",
    colour: "#9aa5b1",
    contents: Object.keys(RELATIONSHIPS)
      .sort()
      .map((rel) => ({ kind: "block" as const, type: relationshipBlockType(rel) })),
  });

  return { kind: "categoryToolbox", contents: categories };
}

/** Provenance, so a generated artefact can say what produced it. */
export function generationInfo() {
  return {
    archimateVersion: LANGUAGE_VERSION,
    elementBlocks: Object.keys(ELEMENTS).length,
    relationshipBlocks: Object.keys(RELATIONSHIPS).length,
  };
}
