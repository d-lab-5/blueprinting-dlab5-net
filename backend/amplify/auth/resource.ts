import { defineAuth } from "@aws-amplify/backend";

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
});
