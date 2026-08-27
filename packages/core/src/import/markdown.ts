import {
  CONVENTIONS,
  isAllowed,
  isElementType,
  isRelationshipType,
} from "@dlab5/archimate-metamodel";
import type { ElementTypeId, RelationshipTypeId } from "@dlab5/archimate-metamodel";

import { slugifyId } from "../iri.js";
import type { AbElement, AbModel, AbRelationship } from "../types.js";

/**
 * An annotated markdown document, read into an ArchiMate model.
 *
 * **One way, and lossy on purpose**, for the same reason `fromMermaidGantt`
 * is: a report carries motivation and prose, not a model. What comes back is
 * whatever the annotations claim and nothing else. Exporting a model and
 * writing it back as markdown is not a thing this offers.
 *
 * Annotations are HTML comments, so every renderer ignores them and the
 * document still reads — and prints — as the document it was:
 *
 * ```markdown
 * <!-- am element type=Stakeholder id=cfo -->
 * ## Chief Financial Officer
 * Wants cost per transaction below EUR 0.02 by Q3.
 *
 * <!-- am rel type=influence from=cfo to=cost-per-txn -->
 * ```
 *
 * They sit where the thing is, rather than in a sidecar keyed by heading text
 * or line number — every such key breaks the moment someone edits a heading,
 * and editing headings is most of what revising a report consists of.
 *
 * **Ids are supplied, never generated.** `id=` is what makes a second import
 * of a revised document update the same element rather than create a twin, so
 * an annotation without one is skipped rather than guessed at.
 */

export interface MarkdownAnnotationError {
  line: number;
  text: string;
  reason: string;
}

export interface MarkdownImportResult {
  model: AbModel;
  /** What was recognised, for reporting back to whoever asked. */
  elements: number;
  relationships: number;
  /** Sections marked `<!-- am ignore -->`, which is not the same as unannotated. */
  ignored: number;
  /** Annotations that were not understood, with their 1-based line numbers. */
  skipped: MarkdownAnnotationError[];
}

/**
 * Where an imported element says it came from.
 *
 * Read from the overlay, never spelled out here: constraint 11 keeps every
 * property key in one place, and a key hard-coded in an importer is exactly
 * how two spellings of the same property end up in one model.
 */
const SOURCE_DOCUMENT = CONVENTIONS.sourceDocument.propertyKey;
const SOURCE_SECTION = CONVENTIONS.sourceSection.propertyKey;

/** `<!-- am element type=Stakeholder id=cfo -->` — one per line. */
const ANNOTATION = /^\s*<!--\s*am\s+([a-z]+)\b([^>]*?)-->\s*$/i;

/**
 * Heading text, with inline markdown removed, for use as an element name.
 *
 * Found on a real plan of record, whose phase headings read
 * `### Phase B — Odoo extract *(blocked on API key)*`. Carried through
 * verbatim, the asterisks end up in the element's name, in every diagram it
 * appears on and in the Archi export. Emphasis is formatting; it is not part
 * of what the thing is called.
 *
 * Link text is kept and the URL dropped, for the same reason.
 */
function plainText(heading: string): string {
  return heading
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/(\*\*\*|___)(.+?)\1/g, "$2")
    .replace(/(\*\*|__)(.+?)\1/g, "$2")
    .replace(/(\*|_)(.+?)\1/g, "$2")
    .replace(/\s+/g, " ")
    .trim();
}

/** ATX headings only. Setext (`====` underline) is not recognised. */
const HEADING = /^(#{1,6})\s+(.+?)\s*$/;

/** `key=value` or `key="value with spaces"`. */
const ATTRIBUTE = /([a-zA-Z][a-zA-Z0-9]*)=(?:"([^"]*)"|(\S+))/g;

function attributes(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of text.matchAll(ATTRIBUTE)) {
    out[m[1]] = m[2] !== undefined ? m[2] : m[3];
  }
  return out;
}

interface Pending {
  kind: "element" | "ignore";
  attrs: Record<string, string>;
  line: number;
  text: string;
}

export function fromAnnotatedMarkdown(
  source: string,
  projectSlug: string,
  options: { documentId?: string } = {}
): MarkdownImportResult {
  const lines = source.split(/\r?\n/);

  const elements: AbElement[] = [];
  const relationships: AbRelationship[] = [];
  const skipped: MarkdownAnnotationError[] = [];
  let ignored = 0;

  /** id -> type, so a relationship between two documented elements can be checked. */
  const typeById = new Map<string, ElementTypeId>();
  const seen = new Set<string>();

  /** An annotation waiting for the heading it binds to. */
  let pending: Pending | undefined;

  /** The element currently collecting prose, and where its body started. */
  let collecting: { element: AbElement; body: string[] } | undefined;

  const closeSection = () => {
    if (!collecting) return;
    const text = collecting.body.join("\n").trim();
    if (text) collecting.element.documentation = text;
    collecting = undefined;
  };

  const skip = (line: number, text: string, reason: string) =>
    skipped.push({ line, text: text.trim(), reason });

  /** Deferred so a relationship may name an element defined later in the document. */
  const pendingRelationships: Array<{
    attrs: Record<string, string>;
    line: number;
    text: string;
  }> = [];

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const lineNumber = i + 1;

    const annotation = ANNOTATION.exec(raw);
    if (annotation) {
      const kind = annotation[1].toLowerCase();
      const attrs = attributes(annotation[2]);

      if (kind === "rel") {
        pendingRelationships.push({ attrs, line: lineNumber, text: raw });
      } else if (kind === "element" || kind === "ignore") {
        if (pending) {
          skip(pending.line, pending.text, "no heading followed this annotation");
        }
        pending = { kind, attrs, line: lineNumber, text: raw };
      } else {
        skip(lineNumber, raw, `unknown annotation "${kind}"`);
      }
      // An annotation is never part of the prose it introduces.
      continue;
    }

    const heading = HEADING.exec(raw);
    if (heading) {
      // A section's prose is what sits between its heading and the NEXT
      // heading of any level. Running to the next same-or-higher heading
      // instead would put a subsection's text in two elements at once.
      closeSection();

      if (!pending) continue;
      const { kind, attrs, line, text } = pending;
      pending = undefined;

      if (kind === "ignore") {
        ignored++;
        continue;
      }

      const headingText = plainText(heading[2]);
      const type = attrs.type;
      const id = attrs.id;

      if (!type) {
        skip(line, text, "an element annotation needs type=");
        continue;
      }
      if (!isElementType(type)) {
        skip(line, text, `"${type}" is not an ArchiMate element type`);
        continue;
      }
      if (!id) {
        skip(
          line,
          text,
          "an element annotation needs id=, so a later import updates this " +
            "element rather than creating a second one"
        );
        continue;
      }
      if (seen.has(id)) {
        skip(line, text, `id "${id}" is used more than once in this document`);
        continue;
      }

      seen.add(id);
      typeById.set(id, type);

      const properties: Record<string, string> = {};
      if (options.documentId) properties[SOURCE_DOCUMENT] = options.documentId;
      properties[SOURCE_SECTION] = slugifyId(headingText);

      const element: AbElement = {
        id,
        type,
        name: attrs.name ?? headingText,
        properties,
      };
      elements.push(element);
      collecting = { element, body: [] };
      continue;
    }

    if (collecting) collecting.body.push(raw);
  }

  closeSection();
  if (pending) {
    skip(pending.line, pending.text, "no heading followed this annotation");
  }

  /* -- relationships, once every element in the document is known ---------- */

  const relIds = new Set<string>();
  for (const { attrs, line, text } of pendingRelationships) {
    const { type, from, to } = attrs;

    if (!type || !from || !to) {
      skip(line, text, "a rel annotation needs type=, from= and to=");
      continue;
    }
    if (!isRelationshipType(type)) {
      skip(line, text, `"${type}" is not an ArchiMate relationship type`);
      continue;
    }

    const sourceType = typeById.get(from);
    const targetType = typeById.get(to);

    // Both ends in this document: check Appendix B now, and say so precisely.
    // An agent proposing a relationship the metamodel forbids has to surface
    // as a rejected annotation, never as a corrupt model.
    if (
      sourceType &&
      targetType &&
      !isAllowed(sourceType, type as RelationshipTypeId, targetType)
    ) {
      skip(
        line,
        text,
        `ArchiMate does not allow ${type} from ${sourceType} to ${targetType}`
      );
      continue;
    }

    // One end outside the document is legitimate: it may already be in the
    // model. Its type is unknown here, so the check is left to validateModel
    // over the merged result — which owns that rule anyway, and duplicating it
    // is exactly what constraint 11 forbids.

    // Endpoint-derived, matching ttl.ts, RoadmapEditor and the MCP tools. It
    // also means relationship identity needs no annotation: re-importing a
    // document produces the same id for the same pair.
    const id = `${from}-${type}-${to}`;
    if (relIds.has(id)) {
      skip(line, text, "this relationship is declared twice");
      continue;
    }
    relIds.add(id);

    relationships.push({
      id,
      type: type as RelationshipTypeId,
      source: from,
      target: to,
      properties: options.documentId ? { [SOURCE_DOCUMENT]: options.documentId } : {},
    });
  }

  return {
    model: { projectSlug, elements, relationships },
    elements: elements.length,
    relationships: relationships.length,
    ignored,
    skipped,
  };
}
