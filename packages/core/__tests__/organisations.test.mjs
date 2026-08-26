import { test } from "node:test";
import assert from "node:assert/strict";

import { LAYER_ORDER } from "@dlab5/archimate-metamodel";
import { initialsOf, toOrganisations } from "../dist/index.js";

const element = (id, type, properties = {}) => ({ id, type, name: id, properties });
const model = (elements) => ({ projectSlug: "t", elements, relationships: [] });

const summarise = (elements) => toOrganisations(model(elements), LAYER_ORDER);

test("elements group by their owner property", () => {
  const { organisations } = summarise([
    element("a", "ApplicationComponent", { owner: "Platform guild" }),
    element("b", "ApplicationComponent", { owner: "Platform guild" }),
    element("c", "Node", { owner: "Infrastructure" }),
  ]);
  assert.deepEqual(
    organisations.map((o) => [o.name, o.elementCount]),
    [["Platform guild", 2], ["Infrastructure", 1]]
  );
});

test("an element with no owner is counted apart, not put in a team", () => {
  const { organisations, unowned } = summarise([
    element("a", "ApplicationComponent", { owner: "Platform guild" }),
    element("b", "ApplicationComponent"),
    element("c", "ApplicationComponent", { owner: "   " }),
  ]);
  assert.equal(organisations.length, 1);
  assert.equal(unowned, 2, "whitespace is not an owner");
});

test("mean debt averages over the elements that declare it, not over all", () => {
  // The rule that matters: if the unassessed element counted as zero the mean
  // would be 0.30, and a team could improve its score by assessing less.
  const { organisations } = summarise([
    element("a", "ApplicationComponent", { owner: "T", debt: "0.9" }),
    element("b", "ApplicationComponent", { owner: "T", debt: "0.3" }),
    element("c", "ApplicationComponent", { owner: "T" }),
  ]);
  assert.equal(organisations[0].meanDebt, 0.6);
  assert.equal(organisations[0].unassessed, 1);
});

test("a team with nothing assessed reports null rather than zero", () => {
  const { organisations } = summarise([
    element("a", "ApplicationComponent", { owner: "T" }),
  ]);
  assert.equal(organisations[0].meanDebt, null);
  assert.equal(organisations[0].unassessed, 1);
});

test("a malformed debt value counts as unassessed, not as clean", () => {
  const { organisations } = summarise([
    element("a", "ApplicationComponent", { owner: "T", debt: "quite bad" }),
    element("b", "ApplicationComponent", { owner: "T", debt: "0.5" }),
  ]);
  assert.equal(organisations[0].meanDebt, 0.5);
  assert.equal(organisations[0].unassessed, 1);
});

test("debt outside 0..1 is clamped rather than skewing the mean", () => {
  const { organisations } = summarise([
    element("a", "ApplicationComponent", { owner: "T", debt: "7" }),
    element("b", "ApplicationComponent", { owner: "T", debt: "-3" }),
  ]);
  assert.equal(organisations[0].meanDebt, 0.5);
});

test("layers come out in specification order, deduplicated", () => {
  const { organisations } = summarise([
    element("a", "Node", { owner: "T" }),
    element("b", "ApplicationComponent", { owner: "T" }),
    element("c", "Node", { owner: "T" }),
    element("d", "Goal", { owner: "T" }),
  ]);
  assert.deepEqual(organisations[0].layers, ["motivation", "application", "technology"]);
});

test("teams sort by size, then by name, so the order never depends on file order", () => {
  const { organisations } = summarise([
    element("a", "Node", { owner: "Zebra" }),
    element("b", "Node", { owner: "Alpha" }),
    element("c", "Node", { owner: "Big" }),
    element("d", "Node", { owner: "Big" }),
  ]);
  assert.deepEqual(organisations.map((o) => o.name), ["Big", "Alpha", "Zebra"]);
});

test("initials take the first letter of the first two words", () => {
  assert.equal(initialsOf("Platform guild"), "PG");
  assert.equal(initialsOf("Architecture board of review"), "AB");
  assert.equal(initialsOf("Infrastructure"), "I");
  assert.equal(initialsOf("data.platform"), "DP");
  assert.equal(initialsOf("   "), "?", "never empty, or the avatar is a blank circle");
});

test("a model with no owners anywhere summarises to nothing, not to a crash", () => {
  const { organisations, unowned } = summarise([
    element("a", "ApplicationComponent"),
  ]);
  assert.deepEqual(organisations, []);
  assert.equal(unowned, 1);
});
