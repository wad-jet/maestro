import { createHash } from "node:crypto";
import { resolveSearchKeys } from "../project.js";
import { fuseRrf } from "./rrf.js";

// Whitelist of scan-able payload fields. Default scan returns everything EXCEPT
// embedding (large); embedding is opt-in.
const SCAN_FIELDS = [
  "session_id", "key", "origin_project_hash", "title", "summary", "decisions",
  "author", "time_first", "time_last", "version", "model_id", "embedding",
];
const DEFAULT_SCAN_FIELDS = SCAN_FIELDS.filter((f) => f !== "embedding");

function uuidFrom(s) {
  const h = createHash("sha256").update(s).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

export class QdrantStorage {
  constructor({ client, collection, modelId, dim }) {
    this.client = client;
    this.collection = collection;
    this.modelId = modelId;
    this.dim = dim;
  }

  // Текстовое представление точки для full-text индекса (payload `text`).
  // decisions хранится как JSON-строка — парсим с guard'ом на битый JSON.
  static textOf(p) {
    let parsed = [];
    try { parsed = JSON.parse(p.payload?.decisions ?? "[]"); } catch { parsed = []; }
    return [p.payload?.title ?? "", p.payload?.summary ?? "", parsed.join(" ")].join(" ").trim();
  }

  async init() {
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
      },
    }));
    await this.client.upsert(this.collection, { points });
  }

  // Общий фильтр для векторной и текстовой веток: key-set + date + author.
  buildMust({ key, project, date_from, date_to, author }) {
    const keys = resolveSearchKeys({ key, project });
    const must = keys.length === 1
      ? [{ key: "key", match: { value: keys[0] } }]
      : [{ key: "key", match: { any: keys } }];
    if (date_from !== undefined) must.push({ key: "time_last", range: { gte: date_from } });
    if (date_to !== undefined) must.push({ key: "time_last", range: { lte: date_to } });
    if (author !== undefined) must.push({ key: "author", match: { value: author } });
    return must;
  }

  async search(embedding, { top_k = 3, min_score = 0, key, date_from, date_to, author, project, query }) {
    // B2: cross-project opt-in — key-set filter (current + project key).
    const must = this.buildMust({ key, project, date_from, date_to, author });
    const res = await this.client.query(this.collection, {
      query: { nearest: Array.from(embedding) },
      limit: top_k,
      score_threshold: min_score,
      filter: { must },
      with_payload: true,
    });
    const vectorHits = (res.points ?? []).map((r) => {
      // M3: производное поле `text` (для full-text индекса) не должно протекать
      // в entry векторной ветки (как в get()) — выкидываем через деструктуризацию.
      const { text, ...rest } = r.payload;
      return { entry: { ...rest, embedding: undefined, decisions: JSON.parse(rest.decisions) }, score: r.score };
    });

    // Текстовая ветка: только full-text (full_text_match), фузия через RRF.
    // Зеркалит key-set/date/author фильтры векторной ветки (buildMust).
    if (typeof query === "string" && query.trim().length > 0) {
      let textHits = [];
      try {
        const tmust = this.buildMust({ key, project, date_from, date_to, author });
        tmust.push({ key: "text", full_text_match: { text: query } });
        // Filter-only leg — top-level `filter` БЕЗ `query` (у Query enum нет
        // FilterQuery-варианта; сервер вернул бы 400). Не должен быть
        // векторно-упорядочен (нет `nearest`).
        const tr = await this.client.query(this.collection, {
          filter: { must: tmust },
          limit: top_k,
          with_payload: true,
        });
        textHits = (tr.points ?? []).map((p) => ({ session_id: p.payload.session_id }));
      } catch (err) {
        // Fail-soft: при сбое текстовой ветки возвращаем только векторные хиты.
        console.error(`[memory] qdrant text leg failed, vector-only fallback: ${err.message}`);
      }
      if (!textHits.length) return vectorHits;
      // C2: кап результата фузии до top_k (паритет с sqlite/pgvector).
      const fused = await fuseRrf(vectorHits, [textHits], { fetchEntry: (sid) => this.get(sid) });
      return fused.slice(0, top_k);
    }
    return vectorHits;
  }

  // C-2: direct filter delete (no query-based point lookup)
  async delete(session_id, { key } = {}) {
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
    const res = await this.client.scroll(this.collection, {
      filter: { must: [{ key: "key", match: { value: key } }] },
      limit: 10000,
      with_payload: true,
      with_vector: true,
    });
    // Field whitelist (mirrors sqlite/pg): only requested SCAN_FIELDS are read
    // from payload; embedding is handled separately from the vector.
    const cols = (fields && fields.length ? fields : DEFAULT_SCAN_FIELDS).filter((f) => SCAN_FIELDS.includes(f));
    if (!cols.length) throw new Error("scan: no valid fields requested");
    const wantEmbedding = cols.includes("embedding");
    return (res.points ?? []).map((p) => {
      const out = {};
      for (const f of cols) {
        if (f === "embedding") continue;
        if (f in p.payload) out[f] = p.payload[f];
      }
      if ("decisions" in out) out.decisions = JSON.parse(out.decisions);
      // C-1: embedding lives in the vector (not payload); normalize to Float32Array.
      if (wantEmbedding) {
        const vec = p.vector ?? p.payload?.embedding;
        out.embedding = Array.isArray(vec) ? new Float32Array(vec) : undefined;
      }
      return out;
    });
  }

  // C-2: filter-only query for get()
  async get(session_id) {
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
}
