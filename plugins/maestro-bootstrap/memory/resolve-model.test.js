import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveSummarizerModel, parseModelRef } from "./resolve-model.js";

const ROOT = "/tmp/root";
function mkClient(cfg, overrides = {}) {
  return { config: { get: async () => cfg }, ...overrides };
}

test("chain: small_model wins over model", async () => {
  const r = await resolveSummarizerModel({ client: mkClient({ small_model: "a/s", model: "b/m" }), root: ROOT });
  assert.deepEqual(r, { model: "a/s", source: "small_model", error: null });
});
test("chain: model when small_model absent", async () => {
  const r = await resolveSummarizerModel({ client: mkClient({ model: "b/m" }), root: ROOT });
  assert.deepEqual(r, { model: "b/m", source: "model", error: null });
});
test("chain: agent.maestro.model when model+small_model absent", async () => {
  const r = await resolveSummarizerModel({ client: mkClient({ agent: { maestro: { model: "c/m" } } }), root: ROOT });
  assert.deepEqual(r, { model: "c/m", source: "agent_maestro", error: null });
});
test("chain: agent.build.model is last", async () => {
  const r = await resolveSummarizerModel({ client: mkClient({ agent: { build: { model: "d/m" } } }), root: ROOT });
  assert.deepEqual(r, { model: "d/m", source: "agent_build", error: null });
});
test("empty config → no_model_resolved", async () => {
  const r = await resolveSummarizerModel({ client: mkClient({}), root: ROOT });
  assert.deepEqual(r, { model: null, source: null, error: "no_model_resolved" });
});
test("unwrap: {data: cfg}", async () => {
  const r = await resolveSummarizerModel({ client: mkClient({ data: { model: "b/m" } }), root: ROOT });
  assert.deepEqual(r, { model: "b/m", source: "model", error: null });
});
test("config.get reject → config_get_failed", async () => {
  const c = { config: { get: async () => { throw new Error("net"); } } };
  const r = await resolveSummarizerModel({ client: c, root: ROOT });
  assert.deepEqual(r, { model: null, source: null, error: "config_get_failed" });
});
test("client without config (sync TypeError path) → config_get_failed", async () => {
  const r = await resolveSummarizerModel({ client: {}, root: ROOT });
  assert.deepEqual(r, { model: null, source: null, error: "config_get_failed" });
});
test("client null → config_get_failed", async () => {
  const r = await resolveSummarizerModel({ client: null, root: ROOT });
  assert.deepEqual(r, { model: null, source: null, error: "config_get_failed" });
});
test("timeout (injected) → config_get_failed", async () => {
  const c = { config: { get: () => new Promise(() => {}) } };
  const r = await resolveSummarizerModel({ client: c, root: ROOT, timeoutMs: 10 });
  assert.deepEqual(r, { model: null, source: null, error: "config_get_failed" });
});
test("invalid small_model skipped → model resolves", async () => {
  const r = await resolveSummarizerModel({ client: mkClient({ small_model: "noslash", model: "b/m" }), root: ROOT });
  assert.deepEqual(r, { model: "b/m", source: "model", error: null });
});
test("all invalid → invalid_model_ref", async () => {
  const r = await resolveSummarizerModel({ client: mkClient({ small_model: "noslash", model: "x" }), root: ROOT });
  assert.deepEqual(r, { model: null, source: null, error: "invalid_model_ref" });
});
test("degenerate 'prov/' (empty modelID) rejected → next candidate", async () => {
  const r = await resolveSummarizerModel({ client: mkClient({ small_model: "prov/", model: "b/m" }), root: ROOT });
  assert.deepEqual(r, { model: "b/m", source: "model", error: null });
});
test("degenerate '/m1' (empty providerID) rejected", async () => {
  const r = await resolveSummarizerModel({ client: mkClient({ model: "/m1" }), root: ROOT });
  assert.deepEqual(r, { model: null, source: null, error: "invalid_model_ref" });
});
test("whitespace-only '   ' → invalid", async () => {
  const r = await resolveSummarizerModel({ client: mkClient({ small_model: "   " }), root: ROOT });
  assert.deepEqual(r, { model: null, source: null, error: "invalid_model_ref" });
});
test("non-string candidate (number) → invalid, skipped", async () => {
  const r = await resolveSummarizerModel({ client: mkClient({ small_model: 42, model: "b/m" }), root: ROOT });
  assert.deepEqual(r, { model: "b/m", source: "model", error: null });
});
test("trim: '  prov/m1  ' → 'prov/m1' (результат — trimmed-строка)", async () => {
  const r = await resolveSummarizerModel({ client: mkClient({ model: "  prov/m1  " }), root: ROOT });
  assert.deepEqual(r, { model: "prov/m1", source: "model", error: null });
});
test("inner whitespace in part 'prov /m1' → invalid (SF-2)", async () => {
  const r = await resolveSummarizerModel({ client: mkClient({ small_model: "prov /m1", model: "b/m" }), root: ROOT });
  assert.deepEqual(r, { model: "b/m", source: "model", error: null });
});
test("inner whitespace 'prov/ m1' → invalid", async () => {
  const r = await resolveSummarizerModel({ client: mkClient({ model: "prov/ m1" }), root: ROOT });
  assert.deepEqual(r, { model: null, source: null, error: "invalid_model_ref" });
});
test("absent candidates (undefined/null) don't set invalid flag (SF-1)", async () => {
  const r = await resolveSummarizerModel({ client: mkClient({ small_model: null, agent: {} }), root: ROOT });
  assert.deepEqual(r, { model: null, source: null, error: "no_model_resolved" });
});
test("model with '/' in modelID: 'akash/Qwen/Qwen3.8-27B'", async () => {
  const r = await resolveSummarizerModel({ client: mkClient({ small_model: "akash/Qwen/Qwen3.8-27B" }), root: ROOT });
  assert.deepEqual(r, { model: "akash/Qwen/Qwen3.8-27B", source: "small_model", error: null });
});
test("chain: 'core' skips agent steps (D-4: sessions path)", async () => {
  const r = await resolveSummarizerModel({ client: mkClient({ agent: { maestro: { model: "c/m" } } }), root: ROOT, chain: "core" });
  assert.deepEqual(r, { model: null, source: null, error: "no_model_resolved" });
});
test("chain: 'core' resolves small_model", async () => {
  const r = await resolveSummarizerModel({ client: mkClient({ small_model: "a/s", agent: { build: { model: "d/m" } } }), root: ROOT, chain: "core" });
  assert.deepEqual(r, { model: "a/s", source: "small_model", error: null });
});
test("parseModelRef: '/' in modelID", () => {
  assert.deepEqual(parseModelRef("akash/Qwen/Qwen3.8-27B"), { providerID: "akash", modelID: "Qwen/Qwen3.8-27B" });
});
test("parseModelRef: degenerate → null", () => {
  assert.equal(parseModelRef("prov/"), null);
  assert.equal(parseModelRef("/m1"), null);
  assert.equal(parseModelRef("noslash"), null);
  assert.equal(parseModelRef(42), null);
  assert.equal(parseModelRef(null), null);
});
