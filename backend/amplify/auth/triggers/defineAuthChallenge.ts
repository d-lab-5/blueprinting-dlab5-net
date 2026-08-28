import type { DefineAuthChallengeTriggerHandler } from "aws-lambda";

/**
 * The custom-auth state machine, in its entirety.
 *
 * One challenge, one attempt. There is no retry: an API key is either right or
 * it is not, and letting a caller try again turns an offline guess into an
 * online one.
 */
export const handler: DefineAuthChallengeTriggerHandler = async (event) => {
  const attempts = event.request.session ?? [];

  if (attempts.length === 0) {
    event.response.challengeName = "CUSTOM_CHALLENGE";
    event.response.issueTokens = false;
    event.response.failAuthentication = false;
    return event;
  }

  const last = attempts[attempts.length - 1];
  const passed =
    last.challengeName === "CUSTOM_CHALLENGE" && last.challengeResult === true;

  event.response.issueTokens = passed;
  event.response.failAuthentication = !passed;
  return event;
};
