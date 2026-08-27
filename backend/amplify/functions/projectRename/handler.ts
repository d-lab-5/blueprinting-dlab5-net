import type { AppSyncResolverEvent } from "aws-lambda";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import {
  CognitoIdentityProviderClient,
  UpdateGroupCommand,
} from "@aws-sdk/client-cognito-identity-provider";

import { ADMIN_GROUP, SLUG, claimsOf } from "../shared/claims";

/**
 * Changes a product's name and description.
 *
 * The id is not an argument and cannot be changed: it is the DynamoDB
 * partition key, and re-identifying a product is an export and a reload
 * (ADR-0010), not an update.
 *
 * This exists rather than the generated `updateProject`, which could change
 * the same two fields, for one reason: the Cognito group's description is set
 * at creation to "Members of the <name> blueprint", and now that product ids
 * are opaque (ADR-0009) it is the only thing in the Cognito console that says
 * which product a `bp-p-…` group belongs to. Keeping it in step needs
 * permissions the browser must never hold.
 */

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const idp = new CognitoIdentityProviderClient({});

const PROJECT_TABLE = process.env.PROJECT_TABLE_NAME!;

interface Args {
  slug: string;
  name: string;
  description?: string;
}

export interface RenamedProject {
  slug: string;
  name: string;
  description?: string;
  group: string;
  ttlKey: string;
}

export const handler = async (
  event: AppSyncResolverEvent<Args>
): Promise<RenamedProject> => {
  const { groups, userPoolId } = claimsOf(event.identity);

  if (!groups.includes(ADMIN_GROUP)) {
    throw new Error("Only platform administrators can rename products.");
  }

  const slug = (event.arguments.slug ?? "").trim().toLowerCase();
  const name = (event.arguments.name ?? "").trim();
  const description = event.arguments.description?.trim() || undefined;

  if (!SLUG.test(slug)) throw new Error("That is not a product id.");
  if (!name) throw new Error("A product name is required.");

  const group = `bp-${slug}`;
  const ttlKey = `projects/${slug}/abox.ttl`;

  // Conditional on the row existing, so renaming a product that is not here
  // fails rather than creating one with no Cognito group behind it.
  try {
    await ddb.send(
      new UpdateCommand({
        TableName: PROJECT_TABLE,
        Key: { slug },
        UpdateExpression: description
          ? "SET #n = :n, description = :d, updatedAt = :u"
          : "SET #n = :n, updatedAt = :u REMOVE description",
        ExpressionAttributeNames: { "#n": "name" },
        ExpressionAttributeValues: {
          ":n": name,
          ":u": new Date().toISOString(),
          ...(description ? { ":d": description } : {}),
        },
        ConditionExpression: "attribute_exists(slug)",
      })
    );
  } catch (err) {
    if ((err as { name?: string }).name === "ConditionalCheckFailedException") {
      throw new Error(`There is no product "${slug}".`);
    }
    throw err;
  }

  // Best effort, and deliberately not fatal. The rename has already happened
  // and is what was asked for; a stale group description is a legibility
  // problem in a console, not a broken product. Reporting failure here would
  // suggest the rename did not take, which would be worse.
  if (userPoolId) {
    try {
      await idp.send(
        new UpdateGroupCommand({
          UserPoolId: userPoolId,
          GroupName: group,
          Description: `Members of the ${name} blueprint`,
        })
      );
    } catch (err) {
      console.warn("[projectRename] updateGroup description", err);
    }
  }

  return { slug, name, description, group, ttlKey };
};
