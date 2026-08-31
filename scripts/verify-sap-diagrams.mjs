#!/usr/bin/env node
/**
 * The SAP draw.io toolchain, end to end.
 *
 * Three layers, and it is worth being clear which proves what:
 *
 *   1. The description written from a model. Pure, and unit-tested in
 *      packages/mcp — not repeated here.
 *   2. The scaffolder, validator and scorer actually running. This file.
 *      Needs python3 and the vendored scripts, nothing else.
 *   3. Whether the diagram LOOKS right. Only a person can judge that, and
 *      only after rendering it — which needs draw.io desktop. Rendered here
 *      when it is installed, skipped with an explanation when it is not, the
 *      way verify:archi treats Archi.
 *
 * The assertion this file exists for is the one that would otherwise be
 * misread: a freshly scaffolded diagram scores 100/100 because it is still the
 * template, and that number means the opposite of what it looks like.
 *
 * Usage:  node scripts/verify-sap-diagrams.mjs [--keep]
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { scriptsDir } from "../packages/mcp/dist/sapDiagrams.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const keep = process.argv.includes("--keep");

let failures = 0;
const check = (ok, what, detail) => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${what}${detail ? ` - ${detail}` : ""}`);
  if (!ok) failures++;
};

const dir = scriptsDir(ROOT);
if (!dir) {
  console.log("SKIP  the draw.io toolchain is not installed.");
  console.log("      Run scripts/setup-sap-diagrams.sh first.");
  process.exit(0);
}

/** Runs a vendored script; a non-zero exit is a result here, not a fault. */
function py(script, args) {
  try {
    return execFileSync("python3", [join(dir, script), ...args], {
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
    });
  } catch (err) {
    return `${err.stdout ?? ""}${err.stderr ?? ""}`;
  }
}

const work = mkdtempSync(join(tmpdir(), "bp-sapdiagram-"));
const out = join(work, "candidate.drawio");

console.log("SAP draw.io toolchain\n");

try {
  /* -- scaffold ------------------------------------------------------------ */

  const description =
    "SAP ECC on premise with a Db2 database, connected through BTP " +
    "Integration Suite to a HANA Cloud reporting layer";

  const raw = py("scaffold_diagram.py", [
    description,
    "--out",
    out,
    "--json",
    "--force",
  ]);

  let scaffolded;
  try {
    scaffolded = JSON.parse(raw);
  } catch {
    check(false, "the scaffolder returns JSON", raw.slice(0, 200));
    throw new Error("cannot continue without a scaffold");
  }

  check(existsSync(out), "a .drawio file is produced", `${statSync(out).size} bytes`);
  check(
    scaffolded.candidates.length > 1,
    "it ranks several templates rather than taking the first",
    `${scaffolded.candidates.length} considered`
  );
  check(
    readFileSync(out, "utf8").includes("<mxCell"),
    "the file is a draw.io document"
  );

  /* -- the number that will be misread ------------------------------------- */

  const scored = py("score_corpus.py", ["--min-score", "90", out]);
  const best = /best\s*:\s*([\d.]+)/.exec(scored);
  check(Boolean(best), "the scorer reports a score", best?.[1] ?? scored.slice(0, 120));

  // This is the point of the whole file. A scaffold is a copy of its template,
  // so it scores perfectly against that template — for exactly the reason it is
  // worthless. Anything reading the score alone would call this finished.
  check(
    Number(best?.[1]) >= 99,
    "an UNEDITED scaffold scores ~100, which is why the score alone means nothing",
    `${best?.[1]} against the template it was copied from`
  );

  const sameBytes =
    readFileSync(out, "utf8") === readFileSync(scaffolded.template, "utf8");
  check(
    sameBytes,
    "and it is byte-identical to that template, containing none of the request",
    "which is what the tools report as `unedited`"
  );

  /* -- validation ---------------------------------------------------------- */

  const fixed = py("autofix.py", ["--write", out]);
  check(/wrote|fixes|no changes/i.test(fixed), "autofix runs", fixed.split("\n")[0]?.slice(0, 90));

  const validated = py("validate.py", [out]);
  check(
    validated.trim().length > 0,
    "validate reports something a person can act on",
    `${validated.split("\n").filter(Boolean).length} line(s)`
  );

  /* -- and the one that needs eyes ----------------------------------------- */

  const png = join(work, "candidate.png");
  const rendered = py("render.py", [out, "-o", png]);
  if (existsSync(png)) {
    check(true, "rendered to PNG", `${statSync(png).size} bytes at ${png}`);
    console.log(
      "\n  Open it. The score says nothing about whether the diagram is right,\n" +
        "  and nothing in this file can."
    );
  } else {
    console.log(
      "\n  SKIP  no draw.io desktop CLI, so nothing was rendered and nobody has\n" +
        "        looked at the result. Install draw.io desktop to close that gap;\n" +
        "        until then the visual half of this is unverified, which is the\n" +
        "        half that decides whether a diagram is any good.\n" +
        `        (${rendered.trim().split("\n")[0]?.slice(0, 88) ?? "not found"})`
    );
  }
} finally {
  if (keep) console.log(`\nkept ${work}`);
  else rmSync(work, { recursive: true, force: true });
}

console.log(`\n${failures === 0 ? "all checks passed" : `${failures} FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
