import { test } from "node:test";
import assert from "node:assert/strict";
import { QdrantStorage } from "./qdrant.js";

function fakeClient() {
  const calls = [];
  return {
    calls,
    collectionExists: async (name) => {
      calls.push(["exists", name]);
      return { exists: false };
    },
    createCollection: async (name, opts) => {
      calls.push(["create", name, opts]);
    },
    upsert: async (name, { points }) => {
      calls.push(["upsert", name, points.length]);
    },
    query: async (name, q) => {
      calls.push(["query", name, q]);
      return { points: [{ id: "s1", score: 0.9, payload: { title: "t", summary: "s", decisions: "[]", key: "k" } }] };
    },
    delete: async (name, opts) => {
      calls.push(["delete", name, opts]);
    },
    count: async (name) => {
      calls.push(["count", name]);
      return { count: 1 };
    },
  };
}

test("qdrant init creates collection with dim from model", async () => {
  const c = fakeClient();
  const st = new QdrantStorage({ client: c, collection: "maestro_memory", modelId: "m", dim: 3 });
  await st.init();
  const create = c.calls.find(([k]) => k === "create");
  assert.ok(create);
  assert.equal(create[2].vectors.size, 3);
  assert.equal(create[2].vectors.distance, "Cosine");
});

test("qdrant search uses query with key payload filter", async () => {
  const c = fakeClient();
  const st = new QdrantStorage({ client: c, collection: "maestro_memory", modelId: "m", dim: 3 });
  await st.init();
  await st.search(new Float32Array([0.1, 0.2, 0.3]), { top_k: 3, min_score: 0.35, key: "k1" });
  const query = c.calls.find(([k]) => k === "query");
  assert.ok(query);
  // query uses { nearest: vector } structure; Float32Array→Array.from() adds precision noise
  const nearest = query[2].query.nearest;
  assert.equal(nearest.length, 3);
  assert.ok(nearest.every((v, i) => Math.abs(v - [0.1, 0.2, 0.3][i]) < 1e-6));
  assert.deepEqual(query[2].filter.must[0], { key: "key", match: { value: "k1" } });
});

test("qdrant search requires key", async () => {
  const c = fakeClient();
  const st = new QdrantStorage({ client: c, collection: "maestro_memory", modelId: "m", dim: 3 });
  await st.init();
  await assert.rejects(() => st.search(new Float32Array([0.1, 0.2, 0.3]), { top_k: 3, min_score: 0.35 }), /key required/);
});

test("qdrant upsert maps entries to points with payload", async () => {
  const c = fakeClient();
  let capturedPoints = null;
  c.upsert = async (name, { points }) => {
    c.calls.push(["upsert", name, points.length]);
    capturedPoints = points;
  };
  const st = new QdrantStorage({ client: c, collection: "maestro_memory", modelId: "m", dim: 3 });
  await st.init();
  await st.upsert([{
    session_id: "s1", key: "k1", origin_project_hash: "h1", title: "Test",
    summary: "Summary", decisions: ["d1"], embedding: new Float32Array([0.1, 0.2, 0.3]),
    model_id: "m", author: "alice", time_first: 100, time_last: 200, version: 1,
  }]);
  const upsert = c.calls.find(([k]) => k === "upsert");
  assert.ok(upsert);
  assert.equal(upsert[2], 1);
  assert.ok(capturedPoints);
  assert.equal(capturedPoints.length, 1);
  const point = capturedPoints[0];
  assert.equal(point.payload.key, "k1");
  assert.equal(point.payload.session_id, "s1");
  assert.equal(point.payload.title, "Test");
  assert.deepEqual(point.payload.decisions, JSON.stringify(["d1"]));
  // Float32Array→Array.from() introduces ~1e-9 precision; use toFixed comparison
  assert.equal(point.vector.length, 3);
  assert.ok(point.vector.every((v, i) => Math.abs(v - [0.1, 0.2, 0.3][i]) < 1e-6));
});

test("qdrant search parses decisions and returns scored results", async () => {
  const c = fakeClient();
  c.query = async (name, q) => {
    c.calls.push(["query", name, q]);
    return { points: [{ id: "p1", score: 0.85, payload: { title: "t1", summary: "s1", decisions: '["dec"]', key: "k1" } }] };
  };
  const st = new QdrantStorage({ client: c, collection: "maestro_memory", modelId: "m", dim: 3 });
  await st.init();
  const res = await st.search(new Float32Array([0.1, 0.2, 0.3]), { top_k: 3, min_score: 0.5, key: "k1" });
  assert.equal(res.length, 1);
  assert.equal(res[0].score, 0.85);
  assert.equal(res[0].entry.title, "t1");
  assert.deepEqual(res[0].entry.decisions, ["dec"]);
  assert.equal(res[0].entry.embedding, undefined);
});

test("qdrant delete uses query then delete with points selector", async () => {
  const c = fakeClient();
  c.query = async (name, q) => {
    c.calls.push(["query", name, q]);
    return { points: [{ id: "s1_0" }, { id: "s1_1" }] };
  };
  const st = new QdrantStorage({ client: c, collection: "maestro_memory", modelId: "m", dim: 3 });
  await st.init();
  await st.delete("s1");
  const deleteCall = c.calls.find(([k]) => k === "delete");
  assert.ok(deleteCall);
  assert.deepEqual(deleteCall[2], { points: ["s1_0", "s1_1"] });
});

test("qdrant delete with no matching points does not call delete", async () => {
  const c = fakeClient();
  c.query = async (name, q) => {
    c.calls.push(["query", name, q]);
    return { points: [] };
  };
  const st = new QdrantStorage({ client: c, collection: "maestro_memory", modelId: "m", dim: 3 });
  await st.init();
  await st.delete("s99");
  const deleteCall = c.calls.find(([k]) => k === "delete");
  assert.equal(deleteCall, undefined);
});

test("qdrant delete adds key filter when provided (spec isolation)", async () => {
  const c = fakeClient();
  c.query = async (name, q) => {
    c.calls.push(["query", name, q]);
    return { points: [{ id: "s1_0" }] };
  };
  const st = new QdrantStorage({ client: c, collection: "maestro_memory", modelId: "m", dim: 3 });
  await st.init();
  await st.delete("s1", { key: "k1" });
  const query = c.calls.find(([k]) => k === "query");
  assert.ok(query);
  // session_id via query: { match }, key via filter: { must }
  assert.deepEqual(query[2].query, { match: { key: "session_id", value: "s1" } });
  assert.deepEqual(query[2].filter, { must: [{ key: "key", match: { value: "k1" } }] });
});

test("qdrant stats returns entry count", async () => {
  const c = fakeClient();
  const st = new QdrantStorage({ client: c, collection: "maestro_memory", modelId: "m", dim: 3 });
  await st.init();
  const s = await st.stats();
  assert.equal(s.entries, 1);
});

test("qdrant dispose is no-op", async () => {
  const c = fakeClient();
  const st = new QdrantStorage({ client: c, collection: "maestro_memory", modelId: "m", dim: 3 });
  await st.init();
  await st.dispose();
});

test("qdrant search with empty key throws", async () => {
  const c = fakeClient();
  const st = new QdrantStorage({ client: c, collection: "maestro_memory", modelId: "m", dim: 3 });
  await st.init();
  await assert.rejects(() => st.search(new Float32Array([0.1, 0.2, 0.3]), { top_k: 3, min_score: 0, key: "" }), /key required/);
});

test("qdrant search query uses nearest vector structure", async () => {
  const c = fakeClient();
  const st = new QdrantStorage({ client: c, collection: "maestro_memory", modelId: "m", dim: 3 });
  await st.init();
  await st.search(new Float32Array([1, 2, 3]), { top_k: 5, min_score: 0.7, key: "test" });
  const query = c.calls.find(([k]) => k === "query");
  assert.ok(query);
  assert.equal(query[2].limit, 5);
  assert.equal(query[2].score_threshold, 0.7);
  assert.deepEqual(query[2].query, { nearest: [1, 2, 3] });
});
