import { createHash, timingSafeEqual } from "node:crypto";
import type { VerifyAuthChallengeResponseTriggerHandler } from "aws-lambda";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";

/**
 * Decides whether an API key is the right one for this user.
 *
 * The key looks like `bp_<keyId>_<secret>`. Only the keyId is used to find the
 * row; the secret is compared against a stored SHA-256, never against anything
 * reversible.
 *
 * Four things must hold, and the answer is the same when any of them fails:
 * the key exists, it belongs to the user being authenticated, it has not been
 * revoked, and it has not expired. Distinguishing them would let someone with
 * a wrong key learn which part was wrong.
 */

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE = process.env.API_KEY_TABLE_NAME!;

const KEY = /^bp_([a-z0-9]{8})_([a-z0-9]{32})$/;

/**
 * Constant time, so the comparison does not leak how much of a hash matched.
 *
 * Both sides are fixed-length hex of a SHA-256, so the lengths always agree —
 * but the guard stays, because timingSafeEqual throws on a length mismatch and
 * a throw here would read as a server error rather than a rejection.
 */
function sameHash(a: string, b: string): boolean {
  const left = Buffer.from(a, "hex");
  const right = Buffer.from(b, "hex");
  if (left.length !== right.length || left.length === 0) return false;
  return timingSafeEqual(left, right);
}

export const handler: VerifyAuthChallengeResponseTriggerHandler = async (
  event
) => {
  event.response.answerCorrect = false;

  const answer = event.request.challengeAnswer ?? "";
  console.log(
    "[verifyAuthChallengeResponse]",
    JSON.stringify({
      client: event.callerContext?.clientId,
      answerLength: answer.length,
      shaped: /^bp_[a-z0-9]{8}_[a-z0-9]{32}$/.test(answer),
    })
  );
  const match = KEY.exec(answer);
  if (!match) return event;

  const [, keyId] = match;

  const { Item } = await ddb.send(
    new GetCommand({ TableName: TABLE, Key: { keyId } })
  );
  if (!Item) return event;

  // The key must belong to the user Cognito is authenticating. Without this a
  // valid key would authenticate as anybody whose username was supplied.
  const sub = event.request.userAttributes?.sub;
  if (!sub || Item.ownerSub !== sub) return event;

  if (Item.revokedAt) return event;
  if (typeof Item.expiresAt === "string" && Date.parse(Item.expiresAt) < Date.now()) {
    return event;
  }

  const presented = createHash("sha256").update(answer).digest("hex");
  if (!sameHash(presented, String(Item.hash ?? ""))) return event;

  event.response.answerCorrect = true;

  // Last used is written after the decision, and a failure to write it must
  // never fail the authentication — it is telemetry, not a control.
  try {
    await ddb.send(
      new UpdateCommand({
        TableName: TABLE,
        Key: { keyId },
        UpdateExpression: "SET lastUsedAt = :now",
        ExpressionAttributeValues: { ":now": new Date().toISOString() },
      })
    );
  } catch (err) {
    console.warn("[verifyAuthChallengeResponse] lastUsedAt", err);
  }

  return event;
};
