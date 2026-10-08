import type { AppSyncResolverEvent } from "aws-lambda";
import { requireWrite } from "../shared/claims";
import { authorizeProduct, Refused } from "../shared/product-access";
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

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const s3 = new S3Client({});

const PROJECT_TABLE = process.env.PROJECT_TABLE_NAME!;
const DOCUMENT_TABLE = process.env.DOCUMENT_TABLE_NAME!;
const BUCKET = process.env.MODEL_BUCKET_NAME!;

interface Args {
  projectSlug: string;
  docId: string;
}

export const handler = async (
  event: AppSyncResolverEvent<Args>
): Promise<boolean> => {
  const { projectSlug, docId } = event.arguments;
  requireWrite(event.identity, "delete a document");
  await authorizeProduct(ddb, PROJECT_TABLE, projectSlug, event.identity);

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
