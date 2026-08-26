#!/usr/bin/env node
/**
 * Round-trips a model through Archi itself.
 *
 * Schema validity says a document is well-formed against the XSD. It does not
 * say Archi will open it, nor that anything survives the trip — Archi has its
 * own reader with its own opinions. This drives the real thing: Archi imports
 * our export, re-exports it, and the result is compared against what we sent.
 *
 * Usage:
 *   node scripts/verify-archi-roundtrip.mjs [--archi <path to Archi launcher>]
 *
 * Install Archi from https://www.archimatetool.com/download/ — a user-local
 * unpack is enough, no system install. Skips cleanly when Archi is absent, so
 * this is safe to run anywhere.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  PLATFORM_ROADMAP,
  hasErrors,
  validateModel,
} from "@dlab5/blueprint-core";
import { fromOpenExchange, toOpenExchange } from "@dlab5/archimate-exchange";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const argIdx = process.argv.indexOf("--archi");
const ARCHI =
  argIdx > -1
    ? process.argv[argIdx + 1]
    : [join(homedir(), "opt/Archi/Archi"), "/opt/Archi/Archi", "Archi"].find(
        (p) => p === "Archi" || existsSync(p)
      );

if (!ARCHI || (ARCHI !== "Archi" && !existsSync(ARCHI))) {
  console.log("Archi not found — skipping. Pass --archi <path> to point at it.");
  process.exit(0);
}

const tmp = mkdtempSync(join(tmpdir(), "archi-rt-"));
const sent = join(tmp, "sent.xml");
const returned = join(tmp, "returned.xml");

let failures = 0;
const check = (ok, label, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

const model = PLATFORM_ROADMAP;
writeFileSync(sent, toOpenExchange(model, { name: "Round-trip fixture" }));

console.log("ArchiMate Open Exchange round trip, through Archi itself\n");

let log;
try {
  log = execFileSync(
    ARCHI,
    [
      "-application", "com.archimatetool.commandline.app",
      "-consoleLog", "-nosplash", "--abortOnException",
      "--xmlexchange.import", sent,
      "--xmlexchange.export", returned,
    ],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 300000 }
  );
} catch (err) {
  console.log("  FAIL  Archi refused the file");
  console.log((err.stdout ?? "") + (err.stderr ?? ""));
  process.exit(1);
}

check(/XML Imported!/.test(log), "Archi imports the export");
check(/Validated!/.test(log), "Archi's own validator accepts it");
check(existsSync(returned), "Archi re-exports it");

const before = fromOpenExchange(readFileSync(sent, "utf8"), model.projectSlug).model;
const after = fromOpenExchange(readFileSync(returned, "utf8"), model.projectSlug);

check(
  after.model.elements.length === before.elements.length,
  "element count survives",
  `${after.model.elements.length} vs ${before.elements.length}`
);
check(
  after.model.relationships.length === before.relationships.length,
  "relationship count survives",
  `${after.model.relationships.length} vs ${before.relationships.length}`
);
check(after.warnings.length === 0, "nothing is skipped on re-import", JSON.stringify(after.warnings));
check(!hasErrors(validateModel(after.model)), "still legal ArchiMate afterwards");

const names = (m) => new Set(m.elements.map((e) => e.name));
const lost = [...names(before)].filter((n) => !names(after.model).has(n));
check(lost.length === 0, "every element name survives", lost.join(", ") || "none lost");

const kinds = (m, key) =>
  JSON.stringify([...new Set(m[key].map((x) => x.type))].sort());
check(kinds(after.model, "elements") === kinds(before, "elements"), "element types survive");
check(
  kinds(after.model, "relationships") === kinds(before, "relationships"),
  "relationship types survive"
);

// The payoff for putting the schedule in ArchiMate Properties rather than
// inventing fields: it comes back.
const pick = (m, name) => m.elements.find((e) => e.name === name);
const a = pick(before, "WP1 Foundation");
const b = pick(after.model, "WP1 Foundation");
check(
  JSON.stringify(a?.properties) === JSON.stringify(b?.properties),
  "schedule Properties survive",
  JSON.stringify(b?.properties)
);
check(Boolean(b?.documentation), "documentation survives");

console.log(`\n${failures === 0 ? "all checks passed" : `${failures} FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
