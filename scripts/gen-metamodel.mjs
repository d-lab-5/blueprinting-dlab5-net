#!/usr/bin/env node
/**
 * Generates packages/metamodel/src/generated/* from the pinned ontology.
 *
 * Two inputs, two very different shapes:
 *
 *   ontology/upstream/archimate.ttl        the OWL vocabulary — which element
 *                                          types exist, what they are called,
 *                                          what they mean, and which layer and
 *                                          aspect each belongs to.
 *
 *   ontology/upstream/relationships.xml    Appendix B of the specification as
 *                                          data — for every ordered pair of
 *                                          element types, which relationships
 *                                          are permitted.
 *
 * The output is committed. Amplify Hosting never runs this script, which is
 * why it can depend on an RDF toolchain the deployed app does not have.
 *
 * The TTL is parsed with a small hand-rolled reader rather than n3. The file is
 * machine-generated and uniform (`archimate:X rdf:type owl:Class ;` followed by
 * predicate lines terminated by `.`), and the alternative is making an RDF
 * parser a dependency of a script that runs three times a year.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const IN_TTL = resolve(ROOT, "ontology/upstream/archimate.ttl");
const IN_XML = resolve(ROOT, "ontology/upstream/relationships.xml");
const IN_OVERLAY = resolve(
  ROOT,
  "ontology/overlay/blueprinting-app-metadata.ttl"
);
const OUT_DIR = resolve(ROOT, "packages/metamodel/src/generated");
const PINNED = readFileSync(
  resolve(ROOT, "ontology/upstream/.pinned-commit"),
  "utf8"
).trim();

const NS = "https://purl.org/archimate#";

/* -------------------------------------------------------------------------- *
 * TTL
 * -------------------------------------------------------------------------- */

/**
 * Splits the Turtle into subject blocks. Every statement in this file starts at
 * column 0 with `archimate:Name rdf:type …` and ends at the first ` .` on its
 * own line-ending, so blocks are recoverable without a full parser.
 */
function readBlocks(ttl) {
  const blocks = [];
  // Terminator is " ." at the end of the final predicate line, not a "." on a
  // line of its own. Requiring whitespace before the dot keeps sentence-ending
  // periods inside rdfs:comment strings from ending a block early — those are
  // always preceded by a word character.
  const re = /^archimate:([A-Za-z]+)\s+rdf:type\s+(owl:Class|owl:ObjectProperty)\s*;([\s\S]*?)\s\.\s*$/gm;
  let m;
  while ((m = re.exec(ttl)) !== null) {
    blocks.push({ name: m[1], kind: m[2], body: m[3] });
  }
  return blocks;
}

const oneOf = (body, pred) => {
  const m = body.match(new RegExp(`${pred}\\s+"((?:[^"\\\\]|\\\\.)*)"`));
  return m ? m[1].replace(/\\"/g, '"').replace(/\\n/g, "\n") : undefined;
};

const superClasses = (body) =>
  [...body.matchAll(/rdfs:subClassOf\s+archimate:([A-Za-z]+)/g)].map((m) => m[1]);

/**
 * The specification's seven horizontal layers, in top-to-bottom order.
 *
 * Motivation is the odd one out: the ontology models it as an Aspect rather
 * than a Layer, because motivation elements sit beside the core layers instead
 * of below them. It is still a layer as far as this platform's users are
 * concerned, so it is mapped here rather than leaked into every consumer.
 */
const LAYER_BY_SUPERCLASS = {
  MotivationAspect: "motivation",
  StrategyLayer: "strategy",
  BusinessLayer: "business",
  ApplicationLayer: "application",
  TechnologyLayer: "technology",
  PhysicalLayer: "physical",
  ImplementationAndMigrationLayer: "implementation",
};

const LAYER_ORDER = [
  "motivation",
  "strategy",
  "business",
  "application",
  "technology",
  "physical",
  "implementation",
  "composite",
];

/**
 * Labels use ArchiMate 4's word, "domain", for what 3.2 calls a layer.
 *
 * 4 reorganises the language around domains and the two line up one-for-one
 * for everything 3.2 has, so the newer term costs nothing and is where the
 * standard has gone. The identifiers stay as they are — they come from the
 * pinned 3.2 ontology's class names and renaming them would be churn.
 *
 * Two do not survive into 4: Physical is folded into Technology, and 3.2's
 * Composite pair (Grouping, Location) moves into 4's new Common Domain. Both
 * are labelled honestly here as what 3.2 says they are. See ADR-0008.
 */
const LAYER_LABELS = {
  motivation: "Motivation",
  strategy: "Strategy",
  business: "Business",
  application: "Application",
  technology: "Technology",
  physical: "Physical",
  implementation: "Implementation & Migration",
  // Grouping and Location belong to no single layer by design (spec 3.3).
  composite: "Common",
};

const ASPECT_SUPERCLASSES = new Set([
  "InternalActiveStructure",
  "ExternalActiveStructure",
  "InternalBehavior",
  "ExternalBehavior",
  "PassiveStructure",
  "BehaviorAspect",
  "StructureAspect",
  "MotivationAspect",
  "CompositeElement",
]);

/**
 * Concrete element types.
 *
 * "Concrete" is decided by intersecting two sources, because neither alone is
 * right. The TTL's `rdfs:subClassOf archimate:Element` closure includes
 * `CompositeElement` and `LayerComposite`, which are organisational classes
 * that upstream simply did not flag `archimate:abstract true`. The matrix's
 * concept list includes `Relationship`, which is not an element at all — it is
 * there because ArchiMate lets you associate *with* a relationship.
 *
 * An element type is therefore one that both reaches `archimate:Element` in the
 * ontology AND appears in Appendix B. That is exactly the set a user can
 * instantiate and connect to something.
 */
function parseElements(ttl, matrixConcepts) {
  const classes = {};
  for (const { name, kind, body } of readBlocks(ttl)) {
    if (kind === "owl:Class") classes[name] = body;
  }

  const supersOf = {};
  const abstract = new Set();
  for (const [name, body] of Object.entries(classes)) {
    supersOf[name] = superClasses(body);
    if (/archimate:abstract\s+true/.test(body)) abstract.add(name);
  }

  const reaches = (name, target, seen = new Set()) => {
    if (seen.has(name)) return false;
    seen.add(name);
    return (supersOf[name] ?? []).some(
      (s) => s === target || reaches(s, target, seen)
    );
  };

  // Layer and aspect are looked up through the superclass chain rather than
  // only on the class itself, so a future element that inherits its layer from
  // a parent still resolves.
  const ancestors = (name, out = new Set()) => {
    for (const s of supersOf[name] ?? []) {
      if (!out.has(s)) {
        out.add(s);
        ancestors(s, out);
      }
    }
    return out;
  };

  const out = {};
  for (const name of Object.keys(classes)) {
    if (abstract.has(name)) continue;
    if (!reaches(name, "Element")) continue;
    if (!matrixConcepts.has(name)) continue;

    const body = classes[name];
    const chain = [...superClasses(body), ...ancestors(name)];
    const layerSuper = chain.find((c) => c in LAYER_BY_SUPERCLASS);
    const aspectSuper = chain.find((c) => ASPECT_SUPERCLASSES.has(c));

    out[name] = {
      id: name,
      label: oneOf(body, "rdfs:label") ?? name,
      comment: oneOf(body, "rdfs:comment") ?? "",
      layer: layerSuper ? LAYER_BY_SUPERCLASS[layerSuper] : "composite",
      aspect: aspectSuper ?? null,
      iri: NS + name,
    };
  }
  return out;
}

/**
 * The 11 concrete relationship types. The ontology also declares four abstract
 * grouping properties (structuralRelationship and friends, flagged
 * `archimate:abstract true`) and two housekeeping properties that are not
 * relationships at all.
 */
const NOT_A_RELATIONSHIP = new Set(["hasConcept", "hasProperty"]);

function parseRelationships(ttl) {
  const out = {};
  for (const { name, kind, body } of readBlocks(ttl)) {
    if (kind !== "owl:ObjectProperty") continue;
    if (NOT_A_RELATIONSHIP.has(name)) continue;
    if (/archimate:abstract\s+true/.test(body)) continue;

    out[name] = {
      id: name,
      label: oneOf(body, "rdfs:label") ?? name,
      comment: oneOf(body, "rdfs:comment") ?? "",
      iri: NS + name,
    };
  }
  return out;
}

/* -------------------------------------------------------------------------- *
 * Relationship matrix
 * -------------------------------------------------------------------------- */

/**
 * From the legend at the top of relationships.xml. UPPERCASE marks a direct
 * relationship, lowercase a derived one — the distinction matters because a
 * derived relationship is valid to assert but is implied by a chain of others,
 * so an editor may want to offer it differently.
 */
const LETTER_TO_RELATIONSHIP = {
  a: "access",
  c: "composition",
  f: "flow",
  g: "aggregation",
  i: "assignment",
  n: "influence",
  o: "association",
  r: "realization",
  s: "specialization",
  t: "triggering",
  v: "serving",
};

function parseMatrix(xml) {
  const matrix = {};
  const sourceRe = /<source concept="([A-Za-z]+)">([\s\S]*?)<\/source>/g;
  const targetRe = /<target concept="([A-Za-z]+)" relations="([A-Za-z]*)"\s*\/>/g;
  let s;
  while ((s = sourceRe.exec(xml)) !== null) {
    const [, source, body] = s;
    const targets = {};
    let t;
    targetRe.lastIndex = 0;
    while ((t = targetRe.exec(body)) !== null) {
      if (t[2]) targets[t[1]] = t[2];
    }
    matrix[source] = targets;
  }
  return matrix;
}

/* -------------------------------------------------------------------------- *
 * Overlay
 *
 * Platform conventions annotated onto the ArchiMate classes, kept in a
 * separate file so ontology/upstream/ stays byte-identical to what upstream
 * publishes. Same pattern as digitalhome-cloud-core's dhc-app-metadata.ttl
 * over Brick. See ADR-0007.
 * -------------------------------------------------------------------------- */

/** `bp:name ( "a" "b" )` — SHACL's list form, as it appears in the overlay. */
function shaclIn(body, predicate) {
  const m = body.match(new RegExp(`${predicate}\\s*\\(([^)]*)\\)`));
  if (!m) return undefined;
  return [...m[1].matchAll(/"([^"]*)"/g)].map((x) => x[1]);
}

function parseOverlay(ttl) {
  const languageVersion = ttl.match(/bp:languageVersion\s+"([^"]*)"/)?.[1];
  if (!languageVersion) {
    throw new Error("the overlay does not declare bp:languageVersion");
  }
  const annotations = {}; // archimate local name -> { flag: true, labels: {} }
  const conventions = {}; // bp: term -> { propertyKey, values, default }

  // Subject blocks: `prefix:Name ... .` terminated by " ." at a line end, the
  // same shape the upstream file uses.
  const blocks = [
    ...ttl.matchAll(
      /^(archimate|bp):([A-Za-z]+)\s+([\s\S]*?)\s\.\s*$/gm
    ),
  ];

  for (const [, prefix, name, body] of blocks) {
    if (prefix === "archimate") {
      const entry = (annotations[name] ??= { labels: {} });
      for (const flag of ["radarEligible", "schedulable"]) {
        if (new RegExp(`bp:${flag}\\s+true`).test(body)) entry[flag] = true;
      }
      for (const m of body.matchAll(/rdfs:label\s+"([^"]*)"@([a-z]{2})/g)) {
        entry.labels[m[2]] = m[1];
      }
      continue;
    }

    // bp: terms. Only those declaring a propertyKey are conventions the
    // application reads off an element; the rest are plumbing.
    const key = body.match(/bp:propertyKey\s+"([^"]*)"/)?.[1];
    if (!key) continue;
    conventions[name] = {
      term: name,
      propertyKey: key,
      values: shaclIn(body, "sh:in"),
      defaultValue: body.match(/sh:defaultValue\s+"([^"]*)"/)?.[1],
      label: oneOf(body, "rdfs:label"),
      comment: oneOf(body, "rdfs:comment"),
    };
  }

  return { annotations, conventions, languageVersion };
}

/* -------------------------------------------------------------------------- *
 * Emit
 * -------------------------------------------------------------------------- */

const banner = `// GENERATED FILE — DO NOT EDIT.
//
// Produced by scripts/gen-metamodel.mjs from the ontology pinned at
// ${PINNED}. To change anything here, change the ontology pin or the
// generator and run \`npm run gen:metamodel\`.
`;

const lit = (v) => JSON.stringify(v);

function emitElements(elements) {
  const entries = Object.values(elements)
    .sort((a, b) => a.id.localeCompare(b.id))
    .map(
      (e) =>
        `  ${e.id}: {\n` +
        `    id: ${lit(e.id)},\n` +
        `    label: ${lit(e.label)},\n` +
        `    comment: ${lit(e.comment)},\n` +
        `    layer: ${lit(e.layer)},\n` +
        `    aspect: ${lit(e.aspect)},\n` +
        `    iri: ${lit(e.iri)},\n` +
        `  },`
    )
    .join("\n");

  return `${banner}
export const LAYER_ORDER = ${lit(LAYER_ORDER)} as const;

export type LayerId = (typeof LAYER_ORDER)[number];

export const LAYER_LABELS: Record<LayerId, string> = ${JSON.stringify(
    LAYER_LABELS,
    null,
    2
  )};

export interface ElementType {
  /** PascalCase local name, e.g. "ApplicationComponent". */
  readonly id: string;
  /** Human label from the specification, e.g. "Application Component". */
  readonly label: string;
  /** The specification's definition of the element. */
  readonly comment: string;
  readonly layer: LayerId;
  /** Structural role within the layer, e.g. "InternalBehavior". */
  readonly aspect: string | null;
  readonly iri: string;
}

export const ELEMENTS = {
${entries}
} as const satisfies Record<string, ElementType>;

export type ElementTypeId = keyof typeof ELEMENTS;
`;
}

function emitRelationships(relationships, letters) {
  const entries = Object.values(relationships)
    .sort((a, b) => a.id.localeCompare(b.id))
    .map(
      (r) =>
        `  ${r.id}: {\n` +
        `    id: ${lit(r.id)},\n` +
        `    label: ${lit(r.label)},\n` +
        `    comment: ${lit(r.comment)},\n` +
        `    iri: ${lit(r.iri)},\n` +
        `  },`
    )
    .join("\n");

  return `${banner}
export interface RelationshipType {
  /** lowerCamelCase local name, e.g. "realization". */
  readonly id: string;
  readonly label: string;
  readonly comment: string;
  readonly iri: string;
}

export const RELATIONSHIPS = {
${entries}
} as const satisfies Record<string, RelationshipType>;

export type RelationshipTypeId = keyof typeof RELATIONSHIPS;

/**
 * The single-letter codes used by the matrix. Uppercase means the relationship
 * is direct; lowercase means it is derived.
 */
export const LETTER_TO_RELATIONSHIP: Record<string, RelationshipTypeId> = ${JSON.stringify(
    letters,
    null,
    2
  )};
`;
}

function emitMatrix(matrix) {
  const rows = Object.keys(matrix)
    .sort()
    .map((src) => {
      const targets = matrix[src];
      const cells = Object.keys(targets)
        .sort()
        .map((tgt) => `    ${tgt}: ${lit(targets[tgt])},`)
        .join("\n");
      return `  ${src}: {\n${cells}\n  },`;
    })
    .join("\n");

  return `${banner}
/**
 * Appendix B of the ArchiMate 3.2 specification: MATRIX[source][target] is the
 * set of permitted relationships, encoded as letters. Uppercase = direct,
 * lowercase = derived. An absent target pair means no relationship is
 * permitted in that direction.
 *
 * Kept in the compact upstream encoding rather than expanded into arrays: the
 * expanded form is roughly ten times the size for the same information, and
 * every consumer goes through the helpers in ../index.ts anyway.
 */
export const MATRIX: Record<string, Record<string, string>> = {
${rows}
};
`;
}

function emitOverlay(conventions, annotations, languageVersion) {
  const conventionEntries = Object.values(conventions)
    .sort((a, b) => a.term.localeCompare(b.term))
    .map(
      (c) =>
        `  ${c.term}: {\n` +
        `    term: ${lit(c.term)},\n` +
        `    propertyKey: ${lit(c.propertyKey)},\n` +
        `    label: ${lit(c.label ?? c.term)},\n` +
        `    comment: ${lit(c.comment ?? "")},\n` +
        `    values: ${c.values ? lit(c.values) : "null"},\n` +
        `    defaultValue: ${lit(c.defaultValue ?? null)},\n` +
        `  },`
    )
    .join("\n");

  const flagged = (flag) =>
    Object.entries(annotations)
      .filter(([, a]) => a[flag])
      .map(([name]) => name)
      .sort();

  const labels = Object.entries(annotations)
    .filter(([, a]) => Object.keys(a.labels).length > 0)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, a]) => `  ${name}: ${JSON.stringify(a.labels)},`)
    .join("\n");

  return `${banner}
/**
 * Platform conventions, declared in ontology/overlay/ and emitted here.
 *
 * These are NOT part of the ArchiMate language — they are what this platform
 * layers on top of it. Keeping them in the ontology rather than in TypeScript
 * means one place declares them and one place changes them, and it is what
 * makes more than one language version possible at once. See ADR-0007.
 */
export interface Convention {
  /** Term local name in the bp: namespace. */
  readonly term: string;
  /** Key used when stored as an ArchiMate Property on an element. */
  readonly propertyKey: string;
  readonly label: string;
  readonly comment: string;
  /** Permitted values from sh:in, or null when the value is free text. */
  readonly values: readonly string[] | null;
  readonly defaultValue: string | null;
}

/**
 * The ArchiMate specification version the pinned ontology expresses.
 *
 * Every model written by this platform is stamped with it, so an export can
 * name what it conforms to rather than leaving a reader to guess. See ADR-0007.
 */
export const LANGUAGE_VERSION = ${lit(languageVersion)};

export const CONVENTIONS = {
${conventionEntries}
} as const satisfies Record<string, Convention>;

export type ConventionId = keyof typeof CONVENTIONS;

/** Element types that name something a team can adopt or hold. */
export const RADAR_ELIGIBLE_TYPES = ${lit(flagged("radarEligible"))} as const;

/** Element types the Layer 7 Gantt places on a timeline. */
export const SCHEDULABLE_TYPES = ${lit(flagged("schedulable"))} as const;

/** Translated element labels, by element type then language tag. */
export const ELEMENT_LABELS_I18N: Record<string, Record<string, string>> = {
${labels}
};
`;
}

/* -------------------------------------------------------------------------- */

const ttl = readFileSync(IN_TTL, "utf8");
const overlayTtl = readFileSync(IN_OVERLAY, "utf8");
const xml = readFileSync(IN_XML, "utf8");

const matrix = parseMatrix(xml);

/**
 * Appears as a matrix concept but is not an element: ArchiMate permits an
 * association whose endpoint is a relationship. Kept in MATRIX so that stays
 * expressible, and kept out of ELEMENTS so nothing offers it in a palette.
 *
 * Junction, the other non-element concept, does not appear in Appendix B at
 * all and so needs no exclusion here.
 */
const MATRIX_ONLY_CONCEPTS = new Set(["Relationship"]);

const matrixConcepts = new Set(Object.keys(matrix));
for (const targets of Object.values(matrix)) {
  for (const t of Object.keys(targets)) matrixConcepts.add(t);
}

const elements = parseElements(ttl, matrixConcepts);
const relationships = parseRelationships(ttl);

// Fail loudly rather than emitting a plausible-looking but wrong metamodel.
// These counts come from the specification, not from a previous run.
const elementCount = Object.keys(elements).length;
const relationshipCount = Object.keys(relationships).length;
if (relationshipCount !== 11) {
  throw new Error(`expected 11 relationship types, parsed ${relationshipCount}`);
}
if (elementCount !== 60) {
  throw new Error(
    `expected 60 element types (61 Appendix B concepts less Relationship), parsed ${elementCount}`
  );
}
for (const concept of matrixConcepts) {
  if (!elements[concept] && !MATRIX_ONLY_CONCEPTS.has(concept)) {
    throw new Error(`matrix names ${concept}, which is not a known element type`);
  }
}
for (const src of Object.keys(matrix)) {
  for (const tgt of Object.keys(matrix[src])) {
    for (const letter of matrix[src][tgt]) {
      if (!LETTER_TO_RELATIONSHIP[letter.toLowerCase()]) {
        throw new Error(`matrix uses unknown relationship letter "${letter}"`);
      }
    }
  }
}

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(`${OUT_DIR}/elements.ts`, emitElements(elements));
writeFileSync(
  `${OUT_DIR}/relationships.ts`,
  emitRelationships(relationships, LETTER_TO_RELATIONSHIP)
);
writeFileSync(`${OUT_DIR}/matrix.ts`, emitMatrix(matrix));

const { annotations, conventions, languageVersion } = parseOverlay(overlayTtl);
for (const name of Object.keys(annotations)) {
  if (!elements[name]) {
    throw new Error(
      `the overlay annotates ${name}, which is not an ArchiMate element type`
    );
  }
}
if (Object.keys(conventions).length === 0) {
  throw new Error("the overlay declared no conventions; check the parser");
}
writeFileSync(
  `${OUT_DIR}/overlay.ts`,
  emitOverlay(conventions, annotations, languageVersion)
);

const byLayer = {};
for (const e of Object.values(elements)) byLayer[e.layer] = (byLayer[e.layer] ?? 0) + 1;

console.log(`ontology pinned at ${PINNED}`);
console.log(`  ${elementCount} element types`);
for (const layer of LAYER_ORDER) {
  if (byLayer[layer]) console.log(`    ${layer.padEnd(15)} ${byLayer[layer]}`);
}
console.log(`  ${relationshipCount} relationship types`);
console.log(`  ${Object.keys(matrix).length} matrix source rows`);
console.log(`overlay`);
console.log(`  ${Object.keys(conventions).length} conventions`);
console.log(`  ${Object.keys(annotations).length} annotated element types`);
console.log(`  ArchiMate ${languageVersion}`);
