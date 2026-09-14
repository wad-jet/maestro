import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
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

// Task 4: write-gate requires a resolvable head — default git mock returns a
// valid 40-hex head so tests that expect a record pass the gate.
function mkGit({ branch = "feature/x", head = "a".repeat(40) } = {}) {
  return {
    resolveBranch: async () => branch,
    resolveHead: async () => head,
  };
}

// 4.0.0: mock embeddings (аналог из memory/index.test.js).
function mkMockEmbeddings() {
  return { embed: async () => new Float32Array([0.1, 0.2, 0.3]), dim: 3, modelId: "m" };
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
    git: mkGit(),
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

test("indexer deletes on session deleted when delete_on_session_delete flag ON", async () => {
  let deletedId = null;
  const storage = {
    upsert: async () => {}, search: async () => [],
    delete: async (sid) => { deletedId = sid; }, stats: async () => ({ entries: 0 }),
  };
  const idx = new Indexer({
    client: mkClient(), config: mkConfig({ delete_on_session_delete: true }),
    embeddings: { embed: async () => new Float32Array([0.1]), dim: 1, modelId: "m" },
    storage, state: mkState(),
    summarize: async () => ({}),
    projectKey: { hash: "k", source: "remote" }, confidentialPatterns: [],
  });
  await idx.onSessionDeleted({ sessionID: "s1" });
  assert.equal(deletedId, "s1");
  idx.dispose();
});

test("indexer keeps record on session deleted by default (flag OFF)", async () => {
  const client = mkClient();
  const storage = mkStorage(client);
  const idx = new Indexer({
    client, config: mkConfig(),
    embeddings: { embed: async () => new Float32Array([0.1]), dim: 1, modelId: "m" },
    storage, state: mkState(),
    summarize: async () => ({ title: "t", summary: "s", decisions: [] }),
    projectKey: { hash: "k", source: "remote" }, confidentialPatterns: [],
    git: mkGit(),
  });
  await idx._run("s1");
  assert.equal(client.upserts.length, 1, "record upserted first");
  await idx.onSessionDeleted({ sessionID: "s1" });
  assert.ok(await storage.get("s1"), "record survives session.deleted by default");
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

test("indexer retryable embed error does not recordFail", async () => {
  let failCalled = false;
  const client = mkClient();
  const storage = mkStorage(client);
  const idx = new Indexer({
    client, config: mkConfig(),
    embeddings: {
      embed: async () => { const e = new Error("network"); e.retryable = true; throw e; },
      dim: 1, modelId: "m",
    },
    storage,
    state: { ...mkState(), recordFail: async () => { failCalled = true; } },
    summarize: async () => ({ title: "t", summary: "s", decisions: [] }),
    projectKey: { hash: "khash", source: "remote" }, confidentialPatterns: [],
    git: mkGit(),
  });
  await idx._run("s1");
  assert.equal(failCalled, false);
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
    git: mkGit(),
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
    git: mkGit(),
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
    git: mkGit(),
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
    git: mkGit(),
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
    git: mkGit(),
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
    git: mkGit(),
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
    git: mkGit(),
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
    git: mkGit(),
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
    git: mkGit(),
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
    git: mkGit(),
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
    git: mkGit(),
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
    git: mkGit(),
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

// ── I1 — summarize inside withTimeout (hangs, bounded) ──────────────

test("indexer timeout bounds hanging summarize (I1)", async () => {
  const client = mkClient();
  const storage = mkStorage(client);
  const summarize = async () => {
    // Hang forever — simulates a stuck client.session.prompt
    await new Promise(() => {});
    return { title: "t", summary: "s", decisions: [] };
  };
  let failCalled = false;
  let failSessionId = null;
  const idx = new Indexer({
    client, config: mkConfig({ summarize_timeout_ms: 50 }),
    embeddings: { embed: async () => new Float32Array([0.1]), dim: 1, modelId: "m" },
    storage,
    state: { ...mkState(), recordFail: async (sid) => { failCalled = true; failSessionId = sid; } },
    summarize,
    projectKey: { hash: "k", source: "remote" }, confidentialPatterns: [],
    git: mkGit(),
  });

  const start = Date.now();
  await idx._run("s1");
  const elapsed = Date.now() - start;

  // Should complete within timeout + small buffer (50ms + 100ms buffer)
  assert.ok(elapsed >= 40, `timed out fast (expected ~50ms, got ${elapsed}ms)`);
  assert.ok(elapsed < 300, `completed too slowly (expected <300ms, got ${elapsed}ms)`);
  assert.ok(failCalled, "recordFail called after timeout");
  assert.equal(failSessionId, "s1");
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
    git: mkGit(),
  });
  await idx._run("s1");
  assert.equal(client.upserts[0][0].author, "custom-author");
  idx.dispose();
});

// ── Task 4: branch/head (sticky) + merged fast-path ──────────────────

test("summarize attaches branch/head (sticky) and merged fast-path", async () => {
  const client = mkClient();
  const storage = mkStorage(client);
  let branch = "feature/x";
  const git = {
    resolveBranch: async () => branch,
    resolveHead: async () => "sha1",
  };
  const idx = new Indexer({
    client, config: mkConfig(),
    embeddings: { embed: async () => new Float32Array([0.1]), dim: 1, modelId: "m" },
    storage, state: mkState(),
    summarize: async () => ({ title: "t", summary: "s", decisions: [] }),
    projectKey: { hash: "k", source: "remote" }, confidentialPatterns: [],
    git, mainline: "main",
  });
  await idx._run("s1");
  let e = client.upserts[0][0];
  assert.equal(e.branch, "feature/x");
  assert.equal(e.head, "sha1");
  assert.equal(e.merged, 0);
  assert.equal(e.version, 1);

  // re-summarize: git switched to main, but sticky keeps feature/x
  branch = "main";
  await idx._run("s1");
  e = client.upserts[1][0];
  assert.equal(e.branch, "feature/x", "sticky branch preserved");
  assert.equal(e.head, "sha1", "sticky head preserved");
  assert.equal(e.merged, 0, "merged=0: sticky branch feature/x (fast-path, head не mainline)");
  assert.equal(e.version, 2);
  idx.dispose();
});

test("onSessionDeleted clears sticky branch/head → re-summarize re-resolves", async () => {
  const client = mkClient();
  const storage = mkStorage(client);
  let branch = "feature/x";
  let head = "sha1";
  const git = {
    resolveBranch: async () => branch,
    resolveHead: async () => head,
  };
  const idx = new Indexer({
    client, config: mkConfig(),
    embeddings: { embed: async () => new Float32Array([0.1]), dim: 1, modelId: "m" },
    storage, state: mkState(),
    summarize: async () => ({ title: "t", summary: "s", decisions: [] }),
    projectKey: { hash: "k", source: "remote" }, confidentialPatterns: [],
    git, mainline: "main",
  });
  await idx._run("s1");
  assert.equal(client.upserts[0][0].branch, "feature/x", "first summarize resolves branch");

  // git switches; sticky keeps old value on re-summarize (no delete yet)
  branch = "main";
  head = "sha2";
  await idx._run("s1");
  assert.equal(client.upserts[1][0].branch, "feature/x", "sticky preserved before delete");

  // delete → sticky cleared → re-summarize re-resolves current git state
  await idx.onSessionDeleted({ sessionID: "s1" });
  await idx._run("s1");
  assert.equal(client.upserts[2][0].branch, "main", "sticky cleared → branch re-resolved");
  assert.equal(client.upserts[2][0].head, "sha2", "sticky cleared → head re-resolved");
  idx.dispose();
});

test("branch==mainline → merged=1 fast-path; mainline unresolved → merged=0", async () => {
  const client = mkClient();
  const storage = mkStorage(client);
  const idx = new Indexer({
    client, config: mkConfig(),
    embeddings: { embed: async () => new Float32Array([0.1]), dim: 1, modelId: "m" },
    storage, state: mkState(),
    summarize: async () => ({ title: "t", summary: "s", decisions: [] }),
    projectKey: { hash: "k", source: "remote" }, confidentialPatterns: [],
    git: { resolveBranch: async () => "main", resolveHead: async () => "sha1" },
    mainline: "main",
  });
  await idx._run("s1");
  assert.equal(client.upserts[0][0].merged, 1, "branch==mainline → merged=1");

  // mainline unresolved → merged=0
  const client2 = mkClient();
  const storage2 = mkStorage(client2);
  const idx2 = new Indexer({
    client: client2, config: mkConfig(),
    embeddings: { embed: async () => new Float32Array([0.1]), dim: 1, modelId: "m" },
    storage: storage2, state: mkState(),
    summarize: async () => ({ title: "t", summary: "s", decisions: [] }),
    projectKey: { hash: "k", source: "remote" }, confidentialPatterns: [],
    git: { resolveBranch: async () => "main", resolveHead: async () => "sha1" },
    mainline: null,
  });
  await idx2._run("s1");
  assert.equal(client2.upserts[0][0].merged, 0, "mainline unresolved → merged=0");
  idx.dispose();
  idx2.dispose();
});

// ── follow-up 2026-09-11: merged пересчитывается по head-ancestry (не липкий) ──

test("merged recomputed by head ancestry — existing merged=1 with head NOT in mainline → 0", async () => {
  const client = mkClient();
  // existing.merged=1 (запись была в main), но текущий head — feature-ветка.
  // Липкое правило оставило бы 1 (баг); новое — пересчитывает по isAncestor → 0.
  const storage = mkStorage(client, async () => ({ merged: 1 }));
  const idx = new Indexer({
    client, config: mkConfig(),
    embeddings: { embed: async () => new Float32Array([0.1]), dim: 1, modelId: "m" },
    storage, state: mkState(),
    summarize: async () => ({ title: "t", summary: "s", decisions: [] }),
    projectKey: { hash: "k", source: "remote" }, confidentialPatterns: [],
    git: {
      resolveBranch: async () => "feature/x",
      resolveHead: async () => "feat-head",
      isAncestor: async () => "no",
    },
    mainline: "main",
  });
  await idx._run("s1");
  assert.equal(client.upserts[0][0].merged, 0, "head вне mainline → merged=0 (не липкий)");
  idx.dispose();
});

test("merged=1 when head is ancestor of mainline (isAncestor yes)", async () => {
  const client = mkClient();
  const idx = new Indexer({
    client, config: mkConfig(),
    embeddings: { embed: async () => new Float32Array([0.1]), dim: 1, modelId: "m" },
    storage: mkStorage(client), state: mkState(),
    summarize: async () => ({ title: "t", summary: "s", decisions: [] }),
    projectKey: { hash: "k", source: "remote" }, confidentialPatterns: [],
    git: {
      resolveBranch: async () => "feature/x",
      resolveHead: async () => "main-head",
      isAncestor: async () => "yes",
    },
    mainline: "main",
  });
  await idx._run("s1");
  assert.equal(client.upserts[0][0].merged, 1, "head ∈ mainline → merged=1");
  idx.dispose();
});

test("merged fast-path fallback when isAncestor errors", async () => {
  const client = mkClient();
  const idx = new Indexer({
    client, config: mkConfig(),
    embeddings: { embed: async () => new Float32Array([0.1]), dim: 1, modelId: "m" },
    storage: mkStorage(client), state: mkState(),
    summarize: async () => ({ title: "t", summary: "s", decisions: [] }),
    projectKey: { hash: "k", source: "remote" }, confidentialPatterns: [],
    git: {
      resolveBranch: async () => "main",
      resolveHead: async () => "sha1",
      isAncestor: async () => "error",
    },
    mainline: "main",
  });
  await idx._run("s1");
  assert.equal(client.upserts[0][0].merged, 1, "isAncestor error → fast-path branch===mainline");
  idx.dispose();
});

test("detached → branch='' but head recorded", async () => {
  const client = mkClient();
  const storage = mkStorage(client);
  const idx = new Indexer({
    client, config: mkConfig(),
    embeddings: { embed: async () => new Float32Array([0.1]), dim: 1, modelId: "m" },
    storage, state: mkState(),
    summarize: async () => ({ title: "t", summary: "s", decisions: [] }),
    projectKey: { hash: "k", source: "remote" }, confidentialPatterns: [],
    git: { resolveBranch: async () => "", resolveHead: async () => "sha1" },
    mainline: "main",
  });
  await idx._run("s1");
  const e = client.upserts[0][0];
  assert.equal(e.branch, "", "detached → branch=''");
  assert.equal(e.head, "sha1", "head recorded");
  assert.equal(e.merged, 0, "detached → merged=0");
  idx.dispose();
});

// ── Task 4: write-gate (spec §3.3) ──────────────────────────────────

test("write-gate: no head → no record, summarize NOT called (spec §3.3)", async () => {
  const client = mkClient();
  const storage = mkStorage(client);
  let summarizeCalls = 0;
  const idx = new Indexer({
    client, config: mkConfig(),
    embeddings: { embed: async () => new Float32Array([0.1]), dim: 1, modelId: "m" },
    storage, state: mkState(),
    summarize: async () => { summarizeCalls++; return { title: "t", summary: "s", decisions: [] }; },
    projectKey: { hash: "k", source: "remote" }, confidentialPatterns: [],
    git: { resolveBranch: async () => "", resolveHead: async () => "" },
  });
  await idx._run("s1");
  assert.equal(summarizeCalls, 0, "summarize NOT called without head");
  assert.equal(await storage.get("s1"), null, "no record written");
  assert.equal(client.upserts.length, 0);
  idx.dispose();
});

test("sticky-фикс: empty head resolution is NOT cached — re-resolves on next run (spec §3.3)", async () => {
  const client = mkClient();
  const storage = mkStorage(client);
  let headResolves = 0;
  const git = {
    resolveBranch: async () => "",
    resolveHead: async () => { headResolves++; return ""; },
  };
  const idx = new Indexer({
    client, config: mkConfig(),
    embeddings: { embed: async () => new Float32Array([0.1]), dim: 1, modelId: "m" },
    storage, state: mkState(),
    summarize: async () => ({ title: "t", summary: "s", decisions: [] }),
    projectKey: { hash: "k", source: "remote" }, confidentialPatterns: [],
    git,
  });
  await idx._run("s1");
  assert.equal(headResolves, 1, "first run resolves head");
  await idx._run("s1");
  assert.equal(headResolves, 2, "empty head NOT cached — second run re-resolves");
  assert.equal(client.upserts.length, 0, "no record without head");
  idx.dispose();
});

test("head-preserve: re-summarize with empty head resolve keeps existing head (spec §3.3)", async () => {
  const client = mkClient();
  const storage = mkStorage(client);
  const head = "a".repeat(40);
  let resolveHead = async () => head;
  const git = {
    resolveBranch: async () => "feature/x",
    resolveHead: async () => resolveHead(),
  };
  const idx = new Indexer({
    client, config: mkConfig(),
    embeddings: { embed: async () => new Float32Array([0.1]), dim: 1, modelId: "m" },
    storage, state: mkState(),
    summarize: async () => ({ title: "t", summary: "s", decisions: [] }),
    projectKey: { hash: "k", source: "remote" }, confidentialPatterns: [],
    git,
  });
  await idx._run("s1");
  assert.equal(client.upserts[0][0].head, head, "first run records head");

  // Re-summarize with empty head resolve: clear sticky cache so the resolver
  // runs again, flip the mock to return empty head.
  idx._branchContext.delete("s1");
  resolveHead = async () => "";
  await idx._run("s1");
  const e = client.upserts[1][0];
  assert.equal(e.head, head, "existing head preserved on re-summarize");
  assert.equal(e.branch, "feature/x", "existing branch preserved");
  assert.equal(e.version, 2);
  idx.dispose();
});

// ── Task 3: lifecycle-аудит (spec §4.1) ─────────────────────────────

function captureLog() {
  const calls = [];
  return {
    calls,
    log: {
      info: (m, e) => calls.push(["info", m, e]),
      warn: (m, e) => calls.push(["warn", m, e]),
      error: (m, e) => calls.push(["error", m, e]),
      debug: (m, e) => calls.push(["debug", m, e]),
    },
  };
}

test("indexer logs indexed + summarize.duration on success", async () => {
  const cap = captureLog();
  const client = mkClient();
  const idx = new Indexer({
    client, config: mkConfig(), embeddings: { embed: async () => new Float32Array([0.1]), dim: 1, modelId: "m" },
    storage: mkStorage(client), state: mkState(),
    summarize: async () => ({ title: "t", summary: "s", decisions: [] }),
    projectKey: { hash: "khash", source: "remote" }, confidentialPatterns: [],
    logInfo: cap.log.info, logDebug: cap.log.debug, logWarn: cap.log.warn, logError: cap.log.error,
    git: mkGit(),
  });
  await idx._run("s1");
  assert.ok(cap.calls.some(([lvl, m]) => lvl === "info" && m === "memory:indexed"));
  assert.ok(cap.calls.some(([lvl, m]) => lvl === "debug" && m === "memory:summarize.duration"));
  idx.dispose();
});

test("indexer logs index_error with error_class (not message)", async () => {
  const cap = captureLog();
  const client = mkClient(); client.session.get = async () => { throw new Error("network"); };
  const idx = new Indexer({
    client, config: mkConfig(), embeddings: { embed: async () => new Float32Array([0.1]), dim: 1, modelId: "m" },
    storage: mkStorage(client), state: { ...mkState(), recordFail: async () => {} },
    summarize: async () => ({}), projectKey: { hash: "k", source: "remote" }, confidentialPatterns: [],
    logInfo: cap.log.info, logDebug: cap.log.debug, logWarn: cap.log.warn, logError: cap.log.error,
  });
  await idx._run("s1");
  const err = cap.calls.find(([lvl, m]) => m === "memory:index_error");
  assert.ok(err, "index_error logged");
  assert.ok(!JSON.stringify(err).includes("network"), "error message NOT in log (enum only)");
  idx.dispose();
});

test("indexer logs reindexed on re-summarize (version > 1)", async () => {
  const cap = captureLog();
  const client = mkClient();
  const idx = new Indexer({
    client, config: mkConfig(), embeddings: { embed: async () => new Float32Array([0.1]), dim: 1, modelId: "m" },
    storage: mkStorage(client), state: mkState(),
    summarize: async () => ({ title: "t", summary: "s", decisions: [] }),
    projectKey: { hash: "k", source: "remote" }, confidentialPatterns: [],
    logInfo: cap.log.info, logDebug: cap.log.debug, logWarn: cap.log.warn, logError: cap.log.error,
    git: mkGit(),
  });
  await idx._run("s1");
  await idx._run("s1");
  assert.ok(cap.calls.some(([lvl, m]) => lvl === "info" && m === "memory:indexed"), "first write → indexed");
  assert.ok(cap.calls.some(([lvl, m]) => lvl === "info" && m === "memory:reindexed"), "re-summarize → reindexed");
  idx.dispose();
});

test("indexer logs index_skipped after 3 fails (recordFail path)", async () => {
  const cap = captureLog();
  const client = mkClient();
  client.session.get = async () => { throw new Error("network"); };
  const idx = new Indexer({
    client, config: mkConfig(), embeddings: { embed: async () => new Float32Array([0.1]), dim: 1, modelId: "m" },
    storage: mkStorage(client), state: mkState(),
    summarize: async () => ({}), projectKey: { hash: "k", source: "remote" }, confidentialPatterns: [],
    logInfo: cap.log.info, logDebug: cap.log.debug, logWarn: cap.log.warn, logError: cap.log.error,
  });
  await idx._run("s1");
  await idx._run("s1");
  await idx._run("s1");
  const skip = cap.calls.find(([lvl, m]) => m === "memory:index_skipped");
  assert.ok(skip, "index_skipped logged");
  assert.equal(skip[2].fails, 3);
  idx.dispose();
});

test("indexer logs index_retryable on retryable error (error_class enum)", async () => {
  const cap = captureLog();
  const client = mkClient();
  const idx = new Indexer({
    client, config: mkConfig(),
    embeddings: {
      embed: async () => { const e = new Error("network"); e.retryable = true; throw e; },
      dim: 1, modelId: "m",
    },
    storage: mkStorage(client), state: mkState(),
    summarize: async () => ({ title: "t", summary: "s", decisions: [] }),
    projectKey: { hash: "k", source: "remote" }, confidentialPatterns: [],
    logInfo: cap.log.info, logDebug: cap.log.debug, logWarn: cap.log.warn, logError: cap.log.error,
    git: mkGit(),
  });
  await idx._run("s1");
  const err = cap.calls.find(([lvl, m]) => m === "memory:index_error");
  assert.ok(err, "index_error logged");
  assert.equal(err[2].error_class, "retryable");
  assert.ok(cap.calls.some(([lvl, m]) => lvl === "debug" && m === "memory:index_retryable"));
  idx.dispose();
});

test("indexer logs session_closed on onSessionDeleted by default (flag OFF)", async () => {
  const cap = captureLog();
  const idx = new Indexer({
    client: mkClient(), config: mkConfig(),
    embeddings: { embed: async () => new Float32Array([0.1]), dim: 1, modelId: "m" },
    storage: mkStorage(null), state: mkState(),
    summarize: async () => ({}),
    projectKey: { hash: "k", source: "remote" }, confidentialPatterns: [],
    logInfo: cap.log.info, logDebug: cap.log.debug, logWarn: cap.log.warn, logError: cap.log.error,
  });
  await idx.onSessionDeleted({ sessionID: "s1" });
  assert.ok(cap.calls.some(([lvl, m]) => lvl === "info" && m === "memory:session_closed"));
  assert.ok(!cap.calls.some(([lvl, m]) => m === "memory:session_deleted"), "no session_deleted when flag OFF");
  idx.dispose();
});

test("indexer logs session_deleted on onSessionDeleted when flag ON (success path)", async () => {
  const cap = captureLog();
  const idx = new Indexer({
    client: mkClient(), config: mkConfig({ delete_on_session_delete: true }),
    embeddings: { embed: async () => new Float32Array([0.1]), dim: 1, modelId: "m" },
    storage: mkStorage(null), state: mkState(),
    summarize: async () => ({}),
    projectKey: { hash: "k", source: "remote" }, confidentialPatterns: [],
    logInfo: cap.log.info, logDebug: cap.log.debug, logWarn: cap.log.warn, logError: cap.log.error,
  });
  await idx.onSessionDeleted({ sessionID: "s1" });
  assert.ok(cap.calls.some(([lvl, m]) => lvl === "info" && m === "memory:session_deleted"));
  idx.dispose();
});

test("indexer logs session_delete_failed (not session_deleted) when storage.delete throws (flag ON)", async () => {
  const cap = captureLog();
  const storage = {
    upsert: async () => {}, search: async () => [],
    delete: async () => { throw new Error("db down"); }, stats: async () => ({ entries: 0 }),
  };
  const idx = new Indexer({
    client: mkClient(), config: mkConfig({ delete_on_session_delete: true }),
    embeddings: { embed: async () => new Float32Array([0.1]), dim: 1, modelId: "m" },
    storage, state: mkState(),
    summarize: async () => ({}),
    projectKey: { hash: "k", source: "remote" }, confidentialPatterns: [],
    logInfo: cap.log.info, logDebug: cap.log.debug, logWarn: cap.log.warn, logError: cap.log.error,
  });
  await idx.onSessionDeleted({ sessionID: "s1" });
  assert.ok(cap.calls.some(([lvl, m]) => lvl === "error" && m === "memory:session_delete_failed"), "session_delete_failed logged");
  assert.ok(!cap.calls.some(([lvl, m]) => m === "memory:session_deleted"), "session_deleted NOT logged on failure");
  idx.dispose();
});

// ── Task 5: tombstone race-guard (spec §5) ───────────────────────────

test("tombstone pre-check: tombstoned session does not write a record (spec §5)", async () => {
  const client = mkClient();
  const storage = mkStorage(client);
  const idx = new Indexer({
    client, config: mkConfig({ delete_on_session_delete: true }),
    embeddings: { embed: async () => new Float32Array([0.1]), dim: 1, modelId: "m" },
    storage, state: mkState(),
    summarize: async () => ({ title: "t", summary: "s", decisions: [] }),
    projectKey: { hash: "k", source: "remote" }, confidentialPatterns: [],
    git: mkGit(),
  });
  idx._tombstones.add("s1");
  await idx._run("s1");
  assert.equal(client.upserts.length, 0, "no upsert for tombstoned session");
  assert.equal(await storage.get("s1"), null, "no record written");
  idx.dispose();
});

test("tombstone post-upsert recheck deletes resurrected record (spec §5)", async () => {
  const client = mkClient();
  const store = new Map();
  let idx;
  const storage = {
    upsert: async (es) => {
      for (const e of es) store.set(e.session_id, e);
      if (client) client.upserts.push(es);
      // simulate session deleted mid-upsert → tombstone set after pre-check
      idx._tombstones.add("s1");
    },
    get: async (sid) => store.get(sid) ?? null,
    search: async () => [],
    delete: async (sid) => { store.delete(sid); },
    stats: async () => ({ entries: 0 }),
  };
  idx = new Indexer({
    client, config: mkConfig({ delete_on_session_delete: true }),
    embeddings: { embed: async () => new Float32Array([0.1]), dim: 1, modelId: "m" },
    storage, state: mkState(),
    summarize: async () => ({ title: "t", summary: "s", decisions: [] }),
    projectKey: { hash: "k", source: "remote" }, confidentialPatterns: [],
    git: mkGit(),
  });
  await idx._run("s1");
  assert.equal(await storage.get("s1"), null, "no resurrected record after tombstone");
  assert.ok(!idx._tombstones.has("s1"), "tombstone cleared after recheck");
  idx.dispose();
});

test("indexer logs backfill + backfill.done on onStartup (considered/indexed/skipped)", async () => {
  const cap = captureLog();
  const now = Date.now();
  const client = {
    upserts: [],
    session: {
      get: async ({ path }) => ({ data: { id: path.id, parentID: null, title: "st", time: { created: 1, updated: now - 1000 } } }),
      messages: async () => ({ data: [{ info: {}, parts: [{ type: "text", text: "hi" }] }] }),
      list: async () => ({ data: [
        { id: "s1", parentID: null, time: { created: 1, updated: now - 1000 } },
        { id: "s2", parentID: "p1", time: { created: 1, updated: now - 1000 } },
        { id: "s3", parentID: null, time: { created: 1, updated: now - 1000 } },
      ]}),
    },
  };
  const idx = new Indexer({
    client, config: { ...mkConfig({ idle_debounce_min: 0.001 }), backfill_max_per_start: 5 },
    embeddings: { embed: async () => new Float32Array([0.1]), dim: 1, modelId: "m" },
    storage: mkStorage(client), state: { ...mkState(), isSkipped: async () => false },
    summarize: async () => ({ title: "t", summary: "s", decisions: [] }),
    projectKey: { hash: "k", source: "remote" }, confidentialPatterns: [],
    logInfo: cap.log.info, logDebug: cap.log.debug, logWarn: cap.log.warn, logError: cap.log.error,
    git: mkGit(),
  });
  await idx.onStartup();
  const bf = cap.calls.find(([lvl, m]) => m === "memory:backfill");
  assert.ok(bf, "backfill logged");
  assert.equal(bf[2].considered, 3);
  assert.equal(bf[2].indexed, 2);
  assert.equal(bf[2].skipped, 1);
  const done = cap.calls.find(([lvl, m]) => m === "memory:backfill.done");
  assert.ok(done, "backfill.done logged");
  assert.ok(typeof done[2].duration_ms === "number");
  idx.dispose();
});

test("M-7: _branchContext bounded — oldest evicted on overflow (re-resolves)", async () => {
  const client = mkClient();
  const storage = mkStorage(client);
  let branch = "feature/x";
  const git = {
    resolveBranch: async () => branch,
    resolveHead: async () => "sha1",
  };
  const idx = new Indexer({
    client, config: mkConfig(),
    embeddings: { embed: async () => new Float32Array([0.1]), dim: 1, modelId: "m" },
    storage, state: mkState(),
    summarize: async () => ({ title: "t", summary: "s", decisions: [] }),
    projectKey: { hash: "k", source: "remote" }, confidentialPatterns: [],
    git, mainline: "main",
    branchContextCap: 3,
  });
  // 3 сессии влезают в cap.
  await idx._resolveBranchContext("s1");
  await idx._resolveBranchContext("s2");
  await idx._resolveBranchContext("s3");
  assert.equal(idx._branchContext.size, 3);
  // 4-я вставка эвиктит старейшую (s1) — FIFO.
  await idx._resolveBranchContext("s4");
  assert.equal(idx._branchContext.size, 3, "map stays bounded");
  assert.ok(!idx._branchContext.has("s1"), "oldest evicted");
  assert.ok(idx._branchContext.has("s2") && idx._branchContext.has("s3") && idx._branchContext.has("s4"), "newer kept");
  // Эвиктированная сессия re-resolves текущее git-состояние.
  branch = "main";
  const ctx = await idx._resolveBranchContext("s1");
  assert.equal(ctx.branch, "main", "evicted session re-resolves current git state");
  idx.dispose();
});

// ── Task 4: origin_remote + prefixes (spec §3.3/§5) ───────────────────

test("entry carries origin_remote and prefixes", async () => {
  const client = mkClient();
  const storage = mkStorage(client);
  const idx = new Indexer({
    client, config: mkConfig(),
    embeddings: { embed: async () => new Float32Array([0.1]), dim: 1, modelId: "m" },
    storage, state: mkState(),
    summarize: async () => ({ title: "t", summary: "s", decisions: [] }),
    projectKey: { hash: "k", source: "remote" }, key: "microservices.sales", originRemote: "github.com/org/api",
    confidentialPatterns: [],
    git: mkGit(),
  });
  await idx._run("s1");
  const e = client.upserts[0][0];
  assert.equal(e.origin_remote, "github.com/org/api");
  assert.deepEqual(e.prefixes, ["microservices"]);
  idx.dispose();
});

test("single-segment namespace → prefixes empty; no originRemote → ''", async () => {
  const client = mkClient();
  const storage = mkStorage(client);
  const idx = new Indexer({
    client, config: mkConfig(),
    embeddings: { embed: async () => new Float32Array([0.1]), dim: 1, modelId: "m" },
    storage, state: mkState(),
    summarize: async () => ({ title: "t", summary: "s", decisions: [] }),
    projectKey: { hash: "k", source: "remote" }, key: "k",
    confidentialPatterns: [],
    git: mkGit(),
  });
  await idx._run("s1");
  const e = client.upserts[0][0];
  assert.deepEqual(e.prefixes, []);
  assert.equal(e.origin_remote, "");
  idx.dispose();
});

// ── Task 3: artifact-links (spec §4.2) ───────────────────────────────

function mkArtifactRoot(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "idx-artifacts-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function touchFile(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, "x");
}

function writePart(filePath) {
  return { type: "tool", tool: "write", state: { status: "completed", input: { filePath } } };
}

test("entry.artifacts extracted from completed write parts (Task 3)", async (t) => {
  const root = mkArtifactRoot(t);
  const file = path.join(root, "docs", "spec.md");
  touchFile(file);
  const client = mkClient([
    { info: {}, parts: [{ type: "text", text: "hello" }] },
    { info: {}, parts: [writePart(file)] },
  ]);
  const storage = mkStorage(client);
  const idx = new Indexer({
    client, config: mkConfig(),
    embeddings: { embed: async () => new Float32Array([0.1]), dim: 1, modelId: "m" },
    storage, state: mkState(),
    summarize: async () => ({ title: "t", summary: "s", decisions: [] }),
    projectKey: { hash: "k", source: "remote" }, confidentialPatterns: [],
    git: mkGit(),
    root,
    artifactGlobs: ["docs/**"],
    artifactConfidentialPatterns: ["secrets/**"],
  });
  await idx._run("s1");
  assert.equal(client.upserts.length, 1);
  assert.deepEqual(client.upserts[0][0].artifacts, ["docs/spec.md"]);
  idx.dispose();
});

test("re-summarize unions artifacts with existing (D6, Z1) and caps at 8 (Task 3)", async (t) => {
  const root = mkArtifactRoot(t);
  const files = Array.from({ length: 12 }, (_, i) => path.join(root, "docs", `f${i}.md`));
  for (const f of files) touchFile(f);
  let run = 0;
  const client = mkClient();
  client.session.messages = async () => {
    run++;
    const batch = run === 1 ? files.slice(0, 6) : files.slice(6);
    return { data: batch.map((f) => ({ info: {}, parts: [{ type: "text", text: "work" }, writePart(f)] })) };
  };
  const storage = mkStorage(client);
  const idx = new Indexer({
    client, config: mkConfig(),
    embeddings: { embed: async () => new Float32Array([0.1]), dim: 1, modelId: "m" },
    storage, state: mkState(),
    summarize: async () => ({ title: "t", summary: "s", decisions: [] }),
    projectKey: { hash: "k", source: "remote" }, confidentialPatterns: [],
    git: mkGit(),
    root,
    artifactGlobs: ["docs/**"],
    artifactConfidentialPatterns: ["secrets/**"],
  });
  await idx._run("s1");
  assert.deepEqual(
    client.upserts[0][0].artifacts,
    ["docs/f0.md", "docs/f1.md", "docs/f2.md", "docs/f3.md", "docs/f4.md", "docs/f5.md"],
    "first run extracts 6 artifacts",
  );
  await idx._run("s1");
  const second = client.upserts[1][0];
  assert.equal(second.version, 2, "re-summarize");
  assert.equal(second.artifacts.length, 8, "union capped at 8");
  assert.deepEqual(
    second.artifacts,
    ["docs/f6.md", "docs/f7.md", "docs/f8.md", "docs/f9.md", "docs/f10.md", "docs/f11.md", "docs/f0.md", "docs/f1.md"],
    "union = extracted + existing.artifacts, slice(0,8)",
  );
  idx.dispose();
});

test("invariants: tool parts NOT in summarize transcript; artifacts NOT in embed input (Task 3)", async (t) => {
  const root = mkArtifactRoot(t);
  const file = path.join(root, "docs", "spec.md");
  touchFile(file);
  let capturedTranscript = null;
  let capturedEmbed = null;
  const client = mkClient([
    { info: {}, parts: [{ type: "text", text: "hello world" }] },
    { info: {}, parts: [writePart(file)] },
  ]);
  const idx = new Indexer({
    client, config: mkConfig(),
    embeddings: {
      embed: async (s) => { capturedEmbed = s; return new Float32Array([0.1]); },
      dim: 1, modelId: "m",
    },
    storage: mkStorage(client), state: mkState(),
    summarize: async ({ transcript }) => { capturedTranscript = transcript; return { title: "t", summary: "s", decisions: [] }; },
    projectKey: { hash: "k", source: "remote" }, confidentialPatterns: [],
    git: mkGit(),
    root,
    artifactGlobs: ["docs/**"],
    artifactConfidentialPatterns: ["secrets/**"],
  });
  await idx._run("s1");
  assert.equal(client.upserts.length, 1);
  assert.deepEqual(client.upserts[0][0].artifacts, ["docs/spec.md"], "artifacts extracted");
  assert.ok(!capturedTranscript.includes("docs/spec.md"), "tool parts NOT in summarize transcript (text-only)");
  assert.ok(!capturedEmbed.includes("docs/spec.md"), "artifacts NOT in embed input");
  assert.ok(capturedEmbed.includes("t") && capturedEmbed.includes("s"), "embed = title+summary+decisions");
  idx.dispose();
});

test("artifactGlobs default [] → no extraction (off by default, Task 3)", async (t) => {
  const root = mkArtifactRoot(t);
  const file = path.join(root, "docs", "spec.md");
  touchFile(file);
  const client = mkClient([
    { info: {}, parts: [{ type: "text", text: "hello" }] },
    { info: {}, parts: [writePart(file)] },
  ]);
  const storage = mkStorage(client);
  const idx = new Indexer({
    client, config: mkConfig(),
    embeddings: { embed: async () => new Float32Array([0.1]), dim: 1, modelId: "m" },
    storage, state: mkState(),
    summarize: async () => ({ title: "t", summary: "s", decisions: [] }),
    projectKey: { hash: "k", source: "remote" }, confidentialPatterns: [],
    git: mkGit(),
    root,
  });
  await idx._run("s1");
  assert.deepEqual(client.upserts[0][0].artifacts, [], "no artifactGlobs → no extraction");
  idx.dispose();
});

test("union dedup is case-insensitive, extracted-first ordering (Task 3 deferred)", async (t) => {
  const root = mkArtifactRoot(t);
  const file = path.join(root, "docs", "Spec.md");
  touchFile(file);
  const client = mkClient();
  client.session.messages = async () => ({ data: [{ info: {}, parts: [{ type: "text", text: "work" }, writePart(file)] }] });
  // existing.artifacts carries the case-variant of the extracted path.
  const storage = mkStorage(client, async () => ({ artifacts: ["docs/spec.md"] }));
  const idx = new Indexer({
    client, config: mkConfig(),
    embeddings: { embed: async () => new Float32Array([0.1]), dim: 1, modelId: "m" },
    storage, state: mkState(),
    summarize: async () => ({ title: "t", summary: "s", decisions: [] }),
    projectKey: { hash: "k", source: "remote" }, confidentialPatterns: [],
    git: mkGit(),
    root,
    artifactGlobs: ["docs/**"],
    artifactConfidentialPatterns: ["secrets/**"],
  });
  await idx._run("s1");
  assert.deepEqual(
    client.upserts[0][0].artifacts,
    ["docs/Spec.md"],
    "extracted-first ordering; case-variant existing deduped (case-insensitive union)",
  );
  idx.dispose();
});

// ── 4.0.0: sessions-путь — резолв модели саммаризации из opencode-конфига ──

test("4.0.0 sessions: small_model из opencode-конфига → summarizerModel (mock summarize)", async () => {
  const client = {
    session: {
      get: async ({ path }) => ({ data: { id: path.id, parentID: null, title: "st", time: { created: 1, updated: 100 } } }),
      messages: async () => ({ data: [{ info: {}, parts: [{ type: "text", text: "hello" }] }] }),
      list: async () => ({ data: [] }),
    },
    config: { get: async () => ({ data: { small_model: "a/s" } }) },
  };
  const storage = {
    upserts: [],
    upsert: async (es) => { for (const e of es) storage.upserts.push(e); },
    get: async () => null, search: async () => [], delete: async () => {}, stats: async () => ({ entries: 0 }),
  };
  let captured = null;
  const durations = [];
  const idx = new Indexer({
    client, config: mkConfig(), embeddings: mkMockEmbeddings(), storage,
    state: mkState(),
    summarize: async (args) => { captured = args; return { title: "t", summary: "s", decisions: [] }; },
    projectKey: { hash: "khash", source: "remote" }, confidentialPatterns: [],
    git: mkGit(), root: "/tmp/root",
    logDebug: (ev, fields) => { if (ev === "memory:summarize.duration") durations.push(fields); },
    logWarn: () => {},
  });
  await idx._run("s1");
  assert.equal(captured.summarizerModel, "a/s", "resolved small_model передан в summarize");
  assert.equal(durations[0].model, "s", "effective modelID в duration");
  assert.equal(durations[0].model_source, "small_model");
  idx.dispose();
});

test("4.0.0 sessions: пустой резолв (нет client.config) → summarizerModel null + модель сессии в duration", async () => {
  // mkClient() без config — резолв → config_get_failed → fail-soft на модель сессии
  const client = mkClient();
  client.session.messages = async () => ({ data: [{ info: { role: "assistant", providerID: "prov", modelID: "sess-m" }, parts: [{ type: "text", text: "hello" }] }] });
  const storage = { upserts: [], upsert: async () => {}, get: async () => null, search: async () => [], delete: async () => {}, stats: async () => ({ entries: 0 }) };
  let captured = null;
  const durations = [];
  const warns = [];
  const idx = new Indexer({
    client, config: mkConfig(), embeddings: mkMockEmbeddings(), storage,
    state: mkState(),
    summarize: async (args) => { captured = args; return { title: "t", summary: "s", decisions: [] }; },
    projectKey: { hash: "khash", source: "remote" }, confidentialPatterns: [],
    git: mkGit(), root: "/tmp/root",
    logDebug: (ev, fields) => { if (ev === "memory:summarize.duration") durations.push(fields); },
    logWarn: (ev, fields) => warns.push([ev, fields]),
  });
  await idx._run("s1");
  assert.equal(captured.summarizerModel, null, "fallback: summarizerModel null → модель сессии внутри summarize.js");
  assert.equal(durations[0].model, "sess-m", "модель сессии в duration (текущее поведение)");
  assert.equal(durations[0].model_source, "session");
  assert.ok(warns.some(([ev, f]) => ev === "memory:summarizer_unavailable" && f.reason === "config_get_failed"), "warn с reason enum");
  idx.dispose();
});

test("4.0.0 sessions: invalid_model_ref → warn (симметрично, SF из Minor-1) + fail-soft", async () => {
  const client = {
    session: {
      get: async ({ path }) => ({ data: { id: path.id, parentID: null, title: "st", time: { created: 1, updated: 100 } } }),
      messages: async () => ({ data: [{ info: {}, parts: [{ type: "text", text: "hello" }] }] }),
      list: async () => ({ data: [] }),
    },
    config: { get: async () => ({ data: { model: "noslash" } }) },
  };
  const storage = { upserts: [], upsert: async () => {}, get: async () => null, search: async () => [], delete: async () => {}, stats: async () => ({ entries: 0 }) };
  let captured = null;
  const warns = [];
  const idx = new Indexer({
    client, config: mkConfig(), embeddings: mkMockEmbeddings(), storage,
    state: mkState(),
    summarize: async (args) => { captured = args; return { title: "t", summary: "s", decisions: [] }; },
    projectKey: { hash: "khash", source: "remote" }, confidentialPatterns: [],
    git: mkGit(), root: "/tmp/root",
    logWarn: (ev, fields) => warns.push([ev, fields]),
  });
  await idx._run("s1");
  assert.equal(captured.summarizerModel, null);
  assert.ok(warns.some(([ev, f]) => ev === "memory:summarizer_unavailable" && f.reason === "invalid_model_ref"));
  idx.dispose();
});

test("4.0.0 sessions: model (не small_model) → source: model", async () => {
  const client = {
    session: {
      get: async ({ path }) => ({ data: { id: path.id, parentID: null, title: "st", time: { created: 1, updated: 100 } } }),
      messages: async () => ({ data: [{ info: {}, parts: [{ type: "text", text: "hello" }] }] }),
      list: async () => ({ data: [] }),
    },
    config: { get: async () => ({ data: { model: "main/m1" } }) },
  };
  const storage = { upserts: [], upsert: async () => {}, get: async () => null, search: async () => [], delete: async () => {}, stats: async () => ({ entries: 0 }) };
  let captured = null;
  const durations = [];
  const idx = new Indexer({
    client, config: mkConfig(), embeddings: mkMockEmbeddings(), storage,
    state: mkState(),
    summarize: async (args) => { captured = args; return { title: "t", summary: "s", decisions: [] }; },
    projectKey: { hash: "khash", source: "remote" }, confidentialPatterns: [],
    git: mkGit(), root: "/tmp/root",
    logDebug: (ev, fields) => { if (ev === "memory:summarize.duration") durations.push(fields); },
  });
  await idx._run("s1");
  assert.equal(captured.summarizerModel, "main/m1");
  assert.equal(durations[0].model, "m1");
  assert.equal(durations[0].model_source, "model");
  idx.dispose();
});
