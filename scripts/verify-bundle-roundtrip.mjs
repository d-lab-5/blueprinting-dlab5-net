#!/usr/bin/env node
/**
 * Proves a product survives export, re-identification and reload (ADR-0010).
 *
 *   1. Export a real product from the environment            -> bundle A
 *   2. Import bundle A under a freshly minted id             -> scratch product
 *   3. Export the scratch product                            -> bundle B
 *   4. Normalise both to one id and compare the Turtle BYTE FOR BYTE
 *   5. Delete the scratch product and its Cognito group
 *
 * Step 3 is what makes this worth running. An exporter and an importer that
 * agree with each other prove nothing - the same trap verify:archi and
 * verify:mcp-client exist to avoid. Going back out through S3 means the bytes
 * compared are bytes that made the whole round trip, not bytes held in memory
 * by the code under test.
 *
 * Usage:
 *   BP_USER=... BP_PASSWORD=... node scripts/verify-bundle-roundtrip.mjs \
 *     [--product <slug>]
 *
 * The user must be in bp-admins. Cleaning up the Cognito group uses the AWS
 * CLI with your own credentials, because provisioning a group goes through a
 * Lambda holding permissions the browser must never have - and there is
 * deliberately no mutation that deletes one.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Amplify } from "aws-amplify";
import { signIn, fetchAuthSession, signOut } from "aws-amplify/auth";
import { cognitoUserPoolsTokenProvider } from "aws-amplify/auth/cognito";
import { generateClient } from "aws-amplify/data";

import { parseAbox, serializeAbox } from "@dlab5/blueprint-core";

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

const source = arg("--product") ?? "dlab5-blueprint";
const { BP_USER: username, BP_PASSWORD: password } = process.env;
if (!username || !password) {
  console.error("set BP_USER and BP_PASSWORD");
  process.exit(2);
}

let failures = 0;
const check = (ok, what, detail) => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${what}${detail ? ` - ${detail}` : ""}`);
  if (!ok) failures++;
};

const run = (args) =>
  execFileSync(process.execPath, args, {
    cwd: ROOT,
    encoding: "utf8",
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });

const readJson = (dir, name) => JSON.parse(readFileSync(join(dir, name), "utf8"));

const work = mkdtempSync(join(tmpdir(), "bp-bundle-"));
const bundleA = join(work, "a");
const bundleB = join(work, "b");
let scratch = null;
/** Seeded on the source product; cleaned up in the finally block. */
let seededIds = [];

console.log(`product bundle round trip (ADR-0010), source ${source}\n`);

try {
  /* -- 0. documents on the source product ---------------------------------- */

  // Seeded BEFORE the first export, so the round trip carries them and the
  // restore path is exercised. Seeded afterwards, as this first did, the
  // import never sees a document and the restore code is shipped unproven.
  await signIn({ username, password });
  await fetchAuthSession();
  const docClient = generateClient({ authMode: "userPool" });
  const docStamp = Date.now().toString(36);
  const seeded = [
    [`bundle-conf-${docStamp}`, "confidential", "# Commercial terms\n"],
    [`bundle-collab-${docStamp}`, "collaboration", "# Sprint notes\n"],
    [`bundle-shared-${docStamp}`, "shared", "# Field mapping\n"],
  ];
  for (const [docId, classification, markdown] of seeded) {
    await docClient.mutations.saveDocument({
      projectSlug: source,
      docId,
      markdown,
      title: docId,
      classification,
    });
  }
  await signOut();
  const [confId, collabId, sharedId] = seeded.map(([id]) => id);
  seededIds = [confId, collabId, sharedId];

  /* -- 1. export ---------------------------------------------------------- */

  run([
    "scripts/bundle-export.mjs",
    "--product", source,
    "--out", bundleA,
    "--env", "roundtrip",
    "--include", "collaboration",
  ]);

  const manifestA = readJson(bundleA, "MANIFEST.json");
  check(
    manifestA.authoritative === "model.ttl",
    "the manifest names model.ttl authoritative"
  );

  const poolId = outputs?.auth?.user_pool_id;
  check(
    Boolean(poolId) && !JSON.stringify(manifestA).includes(poolId),
    "the manifest carries no AWS identifier",
    "a one-way fingerprint only"
  );

  const productA = readJson(bundleA, "product.json");
  check(
    !("group" in productA) && !("ttlKey" in productA),
    "product.json carries no derived field",
    "group and ttlKey are recomputed on import"
  );
  for (const local of ["version", "lockedBy", "lockedAt"]) {
    check(!(local in productA), `product.json drops ${local}`);
  }

  /* -- 2. import under a new id ------------------------------------------- */

  const imported = run(["scripts/bundle-import.mjs", "--in", bundleA, "--reid"]);
  scratch = /imported as (\S+)/.exec(imported)?.[1] ?? null;
  check(
    Boolean(scratch),
    "the bundle imported under a minted id",
    scratch ?? "no id in the output"
  );
  if (!scratch) throw new Error("cannot continue without a scratch product");
  check(
    /^p-[23456789bcdfghjkmnpqrstvwxz]{10}$/.test(scratch),
    "the minted id is opaque",
    scratch
  );

  /* -- 2b. the documents landed too --------------------------------------- */

  await signIn({ username, password });
  await fetchAuthSession();
  const check2 = generateClient({ authMode: "userPool" });
  const landed = await check2.models.Document.list({
    filter: { projectSlug: { eq: scratch } },
  });
  const landedIds = (landed.data ?? []).map((d) => d.docId).sort();
  await signOut();

  check(
    landedIds.includes(sharedId) && landedIds.includes(collabId),
    "the documents that travelled were restored on import",
    landedIds.join(", ") || "none"
  );
  check(
    !landedIds.includes(confId),
    "and the confidential one did not appear from nowhere"
  );
  const restoredCollab = (landed.data ?? []).find((d) => d.docId === collabId);
  check(
    restoredCollab?.classification === "collaboration",
    "classification survives the move",
    restoredCollab?.classification ?? "missing"
  );

  /* -- 3. export what actually landed ------------------------------------- */

  run([
    "scripts/bundle-export.mjs",
    "--product", scratch,
    "--out", bundleB,
    "--env", "roundtrip",
  ]);

  /* -- 4. compare --------------------------------------------------------- */

  const ttlA = readFileSync(join(bundleA, "model.ttl"), "utf8");
  const ttlB = readFileSync(join(bundleB, "model.ttl"), "utf8");

  check(ttlB.includes(`/i/${scratch}/`), "every IRI was rewritten to the new id");
  // The IRI base, not the bare string. An element in this very model has the
  // id "dlab5-blueprint-blockly", so a substring match would fail forever on
  // legitimate content - and, worse, would suggest re-identifying by search
  // and replace, which would corrupt exactly that element.
  check(
    !ttlB.includes(`/i/${source}/`),
    "no IRI still carries the old id",
    `${(ttlB.match(/\/i\/[^/]+\//g) ?? []).length} IRIs, all under /i/${scratch}/`
  );

  // Normalise both to one id, then compare bytes. Comparing parsed objects
  // would let a serialization difference through, which is exactly the kind of
  // drift a transfer format must not have.
  const norm = async (ttl, slug) =>
    serializeAbox({ ...parseAbox(ttl, slug), projectSlug: "normalised" });
  const na = await norm(ttlA, source);
  const nb = await norm(ttlB, scratch);
  check(
    na === nb,
    "the model is byte-identical after the round trip",
    na === nb ? `${na.length} bytes` : firstDifference(na, nb)
  );

  const productB = readJson(bundleB, "product.json");
  check(productA.name === productB.name, "the name survives", `"${productB.name}"`);
  check(
    (productA.description ?? null) === (productB.description ?? null),
    "the description survives"
  );

  const manifestB = readJson(bundleB, "MANIFEST.json");
  check(
    manifestA.counts.elements === manifestB.counts.elements &&
      manifestA.counts.relationships === manifestB.counts.relationships,
    "nothing was gained or lost",
    `${manifestB.counts.elements} elements, ` +
      `${manifestB.counts.relationships} relationships`
  );
  check(
    manifestA.languageVersion === manifestB.languageVersion,
    "the ArchiMate version is preserved"
  );

  /* -- 5. documents travel only as far as they are allowed ---------------- */

  const withDocs = join(work, "docs-default");
  const withCollab = join(work, "docs-collab");

  run(["scripts/bundle-export.mjs", "--product", source, "--out", withDocs,
       "--env", "roundtrip"]);
  run(["scripts/bundle-export.mjs", "--product", source, "--out", withCollab,
       "--env", "roundtrip", "--include", "collaboration"]);

  const has = (dir, docId) =>
    existsSync(join(dir, "documents", docId, "source.md"));

  check(has(withDocs, sharedId), "a shared document travels by default");
  check(
    !has(withDocs, collabId),
    "a collaboration document does NOT travel by default",
    "the default bundle is the one safe to commit"
  );
  check(
    !has(withDocs, confId) && !has(withCollab, confId),
    "a confidential document travels under NO flag",
    "there is deliberately no way to ask for it"
  );
  check(
    has(withCollab, collabId),
    "--include collaboration carries the middle tier"
  );
  check(
    has(withCollab, sharedId),
    "and still carries the shared one"
  );

  const defaultManifest = readJson(withDocs, "MANIFEST.json");
  check(
    defaultManifest.formatVersion === 2,
    "the bundle declares format v2",
    `v${defaultManifest.formatVersion}`
  );
  check(
    (defaultManifest.withheld ?? []).some((d) => d.docId === confId) &&
      (defaultManifest.withheld ?? []).some((d) => d.docId === collabId),
    "the manifest says what it withheld, not only what it carried",
    `${(defaultManifest.withheld ?? []).length} withheld`
  );

  // Nothing of a withheld document may be anywhere in the bundle — not its
  // text, and not its id in a file list. A bundle that names what it does not
  // contain still leaks that the document exists.
  const everything = [...Object.keys(defaultManifest.files ?? {})].join(" ") +
    JSON.stringify(defaultManifest.documents ?? []);
  check(
    !everything.includes(confId),
    "a withheld document's content is nowhere in the carried files"
  );

  /* -- 5. a bundle that disagrees with itself is refused ------------------- */

  const tampered = join(work, "tampered");
  run([
    "scripts/bundle-export.mjs",
    "--product", source,
    "--out", tampered,
    "--env", "roundtrip",
  ]);

  // Rewrite model.xml AND its checksum, so the only thing left to catch it is
  // the re-derivation. A checksum-only guard would wave this through, which is
  // the whole reason the importer re-derives.
  const badXml = readFileSync(join(tampered, "model.xml"), "utf8").replace(
    "</model>",
    "<!-- edited by hand --></model>"
  );
  writeFileSync(join(tampered, "model.xml"), badXml);
  const mt = readJson(tampered, "MANIFEST.json");
  mt.files["model.xml"].sha256 = createHash("sha256").update(badXml).digest("hex");
  mt.files["model.xml"].bytes = Buffer.byteLength(badXml);
  writeFileSync(join(tampered, "MANIFEST.json"), JSON.stringify(mt, null, 2) + "\n");

  let refused = false;
  try {
    run(["scripts/bundle-import.mjs", "--in", tampered, "--dry-run"]);
  } catch {
    refused = true;
  }
  check(
    refused,
    "an XML that disagrees with the Turtle is refused, checksum or not"
  );
} finally {
  if (typeof seededIds !== "undefined" && seededIds.length) {
    await signIn({ username, password });
    await fetchAuthSession();
    const c = generateClient({ authMode: "userPool" });
    for (const docId of seededIds) {
      try {
        await c.models.Document.delete({ projectSlug: source, docId });
      } catch {
        console.error(`could not delete document ${docId}`);
      }
    }
    await signOut();
    const poolBucket = outputs?.storage?.bucket_name;
    if (poolBucket) {
      for (const docId of seededIds) {
        try {
          execFileSync(
            "aws",
            ["s3", "rm", `s3://${poolBucket}/projects/${source}/documents/${docId}/`,
             "--recursive"],
            { stdio: "ignore" }
          );
        } catch {
          console.error(`LEFT BEHIND: documents/${docId}/`);
        }
      }
    }
    console.log(`cleaned up ${seededIds.length} seeded documents`);
  }

  if (scratch) {
    await signIn({ username, password });
    await fetchAuthSession();
    const sc = generateClient({ authMode: "userPool" });
    try {
      const theirs = await sc.models.Document.list({
        filter: { projectSlug: { eq: scratch } },
      });
      for (const d of theirs.data ?? []) {
        await sc.models.Document.delete({ projectSlug: scratch, docId: d.docId });
      }
    } catch {
      console.error("could not clear the scratch product's documents");
    }
    const client = sc;
    try {
      await client.models.Project.delete({ slug: scratch });
      console.log(`\ncleaned up product ${scratch}`);
    } catch (err) {
      console.error(`\ncould not delete product ${scratch}: ${err.message}`);
    }
    await signOut();

    // The product row and the group were being cleaned up, and the model in
    // S3 was not — so every run left a 96 kB abox.ttl under a product that no
    // longer existed. Nothing pointed at it and nothing complained, which is
    // how litter accumulates in a bucket for weeks.
    const scratchBucket = outputs?.storage?.bucket_name;
    if (scratchBucket) {
      try {
        execFileSync(
          "aws",
          ["s3", "rm", `s3://${scratchBucket}/projects/${scratch}/`, "--recursive"],
          { stdio: "ignore" }
        );
        console.log(`cleaned up s3://…/projects/${scratch}/`);
      } catch {
        console.error(`LEFT BEHIND: projects/${scratch}/ in the model bucket.`);
      }
    }

    const poolId = outputs?.auth?.user_pool_id;
    if (poolId) {
      try {
        execFileSync(
          "aws",
          [
            "cognito-idp", "delete-group",
            "--group-name", `bp-${scratch}`,
            "--user-pool-id", poolId,
          ],
          { stdio: "ignore" }
        );
        console.log(`cleaned up Cognito group bp-${scratch}`);
      } catch {
        console.error(
          `LEFT BEHIND: Cognito group bp-${scratch}. Delete it by hand - an ` +
            `orphan group is a permission nobody can see the purpose of.`
        );
      }
    }
  }
  rmSync(work, { recursive: true, force: true });
}

function firstDifference(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] !== b[i]) {
      return (
        `first differs at byte ${i}: ` +
        `${JSON.stringify(a.slice(i, i + 60))} vs ${JSON.stringify(b.slice(i, i + 60))}`
      );
    }
  }
  return "lengths differ";
}

console.log(`\n${failures === 0 ? "all checks passed" : `${failures} FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
