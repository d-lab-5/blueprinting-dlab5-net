import { test } from "node:test";
import assert from "node:assert/strict";

import { clearSessionCache, exchangeApiKey, RefusedKey } from "../dist/session.js";
import { handleMcp } from "../dist/http.js";
import { HOSTED_TOOLS, DIAGRAM_TOOLS } from "../dist/tools.js";

/**
 * The hosted server's two promises: a key becomes its owner's session and
 * nobody else's, and a request is answered with its own key's identity even
 * when others are in flight. Cognito and AppSync are faked; what is tested is
 * the plumbing between them, which is where a cross-tenant leak would live.
 */

const KEY_A = "bp_aaaaaaaa_" + "a".repeat(32);
const KEY_B = "bp_bbbbbbbb_" + "b".repeat(32);

const jwt = (claims) =>
  ["e30", Buffer.from(JSON.stringify(claims)).toString("base64url"), "sig"].join(".");

function fakeConfig({ keys, now = () => Date.now(), calls = [] }) {
  return {
    region: "eu-central-1",
    readClientId: "read-client",
    writeClientId: "write-client",
    now,
    lookupKey: async (keyId) => keys[keyId] ?? null,
    cognito: async (target, body) => {
      calls.push({ target, body });
      if (target === "InitiateAuth") return { Session: "s" };
      const user = body.ChallengeResponses.USERNAME;
      return {
        AuthenticationResult: {
          AccessToken: jwt({ sub: user, client: body.ClientId, exp: Math.floor(now() / 1000) + 3600 }),
        },
      };
    },
  };
}

test("a key is exchanged as its owner, on the client its scope names", async () => {
  clearSessionCache();
  const calls = [];
  const config = fakeConfig({
    keys: { aaaaaaaa: { ownerSub: "user-a", scope: "write" }, bbbbbbbb: { ownerSub: "user-b", scope: "read" } },
    calls,
  });
  const a = JSON.parse(Buffer.from((await exchangeApiKey(KEY_A, config)).split(".")[1], "base64url"));
  const b = JSON.parse(Buffer.from((await exchangeApiKey(KEY_B, config)).split(".")[1], "base64url"));
  assert.deepEqual([a.sub, a.client], ["user-a", "write-client"]);
  assert.deepEqual([b.sub, b.client], ["user-b", "read-client"]);
  assert.equal(calls.find((c) => c.target === "RespondToAuthChallenge").body.ChallengeResponses.ANSWER, KEY_A);
});

test("tokens are cached per key, never shared, and renewed before they lapse", async () => {
  clearSessionCache();
  let clock = 1_000_000_000_000;
  const calls = [];
  const config = fakeConfig({
    keys: { aaaaaaaa: { ownerSub: "user-a", scope: "read" }, bbbbbbbb: { ownerSub: "user-b", scope: "read" } },
    now: () => clock,
    calls,
  });
  const first = await exchangeApiKey(KEY_A, config);
  assert.equal(await exchangeApiKey(KEY_A, config), first, "the same key reuses its token");
  assert.notEqual(await exchangeApiKey(KEY_B, config), first, "another key never gets it");
  assert.equal(calls.length, 4, "two exchanges, two round trips each");

  clock += 56 * 60 * 1000; // inside the five-minute margin of a sixty-minute token
  await exchangeApiKey(KEY_A, config);
  assert.equal(calls.length, 6, "renewed before expiry");
});

test("malformed and unknown keys are refused with the same words", async () => {
  clearSessionCache();
  const config = fakeConfig({ keys: {} });
  const malformed = await exchangeApiKey("not-a-key", config).catch((e) => e);
  const unknown = await exchangeApiKey(KEY_A, config).catch((e) => e);
  assert.ok(malformed instanceof RefusedKey && unknown instanceof RefusedKey);
  assert.equal(malformed.message, unknown.message);
});

test("the hosted tool list is everything except the SAP diagram tools", () => {
  const names = new Set(HOSTED_TOOLS.map((t) => t.name));
  for (const tool of DIAGRAM_TOOLS) assert.ok(!names.has(tool.name), tool.name);
  assert.ok(!names.has("sap_diagram_from_model"));
  for (const name of ["get_model", "get_radar", "add_element", "set_element_properties", "put_document"]) {
    assert.ok(names.has(name), name);
  }
});

/* -- the HTTP handler ------------------------------------------------------- */

const rpc = (body, key) =>
  new Request("https://mcp.example/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...(key ? { authorization: `Bearer ${key}` } : {}),
    },
    body: JSON.stringify(body),
  });

const INIT = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "0" } },
};

/** A fake AppSync client whose only project names its owner. */
const clientFor = (token) => ({
  models: {
    Project: { list: async () => ({ data: [{ slug: `p-of-${token}`, name: token, group: "g" }] }) },
    Document: { list: async () => ({ data: [] }) },
  },
  mutations: {},
});

const authenticate = async (key) => {
  if (key === KEY_A) return "alice";
  if (key === KEY_B) return "bob";
  throw new RefusedKey("The API key was not accepted.");
};

test("no key, or a wrong one, is 401 before anything else happens", async () => {
  for (const key of [undefined, "bp_zzzzzzzz_" + "z".repeat(32)]) {
    const response = await handleMcp(rpc(INIT, key), authenticate, clientFor);
    assert.equal(response.status, 401);
    assert.equal(response.headers.get("www-authenticate"), "Bearer");
  }
});

test("the health check needs no key and says nothing", async () => {
  const response = await handleMcp(new Request("https://mcp.example/healthz"), authenticate, clientFor);
  assert.equal(await response.text(), "ok");
});

test("tools/list over HTTP is the hosted list", async () => {
  const response = await handleMcp(
    rpc({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }, KEY_A),
    authenticate,
    clientFor
  );
  assert.equal(response.status, 200);
  const names = (await response.json()).result.tools.map((t) => t.name).sort();
  assert.deepEqual(names, HOSTED_TOOLS.map((t) => t.name).sort());
});

test("concurrent requests each see their own key's identity", async () => {
  const call = (key, id) =>
    handleMcp(
      rpc({ jsonrpc: "2.0", id, method: "tools/call", params: { name: "list_projects", arguments: {} } }, key),
      authenticate,
      clientFor
    ).then((r) => r.json());

  const results = await Promise.all(
    Array.from({ length: 20 }, (_, i) => call(i % 2 ? KEY_B : KEY_A, i))
  );
  for (const [i, result] of results.entries()) {
    const owner = i % 2 ? "bob" : "alice";
    const text = result.result.content[0].text;
    assert.ok(text.includes(`p-of-${owner}`), `request ${i} answered as ${owner}`);
    assert.ok(!text.includes(`p-of-${owner === "bob" ? "alice" : "bob"}`), `request ${i} saw nobody else`);
  }
});
