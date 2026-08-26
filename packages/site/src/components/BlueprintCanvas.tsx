import * as React from "react";
import { toBandLayout } from "@dlab5/blueprint-core";
import type { AbModel } from "@dlab5/blueprint-core";
import { ELEMENTS, LAYER_LABELS, LAYER_ORDER } from "@dlab5/archimate-metamodel";
import type { LayerId } from "@dlab5/archimate-metamodel";
import { DiagramViewport } from "./DiagramViewport";

/**
 * The model on a banded canvas: one band per ArchiMate layer, top to bottom.
 *
 * This is a second view of the same model, not a replacement for the D2 one.
 * D2 decides where things go to minimise crossings, so the picture rearranges
 * itself as the model grows; here the vertical axis is pinned to the layer, so
 * a technology node is always below an application node and the drawing means
 * the same thing every time. Auto-layout is better for reading structure, a
 * fixed axis is better for reading conformance, and both are worth having.
 */

const NODE_WIDTH = 168;

/**
 * Characters of a name that fit in a node before it must be cut.
 *
 * Measured against the rendered box rather than guessed: at 12px semibold
 * system-ui a character averages about 7px, and a node has NODE_WIDTH less
 * 16px of padding to spend. Cutting at 21 overflowed the box on the longest
 * names, which a build cannot see.
 */
const NAME_LIMIT = Math.floor((NODE_WIDTH - 16) / 7);

const truncate = (name: string) =>
  name.length > NAME_LIMIT ? `${name.slice(0, NAME_LIMIT - 1)}…` : name;

/** How much of a node's width the debt bar fills. */
const DEBT_BAR_MAX = NODE_WIDTH - 16;

const debtOf = (properties: Record<string, string>): number | null => {
  const raw = properties.debt;
  if (raw === undefined) return null;
  const value = Number(raw);
  // A malformed value is dropped rather than clamped to zero: zero means
  // "clean", and silently claiming that about an element nobody has assessed
  // is worse than showing nothing.
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : null;
};

export function BlueprintCanvas({ model }: { model: AbModel }) {
  const [selected, setSelected] = React.useState<string | null>(null);
  const [showRelations, setShowRelations] = React.useState(true);

  const layout = React.useMemo(
    () =>
      toBandLayout(
        model.elements.map((element) => ({
          id: element.id,
          group: ELEMENTS[element.type].layer,
          label: element.name,
        })),
        model.relationships.map((r) => [r.source, r.target] as const),
        { labels: LAYER_LABELS, order: LAYER_ORDER, columns: 5, nodeWidth: NODE_WIDTH }
      ),
    [model]
  );

  const byId = React.useMemo(
    () => new Map(model.elements.map((element) => [element.id, element])),
    [model]
  );

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

  const selectedElement = selected ? byId.get(selected) : undefined;
  const edges = showRelations ? layout.edges : [];

  return (
    <div className="bp-canvas">
      <div className="bp-canvas__bar">
        <button
          type="button"
          className="bp-linkbutton"
          onClick={() => setShowRelations((on) => !on)}
          aria-pressed={showRelations}
        >
          {showRelations ? "Relations on" : "Relations off"}
        </button>
        <span className="bp-muted">
          {layout.nodes.length} elements · {model.relationships.length}{" "}
          relationships
        </span>
      </div>

      <div className="bp-canvas__main">
        <DiagramViewport>
          <svg
            className="bp-canvas__svg"
            viewBox={`0 0 ${layout.width} ${layout.height}`}
            role="group"
            aria-label="The model, by ArchiMate layer"
          >
            {layout.bands.map((band) => (
              <g key={band.group}>
                <rect
                  x={0}
                  y={band.y}
                  width={layout.width}
                  height={band.height}
                  fill={`var(--bp-layer-${band.group})`}
                  fillOpacity={0.05}
                  stroke={`var(--bp-layer-${band.group}-line)`}
                  strokeOpacity={0.4}
                />
                <text
                  className="bp-canvas__band"
                  x={12}
                  y={band.y + 20}
                >
                  {band.label.toUpperCase()}
                </text>
                <text className="bp-canvas__bandcount" x={12} y={band.y + 36}>
                  {band.count}
                </text>
              </g>
            ))}

            {/* Relations under the nodes, so a line never crosses a label. */}
            <g className="bp-canvas__edges">
              {edges.map((edge) => {
                const touchesSelection =
                  selected !== null &&
                  (edge.from === selected || edge.to === selected);
                return (
                  <line
                    key={`${edge.from}->${edge.to}`}
                    x1={edge.x1}
                    y1={edge.y1}
                    x2={edge.x2}
                    y2={edge.y2}
                    strokeOpacity={touchesSelection ? 0.95 : 0.3}
                    strokeWidth={touchesSelection ? 1.6 : 1}
                    strokeDasharray={edge.lateral ? "4 4" : undefined}
                  />
                );
              })}
            </g>

            {layout.nodes.map((node) => {
              const element = byId.get(node.id)!;
              const layer = node.group as LayerId;
              const isSelected = node.id === selected;
              const debt = debtOf(element.properties);

              return (
                <g
                  key={node.id}
                  className="bp-canvas__node"
                  role="button"
                  tabIndex={0}
                  aria-pressed={isSelected}
                  aria-label={`${element.name}, ${ELEMENTS[element.type].label}`}
                  onClick={() => setSelected(isSelected ? null : node.id)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      setSelected(isSelected ? null : node.id);
                    }
                  }}
                >
                  <rect
                    x={node.x}
                    y={node.y}
                    width={node.w}
                    height={node.h}
                    rx={4}
                    fill={`var(--bp-layer-${layer})`}
                    fillOpacity={isSelected ? 0.28 : 0.1}
                    stroke={`var(--bp-layer-${layer}-line)`}
                    strokeOpacity={isSelected ? 1 : 0.6}
                    strokeWidth={isSelected ? 2 : 1}
                  />
                  <text className="bp-canvas__type" x={node.x + 8} y={node.y + 15}>
                    {ELEMENTS[element.type].label}
                  </text>
                  <text className="bp-canvas__name" x={node.x + 8} y={node.y + 30}>
                    {truncate(element.name)}
                    <title>{element.name}</title>
                  </text>
                  {debt !== null && (
                    <>
                      <rect
                        x={node.x + 8}
                        y={node.y + node.h - 8}
                        width={DEBT_BAR_MAX}
                        height={3}
                        rx={1.5}
                        className="bp-canvas__debttrack"
                      />
                      <rect
                        x={node.x + 8}
                        y={node.y + node.h - 8}
                        width={Math.max(3, debt * DEBT_BAR_MAX)}
                        height={3}
                        rx={1.5}
                        // Green through amber to red as debt rises. A single
                        // accent would make a clean element and a rotten one
                        // look the same at a glance, which is the one thing
                        // this bar exists to prevent.
                        fill={
                          debt < 0.34
                            ? "var(--bp-success)"
                            : debt < 0.67
                              ? "var(--bp-warning)"
                              : "var(--bp-danger)"
                        }
                      >
                        <title>{`Technical debt ${debt.toFixed(2)}`}</title>
                      </rect>
                    </>
                  )}
                </g>
              );
            })}
          </svg>
        </DiagramViewport>
      </div>

      {selectedElement && (
        <aside className="bp-canvas__detail">
          <h2>{selectedElement.name}</h2>
          <p className="bp-muted">
            {ELEMENTS[selectedElement.type].label} ·{" "}
            {LAYER_LABELS[ELEMENTS[selectedElement.type].layer]}
          </p>
          {Object.keys(selectedElement.properties).length > 0 && (
            <dl className="bp-canvas__props">
              {Object.entries(selectedElement.properties).map(([key, value]) => (
                <React.Fragment key={key}>
                  <dt>{key}</dt>
                  <dd>{value}</dd>
                </React.Fragment>
              ))}
            </dl>
          )}
          <p className="bp-muted bp-editor__hint">
            <code>{selectedElement.id}</code>
          </p>
          <button
            type="button"
            className="bp-linkbutton"
            onClick={() => setSelected(null)}
          >
            Close
          </button>
        </aside>
      )}
    </div>
  );
}
