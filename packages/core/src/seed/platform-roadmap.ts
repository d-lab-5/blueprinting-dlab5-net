import type { AbModel } from "../types.js";

/**
 * The plan for building this platform, as an ArchiMate 3.2 Layer 7 model.
 *
 * This is the point of starting at Implementation & Migration: the first
 * blueprint the platform holds is its own. It is documentation, seed data and
 * test fixture at once, and it is reviewed in pull requests like any code.
 *
 * Keep it honest. Dates are what actually happened, not what was planned, and
 * a work package is only `status: done` once its verification passed. Where
 * reality diverged from the plan, the model records reality — that is the
 * whole argument for keeping the roadmap in the tool rather than in a
 * document nobody updates.
 *
 * Every relationship here is legal under Appendix B, which the metamodel
 * enforces: a work package REALIZES a deliverable, a deliverable REALIZES the
 * plateau it brings about, and work packages are sequenced by TRIGGERING.
 * Note the direction on the second one — a plateau does not compose its
 * deliverables, which is a plausible-sounding relationship ArchiMate does not
 * permit.
 */
export const PLATFORM_ROADMAP: AbModel = {
  projectSlug: "blueprinting",
  elements: [
    /* -- plateaus: the stable states ------------------------------------- */
    {
      id: "p0",
      type: "Plateau",
      name: "P0 Empty Repo",
      documentation:
        "Two commits, a README and a LICENCE. No app, no backend, no model.",
      properties: { startDate: "2026-08-23", endDate: "2026-08-23", status: "done" },
    },
    {
      id: "p1",
      type: "Plateau",
      name: "P1 Authenticated Shell",
      documentation:
        "A deployed Gatsby app behind Cognito on an Amplify Gen 2 backend. " +
        "Nothing to model yet, but somewhere to put it.",
      properties: { startDate: "2026-08-23", endDate: "2026-08-24", status: "done" },
    },
    {
      id: "p2",
      type: "Plateau",
      name: "P2 Semantic Backbone",
      documentation:
        "The ArchiMate metamodel, the ABox store and the project entity. " +
        "The platform can hold a model and enforce what ArchiMate permits.",
      properties: { startDate: "2026-08-24", endDate: "2026-08-24", status: "done" },
    },
    {
      id: "p3",
      type: "Plateau",
      name: "P3 Blueprinting Platform",
      documentation:
        "Views generated from the model across layers, an editor, exchange " +
        "with Archi, and the model exposed to agents over MCP.",
      properties: { startDate: "2026-08-24", status: "planned" },
    },

    /* -- gaps: what has to change between states -------------------------- */
    {
      id: "gap-auth",
      type: "Gap",
      name: "No deployable app, no authentication",
      properties: { status: "closed" },
    },
    {
      id: "gap-vocab",
      type: "Gap",
      name: "ArchiMate rules exist only in a PDF",
      documentation:
        "Nothing in the codebase knew which relationships the specification " +
        "permits, so nothing could check a model.",
      properties: { status: "closed" },
    },
    {
      id: "gap-store",
      type: "Gap",
      name: "Nowhere to store a model, and no safe concurrent write",
      properties: { status: "closed" },
    },
    {
      id: "gap-views",
      type: "Gap",
      name: "A model that cannot be seen",
      documentation:
        "The graph is stored and validated but renders as a list. Roadmaps, " +
        "flows and infrastructure diagrams are all still missing.",
      properties: { status: "open" },
    },

    /* -- work packages ----------------------------------------------------- */
    {
      id: "wp1",
      type: "WorkPackage",
      name: "WP1 Foundation",
      documentation:
        "Workspace, Amplify Gen 2 backend, one AuthGate over every route, " +
        "ArchiMate layer tokens.",
      properties: { startDate: "2026-08-23", endDate: "2026-08-24", status: "done" },
    },
    {
      id: "wp2",
      type: "WorkPackage",
      name: "WP2 Metamodel from ontology",
      documentation:
        "60 element types, 11 relationships and 3720 Appendix B matrix cells, " +
        "generated from a pinned Apache-2.0 ontology and committed.",
      properties: { startDate: "2026-08-24", endDate: "2026-08-24", status: "done" },
    },
    {
      id: "wp3",
      type: "WorkPackage",
      name: "WP3 Turtle ABox store",
      documentation:
        "Turtle I/O, the storage-proxy Lambda, ETag-guarded writes, and the " +
        "project list and model view.",
      properties: { startDate: "2026-08-24", endDate: "2026-08-24", status: "done" },
    },
    {
      id: "wp4",
      type: "WorkPackage",
      name: "WP4 Layer 7 roadmap view",
      documentation:
        "A Mermaid Gantt generated from this very model, plus forms to edit it.",
      properties: { startDate: "2026-08-24", status: "in-progress" },
    },
    {
      id: "wp5",
      type: "WorkPackage",
      name: "WP5 Open Exchange XML",
      documentation: "Round-tripping into Archi.",
      properties: { status: "planned" },
    },
    {
      id: "wp6",
      type: "WorkPackage",
      name: "WP6 Blockly ABox editor",
      documentation:
        "Blocks generated from the metamodel; relationships as typed variable " +
        "references, so an illegal one cannot be expressed.",
      properties: { status: "planned" },
    },
    {
      id: "wp7",
      type: "WorkPackage",
      name: "WP7 D2 and sequence views",
      documentation: "Layers 4-6 in D2, Layer 3 as Mermaid sequence diagrams.",
      properties: { status: "planned" },
    },
    {
      id: "wp8",
      type: "WorkPackage",
      name: "WP8 MCP server",
      documentation: "The model exposed to LLM agents, stdio first.",
      properties: { status: "planned" },
    },
    {
      id: "wp9",
      type: "WorkPackage",
      name: "WP9 Tech Radar",
      documentation:
        "d-lab-5/gatsby-techradar, with entries linked to element types.",
      properties: { status: "planned" },
    },
    {
      id: "wp10",
      type: "WorkPackage",
      name: "WP10 Body of knowledge and plugins",
      properties: { status: "planned" },
    },

    /* -- deliverables ------------------------------------------------------ */
    {
      id: "d-shell",
      type: "Deliverable",
      name: "Deployed authenticated shell",
      properties: { status: "done" },
    },
    {
      id: "d-metamodel",
      type: "Deliverable",
      name: "@dlab5/archimate-metamodel",
      properties: { status: "done" },
    },
    {
      id: "d-core",
      type: "Deliverable",
      name: "@dlab5/blueprint-core",
      documentation: "ABox model, Turtle I/O and metamodel validation.",
      properties: { status: "done" },
    },
    {
      id: "d-store",
      type: "Deliverable",
      name: "Model store with ETag-guarded writes",
      properties: { status: "done" },
    },
    {
      id: "d-gantt",
      type: "Deliverable",
      name: "Layer 7 Gantt view",
      properties: { status: "planned" },
    },

    /* -- events ------------------------------------------------------------ */
    {
      id: "e-stage-green",
      type: "ImplementationEvent",
      name: "stage builds green",
      documentation:
        "Build 5. Took four attempts: an npm ci that rejected its own " +
        "lockfile, a missing IAM service role, and a cd that leaked across " +
        "build phases.",
      properties: { startDate: "2026-08-23", status: "done" },
    },
    {
      id: "e-first-model",
      type: "ImplementationEvent",
      name: "first model stored",
      properties: { startDate: "2026-08-24", status: "done" },
    },
  ],

  relationships: [
    /* Work packages produce deliverables. */
    { id: "r-wp1-shell", type: "realization", source: "wp1", target: "d-shell", properties: {} },
    { id: "r-wp2-mm", type: "realization", source: "wp2", target: "d-metamodel", properties: {} },
    { id: "r-wp3-core", type: "realization", source: "wp3", target: "d-core", properties: {} },
    { id: "r-wp3-store", type: "realization", source: "wp3", target: "d-store", properties: {} },
    { id: "r-wp4-gantt", type: "realization", source: "wp4", target: "d-gantt", properties: {} },

    /* Deliverables bring about plateaus. Note the direction: ArchiMate has
       the deliverable realising the state, not the state composing it. */
    { id: "r-shell-p1", type: "realization", source: "d-shell", target: "p1", properties: {} },
    { id: "r-mm-p2", type: "realization", source: "d-metamodel", target: "p2", properties: {} },
    { id: "r-core-p2", type: "realization", source: "d-core", target: "p2", properties: {} },
    { id: "r-store-p2", type: "realization", source: "d-store", target: "p2", properties: {} },
    { id: "r-gantt-p3", type: "realization", source: "d-gantt", target: "p3", properties: {} },

    /* Sequencing. This is what a Gantt's "after" dependencies come from. */
    { id: "r-wp1-wp2", type: "triggering", source: "wp1", target: "wp2", properties: {} },
    { id: "r-wp2-wp3", type: "triggering", source: "wp2", target: "wp3", properties: {} },
    { id: "r-wp3-wp4", type: "triggering", source: "wp3", target: "wp4", properties: {} },
    { id: "r-wp4-wp5", type: "triggering", source: "wp4", target: "wp5", properties: {} },
    { id: "r-wp4-wp6", type: "triggering", source: "wp4", target: "wp6", properties: {} },
    { id: "r-wp6-wp7", type: "triggering", source: "wp6", target: "wp7", properties: {} },
    { id: "r-wp3-wp8", type: "triggering", source: "wp3", target: "wp8", properties: {} },
    { id: "r-wp8-wp9", type: "triggering", source: "wp8", target: "wp9", properties: {} },
    { id: "r-wp9-wp10", type: "triggering", source: "wp9", target: "wp10", properties: {} },

    /* Milestones. */
    { id: "r-wp1-green", type: "triggering", source: "wp1", target: "e-stage-green", properties: {} },
    { id: "r-wp3-first", type: "triggering", source: "wp3", target: "e-first-model", properties: {} },

    /* Gaps sit between the states they describe. */
    { id: "r-p0-gapauth", type: "association", source: "p0", target: "gap-auth", properties: {} },
    { id: "r-p1-gapvocab", type: "association", source: "p1", target: "gap-vocab", properties: {} },
    { id: "r-p1-gapstore", type: "association", source: "p1", target: "gap-store", properties: {} },
    { id: "r-p2-gapviews", type: "association", source: "p2", target: "gap-views", properties: {} },
  ],
};
