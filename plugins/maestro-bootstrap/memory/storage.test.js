import { test } from "node:test";
import assert from "node:assert/strict";
import { createStorage } from "./storage.js";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";

function mkEntry(session_id, key, title, extra = {}) {
  return {
    session_id, key, origin_project_hash: key, title, summary: "s",
    decisions: [], embedding: new Float32Array([0.1, 0.2, 0.3]),
    model_id: "m", author: "a", time_first: 1, time_last: 2, version: 1,
    ...extra,
  };
}

test("sqlite upsert/search/delete", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mem-"));
  const st = createStorage({ type: "sqlite", options: { dbPath: join(dir, "memory.db") }, modelId: "m", dim: 3 });
  try {
    await st.init();
    await st.upsert([mkEntry("s1", "k1", "t1"), mkEntry("s2", "k2", "t2")]);
    const hits = await st.search(new Float32Array([0.1, 0.2, 0.3]), { top_k: 2, min_score: 0.5, key: "k1" });
    assert.equal(hits.length, 1);
    assert.equal(hits[0].entry.session_id, "s1");
    assert.equal(hits[0].entry.title, "t1");
    await st.delete("s1");
    const hits2 = await st.search(new Float32Array([0.1, 0.2, 0.3]), { top_k: 2, min_score: 0.5, key: "k1" });
    assert.equal(hits2.length, 0);
    const sts = await st.stats({ key: "k2" });
    assert.equal(sts.entries, 1);
  } finally {
    await st.dispose();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("search below min_score returns empty", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mem-"));
  const st = createStorage({ type: "sqlite", options: { dbPath: join(dir, "memory.db") }, modelId: "m", dim: 3 });
  try {
    await st.init();
    await st.upsert([mkEntry("s1", "k1", "t1")]);
    // orthogonal-ish vector: large negative → very low cosine similarity
    const hits = await st.search(new Float32Array([-0.1, -0.2, -0.3]), { top_k: 2, min_score: 0.5, key: "k1" });
    assert.equal(hits.length, 0);
  } finally {
    await st.dispose();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("search requires key", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mem-"));
  const st = createStorage({ type: "sqlite", options: { dbPath: join(dir, "memory.db") }, modelId: "m", dim: 3 });
  try {
    await st.init();
    await assert.rejects(() => st.search(new Float32Array([0.1, 0.2, 0.3]), { top_k: 2, min_score: 0.5 }), /key required/);
  } finally {
    await st.dispose();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("search filters by date range", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mem-"));
  const st = createStorage({ type: "sqlite", options: { dbPath: join(dir, "memory.db") }, modelId: "m", dim: 3 });
  try {
    await st.init();
    await st.upsert([
      mkEntry("s1", "k1", "t1", { time_last: 100 }),
      mkEntry("s2", "k1", "t2", { time_last: 1000 }),
    ]);
    const hits = await st.search(new Float32Array([0.1, 0.2, 0.3]), { top_k: 5, min_score: 0, key: "k1", date_from: 500 });
    assert.ok(hits.some((h) => h.entry.session_id === "s2"), "date_from must keep s2");
    assert.ok(!hits.some((h) => h.entry.session_id === "s1"), "date_from must drop s1");
    const hits2 = await st.search(new Float32Array([0.1, 0.2, 0.3]), { top_k: 5, min_score: 0, key: "k1", date_to: 500 });
    assert.ok(hits2.some((h) => h.entry.session_id === "s1"), "date_to must keep s1");
    assert.ok(!hits2.some((h) => h.entry.session_id === "s2"), "date_to must drop s2");
  } finally {
    await st.dispose();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("search filters by author", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mem-"));
  const st = createStorage({ type: "sqlite", options: { dbPath: join(dir, "memory.db") }, modelId: "m", dim: 3 });
  try {
    await st.init();
    await st.upsert([
      mkEntry("s1", "k1", "t1", { author: "alice" }),
      mkEntry("s2", "k1", "t2", { author: "bob" }),
    ]);
    const hits = await st.search(new Float32Array([0.1, 0.2, 0.3]), { top_k: 5, min_score: 0, key: "k1", author: "alice" });
    assert.ok(hits.some((h) => h.entry.session_id === "s1"), "author filter must keep alice");
    assert.ok(!hits.some((h) => h.entry.session_id === "s2"), "author filter must drop bob");
  } finally {
    await st.dispose();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("search project on sqlite throws clear error", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mem-"));
  const st = createStorage({ type: "sqlite", options: { dbPath: join(dir, "memory.db") }, modelId: "m", dim: 3 });
  try {
    await st.init();
    await assert.rejects(
      () => st.search(new Float32Array([0.1, 0.2, 0.3]), { top_k: 5, min_score: 0, key: "k1", project: "other" }),
      /централизованн/i,
    );
  } finally {
    await st.dispose();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("sqlite model mismatch throws", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mem-"));
  const dbPath = join(dir, "memory.db");
  const st = createStorage({ type: "sqlite", options: { dbPath: dbPath }, modelId: "m", dim: 3 });
  await st.init();
  await st.dispose();
  const st2 = createStorage({ type: "sqlite", options: { dbPath }, modelId: "m2", dim: 3 });
  await assert.rejects(() => st2.init(), /model mismatch/);
  // st2.db may or may not be null depending on error path — safe no-op
  await st2.dispose();
  rmSync(dir, { recursive: true, force: true });
});

test("sqlite dimension mismatch throws", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mem-"));
  const dbPath = join(dir, "memory.db");
  const st = createStorage({ type: "sqlite", options: { dbPath }, modelId: "m", dim: 3 });
  await st.init();
  await st.upsert([mkEntry("s1", "k1", "t1")]); // dim 3
  await st.dispose();
  const st2 = createStorage({ type: "sqlite", options: { dbPath }, modelId: "m", dim: 4 });
  await assert.rejects(() => st2.init(), /dimension mismatch/);
  await st2.dispose();
  rmSync(dir, { recursive: true, force: true });
});

test("sqlite get returns entry or null", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mem-"));
  const st = createStorage({ type: "sqlite", options: { dbPath: join(dir, "memory.db") }, modelId: "m", dim: 3 });
  try {
    await st.init();
    await st.upsert([mkEntry("s1", "k1", "t1")]);
    const found = await st.get("s1");
    assert.ok(found);
    assert.equal(found.session_id, "s1");
    assert.equal(found.title, "t1");
    assert.deepStrictEqual(found.decisions, []);
    const notFound = await st.get("nonexistent");
    assert.equal(notFound, null);
  } finally {
    await st.dispose();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("sqlite deleteByFilter deletes within key by author", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mem-"));
  const st = createStorage({ type: "sqlite", options: { dbPath: join(dir, "memory.db") }, modelId: "m", dim: 3 });
  try {
    await st.init();
    await st.upsert([
      mkEntry("s1", "k1", "t1", { author: "a" }),
      mkEntry("s2", "k2", "t2", { author: "a" }),
      mkEntry("s3", "k1", "t3", { author: "b" }),
    ]);
    const n = await st.deleteByFilter({ key: "k1", author: "a" });
    assert.equal(n, 1); // only s1 (k1 + author a), not s2 (k2) nor s3 (k1 author b)
    assert.equal(await st.get("s1"), null);
    assert.ok(await st.get("s2"));
    assert.ok(await st.get("s3"));
  } finally {
    await st.dispose();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("sqlite deleteByFilter before date", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mem-"));
  const st = createStorage({ type: "sqlite", options: { dbPath: join(dir, "memory.db") }, modelId: "m", dim: 3 });
  try {
    await st.init();
    await st.upsert([
      mkEntry("s1", "k1", "t1", { time_last: 100 }),
      mkEntry("s2", "k1", "t2", { time_last: 200 }),
    ]);
    const n = await st.deleteByFilter({ key: "k1", before: 150 });
    assert.equal(n, 1); // only s1 (time_last 100 <= 150)
    assert.equal(await st.get("s1"), null);
    assert.ok(await st.get("s2"));
  } finally {
    await st.dispose();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("sqlite deleteByFilter requires key", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mem-"));
  const st = createStorage({ type: "sqlite", options: { dbPath: join(dir, "memory.db") }, modelId: "m", dim: 3 });
  try {
    await st.init();
    await assert.rejects(() => st.deleteByFilter({ author: "a" }), /key required/);
  } finally {
    await st.dispose();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("sqlite prune removes old entries", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mem-"));
  const st = createStorage({ type: "sqlite", options: { dbPath: join(dir, "memory.db") }, modelId: "m", dim: 3 });
  try {
    await st.init();
    const now = Date.now();
    await st.upsert([
      mkEntry("s1", "k1", "t1", { time_last: now - 40 * 86400_000 }), // 40d old
      mkEntry("s2", "k1", "t2", { time_last: now - 1 * 86400_000 }),   // 1d old
      mkEntry("s3", "k2", "t3", { time_last: now - 40 * 86400_000 }), // 40d old, other key
    ]);
    const n = await st.prune({ key: "k1", olderThanDays: 30 });
    assert.equal(n, 1); // only s1 (k1, 40d old)
    assert.equal(await st.get("s1"), null);
    assert.ok(await st.get("s2"));
    assert.ok(await st.get("s3"));
  } finally {
    await st.dispose();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("fts backfill indexes existing entries (re-init)", async () => {
  const dbPath = join(mkdtempSync(join(tmpdir(), "fts-")), "m.db");
  const st = createStorage({ type: "sqlite", options: { dbPath }, modelId: "m", dim: 3 });
  try {
    await st.init();
    await st.upsert([{ ...mkEntry("s1", "k1", "Auth refactor"), summary: "OAuth2 tokens expiry handling" }]);
  } finally {
    await st.dispose();
  }
  const st2 = createStorage({ type: "sqlite", options: { dbPath }, modelId: "m", dim: 3 });
  try {
    await st2.init(); // backfill should index s1
    const vec = new Float32Array([0.9, 0.9, 0.9]); // far from s1 vector
    const hits = await st2.search(vec, { top_k: 5, min_score: 0, key: "k1", query: "OAuth" });
    assert.ok(hits.some((h) => h.entry.session_id === "s1"), "FTS match surfaced");
  } finally {
    await st2.dispose();
  }
  // Re-init again → backfill must be idempotent (no duplicate FTS rows).
  const st3 = createStorage({ type: "sqlite", options: { dbPath }, modelId: "m", dim: 3 });
  try {
    await st3.init();
    const n = st3.db.prepare("SELECT COUNT(*) c FROM memory_fts WHERE session_id = ?").get("s1").c;
    assert.equal(n, 1, "no duplicate FTS rows after repeated init");
  } finally {
    await st3.dispose();
  }
  rmSync(dirname(dbPath), { recursive: true, force: true });
});

test("hybrid search returns FTS match even with low vector similarity", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mem-"));
  const st = createStorage({ type: "sqlite", options: { dbPath: join(dir, "memory.db") }, modelId: "m", dim: 3 });
  try {
    await st.init();
    await st.upsert([mkEntry("s1", "k1", "Auth refactor", { embedding: new Float32Array([1, 0, 0]) })]);
    // orthogonal query vector → cosine 0, below min_score → vector-only would miss it
    const vec = new Float32Array([0, 1, 0]);
    const hits = await st.search(vec, { top_k: 5, min_score: 0.5, key: "k1", query: "refactor" });
    assert.ok(hits.some((h) => h.entry.session_id === "s1"), "FTS match surfaced despite low vector similarity");
  } finally {
    await st.dispose();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("fts ranking: strong keyword match ranks before weak match", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mem-"));
  const st = createStorage({ type: "sqlite", options: { dbPath: join(dir, "memory.db") }, modelId: "m", dim: 3 });
  try {
    await st.init();
    // The weak match has an orthogonal vector (cosine 0 → filtered out of the
    // vector path by min_score), so it can only surface via FTS. The strong
    // match has a high-similarity vector AND a strong keyword match. If FTS
    // ranking is correct (ASC bm25), the strong match must rank first.
    await st.upsert([
      mkEntry("weak", "k1", "Cache invalidation", { summary: "mentions oauth once", embedding: new Float32Array([0, 1, 0]) }),
      mkEntry("strong", "k1", "OAuth token refresh", { summary: "OAuth OAuth OAuth flow", embedding: new Float32Array([1, 0, 0]) }),
    ]);
    const hits = await st.search(new Float32Array([1, 0, 0]), { top_k: 5, min_score: 0.5, key: "k1", query: "OAuth" });
    assert.ok(hits.length >= 2, "both matches must be surfaced (weak via FTS)");
    const idx = (sid) => hits.findIndex((h) => h.entry.session_id === sid);
    assert.ok(idx("strong") !== -1 && idx("weak") !== -1, "both entries present");
    assert.ok(idx("strong") < idx("weak"), "strong keyword match must rank before weak match");
  } finally {
    await st.dispose();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("hybrid search caps fused results to top_k when vector+text both contribute", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mem-"));
  const st = createStorage({ type: "sqlite", options: { dbPath: join(dir, "memory.db") }, modelId: "m", dim: 3 });
  try {
    await st.init();
    // s3 — слабый вектор (ортогонален → отсекается min_score), но сильнейший
    // FTS-матч. s1/s2 — сильные векторы. Без cap фьюжн вернул бы 3 хита
    // (s1, s2 из вектора + s3 из FTS); с cap — ровно top_k.
    await st.upsert([
      mkEntry("s1", "k1", "OAuth token refresh", { summary: "OAuth OAuth OAuth flow", embedding: new Float32Array([1, 0, 0]) }),
      mkEntry("s2", "k1", "OAuth cache", { summary: "OAuth tokens", embedding: new Float32Array([0.9, 0.1, 0]) }),
      mkEntry("s3", "k1", "OAuth OAuth OAuth OAuth", { summary: "OAuth OAuth OAuth OAuth OAuth", embedding: new Float32Array([0, 1, 0]) }),
    ]);
    const hits = await st.search(new Float32Array([1, 0, 0]), { top_k: 2, min_score: 0.5, key: "k1", query: "OAuth" });
    assert.equal(hits.length, 2, "fused hybrid result must be capped to top_k");
  } finally {
    await st.dispose();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("fts stays in sync after delete", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mem-"));
  const st = createStorage({ type: "sqlite", options: { dbPath: join(dir, "memory.db") }, modelId: "m", dim: 3 });
  try {
    await st.init();
    await st.upsert([mkEntry("s1", "k1", "Auth refactor", { summary: "OAuth2 tokens" })]);
    await st.delete("s1");
    const hits = await st.search(new Float32Array([0.1, 0.2, 0.3]), { top_k: 5, min_score: 0, key: "k1", query: "OAuth" });
    assert.equal(hits.some((h) => h.entry.session_id === "s1"), false, "FTS row removed on delete");
  } finally {
    await st.dispose();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("fts stays in sync after deleteByFilter and prune", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mem-"));
  const st = createStorage({ type: "sqlite", options: { dbPath: join(dir, "memory.db") }, modelId: "m", dim: 3 });
  try {
    await st.init();
    const now = Date.now();
    await st.upsert([
      mkEntry("s1", "k1", "Auth refactor", { summary: "OAuth2 tokens", time_last: now }),
      mkEntry("s2", "k1", "Cache invalidation", { summary: "ETag headers", time_last: now - 40 * 86400_000 }),
    ]);
    // deleteByFilter removes s1 (k1) → its FTS row must go too.
    await st.deleteByFilter({ key: "k1", session_id: "s1" });
    let hits = await st.search(new Float32Array([0.1, 0.2, 0.3]), { top_k: 5, min_score: 0, key: "k1", query: "OAuth" });
    assert.equal(hits.some((h) => h.entry.session_id === "s1"), false, "FTS row removed on deleteByFilter");
    // prune removes s2 (k1, 40d old) → its FTS row must go too.
    await st.prune({ key: "k1", olderThanDays: 30 });
    hits = await st.search(new Float32Array([0.1, 0.2, 0.3]), { top_k: 5, min_score: 0, key: "k1", query: "ETag" });
    assert.equal(hits.some((h) => h.entry.session_id === "s2"), false, "FTS row removed on prune");
  } finally {
    await st.dispose();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("sqlite lazy-loads better-sqlite3 from moduleDir/node_modules", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mem-"));
  // Stub better-sqlite3 in moduleDir/node_modules — init must resolve from there.
  const nm = join(dir, "node_modules", "better-sqlite3");
  mkdirSync(nm, { recursive: true });
  writeFileSync(join(nm, "package.json"), JSON.stringify({ name: "better-sqlite3", main: "index.js" }));
  writeFileSync(
    join(nm, "index.js"),
    "module.exports = function StubDatabase(){ throw new Error('stub-better-sqlite3-loaded'); };",
  );
  const st = createStorage({
    type: "sqlite",
    options: { dbPath: join(dir, "memory.db"), moduleDir: dir },
    modelId: "m",
    dim: 3,
  });
  try {
    await assert.rejects(
      () => st.init(),
      /stub-better-sqlite3-loaded/,
      "must load better-sqlite3 from moduleDir/node_modules",
    );
  } finally {
    await st.dispose();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("qdrant factory returns QdrantStorage with valid options", async () => {
  const c = { collectionExists: async () => ({ exists: false }), createCollection: async () => {} };
  const st = createStorage({ type: "qdrant", options: { client: c, collection: "c" }, modelId: "m", dim: 3 });
  assert.equal(st.constructor.name, "QdrantStorage");
  await st.init(); // should not throw with a valid client
});
test("qdrant factory rejects missing client", async () => {
  const st = createStorage({ type: "qdrant", options: { collection: "c" }, modelId: "m", dim: 3 });
  assert.equal(st.constructor.name, "QdrantStorage");
  // init should fail without a valid client
  await assert.rejects(() => st.init(), /client|collectionExists/);
});

test("qdrant get returns entry or null", async () => {
  let storedPayload = null;
  const c = {
    collectionExists: async () => ({ exists: false }),
    createCollection: async () => {},
    upsert: async (_, { points }) => { storedPayload = points[0]?.payload ?? null; },
    query: async (col, { filter, limit, with_payload }) => {
      // get: filter-only query { must: [{ key, match: { value } }] }
      if (filter?.must?.[0]?.key === "session_id") {
        const sid = filter.must[0].match.value;
        if (sid === "s1" && storedPayload) {
          // Return raw payload (decisions is still a JSON string — get will parse it)
          return { points: [{ id: "uuid", payload: storedPayload }] };
        }
        return { points: [] };
      }
      return { points: [] };
    },
    delete: async () => {},
    count: async () => ({ count: 0 }),
  };
  const st = createStorage({ type: "qdrant", options: { client: c, collection: "c" }, modelId: "m", dim: 3 });
  await st.init();
  await st.upsert([mkEntry("s1", "k1", "t1")]);
  const found = await st.get("s1");
  assert.ok(found);
  assert.equal(found.session_id, "s1");
  assert.equal(found.title, "t1");
  assert.deepStrictEqual(found.decisions, []);
  const notFound = await st.get("nonexistent");
  assert.equal(notFound, null);
});

test("stats is key-scoped", async () => {
  const st = createStorage({ type: "sqlite", options: { dbPath: ":memory:" }, modelId: "m", dim: 3 });
  await st.init();
  await st.upsert([mkEntry("s1", "k1", "t1"), mkEntry("s2", "k2", "t2")]);
  const s1 = await st.stats({ key: "k1" });
  const s2 = await st.stats({ key: "k2" });
  assert.equal(s1.entries, 1);
  assert.equal(s2.entries, 1);
});

test("scan returns requested fields with decisions parsed", async () => {
  const st = createStorage({ type: "sqlite", options: { dbPath: ":memory:" }, modelId: "m", dim: 3 });
  await st.init();
  await st.upsert([{ ...mkEntry("s1", "k1", "t1"), decisions: ["d1"], time_last: 100 }]);
  const rows = await st.scan({ key: "k1", fields: ["session_id", "title", "author", "time_last", "decisions"] });
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].decisions, ["d1"]);
  assert.equal(rows[0].embedding, undefined); // not requested
});

test("scan requires key", async () => {
  const st = createStorage({ type: "sqlite", options: { dbPath: ":memory:" }, modelId: "m", dim: 3 });
  await st.init();
  await assert.rejects(() => st.scan({}), /key required/);
});

test("scan without decisions field does not crash", async () => {
  const st = createStorage({ type: "sqlite", options: { dbPath: ":memory:" }, modelId: "m", dim: 3 });
  await st.init();
  await st.upsert([mkEntry("s1", "k1", "t1")]);
  const rows = await st.scan({ key: "k1", fields: ["title", "author"] });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].title, "t1");
  assert.equal(rows[0].decisions, undefined);
});

test("scan invalid fields throws", async () => {
  const st = createStorage({ type: "sqlite", options: { dbPath: ":memory:" }, modelId: "m", dim: 3 });
  await st.init();
  await st.upsert([mkEntry("s1", "k1", "t1")]);
  await assert.rejects(() => st.scan({ key: "k1", fields: ["nonexistent"] }), /no valid fields/);
});

test("pgvector factory rejects missing pool", async () => {
  const st = createStorage({ type: "pgvector", options: { table: "m" }, modelId: "m1", dim: 3 });
  assert.equal(st.constructor.name, "PgVectorStorage");
  await assert.rejects(() => st.init(), /pgvector/);
});

test("pgvector get returns entry or null", async () => {
  const rows = [];
  const pool = {
    query: async (sql, params) => {
      if (sql.includes("SELECT count")) return { rows: [{ count: 0 }] };
      if (sql.includes("CREATE")) return { rows: [] };
      if (sql.includes("INSERT")) return { rows: [] };
      if (sql.includes("DELETE")) return { rows: [] };
      if (sql.includes("SELECT * FROM m WHERE session_id")) {
        const sid = params[0];
        const found = rows.find((r) => r.session_id === sid);
        return { rows: found ? [found] : [] };
      }
      return { rows: [] };
    },
  };
  const st = createStorage({ type: "pgvector", options: { pool, table: "m" }, modelId: "m", dim: 3 });
  await st.init();
  // Manually insert a row (simulate upsert)
  rows.push({
    session_id: "s1", key: "k1", origin_project_hash: "k1", title: "t1",
    summary: "s", decisions: JSON.stringify([]),
    model_id: "m", author: "a", time_first: 1, time_last: 2, version: 1,
  });
  const found = await st.get("s1");
  assert.ok(found);
  assert.equal(found.session_id, "s1");
  assert.equal(found.title, "t1");
  assert.deepStrictEqual(found.decisions, []);
  const notFound = await st.get("nonexistent");
  assert.equal(notFound, null);
});
