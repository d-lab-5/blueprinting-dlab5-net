import { defineFunction } from "@aws-amplify/backend";

/** See createAuthChallenge.ts. Part of the API-key custom auth flow, ADR-0012. */
export const createAuthChallenge = defineFunction({
  name: "createAuthChallenge",
  entry: "./createAuthChallenge.ts",
  timeoutSeconds: 10,
  memoryMB: 256,
});
