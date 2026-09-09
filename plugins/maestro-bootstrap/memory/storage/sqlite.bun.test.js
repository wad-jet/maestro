import { test } from "node:test";
import assert from "node:assert/strict";
import { SqliteStorage } from "./sqlite.js";
import { loadSqliteDriver } from "./sqlite.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// bun:sqlite путь тестируется только под Bun (встроенный модуль; под Node
// import("bun:sqlite") недоступен). Запуск: `bun test` (или bun-рантайм opencode).
const isBun = typeof process.versions.bun === "string";

function mkEntry(session_id, key, title, extra = {}) {
  return {
    session_id, key, origin_project_hash: key, title, summary: "s",
    decisions: [], embedding: new Float32Array([0.1, 0.2, 0.3]),
    model_id: "m", author: "a", time_first: 1, time_last: 2, version: 1,
    ...extra,
  };
}

test("bun:sqlite driver selected under Bun", { skip: !isBun }, async () => {
  const Database = await loadSqliteDriver(null, { force: "bun:sqlite" });
  assert.equal(typeof Database, "function");
  const db = new Database(":memory:");
  db.exec("CREATE TABLE t (a TEXT)");
  db.prepare("INSERT INTO t (a) VALUES (@a)").run({ a: "x" }); // bare named → @-конверсия
  const r = db.prepare("SELECT a FROM t WHERE a = @a").get({ a: "x" });
  assert.equal(r.a, "x");
  assert.equal(db.closed, false);
  db.close();
  assert.equal(db.closed, true);
});

test("bun:sqlite full round-trip: init/upsert/search/fts/delete", { skip: !isBun }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "mem-bun-"));
  const st = new SqliteStorage({ dbPath: join(dir, "memory.db"), modelId: "m", dim: 3, forceDriver: "bun:sqlite" });
  try {
    await st.init();
    await st.upsert([
      mkEntry("s1", "k1", "hello world"),
      mkEntry("s2", "k1", "other", { embedding: new Float32Array([1, 0, 0]) }),
    ]);
    const hits = await st.search(new Float32Array([0.1, 0.2, 0.3]), { top_k: 2, min_score: 0.5, key: "k1" });
    assert.equal(hits.length, 1);
    assert.equal(hits[0].entry.session_id, "s1");
    const fts = await st.search(new Float32Array([0.1, 0.2, 0.3]), { top_k: 2, min_score: 0, key: "k1", query: "hello" });
    assert.ok(fts.some((h) => h.entry.session_id === "s1"), "FTS hit expected");
    const sts = await st.stats({ key: "k1" });
    assert.equal(sts.entries, 2);
    await st.delete("s1");
    assert.equal((await st.stats({ key: "k1" })).entries, 1);
  } finally {
    await st.dispose();
    rmSync(dir, { recursive: true, force: true });
  }
});