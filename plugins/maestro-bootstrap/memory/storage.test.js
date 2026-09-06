import { test } from "node:test";
import assert from "node:assert/strict";
import { createStorage } from "./storage.js";

function mkEntry(session_id, key, title) {
  return {
    session_id, key, origin_project_hash: key, title, summary: "s",
    decisions: [], embedding: new Float32Array([0.1, 0.2, 0.3]),
    model_id: "m", author: "a", time_first: 1, time_last: 2, version: 1,
  };
}

test("sqlite upsert/search/delete", async () => {
  const st = createStorage({ type: "sqlite", options: { dbPath: ":memory:" }, modelId: "m", dim: 3 });
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
  await st.dispose();
});

test("qdrant backend not implemented", () => {
  assert.throws(() => createStorage({ type: "qdrant", modelId: "m", dim: 3 }), /NOT_IMPLEMENTED/);
});
