import type { PreTokenGenerationV2TriggerHandler } from "aws-lambda";

import { requestedScope } from "./keyClients";

const ADMIN_GROUP = "bp-admins";

export const handler: PreTokenGenerationV2TriggerHandler = async (event) => {
  const clientId = event.callerContext?.clientId;
  if (!clientId) return event;

  let scope: "read" | "write" | null;
  try {
    scope = await requestedScope(event.userPoolId, clientId);
  } catch (err) {
    // Failing closed here would lock everyone out of the application over a
    // Cognito hiccup, and this trigger's only job is to RESTRICT a key session.
    // A browser session is unaffected either way, so the safe failure is to
    // leave the token alone and say so loudly.
    console.error("[preTokenGeneration] could not resolve key clients", err);
    return event;
  }

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
