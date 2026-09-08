import { test } from "node:test";
import assert from "node:assert/strict";
import { PgVectorStorage } from "./pgvector.js";
function fakePool() {
  const calls = [];
  const handle = async (sql, params) => {
    calls.push([sql, params]);
    // order matters: count(*) before generic "FROM"
    if (sql.startsWith("SELECT count")) return { rows: [{ count: "2" }] };
    if (sql.includes("FROM maestro_memory")) return { rows: [{ session_id: "s1", title: "t", summary: "s", decisions: "[]", key: "k", score: 0.9 }] };
    if (sql.startsWith("CREATE TABLE")) return { rows: [] };
    if (sql.startsWith("INSERT")) return { rows: [] };
    if (sql.startsWith("DELETE")) return { rows: [] };
    if (sql.includes("info_version")) return { rows: [{ extversion: "0.7.0" }] };
    return { rows: [] };
  };
  const client = {
    query: handle,
    release: () => {},
  };
  return {
    calls,
    query: handle,
    connect: async () => client,
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

test("pgvector upsert wraps batch in transaction (BEGIN/COMMIT)", async () => {
  const p = fakePool();
  const st = new PgVectorStorage({ pool: p, table: "maestro_memory", dim: 3, modelId: "m1" });
  await st.init();
  await st.upsert([{
    session_id: "s1", key: "k1", origin_project_hash: "h1", title: "t1", summary: "s1",
    decisions: [], embedding: new Float32Array([0.1, 0.2, 0.3]),
    model_id: "m1", author: "a1", time_first: 1, time_last: 2, version: 1,
  }]);
  const sqls = p.calls.map(([sql]) => sql);
  assert.ok(sqls.includes("BEGIN"), "must BEGIN transaction");
  assert.ok(sqls.includes("COMMIT"), "must COMMIT transaction");
  assert.ok(!sqls.includes("ROLLBACK"), "must not ROLLBACK on success");
});

test("pgvector upsert rolls back on mid-batch failure", async () => {
  const p = fakePool();
  // Fail on the second INSERT.
  let inserts = 0;
  p.connect = async () => ({
    query: async (sql, params) => {
      p.calls.push([sql, params]);
      if (sql.startsWith("INSERT")) {
        inserts++;
        if (inserts === 2) throw new Error("boom");
      }
      return { rows: [] };
    },
    release: () => {},
  });
  const st = new PgVectorStorage({ pool: p, table: "maestro_memory", dim: 3, modelId: "m1" });
  await st.init();
  const mk = (sid) => ({
    session_id: sid, key: "k1", origin_project_hash: "h1", title: "t", summary: "s",
    decisions: [], embedding: new Float32Array([0.1, 0.2, 0.3]),
    model_id: "m1", author: "a1", time_first: 1, time_last: 2, version: 1,
  });
  await assert.rejects(() => st.upsert([mk("s1"), mk("s2")]), /boom/);
  const sqls = p.calls.map(([sql]) => sql);
  assert.ok(sqls.includes("BEGIN"), "must BEGIN");
  assert.ok(sqls.includes("ROLLBACK"), "must ROLLBACK on failure");
  assert.ok(!sqls.includes("COMMIT"), "must NOT COMMIT on failure");
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
  const s = await st.stats({ key: "k1" });
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

test("pgvector search with project splits legs: active key = + merged-only sibling", async () => {
  const p = fakePool();
  const st = new PgVectorStorage({ pool: p, table: "maestro_memory", dim: 3 });
  await st.init();
  await st.search(new Float32Array([0.1, 0.2, 0.3]), { top_k: 3, min_score: 0.5, key: "k1", project: "other", mergedOnly: true });
  const sels = p.calls.filter(([sql]) => sql.includes("FROM maestro_memory"));
  assert.ok(sels.length >= 2, "active + sibling legs must run");
  // Активная нога: key = $2 (own key), без merged-фильтра.
  const active = sels.find(([sql, params]) => sql.includes("key = $2") && params[1] === "k1");
  assert.ok(active, "active leg with key = $2 (k1)");
  assert.ok(!active[0].includes("merged = 1"), "active leg must NOT be merged-only");
  // Sibling-нога: key = $2 (other) + merged = 1 (§6.2 general-only).
  const sibling = sels.find(([sql, params]) => sql.includes("key = $2") && params[1] === "other");
  assert.ok(sibling, "sibling leg with key = $2 (other)");
  assert.ok(sibling[0].includes("merged = 1"), "sibling leg must be merged-only");
});

test("pgvector cross-project: sibling leg gets merged=1 and NOT own-key filterSessionIds (§6.2)", async () => {
  const p = fakePool();
  const st = new PgVectorStorage({ pool: p, table: "maestro_memory", dim: 3 });
  await st.init();
  await st.search(new Float32Array([0.1, 0.2, 0.3]), { top_k: 3, min_score: 0, key: "k1", project: "other", mergedOnly: true, filterSessionIds: ["a1"] });
  const sels = p.calls.filter(([sql]) => sql.includes("FROM maestro_memory"));
  const sibling = sels.find(([sql, params]) => sql.includes("key = $2") && params[1] === "other");
  assert.ok(sibling, "sibling leg present");
  assert.ok(sibling[0].includes("merged = 1"), "sibling leg merged-only");
  assert.ok(!sibling[0].includes("session_id IN"), "own-key filterSessionIds must NOT leak into sibling leg");
  const active = sels.find(([sql, params]) => sql.includes("key = $2") && params[1] === "k1");
  assert.ok(active, "active leg present");
  assert.ok(active[0].includes("session_id IN"), "active leg keeps filterSessionIds");
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

test("pgvector search filterSessionIds adds session_id IN to vector + text legs (I1)", async () => {
  const p = fakePoolHybrid({ textRows: [{ session_id: "s2" }] });
  const st = new PgVectorStorage({ pool: p, table: "maestro_memory", dim: 3, textSearchConfig: "russian" });
  await st.init();
  await st.search(new Float32Array([0.1, 0.2, 0.3]), { top_k: 3, min_score: 0, key: "k1", query: "foo", filterSessionIds: ["s1", "s2"] });
  // Векторная ветка: $1=embedding, $2=key, $3,$4=session_id IN, $5=min_score, $6=LIMIT.
  const vecCall = p.calls.find(([sql]) => sql.includes("FROM maestro_memory") && !sql.includes("plainto_tsquery"));
  assert.ok(vecCall, "vector leg must run");
  assert.ok(vecCall[0].includes("session_id IN ($3, $4)"), vecCall[0]);
  assert.equal(vecCall[1][2], "s1");
  assert.equal(vecCall[1][3], "s2");
  // Текстовая ветка: $1=cfg, $2=query, $3=key, $4,$5=session_id IN, $6=LIMIT.
  const textCall = p.calls.find(([sql]) => sql.includes("plainto_tsquery"));
  assert.ok(textCall, "text leg must run");
  assert.ok(textCall[0].includes("session_id IN ($4, $5)"), textCall[0]);
  assert.equal(textCall[1][3], "s1");
  assert.equal(textCall[1][4], "s2");
});

test("pgvector search empty filterSessionIds → no session_id filter", async () => {
  const p = fakePool();
  const st = new PgVectorStorage({ pool: p, table: "maestro_memory", dim: 3 });
  await st.init();
  await st.search(new Float32Array([0.1, 0.2, 0.3]), { top_k: 3, min_score: 0, key: "k1", filterSessionIds: [] });
  const sel = p.calls.find(([sql]) => sql.includes("FROM maestro_memory"));
  assert.ok(sel);
  assert.ok(!sel[0].includes("session_id IN"), sel[0]);
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
  assert.ok(del[1][1] >= before - 30 * 86400_000);
  assert.ok(del[1][1] <= before - 30 * 86400_000 + 5000);
});

test("pgvector stats key-scoped", async () => {
  const p = fakePool();
  const st = new PgVectorStorage({ pool: p, table: "maestro_memory", dim: 3 });
  await st.init();
  const s = await st.stats({ key: "k1" });
  assert.equal(s.entries, 2);
  const countCall = p.calls.find(([sql]) => sql.startsWith("SELECT count"));
  assert.ok(countCall[0].includes("WHERE key=$1"), countCall[0]);
  assert.equal(countCall[1][0], "k1");
});

test("pgvector scan returns fields", async () => {
  const p = fakePool();
  p.query = async (sql, params) => {
    p.calls.push([sql, params]);
    if (sql.startsWith("SELECT count")) return { rows: [{ count: "1" }] };
    if (sql.includes("FROM maestro_memory")) return { rows: [{ session_id: "s1", title: "t1", decisions: '["d1"]', key: "k1" }] };
    return { rows: [] };
  };
  const st = new PgVectorStorage({ pool: p, table: "maestro_memory", dim: 3 });
  await st.init();
  const rows = await st.scan({ key: "k1", fields: ["session_id", "title", "decisions"] });
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].decisions, ["d1"]);
  const sel = p.calls.find(([sql]) => sql.includes("FROM maestro_memory"));
  assert.ok(sel[0].includes("WHERE key=$1"), sel[0]);
  assert.equal(sel[1][0], "k1");
});

test("pgvector scan without decisions field does not crash", async () => {
  const p = fakePool();
  p.query = async (sql, params) => {
    p.calls.push([sql, params]);
    if (sql.startsWith("SELECT count")) return { rows: [{ count: "1" }] };
    if (sql.includes("FROM maestro_memory")) return { rows: [{ session_id: "s1", title: "t1", key: "k1" }] };
    return { rows: [] };
  };
  const st = new PgVectorStorage({ pool: p, table: "maestro_memory", dim: 3 });
  await st.init();
  const rows = await st.scan({ key: "k1", fields: ["session_id", "title"] });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].title, "t1");
  assert.equal(rows[0].decisions, undefined);
});

test("pgvector scan with embedding parses string to Float32Array", async () => {
  const p = fakePool();
  p.query = async (sql, params) => {
    p.calls.push([sql, params]);
    if (sql.startsWith("SELECT count")) return { rows: [{ count: "1" }] };
    if (sql.includes("FROM maestro_memory")) return { rows: [{ session_id: "s1", title: "t1", decisions: '["d1"]', key: "k1", embedding: "[0.1,0.2,0.3]" }] };
    return { rows: [] };
  };
  const st = new PgVectorStorage({ pool: p, table: "maestro_memory", dim: 3 });
  await st.init();
  const rows = await st.scan({ key: "k1", fields: ["session_id", "title", "embedding"] });
  assert.equal(rows.length, 1);
  assert.ok(rows[0].embedding instanceof Float32Array, "embedding must be Float32Array");
  assert.ok(rows[0].embedding.every((v, i) => Math.abs(v - [0.1, 0.2, 0.3][i]) < 1e-6));
});

// --- Task 3: гибридный текстовый поиск (generated tsvector + ts_rank + rrf) ---

// fakePool, который умеет отвечать на init-DDL (expr-запрос, ALTER, CREATE INDEX)
// и на текстовую ветку поиска (plainto_tsquery).
function fakePoolHybrid({ expr, textRows = [], tsConfigFound = true } = {}) {
  const calls = [];
  const handle = async (sql, params) => {
    calls.push([sql, params]);
    if (sql.startsWith("SELECT count")) return { rows: [{ count: "2" }] };
    if (sql.includes("pg_ts_config")) return { rows: tsConfigFound ? [{ "?column?": 1 }] : [] };
    if (sql.includes("pg_get_expr")) return { rows: expr === undefined ? [] : [{ expr }] };
    if (sql.includes("plainto_tsquery")) return { rows: textRows };
    if (sql.includes("FROM maestro_memory WHERE session_id")) {
      // get(): возвращаем строку с запрошенным session_id.
      const sid = params[0];
      return { rows: [{ session_id: sid, title: "t", summary: "s", decisions: "[]", key: "k" }] };
    }
    if (sql.includes("FROM maestro_memory")) return { rows: [{ session_id: "s1", title: "t", summary: "s", decisions: "[]", key: "k", score: 0.9 }] };
    if (sql.startsWith("CREATE TABLE")) return { rows: [] };
    if (sql.startsWith("INSERT")) return { rows: [] };
    if (sql.startsWith("DELETE")) return { rows: [] };
    if (sql.includes("info_version")) return { rows: [{ extversion: "0.7.0" }] };
    return { rows: [] };
  };
  const client = { query: handle, release: () => {} };
  return { calls, query: handle, connect: async () => client, end: async () => {} };
}

test("pgvector hybrid: text leg uses plainto_tsquery + ts_rank and fuses via rrf", async () => {
  const p = fakePoolHybrid({ textRows: [{ session_id: "s2" }] });
  const st = new PgVectorStorage({ pool: p, table: "maestro_memory", dim: 3, textSearchConfig: "russian" });
  await st.init();
  const res = await st.search(new Float32Array([0.1, 0.2, 0.3]), { top_k: 3, min_score: 0, key: "k1", query: "foo" });
  // Текстовая ветка выполнена с конфигом и запросом.
  const textCall = p.calls.find(([sql]) => sql.includes("plainto_tsquery"));
  assert.ok(textCall, "text leg must run plainto_tsquery");
  assert.equal(textCall[1][0], "russian");
  assert.equal(textCall[1][1], "foo");
  assert.ok(textCall[0].includes("ts_rank(fts, plainto_tsquery($1, $2)) DESC"), textCall[0]);
  // Фузия: векторный хит s1 + текстовый хит s2.
  assert.ok(res.length >= 2, `expected fused result, got ${res.length}`);
  const ids = res.map((r) => r.entry.session_id);
  assert.ok(ids.includes("s1"));
  assert.ok(ids.includes("s2"));
});

test("pgvector init: creates generated fts column + gin index with effective config", async () => {
  const p = fakePoolHybrid(); // expr undefined → ADD COLUMN branch
  const st = new PgVectorStorage({ pool: p, table: "maestro_memory", dim: 3, textSearchConfig: "russian" });
  await st.init();
  const add = p.calls.find(([sql]) => sql.includes("ADD COLUMN IF NOT EXISTS fts"));
  assert.ok(add, "must ADD COLUMN fts");
  assert.ok(add[0].includes("to_tsvector('russian'::regconfig"), add[0]);
  const gin = p.calls.find(([sql]) => sql.includes("_fts_idx") && sql.includes("USING gin"));
  assert.ok(gin, "must create GIN index on fts");
});

test("pgvector init: recreate on config change (atomic)", async () => {
  // Фактическое выражение — english, конфиг — russian → атомарный recreate.
  const p = fakePoolHybrid({ expr: "to_tsvector('english'::regconfig, ...)" });
  const st = new PgVectorStorage({ pool: p, table: "maestro_memory", dim: 3, textSearchConfig: "russian" });
  await st.init();
  const sqls = p.calls.map(([sql]) => sql);
  assert.ok(sqls.includes("BEGIN"), "must BEGIN");
  assert.ok(sqls.some((s) => s.includes("DROP COLUMN IF EXISTS fts")), "must DROP fts");
  assert.ok(sqls.some((s) => s.includes("ADD COLUMN fts") && s.includes("to_tsvector('russian'::regconfig")), "must ADD fts with russian");
  assert.ok(sqls.some((s) => s.includes("_fts_idx") && s.includes("USING gin")), "must recreate GIN index");
  assert.ok(sqls.includes("COMMIT"), "must COMMIT");
  assert.ok(!sqls.includes("ROLLBACK"), "must not ROLLBACK on success");
});

test("pgvector init: recreate rolls back on failure (no column loss)", async () => {
  // ADD COLUMN бросает → ROLLBACK, колонка не теряется. Recreate идёт через
  // выделенный клиент (pool.connect), поэтому переопределяем query клиента.
  const p = fakePoolHybrid({ expr: "to_tsvector('english'::regconfig, ...)" });
  let addCount = 0;
  const client = await p.connect();
  const origClientQuery = client.query;
  client.query = async (sql, params) => {
    p.calls.push([sql, params]);
    if (sql.includes("ADD COLUMN fts") && !sql.includes("IF NOT EXISTS")) {
      addCount++;
      if (addCount === 1) throw new Error("boom");
    }
    return origClientQuery(sql, params);
  };
  const st = new PgVectorStorage({ pool: p, table: "maestro_memory", dim: 3, textSearchConfig: "russian" });
  await assert.rejects(() => st.init(), /boom/);
  const sqls = p.calls.map(([sql]) => sql);
  assert.ok(sqls.includes("BEGIN"), "must BEGIN");
  assert.ok(sqls.includes("ROLLBACK"), "must ROLLBACK on failure");
  assert.ok(!sqls.includes("COMMIT"), "must NOT COMMIT on failure");
});

test("pgvector init: recreates GIN index unconditionally when column live but index missing", async () => {
  // Колонка fts уже существует с совпадающим конфигом (expr === russian), но
  // индекс потерян (crash между ADD COLUMN и CREATE INDEX на первом
  // не-атомарном init) → init должен выдать CREATE INDEX IF NOT EXISTS
  // безусловно (M4), не трогая живую колонку.
  const p = fakePoolHybrid({ expr: "to_tsvector('russian'::regconfig, ...)" });
  const st = new PgVectorStorage({ pool: p, table: "maestro_memory", dim: 3, textSearchConfig: "russian" });
  await st.init();
  const gin = p.calls.filter(([sql]) => sql.includes("_fts_idx") && sql.includes("USING gin"));
  assert.ok(gin.length >= 1, "must issue CREATE INDEX on fts even when column already matches config");
  // Никакого recreate (DROP/ADD) — колонка не трогается.
  assert.ok(!p.calls.some(([sql]) => sql.includes("DROP COLUMN IF EXISTS fts")), "must not drop live column");
});

test("pgvector get/scan exclude fts column (explicit list)", async () => {
  const p = fakePoolHybrid();
  const st = new PgVectorStorage({ pool: p, table: "maestro_memory", dim: 3 });
  await st.init();
  await st.get("s1");
  const getCall = p.calls.find(([sql]) => sql.includes("WHERE session_id = $1"));
  assert.ok(getCall, "get must run");
  assert.ok(!getCall[0].includes("SELECT *"), "get must not use SELECT *");
  assert.ok(!getCall[0].includes("fts"), "get must not select fts");
  // scan: whitelist не содержит fts.
  await st.scan({ key: "k1", fields: ["session_id", "title"] });
  const scanCall = p.calls.find(([sql]) => sql.includes("WHERE key=$1"));
  assert.ok(scanCall, "scan must run");
  assert.ok(!scanCall[0].includes("fts"), "scan must not select fts");
});

test("pgvector search: text-leg failure falls back to vector-only", async () => {
  const p = fakePoolHybrid();
  const origQuery = p.query;
  p.query = async (sql, params) => {
    p.calls.push([sql, params]);
    if (sql.includes("plainto_tsquery")) throw new Error("text leg boom");
    return origQuery(sql, params);
  };
  const st = new PgVectorStorage({ pool: p, table: "maestro_memory", dim: 3, textSearchConfig: "russian" });
  await st.init();
  const res = await st.search(new Float32Array([0.1, 0.2, 0.3]), { top_k: 3, min_score: 0, key: "k1", query: "foo" });
  // Только векторные хиты, без фузии, без throw.
  assert.equal(res.length, 1);
  assert.equal(res[0].entry.session_id, "s1");
});

// --- Review fixes: C1 (placeholder numbering), C2 (top_k cap), I2 (pg_catalog) ---

test("pgvector text leg: single-key placeholders start at $3, LIMIT is last", async () => {
  const p = fakePoolHybrid({ textRows: [{ session_id: "s2" }] });
  const st = new PgVectorStorage({ pool: p, table: "maestro_memory", dim: 3, textSearchConfig: "russian" });
  await st.init();
  await st.search(new Float32Array([0.1, 0.2, 0.3]), { top_k: 3, min_score: 0, key: "k1", query: "foo" });
  const textCall = p.calls.find(([sql]) => sql.includes("plainto_tsquery"));
  assert.ok(textCall, "text leg must run");
  // $1=cfg, $2=query, $3=key, $4=top_k (LIMIT).
  assert.ok(textCall[0].includes("key = $3"), textCall[0]);
  assert.ok(textCall[0].includes("LIMIT $4"), textCall[0]);
  assert.equal(textCall[1][0], "russian");
  assert.equal(textCall[1][1], "foo");
  assert.equal(textCall[1][2], "k1");
  assert.equal(textCall[1][3], 3);
});

test("pgvector text leg: multi-key splits — active key = $3, sibling key = $3 + merged", async () => {
  const p = fakePoolHybrid({ textRows: [{ session_id: "s2" }] });
  const st = new PgVectorStorage({ pool: p, table: "maestro_memory", dim: 3, textSearchConfig: "russian" });
  await st.init();
  await st.search(new Float32Array([0.1, 0.2, 0.3]), { top_k: 3, min_score: 0, key: "k1", project: "other", query: "foo" });
  const textCalls = p.calls.filter(([sql]) => sql.includes("plainto_tsquery"));
  assert.ok(textCalls.length >= 2, "active + sibling text legs must run");
  // Активная текстовая нога: $1=cfg, $2=query, $3=key (k1).
  const active = textCalls.find(([sql, params]) => sql.includes("key = $3") && params[2] === "k1");
  assert.ok(active, "active text leg with key = $3 (k1)");
  assert.ok(!active[0].includes("merged = 1"), "active text leg must NOT be merged-only");
  // Sibling текстовая нога: key = $3 (other) + merged = 1 (§6.2).
  const sibling = textCalls.find(([sql, params]) => sql.includes("key = $3") && params[2] === "other");
  assert.ok(sibling, "sibling text leg with key = $3 (other)");
  assert.ok(sibling[0].includes("merged = 1"), "sibling text leg must be merged-only");
});

test("pgvector text leg: date_from/author placeholders continue after key-set", async () => {
  const p = fakePoolHybrid({ textRows: [{ session_id: "s2" }] });
  const st = new PgVectorStorage({ pool: p, table: "maestro_memory", dim: 3, textSearchConfig: "russian" });
  await st.init();
  await st.search(new Float32Array([0.1, 0.2, 0.3]), { top_k: 3, min_score: 0, key: "k1", date_from: 100, author: "alice", query: "foo" });
  const textCall = p.calls.find(([sql]) => sql.includes("plainto_tsquery"));
  assert.ok(textCall, "text leg must run");
  // $1=cfg, $2=query, $3=key, $4=date_from, $5=author, $6=top_k.
  assert.ok(textCall[0].includes("key = $3"), textCall[0]);
  assert.ok(textCall[0].includes("time_last >= $4"), textCall[0]);
  assert.ok(textCall[0].includes("author = $5"), textCall[0]);
  assert.ok(textCall[0].includes("LIMIT $6"), textCall[0]);
  assert.equal(textCall[1][2], "k1");
  assert.equal(textCall[1][3], 100);
  assert.equal(textCall[1][4], "alice");
  assert.equal(textCall[1][5], 3);
});

test("pgvector hybrid: fused result capped to top_k", async () => {
  // Векторная ветка даёт 3 хита, текстовая — 3 хита; фузия даёт больше, но
  // результат должен быть ограничен top_k.
  const p = fakePoolHybrid({ textRows: [{ session_id: "s2" }, { session_id: "s3" }, { session_id: "s4" }] });
  const st = new PgVectorStorage({ pool: p, table: "maestro_memory", dim: 3, textSearchConfig: "russian" });
  await st.init();
  const res = await st.search(new Float32Array([0.1, 0.2, 0.3]), { top_k: 2, min_score: 0, key: "k1", query: "foo" });
  assert.ok(res.length <= 2, `fused result must be capped to top_k, got ${res.length}`);
});

// --- Task 3: branch/head/merged schema + candidates/markMerged ---

test("pgvector init: ADD COLUMN IF NOT EXISTS branch/head/merged", async () => {
  const p = fakePoolHybrid();
  const st = new PgVectorStorage({ pool: p, table: "maestro_memory", dim: 3, modelId: "m1" });
  await st.init();
  const adds = p.calls.filter(([sql]) => sql.includes("ADD COLUMN IF NOT EXISTS"));
  const addSql = adds.map(([sql]) => sql).join("\n");
  assert.ok(addSql.includes("branch TEXT NOT NULL DEFAULT ''"), addSql);
  assert.ok(addSql.includes("head TEXT NOT NULL DEFAULT ''"), addSql);
  assert.ok(addSql.includes("merged INT NOT NULL DEFAULT 0"), addSql);
});

test("pgvector upsert/get/scan carry branch/head/merged", async () => {
  const p = fakePoolHybrid();
  const st = new PgVectorStorage({ pool: p, table: "maestro_memory", dim: 3, modelId: "m1" });
  await st.init();
  await st.upsert([{
    session_id: "s1", key: "k1", origin_project_hash: "h1", title: "t1", summary: "s1",
    decisions: [], embedding: new Float32Array([0.1, 0.2, 0.3]),
    model_id: "m1", author: "a1", time_first: 1, time_last: 2, version: 1,
    branch: "feature/x", head: "abc123", merged: 0,
  }]);
  const ins = p.calls.find(([sql]) => sql.includes("INSERT INTO"));
  assert.ok(ins[0].includes("branch"), "INSERT must include branch");
  assert.ok(ins[0].includes("head"), "INSERT must include head");
  assert.ok(ins[0].includes("merged"), "INSERT must include merged");
  // get: явный список колонок включает branch/head/merged.
  await st.get("s1");
  const getCall = p.calls.find(([sql]) => sql.includes("WHERE session_id = $1"));
  assert.ok(getCall[0].includes("branch"), "get must select branch");
  assert.ok(getCall[0].includes("head"), "get must select head");
  assert.ok(getCall[0].includes("merged"), "get must select merged");
  // scan: whitelist включает branch/head/merged.
  await st.scan({ key: "k1", fields: ["session_id", "branch", "head", "merged"] });
  const scanCall = p.calls.find(([sql]) => sql.includes("WHERE key=$1"));
  assert.ok(scanCall[0].includes("branch"), "scan must select branch");
  assert.ok(scanCall[0].includes("head"), "scan must select head");
  assert.ok(scanCall[0].includes("merged"), "scan must select merged");
});

test("pgvector candidates(key) filters merged=1 OR head != ''", async () => {
  const p = fakePoolHybrid();
  const st = new PgVectorStorage({ pool: p, table: "maestro_memory", dim: 3, modelId: "m1" });
  await st.init();
  await st.candidates("k1");
  const sel = p.calls.find(([sql]) => sql.includes("FROM maestro_memory") && sql.includes("merged"));
  assert.ok(sel, "candidates must run a merged-filtered select");
  assert.ok(sel[0].includes("key = $1"), sel[0]);
  assert.ok(sel[0].includes("(merged = 1 OR head != '')"), sel[0]);
  assert.equal(sel[1][0], "k1");
});

test("pgvector markMerged(key, head) sets merged=1 key-scoped", async () => {
  const p = fakePoolHybrid();
  const st = new PgVectorStorage({ pool: p, table: "maestro_memory", dim: 3, modelId: "m1" });
  await st.init();
  await st.markMerged("kA", "h");
  const upd = p.calls.find(([sql]) => sql.includes("UPDATE"));
  assert.ok(upd, "markMerged must run UPDATE");
  assert.ok(upd[0].includes("SET merged = 1"), upd[0]);
  assert.ok(upd[0].includes("key = $1"), upd[0]);
  assert.ok(upd[0].includes("head = $2"), upd[0]);
  assert.equal(upd[1][0], "kA");
  assert.equal(upd[1][1], "h");
});

test("pgvector candidates: malformed decisions JSON → [] (не throw)", async () => {
  const p = fakePoolHybrid();
  const st = new PgVectorStorage({ pool: p, table: "maestro_memory", dim: 3, modelId: "m1" });
  await st.init();
  p.query = async (sql, params) => {
    p.calls.push([sql, params]);
    if (sql.includes("FROM maestro_memory")) {
      return { rows: [{ session_id: "s1", key: "k1", decisions: "not-json", merged: 1, head: "" }] };
    }
    return { rows: [] };
  };
  const cands = await st.candidates("k1");
  assert.equal(cands.length, 1);
  assert.deepEqual(cands[0].decisions, [], "malformed decisions must fall back to []");
});

test("pgvector init: pg_catalog fallback to russian when config absent", async () => {
  // cfg="klingon" отсутствует в pg_ts_config → fallback на "russian".
  const logs = [];
  const origError = console.error;
  console.error = (msg) => { logs.push(msg); };
  try {
    const p = fakePoolHybrid({ tsConfigFound: false });
    const st = new PgVectorStorage({ pool: p, table: "maestro_memory", dim: 3, textSearchConfig: "klingon" });
    await st.init();
    // DDL использует 'russian'.
    const add = p.calls.find(([sql]) => sql.includes("ADD COLUMN IF NOT EXISTS fts"));
    assert.ok(add, "must ADD COLUMN fts");
    assert.ok(add[0].includes("to_tsvector('russian'::regconfig"), add[0]);
    // Эффективный конфиг сохранён на инстансе.
    assert.equal(st.textSearchConfig, "russian");
    // Лог эмитирован.
    assert.ok(logs.some((l) => l.includes("not found in pg_ts_config, falling back to russian")), logs.join("\n"));
  } finally {
    console.error = origError;
  }
});
