import { resolveSearchKeys } from "../project.js";

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
    for (const e of entries) {
      if (e.embedding.length !== this.dim) {
        throw new Error(`embedding length ${e.embedding.length} does not match expected dimension ${this.dim}`);
      }
      if (e.model_id !== this.modelId) {
        throw new Error(`model_id mismatch: expected=${this.modelId} got=${e.model_id} — переиндексируйте (см. how-to)`);
      }
      await this.pool.query(
        `INSERT INTO ${this.table} (session_id, key, origin_project_hash, title, summary, decisions, embedding, model_id, author, time_first, time_last, version)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         ON CONFLICT (session_id) DO UPDATE SET title=$4, summary=$5, decisions=$6, embedding=$7, time_last=$11, version=$12`,
        [e.session_id, e.key, e.origin_project_hash, e.title, e.summary, JSON.stringify(e.decisions), `[${Array.from(e.embedding)}]`, e.model_id, e.author, e.time_first, e.time_last, e.version]
      );
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
  async stats() { const r = await this.pool.query(`SELECT count(*) FROM ${this.table}`); return { entries: Number(r.rows[0].count) }; }
  async get(session_id) {
    const r = await this.pool.query(`SELECT * FROM ${this.table} WHERE session_id = $1`, [session_id]);
    if (!r.rows[0]) return null;
    return { ...r.rows[0], embedding: undefined, decisions: JSON.parse(r.rows[0].decisions) };
  }
}
