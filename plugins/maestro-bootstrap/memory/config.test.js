import { test } from "node:test";
import assert from "node:assert/strict";
import { loadMemoryConfig, classifyMemoryConfig, DEFAULTS, resolveEffectiveKey, resolveIdentity, resolveEffectiveTextConfig, sanitizeDirName } from "./config.js";

test("default off when no memory section", () => {
  const cfg = loadMemoryConfig({});
  assert.equal(cfg.enabled, false);
});
test("enabled true from config", () => {
  const cfg = loadMemoryConfig({ memory: { enabled: true, namespace: "test.ns" } });
  assert.equal(cfg.enabled, true);
  assert.equal(cfg.idle_debounce_min, DEFAULTS.idle_debounce_min);
});
test("storage type validation", () => {
  const cfg = loadMemoryConfig({ memory: { enabled: true, storage: { type: "bogus" } } });
  assert.equal(cfg.enabled, false);
});
test("branch_context default true; mainline default null", () => {
  const cfg = loadMemoryConfig({ memory: { enabled: true, namespace: "x" } });
  assert.equal(cfg.branch_context, true);
  assert.equal(cfg.mainline, null);
});
test("identity resolution order", () => {
  assert.equal(resolveIdentity({ config: { identity_env: "ME_ID" }, env: { ME_ID: "alice" }, gitName: "git" }), "alice");
  assert.equal(resolveIdentity({ config: {}, env: {}, gitName: "gitusername" }), "gitusername");
  assert.equal(resolveIdentity({ config: {}, env: {}, gitName: null }), null);
});
test("centralized requires identity", () => {
  const cfgNoId = loadMemoryConfig({ memory: { enabled: true, namespace: "x", storage: { type: "qdrant" } } });
  assert.equal(cfgNoId.enabled, false);
  const cfgWithId = loadMemoryConfig({ memory: { enabled: true, namespace: "x", storage: { type: "qdrant" }, identity: "x" } });
  assert.equal(cfgWithId.enabled, true);
});
test("centralized accepts git user.name as identity (spec: identity → identity_env → git user.name)", () => {
  const cfg = loadMemoryConfig({ memory: { enabled: true, namespace: "x", storage: { type: "qdrant" } } }, { gitName: "gitusername" });
  assert.equal(cfg.enabled, true);
  // no gitName → still disabled
  const cfgNoGit = loadMemoryConfig({ memory: { enabled: true, namespace: "x", storage: { type: "qdrant" } } }, { gitName: null });
  assert.equal(cfgNoGit.enabled, false);
});
test("effective key", () => {
  assert.equal(resolveEffectiveKey({ projectHash: "ph", namespace: null }), "ph");
  assert.equal(resolveEffectiveKey({ projectHash: "ph", namespace: "team" }), "team");
});
test("branch_context invalid disables; mainline invalid disables", () => {
  assert.equal(classifyMemoryConfig({ memory: { enabled: true, namespace: "x", branch_context: "yes" } }).disabled_reason, "branch_context_invalid");
  assert.equal(classifyMemoryConfig({ memory: { enabled: true, namespace: "x", mainline: "bad name!" } }).disabled_reason, "mainline_invalid");
});
test("mainline validation: length 100 cap + valid passes", () => {
  assert.equal(classifyMemoryConfig({ memory: { enabled: true, namespace: "x", mainline: "a".repeat(101) } }).disabled_reason, "mainline_invalid");
  assert.equal(classifyMemoryConfig({ memory: { enabled: true, namespace: "x", mainline: "develop" } }).enabled, true);
});
test("centralized_confidential removed from config (key ignored)", () => {
  const cfg = loadMemoryConfig({ memory: { enabled: true, storage: { type: "sqlite" }, centralized_confidential: "forbid" } });
  assert.equal(cfg.storage.centralized_confidential, undefined);
});
test("explicit enabled false disables", () => {
  const cfg = loadMemoryConfig({ memory: { enabled: false, namespace: "x" } });
  assert.equal(cfg.enabled, false);
});
test("non-object storage does not throw", () => {
  assert.equal(loadMemoryConfig({ memory: { enabled: true, storage: "sqlite", namespace: "x" } }).enabled, true);
  assert.equal(loadMemoryConfig({ memory: { enabled: true, storage: null, namespace: "x" } }).enabled, true);
});
test("dir name sanitized", () => {
  assert.match(sanitizeDirName("a/b c"), /^[0-9a-f]{16}$/);
});
test("retention_days default null", () => {
  const cfg = loadMemoryConfig({ memory: { enabled: true } });
  assert.equal(cfg.retention_days, null);
});
test("retention_days from config", () => {
  const cfg = loadMemoryConfig({ memory: { enabled: true, namespace: "x", retention_days: 30 } });
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
  const c = classifyMemoryConfig({ memory: { enabled: true, namespace: "x", retention_days: -5 } });
  assert.equal(c.enabled, false);
  assert.equal(c.disabled_reason, "retention_days_invalid");
});

test("similarity_threshold invalid disables", () => {
  assert.equal(loadMemoryConfig({ memory: { enabled: true, similarity_threshold: 1.5 } }).enabled, false);
  assert.equal(loadMemoryConfig({ memory: { enabled: true, similarity_threshold: "0.7" } }).enabled, false);
});

test("classifyMemoryConfig catches invalid similarity_threshold", () => {
  const c = classifyMemoryConfig({ memory: { enabled: true, namespace: "x", similarity_threshold: -0.1 } });
  assert.equal(c.enabled, false);
  assert.equal(c.disabled_reason, "similarity_threshold_invalid");
});

test("text_search_config default russian", () => {
  const cfg = loadMemoryConfig({ memory: { enabled: true, namespace: "x", storage: { type: "pgvector" }, identity: "x" } });
  assert.equal(cfg.storage.pgvector.text_search_config, "russian");
});

test("text_search_config invalid value disables only for pgvector", () => {
  const cfg = { memory: { enabled: true, namespace: "x", storage: { type: "pgvector", pgvector: { text_search_config: "Bad Config" } }, identity: "x" } };
  const cls = classifyMemoryConfig(cfg);
  assert.equal(cls.enabled, false);
  assert.equal(cls.disabled_reason, "pgvector_text_search_config_invalid");
  const sql = classifyMemoryConfig({ memory: { enabled: true, namespace: "x", storage: { type: "sqlite", text_search_config: "Bad Config" } } });
  assert.equal(sql.enabled, true);
});

test("text_search_config length cap 63", () => {
  const cls = classifyMemoryConfig({ memory: { enabled: true, namespace: "x", storage: { type: "pgvector", pgvector: { text_search_config: "a".repeat(64) } }, identity: "x" } });
  assert.equal(cls.disabled_reason, "pgvector_text_search_config_invalid");
});

test("text_search_config valid custom passes", () => {
  const cfg = loadMemoryConfig({ memory: { enabled: true, namespace: "x", storage: { type: "pgvector", pgvector: { text_search_config: "english" } }, identity: "x" } });
  assert.equal(cfg.storage.pgvector.text_search_config, "english");
});

test("flat storage.text_search_config alias is dropped (nested key only)", () => {
  // M5: flat-алиас убран — только вложенный storage.pgvector.text_search_config.
  const cfg = loadMemoryConfig({ memory: { enabled: true, namespace: "x", storage: { type: "pgvector", text_search_config: "english" }, identity: "x" } });
  assert.equal(cfg.storage.pgvector.text_search_config, "russian", "flat alias must be ignored");
  const cls = classifyMemoryConfig({ memory: { enabled: true, namespace: "x", storage: { type: "pgvector", text_search_config: "Bad Config" }, identity: "x" } });
  assert.equal(cls.enabled, true, "flat alias must not trigger validation");
});

test("resolveEffectiveTextConfig: valid passes through, invalid/absent falls back to russian", () => {
  assert.equal(resolveEffectiveTextConfig({ storage: { pgvector: { text_search_config: "english" } } }), "english");
  assert.equal(resolveEffectiveTextConfig({ storage: { pgvector: { text_search_config: "BAD" } } }), "russian");
  assert.equal(resolveEffectiveTextConfig({ storage: { pgvector: {} } }), "russian");
});

// ── Task 1: memory.embedding block + probe_cooldown_min ──

test("embedding block defaults (local)", () => {
  const cfg = loadMemoryConfig({ memory: { enabled: true, namespace: "x" } });
  assert.deepEqual(cfg.embedding, {
    provider: "local",
    model: "Xenova/paraphrase-multilingual-MiniLM-L12-v2",
    base_url: "https://api.openai.com/v1",
    api_key_env: null,
    dim: null,
  });
  assert.equal(cfg.probe_cooldown_min, 30);
});

test("legacy embedding_model feeds embedding.model (local); embedding.model wins", () => {
  const cfg = loadMemoryConfig({ memory: { enabled: true, namespace: "x", embedding_model: "legacy" } });
  assert.equal(cfg.embedding.model, "legacy");
  const cfg2 = loadMemoryConfig({ memory: { enabled: true, namespace: "x", embedding_model: "legacy", embedding: { model: "new" } } });
  assert.equal(cfg2.embedding.model, "new");
});

test("openai provider requires model/api_key_env/dim else embedding_invalid", () => {
  assert.equal(classifyMemoryConfig({ memory: { enabled: true, namespace: "x", embedding: { provider: "openai" } } }).disabled_reason, "embedding_invalid");
  const ok = { memory: { enabled: true, namespace: "x", embedding: { provider: "openai", model: "text-embedding-3-small", api_key_env: "EMB_KEY", dim: 1536 } } };
  assert.equal(classifyMemoryConfig(ok).disabled_reason, null);
});

test("unknown provider / non-object embedding → embedding_invalid", () => {
  assert.equal(classifyMemoryConfig({ memory: { enabled: true, namespace: "x", embedding: { provider: "foo" } } }).disabled_reason, "embedding_invalid");
  assert.equal(classifyMemoryConfig({ memory: { enabled: true, namespace: "x", embedding: "x" } }).disabled_reason, "embedding_invalid");
});

test("openai model does not fall back to legacy embedding_model", () => {
  const cfg = loadMemoryConfig({ memory: { enabled: true, namespace: "x", embedding_model: "legacy", embedding: { provider: "openai", model: "m", api_key_env: "K", dim: 3 } } });
  assert.equal(cfg.embedding.model, "m");
});

test("base_url trailing slashes normalized", () => {
  const cfg = loadMemoryConfig({ memory: { enabled: true, namespace: "x", embedding: { provider: "openai", model: "m", api_key_env: "K", dim: 3, base_url: "https://x/v1/" } } });
  assert.equal(cfg.embedding.base_url, "https://x/v1");
});

test("openai base_url non-string → embedding_invalid (classify, no throw)", () => {
  // Spec §2.1: base_url — строка. Число (напр. 8080) не должно проходить gate
  // и падать в mergedConfig .replace(...) на централизованных бэкендах.
  const cfg = { memory: { enabled: true, namespace: "x", storage: { type: "qdrant" }, embedding: { provider: "openai", model: "m", api_key_env: "K", dim: 3, base_url: 8080 } } };
  assert.doesNotThrow(() => {
    const cls = classifyMemoryConfig(cfg);
    assert.equal(cls.disabled_reason, "embedding_invalid");
  });
});

test("openai base_url non-string → loadMemoryConfig does not throw", () => {
  const cfg = { memory: { enabled: true, storage: { type: "qdrant" }, embedding: { provider: "openai", model: "m", api_key_env: "K", dim: 3, base_url: 8080 } } };
  assert.doesNotThrow(() => loadMemoryConfig(cfg));
});

test("dim ignored for local; probe_cooldown_min validation", () => {
  const cfg = loadMemoryConfig({ memory: { enabled: true, namespace: "x", embedding: { dim: 512 } } });
  assert.equal(cfg.embedding.dim, null);
  assert.equal(classifyMemoryConfig({ memory: { enabled: true, namespace: "x", probe_cooldown_min: 0 } }).disabled_reason, "probe_cooldown_min_invalid");
  assert.equal(classifyMemoryConfig({ memory: { enabled: true, namespace: "x", probe_cooldown_min: 5 } }).disabled_reason, null);
});

// ── delete_on_session_delete ──

test("delete_on_session_delete default false", () => {
  const cfg = loadMemoryConfig({ memory: { enabled: true } });
  assert.equal(cfg.delete_on_session_delete, false);
});
test("delete_on_session_delete from config", () => {
  const cfg = loadMemoryConfig({ memory: { enabled: true, namespace: "x", delete_on_session_delete: true } });
  assert.equal(cfg.delete_on_session_delete, true);
});
test("delete_on_session_delete invalid disables", () => {
  assert.equal(classifyMemoryConfig({ memory: { enabled: true, namespace: "x", delete_on_session_delete: "yes" } }).disabled_reason, "delete_on_session_delete_invalid");
});

// ── namespace mandatory + format + normalize + related + domain_recall ──

test("namespace_missing disables when enabled without namespace", () => {
  assert.equal(classifyMemoryConfig({ memory: { enabled: true } }).disabled_reason, "namespace_missing");
});
test("namespace valid format passes", () => {
  assert.equal(classifyMemoryConfig({ memory: { enabled: true, namespace: "microservices.sales.pay" } }).enabled, true);
});
test("namespace normalized before validation (MyApp → myapp)", () => {
  const cfg = loadMemoryConfig({ memory: { enabled: true, namespace: "MyApp" } });
  assert.equal(cfg.namespace, "myapp");
  assert.equal(cfg.enabled, true);
});
test("namespace invalid format disables", () => {
  for (const n of ["-foo", "foo-", "a..b", "a.b.c.d", "a".repeat(33), "a.b.", "über"]) {
    assert.equal(classifyMemoryConfig({ memory: { enabled: true, namespace: n } }).disabled_reason, "namespace_invalid", `namespace ${n}`);
  }
});
test("related invalid disables; valid passes with normalization+dedup", () => {
  assert.equal(classifyMemoryConfig({ memory: { enabled: true, namespace: "x", related: ["bad!name"] } }).disabled_reason, "related_invalid");
  const cfg = loadMemoryConfig({ memory: { enabled: true, namespace: "x", related: ["a.b", "MyApp"] } });
  assert.deepEqual(cfg.related, ["a.b", "myapp"]);
});
test("related >16 entries disables", () => {
  assert.equal(classifyMemoryConfig({ memory: { enabled: true, namespace: "x", related: Array(17).fill("a.b") } }).disabled_reason, "related_invalid");
});
test("domain_recall default true; false passes; invalid disables", () => {
  assert.equal(loadMemoryConfig({ memory: { enabled: true, namespace: "x" } }).domain_recall, true);
  assert.equal(classifyMemoryConfig({ memory: { enabled: true, namespace: "x", domain_recall: false } }).enabled, true);
  assert.equal(classifyMemoryConfig({ memory: { enabled: true, namespace: "x", domain_recall: "yes" } }).disabled_reason, "domain_recall_invalid");
});
test("disabled_reason priority: namespace_missing > namespace_invalid > related_invalid", () => {
  assert.equal(classifyMemoryConfig({ memory: { enabled: true, namespace: "Bad!", related: ["bad!"] } }).disabled_reason, "namespace_invalid");
  assert.equal(classifyMemoryConfig({ memory: { enabled: true, namespace: "x", related: ["bad!"] } }).disabled_reason, "related_invalid");
  assert.equal(classifyMemoryConfig({ memory: { enabled: true } }).disabled_reason, "namespace_missing");
});
