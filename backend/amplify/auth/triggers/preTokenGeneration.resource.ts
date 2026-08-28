import { defineFunction } from "@aws-amplify/backend";

/** See preTokenGeneration.ts. Part of the API-key custom auth flow, ADR-0012. */
export const preTokenGeneration = defineFunction({
  name: "preTokenGeneration",
  entry: "./preTokenGeneration.ts",
  timeoutSeconds: 10,
  memoryMB: 256,
});
