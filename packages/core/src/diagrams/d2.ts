import { ELEMENTS, LAYER_LABELS } from "@dlab5/archimate-metamodel";
import type { LayerId } from "@dlab5/archimate-metamodel";
import type { AbModel, AbElement, AbRelationship } from "../types.js";

/**
 * Renders a model's structure as D2.
 *
 * D2 rather than Mermaid for the core domains because its layout engine copes
 * with the shape architecture diagrams actually have. A Mermaid flowchart of
 * thirty components with cross-layer dependencies becomes spaghetti; D2's
 * layered layout keeps it readable, which is the whole reason the spec named
 * it.
 *
 * The mapping keeps ArchiMate's own visual conventions, because a reader who
 * knows the language should not have to learn ours:
 *
 *   Domain               a container, in the standard layer pastel
 *   Element              a node, shaped by aspect — active structure square,
 *                        behaviour rounded, passive structure a page
 *   Grouping / Location  a container of its own, since that is what they mean
 *   Relationship         an arrow whose style says which kind it is
 */

export interface D2Options {
  title?: string;
  /** Restrict to these domains. Defaults to every domain present. */
  domains?: LayerId[];
  /** Draw domains as containers. Off gives a flat graph, which suits few elements. */
  groupByDomain?: boolean;
}

/** Standard ArchiMate layer pastels, matching the CSS tokens and the blocks. */
const DOMAIN_FILL: Record<LayerId, string> = {
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
 * Arrow styling per relationship type, following ArchiMate's notation.
 *
 * Structural relationships get a filled or hollow diamond, dependency
 * relationships an open head, dynamic ones a solid arrow, and specialization a
 * hollow triangle. D2 cannot draw every ArchiMate arrowhead, so where it
 * cannot the style carries the distinction instead — dashed for dependency,
 * dotted for association — and the label always names the relationship, so no
 * meaning rests on the shape alone.
 */
const ARROW: Record<string, { style: string; head?: string }> = {
  composition: { style: "  style.stroke-width: 2", head: "diamond" },
  aggregation: { style: "  style.stroke-width: 2", head: "diamond" },
  assignment: { style: "  style.stroke-width: 2" },
  realization: { style: "  style.stroke-dash: 4", head: "triangle" },
  serving: { style: "" },
  access: { style: "  style.stroke-dash: 2" },
  influence: { style: "  style.stroke-dash: 4" },
  association: { style: "  style.stroke-dash: 1" },
  triggering: { style: "" },
  flow: { style: "  style.stroke-dash: 4" },
  specialization: { style: "", head: "triangle" },
};

/** D2 identifiers: no dots, no spaces, no quotes. */
function d2Id(id: string): string {
  return id.replace(/[^A-Za-z0-9_-]/g, "_");
}

/** D2 labels are quoted; a quote or newline inside would end the string. */
function d2Label(text: string): string {
  return text.replace(/"/g, "'").replace(/\s+/g, " ").trim();
}

/**
 * A node's shape, from its ArchiMate aspect.
 *
 * The specification distinguishes active structure, behaviour and passive
 * structure visually, and a reader uses that before reading any label.
 */
function shapeFor(el: AbElement): string {
  const aspect = ELEMENTS[el.type].aspect ?? "";
  if (el.type === "Grouping" || el.type === "Location") return "rectangle";
  if (aspect.includes("Behavior") || aspect.includes("Behaviour")) return "oval";
  if (aspect.includes("PassiveStructure")) return "page";
  if (aspect.includes("Motivation")) return "hexagon";
  return "rectangle";
}

export function toD2(model: AbModel, options: D2Options = {}): string {
  const { title, groupByDomain = true } = options;

  const present = new Set(model.elements.map((e) => ELEMENTS[e.type].layer));
  const domains = (options.domains ?? [...present]).filter((d) => present.has(d));
  const wanted = new Set(domains);

  const elements = model.elements.filter((e) =>
    wanted.has(ELEMENTS[e.type].layer)
  );
  const ids = new Set(elements.map((e) => e.id));
  const relationships = model.relationships.filter(
    (r) => ids.has(r.source) && ids.has(r.target)
  );

  if (elements.length === 0) {
    // D2 rejects an empty diagram, and a picture of nothing is worse than a
    // sentence saying so.
    return `# no elements in the selected domains\nempty: "Nothing to draw"\n`;
  }

  const lines: string[] = [];
  if (title) lines.push(`title: |md\n  # ${d2Label(title)}\n| {near: top-center}`, "");

  const nodeLines = (el: AbElement, indent: string) => {
    const out = [
      `${indent}${d2Id(el.id)}: "${d2Label(el.name)}" {`,
      `${indent}  shape: ${shapeFor(el)}`,
      `${indent}  style.fill: "${DOMAIN_FILL[ELEMENTS[el.type].layer]}"`,
      `${indent}  style.font-color: "#1f2933"`,
      // The ArchiMate type, so a reader can tell a Node from a Device without
      // knowing the naming convention.
      `${indent}  tooltip: "${d2Label(ELEMENTS[el.type].label)}"`,
      `${indent}}`,
    ];
    return out;
  };

  if (groupByDomain) {
    for (const domain of domains) {
      const inDomain = elements.filter((e) => ELEMENTS[e.type].layer === domain);
      if (inDomain.length === 0) continue;
      lines.push(`${d2Id(domain)}: "${d2Label(LAYER_LABELS[domain])}" {`);
      lines.push(`  style.fill: "transparent"`);
      lines.push(`  style.stroke: "${DOMAIN_FILL[domain]}"`);
      lines.push(`  style.stroke-dash: 3`);
      for (const el of inDomain) lines.push(...nodeLines(el, "  "));
      lines.push("}");
    }
  } else {
    for (const el of elements) lines.push(...nodeLines(el, ""));
  }

  lines.push("");

  // Inside a container, a node is addressed as container.node.
  const path = (id: string) => {
    const el = elements.find((e) => e.id === id)!;
    return groupByDomain
      ? `${d2Id(ELEMENTS[el.type].layer)}.${d2Id(id)}`
      : d2Id(id);
  };

  for (const rel of relationships) {
    const arrow = ARROW[rel.type] ?? { style: "" };
    const label = rel.name ? `${rel.type}: ${rel.name}` : rel.type;
    lines.push(`${path(rel.source)} -> ${path(rel.target)}: "${d2Label(label)}" {`);
    if (arrow.style) lines.push(arrow.style);
    if (arrow.head) lines.push(`  target-arrowhead.shape: ${arrow.head}`);
    lines.push("}");
  }

  return lines.join("\n") + "\n";
}
