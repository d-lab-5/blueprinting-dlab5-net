#!/usr/bin/env node
/**
 * Loads a product transfer bundle into an environment (ADR-0010).
 *
 * Usage:
 *   BP_USER=… BP_PASSWORD=… node scripts/bundle-import.mjs --in <dir> \
 *     [--reid | --as <slug>] [--name <name>] [--dry-run]
 *
 * `--reid` mints a fresh opaque product id (ADR-0009) instead of reusing the
 * one in the bundle. That is how a re-identification is performed: there is no
 * migration, because DynamoDB cannot update a primary key. Re-identifying
 * rewrites every IRI in the model, which is safe only because IRIs are derived
 * from the product id at serialization time rather than stored.
 *
 * `group` and `ttlKey` are NOT read from the bundle. They are derived values
 * that must agree with the environment they land in, so provisionProject
 * computes them, exactly as it does for a product created by hand.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Amplify } from "aws-amplify";
import { signIn, fetchAuthSession, signOut } from "aws-amplify/auth";
import { cognitoUserPoolsTokenProvider } from "aws-amplify/auth/cognito";
import { generateClient } from "aws-amplify/data";

import {
  mintProductId,
  parseAbox,
  serializeAbox,
  validateModel,
} from "@dlab5/blueprint-core";
import { toOpenExchange } from "@dlab5/archimate-exchange";

import {
  BUNDLE_FORMAT,
  environmentFingerprint,
  sha256,
} from "./lib/bundle.mjs";

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

const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : undefined;
};

const dir = arg("--in");
const reid = process.argv.includes("--reid");
const asSlug = arg("--as");
const overrideName = arg("--name");
const dryRun = process.argv.includes("--dry-run");
const { BP_USER: username, BP_PASSWORD: password } = process.env;

if (!dir) {
  console.error("usage: node scripts/bundle-import.mjs --in <dir> [--reid|--as <slug>]");
  process.exit(2);
}
if (reid && asSlug) {
  console.error("--reid mints an id and --as supplies one; use one or the other");
  process.exit(2);
}

/* -- read and verify the bundle before touching anything ------------------- */

const read = (name) => readFileSync(join(dir, name), "utf8");
const manifest = JSON.parse(read("MANIFEST.json"));

if (manifest.format !== BUNDLE_FORMAT.name) {
  console.error(`not a product bundle: format is "${manifest.format}"`);
  process.exit(2);
}
if (manifest.formatVersion > BUNDLE_FORMAT.version) {
  console.error(
    `bundle format v${manifest.formatVersion} is newer than this tool understands ` +
      `(v${BUNDLE_FORMAT.version})`
  );
  process.exit(2);
}

const contents = {};
for (const [name, expected] of Object.entries(manifest.files)) {
  const content = read(name);
  const actual = sha256(content);
  if (actual !== expected.sha256) {
    console.error(`${name} does not match its checksum — the bundle is damaged`);
    console.error(`  manifest ${expected.sha256}`);
    console.error(`  actual   ${actual}`);
    process.exit(1);
  }
  contents[name] = content;
}

const product = JSON.parse(contents["product.json"]);
const sourceSlug = product.slug;
const name = overrideName ?? product.name;
const model = parseAbox(contents["model.ttl"], sourceSlug);

// The manifest names model.ttl authoritative, so model.xml must be derivable
// from it. Carrying two representations without checking they agree would give
// the bundle two sources of truth and no way to tell which one was used.
const rederived = toOpenExchange(model, { name: product.name });
if (rederived !== contents["model.xml"]) {
  console.error(
    "model.xml is not what model.ttl produces — the bundle has two different " +
      "models in it. model.ttl is authoritative (MANIFEST.authoritative), so " +
      "either re-export the bundle or delete model.xml if it was hand-edited."
  );
  process.exit(1);
}

const targetSlug = asSlug ?? (reid ? mintProductId() : sourceSlug);
const findings = validateModel(model);
const errors = findings.filter((f) => f.severity === "error");

console.log(`bundle ${dir}`);
console.log(`  format        v${manifest.formatVersion}, exported ${manifest.exportedAt}`);
console.log(`  from          ${manifest.sourceEnvironment} (${manifest.sourceFingerprint})`);
console.log(`  product       "${name}"`);
console.log(
  `  id            ${sourceSlug}` +
    (targetSlug === sourceSlug ? "" : `  ->  ${targetSlug}${reid ? "  (minted)" : ""}`)
);
console.log(
  `  model         ${model.elements.length} elements, ` +
    `${model.relationships.length} relationships, ArchiMate ${model.languageVersion}`
);
console.log(`  checksums     ok, and model.xml matches model.ttl`);
const bundledDocuments = manifest.documents ?? [];
console.log(
  `  documents     ${bundledDocuments.length} carried` +
    (manifest.withheld?.length
      ? `, ${manifest.withheld.length} withheld at export`
      : "")
);
for (const d of manifest.withheld ?? []) {
  console.log(`    not here    ${d.docId} (${d.classification})`);
}
if (errors.length) {
  console.log(`  validation    ${errors.length} error(s):`);
  for (const e of errors) console.log(`    ${e.message}`);
}
if (environmentFingerprint(outputs) === manifest.sourceFingerprint) {
  console.log(
    `  note          this bundle came from the environment you are importing into`
  );
}

if (dryRun) {
  console.log("\n--dry-run: nothing was written.");
  process.exit(0);
}

if (!username || !password) {
  console.error("\nset BP_USER and BP_PASSWORD (or pass --dry-run)");
  process.exit(2);
}

/* -- write ----------------------------------------------------------------- */

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
  const existing = unwrap(
    await client.models.Project.get({ slug: targetSlug }),
    "get product"
  );
  if (existing) {
    console.error(
      `\n"${targetSlug}" already exists here. An import creates a product; it ` +
        `does not merge into one.\n` +
        `  --reid to load this bundle alongside it under a fresh id, or delete ` +
        `the existing product first.`
    );
    process.exit(1);
  }

  // provisionProject, not Project.create: a row without its Cognito group is a
  // product nobody but an administrator can open. It derives group and ttlKey,
  // which is exactly the behaviour wanted here.
  const created = unwrap(
    await client.mutations.provisionProject({
      slug: targetSlug,
      name,
      description: product.description ?? undefined,
    }),
    "provision product"
  );

  // Re-serialized under the target id, which rewrites every IRI. Verified by
  // a unit test in packages/core rather than assumed here.
  const turtle = await serializeAbox({ ...model, projectSlug: targetSlug });

  const saved = unwrap(
    await client.mutations.saveModel({
      projectSlug: targetSlug,
      turtle,
      expectAbsent: true,
    }),
    "save model"
  );

  // Documents after the model, and never fatally: a product whose model
  // landed but whose notes did not is recoverable; one that fails halfway
  // through provisioning is not.
  let restored = 0;
  for (const doc of bundledDocuments) {
    for (const kind of ["source", "annotated"]) {
      const file = join(dir, "documents", doc.docId, `${kind}.md`);
      if (!existsSync(file)) continue;
      try {
        unwrap(
          await client.mutations.saveDocument({
            projectSlug: targetSlug,
            docId: doc.docId,
            markdown: readFileSync(file, "utf8"),
            title: doc.title,
            // Carried across as it was. A document does not become more
            // shareable by being moved to another environment.
            classification: doc.classification,
            kind,
          }),
          `restore ${doc.docId}/${kind}`
        );
        if (kind === "source") restored++;
      } catch (err) {
        console.error(`  could not restore ${doc.docId}/${kind}: ${err.message}`);
      }
    }
  }

  console.log(`\nimported as ${targetSlug}`);
  console.log(`  group ${created.group} — created EMPTY except for you.`);
  console.log(`  key   ${saved.key}`);
  console.log(`  documents restored: ${restored}`);
  console.log(`  etag  ${saved.etag}`);
  console.log(
    `  Members do not transfer (ADR-0010). Add them in the Cognito console.`
  );
} finally {
  await signOut();
}
