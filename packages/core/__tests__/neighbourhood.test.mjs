import { test } from "node:test";
import assert from "node:assert/strict";

import { MAX_DEPTH, neighbourhood } from "../dist/index.js";

const el = (id) => ({ id, type: "ApplicationComponent", name: id, properties: {} });
const rel = (id, source, target) => ({
  id,
  type: "serving",
  source,
  target,
  properties: {},
});

/** a -> b -> c -> d, plus an unconnected island. */
const chain = {
  projectSlug: "t",
  elements: ["a", "b", "c", "d", "island"].map(el),
  relationships: [rel("r1", "a", "b"), rel("r2", "b", "c"), rel("r3", "c", "d")],
};

test("depth 1 reaches immediate neighbours and no further", () => {
  const { distance } = neighbourhood(chain, "b", 1);
  assert.deepEqual(
    [...distance.entries()].sort(),
    [["a", 1], ["b", 0], ["c", 1]]
  );
});

test("a relationship is followed against its direction too", () => {
  // b -> c, and asking from c must still find b.
  const { distance } = neighbourhood(chain, "c", 1);
  assert.ok(distance.has("b"), "an incoming relationship is part of the neighbourhood");
  assert.ok(distance.has("d"), "as is an outgoing one");
});

test("depth 2 reaches two hops, and records how far each element is", () => {
  const { distance } = neighbourhood(chain, "a", 2);
  assert.equal(distance.get("a"), 0);
  assert.equal(distance.get("b"), 1);
  assert.equal(distance.get("c"), 2);
  assert.ok(!distance.has("d"), "three hops away, so out of range");
});

test("one hop does not quietly become a transitive closure", () => {
  // The defect this guards: adding to the visited set while iterating the
  // relationships lets an element found in this pass be followed in the same
  // pass, so depth 1 walks the whole graph. It was a real bug in the MCP
  // server's version of this traversal.
  const { distance } = neighbourhood(chain, "a", 1);
  assert.equal(distance.size, 2, "just a and b");
});

test("an unconnected element is never reached", () => {
  const { distance } = neighbourhood(chain, "a", MAX_DEPTH);
  assert.ok(!distance.has("island"));
});

test("relationships come back only when both ends are inside", () => {
  const { relationships } = neighbourhood(chain, "b", 1);
  const ids = relationships.map((r) => r.id).sort();
  // a-b and b-c are wholly inside; c-d has one end outside.
  assert.deepEqual(ids, ["r1", "r2"]);
});

test("direction is preserved so a caller can still draw the arrow", () => {
  const { relationships } = neighbourhood(chain, "b", 1);
  const ab = relationships.find((r) => r.id === "r1");
  assert.equal(ab.source, "a");
  assert.equal(ab.target, "b");
});

test("depth is clamped rather than allowed to run away", () => {
  const deep = neighbourhood(chain, "a", 99);
  const max = neighbourhood(chain, "a", MAX_DEPTH);
  assert.deepEqual([...deep.distance.keys()].sort(), [...max.distance.keys()].sort());
});

test("depth below one is treated as one", () => {
  assert.equal(neighbourhood(chain, "a", 0).distance.size, 2);
  assert.equal(neighbourhood(chain, "a", -3).distance.size, 2);
});

test("the walk stops early when nothing new is reachable", () => {
  // d is a leaf; asking for five hops from it must not loop forever.
  const { distance } = neighbourhood(chain, "d", MAX_DEPTH);
  assert.deepEqual([...distance.keys()].sort(), ["a", "b", "c", "d"]);
});

test("an id that is not in the model yields an empty neighbourhood, not a throw", () => {
  const { distance, relationships } = neighbourhood(chain, "ghost", 2);
  assert.equal(distance.size, 0);
  assert.deepEqual(relationships, []);
});

test("a self-referential relationship does not loop", () => {
  const loop = {
    projectSlug: "t",
    elements: [el("a")],
    relationships: [rel("self", "a", "a")],
  };
  const { distance, relationships } = neighbourhood(loop, "a", 3);
  assert.deepEqual([...distance.entries()], [["a", 0]]);
  assert.equal(relationships.length, 1);
});
