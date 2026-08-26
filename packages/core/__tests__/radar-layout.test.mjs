import { test } from "node:test";
import assert from "node:assert/strict";

import { RADAR_RINGS, toRadar, toRadarLayout } from "../dist/index.js";

/** Four quadrants, entries across every ring, as a real radar has. */
const model = {
  projectSlug: "radar",
  elements: [
    { id: "q1", type: "Grouping", name: "Languages & Frameworks", properties: {} },
    { id: "q2", type: "Grouping", name: "Platforms", properties: {} },
    { id: "q3", type: "Grouping", name: "Tools", properties: {} },
    { id: "q4", type: "Grouping", name: "Techniques", properties: {} },
    ...["adopt", "adopt", "trial", "assess", "hold"].flatMap((ring, i) =>
      [1, 2, 3, 4].map((q) => ({
        id: `e${q}-${i}`,
        type: "ApplicationComponent",
        name: `Entry ${q}.${i}`,
        properties: { radarRing: ring },
      }))
    ),
  ],
  relationships: ["adopt", "adopt", "trial", "assess", "hold"].flatMap((_, i) =>
    [1, 2, 3, 4].map((q) => ({
      id: `r${q}-${i}`,
      type: "aggregation",
      source: `q${q}`,
      target: `e${q}-${i}`,
      properties: {},
    }))
  ),
};

const quadrants = toRadar(model);

test("every entry becomes a blip, numbered once", () => {
  const layout = toRadarLayout(quadrants);
  assert.equal(layout.blips.length, 20);
  const numbers = layout.blips.map((b) => b.number).sort((a, b) => a - b);
  assert.deepEqual(numbers, Array.from({ length: 20 }, (_, i) => i + 1));
});

test("a blip sits inside its own ring band, always", () => {
  const layout = toRadarLayout(quadrants);
  for (const blip of layout.blips) {
    const radius = Math.hypot(blip.x, blip.y);
    const inner = blip.ringIndex === 0 ? 0 : layout.ringRadii[blip.ringIndex - 1];
    const outer = layout.ringRadii[blip.ringIndex];
    assert.ok(
      radius > inner && radius <= outer,
      `${blip.label} at r=${radius.toFixed(3)} is outside ring ${blip.ring} (${inner.toFixed(3)}..${outer.toFixed(3)})`
    );
  }
});

test("a blip sits inside its own quadrant sector", () => {
  const layout = toRadarLayout(quadrants);
  for (const blip of layout.blips) {
    const sector = layout.sectors[blip.quadrantIndex];
    // Clockwise from twelve o'clock; y is negated for SVG.
    let angle = Math.atan2(blip.x, -blip.y);
    if (angle < 0) angle += Math.PI * 2;
    assert.ok(
      angle >= sector.startAngle && angle <= sector.endAngle,
      `${blip.label} at ${angle.toFixed(3)} rad is outside ${sector.name}`
    );
  }
});

test("adopt is nearer the centre than hold", () => {
  const layout = toRadarLayout(quadrants);
  const radiusOf = (ring) =>
    layout.blips
      .filter((b) => b.ring === ring)
      .map((b) => Math.hypot(b.x, b.y));
  const maxAdopt = Math.max(...radiusOf("adopt"));
  const minHold = Math.min(...radiusOf("hold"));
  assert.ok(maxAdopt < minHold, "the rings must not interleave");
});

test("the layout is deterministic", () => {
  // A random layout makes every re-render a visual diff and every screenshot
  // useless for comparison.
  const a = toRadarLayout(quadrants);
  const b = toRadarLayout(quadrants);
  assert.deepEqual(
    a.blips.map((x) => [x.id, x.x, x.y]),
    b.blips.map((x) => [x.id, x.x, x.y])
  );
});

test("blips in the same band are pushed apart", () => {
  const layout = toRadarLayout(quadrants, { separation: 0.05 });
  for (const a of layout.blips) {
    for (const b of layout.blips) {
      if (a === b) continue;
      if (a.quadrantIndex !== b.quadrantIndex || a.ringIndex !== b.ringIndex) continue;
      const d = Math.hypot(b.x - a.x, b.y - a.y);
      assert.ok(d > 0.02, `${a.label} and ${b.label} overlap at ${d.toFixed(4)}`);
    }
  }
});

test("everything fits inside the unit circle", () => {
  const layout = toRadarLayout(quadrants);
  for (const blip of layout.blips) {
    assert.ok(Math.hypot(blip.x, blip.y) <= 1, `${blip.label} escaped the radar`);
  }
});

test("an empty radar produces sectors but no blips", () => {
  const layout = toRadarLayout([]);
  assert.deepEqual(layout.blips, []);
  assert.deepEqual(layout.sectors, []);
  assert.deepEqual([...layout.rings], [...RADAR_RINGS]);
});

test("a radar with an unusual number of quadrants still divides the circle", () => {
  // Quadrants come from Groupings, so there is nothing forcing four.
  const three = quadrants.slice(0, 3);
  const layout = toRadarLayout(three);
  assert.equal(layout.sectors.length, 3);
  const span = layout.sectors[0].endAngle - layout.sectors[0].startAngle;
  assert.ok(Math.abs(span - (Math.PI * 2) / 3) < 1e-9);
});
