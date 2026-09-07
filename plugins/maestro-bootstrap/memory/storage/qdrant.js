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
      id: `${e.session_id}_${i}`,
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

  async delete(session_id, { key } = {}) {
    const q = { match: { key: "session_id", value: session_id } };
    const filter = key ? { must: [{ key: "key", match: { value: key } }] } : undefined;
    const existing = await this.client.query(this.collection, {
      query: q,
      limit: 100,
      filter,
      with_payload: false,
    });
    const ids = (existing.points ?? []).map((r) => r.id);
    if (ids.length) {
      await this.client.delete(this.collection, { points: ids });
    }
  }

  async stats() {
    const { count } = await this.client.count(this.collection);
    return { entries: count };
  }

  async get(session_id) {
    const res = await this.client.query(this.collection, {
      query: null,
      limit: 1,
      filter: { must: [{ key: "session_id", match: { value: session_id } }] },
      with_payload: true,
    });
    const point = (res.points ?? [])[0];
    if (!point) return null;
    return { ...point.payload, embedding: undefined, decisions: JSON.parse(point.payload.decisions) };
  }
}
