import { defineFunction } from "@aws-amplify/backend";

/**
 * Deletes a document: its S3 objects and its index row, together.
 *
 * A SEPARATE function from documentStore, for two reasons. Its arguments are
 * the same as requestDocumentReadUrl's — product and id — and AppSync does not
 * populate `event.info.fieldName` for these handlers, so one function could not
 * tell a read from a delete. That alone settles it (see projectRename).
 *
 * The second reason is better: this function holds `s3:DeleteObject` and NOT
 * `s3:PutObject`, and documentStore holds the reverse. Neither can do the
 * other's job even if something goes wrong inside it.
 */
export const documentDelete = defineFunction({
  name: "documentDelete",
  entry: "./handler.ts",
  timeoutSeconds: 30,
  memoryMB: 512,
  resourceGroupName: "data",
});
