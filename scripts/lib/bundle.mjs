/** Shared between the bundle exporter, importer and round-trip check. */
import { createHash } from "node:crypto";

export const BUNDLE_FORMAT = {
  name: "dlab5-blueprint-product-bundle",
  // v2 carries documents/. A v1 bundle is still readable; it simply has none.
  version: 2,
};

/**
 * Where a document may go, most restrictive first.
 *
 * The axis is destination, not sensitivity. `collaboration` is the tier that
 * is easy to leave out and expensive to lack: sprint notes and working
 * documents must travel between environments with the product and must not
 * reach a public repository, and no two-valued field can say both.
 */
export const CLASSIFICATIONS = ["confidential", "collaboration", "shared"];

/**
 * Whether a document may travel in a bundle exported at `include`.
 *
 * Confidential never travels, whatever is asked for — that is the one rule
 * with no flag behind it. Anything unrecognised is treated as confidential,
 * so a classification this tool does not know about fails closed.
 */
export function mayTravel(classification, include) {
  if (classification === "shared") return true;
  if (classification === "collaboration") return include === "collaboration";
  return false;
}

export const sha256 = (content) =>
  createHash("sha256").update(content).digest("hex");

/**
 * A one-way fingerprint of the environment, from its Cognito user pool id.
 *
 * Bundles get committed, and this repository is public, so the manifest must
 * not carry an AWS identifier. A hash is enough for the only question worth
 * asking — "is this the environment the bundle came from?" — and answers
 * nothing else.
 */
export function environmentFingerprint(outputs) {
  const poolId =
    outputs?.auth?.user_pool_id ?? outputs?.aws_user_pools_id ?? "unknown";
  return sha256(poolId).slice(0, 16);
}
