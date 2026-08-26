/**
 * A nested-hexagon partition: a core, then concentric bands, each band cut
 * into wedges.
 *
 * This is how the Domains screen navigates the model. The ArchiMate layers
 * nest rather than sit side by side — motivation is why the rest exists, and
 * the business/application/technology stack is the classic core with the
 * supporting layers around it — and a hexagon says that in a way a row of
 * boxes does not.
 *
 * Geometry only, like the radar and constellation layouts beside it. It is
 * pure maths over integers and angles, worth testing without a browser, and
 * the MCP server or a static export may want the paths without one.
 *
 * **Everything angular here must be a multiple of 60.** A hexagon's corners are
 * 60 degrees apart, and a wedge corner placed anywhere else lands on a circle
 * rather than on the hexagon — the band then draws as an inscribed polygon
 * that visibly does not follow the outline. So wedge counts must divide 6 (1,
 * 2, 3 and 6 are the usable ones) and start angles must be multiples of 60.
 * Both are checked rather than silently drawn wrong, because the failure is
 * only obvious once someone looks at the picture.
 */

export interface HexCellSpec {
  id: string;
  label: string;
  /** 0 is the core hexagon; 1 and up are concentric bands around it. */
  band: number;
  /** Position within the band, clockwise from the start angle. */
  wedge: number;
}

export interface HexCell extends HexCellSpec {
  /** An SVG path for the cell. Bands use the even-odd fill rule. */
  path: string;
  /** Whether `path` needs fill-rule="evenodd" — true for a full ring. */
  ring: boolean;
  /** A point inside the cell, for a label. */
  labelX: number;
  labelY: number;
}

export interface HexNavigator {
  cells: HexCell[];
  cx: number;
  cy: number;
  size: number;
}

export interface HexNavigatorOptions {
  /**
   * Outer radius of each band, innermost first. `radii[0]` is the core
   * hexagon's radius. Must cover every band used.
   */
  radii?: number[];
  /** Rotation of the whole figure, in degrees. Must be a multiple of 60. */
  startAngle?: number;
  /**
   * Per-band rotation, overriding `startAngle`. Also multiples of 60.
   *
   * Two stacked bands with the same wedge count otherwise put their labels on
   * the same radial lines, which reads as one wedge split in two rather than
   * as two bands.
   */
  bandStartAngle?: Record<number, number>;
  /** Padding around the figure. */
  padding?: number;
}

const RAD = Math.PI / 180;

/** The six corners of a hexagon, as an SVG point list. */
export function hexPoints(cx: number, cy: number, r: number): string {
  const points: string[] = [];
  for (let i = 0; i < 6; i++) {
    const angle = 60 * i * RAD;
    points.push(`${(cx + r * Math.cos(angle)).toFixed(2)},${(cy + r * Math.sin(angle)).toFixed(2)}`);
  }
  return points.join(" ");
}

const point = (cx: number, cy: number, r: number, degrees: number) =>
  `${(cx + r * Math.cos(degrees * RAD)).toFixed(2)},${(cy + r * Math.sin(degrees * RAD)).toFixed(2)}`;

/** A closed hexagon. */
const hexPath = (cx: number, cy: number, r: number) =>
  `M${hexPoints(cx, cy, r).replace(/ /g, "L")}Z`;

/**
 * A full band, drawn as two hexagons. The caller fills it with
 * `fill-rule="evenodd"` so the inner one becomes a hole.
 */
const ringPath = (cx: number, cy: number, outer: number, inner: number) =>
  `${hexPath(cx, cy, outer)} ${hexPath(cx, cy, inner)}`;

/** One wedge of a band, following the hexagon's corners. */
function wedgePath(
  cx: number,
  cy: number,
  outer: number,
  inner: number,
  from: number,
  span: number
): string {
  const steps = span / 60;
  const outerPoints: string[] = [];
  const innerPoints: string[] = [];
  for (let i = 0; i <= steps; i++) {
    outerPoints.push(point(cx, cy, outer, from + i * 60));
    innerPoints.push(point(cx, cy, inner, from + i * 60));
  }
  innerPoints.reverse();
  return `M${outerPoints.concat(innerPoints).join("L")}Z`;
}

export function toHexNavigator(
  specs: HexCellSpec[],
  options: HexNavigatorOptions = {}
): HexNavigator {
  const {
    radii = [70, 122, 220, 300],
    startAngle = 0,
    padding = 24,
    bandStartAngle = {},
  } = options;

  const checkAngle = (angle: number, where: string) => {
    if (angle % 60 !== 0) {
      throw new Error(
        `${where} is ${angle}°; hexagon corners are 60° apart, so it must be a multiple of 60`
      );
    }
  };
  checkAngle(startAngle, "startAngle");
  for (const [band, angle] of Object.entries(bandStartAngle)) {
    checkAngle(angle, `bandStartAngle[${band}]`);
  }

  const bands = new Map<number, HexCellSpec[]>();
  for (const spec of specs) {
    const bucket = bands.get(spec.band);
    if (bucket) bucket.push(spec);
    else bands.set(spec.band, [spec]);
  }

  const outermost = Math.max(0, ...specs.map((s) => s.band));
  if (outermost >= radii.length) {
    throw new Error(
      `band ${outermost} has no radius: radii has ${radii.length} entries`
    );
  }

  const size = radii[outermost] * 2 + padding * 2;
  const cx = size / 2;
  const cy = size / 2;

  const cells: HexCell[] = [];

  for (const [band, members] of [...bands].sort((a, b) => a[0] - b[0])) {
    const outer = radii[band];
    const inner = band === 0 ? 0 : radii[band - 1];
    const count = members.length;

    if (band > 0 && 6 % count !== 0) {
      throw new Error(
        `band ${band} has ${count} wedges; a hexagon band takes 1, 2, 3 or 6`
      );
    }

    // Sort by the caller's wedge index so the drawing order does not depend on
    // the order the specs happened to arrive in.
    const ordered = [...members].sort((a, b) => a.wedge - b.wedge);

    ordered.forEach((spec, index) => {
      if (band === 0) {
        cells.push({
          ...spec,
          path: hexPath(cx, cy, outer),
          ring: false,
          labelX: cx,
          labelY: cy,
        });
        return;
      }

      const midRadius = (inner + outer) / 2;
      const bandAngle = bandStartAngle[band] ?? startAngle;

      if (count === 1) {
        cells.push({
          ...spec,
          path: ringPath(cx, cy, outer, inner),
          ring: true,
          // A full band has no angular middle, so the label goes at the top.
          // It is a label position, not a corner, so it is free of the
          // multiple-of-60 rule.
          labelX: cx,
          labelY: cy - midRadius,
        });
        return;
      }

      const span = 360 / count;
      const from = bandAngle + index * span;
      const middle = from + span / 2;

      cells.push({
        ...spec,
        path: wedgePath(cx, cy, outer, inner, from, span),
        ring: false,
        labelX: cx + midRadius * Math.cos(middle * RAD),
        labelY: cy + midRadius * Math.sin(middle * RAD),
      });
    });
  }

  return { cells, cx, cy, size };
}
