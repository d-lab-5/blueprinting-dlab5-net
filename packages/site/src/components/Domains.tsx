import * as React from "react";
import { toHexNavigator } from "@dlab5/blueprint-core";
import type { AbModel } from "@dlab5/blueprint-core";
import { ELEMENTS, LAYER_LABELS } from "@dlab5/archimate-metamodel";
import type { LayerId } from "@dlab5/archimate-metamodel";

/**
 * The model, navigated by ArchiMate layer.
 *
 * This replaces the flat stack of per-layer sections that the Model tab used
 * to be. The data is the same; what changes is that the layers are drawn as
 * they actually relate — motivation at the centre because it is why everything
 * else exists, the business/application/technology stack as the classic core
 * around it, and the supporting layers outside that — instead of as six
 * headings down a page, which implies they are peers in a sequence.
 *
 * The nesting is a reading of the specification, not something it mandates.
 * What the specification does fix is the layer set and the colours, and both
 * come from @dlab5/archimate-metamodel rather than from a list here.
 */

/**
 * Where each layer sits in the figure.
 *
 * A hexagon band takes 1, 2, 3 or 6 wedges — the corners are 60 degrees apart
 * — so eight layers do not fit one ring. Core, ring, three, three is the
 * arrangement that both fits and says something true about the layers.
 */
const PLACEMENT: Record<LayerId, { band: number; wedge: number }> = {
  motivation: { band: 0, wedge: 0 },
  strategy: { band: 1, wedge: 0 },
  business: { band: 2, wedge: 0 },
  application: { band: 2, wedge: 1 },
  technology: { band: 2, wedge: 2 },
  physical: { band: 3, wedge: 0 },
  implementation: { band: 3, wedge: 1 },
  composite: { band: 3, wedge: 2 },
};

const NAVIGATOR = toHexNavigator(
  (Object.keys(PLACEMENT) as LayerId[]).map((layer) => ({
    id: layer,
    label: LAYER_LABELS[layer],
    ...PLACEMENT[layer],
  })),
  // The outer band is rotated so its labels interleave with the inner one's.
  // Left aligned, the two bands' labels sit on the same three radial lines and
  // each pair reads as one wedge split in two.
  { bandStartAngle: { 3: 60 } }
);

/** Short enough to sit inside a wedge without overflowing it. */
const SHORT_LABEL: Partial<Record<LayerId, string>> = {
  implementation: "Implementation",
  composite: "Common",
};

export function Domains({ model }: { model: AbModel }) {
  const [selected, setSelected] = React.useState<LayerId | null>(null);

  const byLayer = React.useMemo(() => {
    const map = new Map<LayerId, AbModel["elements"]>();
    for (const element of model.elements) {
      const layer = ELEMENTS[element.type].layer;
      const bucket = map.get(layer);
      if (bucket) bucket.push(element);
      else map.set(layer, [element]);
    }
    return map;
  }, [model]);

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

  const elements = selected ? (byLayer.get(selected) ?? []) : [];

  return (
    <div className="bp-domains">
      <div className="bp-domains__figure">
        <svg
          viewBox={`0 0 ${NAVIGATOR.size} ${NAVIGATOR.size}`}
          role="group"
          aria-label="The model by ArchiMate layer"
        >
          {NAVIGATOR.cells.map((cell) => {
            const layer = cell.id as LayerId;
            const count = byLayer.get(layer)?.length ?? 0;
            const isSelected = selected === layer;
            // An empty layer stays visible but is not selectable: a wedge that
            // opens an empty panel is a dead end, and hiding it would leave a
            // hole in the hexagon.
            const isEmpty = count === 0;

            return (
              <g
                key={cell.id}
                className={`bp-domains__cell${isSelected ? " bp-domains__cell--on" : ""}${
                  isEmpty ? " bp-domains__cell--empty" : ""
                }`}
                role={isEmpty ? undefined : "button"}
                tabIndex={isEmpty ? undefined : 0}
                aria-pressed={isEmpty ? undefined : isSelected}
                aria-label={`${LAYER_LABELS[layer]}, ${count} element${count === 1 ? "" : "s"}`}
                onClick={() => !isEmpty && setSelected(isSelected ? null : layer)}
                onKeyDown={(event) => {
                  if (isEmpty) return;
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    setSelected(isSelected ? null : layer);
                  }
                }}
              >
                <path
                  d={cell.path}
                  fillRule={cell.ring ? "evenodd" : undefined}
                  fill={`var(--bp-layer-${layer})`}
                  fillOpacity={isEmpty ? 0.06 : isSelected ? 0.5 : 0.22}
                  stroke={`var(--bp-layer-${layer})`}
                  strokeOpacity={isEmpty ? 0.25 : 0.7}
                  strokeWidth={isSelected ? 2 : 1}
                />
                <text
                  className="bp-domains__label"
                  x={cell.labelX}
                  y={cell.labelY - 5}
                  textAnchor="middle"
                >
                  {SHORT_LABEL[layer] ?? LAYER_LABELS[layer]}
                </text>
                <text
                  className="bp-domains__count"
                  x={cell.labelX}
                  y={cell.labelY + 11}
                  textAnchor="middle"
                >
                  {count}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      <div className="bp-domains__side">
        {selected ? (
          <>
            <h2 className="bp-domains__sidetitle">
              <span
                className="bp-layer__swatch"
                style={{ background: `var(--bp-layer-${selected})` }}
                aria-hidden="true"
              />
              {LAYER_LABELS[selected]}
            </h2>
            <ul className="bp-elements">
              {elements.map((element) => (
                <li key={element.id}>
                  <span className="bp-element__type">
                    {ELEMENTS[element.type].label}
                  </span>
                  <span className="bp-element__name">{element.name}</span>
                  {Object.keys(element.properties).length > 0 && (
                    <span className="bp-element__props">
                      {Object.entries(element.properties)
                        .map(([key, value]) => `${key}: ${value}`)
                        .join(" · ")}
                    </span>
                  )}
                </li>
              ))}
            </ul>
            <button
              type="button"
              className="bp-linkbutton"
              onClick={() => setSelected(null)}
            >
              Clear selection
            </button>
          </>
        ) : (
          <>
            <p className="bp-lede">
              {model.elements.length} elements and {model.relationships.length}{" "}
              relationships.
            </p>
            <p className="bp-muted">
              Choose a layer to list what it holds. Motivation sits at the
              centre because it is what the rest of the model answers to;
              business, application and technology form the ring around it, and
              the supporting layers sit outside.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
