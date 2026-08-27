/** Shared between the bundle exporter, importer and round-trip check. */
import { createHash } from "node:crypto";

export const BUNDLE_FORMAT = {
  name: "dlab5-blueprint-product-bundle",
  version: 1,
};

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
