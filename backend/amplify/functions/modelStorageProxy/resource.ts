import { defineFunction } from "@aws-amplify/backend";

/**
 * The authorization boundary for project models.
 *
 * Amplify's `defineStorage` access rules are fixed at deploy time, so they
 * cannot express "the caller is in group bp-<slug>" for a Cognito group that
 * will be created by hand next month. This function is what makes per-project
 * S3 access possible at all — see ADR-0003. Nothing else may hand out access
 * to `projects/*`.
 */
export const modelStorageProxy = defineFunction({
  name: "modelStorageProxy",
  entry: "./handler.ts",
  // Reads and writes are a DynamoDB lookup plus one S3 call. The default 3s is
  // enough in the happy path but leaves nothing for a cold start plus a slow
  // S3 write of a large graph.
  timeoutSeconds: 30,
  memoryMB: 512,
  // Placed in the data stack rather than its own.
  //
  // This function is a custom-mutation handler, so the data stack already
  // references it; granting it the Project table's ARN and name pointed the
  // reference back and CloudFormation refused the deployment with
  // "circular dependency found between nested stacks [data..., function...]".
  // Co-locating removes the cross-stack edge instead of working around it with
  // wildcard ARNs, which would also have left the table NAME unresolvable at
  // runtime.
  resourceGroupName: "data",
});
