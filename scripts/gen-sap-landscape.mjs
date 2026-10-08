#!/usr/bin/env node
/**
 * Generates docs/knowledge/sap-landscape.ttl.
 *
 * Written from the SAP skills at sap-ai-skills.com, which are GPL-3.0 while
 * this repository is MIT and public. None of their text is here. What is here
 * is which SAP products exist and how they group — fact, not expression — with
 * each element citing the skill it was learned from.
 *
 * Generated rather than hand-written so the Turtle matches byte for byte what
 * the application writes, which is what makes a seed diffable against an
 * exported model.
 *
 * Usage:  node scripts/gen-sap-landscape.mjs
 */
import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { serializeAbox } from "@dlab5/blueprint-core";
import { isAllowed, isElementType } from "@dlab5/archimate-metamodel";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = resolve(ROOT, "docs/knowledge/sap-landscape.ttl");

const CATALOGUE = "https://sap-ai-skills.com";

/**
 * The landscape.
 *
 * `[id, type, name, documentation, skill]`. The documentation is a plain
 * statement of what the product is — written here, not taken from anywhere —
 * and `skill` names where its existence was learned, which becomes the
 * element's `reference` property.
 */
const GROUPS = [
  ["sap-abap", "ABAP", "The ABAP application server and the languages that run on it."],
  ["sap-btp", "SAP BTP", "Business Technology Platform: the cloud services SAP applications are extended and integrated with."],
  ["sap-data", "Data and analytics", "Where SAP data is stored, modelled and reported on."],
  ["sap-ui", "User interface", "The runtimes and toolchains SAP user interfaces are built with."],
  ["sap-ai", "AI", "Model training, inference and the SDKs that reach them."],
  ["sap-tooling", "Developer tooling", "Command-line tools, linters and IDEs used to build the above."],
];

const ELEMENTS = [
  // ABAP
  ["abap-platform", "SystemSoftware", "ABAP Platform", "The ABAP application server: the runtime SAP business applications have been written for since R/3, now also available as a cloud environment.", "sap-abap", "sap-abap"],
  ["abap-cds", "SystemSoftware", "ABAP Core Data Services", "The data-modelling layer inside the ABAP platform. Views defined once and consumed by OData, Fiori Elements and RAP.", "sap-abap-cds", "sap-abap"],
  ["hana-sqlscript", "SystemSoftware", "SAP HANA SQLScript", "The procedural SQL dialect used for calculation logic pushed down into HANA.", "sap-sqlscript", "sap-abap"],

  // BTP — services you consume
  ["btp", "SystemSoftware", "SAP Business Technology Platform", "The platform the services below are subscribed to and run on.", "sap-btp-cloud-platform", "sap-btp"],
  ["btp-connectivity", "TechnologyService", "BTP Connectivity", "Reaches systems inside a corporate network from an application running outside it.", "sap-btp-connectivity", "sap-btp"],
  ["btp-destination", "TechnologyService", "BTP Destination", "Named, credentialed endpoints, so an application does not hold connection details of its own.", "sap-btp-connectivity", "sap-btp"],
  ["btp-identity", "TechnologyService", "SAP Cloud Identity Services", "Authentication, identity provisioning and directory federation for BTP applications.", "sap-btp-cloud-identity-services", "sap-btp"],
  ["btp-logging", "TechnologyService", "SAP Cloud Logging", "Log and metric collection for applications running on BTP.", "sap-btp-cloud-logging", "sap-btp"],
  ["btp-transport", "TechnologyService", "Cloud Transport Management", "Moves deployable artifacts between BTP landscapes under a change process.", "sap-btp-cloud-transport-management", "sap-btp"],
  ["btp-job-scheduling", "TechnologyService", "BTP Job Scheduling", "Runs jobs on a schedule without an application holding a timer of its own.", "sap-btp-job-scheduling", "sap-btp"],
  ["btp-integration-suite", "TechnologyService", "SAP Integration Suite", "Integration flows, API management and event mesh between SAP and everything else.", "sap-btp-integration-suite", "sap-btp"],
  ["btp-mdi", "TechnologyService", "Master Data Integration", "Distributes master data between SAP applications from one place.", "sap-btp-master-data-integration", "sap-btp"],
  ["btp-service-manager", "TechnologyService", "BTP Service Manager", "Provisions and binds the services above to applications.", "sap-btp-service-manager", "sap-btp"],
  ["btp-cias", "TechnologyService", "Cloud Integration Automation Service", "Guided workflows for setting up integration between SAP systems.", "sap-btp-cias", "sap-btp"],
  ["btp-work-zone", "TechnologyService", "SAP Build Work Zone", "The entry point users reach applications through.", "sap-btp-build-work-zone-advanced", "sap-btp"],
  ["btp-isa", "TechnologyService", "Intelligent Situation Automation", "Situation handling automation. Its skill is marked archived and describes maintaining existing tenants rather than adopting it.", "sap-btp-intelligent-situation-automation", "sap-btp"],

  // Data and analytics
  ["hana-cloud", "SystemSoftware", "SAP HANA Cloud", "The in-memory database SAP applications and analytics run on.", "sap-hana-cli", "sap-data"],
  ["datasphere", "SystemSoftware", "SAP Datasphere", "Data warehousing and federation across SAP and non-SAP sources.", "sap-datasphere", "sap-data"],
  ["hana-di", "SystemSoftware", "HANA Cloud Data Intelligence", "Pipelines and orchestration over data held in HANA Cloud.", "sap-hana-cloud-data-intelligence", "sap-data"],
  ["hana-ml", "SystemSoftware", "HANA Machine Learning", "Model training and inference executed inside the database, next to the data.", "sap-hana-ml", "sap-data"],
  ["bw", "SystemSoftware", "SAP BW", "The classic data warehouse, queried by its own query definitions.", "sap-bw-query", "sap-data"],
  ["sac", "SystemSoftware", "SAP Analytics Cloud", "Planning, reporting and dashboards over SAP data.", "sap-sac-planning", "sap-data"],

  // User interface
  ["sapui5", "SystemSoftware", "SAPUI5", "The JavaScript runtime SAP Fiori applications are built on.", "sap-sapui5", "sap-ui"],
  ["fiori-elements", "ApplicationComponent", "SAP Fiori Elements", "Applications generated from annotations rather than written screen by screen.", "sap-fiori-tools", "sap-ui"],
  ["cap", "ApplicationComponent", "SAP Cloud Application Programming Model", "The Node.js and Java framework for building services on BTP.", "sap-cap-capire", "sap-ui"],
  ["sac-widget", "ApplicationComponent", "SAC Custom Widget", "Extension point for visualisations SAP Analytics Cloud does not provide.", "sap-sac-custom-widget", "sap-ui"],

  // AI
  ["ai-core", "TechnologyService", "SAP AI Core", "Runs training and inference workloads for SAP applications.", "sap-ai-core", "sap-ai"],
  ["cloud-sdk-ai", "ApplicationComponent", "SAP Cloud SDK for AI", "The client libraries applications reach AI Core and generative models through.", "sap-cloud-sdk-ai", "sap-ai"],
  ["rpt1", "SystemSoftware", "SAP-RPT-1-OSS", "An open-source tabular prediction model, used for classification and regression over SAP business data.", "sap-rpt1", "sap-ai"],

  // Developer tooling
  ["bas", "ApplicationComponent", "Business Application Studio", "The hosted development environment for BTP applications.", "sap-btp-business-application-studio", "sap-tooling"],
  ["hana-cli", "ApplicationComponent", "HANA CLI", "Command-line access to HANA Cloud for development and deployment.", "sap-hana-cli", "sap-tooling"],
  ["ui5-cli", "ApplicationComponent", "UI5 CLI", "Builds and serves SAPUI5 applications.", "sap-sapui5-cli", "sap-tooling"],
  ["ui5-linter", "ApplicationComponent", "UI5 Linter", "Checks SAPUI5 code against the rules for current and future UI5 versions.", "sap-sapui5-linter", "sap-tooling"],
];

/** `[whole, part]`, where the part genuinely ships inside the whole. */
const PART_OF = [
  ["abap-platform", "abap-cds"],
  ["hana-cloud", "hana-sqlscript"],
  ["hana-cloud", "hana-ml"],
];

const elements = [];
const relationships = [];

for (const [id, name, documentation] of GROUPS) {
  elements.push({
    id,
    type: "Grouping",
    name,
    documentation,
    properties: {},
  });
}

for (const [id, type, name, documentation, skill, group] of ELEMENTS) {
  if (!isElementType(type)) throw new Error(`${type} is not an element type`);
  elements.push({
    id,
    type,
    name,
    documentation,
    properties: {
      // Where this product's existence was learned. The skill's text is not
      // here and is not quoted anywhere; this is the citation, as
      // engineering-practices.ttl does for a licensed book.
      reference: `${skill} — SAP skills catalogue, ${CATALOGUE}`,
    },
  });
  relationships.push({
    id: `${group}-aggregation-${id}`,
    type: "aggregation",
    source: group,
    target: id,
    properties: {},
  });
}

const typeOf = new Map(elements.map((e) => [e.id, e.type]));
for (const [whole, part] of PART_OF) {
  const [a, b] = [typeOf.get(whole), typeOf.get(part)];
  if (!isAllowed(a, "composition", b)) {
    throw new Error(`composition ${a} -> ${b} is not permitted`);
  }
  relationships.push({
    id: `${whole}-composition-${part}`,
    type: "composition",
    source: whole,
    target: part,
    properties: {},
  });
}

const ttl = await serializeAbox({
  projectSlug: "sap-landscape",
  languageVersion: "3.2",
  elements,
  relationships,
});

writeFileSync(OUT, ttl);
console.log(`wrote ${OUT}`);
console.log(
  `  ${elements.length} elements (${GROUPS.length} groupings), ` +
    `${relationships.length} relationships`
);
console.log("  no radar rings: a ring is a decision, not a fact about a product");
