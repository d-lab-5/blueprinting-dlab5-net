/**
 * A banded canvas: one horizontal band per group, elements placed inside it,
 * relations drawn between them.
 *
 * This is the layout the D2 view does not give. D2 auto-lays-out — it decides
 * where things go to minimise crossings, and the answer moves when the model
 * changes. A banded canvas fixes the vertical axis to the ArchiMate layer, so
 * a technology node is always below an application node and the picture means
 * the same thing every time it is drawn. Both are useful; neither replaces the
 * other, which is why the D2 view stays.
 *
 * Geometry only, and deterministic: position is a function of an element's
 * position in its band, so the same model always draws the same canvas.
 */

export interface BandItem {
  id: string;
  /** Which band this belongs to. */
  group: string;
  label?: string;
}

export interface BandNode extends BandItem {
  x: number;
  y: number;
  w: number;
  h: number;
  row: number;
  column: number;
}

export interface Band {
  group: string;
  label: string;
  y: number;
  height: number;
  count: number;
}

export interface BandEdge {
  from: string;
  to: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** True when both ends sit in the same band. */
  lateral: boolean;
}

export interface BandLayout {
  bands: Band[];
  nodes: BandNode[];
  edges: BandEdge[];
  width: number;
  height: number;
}

export interface BandLayoutOptions {
  nodeWidth?: number;
  nodeHeight?: number;
  /** Horizontal gap between nodes. */
  gapX?: number;
  /** Vertical gap between rows within one band. */
  gapY?: number;
  /** Space above and below the nodes inside a band. */
  bandPadding?: number;
  /** Vertical gap between bands. */
  bandGap?: number;
  /** Space to the left of the nodes, for the band label. */
  labelWidth?: number;
  /** Nodes per row before wrapping. */
  columns?: number;
  /**
   * Space to the right of the last column.
   *
   * Without it the rightmost node's edge is exactly the box edge, so its
   * stroke is half-clipped and the drawing looks cut off rather than finished.
   */
  padding?: number;
  /** Labels per group id. Falls back to the group id. */
  labels?: Record<string, string>;
  /** Band order. Groups absent from this list keep first-appearance order. */
  order?: readonly string[];
}

export function toBandLayout(
  items: BandItem[],
  relations: ReadonlyArray<readonly [string, string]> = [],
  options: BandLayoutOptions = {}
): BandLayout {
  const {
    nodeWidth = 150,
    nodeHeight = 44,
    gapX = 14,
    gapY = 12,
    bandPadding = 30,
    bandGap = 10,
    labelWidth = 132,
    columns = 6,
    padding = 16,
    labels = {},
    order,
  } = options;

  const byGroup = new Map<string, BandItem[]>();
  const seen: string[] = [];
  for (const item of items) {
    const bucket = byGroup.get(item.group);
    if (bucket) bucket.push(item);
    else {
      byGroup.set(item.group, [item]);
      seen.push(item.group);
    }
  }

  // An explicit order matters here in a way it does not for the constellation:
  // the vertical axis is the whole point, and ArchiMate's layer sequence is
  // what makes "below" mean "realised by".
  const groups = order
    ? [...order.filter((g) => byGroup.has(g)), ...seen.filter((g) => !order.includes(g))]
    : seen;

  const nodes: BandNode[] = [];
  const bands: Band[] = [];
  let y = 0;

  for (const group of groups) {
    const members = byGroup.get(group)!;
    const rows = Math.max(1, Math.ceil(members.length / columns));
    const height = bandPadding * 2 + rows * nodeHeight + (rows - 1) * gapY;

    members.forEach((item, index) => {
      const row = Math.floor(index / columns);
      const column = index % columns;
      nodes.push({
        ...item,
        row,
        column,
        x: labelWidth + column * (nodeWidth + gapX),
        y: y + bandPadding + row * (nodeHeight + gapY),
        w: nodeWidth,
        h: nodeHeight,
      });
    });

    bands.push({
      group,
      label: labels[group] ?? group,
      y,
      height,
      count: members.length,
    });

    y += height + bandGap;
  }

  const byId = new Map(nodes.map((node) => [node.id, node]));

  const edges: BandEdge[] = [];
  for (const [from, to] of relations) {
    const a = byId.get(from);
    const b = byId.get(to);
    if (!a || !b) continue;

    // `lateral` is about the band, not the row: a relation within one layer
    // means something different from one that crosses layers, and that is what
    // a caller styles on.
    const lateral = a.group === b.group;

    if (a.y === b.y) {
      // Same row: leave each box on the side that faces the other, so the
      // line does not run through the nodes between them. The endpoints stay
      // tied to `from` and `to` rather than to left and right, so a caller
      // drawing an arrowhead at (x2, y2) points it at the target.
      const aIsLeft = a.x <= b.x;
      edges.push({
        from,
        to,
        x1: aIsLeft ? a.x + a.w : a.x,
        y1: a.y + a.h / 2,
        x2: aIsLeft ? b.x : b.x + b.w,
        y2: b.y + b.h / 2,
        lateral,
      });
      continue;
    }

    // Different rows: leave the lower edge of the upper node and arrive at the
    // upper edge of the lower one, so the line never crosses either box.
    const aIsUpper = a.y < b.y;
    edges.push({
      from,
      to,
      x1: a.x + a.w / 2,
      y1: aIsUpper ? a.y + a.h : a.y,
      x2: b.x + b.w / 2,
      y2: aIsUpper ? b.y : b.y + b.h,
      lateral,
    });
  }

  const widest = Math.max(
    0,
    ...groups.map((group) => Math.min(byGroup.get(group)!.length, columns))
  );

  return {
    bands,
    nodes,
    edges,
    width:
      labelWidth + widest * nodeWidth + Math.max(0, widest - 1) * gapX + padding,
    height: Math.max(0, y - bandGap),
  };
}
