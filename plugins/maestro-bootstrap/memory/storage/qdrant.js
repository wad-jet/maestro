import { createHash } from "node:crypto";
import { resolveSearchKeys } from "../project.js";

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

  async init() {
    const { exists } = await this.client.collectionExists(this.collection);
    if (!exists) {
      await this.client.createCollection(this.collection, {
        vectors: { size: this.dim, distance: "Cosine" },
      });
    }
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
        model_id: e.model_id,
        author: e.author,
        time_first: e.time_first,
        time_last: e.time_last,
        version: e.version,
      },
    }));
    await this.client.upsert(this.collection, { points });
  }

  async search(embedding, { top_k = 3, min_score = 0, key, date_from, date_to, author, project }) {
    // B2: cross-project opt-in — key-set filter (current + project key).
    const keys = resolveSearchKeys({ key, project });
    const must = keys.length === 1
      ? [{ key: "key", match: { value: keys[0] } }]
      : [{ key: "key", match: { any: keys } }];
    if (date_from !== undefined) must.push({ key: "time_last", range: { gte: date_from } });
    if (date_to !== undefined) must.push({ key: "time_last", range: { lte: date_to } });
    if (author !== undefined) must.push({ key: "author", match: { value: author } });
    const res = await this.client.query(this.collection, {
      query: { nearest: Array.from(embedding) },
      limit: top_k,
      score_threshold: min_score,
      filter: { must },
      with_payload: true,
    });
    return (res.points ?? []).map((r) => ({
      entry: { ...r.payload, embedding: undefined, decisions: JSON.parse(r.payload.decisions) },
      score: r.score,
    }));
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
    const cols = fields && fields.length ? fields : DEFAULT_SCAN_FIELDS;
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
    return { ...p.payload, embedding: undefined, decisions: JSON.parse(p.payload.decisions) };
  }
}
