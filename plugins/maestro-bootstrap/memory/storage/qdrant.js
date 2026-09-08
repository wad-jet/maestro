import { createHash } from "node:crypto";
import { resolveSearchKeys } from "../project.js";
import { fuseRrf } from "./rrf.js";
import { timed } from "../storage.js";

// Whitelist of scan-able payload fields. Default scan returns everything EXCEPT
// embedding (large); embedding is opt-in.
const SCAN_FIELDS = [
  "session_id", "key", "origin_project_hash", "title", "summary", "decisions",
  "author", "time_first", "time_last", "version", "model_id", "embedding",
  "branch", "head", "merged",
];
const DEFAULT_SCAN_FIELDS = SCAN_FIELDS.filter((f) => f !== "embedding");

function uuidFrom(s) {
  const h = createHash("sha256").update(s).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

export class QdrantStorage {
  constructor({ client, collection, modelId, dim, log }) {
    this.client = client;
    this.collection = collection;
    this.modelId = modelId;
    this.dim = dim;
    // Task 6: аудит-лог (spec §4.3) — debug/error-события операций; default null (noop).
    this.log = log ?? null;
  }

  // Текстовое представление точки для full-text индекса (payload `text`).
  // decisions хранится как JSON-строка — парсим с guard'ом на битый JSON.
  static textOf(p) {
    let parsed = [];
    try { parsed = JSON.parse(p.payload?.decisions ?? "[]"); } catch { parsed = []; }
    return [p.payload?.title ?? "", p.payload?.summary ?? "", parsed.join(" ")].join(" ").trim();
  }

  async init() {
    return timed(this.log, "init", () => this._init());
  }

  async _init() {
    const { exists } = await this.client.collectionExists(this.collection);
    if (!exists) {
      await this.client.createCollection(this.collection, {
        vectors: { size: this.dim, distance: "Cosine" },
      });
    }
    // Payload full-text индекс на `text`. Серверы < 1.10 не поддерживают
    // createPayloadIndex → scan-mode fallback (без индекса, фильтр по is_empty).
    try {
      await this.client.createPayloadIndex(this.collection, {
        field_name: "text",
        field_schema: { type: "text", tokenizer: "word", min_token_len: 2 },
      });
    } catch (err) {
      console.error(`[memory] qdrant payload text index failed (scan-mode fallback): ${err.message}`);
    }
    // Backfill: существующие точки без `text` (добавлены до этой версии) получают
    // производное поле. Пагинация через next_page_offset.
    let offset = undefined;
    do {
      const res = await this.client.scroll(this.collection, {
        filter: { must: [{ key: "text", is_empty: true }] },
        limit: 100,
        offset,
        with_payload: true,
        with_vector: false,
      });
      const points = res.points ?? [];
      const pts = points.filter((p) => p.payload?.title || p.payload?.summary || p.payload?.decisions);
      if (pts.length) {
        // Реальный API: setPayload(collection, { payload, points }) — payload —
        // ОДИН объект, points — список id. Per-point вызовы + guard: сбой
        // backfill деградирует в лог (как index-creation fallback), не ломая init().
        try {
          for (const p of pts) {
            await this.client.setPayload(this.collection, {
              payload: { text: QdrantStorage.textOf(p) },
              points: [p.id],
            });
          }
        } catch (err) {
          console.error(`[memory] qdrant text backfill failed: ${err.message}`);
        }
      }
      offset = res.next_page_offset;
    } while (offset != null);
  }

  async dispose() {}

  async upsert(entries) {
    return timed(this.log, "upsert", () => this._upsert(entries));
  }

  async _upsert(entries) {
    // I3: паритет с sqlite/pgvector — несовпадение model_id → ошибка с
    // инструкцией переиндексации (embedding dim проверяется сервер-стороной:
    // collection создаётся с фикс. размерностью).
    for (const e of entries) {
      if (e.model_id !== this.modelId) {
        throw new Error(`model_id mismatch: entry=${e.model_id} storage=${this.modelId} — переиндексируйте (см. how-to/enable-memory)`);
      }
    }
    const points = entries.map((e, i) => ({
      // I-3: deterministic UUID v5-like from sha256 (must be u64 or UUID, not string).
      // Fixed id per session (NOT per version) — re-summarize (version bump)
      // overwrites the same point instead of accumulating stale versions.
      id: uuidFrom(e.session_id),
      vector: Array.from(e.embedding),
      payload: {
        session_id: e.session_id,
        key: e.key,
        origin_project_hash: e.origin_project_hash,
        title: e.title,
        summary: e.summary,
        decisions: JSON.stringify(e.decisions),
        // Производное текстовое поле для full-text поиска; пересчитывается на
        // КАЖДОМ upsert (включая re-mask через memory_import).
        text: [e.title, e.summary, e.decisions.join(" ")].join(" "),
        model_id: e.model_id,
        author: e.author,
        time_first: e.time_first,
        time_last: e.time_last,
        version: e.version,
        // branch/head/merged — легитимные метаданные (detached/unknown → '').
        branch: e.branch ?? "",
        head: e.head ?? "",
        merged: e.merged ?? 0,
      },
    }));
    await this.client.upsert(this.collection, { points });
  }

  async search(embedding, { top_k = 3, min_score = 0, key, date_from, date_to, author, project, query, filterSessionIds }) {
    return timed(this.log, "search", () => this._search(embedding, { top_k, min_score, key, date_from, date_to, author, project, query, filterSessionIds }));
  }

  async _search(embedding, { top_k = 3, min_score = 0, key, date_from, date_to, author, project, query, filterSessionIds }) {
    // B2: cross-project opt-in — key-set filter (current + project key). Активная
    // нога (own key) и sibling-ноги разделяются: sibling строго general (merged=1,
    // §6.2) и НЕ получает own-key filterSessionIds (иначе sibling пуст).
    const keys = resolveSearchKeys({ key, project });
    const activeKey = keys[0];
    const siblingKeys = keys.slice(1);
    const vectorHits = [];
    const textLists = [];

    await this._collectLeg(activeKey, { filterSessionIds, merged: false }, embedding, { top_k, min_score, date_from, date_to, author, query }, vectorHits, textLists);
    if (siblingKeys.length) {
      await this._collectLeg(siblingKeys, { merged: true }, embedding, { top_k, min_score, date_from, date_to, author, query }, vectorHits, textLists);
    }

    vectorHits.sort((a, b) => b.score - a.score);
    if (textLists.length) {
      // C2: кап результата фузии до top_k (паритет с sqlite/pgvector).
      const fused = await fuseRrf(vectorHits, textLists, { fetchEntry: (sid) => this._get(sid) });
      return fused.slice(0, top_k);
    }
    return vectorHits.slice(0, top_k);
  }

  /**
   * Одна нога поиска (активная или sibling-набор ключей): векторная + текстовая
   * ветки с общими фильтрами. Хиты накапливаются в переданные массивы.
   * @param {string|string[]} keys  Ключ(и) ноги.
   * @param {{ filterSessionIds?: string[], merged?: boolean }} legOpts
   * @param {Float32Array} embedding
   * @param {{ top_k: number, min_score: number, date_from?: number, date_to?: number, author?: string, query?: string }} opts
   * @param {Array} vectorHits  Накопитель векторных хитов (мутируется).
   * @param {Array} textLists  Накопитель текстовых списков (мутируется).
   */
  async _collectLeg(keys, { filterSessionIds, merged }, embedding, { top_k, min_score, date_from, date_to, author, query }, vectorHits, textLists) {
    const ks = Array.isArray(keys) ? keys : [keys];
    const must = ks.length === 1
      ? [{ key: "key", match: { value: ks[0] } }]
      : [{ key: "key", match: { any: ks } }];
    if (date_from !== undefined) must.push({ key: "time_last", range: { gte: date_from } });
    if (date_to !== undefined) must.push({ key: "time_last", range: { lte: date_to } });
    if (author !== undefined) must.push({ key: "author", match: { value: author } });
    // I1: pre-filter кандидатов (merged=1 OR head != '') — только активная нога.
    if (filterSessionIds && filterSessionIds.length) {
      must.push({ key: "session_id", match: { any: filterSessionIds } });
    }
    // I-1 (§6.2): sibling-нога — строго general (merged=1).
    if (merged) must.push({ key: "merged", match: { value: 1 } });

    const res = await this.client.query(this.collection, {
      query: { nearest: Array.from(embedding) },
      limit: top_k,
      score_threshold: min_score,
      filter: { must },
      with_payload: true,
    });
    vectorHits.push(...(res.points ?? []).map((r) => {
      // M3: производное поле `text` (для full-text индекса) не должно протекать
      // в entry векторной ветки (как в get()) — выкидываем через деструктуризацию.
      const { text, ...rest } = r.payload;
      return { entry: { ...rest, embedding: undefined, decisions: JSON.parse(rest.decisions) }, score: r.score };
    }));

    // Текстовая ветка: только full-text (full_text_match), фузия через RRF.
    // Зеркалит key-set/date/author фильтры векторной ветки.
    if (typeof query === "string" && query.trim().length > 0) {
      try {
        const tmust = [...must];
        tmust.push({ key: "text", full_text_match: { text: query } });
        // Filter-only leg — top-level `filter` БЕЗ `query` (у Query enum нет
        // FilterQuery-варианта; сервер вернул бы 400). Не должен быть
        // векторно-упорядочен (нет `nearest`).
        const tr = await this.client.query(this.collection, {
          filter: { must: tmust },
          limit: top_k,
          with_payload: true,
        });
        const textHits = (tr.points ?? []).map((p) => ({ session_id: p.payload.session_id }));
        if (textHits.length) textLists.push(textHits);
      } catch (err) {
        // Fail-soft: при сбое текстовой ветки возвращаем только векторные хиты.
        console.error(`[memory] qdrant text leg failed, vector-only fallback: ${err.message}`);
      }
    }
  }

  // C-2: direct filter delete (no query-based point lookup)
  async delete(session_id, { key } = {}) {
    return timed(this.log, "delete", () => this._delete(session_id, { key }));
  }

  async _delete(session_id, { key } = {}) {
    await this.client.delete(this.collection, {
      filter: {
        must: [{ key: "session_id", match: { value: session_id } }, ...(key ? [{ key: "key", match: { value: key } }] : [])],
      },
    });
  }

  async deleteByFilter({ key, session_id, author, before }) {
    if (typeof key !== "string" || !key) throw new Error("deleteByFilter: key required");
    const must = [{ key: "key", match: { value: key } }];
    if (session_id !== undefined) must.push({ key: "session_id", match: { value: session_id } });
    if (author !== undefined) must.push({ key: "author", match: { value: author } });
    if (before !== undefined) must.push({ key: "time_last", range: { lte: before } });
    const { count } = await this.client.count(this.collection, { filter: { must } });
    await this.client.delete(this.collection, { filter: { must } });
    return count;
  }

  async prune({ key, olderThanDays }) {
    if (typeof key !== "string" || !key) throw new Error("prune: key required");
    const cutoff = Date.now() - olderThanDays * 86400_000;
    return this.deleteByFilter({ key, before: cutoff });
  }

  async stats({ key }) {
    if (typeof key !== "string" || !key) throw new Error("stats: key required");
    const { count } = await this.client.count(this.collection, {
      filter: { must: [{ key: "key", match: { value: key } }] },
    });
    return { entries: count };
  }

  async scan({ key, fields }) {
    if (typeof key !== "string" || !key) throw new Error("scan: key required");
    // Field whitelist (mirrors sqlite/pg): only requested SCAN_FIELDS are read
    // from payload; embedding is handled separately from the vector.
    const cols = (fields && fields.length ? fields : DEFAULT_SCAN_FIELDS).filter((f) => SCAN_FIELDS.includes(f));
    if (!cols.length) throw new Error("scan: no valid fields requested");
    const wantEmbedding = cols.includes("embedding");
    // M-6: scroll-пагинация через next_page_offset (limit 10000 молча обрезал).
    const out = [];
    let offset = undefined;
    do {
      const res = await this.client.scroll(this.collection, {
        filter: { must: [{ key: "key", match: { value: key } }] },
        limit: 1000,
        offset,
        with_payload: true,
        with_vector: true,
      });
      for (const p of res.points ?? []) {
        const o = {};
        for (const f of cols) {
          if (f === "embedding") continue;
          if (f in p.payload) o[f] = p.payload[f];
        }
        if ("decisions" in o) o.decisions = JSON.parse(o.decisions);
        // C-1: embedding lives in the vector (not payload); normalize to Float32Array.
        if (wantEmbedding) {
          const vec = p.vector ?? p.payload?.embedding;
          o.embedding = Array.isArray(vec) ? new Float32Array(vec) : undefined;
        }
        out.push(o);
      }
      offset = res.next_page_offset;
    } while (offset != null);
    return out;
  }

  // C-2: filter-only query for get()
  async get(session_id) {
    return timed(this.log, "get", () => this._get(session_id));
  }

  async _get(session_id) {
    const res = await this.client.query(this.collection, {
      filter: { must: [{ key: "session_id", match: { value: session_id } }] },
      limit: 1,
      with_payload: true,
    });
    const p = res.points?.[0];
    if (!p) return null;
    // Производное поле `text` (для full-text индекса) не должно протекать
    // в entry — выкидываем через деструктуризацию (spec §3.6).
    const { text, ...rest } = p.payload;
    return { ...rest, embedding: undefined, decisions: JSON.parse(rest.decisions) };
  }

  // Кандидаты для recall (Task 6): записи ключа, которые либо влиты в mainline
  // (merged=1), либо имеют атрибуцию head (head != ''). Qdrant не фильтрует
  // `!= ''` дешёво → scroll по key + JS-фильтр. Malformed decisions → []
  // (guard как в sqlite/get) — не ронять recall. M-6: scroll-пагинация.
  async candidates(key) {
    return timed(this.log, "candidates", () => this._candidates(key));
  }

  async _candidates(key) {
    if (typeof key !== "string" || !key) throw new Error("candidates: key required");
    const out = [];
    let offset = undefined;
    do {
      const res = await this.client.scroll(this.collection, {
        filter: { must: [{ key: "key", match: { value: key } }] },
        limit: 1000,
        offset,
        with_payload: true,
        with_vector: false,
      });
      for (const p of res.points ?? []) {
        if (p.payload?.merged === 1 || (p.payload?.head ?? "") !== "") {
          const { text, ...rest } = p.payload;
          let parsed;
          try { parsed = JSON.parse(rest.decisions); } catch { parsed = []; }
          out.push({ ...rest, embedding: undefined, decisions: parsed });
        }
      }
      offset = res.next_page_offset;
    } while (offset != null);
    return out;
  }

  // Промоция (Task 5): пометить записи ключа с данным head как влитые в mainline.
  // M-6: scroll-пагинация (limit 10000 молча обрезал id-набор).
  async markMerged(key, head) {
    if (typeof key !== "string" || !key) throw new Error("markMerged: key required");
    if (typeof head !== "string" || !head) throw new Error("markMerged: head required");
    const ids = [];
    let offset = undefined;
    do {
      const res = await this.client.scroll(this.collection, {
        filter: {
          must: [
            { key: "key", match: { value: key } },
            { key: "head", match: { value: head } },
          ],
        },
        limit: 1000,
        offset,
        with_payload: false,
        with_vector: false,
      });
      ids.push(...(res.points ?? []).map((p) => p.id));
      offset = res.next_page_offset;
    } while (offset != null);
    if (ids.length) {
      await this.client.setPayload(this.collection, { payload: { merged: 1 }, points: ids });
    }
    return ids.length;
  }
}
