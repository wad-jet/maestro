import { test } from "node:test";
import assert from "node:assert/strict";
import { OpenAiEmbedder, EmbedRetryableError } from "./embeddings-openai.js";

function fakeFetch(respond) {
  const calls = [];
  const fn = async (url, opts) => { calls.push({ url, opts }); return respond(url, opts, calls.length); };
  fn.calls = calls;
  return fn;
}
const okRes = () => ({ ok: true, status: 200, statusText: "OK", json: async () => ({ data: [{ embedding: [0.1, 0.2, 0.3] }] }) });

test("embed posts /embeddings with auth, returns Float32Array", async () => {
  const fetchImpl = fakeFetch(async () => okRes());
  const e = new OpenAiEmbedder({ model: "m", baseUrl: "https://api.openai.com/v1", apiKey: "sk-xyz", dim: 3, fetchImpl });
  const v = await e.embed("hello");
  assert.ok(v instanceof Float32Array);
  assert.equal(v.length, 3);
  assert.equal(e.modelId, "openai:m@https://api.openai.com/v1");
  const c = fetchImpl.calls[0];
  assert.equal(c.url, "https://api.openai.com/v1/embeddings");
  assert.equal(c.opts.headers.Authorization, "Bearer sk-xyz");
  assert.deepEqual(JSON.parse(c.opts.body), { model: "m", input: "hello" });
});

test("dimension mismatch throws actionable with actual dim", async () => {
  const fetchImpl = fakeFetch(async () => ({ ok: true, status: 200, statusText: "OK", json: async () => ({ data: [{ embedding: [1, 2] }] }) }));
  const e = new OpenAiEmbedder({ model: "m", baseUrl: "https://x/v1", apiKey: "k", dim: 3, fetchImpl });
  await assert.rejects(() => e.embed("hi"), /dimension mismatch \(api=2, config=3\)/);
});

test("5xx and network → EmbedRetryableError; 401 → plain Error", async () => {
  const e1 = new OpenAiEmbedder({ model: "m", baseUrl: "https://x/v1", apiKey: "k", dim: 3, fetchImpl: fakeFetch(async () => ({ ok: false, status: 503, statusText: "Busy", text: async () => "" })) });
  await assert.rejects(() => e1.embed("hi"), (err) => err instanceof EmbedRetryableError);
  const e2 = new OpenAiEmbedder({ model: "m", baseUrl: "https://x/v1", apiKey: "k", dim: 3, fetchImpl: fakeFetch(async () => ({ ok: false, status: 401, statusText: "Unauthorized", text: async () => "" })) });
  await assert.rejects(() => e2.embed("hi"), (err) => !(err instanceof EmbedRetryableError));
  const e3 = new OpenAiEmbedder({ model: "m", baseUrl: "https://x/v1", apiKey: "k", dim: 3, fetchImpl: fakeFetch(async () => { throw new Error("ECONNREFUSED"); }) });
  await assert.rejects(() => e3.embed("hi"), (err) => err instanceof EmbedRetryableError);
});

test("cache dedups identical text (single fetch)", async () => {
  let n = 0;
  const fetchImpl = fakeFetch(async () => { n++; return okRes(); });
  const e = new OpenAiEmbedder({ model: "m", baseUrl: "https://x/v1", apiKey: "k", dim: 3, fetchImpl });
  await e.embed("q");
  await e.embed("q");
  assert.equal(n, 1);
});

test("probe classification", async () => {
  const mk = (respond) => new OpenAiEmbedder({ model: "m", baseUrl: "https://x/v1", apiKey: "k", dim: 3, apiKeyEnv: "EMB_KEY", fetchImpl: fakeFetch(respond) });
  assert.deepEqual(await mk(async () => okRes()).probe(), { ok: true, hard: false, detail: "OK (dim 3)" });
  const p401 = await mk(async () => ({ ok: false, status: 401, statusText: "Unauthorized", text: async () => "" })).probe();
  assert.equal(p401.ok, false); assert.equal(p401.hard, true); assert.ok(p401.detail.includes("EMB_KEY"));
  const p404 = await mk(async () => ({ ok: false, status: 404, statusText: "Not Found", text: async () => "" })).probe();
  assert.equal(p404.hard, true);
  const p503 = await mk(async () => ({ ok: false, status: 503, statusText: "Busy", text: async () => "" })).probe();
  assert.equal(p503.hard, false);
  const pNet = await mk(async () => { throw new Error("timeout"); }).probe();
  assert.equal(pNet.hard, false);
  const pDim = await mk(async () => ({ ok: true, status: 200, statusText: "OK", json: async () => ({ data: [{ embedding: [1, 2] }] }) })).probe();
  assert.equal(pDim.hard, true);
});