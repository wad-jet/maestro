import { createHash } from "node:crypto";

export const DEFAULTS = {
  enabled: false,
  auto_recall: true,
  embedding_model: "Xenova/paraphrase-multilingual-MiniLM-L12-v2",
  summarizer_model: null,
  identity: null,
  identity_env: null,
  namespace: null,
  module_dir: null,
  idle_debounce_min: 10,
  min_new_messages: 3,
  backfill_window_days: 30,
  backfill_max_per_start: 5,
  retry_interval_min: 60,
  top_k: 3,
  min_score: 0.35,
  summarize_timeout_ms: 120000,
  storage: { type: "sqlite", centralized_confidential: "forbid" },
};

const STORAGE_TYPES = new Set(["sqlite", "qdrant", "pgvector"]);

export function loadMemoryConfig(maestroJson) {
  const m = maestroJson?.memory;
  if (!m) return { ...DEFAULTS, enabled: false, disabled_reason: "no_memory_section" };
  if (m.enabled !== true) return { ...DEFAULTS, enabled: false, disabled_reason: "explicitly_disabled" };
  const type = m.storage?.type ?? "sqlite";
  if (!STORAGE_TYPES.has(type)) return { ...DEFAULTS, enabled: false, disabled_reason: "storage_type_invalid" };
  const centralized = type !== "sqlite";
  const cfg = {
    ...DEFAULTS,
    ...m,
    storage: {
      type,
      qdrant: m.storage?.qdrant ?? null,
      pgvector: m.storage?.pgvector ?? null,
      centralized_confidential: m.storage?.centralized_confidential ?? "forbid",
    },
  };
  if (centralized && !resolveIdentity({ config: cfg, env: process.env, gitName: null })) {
    return { ...DEFAULTS, enabled: false, disabled_reason: "centralized_identity_missing" };
  }
  if (centralized && cfg.storage.centralized_confidential !== "allow" && cfg.storage.centralized_confidential !== "forbid") {
    return { ...DEFAULTS, enabled: false, disabled_reason: "centralized_confidential_invalid" };
  }
  return cfg;
}

export function resolveEffectiveKey({ projectHash, namespace }) {
  return namespace ?? projectHash;
}

export function resolveIdentity({ config, env, gitName }) {
  if (config.identity) return config.identity;
  if (config.identity_env && env[config.identity_env]) return env[config.identity_env];
  if (gitName) return gitName;
  return null;
}

export function sanitizeDirName(s) {
  return createHash("sha256").update(s).digest("hex").slice(0, 16);
}
