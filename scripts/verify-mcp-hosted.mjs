#!/usr/bin/env node
/**
 * The hosted blueprint MCP server, end to end, against the deployed stack.
 *
 * Signs in, provisions a scratch product (row and Cognito group, with the
 * caller in it), mints a read key and a write key, and hands them to the
 * Python client (scripts/verify-mcp-client.py --url), which drives the server
 * over streamable HTTP as claude.ai would. Then revokes both keys and removes
 * the product, its group and its S3 objects — and says so if it could not.
 *
 * Usage:
 *   BP_USER=… BP_PASSWORD=… node scripts/verify-mcp-hosted.mjs [--url <…/mcp>]
 *
 * Without --url, the URL is read from the blueprint-mcp stack's outputs.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Amplify } from "aws-amplify";
import { signIn, fetchAuthSession, signOut } from "aws-amplify/auth";
import { cognitoUserPoolsTokenProvider } from "aws-amplify/auth/cognito";
import { generateClient } from "aws-amplify/data";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUTS = JSON.parse(readFileSync(resolve(ROOT, "backend/amplify_outputs.json"), "utf8"));
Amplify.configure(OUTPUTS);

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

const i = process.argv.indexOf("--url");
const url =
  i > -1
    ? process.argv[i + 1]
    : execFileSync(
        "aws",
        ["cloudformation", "describe-stacks", "--stack-name", "blueprint-mcp",
         "--query", "Stacks[0].Outputs[?OutputKey=='McpUrl'].OutputValue", "--output", "text"],
        { encoding: "utf8" }
      ).trim();

await signIn({ username, password });
await fetchAuthSession();
const client = generateClient({ authMode: "userPool" });

const call = async (name, args) => {
  const r = await client.mutations[name](args);
  if (r.errors?.length) throw new Error(`${name}: ${r.errors.map((e) => e.message).join("; ")}`);
  return r.data;
};

const stamp = Date.now().toString(36);
const slug = `mcph-${stamp}`;
const keys = [];
let status = 1;

try {
  await call("provisionProject", { slug, name: "Hosted MCP verification" });
  for (const scope of ["write", "read"]) {
    const [key] = await call("createApiKey", { name: `verify-hosted-${scope}-${stamp}`, scope, days: 1 });
    keys.push({ scope, keyId: key.keyId, secret: key.secret });
  }

  const run = spawnSync(
    resolve(ROOT, ".venv/bin/python"),
    ["-I", resolve(ROOT, "scripts/verify-mcp-client.py"), "--url", url],
    {
      stdio: "inherit",
      env: {
        PATH: process.env.PATH,
        BP_KEY_WRITE: keys.find((k) => k.scope === "write").secret,
        BP_KEY_READ: keys.find((k) => k.scope === "read").secret,
        BP_SCRATCH_PRODUCT: slug,
      },
    }
  );
  status = run.status ?? 1;
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
} finally {
  for (const { keyId } of keys) {
    try {
      await call("revokeApiKey", { keyId });
    } catch {
      console.error(`LEFT BEHIND: API key ${keyId}. Revoke it in the app.`);
    }
  }
  if (keys.length) console.log(`revoked ${keys.length} scratch key(s)`);

  try {
    await client.models.Project.delete({ slug });
  } catch {
    console.error(`LEFT BEHIND: product row ${slug}.`);
  }
  const quiet = { stdio: "ignore" };
  try {
    execFileSync("aws", ["s3", "rm", `s3://${OUTPUTS.storage.bucket_name}/projects/${slug}/`, "--recursive"], quiet);
  } catch {
    console.error(`LEFT BEHIND: projects/${slug}/ in the model bucket.`);
  }
  try {
    execFileSync("aws", ["cognito-idp", "delete-group", "--group-name", `bp-${slug}`, "--user-pool-id", OUTPUTS.auth.user_pool_id], quiet);
  } catch {
    console.error(`LEFT BEHIND: Cognito group bp-${slug}.`);
  }
  console.log(`removed scratch product ${slug}, its group and its objects`);
  await signOut();
}

process.exit(status);
