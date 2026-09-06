import { test } from "node:test";
import assert from "node:assert/strict";
import { Embedder } from "./embeddings.js";

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
