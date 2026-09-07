import { createHash } from "node:crypto";

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
      // I-3: deterministic UUID v5-like from sha256 (must be u64 or UUID, not string)
      id: uuidFrom(`${e.session_id}_${e.version}`),
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

  async search(embedding, { top_k = 3, min_score = 0, key }) {
    if (typeof key !== "string" || !key) {
      throw new Error("search: key required");
    }
    const res = await this.client.query(this.collection, {
      query: { nearest: Array.from(embedding) },
      limit: top_k,
      score_threshold: min_score,
      filter: { must: [{ key: "key", match: { value: key } }] },
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

  async stats() {
    const { count } = await this.client.count(this.collection);
    return { entries: count };
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
