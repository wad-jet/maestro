import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";

/**
 * Lazy-load better-sqlite3, resolving from `moduleDir/node_modules`
 * (self-provisioned module) with a fallback to the bare specifier (repo
 * node_modules — tests / dev). Плагин живёт в кэше без node_modules, поэтому
 * статический импорт не резолвится; зависимость ставится в module_dir.
 * ESM не поддерживает directory-import, поэтому entry резолвится через
 * createRequire (уважает package.json main/exports) и импортируется по файлу.
 */
async function loadBetterSqlite3(moduleDir) {
  if (moduleDir) {
    try {
      const require = createRequire(join(moduleDir, "package.json"));
      const resolved = require.resolve("better-sqlite3");
      return (await import(pathToFileURL(resolved).href)).default;
    } catch {
      /* fall through to bare import */
    }
  }
  return (await import("better-sqlite3")).default;
}

export class SqliteStorage {
  constructor({ dbPath, modelId, dim, moduleDir }) {
    this.dbPath = dbPath;
    this.modelId = modelId;
    this.dim = dim;
    this.moduleDir = moduleDir;
    this.db = null;
  }

  async init() {
    const Database = await loadBetterSqlite3(this.moduleDir);
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
      db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
        session_id UNINDEXED,
        key UNINDEXED,
        title,
        summary,
        decisions
      )`);
      // One-time backfill: index pre-existing memory rows (upgrade path). Guarded by
      // a meta flag so re-init is idempotent (FTS5 has no unique constraint on
      // session_id, so a plain INSERT would duplicate on every run).
      const backfilled = db.prepare("SELECT value FROM meta WHERE name = 'fts_backfilled'").get();
      if (!backfilled) {
        const n = db.prepare(
          `INSERT INTO memory_fts (session_id, key, title, summary, decisions)
           SELECT session_id, key, title, summary, decisions FROM memory`,
        ).run();
        db.prepare("INSERT OR REPLACE INTO meta (name, value) VALUES ('fts_backfilled', '1')").run();
        if (n.changes > 0) {
          console.error(`[memory] FTS backfill indexed ${n.changes} entries`);
        }
      }
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
    const ftsDel = this.db.prepare("DELETE FROM memory_fts WHERE session_id = ?");
    const ftsIns = this.db.prepare(
      "INSERT INTO memory_fts (session_id, key, title, summary, decisions) VALUES (?, ?, ?, ?, ?)",
    );
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
        // Sync FTS: delete-then-insert keeps exactly one row per session_id.
        ftsDel.run(e.session_id);
        ftsIns.run(e.session_id, e.key, e.title, e.summary, e.decisions.join(" "));
      }
    });
    tx(entries);
  }

  async search(embedding, { top_k = 3, min_score = 0, key, query }) {
    if (typeof key !== "string" || !key) {
      throw new Error("search: key required");
    }
    if (embedding.length !== this.dim) {
      throw new Error(`embedding length ${embedding.length} does not match expected dimension ${this.dim}`);
    }
    const rows = this.db.prepare("SELECT * FROM memory WHERE key = ?").all(key);
    const vectorHits = rows.map((r) => {
      const vec = new Float32Array(r.embedding.buffer, r.embedding.byteOffset, r.embedding.byteLength / 4);
      const score = cosine(embedding, vec);
      return { entry: { ...r, embedding: undefined, decisions: JSON.parse(r.decisions) }, score };
    }).filter((h) => h.score >= min_score).sort((a, b) => b.score - a.score).slice(0, top_k);

    // No text query → vector-only path (backward compatible).
    if (typeof query !== "string" || !query.trim()) {
      return vectorHits;
    }

    // FTS hits (best-first by bm25 rank).
    const tokens = query.split(/\s+/).filter(Boolean);
    let ftsHits = [];
    if (tokens.length) {
      const match = tokens.map((t) => `"${t.replace(/"/g, '""')}"*`).join(" ");
      try {
        const ftsRows = this.db.prepare(
          "SELECT session_id, bm25(memory_fts) AS rank FROM memory_fts WHERE memory_fts MATCH ? AND key = ?",
        ).all(match, key);
        ftsHits = ftsRows.slice(0, top_k);
      } catch (err) {
        console.error(`[memory] FTS MATCH failed, falling back to vector-only: ${err.message}`);
      }
    }

    // RRF fusion (k=60): merge vector + FTS ranks.
    const K = 60;
    const merged = new Map(); // session_id -> { rrf, entry, score }
    vectorHits.forEach((h, i) => {
      const cur = merged.get(h.entry.session_id) || { rrf: 0, entry: h.entry, score: h.score };
      cur.rrf += 1 / (K + i + 1);
      merged.set(h.entry.session_id, cur);
    });
    for (let i = 0; i < ftsHits.length; i++) {
      const r = ftsHits[i];
      const cur = merged.get(r.session_id) || { rrf: 0, entry: null, score: 0.5 };
      cur.rrf += 1 / (K + i + 1);
      if (!cur.entry) {
        cur.entry = await this.get(r.session_id);
        cur.score = 0.5; // FTS-only hit: low display score
      }
      merged.set(r.session_id, cur);
    }

    return [...merged.values()]
      .filter((h) => h.entry)
      .sort((a, b) => b.rrf - a.rrf)
      .slice(0, top_k)
      .map((h) => ({ entry: h.entry, score: h.score }));
  }

  async delete(session_id) {
    this.db.prepare("DELETE FROM memory WHERE session_id = ?").run(session_id);
    this.db.prepare("DELETE FROM memory_fts WHERE session_id = ?").run(session_id);
  }

  async deleteByFilter({ key, session_id, author, before }) {
    if (typeof key !== "string" || !key) throw new Error("deleteByFilter: key required");
    const conds = ["key = @key"];
    const params = { key };
    if (session_id !== undefined) { conds.push("session_id = @session_id"); params.session_id = session_id; }
    if (author !== undefined) { conds.push("author = @author"); params.author = author; }
    if (before !== undefined) { conds.push("time_last <= @before"); params.before = before; }
    const where = conds.join(" AND ");
    const ids = this.db.prepare(`SELECT session_id FROM memory WHERE ${where}`).all(params).map((r) => r.session_id);
    const info = this.db.prepare(`DELETE FROM memory WHERE ${where}`).run(params);
    if (ids.length) {
      this.db.prepare(`DELETE FROM memory_fts WHERE session_id IN (${ids.map(() => "?").join(",")})`).run(...ids);
    }
    return info.changes;
  }

  async prune({ key, olderThanDays }) {
    if (typeof key !== "string" || !key) throw new Error("prune: key required");
    const cutoff = Date.now() - olderThanDays * 86400_000;
    const ids = this.db.prepare("SELECT session_id FROM memory WHERE key = ? AND time_last < ?").all(key, cutoff).map((r) => r.session_id);
    const info = this.db.prepare("DELETE FROM memory WHERE key = ? AND time_last < ?").run(key, cutoff);
    if (ids.length) {
      this.db.prepare(`DELETE FROM memory_fts WHERE session_id IN (${ids.map(() => "?").join(",")})`).run(...ids);
    }
    return info.changes;
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
