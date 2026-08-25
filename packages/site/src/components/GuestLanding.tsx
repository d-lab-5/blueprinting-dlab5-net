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

/** The screens a signed-in user gets, shown locked so a visitor can see them. */
const LOCKED = [
  "Roadmap",
  "Views",
  "Radar",
  "Domains",
  "Blueprint",
  "Teams",
  "Blocks",
];

const Padlock = () => (
  <svg
    className="bp-rail__lock"
    width="12"
    height="12"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    aria-hidden="true"
  >
    <rect x="4" y="11" width="16" height="9" rx="2" />
    <path d="M8 11V7a4 4 0 0 1 8 0v4" />
  </svg>
);

export function GuestLanding({ children }: { children: React.ReactNode }) {
  return (
    <div className="bp-shell bp-shell--railed bp-shell--guest">
      <nav className="bp-rail" aria-label="Sign in">
        <span className="bp-rail__brand bp-rail__brand--static">
          <span className="bp-mark" aria-hidden="true">
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              strokeWidth="2"
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M3 7h7v7H3z" />
              <path d="M14 10h7v7h-7z" />
              <path d="M10 10h4" />
            </svg>
          </span>
          <span>
            blueprinting<span className="bp-rail__brandaccent">.dlab5</span>
          </span>
        </span>

        <div className="bp-rail__section">
          <h2 className="bp-rail__sectionlabel">Access</h2>
          {children}
          <p className="bp-rail__note">
            Accounts are provisioned by the D-LAB-5 admin. There is no
            self-service sign-up and no anonymous access.
          </p>
        </div>

        <div className="bp-rail__section">
          <h2 className="bp-rail__sectionlabel">Locked</h2>
          {/* Listed, not linked. A visitor can see what the platform holds
              without any of it being reachable — these are spans, so there is
              nothing for a keyboard or a screen reader to try to activate. */}
          <ul className="bp-rail__items">
            {LOCKED.map((label) => (
              <li key={label}>
                <span className="bp-rail__item bp-rail__item--locked">
                  {label}
                  <Padlock />
                </span>
              </li>
            ))}
          </ul>
        </div>
      </nav>

      <div className="bp-shell__body">
        <header className="bp-shell__header">
          <span className="bp-shell__title">Blueprinting</span>
          <span className="bp-shell__meta">/ internal · admin-provisioned</span>
          <span className="bp-shell__spacer" />
          <span className="bp-badge">Guest</span>
        </header>

        <main className="bp-shell__main bp-guest">
          <h1 className="bp-guest__title">
            <span className="bp-guest__titlelead">
              Welcome to{" "}
              <span className="bp-guest__titleaccent">blueprinting.dlab5.net</span>
            </span>
            <span className="bp-guest__titlerest">
              D-LAB-5&rsquo;s digital twin engineering and lifecycle tool for
              Digital products and platforms.
            </span>
          </h1>

          <figure className="bp-guest__figure">
            <svg
              className="bp-guest__constellation"
              viewBox={`0 0 ${CONSTELLATION.width} ${CONSTELLATION.height}`}
              role="img"
              aria-label={`The ArchiMate 3.2 metamodel: ${ITEMS.length} element types across ${CONSTELLATION.clusters.length} layers`}
            >
              <defs>
                {/* The scanner: a soft vertical band that sweeps the drawing,
                    picking out one column of the metamodel at a time. */}
                <linearGradient id="bp-scan" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%" stopColor="var(--bp-accent)" stopOpacity="0" />
                  <stop offset="45%" stopColor="var(--bp-accent)" stopOpacity="0.32" />
                  <stop offset="62%" stopColor="var(--bp-accent)" stopOpacity="0.95" />
                  <stop offset="70%" stopColor="var(--bp-accent)" stopOpacity="0.3" />
                  <stop offset="100%" stopColor="var(--bp-accent)" stopOpacity="0" />
                </linearGradient>
              </defs>

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
                      <title>{ELEMENTS[node.id as ElementTypeId].label}</title>
                    </circle>
                  ))}
                </g>
              ))}

              <rect
                className="bp-guest__scanner"
                x={0}
                y={0}
                width={CONSTELLATION.width / 4}
                height={CONSTELLATION.height}
                fill="url(#bp-scan)"
              />
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
        </main>
      </div>
    </div>
  );
}
