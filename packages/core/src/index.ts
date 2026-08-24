export type {
  AbElement,
  AbModel,
  AbRelationship,
  Properties,
} from "./types.js";
export { emptyModel } from "./types.js";

export {
  AbElementSchema,
  AbModelSchema,
  AbRelationshipSchema,
  IdSchema,
  PropertiesSchema,
} from "./schema.js";

export { parseAbox, serializeAbox } from "./ttl.js";

export { hasErrors, validateModel } from "./validate.js";
export type { Finding, Severity } from "./validate.js";

export {
  AM,
  ARCHIMATE_NS,
  BP,
  BP_NS,
  archimateLocalName,
  elementIri,
  idFromIri,
  instanceBase,
  relationshipIri,
  slugifyId,
  typeIri,
  uniqueId,
} from "./iri.js";

export { PLATFORM_ROADMAP } from "./seed/platform-roadmap.js";
export { toMermaidGantt } from "./diagrams/gantt.js";
export type { GanttOptions } from "./diagrams/gantt.js";

export {
  RADAR_ELEMENT_TYPES,
  RADAR_MOVED,
  RADAR_PROPS,
  RADAR_RINGS,
  canBeRadarEntry,
  toRadar,
  validateRadar,
} from "./radar.js";
export type {
  RadarEntry,
  RadarFinding,
  RadarMoved,
  RadarQuadrant,
  RadarRing,
} from "./radar.js";
