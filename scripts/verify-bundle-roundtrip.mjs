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
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

console.log(`product bundle round trip (ADR-0010), source ${source}\n`);

try {
  /* -- 1. export ---------------------------------------------------------- */

  run([
    "scripts/bundle-export.mjs",
    "--product", source,
    "--out", bundleA,
    "--env", "roundtrip",
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
  if (scratch) {
    await signIn({ username, password });
    await fetchAuthSession();
    const client = generateClient({ authMode: "userPool" });
    try {
      await client.models.Project.delete({ slug: scratch });
      console.log(`\ncleaned up product ${scratch}`);
    } catch (err) {
      console.error(`\ncould not delete product ${scratch}: ${err.message}`);
    }
    await signOut();

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
