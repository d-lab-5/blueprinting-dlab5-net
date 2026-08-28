#!/usr/bin/env node
/**
 * API keys, against a real backend (ADR-0012).
 *
 * The assertion this file exists for is that **read-only is real**. A scope
 * enforced only by the client is not a scope, so every write path is tried
 * with a read key and must be refused — including the GENERATED model
 * mutations, which know nothing about app clients and are closed by
 * preTokenGeneration stripping bp-admins instead.
 *
 * Usage:  BP_USER=... BP_PASSWORD=... node scripts/verify-api-keys.mjs
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Amplify } from "aws-amplify";
import { signIn, fetchAuthSession, signOut } from "aws-amplify/auth";
import { cognitoUserPoolsTokenProvider } from "aws-amplify/auth/cognito";
import { generateClient } from "aws-amplify/data";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputs = JSON.parse(
  readFileSync(resolve(ROOT, "backend/amplify_outputs.json"), "utf8")
);
Amplify.configure(outputs);

const mem = new Map();
cognitoUserPoolsTokenProvider.setKeyValueStorage({
  setItem: async (k, v) => void mem.set(k, v),
  getItem: async (k) => (mem.has(k) ? mem.get(k) : null),
  removeItem: async (k) => void mem.delete(k),
  clear: async () => void mem.clear(),
});

const { BP_USER: username, BP_PASSWORD: password } = process.env;
if (!username || !password) {
  console.error("set BP_USER and BP_PASSWORD");
  process.exit(2);
}

const REGION = outputs.auth.aws_region;
const READ_CLIENT = outputs.custom?.apiKeyClientReadId;
const WRITE_CLIENT = outputs.custom?.apiKeyClientWriteId;
const GRAPHQL = outputs.data.url;

let failures = 0;
const check = (ok, what, detail) => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${what}${detail ? ` - ${detail}` : ""}`);
  if (!ok) failures++;
};

const cognito = async (target, body) => {
  const r = await fetch(`https://cognito-idp.${REGION}.amazonaws.com/`, {
    method: "POST",
    headers: {
      "content-type": "application/x-amz-json-1.1",
      "x-amz-target": `AWSCognitoIdentityProviderService.${target}`,
    },
    body: JSON.stringify(body),
  });
  const json = await r.json();
  if (!r.ok) throw new Error(json.message ?? r.statusText);
  return json;
};

/** Exchanges a key for an access token, or throws. */
async function tokenFor(key, clientId) {
  const started = await cognito("InitiateAuth", {
    AuthFlow: "CUSTOM_AUTH",
    ClientId: clientId,
    AuthParameters: { USERNAME: username },
  });
  const answered = await cognito("RespondToAuthChallenge", {
    ChallengeName: "CUSTOM_CHALLENGE",
    ClientId: clientId,
    Session: started.Session,
    ChallengeResponses: { USERNAME: username, ANSWER: key },
  });
  const token = answered.AuthenticationResult?.AccessToken;
  if (!token) throw new Error("no token issued");
  return token;
}

/** Raw GraphQL with a bearer token; returns {data, error}. */
async function gql(token, query, variables) {
  const r = await fetch(GRAPHQL, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: token },
    body: JSON.stringify({ query, variables }),
  });
  const j = await r.json();
  if (j.errors?.length) return { error: j.errors.map((e) => e.message).join("; ") };
  return { data: j.data };
}

const claims = (t) =>
  JSON.parse(Buffer.from(t.split(".")[1], "base64url").toString("utf8"));

console.log("API keys (ADR-0012)\n");

check(Boolean(READ_CLIENT && WRITE_CLIENT), "the backend published both key clients");
if (!READ_CLIENT || !WRITE_CLIENT) {
  console.log("\ncannot continue without the app client ids");
  process.exit(1);
}

await signIn({ username, password });
await fetchAuthSession();
const client = generateClient({ authMode: "userPool" });
const created = [];

const call = async (name, args) => {
  try {
    const r = await client.mutations[name](args);
    if (r.errors?.length) return { error: r.errors.map((e) => e.message).join("; ") };
    return { data: r.data };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
};

try {
  /* -- minting ------------------------------------------------------------- */

  const stamp = Date.now().toString(36);
  const readKey = await call("createApiKey", {
    name: `verify-read-${stamp}`,
    scope: "read",
    days: 1,
  });
  const readSecret = readKey.data?.[0]?.secret;
  check(Boolean(readSecret), "a read key can be minted", readKey.error ?? "");
  if (readKey.data?.[0]) created.push(readKey.data[0].keyId);

  const writeKey = await call("createApiKey", {
    name: `verify-write-${stamp}`,
    scope: "write",
    days: 1,
  });
  const writeSecret = writeKey.data?.[0]?.secret;
  check(Boolean(writeSecret), "a write key can be minted", writeKey.error ?? "");
  if (writeKey.data?.[0]) created.push(writeKey.data[0].keyId);

  check(
    /^bp_[a-z0-9]{8}_[a-z0-9]{32}$/.test(readSecret ?? ""),
    "the key has the shape the verifier expects"
  );

  const listed = await call("listApiKeys", {});
  const ours = (listed.data ?? []).filter((k) => k.name.includes(stamp));
  check(ours.length === 2, "both appear in the listing", `${ours.length} found`);
  check(
    ours.every((k) => k.secret === null),
    "and the listing never returns the key itself",
    "only the hash is stored"
  );

  /* -- a read key authenticates and can read ------------------------------- */

  const readToken = await tokenFor(readSecret, READ_CLIENT);
  check(Boolean(readToken), "a read key authenticates on the read client");

  const c = claims(readToken);
  check(
    c.client_id === READ_CLIENT,
    "the token names the client it authenticated against",
    "which is what the Lambdas key their refusal on"
  );
  check(
    !(c["cognito:groups"] ?? []).includes("bp-admins"),
    "bp-admins is stripped from a key session",
    `groups: ${(c["cognito:groups"] ?? []).length}`
  );

  const read = await gql(readToken, "query { listProjects { items { slug } } }");
  check(
    !read.error && read.data.listProjects.items.length > 0,
    "a read key can read",
    read.error ?? `${read.data?.listProjects.items.length} products`
  );

  /* -- and cannot write, by any route -------------------------------------- */

  const product = read.data?.listProjects.items[0]?.slug;

  const writeAttempts = [
    [
      "saveModel",
      `mutation { saveModel(projectSlug: "${product}", turtle: "# nope") { key } }`,
    ],
    [
      "saveDocument",
      `mutation { saveDocument(projectSlug: "${product}", docId: "verify-nope", markdown: "# nope") { docId } }`,
    ],
    [
      "purgeDocument",
      `mutation { purgeDocument(projectSlug: "${product}", docId: "verify-nope") }`,
    ],
    [
      "provisionProject",
      `mutation { provisionProject(slug: "verify-nope-${stamp}", name: "Nope") { slug } }`,
    ],
    [
      "projectRename",
      `mutation { renameProject(slug: "${product}", name: "Renamed by a read key") { slug } }`,
    ],
    // The generated route, which knows nothing about app clients and is closed
    // by preTokenGeneration instead.
    [
      "createProject (generated)",
      `mutation { createProject(input: {slug: "verify-gen-${stamp}", name: "Nope", group: "bp-admins", ttlKey: "x"}) { slug } }`,
    ],
    [
      "updateDocument (generated)",
      `mutation { updateDocument(input: {projectSlug: "${product}", docId: "any", title: "Nope"}) { docId } }`,
    ],
    // A key must not be able to make itself a better key.
    ["createApiKey", `mutation { createApiKey(name: "escalate") { keyId } }`],
  ];

  for (const [what, query] of writeAttempts) {
    const r = await gql(readToken, query);
    check(Boolean(r.error), `a read key cannot ${what}`, r.error ? "refused" : "IT SUCCEEDED");
  }

  /* -- a read key is refused on the write client --------------------------- */

  let refusedOnWriteClient = false;
  try {
    await tokenFor(readSecret, WRITE_CLIENT);
  } catch {
    refusedOnWriteClient = true;
  }
  check(
    refusedOnWriteClient,
    "a read key is refused on the write client",
    "the scope is checked where the key is verified, not by the caller"
  );

  /* -- a write key can write ----------------------------------------------- */

  const writeToken = await tokenFor(writeSecret, WRITE_CLIENT);
  const wc = claims(writeToken);
  check(wc.client_id === WRITE_CLIENT, "a write key authenticates on the write client");
  check(
    !(wc["cognito:groups"] ?? []).includes("bp-admins"),
    "a write key is not an administrator either"
  );

  const stored = await gql(
    writeToken,
    `mutation { saveDocument(projectSlug: "${product}", docId: "verify-key-${stamp}", markdown: "# written by a key", title: "Key write check", classification: "shared") { docId } }`
  );
  check(!stored.error, "a write key can write a document", stored.error ?? "stored");

  const cleaned = await gql(
    writeToken,
    `mutation { purgeDocument(projectSlug: "${product}", docId: "verify-key-${stamp}") }`
  );
  check(!cleaned.error, "and remove it again", cleaned.error ?? "removed");

  /* -- revoking ------------------------------------------------------------ */

  const revoked = await call("revokeApiKey", { keyId: created[0] });
  check(!revoked.error, "a key can be revoked", revoked.error ?? "");

  let deadNow = false;
  try {
    await tokenFor(readSecret, READ_CLIENT);
  } catch {
    deadNow = true;
  }
  check(deadNow, "and stops authenticating immediately");

  /* -- a wrong key is refused, without saying why -------------------------- */

  let wrongRefused = false;
  try {
    await tokenFor(`bp_${"a".repeat(8)}_${"b".repeat(32)}`, READ_CLIENT);
  } catch {
    wrongRefused = true;
  }
  check(wrongRefused, "a key that never existed is refused");
} finally {
  for (const keyId of created) {
    try {
      await client.mutations.revokeApiKey({ keyId });
    } catch {
      console.error(`could not revoke ${keyId}`);
    }
  }
  console.log(`\nrevoked ${created.length} scratch key(s)`);
  await signOut();
}

console.log(`\n${failures === 0 ? "all checks passed" : `${failures} FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
