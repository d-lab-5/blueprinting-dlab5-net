import { defineFunction } from "@aws-amplify/backend";

/**
 * Renames a product: the Project row, and its Cognito group's description.
 *
 * A SEPARATE function from projectAdmin rather than a second branch inside it.
 * AppSync does not populate `event.info.fieldName` for these Lambda-backed
 * custom mutations, so a handler serving two mutations cannot tell which one
 * it is answering — modelStorageProxy documents the same trap, where saveModel
 * silently took the read branch. Dispatching on the arguments works only when
 * they differ, and provision and rename take the same three. One function per
 * mutation removes the question.
 */
export const projectRename = defineFunction({
  name: "projectRename",
  entry: "./handler.ts",
  timeoutSeconds: 30,
  memoryMB: 512,
  // Same reason as projectAdmin: a custom-mutation handler that needs the
  // Project table, where a cross-stack reference closes a CloudFormation
  // dependency cycle. ADR-0006.
  resourceGroupName: "data",
});
