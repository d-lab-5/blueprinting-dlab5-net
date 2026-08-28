#!/usr/bin/env node
/**
 * Exercises the MCP model tools against a live backend.
 *
 * The metamodel tools are unit-tested; these cannot be, because what they are
 * for is inheriting the backend's guarantees — the per-project group check and
 * the ETag precondition. Mocking AppSync would test the mock.
 *
 * Creates a scratch project, works against it, and deletes it.
 *
 * Usage:
 *   BP_USER=… BP_PASSWORD=… node scripts/verify-mcp.mjs
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Amplify } from "aws-amplify";
import { signIn, fetchAuthSession, signOut } from "aws-amplify/auth";
import { cognitoUserPoolsTokenProvider } from "aws-amplify/auth/cognito";
import { generateClient } from "aws-amplify/data";

import { connect } from "@dlab5/archimate-mcp/dist/backend.js";
import { ALL_TOOLS } from "@dlab5/archimate-mcp/dist/tools.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUTS = resolve(ROOT, "backend/amplify_outputs.json");
Amplify.configure(JSON.parse(readFileSync(OUTPUTS, "utf8")));

const mem = new Map();
cognitoUserPoolsTokenProvider.setKeyValueStorage({
  setItem: async (k, v) => void mem.set(k, v),
  getItem: async (k) => (mem.has(k) ? mem.get(k) : null),
  removeItem: async (k) => void mem.delete(k),
  clear: async () => void mem.clear(),
});

const {
  BP_USER: username,
  BP_PASSWORD: password,
  BP_REFRESH_TOKEN: refreshToken,
} = process.env;
if (!refreshToken && (!username || !password)) {
  console.error("set BP_USER and BP_PASSWORD, or BP_REFRESH_TOKEN");
  process.exit(2);
}

let failures = 0;
const check = (ok, label, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

const tools = new Map(ALL_TOOLS.map((t) => [t.name, t]));
const call = (name, args) => tools.get(name).run(args);

await connect({ outputsPath: OUTPUTS, username, password, refreshToken });
const admin = generateClient({ authMode: "userPool" });

const slug = `mcp-${Date.now().toString(36)}`;
console.log(`MCP model tools, scratch project ${slug}\n`);

try {
  await admin.models.Project.create({
    slug,
    name: "MCP verification",
    group: `bp-${slug}`,
    ttlKey: `projects/${slug}/abox.ttl`,
    version: 0,
  });

  /* -- an agent builds a Layer 7 model from nothing ----------------------- */

  const wp = await call("add_element", {
    project: slug,
    type: "WorkPackage",
    name: "Migrate the ledger",
    properties: { startDate: "2026-09-01", endDate: "2026-09-30", status: "planned" },
  });
  check(/Added Work Package/.test(wp), "add_element creates an element", wp.trim());

  const del = await call("add_element", {
    project: slug,
    type: "Deliverable",
    name: "Migrated ledger",
  });
  check(/Added Deliverable/.test(del), "a second element is added");

  const ok = await call("add_relationship", {
    project: slug,
    source: "migrate-the-ledger",
    relationship: "realization",
    target: "migrated-ledger",
  });
  check(/Connected/.test(ok), "a permitted relationship is created", ok.trim());

  /* -- the property that matters ------------------------------------------ */

  const refused = await call("add_relationship", {
    project: slug,
    source: "migrated-ledger",
    relationship: "realization",
    target: "migrate-the-ledger",
  });
  check(
    /does not permit/.test(refused),
    "an ArchiMate-illegal relationship is REFUSED before writing"
  );
  check(
    /Permitted the other way round|Permitted in that direction/.test(refused),
    "the refusal says what would have been legal",
    refused.trim().slice(0, 110)
  );

  const stillValid = JSON.parse(await call("validate_model", { project: slug }));
  check(stillValid.valid === true, "the refusal left the model valid");
  check(
    stillValid.archimate.filter((f) => f.severity === "error").length === 0,
    "no errors were written"
  );

  const bogus = await call("add_element", {
    project: slug,
    type: "Wormhole",
    name: "Nope",
  });
  check(/not an ArchiMate/.test(bogus), "an invented element type is refused");

  /* -- reading ------------------------------------------------------------ */

  const found = JSON.parse(
    await call("query_elements", { project: slug, domain: "implementation" })
  );
  check(found.length === 2, "query_elements filters by domain", `${found.length} found`);
  check(
    found.some((e) => e.relationships.some((r) => r.includes("realization"))),
    "elements report their relationships"
  );

  const gantt = await call("render_roadmap", { project: slug });
  check(/^gantt/m.test(gantt), "render_roadmap returns a Mermaid Gantt");
  check(/Migrate the ledger/.test(gantt), "the new work package is on it");

  const oef = await call("export_open_exchange", { project: slug });
  check(/<model/.test(oef) && /WorkPackage/.test(oef), "export_open_exchange returns XML");

  /* -- removal keeps the model coherent ----------------------------------- */

  const removed = await call("remove_element", { project: slug, id: "migrated-ledger" });
  check(/relationship/.test(removed), "removing an element removes its relationships", removed.trim());
  const after = JSON.parse(await call("validate_model", { project: slug }));
  check(after.valid === true, "no dangling references are left behind");
} finally {
  try {
    await admin.models.Project.delete({ slug });
  } catch {
    /* best effort */
  }
  await signOut();
}

console.log(`\n${failures === 0 ? "all checks passed" : `${failures} FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
