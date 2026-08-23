import { ELEMENTS, isAllowed, isDerived } from "@dlab5/archimate-metamodel";
import type { AbModel } from "./types.js";
import { AbModelSchema } from "./schema.js";

export type Severity = "error" | "warning";

export interface Finding {
  severity: Severity;
  /** Machine-readable, for grouping in a UI. */
  code: string;
  message: string;
  /** Element or relationship id the finding attaches to, when there is one. */
  subject?: string;
}

/**
 * Checks a model against the ArchiMate 3.2 metamodel.
 *
 * Errors are things that make the model wrong: a dangling reference, a
 * duplicate id, a relationship Appendix B forbids. Warnings are things worth
 * knowing that are still valid ArchiMate — a derived relationship asserted
 * directly, an element nothing connects to.
 *
 * This is deliberately not SHACL. See ADR-0004 for why the upstream shapes are
 * not usable here yet; the relationship matrix covers the errors that actually
 * occur when a human or an agent edits a model.
 */
export function validateModel(model: AbModel): Finding[] {
  const findings: Finding[] = [];

  const parsed = AbModelSchema.safeParse(model);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      findings.push({
        severity: "error",
        code: "schema",
        message: `${issue.path.join(".")}: ${issue.message}`,
      });
    }
    // Structure is unsound; the metamodel checks below would report noise.
    return findings;
  }

  const byId = new Map<string, (typeof model.elements)[number]>();
  for (const el of model.elements) {
    if (byId.has(el.id)) {
      findings.push({
        severity: "error",
        code: "duplicate-element-id",
        message: `two elements share the id "${el.id}"`,
        subject: el.id,
      });
      continue;
    }
    byId.set(el.id, el);
  }

  const relIds = new Set<string>();
  const connected = new Set<string>();

  for (const rel of model.relationships) {
    if (relIds.has(rel.id)) {
      findings.push({
        severity: "error",
        code: "duplicate-relationship-id",
        message: `two relationships share the id "${rel.id}"`,
        subject: rel.id,
      });
    }
    relIds.add(rel.id);

    const source = byId.get(rel.source);
    const target = byId.get(rel.target);

    if (!source) {
      findings.push({
        severity: "error",
        code: "dangling-source",
        message: `relationship "${rel.id}" points at unknown source "${rel.source}"`,
        subject: rel.id,
      });
    }
    if (!target) {
      findings.push({
        severity: "error",
        code: "dangling-target",
        message: `relationship "${rel.id}" points at unknown target "${rel.target}"`,
        subject: rel.id,
      });
    }
    if (!source || !target) continue;

    connected.add(source.id);
    connected.add(target.id);

    if (!isAllowed(source.type, rel.type, target.type)) {
      findings.push({
        severity: "error",
        code: "forbidden-relationship",
        message:
          `ArchiMate 3.2 does not permit ${ELEMENTS[source.type].label} ` +
          `--${rel.type}--> ${ELEMENTS[target.type].label} ` +
          `(relationship "${rel.id}")`,
        subject: rel.id,
      });
    } else if (isDerived(source.type, rel.type, target.type)) {
      findings.push({
        severity: "warning",
        code: "derived-relationship",
        message:
          `${rel.type} from ${ELEMENTS[source.type].label} to ` +
          `${ELEMENTS[target.type].label} is derived; it is implied by a chain ` +
          `of other relationships and does not usually need asserting`,
        subject: rel.id,
      });
    }
  }

  for (const el of model.elements) {
    if (!connected.has(el.id) && model.elements.length > 1) {
      findings.push({
        severity: "warning",
        code: "orphan-element",
        message: `"${el.name}" is not connected to anything`,
        subject: el.id,
      });
    }
  }

  return findings;
}

export function hasErrors(findings: Finding[]): boolean {
  return findings.some((f) => f.severity === "error");
}
