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

function mkStorage(client) {
  return {
    upsert: async (es) => { if (client) client.upserts.push(es); },
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
