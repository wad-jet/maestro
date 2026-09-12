import { createHash } from "node:crypto";

const NAMESPACE_RE = /^[a-z0-9]([a-z0-9-]{0,30}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,30}[a-z0-9])?){0,2}$/;
export function normalizeNamespace(ns) {
  if (typeof ns !== "string") return null;
  return ns.trim().toLowerCase();
}
export function namespaceValid(ns) {
  const n = normalizeNamespace(ns);
  return typeof n === "string" && n.length > 0 && n.length <= 100 && NAMESPACE_RE.test(n);
}
function namespaceMissing(m) { return !m?.namespace; }
function namespaceInvalid(m) { return m?.namespace != null && !namespaceValid(m.namespace); }
function relatedValid(m) {
  const r = m?.related;
  if (r == null) return true;
  return Array.isArray(r) && r.length <= 16 && r.every((x) => namespaceValid(x));
}
function domainRecallValid(m) {
  if (m?.domain_recall == null) return true;
  return typeof m.domain_recall === "boolean";
}

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
  delete_on_session_delete: false,
  summarize_timeout_ms: 120000,
  branch_context: true,
  mainline: null,
  related: null,
  domain_recall: true,
  storage: { type: "sqlite", qdrant: null, pgvector: null },
  embedding: {
    provider: "local",
    model: null,
    base_url: "https://api.openai.com/v1",
    api_key_env: null,
    dim: null,
  },
  probe_cooldown_min: 30,
  artifact_globs: ["docs/superpowers/specs/**", "docs/superpowers/plans/**"],
  history_globs: null,
};

const STORAGE_TYPES = new Set(["sqlite", "qdrant", "pgvector"]);

// Имя конфигурации полнотекстового поиска Postgres (pgvector). Допустимы
// только строчные идентификаторы: /^[a-z][a-z0-9_]*$/ и длина ≤ 63 байт
// (лимит идентификаторов Postgres). Fallback — "russian".
const TEXT_SEARCH_CONFIG_RE = /^[a-z][a-z0-9_]*$/;

function mergedConfig(m) {
  const type = m.storage?.type ?? "sqlite";
  const provider = m.embedding?.provider ?? "local";
  const embedding = {
    provider,
    model: m.embedding?.model ?? (provider === "local" ? (m.embedding_model ?? DEFAULTS.embedding_model) : null),
    base_url: (m.embedding?.base_url ?? "https://api.openai.com/v1").replace(/\/+$/, ""),
    api_key_env: m.embedding?.api_key_env ?? null,
    dim: provider === "local" ? null : (m.embedding?.dim ?? null),
  };
  return {
    ...DEFAULTS,
    ...m,
    namespace: m?.namespace != null ? normalizeNamespace(m.namespace) : null,
    related: m?.related != null ? m.related.map((x) => normalizeNamespace(x)) : null,
    embedding,
    probe_cooldown_min: m.probe_cooldown_min ?? DEFAULTS.probe_cooldown_min,
    storage: {
      type,
      qdrant: m.storage?.qdrant ?? null,
      pgvector: {
        ...(m.storage?.pgvector ?? {}),
        // M5: только документированный вложенный ключ (spec §4); flat-алиас
        // storage.text_search_config убран за строгость.
        text_search_config: m.storage?.pgvector?.text_search_config ?? "russian",
      },
    },
    artifact_globs: [...new Set((m.artifact_globs ?? DEFAULTS.artifact_globs).map((s) => s.trim()).filter(Boolean))],
    history_globs: m.history_globs,
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
  // M5: читаем только вложенный ключ (spec §4); flat-алиас убран.
  const v = m?.storage?.pgvector?.text_search_config;
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
 * artifact_globs: absent/null → default (see DEFAULTS); `[]` = off;
 * array of non-empty strings (≤ 16 items) → used; anything else → invalid
 * (memory disabled). Shared by classifyMemoryConfig
 * (zero-dep gate) and loadMemoryConfig.
 * @param {object} m  The `memory` config section.
 * @returns {boolean}  True when artifact_globs is valid (or absent).
 */
function artifactGlobsValid(m) {
  const g = m?.artifact_globs;
  if (g == null) return true;
  return Array.isArray(g)
    && g.length <= 16
    && g.every((x) => typeof x === "string" && x.length > 0);
}

// Имя mainline-ветки: допустимы буквы/цифры/`_`/`/`/`.`/`-`, длина ≤ 100.
const MAINLINE_RE = /^[a-zA-Z0-9_\/.-]+$/;

/**
 * mainline: null (off) or a valid branch name (string ≤ 100 chars matching
 * MAINLINE_RE); anything else → invalid (memory disabled). Shared by
 * classifyMemoryConfig (zero-dep gate) and loadMemoryConfig.
 * @param {object} m  The `memory` config section.
 * @returns {boolean}  True when mainline is valid (or absent/null).
 */
function mainlineValid(m) {
  if (m?.mainline == null) return true;
  return typeof m.mainline === "string" && m.mainline.length <= 100 && MAINLINE_RE.test(m.mainline);
}

/**
 * branch_context: null (default true) or a boolean; anything else → invalid
 * (memory disabled). Shared by classifyMemoryConfig (zero-dep gate) and
 * loadMemoryConfig.
 * @param {object} m  The `memory` config section.
 * @returns {boolean}  True when branch_context is valid (or absent).
 */
function branchContextValid(m) {
  if (m?.branch_context == null) return true;
  return typeof m.branch_context === "boolean";
}

function deleteOnSessionDeleteValid(m) {
  if (m?.delete_on_session_delete == null) return true;
  return typeof m.delete_on_session_delete === "boolean";
}

// Идентификаторы провайдеров эмбеддингов, поддерживаемых в конфиге.
const EMBEDDING_PROVIDERS = new Set(["local", "openai"]);

/**
 * Валидация блока memory.embedding: provider ∈ {local, openai}, для openai
 * обязательны model / api_key_env / dim. При отсутствии блока — true (local
 * default применяется в mergedConfig).
 * @param {object} m  The `memory` config section.
 * @returns {boolean}  True when embedding is valid (or absent).
 */
function embeddingValid(m) {
  const e = m.embedding;
  if (e == null) return true; // отсутствует → local default
  if (typeof e !== "object" || Array.isArray(e)) return false;
  const provider = e.provider ?? "local";
  if (!EMBEDDING_PROVIDERS.has(provider)) return false;
  // Spec §2.1: base_url — строка. Не-строка (напр. 8080) прошла бы gate и
  // упала TypeError в mergedConfig .replace(...) на централизованных бэкендах.
  if (e.base_url != null && typeof e.base_url !== "string") return false;
  if (provider === "openai") {
    if (typeof e.model !== "string" || e.model.length === 0) return false;
    if (typeof e.api_key_env !== "string" || e.api_key_env.length === 0) return false;
    if (e.dim == null || !Number.isInteger(e.dim) || e.dim <= 0) return false;
  }
  return true;
}

/**
 * probe_cooldown_min: null (не задан → default 30) или положительное число;
 * иначе → невалидно (память отключена). Shared by classifyMemoryConfig and
 * loadMemoryConfig.
 * @param {object} m  The `memory` config section.
 * @returns {boolean}  True when probe_cooldown_min is valid (or absent).
 */
function probeCooldownValid(m) {
  if (m?.probe_cooldown_min == null) return true;
  return typeof m.probe_cooldown_min === "number" && m.probe_cooldown_min > 0;
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
  if (namespaceMissing(m)) return { enabled: false, disabled_reason: "namespace_missing" };
  if (namespaceInvalid(m)) return { enabled: false, disabled_reason: "namespace_invalid" };
  if (!relatedValid(m)) return { enabled: false, disabled_reason: "related_invalid" };
  if (!domainRecallValid(m)) return { enabled: false, disabled_reason: "domain_recall_invalid" };
  if (!retentionDaysValid(m)) return { enabled: false, disabled_reason: "retention_days_invalid" };
  if (!similarityThresholdValid(m)) return { enabled: false, disabled_reason: "similarity_threshold_invalid" };
  if (!artifactGlobsValid(m)) return { enabled: false, disabled_reason: "artifact_globs_invalid" };
  const type = m.storage?.type ?? "sqlite";
  if (!STORAGE_TYPES.has(type)) return { enabled: false, disabled_reason: "storage_type_invalid" };
  if (!pgvectorTextSearchConfigValid(m)) return { enabled: false, disabled_reason: "pgvector_text_search_config_invalid" };
  if (!branchContextValid(m)) return { enabled: false, disabled_reason: "branch_context_invalid" };
  if (!deleteOnSessionDeleteValid(m)) return { enabled: false, disabled_reason: "delete_on_session_delete_invalid" };
  if (!embeddingValid(m)) return { enabled: false, disabled_reason: "embedding_invalid" };
  if (!probeCooldownValid(m)) return { enabled: false, disabled_reason: "probe_cooldown_min_invalid" };
  if (!mainlineValid(m)) return { enabled: false, disabled_reason: "mainline_invalid" };
  const centralized = type !== "sqlite";
  if (centralized) {
    const cfg = mergedConfig(m);
    if (!resolveIdentity({ config: cfg, env: process.env, gitName })) {
      return { enabled: false, disabled_reason: "centralized_identity_missing" };
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

/**
 * resolveHistoryGlobs: возвращает нормализованные history_globs.
 * Если history_globs absent/null → inherit на artifact_globs (fallback=false).
 * Валидный array → trim + unique (fallback=false); [] → [] (off, fallback=false).
 * Не-валидный input (non-array, non-string элементы, >16) → soft fallback на
 * artifact_globs (memory НЕ отключается, fallback=true).
 * @param {object} config  Merged memory config (loadMemoryConfig output).
 * @returns {{ value: string[], fallback: boolean }}
 */
export function resolveHistoryGlobs(config) {
  const hg = config?.history_globs;
  const default_globs = config?.artifact_globs ?? DEFAULTS.artifact_globs;

  if (hg == null) {
    return { value: [...default_globs], fallback: false };
  }
  if (!Array.isArray(hg)) {
    return { value: [...default_globs], fallback: true };
  }
  if (hg.length > 16) {
    return { value: [...default_globs], fallback: true };
  }
  // Validate all elements are strings BEFORE trimming
  if (hg.some((x) => typeof x !== "string")) {
    return { value: [...default_globs], fallback: true };
  }
  // valid array → trim + unique
  return { value: [...new Set(hg.map((s) => s.trim()))], fallback: false };
}
