import type { AppSyncResolverEvent } from "aws-lambda";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

/**
 * Source documents held for the record, beside a product's model.
 *
 * The security boundary is the same one modelStorageProxy enforces: the
 * caller's Cognito groups against the product's own group, checked here rather
 * than in S3, because per-product groups are created by hand and defineStorage
 * rules are fixed at deploy time (ADR-0002, ADR-0003).
 *
 * Two mutations share this handler, which is safe ONLY because their arguments
 * differ — `saveDocument` carries markdown and `requestDocumentReadUrl` does
 * not. AppSync does not populate `event.info.fieldName` for these handlers, so
 * the field name is a hint and the arguments are the decision. Two mutations
 * with matching arguments need two functions; see projectRename/resource.ts.
 */

const ADMIN_GROUP = "bp-admins";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const s3 = new S3Client({});

const PROJECT_TABLE = process.env.PROJECT_TABLE_NAME!;
const DOCUMENT_TABLE = process.env.DOCUMENT_TABLE_NAME!;
const BUCKET = process.env.MODEL_BUCKET_NAME!;

/**
 * Shapes that must never be stored, whatever anyone says about them.
 *
 * A warning gets clicked through. These are refused: an access token in a
 * document would be copied into the model's documentation, exported, and read
 * by everyone the product is shared with. Deliberately narrow — this catches
 * credentials that announce themselves, and is not a general secret scanner.
 */
const SECRET_SHAPES: Array<[RegExp, string]> = [
  [/\bshp(at|ss|ca|pa)_[0-9a-f]{32}\b/i, "a Shopify access token"],
  [/\bgh[pousr]_[A-Za-z0-9]{36,}\b/, "a GitHub token"],
  [/\bsk-[A-Za-z0-9]{32,}\b/, "an API secret key"],
  [/\bAKIA[0-9A-Z]{16}\b/, "an AWS access key id"],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, "a private key"],
  [/\baws_secret_access_key\s*[=:]\s*\S/i, "an AWS secret access key"],
];

type Classification = "confidential" | "collaboration" | "shared";

/**
 * Where a document may go, most restrictive first.
 *
 * The axis is destination, not sensitivity: `collaboration` travels between
 * environments with the product but never into a public repository, which is
 * a pair of properties a two-valued field cannot express.
 */
const CLASSIFICATIONS: Classification[] = ["confidential", "collaboration", "shared"];

interface Args {
  projectSlug: string;
  docId: string;
  title?: string;
  markdown?: string;
  classification?: string;
  /** "source" is written once and never again; "annotated" is the working copy. */
  kind?: string;
}

interface DocumentAccess {
  docId: string;
  key: string;
  url?: string;
  exists: boolean;
  classification: string;
}

class Refused extends Error {}

function groupsOf(identity: unknown): string[] {
  const cognito = identity as
    | { claims?: Record<string, unknown> }
    | undefined;
  const claim = cognito?.claims?.["cognito:groups"];
  if (Array.isArray(claim)) return claim as string[];
  if (typeof claim === "string") return claim.split(/[\s,]+/).filter(Boolean);
  return [];
}

/**
 * Resolves the product and confirms the caller may touch it.
 *
 * Throws the same message whether the product is missing or merely forbidden,
 * so that a signed-in user cannot enumerate product ids — the same reasoning
 * as modelStorageProxy.
 */
async function authorize(projectSlug: string, identity: unknown) {
  const groups = groupsOf(identity);
  const { Item } = await ddb.send(
    new GetCommand({ TableName: PROJECT_TABLE, Key: { slug: projectSlug } })
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

const documentKey = (projectSlug: string, docId: string, kind: string) =>
  `projects/${projectSlug}/documents/${docId}/${kind === "annotated" ? "annotated" : "source"}.md`;

export const handler = async (
  event: AppSyncResolverEvent<Args>
): Promise<DocumentAccess> => {
  const { projectSlug, docId, markdown, kind } = event.arguments;
  const { group } = await authorize(projectSlug, event.identity);

  const key = documentKey(projectSlug, docId, kind ?? "source");

  /* -- read ---------------------------------------------------------------- */

  if (typeof markdown !== "string") {
    const { Item } = await ddb.send(
      new GetCommand({
        TableName: DOCUMENT_TABLE,
        Key: { projectSlug, docId },
      })
    );
    if (!Item) {
      return { docId, key, exists: false, classification: "confidential" };
    }
    const url = await getSignedUrl(
      s3,
      new GetObjectCommand({ Bucket: BUCKET, Key: key }),
      { expiresIn: 900 }
    );
    return {
      docId,
      key,
      url,
      exists: true,
      classification: (Item.classification as string) ?? "confidential",
    };
  }

  /* -- write --------------------------------------------------------------- */

  for (const [shape, what] of SECRET_SHAPES) {
    if (shape.test(markdown)) {
      throw new Error(
        `This document looks like it contains ${what}. Documents are stored ` +
          `with the model and read by everyone the product is shared with, so ` +
          `credentials are refused rather than warned about. Remove it and try ` +
          `again.`
      );
    }
  }

  // Keyed by product AND id, so a document id is unique within a product and
  // says nothing about any other. The cross-product check that used to live
  // here existed only because the key was global, and it made copying a
  // product into another environment fail on the first name collision.
  const existing = await ddb.send(
    new GetCommand({
      TableName: DOCUMENT_TABLE,
      Key: { projectSlug, docId },
    })
  );

  // The source is written once. It is the record of what arrived, and a record
  // that can be rewritten is not one — annotation goes to the working copy.
  if ((kind ?? "source") === "source" && existing.Item?.sourceWritten) {
    throw new Error(
      `The source of "${docId}" is already stored and is never rewritten. ` +
        `Annotate the working copy, or upload a revision as a new document.`
    );
  }

  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: markdown,
      ContentType: "text/markdown; charset=utf-8",
    })
  );

  // Confidential unless someone says otherwise. Sharing is opt-in, so a
  // document nobody classified stays put; the other direction puts commercial
  // terms in a file bound for a public repository.
  // Anything unrecognised falls back to confidential rather than being
  // rejected: a typo in a classification must not be the thing that decides a
  // document travels.
  const requested = event.arguments.classification as Classification | undefined;
  const classification: Classification =
    requested && CLASSIFICATIONS.includes(requested) ? requested : "confidential";

  const isSource = (kind ?? "source") === "source";
  const now = new Date().toISOString();

  await ddb.send(
    new PutCommand({
      TableName: DOCUMENT_TABLE,
      Item: {
        ...(existing.Item ?? {}),
        docId,
        projectSlug,
        group,
        title: event.arguments.title ?? existing.Item?.title ?? docId,
        classification: existing.Item
          ? (event.arguments.classification === undefined
              ? existing.Item.classification
              : classification)
          : classification,
        sourceKey: documentKey(projectSlug, docId, "source"),
        ...(isSource
          ? { sourceWritten: true, sha256: undefined, uploadedAt: now }
          : { annotatedKey: key }),
        bytes: Buffer.byteLength(markdown),
        updatedAt: now,
        createdAt: existing.Item?.createdAt ?? now,
        __typename: "Document",
      },
    })
  );

  return { docId, key, exists: true, classification };
};
