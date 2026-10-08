import { defineFunction } from "@aws-amplify/backend";

/** See defineAuthChallenge.ts. Part of the API-key custom auth flow, ADR-0012. */
export const defineAuthChallenge = defineFunction({
  name: "defineAuthChallenge",
  entry: "./defineAuthChallenge.ts",
  timeoutSeconds: 10,
  memoryMB: 256,
});
