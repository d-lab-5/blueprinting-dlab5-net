import type { AppSyncIdentityCognito, AppSyncResolverEvent } from "aws-lambda";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand } from "@aws-sdk/lib-dynamodb";
import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

/**
 * Per-project access to the ArchiMate ABox in S3.
 *
 * Reads hand back a short-lived pre-signed GET, so the graph never travels
 * through AppSync. Writes go through this function rather than a pre-signed
 * PUT, because the correctness mechanism is an S3 `If-Match` precondition and
 * doing it here means the condition cannot be dropped, altered or replayed by
 * the caller. See ADR-0003.
 *
 * Every path checks the caller's Cognito groups against the project's own
 * group. This is the security boundary; the UI's checks are ergonomics.
 */

const ADMIN_GROUP = "bp-admins";
const URL_TTL_SECONDS = 300;

const s3 = new S3Client({});
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const BUCKET = process.env.MODEL_BUCKET_NAME!;
const PROJECT_TABLE = process.env.PROJECT_TABLE_NAME!;

type Action = "read" | "write";

interface Args {
  projectSlug: string;
  /** Turtle to store. Required for `write`. */
  turtle?: string;
  /**
   * The ETag the caller believes is current. Required for `write` unless
   * `expectAbsent` is set. A mismatch is a lost update and is refused.
   */
  etag?: string;
  /** Set on the very first write, when there is no object to match against. */
  expectAbsent?: boolean;
}

export interface ModelAccessResult {
  /** Pre-signed GET, only on `read` and only when the object exists. */
  url?: string;
  /** Current ETag, so a subsequent write can name what it is replacing. */
  etag?: string;
  /** False when the project has no model yet — a legitimate empty state. */
  exists: boolean;
  key: string;
}

class Refused extends Error {}

function groupsOf(identity: unknown): string[] {
  const cognito = identity as AppSyncIdentityCognito | undefined;
  const claim = cognito?.claims?.["cognito:groups"];
  if (Array.isArray(claim)) return claim as string[];
  // A single-group token can arrive as a bare string rather than an array.
  if (typeof claim === "string") return claim.split(/[\s,]+/).filter(Boolean);
  return [];
}

/**
 * Resolves the project and confirms the caller may touch it.
 *
 * Throws the same message whether the project is missing or merely forbidden.
 * Distinguishing them would let any signed-in user enumerate project slugs.
 */
async function authorize(projectSlug: string, identity: unknown) {
  const groups = groupsOf(identity);

  const { Item } = await ddb.send(
    new GetCommand({
      TableName: PROJECT_TABLE,
      Key: { slug: projectSlug },
    })
  );

  const denied = new Refused(`No such project, or you cannot access it.`);
  if (!Item) throw denied;

  const projectGroup = Item.group as string | undefined;
  const permitted =
    groups.includes(ADMIN_GROUP) ||
    (projectGroup !== undefined && groups.includes(projectGroup));
  if (!permitted) throw denied;

  return {
    key: (Item.ttlKey as string) || `projects/${projectSlug}/abox.ttl`,
  };
}

async function head(key: string): Promise<string | undefined> {
  try {
    const r = await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
    return r.ETag;
  } catch (err) {
    const name = (err as { name?: string }).name;
    const status = (err as { $metadata?: { httpStatusCode?: number } })
      .$metadata?.httpStatusCode;
    if (name === "NotFound" || name === "NoSuchKey" || status === 404) {
      return undefined;
    }
    throw err;
  }
}

export const handler = async (
  event: AppSyncResolverEvent<Args> & { info?: { fieldName?: string } }
): Promise<ModelAccessResult> => {
  const { projectSlug, turtle, etag, expectAbsent } = event.arguments;

  // Which mutation this is, decided from the arguments rather than from
  // event.info.fieldName alone. Both mutations share this handler, and relying
  // on the field name failed silently: saveModel was taking the read branch,
  // returning {exists:false} and writing nothing, with no error anywhere.
  // `turtle` is present on exactly one of the two, so it is the reliable
  // discriminator; the field name is kept as the primary signal and logged so
  // a future mismatch is visible rather than silent.
  const fieldName = event.info?.fieldName;
  const action: Action =
    fieldName === "saveModel" || typeof turtle === "string" ? "write" : "read";
  if (fieldName !== "saveModel" && fieldName !== "requestModelReadUrl") {
    console.warn("[modelStorageProxy] unexpected fieldName", fieldName);
  }

  if (!projectSlug) throw new Error("projectSlug is required");

  try {
    const { key } = await authorize(projectSlug, event.identity);

    if (action === "read") {
      const currentEtag = await head(key);
      if (!currentEtag) return { exists: false, key };
      const url = await getSignedUrl(
        s3,
        new GetObjectCommand({ Bucket: BUCKET, Key: key }),
        { expiresIn: URL_TTL_SECONDS }
      );
      return { url, etag: currentEtag, exists: true, key };
    }

    if (typeof turtle !== "string") {
      throw new Error("turtle is required to save a model");
    }
    if (!etag && !expectAbsent) {
      // Refusing an unconditional write is the whole point. Without a
      // precondition, two editors silently overwrite each other.
      throw new Error(
        "either etag or expectAbsent is required; unconditional writes are refused"
      );
    }

    try {
      const put = await s3.send(
        new PutObjectCommand({
          Bucket: BUCKET,
          Key: key,
          Body: turtle,
          ContentType: "text/turtle",
          ...(expectAbsent ? { IfNoneMatch: "*" } : { IfMatch: etag }),
        })
      );
      return { etag: put.ETag, exists: true, key };
    } catch (err) {
      const name = (err as { name?: string }).name;
      const status = (err as { $metadata?: { httpStatusCode?: number } })
        .$metadata?.httpStatusCode;
      if (
        status === 412 ||
        status === 409 ||
        name === "PreconditionFailed" ||
        name === "ConditionalRequestConflict"
      ) {
        // Surfaced verbatim to the user. A lost update must be visible, never
        // resolved by whoever happened to save last.
        throw new Refused(
          "This model changed since you loaded it. Reload and reapply your edits."
        );
      }
      throw err;
    }
  } catch (err) {
    if (err instanceof Refused) throw new Error(err.message);
    console.error("[modelStorageProxy]", err);
    throw new Error("Could not access the model.");
  }
};
