import * as React from "react";
import type { HeadFC, PageProps } from "gatsby";
import { LAYER_LABELS, ELEMENTS, LAYER_ORDER } from "@dlab5/archimate-metamodel";
import type { LayerId } from "@dlab5/archimate-metamodel";
import { validateModel } from "@dlab5/blueprint-core";
import type { AbModel, Finding } from "@dlab5/blueprint-core";
import { Shell } from "../components/Shell";
import { loadModel } from "../lib/data";

/**
 * Client-only route for everything under /p/. gatsby-node.ts rewrites this
 * page's path to the matchPath /p/*, so the slug is only knowable at runtime:
 * there is no build-time list of projects, because the list depends on who is
 * asking.
 */
const ProjectPage: React.FC<PageProps> = ({ location }) => {
  const slug = location.pathname.replace(/^\/p\/?/, "").replace(/\/.*$/, "");

  const [model, setModel] = React.useState<AbModel | null>(null);
  const [findings, setFindings] = React.useState<Finding[]>([]);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!slug) return;
    let cancelled = false;
    loadModel(slug)
      .then(({ model: loaded }) => {
        if (cancelled) return;
        setModel(loaded);
        setFindings(validateModel(loaded));
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [slug]);

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

  const byLayer = new Map<LayerId, AbModel["elements"]>();
  for (const el of model?.elements ?? []) {
    const layer = ELEMENTS[el.type].layer;
    byLayer.set(layer, [...(byLayer.get(layer) ?? []), el]);
  }

  return (
    <Shell>
      <p className="bp-crumb">
        <a href="/">Projects</a>
      </p>
      <h1>{slug}</h1>

      {error && (
        <p className="bp-error" role="alert">
          {error}
        </p>
      )}

      {!model && !error && <p className="bp-muted">Loading model…</p>}

      {model && model.elements.length === 0 && (
        <div className="bp-empty">
          <p>This project has no model yet.</p>
          <p className="bp-muted">
            Seed one with <code>npm run seed</code>, or import an existing
            ArchiMate model. Editing in the browser arrives with the Layer 7
            roadmap.
          </p>
        </div>
      )}

      {model && model.elements.length > 0 && (
        <>
          <p className="bp-lede">
            {model.elements.length} elements and {model.relationships.length}{" "}
            relationships.
          </p>

          {findings.length > 0 && (
            <section className="bp-findings">
              <h2>Validation</h2>
              <ul>
                {findings.map((f, i) => (
                  <li key={i} className={`bp-finding bp-finding--${f.severity}`}>
                    <span className="bp-finding__severity">{f.severity}</span>
                    {f.message}
                  </li>
                ))}
              </ul>
            </section>
          )}

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
                    <span className="bp-element__type">
                      {ELEMENTS[el.type].label}
                    </span>
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
      )}
    </Shell>
  );
};

export default ProjectPage;

export const Head: HeadFC = () => <title>Project — D-LAB-5 Blueprinting</title>;
