import { test } from "node:test";
import assert from "node:assert/strict";

import {
  PRODUCT_ID,
  isMintedProductId,
  mintProductId,
  parseAbox,
  serializeAbox,
} from "../dist/index.js";

test("a minted id is a legal slug, so nothing downstream changes shape", () => {
  // The pattern projectAdmin enforces before it will create a product.
  const legalSlug = /^[a-z0-9-]{3,50}$/;
  for (let i = 0; i < 200; i++) {
    const id = mintProductId();
    assert.match(id, legalSlug, `${id} is not a legal slug`);
    assert.match(id, PRODUCT_ID);
    assert.ok(isMintedProductId(id));
  }
});

test("a minted id cannot spell a word: no vowels, and no confusable digits", () => {
  for (let i = 0; i < 200; i++) {
    const body = mintProductId().slice(2);
    assert.ok(!/[aeiou]/.test(body), `${body} contains a vowel`);
    assert.ok(!/[01lo]/.test(body), `${body} contains a confusable character`);
  }
});

test("ids do not collide in a realistic number of products", () => {
  const seen = new Set();
  for (let i = 0; i < 5000; i++) seen.add(mintProductId());
  assert.equal(seen.size, 5000);
});

test("a readable slug is not mistaken for a minted id", () => {
  // The three products that predate ADR-0009 keep their readable slugs, and
  // nothing may treat them as minted.
  for (const slug of ["dlab5-blueprint", "engineering-practices", "p-short"]) {
    assert.equal(isMintedProductId(slug), false, slug);
  }
});

test("bytes at or above the rejection threshold are discarded, not folded", () => {
  // 256 % 27 === 13, so bytes 243..255 must be skipped. Folding them with a
  // modulo would make the first 13 letters of the alphabet likelier. Feed it
  // nothing but rejectable bytes followed by zeros: a biased implementation
  // would consume the 255s, a correct one skips them entirely.
  const script = [...Array(10).fill(255), ...Array(10).fill(0)];
  let at = 0;
  const id = mintProductId((n) => {
    const out = new Uint8Array(n);
    for (let i = 0; i < n; i++) out[i] = script[at++ % script.length];
    return out;
  });
  assert.equal(id, "p-2222222222");
});

/* -- the property that makes re-identification possible -------------------- */

test("re-identifying a product rewrites every IRI, because none are stored", async () => {
  // ADR-0010 re-ids a product by parsing under its old id and serializing
  // under a new one. That is only safe because IRIs are DERIVED from
  // model.projectSlug at serialization time. If any IRI were carried through
  // the parse, the re-identified model would still claim the old identity.
  const model = {
    projectSlug: "old-slug",
    elements: [
      { id: "a", type: "BusinessActor", name: "A", properties: { owner: "x" } },
      { id: "b", type: "BusinessRole", name: "B", properties: {} },
    ],
    relationships: [
      { id: "a-assignment-b", type: "assignment", source: "a", target: "b", properties: {} },
    ],
  };

  const before = await serializeAbox(model);
  assert.ok(before.includes("/i/old-slug/"), "the old id should be in the IRIs");

  const reparsed = parseAbox(before, "old-slug");
  const after = await serializeAbox({ ...reparsed, projectSlug: "p-7f3k2b9c4d" });

  assert.ok(!after.includes("old-slug"), "the old id survived the rewrite");
  assert.ok(after.includes("/i/p-7f3k2b9c4d/"), "the new id is not in the IRIs");

  // And nothing else changed: same elements, same relationships, same properties.
  const round = parseAbox(after, "p-7f3k2b9c4d");
  assert.deepEqual(
    round.elements.map((e) => [e.id, e.type, e.name, e.properties]),
    reparsed.elements.map((e) => [e.id, e.type, e.name, e.properties])
  );
  assert.deepEqual(
    round.relationships.map((r) => [r.id, r.type, r.source, r.target]),
    reparsed.relationships.map((r) => [r.id, r.type, r.source, r.target])
  );
});
