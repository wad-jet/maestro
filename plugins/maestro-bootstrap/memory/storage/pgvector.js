import { resolveSearchKeys } from "../project.js";

// Whitelist of scan-able columns (mirrors the table schema). Default scan
// returns everything EXCEPT embedding (large); embedding is opt-in.
const SCAN_FIELDS = [
  "session_id", "key", "origin_project_hash", "title", "summary", "decisions",
  "author", "time_first", "time_last", "version", "model_id", "embedding",
];
const DEFAULT_SCAN_FIELDS = SCAN_FIELDS.filter((f) => f !== "embedding");

export class PgVectorStorage {
  constructor({ pool, table, dim, modelId }) {
    this.pool = pool;
    this.table = table;
    this.dim = dim;
    this.modelId = modelId;
  }
  async init() {
    try {
      await this.pool.query(`CREATE EXTENSION IF NOT EXISTS vector`);
    } catch {
      throw new Error("CREATE EXTENSION vector — требуется расширение pgvector (см. how-to)");
    }
    await this.pool.query(`CREATE TABLE IF NOT EXISTS ${this.table} (
      session_id TEXT PRIMARY KEY,
      key TEXT NOT NULL,
      origin_project_hash TEXT NOT NULL,
      title TEXT NOT NULL,
      summary TEXT NOT NULL,
      decisions TEXT NOT NULL,
      embedding vector(${this.dim}) NOT NULL,
      model_id TEXT NOT NULL,
      author TEXT NOT NULL,
      time_first BIGINT NOT NULL,
      time_last BIGINT NOT NULL,
      version INT NOT NULL
    )`);
    await this.pool.query(`CREATE INDEX IF NOT EXISTS ${this.table}_key_idx ON ${this.table} (key)`);
  }
  async dispose() { await this.pool.end?.(); }
  async upsert(entries) {
    // M-7: atomic per-file import — wrap the whole batch in a transaction so a
    // mid-batch failure rolls back everything (nothing partially imported).
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      for (const e of entries) {
        if (e.embedding.length !== this.dim) {
          throw new Error(`embedding length ${e.embedding.length} does not match expected dimension ${this.dim}`);
        }
        if (e.model_id !== this.modelId) {
          throw new Error(`model_id mismatch: expected=${this.modelId} got=${e.model_id} — переиндексируйте (см. how-to)`);
        }
        await client.query(
          `INSERT INTO ${this.table} (session_id, key, origin_project_hash, title, summary, decisions, embedding, model_id, author, time_first, time_last, version)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
           ON CONFLICT (session_id) DO UPDATE SET title=$4, summary=$5, decisions=$6, embedding=$7, time_last=$11, version=$12`,
          [e.session_id, e.key, e.origin_project_hash, e.title, e.summary, JSON.stringify(e.decisions), `[${Array.from(e.embedding)}]`, e.model_id, e.author, e.time_first, e.time_last, e.version]
        );
      }
      await client.query("COMMIT");
    } catch (err) {
      try { await client.query("ROLLBACK"); } catch { /* ignore */ }
      throw err;
    } finally {
      client.release();
    }
  }
  async search(embedding, { top_k = 3, min_score = 0, key, date_from, date_to, author, project }) {
    // B2: cross-project opt-in — key IN (current + project key).
    const keys = resolveSearchKeys({ key, project });
    const conds = [];
    const params = [`[${Array.from(embedding)}]`];
    let i = 2;
    if (keys.length === 1) {
      conds.push(`key = $${i++}`);
      params.push(keys[0]);
    } else {
      conds.push(`key IN (${keys.map(() => `$${i++}`).join(", ")})`);
      params.push(...keys);
    }
    if (date_from !== undefined) { conds.push(`time_last >= $${i++}`); params.push(date_from); }
    if (date_to !== undefined) { conds.push(`time_last <= $${i++}`); params.push(date_to); }
    if (author !== undefined) { conds.push(`author = $${i++}`); params.push(author); }
    conds.push(`1 - (embedding <=> $1) >= $${i++}`);
    params.push(min_score);
    const res = await this.pool.query(
      `SELECT session_id, key, origin_project_hash, title, summary, decisions, model_id, author, time_first, time_last, version,
              1 - (embedding <=> $1) AS score
       FROM ${this.table}
       WHERE ${conds.join(" AND ")}
       ORDER BY embedding <=> $1
       LIMIT $${i}`,
      [...params, top_k]
    );
    return res.rows.map((r) => ({ entry: { ...r, embedding: undefined, decisions: JSON.parse(r.decisions) }, score: Number(r.score) }));
  }
  async delete(session_id) { await this.pool.query(`DELETE FROM ${this.table} WHERE session_id = $1`, [session_id]); }
  async deleteByFilter({ key, session_id, author, before }) {
    if (typeof key !== "string" || !key) throw new Error("deleteByFilter: key required");
    const conds = ["key = $1"];
    const params = [key];
    let i = 2;
    if (session_id !== undefined) { conds.push(`session_id = $${i++}`); params.push(session_id); }
    if (author !== undefined) { conds.push(`author = $${i++}`); params.push(author); }
    if (before !== undefined) { conds.push(`time_last <= $${i++}`); params.push(before); }
    const res = await this.pool.query(`DELETE FROM ${this.table} WHERE ${conds.join(" AND ")} RETURNING session_id`, params);
    return res.rows.length;
  }
  async prune({ key, olderThanDays }) {
    if (typeof key !== "string" || !key) throw new Error("prune: key required");
    const cutoff = Date.now() - olderThanDays * 86400_000;
    return this.deleteByFilter({ key, before: cutoff });
  }
  async stats({ key }) {
    if (typeof key !== "string" || !key) throw new Error("stats: key required");
    const r = await this.pool.query(`SELECT count(*) FROM ${this.table} WHERE key=$1`, [key]);
    return { entries: Number(r.rows[0].count) };
  }
  async scan({ key, fields }) {
    if (typeof key !== "string" || !key) throw new Error("scan: key required");
    const cols = (fields && fields.length ? fields : DEFAULT_SCAN_FIELDS).filter((f) => SCAN_FIELDS.includes(f));
    if (!cols.length) throw new Error("scan: no valid fields requested");
    const res = await this.pool.query(`SELECT ${cols.join(", ")} FROM ${this.table} WHERE key=$1`, [key]);
    return res.rows.map((r) => {
      if ("decisions" in r) r.decisions = JSON.parse(r.decisions);
      // C-1: pgvector returns embedding as a string "[0.1,0.2,0.3]"; normalize to Float32Array.
      if ("embedding" in r && typeof r.embedding === "string") {
        r.embedding = new Float32Array(JSON.parse(r.embedding));
      }
      return r;
    });
  }
  async get(session_id) {
    const r = await this.pool.query(`SELECT * FROM ${this.table} WHERE session_id = $1`, [session_id]);
    if (!r.rows[0]) return null;
    return { ...r.rows[0], embedding: undefined, decisions: JSON.parse(r.rows[0].decisions) };
  }
}
