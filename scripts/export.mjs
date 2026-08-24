#!/usr/bin/env node
/**
 * Pulls a project's ABox out of a backend.
 *
 * This is what makes the tool usable for real planning. Once a roadmap is
 * edited in the browser, S3 holds the truth and the committed seed goes stale
 * — export closes the loop, so a plan made in the tool can be reviewed in a
 * pull request like anything else.
 *
 * Usage:
 *   BP_USER=… BP_PASSWORD=… node scripts/export.mjs --project <slug> [--out <file>]
 *
 * Writes Turtle to stdout by default. Targets whatever
 * backend/amplify_outputs.json points at; for a deployed branch, regenerate it
 * first with `cd backend && npx ampx generate outputs --app-id <id> --branch <branch>`.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Amplify } from "aws-amplify";
import { signIn, fetchAuthSession, signOut } from "aws-amplify/auth";
import { cognitoUserPoolsTokenProvider } from "aws-amplify/auth/cognito";
import { generateClient } from "aws-amplify/data";

import { parseAbox, validateModel } from "@dlab5/blueprint-core";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
Amplify.configure(
  JSON.parse(readFileSync(resolve(ROOT, "backend/amplify_outputs.json"), "utf8"))
);

const mem = new Map();
cognitoUserPoolsTokenProvider.setKeyValueStorage({
  setItem: async (k, v) => void mem.set(k, v),
  getItem: async (k) => (mem.has(k) ? mem.get(k) : null),
  removeItem: async (k) => void mem.delete(k),
  clear: async () => void mem.clear(),
});

const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : undefined;
};

const slug = arg("--project");
const out = arg("--out");
const { BP_USER: username, BP_PASSWORD: password } = process.env;

if (!slug) {
  console.error("usage: node scripts/export.mjs --project <slug> [--out <file>]");
  process.exit(2);
}
if (!username || !password) {
  console.error("set BP_USER and BP_PASSWORD");
  process.exit(2);
}

await signIn({ username, password });
await fetchAuthSession();
const client = generateClient({ authMode: "userPool" });

try {
  const result = await client.mutations.requestModelReadUrl({ projectSlug: slug });
  if (result.errors?.length) {
    throw new Error(result.errors.map((e) => e.message).join("; "));
  }
  const access = result.data;

  if (!access.exists) {
    console.error(`project "${slug}" has no model yet`);
    process.exit(1);
  }

  const turtle = await (await fetch(access.url)).text();

  // Report what came back on stderr, so stdout stays pure Turtle and the
  // command can be redirected into a file without contaminating it.
  const model = parseAbox(turtle, slug);
  const findings = validateModel(model);
  console.error(
    `${slug}: ${model.elements.length} elements, ` +
      `${model.relationships.length} relationships, ` +
      `ArchiMate ${model.languageVersion}, ` +
      `${findings.filter((f) => f.severity === "error").length} error(s), ` +
      `${findings.filter((f) => f.severity === "warning").length} warning(s)`
  );
  for (const f of findings) console.error(`  ${f.severity}: ${f.message}`);

  if (out) {
    writeFileSync(resolve(process.cwd(), out), turtle);
    console.error(`written to ${out}`);
  } else {
    process.stdout.write(turtle);
  }
} finally {
  await signOut();
}
