import { AsyncLocalStorage } from "node:async_hooks";
import { parseAbox, serializeAbox } from "@dlab5/blueprint-core";
import type { AbModel } from "@dlab5/blueprint-core";

/**
 * The platform's backend, as the MCP server sees it.
 *
 * Deliberately goes through the same AppSync mutations the browser uses rather
 * than reaching into DynamoDB or S3. That means an agent inherits exactly the
 * same guarantees a person gets: the per-project Cognito group check inside
 * modelStorageProxy, and the S3 ETag precondition that refuses a lost update.
 * An agent with its own privileged path to the data would be a second security
 * boundary to keep correct, and it would be the one nobody audits.
 */

export interface Project {
  slug: string;
  name: string;
  description?: string | null;
  group: string;
}

/** A model plus the token needed to write it back. */
export interface LoadedModel {
  model: AbModel;
  /** null means the project has no model yet — a valid state, not an error. */
  etag: string | null;
}

export class ConflictError extends Error {}

interface Result<T> {
  data?: T;
  errors?: Array<{ message: string }>;
}

/**
 * The client, typed by hand rather than by `generateClient<Schema>`.
 *
 * The generated type is deep enough that tsc gives up with "Excessive stack
 * depth comparing types" — the same reason packages/site keeps its client
 * untyped (ADR-0001, and constraint 13 in CLAUDE.md). The shapes below are the
 * three calls this file makes and must track data/resource.ts by hand.
 */
export interface BpDocument {
  docId: string;
  projectSlug: string;
  title: string;
  classification: string;
  annotatedKey?: string | null;
  bytes?: number | null;
  uploadedAt?: string | null;
}

export interface BackendClient {
  models: {
    Project: { list: () => Promise<Result<Project[]>> };
    Document: {
      list: (args?: {
        filter?: { projectSlug?: { eq: string } };
      }) => Promise<Result<BpDocument[]>>;
    };
  };
  mutations: {
    saveDocument: (args: {
      projectSlug: string;
      docId: string;
      markdown: string;
      title?: string;
      classification?: string;
      kind?: string;
    }) => Promise<Result<{ docId: string; key: string }>>;
    requestDocumentReadUrl: (args: {
      projectSlug: string;
      docId: string;
      kind?: string;
    }) => Promise<Result<{ url?: string; exists: boolean; classification: string }>>;
    requestModelReadUrl: (args: { projectSlug: string }) => Promise<
      Result<{ url?: string; etag?: string; exists: boolean }>
    >;
    saveModel: (args: {
      projectSlug: string;
      turtle: string;
      etag?: string;
      expectAbsent?: boolean;
    }) => Promise<Result<{ etag?: string }>>;
  };
}

/**
 * Which client a call uses.
 *
 * Over stdio there is one: the process signed in once, at start-up, and
 * `setClient` holds that session. Hosted, every request carries its own key and
 * so its own identity, and two requests must never see each other's token. So
 * a request runs inside `withClient`, which binds its client to that request's
 * async context alone; `api()` prefers it, and a hosted process never calls
 * `setClient`, so a call outside a request finds nothing rather than somebody
 * else's session.
 */
let processClient: BackendClient | null = null;
const requestClient = new AsyncLocalStorage<BackendClient>();

export function setClient(client: BackendClient): void {
  processClient = client;
}

export function withClient<T>(client: BackendClient, fn: () => Promise<T>): Promise<T> {
  return requestClient.run(client, fn);
}

function api(): BackendClient {
  const client = requestClient.getStore() ?? processClient;
  if (!client) throw new Error("not connected: call connect() first");
  return client;
}

function unwrap<T>(result: Result<T>, what: string): T {
  if (result.errors?.length) {
    throw new Error(`${what}: ${result.errors.map((e) => e.message).join("; ")}`);
  }
  if (result.data === undefined || result.data === null) {
    throw new Error(`${what}: the API returned no data`);
  }
  return result.data;
}

export async function listProjects(): Promise<Project[]> {
  return unwrap(await api().models.Project.list(), "list projects");
}

export async function loadModel(projectSlug: string): Promise<LoadedModel> {
  const access = unwrap(
    await api().mutations.requestModelReadUrl({ projectSlug }),
    `read ${projectSlug}`
  );

  if (!access.exists || !access.url) {
    return {
      model: { projectSlug, elements: [], relationships: [] },
      etag: null,
    };
  }

  const response = await fetch(access.url);
  if (!response.ok) {
    throw new Error(`could not fetch the model (${response.status})`);
  }
  return {
    model: parseAbox(await response.text(), projectSlug),
    etag: access.etag ?? null,
  };
}

/**
 * Writes a model back under the ETag it was read with.
 *
 * There is no retry on conflict, and that is the point: a retry would fetch
 * the newer model and overwrite it with edits computed against the older one,
 * which is precisely the lost update the precondition exists to prevent. The
 * caller re-reads and redecides.
 */
export async function saveModel(
  model: AbModel,
  etag: string | null
): Promise<string | null> {
  const turtle = await serializeAbox(model);
  try {
    const saved = unwrap(
      await api().mutations.saveModel({
        projectSlug: model.projectSlug,
        turtle,
        etag: etag ?? undefined,
        expectAbsent: etag === null ? true : undefined,
      }),
      `save ${model.projectSlug}`
    );
    return saved.etag ?? null;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/changed since you loaded it/i.test(message)) {
      throw new ConflictError(
        "The model changed since it was read. Read it again and reapply the change."
      );
    }
    throw err;
  }
}

/**
 * Read, change, write — with the ETag from the read.
 *
 * Every mutating tool goes through this so the window between reading and
 * writing is as small as it can be, and so no tool can accidentally write
 * without a precondition.
 */
export async function mutate(
  projectSlug: string,
  change: (model: AbModel) => AbModel
): Promise<{ model: AbModel; etag: string | null }> {
  const { model, etag } = await loadModel(projectSlug);
  const next = change(model);
  const newEtag = await saveModel(next, etag);
  return { model: next, etag: newEtag };
}

/* -- documents -------------------------------------------------------------- */

/** Every document held for a product, without their text. */
export async function listDocuments(projectSlug: string): Promise<BpDocument[]> {
  const result = await api().models.Document.list({
    filter: { projectSlug: { eq: projectSlug } },
  });
  return unwrap(result, "list documents") ?? [];
}

/**
 * One document's markdown.
 *
 * The working copy by default, falling back to the source: annotation is
 * iterative, and an agent asked to continue should see the last pass rather
 * than start again from what arrived.
 */
export async function loadDocument(
  projectSlug: string,
  docId: string,
  kind: "source" | "annotated" = "annotated"
): Promise<{ markdown: string | null; classification: string }> {
  const fetchOne = async (which: "source" | "annotated") => {
    const access = unwrap(
      await api().mutations.requestDocumentReadUrl({ projectSlug, docId, kind: which }),
      `read ${docId}`
    );
    if (!access.exists || !access.url) return null;
    const response = await fetch(access.url);
    return response.ok ? { text: await response.text(), access } : null;
  };

  const wanted = await fetchOne(kind);
  if (wanted) return { markdown: wanted.text, classification: wanted.access.classification };

  if (kind === "annotated") {
    const source = await fetchOne("source");
    if (source) {
      return { markdown: source.text, classification: source.access.classification };
    }
  }
  return { markdown: null, classification: "confidential" };
}

/**
 * Writes the annotated working copy.
 *
 * Never the source. The source is the record of what arrived and the backend
 * refuses to rewrite it, so offering the choice here would only produce an
 * error a caller could not act on.
 */
export async function saveAnnotated(
  projectSlug: string,
  docId: string,
  markdown: string
): Promise<string> {
  const saved = unwrap(
    await api().mutations.saveDocument({
      projectSlug,
      docId,
      markdown,
      kind: "annotated",
    }),
    `save ${docId}`
  );
  return saved.key;
}
