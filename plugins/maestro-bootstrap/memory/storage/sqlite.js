import Database from "better-sqlite3";

export class SqliteStorage {
  constructor({ dbPath, modelId, dim }) {
    this.dbPath = dbPath;
    this.modelId = modelId;
    this.dim = dim;
    this.db = null;
  }

  async init() {
    let db = new Database(this.dbPath);
    try {
      db.pragma("journal_mode = WAL");
      db.pragma("busy_timeout = 5000");
      db.exec(`CREATE TABLE IF NOT EXISTS memory (
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
      db.exec(`CREATE TABLE IF NOT EXISTS meta (name TEXT PRIMARY KEY, value TEXT NOT NULL)`);
      db.exec(`CREATE INDEX IF NOT EXISTS memory_key ON memory (key)`);
      const row = db.prepare("SELECT value FROM meta WHERE name = 'model_id'").get();
      if (row && row.value !== this.modelId) {
        db.close();
        throw new Error(`model mismatch: stored=${row.value} expected=${this.modelId} — переиндексируйте (см. how-to/enable-memory)`);
      }
      db.prepare("INSERT OR IGNORE INTO meta (name, value) VALUES ('model_id', ?)").run(this.modelId);
      const dimRow = db.prepare("SELECT value FROM meta WHERE name = 'dim'").get();
      if (dimRow && parseInt(dimRow.value, 10) !== this.dim) {
        db.close();
        throw new Error(`dimension mismatch: stored=${dimRow.value} expected=${this.dim} — переиндексируйте (см. how-to/enable-memory)`);
      }
      db.prepare("INSERT OR IGNORE INTO meta (name, value) VALUES ('dim', ?)").run(this.dim);
      this.db = db;
    } catch (err) {
      if (!db?.closed) db.close();
      throw err;
    }
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
        if (e.embedding.length !== this.dim) {
          throw new Error(`embedding length ${e.embedding.length} does not match expected dimension ${this.dim}`);
        }
        if (e.model_id !== this.modelId) {
          throw new Error(`model_id mismatch: entry=${e.model_id} storage=${this.modelId}`);
        }
        ins.run({
          session_id: e.session_id,
          key: e.key,
          origin_project_hash: e.origin_project_hash,
          title: e.title,
          summary: e.summary,
          decisions: JSON.stringify(e.decisions),
          embedding: Buffer.from(e.embedding.buffer, e.embedding.byteOffset, e.embedding.byteLength),
          model_id: e.model_id,
          author: e.author,
          time_first: e.time_first,
          time_last: e.time_last,
          version: e.version,
        });
      }
    });
    tx(entries);
  }

  async search(embedding, { top_k = 3, min_score = 0, key }) {
    if (typeof key !== "string" || !key) {
      throw new Error("search: key required");
    }
    const rows = this.db.prepare("SELECT * FROM memory WHERE key = ?").all(key);
    if (embedding.length !== this.dim) {
      throw new Error(`embedding length ${embedding.length} does not match expected dimension ${this.dim}`);
    }
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

  async get(session_id) {
    const r = this.db.prepare("SELECT * FROM memory WHERE session_id = ?").get(session_id);
    if (!r) return null;
    return { ...r, embedding: undefined, decisions: JSON.parse(r.decisions) };
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
