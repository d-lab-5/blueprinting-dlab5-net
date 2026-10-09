#!/usr/bin/env node
/**
 * Adds one or more committed models to an existing product's model.
 *
 * `seed --merge` cannot do this for model files: it matches relationships by
 * id, and every model file numbers its relationships r1, r2, …, so merging a
 * second file would silently skip most of its relationships. This matches
 * relationships by what they connect instead (`mergeModels` in
 * packages/core/src/merge.ts), and stops on any element that exists on both
 * sides with different content rather than choosing one.
 *
 * The write is conditioned on the ETag of the read, so an edit made in the app
 * meanwhile fails the save instead of being overwritten.
 *
 * Usage:
 *   BP_USER=… BP_PASSWORD=… node scripts/merge-models.mjs \
 *     --into <product id> --from a.ttl [--from b.ttl …] [--dry-run]
 */
import { readFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Amplify } from "aws-amplify";
import { signIn, fetchAuthSession, signOut } from "aws-amplify/auth";
import { cognitoUserPoolsTokenProvider } from "aws-amplify/auth/cognito";
import { generateClient } from "aws-amplify/data";

import {
  hasErrors,
  mergeModels,
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

const args = process.argv.slice(2);
const into = args[args.indexOf("--into") + 1];
const froms = args.flatMap((a, i) => (a === "--from" ? [args[i + 1]] : []));
const dryRun = args.includes("--dry-run");
if (!args.includes("--into") || froms.length === 0) {
  console.error("usage: merge-models.mjs --into <product id> --from a.ttl [--from b.ttl …] [--dry-run]");
  process.exit(2);
}

const incoming = froms.map((file) =>
  parseAbox(readFileSync(resolve(process.cwd(), file), "utf8"), basename(file, ".ttl"))
);

const unwrap = (r, what) => {
  if (r.errors?.length) throw new Error(`${what}: ${r.errors.map((e) => e.message).join("; ")}`);
  return r.data;
};

await signIn({ username, password });
await fetchAuthSession();
const client = generateClient({ authMode: "userPool" });

let status = 1;
try {
  const access = unwrap(await client.mutations.requestModelReadUrl({ projectSlug: into }), "read");
  const current =
    access.exists && access.url
      ? parseAbox(await (await fetch(access.url)).text(), into)
      : { projectSlug: into, elements: [], relationships: [] };

  const result = mergeModels(current, incoming);
  console.log(`${into}: ${current.elements.length} elements, ${current.relationships.length} relationships now`);
  for (const [file, model] of froms.map((f, i) => [f, incoming[i]])) {
    console.log(`  + ${file}: ${model.elements.length} elements, ${model.relationships.length} relationships`);
  }
  console.log(
    `  added ${result.addedElements} elements and ${result.addedRelationships} relationships; ` +
      `${result.skippedElements} elements and ${result.skippedRelationships} relationships already there`
  );

  if (result.conflicts.length) {
    console.error(`\n${result.conflicts.length} element(s) exist on both sides with different content:`);
    for (const c of result.conflicts) console.error(`  ${c.id}: "${c.existing.name}" vs "${c.incoming.name}"`);
    console.error("Nothing was written. Decide each one, then run again.");
  } else {
    const merged = { ...result.model, projectSlug: into };
    const findings = validateModel(merged);
    if (hasErrors(findings)) {
      console.error("\nthe merged model does not validate; nothing was written:");
      for (const f of findings.filter((x) => x.severity === "error")) console.error(`  ${f.message}`);
    } else if (dryRun) {
      console.log(`\ndry run: would write ${merged.elements.length} elements and ${merged.relationships.length} relationships`);
      status = 0;
    } else {
      const saved = unwrap(
        await client.mutations.saveModel({
          projectSlug: into,
          turtle: await serializeAbox(merged),
          etag: access.exists ? access.etag : undefined,
          expectAbsent: access.exists ? undefined : true,
        }),
        "save"
      );
      console.log(`\nwrote ${merged.elements.length} elements and ${merged.relationships.length} relationships`);
      console.log(`  etag ${saved.etag}`);
      status = 0;
    }
  }
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
} finally {
  await signOut();
}
process.exit(status);
