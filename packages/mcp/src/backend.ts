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
let currentOutputsPath = "";

/**
 * Signs in once per process, by password or by refresh token.
 *
 * Credentials come from the environment, the same way the repository's other
 * scripts take them. An MCP server started by an editor has no way to prompt.
 *
 * `BP_REFRESH_TOKEN` exists for the case a password cannot serve: a server
 * running somewhere nobody is sitting. It is a Cognito refresh token, which
 * makes it a real credential for the account rather than a shared key with no
 * identity — the exchanged access token carries the user's own groups, so
 * every authorization check downstream behaves exactly as it does in the app.
 *
 * What it is NOT is a scoped API key. It is the account, for thirty days, and
 * anyone holding it can do anything its owner can. Revoke it with Cognito's
 * RevokeToken, or by signing out of the app — signing out revokes it, which is
 * worth knowing in both directions.
 */
export async function connect(options: {
  outputsPath: string;
  username?: string;
  password?: string;
  refreshToken?: string;
  apiKey?: string;
}): Promise<void> {
  currentOutputsPath = options.outputsPath;
  Amplify.configure(JSON.parse(readFileSync(options.outputsPath, "utf8")));

  const mem = new Map<string, string>();
  cognitoUserPoolsTokenProvider.setKeyValueStorage({
    setItem: async (k, v) => void mem.set(k, v),
    getItem: async (k) => (mem.has(k) ? mem.get(k)! : null),
    removeItem: async (k) => void mem.delete(k),
    clear: async () => void mem.clear(),
  });

  if (options.apiKey) {
    if (!options.username) {
      throw new Error(
        "BP_API_KEY needs BP_USER as well: a key authenticates a particular " +
          "account, and Cognito has to be told which."
      );
    }
    await connectWithApiKey(options.username, options.apiKey, mem);
  } else if (options.refreshToken) {
    await connectWithRefreshToken(options.refreshToken, mem);
  } else if (options.username && options.password) {
    await signIn({ username: options.username, password: options.password });
    await fetchAuthSession();
  } else {
    throw new Error(
      "no credentials: set BP_USER with BP_API_KEY or BP_PASSWORD, " +
        "or set BP_REFRESH_TOKEN"
    );
  }

  client = generateClient({ authMode: "userPool" }) as unknown as BackendClient;
}

/**
 * Exchanges a refresh token for a session, and seeds Amplify's store with it.
 *
 * Amplify has no "sign in with a refresh token" call, so the exchange is the
 * raw Cognito one — which is all any client does anyway — and the result is
 * written into the same in-memory store Amplify reads from. From there the
 * generated client refreshes on its own, exactly as after a password sign-in.
 */
async function connectWithRefreshToken(
  refreshToken: string,
  mem: Map<string, string>
): Promise<void> {
  const outputs = JSON.parse(
    readFileSync(currentOutputsPath, "utf8")
  ) as {
    auth: { aws_region: string; user_pool_client_id: string };
  };
  const region = outputs.auth.aws_region;
  const clientId = outputs.auth.user_pool_client_id;

  const response = await fetch(
    `https://cognito-idp.${region}.amazonaws.com/`,
    {
      method: "POST",
      headers: {
        "content-type": "application/x-amz-json-1.1",
        "x-amz-target": "AWSCognitoIdentityProviderService.InitiateAuth",
      },
      body: JSON.stringify({
        AuthFlow: "REFRESH_TOKEN_AUTH",
        ClientId: clientId,
        AuthParameters: { REFRESH_TOKEN: refreshToken },
      }),
    }
  );

  const json = (await response.json()) as {
    message?: string;
    AuthenticationResult?: { AccessToken?: string; IdToken?: string };
  };
  if (!response.ok || !json.AuthenticationResult?.AccessToken) {
    // Cognito says "Refresh Token has been revoked" for a revoked token and
    // "Invalid Refresh Token" for a malformed one. Both are worth passing
    // through verbatim: they are the difference between "someone revoked this"
    // and "this was never a token".
    throw new Error(
      `BP_REFRESH_TOKEN was not accepted: ${json.message ?? response.statusText}`
    );
  }

  const { AccessToken, IdToken } = json.AuthenticationResult;
  const sub = JSON.parse(
    Buffer.from(AccessToken.split(".")[1], "base64url").toString("utf8")
  ).sub as string;

  const prefix = `CognitoIdentityServiceProvider.${clientId}`;
  mem.set(`${prefix}.LastAuthUser`, sub);
  mem.set(`${prefix}.${sub}.accessToken`, AccessToken);
  if (IdToken) mem.set(`${prefix}.${sub}.idToken`, IdToken);
  mem.set(`${prefix}.${sub}.refreshToken`, refreshToken);

  await fetchAuthSession();
}

/**
 * Exchanges an API key for a session, through Cognito custom authentication.
 *
 * Two round trips: InitiateAuth opens the challenge, RespondToAuthChallenge
 * answers it with the key. What comes back is an ordinary Cognito session
 * carrying the user's own groups, which is the whole reason this is a Cognito
 * credential rather than an API-level one (ADR-0012).
 *
 * The app client is chosen by the key's scope: a read key on the write client
 * is refused by the verifier, deliberately. `bp_` keys are read-only unless
 * created otherwise, so the read client is the default and the write client is
 * used only when BP_API_KEY_WRITE says to.
 */
/**
 * What a refused key means, since Cognito will not say.
 *
 * It answers NotAuthorizedException with "Incorrect username or password" for
 * every one of these, which is misleading rather than merely unhelpful — no
 * password is involved anywhere in this flow. The server withholds the
 * distinction deliberately, so the client lists the possibilities instead of
 * repeating a wrong one.
 */
const REFUSED =
  "the API key was not accepted. It may be wrong, revoked, expired, belong " +
  "to another account, or be read-only while BP_API_KEY_WRITE is set.";

async function connectWithApiKey(
  username: string,
  apiKey: string,
  mem: Map<string, string>
): Promise<void> {
  const outputs = JSON.parse(readFileSync(currentOutputsPath, "utf8")) as {
    auth: { aws_region: string; user_pool_client_id: string };
    custom?: { apiKeyClientReadId?: string; apiKeyClientWriteId?: string };
  };
  const region = outputs.auth.aws_region;
  const wantWrite = process.env.BP_API_KEY_WRITE === "1";
  const clientId = wantWrite
    ? outputs.custom?.apiKeyClientWriteId
    : outputs.custom?.apiKeyClientReadId;

  if (!clientId) {
    throw new Error(
      "this backend has no API key client; regenerate amplify_outputs.json"
    );
  }

  const call = async (target: string, body: unknown) => {
    const r = await fetch(`https://cognito-idp.${region}.amazonaws.com/`, {
      method: "POST",
      headers: {
        "content-type": "application/x-amz-json-1.1",
        "x-amz-target": `AWSCognitoIdentityProviderService.${target}`,
      },
      body: JSON.stringify(body),
    });
    const json = (await r.json()) as Record<string, unknown>;
    if (!r.ok) {
      // Cognito answers every custom-auth failure with "Incorrect username or
      // password", which is true of none of them: no password was involved.
      // The real cause is one of five, and the server refuses to say which on
      // purpose — so the message lists them rather than repeating a wrong one.
      const type = String(json.__type ?? "");
      if (type.includes("NotAuthorized")) throw new Error(REFUSED);
      throw new Error(String(json.message ?? r.statusText));
    }
    return json;
  };

  const started = (await call("InitiateAuth", {
    AuthFlow: "CUSTOM_AUTH",
    ClientId: clientId,
    AuthParameters: { USERNAME: username },
  })) as { Session?: string };

  const answered = (await call("RespondToAuthChallenge", {
    ChallengeName: "CUSTOM_CHALLENGE",
    ClientId: clientId,
    Session: started.Session,
    ChallengeResponses: { USERNAME: username, ANSWER: apiKey },
  })) as {
    AuthenticationResult?: {
      AccessToken?: string;
      IdToken?: string;
      RefreshToken?: string;
    };
  };

  const result = answered.AuthenticationResult;
  if (!result?.AccessToken) throw new Error(REFUSED);

  const sub = JSON.parse(
    Buffer.from(result.AccessToken.split(".")[1], "base64url").toString("utf8")
  ).sub as string;

  // Stored under the CONFIGURED client id, not the one just authenticated
  // against: that is where Amplify's token provider looks. The refresh token
  // is deliberately NOT stored — it belongs to the API-key client, and letting
  // Amplify try to refresh with it under a different client id would fail in a
  // way that looks like an expired session rather than a mismatch.
  //
  // The consequence is a hard ceiling of one access-token lifetime, sixty
  // minutes, per connect(). For an MCP server that is a long session; for
  // anything longer, connect() again.
  const prefix = `CognitoIdentityServiceProvider.${outputs.auth.user_pool_client_id}`;
  mem.set(`${prefix}.LastAuthUser`, sub);
  mem.set(`${prefix}.${sub}.accessToken`, result.AccessToken);
  if (result.IdToken) mem.set(`${prefix}.${sub}.idToken`, result.IdToken);

  await fetchAuthSession();
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
