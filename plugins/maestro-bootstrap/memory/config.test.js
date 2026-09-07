import { test } from "node:test";
import assert from "node:assert/strict";
import { loadMemoryConfig, classifyMemoryConfig, DEFAULTS, resolveEffectiveKey, resolveIdentity, resolveEffectiveTextConfig, sanitizeDirName } from "./config.js";

test("default off when no memory section", () => {
  const cfg = loadMemoryConfig({});
  assert.equal(cfg.enabled, false);
});
test("enabled true from config", () => {
  const cfg = loadMemoryConfig({ memory: { enabled: true } });
  assert.equal(cfg.enabled, true);
  assert.equal(cfg.idle_debounce_min, DEFAULTS.idle_debounce_min);
});
test("storage type validation", () => {
  const cfg = loadMemoryConfig({ memory: { enabled: true, storage: { type: "bogus" } } });
  assert.equal(cfg.enabled, false);
});
test("centralized_confidential default forbid", () => {
  const cfg = loadMemoryConfig({ memory: { enabled: true } });
  assert.equal(cfg.storage.centralized_confidential, "forbid");
});
test("identity resolution order", () => {
  assert.equal(resolveIdentity({ config: { identity_env: "ME_ID" }, env: { ME_ID: "alice" }, gitName: "git" }), "alice");
  assert.equal(resolveIdentity({ config: {}, env: {}, gitName: "gitusername" }), "gitusername");
  assert.equal(resolveIdentity({ config: {}, env: {}, gitName: null }), null);
});
test("centralized requires identity", () => {
  const cfgNoId = loadMemoryConfig({ memory: { enabled: true, storage: { type: "qdrant" } } });
  assert.equal(cfgNoId.enabled, false);
  const cfgWithId = loadMemoryConfig({ memory: { enabled: true, storage: { type: "qdrant" }, identity: "x" } });
  assert.equal(cfgWithId.enabled, true);
});
test("centralized accepts git user.name as identity (spec: identity → identity_env → git user.name)", () => {
  const cfg = loadMemoryConfig({ memory: { enabled: true, storage: { type: "qdrant" } } }, { gitName: "gitusername" });
  assert.equal(cfg.enabled, true);
  // no gitName → still disabled
  const cfgNoGit = loadMemoryConfig({ memory: { enabled: true, storage: { type: "qdrant" } } }, { gitName: null });
  assert.equal(cfgNoGit.enabled, false);
});
test("effective key", () => {
  assert.equal(resolveEffectiveKey({ projectHash: "ph", namespace: null }), "ph");
  assert.equal(resolveEffectiveKey({ projectHash: "ph", namespace: "team" }), "team");
});
test("centralized_confidential invalid value disables", () => {
  const cfg = loadMemoryConfig({ memory: { enabled: true, storage: { type: "qdrant", centralized_confidential: "bogus" }, identity: "x" } });
  assert.equal(cfg.enabled, false);
});
test("centralized_confidential allow enables with identity", () => {
  const cfg = loadMemoryConfig({ memory: { enabled: true, storage: { type: "qdrant", centralized_confidential: "allow" }, identity: "x" } });
  assert.equal(cfg.enabled, true);
});
test("explicit enabled false disables", () => {
  const cfg = loadMemoryConfig({ memory: { enabled: false } });
  assert.equal(cfg.enabled, false);
});
test("non-object storage does not throw", () => {
  assert.equal(loadMemoryConfig({ memory: { enabled: true, storage: "sqlite" } }).enabled, true);
  assert.equal(loadMemoryConfig({ memory: { enabled: true, storage: null } }).enabled, true);
});
test("dir name sanitized", () => {
  assert.match(sanitizeDirName("a/b c"), /^[0-9a-f]{16}$/);
});
test("retention_days default null", () => {
  const cfg = loadMemoryConfig({ memory: { enabled: true } });
  assert.equal(cfg.retention_days, null);
});
test("retention_days from config", () => {
  const cfg = loadMemoryConfig({ memory: { enabled: true, retention_days: 30 } });
  assert.equal(cfg.retention_days, 30);
});
test("retention_days invalid value disables memory", () => {
  const cfg = loadMemoryConfig({ memory: { enabled: true, retention_days: -5 } });
  assert.equal(cfg.enabled, false);
});
test("retention_days zero disables", () => {
  assert.equal(loadMemoryConfig({ memory: { enabled: true, retention_days: 0 } }).enabled, false);
});
test("retention_days string disables", () => {
  assert.equal(loadMemoryConfig({ memory: { enabled: true, retention_days: "30" } }).enabled, false);
});
test("classifyMemoryConfig catches invalid retention_days", () => {
  const c = classifyMemoryConfig({ memory: { enabled: true, retention_days: -5 } });
  assert.equal(c.enabled, false);
  assert.equal(c.disabled_reason, "retention_days_invalid");
});

test("similarity_threshold invalid disables", () => {
  assert.equal(loadMemoryConfig({ memory: { enabled: true, similarity_threshold: 1.5 } }).enabled, false);
  assert.equal(loadMemoryConfig({ memory: { enabled: true, similarity_threshold: "0.7" } }).enabled, false);
});

test("classifyMemoryConfig catches invalid similarity_threshold", () => {
  const c = classifyMemoryConfig({ memory: { enabled: true, similarity_threshold: -0.1 } });
  assert.equal(c.enabled, false);
  assert.equal(c.disabled_reason, "similarity_threshold_invalid");
});

test("text_search_config default russian", () => {
  const cfg = loadMemoryConfig({ memory: { enabled: true, storage: { type: "pgvector" }, identity: "x" } });
  assert.equal(cfg.storage.pgvector.text_search_config, "russian");
});

test("text_search_config invalid value disables only for pgvector", () => {
  const cfg = { memory: { enabled: true, storage: { type: "pgvector", pgvector: { text_search_config: "Bad Config" } }, identity: "x" } };
  const cls = classifyMemoryConfig(cfg);
  assert.equal(cls.enabled, false);
  assert.equal(cls.disabled_reason, "pgvector_text_search_config_invalid");
  const sql = classifyMemoryConfig({ memory: { enabled: true, storage: { type: "sqlite", text_search_config: "Bad Config" } } });
  assert.equal(sql.enabled, true);
});

test("text_search_config length cap 63", () => {
  const cls = classifyMemoryConfig({ memory: { enabled: true, storage: { type: "pgvector", pgvector: { text_search_config: "a".repeat(64) } }, identity: "x" } });
  assert.equal(cls.disabled_reason, "pgvector_text_search_config_invalid");
});

test("text_search_config valid custom passes", () => {
  const cfg = loadMemoryConfig({ memory: { enabled: true, storage: { type: "pgvector", pgvector: { text_search_config: "english" } }, identity: "x" } });
  assert.equal(cfg.storage.pgvector.text_search_config, "english");
});

test("flat storage.text_search_config alias is dropped (nested key only)", () => {
  // M5: flat-алиас убран — только вложенный storage.pgvector.text_search_config.
  const cfg = loadMemoryConfig({ memory: { enabled: true, storage: { type: "pgvector", text_search_config: "english" }, identity: "x" } });
  assert.equal(cfg.storage.pgvector.text_search_config, "russian", "flat alias must be ignored");
  const cls = classifyMemoryConfig({ memory: { enabled: true, storage: { type: "pgvector", text_search_config: "Bad Config" }, identity: "x" } });
  assert.equal(cls.enabled, true, "flat alias must not trigger validation");
});

test("resolveEffectiveTextConfig: valid passes through, invalid/absent falls back to russian", () => {
  assert.equal(resolveEffectiveTextConfig({ storage: { pgvector: { text_search_config: "english" } } }), "english");
  assert.equal(resolveEffectiveTextConfig({ storage: { pgvector: { text_search_config: "BAD" } } }), "russian");
  assert.equal(resolveEffectiveTextConfig({ storage: { pgvector: {} } }), "russian");
});
