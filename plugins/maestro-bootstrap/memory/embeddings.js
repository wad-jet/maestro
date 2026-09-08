export class Embedder {
  constructor({ model, cacheDir, moduleDir, _pipeline, _dim, _importImpl } = {}) {
    this.model = model;
    this.cacheDir = cacheDir;
    this.moduleDir = moduleDir;
    this.pipeline = _pipeline ?? null;
    this._dim = _dim ?? null;
    this.ready = false;
    this._importImpl = _importImpl ?? null;
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
    if (!this.ready) await this.init();
    const out = await this.pipeline([text], { pooling: "mean", normalize: true });
    return new Float32Array(out.data);
  }
  get dim() { return this._dim; }
  get modelId() { return this.model; }
}
