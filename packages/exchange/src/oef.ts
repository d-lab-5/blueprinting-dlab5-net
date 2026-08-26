import { ELEMENTS, RELATIONSHIPS } from "@dlab5/archimate-metamodel";
import type { AbElement, AbModel, AbRelationship } from "@dlab5/blueprint-core";

/**
 * The ArchiMate Model Exchange File Format — the standard way a model leaves
 * this platform and opens in Archi.
 *
 * This is the round-trip that proves the ABox is faithful ArchiMate rather
 * than merely our own shape. It is also the escape hatch: if this platform
 * ever stops being the right home for a model, the model leaves intact.
 *
 * Two naming conventions have to be bridged, both mechanical:
 *
 *   Element types    identical. `WorkPackage` is `xsi:type="WorkPackage"`.
 *   Relationships    ours are lowerCamelCase after the ontology's object
 *                    properties; the format uses PascalCase complex types.
 *                    `realization` becomes `xsi:type="Realization"`.
 *
 * Identifiers are the sharp edge. The format declares them `xs:ID`, so they
 * must be XML NCNames and may not start with a digit — which ours can, since
 * a project may legitimately hold an element called "3rd party gateway". Every
 * identifier is therefore prefixed on the way out and stripped on the way
 * back, which also guarantees element and relationship ids cannot collide in
 * the single ID space the format uses for both.
 */

const NS = "http://www.opengroup.org/xsd/archimate/3.0/";
const XSI = "http://www.w3.org/2001/XMLSchema-instance";
const SCHEMA_LOCATION = `${NS} ${NS}archimate3_Model.xsd`;

const ELEMENT_PREFIX = "e-";
const RELATIONSHIP_PREFIX = "r-";
const PROPERTY_PREFIX = "propid-";
const MODEL_PREFIX = "model-";

/** `realization` -> `Realization`. */
function relationshipXsiType(id: string): string {
  return id.charAt(0).toUpperCase() + id.slice(1);
}

/** `Realization` -> `realization`, or undefined if it is not one of the 11. */
function relationshipIdFromXsiType(xsiType: string): string | undefined {
  const id = xsiType.charAt(0).toLowerCase() + xsiType.slice(1);
  return Object.prototype.hasOwnProperty.call(RELATIONSHIPS, id) ? id : undefined;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/* -------------------------------------------------------------------------- *
 * Export
 * -------------------------------------------------------------------------- */

export interface OefOptions {
  /** Model name shown in Archi's model tree. Defaults to the project slug. */
  name?: string;
  /** Two-letter language tag for the name and documentation. */
  lang?: string;
}

/**
 * Serialises a model to Open Exchange XML.
 *
 * Written by hand rather than through an XML builder. The document is small,
 * entirely of our own construction, and every value passes through
 * escapeXml — a builder would add a dependency to this package for no
 * correctness the schema validation does not already give us.
 */
export function toOpenExchange(model: AbModel, options: OefOptions = {}): string {
  const { name = model.projectSlug, lang = "en" } = options;

  // ArchiMate Properties become propertyDefinitions plus per-concept
  // references. The format models them as a shared vocabulary, so every
  // distinct key across the whole model is declared once.
  const keys = new Set<string>();
  for (const el of model.elements) for (const k of Object.keys(el.properties)) keys.add(k);
  for (const rel of model.relationships)
    for (const k of Object.keys(rel.properties)) keys.add(k);
  const propertyIds = new Map(
    [...keys].sort().map((key, i) => [key, `${PROPERTY_PREFIX}${i}`])
  );

  const properties = (concept: AbElement | AbRelationship, indent: string) => {
    const entries = Object.entries(concept.properties).sort(([a], [b]) =>
      a.localeCompare(b)
    );
    if (entries.length === 0) return "";
    const lines = entries.map(
      ([key, value]) =>
        `${indent}  <property propertyDefinitionRef="${propertyIds.get(key)}">\n` +
        `${indent}    <value xml:lang="${lang}">${escapeXml(value)}</value>\n` +
        `${indent}  </property>`
    );
    return `\n${indent}<properties>\n${lines.join("\n")}\n${indent}</properties>`;
  };

  const documentation = (text: string | undefined, indent: string) =>
    text
      ? `\n${indent}<documentation xml:lang="${lang}">${escapeXml(text)}</documentation>`
      : "";

  const elements = [...model.elements]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((el) => {
      const open =
        `    <element identifier="${ELEMENT_PREFIX}${el.id}" ` +
        `xsi:type="${el.type}">`;
      const body =
        `\n      <name xml:lang="${lang}">${escapeXml(el.name)}</name>` +
        documentation(el.documentation, "      ") +
        properties(el, "      ");
      return `${open}${body}\n    </element>`;
    })
    .join("\n");

  const elementIds = new Set(model.elements.map((e) => e.id));

  const relationships = [...model.relationships]
    .sort((a, b) => a.id.localeCompare(b.id))
    // A dangling endpoint has no identifier to reference, and the format
    // declares source and target as IDREF, so the document would not validate.
    // validateModel already reports these as errors.
    .filter((r) => elementIds.has(r.source) && elementIds.has(r.target))
    .map((rel) => {
      const open =
        `    <relationship identifier="${RELATIONSHIP_PREFIX}${rel.id}" ` +
        `source="${ELEMENT_PREFIX}${rel.source}" ` +
        `target="${ELEMENT_PREFIX}${rel.target}" ` +
        `xsi:type="${relationshipXsiType(rel.type)}">`;
      const body =
        (rel.name
          ? `\n      <name xml:lang="${lang}">${escapeXml(rel.name)}</name>`
          : "") +
        documentation(rel.documentation, "      ") +
        properties(rel, "      ");
      return body
        ? `${open}${body}\n    </relationship>`
        : `${open.slice(0, -1)} />`;
    })
    .join("\n");

  const propertyDefinitions = [...propertyIds.entries()]
    .map(
      ([key, id]) =>
        `    <propertyDefinition identifier="${id}" type="string">\n` +
        `      <name xml:lang="${lang}">${escapeXml(key)}</name>\n` +
        `    </propertyDefinition>`
    )
    .join("\n");

  // Order matters: the schema declares a sequence, so elements must precede
  // relationships, and propertyDefinitions come last.
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<model xmlns="${NS}"\n` +
    `       xmlns:xsi="${XSI}"\n` +
    `       xsi:schemaLocation="${SCHEMA_LOCATION}"\n` +
    `       identifier="${MODEL_PREFIX}${model.projectSlug}">\n` +
    `  <name xml:lang="${lang}">${escapeXml(name)}</name>\n` +
    (model.elements.length
      ? `  <elements>\n${elements}\n  </elements>\n`
      : "") +
    (relationships
      ? `  <relationships>\n${relationships}\n  </relationships>\n`
      : "") +
    (propertyDefinitions
      ? `  <propertyDefinitions>\n${propertyDefinitions}\n  </propertyDefinitions>\n`
      : "") +
    `</model>\n`
  );
}

/* -------------------------------------------------------------------------- *
 * Import
 * -------------------------------------------------------------------------- */

export interface OefImportResult {
  model: AbModel;
  /** Anything dropped or coerced, so an import never fails silently. */
  warnings: string[];
}

const attr = (tag: string, name: string): string | undefined =>
  tag.match(new RegExp(`${name}="([^"]*)"`))?.[1];

const unescapeXml = (value: string): string =>
  value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");

/** Strips a prefix this exporter added, leaving anything else untouched. */
const stripPrefix = (id: string, prefix: string) =>
  id.startsWith(prefix) ? id.slice(prefix.length) : id;

/**
 * Reads Open Exchange XML back into a model.
 *
 * Deliberately tolerant. A file from Archi carries views, organizations,
 * junctions and diagram geometry this platform does not model; those are
 * skipped rather than treated as errors, because refusing to import a
 * perfectly good ArchiMate model over a `<view>` would defeat the point. What
 * cannot be represented is reported in `warnings` — an import that silently
 * loses concepts is worse than one that refuses.
 */
export function fromOpenExchange(
  xml: string,
  projectSlug: string
): OefImportResult {
  const warnings: string[] = [];

  const propertyNames = new Map<string, string>();
  for (const block of xml.matchAll(
    /<propertyDefinition\b([^>]*)>([\s\S]*?)<\/propertyDefinition>/g
  )) {
    const id = attr(block[1], "identifier");
    const name = block[2].match(/<name[^>]*>([\s\S]*?)<\/name>/)?.[1];
    if (id && name) propertyNames.set(id, unescapeXml(name.trim()));
  }

  const readProperties = (body: string): Record<string, string> => {
    const out: Record<string, string> = {};
    for (const p of body.matchAll(
      /<property\b([^>]*)>([\s\S]*?)<\/property>/g
    )) {
      const ref = attr(p[1], "propertyDefinitionRef");
      const value = p[2].match(/<value[^>]*>([\s\S]*?)<\/value>/)?.[1];
      const key = ref ? propertyNames.get(ref) : undefined;
      if (key && value !== undefined) out[key] = unescapeXml(value.trim());
    }
    return out;
  };

  const readText = (body: string, tag: string): string | undefined => {
    const m = body.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`));
    return m ? unescapeXml(m[1].trim()) : undefined;
  };

  /* -- elements ---------------------------------------------------------- */

  const elements: AbElement[] = [];
  const idByXmlId = new Map<string, string>();

  const elementsBlock =
    xml.match(/<elements>([\s\S]*?)<\/elements>/)?.[1] ?? "";

  for (const m of elementsBlock.matchAll(
    /<element\b([^>]*?)(?:\/>|>([\s\S]*?)<\/element>)/g
  )) {
    const head = m[1];
    const body = m[2] ?? "";
    const xmlId = attr(head, "identifier");
    const xsiType = attr(head, "xsi:type") ?? attr(head, "type");
    if (!xmlId || !xsiType) continue;

    if (!Object.prototype.hasOwnProperty.call(ELEMENTS, xsiType)) {
      // Junctions arrive here, as do any types from a newer language version.
      warnings.push(
        `skipped element "${xmlId}": ${xsiType} is not an ArchiMate 3.2 element type`
      );
      continue;
    }

    const id = stripPrefix(xmlId, ELEMENT_PREFIX);
    elements.push({
      id,
      type: xsiType as AbElement["type"],
      name: readText(body, "name") ?? id,
      documentation: readText(body, "documentation"),
      properties: readProperties(body),
    });
    idByXmlId.set(xmlId, id);
  }

  /* -- relationships ------------------------------------------------------ */

  const relationships: AbRelationship[] = [];
  const relationshipsBlock =
    xml.match(/<relationships>([\s\S]*?)<\/relationships>/)?.[1] ?? "";

  for (const m of relationshipsBlock.matchAll(
    /<relationship\b([^>]*?)(?:\/>|>([\s\S]*?)<\/relationship>)/g
  )) {
    const head = m[1];
    const body = m[2] ?? "";
    const xmlId = attr(head, "identifier");
    const xsiType = attr(head, "xsi:type") ?? attr(head, "type");
    const source = attr(head, "source");
    const target = attr(head, "target");
    if (!xmlId || !xsiType || !source || !target) continue;

    const type = relationshipIdFromXsiType(xsiType);
    if (!type) {
      warnings.push(
        `skipped relationship "${xmlId}": ${xsiType} is not an ArchiMate 3.2 relationship type`
      );
      continue;
    }

    const sourceId = idByXmlId.get(source);
    const targetId = idByXmlId.get(target);
    if (!sourceId || !targetId) {
      // Usually a relationship to or from a junction, which was skipped above.
      warnings.push(
        `skipped relationship "${xmlId}": an endpoint was not imported`
      );
      continue;
    }

    relationships.push({
      id: stripPrefix(xmlId, RELATIONSHIP_PREFIX),
      type: type as AbRelationship["type"],
      source: sourceId,
      target: targetId,
      name: readText(body, "name"),
      documentation: readText(body, "documentation"),
      properties: readProperties(body),
    });
  }

  const viewCount = (xml.match(/<view\b/g) ?? []).length;
  if (viewCount > 0) {
    warnings.push(
      `${viewCount} view(s) were not imported: this platform generates views ` +
        `from the model rather than storing them`
    );
  }

  elements.sort((a, b) => a.id.localeCompare(b.id));
  relationships.sort((a, b) => a.id.localeCompare(b.id));

  return { model: { projectSlug, elements, relationships }, warnings };
}
