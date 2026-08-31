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
 *     [--group <cognito-group>] [--merge]
 *
 * `--from` seeds any project from committed Turtle rather than from the
 * built-in roadmap — which is how the engineering pattern library, and any
 * other model kept in git, gets into the platform.
 *
 * `--merge` ADDS to whatever is already there instead of replacing it, which
 * is what you want when a committed model documents one part of a larger
 * project — an architecture model going into the product's own blueprint, say.
 * Elements and relationships whose ids already exist are left alone, so
 * re-running is idempotent and never clobbers an edit made in the app.
 *
 * Targets whichever backend backend/amplify_outputs.json points at. For the
 * deployed branch, regenerate it first:
 *   cd backend && npx ampx generate outputs --app-id <id> --branch stage
 *
 * The caller must be in bp-admins. Note that this does NOT create the
 * project's Cognito group — it is still made by hand, so until it exists only
 * bp-admins can open the project. The group defaults to `bp-<slug>` and
 * `--group` overrides it.
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
const merge = process.argv.includes("--merge");
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
        // Normally bp-<slug>. --group exists for a project read ACROSS
        // projects rather than owned by one, where the group name should say
        // what it grants rather than which project it belongs to.
        group: arg("--group") ?? `bp-${slug}`,
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

  let toWrite = model;
  if (merge && current.exists && current.url) {
    // Read what is there and add to it. The ETag from this read is the one
    // the save below is conditioned on, so a concurrent edit between the two
    // fails the write rather than silently overwriting.
    const existing = parseAbox(await (await fetch(current.url)).text(), slug);
    const haveElement = new Set(existing.elements.map((e) => e.id));
    const haveRel = new Set(existing.relationships.map((r) => r.id));
    const newElements = model.elements.filter((e) => !haveElement.has(e.id));
    const newRels = model.relationships.filter((r) => !haveRel.has(r.id));

    // --merge ADDS. It never rewrites an element that is already there, so a
    // committed file whose element has since gained a property does NOT push
    // that property into the model — the id matches, so the whole element is
    // skipped. That is deliberate: overwriting would silently discard edits
    // made in the app. But it is invisible unless said out loud, so it is.
    const existingById = new Map(existing.elements.map((e) => [e.id, e]));
    const differing = model.elements.filter((e) => {
      const there = existingById.get(e.id);
      return (
        there &&
        JSON.stringify({ n: there.name, p: there.properties, d: there.documentation }) !==
          JSON.stringify({ n: e.name, p: e.properties, d: e.documentation })
      );
    });
    if (differing.length) {
      console.log(
        `  ${differing.length} element(s) already present but DIFFERENT — left untouched:`
      );
      for (const e of differing) console.log(`    ${e.id} (${e.name})`);
      console.log(
        "    --merge never overwrites. Change these in the app, or through the"
      );
      console.log(
        "    MCP server's set_element_properties, which is built for it."
      );
    }
    toWrite = {
      ...existing,
      elements: [...existing.elements, ...newElements],
      relationships: [...existing.relationships, ...newRels],
    };
    console.log(
      `merging into ${existing.elements.length} existing elements: ` +
        `${newElements.length} new, ${model.elements.length - newElements.length} already present`
    );
  }

  const saved = unwrap(
    await client.mutations.saveModel({
      projectSlug: slug,
      turtle: await serializeAbox(toWrite),
      etag: current.exists ? current.etag : undefined,
      expectAbsent: current.exists ? undefined : true,
    }),
    "save"
  );

  console.log(
    `${merge ? "model now holds" : "seeded"} ${toWrite.elements.length} elements and ` +
      `${toWrite.relationships.length} relationships` +
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
