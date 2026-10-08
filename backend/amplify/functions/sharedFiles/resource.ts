import { defineFunction } from "@aws-amplify/backend";

/**
 * Lists and reads a product's shared working files from the project-docs
 * store (ADR-0013), read-only, for the Documents page.
 */
export const sharedFiles = defineFunction({
  name: "sharedFiles",
  entry: "./handler.ts",
  timeoutSeconds: 30,
  memoryMB: 512,
  // The Project table lives in the data stack; referencing it across stacks
  // closes a CloudFormation dependency cycle. ADR-0006.
  resourceGroupName: "data",
});
