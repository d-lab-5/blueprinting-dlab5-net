import { defineFunction } from "@aws-amplify/backend";

/**
 * Reads and writes the source documents held beside a product's model.
 *
 * A Lambda rather than direct S3 access for the reason ADR-0003 gives: per
 * product Cognito groups are created by hand and `defineStorage` rules are
 * fixed at deploy time, so the authorization check cannot live in the bucket.
 */
export const documentStore = defineFunction({
  name: "documentStore",
  entry: "./handler.ts",
  timeoutSeconds: 30,
  memoryMB: 512,
  // The Project and Document tables both live in the data stack; referencing
  // them across stacks closes a CloudFormation dependency cycle. ADR-0006.
  resourceGroupName: "data",
});
