import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { fuseRrf } from "./rrf.js";

// Whitelist of scan-able columns (mirrors the `memory` table schema). Default
// scan returns everything EXCEPT embedding (large); embedding is opt-in.
const SCAN_FIELDS = [
  "session_id", "key", "origin_project_hash", "title", "summary", "decisions",
  "author", "time_first", "time_last", "version", "model_id", "embedding",
];
const DEFAULT_SCAN_FIELDS = SCAN_FIELDS.filter((f) => f !== "embedding");

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
      // session_id, so a plain INSERT would duplicate on every run). decisions is
      // stored as JSON in `memory`; the FTS column mirrors the upsert path
      // (decisions.join(" ")), so backfill parses in JS rather than copying raw JSON.
      const backfilled = db.prepare("SELECT value FROM meta WHERE name = 'fts_backfilled'").get();
      if (!backfilled) {
        const rows = db.prepare("SELECT session_id, key, title, summary, decisions FROM memory").all();
        const ftsIns = db.prepare(
          "INSERT INTO memory_fts (session_id, key, title, summary, decisions) VALUES (?, ?, ?, ?, ?)",
        );
        const tx = db.transaction((rs) => {
          for (const r of rs) {
            // Upgrade-path robustness: a legacy row may hold malformed decisions
            // JSON; fall back to an empty array rather than aborting the backfill.
            let parsed;
            try { parsed = JSON.parse(r.decisions); } catch { parsed = []; }
            ftsIns.run(r.session_id, r.key, r.title, r.summary, parsed.join(" "));
          }
          db.prepare("INSERT OR REPLACE INTO meta (name, value) VALUES ('fts_backfilled', '1')").run();
        });
        tx(rows);
        if (rows.length > 0) {
          console.error(`[memory] FTS backfill indexed ${rows.length} entries`);
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

  async search(embedding, { top_k = 3, min_score = 0, key, date_from, date_to, author, project, query }) {
    // B2: cross-project search is centralized-only (per-key sqlite files would
    // require opening sibling DBs — new concurrency surface). Explicit error.
    if (project !== undefined && project !== null && project !== "") {
      throw new Error("кросс-проектный поиск доступен только для централизованных бэкендов");
    }
    if (typeof key !== "string" || !key) {
      throw new Error("search: key required");
    }
    if (embedding.length !== this.dim) {
      throw new Error(`embedding length ${embedding.length} does not match expected dimension ${this.dim}`);
    }
    const conds = ["key = ?"];
    const params = [key];
    if (date_from !== undefined) { conds.push("time_last >= ?"); params.push(date_from); }
    if (date_to !== undefined) { conds.push("time_last <= ?"); params.push(date_to); }
    if (author !== undefined) { conds.push("author = ?"); params.push(author); }
    const rows = this.db.prepare(`SELECT * FROM memory WHERE ${conds.join(" AND ")}`).all(...params);
    const vectorHits = rows.map((r) => {
      const vec = new Float32Array(r.embedding.buffer, r.embedding.byteOffset, r.embedding.byteLength / 4);
      const score = cosine(embedding, vec);
      return { entry: { ...r, embedding: undefined, decisions: JSON.parse(r.decisions) }, score };
    }).filter((h) => h.score >= min_score).sort((a, b) => b.score - a.score).slice(0, top_k);

    // No text query → vector-only path (backward compatible).
    if (typeof query !== "string" || !query.trim()) {
      return vectorHits;
    }

    // FTS hits (best-first by bm25 rank — SMALLER bm25 = better match, so ASC).
    // time_last/author live only in `memory`, so date/author filters join back
    // to it (FTS schema unchanged).
    const tokens = query.split(/\s+/).filter(Boolean);
    let ftsHits = [];
    if (tokens.length) {
      const match = tokens.map((t) => `"${t.replace(/"/g, '""')}"*`).join(" ");
      const ftsConds = ["memory_fts MATCH ?", "memory.key = ?"];
      const ftsParams = [match, key];
      if (date_from !== undefined) { ftsConds.push("memory.time_last >= ?"); ftsParams.push(date_from); }
      if (date_to !== undefined) { ftsConds.push("memory.time_last <= ?"); ftsParams.push(date_to); }
      if (author !== undefined) { ftsConds.push("memory.author = ?"); ftsParams.push(author); }
      try {
        const ftsRows = this.db.prepare(
          `SELECT memory_fts.session_id, bm25(memory_fts) AS rank
           FROM memory_fts JOIN memory ON memory.session_id = memory_fts.session_id
           WHERE ${ftsConds.join(" AND ")}
           ORDER BY bm25(memory_fts)`,
        ).all(...ftsParams);
        ftsHits = ftsRows.slice(0, top_k);
      } catch (err) {
        console.error(`[memory] FTS MATCH failed, falling back to vector-only: ${err.message}`);
      }
    }

    // RRF fusion (k=60): merge vector + FTS ranks через общий хелпер.
    return fuseRrf(vectorHits, ftsHits.length ? [ftsHits] : [], { fetchEntry: (sid) => this.get(sid) });
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

  async stats({ key }) {
    if (typeof key !== "string" || !key) throw new Error("stats: key required");
    const r = this.db.prepare("SELECT COUNT(*) c FROM memory WHERE key = ?").get(key);
    return { entries: r.c };
  }

  async scan({ key, fields }) {
    if (typeof key !== "string" || !key) throw new Error("scan: key required");
    const cols = (fields && fields.length ? fields : DEFAULT_SCAN_FIELDS).filter((f) => SCAN_FIELDS.includes(f));
    if (!cols.length) throw new Error("scan: no valid fields requested");
    const rows = this.db.prepare(`SELECT ${cols.join(", ")} FROM memory WHERE key = ?`).all(key);
    return rows.map((r) => {
      if ("decisions" in r) r.decisions = JSON.parse(r.decisions);
      return r;
    });
  }

  async get(session_id) {
    const r = this.db.prepare("SELECT * FROM memory WHERE session_id = ?").get(session_id);
    if (!r) return null;
    // Upgrade-path robustness: guard malformed decisions JSON (used by the FTS
    // merge line-fetch for FTS-only hits).
    let parsed;
    try { parsed = JSON.parse(r.decisions); } catch { parsed = []; }
    return { ...r, embedding: undefined, decisions: parsed };
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
