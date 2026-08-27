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
