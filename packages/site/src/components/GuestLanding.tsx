import * as React from "react";
import { toConstellation } from "@dlab5/blueprint-core";
import {
  ELEMENT_TYPE_IDS,
  ELEMENTS,
  LAYER_LABELS,
  LAYER_ORDER,
  allowedTargets,
} from "@dlab5/archimate-metamodel";
import type { ElementTypeId } from "@dlab5/archimate-metamodel";

/**
 * What a visitor sees before signing in.
 *
 * ADR-0002 settled that there is no anonymous access and no self-service
 * sign-up, and none of that changes here: nothing on this page is fetched, no
 * project is named, and the only control that does anything is the sign-in
 * form. What changes is that a visitor arrives at something that explains what
 * the platform is, instead of a bare password box on an empty background.
 *
 * The constellation is the ArchiMate 3.2 metamodel itself — sixty element
 * types grouped by layer, joined where Appendix B permits a relationship. It
 * is compiled into the bundle by way of @dlab5/archimate-metamodel, so drawing
 * it costs no network call and reveals nothing: it is the published
 * specification, identical for every visitor. Decorative geometry would have
 * been easier and would have meant nothing.
 */

/** Layers with no element types would draw as empty halos. */
const LAYERS_WITH_ELEMENTS = LAYER_ORDER.filter((layer) =>
  ELEMENT_TYPE_IDS.some((id) => ELEMENTS[id].layer === layer)
);

const ITEMS = LAYERS_WITH_ELEMENTS.flatMap((layer) =>
  ELEMENT_TYPE_IDS.filter((id) => ELEMENTS[id].layer === layer).map((id) => ({
    id,
    group: layer,
  }))
);

/**
 * One permitted serving relationship per element type, crossing into another
 * layer.
 *
 * Serving rather than association: it is the relationship that actually runs
 * between ArchiMate layers — technology serves application, application serves
 * business — so the lines drawn trace the language's own grain. Association
 * would have connected almost everything to almost everything and said nothing.
 *
 * One edge per source, because the full matrix is thousands of pairs and would
 * render as a grey fog. Every line drawn is still a relationship Appendix B
 * permits; drawing arbitrary lines would make this a diagram that lies.
 */
const RELATIONS: Array<readonly [string, string]> = ITEMS.flatMap((item, index) => {
  const source = item.id as ElementTypeId;
  const candidates = allowedTargets(source, "serving").filter(
    (candidate) => ELEMENTS[candidate].layer !== ELEMENTS[source].layer
  );
  if (candidates.length === 0) return [];
  // Spread across the permitted targets rather than always taking the first.
  // Taking `[0]` picks the same element type for almost every source, and the
  // drawing collapses into a hub — a shape the metamodel does not have.
  // Stepping by the source's own index keeps it deterministic.
  return [[source, candidates[index % candidates.length]] as readonly [string, string]];
});

const HALO_RADIUS = 92;

const CONSTELLATION = toConstellation(ITEMS, RELATIONS, {
  labels: LAYER_LABELS,
  spacing: 240,
  offsetX: 140,
  radius: HALO_RADIUS,
  nodeRadius: 5.5,
  // Two rows of four rather than one row of eight. All eight layers on one
  // line is a nine-to-one box, and at any real page width that renders as a
  // smear with the halos flattened out of existence.
  columns: 4,
  rowSpacing: HALO_RADIUS * 2 + 16,
  // centreY is the first row's centre, and the box is measured from it, so it
  // has to be the halo radius plus a margin — otherwise the viewBox carries
  // slack the browser scales into visible dead space.
  centreY: HALO_RADIUS + 8,
});

/** The layer pastels are tokens, so a theme change moves the drawing with it. */
const layerFill = (layer: string) => `var(--bp-layer-${layer}, var(--bp-accent))`;
/** Outlines and dots: the pastel on dark, the ink on white. */
const layerLine = (layer: string) => `var(--bp-layer-${layer}-line, var(--bp-accent))`;

export function GuestLanding({ children }: { children: React.ReactNode }) {
  return (
    <main className="bp-guest">
      <div className="bp-guest__intro">
        <h1 className="bp-guest__title">
          D-LAB-5 <span className="bp-guest__titleaccent">Blueprinting</span>
        </h1>
        <p className="bp-guest__lede">
          Engineering governance over one ArchiMate 3.2 semantic model. Technical
          state, architecture structure and tactical roadmaps read from the same
          elements, so there are no duplicate diagrams to keep in step.
        </p>
      </div>

      <figure className="bp-guest__figure">
        <svg
          className="bp-guest__constellation"
          viewBox={`0 0 ${CONSTELLATION.width} ${CONSTELLATION.height}`}
          role="img"
          aria-label={`The ArchiMate 3.2 metamodel: ${ITEMS.length} element types across ${CONSTELLATION.clusters.length} layers`}
        >
          {/* Edges first so nodes sit above them. */}
          <g className="bp-guest__edges">
            {CONSTELLATION.edges.map((edge) => (
              <line
                key={`${edge.from}-${edge.to}`}
                x1={edge.x1}
                y1={edge.y1}
                x2={edge.x2}
                y2={edge.y2}
              />
            ))}
          </g>

          {CONSTELLATION.clusters.map((cluster) => (
            <g key={cluster.group}>
              <circle
                className="bp-guest__halo"
                cx={cluster.cx}
                cy={cluster.cy}
                r={cluster.radius}
                stroke={layerLine(cluster.group)}
              />
              {cluster.nodes.map((node) => (
                <circle
                  key={node.id}
                  cx={node.x}
                  cy={node.y}
                  r={node.r}
                  fill={layerLine(cluster.group)}
                >
                  {/* A tooltip rather than a label: sixty labels at this scale
                      would be unreadable, and the name is still reachable. */}
                  <title>{ELEMENTS[node.id as ElementTypeId].label}</title>
                </circle>
              ))}
            </g>
          ))}
        </svg>

        <figcaption className="bp-guest__legend">
          {CONSTELLATION.clusters.map((cluster) => (
            <span key={cluster.group} className="bp-guest__legenditem">
              <span
                className="bp-guest__swatch"
                style={{ background: layerFill(cluster.group) }}
                aria-hidden="true"
              />
              {cluster.label}
              <span className="bp-guest__count">{cluster.nodes.length}</span>
            </span>
          ))}
        </figcaption>
      </figure>

      {children}

      <p className="bp-guest__foot">
        Access is granted per project by a platform administrator. There is no
        self-service sign-up and no anonymous access.
      </p>
    </main>
  );
}
