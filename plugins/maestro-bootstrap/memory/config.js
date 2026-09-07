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
  similarity_threshold: 0.7,
  retention_days: null,
  summarize_timeout_ms: 120000,
  storage: { type: "sqlite", centralized_confidential: "forbid" },
};

const STORAGE_TYPES = new Set(["sqlite", "qdrant", "pgvector"]);

// Имя конфигурации полнотекстового поиска Postgres (pgvector). Допустимы
// только строчные идентификаторы: /^[a-z][a-z0-9_]*$/ и длина ≤ 63 байт
// (лимит идентификаторов Postgres). Fallback — "russian".
const TEXT_SEARCH_CONFIG_RE = /^[a-z][a-z0-9_]*$/;

function mergedConfig(m) {
  const type = m.storage?.type ?? "sqlite";
  return {
    ...DEFAULTS,
    ...m,
    storage: {
      type,
      qdrant: m.storage?.qdrant ?? null,
      pgvector: {
        ...(m.storage?.pgvector ?? {}),
        text_search_config: m.storage?.text_search_config ?? m.storage?.pgvector?.text_search_config ?? "russian",
      },
      centralized_confidential: m.storage?.centralized_confidential ?? "forbid",
    },
  };
}

/**
 * text_search_config: валиден только для pgvector. Нерелевантный ключ в
 * sqlite/qdrant-конфиге НЕ отключает память. Валидация: строка, длина ≤ 63
 * байта и /^[a-z][a-z0-9_]*$/. Shared by classifyMemoryConfig (zero-dep gate)
 * и loadMemoryConfig.
 * @param {object} m  The `memory` config section.
 * @returns {boolean}  True когда text_search_config валиден (или отсутствует).
 */
function pgvectorTextSearchConfigValid(m) {
  if (m?.storage?.type !== "pgvector") return true;
  const v = m?.storage?.text_search_config ?? m?.storage?.pgvector?.text_search_config;
  if (v == null) return true;
  return typeof v === "string" && v.length <= 63 && TEXT_SEARCH_CONFIG_RE.test(v);
}

/**
 * retention_days: null (off) or a positive number; anything else → invalid.
 * Shared by classifyMemoryConfig (zero-dep gate) and loadMemoryConfig.
 * @param {object} m  The `memory` config section.
 * @returns {boolean}  True when retention_days is valid (or absent/null).
 */
function retentionDaysValid(m) {
  if (m?.retention_days == null) return true;
  return typeof m.retention_days === "number" && m.retention_days > 0;
}

/**
 * similarity_threshold: number in [0, 1] (cosine threshold for clusters/graph);
 * anything else → invalid (memory disabled). Shared by classifyMemoryConfig
 * (zero-dep gate) and loadMemoryConfig.
 * @param {object} m  The `memory` config section.
 * @returns {boolean}  True when similarity_threshold is valid (or absent).
 */
function similarityThresholdValid(m) {
  if (m?.similarity_threshold == null) return true;
  return typeof m.similarity_threshold === "number"
    && m.similarity_threshold >= 0
    && m.similarity_threshold <= 1;
}

/**
 * Lightweight classification of the memory config — NO storage imports.
 * Used by core.js BEFORE any memory module import (zero-dep gate, C1) and
 * re-used by loadMemoryConfig / registerMemoryHooks.
 * @param {object} maestroJson  Parsed maestro.json.
 * @param {{ gitName?: string|null }} [opts]  Git user.name (identity fallback).
 * @returns {{ enabled: boolean, disabled_reason: string|null }}
 */
export function classifyMemoryConfig(maestroJson, { gitName = null } = {}) {
  const m = maestroJson?.memory;
  if (!m) return { enabled: false, disabled_reason: "no_memory_section" };
  if (m.enabled !== true) return { enabled: false, disabled_reason: "explicitly_disabled" };
  if (!retentionDaysValid(m)) return { enabled: false, disabled_reason: "retention_days_invalid" };
  if (!similarityThresholdValid(m)) return { enabled: false, disabled_reason: "similarity_threshold_invalid" };
  const type = m.storage?.type ?? "sqlite";
  if (!STORAGE_TYPES.has(type)) return { enabled: false, disabled_reason: "storage_type_invalid" };
  if (!pgvectorTextSearchConfigValid(m)) return { enabled: false, disabled_reason: "pgvector_text_search_config_invalid" };
  const centralized = type !== "sqlite";
  if (centralized) {
    const cfg = mergedConfig(m);
    if (!resolveIdentity({ config: cfg, env: process.env, gitName })) {
      return { enabled: false, disabled_reason: "centralized_identity_missing" };
    }
    if (cfg.storage.centralized_confidential !== "allow" && cfg.storage.centralized_confidential !== "forbid") {
      return { enabled: false, disabled_reason: "centralized_confidential_invalid" };
    }
  }
  return { enabled: true, disabled_reason: null };
}

export function loadMemoryConfig(maestroJson, { gitName = null } = {}) {
  const { enabled, disabled_reason } = classifyMemoryConfig(maestroJson, { gitName });
  if (!enabled) return { ...DEFAULTS, enabled: false, disabled_reason };
  return mergedConfig(maestroJson.memory);
}

export function resolveEffectiveKey({ projectHash, namespace }) {
  return namespace ?? projectHash;
}

/**
 * Эффективная конфигурация полнотекстового поиска Postgres: валидный
 * конфигурированный text_search_config ИЛИ fallback "russian". Используется
 * Task 3 (pgvector-запросы) для выбора конфигурации to_tsvector.
 * @param {object} config  Merged memory config (loadMemoryConfig output).
 * @returns {string}  Валидный text_search_config или "russian".
 */
export function resolveEffectiveTextConfig(config) {
  const v = config?.storage?.pgvector?.text_search_config;
  return (typeof v === "string" && v.length <= 63 && TEXT_SEARCH_CONFIG_RE.test(v)) ? v : "russian";
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
