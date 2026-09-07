import { test } from "node:test";
import assert from "node:assert/strict";
import { Indexer } from "./indexer.js";
import { SESSIONS } from "./summarize.js";

function mkClient(msgs = null) {
  const upserts = [];
  return {
    upserts,
    session: {
      get: async ({ path }) => ({
        data: {
          id: path.id,
          parentID: null,
          title: "st",
          time: { created: 1, updated: 100 },
        },
      }),
      messages: async () => ({
        data: msgs ?? [
          { info: {}, parts: [{ type: "text", text: "API_KEY=secret123 hello" }] },
        ],
      }),
      list: async () => ({ data: [] }),
    },
  };
}

function mkStorage(client, getOverride) {
  const store = new Map();
  return {
    upsert: async (es) => {
      for (const e of es) { store.set(e.session_id, e); }
      if (client) client.upserts.push(es);
    },
    get: async (sid) => getOverride ? getOverride(sid) : store.get(sid) ?? null,
    search: async () => [],
    delete: async () => {},
    stats: async () => ({ entries: 0 }),
  };
}

function mkConfig(extra = {}) {
  return {
    min_new_messages: 1,
    idle_debounce_min: 10,
    backfill_window_days: 30,
    backfill_max_per_start: 5,
    retry_interval_min: 60,
    namespace: null,
    top_k: 3,
    min_score: 0.35,
    author: "test",
    ...extra,
  };
}

function mkState(extra = {}) {
  return {
    getLastSummarized: async () => null,
    setSummarized: async () => {},
    recordFail: async () => {},
    isSkipped: async () => false,
    getFirstRun: async () => Date.now(),
    ...extra,
  };
}

// ── Basic functionality ──────────────────────────────────────────────

test("indexer summarizes and upserts on _run, masking secrets", async () => {
  const client = mkClient();
  const storage = mkStorage(client);
  const embeddings = { embed: async () => new Float32Array([0.1, 0.2, 0.3]), dim: 3, modelId: "m" };
  const idx = new Indexer({
    client, config: mkConfig(), embeddings, storage,
    state: mkState(),
    summarize: async ({ transcript }) => ({ title: "t", summary: "s", decisions: [] }),
    projectKey: { hash: "khash", source: "remote" }, confidentialPatterns: [],
  });
  await idx._run("s1");
  assert.equal(client.upserts.length, 1);
  const e = client.upserts[0][0];
  assert.equal(e.key, "khash");
  assert.ok(!e.summary.includes("secret123"));
  assert.equal(e.title, "t");
  assert.ok(e.embedding instanceof Float32Array);
  assert.equal(e.version, 1);
  idx.dispose();
});

test("indexer skips subagent sessions (parentID present)", async () => {
  const client = mkClient();
  client.session.get = async () => ({
    data: { id: "s1", parentID: "p1", title: "st", time: { created: 1, updated: 100 } },
  });
  const storage = mkStorage(client);
  const idx = new Indexer({
    client, config: mkConfig(),
    embeddings: { embed: async () => new Float32Array([0.1]), dim: 1, modelId: "m" },
    storage, state: mkState(),
    summarize: async () => ({ title: "t", summary: "s", decisions: [] }),
    projectKey: { hash: "khash", source: "remote" }, confidentialPatterns: [],
  });
  await idx._run("s1");
  assert.equal(client.upserts.length, 0);
  idx.dispose();
});

test("indexer deletes on session deleted", async () => {
  let deletedId = null;
  const storage = {
    upsert: async () => {}, search: async () => [],
    delete: async (sid) => { deletedId = sid; }, stats: async () => ({ entries: 0 }),
  };
  const idx = new Indexer({
    client: mkClient(), config: mkConfig(),
    embeddings: { embed: async () => new Float32Array([0.1]), dim: 1, modelId: "m" },
    storage, state: mkState(),
    summarize: async () => ({}),
    projectKey: { hash: "k", source: "remote" }, confidentialPatterns: [],
  });
  await idx.onSessionDeleted({ sessionID: "s1" });
  assert.equal(deletedId, "s1");
  idx.dispose();
});

test("indexer _run calls recordFail on error", async () => {
  let failCalled = false;
  let failSessionId = null;
  const client = mkClient();
  client.session.get = async () => { throw new Error("network"); };
  const storage = mkStorage(client);
  const idx = new Indexer({
    client, config: mkConfig(),
    embeddings: { embed: async () => new Float32Array([0.1]), dim: 1, modelId: "m" },
    storage,
    state: { ...mkState(), recordFail: async (sid) => { failCalled = true; failSessionId = sid; } },
    summarize: async () => ({}),
    projectKey: { hash: "khash", source: "remote" }, confidentialPatterns: [],
  });
  await idx._run("s1");
  assert.ok(failCalled);
  assert.equal(failSessionId, "s1");
  idx.dispose();
});

test("indexer records summarized state after success", async () => {
  let summarizedId = null;
  const client = mkClient();
  const storage = mkStorage(client);
  const idx = new Indexer({
    client, config: mkConfig(),
    embeddings: { embed: async () => new Float32Array([0.1]), dim: 1, modelId: "m" },
    storage,
    state: { ...mkState(), setSummarized: async (sid) => { summarizedId = sid; } },
    summarize: async () => ({ title: "t", summary: "s", decisions: [] }),
    projectKey: { hash: "khash", source: "remote" }, confidentialPatterns: [],
  });
  await idx._run("s1");
  assert.equal(summarizedId, "s1");
  idx.dispose();
});

// M6: guard onSessionIdle without sessionID
test("indexer onSessionIdle guards null sessionID", async () => {
  const idx = new Indexer({
    client: mkClient(), config: mkConfig(),
    embeddings: { embed: async () => new Float32Array([0.1]), dim: 1, modelId: "m" },
    storage: mkStorage(null), state: mkState(),
    summarize: async () => ({ title: "t", summary: "s", decisions: [] }),
    projectKey: { hash: "k", source: "remote" }, confidentialPatterns: [],
  });
  await idx.onSessionIdle({ sessionID: null });
  // Should not throw
  idx.dispose();
});

// ── C1 — model from assistant message ────────────────────────────────

test("indexer extracts model from last assistant message (C-1)", async () => {
  const client = mkClient([
    { info: { role: "user" }, parts: [{ type: "text", text: "hello" }] },
    { info: { role: "assistant", providerID: "google", modelID: "gemini-2.0" }, parts: [{ type: "text", text: "hi" }] },
  ]);
  const storage = mkStorage(client);
  let capturedModel = null;
  const idx = new Indexer({
    client, config: mkConfig(),
    embeddings: { embed: async () => new Float32Array([0.1]), dim: 1, modelId: "m" },
    storage, state: mkState(),
    summarize: async ({ model }) => { capturedModel = model; return { title: "t", summary: "s", decisions: [] }; },
    projectKey: { hash: "k", source: "remote" }, confidentialPatterns: [],
  });
  await idx._run("s1");
  assert.equal(capturedModel.providerID, "google");
  assert.equal(capturedModel.modelID, "gemini-2.0");
  assert.equal(client.upserts.length, 1);
  idx.dispose();
});

// ── G1 — min_new_messages ────────────────────────────────────────────

test("indexer skips _run when messages < min_new_messages (G1)", async () => {
  const client = mkClient();
  const storage = mkStorage(client);
  const config = mkConfig({ min_new_messages: 3 });
  let callCount = 0;
  const state = { ...mkState(), getLastSummarized: async () => 99 };
  const summarize = async () => { callCount++; return { title: "t", summary: "s", decisions: [] }; };
  client.session.messages = async () => ({
    data: [{ info: { time: { created: 100 } }, parts: [{ type: "text", text: "hi" }] }],
  });
  const idx = new Indexer({ client, config,
    embeddings: { embed: async () => new Float32Array([0.1]), dim: 1, modelId: "m" },
    storage, state, summarize,
    projectKey: { hash: "k", source: "remote" }, confidentialPatterns: [],
  });
  await idx._run("s1");
  assert.equal(callCount, 0);
  assert.equal(client.upserts.length, 0);
  idx.dispose();
});

test("indexer proceeds when messages >= min_new_messages (G1)", async () => {
  const client = mkClient();
  const storage = mkStorage(client);
  const config = mkConfig({ min_new_messages: 2 });
  let callCount = 0;
  const state = { ...mkState(), getLastSummarized: async () => 99 };
  const summarize = async () => { callCount++; return { title: "t", summary: "s", decisions: [] }; };
  client.session.messages = async () => ({
    data: [
      { info: { time: { created: 100 } }, parts: [{ type: "text", text: "a" }] },
      { info: { time: { created: 101 } }, parts: [{ type: "text", text: "b" }] },
      { info: { time: { created: 102 } }, parts: [{ type: "text", text: "c" }] },
    ],
  });
  const idx = new Indexer({ client, config,
    embeddings: { embed: async () => new Float32Array([0.1]), dim: 1, modelId: "m" },
    storage, state, summarize,
    projectKey: { hash: "k", source: "remote" }, confidentialPatterns: [],
  });
  await idx._run("s1");
  assert.equal(callCount, 1);
  assert.equal(client.upserts.length, 1);
  idx.dispose();
});

test("indexer first summary proceeds with no lastSummarized (G1)", async () => {
  const client = mkClient();
  const storage = mkStorage(client);
  const config = mkConfig({ min_new_messages: 3 });
  let callCount = 0;
  const summarize = async () => { callCount++; return { title: "t", summary: "s", decisions: [] }; };
  const idx = new Indexer({ client, config,
    embeddings: { embed: async () => new Float32Array([0.1]), dim: 1, modelId: "m" },
    storage, state: mkState(), summarize,
    projectKey: { hash: "k", source: "remote" }, confidentialPatterns: [],
  });
  await idx._run("s1");
  assert.equal(callCount, 1);
  assert.equal(client.upserts.length, 1);
  idx.dispose();
});

// ── G2 — re-mask entry ──────────────────────────────────────────────

test("indexer re-masks entry before upsert (G2)", async () => {
  const client = mkClient();
  const storage = mkStorage(client);
  const summarize = async () => ({
    title: "API_KEY=leaked", summary: "TOKEN=abc detail", decisions: ["x"],
  });
  const idx = new Indexer({ client, config: mkConfig(),
    embeddings: { embed: async () => new Float32Array([0.1]), dim: 1, modelId: "m" },
    storage, state: mkState(), summarize,
    projectKey: { hash: "k", source: "remote" }, confidentialPatterns: [],
  });
  await idx._run("s1");
  assert.equal(client.upserts.length, 1);
  const e = client.upserts[0][0];
  assert.ok(!e.title.includes("leaked"));
  assert.ok(!e.summary.includes("abc"));
  idx.dispose();
});

// ── G3 — concurrency ─────────────────────────────────────────────────

test("indexer serializes concurrent _run calls (G3)", async () => {
  let summarizeOrder = [];
  let blockerResolve = null;
  const blocker = new Promise((r) => { blockerResolve = r; });
  const summarize = async ({ sessionID }) => {
    summarizeOrder.push(sessionID);
    if (sessionID === "s1") await blocker;
    return { title: "t", summary: "s", decisions: [] };
  };
  const idx = new Indexer({
    client: mkClient(), config: mkConfig(),
    embeddings: { embed: async () => new Float32Array([0.1]), dim: 1, modelId: "m" },
    storage: mkStorage(null),
    state: mkState(), summarize,
    projectKey: { hash: "k", source: "remote" }, confidentialPatterns: [],
  });

  const p1 = idx._run("s1");
  const p2 = idx._run("s2");
  await new Promise((r) => setImmediate(r));
  assert.equal(idx.queue.size, 1, "p2 is queued behind p1");
  assert.equal(idx.running, true, "p1 holds the lock");

  blockerResolve();
  await p1;
  await new Promise((r) => setImmediate(r));
  assert.equal(summarizeOrder.length, 2, "both sessions summarized");
  assert.equal(summarizeOrder[0], "s1");
  assert.equal(summarizeOrder[1], "s2");
  idx.dispose();
});

// M3: queue dedup — calling _run twice for same session should not double-queue
test("indexer dedups queued sessions (M3)", async () => {
  let summarizeOrder = [];
  const summarize = async ({ sessionID }) => { summarizeOrder.push(sessionID); return { title: "t", summary: "s", decisions: [] }; };
  const idx = new Indexer({
    client: mkClient(), config: mkConfig(),
    embeddings: { embed: async () => new Float32Array([0.1]), dim: 1, modelId: "m" },
    storage: mkStorage(null), state: mkState(), summarize,
    projectKey: { hash: "k", source: "remote" }, confidentialPatterns: [],
  });
  // First call acquires lock
  const p1 = idx._run("s1");
  // Second call for same session: queue.has → returns early (dedup)
  idx._run("s1");
  await p1;
  assert.equal(summarizeOrder.length, 1, "s1 summarized once");
  idx.dispose();
});

// ── G5 — version increment ──────────────────────────────────────────

test("indexer increments version on re-summarize (G5)", async () => {
  const client = mkClient();
  const storage = mkStorage(client);
  const summarize = async () => ({ title: "t", summary: "s", decisions: [] });
  const idx = new Indexer({ client, config: mkConfig(),
    embeddings: { embed: async () => new Float32Array([0.1]), dim: 1, modelId: "m" },
    storage, state: mkState(), summarize,
    projectKey: { hash: "k", source: "remote" }, confidentialPatterns: [],
  });
  await idx._run("s1");
  assert.equal(client.upserts[0][0].version, 1);
  await idx._run("s1");
  assert.equal(client.upserts[1][0].version, 2);
  idx.dispose();
});

// ── I2 — SESSIONS exclusion + maestro-memory cleanup ─────────────────

test("indexer skips maestro-memory sessions from SESSIONS set (I2)", async () => {
  SESSIONS.add("mem-session-1");
  const client = mkClient();
  const storage = mkStorage(client);
  const summarize = async () => ({ title: "t", summary: "s", decisions: [] });
  const idx = new Indexer({ client, config: mkConfig(),
    embeddings: { embed: async () => new Float32Array([0.1]), dim: 1, modelId: "m" },
    storage, state: mkState(), summarize,
    projectKey: { hash: "k", source: "remote" }, confidentialPatterns: [],
  });
  await idx._run("mem-session-1");
  assert.equal(client.upserts.length, 0);
  SESSIONS.delete("mem-session-1");
  idx.dispose();
});

test("indexer deletes [maestro-memory] sessions during backfill (I2)", async () => {
  let deletedIds = [];
  const client = {
    upserts: [],
    session: {
      get: async () => ({ data: { id: "user-1", parentID: null, title: "User session", time: { created: 1, updated: Date.now() - 1000 } } }),
      messages: async () => ({ data: [{ info: {}, parts: [{ type: "text", text: "hi" }] }] }),
      list: async () => ({ data: [
        { id: "mem-1", parentID: null, title: "[maestro-memory] old-session" },
        { id: "user-1", parentID: null, title: "User session", time: { created: 1, updated: Date.now() - 1000 } },
      ]}),
      delete: async ({ path: { id } }) => { deletedIds.push(id); },
    },
  };
  const storage = mkStorage(client);
  const summarize = async () => ({ title: "t", summary: "s", decisions: [] });
  const idx = new Indexer({ client, config: { ...mkConfig({ idle_debounce_min: 0.001 }), backfill_max_per_start: 5 },
    embeddings: { embed: async () => new Float32Array([0.1]), dim: 1, modelId: "m" },
    storage, state: { ...mkState(), isSkipped: async () => false },
    summarize, projectKey: { hash: "k", source: "remote" }, confidentialPatterns: [],
  });
  await idx.onStartup();
  await new Promise((r) => setTimeout(r, 100));
  assert.ok(deletedIds.includes("mem-1"), "maestro-memory session deleted");
  assert.equal(client.upserts.length, 1, "only user-1 was backfilled");
  idx.dispose();
});

// ── I3 — retry throttle ─────────────────────────────────────────────

test("indexer throttles retry based on lastAttempt (I3)", async () => {
  const client = mkClient();
  const storage = mkStorage(client);
  let callCount = 0;
  const summarize = async () => { callCount++; return { title: "t", summary: "s", decisions: [] }; };
  const idx = new Indexer({ client, config: { ...mkConfig(), retry_interval_min: 10 },
    embeddings: { embed: async () => new Float32Array([0.1]), dim: 1, modelId: "m" },
    storage, state: { ...mkState(), getLastAttempt: async () => Date.now() },
    summarize, projectKey: { hash: "k", source: "remote" }, confidentialPatterns: [],
  });
  await idx._run("s1");
  assert.equal(callCount, 0, "retry throttled — lastAttempt too recent");
  idx.dispose();
});

// ── I5 — debounce fix + backfill cap ─────────────────────────────────

test("indexer debounce sets timer (I5)", async () => {
  const idx = new Indexer({
    client: mkClient(), config: mkConfig(),
    embeddings: { embed: async () => new Float32Array([0.1]), dim: 1, modelId: "m" },
    storage: mkStorage(null), state: mkState(),
    summarize: async () => ({ title: "t", summary: "s", decisions: [] }),
    projectKey: { hash: "k", source: "remote" }, confidentialPatterns: [],
  });
  await idx.onSessionIdle({ sessionID: "s1" });
  assert.equal(idx.timers.size, 1, "one timer set");
  assert.ok(idx.timers.has("s1"));
  idx.dispose();
});

test("indexer onStartup caps backfill at backfill_max_per_start (I5)", async () => {
  const now = Date.now();
  const sessions = Array.from({ length: 20 }, (_, i) => ({
    id: `s${i}`, parentID: null, time: { created: 1, updated: now - 1000 },
  }));
  const client = {
    upserts: [],
    session: {
      get: async ({ path }) => ({ data: { id: path.id, parentID: null, title: "st", time: { created: 1, updated: now - 1000 } } }),
      messages: async () => ({ data: [{ info: {}, parts: [{ type: "text", text: "hi" }] }] }),
      list: async () => ({ data: sessions }),
    },
  };
  const storage = mkStorage(client);
  const summarize = async () => ({ title: "t", summary: "s", decisions: [] });
  const idx = new Indexer({ client, config: { ...mkConfig({ idle_debounce_min: 0.001 }), backfill_max_per_start: 3 },
    embeddings: { embed: async () => new Float32Array([0.1]), dim: 1, modelId: "m" },
    storage, state: { ...mkState(), isSkipped: async () => false },
    summarize, projectKey: { hash: "k", source: "remote" }, confidentialPatterns: [],
  });
  await idx.onStartup();
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(client.upserts.length, 3, "only 3 sessions backfilled (cap)");
  idx.dispose();
});

// ── Queue-after-error ───────────────────────────────────────────────

test("indexer queued session runs after first _run throws (queue-after-error)", async () => {
  let summaryCalls = [];
  const summarize = async ({ sessionID }) => {
    summaryCalls.push(sessionID);
    if (sessionID === "s1") {
      throw new Error("simulated summarize failure");
    }
    return { title: "t", summary: "s", decisions: [] };
  };
  const idx = new Indexer({
    client: mkClient(), config: mkConfig(),
    embeddings: { embed: async () => new Float32Array([0.1]), dim: 1, modelId: "m" },
    storage: mkStorage(null), state: mkState(), summarize,
    projectKey: { hash: "k", source: "remote" }, confidentialPatterns: [],
  });

  // First call: acquires lock, throws in summarize (sync) → caught → finally → processes queue → s2 runs
  const p1 = idx._run("s1");
  // Second call: queues behind s1 (s1 has running=true)
  idx._run("s2");

  // s1 throws sync, finally runs sync, processes queue sync → s2 runs sync
  // But p2 (queued call) returns immediately (just queued). We need to wait for s2 to complete.
  // Since s2 runs from the recursive _run in finally, it's already scheduled.
  await p1; // waits for s1's error
  await new Promise((r) => setImmediate(r)); // yield to let s2 complete from recursive call
  assert.equal(summaryCalls.length, 2, "s1 failed, s2 ran from queue");
  assert.equal(summaryCalls[0], "s1");
  assert.equal(summaryCalls[1], "s2");
  idx.dispose();
});

// ── Custom author (M7) ───────────────────────────────────────────────

test("indexer uses explicit author param (M7)", async () => {
  const client = mkClient();
  const storage = mkStorage(client);
  const idx = new Indexer({
    client, config: mkConfig(),
    embeddings: { embed: async () => new Float32Array([0.1]), dim: 1, modelId: "m" },
    storage, state: mkState(),
    summarize: async () => ({ title: "t", summary: "s", decisions: [] }),
    projectKey: { hash: "k", source: "remote" }, confidentialPatterns: [],
    author: "custom-author",
  });
  await idx._run("s1");
  assert.equal(client.upserts[0][0].author, "custom-author");
  idx.dispose();
});
