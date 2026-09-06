import { test } from "node:test";
import assert from "node:assert/strict";
import { loadMemoryConfig, DEFAULTS, resolveEffectiveKey, resolveIdentity, sanitizeDirName } from "./config.js";

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
