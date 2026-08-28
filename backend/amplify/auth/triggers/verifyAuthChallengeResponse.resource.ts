import { defineFunction } from "@aws-amplify/backend";

/** See verifyAuthChallengeResponse.ts. Part of the API-key custom auth flow, ADR-0012. */
export const verifyAuthChallengeResponse = defineFunction({
  name: "verifyAuthChallengeResponse",
  entry: "./verifyAuthChallengeResponse.ts",
  timeoutSeconds: 10,
  memoryMB: 256,
});
