import { test } from "node:test";
import assert from "node:assert/strict";
import { createStorage } from "./storage.js";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function mkEntry(session_id, key, title) {
  return {
    session_id, key, origin_project_hash: key, title, summary: "s",
    decisions: [], embedding: new Float32Array([0.1, 0.2, 0.3]),
    model_id: "m", author: "a", time_first: 1, time_last: 2, version: 1,
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
    const sts = await st.stats();
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
