import { z } from "zod";
import { isElementType, isRelationshipType } from "@dlab5/archimate-metamodel";

/**
 * Ids appear inside IRIs, so the shape is constrained rather than merely
 * validated — see slugifyId in iri.ts, which produces exactly this.
 */
export const IdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9][a-z0-9-]*$/, "id must be lowercase alphanumeric with hyphens");

export const PropertiesSchema = z.record(z.string(), z.string());

/**
 * Element and relationship types are checked against the generated metamodel
 * rather than a hand-written enum, so a re-pinned ontology cannot leave a
 * stale list behind.
 */
export const AbElementSchema = z.object({
  id: IdSchema,
  type: z.string().refine(isElementType, {
    message: "not an ArchiMate 3.2 element type",
  }),
  name: z.string().min(1),
  documentation: z.string().optional(),
  properties: PropertiesSchema,
});

export const AbRelationshipSchema = z.object({
  id: IdSchema,
  type: z.string().refine(isRelationshipType, {
    message: "not an ArchiMate 3.2 relationship type",
  }),
  source: IdSchema,
  target: IdSchema,
  name: z.string().optional(),
  documentation: z.string().optional(),
  properties: PropertiesSchema,
});

export const AbModelSchema = z.object({
  projectSlug: z.string().min(1),
  elements: z.array(AbElementSchema),
  relationships: z.array(AbRelationshipSchema),
});
