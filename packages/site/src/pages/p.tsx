import * as React from "react";
import type { HeadFC, PageProps } from "gatsby";
import { ELEMENTS, LAYER_LABELS, LAYER_ORDER } from "@dlab5/archimate-metamodel";
import type { LayerId } from "@dlab5/archimate-metamodel";
import {
  neighbourhood,
  toD2,
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
import { RoadmapEditor } from "../components/RoadmapEditor";
import { BlocklyEditor } from "../components/BlocklyEditor";
import { D2View } from "../components/D2View";
import { RadarChart } from "../components/RadarChart";
import { useModel } from "../hooks/useModel";

type Tab =
  | "roadmap"
  | "views"
  | "radar"
  | "domains"
  | "blueprint"
  | "orgs"
  | "blocks";

/**
 * URL section to tab. `model` is kept as an alias for `domains`: the screen
 * was renamed when the hexagon navigator replaced the flat per-layer stack,
 * and an existing link should not break over a rename.
 */
const SECTIONS: Record<string, Tab> = {
  "": "roadmap",
  roadmap: "roadmap",
  views: "views",
  radar: "radar",
  domains: "domains",
  model: "domains",
  blueprint: "blueprint",
  orgs: "orgs",
  blocks: "blocks",
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

  if (!slug) {
    return (
      <Shell>
        <h1>No project selected</h1>
        <p>
          <a href="/">Back to projects</a>
        </p>
      </Shell>
    );
  }

  return (
    <Shell project={{ slug, active: tab }}>
      <h1>{slug}</h1>

      {error && (
        <p className="bp-error" role="alert">
          {error}
        </p>
      )}
      {loading && <p className="bp-muted">Loading model…</p>}

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
              <Roadmap model={model} slug={slug} />
              <h2>Edit</h2>
              <RoadmapEditor model={model} onChange={update} />
            </>
          )}
          {tab === "views" && <Views model={model} />}
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
            {f.message}
          </li>
        ))}
      </ul>
    </details>
  );
}

function Roadmap({ model, slug }: { model: AbModel; slug: string }) {
  // Regenerated on every model change, so the Gantt is a view of the graph
  // rather than a stored artefact that can drift from it.
  const script = React.useMemo(
    () => toMermaidGantt(model, { title: slug }),
    [model, slug]
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
function Views({ model }: { model: AbModel }) {
  const [domains, setDomains] = React.useState<LayerId[] | null>(null);
  /** Element to centre the structure view on, or null for the whole model. */
  const [focus, setFocus] = React.useState<string>("");
  const [depth, setDepth] = React.useState(1);

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
    () => toD2(shown, { title: shown.projectSlug, domains: selected }),
    [shown, selected]
  );
  const sequence = React.useMemo(
    () => toMermaidSequence(model, { title: model.projectSlug }),
    [model]
  );

  const toggle = (layer: LayerId) =>
    setDomains((current) => {
      const base = current ?? present;
      return base.includes(layer)
        ? base.filter((l) => l !== layer)
        : LAYER_ORDER.filter((l) => base.includes(l) || l === layer);
    });

  return (
    <>
      <h2>Structure</h2>
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

      <h2>Behaviour</h2>
      <p className="bp-lede">
        Who does what, and what happens next. Participants come from the
        assignment relationship — ArchiMate already records who performs each
        step, which is why this can be derived rather than drawn.
      </p>
      <DiagramViewport>
        <MermaidView script={sequence} id={`seq-${model.projectSlug}`} />
      </DiagramViewport>
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

export const Head: HeadFC = () => <title>Project — D-LAB-5 Blueprinting</title>;
