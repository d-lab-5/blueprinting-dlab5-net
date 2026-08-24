import { defineFunction } from "@aws-amplify/backend";

/**
 * Creates projects, which means two things that must happen together: a
 * Project row and a Cognito group named `bp-<slug>`.
 *
 * A project row without its group is a project nobody but bp-admins can open,
 * and a group without a row is invisible. Doing both from the browser would
 * need Cognito admin permissions in the client, so it happens here instead.
 */
export const projectAdmin = defineFunction({
  name: "projectAdmin",
  entry: "./handler.ts",
  timeoutSeconds: 30,
  memoryMB: 512,
  // Same reason as modelStorageProxy: this is a custom-mutation handler that
  // needs the Project table, and referencing it across stacks closes a
  // CloudFormation dependency cycle. See ADR-0006.
  resourceGroupName: "data",
});
