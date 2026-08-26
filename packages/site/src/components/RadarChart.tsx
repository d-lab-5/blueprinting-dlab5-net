import * as React from "react";
import { toRadar, toRadarLayout, validateRadar } from "@dlab5/blueprint-core";
import type { AbModel, RadarBlip } from "@dlab5/blueprint-core";
import { ELEMENTS } from "@dlab5/archimate-metamodel";
import { DiagramViewport } from "./DiagramViewport";

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
/**
 * Horizontal room for the quadrant labels.
 *
 * A quadrant's label sits just outside the rim at the middle of its sector.
 * With four quadrants those middles fall on the diagonals and everything fits;
 * with TWO they fall at due left and due right, and the labels ran off the
 * edge of a square viewBox — "Platforms" rendering as "Pla". The box is wider
 * than it is tall so a label at either extreme has somewhere to go.
 */
const SIDE_ROOM = 90;
const WIDTH = SIZE + SIDE_ROOM * 2;
const CX = WIDTH / 2;
const CENTRE = SIZE / 2;
/** Leaves room for blip labels at the rim. */
const RADIUS = CENTRE - 34;

/**
 * Ring colours, as tokens rather than hex.
 *
 * These are the platform's semantic accents, not a palette invented for the
 * radar: adopt is success, hold is danger, and the two in between are the
 * accent and the warning. Naming the tokens rather than their values is what
 * makes the radar follow the theme — the light theme darkens every one of
 * them for contrast against white, and hard-coded hex would have ignored that.
 */
const RING_COLOUR: Record<string, string> = {
  adopt: "var(--bp-success)",
  trial: "var(--bp-accent)",
  assess: "var(--bp-warning)",
  hold: "var(--bp-danger)",
};

const toSvg = (x: number, y: number) => ({
  cx: CX + x * RADIUS,
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
    CX + Math.sin(angle) * r * RADIUS,
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

const RINGS = ["adopt", "trial", "assess", "hold"] as const;

export function RadarChart({ model }: { model: AbModel }) {
  const [selected, setSelected] = React.useState<RadarBlip | null>(null);
  const [rings, setRings] = React.useState<Set<string>>(new Set(RINGS));
  const [hidden, setHidden] = React.useState<Set<string>>(new Set());
  const [needle, setNeedle] = React.useState("");

  const all = React.useMemo(() => toRadar(model), [model]);

  /**
   * Filtering removes blips, never sectors or rings.
   *
   * A radar whose shape changes as you filter is disorienting: the whole point
   * of the figure is that a given position means the same thing every time.
   * So every quadrant keeps its sector and every ring its band, and what
   * changes is which entries are drawn in them.
   */
  const quadrants = React.useMemo(() => {
    const search = needle.trim().toLowerCase();
    return all.map((q) => ({
      ...q,
      entries: hidden.has(q.id)
        ? []
        : q.entries.filter(
            (e) =>
              rings.has(e.ring) &&
              (!search || e.label.toLowerCase().includes(search))
          ),
    }));
  }, [all, rings, hidden, needle]);

  const total = React.useMemo(
    () => all.reduce((n, q) => n + q.entries.length, 0),
    [all]
  );
  const shown = quadrants.reduce((n, q) => n + q.entries.length, 0);

  const layout = React.useMemo(() => toRadarLayout(quadrants), [quadrants]);
  const findings = React.useMemo(() => validateRadar(model), [model]);

  const toggle = (set: Set<string>, value: string, next: (s: Set<string>) => void) => {
    const copy = new Set(set);
    if (copy.has(value)) copy.delete(value);
    else copy.add(value);
    next(copy);
  };

  if (total === 0) {
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
      <div className="bp-radar__filters">
        <div className="bp-radar__filterrow" role="group" aria-label="Rings shown">
          {RINGS.map((ring) => (
            <button
              key={ring}
              type="button"
              className={`bp-chip${rings.has(ring) ? " bp-chip--on" : ""}`}
              aria-pressed={rings.has(ring)}
              onClick={() => toggle(rings, ring, setRings)}
            >
              <span
                className="bp-radar__dot"
                style={{ background: RING_COLOUR[ring] }}
                aria-hidden="true"
              />
              {ring}
            </button>
          ))}
        </div>

        <div className="bp-radar__filterrow" role="group" aria-label="Quadrants shown">
          {all.map((q) => (
            <button
              key={q.id}
              type="button"
              className={`bp-chip${hidden.has(q.id) ? "" : " bp-chip--on"}`}
              aria-pressed={!hidden.has(q.id)}
              onClick={() => toggle(hidden, q.id, setHidden)}
            >
              {q.name}
              <span className="bp-radar__num">{q.entries.length}</span>
            </button>
          ))}
        </div>

        <label className="bp-field bp-radar__search">
          <span>Find</span>
          <input
            type="search"
            value={needle}
            placeholder="name contains…"
            onChange={(e) => setNeedle(e.target.value)}
          />
        </label>

        <p className="bp-muted bp-radar__count">
          {shown === total
            ? `${total} entr${total === 1 ? "y" : "ies"}`
            : `${shown} of ${total} shown`}
        </p>
      </div>

      <div className="bp-radar__chart">
        {/* The same viewport the other diagrams use, so zoom, fit, scroll and
            full screen behave identically here. A radar with forty entries is
            exactly the case full screen exists for. */}
        <DiagramViewport>
        <svg
          viewBox={`0 0 ${WIDTH} ${SIZE}`}
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
                x={CX}
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
            const x = CX + Math.sin(mid) * r;
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
                {/* A blip is a number until you hover it. The title carries
                    what the side list would tell you, so the chart can be read
                    without clicking through every point. */}
                <title>
                  {`${blip.number}. ${blip.label}\n${blip.ring.toUpperCase()} · ${blip.quadrant} · ${
                    ELEMENTS[blip.type].label
                  }${blip.moved !== "none" ? `\nmoved ${blip.moved}` : ""}${
                    blip.description ? `\n\n${blip.description}` : ""
                  }`}
                </title>
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
        </DiagramViewport>
      </div>

      <div className="bp-radar__side">
        {shown === 0 && (
          <p className="bp-muted">
            Nothing matches. The rings and quadrants are still drawn, so the
            shape stays comparable — it is the entries that are filtered out.
          </p>
        )}
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
