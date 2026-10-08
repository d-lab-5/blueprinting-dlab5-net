#!/usr/bin/env node
/**
 * Models the D-LAB-5 platform from the machine it is run on.
 *
 * The platform is the DevOps pipeline: a workstation, the tools on it, the
 * path a change takes from an editor to a deployed site, and the AWS services
 * it lands on. `blueprinting.dlab5.net` is one PRODUCT that travels that path —
 * which is the relationship this model exists to record, and the reason the
 * platform is not simply part of the blueprinting model.
 *
 * Read from the live environment rather than written down, so it is a
 * description of what is actually here rather than of what someone remembered.
 * Versions drift; `~/pc-configurations` already had node 22.22.2 recorded while
 * 22.23.2 was installed.
 *
 * **The output is not committed.** It names a workstation, an operator and an
 * AWS region, and CLAUDE.md forbids real names, emails and hostnames in seed
 * models in this public repository. The generator is committed; what it
 * produces goes to S3 behind the product's Cognito group, the same way the SAP
 * ECC estate does.
 *
 * Usage:
 *   node scripts/gen-platform-model.mjs [--out <file>] [--anonymous]
 *
 * `--anonymous` replaces the operator's identity with a role, for a model that
 * may be shown to somebody else.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { serializeAbox } from "@dlab5/blueprint-core";
import { isAllowed, isElementType } from "@dlab5/archimate-metamodel";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : undefined;
};
const anonymous = process.argv.includes("--anonymous");
const OUT = resolve(arg("--out") ?? join(ROOT, "platform-model.ttl"));

/** A command's first line, or null. Never throws — a missing tool is a fact. */
function ask(cmd, args) {
  try {
    return execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })
      .split("\n")[0]
      .trim();
  } catch {
    return null;
  }
}

/* -- what is actually on this machine --------------------------------------- */

const CONFIG = join(homedir(), "pc-configurations/devices/DLAB5-W541-01/config.yaml");
const config = existsSync(CONFIG) ? readFileSync(CONFIG, "utf8") : "";
/**
 * One scalar out of the YAML, optionally scoped to a section.
 *
 * Deliberately not a YAML parser — a handful of fields. But `version:` appears
 * under os:, nvidia:, webots:, nodejs: and the BIOS, and an unscoped match took
 * the BIOS one and produced "Ubuntu GNET75WW (2.23)". A key that appears more
 * than once needs saying WHERE.
 */
function fromConfig(key, fallback = null, section = null) {
  let text = config;
  if (section) {
    // A section runs until the next key at the SAME indentation or shallower.
    // A fixed lookahead does not work: `os:` sits at two spaces and `name:` at
    // four, so anything allowing four ends the block on its first child and
    // captures nothing.
    const opener = new RegExp(`^(\\s*)${section}:\\s*$`, "m").exec(config);
    if (!opener) return fallback;
    const indent = opener[1].length;
    const rest = config.slice(opener.index + opener[0].length);
    const lines = [];
    for (const line of rest.split("\n")) {
      if (line.trim() === "" || line.trimStart().startsWith("#")) continue;
      if (line.search(/\S/) <= indent) break;
      lines.push(line);
    }
    text = lines.join("\n");
  }
  return new RegExp(`^\\s*${key}:\\s*"?([^"\\n#]+)"?`, "m").exec(text)?.[1]?.trim() ?? fallback;
}

const env = {
  device: fromConfig("id", "workstation"),
  model: fromConfig("model", "unknown"),
  os: `${fromConfig("name", "Linux", "os")} ${fromConfig("version", "", "os")}`.trim(),
  kernel: ask("uname", ["-r"]),
  node: ask("node", ["--version"]),
  npm: ask("npm", ["--version"]),
  python: ask("python3", ["--version"])?.replace("Python ", ""),
  git: ask("git", ["--version"])?.replace("git version ", ""),
  aws: ask("aws", ["--version"])?.split(" ")[0]?.replace("aws-cli/", ""),
  gh: ask("gh", ["--version"])?.replace("gh version ", "").split(" ")[0],
  nvidia: fromConfig("driver", null, "nvidia"),
  ros: fromConfig("version", null, "ros"),
};

const remote =
  ask("git", ["-C", ROOT, "remote", "get-url", "origin"])?.replace(/\.git$/, "") ?? "";
const org = /github\.com[:/]([^/]+)/.exec(remote)?.[1] ?? "the organisation";

/* -- the model -------------------------------------------------------------- */

const elements = [];
const relationships = [];

const el = (id, type, name, documentation, properties = {}) => {
  if (!isElementType(type)) throw new Error(`${type} is not an ArchiMate element type`);
  elements.push({ id, type, name, documentation, properties });
  return id;
};

const rel = (source, type, target) => {
  const a = elements.find((e) => e.id === source);
  const b = elements.find((e) => e.id === target);
  if (!a || !b) throw new Error(`unknown endpoint: ${source} -> ${target}`);
  if (!isAllowed(a.type, type, b.type)) {
    throw new Error(`ArchiMate forbids ${a.type} -${type}-> ${b.type} (${source} -> ${target})`);
  }
  relationships.push({
    id: `${source}-${type}-${target}`,
    type,
    source,
    target,
    properties: {},
  });
};

/* Groupings — the same convention the radar uses for quadrants. */
const G_WORK = el("g-workstation", "Grouping", "Workstation",
  "The machine changes are made on, and what is installed to make them.");
const G_PIPE = el("g-pipeline", "Grouping", "DevOps pipeline",
  "The path a change takes from an editor to a running site. This is what makes D-LAB-5 a platform rather than a collection of repositories.");
const G_AWS = el("g-aws", "Grouping", "AWS eu-central-1",
  "Where the products run.");
const G_PEOPLE = el("g-people", "Grouping", "People",
  "Who operates the platform.");
const G_PRODUCTS = el("g-products", "Grouping", "Products",
  "What travels the pipeline. A product is not part of the platform; it is carried by it.");

/* The workstation. */
const DEVICE = el("workstation", "Device", `${env.device} (${env.model})`,
  `The development workstation. Kernel held at ${env.kernel} because the NVIDIA ${env.nvidia ?? "Kepler"} driver does not build on newer ones — a constraint the hardware imposes on the whole toolchain.`,
  { reference: "~/pc-configurations/devices/DLAB5-W541-01/config.yaml" });
rel(G_WORK, "aggregation", DEVICE);

const software = [
  ["os", env.os, "The operating system, held at a kernel series the GPU driver supports."],
  ["nodejs", `Node.js ${env.node}`, "Runs the build, the tests, the verification scripts and the MCP server."],
  ["python", `Python ${env.python}`, "Drives the MCP protocol check and the SAP diagram toolchain."],
  ["git", `Git ${env.git}`, "The first step of the pipeline, and the only one that is purely local."],
];
for (const [id, name, doc] of software) {
  if (!name || name.includes("undefined")) continue;
  const s = el(`sw-${id}`, "SystemSoftware", name, doc);
  rel(G_WORK, "aggregation", s);
  rel(DEVICE, "assignment", s);
}

/* Tools — application components, because they are things a person operates. */
const tools = [
  ["vscode", "VS Code", "Where the code is edited."],
  ["claude-code", "Claude Code", "An agent working in the repository, reaching the model through the MCP server this platform hosts."],
  ["gh", `GitHub CLI ${env.gh ?? ""}`.trim(), "Opens the promotion pull request."],
  ["aws-cli", `AWS CLI ${env.aws ?? ""}`.trim(), "Reads deployment state and cleans up what verification leaves behind."],
];
for (const [id, name, doc] of tools) {
  const t = el(`tool-${id}`, "ApplicationComponent", name, doc);
  rel(G_WORK, "aggregation", t);
}

/* The pipeline. Every stage is a TechnologyProcess: each acts on technology,
   and modelling the human ones as BusinessProcess would need a triggering
   relationship ArchiMate marks derived, for no gain in truth. */
const stages = [
  ["commit", "Commit", "Local, and cheap on purpose. The gate is at push."],
  ["gate", "Run the push gate", "Checks chosen by what changed: tests, typecheck, a clean build for a stylesheet, the live verifications, the secret sweep. See the dlab5-git-push skill."],
  ["push", "Push to stage", `To ${remote || "the origin"}, in the ${org} organisation.`],
  ["build", "Amplify build", "Installs, builds the frontend, and deploys the Amplify Gen 2 backend. A CloudFormation cycle or a redeclared GraphQL name fails here after a green local run."],
  ["deploy", "Deploy", "The frontend to Amplify Hosting, the backend to CloudFormation."],
  ["verify", "Verify against the deployment", "The live checks run against what was deployed, not against localhost — which is where holding six commits back was caught."],
  ["promote", "Promote to main", "A pull request. main has no Amplify branch, so merging deploys nothing; it is where review happens."],
];
let previous = null;
for (const [id, name, doc] of stages) {
  const p = el(`stage-${id}`, "TechnologyProcess", name, doc);
  rel(G_PIPE, "aggregation", p);
  if (previous) rel(previous, "triggering", p);
  previous = p;
}

/* AWS. */
const services = [
  ["github", "GitHub", `Origin and review. Push protection blocks a secret before it is published — it has.`],
  ["amplify-hosting", "AWS Amplify Hosting", "Builds on push and serves the site. Client-only routes need a rewrite rule that lives in app configuration, not in the repository."],
  ["cognito", "Amazon Cognito", "Identity. Per-product groups are created by hand, which is why storage authorization goes through a Lambda."],
  ["appsync", "AWS AppSync", "The GraphQL API. It does not populate event.info.fieldName for Lambda-backed mutations, which has cost two deploys."],
  ["dynamodb", "Amazon DynamoDB", "Product, Document and API key rows. A primary key cannot be updated, which is why re-identifying a product is an export and a reload."],
  ["s3", "Amazon S3", "The ArchiMate models themselves, and the documents held beside them."],
  ["lambda", "AWS Lambda", "Every authorization decision that a static rule cannot express."],
];
for (const [id, name, doc] of services) {
  const s = el(`svc-${id}`, "TechnologyService", name, doc);
  rel(G_AWS, "aggregation", s);
}
rel("svc-github", "serving", "stage-push");
rel("svc-amplify-hosting", "serving", "stage-build");
rel("svc-amplify-hosting", "serving", "stage-deploy");
rel("svc-github", "serving", "stage-promote");

/* People. */
const actorName = anonymous ? "Platform operator" : (ask("git", ["config", "user.name"]) || "Platform operator");
const ACTOR = el("operator", "BusinessActor", actorName,
  anonymous ? "The person who operates the platform." : "The person who operates this workstation and this platform.");
const ROLE = el("role-admin", "BusinessRole", "Platform administrator",
  "Holds bp-admins: creates products and their Cognito groups, and is the only role that can write a product row.");
rel(G_PEOPLE, "aggregation", ACTOR);
rel(G_PEOPLE, "aggregation", ROLE);
rel(ACTOR, "assignment", ROLE);

/* The product, and the relationship this model exists to state. */
const PRODUCT = el("product-blueprinting", "Product", "blueprinting.dlab5.net",
  "Engineering governance and architecture planning over an ArchiMate 3.2 model. A product ON this platform: it is built, deployed and verified by the pipeline above, and the platform knows nothing about what it does.");
rel(G_PRODUCTS, "aggregation", PRODUCT);

const OFFERED = el("svc-blueprinting", "ApplicationService", "Blueprinting",
  "What the product offers its users: roadmaps, a technology radar, architecture views and document intake over one semantic model.");
rel(PRODUCT, "composition", OFFERED);

/* -- write ------------------------------------------------------------------ */

const ttl = await serializeAbox({
  projectSlug: arg("--slug") ?? "dlab5-platform",
  languageVersion: "3.2",
  elements,
  relationships,
});

writeFileSync(OUT, ttl);
console.log(`wrote ${OUT}`);
console.log(`  ${elements.length} elements, ${relationships.length} relationships`);
console.log(`  read from: ${env.device}, ${env.os}, kernel ${env.kernel}`);
if (!anonymous) {
  console.log(
    `  names "${actorName}" — pass --anonymous for a model to show someone else.`
  );
}
console.log("  NOT for committing: it names a workstation, a person and a region.");
