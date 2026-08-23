import { DataFactory, Parser, Store, Writer } from "n3";
import type { Quad_Object, Quad_Subject } from "n3";
import { isElementType, isRelationshipType } from "@dlab5/archimate-metamodel";
import type {
  ElementTypeId,
  RelationshipTypeId,
} from "@dlab5/archimate-metamodel";
import {
  AM,
  ARCHIMATE_NS,
  BP,
  BP_NS,
  RDF_TYPE,
  archimateLocalName,
  elementIri,
  idFromIri,
  relationshipIri,
  typeIri,
  uniqueId,
} from "./iri.js";
import type { AbElement, AbModel, AbRelationship, Properties } from "./types.js";

const { namedNode, literal, blankNode } = DataFactory;

/* -------------------------------------------------------------------------- *
 * Write
 * -------------------------------------------------------------------------- */

/**
 * Serialises a model to Turtle.
 *
 * Each relationship is written twice, and deliberately so (ADR-0005): the
 * plain `<source> archimate:<type> <target>` triple is the ArchiMate-faithful
 * statement any consumer reads, and a descriptor resource typed
 * `archimate:Relationship` carries the identity and metadata a plain triple
 * cannot. RDF-Star would have been the ontology's preferred way to attach that
 * metadata, but N3.js discards it silently.
 */
export function serializeAbox(model: AbModel): Promise<string> {
  // No `bpi:` prefix is declared. Instance IRIs carry a path — .../<Type>/<id>
  // — and Turtle cannot abbreviate a local name containing "/", so n3 writes
  // them in full regardless. Declaring a prefix nothing uses is just noise.
  const writer = new Writer({
    prefixes: {
      archimate: ARCHIMATE_NS,
      bp: BP_NS,
    },
  });

  const propertyQuads = (
    subject: Quad_Subject,
    scope: string,
    properties: Properties
  ) => {
    // Keys are sorted, and blank-node labels are minted from the scope plus a
    // positional index, so a semantically identical model always produces a
    // byte-identical file. Two reasons that matters: the .ttl is reviewed in
    // pull requests, and writes carry an S3 ETag precondition — incidental
    // reordering would surface as a spurious conflict against another editor.
    //
    // The label cannot be derived from the property key: keys are user text
    // and may contain characters a blank-node label cannot. It cannot be left
    // to n3's blankNode() either — that counter is global to the module, not
    // per-writer, so labels drift between calls on the same input.
    const keys = Object.keys(properties).sort();
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      const node = blankNode(`p-${scope}-${i}`);
      writer.addQuad(subject, namedNode(AM.hasProperty), node);
      writer.addQuad(node, namedNode(RDF_TYPE), namedNode(AM.Property));
      writer.addQuad(node, namedNode(AM.propertyKey), literal(key));
      writer.addQuad(node, namedNode(AM.propertyValue), literal(properties[key]));
    }
  };

  for (const el of [...model.elements].sort((a, b) => a.id.localeCompare(b.id))) {
    const subject = namedNode(elementIri(model.projectSlug, el.type, el.id));
    writer.addQuad(subject, namedNode(RDF_TYPE), namedNode(typeIri(el.type)));
    writer.addQuad(subject, namedNode(AM.identifier), literal(el.id));
    writer.addQuad(subject, namedNode(AM.name), literal(el.name));
    if (el.documentation) {
      writer.addQuad(
        subject,
        namedNode(AM.documentation),
        literal(el.documentation)
      );
    }
    propertyQuads(subject, `e-${el.id}`, el.properties);
  }

  const elementById = new Map(model.elements.map((e) => [e.id, e]));

  for (const rel of [...model.relationships].sort((a, b) =>
    a.id.localeCompare(b.id)
  )) {
    const source = elementById.get(rel.source);
    const target = elementById.get(rel.target);
    // A relationship with a missing endpoint has no IRI to point at, so it
    // cannot be written as a triple. validateModel reports it as an error;
    // serialising skips it rather than emitting a broken graph.
    if (!source || !target) continue;

    const sourceNode = namedNode(
      elementIri(model.projectSlug, source.type, source.id)
    );
    const targetNode = namedNode(
      elementIri(model.projectSlug, target.type, target.id)
    );

    writer.addQuad(sourceNode, namedNode(typeIri(rel.type)), targetNode);

    const descriptor = namedNode(
      relationshipIri(model.projectSlug, rel.type, rel.id)
    );
    writer.addQuad(descriptor, namedNode(RDF_TYPE), namedNode(AM.Relationship));
    writer.addQuad(descriptor, namedNode(AM.identifier), literal(rel.id));
    writer.addQuad(
      descriptor,
      namedNode(BP.relationshipType),
      namedNode(typeIri(rel.type))
    );
    writer.addQuad(descriptor, namedNode(BP.source), sourceNode);
    writer.addQuad(descriptor, namedNode(BP.target), targetNode);
    if (rel.name) {
      writer.addQuad(descriptor, namedNode(AM.name), literal(rel.name));
    }
    if (rel.documentation) {
      writer.addQuad(
        descriptor,
        namedNode(AM.documentation),
        literal(rel.documentation)
      );
    }
    propertyQuads(descriptor, `r-${rel.id}`, rel.properties);
  }

  return new Promise((resolve, reject) => {
    writer.end((error: Error | null, result: string) =>
      error ? reject(error) : resolve(result)
    );
  });
}

/* -------------------------------------------------------------------------- *
 * Read
 * -------------------------------------------------------------------------- */

function readProperties(store: Store, subject: Quad_Subject): Properties {
  const out: Properties = {};
  for (const q of store.getQuads(subject, namedNode(AM.hasProperty), null, null)) {
    const node = q.object as Quad_Subject;
    const key = store.getObjects(node, namedNode(AM.propertyKey), null)[0];
    const value = store.getObjects(node, namedNode(AM.propertyValue), null)[0];
    if (key && value) out[key.value] = value.value;
  }
  return out;
}

function firstLiteral(
  store: Store,
  subject: Quad_Subject,
  predicate: string
): string | undefined {
  const o: Quad_Object | undefined = store.getObjects(
    subject,
    namedNode(predicate),
    null
  )[0];
  return o?.value;
}

/**
 * Parses a project's Turtle into a model.
 *
 * The plain relationship triple is authoritative and the descriptor is
 * decoration (ADR-0005). A descriptor with no matching triple is ignored; a
 * triple with no descriptor still produces a relationship, with an id derived
 * from its endpoints. That asymmetry is what lets a hand-edited or externally
 * generated file — one that knows nothing about `bp:` — round-trip correctly,
 * just with regenerated ids.
 */
export function parseAbox(turtle: string, projectSlug: string): AbModel {
  const store = new Store(new Parser().parse(turtle));

  /* -- elements ----------------------------------------------------------- */

  const elements: AbElement[] = [];
  const idByIri = new Map<string, string>();

  for (const q of store.getQuads(null, namedNode(RDF_TYPE), null, null)) {
    const local = archimateLocalName(q.object.value);
    if (!local || !isElementType(local)) continue;

    const subject = q.subject as Quad_Subject;
    const id =
      firstLiteral(store, subject, AM.identifier) ?? idFromIri(subject.value);

    elements.push({
      id,
      type: local as ElementTypeId,
      name: firstLiteral(store, subject, AM.name) ?? id,
      documentation: firstLiteral(store, subject, AM.documentation),
      properties: readProperties(store, subject),
    });
    idByIri.set(subject.value, id);
  }

  /* -- relationship descriptors, indexed by (type, source IRI, target IRI) - */

  interface Descriptor {
    id: string;
    name?: string;
    documentation?: string;
    properties: Properties;
  }
  const descriptors = new Map<string, Descriptor>();
  const key = (type: string, source: string, target: string) =>
    `${type} ${source} ${target}`;

  for (const q of store.getQuads(
    null,
    namedNode(RDF_TYPE),
    namedNode(AM.Relationship),
    null
  )) {
    const subject = q.subject as Quad_Subject;
    const type = archimateLocalName(
      firstLiteral(store, subject, BP.relationshipType) ?? ""
    );
    const source = firstLiteral(store, subject, BP.source);
    const target = firstLiteral(store, subject, BP.target);
    if (!type || !source || !target) continue;

    descriptors.set(key(type, source, target), {
      id: firstLiteral(store, subject, AM.identifier) ?? idFromIri(subject.value),
      name: firstLiteral(store, subject, AM.name),
      documentation: firstLiteral(store, subject, AM.documentation),
      properties: readProperties(store, subject),
    });
  }

  /* -- relationships, from the plain triples ------------------------------ */

  const relationships: AbRelationship[] = [];
  const usedIds = new Set<string>();

  for (const q of store.getQuads(null, null, null, null)) {
    const local = archimateLocalName(q.predicate.value);
    if (!local || !isRelationshipType(local)) continue;

    const sourceId = idByIri.get(q.subject.value);
    const targetId = idByIri.get(q.object.value);
    if (!sourceId || !targetId) continue;

    const descriptor = descriptors.get(
      key(local, q.subject.value, q.object.value)
    );
    const id = uniqueId(
      descriptor ? descriptor.id : `${sourceId}-${local}-${targetId}`,
      usedIds
    );
    usedIds.add(id);

    relationships.push({
      id,
      type: local as RelationshipTypeId,
      source: sourceId,
      target: targetId,
      name: descriptor?.name,
      documentation: descriptor?.documentation,
      properties: descriptor?.properties ?? {},
    });
  }

  elements.sort((a, b) => a.id.localeCompare(b.id));
  relationships.sort((a, b) => a.id.localeCompare(b.id));

  return { projectSlug, elements, relationships };
}
