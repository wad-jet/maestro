import { SqliteStorage } from "./storage/sqlite.js";
import { QdrantStorage } from "./storage/qdrant.js";
import { PgVectorStorage } from "./storage/pgvector.js";

export function createStorage({ type, options, modelId, dim, textSearchConfig, log }) {
  // log принимается и top-level параметром, и внутри options (тесты/бэкенды);
  // top-level приоритетнее, иначе не затираем options.log undefined-ом.
  const opts = { ...options, log: log ?? options?.log };
  switch (type) {
    case "sqlite": return new SqliteStorage({ ...opts, modelId, dim });
    case "qdrant": return new QdrantStorage({ client: opts.client, collection: opts.collection, modelId, dim, log: opts.log });
    case "pgvector": return new PgVectorStorage({ pool: opts.pool, table: opts.table, dim, modelId, textSearchConfig, log: opts.log });
    default:
      throw new Error(`unknown storage type: ${type}`);
  }
}

// Task 6: обёртка операции бэкенда — аудит-события длительности (debug) и
// ошибки (error, error_class). Не меняет поведение/возвращаемые значения:
// успех → duration + результат; ошибка → error + rethrow.
export function timed(log, tag, fn) {
  const t0 = Date.now();
  return Promise.resolve()
    .then(fn)
    .then((r) => { log?.debug?.(`memory:storage.${tag}.duration`, { op: tag, duration_ms: Date.now() - t0 }); return r; })
    .catch((err) => { log?.error?.("memory:storage.error", { op: tag, error_class: err?.code === "DIM_MISMATCH" ? "dim_mismatch" : "storage_error" }); throw err; });
}
