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

// ── Task 6: auto-recall использует дефолтный scope ─────────────────────

test("recall auto-recall: branch_context=false → project scope (no membership)", async () => {
  const { embedder, storage } = mkDeps();
  let candidatesCalls = 0;
  storage.candidates = async () => { candidatesCalls++; return []; };
  const r = new Recall({
    embeddings: embedder, storage, topK: 3, minScore: 0.35, key: "project-key",
    getUserMessageCount: async () => 1,
    branchContext: false,
    git: { revList: () => new Set(), detectMainline: () => ({ name: "main" }) },
    root: "/tmp/x",
  });
  await r.onChatMessage({ sessionID: "s1", text: "hello" });
  assert.equal(candidatesCalls, 0, "project scope must NOT call candidates");
  const block = await r.systemBlock({ sessionID: "s1" });
  assert.ok(block.includes("t"), "plain search results must be used");
});

test("recall auto-recall: branch scope filters hits by membership", async () => {
  const storage = {
    candidates: async () => [
      { session_id: "a", merged: 1, head: "" },
      { session_id: "d", merged: 0, head: "hd" },
    ],
    search: async () => [
      { entry: { session_id: "a", title: "A", summary: "SA", decisions: [], author: "a", time_last: 1, origin_project_hash: "k" }, score: 0.9 },
      { entry: { session_id: "d", title: "D", summary: "SD", decisions: [], author: "a", time_last: 2, origin_project_hash: "k" }, score: 0.8 },
    ],
  };
  const r = new Recall({
    embeddings: { embed: async () => new Float32Array([0.1, 0.2, 0.3]) },
    storage, topK: 3, minScore: 0.35, key: "project-key",
    getUserMessageCount: async () => 1,
    branchContext: true,
    git: {
      revList: (root, ref) => (ref === "HEAD" ? new Set(["hb"]) : new Set()),
      detectMainline: () => ({ name: "main" }),
    },
    root: "/tmp/x",
  });
  await r.onChatMessage({ sessionID: "s1", text: "hello" });
  const block = await r.systemBlock({ sessionID: "s1" });
  assert.ok(block.includes("A"), "in-context hit must be in block");
  assert.ok(!block.includes("D"), "out-of-context hit must be filtered");
});
