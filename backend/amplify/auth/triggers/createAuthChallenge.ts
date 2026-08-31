import type { CreateAuthChallengeTriggerHandler } from "aws-lambda";

/**
 * There is nothing to send.
 *
 * In a one-time-code flow this trigger would generate and deliver the code.
 * Here the secret is the API key, which the caller already holds — so the
 * challenge carries no parameters at all. `publicChallengeParameters` is
 * returned to the client and `privateChallengeParameters` to the verifier;
 * both stay empty, because anything in either would be a hint.
 */
export const handler: CreateAuthChallengeTriggerHandler = async (event) => {
  // Not empty. Cognito rejects the flow when publicChallengeParameters has no
  // entries, which surfaces at the client as "Incorrect username or password"
  // with every trigger having run cleanly — a genuinely misleading pair.
  // The value carries no information: it names the challenge, nothing more.
  event.response.publicChallengeParameters = { challenge: "api-key" };
  event.response.privateChallengeParameters = {};
  event.response.challengeMetadata = "API_KEY";
  return event;
};
