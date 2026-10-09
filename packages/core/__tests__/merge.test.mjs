import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { mergeModels, parseAbox, validateModel, hasErrors } from "../dist/index.js";

const el = (id, name = id, type = "ApplicationComponent") => ({ id, type, name, properties: {} });
const rel = (id, source, target, type = "serving") => ({ id, type, source, target, properties: {} });
const model = (elements, relationships = []) => ({ projectSlug: "x", elements, relationships });

test("two files that both number a relationship r1 keep both", () => {
  const a = model([el("a"), el("b")], [rel("r1", "a", "b")]);
  const b = model([el("c"), el("d")], [rel("r1", "c", "d")]);
  const { model: merged, addedRelationships } = mergeModels(model([]), [a, b]);
  assert.equal(addedRelationships, 2);
  assert.deepEqual(merged.relationships.map((r) => r.id).sort(), ["a-serving-b", "c-serving-d"]);
});

test("the same element and the same relationship twice are added once", () => {
  const a = model([el("a"), el("b")], [rel("r1", "a", "b")]);
  const result = mergeModels(a, [a]);
  assert.equal(result.addedElements, 0);
  assert.equal(result.skippedElements, 2);
  assert.equal(result.skippedRelationships, 1);
  assert.equal(result.model.relationships.length, 1);
});

test("an element that differs is a conflict, not an overwrite", () => {
  const current = model([el("a", "Old name")]);
  const result = mergeModels(current, [model([el("a", "New name")])]);
  assert.equal(result.conflicts.length, 1);
  assert.equal(result.model.elements.find((e) => e.id === "a").name, "Old name");
});

test("the real pattern files merge without conflict and validate", () => {
  const files = ["cloud-edge-platform", "engineering-patterns", "technology-radar"].map((f) =>
    parseAbox(readFileSync(new URL(`../../../docs/patterns/${f}.ttl`, import.meta.url), "utf8"), f)
  );
  const result = mergeModels(model([]), files);
  assert.deepEqual(result.conflicts.map((c) => c.id), []);
  const total = files.reduce((n, m) => n + m.relationships.length, 0);
  assert.equal(result.addedRelationships + result.skippedRelationships, total, "no relationship lost");
  assert.ok(!hasErrors(validateModel({ ...result.model, projectSlug: "engineering-practices" })));
});
