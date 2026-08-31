import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { promisify } from "node:util";

import type { AbModel } from "@dlab5/blueprint-core";

/**
 * The SAP draw.io toolchain, wrapped.
 *
 * The scripts are `marianfoo/btp-drawio-skill`, fetched at a pinned commit by
 * `scripts/setup-sap-diagrams.sh` into a gitignored `vendor/`. They are MIT,
 * their bundled SAP assets are Apache-2.0, and neither is modified here — see
 * `vendor/NOTICE`.
 *
 * **These scaffold, check and score. They do not finish a diagram.** The
 * upstream is explicit that producing an SAP-Architecture-Center-quality result
 * needs manual editing for about two thirds of scenarios, and step four of its
 * own workflow is ten to twenty minutes in draw.io desktop. Every tool
 * description says so, because a tool that implied otherwise would send an
 * agent round a loop chasing a gate it cannot reach alone.
 */

const run = promisify(execFile);

const SUBPATH = "plugins/sap-architecture/skills/sap-architecture";

/** Where the vendored scripts are, or null if the setup has not been run. */
export function scriptsDir(repoRoot: string): string | null {
  const fromEnv = process.env.BP_SAP_DIAGRAM_SCRIPTS;
  const candidate = fromEnv
    ? resolve(fromEnv)
    : resolve(repoRoot, "vendor/btp-drawio-skill", SUBPATH, "scripts");
  return existsSync(resolve(candidate, "scaffold_diagram.py")) ? candidate : null;
}

export class NotInstalledError extends Error {
  constructor() {
    super(
      "the SAP diagram toolchain is not installed. Run " +
        "scripts/setup-sap-diagrams.sh, or set BP_SAP_DIAGRAM_SCRIPTS to its " +
        "scripts directory."
    );
  }
}

async function python(
  dir: string,
  script: string,
  args: string[]
): Promise<string> {
  try {
    const { stdout, stderr } = await run(
      "python3",
      [resolve(dir, script), ...args],
      { maxBuffer: 16 * 1024 * 1024 }
    );
    // These scripts report findings on stdout and progress on stderr, so
    // stderr is kept only when there is nothing else to show.
    return stdout.trim() || stderr.trim();
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message?: string };
    // A non-zero exit is how validate.py and score_corpus.py report a FAILING
    // diagram, which is a result rather than a fault. Its output is what the
    // caller needs, so it is returned rather than thrown away with the error.
    const output = `${e.stdout ?? ""}${e.stderr ?? ""}`.trim();
    if (output) return output;
    throw new Error(e.message ?? String(err));
  }
}

/**
 * A required path argument, or a refusal.
 *
 * `String(undefined)` is `"undefined"`, which is a perfectly good filename —
 * so a missing argument silently wrote a 387 kB diagram to a file called
 * `undefined` rather than failing. Found by accident, because the file turned
 * up staged for commit.
 */
export function requirePath(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${name} is required and must be a path`);
  }
  return value;
}

export const scaffold = (dir: string, args: string[]) =>
  python(dir, "scaffold_diagram.py", args);
export const autofix = (dir: string, file: string) =>
  python(dir, "autofix.py", ["--write", file]);
export const validate = (dir: string, file: string) =>
  python(dir, "validate.py", [file]);
export const score = (dir: string, file: string, min: number) =>
  python(dir, "score_corpus.py", ["--min-score", String(min), file]);

/**
 * Whether a scaffolded file is still, byte for byte, the template it came from.
 *
 * It always is, immediately after scaffolding — that is what scaffolding means.
 * It matters because `score_corpus.py` then reports 100/100 against that same
 * template, and 100 is the highest number there is. An agent reading only the
 * score would conclude the diagram was finished when in fact it contains an SAP
 * reference architecture and nothing of the user's at all.
 *
 * So the tools say it outright rather than leaving a perfect score to be
 * misread.
 */
export function isUneditedCopy(file: string, template: string): boolean {
  try {
    const digest = (p: string) =>
      createHash("sha256").update(readFileSync(p)).digest("hex");
    return digest(file) === digest(template);
  } catch {
    return false;
  }
}

/**
 * A scaffolder request, written from the model rather than from prose.
 *
 * This is the part worth having. The scaffolder ranks its 71 SAP reference
 * templates by token overlap against a description, so the description decides
 * everything — and a description typed from memory is where a model usually
 * loses something. We already hold the components, the technology services and
 * the relationships, so the description can be generated from what is actually
 * there.
 *
 * Deliberately a description and not a diagram: the upstream picks and adapts a
 * reference template, and a template chosen well is worth more than a layout
 * generated badly. We give it a better question, not a different answer.
 */
export function describeForScaffold(
  model: AbModel,
  options: { limit?: number } = {}
): string {
  const limit = options.limit ?? 24;

  // The types a solution diagram is drawn from. Motivation and implementation
  // elements say why and when, not what is deployed, and putting them in the
  // description skews the template match towards the wrong references.
  const DRAWN = new Set([
    "ApplicationComponent",
    "ApplicationService",
    "SystemSoftware",
    "TechnologyService",
    "Node",
    "Device",
    "DataObject",
    "Artifact",
    "BusinessProcess",
  ]);

  const drawn = model.elements.filter((e) => DRAWN.has(e.type));
  if (drawn.length === 0) {
    throw new Error(
      "this model has nothing a solution diagram is drawn from — no " +
        "components, technology services or nodes. A roadmap or a motivation " +
        "model is not what this scaffolder ranks templates against."
    );
  }

  // Most-connected first: the things with the most relationships are the ones
  // a reader is looking for, and the template match is driven by names.
  const degree = new Map<string, number>();
  for (const r of model.relationships) {
    degree.set(r.source, (degree.get(r.source) ?? 0) + 1);
    degree.set(r.target, (degree.get(r.target) ?? 0) + 1);
  }
  const ranked = [...drawn].sort(
    (a, b) => (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0)
  );
  const chosen = ranked.slice(0, limit);
  const names = new Map(chosen.map((e) => [e.id, e.name]));

  const parts = [`${model.projectSlug}: ${chosen.map((e) => e.name).join(", ")}.`];

  // A few real connections, so the ranking sees structure and not only nouns.
  const links = model.relationships
    .filter((r) => names.has(r.source) && names.has(r.target))
    .slice(0, 12)
    .map((r) => `${names.get(r.source)} ${r.type} ${names.get(r.target)}`);
  if (links.length) parts.push(`Connections: ${links.join("; ")}.`);

  return parts.join(" ");
}
