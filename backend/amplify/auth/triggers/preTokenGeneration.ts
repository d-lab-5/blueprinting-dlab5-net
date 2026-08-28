import {
  CognitoIdentityProviderClient,
  ListUserPoolClientsCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import type { PreTokenGenerationV2TriggerHandler } from "aws-lambda";

/**
 * Marks a session that came from an API key, and takes its administrator
 * rights away.
 *
 * Two jobs, and both exist because the *generated* model operations cannot be
 * told about API keys. Their authorization rules read `cognito:groups` and know
 * nothing about app clients, so without this an administrator's read-only key
 * could call `createProject` directly and go around the five Lambdas that would
 * have refused it.
 *
 *   1. `bp:scope` is added to the token — `read` or `write` — so every other
 *      function reads one claim instead of resolving client ids of its own.
 *   2. `bp-admins` is removed, for read and write keys alike. Writing a row is
 *      an administrator's act performed through `provisionProject`,
 *      `projectRename`, `documentStore` or `documentDelete`, each of which
 *      checks the scope. A key has no business reaching around them.
 *
 * Per-product groups are left alone: a key should see exactly what its owner
 * sees, and reading is mostly what keys are for.
 *
 * V2 rather than V1 because V1 rewrites the ID token only, and AppSync accepts
 * either token — verified — so a V1 override would be bypassed by any client
 * that sent the access token instead.
 */

const ADMIN_GROUP = "bp-admins";

const READ_CLIENT_NAME = "blueprinting-api-key-read";
const WRITE_CLIENT_NAME = "blueprinting-api-key-write";

const idp = new CognitoIdentityProviderClient({});

/**
 * The two API-key clients, by name.
 *
 * Resolved at runtime rather than passed in, because an environment variable
 * holding a client id would point the function stack back at the auth stack
 * and close the CloudFormation cycle of ADR-0006. Cached for the life of the
 * container, so this is one call per cold start and none thereafter.
 */
let cached: { read?: string; write?: string } | null = null;

async function keyClients(userPoolId: string) {
  if (cached) return cached;

  const found: { read?: string; write?: string } = {};
  let token: string | undefined;
  do {
    const page = await idp.send(
      new ListUserPoolClientsCommand({
        UserPoolId: userPoolId,
        MaxResults: 60,
        NextToken: token,
      })
    );
    for (const c of page.UserPoolClients ?? []) {
      if (c.ClientName === READ_CLIENT_NAME) found.read = c.ClientId;
      if (c.ClientName === WRITE_CLIENT_NAME) found.write = c.ClientId;
    }
    token = page.NextToken;
  } while (token && !(found.read && found.write));

  cached = found;
  return cached;
}

export const handler: PreTokenGenerationV2TriggerHandler = async (event) => {
  const clientId = event.callerContext?.clientId;
  if (!clientId) return event;

  let clients: { read?: string; write?: string };
  try {
    clients = await keyClients(event.userPoolId);
  } catch (err) {
    // Failing closed here would lock everyone out of the application over a
    // Cognito hiccup, and this trigger's only job is to RESTRICT a key session.
    // A browser session is unaffected either way, so the safe failure is to
    // leave the token alone and say so loudly.
    console.error("[preTokenGeneration] could not resolve key clients", err);
    return event;
  }

  const scope =
    clientId === clients.write
      ? "write"
      : clientId === clients.read
        ? "read"
        : null;

  if (!scope) return event;

  const groups = event.request.groupConfiguration?.groupsToOverride ?? [];

  event.response.claimsAndScopeOverrideDetails = {
    idTokenGeneration: {
      claimsToAddOrOverride: { "bp:scope": scope },
    },
    accessTokenGeneration: {
      claimsToAddOrOverride: { "bp:scope": scope },
    },
    groupOverrideDetails: {
      groupsToOverride: groups.filter((g) => g !== ADMIN_GROUP),
      // Cleared deliberately: an IAM role attached to a group would grant
      // through a path this override does not cover.
      iamRolesToOverride: [],
      preferredRole: undefined,
    },
  };

  return event;
};
