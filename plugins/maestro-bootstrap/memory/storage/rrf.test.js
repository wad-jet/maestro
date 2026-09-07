import { test } from "node:test";
import assert from "node:assert/strict";
import { fuseRrf } from "./rrf.js";

test("fuseRrf: single key, vector + text fusion, order by rrf", async () => {
  const vectorHits = [
    { entry: { session_id: "v1" }, score: 0.9 },
    { entry: { session_id: "v2" }, score: 0.8 },
  ];
  const textHitLists = [[{ session_id: "t1" }, { session_id: "v1" }]];
  const fetched = new Map([["t1", { session_id: "t1" }]]);
  const out = await fuseRrf(vectorHits, textHitLists, { fetchEntry: async (sid) => fetched.get(sid) });
  assert.deepEqual(out.map((h) => h.entry.session_id), ["v1", "t1", "v2"]);
  assert.equal(out[1].score, 0.5);
});

test("fuseRrf: cross-key, two text lists fuse with shared vector list", async () => {
  const vectorHits = [
    { entry: { session_id: "k1a" }, score: 0.9 },
    { entry: { session_id: "k2a" }, score: 0.7 },
  ];
  const textHitLists = [
    [{ session_id: "k1b" }],
    [{ session_id: "k2b" }, { session_id: "k1a" }],
  ];
  const all = { k1b: { session_id: "k1b" }, k2b: { session_id: "k2b" } };
  const out = await fuseRrf(vectorHits, textHitLists, { fetchEntry: async (sid) => all[sid] });
  assert.deepEqual(out.map((h) => h.entry.session_id), ["k1a", "k1b", "k2b", "k2a"]);
});
