import { test } from "node:test";
import assert from "node:assert/strict";
import { Embedder, bucket } from "./embeddings.js";

function fakePipeline() {
  const calls = [];
  const fn = async (texts, opts) => { calls.push({ texts, opts }); return { data: [0.1, 0.2, 0.3] }; };
  fn.calls = calls;
  return fn;
}

test("embedder produces Float32Array", async () => {
  const pipeline = fakePipeline();
  const e = new Embedder({ model: "x", cacheDir: "/tmp/x", _pipeline: pipeline, _dim: 3 });
  await e.init();
  const v = await e.embed("hello");
  assert.ok(v instanceof Float32Array);
  assert.equal(v.length, 3);
  assert.equal(e.dim, 3);
  assert.equal(e.modelId, "x");
  const c = pipeline.calls;
  assert.deepEqual(c[0].opts, { pooling: "mean", normalize: true });
  assert.deepEqual(c[1].opts, { pooling: "mean", normalize: true });
});
test("init failure throws actionable", async () => {
  const e = new Embedder({ model: "x", cacheDir: "/tmp/x", _pipeline: null, _dim: 3, moduleDir: "/tmp/nonexistent" });
  await assert.rejects(() => e.init(), /install|module_dir/i);
});

test("probe ok when transformers importable", async () => {
  const e = new Embedder({ model: "x", cacheDir: "/tmp/x", _pipeline: null, _dim: 3, moduleDir: "/tmp/m", _importImpl: async () => ({}) });
  const p = await e.probe();
  assert.equal(p.ok, true);
  assert.equal(p.hard, false);
});

test("probe hard when transformers missing", async () => {
  const e = new Embedder({ model: "x", cacheDir: "/tmp/x", _pipeline: null, _dim: 3, moduleDir: "/tmp/m", _importImpl: async () => { throw new Error("not found"); } });
  const p = await e.probe();
  assert.equal(p.ok, false);
  assert.equal(p.hard, true);
});

// Task 5: аудит-события embedder (spec §4.3) — duration без cache_hit
// (локальный Embedder текстового кэша не имеет).
test("local embed logs duration without cache_hit", async () => {
  const calls = [];
  const log = { debug: (m, e) => calls.push([m, e]) };
  const e = new Embedder({ model: "x", cacheDir: "/tmp/x", _pipeline: fakePipeline(), _dim: 3, moduleDir: "/tmp/m", _importImpl: async () => ({}), logDebug: log.debug });
  await e.embed("hi");
  const ev = calls.find(([m]) => m === "memory:embed.duration");
  assert.ok(ev);
  assert.equal(ev[1].provider, "local");
  assert.equal("cache_hit" in ev[1], false);
});

// Task 5: биннинг длины текста (spec §3: <100, 100-500, 500-2000, >2000).
test("bucket bins lengths per spec §3", () => {
  assert.equal(bucket(50), "<100");
  assert.equal(bucket(100), "100-500");
  assert.equal(bucket(500), "100-500");
  assert.equal(bucket(501), "500-2000");
  assert.equal(bucket(2000), "500-2000");
  assert.equal(bucket(2001), ">2000");
});
