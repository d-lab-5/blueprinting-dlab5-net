import { createHash } from "node:crypto";

/**
 * Turning a blueprinting API key into that user's Cognito session (ADR-0012).
 *
 * The key alone cannot sign in: Cognito's custom auth needs a USERNAME, and a
 * key (`bp_<keyId>_<secret>`) does not carry one. The key's own record does —
 * its owner's `sub`, which is the pool's username for e-mail sign-in — and its
 * scope, which picks the app client. So the server reads that one row, then
 * runs the same two Cognito calls the stdio server does. The verifier in
 * Cognito still checks everything that matters: the hash, the owner, revoked,
 * expired, and a read key presented on the write client.
 */

export const KEY_SHAPE = /^bp_([a-z0-9]{8})_[a-z0-9]{32}$/;

/** The same words for every refusal: which part failed is not ours to say. */
export const REFUSED =
  "The API key was not accepted. It may be wrong, revoked or expired.";

export interface KeyRecord {
  ownerSub: string;
  scope: string;
}

export interface SessionConfig {
  region: string;
  readClientId: string;
  writeClientId: string;
  /** keyId -> the key's row, or null. Injected so tests need no AWS. */
  lookupKey: (keyId: string) => Promise<KeyRecord | null>;
  /** Cognito's JSON API. Injected for the same reason. */
  cognito?: (target: string, body: unknown) => Promise<Record<string, unknown>>;
  now?: () => number;
}

export class RefusedKey extends Error {}

interface Cached {
  token: string;
  expiresAt: number;
}

/**
 * Tokens by sha256(key), per Lambda container. A token only ever answers the
 * key that produced it, and the key itself is never kept.
 */
const cache = new Map<string, Cached>();

/** Renew five minutes before Cognito's sixty, so no request starts on a token about to lapse. */
const MARGIN_MS = 5 * 60 * 1000;

export function clearSessionCache(): void {
  cache.clear();
}

export async function exchangeApiKey(key: string, config: SessionConfig): Promise<string> {
  const now = (config.now ?? Date.now)();
  const match = KEY_SHAPE.exec(key);
  if (!match) throw new RefusedKey(REFUSED);

  const id = createHash("sha256").update(key).digest("hex");
  const hit = cache.get(id);
  if (hit && hit.expiresAt - MARGIN_MS > now) return hit.token;
  cache.delete(id);

  const record = await config.lookupKey(match[1]);
  if (!record) throw new RefusedKey(REFUSED);

  const clientId = record.scope === "write" ? config.writeClientId : config.readClientId;
  const cognito = config.cognito ?? cognitoCall(config.region);

  let answered: Record<string, unknown>;
  try {
    const started = await cognito("InitiateAuth", {
      AuthFlow: "CUSTOM_AUTH",
      ClientId: clientId,
      AuthParameters: { USERNAME: record.ownerSub },
    });
    answered = await cognito("RespondToAuthChallenge", {
      ChallengeName: "CUSTOM_CHALLENGE",
      ClientId: clientId,
      Session: started.Session,
      ChallengeResponses: { USERNAME: record.ownerSub, ANSWER: key },
    });
  } catch (err) {
    if (err instanceof RefusedKey) throw err;
    throw new Error(`could not reach Cognito: ${err instanceof Error ? err.message : err}`);
  }

  const result = answered.AuthenticationResult as { AccessToken?: string } | undefined;
  const token = result?.AccessToken;
  if (!token) throw new RefusedKey(REFUSED);

  // The access token, as Amplify sends it in the app: it carries the groups
  // and bp:scope that every check downstream reads.
  const exp = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"))
    .exp as number;
  cache.set(id, { token, expiresAt: exp * 1000 });
  return token;
}

function cognitoCall(region: string) {
  return async (target: string, body: unknown) => {
    const response = await fetch(`https://cognito-idp.${region}.amazonaws.com/`, {
      method: "POST",
      headers: {
        "content-type": "application/x-amz-json-1.1",
        "x-amz-target": `AWSCognitoIdentityProviderService.${target}`,
      },
      body: JSON.stringify(body),
    });
    const json = (await response.json()) as Record<string, unknown>;
    if (!response.ok) {
      // Cognito answers every custom-auth failure with NotAuthorized and a
      // message about passwords, which is true of none of them.
      if (String(json.__type ?? "").includes("NotAuthorized")) throw new RefusedKey(REFUSED);
      throw new Error(String(json.message ?? response.statusText));
    }
    return json;
  };
}
