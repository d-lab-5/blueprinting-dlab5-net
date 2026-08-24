import * as React from "react";
import type { HeadFC, PageProps } from "gatsby";
import { ELEMENTS, LAYER_LABELS, LAYER_ORDER } from "@dlab5/archimate-metamodel";
import type { LayerId } from "@dlab5/archimate-metamodel";
import { toMermaidGantt } from "@dlab5/blueprint-core";
import type { AbModel } from "@dlab5/blueprint-core";
import { Shell } from "../components/Shell";
import { MermaidView } from "../components/MermaidView";
import { DiagramViewport } from "../components/DiagramViewport";
import { GanttLegend } from "../components/GanttLegend";
import { RoadmapEditor } from "../components/RoadmapEditor";
import { BlocklyEditor } from "../components/BlocklyEditor";
import { useModel } from "../hooks/useModel";

type Tab = "roadmap" | "model" | "blocks";

/**
 * Client-only route for everything under /p/. gatsby-node.ts rewrites this
 * page's path to the matchPath /p/*, so the slug is only knowable at runtime:
 * there is no build-time list of projects, because the list depends on who is
 * asking. Amplify Hosting needs a matching 200 rewrite — see CLAUDE.md.
 */
const ProjectPage: React.FC<PageProps> = ({ location }) => {
  const path = location.pathname.replace(/^\/p\/?/, "").replace(/\/$/, "");
  const [slug, section] = path.split("/");
  const tab: Tab =
    section === "model" ? "model" : section === "blocks" ? "blocks" : "roadmap";

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
    <Shell>
      <p className="bp-crumb">
        <a href="/">Projects</a>
      </p>

      <div className="bp-pagehead">
        <h1>{slug}</h1>
        <nav className="bp-tabs">
          <a
            href={`/p/${slug}/`}
            className={`bp-tab${tab === "roadmap" ? " bp-tab--on" : ""}`}
          >
            Roadmap
          </a>
          <a
            href={`/p/${slug}/model/`}
            className={`bp-tab${tab === "model" ? " bp-tab--on" : ""}`}
          >
            Model
          </a>
          <a
            href={`/p/${slug}/blocks/`}
            className={`bp-tab${tab === "blocks" ? " bp-tab--on" : ""}`}
          >
            Blocks
          </a>
        </nav>
      </div>

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
          {tab === "model" && <ModelByDomain model={model} />}
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

function ModelByDomain({ model }: { model: AbModel }) {
  const byLayer = new Map<LayerId, AbModel["elements"]>();
  for (const el of model.elements) {
    const layer = ELEMENTS[el.type].layer;
    byLayer.set(layer, [...(byLayer.get(layer) ?? []), el]);
  }

  if (model.elements.length === 0) {
    return (
      <div className="bp-empty">
        <p>This project has no model yet.</p>
        <p className="bp-muted">
          Add elements on the Roadmap tab, or seed one with{" "}
          <code>npm run seed</code>.
        </p>
      </div>
    );
  }

  return (
    <>
      <p className="bp-lede">
        {model.elements.length} elements and {model.relationships.length}{" "}
        relationships.
      </p>
      {LAYER_ORDER.filter((layer) => byLayer.has(layer)).map((layer) => (
        <section key={layer} className="bp-layer">
          <h2>
            <span
              className="bp-layer__swatch"
              style={{ background: `var(--bp-layer-${layer})` }}
              aria-hidden="true"
            />
            {LAYER_LABELS[layer]}
          </h2>
          <ul className="bp-elements">
            {byLayer.get(layer)!.map((el) => (
              <li key={el.id}>
                <span className="bp-element__type">{ELEMENTS[el.type].label}</span>
                <span className="bp-element__name">{el.name}</span>
                {Object.keys(el.properties).length > 0 && (
                  <span className="bp-element__props">
                    {Object.entries(el.properties)
                      .map(([k, v]) => `${k}: ${v}`)
                      .join(" · ")}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}

export default ProjectPage;

export const Head: HeadFC = () => <title>Project — D-LAB-5 Blueprinting</title>;
