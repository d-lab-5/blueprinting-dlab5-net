import * as React from "react";
import { toRadar, toRadarLayout, validateRadar } from "@dlab5/blueprint-core";
import type { AbModel, RadarBlip } from "@dlab5/blueprint-core";
import { ELEMENTS } from "@dlab5/archimate-metamodel";

/**
 * The Technology Radar, drawn from the model.
 *
 * Plain SVG rather than a charting library: the geometry is already computed
 * in packages/core, so all that is left is drawing arcs and circles, and a
 * dependency would only add weight and a second opinion about layout.
 *
 * Every blip is an element of the ArchiMate model, so a click can reasonably
 * lead back to it. That is the point of deriving the radar rather than keeping
 * it as a second dataset — a component cannot be ADOPT on the radar and
 * something else in the architecture, because they are the same object.
 */

const SIZE = 620;
const CENTRE = SIZE / 2;
/** Leaves room for blip labels at the rim. */
const RADIUS = CENTRE - 34;

/** Ring colours, dark-theme. Adopt is the most saturated, hold the least. */
const RING_COLOUR: Record<string, string> = {
  adopt: "#22c55e",
  trial: "#38bdf8",
  assess: "#f59e0b",
  hold: "#ef4444",
};

const toSvg = (x: number, y: number) => ({
  cx: CENTRE + x * RADIUS,
  cy: CENTRE + y * RADIUS,
});

/** An SVG arc path for one ring band within one sector. */
function sectorArc(
  startAngle: number,
  endAngle: number,
  inner: number,
  outer: number
): string {
  const point = (angle: number, r: number) => [
    CENTRE + Math.sin(angle) * r * RADIUS,
    CENTRE - Math.cos(angle) * r * RADIUS,
  ];
  const [x1, y1] = point(startAngle, outer);
  const [x2, y2] = point(endAngle, outer);
  const [x3, y3] = point(endAngle, inner);
  const [x4, y4] = point(startAngle, inner);
  const large = endAngle - startAngle > Math.PI ? 1 : 0;
  return [
    `M ${x1} ${y1}`,
    `A ${outer * RADIUS} ${outer * RADIUS} 0 ${large} 1 ${x2} ${y2}`,
    `L ${x3} ${y3}`,
    `A ${inner * RADIUS} ${inner * RADIUS} 0 ${large} 0 ${x4} ${y4}`,
    "Z",
  ].join(" ");
}

export function RadarChart({ model }: { model: AbModel }) {
  const [selected, setSelected] = React.useState<RadarBlip | null>(null);

  const quadrants = React.useMemo(() => toRadar(model), [model]);
  const layout = React.useMemo(() => toRadarLayout(quadrants), [quadrants]);
  const findings = React.useMemo(() => validateRadar(model), [model]);

  if (layout.blips.length === 0) {
    return (
      <div className="bp-empty">
        <p>Nothing on the radar yet.</p>
        <p className="bp-muted">
          A radar entry is an element carrying a <code>radarRing</code> property
          that some <strong>Grouping</strong> aggregates — the Grouping is the
          quadrant. Add both and the entry appears here; the element stays the
          same one the architecture uses.
        </p>
      </div>
    );
  }

  return (
    <div className="bp-radar">
      <div className="bp-radar__chart">
        <svg
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          role="img"
          aria-label={`Technology radar with ${layout.blips.length} entries`}
        >
          {/* Ring bands, faintly tinted so the adoption gradient reads before
              any label does. */}
          {layout.sectors.map((sector) =>
            layout.rings.map((ring, ringIndex) => {
              const inner = ringIndex === 0 ? 0 : layout.ringRadii[ringIndex - 1];
              return (
                <path
                  key={`${sector.index}-${ring}`}
                  d={sectorArc(
                    sector.startAngle,
                    sector.endAngle,
                    inner,
                    layout.ringRadii[ringIndex]
                  )}
                  fill={RING_COLOUR[ring]}
                  fillOpacity={0.06}
                  stroke="var(--bp-border-strong)"
                  strokeWidth={1}
                />
              );
            })
          )}

          {/* Ring names, once, along the vertical. */}
          {layout.rings.map((ring, i) => {
            const inner = i === 0 ? 0 : layout.ringRadii[i - 1];
            const mid = ((inner + layout.ringRadii[i]) / 2) * RADIUS;
            return (
              <text
                key={ring}
                x={CENTRE}
                y={CENTRE - mid}
                textAnchor="middle"
                className="bp-radar__ringlabel"
                fill={RING_COLOUR[ring]}
              >
                {ring}
              </text>
            );
          })}

          {/* Quadrant names, outside the rim. */}
          {layout.sectors.map((sector) => {
            const mid = (sector.startAngle + sector.endAngle) / 2;
            const r = RADIUS + 18;
            const x = CENTRE + Math.sin(mid) * r;
            const y = CENTRE - Math.cos(mid) * r;
            return (
              <text
                key={sector.name}
                x={x}
                y={y}
                textAnchor={Math.sin(mid) > 0.1 ? "start" : Math.sin(mid) < -0.1 ? "end" : "middle"}
                dominantBaseline="middle"
                className="bp-radar__quadrantlabel"
              >
                {sector.name}
              </text>
            );
          })}

          {layout.blips.map((blip) => {
            const { cx, cy } = toSvg(blip.x, blip.y);
            const isSelected = selected?.id === blip.id;
            return (
              <g
                key={blip.id}
                className="bp-radar__blip"
                onClick={() => setSelected(isSelected ? null : blip)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setSelected(isSelected ? null : blip);
                  }
                }}
                aria-label={`${blip.label}, ${blip.ring}, ${blip.quadrant}`}
              >
                {/* Movement is drawn as a triangle, as Thoughtworks does:
                    a blip that has moved says more than one that has not. */}
                {blip.moved === "none" ? (
                  <circle
                    cx={cx}
                    cy={cy}
                    r={isSelected ? 11 : 8}
                    fill={RING_COLOUR[blip.ring]}
                  />
                ) : (
                  <polygon
                    points={
                      blip.moved === "in"
                        ? `${cx},${cy - 10} ${cx + 9},${cy + 6} ${cx - 9},${cy + 6}`
                        : `${cx},${cy + 10} ${cx + 9},${cy - 6} ${cx - 9},${cy - 6}`
                    }
                    fill={RING_COLOUR[blip.ring]}
                  />
                )}
                <text
                  x={cx}
                  y={cy}
                  textAnchor="middle"
                  dominantBaseline="central"
                  className="bp-radar__blipnumber"
                >
                  {blip.number}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      <div className="bp-radar__side">
        {selected ? (
          <div className="bp-radar__detail">
            <h3>
              {selected.number}. {selected.label}
            </h3>
            <p className="bp-radar__meta">
              <span style={{ color: RING_COLOUR[selected.ring] }}>
                {selected.ring}
              </span>{" "}
              · {selected.quadrant} · {ELEMENTS[selected.type].label}
              {selected.moved !== "none" && ` · moved ${selected.moved}`}
            </p>
            {selected.description && <p>{selected.description}</p>}
            <p className="bp-muted bp-editor__hint">
              This is the element <code>{selected.id}</code> in the model, not a
              copy of it.
            </p>
            <button
              type="button"
              className="bp-linkbutton"
              onClick={() => setSelected(null)}
            >
              Close
            </button>
          </div>
        ) : (
          <>
            {quadrants.map((quadrant) => (
              <section key={quadrant.id} className="bp-radar__quadrant">
                <h3>{quadrant.name}</h3>
                <ul>
                  {quadrant.entries.map((entry) => {
                    const blip = layout.blips.find((b) => b.id === entry.id)!;
                    return (
                      <li key={entry.id}>
                        <button
                          type="button"
                          className="bp-radar__entry"
                          onClick={() => setSelected(blip)}
                        >
                          <span
                            className="bp-radar__dot"
                            style={{ background: RING_COLOUR[entry.ring] }}
                          />
                          <span className="bp-radar__num">{blip.number}</span>
                          {entry.label}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </>
        )}

        {findings.length > 0 && (
          <ul className="bp-blockly__warnings" role="status">
            {findings.map((f, i) => (
              <li key={i}>{f.message}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
