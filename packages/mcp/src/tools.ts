import { z } from "zod";
import {
  CONVENTIONS,
  ELEMENTS,
  LANGUAGE_VERSION,
  LAYER_LABELS,
  LAYER_ORDER,
  RELATIONSHIPS,
  allowedRelationships,
  allowedTargets,
  elementsByLayer,
  isAllowed,
  isDerived,
  isElementType,
  isRelationshipType,
} from "@dlab5/archimate-metamodel";
import {
  hasErrors,
  neighbourhood,
  toMermaidGantt,
  toRadar,
  uniqueId,
  validateModel,
  validateRadar,
} from "@dlab5/blueprint-core";
import type { AbModel } from "@dlab5/blueprint-core";
import { toOpenExchange } from "@dlab5/archimate-exchange";
import * as backend from "./backend.js";

/**
 * The tools an agent gets.
 *
 * They fall into two groups, and the first is the more interesting one.
 *
 * The **metamodel** tools expose the ArchiMate specification itself: which
 * element types exist, what each means, and — the useful part — exactly which
 * relationships are permitted between any two of them. An agent that can ask
 * "what may a Work Package connect to?" writes valid models. An agent that
 * cannot guesses, and ArchiMate is not guessable: the plausible-looking
 * Plateau --composition--> Deliverable is forbidden, while the less obvious
 * Deliverable --realization--> Plateau is correct. These tools need no
 * backend and no credentials.
 *
 * The **model** tools read and write a project's ABox through the same
 * AppSync mutations the browser uses, so an agent inherits the same
 * authorization and the same lost-update protection.
 *
 * Mutating tools refuse an illegal change before writing rather than letting
 * validation catch it afterwards, and say what would have been legal instead.
 * A refusal an agent can act on is worth more than an error it can only report.
 */

export interface Tool {
  name: string;
  description: string;
  schema: z.ZodRawShape;
  /** Returns text. Structured data is JSON so an agent can parse it. */
  run: (args: Record<string, unknown>) => Promise<string>;
}

const json = (value: unknown) => JSON.stringify(value, null, 2);

/* -------------------------------------------------------------------------- *
 * Metamodel — the specification, queryable
 * -------------------------------------------------------------------------- */

const listElementTypes: Tool = {
  name: "archimate_list_element_types",
  description:
    "List ArchiMate element types, optionally filtered to one domain " +
    "(motivation, strategy, business, application, technology, physical, " +
    "implementation, composite). Use this before creating an element so the " +
    "type is one the language actually defines.",
  schema: { domain: z.string().optional() },
  run: async ({ domain }) => {
    if (domain) {
      if (!LAYER_ORDER.includes(domain as never)) {
        return `Unknown domain "${domain}". One of: ${LAYER_ORDER.join(", ")}`;
      }
      return json(
        elementsByLayer(domain as never).map((e) => ({
          type: e.id,
          label: e.label,
          definition: e.comment,
        }))
      );
    }
    return json(
      LAYER_ORDER.filter((l) => elementsByLayer(l).length > 0).map((l) => ({
        domain: l,
        label: LAYER_LABELS[l],
        types: elementsByLayer(l).map((e) => e.id),
      }))
    );
  },
};

const describeElementType: Tool = {
  name: "archimate_describe_element_type",
  description:
    "The specification's definition of one element type, its domain, and a " +
    "summary of what it may connect to.",
  schema: { type: z.string() },
  run: async ({ type }) => {
    const id = String(type);
    if (!isElementType(id)) {
      return `"${id}" is not an ArchiMate ${LANGUAGE_VERSION} element type. Use archimate_list_element_types.`;
    }
    const e = ELEMENTS[id];
    const outgoing: Record<string, string[]> = {};
    for (const target of Object.keys(ELEMENTS)) {
      const rels = allowedRelationships(id, target);
      for (const rel of rels) (outgoing[rel] ??= []).push(target);
    }
    return json({
      type: e.id,
      label: e.label,
      definition: e.comment,
      domain: e.layer,
      aspect: e.aspect,
      archimateVersion: LANGUAGE_VERSION,
      // The complete target list per relationship, not a sample. A truncated
      // list cannot answer the only question this tool is for — "may I connect
      // this to that?" — and an agent shown eight alphabetical examples out of
      // fifty-three would have to guess about the other forty-five.
      outgoingRelationships: Object.fromEntries(
        Object.entries(outgoing).map(([rel, targets]) => [rel, targets.sort()])
      ),
    });
  },
};

const checkRelationship: Tool = {
  name: "archimate_check_relationship",
  description:
    "Is source --relationship--> target permitted by ArchiMate? Direction " +
    "matters. Returns whether it is allowed, whether it is derived, and if " +
    "not allowed, what is permitted between those two types instead.",
  schema: {
    source: z.string(),
    relationship: z.string(),
    target: z.string(),
  },
  run: async ({ source, relationship, target }) => {
    const s = String(source);
    const t = String(target);
    const r = String(relationship);
    if (!isElementType(s)) return `"${s}" is not an element type.`;
    if (!isElementType(t)) return `"${t}" is not an element type.`;
    if (!isRelationshipType(r)) {
      return `"${r}" is not a relationship type. One of: ${Object.keys(RELATIONSHIPS).join(", ")}`;
    }
    const allowed = isAllowed(s, r, t);
    return json({
      source: s,
      relationship: r,
      target: t,
      allowed,
      derived: allowed ? isDerived(s, r, t) : false,
      alsoPermittedBetweenThese: allowedRelationships(s, t),
      permittedInTheOtherDirection: allowedRelationships(t, s),
    });
  },
};

const allowedTargetsTool: Tool = {
  name: "archimate_allowed_targets",
  description:
    "Every element type that may be the target of a given relationship from " +
    "a given source type.",
  schema: { source: z.string(), relationship: z.string() },
  run: async ({ source, relationship }) => {
    const s = String(source);
    const r = String(relationship);
    if (!isElementType(s)) return `"${s}" is not an element type.`;
    if (!isRelationshipType(r)) return `"${r}" is not a relationship type.`;
    return json({ source: s, relationship: r, targets: allowedTargets(s, r) });
  },
};

const describeConventions: Tool = {
  name: "archimate_describe_conventions",
  description:
    "Platform conventions layered on ArchiMate: the ArchiMate Property keys " +
    "used for scheduling and for the Technology Radar, and their permitted " +
    "values. These are not part of the language.",
  schema: {},
  run: async () =>
    json({
      archimateVersion: LANGUAGE_VERSION,
      conventions: Object.values(CONVENTIONS).map((c) => ({
        propertyKey: c.propertyKey,
        label: c.label,
        description: c.comment,
        permittedValues: c.values,
        default: c.defaultValue,
      })),
      radarQuadrants:
        "Quadrants are Grouping elements that aggregate their members. The " +
        "element type does not determine the quadrant.",
    }),
};

/* -------------------------------------------------------------------------- *
 * Model
 * -------------------------------------------------------------------------- */

const listProjects: Tool = {
  name: "list_projects",
  description: "Blueprint projects this account can open.",
  schema: {},
  run: async () =>
    json(
      (await backend.listProjects()).map((p) => ({
        slug: p.slug,
        name: p.name,
        description: p.description ?? undefined,
      }))
    ),
};

const getModel: Tool = {
  name: "get_model",
  description:
    "A project's whole ArchiMate model: every element and relationship, with " +
    "validation findings.",
  schema: { project: z.string() },
  run: async ({ project }) => {
    const { model } = await backend.loadModel(String(project));
    return json({
      project: model.projectSlug,
      archimateVersion: model.languageVersion ?? LANGUAGE_VERSION,
      elements: model.elements,
      relationships: model.relationships,
      findings: validateModel(model),
    });
  },
};

const queryElements: Tool = {
  name: "query_elements",
  description:
    "Elements of a project, filtered by domain, type, a substring of the " +
    "name, or connection to another element. Prefer this to get_model on a " +
    "large model. Use relatedTo to answer questions about one part of a " +
    "model — what a Grouping contains, what a component connects to — rather " +
    "than fetching everything and filtering by eye.",
  schema: {
    project: z.string(),
    domain: z.string().optional(),
    type: z.string().optional(),
    nameContains: z.string().optional(),
    relatedTo: z.string().optional(),
    /** How many relationship hops from relatedTo. Defaults to 1. */
    depth: z.number().optional(),
  },
  run: async ({ project, domain, type, nameContains, relatedTo, depth }) => {
    const { model } = await backend.loadModel(String(project));
    const needle = nameContains ? String(nameContains).toLowerCase() : null;

    // Elements reachable from `relatedTo`, in either direction.
    //
    // Added because the library could not answer its own first question:
    // "what constrains the Amplify backend" returned every Constraint in the
    // model, because a Grouping's membership was expressed in relationships
    // that nothing could traverse. Direction-agnostic on purpose — a reader
    // asking what belongs to a pattern does not care which way the
    // aggregation points.
    //
    // The walk itself lives in core, shared with the browser's neighbourhood
    // view. An agent asking "what depends on this?" and a person clicking an
    // element are asking the same question; the answer should not depend on
    // which one asked.
    let reachable: Set<string> | null = null;
    if (relatedTo) {
      const start = String(relatedTo);
      if (!model.elements.some((e) => e.id === start)) {
        return `No element with id "${start}" in ${project}.`;
      }
      const found = neighbourhood(model, start, Number(depth) || 1);
      reachable = new Set(found.distance.keys());
      // The start is the thing asked about, not an answer to it.
      reachable.delete(start);
    }

    const matches = model.elements.filter(
      (e) =>
        (!domain || ELEMENTS[e.type].layer === domain) &&
        (!type || e.type === type) &&
        (!needle || e.name.toLowerCase().includes(needle)) &&
        (!reachable || reachable.has(e.id))
    );
    return json(
      matches.map((e) => ({
        id: e.id,
        type: e.type,
        domain: ELEMENTS[e.type].layer,
        name: e.name,
        properties: e.properties,
        relationships: model.relationships
          .filter((r) => r.source === e.id || r.target === e.id)
          .map((r) =>
            r.source === e.id
              ? `-${r.type}-> ${r.target}`
              : `<-${r.type}- ${r.source}`
          ),
      }))
    );
  },
};

const addElement: Tool = {
  name: "add_element",
  description:
    "Add an element to a project. The type must be an ArchiMate element type " +
    "— check with archimate_list_element_types first. Properties carry " +
    "scheduling and radar data; see archimate_describe_conventions.",
  schema: {
    project: z.string(),
    type: z.string(),
    name: z.string(),
    documentation: z.string().optional(),
    properties: z.record(z.string(), z.string()).optional(),
  },
  run: async ({ project, type, name, documentation, properties }) => {
    const t = String(type);
    if (!isElementType(t)) {
      return `"${t}" is not an ArchiMate ${LANGUAGE_VERSION} element type. Use archimate_list_element_types.`;
    }
    let created = "";
    await backend.mutate(String(project), (model) => {
      const id = uniqueId(String(name), model.elements.map((e) => e.id));
      created = id;
      return {
        ...model,
        elements: [
          ...model.elements,
          {
            id,
            type: t,
            name: String(name),
            documentation: documentation ? String(documentation) : undefined,
            properties: (properties as Record<string, string>) ?? {},
          },
        ],
      };
    });
    return `Added ${ELEMENTS[t].label} "${name}" with id "${created}".`;
  },
};

const addRelationship: Tool = {
  name: "add_relationship",
  description:
    "Connect two elements. Refuses relationships ArchiMate does not permit " +
    "between those element types, and says what is permitted instead.",
  schema: {
    project: z.string(),
    source: z.string(),
    relationship: z.string(),
    target: z.string(),
    name: z.string().optional(),
  },
  run: async ({ project, source, relationship, target, name }) => {
    const rel = String(relationship);
    if (!isRelationshipType(rel)) {
      return `"${rel}" is not a relationship type. One of: ${Object.keys(RELATIONSHIPS).join(", ")}`;
    }

    let message = "";
    try {
      await backend.mutate(String(project), (model) => {
        const from = model.elements.find((e) => e.id === source);
        const to = model.elements.find((e) => e.id === target);
        if (!from) throw new RefusedError(`No element with id "${source}".`);
        if (!to) throw new RefusedError(`No element with id "${target}".`);

        // Refused before the write, not caught by validation after it.
        if (!isAllowed(from.type, rel, to.type)) {
          const instead = allowedRelationships(from.type, to.type);
          const reverse = allowedRelationships(to.type, from.type);
          throw new RefusedError(
            `ArchiMate ${LANGUAGE_VERSION} does not permit ` +
              `${ELEMENTS[from.type].label} --${rel}--> ${ELEMENTS[to.type].label}. ` +
              (instead.length
                ? `Permitted in that direction: ${instead.join(", ")}. `
                : "Nothing is permitted in that direction. ") +
              (reverse.length
                ? `Permitted the other way round: ${reverse.join(", ")}.`
                : "")
          );
        }

        const id = uniqueId(
          `${from.id}-${rel}-${to.id}`,
          model.relationships.map((r) => r.id)
        );
        message =
          `Connected "${from.name}" --${rel}--> "${to.name}" as "${id}"` +
          (isDerived(from.type, rel, to.type)
            ? " (a derived relationship: it is implied by a chain of others)"
            : "");
        return {
          ...model,
          relationships: [
            ...model.relationships,
            {
              id,
              type: rel,
              source: from.id,
              target: to.id,
              name: name ? String(name) : undefined,
              properties: {},
            },
          ],
        };
      });
    } catch (err) {
      if (err instanceof RefusedError) return err.message;
      throw err;
    }
    return message;
  },
};

const setProperties: Tool = {
  name: "set_element_properties",
  description:
    "Set ArchiMate Properties on an element — scheduling dates, status, radar " +
    "ring. An empty value removes the property.",
  schema: {
    project: z.string(),
    id: z.string(),
    properties: z.record(z.string(), z.string()),
  },
  run: async ({ project, id, properties }) => {
    let message = "";
    try {
      await backend.mutate(String(project), (model) => {
        const el = model.elements.find((e) => e.id === id);
        if (!el) throw new RefusedError(`No element with id "${id}".`);
        const next = { ...el.properties };
        for (const [k, v] of Object.entries(
          properties as Record<string, string>
        )) {
          if (v) next[k] = v;
          else delete next[k];
        }
        message = `Updated properties on "${el.name}": ${json(next)}`;
        return {
          ...model,
          elements: model.elements.map((e) =>
            e.id === id ? { ...e, properties: next } : e
          ),
        };
      });
    } catch (err) {
      if (err instanceof RefusedError) return err.message;
      throw err;
    }
    return message;
  },
};

const removeElement: Tool = {
  name: "remove_element",
  description:
    "Remove an element and every relationship touching it, so the model " +
    "cannot be left with dangling references.",
  schema: { project: z.string(), id: z.string() },
  run: async ({ project, id }) => {
    let message = "";
    try {
      await backend.mutate(String(project), (model) => {
        const el = model.elements.find((e) => e.id === id);
        if (!el) throw new RefusedError(`No element with id "${id}".`);
        const dropped = model.relationships.filter(
          (r) => r.source === id || r.target === id
        );
        message =
          `Removed "${el.name}"` +
          (dropped.length
            ? ` and ${dropped.length} relationship(s) that touched it.`
            : ".");
        return {
          ...model,
          elements: model.elements.filter((e) => e.id !== id),
          relationships: model.relationships.filter(
            (r) => r.source !== id && r.target !== id
          ),
        };
      });
    } catch (err) {
      if (err instanceof RefusedError) return err.message;
      throw err;
    }
    return message;
  },
};

const validate: Tool = {
  name: "validate_model",
  description:
    "Check a project's model against ArchiMate and against the platform's " +
    "radar convention.",
  schema: { project: z.string() },
  run: async ({ project }) => {
    const { model } = await backend.loadModel(String(project));
    const findings = validateModel(model);
    return json({
      valid: !hasErrors(findings),
      archimate: findings,
      radar: validateRadar(model),
    });
  },
};

const renderRoadmap: Tool = {
  name: "render_roadmap",
  description:
    "The project's Implementation & Migration schedule as a Mermaid Gantt.",
  schema: { project: z.string() },
  run: async ({ project }) => {
    const { model } = await backend.loadModel(String(project));
    return toMermaidGantt(model, { title: model.projectSlug });
  },
};

const getRadar: Tool = {
  name: "get_radar",
  description:
    "The Technology Radar derived from the model: quadrants and their entries " +
    "with adoption rings.",
  schema: { project: z.string() },
  run: async ({ project }) => {
    const { model } = await backend.loadModel(String(project));
    return json(toRadar(model));
  },
};

const exportOef: Tool = {
  name: "export_open_exchange",
  description:
    "The model as ArchiMate Open Exchange XML, which opens in Archi and any " +
    "other conforming tool.",
  schema: { project: z.string() },
  run: async ({ project }) => {
    const { model } = await backend.loadModel(String(project));
    return toOpenExchange(model, { name: model.projectSlug });
  },
};

/* -------------------------------------------------------------------------- */

/** A refusal the agent should act on, as opposed to a fault. */
export class RefusedError extends Error {}

/** Tools needing no backend and no credentials. */
export const METAMODEL_TOOLS: Tool[] = [
  listElementTypes,
  describeElementType,
  checkRelationship,
  allowedTargetsTool,
  describeConventions,
];

/** Tools that read or write a project. */
export const MODEL_TOOLS: Tool[] = [
  listProjects,
  getModel,
  queryElements,
  addElement,
  addRelationship,
  setProperties,
  removeElement,
  validate,
  renderRoadmap,
  getRadar,
  exportOef,
];

export const ALL_TOOLS: Tool[] = [...METAMODEL_TOOLS, ...MODEL_TOOLS];
