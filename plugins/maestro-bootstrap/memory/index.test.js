import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerMemoryHooks } from "./index.js";
import { sanitizeDirName } from "./config.js";
import { projectHashFromDir, projectHashFromRemote } from "./project.js";
import { SESSIONS } from "./summarize.js";

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

function mkClient(overrides = {}) {
  return {
    session: {
      get: async () => ({ data: { id: "s", parentID: null } }),
      messages: async () => ({ data: [] }),
      list: async () => ({ data: [] }),
      ...overrides,
    },
  };
}

function mkMockStorage() {
  return {
    searches: 0,
    prunes: [],
    search: async function () { this.searches++; return []; },
    prune: async function (args) { this.prunes.push(args); return 0; },
    delete: async () => {},
    dispose: async () => {},
    init: async () => {},
    upsert: async () => {},
    get: async () => null,
    stats: async () => ({ entries: 0 }),
  };
}

function mkMockEmbeddings() {
  return { embed: async () => new Float32Array([0.1, 0.2, 0.3]), dim: 3, modelId: "m" };
}

// Per-key sqlite path (I8): <XDG_DATA_HOME>/maestro/memory/<key-hash>/memory.db
function dbPathFor(dataHome, root) {
  return join(dataHome, "maestro", "memory", sanitizeDirName(projectHashFromDir(root)), "memory.db");
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
  const saved = process.env.XDG_DATA_HOME;
  process.env.XDG_DATA_HOME = dir;
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
    if (saved === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = saved;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("messages.transform stays undefined", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mem-hooks-"));
  const saved = process.env.XDG_DATA_HOME;
  process.env.XDG_DATA_HOME = dir;
  try {
    const hooks = await registerMemoryHooks({ client: mkClient(), config: mkConfig(dir), log: silentLog, root: dir });
    assert.equal(hooks["experimental.chat.messages.transform"], undefined);
    await hooks.dispose?.();
  } finally {
    if (saved === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = saved;
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── self-provisioning ──────────────────────────────────────────────────

test("self-provisioning creates module_dir with package.json", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mem-hooks-"));
  const saved = process.env.XDG_DATA_HOME;
  process.env.XDG_DATA_HOME = dir;
  try {
    const hooks = await registerMemoryHooks({ client: mkClient(), config: mkConfig(dir), log: silentLog, root: dir });
    const moduleDir = join(dir, "memory", "module");
    assert.ok(existsSync(join(moduleDir, "package.json")), "module_dir package.json must be created");
    const pkg = JSON.parse(readFileSync(join(moduleDir, "package.json"), "utf8"));
    assert.equal(pkg.name, "maestro-memory");
    assert.equal(pkg.type, "module");
    assert.match(pkg.version, /^\d+\.\d+\.\d+$/);
    await hooks.dispose?.();
  } finally {
    if (saved === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = saved;
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── I8: per-key sqlite layout ──────────────────────────────────────────

test("I8: sqlite db stored per-key under dataDir", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mem-hooks-"));
  const saved = process.env.XDG_DATA_HOME;
  process.env.XDG_DATA_HOME = dir;
  try {
    const hooks = await registerMemoryHooks({ client: mkClient(), config: mkConfig(dir), log: silentLog, root: dir });
    const dbPath = dbPathFor(dir, dir);
    const { default: Database } = await import("better-sqlite3");
    const db = new Database(dbPath);
    const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='memory'").get();
    db.close();
    assert.ok(row, "per-key memory.db must exist with memory table");
    await hooks.dispose?.();
  } finally {
    if (saved === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = saved;
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── event dispatch ─────────────────────────────────────────────────────

test("event dispatches session.deleted to storage.delete", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mem-hooks-"));
  const saved = process.env.XDG_DATA_HOME;
  process.env.XDG_DATA_HOME = dir;
  try {
    const hooks = await registerMemoryHooks({ client: mkClient(), config: mkConfig(dir), log: silentLog, root: dir });
    const dbPath = dbPathFor(dir, dir);
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
    if (saved === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = saved;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("event ignores unknown event types", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mem-hooks-"));
  const saved = process.env.XDG_DATA_HOME;
  process.env.XDG_DATA_HOME = dir;
  try {
    const hooks = await registerMemoryHooks({ client: mkClient(), config: mkConfig(dir), log: silentLog, root: dir });
    await hooks.event({ event: { type: "session.error", properties: { sessionID: "x" } } });
    await hooks.event({ event: { type: "session.status", properties: { sessionID: "x" } } });
    await hooks.dispose?.();
  } finally {
    if (saved === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = saved;
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── I1: chat.message signature + first-message counter ─────────────────

test("I1: chat.message reads from output and triggers recall only on first message", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mem-hooks-"));
  const saved = process.env.XDG_DATA_HOME;
  process.env.XDG_DATA_HOME = dir;
  try {
    const storage = mkMockStorage();
    const hooks = await registerMemoryHooks({
      client: mkClient(),
      config: mkConfig(dir),
      log: silentLog,
      root: dir,
      deps: { storage, embeddings: mkMockEmbeddings() },
    });
    // first user message → recall search runs
    await hooks["chat.message"]({ sessionID: "s1" }, { message: { parts: [{ type: "text", text: "hello" }] } });
    assert.equal(storage.searches, 1, "first message must trigger recall search");
    // second user message → counter=2 → recall skips
    await hooks["chat.message"]({ sessionID: "s1" }, { message: { parts: [{ type: "text", text: "second" }] } });
    assert.equal(storage.searches, 1, "second message must NOT trigger recall search (counter)");
    await hooks.dispose?.();
  } finally {
    if (saved === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = saved;
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── I2: top-level primary + [maestro-memory] exclusion ─────────────────

test("I2: chat.message skips subagent sessions", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mem-hooks-"));
  const saved = process.env.XDG_DATA_HOME;
  process.env.XDG_DATA_HOME = dir;
  try {
    const storage = mkMockStorage();
    const client = mkClient({ get: async () => ({ data: { id: "sub", parentID: "root" } }) });
    const hooks = await registerMemoryHooks({
      client,
      config: mkConfig(dir),
      log: silentLog,
      root: dir,
      deps: { storage, embeddings: mkMockEmbeddings() },
    });
    await hooks["chat.message"]({ sessionID: "sub" }, { message: { parts: [{ type: "text", text: "hello" }] } });
    assert.equal(storage.searches, 0, "subagent session must be excluded from recall");
    await hooks.dispose?.();
  } finally {
    if (saved === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = saved;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("I2: chat.message skips [maestro-memory] sessions", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mem-hooks-"));
  const saved = process.env.XDG_DATA_HOME;
  process.env.XDG_DATA_HOME = dir;
  try {
    const storage = mkMockStorage();
    const hooks = await registerMemoryHooks({
      client: mkClient(),
      config: mkConfig(dir),
      log: silentLog,
      root: dir,
      deps: { storage, embeddings: mkMockEmbeddings() },
    });
    SESSIONS.add("summ-session");
    try {
      await hooks["chat.message"]({ sessionID: "summ-session" }, { message: { parts: [{ type: "text", text: "hello" }] } });
      assert.equal(storage.searches, 0, "[maestro-memory] session must be excluded from recall");
    } finally {
      SESSIONS.delete("summ-session");
    }
    await hooks.dispose?.();
  } finally {
    if (saved === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = saved;
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── I3: memory_search excludes [maestro-memory] sessions ───────────────

test("I3: memory_search unavailable for [maestro-memory] sessions", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mem-hooks-"));
  const saved = process.env.XDG_DATA_HOME;
  process.env.XDG_DATA_HOME = dir;
  try {
    const hooks = await registerMemoryHooks({
      client: mkClient(),
      config: mkConfig(dir),
      log: silentLog,
      root: dir,
      deps: { storage: mkMockStorage(), embeddings: mkMockEmbeddings() },
    });
    SESSIONS.add("summ-session");
    try {
      const res = await hooks.tool.memory_search.execute({ query: "x" }, { sessionID: "summ-session" });
      assert.equal(res, "Инструмент недоступен для служебных сессий.");
    } finally {
      SESSIONS.delete("summ-session");
    }
    await hooks.dispose?.();
  } finally {
    if (saved === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = saved;
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── M2: auto_recall off ────────────────────────────────────────────────

test("M2: auto_recall false → no chat.message/system.transform hooks", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mem-hooks-"));
  const saved = process.env.XDG_DATA_HOME;
  process.env.XDG_DATA_HOME = dir;
  try {
    const hooks = await registerMemoryHooks({
      client: mkClient(),
      config: mkConfig(dir, { auto_recall: false }),
      log: silentLog,
      root: dir,
    });
    assert.ok(hooks.tool && hooks.tool.memory_search, "tool still present");
    assert.equal(hooks["chat.message"], undefined);
    assert.equal(hooks["experimental.chat.system.transform"], undefined);
    await hooks.dispose?.();
  } finally {
    if (saved === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = saved;
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── I5: centralized forbid + confidential → sqlite fallback ────────────

test("I5: centralized forbid + confidential paths → fallback to sqlite", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mem-hooks-"));
  const saved = process.env.XDG_DATA_HOME;
  process.env.XDG_DATA_HOME = dir;
  try {
    const logged = [];
    const log = { debug() {}, info() {}, warn: (m, e) => logged.push([m, e]), error() {} };
    const config = mkConfig(dir, {
      storage: {
        type: "qdrant",
        qdrant: { url: "http://localhost:6333", api_key_env: "Q_KEY" },
        centralized_confidential: "forbid",
      },
      identity: "x",
    });
    config.confidential = { paths: ["docs/confidential/**"] };
    const hooks = await registerMemoryHooks({ client: mkClient(), config, log, root: dir });
    assert.ok(hooks.tool && hooks.tool.memory_search, "must work via sqlite fallback");
    assert.ok(
      logged.some(([m]) => m === "memory: centralized backend forbidden for confidential project — fallback to sqlite"),
      "must log the fallback warning",
    );
    await hooks.dispose?.();
  } finally {
    if (saved === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = saved;
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── I6: onStartup called ───────────────────────────────────────────────

test("I6: onStartup is called (session.list invoked)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mem-hooks-"));
  const saved = process.env.XDG_DATA_HOME;
  process.env.XDG_DATA_HOME = dir;
  try {
    let listed = 0;
    const client = mkClient({ list: async () => { listed++; return { data: [] }; } });
    const hooks = await registerMemoryHooks({ client, config: mkConfig(dir), log: silentLog, root: dir });
    await new Promise((r) => setTimeout(r, 20));
    assert.ok(listed >= 1, "onStartup must call session.list");
    await hooks.dispose?.();
  } finally {
    if (saved === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = saved;
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

// ── memory_search filters (Task 4) ─────────────────────────────────────

test("memory_search passes filters and project", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mem-hooks-"));
  const saved = process.env.XDG_DATA_HOME;
  process.env.XDG_DATA_HOME = dir;
  try {
    const storage = mkMockStorage();
    const seen = [];
    storage.search = async function (vec, opts) { this.searches++; seen.push(opts); return []; };
    const hooks = await registerMemoryHooks({
      client: mkClient(),
      config: mkConfig(dir),
      log: silentLog,
      root: dir,
      deps: { storage, embeddings: mkMockEmbeddings() },
    });
    const res = await hooks.tool.memory_search.execute(
      { query: "x", date_from: 100, date_to: 500, author: "alice", project: "https://github.com/foo/bar.git" },
      { sessionID: "s1" },
    );
    assert.equal(seen.length, 1, "storage.search must be called once");
    assert.equal(seen[0].date_from, 100);
    assert.equal(seen[0].date_to, 500);
    assert.equal(seen[0].author, "alice");
    assert.equal(
      seen[0].project,
      projectHashFromRemote("https://github.com/foo/bar.git"),
      "URL project must be canonicalized+hashed before search",
    );
    assert.equal(typeof seen[0].key, "string");
    await hooks.dispose?.();
  } finally {
    if (saved === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = saved;
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── memory_forget (Task 6) ─────────────────────────────────────────────

test("memory_forget deletes by author and returns count", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mem-hooks-"));
  const saved = process.env.XDG_DATA_HOME;
  process.env.XDG_DATA_HOME = dir;
  try {
    const storage = mkMockStorage();
    storage.deleteByFilter = async () => 3;
    const hooks = await registerMemoryHooks({
      client: mkClient(),
      config: mkConfig(dir),
      log: silentLog,
      root: dir,
      deps: { storage, embeddings: mkMockEmbeddings() },
    });
    const res = await hooks.tool.memory_forget.execute({ author: "alice" }, { sessionID: "s1" });
    assert.match(res, /Удалено 3 записей/, "must report deleted count");
    await hooks.dispose?.();
  } finally {
    if (saved === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = saved;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("memory_forget empty filter errors", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mem-hooks-"));
  const saved = process.env.XDG_DATA_HOME;
  process.env.XDG_DATA_HOME = dir;
  try {
    const storage = mkMockStorage();
    storage.deleteByFilter = async () => 0;
    const hooks = await registerMemoryHooks({
      client: mkClient(),
      config: mkConfig(dir),
      log: silentLog,
      root: dir,
      deps: { storage, embeddings: mkMockEmbeddings() },
    });
    const res = await hooks.tool.memory_forget.execute({}, { sessionID: "s1" });
    assert.match(res, /укажите session_id, author или before/);
    await hooks.dispose?.();
  } finally {
    if (saved === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = saved;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("memory_forget blocked for [maestro-memory] sessions", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mem-hooks-"));
  const saved = process.env.XDG_DATA_HOME;
  process.env.XDG_DATA_HOME = dir;
  try {
    const storage = mkMockStorage();
    storage.deleteByFilter = async () => 0;
    const hooks = await registerMemoryHooks({
      client: mkClient(),
      config: mkConfig(dir),
      log: silentLog,
      root: dir,
      deps: { storage, embeddings: mkMockEmbeddings() },
    });
    SESSIONS.add("summ-session");
    try {
      const res = await hooks.tool.memory_forget.execute({ author: "alice" }, { sessionID: "summ-session" });
      assert.match(res, /недоступен для служебных сессий/);
    } finally {
      SESSIONS.delete("summ-session");
    }
    await hooks.dispose?.();
  } finally {
    if (saved === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = saved;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("memory_forget passes key and filters to deleteByFilter", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mem-hooks-"));
  const saved = process.env.XDG_DATA_HOME;
  process.env.XDG_DATA_HOME = dir;
  try {
    const storage = mkMockStorage();
    const seen = [];
    storage.deleteByFilter = async function (args) { seen.push(args); return 2; };
    const hooks = await registerMemoryHooks({
      client: mkClient(),
      config: mkConfig(dir),
      log: silentLog,
      root: dir,
      deps: { storage, embeddings: mkMockEmbeddings() },
    });
    await hooks.tool.memory_forget.execute(
      { session_id: "s9", author: "alice", before: 123 },
      { sessionID: "s1" },
    );
    assert.equal(seen.length, 1, "deleteByFilter must be called once");
    assert.equal(seen[0].author, "alice");
    assert.equal(seen[0].session_id, "s9");
    assert.equal(seen[0].before, 123);
    assert.equal(typeof seen[0].key, "string");
    assert.ok(seen[0].key.length > 0, "deleteByFilter must be called with the effective key");
    await hooks.dispose?.();
  } finally {
    if (saved === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = saved;
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── retention (Task 2) ─────────────────────────────────────────────────

test("retention_days set → storage.prune called with effective key + logged", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mem-hooks-"));
  const saved = process.env.XDG_DATA_HOME;
  process.env.XDG_DATA_HOME = dir;
  try {
    const storage = mkMockStorage();
    storage.prune = async function (args) { this.prunes.push(args); return 5; };
    const logged = [];
    const log = { debug() {}, info: (m, e) => logged.push([m, e]), warn() {}, error() {} };
    const hooks = await registerMemoryHooks({
      client: mkClient(),
      config: mkConfig(dir, { retention_days: 30 }),
      log,
      root: dir,
      deps: { storage, embeddings: mkMockEmbeddings() },
    });
    assert.equal(storage.prunes.length, 1, "prune must be called once on startup");
    assert.equal(storage.prunes[0].olderThanDays, 30);
    assert.equal(typeof storage.prunes[0].key, "string");
    assert.ok(storage.prunes[0].key.length > 0, "prune must be called with the effective key");
    assert.ok(
      logged.some(([m, e]) => m === "memory: retention pruned" && e.count === 5),
      "must log retention pruned with count",
    );
    await hooks.dispose?.();
  } finally {
    if (saved === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = saved;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("retention_days null → storage.prune NOT called", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mem-hooks-"));
  const saved = process.env.XDG_DATA_HOME;
  process.env.XDG_DATA_HOME = dir;
  try {
    const storage = mkMockStorage();
    const hooks = await registerMemoryHooks({
      client: mkClient(),
      config: mkConfig(dir),
      log: silentLog,
      root: dir,
      deps: { storage, embeddings: mkMockEmbeddings() },
    });
    assert.equal(storage.prunes.length, 0, "prune must NOT be called when retention_days is null");
    await hooks.dispose?.();
  } finally {
    if (saved === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = saved;
    rmSync(dir, { recursive: true, force: true });
  }
});