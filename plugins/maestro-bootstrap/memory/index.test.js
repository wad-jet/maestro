import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerMemoryHooks } from "./index.js";

const silentLog = { debug() {}, info() {}, warn() {}, error() {} };

function mkConfig(dir, extra = {}) {
  return {
    memory: {
      enabled: true,
      auto_recall: true,
      top_k: 3,
      min_score: 0.35,
      min_new_messages: 1,
      idle_debounce_min: 1,
      backfill_window_days: 30,
      backfill_max_per_start: 1,
      retry_interval_min: 60,
      storage: { type: "sqlite", centralized_confidential: "forbid" },
      module_dir: join(dir, "memory", "module"),
      embedding_model: "x",
      ...extra,
    },
  };
}

function mkClient() {
  return {
    session: {
      get: async () => ({ data: { id: "s", parentID: null } }),
      messages: async () => ({ data: [] }),
      list: async () => ({ data: [] }),
    },
  };
}

// ── memory off ─────────────────────────────────────────────────────────

test("memory off (no config) → no hooks", async () => {
  const hooks = await registerMemoryHooks({ client: {}, config: {}, log: silentLog });
  assert.equal(hooks.tool, undefined);
  assert.equal(hooks["chat.message"], undefined);
  assert.equal(hooks["experimental.chat.system.transform"], undefined);
  assert.equal(hooks.event, undefined);
  assert.equal(hooks["experimental.chat.messages.transform"], undefined);
});

test("memory off (explicit enabled false) → no hooks", async () => {
  const hooks = await registerMemoryHooks({ client: {}, config: { memory: { enabled: false } }, log: silentLog });
  assert.equal(hooks.tool, undefined);
  assert.equal(hooks.event, undefined);
});

// ── memory enabled ─────────────────────────────────────────────────────

test("memory enabled → tool.memory_search + hooks present", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mem-hooks-"));
  try {
    const hooks = await registerMemoryHooks({ client: mkClient(), config: mkConfig(dir), log: silentLog, root: dir });
    assert.ok(hooks.tool && hooks.tool.memory_search, "tool.memory_search must exist");
    assert.equal(typeof hooks.tool.memory_search.execute, "function");
    assert.equal(typeof hooks["chat.message"], "function");
    assert.equal(typeof hooks["experimental.chat.system.transform"], "function");
    assert.equal(typeof hooks.event, "function");
    assert.equal(typeof hooks.dispose, "function");
    await hooks.dispose?.();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("messages.transform stays undefined", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mem-hooks-"));
  try {
    const hooks = await registerMemoryHooks({ client: mkClient(), config: mkConfig(dir), log: silentLog, root: dir });
    assert.equal(hooks["experimental.chat.messages.transform"], undefined);
    await hooks.dispose?.();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── event dispatch ─────────────────────────────────────────────────────

test("event dispatches session.deleted to storage.delete", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mem-hooks-"));
  try {
    const hooks = await registerMemoryHooks({ client: mkClient(), config: mkConfig(dir), log: silentLog, root: dir });
    const dbPath = join(dir, "memory", "memory.db");
    const { default: Database } = await import("better-sqlite3");
    const db = new Database(dbPath);
    db.prepare(
      `INSERT INTO memory (session_id, key, origin_project_hash, title, summary, decisions, embedding, model_id, author, time_first, time_last, version)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run("victim", "k", "h", "t", "s", "[]", Buffer.from(new Float32Array([0.1, 0.2, 0.3]).buffer), "x", "a", 1, 2, 0);
    db.close();

    await hooks.event({ event: { type: "session.idle", properties: { sessionID: "victim" } } });
    await hooks.event({ event: { type: "session.deleted", properties: { sessionID: "victim" } } });

    const db2 = new Database(dbPath);
    const row = db2.prepare("SELECT * FROM memory WHERE session_id = ?").get("victim");
    db2.close();
    assert.equal(row, undefined, "session.deleted must remove the memory entry");
    await hooks.dispose?.();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("event ignores unknown event types", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mem-hooks-"));
  try {
    const hooks = await registerMemoryHooks({ client: mkClient(), config: mkConfig(dir), log: silentLog, root: dir });
    await hooks.event({ event: { type: "session.error", properties: { sessionID: "x" } } });
    await hooks.event({ event: { type: "session.status", properties: { sessionID: "x" } } });
    await hooks.dispose?.();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── I-3: disabled_reason logging ───────────────────────────────────────

test("invalid storage type → disabled with reason logged", async () => {
  const logged = [];
  const log = { debug() {}, info: (m, e) => logged.push([m, e]), warn() {}, error() {} };
  const hooks = await registerMemoryHooks({
    client: {},
    config: { memory: { enabled: true, storage: { type: "bogus" } } },
    log,
  });
  assert.equal(hooks.tool, undefined);
  assert.ok(
    logged.some(([m, e]) => m === "memory: disabled" && e.reason === "storage_type_invalid"),
    "must log memory: disabled with storage_type_invalid",
  );
});

test("no memory section → no disabled log", async () => {
  const logged = [];
  const log = { debug() {}, info: (m, e) => logged.push([m, e]), warn() {}, error() {} };
  await registerMemoryHooks({ client: {}, config: {}, log });
  assert.ok(!logged.some(([m]) => m === "memory: disabled"), "no section must not log disabled");
});

// ── M-5: centralized backend config validation ─────────────────────────

test("qdrant without url/api_key_env → memory off", async () => {
  const logged = [];
  const log = { debug() {}, info: (m, e) => logged.push([m, e]), warn() {}, error() {} };
  const hooks = await registerMemoryHooks({
    client: {},
    config: { memory: { enabled: true, storage: { type: "qdrant", qdrant: {} }, identity: "x" } },
    log,
  });
  assert.equal(hooks.tool, undefined);
  assert.ok(logged.some(([m, e]) => m === "memory: disabled" && e.reason === "qdrant_config_invalid"));
});

test("pgvector without connection_string_env → memory off", async () => {
  const logged = [];
  const log = { debug() {}, info: (m, e) => logged.push([m, e]), warn() {}, error() {} };
  const hooks = await registerMemoryHooks({
    client: {},
    config: { memory: { enabled: true, storage: { type: "pgvector", pgvector: {} }, identity: "x" } },
    log,
  });
  assert.equal(hooks.tool, undefined);
  assert.ok(logged.some(([m, e]) => m === "memory: disabled" && e.reason === "pgvector_config_invalid"));
});