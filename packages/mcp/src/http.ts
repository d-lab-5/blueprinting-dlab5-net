import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { DynamoDBClient, GetItemCommand } from "@aws-sdk/client-dynamodb";
import { createAppSyncClient } from "./appsync.js";
import { withClient } from "./data.js";
import { buildServer } from "./server.js";
import { exchangeApiKey, RefusedKey } from "./session.js";
import type { KeyRecord, SessionConfig } from "./session.js";
import { HOSTED_TOOLS } from "./tools.js";

/**
 * The blueprint MCP server, hosted: a Lambda behind a Function URL (ADR-0014).
 *
 * Every request carries `Authorization: Bearer bp_…`, a blueprinting API key.
 * The key becomes its owner's Cognito session (session.ts), and every call the
 * tools make goes to AppSync with that session's token, so the product groups,
 * the key's read/write scope and the bp-admins strip all apply exactly as they
 * do in the app. This server holds no privilege of its own beyond reading a
 * key's owner and scope.
 *
 * Stateless: a fresh MCP server per request, JSON responses, no sessions. The
 * only thing that outlives a request is the token cache, keyed by the key's
 * hash, so no request can ever be answered with another key's identity.
 */

const env = (name: string) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
};

let config: (SessionConfig & { appsyncUrl: string }) | null = null;

function configure() {
  if (config) return config;
  const ddb = new DynamoDBClient({});
  const table = env("API_KEY_TABLE");
  config = {
    appsyncUrl: env("APPSYNC_URL"),
    region: env("AWS_REGION"),
    readClientId: env("API_KEY_CLIENT_READ_ID"),
    writeClientId: env("API_KEY_CLIENT_WRITE_ID"),
    lookupKey: async (keyId: string): Promise<KeyRecord | null> => {
      const { Item } = await ddb.send(
        new GetItemCommand({
          TableName: table,
          Key: { keyId: { S: keyId } },
          ProjectionExpression: "ownerSub, #s",
          ExpressionAttributeNames: { "#s": "scope" },
        })
      );
      if (!Item?.ownerSub?.S) return null;
      return { ownerSub: Item.ownerSub.S, scope: Item.scope?.S ?? "read" };
    },
  };
  return config;
}

/** Handles one MCP request. Exported apart from the Lambda glue so tests can call it. */
export async function handleMcp(
  request: Request,
  authenticate: (key: string) => Promise<string>,
  clientFor: (token: string) => Parameters<typeof withClient>[0]
): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === "/healthz") return new Response("ok");

  const header = request.headers.get("authorization") ?? "";
  const key = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  let token: string;
  try {
    if (!key) throw new RefusedKey("unauthorized");
    token = await authenticate(key);
  } catch (err) {
    if (err instanceof RefusedKey) {
      return new Response(err.message, {
        status: 401,
        headers: { "www-authenticate": "Bearer", "content-type": "text/plain" },
      });
    }
    throw err;
  }

  const server = buildServer(HOSTED_TOOLS);
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  try {
    return await withClient(clientFor(token), () => transport.handleRequest(request));
  } finally {
    await server.close();
  }
}

/* -- Lambda Function URL glue ------------------------------------------------ */

interface FunctionUrlEvent {
  rawPath: string;
  rawQueryString?: string;
  headers?: Record<string, string>;
  body?: string;
  isBase64Encoded?: boolean;
  requestContext: { http: { method: string }; domainName: string };
}

export async function handler(event: FunctionUrlEvent) {
  const method = event.requestContext.http.method;
  const body =
    event.body === undefined || method === "GET" || method === "HEAD"
      ? undefined
      : event.isBase64Encoded
        ? Buffer.from(event.body, "base64")
        : event.body;
  const request = new Request(
    `https://${event.requestContext.domainName}${event.rawPath}${event.rawQueryString ? `?${event.rawQueryString}` : ""}`,
    { method, headers: event.headers ?? {}, body }
  );

  let response: Response;
  try {
    // Configuration is read only once a request needs it, so the health check
    // and a keyless request are answered even by a misconfigured function.
    response = await handleMcp(
      request,
      (key) => exchangeApiKey(key, configure()),
      (token) => createAppSyncClient(configure().appsyncUrl, token)
    );
  } catch (err) {
    // Logged without the request: its headers carry the key.
    console.error(`[blueprint-mcp] ${err instanceof Error ? err.message : err}`);
    response = new Response("internal error", { status: 500 });
  }

  const headers: Record<string, string> = {};
  response.headers.forEach((value, name) => (headers[name] = value));
  return { statusCode: response.status, headers, body: await response.text() };
}
