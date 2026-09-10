import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { QdrantStorage } from "./qdrant.js";
import { prefixesOf } from "../project.js";

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
    createPayloadIndex: async (name, opts) => {
      calls.push(["createPayloadIndex", name, opts]);
    },
    scroll: async (name, opts) => {
      calls.push(["scroll", name, opts]);
      return { points: [], next_page_offset: null };
    },
    setPayload: async (name, opts) => {
      calls.push(["setPayload", name, opts]);
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

test("qdrant upsert throws on model_id mismatch (parity with sqlite/pg)", async () => {
  const c = fakeClient();
  const st = new QdrantStorage({ client: c, collection: "maestro_memory", modelId: "m", dim: 3 });
  await st.init();
  await assert.rejects(
    () => st.upsert([{
      session_id: "s1", key: "k1", origin_project_hash: "h1", title: "T",
      summary: "S", decisions: [], embedding: new Float32Array([0.1, 0.2, 0.3]),
      model_id: "other", author: "a", time_first: 1, time_last: 2, version: 1,
    }]),
    /переиндексируйте \(см\. how-to\/enable-memory\)/,
    "model_id mismatch must throw with reindex instruction",
  );
  // Модель совпадает → upsert проходит (не бросает).
  await st.upsert([{
    session_id: "s1", key: "k1", origin_project_hash: "h1", title: "T",
    summary: "S", decisions: [], embedding: new Float32Array([0.1, 0.2, 0.3]),
    model_id: "m", author: "a", time_first: 1, time_last: 2, version: 1,
  }]);
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

test("qdrant search with project splits legs: active key + merged-only sibling", async () => {
  const c = fakeClient();
  const st = new QdrantStorage({ client: c, collection: "maestro_memory", modelId: "m", dim: 3 });
  await st.init();
  await st.search(new Float32Array([0.1, 0.2, 0.3]), { top_k: 3, min_score: 0.35, key: "k1", project: "other" });
  const queries = c.calls.filter(([k]) => k === "query");
  assert.ok(queries.length >= 2, "active + sibling legs must run");
  // Активная нога: key match value (own key), без merged-фильтра.
  const active = queries.find(([, , q]) => q.filter.must[0]?.key === "key" && q.filter.must[0]?.match?.value === "k1");
  assert.ok(active, "active leg with key match value k1");
  assert.ok(!active[2].filter.must.some((m) => m.key === "merged"), "active leg must NOT be merged-only");
  // Sibling-нога: key match value (other) + merged=1 (§6.2 general-only).
  const sibling = queries.find(([, , q]) => q.filter.must[0]?.key === "key" && q.filter.must[0]?.match?.value === "other");
  assert.ok(sibling, "sibling leg with key match value other");
  assert.deepEqual(sibling[2].filter.must[1], { key: "merged", match: { value: 1 } });
});

test("qdrant cross-project: sibling leg merged=1 and NOT own-key filterSessionIds (§6.2)", async () => {
  const c = fakeClient();
  const st = new QdrantStorage({ client: c, collection: "maestro_memory", modelId: "m", dim: 3 });
  await st.init();
  await st.search(new Float32Array([0.1, 0.2, 0.3]), { top_k: 3, min_score: 0, key: "k1", project: "other", filterSessionIds: ["a1"] });
  const queries = c.calls.filter(([k]) => k === "query");
  const sibling = queries.find(([, , q]) => q.filter.must[0]?.key === "key" && q.filter.must[0]?.match?.value === "other");
  assert.ok(sibling, "sibling leg present");
  assert.deepEqual(sibling[2].filter.must[1], { key: "merged", match: { value: 1 } }, "sibling leg merged-only");
  assert.ok(!sibling[2].filter.must.some((m) => m.key === "session_id"), "own-key filterSessionIds must NOT leak into sibling leg");
  const active = queries.find(([, , q]) => q.filter.must[0]?.key === "key" && q.filter.must[0]?.match?.value === "k1");
  assert.ok(active, "active leg present");
  assert.ok(active[2].filter.must.some((m) => m.key === "session_id"), "active leg keeps filterSessionIds");
});

test("qdrant pre-v3 sibling points (no merged payload) → merged=1 filter silently excludes, no throw (§6.2)", async () => {
  const c = fakeClient();
  // Pre-v3 sibling point: payload БЕЗ поля merged. qdrant фильтр merged=1
  // молча исключает такие точки (missing payload ≠ match) → under-inclusion
  // (документировано). Активная нога возвращает свой хит; sibling пуст, без throw.
  c.query = async (name, q) => {
    c.calls.push(["query", name, q]);
    const isSibling = q.filter?.must?.[0]?.key === "key" && q.filter?.must?.[0]?.match?.value === "other";
    if (isSibling) {
      // Sibling-нога: сервер вернул бы только точки с merged=1; у pre-v3 точки
      // merged отсутствует → не матчится → пустой результат.
      return { points: [] };
    }
    return { points: [{ id: "a1", score: 0.9, payload: { session_id: "a1", title: "Active", summary: "s", decisions: "[]", key: "k1", merged: 1 } }] };
  };
  const st = new QdrantStorage({ client: c, collection: "maestro_memory", modelId: "m", dim: 3 });
  await st.init();
  const res = await st.search(new Float32Array([0.1, 0.2, 0.3]), { top_k: 3, min_score: 0, key: "k1", project: "other" });
  const queries = c.calls.filter(([k]) => k === "query");
  const sibling = queries.find(([, , q]) => q.filter.must[0]?.key === "key" && q.filter.must[0]?.match?.value === "other");
  assert.ok(sibling, "sibling leg present");
  assert.deepEqual(sibling[2].filter.must[1], { key: "merged", match: { value: 1 } }, "sibling leg merged-only filter");
  const ids = res.map((h) => h.entry.session_id);
  assert.ok(!ids.includes("o1"), "pre-v3 sibling point (no merged payload) silently excluded (under-inclusion)");
  assert.ok(ids.includes("a1"), "active hit present");
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

test("qdrant search filterSessionIds adds session_id match any to vector + text legs (I1)", async () => {
  const c = fakeClient();
  const st = new QdrantStorage({ client: c, collection: "maestro_memory", modelId: "m", dim: 3 });
  await st.init();
  await st.search(new Float32Array([0.1, 0.2, 0.3]), { top_k: 3, min_score: 0, key: "k1", query: "foo", filterSessionIds: ["s1", "s2"] });
  const queries = c.calls.filter(([k]) => k === "query");
  assert.ok(queries.length >= 2, "vector + text legs must run");
  for (const [, , q] of queries) {
    const sid = q.filter.must.find((m) => m.key === "session_id");
    assert.ok(sid, "must filter by session_id");
    assert.deepEqual(sid.match.any, ["s1", "s2"]);
  }
});

test("qdrant search empty filterSessionIds → no session_id filter", async () => {
  const c = fakeClient();
  const st = new QdrantStorage({ client: c, collection: "maestro_memory", modelId: "m", dim: 3 });
  await st.init();
  await st.search(new Float32Array([0.1, 0.2, 0.3]), { top_k: 3, min_score: 0, key: "k1", filterSessionIds: [] });
  const query = c.calls.find(([k]) => k === "query");
  assert.ok(query);
  assert.ok(!query[2].filter.must.some((m) => m.key === "session_id"), "empty filter must not add session_id");
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
  assert.ok(must[1].range.lte <= before - 30 * 86400_000 + 5000);
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
  // Последний scroll — это scan (backfill в init() идёт раньше и с is_empty фильтром).
  const scrollCalls = c.calls.filter(([k]) => k === "scroll");
  const scanCall = scrollCalls[scrollCalls.length - 1];
  assert.deepEqual(scanCall[2].filter.must, [{ key: "key", match: { value: "k1" } }]);
});

test("qdrant scan with embedding returns Float32Array from vector (with_vector)", async () => {
  const c = fakeClient();
  c.scroll = async (name, opts) => {
    c.calls.push(["scroll", name, opts]);
    return { points: [{ payload: { session_id: "s1", title: "t1", decisions: '["d1"]', key: "k1" }, vector: [0.1, 0.2, 0.3] }] };
  };
  const st = new QdrantStorage({ client: c, collection: "maestro_memory", modelId: "m", dim: 3 });
  await st.init();
  const rows = await st.scan({ key: "k1", fields: ["session_id", "title", "embedding"] });
  assert.equal(rows.length, 1);
  assert.ok(rows[0].embedding instanceof Float32Array, "embedding must be Float32Array");
  assert.ok(rows[0].embedding.every((v, i) => Math.abs(v - [0.1, 0.2, 0.3][i]) < 1e-6));
  // Последний scroll — это scan (backfill в init() идёт раньше).
  const scrollCalls = c.calls.filter(([k]) => k === "scroll");
  const scanCall = scrollCalls[scrollCalls.length - 1];
  assert.equal(scanCall[2].with_vector, true, "scroll must request vectors");
});

// --- Task 4: текстовая ветка (payload text + full-text index) ---

test("qdrant upsert adds derived text field (recomputed each time)", async () => {
  const c = fakeClient();
  let capturedPoints = null;
  c.upsert = async (name, { points }) => {
    c.calls.push(["upsert", name, points.length]);
    capturedPoints = points;
  };
  const st = new QdrantStorage({ client: c, collection: "maestro_memory", modelId: "m", dim: 3 });
  await st.init();
  const entry = {
    session_id: "s1", key: "k1", origin_project_hash: "h1", title: "T",
    summary: "S", decisions: ["d1", "d2"], embedding: new Float32Array([0.1, 0.2, 0.3]),
    model_id: "m", author: "alice", time_first: 100, time_last: 200, version: 1,
  };
  await st.upsert([entry]);
  assert.equal(capturedPoints[0].payload.text, "T S d1 d2");
  // Re-upsert с новыми decisions — text пересчитывается.
  await st.upsert([{ ...entry, decisions: ["d3"], version: 2 }]);
  assert.equal(capturedPoints[0].payload.text, "T S d3");
});

test("qdrant init creates payload text index + backfills empty-text points (paged)", async () => {
  const c = fakeClient();
  const setPayloadCalls = [];
  c.setPayload = async (name, opts) => {
    c.calls.push(["setPayload", name, opts]);
    setPayloadCalls.push(opts);
  };
  // Пагинация: первая страница возвращает offset, вторая — null.
  let scrollCount = 0;
  c.scroll = async (name, opts) => {
    c.calls.push(["scroll", name, opts]);
    scrollCount++;
    if (scrollCount === 1) {
      return {
        points: [
          { id: "p1", payload: { title: "T1", summary: "S1", decisions: '["d1"]' } },
          { id: "p2", payload: { title: "T2", summary: "S2", decisions: "[]" } },
        ],
        next_page_offset: 10,
      };
    }
    return { points: [], next_page_offset: null };
  };
  const st = new QdrantStorage({ client: c, collection: "maestro_memory", modelId: "m", dim: 3 });
  await st.init();
  // Индекс создан с tokenizer word.
  const idx = c.calls.find(([k]) => k === "createPayloadIndex");
  assert.ok(idx, "must create payload index");
  assert.equal(idx[2].field_name, "text");
  assert.equal(idx[2].field_schema.type, "text");
  assert.equal(idx[2].field_schema.tokenizer, "word");
  // Scroll с is_empty фильтром.
  const scrollCalls = c.calls.filter(([k]) => k === "scroll");
  assert.ok(scrollCalls.length >= 2, "must paginate");
  assert.deepEqual(scrollCalls[0][2].filter.must, [{ key: "text", is_empty: true }]);
  // setPayload: per-point вызовы { payload: { text }, points: [id] }.
  assert.equal(setPayloadCalls.length, 2);
  assert.deepEqual(setPayloadCalls[0], { payload: { text: "T1 S1 d1" }, points: ["p1"] });
  assert.deepEqual(setPayloadCalls[1], { payload: { text: "T2 S2" }, points: ["p2"] });
});

test("qdrant init: index creation failure → scan-mode fallback, backfill still runs", async () => {
  const c = fakeClient();
  const logs = [];
  const origError = console.error;
  console.error = (msg) => { logs.push(msg); };
  let setPayloadCalled = false;
  c.createPayloadIndex = async () => { throw new Error("unsupported"); };
  c.setPayload = async (name, opts) => {
    c.calls.push(["setPayload", name, opts]);
    setPayloadCalled = true;
  };
  c.scroll = async (name, opts) => {
    c.calls.push(["scroll", name, opts]);
    return { points: [{ id: "p1", payload: { title: "T1", summary: "S1", decisions: "[]" } }], next_page_offset: null };
  };
  try {
    const st = new QdrantStorage({ client: c, collection: "maestro_memory", modelId: "m", dim: 3 });
    await st.init();
    assert.ok(logs.some((l) => l.includes("scan-mode fallback")), "must log fallback");
    assert.ok(setPayloadCalled, "backfill must still run");
  } finally {
    console.error = origError;
  }
});

test("qdrant hybrid: text leg is filter-only (no query/nearest), full_text_match present, fuses via rrf, capped to top_k", async () => {
  const c = fakeClient();
  const textQueries = [];
  c.query = async (name, q) => {
    c.calls.push(["query", name, q]);
    if (q.query && q.query.nearest) {
      return { points: [{ id: "s1", score: 0.9, payload: { session_id: "s1", title: "t", summary: "s", decisions: "[]", key: "k1" } }] };
    }
    // Текстовая ветка: top-level filter с full_text_match (без query/nearest).
    if (q.filter && q.filter.must.some((m) => m.key === "text")) {
      textQueries.push(q);
      return { points: [{ id: "s2", payload: { session_id: "s2" } }] };
    }
    // get() — filter-only по session_id.
    return { points: [{ id: "s2", payload: { session_id: "s2", title: "t2", summary: "s2", decisions: "[]", key: "k1" } }] };
  };
  const st = new QdrantStorage({ client: c, collection: "maestro_memory", modelId: "m", dim: 3 });
  await st.init();
  const res = await st.search(new Float32Array([0.1, 0.2, 0.3]), { top_k: 2, min_score: 0, key: "k1", query: "OAuth" });
  // Текстовая ветка: top-level filter, БЕЗ query и БЕЗ nearest.
  assert.equal(textQueries.length, 1);
  const tq = textQueries[0];
  assert.ok(tq.filter, "text leg must use top-level filter");
  assert.equal(tq.query, undefined, "text leg must NOT have query key");
  assert.equal(tq.query?.nearest, undefined, "text leg must NOT use nearest");
  assert.ok(tq.filter.must.some((m) => m.key === "text" && m.full_text_match && m.full_text_match.text === "OAuth"));
  // Фузия: векторный s1 + текстовый s2.
  assert.ok(res.length >= 2, `expected fused result, got ${res.length}`);
  const ids = res.map((r) => r.entry.session_id);
  assert.ok(ids.includes("s1"));
  assert.ok(ids.includes("s2"));
  assert.ok(res.length <= 2, `fused result must be capped to top_k, got ${res.length}`);
});

test("qdrant search: text-leg failure falls back to vector-only", async () => {
  const c = fakeClient();
  c.query = async (name, q) => {
    c.calls.push(["query", name, q]);
    if (q.query && q.query.nearest) {
      return { points: [{ id: "s1", score: 0.9, payload: { session_id: "s1", title: "t", summary: "s", decisions: "[]", key: "k1" } }] };
    }
    throw new Error("text leg boom");
  };
  const st = new QdrantStorage({ client: c, collection: "maestro_memory", modelId: "m", dim: 3 });
  await st.init();
  const res = await st.search(new Float32Array([0.1, 0.2, 0.3]), { top_k: 3, min_score: 0, key: "k1", query: "foo" });
  // Только векторные хиты, без фузии, без throw.
  assert.equal(res.length, 1);
  assert.equal(res[0].entry.session_id, "s1");
});

test("qdrant backfill: malformed decisions JSON falls back to []", async () => {
  const c = fakeClient();
  let setPayloadCalls = [];
  c.setPayload = async (name, opts) => {
    c.calls.push(["setPayload", name, opts]);
    setPayloadCalls.push(opts);
  };
  c.scroll = async (name, opts) => {
    c.calls.push(["scroll", name, opts]);
    return { points: [{ id: "p1", payload: { title: "T1", summary: "S1", decisions: "not-json" } }], next_page_offset: null };
  };
  const st = new QdrantStorage({ client: c, collection: "maestro_memory", modelId: "m", dim: 3 });
  await st.init();
  // text из title+summary только (decisions не парсится → []).
  assert.deepEqual(setPayloadCalls[0], { payload: { text: "T1 S1" }, points: ["p1"] });
});

test("qdrant init: backfill failure degrades to log, init still completes", async () => {
  const c = fakeClient();
  const logs = [];
  const origError = console.error;
  console.error = (msg) => { logs.push(msg); };
  c.setPayload = async () => { throw new Error("setPayload boom"); };
  c.scroll = async (name, opts) => {
    c.calls.push(["scroll", name, opts]);
    return { points: [{ id: "p1", payload: { title: "T1", summary: "S1", decisions: "[]" } }], next_page_offset: null };
  };
  try {
    const st = new QdrantStorage({ client: c, collection: "maestro_memory", modelId: "m", dim: 3 });
    await st.init(); // не должен бросить
    assert.ok(logs.some((l) => l.includes("text backfill failed")), "must log backfill failure");
  } finally {
    console.error = origError;
  }
});

test("qdrant get excludes derived text field from entry", async () => {
  const c = fakeClient();
  c.query = async (name, q) => {
    c.calls.push(["query", name, q]);
    // get() — filter-only по session_id.
    return { points: [{ id: "s1", payload: { session_id: "s1", title: "t1", summary: "s1", decisions: '["d1"]', key: "k1", text: "t1 s1 d1" } }] };
  };
  const st = new QdrantStorage({ client: c, collection: "maestro_memory", modelId: "m", dim: 3 });
  await st.init();
  const found = await st.get("s1");
  assert.ok(found);
  assert.equal(found.session_id, "s1");
  assert.equal(found.title, "t1");
  assert.deepEqual(found.decisions, ["d1"]);
  // Производное поле text не должно протекать в entry (spec §3.6).
  assert.equal(found.text, undefined, "get() must not leak derived text field");
});

// --- Task 3: branch/head/merged payload + candidates/markMerged ---

test("qdrant upsert payload always carries branch/head/merged (detached → '')", async () => {
  const c = fakeClient();
  let capturedPoints = null;
  c.upsert = async (name, { points }) => {
    c.calls.push(["upsert", name, points.length]);
    capturedPoints = points;
  };
  const st = new QdrantStorage({ client: c, collection: "maestro_memory", modelId: "m", dim: 3 });
  await st.init();
  await st.upsert([{
    session_id: "s1", key: "k1", origin_project_hash: "h1", title: "T",
    summary: "S", decisions: [], embedding: new Float32Array([0.1, 0.2, 0.3]),
    model_id: "m", author: "a", time_first: 1, time_last: 2, version: 1,
    branch: "feature/x", head: "abc123", merged: 0,
  }]);
  assert.equal(capturedPoints[0].payload.branch, "feature/x");
  assert.equal(capturedPoints[0].payload.head, "abc123");
  assert.equal(capturedPoints[0].payload.merged, 0);
  // detached/unknown → '' defaults.
  await st.upsert([{
    session_id: "s2", key: "k1", origin_project_hash: "h1", title: "T2",
    summary: "S2", decisions: [], embedding: new Float32Array([0.1, 0.2, 0.3]),
    model_id: "m", author: "a", time_first: 1, time_last: 2, version: 1,
  }]);
  assert.equal(capturedPoints[0].payload.branch, "");
  assert.equal(capturedPoints[0].payload.head, "");
  assert.equal(capturedPoints[0].payload.merged, 0);
});

test("qdrant upsert payload carries host (detached → '')", async () => {
  const c = fakeClient();
  let capturedPoints = null;
  c.upsert = async (name, { points }) => {
    c.calls.push(["upsert", name, points.length]);
    capturedPoints = points;
  };
  const st = new QdrantStorage({ client: c, collection: "maestro_memory", modelId: "m", dim: 3 });
  await st.init();
  await st.upsert([{
    session_id: "s1", key: "k1", origin_project_hash: "h1", title: "T",
    summary: "S", decisions: [], embedding: new Float32Array([0.1, 0.2, 0.3]),
    model_id: "m", author: "a", time_first: 1, time_last: 2, version: 1,
    host: "host-a",
  }]);
  assert.equal(capturedPoints[0].payload.host, "host-a");
  // detached/unknown → '' default.
  await st.upsert([{
    session_id: "s2", key: "k1", origin_project_hash: "h1", title: "T2",
    summary: "S2", decisions: [], embedding: new Float32Array([0.1, 0.2, 0.3]),
    model_id: "m", author: "a", time_first: 1, time_last: 2, version: 1,
  }]);
  assert.equal(capturedPoints[0].payload.host, "");
});

test("qdrant get maps host into entry", async () => {
  const c = fakeClient();
  c.query = async (name, q) => {
    c.calls.push(["query", name, q]);
    return { points: [{ id: "s1", payload: { session_id: "s1", title: "t1", summary: "s1", decisions: '["d1"]', key: "k1", host: "host-a" } }] };
  };
  const st = new QdrantStorage({ client: c, collection: "maestro_memory", modelId: "m", dim: 3 });
  await st.init();
  const found = await st.get("s1");
  assert.ok(found);
  assert.equal(found.host, "host-a");
});

test("qdrant candidates(key) scrolls key points + JS-filters merged=1 OR head != ''", async () => {
  const c = fakeClient();
  c.scroll = async (name, opts) => {
    c.calls.push(["scroll", name, opts]);
    // init()-backfill scroll (is_empty text) → пусто; candidates scroll (key) →
    // точки запрошенного ключа (реальный сервер фильтрует на стороне qdrant).
    const keyCond = opts.filter.must.find((m) => m.key === "key");
    if (!keyCond) return { points: [], next_page_offset: null };
    const key = keyCond.match.value;
    const all = [
      { id: "p1", payload: { session_id: "s1", key: "k1", decisions: "[]", merged: 1, head: "" } },
      { id: "p2", payload: { session_id: "s2", key: "k1", decisions: "[]", merged: 0, head: "h1" } },
      { id: "p3", payload: { session_id: "s3", key: "k1", decisions: "[]", merged: 0, head: "" } },
      { id: "p4", payload: { session_id: "s4", key: "k2", decisions: "[]", merged: 1, head: "" } },
    ];
    return { points: all.filter((p) => p.payload.key === key), next_page_offset: null };
  };
  const st = new QdrantStorage({ client: c, collection: "maestro_memory", modelId: "m", dim: 3 });
  await st.init();
  const cands = await st.candidates("k1");
  const ids = cands.map((x) => x.session_id).sort();
  assert.deepEqual(ids, ["s1", "s2"], "candidates = merged=1 OR head != '' within key");
  // Последний scroll — это candidates (backfill в init() идёт раньше).
  const scrollCalls = c.calls.filter(([k]) => k === "scroll");
  const candCall = scrollCalls[scrollCalls.length - 1];
  assert.deepEqual(candCall[2].filter.must, [{ key: "key", match: { value: "k1" } }]);
});

test("qdrant markMerged(key, head) scrolls key+head then setPayload merged=1 per id", async () => {
  const c = fakeClient();
  const setPayloadCalls = [];
  c.scroll = async (name, opts) => {
    c.calls.push(["scroll", name, opts]);
    return { points: [{ id: "pA", payload: { session_id: "sA", key: "kA", head: "h" } }], next_page_offset: null };
  };
  c.setPayload = async (name, opts) => {
    c.calls.push(["setPayload", name, opts]);
    setPayloadCalls.push(opts);
  };
  const st = new QdrantStorage({ client: c, collection: "maestro_memory", modelId: "m", dim: 3 });
  await st.init();
  await st.markMerged("kA", "h");
  const scrollCalls = c.calls.filter(([k]) => k === "scroll");
  const markScroll = scrollCalls[scrollCalls.length - 1];
  assert.deepEqual(markScroll[2].filter.must, [
    { key: "key", match: { value: "kA" } },
    { key: "head", match: { value: "h" } },
  ]);
  assert.equal(setPayloadCalls.length, 1);
  assert.deepEqual(setPayloadCalls[0], { payload: { merged: 1 }, points: ["pA"] });
});

test("qdrant candidates: malformed decisions JSON → [] (не throw)", async () => {
  const c = fakeClient();
  c.scroll = async (name, opts) => {
    c.calls.push(["scroll", name, opts]);
    const keyCond = opts.filter.must.find((m) => m.key === "key");
    if (!keyCond) return { points: [], next_page_offset: null };
    return { points: [{ id: "p1", payload: { session_id: "s1", key: "k1", decisions: "not-json", merged: 1, head: "" } }], next_page_offset: null };
  };
  const st = new QdrantStorage({ client: c, collection: "maestro_memory", modelId: "m", dim: 3 });
  await st.init();
  const cands = await st.candidates("k1");
  assert.equal(cands.length, 1);
  assert.deepEqual(cands[0].decisions, [], "malformed decisions must fall back to []");
});

// ── M-6: scroll-пагинация (next_page_offset) на candidates/markMerged/scan ──

test("qdrant M-6: candidates/markMerged/scan paginate via next_page_offset", async () => {
  const c = fakeClient();
  // Первая страница возвращает offset, вторая — null (пагинация). Фильтры
  // (key/head) применяются на стороне «сервера».
  let scrollCount = 0;
  const all = [
    { id: "p1", payload: { session_id: "s1", key: "k1", decisions: "[]", merged: 1, head: "" } },
    { id: "p2", payload: { session_id: "s2", key: "k1", decisions: "[]", merged: 0, head: "h1" } },
    { id: "p3", payload: { session_id: "s3", key: "k1", decisions: "[]", merged: 0, head: "" } },
    { id: "p4", payload: { session_id: "s4", key: "k1", decisions: "[]", merged: 1, head: "" } },
  ];
  c.scroll = async (name, opts) => {
    c.calls.push(["scroll", name, opts]);
    scrollCount++;
    const keyCond = opts.filter.must.find((m) => m.key === "key");
    if (!keyCond) return { points: [], next_page_offset: null };
    const headCond = opts.filter.must.find((m) => m.key === "head");
    const filtered = all.filter((p) => p.payload.key === keyCond.match.value && (!headCond || p.payload.head === headCond.match.value));
    const page = scrollCount === 1 ? filtered.slice(0, 2) : filtered.slice(2);
    return { points: page, next_page_offset: scrollCount === 1 ? 10 : null };
  };
  const st = new QdrantStorage({ client: c, collection: "maestro_memory", modelId: "m", dim: 3 });
  await st.init();
  scrollCount = 0; // сброс: считаем только вызовы после init

  // candidates: обе страницы, JS-фильтр merged=1 OR head != ''.
  const cands = await st.candidates("k1");
  const candIds = cands.map((x) => x.session_id).sort();
  assert.deepEqual(candIds, ["s1", "s2", "s4"], "candidates across pages (s3 unattributed excluded)");
  const candScrolls = c.calls.filter(([k]) => k === "scroll").slice(-2);
  assert.equal(candScrolls[0][2].offset, undefined, "first page no offset");
  assert.equal(candScrolls[1][2].offset, 10, "second page carries next_page_offset");

  // markMerged: id-набор из обеих страниц → один setPayload.
  const setPayloadCalls = [];
  c.setPayload = async (name, opts) => {
    c.calls.push(["setPayload", name, opts]);
    setPayloadCalls.push(opts);
  };
  scrollCount = 0;
  const n = await st.markMerged("k1", "h1");
  assert.equal(n, 1, "markMerged counts ids across pages (head=h1 → p2 only)");
  assert.equal(setPayloadCalls.length, 1, "single setPayload with all ids");
  assert.deepEqual(setPayloadCalls[0].points, ["p2"], "ids from both pages");

  // scan: строки из обеих страниц.
  scrollCount = 0;
  const rows = await st.scan({ key: "k1", fields: ["session_id"] });
  assert.deepEqual(rows.map((r) => r.session_id).sort(), ["s1", "s2", "s3", "s4"], "scan across pages");
});

test("qdrant search: vector-leg entry excludes derived text field", async () => {
  const c = fakeClient();
  c.query = async (name, q) => {
    c.calls.push(["query", name, q]);
    // Векторная ветка возвращает payload С полем text (как в реальном API).
    return { points: [{ id: "s1", score: 0.9, payload: { session_id: "s1", title: "t", summary: "s", decisions: "[]", key: "k1", text: "t s" } }] };
  };
  const st = new QdrantStorage({ client: c, collection: "maestro_memory", modelId: "m", dim: 3 });
  await st.init();
  const res = await st.search(new Float32Array([0.1, 0.2, 0.3]), { top_k: 3, min_score: 0, key: "k1" });
  assert.equal(res.length, 1);
  assert.equal(res[0].entry.session_id, "s1");
  assert.equal(res[0].entry.text, undefined, "vector-leg entry must not leak derived text field");
});

// ── Task 3 (namespace-related): origin_remote + prefixes поля, subtree-ноги, migrateKey ──

test("qdrant upsert payload carries origin_remote + prefixes (detached → '' / [])", async () => {
  const c = fakeClient();
  let capturedPoints = null;
  c.upsert = async (name, { points }) => {
    c.calls.push(["upsert", name, points.length]);
    capturedPoints = points;
  };
  const st = new QdrantStorage({ client: c, collection: "maestro_memory", modelId: "m", dim: 3 });
  await st.init();
  await st.upsert([{
    session_id: "s1", key: "a.b.c", origin_project_hash: "h1", title: "T",
    summary: "S", decisions: [], embedding: new Float32Array([0.1, 0.2, 0.3]),
    model_id: "m", author: "a", time_first: 1, time_last: 2, version: 1,
    origin_remote: "github.com/org/api", prefixes: ["a", "a.b"],
  }]);
  assert.equal(capturedPoints[0].payload.origin_remote, "github.com/org/api");
  assert.deepEqual(capturedPoints[0].payload.prefixes, ["a", "a.b"]);
  // detached/unknown → '' / [] defaults.
  await st.upsert([{
    session_id: "s2", key: "a.b.c", origin_project_hash: "h1", title: "T2",
    summary: "S2", decisions: [], embedding: new Float32Array([0.1, 0.2, 0.3]),
    model_id: "m", author: "a", time_first: 1, time_last: 2, version: 1,
  }]);
  assert.equal(capturedPoints[0].payload.origin_remote, "");
  assert.deepEqual(capturedPoints[0].payload.prefixes, []);
});

test("qdrant init creates keyword payload index on prefixes (idempotent)", async () => {
  const c = fakeClient();
  const st = new QdrantStorage({ client: c, collection: "maestro_memory", modelId: "m", dim: 3 });
  await st.init();
  const idx = c.calls.find(([k, , opts]) => k === "createPayloadIndex" && opts?.field_name === "prefixes");
  assert.ok(idx, "must create prefixes payload index");
  assert.equal(idx[2].field_schema.type, "keyword");
});

test("qdrant get maps origin_remote + prefixes (legacy → defaults)", async () => {
  const c = fakeClient();
  c.query = async (name, q) => {
    c.calls.push(["query", name, q]);
    const sid = q.filter?.must?.[0]?.match?.value;
    if (sid === "s1") {
      return { points: [{ id: "s1", payload: { session_id: "s1", title: "t1", summary: "s1", decisions: '["d1"]', key: "a.b.c", origin_remote: "github.com/org/api", prefixes: ["a", "a.b"] } }] };
    }
    // legacy point without the fields.
    return { points: [{ id: "s2", payload: { session_id: "s2", title: "t2", summary: "s2", decisions: "[]", key: "a.b.c" } }] };
  };
  const st = new QdrantStorage({ client: c, collection: "maestro_memory", modelId: "m", dim: 3 });
  await st.init();
  const found = await st.get("s1");
  assert.equal(found.origin_remote, "github.com/org/api");
  assert.deepEqual(found.prefixes, ["a", "a.b"]);
  const legacy = await st.get("s2");
  assert.equal(legacy.origin_remote, "");
  assert.deepEqual(legacy.prefixes, []);
});

test("qdrant subtree leg: key = T OR prefixes match any [T] + merged=1", async () => {
  const c = fakeClient();
  const st = new QdrantStorage({ client: c, collection: "maestro_memory", modelId: "m", dim: 3 });
  await st.init();
  await st.search(new Float32Array([0.1, 0.2, 0.3]), { top_k: 3, min_score: 0, key: "a.b.c", subtree: ["a.b"] });
  const queries = c.calls.filter(([k]) => k === "query");
  // Активная нога: key match value (own key), без merged-фильтра.
  const active = queries.find(([, , q]) => q.filter.must[0]?.key === "key" && q.filter.must[0]?.match?.value === "a.b.c");
  assert.ok(active, "active leg with key match value a.b.c");
  assert.ok(!active[2].filter.must.some((m) => m.key === "merged"), "active leg must NOT be merged-only");
  // Subtree-нога: should = [key match T, prefixes match any [T]] + merged=1 (§3.3 subtreeLeg).
  const subtree = queries.find(([, , q]) => q.filter.should?.some((m) => m.key === "prefixes"));
  assert.ok(subtree, "subtree leg with prefixes should-filter");
  assert.deepEqual(subtree[2].filter.should, [
    { key: "key", match: { value: "a.b" } },
    { key: "prefixes", match: { any: ["a.b"] } },
  ]);
  assert.ok(subtree[2].filter.must.some((m) => m.key === "merged" && m.match.value === 1), "subtree leg must be merged-only");
  assert.ok(!subtree[2].filter.must.some((m) => m.key === "session_id"), "own-key filterSessionIds must NOT leak into subtree leg");
});

test("qdrant migrateKey: unconditional re-key (deterministic id — no cross-bucket conflict)", async () => {
  const c = fakeClient();
  // Одна коллекция: source-точки (key=old.ns). На qdrant id точки
  // детерминирован uuidFrom(session_id) → same-session cross-bucket конфликт
  // структурно невозможен → max-version-wins не применяется, каждая точка
  // безусловно re-key'ится в toKey (payload.key + пересчитанные prefixes).
  const sourcePoints = [
    { id: uuidFrom("s1"), payload: { session_id: "s1", key: "old.ns", version: 2, decisions: "[]" } },
    { id: uuidFrom("s2"), payload: { session_id: "s2", key: "old.ns", version: 7, decisions: "[]" } },
  ];
  const setPayloadCalls = [];
  c.scroll = async (name, opts) => {
    c.calls.push(["scroll", name, opts]);
    const keyCond = opts.filter.must.find((m) => m.key === "key");
    if (!keyCond) return { points: [], next_page_offset: null };
    return { points: sourcePoints.filter((p) => p.payload.key === keyCond.match.value), next_page_offset: null };
  };
  c.setPayload = async (name, opts) => {
    c.calls.push(["setPayload", name, opts]);
    setPayloadCalls.push(opts);
  };
  const st = new QdrantStorage({ client: c, collection: "maestro_memory", modelId: "m", dim: 3 });
  await st.init();
  const n = await st.migrateKey("old.ns", "new.ns");
  // Обе точки перенесены (никакого skip по версии).
  assert.equal(n, 2, "all source points re-keyed unconditionally");
  assert.equal(setPayloadCalls.length, 2);
  assert.deepEqual(setPayloadCalls[0], { payload: { key: "new.ns", prefixes: prefixesOf("new.ns") }, points: [uuidFrom("s1")] });
  assert.deepEqual(setPayloadCalls[1], { payload: { key: "new.ns", prefixes: prefixesOf("new.ns") }, points: [uuidFrom("s2")] });
  // Никакого _get/query-лукапа по session_id (нет max-version-wins).
  assert.equal(c.calls.some(([k]) => k === "query"), false, "no per-point get lookup");
});

test("qdrant migrateKey delete_source: ids collected pre-setPayload, delete by ids after", async () => {
  const c = fakeClient();
  const sourcePoints = [
    { id: uuidFrom("s1"), payload: { session_id: "s1", key: "old.ns", version: 7, decisions: "[]" } },
    { id: uuidFrom("s2"), payload: { session_id: "s2", key: "old.ns", version: 2, decisions: "[]" } },
  ];
  const setPayloadCalls = [];
  const deleteCalls = [];
  c.scroll = async (name, opts) => {
    c.calls.push(["scroll", name, opts]);
    const keyCond = opts.filter.must.find((m) => m.key === "key");
    if (!keyCond) return { points: [], next_page_offset: null };
    return { points: sourcePoints.filter((p) => p.payload.key === keyCond.match.value), next_page_offset: null };
  };
  c.setPayload = async (name, opts) => {
    c.calls.push(["setPayload", name, opts]);
    setPayloadCalls.push(opts);
  };
  c.delete = async (name, opts) => {
    c.calls.push(["delete", name, opts]);
    deleteCalls.push(opts);
  };
  const st = new QdrantStorage({ client: c, collection: "maestro_memory", modelId: "m", dim: 3 });
  await st.init();
  const n = await st.migrateKey("old.ns", "new.ns", { deleteSource: true });
  // Обе точки re-key'нуты; deleteSource удаляет исходные ids (собранные ДО setPayload).
  assert.equal(n, 2);
  assert.equal(setPayloadCalls.length, 2);
  assert.deepEqual(setPayloadCalls[0].points, [uuidFrom("s1")]);
  assert.deepEqual(setPayloadCalls[1].points, [uuidFrom("s2")]);
  assert.equal(deleteCalls.length, 1);
  assert.deepEqual(deleteCalls[0], { points: [uuidFrom("s1"), uuidFrom("s2")] }, "all source ids deleted by id");
  // Порядок: scroll (ids собраны ДО setPayload) → setPayload → delete.
  const keyScrollIdx = c.calls.findIndex(([k, , opts]) => k === "scroll" && opts?.filter?.must?.some((m) => m.key === "key"));
  const setPayloadIdx = c.calls.findIndex(([k]) => k === "setPayload");
  const deleteIdx = c.calls.findIndex(([k]) => k === "delete");
  assert.ok(keyScrollIdx !== -1 && setPayloadIdx !== -1 && deleteIdx !== -1, "scroll/setPayload/delete all present");
  assert.ok(keyScrollIdx < setPayloadIdx, "ids collected (scroll) before setPayload");
  assert.ok(setPayloadIdx < deleteIdx, "delete after setPayload");
});

test("qdrant migrateKey no-op when fromKey === toKey", async () => {
  const c = fakeClient();
  const st = new QdrantStorage({ client: c, collection: "maestro_memory", modelId: "m", dim: 3 });
  await st.init();
  c.calls.length = 0; // сброс: init() сам делает scroll (backfill)
  const n = await st.migrateKey("same.ns", "same.ns");
  assert.equal(n, 0, "no-op guard returns 0");
  assert.equal(c.calls.some(([k]) => k === "scroll"), false, "no scroll on no-op");
  assert.equal(c.calls.some(([k]) => k === "setPayload"), false, "no setPayload on no-op");
});
