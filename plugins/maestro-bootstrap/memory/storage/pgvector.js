import { resolveSearchKeys, prefixesOf } from "../project.js";
import { fuseRrf } from "./rrf.js";
import { timed } from "../storage.js";

// Whitelist of scan-able columns (mirrors the table schema). Default scan
// returns everything EXCEPT embedding (large); embedding is opt-in.
const SCAN_FIELDS = [
  "session_id", "key", "origin_project_hash", "title", "summary", "decisions",
  "artifacts", "author", "time_first", "time_last", "version", "model_id", "embedding",
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

// Subtree-цели (spec §3.3): нормализация + дедуп + исключение own key.
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

export class PgVectorStorage {
  constructor({ pool, table, dim, modelId, textSearchConfig, log }) {
    this.pool = pool;
    this.table = table;
    this.dim = dim;
    this.modelId = modelId;
    // Эффективный конфиг полнотекстового поиска (resolveEffectiveTextConfig);
    // fallback — "russian".
    this.textSearchConfig = textSearchConfig ?? "russian";
    // Task 6: аудит-лог (spec §4.3) — debug/error-события операций; default null (noop).
    this.log = log ?? null;
  }
  async init() {
    return timed(this.log, "init", () => this._init());
  }
  async _init() {
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
      artifacts TEXT NOT NULL DEFAULT '[]',
      embedding vector(${this.dim}) NOT NULL,
      model_id TEXT NOT NULL,
      author TEXT NOT NULL,
      time_first BIGINT NOT NULL,
      time_last BIGINT NOT NULL,
      version INT NOT NULL,
      branch TEXT NOT NULL DEFAULT '',
      head TEXT NOT NULL DEFAULT '',
      merged INT NOT NULL DEFAULT 0,
      host TEXT NOT NULL DEFAULT '',
      origin_remote TEXT NOT NULL DEFAULT '',
      prefixes TEXT NOT NULL DEFAULT ''
    )`);
    // Dev-гигиена: существующие dev-БД без branch/head/merged получают колонки
    // идемпотентно (ADD COLUMN IF NOT EXISTS, НЕ миграция данных).
    await this.pool.query(`ALTER TABLE ${this.table} ADD COLUMN IF NOT EXISTS branch TEXT NOT NULL DEFAULT ''`);
    await this.pool.query(`ALTER TABLE ${this.table} ADD COLUMN IF NOT EXISTS head TEXT NOT NULL DEFAULT ''`);
    await this.pool.query(`ALTER TABLE ${this.table} ADD COLUMN IF NOT EXISTS merged INT NOT NULL DEFAULT 0`);
    await this.pool.query(`ALTER TABLE ${this.table} ADD COLUMN IF NOT EXISTS host TEXT NOT NULL DEFAULT ''`);
    await this.pool.query(`ALTER TABLE ${this.table} ADD COLUMN IF NOT EXISTS origin_remote TEXT NOT NULL DEFAULT ''`);
    await this.pool.query(`ALTER TABLE ${this.table} ADD COLUMN IF NOT EXISTS prefixes TEXT NOT NULL DEFAULT ''`);
    await this.pool.query(`ALTER TABLE ${this.table} ADD COLUMN IF NOT EXISTS artifacts TEXT NOT NULL DEFAULT '[]'`);
    // I2: проверяем, что конфиг существует в pg_ts_config ДО того, как запечём
    // его в DDL. Если отсутствует (и отличается от "russian") — fallback на
    // "russian" для этого init И последующих поисков.
    const cfgRows = await this.pool.query(`SELECT 1 FROM pg_ts_config WHERE cfgname = $1`, [this.textSearchConfig]);
    if (cfgRows.rows.length === 0) {
      if (this.textSearchConfig !== "russian") {
        console.error(`[memory] pgvector text_search_config '${this.textSearchConfig}' not found in pg_ts_config, falling back to russian`);
        // Fix round 2: live-site fts.fallback (spec §4.2) — валидный конфиг
        // отсутствует в pg_ts_config → эффективный fallback на "russian".
        this.log?.debug?.("memory:fts.fallback", { backend: "pgvector", fallback: "russian" });
        this.textSearchConfig = "russian";
      } else {
        // "russian" отсутствует — логируем и продолжаем; DDL упадёт громко.
        console.error("[memory] pgvector text_search_config 'russian' not found in pg_ts_config");
      }
    }
    // Эффективный конфиг; сверка с фактическим выражением колонки fts.
    const cfg = this.textSearchConfig;
    const exprRows = await this.pool.query(
      `SELECT pg_get_expr(a.adbin, a.adrelid) AS expr
       FROM pg_attribute a
       JOIN pg_class c ON c.oid = a.attrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE c.relname = $1 AND a.attname = 'fts' AND NOT a.attisdropped`,
      [this.table]);
    const expr = exprRows.rows?.[0]?.expr;
    const addExpr = (c) => `ALTER TABLE ${this.table} ADD COLUMN fts tsvector GENERATED ALWAYS AS (to_tsvector('${c}'::regconfig, coalesce(title,'') || ' ' || coalesce(summary,'') || ' ' || coalesce(decisions,''))) STORED`;
    if (expr !== undefined && !expr.includes(`'${cfg}'::regconfig`)) {
      // Смена конфига: атомарный recreate (не оставлять таблицу без fts).
      // I1: транзакция на выделенном клиенте (как в upsert), release в finally.
      const client = await this.pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(`ALTER TABLE ${this.table} DROP COLUMN IF EXISTS fts`);
        await client.query(addExpr(cfg));
        await client.query(`CREATE INDEX IF NOT EXISTS ${this.table}_fts_idx ON ${this.table} USING gin(fts)`);
        await client.query("COMMIT");
      } catch (err) {
        try { await client.query("ROLLBACK"); } catch { /* ignore */ }
        throw err;
      } finally {
        client.release();
      }
    } else if (expr === undefined) {
      await this.pool.query(`ALTER TABLE ${this.table} ADD COLUMN IF NOT EXISTS fts tsvector GENERATED ALWAYS AS (to_tsvector('${cfg}'::regconfig, coalesce(title,'') || ' ' || coalesce(summary,'') || ' ' || coalesce(decisions,''))) STORED`);
      await this.pool.query(`CREATE INDEX IF NOT EXISTS ${this.table}_fts_idx ON ${this.table} USING gin(fts)`);
    }
    // M4: индекс может быть потерян при crash между ADD COLUMN и CREATE INDEX
    // (первый не-атомарный init). Безусловный CREATE INDEX IF NOT EXISTS
    // восстанавливает его, не трогая живую колонку (silent seq-scan деградация).
    await this.pool.query(`CREATE INDEX IF NOT EXISTS ${this.table}_fts_idx ON ${this.table} USING gin(fts)`);
    await this.pool.query(`CREATE INDEX IF NOT EXISTS ${this.table}_key_idx ON ${this.table} (key)`);
  }
  async dispose() { await this.pool.end?.(); }
  async upsert(entries) {
    return timed(this.log, "upsert", () => this._upsert(entries));
  }
  async _upsert(entries) {
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
          `INSERT INTO ${this.table} (session_id, key, origin_project_hash, title, summary, decisions, embedding, model_id, author, time_first, time_last, version, branch, head, merged, host, origin_remote, prefixes, artifacts)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
           ON CONFLICT (session_id) DO UPDATE SET title=$4, summary=$5, decisions=$6, embedding=$7, time_last=$11, version=$12, branch=$13, head=$14, merged=$15, host=$16, origin_remote=$17, prefixes=$18, artifacts=$19`,
          [e.session_id, e.key, e.origin_project_hash, e.title, e.summary, JSON.stringify(e.decisions), `[${Array.from(e.embedding)}]`, e.model_id, e.author, e.time_first, e.time_last, e.version, e.branch ?? "", e.head ?? "", e.merged ?? 0, e.host ?? "", e.origin_remote ?? "", JSON.stringify(e.prefixes ?? []), JSON.stringify(e.artifacts ?? [])]
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
  async search(embedding, { top_k = 3, min_score = 0, key, date_from, date_to, author, project, query, filterSessionIds, related, subtree }) {
    return timed(this.log, "search", () => this._search(embedding, { top_k, min_score, key, date_from, date_to, author, project, query, filterSessionIds, related, subtree }));
  }
  async _search(embedding, { top_k = 3, min_score = 0, key, date_from, date_to, author, project, query, filterSessionIds, related, subtree }) {
    // B2: cross-project opt-in — key IN (current + project key). Активная нога
    // (own key) и sibling-ноги разделяются: sibling строго general (merged=1,
    // §6.2) и НЕ получает own-key filterSessionIds (иначе sibling пуст).
    const keys = resolveSearchKeys({ key, project, related });
    const activeKey = keys[0];
    const siblingKeys = keys.slice(1);
    const vectorHits = [];
    const textLists = [];

    await this._collectLeg(activeKey, { filterSessionIds, merged: false, ownKey: activeKey }, embedding, { top_k, min_score, date_from, date_to, author, query }, vectorHits, textLists);
    if (siblingKeys.length) {
      await this._collectLeg(siblingKeys, { merged: true, ownKey: activeKey }, embedding, { top_k, min_score, date_from, date_to, author, query }, vectorHits, textLists);
    }
    // Subtree-ноги (spec §3.3): префикс-цели → (key = T OR key LIKE T || '.%')
    // + merged=1 (sibling). LIKE безопасен: алфавит namespace без %/_.
    const targets = subtreeTargets(subtree, activeKey);
    if (targets.length) {
      await this._collectLeg([], { merged: true, subtreeTargets: targets, ownKey: activeKey }, embedding, { top_k, min_score, date_from, date_to, author, query }, vectorHits, textLists);
    }

    vectorHits.sort((a, b) => b.score - a.score);
    if (textLists.length) {
      // I2 (§3.1): единый пост-фильтр min_score после фьюжна (в т.ч. text-only).
      return (await fuseRrf(vectorHits, textLists, { fetchEntry: (sid) => this._get(sid), minScore: min_score })).slice(0, top_k);
    }
    return vectorHits.slice(0, top_k);
  }

  /**
   * Одна нога поиска (активная, sibling-набор ключей или subtree-префиксы):
   * векторная + текстовая ветки с общими фильтрами. Хиты накапливаются в
   * переданные массивы.
   * @param {string|string[]} keys  Ключ(и) ноги.
   * @param {{ filterSessionIds?: string[], merged?: boolean, subtreeTargets?: string[], ownKey?: string }} legOpts
   * @param {Float32Array} embedding
   * @param {{ top_k: number, min_score: number, date_from?: number, date_to?: number, author?: string, query?: string }} opts
   * @param {Array} vectorHits  Накопитель векторных хитов (мутируется).
   * @param {Array} textLists  Накопитель текстовых списков (мутируется).
   */
  async _collectLeg(keys, { filterSessionIds, merged, subtreeTargets, ownKey }, embedding, { top_k, min_score, date_from, date_to, author, query }, vectorHits, textLists) {
    const ks = Array.isArray(keys) ? keys : [keys];
    const conds = [];
    const params = [`[${Array.from(embedding)}]`];
    let i = 2;
    if (subtreeTargets && subtreeTargets.length) {
      // Subtree: (key = $i OR key LIKE $i || '.%') для каждой цели.
      const ors = [];
      for (const t of subtreeTargets) {
        ors.push(`(key = $${i} OR key LIKE $${i} || '.%')`);
        params.push(t);
        i++;
      }
      conds.push(`(${ors.join(" OR ")})`);
      // §3.3: subtree-нога не должна захватывать own bucket (иначе own merged
      // записи попадают и в активную, и в subtree-ногу → двойной вес в fuseRrf).
      // Исключение применяется ТОЛЬКО к subtree-ноге (не к активной).
      if (ownKey) { conds.push(`key <> $${i++}`); params.push(ownKey); }
    } else if (ks.length === 1) {
      conds.push(`key = $${i++}`);
      params.push(ks[0]);
    } else {
      conds.push(`key IN (${ks.map(() => `$${i++}`).join(", ")})`);
      params.push(...ks);
    }
    if (date_from !== undefined) { conds.push(`time_last >= $${i++}`); params.push(date_from); }
    if (date_to !== undefined) { conds.push(`time_last <= $${i++}`); params.push(date_to); }
    if (author !== undefined) { conds.push(`author = $${i++}`); params.push(author); }
    // I1: pre-filter по кандидатам (merged=1 OR head != '') — только активная нога.
    if (filterSessionIds && filterSessionIds.length) {
      conds.push(`session_id IN (${filterSessionIds.map(() => `$${i++}`).join(", ")})`);
      params.push(...filterSessionIds);
    }
    // I-1 (§6.2): sibling-нога — строго general (merged=1).
    if (merged) conds.push(`merged = 1`);
    conds.push(`1 - (embedding <=> $1) >= $${i++}`);
    params.push(min_score);
    const vectorRes = await this.pool.query(
      `SELECT session_id, key, origin_project_hash, title, summary, decisions, model_id, author, time_first, time_last, version, branch, head, merged, host, origin_remote, prefixes, artifacts,
               1 - (embedding <=> $1) AS score
       FROM ${this.table}
       WHERE ${conds.join(" AND ")}
       ORDER BY embedding <=> $1
       LIMIT $${i}`,
      [...params, top_k]
    );
    vectorHits.push(...vectorRes.rows.map((r) => ({ entry: { ...r, embedding: undefined, decisions: JSON.parse(r.decisions), artifacts: parseJsonArray(r.artifacts), host: r.host ?? "", origin_remote: r.origin_remote ?? "", prefixes: parseJsonArray(r.prefixes) }, score: Number(r.score) })));

    // Текстовая ветка: только lex (ts_rank), фузия через RRF. Зеркалит
    // key-set/date/author фильтры векторной ветки.
    if (typeof query === "string" && query.trim().length > 0) {
      try {
        const tparams = [this.textSearchConfig, query];
        // $1 = cfg, $2 = query → первый key-фильтр начинается с $3.
        let j = 3;
        const tconds = [`fts @@ plainto_tsquery($1, $2)`];
        if (subtreeTargets && subtreeTargets.length) {
          const ors = [];
          for (const t of subtreeTargets) {
            ors.push(`(key = $${j} OR key LIKE $${j} || '.%')`);
            tparams.push(t);
            j++;
          }
          tconds.push(`(${ors.join(" OR ")})`);
          // §3.3: исключение own bucket из subtree-ноги (см. векторную ветку).
          if (ownKey) { tconds.push(`key <> $${j++}`); tparams.push(ownKey); }
        } else if (ks.length === 1) {
          tconds.push(`key = $${j++}`);
          tparams.push(ks[0]);
        } else {
          tconds.push(`key IN (${ks.map(() => `$${j++}`).join(", ")})`);
          tparams.push(...ks);
        }
        if (date_from !== undefined) { tconds.push(`time_last >= $${j++}`); tparams.push(date_from); }
        if (date_to !== undefined) { tconds.push(`time_last <= $${j++}`); tparams.push(date_to); }
        if (author !== undefined) { tconds.push(`author = $${j++}`); tparams.push(author); }
        // I1: тот же pre-filter кандидатов в текстовой ветке (активная нога).
        if (filterSessionIds && filterSessionIds.length) {
          tconds.push(`session_id IN (${filterSessionIds.map(() => `$${j++}`).join(", ")})`);
          tparams.push(...filterSessionIds);
        }
        // I-1 (§6.2): merged-only в текстовой ветке sibling-ноги.
        if (merged) tconds.push(`merged = 1`);
        const textRes = await this.pool.query(
          `SELECT session_id FROM ${this.table}
           WHERE ${tconds.join(" AND ")}
           ORDER BY ts_rank(fts, plainto_tsquery($1, $2)) DESC
           LIMIT $${j}`,
          [...tparams, top_k]
        );
        const textHits = textRes.rows.map((r) => ({ session_id: r.session_id }));
        if (textHits.length) textLists.push(textHits);
      } catch (err) {
        // Fail-soft: при сбое текстовой ветки возвращаем только векторные хиты.
        console.error("[memory] pgvector text leg failed, vector-only fallback: " + err.message);
      }
    }
  }
  async delete(session_id) {
    return timed(this.log, "delete", () => this._delete(session_id));
  }
  async _delete(session_id) { await this.pool.query(`DELETE FROM ${this.table} WHERE session_id = $1`, [session_id]); }
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
      if ("artifacts" in r) r.artifacts = parseJsonArray(r.artifacts);
      if ("prefixes" in r) r.prefixes = parseJsonArray(r.prefixes);
      // C-1: pgvector returns embedding as a string "[0.1,0.2,0.3]"; normalize to Float32Array.
      if ("embedding" in r && typeof r.embedding === "string") {
        r.embedding = new Float32Array(JSON.parse(r.embedding));
      }
      return r;
    });
  }
  async get(session_id) {
    return timed(this.log, "get", () => this._get(session_id));
  }
  async _get(session_id) {
    // Явный список колонок (без SELECT *, без fts).
    const r = await this.pool.query(
      `SELECT session_id, key, origin_project_hash, title, summary, decisions, model_id, author, time_first, time_last, version, branch, head, merged, host, origin_remote, prefixes, artifacts
       FROM ${this.table} WHERE session_id = $1`,
      [session_id]);
    if (!r.rows[0]) return null;
    return { ...r.rows[0], embedding: undefined, decisions: JSON.parse(r.rows[0].decisions), artifacts: parseJsonArray(r.rows[0].artifacts), host: r.rows[0].host ?? "", origin_remote: r.rows[0].origin_remote ?? "", prefixes: parseJsonArray(r.rows[0].prefixes) };
  }

  // Кандидаты для recall (Task 6): записи ключа, которые либо влиты в mainline
  // (merged=1), либо имеют атрибуцию head (head != ''). Malformed decisions →
  // [] (guard как в sqlite/get) — не ронять recall.
  async candidates(key) {
    return timed(this.log, "candidates", () => this._candidates(key));
  }
  async _candidates(key) {
    if (typeof key !== "string" || !key) throw new Error("candidates: key required");
    const res = await this.pool.query(
      `SELECT session_id, key, origin_project_hash, title, summary, decisions, model_id, author, time_first, time_last, version, branch, head, merged, host, origin_remote, prefixes, artifacts
       FROM ${this.table} WHERE key = $1 AND (merged = 1 OR head != '')`,
      [key]);
    return res.rows.map((r) => {
      let parsed;
      try { parsed = JSON.parse(r.decisions); } catch { parsed = []; }
      return { ...r, embedding: undefined, decisions: parsed, artifacts: parseJsonArray(r.artifacts), host: r.host ?? "", origin_remote: r.origin_remote ?? "", prefixes: parseJsonArray(r.prefixes) };
    });
  }

  // Промоция (Task 5): пометить записи ключа с данным head как влитые в mainline.
  async markMerged(key, head) {
    if (typeof key !== "string" || !key) throw new Error("markMerged: key required");
    if (typeof head !== "string" || !head) throw new Error("markMerged: head required");
    const res = await this.pool.query(
      `UPDATE ${this.table} SET merged = 1 WHERE key = $1 AND head = $2`,
      [key, head]);
    return res.rowCount ?? 0;
  }

  /**
   * Миграция namespace (spec §3.6): перенести записи key=fromKey в key=toKey.
   * max-version-wins через NOT EXISTS-подзапрос: строка-источник обновляется
   * только если в цели нет записи с тем же session_id и version >= источника.
   * prefixes пересчитываются от toKey; origin_remote сохраняется (provenance).
   * @param {string} fromKey  Ключ источника.
   * @param {string} toKey  Ключ цели.
   * @param {{ deleteSource?: boolean }} [opts]  deleteSource → no-op (после
   *   UPDATE источник уже пуст).
   * @returns {Promise<number>}  Число обновлённых строк (rowsAffected).
   */
  async migrateKey(fromKey, toKey, { deleteSource = false } = {}) {
    if (typeof fromKey !== "string" || !fromKey) throw new Error("migrateKey: fromKey required");
    if (typeof toKey !== "string" || !toKey) throw new Error("migrateKey: toKey required");
    if (fromKey === toKey) return 0; // edge: no-op
    const newPrefixes = JSON.stringify(prefixesOf(toKey));
    const res = await this.pool.query(
      `UPDATE ${this.table} SET key = $1, prefixes = $2
       WHERE key = $3
         AND NOT EXISTS (
           SELECT 1 FROM ${this.table} t
           WHERE t.session_id = ${this.table}.session_id
             AND t.key = $1
             AND t.version >= ${this.table}.version
         )`,
      [toKey, newPrefixes, fromKey]
    );
    // deleteSource → no-op: после UPDATE источник (key=from) уже пуст.
    return res.rowCount ?? 0;
  }
}
