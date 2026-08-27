import type { AppSyncIdentityCognito, AppSyncResolverEvent } from "aws-lambda";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  PutCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import {
  AdminAddUserToGroupCommand,
  CognitoIdentityProviderClient,
  CreateGroupCommand,
  GroupExistsException,
  UpdateGroupCommand,
} from "@aws-sdk/client-cognito-identity-provider";

/**
 * Administrative operations on a product, dispatched by field name.
 *
 * `provisionProject` creates a Project row and its Cognito group together.
 * `renameProject` changes the name and description, and keeps the Cognito
 * group's description in step with them.
 *
 * Renaming needs its own mutation rather than the generated `updateProject`
 * for one reason: the group description is set at creation to "Members of the
 * <name> blueprint", and under ADR-0009 product ids are opaque — so that
 * description is the only thing in the Cognito console that says which product
 * a group belongs to. Letting it go stale would make the console unreadable,
 * and only a Lambda holds the permission to update it.
 *
 * Only bp-admins may call either.
 */

const ADMIN_GROUP = "bp-admins";
const SLUG = /^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/;

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

function claimsOf(identity: unknown) {
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

export const handler = async (
  event: AppSyncResolverEvent<Args>
): Promise<CreatedProject> => {
  const { groups, username, userPoolId } = claimsOf(event.identity);

  if (!groups.includes(ADMIN_GROUP)) {
    throw new Error("Only platform administrators can change products.");
  }

  if (event.info?.fieldName === "renameProject") {
    return rename(event, userPoolId);
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

/**
 * Changes a product's name and description.
 *
 * The id is untouched, and cannot be changed: it is the DynamoDB partition
 * key. Re-identifying a product is done by exporting and reloading it
 * (ADR-0010), not here.
 */
async function rename(
  event: AppSyncResolverEvent<Args>,
  userPoolId: string | undefined
): Promise<CreatedProject> {
  const slug = (event.arguments.slug ?? "").trim().toLowerCase();
  const name = (event.arguments.name ?? "").trim();
  const description = event.arguments.description?.trim() || undefined;

  if (!SLUG.test(slug)) throw new Error("That is not a product id.");
  if (!name) throw new Error("A product name is required.");

  const group = `bp-${slug}`;
  const ttlKey = `projects/${slug}/abox.ttl`;

  // Conditional on the row existing, so renaming a product that is not there
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
  // and is what the user asked for; a stale group description is a legibility
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
      console.warn("[projectAdmin] updateGroup description", err);
    }
  }

  return { slug, name, description, group, ttlKey };
}
