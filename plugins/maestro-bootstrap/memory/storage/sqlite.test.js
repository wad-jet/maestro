import { test } from "node:test";
import assert from "node:assert/strict";
import { SqliteStorage } from "./sqlite.js";
import { mkdtempSync, rmSync } from "node:fs";
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
  } finally {
    await st.dispose();
    rmSync(dir, { recursive: true, force: true });
  }
});
