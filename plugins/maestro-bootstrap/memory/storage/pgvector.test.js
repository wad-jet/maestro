import { test } from "node:test";
import assert from "node:assert/strict";
import { PgVectorStorage } from "./pgvector.js";

function fakePool() {
  const calls = [];
  return {
    calls,
    query: async (sql, params) => {
      calls.push([sql, params]);
      if (sql.startsWith("CREATE TABLE")) return { rows: [] };
      if (sql.includes("FROM maestro_memory")) return { rows: [{ session_id: "s1", title: "t", summary: "s", decisions: "[]", key: "k", score: 0.9 }] };
      if (sql.startsWith("INSERT")) return { rows: [] };
      if (sql.startsWith("DELETE")) return { rows: [] };
      if (sql.startsWith("SELECT count")) return { rows: [{ count: "1" }] };
      if (sql.includes("info_version")) return { rows: [{ extversion: "0.7.0" }] };
      return { rows: [] };
    },
    end: async () => {},
  };
}

test("pgvector init creates table", async () => {
  const p = fakePool();
  const st = new PgVectorStorage({ pool: p, table: "maestro_memory", dim: 3 });
  await st.init();
  assert.ok(p.calls.some(([sql]) => sql.startsWith("CREATE TABLE")));
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
