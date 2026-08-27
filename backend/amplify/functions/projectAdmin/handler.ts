import type { AppSyncResolverEvent } from "aws-lambda";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";
import {
  AdminAddUserToGroupCommand,
  CognitoIdentityProviderClient,
  CreateGroupCommand,
  GroupExistsException,
} from "@aws-sdk/client-cognito-identity-provider";

import { ADMIN_GROUP, SLUG, claimsOf } from "../shared/claims";

/**
 * Creates a product: a Project row and its Cognito group, together.
 *
 * Only bp-admins may call this. Creating a product grants access to a new
 * slice of the platform, and the caller is added to the new group so that the
 * person who made it can immediately open it.
 *
 * Renaming lives in its own function, not a second branch here — see
 * projectRename/resource.ts for why.
 */


const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const idp = new CognitoIdentityProviderClient({});

const PROJECT_TABLE = process.env.PROJECT_TABLE_NAME!;

interface Args {
  slug: string;
  name: string;
  description?: string;
}

export interface CreatedProject {
  slug: string;
  name: string;
  description?: string;
  group: string;
  ttlKey: string;
}


export const handler = async (
  event: AppSyncResolverEvent<Args>
): Promise<CreatedProject> => {
  const { groups, username, userPoolId } = claimsOf(event.identity);

  if (!groups.includes(ADMIN_GROUP)) {
    throw new Error("Only platform administrators can create products.");
  }

  const slug = (event.arguments.slug ?? "").trim().toLowerCase();
  const name = (event.arguments.name ?? "").trim();
  const description = event.arguments.description?.trim() || undefined;

  if (!SLUG.test(slug)) {
    throw new Error(
      "The slug must be 3-50 characters, lowercase letters, digits and hyphens, " +
        "and may not start or end with a hyphen."
    );
  }
  if (!name) throw new Error("A project name is required.");

  const group = `bp-${slug}`;
  const ttlKey = `projects/${slug}/abox.ttl`;
  const now = new Date().toISOString();

  // The row first, conditionally. If the slug is taken this fails before any
  // Cognito group is created, so a failed attempt leaves nothing behind.
  try {
    await ddb.send(
      new PutCommand({
        TableName: PROJECT_TABLE,
        Item: {
          slug,
          name,
          ...(description ? { description } : {}),
          group,
          ttlKey,
          version: 0,
          createdAt: now,
          updatedAt: now,
          __typename: "Project",
        },
        ConditionExpression: "attribute_not_exists(slug)",
      })
    );
  } catch (err) {
    if ((err as { name?: string }).name === "ConditionalCheckFailedException") {
      throw new Error(`A project with the slug "${slug}" already exists.`);
    }
    throw err;
  }

  if (!userPoolId) {
    // The row exists but nobody outside bp-admins can be granted access to it.
    // Say so rather than reporting success.
    throw new Error(
      `Project "${slug}" was created, but its Cognito group could not be: ` +
        "the user pool could not be determined from the request."
    );
  }

  try {
    await idp.send(
      new CreateGroupCommand({
        UserPoolId: userPoolId,
        GroupName: group,
        Description: `Members of the ${name} blueprint`,
      })
    );
  } catch (err) {
    // An existing group is fine — most likely a retry, or a group created by
    // hand ahead of the project.
    if (!(err instanceof GroupExistsException)) {
      console.error("[projectAdmin] createGroup", err);
      throw new Error(
        `Project "${slug}" was created, but its Cognito group could not be. ` +
          "Create it by hand or the project will only be visible to administrators."
      );
    }
  }

  if (username) {
    try {
      await idp.send(
        new AdminAddUserToGroupCommand({
          UserPoolId: userPoolId,
          Username: username,
          GroupName: group,
        })
      );
    } catch (err) {
      // Not fatal: the caller is an admin and can open the project regardless.
      console.warn("[projectAdmin] addUserToGroup", err);
    }
  }

  return { slug, name, description, group, ttlKey };
};
