import { createHash, randomBytes } from "node:crypto";
import type { AppSyncResolverEvent } from "aws-lambda";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";

/**
 * Minting, listing and revoking a user's API keys.
 *
 * The keys live in a standalone table rather than an `a.model`, for two
 * reasons. A model would expose generated CRUD over the row, and the row holds
 * a key hash that must never be readable through the API — not even by its
 * owner, who has already been shown the only copy that exists. And the auth
 * triggers need the same table, which would put an edge from the auth stack to
 * the data stack and close the CloudFormation cycle ADR-0006 describes.
 *
 * Three mutations share this handler, dispatched on their arguments rather
 * than on `event.info.fieldName`, which AppSync does not populate here. They
 * are distinguishable: create carries a name, revoke carries a keyId, list
 * carries neither.
 */

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE = process.env.API_KEY_TABLE_NAME!;

/** `bp_` then 8 public characters, an underscore, then 32 secret ones. */
const PREFIX = "bp_";
const ID_LENGTH = 8;
const SECRET_LENGTH = 32;
const ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789";

const MAX_DAYS = 365;
const DEFAULT_DAYS = 90;

type Scope = "read" | "write";

interface Args {
  /** create */
  name?: string;
  scope?: string;
  days?: number;
  /** revoke */
  keyId?: string;
}

interface ApiKeyView {
  keyId: string;
  name: string;
  scope: string;
  createdAt: string;
  expiresAt: string;
  lastUsedAt?: string | null;
  revokedAt?: string | null;
  /** Only ever set on create, and only that once. */
  secret?: string | null;
}

function random(length: number): string {
  // Rejection sampling, so the alphabet is uniform. 256 % 32 === 0, so with a
  // 32-character alphabet there is nothing to reject — but the alphabet is a
  // thing someone will edit, and a modulo that happens to be safe today is a
  // bias waiting for that edit.
  const max = Math.floor(256 / ALPHABET.length) * ALPHABET.length;
  let out = "";
  while (out.length < length) {
    for (const byte of randomBytes(length * 2)) {
      if (byte >= max) continue;
      out += ALPHABET[byte % ALPHABET.length];
      if (out.length === length) break;
    }
  }
  return out;
}

export const hashKey = (secret: string): string =>
  createHash("sha256").update(secret).digest("hex");

function claimsOf(identity: unknown) {
  const cognito = identity as
    | { username?: string; claims?: Record<string, unknown> }
    | undefined;
  return {
    sub: (cognito?.claims?.sub as string | undefined) ?? cognito?.username,
    email: cognito?.claims?.email as string | undefined,
    scope: cognito?.claims?.["bp:scope"] as string | undefined,
  };
}

const view = (item: Record<string, unknown>): ApiKeyView => ({
  keyId: item.keyId as string,
  name: item.name as string,
  scope: item.scope as string,
  createdAt: item.createdAt as string,
  expiresAt: item.expiresAt as string,
  lastUsedAt: (item.lastUsedAt as string) ?? null,
  revokedAt: (item.revokedAt as string) ?? null,
  secret: null,
});

export const handler = async (
  event: AppSyncResolverEvent<Args>
): Promise<ApiKeyView[]> => {
  const { sub, email, scope } = claimsOf(event.identity);
  if (!sub) throw new Error("Not signed in.");

  // A key cannot mint another key, whatever its scope. Otherwise a leaked
  // read-only key becomes a write key in one call, and revoking the one you
  // know about leaves the one you do not.
  if (scope) {
    throw new Error(
      "API keys cannot manage API keys. Sign in to create or revoke one."
    );
  }

  /* -- revoke -------------------------------------------------------------- */

  if (event.arguments.keyId) {
    const keyId = event.arguments.keyId;
    const { Item } = await ddb.send(
      new GetCommand({ TableName: TABLE, Key: { keyId } })
    );
    // Same answer for "not yours" and "not there", so one user cannot probe
    // for another's key ids.
    if (!Item || Item.ownerSub !== sub) throw new Error("No such key.");

    await ddb.send(
      new UpdateCommand({
        TableName: TABLE,
        Key: { keyId },
        UpdateExpression: "SET revokedAt = :now",
        ExpressionAttributeValues: { ":now": new Date().toISOString() },
      })
    );
    return [];
  }

  /* -- create -------------------------------------------------------------- */

  if (event.arguments.name) {
    const name = event.arguments.name.trim().slice(0, 60);
    if (!name) throw new Error("A key needs a name.");

    // Read unless write is asked for, explicitly. A key that quietly gained
    // write access would defeat the point of having a scope at all.
    const keyScope: Scope = event.arguments.scope === "write" ? "write" : "read";

    const days = Math.min(
      Math.max(Math.floor(event.arguments.days ?? DEFAULT_DAYS), 1),
      MAX_DAYS
    );

    const keyId = random(ID_LENGTH);
    const secretPart = random(SECRET_LENGTH);
    const secret = `${PREFIX}${keyId}_${secretPart}`;
    const now = new Date();
    const expiresAt = new Date(now.getTime() + days * 86_400_000);

    const item = {
      keyId,
      ownerSub: sub,
      ownerEmail: email ?? null,
      name,
      scope: keyScope,
      // Only the hash is stored. The value below is the only time the key
      // exists anywhere outside the caller's hands, which is why the UI says
      // so and why there is no way to ask for it again.
      hash: hashKey(secret),
      createdAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
      // DynamoDB TTL, so an expired key eventually stops existing rather than
      // merely stopping working.
      ttl: Math.floor(expiresAt.getTime() / 1000) + 30 * 86_400,
    };

    await ddb.send(
      new PutCommand({
        TableName: TABLE,
        Item: item,
        ConditionExpression: "attribute_not_exists(keyId)",
      })
    );

    return [{ ...view(item), secret }];
  }

  /* -- list ---------------------------------------------------------------- */

  const { Items } = await ddb.send(
    new QueryCommand({
      TableName: TABLE,
      IndexName: "byOwner",
      KeyConditionExpression: "ownerSub = :s",
      ExpressionAttributeValues: { ":s": sub },
    })
  );

  return (Items ?? [])
    .map(view)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
};
