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

  // Temporary, while the flow is being got working: Cognito reports a failed
  // custom auth as "Incorrect username or password" no matter what went wrong,
  // so the only way to see the state machine is from inside it.
  console.log(
    "[defineAuthChallenge]",
    JSON.stringify({
      client: event.callerContext?.clientId,
      attempts: attempts.map((a) => ({
        name: a.challengeName,
        result: a.challengeResult,
      })),
    })
  );

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
