import { test } from "node:test";
import assert from "node:assert/strict";
import { Indexer } from "./indexer.js";

function mkClient() {
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
        data: [
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

test("indexer summarizes and upserts on _run, masking secrets", async () => {
  const client = mkClient();
  const storage = mkStorage(client);
  const embeddings = { embed: async () => new Float32Array([0.1, 0.2, 0.3]), dim: 3, modelId: "m" };
  const config = mkConfig();
  const state = mkState();
  const summarize = async ({ transcript }) => ({ title: "t", summary: "s", decisions: [] });
  const idx = new Indexer({
    client,
    config,
    embeddings,
    storage,
    state,
    summarize,
    projectKey: { hash: "khash", source: "remote" },
    confidentialPatterns: [],
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
  const embeddings = { embed: async () => new Float32Array([0.1, 0.2, 0.3]), dim: 3, modelId: "m" };
  const config = mkConfig();
  const state = mkState();
  const summarize = async () => ({ title: "t", summary: "s", decisions: [] });
  const idx = new Indexer({
    client,
    config,
    embeddings,
    storage,
    state,
    summarize,
    projectKey: { hash: "khash", source: "remote" },
    confidentialPatterns: [],
  });
  await idx._run("s1");
  assert.equal(client.upserts.length, 0);
  idx.dispose();
});

test("indexer deletes on session deleted", async () => {
  const client = mkClient();
  let deletedId = null;
  const storage = {
    upsert: async () => {},
    search: async () => [],
    delete: async (sid) => { deletedId = sid; },
    stats: async () => ({ entries: 0 }),
  };
  const config = mkConfig();
  const embeddings = { embed: async () => new Float32Array([0.1]), dim: 1, modelId: "m" };
  const state = mkState();
  const summarize = async () => ({});
  const idx = new Indexer({
    client,
    config,
    embeddings,
    storage,
    state,
    summarize,
    projectKey: { hash: "k", source: "remote" },
    confidentialPatterns: [],
  });
  await idx.onSessionDeleted({ sessionID: "s1" });
  assert.equal(deletedId, "s1");
  idx.dispose();
});

test("indexer _run calls recordFail on error", async () => {
  const client = mkClient();
  let failCalled = false;
  let failSessionId = null;
  client.session.get = async () => { throw new Error("network"); };
  const storage = mkStorage(client);
  const embeddings = { embed: async () => new Float32Array([0.1]), dim: 1, modelId: "m" };
  const config = mkConfig();
  const state = {
    ...mkState(),
    recordFail: async (sid) => { failCalled = true; failSessionId = sid; },
  };
  const summarize = async () => ({});
  const idx = new Indexer({
    client,
    config,
    embeddings,
    storage,
    state,
    summarize,
    projectKey: { hash: "khash", source: "remote" },
    confidentialPatterns: [],
  });
  await idx._run("s1");
  assert.ok(failCalled);
  assert.equal(failSessionId, "s1");
  idx.dispose();
});

test("indexer records summarized state after success", async () => {
  const client = mkClient();
  let summarizedId = null;
  const storage = mkStorage(client);
  const embeddings = { embed: async () => new Float32Array([0.1]), dim: 1, modelId: "m" };
  const config = mkConfig();
  const state = {
    ...mkState(),
    setSummarized: async (sid) => { summarizedId = sid; },
  };
  const summarize = async () => ({ title: "t", summary: "s", decisions: [] });
  const idx = new Indexer({
    client,
    config,
    embeddings,
    storage,
    state,
    summarize,
    projectKey: { hash: "khash", source: "remote" },
    confidentialPatterns: [],
  });
  await idx._run("s1");
  assert.equal(summarizedId, "s1");
  idx.dispose();
});

test("indexer onSessionIdle schedules debounce timer", async () => {
  const client = mkClient();
  const storage = mkStorage(client);
  const embeddings = { embed: async () => new Float32Array([0.1]), dim: 1, modelId: "m" };
  const config = mkConfig();
  const state = mkState();
  const summarize = async () => ({ title: "t", summary: "s", decisions: [] });
  const idx = new Indexer({
    client,
    config,
    embeddings,
    storage,
    state,
    summarize,
    projectKey: { hash: "khash", source: "remote" },
    confidentialPatterns: [],
  });
  await idx.onSessionIdle({ sessionID: "s1" });
  // After dispose, all timers should be cleared
  idx.dispose();
});

test("indexer onStartup backfills eligible sessions", async () => {
  const now = Date.now();
  const client = {
    upserts: [],
    session: {
      get: async ({ path }) => ({
        data: { id: path.id, parentID: null, title: "st", time: { created: 1, updated: now - 1000 } },
      }),
      messages: async () => ({
        data: [{ info: {}, parts: [{ type: "text", text: "hi" }] }],
      }),
      list: async () => ({
        data: [
          { id: "recent", parentID: null, time: { created: 1, updated: now - 1000 } },
          { id: "old", parentID: null, time: { created: 1, updated: now - 40 * 86400_000 } },
          { id: "subagent", parentID: "p1", time: { created: 1, updated: now - 1000 } },
        ],
      }),
    },
  };
  const storage = mkStorage(client);
  const embeddings = { embed: async () => new Float32Array([0.1]), dim: 1, modelId: "m" };
  const config = mkConfig({ idle_debounce_min: 0.001 }); // ~1ms debounce for test
  const state = {
    ...mkState(),
    isSkipped: async () => false,
  };
  const summarize = async () => ({ title: "t", summary: "s", decisions: [] });
  const idx = new Indexer({
    client,
    config,
    embeddings,
    storage,
    state,
    summarize,
    projectKey: { hash: "khash", source: "remote" },
    confidentialPatterns: [],
  });
  await idx.onStartup();
  // After 100ms, debounce should fire for the recent session only
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(client.upserts.length, 1);
  assert.equal(client.upserts[0][0].session_id, "recent");
  idx.dispose();
});

test("indexer skips sessions marked in state", async () => {
  const client = mkClient();
  const storage = mkStorage(client);
  const embeddings = { embed: async () => new Float32Array([0.1]), dim: 1, modelId: "m" };
  const config = mkConfig();
  const state = {
    ...mkState(),
    isSkipped: async (sid) => sid === "s1",
  };
  const summarize = async () => ({ title: "t", summary: "s", decisions: [] });
  const idx = new Indexer({
    client,
    config,
    embeddings,
    storage,
    state,
    summarize,
    projectKey: { hash: "khash", source: "remote" },
    confidentialPatterns: [],
  });
  await idx._run("s1");
  assert.equal(client.upserts.length, 0);
  idx.dispose();
});

test("indexer uses namespace in key when provided", async () => {
  const client = mkClient();
  const storage = mkStorage(client);
  const embeddings = { embed: async () => new Float32Array([0.1]), dim: 1, modelId: "m" };
  const config = mkConfig({ namespace: "ns1" });
  const state = mkState();
  const summarize = async () => ({ title: "t", summary: "s", decisions: [] });
  const idx = new Indexer({
    client,
    config,
    embeddings,
    storage,
    state,
    summarize,
    projectKey: { hash: "khash", source: "remote" },
    confidentialPatterns: [],
  });
  await idx._run("s1");
  assert.equal(client.upserts[0][0].key, "ns1");
  idx.dispose();
});

test("indexer builds correct upsert record fields", async () => {
  const client = mkClient();
  const storage = mkStorage(client);
  const embeddings = { embed: async () => new Float32Array([0.1, 0.2]), dim: 2, modelId: "xgb" };
  const config = mkConfig({ namespace: "ns" });
  const state = mkState();
  const summarize = async () => ({ title: "t", summary: "s", decisions: [] });
  const idx = new Indexer({
    client,
    config,
    embeddings,
    storage,
    state,
    summarize,
    projectKey: { hash: "phash", source: "remote" },
    confidentialPatterns: [],
  });
  await idx._run("sid");
  const e = client.upserts[0][0];
  assert.equal(e.session_id, "sid");
  assert.equal(e.key, "ns");
  assert.equal(e.origin_project_hash, "phash");
  assert.equal(e.title, "t");
  assert.equal(e.model_id, "xgb");
  assert.equal(e.author, "test");
  assert.equal(e.time_first, 1);
  assert.equal(e.time_last, 100);
  assert.equal(e.version, 1);
  assert.ok(e.decisions instanceof Array);
  assert.ok(e.embedding instanceof Float32Array);
  idx.dispose();
});

// G1 — min_new_messages check
test("indexer skips _run when messages < min_new_messages (G1)", async () => {
  const client = mkClient();
  const storage = mkStorage(client);
  const embeddings = { embed: async () => new Float32Array([0.1]), dim: 1, modelId: "m" };
  const config = mkConfig({ min_new_messages: 3 }); // require 3 new messages
  let callCount = 0;
  const state = {
    ...mkState(),
    getLastSummarized: async () => 99, // last summarized at ts=99
  };
  const summarize = async () => { callCount++; return { title: "t", summary: "s", decisions: [] }; };
  const idx = new Indexer({
    client, config, embeddings, storage, state, summarize,
    projectKey: { hash: "khash", source: "remote" }, confidentialPatterns: [],
  });
  // Only 1 message with time_created > 99 → skip (need 3)
  client.session.messages = async () => ({ data: [{ info: { time: { created: 100 } }, parts: [{ type: "text", text: "hi" }] }] });
  await idx._run("s1");
  assert.equal(callCount, 0); // summarize never called
  assert.equal(client.upserts.length, 0);
  idx.dispose();
});

test("indexer proceeds when messages >= min_new_messages (G1)", async () => {
  const client = mkClient();
  const storage = mkStorage(client);
  const embeddings = { embed: async () => new Float32Array([0.1]), dim: 1, modelId: "m" };
  const config = mkConfig({ min_new_messages: 2 }); // require 2 new messages
  let callCount = 0;
  const state = {
    ...mkState(),
    getLastSummarized: async () => 99,
  };
  const summarize = async () => { callCount++; return { title: "t", summary: "s", decisions: [] }; };
  const idx = new Indexer({
    client, config, embeddings, storage, state, summarize,
    projectKey: { hash: "khash", source: "remote" }, confidentialPatterns: [],
  });
  // 3 messages with time_created > 99 → proceed
  client.session.messages = async () => ({
    data: [
      { info: { time: { created: 100 } }, parts: [{ type: "text", text: "a" }] },
      { info: { time: { created: 101 } }, parts: [{ type: "text", text: "b" }] },
      { info: { time: { created: 102 } }, parts: [{ type: "text", text: "c" }] },
    ],
  });
  await idx._run("s1");
  assert.equal(callCount, 1); // summarize called
  assert.equal(client.upserts.length, 1);
  idx.dispose();
});

test("indexer first summary proceeds with no lastSummarized (G1)", async () => {
  const client = mkClient();
  const storage = mkStorage(client);
  const embeddings = { embed: async () => new Float32Array([0.1]), dim: 1, modelId: "m" };
  const config = mkConfig({ min_new_messages: 3 });
  let callCount = 0;
  const state = mkState(); // getLastSummarized → null by default
  const summarize = async () => { callCount++; return { title: "t", summary: "s", decisions: [] }; };
  const idx = new Indexer({
    client, config, embeddings, storage, state, summarize,
    projectKey: { hash: "khash", source: "remote" }, confidentialPatterns: [],
  });
  await idx._run("s1");
  assert.equal(callCount, 1); // first time → proceed regardless of count
  assert.equal(client.upserts.length, 1);
  idx.dispose();
});

// G2 — re-mask entry before write
test("indexer re-masks entry title/summary/decisions before upsert (G2)", async () => {
  const client = mkClient();
  const storage = mkStorage(client);
  const embeddings = { embed: async () => new Float32Array([0.1]), dim: 1, modelId: "m" };
  const config = mkConfig();
  const state = mkState();
  // Summarize returns a title containing a secret — maskEntry should catch it
  const summarize = async () => ({ title: "API_KEY=leaked_secret", summary: "detail with TOKEN=abc", decisions: ["x"] });
  const idx = new Indexer({
    client, config, embeddings, storage, state, summarize,
    projectKey: { hash: "khash", source: "remote" }, confidentialPatterns: [],
  });
  await idx._run("s1");
  assert.equal(client.upserts.length, 1);
  const e = client.upserts[0][0];
  assert.ok(!e.title.includes("leaked_secret"));
  assert.ok(!e.summary.includes("abc"));
  idx.dispose();
});

// G3 — concurrency serialization
test("indexer serializes concurrent _run calls (G3)", async () => {
  const client = mkClient();
  const storage = mkStorage(client);
  const embeddings = { embed: async () => new Float32Array([0.1]), dim: 1, modelId: "m" };
  const config = mkConfig();
  const state = mkState();
  let summarizeOrder = [];
  let blockerResolve = null;
  const blocker = new Promise((r) => { blockerResolve = r; });

  const summarize = async ({ sessionID }) => {
    summarizeOrder.push(sessionID);
    if (sessionID === "s1") {
      await blocker;
    }
    return { title: "t", summary: "s", decisions: [] };
  };

  const idx = new Indexer({
    client, config, embeddings, storage, state, summarize,
    projectKey: { hash: "khash", source: "remote" }, confidentialPatterns: [],
  });

  // p1 starts _run("s1"), hits summarize("s1"), awaits blocker, holds running=true
  const p1 = idx._run("s1");

  // p2 immediately sees running=true and queues
  const p2 = idx._run("s2");

  // p2 returns immediately (queued, not running). Give event loop a tick.
  await new Promise((r) => setImmediate(r));

  // Verify p2 is queued
  assert.equal(idx.queue.length, 1, "p2 is queued behind p1");
  assert.equal(idx.running, true, "p1 holds the lock");

  // Release p1 — it completes, releases lock, processes queue → s2 runs
  blockerResolve();
  await p1;

  // p1 completed. The finally block called this._run(this.queue.shift())
  // which runs s2. But p2 is already resolved (it just returned from _run).
  // The recursive _run(s2) call happens inside p1's finally, so after await p1,
  // s2 should have been summarized.
  // However, the recursive _run call returns a promise we're not awaiting.
  // Let's yield to let it complete.
  await new Promise((r) => setImmediate(r));

  assert.equal(summarizeOrder.length, 2, "both sessions summarized");
  assert.equal(summarizeOrder[0], "s1", "s1 first");
  assert.equal(summarizeOrder[1], "s2", "s2 second from queue");
  idx.dispose();
});

// G5 — version increment
test("indexer increments version on re-summarize (G5)", async () => {
  const client = mkClient();
  const storage = mkStorage(client);
  const embeddings = { embed: async () => new Float32Array([0.1]), dim: 1, modelId: "m" };
  const config = mkConfig();
  const state = mkState();
  const summarize = async () => ({ title: "t", summary: "s", decisions: [] });
  const idx = new Indexer({
    client, config, embeddings, storage, state, summarize,
    projectKey: { hash: "khash", source: "remote" }, confidentialPatterns: [],
  });
  // First run → version 1
  await idx._run("s1");
  assert.equal(client.upserts[0][0].version, 1);
  // Second run → version 2
  await idx._run("s1");
  assert.equal(client.upserts[1][0].version, 2);
  idx.dispose();
});
