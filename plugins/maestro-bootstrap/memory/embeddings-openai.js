import { makeBoundedMap } from "../core.js";

export class EmbedRetryableError extends Error {
  constructor(message) {
    super(message);
    this.name = "EmbedRetryableError";
    this.retryable = true;
  }
}

export class OpenAiEmbedder {
  constructor({ model, baseUrl, apiKey, dim = null, apiKeyEnv = null, timeoutMs = 15000, fetchImpl = globalThis.fetch, cache = makeBoundedMap(256) }) {
    this.model = model;
    this.baseUrl = baseUrl;
    this.apiKey = apiKey;
    this.apiKeyEnv = apiKeyEnv;
    this._dim = dim;
    this.timeoutMs = timeoutMs;
    this.fetchImpl = fetchImpl;
    this.cache = cache;
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
      throw new EmbedRetryableError(`openai embeddings network error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      clearTimeout(timer);
    }
  }
  async embed(text) {
    const hit = this.cache.get(text);
    if (hit) return hit;
    const res = await this._post(text);
    if (!res.ok) {
      if (res.status >= 500) {
        throw new EmbedRetryableError(`openai embeddings ${res.status} ${res.statusText}: ${(await res.text()).slice(0, 200)}`);
      }
      throw new Error(`openai embeddings ${res.status} ${res.statusText}: ${(await res.text()).slice(0, 200)}`);
    }
    const data = await res.json();
    const vec = new Float32Array(data.data[0].embedding);
    if (this._dim != null && vec.length !== this._dim) {
      throw new Error(`openai embeddings dimension mismatch (api=${vec.length}, config=${this._dim}) — см. manual_docs/how-to/enable-memory.md`);
    }
    this._dim = this._dim ?? vec.length;
    this.cache.set(text, vec);
    return vec;
  }
  async probe() {
    let res;
    try {
      res = await this._post("probe");
    } catch (err) {
      return { ok: false, hard: false, detail: err instanceof Error ? err.message : String(err) };
    }
    if (res.status === 401 || res.status === 403) {
      return { ok: false, hard: true, detail: `API-ключ отклонён (${res.status}) — проверьте env ${this.apiKeyEnv}` };
    }
    if (res.status === 404) {
      return { ok: false, hard: true, detail: "модель/URL не найдены (404) — проверьте model/base_url" };
    }
    if (!res.ok) return { ok: false, hard: false, detail: `API временно недоступен (${res.status})` };
    const data = await res.json();
    const dim = data.data[0].embedding.length;
    if (this._dim != null && dim !== this._dim) {
      return { ok: false, hard: true, detail: `dimension mismatch (api=${dim}, config=${this._dim})` };
    }
    return { ok: true, hard: false, detail: `OK (dim ${dim})` };
  }
}