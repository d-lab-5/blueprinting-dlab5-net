#!/usr/bin/env node
/**
 * Compiles and renders the generated D2 with the real d2 compiler.
 *
 * Separate from the test suite because the D2 WASM wrapper spawns a worker
 * that keeps the event loop alive, so `node --test` never exits with it
 * loaded. The verification is the same one the Gantt gets from mermaid.parse:
 * asserting on a string we just built proves only that the generator does what
 * it does.
 *
 * Usage:  node scripts/verify-views.mjs
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { D2 } from "@terrastruct/d2";
import { emptyModel, parseAbox, toD2 } from "@dlab5/blueprint-core";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

let failures = 0;
const check = (ok, label, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

const d2 = new D2();

async function compilesAndRenders(src, label) {
  try {
    const result = await d2.compile(src);
    const svg = await d2.render(result.diagram, result.renderOptions);
    check(svg.length > 0, label, `${svg.length} bytes of SVG`);
    return svg;
  } catch (err) {
    check(false, label, String(err.message ?? err).split("\n")[0]);
    return null;
  }
}

console.log("D2 views, through the real compiler\n");

const patterns = parseAbox(
  readFileSync(resolve(ROOT, "docs/patterns/engineering-patterns.ttl"), "utf8"),
  "patterns"
);

const svg = await compilesAndRenders(
  toD2(patterns, { title: "Engineering patterns" }),
  "the pattern library, grouped by domain"
);
if (svg) {
  // The layer pastel has to survive into the SVG, or the diagram is generic
  // boxes and the ArchiMate convention is lost.
  check(/#ccccff/i.test(svg), "the motivation pastel reaches the rendered SVG");
  check(/Ontology-to-code generator/.test(svg), "element labels are rendered");
}

await compilesAndRenders(
  toD2(patterns, { groupByDomain: false }),
  "the same model, flat"
);

await compilesAndRenders(
  toD2(patterns, { domains: ["motivation"] }),
  "a single-domain view"
);

await compilesAndRenders(toD2(emptyModel("x")), "an empty model");

await compilesAndRenders(
  toD2({
    projectSlug: "x",
    elements: [
      { id: "a", type: "ApplicationComponent", name: 'The "billing" service: v2 {beta}', properties: {} },
      { id: "b", type: "Node", name: "host-01.example.com", properties: {} },
    ],
    relationships: [
      { id: "r", type: "serving", source: "b", target: "a", name: "hosts; runs", properties: {} },
    ],
  }),
  "names containing d2's own delimiters"
);

console.log(`\n${failures === 0 ? "all checks passed" : `${failures} FAILED`}`);
// The d2 worker does not exit on its own.
process.exit(failures === 0 ? 0 : 1);
