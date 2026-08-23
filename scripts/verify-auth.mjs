#!/usr/bin/env node
/**
 * Verifies the auth invariants of ADR-0002 against a live backend.
 *
 * This exercises the exact library and the exact call sequence AuthGate uses —
 * aws-amplify/auth, signIn -> the new-password challenge -> confirmSignIn ->
 * fetchAuthSession -> cognito:groups — rather than a stand-in. A green run
 * means the sign-in path in the browser works, not merely that Cognito exists.
 *
 * Usage:
 *   BP_USER=someone@example.com BP_PASSWORD='...' \
 *     node scripts/verify-auth.mjs [--new-password '...']
 *
 * Pass --new-password when the account is still in FORCE_CHANGE_PASSWORD, i.e.
 * the normal first login for an admin-created account.
 *
 * Reads backend/amplify_outputs.json, so run it after `ampx sandbox`.
 * Credentials come from the environment and are never written anywhere.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Amplify } from "aws-amplify";
import {
  confirmSignIn,
  fetchAuthSession,
  getCurrentUser,
  signIn,
  signOut,
} from "aws-amplify/auth";
import { cognitoUserPoolsTokenProvider } from "aws-amplify/auth/cognito";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputs = JSON.parse(
  readFileSync(resolve(ROOT, "backend/amplify_outputs.json"), "utf8")
);

Amplify.configure(outputs);

// Amplify defaults to browser storage. In Node there is none, and a token
// cache that outlives the process would be wrong for a verification script
// anyway, so tokens live and die in this Map.
const mem = new Map();
cognitoUserPoolsTokenProvider.setKeyValueStorage({
  setItem: async (k, v) => void mem.set(k, v),
  getItem: async (k) => (mem.has(k) ? mem.get(k) : null),
  removeItem: async (k) => void mem.delete(k),
  clear: async () => void mem.clear(),
});

const username = process.env.BP_USER;
const password = process.env.BP_PASSWORD;
const newPasswordIdx = process.argv.indexOf("--new-password");
const newPassword =
  newPasswordIdx > -1 ? process.argv[newPasswordIdx + 1] : undefined;

if (!username || !password) {
  console.error("set BP_USER and BP_PASSWORD");
  process.exit(2);
}

let failures = 0;
const check = (ok, label, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

console.log("auth invariants (ADR-0002)\n");

/* -- the configuration itself -------------------------------------------- */

check(
  outputs.auth.unauthenticated_identities_enabled === false,
  "identity pool refuses unauthenticated identities"
);
check(
  outputs.data.default_authorization_type === "AMAZON_COGNITO_USER_POOLS",
  "data API defaults to the user pool"
);
check(
  !outputs.data.api_key,
  "data API has no API key"
);
check(
  (outputs.auth.groups ?? []).some((g) => "bp-admins" in g),
  "bp-admins group is declared"
);

/* -- the sign-in path ----------------------------------------------------- */

let res = await signIn({ username, password });

if (res.nextStep?.signInStep === "CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED") {
  check(true, "admin-created account is challenged for a new password");
  if (!newPassword) {
    console.error("\n  account needs --new-password to continue");
    process.exit(2);
  }
  res = await confirmSignIn({ challengeResponse: newPassword });
}

check(res.isSignedIn === true, "sign-in completes");

const user = await getCurrentUser();
check(Boolean(user.username), "getCurrentUser returns a user", user.username);

const session = await fetchAuthSession();
const payload = session.tokens?.idToken?.payload ?? {};
const groups = payload["cognito:groups"] ?? [];

check(Boolean(session.tokens?.idToken), "an ID token is issued");
check(
  Array.isArray(groups) && groups.includes("bp-admins"),
  "cognito:groups reaches the client",
  JSON.stringify(groups)
);
check(
  payload.email === username,
  "the email claim is present",
  String(payload.email)
);

await signOut();
const after = await fetchAuthSession().catch(() => ({}));
check(!after.tokens?.idToken, "sign-out clears the session");

console.log(`\n${failures === 0 ? "all checks passed" : `${failures} FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
