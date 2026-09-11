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

test("fuseRrf: minScore post-filter drops hits with display score below threshold", async () => {
  const vectorHits = [
    { entry: { session_id: "v1" }, score: 0.9 },
    { entry: { session_id: "v2" }, score: 0.4 },
  ];
  const textHitLists = [[{ session_id: "t1" }]];
  const fetched = new Map([["t1", { session_id: "t1" }]]);
  // v1 (0.9) проходит; v2 (0.4) и text-only t1 (0.5) — ниже порога 0.6.
  const out = await fuseRrf(vectorHits, textHitLists, { fetchEntry: async (sid) => fetched.get(sid), minScore: 0.6 });
  assert.deepEqual(out.map((h) => h.entry.session_id), ["v1"]);
});

test("fuseRrf: minScore boundary is inclusive (score === minScore kept)", async () => {
  const vectorHits = [{ entry: { session_id: "v1" }, score: 0.5 }];
  const out = await fuseRrf(vectorHits, [], { minScore: 0.5 });
  assert.deepEqual(out.map((h) => h.entry.session_id), ["v1"]);
});
