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

/**
 * Whether this session came from an API key, and what it may do.
 *
 * The app client id is the signal, because Cognito sets it and the caller
 * cannot: it arrives as `client_id` in an access token and `aud` in an ID
 * token, and AppSync accepts either. A key's own scope was already checked
 * against the client it authenticated with, so the client alone is enough
 * here.
 *
 * A browser session has neither id and is unrestricted, exactly as before.
 */
export function keySession(identity: unknown) {
  const cognito = identity as { claims?: Record<string, unknown> } | undefined;
  const clientId =
    (cognito?.claims?.client_id as string | undefined) ??
    (cognito?.claims?.aud as string | undefined);

  const read = process.env.API_KEY_CLIENT_READ;
  const write = process.env.API_KEY_CLIENT_WRITE;

  if (!clientId || (clientId !== read && clientId !== write)) {
    return { isKey: false, mayWrite: true };
  }
  return { isKey: true, mayWrite: clientId === write };
}

/** Throws unless this session may change things. */
export function requireWrite(identity: unknown, what: string): void {
  const { isKey, mayWrite } = keySession(identity);
  if (isKey && !mayWrite) {
    throw new Error(
      `This API key is read-only, so it cannot ${what}. Create a key with ` +
        `write scope, or sign in.`
    );
  }
}
