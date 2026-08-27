import type { AppSyncIdentityCognito } from "aws-lambda";

/**
 * What a caller's token says about them.
 *
 * Shared by the two product-administration functions, which both need the user
 * pool and both gate on bp-admins. It is not shared with modelStorageProxy,
 * which needs only the group list and has its own narrower reader.
 */
export function claimsOf(identity: unknown) {
  const cognito = identity as AppSyncIdentityCognito | undefined;
  const claim = cognito?.claims?.["cognito:groups"];
  const groups = Array.isArray(claim)
    ? (claim as string[])
    : typeof claim === "string"
      ? claim.split(/[\s,]+/).filter(Boolean)
      : [];
  return {
    groups,
    username: cognito?.username ?? (cognito?.claims?.sub as string | undefined),
    /**
     * The user pool is recovered from the token's issuer rather than passed in
     * an environment variable. An env var would mean referencing the auth
     * stack from the data stack, which is the CloudFormation cycle described
     * in ADR-0006 — and the issuer is authoritative anyway, since it is the
     * pool that actually signed this request.
     */
    userPoolId: (cognito?.issuer ?? "").split("/").pop(),
  };
}

export const ADMIN_GROUP = "bp-admins";

/** Matches what a product id may look like, minted or inherited. */
export const SLUG = /^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/;
