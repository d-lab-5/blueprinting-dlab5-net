import { readFileSync } from "node:fs";
import { Amplify } from "aws-amplify";
import { fetchAuthSession, signIn } from "aws-amplify/auth";
import { cognitoUserPoolsTokenProvider } from "aws-amplify/auth/cognito";
import { generateClient } from "aws-amplify/data";
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
interface BackendClient {
  models: {
    Project: { list: () => Promise<Result<Project[]>> };
  };
  mutations: {
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

let client: BackendClient | null = null;

/**
 * Signs in once per process.
 *
 * Credentials come from the environment, the same way the repository's other
 * scripts take them. An MCP server started by an editor has no way to prompt,
 * and a token cached on disk is a credential nobody remembers to revoke.
 */
export async function connect(options: {
  outputsPath: string;
  username: string;
  password: string;
}): Promise<void> {
  Amplify.configure(JSON.parse(readFileSync(options.outputsPath, "utf8")));

  const mem = new Map<string, string>();
  cognitoUserPoolsTokenProvider.setKeyValueStorage({
    setItem: async (k, v) => void mem.set(k, v),
    getItem: async (k) => (mem.has(k) ? mem.get(k)! : null),
    removeItem: async (k) => void mem.delete(k),
    clear: async () => void mem.clear(),
  });

  await signIn({ username: options.username, password: options.password });
  await fetchAuthSession();
  client = generateClient({ authMode: "userPool" }) as unknown as BackendClient;
}

function api() {
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
