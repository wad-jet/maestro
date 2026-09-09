import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createStorage } from "./storage.js";
import { SqliteStorage } from "./storage/sqlite.js";
import { sanitizeDirName } from "./config.js";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";

const require = createRequire(import.meta.url);

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

test("sqlite cross-project search reads sibling DB read-only", async () => {
  const base = mkdtempSync(join(tmpdir(), "mm-sqlite-xp-"));
  const dir = (key) => join(base, "maestro", "memory", sanitizeDirName(key));
  const activeKey = "active"; const other = "other";
  mkdirSync(dir(activeKey), { recursive: true });
  mkdirSync(dir(other), { recursive: true });
  const mk = (key) => new SqliteStorage({ dbPath: join(dir(key), "memory.db"), modelId: "m", dim: 3, moduleDir: null });
  const active = mk(activeKey); const otherDb = mk(other);
  try {
    await otherDb.init();
    await otherDb.upsert([{ session_id: "o1", key: other, origin_project_hash: "ho", title: "Other Project", summary: "sum", decisions: [], model_id: "m", author: "a", time_first: 1, time_last: 2, version: 1, embedding: new Float32Array([1, 0, 0]), merged: 1 }]);
    await otherDb.dispose();
    await active.init();
    await active.upsert([{ session_id: "a1", key: activeKey, origin_project_hash: "ha", title: "Active", summary: "sum", decisions: [], model_id: "m", author: "a", time_first: 1, time_last: 2, version: 1, embedding: new Float32Array([0, 1, 0]) }]);
    const res = await active.search(new Float32Array([1, 0, 0]), { key: activeKey, project: other, top_k: 10, min_score: 0 });
    const ids = res.map((h) => h.entry.session_id);
    assert.ok(ids.includes("o1"), "sibling hit present");
    assert.ok(ids.includes("a1"), "active hit present");
    // Провенанс: sibling-хит помечен _source_key.
    const o1 = res.find((h) => h.entry.session_id === "o1");
    assert.equal(o1.entry._source_key, other, "sibling hit carries _source_key");
    const a1 = res.find((h) => h.entry.session_id === "a1");
    assert.equal(a1.entry._source_key, undefined, "active hit has no _source_key");
  } finally {
    await active.dispose();
    await otherDb.dispose();
    rmSync(base, { recursive: true, force: true });
  }
});

test("sqlite cross-project: sibling is opened read-only", async () => {
  const base = mkdtempSync(join(tmpdir(), "mm-sqlite-xp-"));
  const dir = (key) => join(base, "maestro", "memory", sanitizeDirName(key));
  const activeKey = "active"; const other = "other";
  mkdirSync(dir(activeKey), { recursive: true });
  mkdirSync(dir(other), { recursive: true });
  // Stub better-sqlite3 в moduleDir: оборачивает реальный, записывает опции
  // каждого открытия в JSON-файл (проверяем readonly-флаг sibling-открытия).
  const nm = join(base, "node_modules", "better-sqlite3");
  mkdirSync(nm, { recursive: true });
  const realPath = require.resolve("better-sqlite3");
  const logPath = join(base, "opens.json");
  writeFileSync(join(nm, "package.json"), JSON.stringify({ name: "better-sqlite3", main: "index.js" }));
  writeFileSync(join(nm, "index.js"), `
    const real = require(${JSON.stringify(realPath)});
    const fs = require("node:fs");
    const logPath = ${JSON.stringify(logPath)};
    function Wrapped(path, opts) {
      const arr = fs.existsSync(logPath) ? JSON.parse(fs.readFileSync(logPath, "utf8")) : [];
      arr.push({ path: String(path), opts });
      fs.writeFileSync(logPath, JSON.stringify(arr));
      return new real(path, opts);
    }
    module.exports = Wrapped;
  `);
  const mk = (key) => new SqliteStorage({ dbPath: join(dir(key), "memory.db"), modelId: "m", dim: 3, moduleDir: base });
  const active = mk(activeKey); const otherDb = mk(other);
  try {
    await otherDb.init();
    await otherDb.upsert([{ session_id: "o1", key: other, origin_project_hash: "ho", title: "Other Project", summary: "sum", decisions: [], model_id: "m", author: "a", time_first: 1, time_last: 2, version: 1, embedding: new Float32Array([1, 0, 0]) }]);
    await otherDb.dispose();
    await active.init();
    await active.upsert([{ session_id: "a1", key: activeKey, origin_project_hash: "ha", title: "Active", summary: "sum", decisions: [], model_id: "m", author: "a", time_first: 1, time_last: 2, version: 1, embedding: new Float32Array([0, 1, 0]) }]);
    await active.search(new Float32Array([1, 0, 0]), { key: activeKey, project: other, top_k: 10, min_score: 0 });
    const opens = JSON.parse(readFileSync(logPath, "utf8"));
    const siblingOpen = opens.find((o) => String(o.path).includes(sanitizeDirName(other)) && o.opts);
    assert.ok(siblingOpen, "sibling Database constructed");
    assert.equal(siblingOpen.opts.readonly, true, "sibling opened read-only");
  } finally {
    await active.dispose();
    await otherDb.dispose();
    rmSync(base, { recursive: true, force: true });
  }
});

test("sqlite cross-project: model mismatch sibling is skipped", async () => {
  const base = mkdtempSync(join(tmpdir(), "mm-sqlite-xp-"));
  const dir = (key) => join(base, "maestro", "memory", sanitizeDirName(key));
  const activeKey = "active"; const other = "other";
  mkdirSync(dir(activeKey), { recursive: true });
  mkdirSync(dir(other), { recursive: true });
  const mk = (key, modelId) => new SqliteStorage({ dbPath: join(dir(key), "memory.db"), modelId, dim: 3, moduleDir: null });
  const active = mk(activeKey, "m"); const otherDb = mk(other, "other-model");
  const logs = [];
  const origErr = console.error;
  console.error = (...a) => logs.push(a.join(" "));
  try {
    await otherDb.init();
    await otherDb.upsert([{ session_id: "o1", key: other, origin_project_hash: "ho", title: "Other Project", summary: "sum", decisions: [], model_id: "other-model", author: "a", time_first: 1, time_last: 2, version: 1, embedding: new Float32Array([1, 0, 0]) }]);
    await otherDb.dispose();
    await active.init();
    await active.upsert([{ session_id: "a1", key: activeKey, origin_project_hash: "ha", title: "Active", summary: "sum", decisions: [], model_id: "m", author: "a", time_first: 1, time_last: 2, version: 1, embedding: new Float32Array([0, 1, 0]) }]);
    const res = await active.search(new Float32Array([1, 0, 0]), { key: activeKey, project: other, top_k: 10, min_score: 0 });
    const ids = res.map((h) => h.entry.session_id);
    assert.ok(ids.includes("a1"), "active hit present");
    assert.ok(!ids.includes("o1"), "mismatched sibling skipped");
    assert.ok(logs.some((l) => l.includes("model mismatch")), "model mismatch logged");
  } finally {
    console.error = origErr;
    await active.dispose();
    await otherDb.dispose();
    rmSync(base, { recursive: true, force: true });
  }
});

test("sqlite cross-project: missing sibling file is skipped silently", async () => {
  const base = mkdtempSync(join(tmpdir(), "mm-sqlite-xp-"));
  const dir = (key) => join(base, "maestro", "memory", sanitizeDirName(key));
  const activeKey = "active";
  mkdirSync(dir(activeKey), { recursive: true });
  const active = new SqliteStorage({ dbPath: join(dir(activeKey), "memory.db"), modelId: "m", dim: 3, moduleDir: null });
  try {
    await active.init();
    await active.upsert([{ session_id: "a1", key: activeKey, origin_project_hash: "ha", title: "Active", summary: "sum", decisions: [], model_id: "m", author: "a", time_first: 1, time_last: 2, version: 1, embedding: new Float32Array([0, 1, 0]) }]);
    // project "nonexistent" — файла нет → skip, без throw.
    const res = await active.search(new Float32Array([1, 0, 0]), { key: activeKey, project: "nonexistent", top_k: 5, min_score: 0 });
    const ids = res.map((h) => h.entry.session_id);
    assert.ok(ids.includes("a1"), "active hit present");
    assert.ok(!ids.includes("o1"), "no phantom sibling hit");
  } finally {
    await active.dispose();
    rmSync(base, { recursive: true, force: true });
  }
});

test("sqlite cross-project: sibling search error skipped (fail-soft)", async () => {
  const base = mkdtempSync(join(tmpdir(), "mm-sqlite-xp-"));
  const dir = (key) => join(base, "maestro", "memory", sanitizeDirName(key));
  const activeKey = "active"; const other = "other";
  mkdirSync(dir(activeKey), { recursive: true });
  mkdirSync(dir(other), { recursive: true });
  // Повреждённая sibling-БД: обычный текстовый файл вместо sqlite.
  writeFileSync(join(dir(other), "memory.db"), "this is not a sqlite database");
  const active = new SqliteStorage({ dbPath: join(dir(activeKey), "memory.db"), modelId: "m", dim: 3, moduleDir: null });
  const logs = [];
  const origErr = console.error;
  console.error = (...a) => logs.push(a.join(" "));
  try {
    await active.init();
    await active.upsert([{ session_id: "a1", key: activeKey, origin_project_hash: "ha", title: "Active", summary: "sum", decisions: [], model_id: "m", author: "a", time_first: 1, time_last: 2, version: 1, embedding: new Float32Array([0, 1, 0]) }]);
    const res = await active.search(new Float32Array([1, 0, 0]), { key: activeKey, project: other, top_k: 5, min_score: 0 });
    const ids = res.map((h) => h.entry.session_id);
    assert.ok(ids.includes("a1"), "active hit present despite corrupt sibling");
    assert.ok(logs.some((l) => l.includes("cross-project skip")), "corrupt sibling logged");
  } finally {
    console.error = origErr;
    await active.dispose();
    rmSync(base, { recursive: true, force: true });
  }
});

test("sqlite cross-project: sibling text-only hit gets full entry (embedded)", async () => {
  const base = mkdtempSync(join(tmpdir(), "mm-sqlite-xp-"));
  const dir = (key) => join(base, "maestro", "memory", sanitizeDirName(key));
  const activeKey = "active"; const other = "other";
  mkdirSync(dir(activeKey), { recursive: true });
  mkdirSync(dir(other), { recursive: true });
  const mk = (key) => new SqliteStorage({ dbPath: join(dir(key), "memory.db"), modelId: "m", dim: 3, moduleDir: null });
  const active = mk(activeKey); const otherDb = mk(other);
  try {
    await otherDb.init();
    // Слабый вектор (ортогонален запросу → отсекается min_score), но сильный
    // текстовый матч по "OAuth" → хит только через FTS.
    await otherDb.upsert([{ session_id: "o1", key: other, origin_project_hash: "ho", title: "OAuth token refresh", summary: "OAuth OAuth flow", decisions: ["d"], model_id: "m", author: "a", time_first: 1, time_last: 2, version: 1, embedding: new Float32Array([0, 1, 0]), merged: 1 }]);
    await otherDb.dispose();
    await active.init();
    await active.upsert([{ session_id: "a1", key: activeKey, origin_project_hash: "ha", title: "Active", summary: "sum", decisions: [], model_id: "m", author: "a", time_first: 1, time_last: 2, version: 1, embedding: new Float32Array([1, 0, 0]) }]);
    const res = await active.search(new Float32Array([1, 0, 0]), { key: activeKey, project: other, top_k: 10, min_score: 0.5, query: "OAuth" });
    const o1 = res.find((h) => h.entry.session_id === "o1");
    assert.ok(o1, "sibling text-only hit surfaced via FTS");
    assert.equal(o1.entry.title, "OAuth token refresh", "full entry embedded (title)");
    assert.equal(o1.entry.summary, "OAuth OAuth flow", "full entry embedded (summary)");
    assert.deepStrictEqual(o1.entry.decisions, ["d"], "decisions parsed");
    assert.equal(o1.entry._source_key, other, "sibling hit carries _source_key");
  } finally {
    await active.dispose();
    await otherDb.dispose();
    rmSync(base, { recursive: true, force: true });
  }
});

test("sqlite cross-project: sibling FTS row without memory row is skipped (no phantom entry)", async () => {
  const base = mkdtempSync(join(tmpdir(), "mm-sqlite-xp-"));
  const dir = (key) => join(base, "maestro", "memory", sanitizeDirName(key));
  const activeKey = "active"; const other = "other";
  mkdirSync(dir(activeKey), { recursive: true });
  mkdirSync(dir(other), { recursive: true });
  const mk = (key) => new SqliteStorage({ dbPath: join(dir(key), "memory.db"), modelId: "m", dim: 3, moduleDir: null });
  const active = mk(activeKey); const otherDb = mk(other);
  try {
    await otherDb.init();
    await otherDb.upsert([{ session_id: "o1", key: other, origin_project_hash: "ho", title: "OAuth token refresh", summary: "OAuth OAuth flow", decisions: ["d"], model_id: "m", author: "a", time_first: 1, time_last: 2, version: 1, embedding: new Float32Array([0, 1, 0]) }]);
    // Desync: удаляем memory-строку, оставляя FTS-строку (имитация сбоя).
    otherDb.db.prepare("DELETE FROM memory WHERE session_id = ?").run("o1");
    await otherDb.dispose();
    await active.init();
    await active.upsert([{ session_id: "a1", key: activeKey, origin_project_hash: "ha", title: "Active", summary: "sum", decisions: [], model_id: "m", author: "a", time_first: 1, time_last: 2, version: 1, embedding: new Float32Array([1, 0, 0]) }]);
    // Поиск с текстовым запросом: FTS-хит o1 без memory-строки должен быть
    // пропущен — без crash и без phantom-записи (M6).
    const res = await active.search(new Float32Array([1, 0, 0]), { key: activeKey, project: other, top_k: 10, min_score: 0, query: "OAuth" });
    const ids = res.map((h) => h.entry.session_id);
    assert.ok(ids.includes("a1"), "active hit present");
    assert.ok(!ids.includes("o1"), "sibling FTS hit without memory row must be skipped");
    // Ни один хит не должен быть phantom ({_source_key} без entry).
    for (const h of res) {
      assert.ok(h.entry && h.entry.session_id, "every hit must carry a real entry");
    }
  } finally {
    await active.dispose();
    await otherDb.dispose();
    rmSync(base, { recursive: true, force: true });
  }
});

test("sqlite cross-project: sibling merged=0 record excluded (general-only, §6.2)", async () => {
  const base = mkdtempSync(join(tmpdir(), "mm-sqlite-xp-"));
  const dir = (key) => join(base, "maestro", "memory", sanitizeDirName(key));
  const activeKey = "active"; const other = "other";
  mkdirSync(dir(activeKey), { recursive: true });
  mkdirSync(dir(other), { recursive: true });
  const mk = (key) => new SqliteStorage({ dbPath: join(dir(key), "memory.db"), modelId: "m", dim: 3, moduleDir: null });
  const active = mk(activeKey); const otherDb = mk(other);
  try {
    await otherDb.init();
    // merged=0 sibling record (даже с head) — НЕ должен попасть в кросс-проект.
    await otherDb.upsert([{ session_id: "o1", key: other, origin_project_hash: "ho", title: "Other Project", summary: "sum", decisions: [], model_id: "m", author: "a", time_first: 1, time_last: 2, version: 1, embedding: new Float32Array([1, 0, 0]), merged: 0, head: "h1" }]);
    await otherDb.dispose();
    await active.init();
    await active.upsert([{ session_id: "a1", key: activeKey, origin_project_hash: "ha", title: "Active", summary: "sum", decisions: [], model_id: "m", author: "a", time_first: 1, time_last: 2, version: 1, embedding: new Float32Array([0, 1, 0]) }]);
    const res = await active.search(new Float32Array([1, 0, 0]), { key: activeKey, project: other, top_k: 10, min_score: 0 });
    const ids = res.map((h) => h.entry.session_id);
    assert.ok(!ids.includes("o1"), "merged=0 sibling must be excluded");
    assert.ok(ids.includes("a1"), "active hit present");
  } finally {
    await active.dispose();
    await otherDb.dispose();
    rmSync(base, { recursive: true, force: true });
  }
});

test("sqlite cross-project: sibling leg ignores own-key filterSessionIds (mergedOnly)", async () => {
  const base = mkdtempSync(join(tmpdir(), "mm-sqlite-xp-"));
  const dir = (key) => join(base, "maestro", "memory", sanitizeDirName(key));
  const activeKey = "active"; const other = "other";
  mkdirSync(dir(activeKey), { recursive: true });
  mkdirSync(dir(other), { recursive: true });
  const mk = (key) => new SqliteStorage({ dbPath: join(dir(key), "memory.db"), modelId: "m", dim: 3, moduleDir: null });
  const active = mk(activeKey); const otherDb = mk(other);
  try {
    await otherDb.init();
    // merged=1 sibling record, session_id НЕ в own-key кандидатах.
    await otherDb.upsert([{ session_id: "o1", key: other, origin_project_hash: "ho", title: "Other Project", summary: "sum", decisions: [], model_id: "m", author: "a", time_first: 1, time_last: 2, version: 1, embedding: new Float32Array([1, 0, 0]), merged: 1 }]);
    await otherDb.dispose();
    await active.init();
    await active.upsert([{ session_id: "a1", key: activeKey, origin_project_hash: "ha", title: "Active", summary: "sum", decisions: [], model_id: "m", author: "a", time_first: 1, time_last: 2, version: 1, embedding: new Float32Array([0, 1, 0]) }]);
    // filterSessionIds = own-key кандидаты (a1) — НЕ должен применяться к sibling.
    const res = await active.search(new Float32Array([1, 0, 0]), { key: activeKey, project: other, top_k: 10, min_score: 0, filterSessionIds: ["a1"] });
    const ids = res.map((h) => h.entry.session_id);
    assert.ok(ids.includes("o1"), "sibling general record returned despite own-key filterSessionIds");
    assert.ok(ids.includes("a1"), "active candidate present");
  } finally {
    await active.dispose();
    await otherDb.dispose();
    rmSync(base, { recursive: true, force: true });
  }
});

test("sqlite cross-project: pre-v3 sibling without merged column → fail-soft skip, active unaffected (§6.2)", async () => {
  const base = mkdtempSync(join(tmpdir(), "mm-sqlite-v2-"));
  const dir = (key) => join(base, "maestro", "memory", sanitizeDirName(key));
  const activeKey = "active"; const other = "other";
  mkdirSync(dir(activeKey), { recursive: true });
  mkdirSync(dir(other), { recursive: true });
  const mk = (key) => new SqliteStorage({ dbPath: join(dir(key), "memory.db"), modelId: "m", dim: 3, moduleDir: null });
  const active = mk(activeKey);
  try {
    // v2-schema sibling: memory table БЕЗ колонки merged (pre-v3).
    const Database = require("better-sqlite3");
    const sib = new Database(join(dir(other), "memory.db"));
    sib.exec(`CREATE TABLE memory (
      session_id TEXT PRIMARY KEY, key TEXT NOT NULL, origin_project_hash TEXT NOT NULL,
      title TEXT NOT NULL, summary TEXT NOT NULL, decisions TEXT NOT NULL,
      embedding BLOB NOT NULL, model_id TEXT NOT NULL, author TEXT NOT NULL,
      time_first INTEGER NOT NULL, time_last INTEGER NOT NULL, version INTEGER NOT NULL
    )`);
    sib.exec(`CREATE TABLE meta (name TEXT PRIMARY KEY, value TEXT NOT NULL)`);
    sib.prepare("INSERT INTO meta (name, value) VALUES ('model_id', 'm')").run();
    sib.prepare("INSERT INTO meta (name, value) VALUES ('dim', '3')").run();
    sib.prepare(`INSERT INTO memory (session_id, key, origin_project_hash, title, summary, decisions, embedding, model_id, author, time_first, time_last, version)
      VALUES ('o1', ?, 'ho', 'Other', 'sum', '[]', ?, 'm', 'a', 1, 2, 1)`)
      .run(other, Buffer.from(new Float32Array([1, 0, 0]).buffer));
    sib.close();

    await active.init();
    await active.upsert([{ session_id: "a1", key: activeKey, origin_project_hash: "ha", title: "Active", summary: "sum", decisions: [], model_id: "m", author: "a", time_first: 1, time_last: 2, version: 1, embedding: new Float32Array([0, 1, 0]) }]);
    // Pre-v3 sibling (нет merged) → fail-soft skip + лог; активные результаты не затронуты.
    const res = await active.search(new Float32Array([1, 0, 0]), { key: activeKey, project: other, top_k: 10, min_score: 0 });
    const ids = res.map((h) => h.entry.session_id);
    assert.ok(!ids.includes("o1"), "pre-v3 sibling skipped (no merged column)");
    assert.ok(ids.includes("a1"), "active hit unaffected");
  } finally {
    await active.dispose();
    rmSync(base, { recursive: true, force: true });
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

// ── I1: search pre-filter по кандидатам (filterSessionIds) ─────────────

test("sqlite search filterSessionIds restricts vector leg to candidates", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mem-"));
  const st = createStorage({ type: "sqlite", options: { dbPath: join(dir, "memory.db") }, modelId: "m", dim: 3 });
  try {
    await st.init();
    await st.upsert([
      mkEntry("s1", "k1", "t1", { merged: 1, head: "" }),
      mkEntry("s2", "k1", "t2", { merged: 0, head: "" }), // unattributed
    ]);
    // s2 имеет тот же вектор (максимальная похожесть), но не кандидат —
    // без pre-filter вытеснил бы s1 из top_k.
    const hits = await st.search(new Float32Array([0.1, 0.2, 0.3]), { top_k: 5, min_score: 0, key: "k1", filterSessionIds: ["s1"] });
    assert.equal(hits.length, 1, "only candidate s1 must be searched");
    assert.equal(hits[0].entry.session_id, "s1");
  } finally {
    await st.dispose();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("sqlite search filterSessionIds applies to FTS leg", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mem-"));
  const st = createStorage({ type: "sqlite", options: { dbPath: join(dir, "memory.db") }, modelId: "m", dim: 3 });
  try {
    await st.init();
    await st.upsert([
      mkEntry("s1", "k1", "OAuth token refresh", { summary: "OAuth OAuth flow", merged: 1, head: "" }),
      mkEntry("s2", "k1", "OAuth cache", { summary: "OAuth tokens", merged: 0, head: "" }),
    ]);
    // s2 — сильный FTS-матч, но не кандидат → исключён из текстовой ветки.
    const hits = await st.search(new Float32Array([0, 1, 0]), { top_k: 5, min_score: 0.5, key: "k1", query: "OAuth", filterSessionIds: ["s1"] });
    assert.equal(hits.length, 1, "FTS leg must be restricted to candidates");
    assert.equal(hits[0].entry.session_id, "s1");
  } finally {
    await st.dispose();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("sqlite search empty filterSessionIds → current behavior (no filter)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mem-"));
  const st = createStorage({ type: "sqlite", options: { dbPath: join(dir, "memory.db") }, modelId: "m", dim: 3 });
  try {
    await st.init();
    await st.upsert([
      mkEntry("s1", "k1", "t1", { merged: 1, head: "" }),
      mkEntry("s2", "k1", "t2", { merged: 0, head: "" }),
    ]);
    const hits = await st.search(new Float32Array([0.1, 0.2, 0.3]), { top_k: 5, min_score: 0, key: "k1", filterSessionIds: [] });
    assert.equal(hits.length, 2, "empty filterSessionIds must not restrict search");
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

test("sqlite logs actionable npm install message when better-sqlite3 missing in moduleDir", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mem-"));
  // moduleDir БЕЗ better-sqlite3 → require.resolve падает → actionable-лог
  // (в тесте bare-import fallback успешен, поэтому init продолжается).
  const logs = [];
  const origError = console.error;
  console.error = (msg) => { logs.push(msg); };
  const st = createStorage({
    type: "sqlite",
    options: { dbPath: join(dir, "memory.db"), moduleDir: dir },
    modelId: "m",
    dim: 3,
  });
  try {
    await st.init();
    assert.ok(logs.some((l) => l.includes("npm install")), "must log npm install hint");
    assert.ok(logs.some((l) => l.includes("enable-memory")), "must reference how-to/enable-memory");
    assert.ok(logs.some((l) => l.includes(dir)), "must include module_dir path");
  } finally {
    console.error = origError;
    await st.dispose();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("qdrant factory returns QdrantStorage with valid options", async () => {
  const c = {
    collectionExists: async () => ({ exists: false }),
    createCollection: async () => {},
    createPayloadIndex: async () => {},
    scroll: async () => ({ points: [], next_page_offset: null }),
    setPayload: async () => {},
  };
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
    createPayloadIndex: async () => {},
    scroll: async () => ({ points: [], next_page_offset: null }),
    setPayload: async () => {},
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

// --- Task 3: branch/head/merged schema + candidates/markMerged ---

test("sqlite schema: branch/head/merged stored + returned by get/scan", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mem-"));
  const st = createStorage({ type: "sqlite", options: { dbPath: join(dir, "memory.db") }, modelId: "m", dim: 3 });
  try {
    await st.init();
    await st.upsert([mkEntry("s1", "k1", "t1", { branch: "feature/x", head: "abc123", merged: 0 })]);
    const found = await st.get("s1");
    assert.equal(found.branch, "feature/x");
    assert.equal(found.head, "abc123");
    assert.equal(found.merged, 0);
    // scan возвращает поля (легитимные метаданные).
    const rows = await st.scan({ key: "k1", fields: ["session_id", "branch", "head", "merged"] });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].branch, "feature/x");
    assert.equal(rows[0].head, "abc123");
    assert.equal(rows[0].merged, 0);
  } finally {
    await st.dispose();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("sqlite ALTER dev-hygiene: old v2-schema table gains columns idempotently", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mem-"));
  const dbPath = join(dir, "memory.db");
  // Вручную создаём таблицу v2 (без branch/head/merged) + meta.
  const Database = require("better-sqlite3");
  const db = new Database(dbPath);
  db.exec(`CREATE TABLE memory (
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
  db.exec(`CREATE TABLE meta (name TEXT PRIMARY KEY, value TEXT NOT NULL)`);
  db.close();
  const st = createStorage({ type: "sqlite", options: { dbPath }, modelId: "m", dim: 3 });
  try {
    await st.init(); // должен ALTER ADD COLUMN × 3
    const cols = st.db.prepare("PRAGMA table_info(memory)").all().map((c) => c.name);
    assert.ok(cols.includes("branch"), "branch column added");
    assert.ok(cols.includes("head"), "head column added");
    assert.ok(cols.includes("merged"), "merged column added");
    // Повторный init не падает (guard).
    await st.dispose();
    const st2 = createStorage({ type: "sqlite", options: { dbPath }, modelId: "m", dim: 3 });
    await st2.init();
    await st2.dispose();
  } finally {
    await st.dispose();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("sqlite candidates(key) returns merged=1 OR head != ''", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mem-"));
  const st = createStorage({ type: "sqlite", options: { dbPath: join(dir, "memory.db") }, modelId: "m", dim: 3 });
  try {
    await st.init();
    await st.upsert([
      mkEntry("s1", "k1", "t1", { merged: 1, head: "" }),
      mkEntry("s2", "k1", "t2", { merged: 0, head: "h1" }),
      mkEntry("s3", "k1", "t3", { merged: 0, head: "" }),
      mkEntry("s4", "k2", "t4", { merged: 1, head: "" }), // другой key — не кандидат
    ]);
    const cands = await st.candidates("k1");
    const ids = cands.map((c) => c.session_id).sort();
    assert.deepEqual(ids, ["s1", "s2"], "candidates = merged=1 OR head != '' within key");
  } finally {
    await st.dispose();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("sqlite markMerged(key, head) sets merged=1 (key-scoped)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mem-"));
  const st = createStorage({ type: "sqlite", options: { dbPath: join(dir, "memory.db") }, modelId: "m", dim: 3 });
  try {
    await st.init();
    await st.upsert([
      mkEntry("sA", "kA", "tA", { head: "h", merged: 0 }),
      mkEntry("sB", "kB", "tB", { head: "h", merged: 0 }),
    ]);
    await st.markMerged("kA", "h");
    assert.equal((await st.get("sA")).merged, 1, "A promoted");
    assert.equal((await st.get("sB")).merged, 0, "B untouched (different key)");
  } finally {
    await st.dispose();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("pgvector get returns entry or null", async () => {
  const rows = [];
  const pool = {
    query: async (sql, params) => {
      if (sql.includes("SELECT count")) return { rows: [{ count: 0 }] };
      if (sql.includes("CREATE")) return { rows: [] };
      if (sql.includes("INSERT")) return { rows: [] };
      if (sql.includes("DELETE")) return { rows: [] };
      if (sql.includes("SELECT session_id, key, origin_project_hash, title, summary, decisions, model_id, author, time_first, time_last, version") && sql.includes("FROM m WHERE session_id")) {
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

// ── Task 6: storage-события (duration/error/cross_project_miss) ──

test("storage search logs duration and errors with class", async () => {
  const calls = [];
  const log = { debug: (m, e) => calls.push([m, e]), error: (m, e) => calls.push([m, e]) };
  const st = createStorage({ type: "sqlite", options: { dbPath: ":memory:", log }, modelId: "m", dim: 3 });
  try {
    await st.init();
    await st.upsert([mkEntry("s1", "k1", "t1")]);
    await st.search(new Float32Array([0.1, 0.2, 0.3]), { top_k: 3, min_score: 0.3, key: "k1" });
    assert.ok(calls.some(([m]) => m === "memory:storage.search.duration"), "search duration logged");
    assert.ok(calls.some(([m, e]) => m === "memory:storage.search.duration" && typeof e.duration_ms === "number" && e.op === "search"), "duration carries op + duration_ms");
  } finally {
    await st.dispose();
  }
});

test("storage error event logs error_class and rethrows", async () => {
  const calls = [];
  const log = { debug: (m, e) => calls.push([m, e]), error: (m, e) => calls.push([m, e]) };
  const st = createStorage({ type: "sqlite", options: { dbPath: ":memory:", log }, modelId: "m", dim: 3 });
  try {
    await st.init();
    // Неверная размерность → ошибка внутри search → error-событие + rethrow.
    await assert.rejects(
      () => st.search(new Float32Array([0.1, 0.2]), { top_k: 3, min_score: 0, key: "k1" }),
      /dimension/,
    );
    assert.ok(calls.some(([m, e]) => m === "memory:storage.error" && e.op === "search" && e.error_class === "storage_error"), "storage.error logged with class");
  } finally {
    await st.dispose();
  }
});

test("storage logs cross_project_miss on sibling model mismatch", async () => {
  const base = mkdtempSync(join(tmpdir(), "mm-sqlite-xp-"));
  const dir = (key) => join(base, "maestro", "memory", sanitizeDirName(key));
  const activeKey = "active"; const other = "other";
  mkdirSync(dir(activeKey), { recursive: true });
  mkdirSync(dir(other), { recursive: true });
  const calls = [];
  const log = { debug: (m, e) => calls.push([m, e]), error: (m, e) => calls.push([m, e]) };
  const mk = (key, modelId) => new SqliteStorage({ dbPath: join(dir(key), "memory.db"), modelId, dim: 3, moduleDir: null, log });
  const active = mk(activeKey, "m"); const otherDb = mk(other, "other-model");
  try {
    await otherDb.init();
    await otherDb.upsert([{ session_id: "o1", key: other, origin_project_hash: "ho", title: "Other Project", summary: "sum", decisions: [], model_id: "other-model", author: "a", time_first: 1, time_last: 2, version: 1, embedding: new Float32Array([1, 0, 0]) }]);
    await otherDb.dispose();
    await active.init();
    await active.upsert([{ session_id: "a1", key: activeKey, origin_project_hash: "ha", title: "Active", summary: "sum", decisions: [], model_id: "m", author: "a", time_first: 1, time_last: 2, version: 1, embedding: new Float32Array([0, 1, 0]) }]);
    const res = await active.search(new Float32Array([1, 0, 0]), { key: activeKey, project: other, top_k: 10, min_score: 0 });
    assert.ok(res.some((h) => h.entry.session_id === "a1"), "active hit present");
    assert.ok(!res.some((h) => h.entry.session_id === "o1"), "mismatched sibling skipped");
    assert.ok(calls.some(([m, e]) => m === "memory:cross_project_miss" && e.reason === "model_mismatch" && e.projectKey === other), "cross_project_miss logged with model_mismatch + projectKey");
  } finally {
    await active.dispose();
    await otherDb.dispose();
    rmSync(base, { recursive: true, force: true });
  }
});

test("storage logs cross_project_miss when sibling DB unavailable", async () => {
  const base = mkdtempSync(join(tmpdir(), "mm-sqlite-xp-"));
  const dir = (key) => join(base, "maestro", "memory", sanitizeDirName(key));
  const activeKey = "active";
  mkdirSync(dir(activeKey), { recursive: true });
  const calls = [];
  const log = { debug: (m, e) => calls.push([m, e]), error: (m, e) => calls.push([m, e]) };
  const active = new SqliteStorage({ dbPath: join(dir(activeKey), "memory.db"), modelId: "m", dim: 3, moduleDir: null, log });
  try {
    await active.init();
    await active.upsert([{ session_id: "a1", key: activeKey, origin_project_hash: "ha", title: "Active", summary: "sum", decisions: [], model_id: "m", author: "a", time_first: 1, time_last: 2, version: 1, embedding: new Float32Array([0, 1, 0]) }]);
    // project "nonexistent" — sibling-файла нет → skip + cross_project_miss.
    const res = await active.search(new Float32Array([1, 0, 0]), { key: activeKey, project: "nonexistent", top_k: 5, min_score: 0 });
    assert.ok(res.some((h) => h.entry.session_id === "a1"), "active hit present");
    assert.ok(calls.some(([m, e]) => m === "memory:cross_project_miss" && e.reason === "unavailable" && e.projectKey === "nonexistent"), "cross_project_miss logged with unavailable + projectKey");
  } finally {
    await active.dispose();
    rmSync(base, { recursive: true, force: true });
  }
});
