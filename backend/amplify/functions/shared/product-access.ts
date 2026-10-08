import { DynamoDBDocumentClient, GetCommand } from "@aws-sdk/lib-dynamodb";
import { ADMIN_GROUP, claimsOf } from "./claims";

/** A refusal the caller is meant to read. */
export class Refused extends Error {}

/**
 * Resolves the product and confirms the caller may open it: a member of its
 * group, or of bp-admins.
 *
 * Throws the same message whether the product is missing or merely forbidden,
 * so that a signed-in user cannot enumerate product ids — the same reasoning
 * as modelStorageProxy. One copy, used by every function that reads or writes
 * something belonging to a product, so the rule cannot drift between them.
 */
export async function authorizeProduct(
  ddb: DynamoDBDocumentClient,
  projectTable: string,
  projectSlug: string,
  identity: unknown
): Promise<{ group: string }> {
  const { groups } = claimsOf(identity);
  const { Item } = await ddb.send(
    new GetCommand({ TableName: projectTable, Key: { slug: projectSlug } })
  );

  const denied = new Refused("No such product, or you cannot access it.");
  if (!Item) throw denied;

  const productGroup = Item.group as string | undefined;
  const permitted =
    groups.includes(ADMIN_GROUP) ||
    (productGroup !== undefined && groups.includes(productGroup));
  if (!permitted) throw denied;

  return { group: productGroup as string };
}
