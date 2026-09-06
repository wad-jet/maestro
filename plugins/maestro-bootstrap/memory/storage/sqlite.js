import Database from "better-sqlite3";

export class SqliteStorage {
  constructor({ dbPath, modelId, dim }) {
    this.dbPath = dbPath;
    this.modelId = modelId;
    this.dim = dim;
    this.db = null;
  }

  async init() {
    this.db = new Database(this.dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("busy_timeout = 5000");
    this.db.exec(`CREATE TABLE IF NOT EXISTS memory (
      session_id TEXT PRIMARY KEY,
      key TEXT NOT NULL,
      origin_project_hash TEXT NOT NULL,
      title TEXT NOT NULL,
      summary TEXT NOT NULL,
      decisions TEXT NOT NULL,
      embedding BLOB NOT NULL,
      model_id TEXT NOT NULL,
      author TEXT NOT NULL,
      time_first INTEGER NOT NULL,
      time_last INTEGER NOT NULL,
      version INTEGER NOT NULL
    )`);
    this.db.exec(`CREATE TABLE IF NOT EXISTS meta (name TEXT PRIMARY KEY, value TEXT NOT NULL)`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS memory_key ON memory (key)`);
    const row = this.db.prepare("SELECT value FROM meta WHERE name = 'model_id'").get();
    if (row && row.value !== this.modelId) {
      this.db.close();
      this.db = null;
      throw new Error(`model mismatch: stored=${row.value} expected=${this.modelId}`);
    }
    this.db.prepare("INSERT OR IGNORE INTO meta (name, value) VALUES ('model_id', ?)").run(this.modelId);
  }

  async dispose() {
    this.db?.close();
    this.db = null;
  }

  async upsert(entries) {
    const ins = this.db.prepare(`INSERT OR REPLACE INTO memory
      (session_id, key, origin_project_hash, title, summary, decisions, embedding, model_id, author, time_first, time_last, version)
      VALUES (@session_id, @key, @origin_project_hash, @title, @summary, @decisions, @embedding, @model_id, @author, @time_first, @time_last, @version)`);
    const tx = this.db.transaction((es) => {
      for (const e of es) {
        ins.run({
          ...e,
          embedding: Buffer.from(e.embedding.buffer),
          decisions: JSON.stringify(e.decisions),
        });
      }
    });
    tx(entries);
  }

  async search(embedding, { top_k = 3, min_score = 0, key }) {
    const rows = key !== undefined ? this.db.prepare("SELECT * FROM memory WHERE key = ?").all(key) : this.db.prepare("SELECT * FROM memory").all();
    const hits = rows.map((r) => {
      const vec = new Float32Array(r.embedding.buffer, r.embedding.byteOffset, r.embedding.byteLength / 4);
      const score = cosine(embedding, vec);
      return { entry: { ...r, embedding: undefined, decisions: JSON.parse(r.decisions) }, score };
    }).filter((h) => h.score >= min_score).sort((a, b) => b.score - a.score).slice(0, top_k);
    return hits;
  }

  async delete(session_id) {
    this.db.prepare("DELETE FROM memory WHERE session_id = ?").run(session_id);
  }

  async stats() {
    const r = this.db.prepare("SELECT COUNT(*) c FROM memory").get();
    return { entries: r.c };
  }
}

function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}
