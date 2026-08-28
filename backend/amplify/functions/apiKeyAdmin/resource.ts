import { defineFunction } from "@aws-amplify/backend";

/**
 * Mints, lists and revokes a user's API keys.
 *
 * In the data resource group because it answers GraphQL mutations; the key
 * table it uses is a standalone construct, deliberately outside the data model
 * so that no generated CRUD is ever exposed over a row holding a key hash.
 */
export const apiKeyAdmin = defineFunction({
  name: "apiKeyAdmin",
  entry: "./handler.ts",
  timeoutSeconds: 30,
  memoryMB: 512,
  resourceGroupName: "data",
});
