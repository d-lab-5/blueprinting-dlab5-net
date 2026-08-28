import type { AppSyncResolverEvent } from "aws-lambda";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
} from "@aws-sdk/lib-dynamodb";
import { DeleteObjectsCommand, S3Client } from "@aws-sdk/client-s3";

/**
 * Removes a document and everything it owns.
 *
 * The source is written once and never rewritten, which makes a document a
 * record. Deleting one is therefore the only way to take it back, and it is
 * genuinely irreversible: S3 has no undo here. The UI asks first; this
 * function does not, because a confirmation the caller supplies is not a
 * confirmation.
 */

const ADMIN_GROUP = "bp-admins";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const s3 = new S3Client({});

const PROJECT_TABLE = process.env.PROJECT_TABLE_NAME!;
const DOCUMENT_TABLE = process.env.DOCUMENT_TABLE_NAME!;
const BUCKET = process.env.MODEL_BUCKET_NAME!;

interface Args {
  projectSlug: string;
  docId: string;
}

class Refused extends Error {}

function groupsOf(identity: unknown): string[] {
  const cognito = identity as { claims?: Record<string, unknown> } | undefined;
  const claim = cognito?.claims?.["cognito:groups"];
  if (Array.isArray(claim)) return claim as string[];
  if (typeof claim === "string") return claim.split(/[\s,]+/).filter(Boolean);
  return [];
}

export const handler = async (
  event: AppSyncResolverEvent<Args>
): Promise<boolean> => {
  const { projectSlug, docId } = event.arguments;
  const groups = groupsOf(event.identity);

  const { Item: product } = await ddb.send(
    new GetCommand({ TableName: PROJECT_TABLE, Key: { slug: projectSlug } })
  );

  const denied = new Refused("No such product, or you cannot access it.");
  if (!product) throw denied;

  const productGroup = product.group as string | undefined;
  if (
    !groups.includes(ADMIN_GROUP) &&
    !(productGroup !== undefined && groups.includes(productGroup))
  ) {
    throw denied;
  }

  const { Item } = await ddb.send(
    new GetCommand({
      TableName: DOCUMENT_TABLE,
      Key: { projectSlug, docId },
    })
  );
  if (!Item) throw new Refused("No such document.");

  // Objects first. A row without its objects is a document that cannot be
  // opened; objects without a row are invisible and unreachable, which is the
  // less bad of the two if this fails halfway.
  await s3.send(
    new DeleteObjectsCommand({
      Bucket: BUCKET,
      Delete: {
        Objects: [
          { Key: `projects/${projectSlug}/documents/${docId}/source.md` },
          { Key: `projects/${projectSlug}/documents/${docId}/annotated.md` },
        ],
        Quiet: true,
      },
    })
  );

  await ddb.send(
    new DeleteCommand({
      TableName: DOCUMENT_TABLE,
      Key: { projectSlug, docId },
    })
  );

  return true;
};
