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
