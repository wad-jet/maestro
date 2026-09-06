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
test("dir name sanitized", () => {
  assert.match(sanitizeDirName("a/b c"), /^[0-9a-f]{16}$/);
});
