/**
 * IRI minting.
 *
 * Instance IRIs follow the shape DHC Designer's aboxSerializer.js established
 * — namespace, project, type, id — so a reader who knows one platform's
 * graphs can navigate the other's:
 *
 *   https://blueprinting.dlab5.net/i/<slug>/<Type>/<id>
 *
 * `bp:` is our own vocabulary and holds exactly three terms, all of them
 * relationship bookkeeping the ArchiMate ontology does not define. Everything
 * with real ArchiMate meaning uses `archimate:`. See ADR-0005.
 */
export const ARCHIMATE_NS = "https://purl.org/archimate#";
export const BP_NS = "https://blueprinting.dlab5.net/ns#";

export const BP = {
  relationshipType: `${BP_NS}relationshipType`,
  source: `${BP_NS}source`,
  target: `${BP_NS}target`,
} as const;

export const AM = {
  identifier: `${ARCHIMATE_NS}identifier`,
  name: `${ARCHIMATE_NS}name`,
  documentation: `${ARCHIMATE_NS}documentation`,
  hasProperty: `${ARCHIMATE_NS}hasProperty`,
  propertyKey: `${ARCHIMATE_NS}propertyKey`,
  propertyValue: `${ARCHIMATE_NS}propertyValue`,
  Property: `${ARCHIMATE_NS}Property`,
  Relationship: `${ARCHIMATE_NS}Relationship`,
} as const;

export const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";

export function instanceBase(projectSlug: string): string {
  return `https://blueprinting.dlab5.net/i/${projectSlug}/`;
}

export function elementIri(
  projectSlug: string,
  type: string,
  id: string
): string {
  return `${instanceBase(projectSlug)}${type}/${id}`;
}

export function relationshipIri(
  projectSlug: string,
  type: string,
  id: string
): string {
  return `${instanceBase(projectSlug)}${type}/${id}`;
}

export function typeIri(localName: string): string {
  return `${ARCHIMATE_NS}${localName}`;
}

/** Local name of an `archimate:` term, or null if the IRI is from elsewhere. */
export function archimateLocalName(iri: string): string | null {
  return iri.startsWith(ARCHIMATE_NS) ? iri.slice(ARCHIMATE_NS.length) : null;
}

/**
 * Recovers the id from an instance IRI. Ids may not contain "/", which
 * `slugifyId` guarantees, so the last segment is unambiguous.
 */
export function idFromIri(iri: string): string {
  return iri.slice(iri.lastIndexOf("/") + 1);
}

/**
 * Ids appear in IRIs, so they are restricted to characters that need no
 * escaping and cannot introduce a path segment.
 */
export function slugifyId(value: string): string {
  return (
    value
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 64) || "x"
  );
}

/** `slugifyId` plus a numeric suffix if needed to stay unique within `taken`. */
export function uniqueId(value: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  const base = slugifyId(value);
  if (!used.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`;
    if (!used.has(candidate)) return candidate;
  }
}
