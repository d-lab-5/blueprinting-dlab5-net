import * as React from "react";
import type { HeadFC, PageProps } from "gatsby";
import { ELEMENTS, LAYER_LABELS, LAYER_ORDER } from "@dlab5/archimate-metamodel";
import type { LayerId } from "@dlab5/archimate-metamodel";
import {
  neighbourhood,
  toD2,
  toMermaidGitgraph,
  toMermaidGantt,
  toMermaidSequence,
} from "@dlab5/blueprint-core";
import type { AbModel } from "@dlab5/blueprint-core";
import { BlueprintCanvas } from "../components/BlueprintCanvas";
import { Domains } from "../components/Domains";
import { Organisations } from "../components/Organisations";
import { Shell } from "../components/Shell";
import { MermaidView } from "../components/MermaidView";
import { DiagramViewport } from "../components/DiagramViewport";
import { GanttLegend } from "../components/GanttLegend";
import { GanttImport } from "../components/GanttImport";
import { RoadmapEditor } from "../components/RoadmapEditor";
import { BlocklyEditor } from "../components/BlocklyEditor";
import { D2View } from "../components/D2View";
import { RadarChart } from "../components/RadarChart";
import { useModel } from "../hooks/useModel";
import { useProject } from "../hooks/useProject";
import { ProductSettings } from "../components/ProductSettings";
import { MarkdownImport } from "../components/MarkdownImport";
import { Documents } from "../components/Documents";
import { ExportTools } from "../components/ExportTools";
import { useSession } from "../components/AuthGate";

type Tab =
  | "roadmap"
  | "releases"
  | "views"
  | "radar"
  | "domains"
  | "blueprint"
  | "orgs"
  | "blocks"
  | "documents"
  | "import"
  | "export";

/**
 * URL section to tab. `model` is kept as an alias for `domains`: the screen
 * was renamed when the hexagon navigator replaced the flat per-layer stack,
 * and an existing link should not break over a rename.
 */
const SECTIONS: Record<string, Tab> = {
  "": "roadmap",
  roadmap: "roadmap",
  releases: "releases",
  views: "views",
  radar: "radar",
  domains: "domains",
  model: "domains",
  blueprint: "blueprint",
  orgs: "orgs",
  blocks: "blocks",
  documents: "documents",
  import: "import",
  export: "export",
};

/**
 * Client-only route for everything under /p/. gatsby-node.ts rewrites this
 * page's path to the matchPath /p/*, so the slug is only knowable at runtime:
 * there is no build-time list of projects, because the list depends on who is
 * asking. Amplify Hosting needs a matching 200 rewrite — see CLAUDE.md.
 */
const ProjectPage: React.FC<PageProps> = ({ location }) => {
  const path = location.pathname.replace(/^\/p\/?/, "").replace(/\/$/, "");
  const [slug, section] = path.split("/");
  const tab: Tab = SECTIONS[section ?? ""] ?? "roadmap";

  const {
    model,
    findings,
    loading,
    error,
    dirty,
    saveState,
    saveError,
    update,
    save,
    reload,
  } = useModel(slug ?? "");

  const { project, loading: projectLoading, setProject } = useProject(slug ?? "");
  const session = useSession();

  // What a reader is shown wherever the product is named — the page
  // title, the rail, and every diagram title. ADR-0009.
  const heading = project?.name ?? (projectLoading ? "…" : (slug ?? ""));

  if (!slug) {
    return (
      <Shell>
        <h1>No product selected</h1>
        <p>
          <a href="/">Back to products</a>
        </p>
      </Shell>
    );
  }

  return (
    <Shell project={{ slug, name: project?.name, active: tab }}>
      {/* The name, never the id. Under ADR-0009 the id in the URL is
          opaque, so titling the page with it would say nothing a reader can
          use. It is still the fallback when the row cannot be read, because a
          wrong-looking title beats no title at all. */}
      <h1>{heading}</h1>
      {project?.description && (
        <p className="bp-product__blurb">{project.description}</p>
      )}
      {project && session.isAdmin && (
        <ProductSettings project={project} onRenamed={setProject} />
      )}

      {error && (
        <p className="bp-error" role="alert">
          {error}
        </p>
      )}
      {loading && <p className="bp-muted">Loading model…</p>}

      {/* Outside the model gate on purpose. A product created this morning has
          no blueprint yet, and the report that will become one has to be able
          to land somewhere before there is anything to import it into. */}
      {tab === "documents" && <Documents slug={slug} />}
      {tab === "export" && <ExportTools slug={slug} name={heading} />}

      {model && (
        <>
          <SaveBar
            dirty={dirty}
            saveState={saveState}
            saveError={saveError}
            onSave={() => void save()}
            onReload={() => void reload()}
          />

          <Findings findings={findings} />

          {tab === "roadmap" && (
            <>
              <Roadmap model={model} slug={slug} title={heading} />
              <h2>Edit</h2>
              <RoadmapEditor model={model} onChange={update} />
            </>
          )}
          {tab === "import" && (
            <>
              <MarkdownImport model={model} onChange={update} />
              <GanttImport model={model} onChange={update} />
            </>
          )}

          {tab === "releases" && <Releases model={model} slug={slug} title={heading} />}
          {tab === "views" && <Views model={model} title={heading} />}
          {tab === "radar" && (
            <>
              <p className="bp-lede">
                Every entry is an element of this model, not a copy of one — so
                a component cannot sit at ADOPT here while the architecture
                says otherwise. Quadrants are Groupings; the ring is an
                ArchiMate Property.
              </p>
              <RadarChart model={model} />
            </>
          )}
          {tab === "domains" && <Domains model={model} />}
          {tab === "blueprint" && <BlueprintCanvas model={model} />}
          {tab === "orgs" && <Organisations model={model} />}
          {tab === "blocks" && <Blocks model={model} onChange={update} />}
        </>
      )}
    </Shell>
  );
};

/* -------------------------------------------------------------------------- */

function SaveBar({
  dirty,
  saveState,
  saveError,
  onSave,
  onReload,
}: {
  dirty: boolean;
  saveState: string;
  saveError: string | null;
  onSave: () => void;
  onReload: () => void;
}) {
  return (
    <div className="bp-savebar">
      <button
        type="button"
        className="bp-button"
        disabled={!dirty || saveState === "saving"}
        onClick={onSave}
      >
        {saveState === "saving" ? "Saving…" : "Save model"}
      </button>

      {dirty && saveState === "idle" && (
        <span className="bp-muted">Unsaved changes.</span>
      )}
      {saveState === "saved" && <span className="bp-ok">Saved.</span>}

      {saveState === "conflict" && (
        <span className="bp-error" role="alert">
          {saveError}{" "}
          <button type="button" className="bp-linkbutton" onClick={onReload}>
            Reload
          </button>
        </span>
      )}
      {saveState === "error" && (
        <span className="bp-error" role="alert">
          {saveError}
        </span>
      )}
    </div>
  );
}

function Findings({
  findings,
}: {
  findings: ReturnType<typeof useModel>["findings"];
}) {
  if (findings.length === 0) return null;
  const errors = findings.filter((f) => f.severity === "error");
  return (
    <details className="bp-findings" open={errors.length > 0}>
      <summary>
        Validation — {errors.length} error(s),{" "}
        {findings.length - errors.length} warning(s)
      </summary>
      <ul>
        {findings.map((f, i) => (
          <li key={i} className={`bp-finding bp-finding--${f.severity}`}>
            <span className="bp-finding__severity">{f.severity}</span>
            <span className="bp-finding__message">
              {f.message}
              {/* Where the rule comes from, when it is not simply the
                  specification. A reader who disagrees can go and read the
                  argument rather than take this tool's word for it. */}
              {f.source && (
                <span className="bp-finding__source">{f.source}</span>
              )}
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}

function Roadmap({
  model,
  slug,
  title,
}: {
  model: AbModel;
  /** Opaque id (ADR-0009) — for the DOM id only, never for a label. */
  slug: string;
  title: string;
}) {
  // Regenerated on every model change, so the Gantt is a view of the graph
  // rather than a stored artefact that can drift from it.
  const script = React.useMemo(
    () => toMermaidGantt(model, { title }),
    [model, title]
  );
  return (
    <>
      <DiagramViewport>
        <MermaidView script={script} id={`gantt-${slug}`} />
      </DiagramViewport>
      <GanttLegend model={model} />
    </>
  );
}

/**
 * The structural and behavioural views, both generated from the same graph.
 *
 * D2 for structure because its layout engine copes with the shape an
 * architecture actually has; a Mermaid flowchart of thirty cross-linked
 * components becomes spaghetti. Mermaid sequence for behaviour, because that
 * is what a sequence diagram is for.
 */
/**
 * The release train: plateaus as commits, work packages as branches.
 *
 * A second reading of the same Layer 7 model the Gantt draws. The Gantt
 * answers "when", this answers "in what order did the architecture actually
 * change" — and an engineer reads a branch-and-merge picture faster than a
 * list of realization relationships.
 */
function Releases({
  model,
  slug,
  title,
}: {
  model: AbModel;
  /** Opaque id (ADR-0009) — for the DOM id only, never for a label. */
  slug: string;
  title: string;
}) {
  const script = React.useMemo(
    () => toMermaidGitgraph(model, { title }),
    [model, title]
  );

  const plateaus = model.elements.filter((e) => e.type === "Plateau").length;

  if (plateaus === 0) {
    return (
      <div className="bp-empty">
        <p>This product has no plateaus.</p>
        <p className="bp-muted">
          A plateau is a stable, frozen baseline — the state the architecture
          reaches when a batch of work lands. Add one on the Roadmap tab and
          point a work package at it with a <code>realization</code>
          relationship, and the train appears here.
        </p>
      </div>
    );
  }

  return (
    <>
      <h2>Release train</h2>
      <p className="bp-lede">
        Each commit on the trunk is a <strong>Plateau</strong> — a frozen
        baseline. Each branch is a <strong>Work Package</strong>, merged back
        when it lands, tagged with the{" "}
        <strong>Implementation Event</strong> it triggers. Nothing here reads a
        repository: it borrows git&rsquo;s vocabulary because a release train
        has git&rsquo;s shape.
      </p>
      <DiagramViewport>
        <MermaidView script={script} id={`gitgraph-${slug}`} />
      </DiagramViewport>
    </>
  );
}

function Views({ model, title }: { model: AbModel; title: string }) {
  const [domains, setDomains] = React.useState<LayerId[] | null>(null);
  /** Element to centre the structure view on, or null for the whole model. */
  const [focus, setFocus] = React.useState<string>("");
  const [depth, setDepth] = React.useState(1);
  /**
   * One view at a time.
   *
   * Structure and behaviour answer different questions and are read at
   * different moments. Stacking them meant every visit rendered both — two
   * WASM compiles, and a page you scroll past half of.
   */
  const [kind, setKind] = React.useState<"structure" | "behaviour">("structure");
  /** Which flow the sequence draws. Empty means every flow in the model. */
  const [flow, setFlow] = React.useState("");

  const present = React.useMemo(() => {
    const seen = new Set<LayerId>();
    for (const el of model.elements) seen.add(ELEMENTS[el.type].layer);
    return LAYER_ORDER.filter((l) => seen.has(l));
  }, [model]);

  const selected = domains ?? present;

  // Focusing narrows the model itself rather than the diagram, so the layer
  // filter, the D2 generator and the legend all keep working on it unchanged.
  const shown = React.useMemo(() => {
    if (!focus) return model;
    const near = neighbourhood(model, focus, depth);
    return {
      ...model,
      elements: model.elements.filter((e) => near.distance.has(e.id)),
      relationships: near.relationships,
    };
  }, [model, focus, depth]);

  const d2 = React.useMemo(
    () => toD2(shown, { title, domains: selected }),
    [shown, selected, title]
  );
  const sequence = React.useMemo(
    () => toMermaidSequence(model, { title, from: flow || undefined }),
    [model, flow, title]
  );

  /**
   * Behaviours that start something — the sensible places to begin reading.
   *
   * A product's ABox holds more than one flow once it documents both a roadmap
   * and a runtime sequence, and drawing them together is unreadable. These are
   * the entry points: a behaviour that triggers something and is triggered by
   * nothing.
   */
  const starts = React.useMemo(() => {
    const triggers = model.relationships.filter(
      (r) => r.type === "triggering" || r.type === "flow"
    );
    const sources = new Set(triggers.map((r) => r.source));
    const targets = new Set(triggers.map((r) => r.target));
    return model.elements
      .filter((e) => sources.has(e.id) && !targets.has(e.id))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [model]);

  const toggle = (layer: LayerId) =>
    setDomains((current) => {
      const base = current ?? present;
      return base.includes(layer)
        ? base.filter((l) => l !== layer)
        : LAYER_ORDER.filter((l) => base.includes(l) || l === layer);
    });

  return (
    <>
      <div className="bp-viewpicker" role="group" aria-label="View">
        {(
          [
            ["structure", "Structure"],
            ["behaviour", "Behaviour"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            className={`bp-chip${kind === value ? " bp-chip--on" : ""}`}
            aria-pressed={kind === value}
            onClick={() => setKind(value)}
          >
            {label}
          </button>
        ))}
      </div>

      {kind === "structure" && (
        <>
      <p className="bp-lede">
        Domains are containers in the standard ArchiMate colours, and a shape
        follows the element&rsquo;s aspect: hexagon for motivation, rounded for
        behaviour, page for passive structure.
      </p>

      <div className="bp-focus">
        <label className="bp-field">
          <span>Centre on</span>
          <select value={focus} onChange={(e) => setFocus(e.target.value)}>
            <option value="">The whole model</option>
            {[...model.elements]
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((el) => (
                <option key={el.id} value={el.id}>
                  {el.name} ({ELEMENTS[el.type].label})
                </option>
              ))}
          </select>
        </label>

        {focus && (
          <>
            <label className="bp-field">
              <span>Hops</span>
              <select
                value={depth}
                onChange={(e) => setDepth(Number(e.target.value))}
              >
                {[1, 2, 3].map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </label>
            <p className="bp-muted bp-focus__count">
              {shown.elements.length} of {model.elements.length} elements.
              Relationships are followed in both directions — what points at an
              element is as much a part of its neighbourhood as what it points
              at.
            </p>
          </>
        )}
      </div>

      <div className="bp-domainfilter" role="group" aria-label="Domains shown">
        {present.map((layer) => (
          <button
            key={layer}
            type="button"
            className={`bp-chip${selected.includes(layer) ? " bp-chip--on" : ""}`}
            onClick={() => toggle(layer)}
          >
            <span
              className="bp-layer__swatch"
              style={{ background: `var(--bp-layer-${layer})` }}
              aria-hidden="true"
            />
            {LAYER_LABELS[layer]}
          </button>
        ))}
      </div>

      {selected.length === 0 ? (
        <p className="bp-muted">Select at least one domain.</p>
      ) : shown.elements.length === 0 ? (
        <p className="bp-muted">
          Nothing to draw: that element has no connections within {depth} hop
          {depth === 1 ? "" : "s"} in the domains shown.
        </p>
      ) : (
        <DiagramViewport>
          <D2View script={d2} />
        </DiagramViewport>
      )}
        </>
      )}

      {kind === "behaviour" && (
        <>
          <p className="bp-lede">
            Who does what, and what happens next. Participants come from the
            assignment relationship — ArchiMate already records who performs
            each step, which is why this can be derived rather than drawn.
          </p>

          {starts.length > 1 && (
            <div className="bp-focus">
              <label className="bp-field">
                <span>Start from</span>
                <select value={flow} onChange={(e) => setFlow(e.target.value)}>
                  <option value="">Every flow in this product</option>
                  {starts.map((el) => (
                    <option key={el.id} value={el.id}>
                      {el.name}
                    </option>
                  ))}
                </select>
              </label>
              <p className="bp-muted bp-focus__count">
                {flow
                  ? "Only what this step reaches is drawn."
                  : `${starts.length} flows begin in this model. Drawing them together is rarely readable.`}
              </p>
            </div>
          )}

          <DiagramViewport>
            <MermaidView script={sequence} id={`seq-${model.projectSlug}`} />
          </DiagramViewport>
        </>
      )}
    </>
  );
}

function Blocks({
  model,
  onChange,
}: {
  model: AbModel;
  onChange: (next: AbModel) => void;
}) {
  const [warnings, setWarnings] = React.useState<string[]>([]);
  return (
    <>
      <p className="bp-lede">
        Every block and every relationship in the palette is generated from the
        ArchiMate specification, so a connection the language forbids is not
        offered. Changes here are unsaved until you press Save above.
      </p>
      {warnings.length > 0 && (
        <ul className="bp-blockly__warnings" role="status">
          {warnings.map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </ul>
      )}
      <BlocklyEditor model={model} onChange={onChange} onWarnings={setWarnings} />
    </>
  );
}

export default ProjectPage;

export const Head: HeadFC = () => <title>Product — D-LAB-5 Blueprinting</title>;
