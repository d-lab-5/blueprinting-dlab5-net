import { test } from "node:test";
import assert from "node:assert/strict";

import { hexPoints, toHexNavigator } from "../dist/index.js";

/** Every "x,y" pair in a path, as numbers. */
const coords = (path) =>
  [...path.matchAll(/(-?\d+\.\d+),(-?\d+\.\d+)/g)].map((m) => [
    Number(m[1]),
    Number(m[2]),
  ]);

test("a hexagon has six distinct corners, all at the given radius", () => {
  const points = coords(hexPoints(100, 100, 50));
  assert.equal(points.length, 6);
  assert.equal(new Set(points.map(String)).size, 6);
  for (const [x, y] of points) {
    assert.ok(Math.abs(Math.hypot(x - 100, y - 100) - 50) < 0.01);
  }
});

test("the core cell is a closed hexagon centred on the figure", () => {
  const { cells, cx, cy } = toHexNavigator([
    { id: "core", label: "Core", band: 0, wedge: 0 },
  ]);
  const [core] = cells;
  assert.equal(core.ring, false);
  assert.ok(core.path.startsWith("M") && core.path.endsWith("Z"));
  assert.equal(coords(core.path).length, 6);
  assert.equal(core.labelX, cx);
  assert.equal(core.labelY, cy);
});

test("a band with one cell is a ring: two hexagons for an even-odd fill", () => {
  const { cells } = toHexNavigator([
    { id: "core", label: "Core", band: 0, wedge: 0 },
    { id: "ring", label: "Ring", band: 1, wedge: 0 },
  ]);
  const ring = cells.find((c) => c.id === "ring");
  assert.equal(ring.ring, true);
  assert.equal(coords(ring.path).length, 12, "outer hexagon plus inner hexagon");
  assert.equal((ring.path.match(/Z/g) ?? []).length, 2);
});

test("three wedges each span 120 degrees and together close the band", () => {
  const specs = [
    { id: "core", label: "Core", band: 0, wedge: 0 },
    ...[0, 1, 2].map((w) => ({ id: `w${w}`, label: `W${w}`, band: 1, wedge: w })),
  ];
  const { cells, cx, cy } = toHexNavigator(specs, { radii: [50, 100] });
  const wedges = cells.filter((c) => c.band === 1);
  assert.equal(wedges.length, 3);

  for (const wedge of wedges) {
    assert.equal(wedge.ring, false);
    // 120 degrees is two 60-degree hops, so three outer corners and three
    // inner ones.
    assert.equal(coords(wedge.path).length, 6);
  }

  // The three label points are 120 degrees apart, which is what "the band is
  // evenly divided" means in practice.
  const angles = wedges
    .map((w) => (Math.atan2(w.labelY - cy, w.labelX - cx) * 180) / Math.PI)
    .map((a) => (a + 360) % 360)
    .sort((a, b) => a - b);
  assert.ok(Math.abs(angles[1] - angles[0] - 120) < 0.01);
  assert.ok(Math.abs(angles[2] - angles[1] - 120) < 0.01);
});

test("six wedges are allowed and each spans one hexagon edge", () => {
  const specs = [
    { id: "core", label: "Core", band: 0, wedge: 0 },
    ...[0, 1, 2, 3, 4, 5].map((w) => ({
      id: `w${w}`,
      label: `W${w}`,
      band: 1,
      wedge: w,
    })),
  ];
  const { cells } = toHexNavigator(specs, { radii: [50, 100] });
  const wedges = cells.filter((c) => c.band === 1);
  assert.equal(wedges.length, 6);
  for (const wedge of wedges) {
    assert.equal(coords(wedge.path).length, 4, "two outer corners, two inner");
  }
});

test("a wedge count that does not divide six is refused", () => {
  const specs = [
    { id: "core", label: "Core", band: 0, wedge: 0 },
    ...[0, 1, 2, 3].map((w) => ({ id: `w${w}`, label: `W${w}`, band: 1, wedge: w })),
  ];
  assert.throws(
    () => toHexNavigator(specs, { radii: [50, 100] }),
    /1, 2, 3 or 6/
  );
});

test("a band with no radius is refused rather than drawn at NaN", () => {
  assert.throws(
    () =>
      toHexNavigator([{ id: "x", label: "X", band: 4, wedge: 0 }], {
        radii: [50, 100],
      }),
    /no radius/
  );
});

test("every label point lies inside its own band", () => {
  const specs = [
    { id: "core", label: "Core", band: 0, wedge: 0 },
    { id: "ring", label: "Ring", band: 1, wedge: 0 },
    ...[0, 1, 2].map((w) => ({ id: `a${w}`, label: `A${w}`, band: 2, wedge: w })),
    ...[0, 1, 2].map((w) => ({ id: `b${w}`, label: `B${w}`, band: 3, wedge: w })),
  ];
  const radii = [70, 122, 220, 300];
  const { cells, cx, cy } = toHexNavigator(specs, { radii });

  for (const cell of cells) {
    const distance = Math.hypot(cell.labelX - cx, cell.labelY - cy);
    const inner = cell.band === 0 ? 0 : radii[cell.band - 1];
    const outer = radii[cell.band];
    assert.ok(
      distance >= inner - 0.01 && distance <= outer + 0.01,
      `${cell.id} labels at ${distance.toFixed(1)}, band is ${inner}..${outer}`
    );
  }
});

test("the figure is square and wraps the outermost band with its padding", () => {
  const { size } = toHexNavigator(
    [
      { id: "core", label: "Core", band: 0, wedge: 0 },
      { id: "ring", label: "Ring", band: 1, wedge: 0 },
    ],
    { radii: [50, 100], padding: 10 }
  );
  assert.equal(size, 100 * 2 + 10 * 2);
});

test("cells come out in wedge order regardless of the order supplied", () => {
  const shuffled = [
    { id: "c", label: "C", band: 1, wedge: 2 },
    { id: "a", label: "A", band: 1, wedge: 0 },
    { id: "b", label: "B", band: 1, wedge: 1 },
  ];
  const { cells } = toHexNavigator(shuffled, { radii: [50, 100] });
  assert.deepEqual(
    cells.map((c) => c.id),
    ["a", "b", "c"]
  );
});

test("the layout is deterministic", () => {
  const specs = [
    { id: "core", label: "Core", band: 0, wedge: 0 },
    ...[0, 1, 2].map((w) => ({ id: `w${w}`, label: `W${w}`, band: 1, wedge: w })),
  ];
  assert.deepEqual(toHexNavigator(specs), toHexNavigator(specs));
});

test("wedge corners land on the hexagon, not on a circle inside it", () => {
  // The defect this catches: with a start angle that is not a multiple of 60,
  // every wedge corner sits on a circle of radius r instead of on a hexagon
  // corner, and the band draws as an inscribed polygon that visibly does not
  // follow the outline. It is invisible to a build and obvious in a picture.
  const specs = [0, 1, 2].map((w) => ({ id: `w${w}`, label: `W${w}`, band: 1, wedge: w }));
  const { cells, cx, cy } = toHexNavigator(specs, { radii: [50, 100] });

  const corners = new Set(
    coords(hexPoints(cx, cy, 100)).map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`)
  );

  for (const cell of cells) {
    const outer = coords(cell.path).filter(
      ([x, y]) => Math.abs(Math.hypot(x - cx, y - cy) - 100) < 0.01
    );
    assert.ok(outer.length > 0, `${cell.id} has no outer corners`);
    for (const [x, y] of outer) {
      assert.ok(
        corners.has(`${x.toFixed(1)},${y.toFixed(1)}`),
        `${cell.id} has an outer point at ${x.toFixed(1)},${y.toFixed(1)} that is not a hexagon corner`
      );
    }
  }
});

test("a start angle off the 60-degree grid is refused", () => {
  const specs = [0, 1, 2].map((w) => ({ id: `w${w}`, label: `W${w}`, band: 1, wedge: w }));
  assert.throws(
    () => toHexNavigator(specs, { radii: [50, 100], startAngle: -90 }),
    /multiple of 60/
  );
  assert.throws(
    () => toHexNavigator(specs, { radii: [50, 100], bandStartAngle: { 1: 45 } }),
    /multiple of 60/
  );
});

test("a band can be rotated independently so stacked labels do not align", () => {
  const specs = [
    ...[0, 1, 2].map((w) => ({ id: `a${w}`, label: `A${w}`, band: 1, wedge: w })),
    ...[0, 1, 2].map((w) => ({ id: `b${w}`, label: `B${w}`, band: 2, wedge: w })),
  ];
  const { cells, cx, cy } = toHexNavigator(specs, {
    radii: [40, 80, 120],
    bandStartAngle: { 2: 60 },
  });

  const angleOf = (cell) =>
    Math.round(((Math.atan2(cell.labelY - cy, cell.labelX - cx) * 180) / Math.PI + 360) % 360);

  const inner = cells.filter((c) => c.band === 1).map(angleOf).sort((x, y) => x - y);
  const outer = cells.filter((c) => c.band === 2).map(angleOf).sort((x, y) => x - y);
  assert.notDeepEqual(inner, outer, "the two bands put labels on the same radial lines");
});

test("a full ring labels at the top, above the core", () => {
  const { cells, cx, cy } = toHexNavigator(
    [
      { id: "core", label: "Core", band: 0, wedge: 0 },
      { id: "ring", label: "Ring", band: 1, wedge: 0 },
    ],
    { radii: [50, 100] }
  );
  const ring = cells.find((c) => c.id === "ring");
  assert.equal(ring.labelX, cx);
  assert.ok(ring.labelY < cy, "the ring label should sit above the centre");
});
