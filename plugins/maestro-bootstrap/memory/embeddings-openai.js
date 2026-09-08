import { makeBoundedMap } from "../core.js";
import { bucket } from "./embeddings.js";

export class EmbedRetryableError extends Error {
  constructor(message) {
    super(message);
    this.name = "EmbedRetryableError";
    this.retryable = true;
  }
}

export class OpenAiEmbedder {
  constructor({ model, baseUrl, apiKey, dim = null, apiKeyEnv = null, timeoutMs = 15000, fetchImpl = globalThis.fetch, cache = makeBoundedMap(256), logDebug = () => {}, logWarn = () => {}, logInfo = () => {} }) {
    this.model = model;
    this.baseUrl = baseUrl;
    this.apiKey = apiKey;
    this.apiKeyEnv = apiKeyEnv;
    this._dim = dim;
    this.timeoutMs = timeoutMs;
    this.fetchImpl = fetchImpl;
    this.cache = cache;
    // Task 5: аудит-лог (spec §4.3) — debug/info/warn-события embedder; default noop.
    this.logDebug = logDebug;
    this.logWarn = logWarn;
    this.logInfo = logInfo;
    // Счётчики для memory:embed.cache_stats (info, раз в 10 embed-вызовов).
    this._embedCalls = 0;
    this._cacheHits = 0;
  }
  get dim() { return this._dim; }
  get modelId() { return `openai:${this.model}@${this.baseUrl}`; }
  async init() { return this; }
  async _post(text) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await this.fetchImpl(`${this.baseUrl}/embeddings`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.apiKey}` },
        body: JSON.stringify({ model: this.model, input: text }),
        signal: controller.signal,
      });
    } catch (err) {
      // Task 5: сетевые ошибки/таймауты — только error_class enum (SEC-4b:
      // тело/сообщение ошибки в лог не попадают).
      this.logWarn?.("memory:http.error", { error_class: "network", retryable: true });
      throw new EmbedRetryableError(`openai embeddings network error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      clearTimeout(timer);
    }
  }
  async embed(text) {
    const t0 = Date.now();
    const hit = this.cache.get(text);
    if (hit) {
      this._cacheHits++;
      this._embedCalls++;
      this.logDebug?.("memory:embed.duration", { provider: "external", duration_ms: Date.now() - t0, cache_hit: true, len_bucket: bucket(text.length) });
      this._maybeCacheStats();
      return hit;
    }
    this._embedCalls++;
    const res = await this._post(text);
    if (!res.ok) {
      // Task 5: http.error — только класс статуса (5xx/auth/4xx), без тела.
      if (res.status >= 500) {
        this.logWarn?.("memory:http.error", { http_status_class: "5xx", retryable: true });
        throw new EmbedRetryableError(`openai embeddings ${res.status} ${res.statusText}: ${(await res.text()).slice(0, 200)}`);
      }
      if (res.status === 401 || res.status === 403) {
        this.logWarn?.("memory:http.error", { http_status_class: "auth", retryable: false });
        throw new Error(`openai embeddings ${res.status} ${res.statusText}: ${(await res.text()).slice(0, 200)}`);
      }
      this.logWarn?.("memory:http.error", { http_status_class: "4xx", retryable: false });
      throw new Error(`openai embeddings ${res.status} ${res.statusText}: ${(await res.text()).slice(0, 200)}`);
    }
    const data = await res.json();
    const vec = new Float32Array(data.data[0].embedding);
    if (this._dim != null && vec.length !== this._dim) {
      throw new Error(`openai embeddings dimension mismatch (api=${vec.length}, config=${this._dim}) — см. manual_docs/how-to/enable-memory.md`);
    }
    this._dim = this._dim ?? vec.length;
    this.cache.set(text, vec);
    this.logDebug?.("memory:embed.duration", { provider: "external", duration_ms: Date.now() - t0, cache_hit: false, len_bucket: bucket(text.length) });
    this._maybeCacheStats();
    return vec;
  }
  // Task 5: агрегат cache_stats (info) — раз в 10 embed-вызовов, чтобы не шуметь.
  _maybeCacheStats() {
    if (this._embedCalls % 10 !== 0) return;
    const hitRate = this._embedCalls > 0 ? this._cacheHits / this._embedCalls : 0;
    this.logInfo?.("memory:embed.cache_stats", { hit_rate: hitRate, cache_size: this.cache.size() });
  }
  async probe() {
    let res;
    try {
      res = await this._post("probe");
    } catch (err) {
      // Fix round 1 (C1): error_class enum (SEC-4b) — тело/сообщение ошибки
      // (может содержать host) в аудит-лог не попадает; detail — для тула.
      return { ok: false, hard: false, detail: err instanceof Error ? err.message : String(err), error_class: "network" };
    }
    if (res.status === 401 || res.status === 403) {
      return { ok: false, hard: true, detail: `API-ключ отклонён (${res.status}) — проверьте env ${this.apiKeyEnv}`, error_class: "auth" };
    }
    if (res.status === 404) {
      return { ok: false, hard: true, detail: "модель/URL не найдены (404) — проверьте model/base_url", error_class: "not_found" };
    }
    if (!res.ok) return { ok: false, hard: false, detail: `API временно недоступен (${res.status})`, error_class: "http_5xx" };
    const data = await res.json();
    const dim = data.data[0].embedding.length;
    if (this._dim != null && dim !== this._dim) {
      return { ok: false, hard: true, detail: `dimension mismatch (api=${dim}, config=${this._dim})`, error_class: "dim_mismatch" };
    }
    return { ok: true, hard: false, detail: `OK (dim ${dim})` };
  }
}