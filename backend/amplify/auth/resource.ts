import { defineAuth } from "@aws-amplify/backend";
import { createAuthChallenge } from "./triggers/createAuthChallenge.resource";
import { defineAuthChallenge } from "./triggers/defineAuthChallenge.resource";
import { preTokenGeneration } from "./triggers/preTokenGeneration.resource";
import { verifyAuthChallengeResponse } from "./triggers/verifyAuthChallengeResponse.resource";

/**
 * Cognito User Pool for the D-LAB-5 Blueprinting Platform.
 *
 * There is no guest tier and no self-signup: the landing page IS the sign-in
 * page. Accounts are created by hand in the Cognito console for now, which is
 * why the invitation email below is the normal first-contact path rather than
 * an edge case. Self-signup is closed at the user-pool level in backend.ts via
 * `adminCreateUserConfig` — defineAuth does not expose that switch.
 *
 * Only ONE static group is declared here:
 *
 *   - bp-admins   Platform administrators. Read and write every project,
 *                 create projects, manage Cognito users and groups.
 *
 * Per-project groups are deliberately NOT declared here. Each project owns a
 * Cognito group named `bp-<slug>` (see Project.group in data/resource.ts),
 * created in the console when the project is created. Declaring them in
 * `defineAuth` would mean a backend deploy per new project, and Amplify's
 * static `defineStorage` rules cannot reference them anyway — which is exactly
 * why S3 access goes through the modelStorageProxy function instead.
 */
export const auth = defineAuth({
  loginWith: {
    email: {
      verificationEmailStyle: "CODE",
      verificationEmailSubject: "D-LAB-5 Blueprinting — verification code",
      verificationEmailBody: (createCode) =>
        `Your verification code for the D-LAB-5 Blueprinting Platform is: ${createCode()}`,
      userInvitation: {
        emailSubject: "D-LAB-5 Blueprinting — your access",
        emailBody: (user, code) =>
          `An account on the D-LAB-5 Blueprinting Platform has been created for you.\n\n` +
          `Username: ${user()}\n` +
          `Temporary password: ${code()}\n\n` +
          `Sign in at https://blueprinting.dlab5.net/ — you will be asked to choose a new password.`,
      },
    },
  },
  groups: ["bp-admins"],
  accountRecovery: "EMAIL_ONLY",

  /**
   * Custom authentication, used only by API keys (ADR-0012).
   *
   * The three challenge triggers let a key be exchanged for an ordinary
   * Cognito session carrying the user's real groups, which is what keeps every
   * authorization rule downstream unchanged. preTokenGeneration then removes
   * bp-admins from a key session, because the generated model rules cannot
   * tell a key from a browser and would otherwise let a read-only key write
   * rows directly.
   *
   * The browser never touches any of this: its app client does not allow
   * CUSTOM_AUTH, and the challenge triggers answer nothing without a key.
   */
  triggers: {
    defineAuthChallenge,
    createAuthChallenge,
    verifyAuthChallengeResponse,
    preTokenGeneration,
  },
});
