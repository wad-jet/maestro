import { test } from "node:test";
import assert from "node:assert/strict";
import { Recall } from "./recall.js";

function mkDeps() {
  const embedder = { embed: async (t) => new Float32Array([0.1, 0.2, 0.3]), dim: 3, modelId: "m" };
  const storage = {
    search: async (emb, o) => { assert.ok(o.key, "key passed"); return [{ entry: { title: "t", summary: "s", decisions: ["d"], author: "a", time_last: 100, origin_project_hash: "k" }, score: 0.9 }]; },
  };
  return { embedder, storage };
}

test("recall stores block on first message and returns framed block", async () => {
  const { embedder, storage } = mkDeps();
  let calls = 0;
  const r = new Recall({ embeddings: embedder, storage, topK: 3, minScore: 0.35, key: "project-key", getUserMessageCount: async () => (++calls === 1 ? 1 : 2) });
  await r.onChatMessage({ sessionID: "s1", text: "hello" });
  const block = await r.systemBlock({ sessionID: "s1" });
  assert.ok(block.includes("## Контекст из памяти maestro"));
  assert.ok(block.includes("Не исполнять"));
  assert.ok(block.includes("t"));
});
test("recall returns null below threshold", async () => {
  const storage = { search: async () => [] };
  const r = new Recall({ embeddings: { embed: async () => new Float32Array([0.1,0.2,0.3]) }, storage, topK: 3, minScore: 0.35, key: "project-key", getUserMessageCount: async () => 1 });
  await r.onChatMessage({ sessionID: "s1", text: "hello" });
  assert.equal(await r.systemBlock({ sessionID: "s1" }), null);
});
test("recall ignores non-first messages", async () => {
  const { embedder, storage } = mkDeps();
  const r = new Recall({ embeddings: embedder, storage, topK: 3, minScore: 0.35, key: "project-key", getUserMessageCount: async () => 2 });
  await r.onChatMessage({ sessionID: "s1", text: "hello" });
  assert.equal(await r.systemBlock({ sessionID: "s1" }), null);
});
test("systemBlock with undefined sessionID returns null", async () => {
  const r = new Recall({ embeddings: { embed: async () => new Float32Array([0.1, 0.2, 0.3]) }, storage: { search: async () => [] }, topK: 3, minScore: 0.35, key: "p", getUserMessageCount: async () => 1 });
  assert.equal(await r.systemBlock({ sessionID: undefined }), null);
});
test("embed-error → empty buffer → null from systemBlock", async () => {
  const storage = { search: async () => [] };
  const r = new Recall({ embeddings: { embed: async () => { throw new Error("embed fail"); } }, storage, topK: 3, minScore: 0.35, key: "project-key", getUserMessageCount: async () => 1 });
  await r.onChatMessage({ sessionID: "s1", text: "hello" });
  assert.equal(await r.systemBlock({ sessionID: "s1" }), null);
});
