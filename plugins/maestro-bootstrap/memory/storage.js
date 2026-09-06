import { SqliteStorage } from "./storage/sqlite.js";
import { QdrantStorage } from "./storage/qdrant.js";

export function createStorage({ type, options, modelId, dim }) {
  switch (type) {
    case "sqlite": return new SqliteStorage({ ...options, modelId, dim });
    case "qdrant": return new QdrantStorage({ client: options.client, collection: options.collection, modelId, dim });
    case "pgvector":
      throw new Error(`NOT_IMPLEMENTED: ${type}`);
    default:
      throw new Error(`unknown storage type: ${type}`);
  }
}
