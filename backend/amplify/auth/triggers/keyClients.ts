import {
  CognitoIdentityProviderClient,
  ListUserPoolClientsCommand,
} from "@aws-sdk/client-cognito-identity-provider";

/**
 * The two app clients that exist solely for API keys, resolved by name.
 *
 * Resolved at runtime rather than passed in, because an environment variable
 * holding a client id points the function stack back at the auth stack and
 * closes a CloudFormation cycle — that cost a build once already (ADR-0006).
 *
 * Cached for the life of the container, so this is one call per cold start.
 * Shared by the verifier, which must refuse a read-only key on the write
 * client, and by preTokenGeneration, which writes the scope into the token.
 */

export const READ_CLIENT_NAME = "blueprinting-api-key-read";
export const WRITE_CLIENT_NAME = "blueprinting-api-key-write";

const idp = new CognitoIdentityProviderClient({});

let cached: { read?: string; write?: string } | null = null;

export async function keyClients(
  userPoolId: string
): Promise<{ read?: string; write?: string }> {
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

/** Which scope a client is asking for, or null if it is not a key client. */
export async function requestedScope(
  userPoolId: string,
  clientId: string | undefined
): Promise<"read" | "write" | null> {
  if (!clientId) return null;
  const clients = await keyClients(userPoolId);
  if (clientId === clients.write) return "write";
  if (clientId === clients.read) return "read";
  return null;
}
