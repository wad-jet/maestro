import { join, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { readdir } from "node:fs/promises";
import { rmSync } from "node:fs";
import { fuseRrf } from "./rrf.js";
import { resolveSearchKeys, prefixesOf } from "../project.js";
import { sanitizeDirName } from "../config.js";
import { timed } from "../storage.js";

// Селектор sqlite-драйвера по рантайму:
//  - Bun (opencode runtime): better-sqlite3 не поддерживается (oven-sh/bun#4290),
//    а `node:sqlite` через process.getBuiltinModule в сборке opencode отсутствует
//    (проверено live) → встроенный `bun:sqlite` (ядро Bun, есть всегда),
//    обёрнутый в better-sqlite3-совместимый шим.
//  - Node: better-sqlite3 как раньше (тесты/dev).
//  - forceDriver (тесты): "node:sqlite" | "bun:sqlite" | "better-sqlite3".
export async function loadSqliteDriver(moduleDir, { force = null } = {}) {
  if (force === "node:sqlite") return makeNodeSqliteDatabase();
  if (force === "bun:sqlite") return makeBunSqliteDatabase();
  if (process.versions.bun) {
    try {
      return await makeBunSqliteDatabase();
    } catch {
      return makeNodeSqliteDatabase();
    }
  }
  return loadBetterSqlite3(moduleDir);
}

// Шим: better-sqlite3-совместимая поверхность поверх bun:sqlite Database.
// bun:sqlite — встроенный модуль ядра Bun (dynamic import недоступен в Node →
// только под Bun). Нативный API близок к better-sqlite3: exec/prepare/close,
// transaction(fn) (BEGIN/COMMIT/ROLLBACK сам), BLOB→Uint8Array, FTS5+bm25.
// Отличия от better-sqlite3/node:sqlite, компенсируемые здесь:
//  - нет pragma() → exec("PRAGMA ...");
//  - нет isOpen/closed → собственный флаг;
//  - named params НЕ матчатся по bare-ключам ({ key } против @key) → prepare()
//    оборачивается и конвертирует bare-ключи объекта в `@`-префикс
//    (код sqlite.js использует bare named-params, как better-sqlite3).
async function makeBunSqliteDatabase() {
  const { Database } = await import("bun:sqlite");
  return class BunSqliteDatabase {
    constructor(path, opts = {}) {
      // readOnly → не создавать файл (несуществующий → CANTOPEN → fail-soft
      // sibling-skip в _collectKey); readwrite → создавать.
      this._db = new Database(path, { readonly: !!opts.readonly, create: !opts.readonly });
      this._closed = false;
    }
    pragma(sql) { this._db.exec(`PRAGMA ${sql}`); }
    exec(sql) { this._db.exec(sql); }
    prepare(sql) {
      const st = this._db.prepare(sql);
      // bun:sqlite named-params матчатся ТОЛЬКО по ключам с префиксом (@key).
      // Код sqlite.js использует bare named-params (как better-sqlite3) →
      // конвертируем единственный объект-аргумент в @-префиксованный объект.
      const namedObj = (args) => {
        if (args.length === 1 && args[0] && typeof args[0] === "object" && !Array.isArray(args[0]) && !(args[0] instanceof Uint8Array)) {
          const out = {};
          for (const [k, v] of Object.entries(args[0])) {
            out[k[0] === "@" || k[0] === "$" || k[0] === ":" ? k : `@${k}`] = v;
          }
          return out;
        }
        return null;
      };
      return {
        get: (...args) => { const o = namedObj(args); return o ? st.get(o) : st.get(...args); },
        all: (...args) => { const o = namedObj(args); return o ? st.all(o) : st.all(...args); },
        run: (...args) => { const o = namedObj(args); return o ? st.run(o) : st.run(...args); },
      };
    }
    transaction(fn) { return this._db.transaction(fn); }
    close() { this._db.close(); this._closed = true; }
    get closed() { return this._closed; }
  };
}

// Шим: better-sqlite3-совместимая поверхность поверх node:sqlite DatabaseSync.
// Ленивый импорт node:sqlite (встроенный модуль; Node ≥22.5) — чтобы не ломать
// Node <22.5 и не грузить на better-sqlite3-пути.
function requireNodeSqlite() {
  const m = globalThis.process?.getBuiltinModule?.("node:sqlite");
  if (!m?.DatabaseSync) throw new Error("[memory] node:sqlite недоступен: запустите opencode на Node ≥22.5");
  return m;
}

function makeNodeSqliteDatabase() {
  return class NodeSqliteDatabase {
    constructor(path, opts = {}) {
      const { DatabaseSync } = requireNodeSqlite();
      this._db = new DatabaseSync(path, { readOnly: !!opts.readonly, open: true });
      this._readonly = !!opts.readonly;
    }
    pragma(sql) { this._db.exec(`PRAGMA ${sql}`); }
    exec(sql) { this._db.exec(sql); }
    prepare(sql) { return this._db.prepare(sql); }
    transaction(fn) {
      return (...args) => {
        this._db.exec("BEGIN");
        try {
          const r = fn(...args);
          this._db.exec("COMMIT");
          return r;
        } catch (e) {
          try { this._db.exec("ROLLBACK"); } catch { /* noop */ }
          throw e;
        }
      };
    }
    close() { this._db.close(); }
    // node:sqlite: db.isOpen — boolean; db.open — метод открытия (не путать!).
    get closed() { return !this._db.isOpen; }
  };
}

// Whitelist of scan-able columns (mirrors the `memory` table schema). Default
// scan returns everything EXCEPT embedding (large); embedding is opt-in.
const SCAN_FIELDS = [
  "session_id", "key", "origin_project_hash", "title", "summary", "decisions",
  "author", "time_first", "time_last", "version", "model_id", "embedding",
  "branch", "head", "merged", "host", "origin_remote", "prefixes",
];
const DEFAULT_SCAN_FIELDS = SCAN_FIELDS.filter((f) => f !== "embedding");

// JSON-массив из строки колонки (prefixes); битый/пустой → [] (guard).
function parseJsonArray(v) {
  if (v == null || v === "") return [];
  try {
    const a = JSON.parse(v);
    return Array.isArray(a) ? a : [];
  } catch {
    return [];
  }
}

// Subtree-цели (spec §3.3): нормализация + дедуп + исключение own key
// (активная нога уже покрывает собственный бакет).
function subtreeTargets(subtree, ownKey) {
  if (!Array.isArray(subtree)) return [];
  const out = [];
  for (const t of subtree) {
    const tt = String(t ?? "").trim().toLowerCase();
    if (!tt || tt === ownKey) continue;
    if (!out.includes(tt)) out.push(tt);
  }
  return out;
}

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
      // I4: actionable-инструкция при недоступности better-sqlite3 в module_dir
      // (дополняет голый ERR_MODULE_NOT_FOUND из index.js «memory: init failed»).
      console.error(`[memory] better-sqlite3 не найден в module_dir. Выполните: cd ${moduleDir} && npm install (см. manual_docs/how-to/enable-memory.md)`);
      /* fall through to bare import */
    }
  }
  return (await import("better-sqlite3")).default;
}

export class SqliteStorage {
  constructor({ dbPath, modelId, dim, moduleDir, log, forceDriver = null, key = null }) {
    this.dbPath = dbPath;
    this.modelId = modelId;
    this.dim = dim;
    this.moduleDir = moduleDir;
    this.forceDriver = forceDriver; // тесты: "node:sqlite" | "better-sqlite3"
    // Task 6: аудит-лог (spec §4.3) — debug/error-события операций; default null (noop).
    this.log = log ?? null;
    // Task 3: ключ (namespace), который держит этот бакет; пишется в meta.key
    // при init (нужен для subtree-перебора соседей). Если не передан — выводится
    // из первой записи бакета.
    this.key = key ?? null;
    this.db = null;
    // Кэш перечня соседних бакетов {dirName → meta.key} (subtree-ноги, §3.3);
    // re-enumerate при промахе ноги.
    this._siblingKeys = null;
  }

  async init() {
    return timed(this.log, "init", () => this._init());
  }

  async _init() {
    const Database = await loadSqliteDriver(this.moduleDir, { force: this.forceDriver });
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
        version INTEGER NOT NULL,
        branch TEXT NOT NULL DEFAULT '',
        head TEXT NOT NULL DEFAULT '',
        merged INTEGER NOT NULL DEFAULT 0,
        host TEXT NOT NULL DEFAULT '',
        origin_remote TEXT NOT NULL DEFAULT '',
        prefixes TEXT NOT NULL DEFAULT ''
      )`);
      // Dev-гигиена: существующие in-repo dev-БД (v2-схема без branch/head/merged)
      // получают колонки идемпотентно (ALTER ADD COLUMN, НЕ миграция данных).
      const cols = db.prepare("PRAGMA table_info(memory)").all().map((c) => c.name);
      if (!cols.includes("branch")) db.exec("ALTER TABLE memory ADD COLUMN branch TEXT NOT NULL DEFAULT ''");
      if (!cols.includes("head")) db.exec("ALTER TABLE memory ADD COLUMN head TEXT NOT NULL DEFAULT ''");
      if (!cols.includes("merged")) db.exec("ALTER TABLE memory ADD COLUMN merged INTEGER NOT NULL DEFAULT 0");
      if (!cols.includes("host")) db.exec("ALTER TABLE memory ADD COLUMN host TEXT NOT NULL DEFAULT ''");
      if (!cols.includes("origin_remote")) db.exec("ALTER TABLE memory ADD COLUMN origin_remote TEXT NOT NULL DEFAULT ''");
      if (!cols.includes("prefixes")) db.exec("ALTER TABLE memory ADD COLUMN prefixes TEXT NOT NULL DEFAULT ''");
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
      // Task 3: штамп ключа бакета в meta.key (subtree-перебор соседей, §3.3).
      // Явный key конструктора приоритетнее; иначе выводим из первой записи
      // (легаси-бакет, открытый новой версией). Пустой бакет без key → штамп
      // появится при первом upsert.
      const effKey = this.key ?? db.prepare("SELECT key FROM memory LIMIT 1").get()?.key;
      if (effKey) db.prepare("INSERT OR REPLACE INTO meta (name, value) VALUES ('key', ?)").run(effKey);
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
    return timed(this.log, "upsert", () => this._upsert(entries));
  }

  async _upsert(entries) {
    const ins = this.db.prepare(`INSERT OR REPLACE INTO memory
      (session_id, key, origin_project_hash, title, summary, decisions, embedding, model_id, author, time_first, time_last, version, branch, head, merged, host, origin_remote, prefixes)
      VALUES (@session_id, @key, @origin_project_hash, @title, @summary, @decisions, @embedding, @model_id, @author, @time_first, @time_last, @version, @branch, @head, @merged, @host, @origin_remote, @prefixes)`);
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
          branch: e.branch ?? "",
          head: e.head ?? "",
          merged: e.merged ?? 0,
          host: e.host ?? "",
          origin_remote: e.origin_remote ?? "",
          prefixes: JSON.stringify(e.prefixes ?? []),
        });
        // Sync FTS: delete-then-insert keeps exactly one row per session_id.
        ftsDel.run(e.session_id);
        ftsIns.run(e.session_id, e.key, e.title, e.summary, e.decisions.join(" "));
      }
    });
    tx(entries);
    // Штамп meta.key от первой записи (бакет без явного key конструктора).
    if (!this.key && entries.length) {
      this.db.prepare("INSERT OR REPLACE INTO meta (name, value) VALUES ('key', ?)").run(entries[0].key);
    }
  }

  async search(embedding, { top_k = 3, min_score = 0, key, date_from, date_to, author, project, query, filterSessionIds, related, subtree }) {
    return timed(this.log, "search", () => this._search(embedding, { top_k, min_score, key, date_from, date_to, author, project, query, filterSessionIds, related, subtree }));
  }

  async _search(embedding, { top_k = 3, min_score = 0, key, date_from, date_to, author, project, query, filterSessionIds, related, subtree }) {
    if (embedding.length !== this.dim) {
      throw new Error(`embedding length ${embedding.length} does not match expected dimension ${this.dim}`);
    }
    // Ключевой набор: активный key + (опционально) соседние project/related-ключи.
    // Без `project`/`related` — ровно один ключ, поведение идентично прежнему.
    const keys = resolveSearchKeys({ key, project, related });
    const opts = { date_from, date_to, author, query, top_k, min_score, filterSessionIds };
    const textLists = [];
    const allVector = [];
    await this._collectKey(keys[0], true, embedding, opts, allVector, textLists); // активный ключ
    for (const k of keys.slice(1)) {
      // I-1 (§6.2): sibling-нога — строго general (merged=1) при любом scope;
      // own-key filterSessionIds в sibling не протекает (иначе sibling пуст).
      await this._collectKey(k, false, embedding, { ...opts, mergedOnly: true, filterSessionIds: undefined }, allVector, textLists);
    }
    // Subtree-ноги (spec §3.3): префикс-цели → merged-only sibling-бакеты по
    // meta.key (=== T или LIKE 'T.%'). Собственный бакет — активная нога.
    const targets = subtreeTargets(subtree, keys[0]);
    if (targets.length) {
      const seen = new Set();
      for (const t of targets) {
        const buckets = await this._siblingBucketsFor(t);
        for (const b of buckets) {
          if (b.key === keys[0] || seen.has(b.key)) continue;
          seen.add(b.key);
          await this._collectKey(b.key, false, embedding, { ...opts, mergedOnly: true, filterSessionIds: undefined }, allVector, textLists);
        }
      }
    }
    allVector.sort((a, b) => b.score - a.score);
    // Единый RRF-фьюжн по всем ключам (модель сверена → скоры сравнимы).
    // I2 (§3.1): единый пост-фильтр min_score после фьюжна (в т.ч. text-only).
    const fused = await fuseRrf(allVector, textLists, { fetchEntry: (sid) => this._get(sid), minScore: min_score });
    return fused.slice(0, top_k);
  }

  /**
   * Бакеты-соседи, попадающие под subtree-цель T: meta.key === T или
   * meta.key LIKE 'T.%'. Кэш `this._siblingKeys` (dirName → key); при промахе
   * ноги — re-enumerate (новый бакет мог появиться после кэширования).
   * @param {string} target  Нормализованный namespace-префикс.
   * @returns {Promise<Array<{dirName: string, key: string}>>}
   */
  async _siblingBucketsFor(target) {
    if (!this._siblingKeys) await this._enumerateSiblingKeys();
    let buckets = this._matchSiblingBuckets(target);
    if (!buckets.length) {
      await this._enumerateSiblingKeys();
      buckets = this._matchSiblingBuckets(target);
    }
    return buckets;
  }

  _matchSiblingBuckets(target) {
    const out = [];
    for (const [dirName, key] of this._siblingKeys) {
      if (key === target || key.startsWith(target + ".")) out.push({ dirName, key });
    }
    return out;
  }

  /**
   * Перечислить соседние бакеты: readdir(<dataDir>/maestro/memory), для каждого
   * каталога открыть memory.db read-only и прочитать meta.key. Fail-soft:
   * непрочитаемый бакет пропускается. Легаси-БД без meta.key невидимы до
   * открытия новой версией (задокументировано, §3.3).
   */
  async _enumerateSiblingKeys() {
    const dataDir = join(dirname(this.dbPath), "..", "..");
    const memoryDir = join(dataDir, "memory");
    const map = new Map();
    let entries = [];
    try {
      entries = await readdir(memoryDir, { withFileTypes: true });
    } catch {
      entries = [];
    }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const p = join(memoryDir, e.name, "memory.db");
      try {
        const Database = await loadSqliteDriver(this.moduleDir, { force: this.forceDriver });
        const sib = new Database(p, { readonly: true, fileMustExist: false });
        try {
          const row = sib.prepare("SELECT value FROM meta WHERE name = 'key'").get();
          if (row?.value) map.set(e.name, row.value);
        } finally {
          sib.close();
        }
      } catch {
        // Fail-soft: непрочитаемый/несуществующий бакет пропускаем.
      }
    }
    this._siblingKeys = map;
  }

  /**
   * Собрать хиты одного ключа (активного или соседнего) и накопить их в
   * общие списки. Активный ключ — через `this.db`; соседний — read-only
   * открытие sibling-БД с fail-soft (любая ошибка → skip + лог).
   * @param {string} k  Ключ.
   * @param {boolean} isActive  Активный ключ (this.db) или соседний.
   * @param {Float32Array} embedding  Вектор запроса.
   * @param {object} opts  date_from/date_to/author/query/top_k/min_score/filterSessionIds/mergedOnly.
   * @param {Array} allVector  Накопитель векторных хитов (мутируется).
   * @param {Array} textLists  Накопитель текстовых списков (мутируется).
   */
  async _collectKey(k, isActive, embedding, opts, allVector, textLists) {
    if (isActive) {
      const { vectorHits, ftsHits } = this._searchIn(this.db, k, embedding, { ...opts, allowFts: true });
      allVector.push(...vectorHits);
      if (ftsHits.length) textLists.push(ftsHits);
      return;
    }
    // Соседний ключ: read-only sibling-БД по layout <dataDir>/maestro/memory/<hash>/memory.db.
    // dataDir = join(dirname(dbPath), "..", "..") — поднимаемся от
    // <dataDir>/maestro/memory/<hash>/memory.db до <dataDir>/maestro.
    const dataDir = join(dirname(this.dbPath), "..", "..");
    const path = join(dataDir, "memory", sanitizeDirName(k), "memory.db");
    const Database = await loadSqliteDriver(this.moduleDir, { force: this.forceDriver });
    let sib;
    try {
      sib = new Database(path, { readonly: true, fileMustExist: false });
    } catch (err) {
      console.error(`[memory] cross-project skip ${k}: ${err.message}`);
      // Task 6 + fix round 1 (I1): аудит-событие промаха cross-project
      // (sibling-БД недоступна); projectKey = hash соседнего ключа (SEC-4b).
      this.log?.debug?.("memory:cross_project_miss", { reason: "unavailable", projectKey: k });
      return;
    }
    try {
      // Сверка модели: несовпадение → косинусы несравнимы → skip + лог.
      const model = sib.prepare("SELECT value FROM meta WHERE name = 'model_id'").get();
      if (model && model.value !== this.modelId) {
        console.error(`[memory] cross-project skip ${k}: model mismatch`);
        // Task 6 + fix round 1 (I1): аудит-событие промаха (модель sibling не
        // совпала); projectKey = hash соседнего ключа.
        this.log?.debug?.("memory:cross_project_miss", { reason: "model_mismatch", projectKey: k });
        return;
      }
      const dim = sib.prepare("SELECT value FROM meta WHERE name = 'dim'").get();
      if (dim && parseInt(dim.value, 10) !== this.dim) {
        console.error(`[memory] cross-project skip ${k}: dim mismatch`);
        // Task 6 + fix round 1 (I1): аудит-событие промаха (размерность sibling
        // не совпала — то же пространство эмбеддингов, что и model_mismatch).
        this.log?.debug?.("memory:cross_project_miss", { reason: "model_mismatch", projectKey: k });
        return;
      }
      // Pre-v3 sibling (без колонки merged) → SQL-ошибка → fail-soft skip (§6.2).
      const cols = sib.prepare("PRAGMA table_info(memory)").all().map((c) => c.name);
      if (opts.mergedOnly && !cols.includes("merged")) {
        console.error(`[memory] cross-project skip ${k}: pre-v3 sibling without merged column`);
        // Task 6 + fix round 1 (I1): аудит-событие промаха (sibling-схема
        // непригодна для merged-ноги); projectKey = hash соседнего ключа.
        this.log?.debug?.("memory:cross_project_miss", { reason: "unavailable", projectKey: k });
        return;
      }
      // Старая БД без FTS-таблицы → vector-only.
      const hasFts = sib.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'memory_fts'").get();
      const { vectorHits, ftsHits } = this._searchIn(sib, k, embedding, { ...opts, allowFts: !!hasFts });
      // Провенанс: помечаем хиты соседнего ключа (transient, не в scan/export).
      const src = (h) => ({ ...h, entry: { ...h.entry, _source_key: k } });
      allVector.push(...vectorHits.map(src));
      if (ftsHits.length) textLists.push(ftsHits.map(src));
    } catch (err) {
      console.error(`[memory] cross-project skip ${k}: ${err.message}`);
    } finally {
      sib.close();
    }
  }

  /**
   * Общий векторный + (опциональный) FTS-поиск по произвольному соединению.
   * Для активного ключа `db === this.db`; для соседнего — read-only sibling.
   * FTS-хиты несут полный entry (подтянутый из `memory` до закрытия БД), чтобы
   * fuseRrf не дёргал fetchEntry по уже закрытому соединению.
   * @param {object} db  better-sqlite3 соединение.
   * @param {string} k  Ключ.
   * @param {Float32Array} embedding  Вектор запроса.
   * @param {object} opts  date_from/date_to/author/query/top_k/min_score/allowFts/filterSessionIds/mergedOnly.
   * @returns {{ vectorHits: Array, ftsHits: Array }}
   */
  _searchIn(db, k, embedding, { top_k = 3, min_score = 0, date_from, date_to, author, query, allowFts = true, filterSessionIds, mergedOnly }) {
    const conds = ["key = ?"];
    const params = [k];
    if (date_from !== undefined) { conds.push("time_last >= ?"); params.push(date_from); }
    if (date_to !== undefined) { conds.push("time_last <= ?"); params.push(date_to); }
    if (author !== undefined) { conds.push("author = ?"); params.push(author); }
    // I-1 (§6.2): sibling-нога — строго general (merged=1).
    if (mergedOnly) conds.push("merged = 1");
    // I1: pre-filter по кандидатам (merged=1 OR head != '') — поиск идёт ТОЛЬКО
    // по ним, чтобы unattributed/out-of-context записи не разбавляли top_k.
    if (filterSessionIds && filterSessionIds.length) {
      conds.push(`session_id IN (${filterSessionIds.map(() => "?").join(",")})`);
      params.push(...filterSessionIds);
    }
    const rows = db.prepare(`SELECT * FROM memory WHERE ${conds.join(" AND ")}`).all(...params);
    const vectorHits = rows.map((r) => {
      const vec = new Float32Array(r.embedding.buffer, r.embedding.byteOffset, r.embedding.byteLength / 4);
      const score = cosine(embedding, vec);
      return { entry: { ...r, embedding: undefined, decisions: JSON.parse(r.decisions), origin_remote: r.origin_remote ?? "", prefixes: parseJsonArray(r.prefixes) }, score };
    }).filter((h) => h.score >= min_score).sort((a, b) => b.score - a.score).slice(0, top_k);

    // Нет текстового запроса или FTS недоступен → vector-only.
    if (!allowFts || typeof query !== "string" || !query.trim()) {
      return { vectorHits, ftsHits: [] };
    }

    // FTS-хиты (best-first по bm25 rank — МЕНЬШЕ bm25 = лучше, поэтому ASC).
    // time_last/author живут только в `memory`, поэтому date/author-фильтры
    // join-ятся обратно к нему (схема FTS не меняется).
    const tokens = query.split(/\s+/).filter(Boolean);
    let ftsHits = [];
    if (tokens.length) {
      // OR-матчинг: bm25 ранжирует многословные совпадения выше;
      // префиксы покрывают русскую морфологию («отчёт*» → «отчёта»),
      // суффиксные формы («памяти») ловит семантическая нога.
      const match = tokens.map((t) => `"${t.replace(/"/g, '""')}"*`).join(" OR ");
      const ftsConds = ["memory_fts MATCH ?", "memory.key = ?"];
      const ftsParams = [match, k];
      if (date_from !== undefined) { ftsConds.push("memory.time_last >= ?"); ftsParams.push(date_from); }
      if (date_to !== undefined) { ftsConds.push("memory.time_last <= ?"); ftsParams.push(date_to); }
      if (author !== undefined) { ftsConds.push("memory.author = ?"); ftsParams.push(author); }
      // I-1 (§6.2): тот же merged-only фильтр в FTS-ветке sibling-ноги.
      if (mergedOnly) { ftsConds.push("memory.merged = 1"); }
      // I1: тот же pre-filter кандидатов в FTS-ветке (join к memory.session_id).
      if (filterSessionIds && filterSessionIds.length) {
        ftsConds.push(`memory.session_id IN (${filterSessionIds.map(() => "?").join(",")})`);
        ftsParams.push(...filterSessionIds);
      }
      try {
        const ftsRows = db.prepare(
          `SELECT memory_fts.session_id, bm25(memory_fts) AS rank
           FROM memory_fts JOIN memory ON memory.session_id = memory_fts.session_id
           WHERE ${ftsConds.join(" AND ")}
           ORDER BY bm25(memory_fts)`,
        ).all(...ftsParams);
        // Подтягиваем полный entry сразу (до закрытия соединения), чтобы
        // fuseRrf не вызывал fetchEntry по закрытой sibling-БД.
        const fetch = db.prepare("SELECT * FROM memory WHERE session_id = ?");
        ftsHits = ftsRows.slice(0, top_k).map((r) => {
          const full = fetch.get(r.session_id);
          // M6: memory-строка отсутствует (desync FTS/memory) → пропускаем хит,
          // не создавая phantom-запись без entry (иначе fuseRrf/рендер упадут
          // на entry.decisions.join).
          if (!full) return null;
          let parsed;
          try { parsed = JSON.parse(full.decisions); } catch { parsed = []; }
          return { session_id: r.session_id, entry: { ...full, embedding: undefined, decisions: parsed, origin_remote: full.origin_remote ?? "", prefixes: parseJsonArray(full.prefixes) } };
        }).filter(Boolean);
      } catch (err) {
        console.error(`[memory] FTS MATCH failed, falling back to vector-only: ${err.message}`);
      }
    }
    return { vectorHits, ftsHits };
  }

  async delete(session_id) {
    return timed(this.log, "delete", () => this._delete(session_id));
  }

  async _delete(session_id) {
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
      if ("prefixes" in r) r.prefixes = parseJsonArray(r.prefixes);
      return r;
    });
  }

  async get(session_id) {
    return timed(this.log, "get", () => this._get(session_id));
  }

  async _get(session_id) {
    const r = this.db.prepare("SELECT * FROM memory WHERE session_id = ?").get(session_id);
    if (!r) return null;
    // Upgrade-path robustness: guard malformed decisions JSON (used by the FTS
    // merge line-fetch for FTS-only hits).
    let parsed;
    try { parsed = JSON.parse(r.decisions); } catch { parsed = []; }
    return { ...r, embedding: undefined, decisions: parsed, host: r.host ?? "", origin_remote: r.origin_remote ?? "", prefixes: parseJsonArray(r.prefixes) };
  }

  // Кандидаты для recall (Task 6): записи ключа, которые либо уже влиты в
  // mainline (merged=1), либо имеют атрибуцию head (head != '').
  async candidates(key) {
    return timed(this.log, "candidates", () => this._candidates(key));
  }

  async _candidates(key) {
    if (typeof key !== "string" || !key) throw new Error("candidates: key required");
    const rows = this.db.prepare(
      "SELECT * FROM memory WHERE key = ? AND (merged = 1 OR head != '')",
    ).all(key);
    return rows.map((r) => {
      let parsed;
      try { parsed = JSON.parse(r.decisions); } catch { parsed = []; }
      return { ...r, embedding: undefined, decisions: parsed, origin_remote: r.origin_remote ?? "", prefixes: parseJsonArray(r.prefixes) };
    });
  }

  // Промоция (Task 5): пометить записи ключа с данным head как влитые в mainline.
  async markMerged(key, head) {
    if (typeof key !== "string" || !key) throw new Error("markMerged: key required");
    if (typeof head !== "string" || !head) throw new Error("markMerged: head required");
    const info = this.db.prepare("UPDATE memory SET merged = 1 WHERE key = ? AND head = ?").run(key, head);
    return info.changes;
  }

  /**
   * Миграция namespace (spec §3.6): перенести записи бакета fromKey в активный
   * бакет (toKey). max-version-wins: запись-источник НЕ затирает более новую
   * запись цели (existing.version >= source.version → skip). prefixes
   * пересчитываются от toKey; origin_project_hash/origin_remote сохраняются.
   * @param {string} fromKey  Ключ источника (namespace или hash).
   * @param {string} toKey  Ключ цели (активный бакет).
   * @param {{ deleteSource?: boolean }} [opts]  deleteSource → удалить файл
   *   источника (+ -wal/-shm) после переноса.
   * @returns {Promise<number>}  Число перенесённых записей.
   */
  async migrateKey(fromKey, toKey, { deleteSource = false } = {}) {
    if (typeof fromKey !== "string" || !fromKey) throw new Error("migrateKey: fromKey required");
    if (typeof toKey !== "string" || !toKey) throw new Error("migrateKey: toKey required");
    if (fromKey === toKey) return 0; // edge: no-op
    const dataDir = join(dirname(this.dbPath), "..", "..");
    const srcPath = join(dataDir, "memory", sanitizeDirName(fromKey), "memory.db");
    const Database = await loadSqliteDriver(this.moduleDir, { force: this.forceDriver });
    let sib;
    try {
      sib = new Database(srcPath, { readonly: true, fileMustExist: false });
    } catch (err) {
      throw new Error(`migrateKey: source bucket ${fromKey} unavailable: ${err.message}`);
    }
    try {
      // Сверка модели/размерности: несовпадение → косинусы несравнимы → ошибка
      // с инструкцией переиндексации (как init).
      const model = sib.prepare("SELECT value FROM meta WHERE name = 'model_id'").get();
      if (model && model.value !== this.modelId) {
        throw new Error(`migrateKey: model mismatch (stored=${model.value} expected=${this.modelId}) — переиндексируйте (model/dim mismatch)`);
      }
      const dim = sib.prepare("SELECT value FROM meta WHERE name = 'dim'").get();
      if (dim && parseInt(dim.value, 10) !== this.dim) {
        throw new Error(`migrateKey: dimension mismatch (stored=${dim.value} expected=${this.dim}) — переиндексируйте (model/dim mismatch)`);
      }
      const rows = sib.prepare("SELECT * FROM memory").all();
      const toUpsert = [];
      for (const r of rows) {
        const existing = await this._get(r.session_id);
        if (existing && r.version <= existing.version) continue; // max-version-wins
        let decisions;
        try { decisions = JSON.parse(r.decisions); } catch { decisions = []; }
        toUpsert.push({
          session_id: r.session_id,
          key: toKey,
          origin_project_hash: r.origin_project_hash,
          title: r.title,
          summary: r.summary,
          decisions,
          embedding: new Float32Array(r.embedding.buffer, r.embedding.byteOffset, r.embedding.byteLength / 4),
          model_id: r.model_id,
          author: r.author,
          time_first: r.time_first,
          time_last: r.time_last,
          version: r.version,
          branch: r.branch ?? "",
          head: r.head ?? "",
          merged: r.merged ?? 0,
          host: r.host ?? "",
          origin_remote: r.origin_remote ?? "",
          prefixes: prefixesOf(toKey),
        });
      }
      if (toUpsert.length) await this._upsert(toUpsert);
      if (deleteSource) {
        for (const suffix of ["", "-wal", "-shm"]) {
          try { rmSync(srcPath + suffix, { force: true }); } catch { /* fail-soft */ }
        }
      }
      return toUpsert.length;
    } finally {
      sib.close();
    }
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
