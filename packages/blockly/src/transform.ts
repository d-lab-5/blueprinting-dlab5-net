import { ELEMENTS, isAllowed, isElementType, isRelationshipType } from "@dlab5/archimate-metamodel";
import type { AbElement, AbModel, AbRelationship } from "@dlab5/blueprint-core";
import { uniqueId } from "@dlab5/blueprint-core";
import {
  ELEMENT_BLOCK_PREFIX,
  RELATIONSHIP_BLOCK_PREFIX,
  elementBlockType,
  generateElementBlocks,
  relationshipBlockType,
} from "./generate.js";

/**
 * What each generated element block can actually hold, per element type.
 *
 * A dropdown field records its permitted options, because Blockly silently
 * discards a value that is not one of them — which looked exactly like data
 * loss when a Gap carrying `status: "open"` came back empty. Anything a field
 * cannot represent goes into the carrier instead.
 */
interface FieldCapability {
  /** Permitted values for a dropdown; null for a free-text field. */
  options: Set<string> | null;
}

const MODELLED_FIELDS = new Map<string, Map<string, FieldCapability>>();
for (const def of generateElementBlocks()) {
  const fields = new Map<string, FieldCapability>();
  for (const key of Object.keys(def)) {
    if (!key.startsWith("args")) continue;
    for (const arg of def[key] as Array<{
      name?: string;
      type?: string;
      options?: Array<[string, string]>;
    }>) {
      if (!arg?.name) continue;
      fields.set(arg.name, {
        options:
          arg.type === "field_dropdown" && arg.options
            ? new Set(arg.options.map(([, value]) => value))
            : null,
      });
    }
  }
  MODELLED_FIELDS.set(def.type.slice(ELEMENT_BLOCK_PREFIX.length), fields);
}

/** True when this element type's block can hold that exact value in that field. */
function fieldCanHold(type: string, key: string, value: string): boolean {
  const field = MODELLED_FIELDS.get(type)?.get(key);
  if (!field) return false;
  return field.options === null || field.options.has(value);
}

/**
 * Between a Blockly workspace and an ArchiMate ABox.
 *
 * **The ABox is the source of truth and the workspace is derived.** The
 * workspace is regenerated from the model on every load and never persisted as
 * the record. This is not a style preference: the DHC Blockly harness records
 * in its own README that loading a saved workspace is schema-fragile — a file
 * saved against older block definitions stops opening — and names "persist the
 * A-Box, regenerate the workspace" as the fix. Since our block definitions are
 * generated from an ontology that will be re-pinned, that fragility is
 * guaranteed rather than hypothetical.
 *
 * It is also the only coherent option here, because the same .ttl is written
 * by the forms editor, by the MCP server, by Archi and by hand.
 *
 * These functions work on Blockly's serialization JSON rather than on a live
 * workspace, so they need no DOM and are testable in Node.
 */

/** Blockly's workspace serialization, narrowed to what we read and write. */
export interface WorkspaceState {
  variables?: Array<{ name: string; id: string; type?: string }>;
  blocks?: { languageVersion: number; blocks: BlockState[] };
}

interface BlockState {
  type: string;
  id?: string;
  x?: number;
  y?: number;
  fields?: Record<string, unknown>;
  inputs?: Record<string, { block?: BlockState }>;
  next?: { block?: BlockState };
  [key: string]: unknown;
}

/** Layout: elements are laid out in a column per domain. */
const COLUMN_WIDTH = 320;
const ROW_HEIGHT = 140;

/**
 * Builds a workspace from a model.
 *
 * Every element becomes a top-level block declaring a Blockly variable of its
 * ArchiMate type; every relationship becomes a child block referring to the
 * target's variable. Variable ids are the element ids, which makes the mapping
 * back trivial and stable across regenerations.
 */
export function aboxToWorkspace(model: AbModel): WorkspaceState {
  // A variable per element, typed with its ArchiMate type. Blockly matches a
  // field_variable's variableTypes against this, which is what stops an
  // illegal target being offered at all.
  const variables = model.elements.map((el) => ({
    name: el.name,
    id: el.id,
    type: el.type,
  }));

  const outgoing = new Map<string, AbRelationship[]>();
  for (const rel of model.relationships) {
    const list = outgoing.get(rel.source) ?? [];
    list.push(rel);
    outgoing.set(rel.source, list);
  }

  // Grouped by domain so the workspace opens readable rather than as one column.
  const columns = new Map<string, number>();
  const blocks: BlockState[] = model.elements.map((el) => {
    const domain = ELEMENTS[el.type].layer;
    const row = columns.get(domain) ?? 0;
    columns.set(domain, row + 1);
    const column = [...columns.keys()].indexOf(domain);

    const fields: Record<string, unknown> = { ID: { id: el.id } };
    if (el.documentation) fields.documentation = el.documentation;

    // Properties the block has a dedicated field for go into it; everything
    // else rides in otherProperties so nothing is lost. `modelled` is derived
    // from the generated block definition rather than listed here, so the two
    // cannot drift apart.
    const other: Record<string, string> = {};
    for (const [key, value] of Object.entries(el.properties)) {
      if (fieldCanHold(el.type, key, value)) fields[key] = value;
      else other[key] = value;
    }
    if (Object.keys(other).length) fields.otherProperties = JSON.stringify(other);

    const block: BlockState = {
      type: elementBlockType(el.type),
      id: el.id,
      x: column * COLUMN_WIDTH,
      y: row * ROW_HEIGHT,
      fields,
    };

    const rels = outgoing.get(el.id) ?? [];
    if (rels.length) {
      block.inputs = {
        relationships: { block: chainRelationships(rels) },
      };
    }
    return block;
  });

  return {
    variables,
    blocks: { languageVersion: 0, blocks },
  };
}

/** Relationship blocks stack via `next`, which is how Blockly chains statements. */
function chainRelationships(rels: AbRelationship[]): BlockState {
  const build = (index: number): BlockState => {
    const rel = rels[index];
    const block: BlockState = {
      type: relationshipBlockType(rel.type),
      id: rel.id,
      fields: { TARGET: { id: rel.target } },
    };
    if (index + 1 < rels.length) block.next = { block: build(index + 1) };
    return block;
  };
  return build(0);
}

/* -------------------------------------------------------------------------- */

export interface WorkspaceReadResult {
  model: AbModel;
  /** Anything dropped, so an edit never disappears without explanation. */
  warnings: string[];
}

/**
 * Reads a workspace back into a model.
 *
 * Tolerant in the same way the Open Exchange importer is: a block whose type
 * is not one of ours, or a relationship the specification forbids, is reported
 * rather than silently included. The forbidden case should be unreachable —
 * the palette will not offer it — but a workspace can also arrive from an
 * older block set or a hand-edited file.
 */
export function workspaceToAbox(
  state: WorkspaceState,
  projectSlug: string
): WorkspaceReadResult {
  const warnings: string[] = [];
  const variableType = new Map<string, string>();
  const variableName = new Map<string, string>();
  for (const v of state.variables ?? []) {
    if (v.type) variableType.set(v.id, v.type);
    variableName.set(v.id, v.name);
  }

  const elements: AbElement[] = [];
  const relationships: AbRelationship[] = [];
  const usedElementIds = new Set<string>();
  const usedRelationshipIds = new Set<string>();

  const top = state.blocks?.blocks ?? [];

  // Elements first, so a relationship can be checked against real endpoints.
  const pending: Array<{ sourceId: string; sourceType: string; block: BlockState }> = [];

  for (const block of top) {
    for (const b of walkNext(block)) {
      if (!b.type.startsWith(ELEMENT_BLOCK_PREFIX)) {
        warnings.push(`ignored a top-level block of type "${b.type}"`);
        continue;
      }
      const type = b.type.slice(ELEMENT_BLOCK_PREFIX.length);
      if (!isElementType(type)) {
        warnings.push(`ignored "${b.type}": not an ArchiMate element type`);
        continue;
      }

      const variableRef = (b.fields?.ID as { id?: string } | undefined)?.id;
      const id = uniqueId(variableRef ?? b.id ?? type, usedElementIds);
      usedElementIds.add(id);

      const properties: Record<string, string> = {};
      for (const [key, value] of Object.entries(b.fields ?? {})) {
        if (key === "ID" || key === "documentation" || key === "otherProperties") {
          continue;
        }
        if (typeof value === "string" && value !== "") properties[key] = value;
      }

      // Unmodelled properties come back out of the carrier field. Malformed
      // JSON is reported rather than thrown: a hand-edited workspace should
      // not make the whole model unreadable.
      const carrier = b.fields?.otherProperties;
      if (typeof carrier === "string" && carrier.trim()) {
        try {
          const extra = JSON.parse(carrier) as Record<string, string>;
          for (const [k, v] of Object.entries(extra)) {
            if (typeof v === "string") properties[k] = v;
          }
        } catch {
          warnings.push(
            `could not read otherProperties on "${b.id ?? type}"; ` +
              `those properties were dropped`
          );
        }
      }

      elements.push({
        id,
        type,
        name: (variableRef && variableName.get(variableRef)) || id,
        documentation:
          typeof b.fields?.documentation === "string" && b.fields.documentation
            ? (b.fields.documentation as string)
            : undefined,
        properties,
      });

      const relBlock = b.inputs?.relationships?.block;
      if (relBlock) pending.push({ sourceId: id, sourceType: type, block: relBlock });
    }
  }

  const byId = new Map(elements.map((e) => [e.id, e]));

  for (const { sourceId, sourceType, block } of pending) {
    for (const b of walkNext(block)) {
      if (!b.type.startsWith(RELATIONSHIP_BLOCK_PREFIX)) {
        warnings.push(`ignored a relationship block of type "${b.type}"`);
        continue;
      }
      const type = b.type.slice(RELATIONSHIP_BLOCK_PREFIX.length);
      if (!isRelationshipType(type)) {
        warnings.push(`ignored "${b.type}": not an ArchiMate relationship type`);
        continue;
      }

      const targetId = (b.fields?.TARGET as { id?: string } | undefined)?.id;
      const target = targetId ? byId.get(targetId) : undefined;
      if (!target) {
        warnings.push(
          `dropped a ${type} from "${sourceId}": its target is not in the workspace`
        );
        continue;
      }

      if (!isAllowed(sourceType, type, target.type)) {
        // Unreachable through the palette; reachable through an older file.
        // `sourceType` came off a block type string, so it is narrowed back to
        // a known element type before being used to look up a label.
        const sourceLabel = isElementType(sourceType)
          ? ELEMENTS[sourceType].label
          : sourceType;
        warnings.push(
          `dropped a ${type} from "${sourceId}" to "${target.id}": ArchiMate ` +
            `does not permit ${sourceLabel} --${type}--> ` +
            `${ELEMENTS[target.type].label}`
        );
        continue;
      }

      const id = uniqueId(
        b.id ?? `${sourceId}-${type}-${target.id}`,
        usedRelationshipIds
      );
      usedRelationshipIds.add(id);
      relationships.push({
        id,
        type: type as AbRelationship["type"],
        source: sourceId,
        target: target.id,
        properties: {},
      });
    }
  }

  elements.sort((a, b) => a.id.localeCompare(b.id));
  relationships.sort((a, b) => a.id.localeCompare(b.id));

  return { model: { projectSlug, elements, relationships }, warnings };
}

/** A block and everything stacked below it. */
function* walkNext(block: BlockState): Generator<BlockState> {
  let current: BlockState | undefined = block;
  while (current) {
    yield current;
    current = current.next?.block;
  }
}
