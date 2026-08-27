import { generateClient } from "aws-amplify/api";
import type { AbModel } from "@dlab5/blueprint-core";
import { parseAbox, serializeAbox } from "@dlab5/blueprint-core";

/**
 * The AppSync client, and the two model-store calls layered on it.
 *
 * The client is deliberately untyped rather than parameterised with
 * `Schema` from backend/amplify/data/resource. Importing that type would pull
 * @aws-amplify/backend into the site's TypeScript program, and with it the
 * graphql 15 tree that ADR-0001 keeps out of the frontend. The shapes below
 * are narrow and hand-written for that reason; they must be kept in step with
 * data/resource.ts by hand.
 */

export interface Project {
  slug: string;
  name: string;
  description?: string | null;
  group: string;
  ttlKey: string;
  version?: number | null;
  lockedBy?: string | null;
  lockedAt?: string | null;
}

/**
 * Where a document may go. The axis is destination, not sensitivity.
 *
 *                   in a bundle   safe in a public repo
 *   confidential         no              no
 *   collaboration       yes              no
 *   shared              yes             yes
 */
export type Classification = "confidential" | "collaboration" | "shared";

/**
 * A source document held beside the model.
 *
 * `classification` decides how far it travels: `shared` documents go with the
 * model in a transfer bundle, `confidential` ones never do and come out only
 * as a local download. Anything unclassified is confidential.
 */
export interface BpDocument {
  docId: string;
  projectSlug: string;
  title: string;
  classification: Classification;
  sourceKey: string;
  annotatedKey?: string | null;
  bytes?: number | null;
  uploadedAt?: string | null;
  updatedAt?: string | null;
}

export interface DocumentAccess {
  docId: string;
  key: string;
  url?: string | null;
  exists: boolean;
  classification: string;
}

export interface ModelAccess {
  url?: string | null;
  etag?: string | null;
  exists: boolean;
  key: string;
}

/** Thrown when a save loses a race. Distinct so the UI can offer a reload. */
export class ModelConflictError extends Error {}

const LIST_PROJECTS = /* GraphQL */ `
  query ListProjects {
    listProjects {
      items {
        slug
        name
        description
        group
        ttlKey
        version
        lockedBy
        lockedAt
      }
    }
  }
`;

const LIST_DOCUMENTS = /* GraphQL */ `
  query ListDocuments($projectSlug: String!) {
    listDocuments(projectSlug: $projectSlug) {
      items {
        docId
        projectSlug
        title
        classification
        sourceKey
        annotatedKey
        bytes
        uploadedAt
        updatedAt
      }
    }
  }
`;

const SAVE_DOCUMENT = /* GraphQL */ `
  mutation SaveDocument(
    $projectSlug: String!
    $docId: String!
    $markdown: String!
    $title: String
    $classification: String
    $kind: String
  ) {
    saveDocument(
      projectSlug: $projectSlug
      docId: $docId
      markdown: $markdown
      title: $title
      classification: $classification
      kind: $kind
    ) {
      docId
      key
      exists
      classification
    }
  }
`;

const READ_DOCUMENT = /* GraphQL */ `
  mutation RequestDocumentReadUrl(
    $projectSlug: String!
    $docId: String!
    $kind: String
  ) {
    requestDocumentReadUrl(
      projectSlug: $projectSlug
      docId: $docId
      kind: $kind
    ) {
      docId
      key
      url
      exists
      classification
    }
  }
`;

const GET_PROJECT = /* GraphQL */ `
  query GetProject($slug: ID!) {
    getProject(slug: $slug) {
      slug
      name
      description
      group
      ttlKey
      version
      lockedBy
      lockedAt
    }
  }
`;

const RENAME_PROJECT = /* GraphQL */ `
  mutation RenameProject($slug: String!, $name: String!, $description: String) {
    renameProject(slug: $slug, name: $name, description: $description) {
      slug
      name
      description
      group
      ttlKey
    }
  }
`;

const PROVISION_PROJECT = /* GraphQL */ `
  mutation ProvisionProject($slug: String!, $name: String!, $description: String) {
    provisionProject(slug: $slug, name: $name, description: $description) {
      slug
      name
      description
      group
      ttlKey
    }
  }
`;

const REQUEST_READ_URL = /* GraphQL */ `
  mutation RequestModelReadUrl($projectSlug: String!) {
    requestModelReadUrl(projectSlug: $projectSlug) {
      url
      etag
      exists
      key
    }
  }
`;

const SAVE_MODEL = /* GraphQL */ `
  mutation SaveModel(
    $projectSlug: String!
    $turtle: String!
    $etag: String
    $expectAbsent: Boolean
  ) {
    saveModel(
      projectSlug: $projectSlug
      turtle: $turtle
      etag: $etag
      expectAbsent: $expectAbsent
    ) {
      etag
      exists
      key
    }
  }
`;

interface GraphQLResult<T> {
  data?: T;
  errors?: Array<{ message: string }>;
}

function unwrap<T>(result: GraphQLResult<T>): T {
  if (result.errors?.length) {
    throw new Error(result.errors.map((e) => e.message).join("; "));
  }
  if (!result.data) throw new Error("The API returned no data.");
  return result.data;
}

const client = () => generateClient();

/**
 * Every project the caller may see.
 *
 * The list comes from the Project table, not from the user's Cognito groups.
 * AppSync applies the authorization rules server-side, so a bp-admins member
 * sees every project while everyone else sees only theirs — which the earlier
 * group-derived list got wrong for admins.
 */
export async function listProjects(): Promise<Project[]> {
  const result = (await client().graphql({
    query: LIST_PROJECTS,
  })) as GraphQLResult<{ listProjects: { items: Project[] } }>;
  return unwrap(result).listProjects.items;
}

/**
 * One product's metadata row.
 *
 * Separate from `listProjects` because a product page needs the row itself —
 * its name is what the page is titled with, and under ADR-0009 the id in the
 * URL is opaque and says nothing a reader can use. Returns null when the row
 * does not exist or the caller may not see it; AppSync does not distinguish
 * the two, and neither should the UI.
 */
export async function getProject(slug: string): Promise<Project | null> {
  const result = (await client().graphql({
    query: GET_PROJECT,
    variables: { slug },
  })) as GraphQLResult<{ getProject: Project | null }>;
  return unwrap(result).getProject ?? null;
}

/**
 * Creates a project and its Cognito group.
 *
 * Calls `provisionProject`, not the `createProject` that Amplify generates for
 * the Project model — that one writes a bare row with no Cognito group, which
 * is a project nobody but an administrator can open.
 *
 * Administrators only, enforced in the Lambda rather than here — the Cognito
 * calls need admin permissions the browser must never hold, and a project row
 * without its group is one nobody but an administrator can open.
 */
export async function createProject(input: {
  slug: string;
  name: string;
  description?: string;
}): Promise<Project> {
  const result = (await client().graphql({
    query: PROVISION_PROJECT,
    variables: {
      slug: input.slug,
      name: input.name,
      description: input.description || undefined,
    },
  })) as GraphQLResult<{ provisionProject: Project }>;
  return unwrap(result).provisionProject;
}

/**
 * Loads a project's ABox.
 *
 * Returns the ETag alongside the model: it is the token a later save must
 * present, and without it the save would have to be unconditional, which the
 * backend refuses.
 */
/**
 * Changes a product's name and description.
 *
 * Calls `renameProject`, not the generated `updateProject`, so that the
 * Cognito group's description is kept in step — under ADR-0009 the group name
 * is opaque, and that description is the only thing in the console that says
 * which product it belongs to.
 *
 * The id is not changeable. Re-identifying a product is an export and a
 * reload (ADR-0010).
 */
export async function renameProject(input: {
  slug: string;
  name: string;
  description?: string;
}): Promise<Project> {
  const result = (await client().graphql({
    query: RENAME_PROJECT,
    variables: {
      slug: input.slug,
      name: input.name,
      description: input.description ?? null,
    },
  })) as GraphQLResult<{ renameProject: Project }>;
  return unwrap(result).renameProject;
}

/** Every document held for a product. */
export async function listDocuments(projectSlug: string): Promise<BpDocument[]> {
  const result = (await client().graphql({
    query: LIST_DOCUMENTS,
    variables: { projectSlug },
  })) as GraphQLResult<{ listDocuments: { items: BpDocument[] } }>;
  return unwrap(result).listDocuments.items;
}

/**
 * Stores a document, or its annotated working copy.
 *
 * `classification` is omitted rather than defaulted here: the function treats
 * an omitted value as "leave as it is" on an update and as confidential on a
 * first write, and a default in the browser would quietly override that.
 */
export async function saveDocument(input: {
  projectSlug: string;
  docId: string;
  markdown: string;
  title?: string;
  classification?: Classification;
  kind?: "source" | "annotated";
}): Promise<DocumentAccess> {
  const result = (await client().graphql({
    query: SAVE_DOCUMENT,
    variables: {
      projectSlug: input.projectSlug,
      docId: input.docId,
      markdown: input.markdown,
      title: input.title ?? null,
      classification: input.classification ?? null,
      kind: input.kind ?? "source",
    },
  })) as GraphQLResult<{ saveDocument: DocumentAccess }>;
  return unwrap(result).saveDocument;
}

/** The markdown itself, through a short-lived pre-signed URL. */
export async function loadDocument(
  projectSlug: string,
  docId: string,
  kind: "source" | "annotated" = "source"
): Promise<{ markdown: string | null; access: DocumentAccess }> {
  const result = (await client().graphql({
    query: READ_DOCUMENT,
    variables: { projectSlug, docId, kind },
  })) as GraphQLResult<{ requestDocumentReadUrl: DocumentAccess }>;
  const access = unwrap(result).requestDocumentReadUrl;
  if (!access.exists || !access.url) return { markdown: null, access };
  const response = await fetch(access.url);
  if (!response.ok) return { markdown: null, access };
  return { markdown: await response.text(), access };
}

export async function loadModel(
  projectSlug: string
): Promise<{ model: AbModel; etag: string | null }> {
  const result = (await client().graphql({
    query: REQUEST_READ_URL,
    variables: { projectSlug },
  })) as GraphQLResult<{ requestModelReadUrl: ModelAccess }>;

  const access = unwrap(result).requestModelReadUrl;

  // A project with no model yet is an ordinary state, not an error.
  if (!access.exists || !access.url) {
    return {
      model: { projectSlug, elements: [], relationships: [] },
      etag: null,
    };
  }

  const response = await fetch(access.url);
  if (!response.ok) {
    throw new Error(`Could not fetch the model (${response.status}).`);
  }
  return {
    model: parseAbox(await response.text(), projectSlug),
    etag: access.etag ?? null,
  };
}

/**
 * Saves a project's ABox under the ETag it was loaded with.
 *
 * `etag: null` means "this project had no model", which the backend accepts
 * only if that is still true. Either way the write is conditional.
 */
export async function saveModel(
  model: AbModel,
  etag: string | null
): Promise<string | null> {
  const turtle = await serializeAbox(model);
  try {
    const result = (await client().graphql({
      query: SAVE_MODEL,
      variables: {
        projectSlug: model.projectSlug,
        turtle,
        etag: etag ?? undefined,
        expectAbsent: etag === null ? true : undefined,
      },
    })) as GraphQLResult<{ saveModel: ModelAccess }>;
    return unwrap(result).saveModel.etag ?? null;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/changed since you loaded it/i.test(message)) {
      throw new ModelConflictError(message);
    }
    throw err;
  }
}
