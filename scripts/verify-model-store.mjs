#!/usr/bin/env node
/**
 * Verifies the model store's two load-bearing properties against a live
 * backend: per-project authorization, and refusal of a lost update.
 *
 * Both are claims that cannot be checked by reading code. The authorization
 * boundary lives inside a Lambda, and the ETag precondition lives in S3 — a
 * unit test would only be exercising a mock of each.
 *
 * Usage:
 *   BP_USER=… BP_PASSWORD=… node scripts/verify-model-store.mjs
 *
 * The user must be in bp-admins. The script creates a scratch project, works
 * against it, and deletes it again.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Amplify } from "aws-amplify";
import { signIn, fetchAuthSession, signOut } from "aws-amplify/auth";
import { cognitoUserPoolsTokenProvider } from "aws-amplify/auth/cognito";
import { generateClient } from "aws-amplify/data";

import { parseAbox, serializeAbox } from "@dlab5/blueprint-core";

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

const username = process.env.BP_USER;
const password = process.env.BP_PASSWORD;
if (!username || !password) {
  console.error("set BP_USER and BP_PASSWORD");
  process.exit(2);
}

let failures = 0;
const check = (ok, label, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

await signIn({ username, password });
await fetchAuthSession();
const client = generateClient({ authMode: "userPool" });

const slug = `verify-${Date.now().toString(36)}`;
console.log(`model store (ADR-0003), scratch project ${slug}\n`);

const model = {
  projectSlug: slug,
  elements: [
    { id: "wp1", type: "WorkPackage", name: "Foundation", properties: { startDate: "2026-08-23" } },
    { id: "d1", type: "Deliverable", name: "Shell", properties: {} },
  ],
  relationships: [
    { id: "r1", type: "realization", source: "wp1", target: "d1", properties: {} },
  ],
};

const unwrap = (r, what) => {
  if (r.errors?.length) throw new Error(`${what}: ${r.errors.map((e) => e.message).join("; ")}`);
  return r.data;
};

try {
  /* -- a project nobody is a member of ------------------------------------ */

  unwrap(
    await client.models.Project.create({
      slug,
      name: "Verification scratch",
      group: `bp-${slug}`, // a Cognito group that does not exist
      ttlKey: `projects/${slug}/abox.ttl`,
      version: 0,
    }),
    "create project"
  );

  /* -- read before anything is written ------------------------------------ */

  const empty = unwrap(
    await client.mutations.requestModelReadUrl({ projectSlug: slug }),
    "read empty"
  );
  check(empty.exists === false, "a project with no model reads as empty, not an error");
  check(empty.key === `projects/${slug}/abox.ttl`, "key comes from the project row", empty.key);

  /* -- first write -------------------------------------------------------- */

  const turtle = await serializeAbox(model);
  const first = unwrap(
    await client.mutations.saveModel({ projectSlug: slug, turtle, expectAbsent: true }),
    "first save"
  );
  check(Boolean(first.etag), "first save succeeds with expectAbsent", first.etag);

  /* -- read back through the pre-signed URL ------------------------------- */

  const read = unwrap(
    await client.mutations.requestModelReadUrl({ projectSlug: slug }),
    "read"
  );
  check(read.exists === true, "the model now exists");
  check(Boolean(read.url), "a pre-signed GET is returned");
  const fetched = await (await fetch(read.url)).text();
  check(fetched === turtle, "the bytes fetched are the bytes stored");

  const back = parseAbox(fetched, slug);
  check(
    back.elements.length === 2 && back.relationships.length === 1,
    "the round trip survives S3",
    `${back.elements.length} elements, ${back.relationships.length} relationships`
  );

  /* -- the lost update ---------------------------------------------------- */

  const staleEtag = read.etag;
  const edited = { ...model, elements: [...model.elements, { id: "d2", type: "Deliverable", name: "Second", properties: {} }] };
  const good = unwrap(
    await client.mutations.saveModel({
      projectSlug: slug,
      turtle: await serializeAbox(edited),
      etag: staleEtag,
    }),
    "conditional save"
  );
  check(good.etag !== staleEtag, "a save with the current ETag succeeds and moves it");

  let refused = false;
  let message = "";
  try {
    const r = await client.mutations.saveModel({
      projectSlug: slug,
      turtle: await serializeAbox(model),
      etag: staleEtag, // now stale — someone else saved in between
    });
    if (r.errors?.length) {
      refused = true;
      message = r.errors[0].message;
    }
  } catch (err) {
    refused = true;
    message = err.message;
  }
  check(refused, "a save with a stale ETag is REFUSED, not silently applied", message);

  let unconditional = false;
  try {
    const r = await client.mutations.saveModel({ projectSlug: slug, turtle });
    if (r.errors?.length) unconditional = true;
  } catch {
    unconditional = true;
  }
  check(unconditional, "an unconditional save is refused");

  /* -- authorization ------------------------------------------------------ */

  let denied = false;
  try {
    const r = await client.mutations.requestModelReadUrl({ projectSlug: "no-such-project" });
    if (r.errors?.length) denied = true;
  } catch {
    denied = true;
  }
  check(denied, "an unknown project is refused");
} finally {
  try {
    await client.models.Project.delete({ slug });
  } catch {
    /* best effort */
  }
  await signOut();
}

console.log(`\n${failures === 0 ? "all checks passed" : `${failures} FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
