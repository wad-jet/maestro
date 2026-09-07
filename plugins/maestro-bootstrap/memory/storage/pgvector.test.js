import { test } from "node:test";
import assert from "node:assert/strict";
import { PgVectorStorage } from "./pgvector.js";

function fakePool() {
  const calls = [];
  return {
    calls,
    query: async (sql, params) => {
      calls.push([sql, params]);
      // order matters: count(*) before generic "FROM"
      if (sql.startsWith("SELECT count")) return { rows: [{ count: "2" }] };
      if (sql.includes("FROM maestro_memory")) return { rows: [{ session_id: "s1", title: "t", summary: "s", decisions: "[]", key: "k", score: 0.9 }] };
      if (sql.startsWith("CREATE TABLE")) return { rows: [] };
      if (sql.startsWith("INSERT")) return { rows: [] };
      if (sql.startsWith("DELETE")) return { rows: [] };
      if (sql.includes("info_version")) return { rows: [{ extversion: "0.7.0" }] };
      return { rows: [] };
    },
    end: async () => {},
  };
}

test("pgvector init creates extension + table", async () => {
  const p = fakePool();
  const st = new PgVectorStorage({ pool: p, table: "maestro_memory", dim: 3, modelId: "m1" });
  await st.init();
  assert.ok(p.calls.some(([sql]) => sql.includes("CREATE EXTENSION")));
  assert.ok(p.calls.some(([sql]) => sql.startsWith("CREATE TABLE")));
  assert.ok(p.calls.some(([sql]) => sql.includes("CREATE INDEX")));
});

test("pgvector search filters by key", async () => {
  const p = fakePool();
  const st = new PgVectorStorage({ pool: p, table: "maestro_memory", dim: 3 });
  await st.init();
  await st.search(new Float32Array([0.1, 0.2, 0.3]), { top_k: 3, min_score: 0.5, key: "k1" });
  const sel = p.calls.find(([sql]) => sql.includes("FROM maestro_memory"));
  assert.ok(sel);
  assert.equal(sel[1][1], "k1");
});

test("pgvector search requires key", async () => {
  const p = fakePool();
  const st = new PgVectorStorage({ pool: p, table: "maestro_memory", dim: 3 });
  await st.init();
  await assert.rejects(() => st.search(new Float32Array([0.1, 0.2, 0.3]), { top_k: 3, min_score: 0.5 }), /key required/);
});

test("pgvector upsert captures INSERT ON CONFLICT", async () => {
  const p = fakePool();
  const st = new PgVectorStorage({ pool: p, table: "maestro_memory", dim: 3, modelId: "m1" });
  await st.init();
  await st.upsert([{
    session_id: "s1", key: "k1", origin_project_hash: "h1", title: "t1", summary: "s1",
    decisions: [], embedding: new Float32Array([0.1, 0.2, 0.3]),
    model_id: "m1", author: "a1", time_first: 1, time_last: 2, version: 1,
  }]);
  const ins = p.calls.find(([sql]) => sql.includes("INSERT INTO"));
  assert.ok(ins);
  assert.ok(ins[0].includes("ON CONFLICT"));
  assert.equal(ins[1][1], "k1");
  assert.equal(ins[1][7], "m1");
});

test("pgvector delete", async () => {
  const p = fakePool();
  const st = new PgVectorStorage({ pool: p, table: "maestro_memory", dim: 3 });
  await st.init();
  await st.delete("s1");
  const del = p.calls.find(([sql]) => sql.startsWith("DELETE"));
  assert.ok(del);
  assert.equal(del[1][0], "s1");
});

test("pgvector stats", async () => {
  const p = fakePool();
  const st = new PgVectorStorage({ pool: p, table: "maestro_memory", dim: 3 });
  await st.init();
  const s = await st.stats();
  assert.equal(s.entries, 2);
});

test("pgvector upsert rejects model_id mismatch", async () => {
  const p = fakePool();
  const st = new PgVectorStorage({ pool: p, table: "maestro_memory", dim: 3, modelId: "m1" });
  await st.init();
  await assert.rejects(() => st.upsert([{
    session_id: "s1", key: "k1", origin_project_hash: "h1", title: "t1", summary: "s1",
    decisions: [], embedding: new Float32Array([0.1, 0.2, 0.3]),
    model_id: "m2", author: "a1", time_first: 1, time_last: 2, version: 1,
  }]), /model_id mismatch/);
});

test("pgvector upsert rejects wrong embedding dimension", async () => {
  const p = fakePool();
  const st = new PgVectorStorage({ pool: p, table: "maestro_memory", dim: 3, modelId: "m1" });
  await st.init();
  await assert.rejects(() => st.upsert([{
    session_id: "s1", key: "k1", origin_project_hash: "h1", title: "t1", summary: "s1",
    decisions: [], embedding: new Float32Array([0.1, 0.2]),
    model_id: "m1", author: "a1", time_first: 1, time_last: 2, version: 1,
  }]), /embedding length.*does not match/);
});

test("pgvector search with project uses key IN", async () => {
  const p = fakePool();
  const st = new PgVectorStorage({ pool: p, table: "maestro_memory", dim: 3 });
  await st.init();
  await st.search(new Float32Array([0.1, 0.2, 0.3]), { top_k: 3, min_score: 0.5, key: "k1", project: "other" });
  const sel = p.calls.find(([sql]) => sql.includes("FROM maestro_memory"));
  assert.ok(sel);
  assert.ok(sel[0].includes("key IN ($2, $3)"), `expected key IN ($2, $3), got: ${sel[0]}`);
  assert.equal(sel[1][1], "k1");
  assert.equal(sel[1][2], "other");
});

test("pgvector search filters date/author", async () => {
  const p = fakePool();
  const st = new PgVectorStorage({ pool: p, table: "maestro_memory", dim: 3 });
  await st.init();
  await st.search(new Float32Array([0.1, 0.2, 0.3]), { top_k: 3, min_score: 0, key: "k1", date_from: 100, date_to: 500, author: "alice" });
  const sel = p.calls.find(([sql]) => sql.includes("FROM maestro_memory"));
  assert.ok(sel);
  assert.ok(sel[0].includes("time_last >= $3"), sel[0]);
  assert.ok(sel[0].includes("time_last <= $4"), sel[0]);
  assert.ok(sel[0].includes("author = $5"), sel[0]);
  assert.equal(sel[1][2], 100);
  assert.equal(sel[1][3], 500);
  assert.equal(sel[1][4], "alice");
});

test("pgvector deleteByFilter returns count from RETURNING", async () => {
  const p = fakePool();
  p.query = async (sql, params) => {
    p.calls.push([sql, params]);
    if (sql.startsWith("DELETE")) return { rows: [{ session_id: "s1" }, { session_id: "s2" }] };
    return { rows: [] };
  };
  const st = new PgVectorStorage({ pool: p, table: "maestro_memory", dim: 3 });
  await st.init();
  const n = await st.deleteByFilter({ key: "k1", author: "a" });
  assert.equal(n, 2);
  const del = p.calls.find(([sql]) => sql.startsWith("DELETE"));
  assert.ok(del);
  assert.ok(del[0].includes("RETURNING session_id"));
  assert.equal(del[1][0], "k1");
  assert.equal(del[1][1], "a");
});

test("pgvector deleteByFilter requires key", async () => {
  const p = fakePool();
  const st = new PgVectorStorage({ pool: p, table: "maestro_memory", dim: 3 });
  await st.init();
  await assert.rejects(() => st.deleteByFilter({ author: "a" }), /key required/);
});

test("pgvector prune filters by time_last", async () => {
  const p = fakePool();
  p.query = async (sql, params) => {
    p.calls.push([sql, params]);
    if (sql.startsWith("DELETE")) return { rows: [{ session_id: "s1" }] };
    return { rows: [] };
  };
  const st = new PgVectorStorage({ pool: p, table: "maestro_memory", dim: 3 });
  await st.init();
  const before = Date.now();
  const n = await st.prune({ key: "k1", olderThanDays: 30 });
  assert.equal(n, 1);
  const del = p.calls.find(([sql]) => sql.startsWith("DELETE"));
  assert.ok(del);
  assert.ok(del[0].includes("time_last <= $2"));
  assert.equal(del[1][0], "k1");
  assert.ok(del[1][1] <= before - 30 * 86400_000);
});
