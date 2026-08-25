import { test } from "node:test";
import assert from "node:assert/strict";

import { toBandLayout } from "../dist/index.js";

const items = [
  { id: "a1", group: "application" },
  { id: "a2", group: "application" },
  { id: "t1", group: "technology" },
  { id: "b1", group: "business" },
];

const ORDER = ["business", "application", "technology"];

test("bands come out in the order given, not first-appearance order", () => {
  const { bands } = toBandLayout(items, [], { order: ORDER });
  assert.deepEqual(bands.map((b) => b.group), ORDER);
});

test("a group missing from the order still gets a band, after the ordered ones", () => {
  const { bands } = toBandLayout(
    [...items, { id: "m1", group: "motivation" }],
    [],
    { order: ORDER }
  );
  assert.deepEqual(bands.map((b) => b.group), [...ORDER, "motivation"]);
});

test("bands stack downwards without overlapping", () => {
  const { bands } = toBandLayout(items, [], { order: ORDER, bandGap: 10 });
  for (let i = 1; i < bands.length; i++) {
    const previous = bands[i - 1];
    assert.equal(bands[i].y, previous.y + previous.height + 10);
  }
});

test("every node sits inside its own band", () => {
  const { bands, nodes } = toBandLayout(items, [], { order: ORDER });
  const byGroup = new Map(bands.map((b) => [b.group, b]));
  for (const node of nodes) {
    const band = byGroup.get(node.group);
    assert.ok(node.y >= band.y, `${node.id} starts above its band`);
    assert.ok(
      node.y + node.h <= band.y + band.height,
      `${node.id} ends below its band`
    );
  }
});

test("nodes wrap at the column count and the band grows a row", () => {
  const many = Array.from({ length: 7 }, (_, i) => ({ id: `n${i}`, group: "g" }));
  const { bands, nodes } = toBandLayout(many, [], { columns: 3 });
  assert.deepEqual(nodes.map((n) => n.row), [0, 0, 0, 1, 1, 1, 2]);
  assert.deepEqual(nodes.map((n) => n.column), [0, 1, 2, 0, 1, 2, 0]);

  const oneRow = toBandLayout(many.slice(0, 3), [], { columns: 3 });
  assert.ok(bands[0].height > oneRow.bands[0].height);
});

test("no two nodes overlap", () => {
  const many = Array.from({ length: 12 }, (_, i) => ({ id: `n${i}`, group: "g" }));
  const { nodes } = toBandLayout(many, [], { columns: 4 });
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i];
      const b = nodes[j];
      const apart =
        a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y;
      assert.ok(apart, `${a.id} overlaps ${b.id}`);
    }
  }
});

test("a cross-band edge leaves the upper box's bottom and meets the lower box's top", () => {
  const { nodes, edges } = toBandLayout(items, [["a1", "t1"]], { order: ORDER });
  const a1 = nodes.find((n) => n.id === "a1");
  const t1 = nodes.find((n) => n.id === "t1");
  const [edge] = edges;

  assert.equal(edge.lateral, false);
  assert.equal(edge.x1, a1.x + a1.w / 2);
  assert.equal(edge.y1, a1.y + a1.h, "should leave the bottom edge");
  assert.equal(edge.x2, t1.x + t1.w / 2);
  assert.equal(edge.y2, t1.y, "should meet the top edge");
});

test("a cross-band edge drawn upwards is routed the other way round", () => {
  const { nodes, edges } = toBandLayout(items, [["t1", "a1"]], { order: ORDER });
  const t1 = nodes.find((n) => n.id === "t1");
  const a1 = nodes.find((n) => n.id === "a1");
  const [edge] = edges;
  assert.equal(edge.y1, t1.y, "leaves the top of the lower node");
  assert.equal(edge.y2, a1.y + a1.h, "meets the bottom of the upper node");
});

test("a same-row edge runs side to side, oriented from source to target", () => {
  const { nodes, edges } = toBandLayout(items, [["a1", "a2"]], { order: ORDER });
  const a1 = nodes.find((n) => n.id === "a1");
  const a2 = nodes.find((n) => n.id === "a2");
  const [edge] = edges;

  assert.equal(edge.lateral, true);
  assert.equal(edge.x1, a1.x + a1.w, "leaves a1's right side");
  assert.equal(edge.x2, a2.x, "meets a2's left side");
  assert.equal(edge.y1, a1.y + a1.h / 2);
});

test("the same edge reversed swaps which sides it touches", () => {
  const { nodes, edges } = toBandLayout(items, [["a2", "a1"]], { order: ORDER });
  const a2 = nodes.find((n) => n.id === "a2");
  const a1 = nodes.find((n) => n.id === "a1");
  const [edge] = edges;
  assert.equal(edge.x1, a2.x, "leaves a2's left side");
  assert.equal(edge.x2, a1.x + a1.w, "meets a1's right side");
});

test("an edge within one band is lateral even when it crosses rows", () => {
  const many = Array.from({ length: 4 }, (_, i) => ({ id: `n${i}`, group: "g" }));
  const { edges } = toBandLayout(many, [["n0", "n3"]], { columns: 2 });
  assert.equal(edges[0].lateral, true, "same band, different rows");
});

test("edges naming an absent node are dropped", () => {
  const { edges } = toBandLayout(items, [["a1", "ghost"]], { order: ORDER });
  assert.deepEqual(edges, []);
});

test("the box is as wide as the fullest row, not the total element count", () => {
  const many = Array.from({ length: 9 }, (_, i) => ({ id: `n${i}`, group: "g" }));
  const { width } = toBandLayout(many, [], {
    columns: 3,
    labelWidth: 100,
    nodeWidth: 50,
    gapX: 10,
    padding: 0,
  });
  assert.equal(width, 100 + 3 * 50 + 2 * 10);
});

test("the box leaves room to the right of the last column", () => {
  // Without this the rightmost stroke is half-clipped and the canvas reads as
  // cut off. It was found by rendering the canvas and looking at it, not by
  // any assertion about coordinates.
  const many = Array.from({ length: 3 }, (_, i) => ({ id: `n${i}`, group: "g" }));
  const { width, nodes } = toBandLayout(many, [], { columns: 3, padding: 16 });
  const rightmost = Math.max(...nodes.map((n) => n.x + n.w));
  assert.equal(width - rightmost, 16);
});

test("the layout is deterministic", () => {
  assert.deepEqual(
    toBandLayout(items, [["a1", "t1"]], { order: ORDER }),
    toBandLayout(items, [["a1", "t1"]], { order: ORDER })
  );
});

test("an empty model lays out without throwing", () => {
  const { bands, nodes, edges, height } = toBandLayout([]);
  assert.deepEqual([bands, nodes, edges], [[], [], []]);
  assert.equal(height, 0);
});
