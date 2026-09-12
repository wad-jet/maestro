import { test } from "node:test";
import assert from "node:assert/strict";
import { SqliteStorage } from "./sqlite.js";
import { sanitizeDirName } from "../config.js";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function mkEntry(session_id, key, title, extra = {}) {
  return {
    session_id, key, origin_project_hash: key, title, summary: "s",
    decisions: [], embedding: new Float32Array([0.1, 0.2, 0.3]),
    model_id: "m", author: "a", time_first: 1, time_last: 2, version: 1,
    ...extra,
  };
}

test("sqlite (node:sqlite driver) full round-trip: init/upsert/search/fts/delete", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mem-ns-"));
  const st = new SqliteStorage({ dbPath: join(dir, "memory.db"), modelId: "m", dim: 3, forceDriver: "node:sqlite" });
  try {
    await st.init();
    // s2 — ортогональный вектор (cosine 0.267 < min_score 0.5): векторный поиск
    // возвращает только s1, хотя оба хита под одним key "k1" (см. stats ниже).
    await st.upsert([mkEntry("s1", "k1", "hello world"), mkEntry("s2", "k1", "other", { embedding: new Float32Array([1, 0, 0]) })]);
    const hits = await st.search(new Float32Array([0.1, 0.2, 0.3]), { top_k: 2, min_score: 0.5, key: "k1" });
    assert.equal(hits.length, 1);
    assert.equal(hits[0].entry.session_id, "s1");
    const fts = await st.search(new Float32Array([0.1, 0.2, 0.3]), { top_k: 2, min_score: 0, key: "k1", query: "hello" });
    assert.ok(fts.some((h) => h.entry.session_id === "s1"), "FTS hit expected");
    const sts = await st.stats({ key: "k1" });
    assert.equal(sts.entries, 2);
    await st.delete("s1");
    const after = await st.stats({ key: "k1" });
    assert.equal(after.entries, 1);
  } finally {
    await st.dispose();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("sqlite (node:sqlite driver) hybrid: text-only FTS hit dropped when min_score > 0.5", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mem-ns-"));
  const st = new SqliteStorage({ dbPath: join(dir, "memory.db"), modelId: "m", dim: 3, forceDriver: "node:sqlite" });
  try {
    await st.init();
    // s1 — ортогональный вектор (cosine 0 < min_score 0.7): из векторной ветки
    // выпадает, остаётся только FTS-хит с display score 0.5. Единый пост-фильтр
    // fuseRrf (minScore) должен отбросить его при min_score > 0.5.
    await st.upsert([mkEntry("s1", "k1", "OAuth token refresh", { embedding: new Float32Array([1, 0, 0]) })]);
    const hits = await st.search(new Float32Array([0, 1, 0]), { top_k: 5, min_score: 0.7, key: "k1", query: "OAuth" });
    assert.equal(hits.length, 0, "text-only hit below min_score must be dropped");
    // Positive control: тот же FTS-only хит (score 0.5) проходит при min_score ≤ 0.5.
    // Защищает тест от vacuous-pass — если FTS-ветка сломается, упадёт здесь.
    const hitsLow = await st.search(new Float32Array([0, 1, 0]), { top_k: 5, min_score: 0.3, key: "k1", query: "OAuth" });
    assert.equal(hitsLow.length, 1, "text-only hit must pass at min_score ≤ 0.5");
    assert.equal(hitsLow[0].entry.session_id, "s1");
  } finally {
    await st.dispose();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("sqlite FTS: OR matching — partial multi-token match is found (I1)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mem-ns-or-"));
  const st = new SqliteStorage({ dbPath: join(dir, "memory.db"), modelId: "m", dim: 3, forceDriver: "node:sqlite" });
  try {
    await st.init();
    // Векторы ортогональны запросу [0,0,1] (cos 0 < min_score 0.5) —
    // записи доступны только через FTS-ногу.
    await st.upsert([
      mkEntry("s1", "k1", "alpha world", { embedding: new Float32Array([1, 0, 0]) }),
      mkEntry("s3", "k1", "beta memory", { embedding: new Float32Array([0, 1, 0]) }),
    ]);
    const hits = await st.search(new Float32Array([0, 0, 1]), { top_k: 5, min_score: 0.5, key: "k1", query: "alpha beta" });
    assert.ok(hits.some((h) => h.entry.session_id === "s1"), "частичное совпадение (alpha*) находится через OR");
    assert.ok(hits.some((h) => h.entry.session_id === "s3"), "частичное совпадение (beta*) находится через OR");
  } finally {
    await st.dispose();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("sqlite FTS: full match ranks above partial (bm25)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mem-ns-or2-"));
  const st = new SqliteStorage({ dbPath: join(dir, "memory.db"), modelId: "m", dim: 3, forceDriver: "node:sqlite" });
  try {
    await st.init();
    await st.upsert([
      mkEntry("s1", "k1", "alpha world", { embedding: new Float32Array([1, 0, 0]) }),
      mkEntry("s4", "k1", "alpha beta report", { embedding: new Float32Array([0, 1, 0]) }),
    ]);
    const hits = await st.search(new Float32Array([0, 0, 1]), { top_k: 5, min_score: 0.5, key: "k1", query: "alpha beta" });
    assert.equal(hits.length, 2);
    assert.equal(hits[0].entry.session_id, "s4", "полное совпадение (оба терма) ранжируется выше");
  } finally {
    await st.dispose();
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── Task 4 (v5.2): artifacts поле ──

test("sqlite artifacts round-trip: upsert → get/search/scan carry parsed artifacts", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mem-art-"));
  const st = new SqliteStorage({ dbPath: join(dir, "memory.db"), modelId: "m", dim: 3, forceDriver: "node:sqlite" });
  try {
    await st.init();
    await st.upsert([mkEntry("s1", "k1", "hello world", { artifacts: ["docs/spec.md", "src/index.js"] })]);
    // get
    const got = await st.get("s1");
    assert.deepEqual(got.artifacts, ["docs/spec.md", "src/index.js"]);
    // search (vector)
    const hits = await st.search(new Float32Array([0.1, 0.2, 0.3]), { top_k: 2, min_score: 0, key: "k1" });
    assert.equal(hits.length, 1);
    assert.deepEqual(hits[0].entry.artifacts, ["docs/spec.md", "src/index.js"]);
    // scan
    const rows = await st.scan({ key: "k1", fields: ["session_id", "artifacts"] });
    assert.equal(rows.length, 1);
    assert.deepEqual(rows[0].artifacts, ["docs/spec.md", "src/index.js"]);
  } finally {
    await st.dispose();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("sqlite artifacts: malformed JSON in column → [] (guard)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mem-art-bad-"));
  const st = new SqliteStorage({ dbPath: join(dir, "memory.db"), modelId: "m", dim: 3, forceDriver: "node:sqlite" });
  try {
    await st.init();
    await st.upsert([mkEntry("s1", "k1", "hello")]);
    // Corrupt the column directly (upgrade-path robustness).
    st.db.prepare("UPDATE memory SET artifacts = 'not-json' WHERE session_id = 's1'").run();
    const got = await st.get("s1");
    assert.deepEqual(got.artifacts, []);
    const rows = await st.scan({ key: "k1", fields: ["session_id", "artifacts"] });
    assert.deepEqual(rows[0].artifacts, []);
    const hits = await st.search(new Float32Array([0.1, 0.2, 0.3]), { top_k: 2, min_score: 0, key: "k1" });
    assert.deepEqual(hits[0].entry.artifacts, []);
  } finally {
    await st.dispose();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("sqlite old schema (no artifacts column) → ALTER idempotent + default []", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mem-art-old-"));
  const dbPath = join(dir, "memory.db");
  // Вручную создаём pre-v5.2 таблицу (без artifacts) + meta.
  const { DatabaseSync } = process.getBuiltinModule("node:sqlite");
  const raw = new DatabaseSync(dbPath, { open: true });
  raw.exec(`CREATE TABLE memory (
    session_id TEXT PRIMARY KEY,
    key TEXT NOT NULL,
    origin_project_hash TEXT NOT NULL,
    title TEXT NOT NULL,
    summary TEXT NOT NULL,
    decisions TEXT NOT NULL,
    embedding BLOB NOT NULL,
    model_id TEXT NOT NULL,
    author TEXT NOT NULL,
    time_first INTEGER NOT NULL,
    time_last INTEGER NOT NULL,
    version INTEGER NOT NULL
  )`);
  raw.exec(`CREATE TABLE meta (name TEXT PRIMARY KEY, value TEXT NOT NULL)`);
  raw.close();
  const st = new SqliteStorage({ dbPath, modelId: "m", dim: 3, forceDriver: "node:sqlite" });
  try {
    await st.init(); // должен ALTER ADD COLUMN artifacts
    const cols = st.db.prepare("PRAGMA table_info(memory)").all().map((c) => c.name);
    assert.ok(cols.includes("artifacts"), "artifacts column added");
    // Повторный init идемпотентен (не падает).
    await st.dispose();
    const st2 = new SqliteStorage({ dbPath, modelId: "m", dim: 3, forceDriver: "node:sqlite" });
    await st2.init();
    // Запись без artifacts → default [].
    await st2.upsert([mkEntry("s1", "k1", "hello")]);
    const got = await st2.get("s1");
    assert.deepEqual(got.artifacts, []);
    await st2.dispose();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("sqlite migrateKey carries artifacts into target (I3)", async () => {
  const base = mkdtempSync(join(tmpdir(), "mm-sqlite-migrate-art-"));
  const dir = (key) => join(base, "maestro", "memory", sanitizeDirName(key));
  const fromKey = "old.ns"; const toKey = "new.ns";
  mkdirSync(dir(fromKey), { recursive: true });
  mkdirSync(dir(toKey), { recursive: true });
  const mk = (key) => new SqliteStorage({ dbPath: join(dir(key), "memory.db"), modelId: "m", dim: 3, moduleDir: null, key });
  const from = mk(fromKey); const to = mk(toKey);
  try {
    await from.init();
    await to.init();
    await from.upsert([{ session_id: "s1", key: fromKey, origin_project_hash: "h", title: "Source", summary: "s", decisions: [], artifacts: ["docs/spec.md"], model_id: "m", author: "a", time_first: 1, time_last: 2, version: 1, embedding: new Float32Array([0.1, 0.2, 0.3]) }]);
    await from.dispose();
    const n = await to.migrateKey(fromKey, toKey);
    assert.equal(n, 1);
    const migrated = await to.get("s1");
    assert.deepEqual(migrated.artifacts, ["docs/spec.md"], "artifacts carried through migrateKey");
  } finally {
    await from.dispose();
    await to.dispose();
    rmSync(base, { recursive: true, force: true });
  }
});

test("sqlite migrateKey: source bucket without artifacts column → [] (I3)", async () => {
  const base = mkdtempSync(join(tmpdir(), "mm-sqlite-migrate-art2-"));
  const dir = (key) => join(base, "maestro", "memory", sanitizeDirName(key));
  const fromKey = "old.ns"; const toKey = "new.ns";
  mkdirSync(dir(fromKey), { recursive: true });
  mkdirSync(dir(toKey), { recursive: true });
  // Source: pre-v5.2 schema (no artifacts column) с одной записью.
  const { DatabaseSync } = process.getBuiltinModule("node:sqlite");
  const raw = new DatabaseSync(join(dir(fromKey), "memory.db"), { open: true });
  raw.exec(`CREATE TABLE memory (
    session_id TEXT PRIMARY KEY,
    key TEXT NOT NULL,
    origin_project_hash TEXT NOT NULL,
    title TEXT NOT NULL,
    summary TEXT NOT NULL,
    decisions TEXT NOT NULL,
    embedding BLOB NOT NULL,
    model_id TEXT NOT NULL,
    author TEXT NOT NULL,
    time_first INTEGER NOT NULL,
    time_last INTEGER NOT NULL,
    version INTEGER NOT NULL
  )`);
  raw.exec(`CREATE TABLE meta (name TEXT PRIMARY KEY, value TEXT NOT NULL)`);
  raw.exec(`INSERT INTO meta (name, value) VALUES ('model_id', 'm'), ('dim', '3')`);
  const emb = Buffer.from(new Float32Array([0.1, 0.2, 0.3]).buffer);
  raw.prepare(`INSERT INTO memory (session_id, key, origin_project_hash, title, summary, decisions, embedding, model_id, author, time_first, time_last, version)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run("s1", fromKey, "h", "Source", "s", "[]", emb, "m", "a", 1, 2, 1);
  raw.close();
  const to = new SqliteStorage({ dbPath: join(dir(toKey), "memory.db"), modelId: "m", dim: 3, moduleDir: null, key: toKey });
  try {
    await to.init();
    const n = await to.migrateKey(fromKey, toKey);
    assert.equal(n, 1);
    const migrated = await to.get("s1");
    assert.deepEqual(migrated.artifacts, [], "source without artifacts column → []");
  } finally {
    await to.dispose();
    rmSync(base, { recursive: true, force: true });
  }
});
