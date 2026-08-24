#!/usr/bin/env node
/**
 * Pushes the platform's own roadmap into a backend.
 *
 * Creates the `blueprinting` project row if it is missing, then saves
 * PLATFORM_ROADMAP as its ABox. Idempotent: re-running overwrites the model
 * with whatever the committed seed now says, using the current ETag, so it
 * never clobbers a concurrent edit unnoticed.
 *
 * Usage:
 *   BP_USER=… BP_PASSWORD=… node scripts/seed.mjs \
 *     [--project <slug>] [--from <ttl>] [--name <name>] [--description <text>]
 *
 * `--from` seeds any project from committed Turtle rather than from the
 * built-in roadmap — which is how the engineering pattern library, and any
 * other model kept in git, gets into the platform.
 *
 * Targets whichever backend backend/amplify_outputs.json points at. For the
 * deployed branch, regenerate it first:
 *   cd backend && npx ampx generate outputs --app-id <id> --branch stage
 *
 * The caller must be in bp-admins. Note that this does NOT create the
 * project's Cognito group — `bp-<slug>` is still made by hand, so until it
 * exists only bp-admins can open the project.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Amplify } from "aws-amplify";
import { signIn, fetchAuthSession, signOut } from "aws-amplify/auth";
import { cognitoUserPoolsTokenProvider } from "aws-amplify/auth/cognito";
import { generateClient } from "aws-amplify/data";

import {
  PLATFORM_ROADMAP,
  hasErrors,
  parseAbox,
  serializeAbox,
  validateModel,
} from "@dlab5/blueprint-core";

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

const { BP_USER: username, BP_PASSWORD: password } = process.env;
if (!username || !password) {
  console.error("set BP_USER and BP_PASSWORD");
  process.exit(2);
}

const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : undefined;
};

const from = arg("--from");
const source = from
  ? parseAbox(readFileSync(resolve(process.cwd(), from), "utf8"), "seed")
  : PLATFORM_ROADMAP;

const slug = arg("--project") ?? source.projectSlug;

// Re-slugged so the instance IRIs match the project the model lands in. The
// ids inside are unchanged, so a re-export of the same content is stable.
const model = { ...source, projectSlug: slug };

// Refuse to seed a model the metamodel rejects. A broken seed would be worse
// than none: it becomes the example everything else is copied from.
const findings = validateModel(model);
if (hasErrors(findings)) {
  console.error("the seed model does not validate:");
  for (const f of findings.filter((x) => x.severity === "error")) {
    console.error(`  ${f.message}`);
  }
  process.exit(1);
}

const unwrap = (r, what) => {
  if (r.errors?.length) {
    throw new Error(`${what}: ${r.errors.map((e) => e.message).join("; ")}`);
  }
  return r.data;
};

await signIn({ username, password });
await fetchAuthSession();
const client = generateClient({ authMode: "userPool" });

try {
  const existing = unwrap(await client.models.Project.get({ slug }), "get project");

  if (!existing) {
    unwrap(
      await client.models.Project.create({
        slug,
        name: arg("--name") ?? slug,
        description: arg("--description") ?? undefined,
        group: `bp-${slug}`,
        ttlKey: `projects/${slug}/abox.ttl`,
        version: 0,
      }),
      "create project"
    );
    console.log(`created project ${slug}`);
  } else {
    console.log(`project ${slug} already exists`);
  }

  const current = unwrap(
    await client.mutations.requestModelReadUrl({ projectSlug: slug }),
    "read"
  );

  const saved = unwrap(
    await client.mutations.saveModel({
      projectSlug: slug,
      turtle: await serializeAbox(model),
      etag: current.exists ? current.etag : undefined,
      expectAbsent: current.exists ? undefined : true,
    }),
    "save"
  );

  console.log(
    `seeded ${model.elements.length} elements and ` +
      `${model.relationships.length} relationships` +
      (from ? ` from ${from}` : "")
  );
  console.log(`  key  ${saved.key}`);
  console.log(`  etag ${saved.etag}`);
  const warnings = findings.filter((f) => f.severity === "warning");
  if (warnings.length) {
    console.log(`  ${warnings.length} warning(s):`);
    for (const w of warnings) console.log(`    ${w.message}`);
  }
} finally {
  await signOut();
}
