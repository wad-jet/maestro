import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { QdrantStorage } from "./qdrant.js";

// Mirror of qdrant.js uuidFrom (sha256 → deterministic UUID v5-like).
function uuidFrom(s) {
  const h = createHash("sha256").update(s).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

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
  // Fixed point id per session (NOT per version) — re-summarize overwrites.
  assert.match(point.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  assert.equal(point.id, uuidFrom("s1"));
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

test("qdrant search with project uses key-set filter", async () => {
  const c = fakeClient();
  const st = new QdrantStorage({ client: c, collection: "maestro_memory", modelId: "m", dim: 3 });
  await st.init();
  await st.search(new Float32Array([0.1, 0.2, 0.3]), { top_k: 3, min_score: 0.35, key: "k1", project: "other" });
  const query = c.calls.find(([k]) => k === "query");
  assert.ok(query);
  assert.deepEqual(query[2].filter.must[0], { key: "key", match: { any: ["k1", "other"] } });
});

test("qdrant search filters date/author", async () => {
  const c = fakeClient();
  const st = new QdrantStorage({ client: c, collection: "maestro_memory", modelId: "m", dim: 3 });
  await st.init();
  await st.search(new Float32Array([0.1, 0.2, 0.3]), { top_k: 3, min_score: 0, key: "k1", date_from: 100, date_to: 500, author: "alice" });
  const query = c.calls.find(([k]) => k === "query");
  assert.ok(query);
  const must = query[2].filter.must;
  assert.deepEqual(must[0], { key: "key", match: { value: "k1" } });
  assert.deepEqual(must[1], { key: "time_last", range: { gte: 100 } });
  assert.deepEqual(must[2], { key: "time_last", range: { lte: 500 } });
  assert.deepEqual(must[3], { key: "author", match: { value: "alice" } });
});

test("qdrant delete uses filter-based delete (no query lookup)", async () => {
  const c = fakeClient();
  const st = new QdrantStorage({ client: c, collection: "maestro_memory", modelId: "m", dim: 3 });
  await st.init();
  await st.delete("s1");
  const deleteCall = c.calls.find(([k]) => k === "delete");
  assert.ok(deleteCall);
  // C-2: direct filter delete — no points selector, no pre-query.
  assert.deepEqual(deleteCall[2], { filter: { must: [{ key: "session_id", match: { value: "s1" } }] } });
  assert.equal(c.calls.some(([k]) => k === "query"), false);
});

test("qdrant delete always calls delete with filter (no pre-query needed)", async () => {
  const c = fakeClient();
  const st = new QdrantStorage({ client: c, collection: "maestro_memory", modelId: "m", dim: 3 });
  await st.init();
  await st.delete("s99");
  const deleteCall = c.calls.find(([k]) => k === "delete");
  assert.ok(deleteCall);
  assert.deepEqual(deleteCall[2], { filter: { must: [{ key: "session_id", match: { value: "s99" } }] } });
});

test("qdrant delete adds key filter when provided (spec isolation)", async () => {
  const c = fakeClient();
  const st = new QdrantStorage({ client: c, collection: "maestro_memory", modelId: "m", dim: 3 });
  await st.init();
  await st.delete("s1", { key: "k1" });
  const deleteCall = c.calls.find(([k]) => k === "delete");
  assert.ok(deleteCall);
  assert.deepEqual(deleteCall[2], {
    filter: {
      must: [
        { key: "session_id", match: { value: "s1" } },
        { key: "key", match: { value: "k1" } },
      ],
    },
  });
});

test("qdrant stats returns entry count", async () => {
  const c = fakeClient();
  const st = new QdrantStorage({ client: c, collection: "maestro_memory", modelId: "m", dim: 3 });
  await st.init();
  const s = await st.stats({ key: "k1" });
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

test("qdrant deleteByFilter uses filter-based delete with key", async () => {
  const c = fakeClient();
  c.count = async (name, opts) => {
    c.calls.push(["count", name, opts]);
    return { count: 3 };
  };
  const st = new QdrantStorage({ client: c, collection: "maestro_memory", modelId: "m", dim: 3 });
  await st.init();
  const n = await st.deleteByFilter({ key: "k1", author: "a" });
  assert.equal(n, 3);
  const countCall = c.calls.find(([k]) => k === "count");
  assert.ok(countCall);
  assert.deepEqual(countCall[2].filter.must, [
    { key: "key", match: { value: "k1" } },
    { key: "author", match: { value: "a" } },
  ]);
  const deleteCall = c.calls.find(([k]) => k === "delete");
  assert.ok(deleteCall);
  assert.deepEqual(deleteCall[2], {
    filter: {
      must: [
        { key: "key", match: { value: "k1" } },
        { key: "author", match: { value: "a" } },
      ],
    },
  });
});

test("qdrant deleteByFilter requires key", async () => {
  const c = fakeClient();
  const st = new QdrantStorage({ client: c, collection: "maestro_memory", modelId: "m", dim: 3 });
  await st.init();
  await assert.rejects(() => st.deleteByFilter({ author: "a" }), /key required/);
});

test("qdrant prune filters by time_last", async () => {
  const c = fakeClient();
  c.count = async (name, opts) => {
    c.calls.push(["count", name, opts]);
    return { count: 2 };
  };
  const st = new QdrantStorage({ client: c, collection: "maestro_memory", modelId: "m", dim: 3 });
  await st.init();
  const before = Date.now();
  const n = await st.prune({ key: "k1", olderThanDays: 30 });
  assert.equal(n, 2);
  const deleteCall = c.calls.find(([k]) => k === "delete");
  assert.ok(deleteCall);
  const must = deleteCall[2].filter.must;
  assert.deepEqual(must[0], { key: "key", match: { value: "k1" } });
  assert.equal(must[1].key, "time_last");
  assert.ok(must[1].range.lte >= before - 30 * 86400_000);
});

test("qdrant stats key-scoped", async () => {
  const c = fakeClient();
  c.count = async (name, opts) => {
    c.calls.push(["count", name, opts]);
    return { count: 1 };
  };
  const st = new QdrantStorage({ client: c, collection: "maestro_memory", modelId: "m", dim: 3 });
  await st.init();
  const s = await st.stats({ key: "k1" });
  assert.equal(s.entries, 1);
  const countCall = c.calls.find(([k]) => k === "count");
  assert.deepEqual(countCall[2].filter.must, [{ key: "key", match: { value: "k1" } }]);
});

test("qdrant scan scrolls with key filter", async () => {
  const c = fakeClient();
  c.scroll = async (name, opts) => {
    c.calls.push(["scroll", name, opts]);
    return { points: [{ payload: { session_id: "s1", title: "t1", decisions: '["d1"]', key: "k1" } }] };
  };
  const st = new QdrantStorage({ client: c, collection: "maestro_memory", modelId: "m", dim: 3 });
  await st.init();
  const rows = await st.scan({ key: "k1", fields: ["session_id", "title", "decisions"] });
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].decisions, ["d1"]);
  const scrollCall = c.calls.find(([k]) => k === "scroll");
  assert.deepEqual(scrollCall[2].filter.must, [{ key: "key", match: { value: "k1" } }]);
});
