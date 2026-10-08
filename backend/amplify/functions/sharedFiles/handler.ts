import type { AppSyncResolverEvent } from "aws-lambda";
import { SLUG } from "../shared/claims";
import { authorizeProduct, Refused } from "../shared/product-access";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import {
  GetObjectCommand,
  ListObjectsV2Command,
  NoSuchKey,
  S3Client,
} from "@aws-sdk/client-s3";
import { GetParameterCommand, ParameterNotFound, SSMClient } from "@aws-sdk/client-ssm";

/**
 * The project-docs store, read-only, for a product's Documents page.
 *
 * Working files that claude.ai and Claude Code share live in a separate
 * bucket under `docs/<product id>/` (ADR-0013). This lists and reads them for
 * members of the product, under the same group check as everything else a
 * product owns. Nothing here writes: editing happens through the MCP server.
 *
 * The bucket belongs to another stack, so its name is read at runtime from the
 * SSM parameter that stack publishes. Nothing is committed and no stack
 * references another. An environment without that stack is told so, rather
 * than failing.
 *
 * Two mutations share this handler and are told apart by their arguments:
 * `readSharedFile` carries a path, `listSharedFiles` does not. AppSync does not
 * populate `event.info.fieldName` here; see documentStore.
 */

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const s3 = new S3Client({});
const ssm = new SSMClient({});

const PROJECT_TABLE = process.env.PROJECT_TABLE_NAME!;
const BUCKET_PARAMETER = process.env.SHARED_FILES_BUCKET_PARAMETER!;

const ROOT = "docs/";
const MAX_LIST = 1000;
const MAX_BYTES = 1024 * 1024;

/** The same rules the store applies on write (mcp/project-docs/src/rules.py). */
const ALLOWED_EXTENSIONS = [".md", ".ttl", ".txt", ".json", ".csv", ".yaml", ".sparql", ".py"];
const PATH_CHARS = /^[A-Za-z0-9._/-]+$/;

interface Args {
  projectSlug: string;
  path?: string;
}

interface SharedFile {
  path: string;
  size: number;
  lastModified: string;
}

interface SharedFiles {
  available: boolean;
  files: SharedFile[];
  truncated: boolean;
}

interface SharedFileContent extends SharedFile {
  content: string;
}

let bucket: string | null | undefined;

/** The bucket name, or null when this environment has no project-docs stack. */
async function bucketName(): Promise<string | null> {
  if (bucket !== undefined) return bucket;
  try {
    const out = await ssm.send(new GetParameterCommand({ Name: BUCKET_PARAMETER }));
    bucket = out.Parameter?.Value ?? null;
  } catch (e) {
    if (!(e instanceof ParameterNotFound)) throw e;
    bucket = null;
  }
  return bucket;
}

function checkPath(path: string): string {
  const segments = path.split("/");
  const ok =
    path.length > 0 &&
    path.length <= 512 &&
    PATH_CHARS.test(path) &&
    !path.startsWith("/") &&
    segments.every((s) => s !== "" && s !== "." && s !== "..") &&
    ALLOWED_EXTENSIONS.some((ext) => path.toLowerCase().endsWith(ext));
  if (!ok) throw new Refused("Not a valid shared file path.");
  return path;
}

export const handler = async (
  event: AppSyncResolverEvent<Args>
): Promise<SharedFiles | SharedFileContent> => {
  const { projectSlug, path } = event.arguments;
  if (!SLUG.test(projectSlug)) throw new Refused("No such product, or you cannot access it.");
  await authorizeProduct(ddb, PROJECT_TABLE, projectSlug, event.identity);

  const name = await bucketName();
  const prefix = `${ROOT}${projectSlug}/`;

  /* -- read one ------------------------------------------------------------ */

  if (typeof path === "string") {
    if (!name) throw new Refused("Shared files are not set up in this environment.");
    const key = prefix + checkPath(path);
    try {
      const out = await s3.send(new GetObjectCommand({ Bucket: name, Key: key }));
      if ((out.ContentLength ?? 0) > MAX_BYTES) throw new Refused("This file is larger than 1 MB.");
      return {
        path,
        content: (await out.Body?.transformToString("utf-8")) ?? "",
        size: out.ContentLength ?? 0,
        lastModified: (out.LastModified ?? new Date(0)).toISOString(),
      };
    } catch (e) {
      if (e instanceof NoSuchKey) throw new Refused(`No shared file at ${path}.`);
      throw e;
    }
  }

  /* -- list ---------------------------------------------------------------- */

  if (!name) return { available: false, files: [], truncated: false };

  const files: SharedFile[] = [];
  let token: string | undefined;
  do {
    const page = await s3.send(
      new ListObjectsV2Command({ Bucket: name, Prefix: prefix, ContinuationToken: token })
    );
    for (const obj of page.Contents ?? []) {
      if (files.length === MAX_LIST) return { available: true, files, truncated: true };
      files.push({
        path: obj.Key!.slice(prefix.length),
        size: obj.Size ?? 0,
        lastModified: (obj.LastModified ?? new Date(0)).toISOString(),
      });
    }
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);

  return { available: true, files, truncated: false };
};
