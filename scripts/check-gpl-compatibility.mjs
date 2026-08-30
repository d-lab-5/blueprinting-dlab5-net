#!/usr/bin/env node
/**
 * Are this repository's dependencies compatible with GPL-3.0?
 *
 * Run BEFORE relicensing anything. A relicence that breaks a dependency is
 * worse than no relicence, and the answer is usually yes — but "usually" is
 * not a licence review.
 *
 * Reads package.json licence fields from node_modules. Packages using the
 * older `licenses` array report UNKNOWN and are listed for reading by hand;
 * every one of them here turned out to be MIT or public domain.
 *
 * Usage:  node scripts/check-gpl-compatibility.mjs [node_modules-path]
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(process.argv[2] ?? "node_modules");
if (!existsSync(root)) {
  console.error(`no node_modules at ${root} — run npm ci first`);
  process.exit(2);
}

/** One-way compatible INTO GPL-3.0. Not a complete list; a working one. */
const COMPATIBLE = new Set([
  "MIT", "MIT-0", "ISC", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause",
  "0BSD", "Unlicense", "CC0-1.0", "MPL-2.0", "Zlib", "Python-2.0",
  "BlueOak-1.0.0", "CC-BY-4.0", "GPL-3.0", "GPL-3.0-or-later", "LGPL-3.0",
  "AGPL-3.0", "WTFPL", "BSD", "Artistic-2.0",
]);

const seen = new Map();
(function walk(dir, depth) {
  if (depth > 4) return;
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (!e.isDirectory() || e.name === ".bin") continue;
    const p = join(dir, e.name);
    if (e.name.startsWith("@")) { walk(p, depth); continue; }
    try {
      const pkg = JSON.parse(readFileSync(join(p, "package.json"), "utf8"));
      const l = typeof pkg.license === "string"
        ? pkg.license
        : pkg.license?.type ?? (Array.isArray(pkg.licenses) ? "UNKNOWN" : "UNKNOWN");
      seen.set(pkg.name ?? e.name, { license: l, dir: p });
    } catch { /* not a package */ }
    walk(join(p, "node_modules"), depth + 1);
  }
})(root, 0);

/** "(A OR B)" is fine if either side is. "(A AND B)" needs both. */
const ok = (l) => {
  if (COMPATIBLE.has(l)) return true;
  const or = /^\((.+)\)$/.exec(l)?.[1]?.split(/\s+OR\s+/);
  if (or) return or.some((x) => COMPATIBLE.has(x.trim()));
  return false;
};

const blocked = [], unknown = [];
for (const [name, v] of seen) {
  if (v.license === "UNKNOWN") unknown.push([name, v]);
  else if (!ok(v.license)) blocked.push([name, v.license]);
}

const counts = {};
for (const v of seen.values()) counts[v.license] = (counts[v.license] ?? 0) + 1;
console.log(`${seen.size} packages\n`);
for (const [l, n] of Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 12)) {
  console.log(`  ${String(n).padStart(5)}  ${l}`);
}

if (unknown.length) {
  console.log(`\n${unknown.length} declare no SPDX licence — READ EACH ONE:`);
  for (const [name, v] of unknown) {
    const f = ["LICENSE", "LICENSE.md", "LICENCE", "license"]
      .map((x) => join(v.dir, x)).find((x) => existsSync(x));
    const first = f ? readFileSync(f, "utf8").split("\n").find((l) => l.trim()) : null;
    console.log(`  ${name}: ${first?.slice(0, 64) ?? "(no licence file)"}`);
  }
}

console.log(
  blocked.length
    ? `\nBLOCKED — not GPL-3.0 compatible:\n${blocked.map(([n, l]) => `  ${n} (${l})`).join("\n")}`
    : "\nnothing blocks a move to GPL-3.0."
);
process.exit(blocked.length ? 1 : 0);
