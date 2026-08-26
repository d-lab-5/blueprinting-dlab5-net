/**
 * A clustered constellation: nodes grouped into rings, with edges between them.
 *
 * Geometry only, like the radar layout beside it — no rendering, no React. It
 * is what the landing page draws, and the maths is worth testing without a
 * browser.
 *
 * The landing page is seen by visitors who are not signed in, so it must draw
 * something that costs no data access at all (ADR-0002). What it draws is the
 * ArchiMate metamodel itself: the element types of the language, grouped by
 * layer. That is already compiled into the bundle, it is public information,
 * and it is a fair picture of what the platform is for.
 *
 * Placement is deterministic — nodes go round their cluster in order, and the
 * per-cluster phase offset is a function of the cluster index. Nothing here is
 * random, so the same input always draws the same picture and a screenshot
 * diff means something changed.
 */

export interface ConstellationItem {
  id: string;
  /** Which cluster this belongs to. */
  group: string;
}

export interface ConstellationNode {
  id: string;
  group: string;
  x: number;
  y: number;
  r: number;
}

export interface ConstellationCluster {
  group: string;
  label: string;
  /** Centre, in the same coordinate space as the nodes. */
  cx: number;
  cy: number;
  /** Radius of the halo drawn around the cluster. */
  radius: number;
  nodes: ConstellationNode[];
}

export interface ConstellationEdge {
  from: string;
  to: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface Constellation {
  clusters: ConstellationCluster[];
  edges: ConstellationEdge[];
  width: number;
  height: number;
}

export interface ConstellationOptions {
  /** Horizontal distance between cluster centres. */
  spacing?: number;
  /** Vertical centre of the first row of clusters. */
  centreY?: number;
  /**
   * Clusters per row. Everything on one row by default.
   *
   * Eight clusters in a single row is a nine-to-one box that renders as a
   * smear at any sensible page width, so a caller with many groups wraps them.
   */
  columns?: number;
  /** Vertical distance between rows. Defaults to twice the halo radius. */
  rowSpacing?: number;
  /** Distance from the left edge to the first cluster centre. */
  offsetX?: number;
  /** Halo radius. Nodes stay inside it. */
  radius?: number;
  /** Node radius. */
  nodeRadius?: number;
  /** Above this many nodes a cluster splits into two concentric rings. */
  splitAbove?: number;
  /** Labels per group id. Falls back to the group id itself. */
  labels?: Record<string, string>;
}

export function toConstellation(
  items: ConstellationItem[],
  relations: ReadonlyArray<readonly [string, string]> = [],
  options: ConstellationOptions = {}
): Constellation {
  const {
    spacing = 245,
    centreY = 170,
    offsetX = 145,
    radius = 98,
    nodeRadius = 6.5,
    splitAbove = 6,
    labels = {},
    columns,
    rowSpacing,
  } = options;

  // Groups in first-appearance order rather than sorted: the caller has
  // already decided what order its groups belong in — for ArchiMate that is
  // LAYER_ORDER, which is the specification's own sequence and not
  // alphabetical.
  const groups: string[] = [];
  const byGroup = new Map<string, ConstellationItem[]>();
  for (const item of items) {
    let bucket = byGroup.get(item.group);
    if (!bucket) {
      bucket = [];
      byGroup.set(item.group, bucket);
      groups.push(item.group);
    }
    bucket.push(item);
  }

  const perRow = Math.max(1, columns ?? groups.length);
  const gapY = rowSpacing ?? radius * 2;

  const position = new Map<string, { x: number; y: number }>();

  const clusters: ConstellationCluster[] = groups.map((group, groupIndex) => {
    const members = byGroup.get(group)!;
    const column = groupIndex % perRow;
    const row = Math.floor(groupIndex / perRow);
    const cx = offsetX + column * spacing;
    const cy = centreY + row * gapY;

    // A crowded cluster splits onto two rings. One ring of twenty nodes is an
    // unreadable bead necklace; two make the density legible.
    const split = members.length > splitAbove;
    const innerCount = split ? Math.ceil(members.length / 3) : 0;

    const nodes = members.map((item, index) => {
      const inner = split && index < innerCount;
      const ringCount = split ? (inner ? innerCount : members.length - innerCount) : members.length;
      const ringIndex = inner ? index : index - innerCount;
      const ringRadius = split
        ? inner
          ? radius * 0.35
          : radius * 0.76
        : radius * 0.57;

      // The phase offset keeps neighbouring clusters from lining up into
      // false rows, which read as structure that is not there.
      const angle = (ringIndex / Math.max(1, ringCount)) * Math.PI * 2 + groupIndex * 0.5;
      const point = {
        x: cx + ringRadius * Math.cos(angle),
        y: cy + ringRadius * Math.sin(angle),
      };
      position.set(item.id, point);

      return { id: item.id, group, x: point.x, y: point.y, r: nodeRadius };
    });

    return {
      group,
      label: labels[group] ?? group,
      cx,
      cy,
      radius,
      nodes,
    };
  });

  // Relations naming something outside `items` are dropped rather than
  // treated as an error: the caller may legitimately pass a full relationship
  // set alongside a subset of nodes.
  const edges: ConstellationEdge[] = [];
  for (const [from, to] of relations) {
    const a = position.get(from);
    const b = position.get(to);
    if (!a || !b) continue;
    edges.push({ from, to, x1: a.x, y1: a.y, x2: b.x, y2: b.y });
  }

  const rows = Math.ceil(groups.length / perRow) || 1;
  const widest = Math.min(groups.length, perRow);

  return {
    clusters,
    edges,
    // The box wraps the halos exactly: slack in the viewBox becomes visible
    // dead space once the browser scales the drawing to the page width.
    width: offsetX * 2 + Math.max(0, widest - 1) * spacing,
    height: centreY * 2 + Math.max(0, rows - 1) * gapY,
  };
}
