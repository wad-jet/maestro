import { SqliteStorage } from "./storage/sqlite.js";

export function createStorage({ type, options, modelId, dim }) {
  switch (type) {
    case "sqlite": return new SqliteStorage({ ...options, modelId, dim });
    case "qdrant":
    case "pgvector":
      throw new Error(`NOT_IMPLEMENTED: ${type}`);
    default:
      throw new Error(`unknown storage type: ${type}`);
  }
}
