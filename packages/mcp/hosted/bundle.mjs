#!/usr/bin/env node
/**
 * Bundles src/http.ts into one ESM file for Lambda, at hosted/dist/index.mjs.
 *
 * The workspace packages (@dlab5/*) and every runtime dependency are inlined,
 * because a Lambda has no workspace to resolve them from. The AWS SDK is left
 * out: the nodejs22.x runtime ships v3. aws-amplify never enters, since the
 * hosted path does not import backend.ts.
 */
import { build } from "esbuild";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

const result = await build({
  entryPoints: [resolve(here, "../src/http.ts")],
  outfile: resolve(here, "dist/index.mjs"),
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  minify: false,
  sourcemap: false,
  metafile: true,
  external: ["@aws-sdk/*"],
  // Some dependencies are CommonJS and call require(); an ESM bundle has none.
  banner: {
    js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  },
  logLevel: "warning",
});

const bytes = Object.values(result.metafile.outputs)[0].bytes;
const amplify = Object.keys(result.metafile.inputs).some((p) => p.includes("aws-amplify"));
console.log(`hosted/dist/index.mjs: ${(bytes / 1024).toFixed(0)} kB${amplify ? " — WARNING: aws-amplify got in" : ""}`);
