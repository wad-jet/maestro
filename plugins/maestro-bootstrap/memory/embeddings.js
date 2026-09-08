// Task 5: биннинг длины текста для аудит-лога (spec §3) — бакеты вместо
// точного значения (SEC-4b: len не логируется как raw).
export function bucket(len) {
  if (len < 100) return "<100";
  if (len <= 500) return "100-500";
  if (len <= 2000) return "500-2000";
  return ">2000";
}

export class Embedder {
  constructor({ model, cacheDir, moduleDir, _pipeline, _dim, _importImpl, logDebug = () => {} } = {}) {
    this.model = model;
    this.cacheDir = cacheDir;
    this.moduleDir = moduleDir;
    this.pipeline = _pipeline ?? null;
    this._dim = _dim ?? null;
    this.ready = false;
    this._importImpl = _importImpl ?? null;
    // Task 5: аудит-лог (spec §4.3) — debug-события embedder; default noop.
    this.logDebug = logDebug;
  }
  async probe() {
    const imp = this._importImpl ?? (() => import(`${this.moduleDir}/node_modules/@huggingface/transformers`));
    try {
      await imp();
    } catch {
      return { ok: false, hard: true, detail: `transformers не установлен — выполните npm install в ${this.moduleDir} (см. manual_docs/how-to/enable-memory.md)` };
    }
    return { ok: true, hard: false, detail: "зависимость на месте; загрузка модели — лениво (первый embed)" };
  }
  async init() {
    if (!this.pipeline) {
      let transformers;
      try {
        transformers = await import(`${this.moduleDir}/node_modules/@huggingface/transformers`);
      } catch {
        throw new Error(`memory: transformers not installed — run \`npm install\` in ${this.moduleDir} (см. manual_docs/how-to/enable-memory.md)`);
      }
      this.pipeline = await transformers.pipeline("feature-extraction", this.model, { cache_dir: this.cacheDir, dtype: "q8" });
    }
    const out = await this.pipeline(["warmup"], { pooling: "mean", normalize: true });
    this._dim = this._dim ?? out.data.length;
    this.ready = true;
  }
  async embed(text) {
    // Task 5: замер duration для memory:embed.duration (только успех; probe — отдельно).
    const t0 = Date.now();
    if (!this.ready) await this.init();
    const out = await this.pipeline([text], { pooling: "mean", normalize: true });
    // Локальный Embedder текстового кэша не имеет → cache_hit не логируется.
    this.logDebug?.("memory:embed.duration", { provider: "local", duration_ms: Date.now() - t0, len_bucket: bucket(text.length) });
    return new Float32Array(out.data);
  }
  get dim() { return this._dim; }
  get modelId() { return this.model; }
}
