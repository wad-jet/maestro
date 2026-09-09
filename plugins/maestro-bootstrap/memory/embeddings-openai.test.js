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
  assert.equal(p401.error_class, "auth", "401 → error_class auth");
  const p404 = await mk(async () => ({ ok: false, status: 404, statusText: "Not Found", text: async () => "" })).probe();
  assert.equal(p404.hard, true);
  assert.equal(p404.error_class, "not_found", "404 → error_class not_found");
  const p503 = await mk(async () => ({ ok: false, status: 503, statusText: "Busy", text: async () => "" })).probe();
  assert.equal(p503.hard, false);
  assert.equal(p503.error_class, "http_5xx", "5xx → error_class http_5xx");
  const pNet = await mk(async () => { throw new Error("timeout"); }).probe();
  assert.equal(pNet.hard, false);
  assert.equal(pNet.error_class, "network", "network/timeout → error_class network");
  const pDim = await mk(async () => ({ ok: true, status: 200, statusText: "OK", json: async () => ({ data: [{ embedding: [1, 2] }] }) })).probe();
  assert.equal(pDim.hard, true);
  assert.equal(pDim.error_class, "dim_mismatch", "dim mismatch → error_class dim_mismatch");
});

// Task 5: аудит-события openai-embedder (spec §4.3) — duration с cache_hit
// и cache_stats (info, раз в 10 embed-вызовов).
test("openai embed logs duration with cache_hit and cache_stats", async () => {
  const calls = [];
  const log = { debug: (m, e) => calls.push([m, e]), info: (m, e) => calls.push([m, e]) };
  const fetchImpl = fakeFetch(async () => okRes());
  const e = new OpenAiEmbedder({ model: "m", baseUrl: "https://x/v1", apiKey: "k", dim: 3, fetchImpl, logDebug: log.debug, logInfo: log.info });
  await e.embed("q");
  const dur = calls.find(([m]) => m === "memory:embed.duration");
  assert.ok(dur);
  assert.equal(dur[1].provider, "external");
  assert.equal(dur[1].cache_hit, false);
});

test("openai http.error logs status_class enum, not body", async () => {
  const calls = [];
  const log = { warn: (m, e) => calls.push([m, e]) };
  const fetchImpl = fakeFetch(async () => ({ ok: false, status: 503, statusText: "Busy", text: async () => "top secret body" }));
  const e = new OpenAiEmbedder({ model: "m", baseUrl: "https://x/v1", apiKey: "k", dim: 3, fetchImpl, logWarn: log.warn });
  await assert.rejects(() => e.embed("hi"));
  const ev = calls.find(([m]) => m === "memory:http.error");
  assert.ok(ev);
  assert.ok(!JSON.stringify(ev).includes("secret body"), "HTTP body NOT in log");
});

test("openai cache_stats logged every 10th embed with hit_rate and cache_size", async () => {
  const calls = [];
  const log = { debug: () => {}, info: (m, e) => calls.push([m, e]) };
  const fetchImpl = fakeFetch(async () => okRes());
  const e = new OpenAiEmbedder({ model: "m", baseUrl: "https://x/v1", apiKey: "k", dim: 3, fetchImpl, logDebug: log.debug, logInfo: log.info });
  for (let i = 0; i < 10; i++) await e.embed(`q${i}`);
  const stats = calls.find(([m]) => m === "memory:embed.cache_stats");
  assert.ok(stats, "cache_stats on 10th embed");
  assert.equal(typeof stats[1].hit_rate, "number");
  assert.equal(stats[1].cache_size, 10);
});

test("openai network error logs http.error with error_class network", async () => {
  const calls = [];
  const log = { warn: (m, e) => calls.push([m, e]) };
  const fetchImpl = fakeFetch(async () => { throw new Error("ECONNREFUSED"); });
  const e = new OpenAiEmbedder({ model: "m", baseUrl: "https://x/v1", apiKey: "k", dim: 3, fetchImpl, logWarn: log.warn });
  await assert.rejects(() => e.embed("hi"));
  const ev = calls.find(([m]) => m === "memory:http.error");
  assert.ok(ev);
  assert.equal(ev[1].error_class, "network");
});

test("openai 401 logs http.error with auth class", async () => {
  const calls = [];
  const log = { warn: (m, e) => calls.push([m, e]) };
  const fetchImpl = fakeFetch(async () => ({ ok: false, status: 401, statusText: "Unauthorized", text: async () => "" }));
  const e = new OpenAiEmbedder({ model: "m", baseUrl: "https://x/v1", apiKey: "k", dim: 3, fetchImpl, logWarn: log.warn });
  await assert.rejects(() => e.embed("hi"));
  const ev = calls.find(([m]) => m === "memory:http.error");
  assert.ok(ev);
  assert.equal(ev[1].http_status_class, "auth");
});