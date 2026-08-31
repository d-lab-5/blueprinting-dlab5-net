#!/usr/bin/env node
/**
 * Writes one product out as a transfer bundle (ADR-0010).
 *
 * A bundle is the unit of movement between environments and the mechanism for
 * structural change: export, transform the files, reload. Nothing here mutates
 * anything — the environment is untouched.
 *
 * Usage:
 *   BP_USER=… BP_PASSWORD=… node scripts/bundle-export.mjs \
 *     --product <slug> --out <dir> [--env <label>]
 *
 * Targets whatever backend/amplify_outputs.json points at; for a deployed
 * branch, regenerate it first with
 * `cd backend && npx ampx generate outputs --app-id <id> --branch <branch>`.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Amplify } from "aws-amplify";
import { signIn, fetchAuthSession, signOut } from "aws-amplify/auth";
import { cognitoUserPoolsTokenProvider } from "aws-amplify/auth/cognito";
import { generateClient } from "aws-amplify/data";

import { parseAbox, serializeAbox, validateModel } from "@dlab5/blueprint-core";
import { toOpenExchange } from "@dlab5/archimate-exchange";

import {
  BUNDLE_FORMAT,
  environmentFingerprint,
  mayTravel,
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

const slug = arg("--product") ?? arg("--project");
const out = arg("--out");
const envLabel = arg("--env") ?? "unspecified";
// Shared only unless asked otherwise. The safest default is the one that
// produces a bundle safe to commit, because that is the bundle someone will
// commit without checking.
const include = process.argv.includes("--include")
  ? arg("--include")
  : "shared";
if (include !== "shared" && include !== "collaboration") {
  console.error(
    `--include takes "shared" (default) or "collaboration". Confidential ` +
      `documents never travel and there is deliberately no flag for it.`
  );
  process.exit(2);
}
const { BP_USER: username, BP_PASSWORD: password } = process.env;

if (!slug || !out) {
  console.error(
    "usage: node scripts/bundle-export.mjs --product <slug> --out <dir> " +
      "[--env <label>] [--include collaboration]"
  );
  process.exit(2);
}
if (!username || !password) {
  console.error("set BP_USER and BP_PASSWORD");
  process.exit(2);
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
  const row = unwrap(await client.models.Project.get({ slug }), "get product");
  if (!row) {
    console.error(`no product "${slug}" here, or it is not yours`);
    process.exit(1);
  }

  const access = unwrap(
    await client.mutations.requestModelReadUrl({ projectSlug: slug }),
    "read model"
  );
  if (!access.exists) {
    console.error(`product "${slug}" has no model yet; nothing to bundle`);
    process.exit(1);
  }

  const turtle = await (await fetch(access.url)).text();
  const model = parseAbox(turtle, slug);

  // Re-serialized rather than copied byte for byte. The serializer is
  // byte-stable, so this is normally a no-op — and when it is not, the bundle
  // should carry what this version of the tool writes, not whatever an older
  // one left in the bucket. A round-trip that starts from a file no current
  // code path would produce proves nothing about the current code path.
  const canonical = await serializeAbox(model);
  const xml = toOpenExchange(model, { name: row.name });

  const findings = validateModel(model);
  const errors = findings.filter((f) => f.severity === "error");

  mkdirSync(out, { recursive: true });

  // Environment-local fields are dropped here, not on import, so that a
  // bundle never carries them at all: `version` is a local revision counter,
  // and a lock from one environment would park the product in the next.
  const product = {
    slug: row.slug,
    name: row.name,
    description: row.description ?? null,
  };

  /* -- documents ---------------------------------------------------------- */

  const index = await client.models.Document.list({
    filter: { projectSlug: { eq: slug } },
  });
  const allDocuments = index.data ?? [];
  const travelling = allDocuments.filter((d) =>
    mayTravel(d.classification, include)
  );
  const held = allDocuments.filter((d) => !mayTravel(d.classification, include));

  const documentFiles = {};
  const manifestDocuments = [];
  for (const doc of travelling) {
    for (const kind of ["source", "annotated"]) {
      if (kind === "annotated" && !doc.annotatedKey) continue;
      const access = unwrap(
        await client.mutations.requestDocumentReadUrl({
          projectSlug: slug,
          docId: doc.docId,
          kind,
        }),
        `read ${doc.docId}/${kind}`
      );
      if (!access.exists || !access.url) continue;
      const text = await (await fetch(access.url)).text();
      documentFiles[`documents/${doc.docId}/${kind}.md`] = text;
    }
    manifestDocuments.push({
      docId: doc.docId,
      title: doc.title,
      classification: doc.classification,
    });
  }

  const files = {
    "product.json": JSON.stringify(product, null, 2) + "\n",
    "model.ttl": canonical,
    "model.xml": xml,
    ...documentFiles,
  };
  for (const [name, content] of Object.entries(files)) {
    const target = join(out, name);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
  }

  const manifest = {
    format: BUNDLE_FORMAT.name,
    formatVersion: BUNDLE_FORMAT.version,
    exportedAt: new Date().toISOString(),
    // A label the operator chose, plus a one-way fingerprint of the user pool.
    // The fingerprint lets an import say "this came from the environment you
    // are importing into" without putting an AWS identifier in a file that may
    // well end up in a public repository.
    sourceEnvironment: envLabel,
    sourceFingerprint: environmentFingerprint(outputs),
    authoritative: "model.ttl",
    product: { slug: row.slug },
    counts: {
      elements: model.elements.length,
      relationships: model.relationships.length,
    },
    languageVersion: model.languageVersion,
    include,
    documents: manifestDocuments,
    // What was deliberately left behind, and why. A bundle that silently
    // omits half a product's records is indistinguishable from one that had
    // none, and the difference matters when someone reloads it.
    withheld: held.map((d) => ({
      docId: d.docId,
      classification: d.classification,
    })),
    files: Object.fromEntries(
      Object.entries(files).map(([name, content]) => [
        name,
        { sha256: sha256(content), bytes: Buffer.byteLength(content) },
      ])
    ),
  };
  writeFileSync(join(out, "MANIFEST.json"), JSON.stringify(manifest, null, 2) + "\n");

  console.log(`bundled ${slug} -> ${out}`);
  console.log(
    `  ${model.elements.length} elements, ${model.relationships.length} relationships, ` +
      `ArchiMate ${model.languageVersion}`
  );
  console.log(`  name "${row.name}"`);
  console.log(`  group ${row.group} and membership are NOT in the bundle (ADR-0010)`);
  console.log(
    `  documents: ${travelling.length} carried (--include ${include}), ` +
      `${held.length} withheld`
  );
  for (const d of held) {
    console.log(`    withheld  ${d.docId}  (${d.classification})`);
  }
  if (held.some((d) => d.classification !== "confidential")) {
    console.log(
      `    pass --include collaboration to carry collaboration documents too.`
    );
  }
  if (errors.length) {
    console.log(`  ${errors.length} validation error(s) — exported anyway:`);
    for (const e of errors) console.log(`    ${e.message}`);
  }
} finally {
  await signOut();
}
