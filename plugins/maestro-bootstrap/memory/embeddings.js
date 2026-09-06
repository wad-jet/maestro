export class Embedder {
  constructor({ model, cacheDir, moduleDir, _pipeline, _dim }) {
    this.model = model;
    this.cacheDir = cacheDir;
    this.moduleDir = moduleDir;
    this.pipeline = _pipeline ?? null;
    this._dim = _dim ?? null;
    this.ready = false;
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
