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
    // Still fails open HERE — the token is issued — but it now carries no
    // bp:scope at all, and requireWrite() denies writes when the claim is
    // missing. So a Cognito hiccup degrades everyone to read-only rather than
    // either locking sign-in out entirely or, as it did before, handing a
    // read-only key an administrator session.
    console.error("[preTokenGeneration] could not resolve key clients", err);
    return event;
  }

  // A browser session is marked too, not just a key one. The claim's ABSENCE
  // then means this trigger did not run, which downstream can fail closed on.
  // Without this, a lookup failure produced a token with no scope AND no group
  // strip — and a missing scope read as "not a key, may write", so a read-only
  // key became an administrator. Fail-open on an authorization control.
  if (!scope) {
    event.response.claimsAndScopeOverrideDetails = {
      idTokenGeneration: { claimsToAddOrOverride: { "bp:scope": "web" } },
      accessTokenGeneration: { claimsToAddOrOverride: { "bp:scope": "web" } },
    };
    return event;
  }

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
