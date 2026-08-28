import type { PreTokenGenerationV2TriggerHandler } from "aws-lambda";

/**
 * Strips administrator rights from a session that came from an API key.
 *
 * The five hand-written Lambdas can tell a key session from a browser one by
 * its `client_id`, which Cognito sets and the caller cannot forge. The
 * *generated* model operations cannot: their authorization rules read
 * `cognito:groups` and know nothing about app clients. So a read-only key held
 * by an administrator could otherwise call `createProject` or `updateDocument`
 * directly and write rows the Lambdas would have refused.
 *
 * Removing `bp-admins` closes that, for read and write keys alike. Writing a
 * row is an administrator's act performed through `provisionProject`,
 * `projectRename`, `documentStore` or `documentDelete` — all of which check
 * the scope themselves. A key has no business reaching around them.
 *
 * Per-product groups are left alone: a key should see exactly what its owner
 * sees, and reading is the thing keys are mostly for.
 *
 * V2 rather than V1 because V1 rewrites the ID token only, and AppSync accepts
 * either token — so a V1 override would be bypassed by any client that sent
 * the access token instead. Verified: both are accepted.
 */

const ADMIN_GROUP = "bp-admins";

/** The app clients that exist solely for API keys, from the environment. */
function apiKeyClients(): string[] {
  return [process.env.API_KEY_CLIENT_READ, process.env.API_KEY_CLIENT_WRITE]
    .filter((id): id is string => Boolean(id));
}

export const handler: PreTokenGenerationV2TriggerHandler = async (event) => {
  const clientId = event.callerContext?.clientId;
  if (!clientId || !apiKeyClients().includes(clientId)) return event;

  const groups = event.request.groupConfiguration?.groupsToOverride ?? [];
  const kept = groups.filter((g) => g !== ADMIN_GROUP);

  event.response.claimsAndScopeOverrideDetails = {
    groupOverrideDetails: {
      groupsToOverride: kept,
      // Cleared deliberately. An IAM role attached to a group would grant
      // through a path this override does not cover.
      iamRolesToOverride: [],
      preferredRole: undefined,
    },
  };

  return event;
};
