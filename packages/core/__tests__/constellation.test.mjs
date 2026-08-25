import { test } from "node:test";
import assert from "node:assert/strict";

import { ELEMENTS, LAYER_LABELS, LAYER_ORDER } from "@dlab5/archimate-metamodel";
import { toConstellation } from "../dist/index.js";

const items = [
  { id: "a1", group: "application" },
  { id: "a2", group: "application" },
  { id: "b1", group: "business" },
];

test("clusters appear in the order the caller supplied, not sorted", () => {
  const { clusters } = toConstellation(items);
  assert.deepEqual(
    clusters.map((c) => c.group),
    ["application", "business"]
  );
});

test("cluster centres are spaced evenly along the horizontal", () => {
  const { clusters } = toConstellation(items, [], { offsetX: 100, spacing: 200 });
  assert.deepEqual(
    clusters.map((c) => c.cx),
    [100, 300]
  );
});

test("every node stays inside its cluster halo", () => {
  const many = Array.from({ length: 24 }, (_, i) => ({ id: `n${i}`, group: "g" }));
  const { clusters } = toConstellation(many);
  const [cluster] = clusters;
  for (const node of cluster.nodes) {
    const distance = Math.hypot(node.x - cluster.cx, node.y - cluster.cy);
    assert.ok(
      distance <= cluster.radius,
      `${node.id} sits ${distance.toFixed(1)} from the centre, halo is ${cluster.radius}`
    );
  }
});

test("a crowded cluster splits onto two rings", () => {
  const many = Array.from({ length: 21 }, (_, i) => ({ id: `n${i}`, group: "g" }));
  const [cluster] = toConstellation(many, [], { splitAbove: 6 }).clusters;
  const radii = new Set(
    cluster.nodes.map((n) =>
      Math.hypot(n.x - cluster.cx, n.y - cluster.cy).toFixed(3)
    )
  );
  assert.equal(radii.size, 2, "expected exactly two distinct ring radii");
});

test("a small cluster stays on one ring", () => {
  const few = Array.from({ length: 4 }, (_, i) => ({ id: `n${i}`, group: "g" }));
  const [cluster] = toConstellation(few, [], { splitAbove: 6 }).clusters;
  const radii = new Set(
    cluster.nodes.map((n) =>
      Math.hypot(n.x - cluster.cx, n.y - cluster.cy).toFixed(3)
    )
  );
  assert.equal(radii.size, 1);
});

test("no two nodes land on the same point", () => {
  const many = Array.from({ length: 30 }, (_, i) => ({ id: `n${i}`, group: "g" }));
  const [cluster] = toConstellation(many).clusters;
  const points = new Set(
    cluster.nodes.map((n) => `${n.x.toFixed(4)},${n.y.toFixed(4)}`)
  );
  assert.equal(points.size, cluster.nodes.length);
});

test("edges naming an absent node are dropped, not thrown", () => {
  const { edges } = toConstellation(items, [
    ["a1", "b1"],
    ["a1", "nowhere"],
    ["nowhere", "else"],
  ]);
  assert.equal(edges.length, 1);
  assert.deepEqual([edges[0].from, edges[0].to], ["a1", "b1"]);
});

test("an edge's endpoints are the positions of the nodes it names", () => {
  const { clusters, edges } = toConstellation(items, [["a1", "b1"]]);
  const a1 = clusters[0].nodes.find((n) => n.id === "a1");
  const b1 = clusters[1].nodes.find((n) => n.id === "b1");
  assert.deepEqual(
    [edges[0].x1, edges[0].y1, edges[0].x2, edges[0].y2],
    [a1.x, a1.y, b1.x, b1.y]
  );
});

test("the layout is deterministic across calls", () => {
  const once = toConstellation(items, [["a1", "b1"]]);
  const twice = toConstellation(items, [["a1", "b1"]]);
  assert.deepEqual(once, twice);
});

test("empty input yields an empty constellation rather than throwing", () => {
  const { clusters, edges } = toConstellation([]);
  assert.deepEqual(clusters, []);
  assert.deepEqual(edges, []);
});

test("the real metamodel lays out with every element type placed", () => {
  // What the landing page actually draws. It must survive the full 60-type
  // language, not just the synthetic fixtures above.
  const all = Object.values(ELEMENTS).map((e) => ({ id: e.id, group: e.layer }));
  const { clusters } = toConstellation(all, [], { labels: LAYER_LABELS });

  const placed = clusters.flatMap((c) => c.nodes).length;
  assert.equal(placed, all.length);

  // Every layer that has element types is drawn, and labelled from the
  // specification rather than from a hard-coded list in the site.
  for (const cluster of clusters) {
    assert.ok(LAYER_ORDER.includes(cluster.group), `unknown layer ${cluster.group}`);
    assert.equal(cluster.label, LAYER_LABELS[cluster.group]);
  }
});

test("clusters wrap into rows when columns is set", () => {
  const groups = Array.from({ length: 8 }, (_, i) => ({ id: `n${i}`, group: `g${i}` }));
  const { clusters } = toConstellation(groups, [], {
    columns: 4,
    offsetX: 100,
    spacing: 200,
    centreY: 100,
    rowSpacing: 200,
  });

  assert.deepEqual(
    clusters.map((c) => [c.cx, c.cy]),
    [
      [100, 100], [300, 100], [500, 100], [700, 100],
      [100, 300], [300, 300], [500, 300], [700, 300],
    ]
  );
});

test("the box wraps the wrapped rows with no slack", () => {
  const groups = Array.from({ length: 8 }, (_, i) => ({ id: `n${i}`, group: `g${i}` }));
  const { width, height } = toConstellation(groups, [], {
    columns: 4,
    offsetX: 100,
    spacing: 200,
    centreY: 100,
    rowSpacing: 200,
  });
  assert.equal(width, 100 * 2 + 3 * 200);
  assert.equal(height, 100 * 2 + 1 * 200);
});

test("a partial last row does not widen the box", () => {
  const groups = Array.from({ length: 5 }, (_, i) => ({ id: `n${i}`, group: `g${i}` }));
  const { width } = toConstellation(groups, [], {
    columns: 4,
    offsetX: 100,
    spacing: 200,
  });
  assert.equal(width, 100 * 2 + 3 * 200, "five groups over four columns is still four wide");
});

test("nodes follow their cluster onto the second row", () => {
  const groups = Array.from({ length: 8 }, (_, i) => ({ id: `n${i}`, group: `g${i}` }));
  const { clusters } = toConstellation(groups, [], { columns: 4 });
  for (const cluster of clusters) {
    for (const node of cluster.nodes) {
      const distance = Math.hypot(node.x - cluster.cx, node.y - cluster.cy);
      assert.ok(distance <= cluster.radius, `${node.id} escaped its halo`);
    }
  }
});
