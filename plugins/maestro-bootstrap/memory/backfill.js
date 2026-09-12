import { extractArtifacts } from "./artifacts.js";
import { maskEntry } from "./mask.js";
import { SESSIONS } from "./summarize.js";

// Локальный нормализатор embedding (spec §4.2.1 п.2): дублируется из index.js
// без рефакторинга. sqlite возвращает Buffer (BLOB) → Float32Array-view;
// Float32Array/Array — passthrough; прочее (string/null/…) → null.
function toF32(v) {
  if (v instanceof Float32Array) return v;
  if (Array.isArray(v)) return new Float32Array(v);
  if (v?.buffer) return new Float32Array(v.buffer, v.byteOffset, v.byteLength / 4);
  return null;
}

// Поля записи для полного upsert (RI-3: спред из existing — меняются только
// artifacts + version). embedding — opt-in поле scan (C1: storage.get затирает
// embedding на всех бэкендах; scan без fields его не возвращает).
const SCAN_FIELDS = [
  "session_id", "key", "origin_project_hash", "title", "summary", "decisions",
  "artifacts", "author", "time_first", "time_last", "version", "model_id",
  "embedding", "branch", "head", "merged", "host", "origin_remote", "prefixes",
];

const MAX_ARTIFACTS = 8;

/**
 * Light-путь бэкфилла artifacts (spec §4.2.1): детерминированное извлечение
 * путей записанных файлов из сообщений сессии + union с existing.artifacts.
 *
 * Инварианты: 0 LLM (RI-5); меняет только artifacts + version (RI-3); не пишет
 * в state (RI-4 — state не входит в deps); no-op guard — case-insensitive
 * set-равенство union и existing → без upsert (RI-7); maskEntry перед upsert
 * (G2-parity: artifacts — resolved-набор, текст — raw-набор).
 *
 * @param {{ client: object, storage: object, root: string, key: string,
 *   artifactGlobs: string[], artifactConfidentialPatterns: string[],
 *   confidentialPatterns: string[], embedModelId: string }} deps
 * @param {string} sessionID
 * @returns {Promise<{ status: string, artifacts: string[] }>}
 *   status: updated | no_change | skip_no_record | skip_model_mismatch |
 *   skip_messages_unavailable | skip_no_embedding | skip_service
 */
export async function reindexSessionArtifacts(deps, sessionID) {
  const {
    client, storage, root, key, artifactGlobs,
    artifactConfidentialPatterns, confidentialPatterns, embedModelId,
  } = deps;

  // 1. Служебные сессии (саммаризатор) — вне индексации.
  if (SESSIONS.has(sessionID)) return { status: "skip_service", artifacts: [] };

  // 2. Запись — scan (embedding opt-in) + filter по session_id.
  const rows = await storage.scan({ key, fields: SCAN_FIELDS });
  const existing = rows.find((r) => r.session_id === sessionID);
  if (!existing) return { status: "skip_no_record", artifacts: [] };

  // 3. Модель записи должна совпадать с активной (смешение эмбеддингов разных
  // моделей в одном бакете ломает поиск; пере-embed = уже полный путь).
  if (existing.model_id !== embedModelId) {
    return { status: "skip_model_mismatch", artifacts: existing.artifacts ?? [] };
  }

  // 4. Пустой embedding → пере-embed = полный путь, не light.
  if (!existing.embedding || existing.embedding.length === 0) {
    return { status: "skip_no_embedding", artifacts: existing.artifacts ?? [] };
  }

  // 5. Сообщения сессии — ошибка/пусто → недоступны.
  let messages;
  try {
    const resp = await client.session.messages({ path: { id: sessionID } });
    messages = (resp?.data ?? resp) ?? [];
  } catch {
    return { status: "skip_messages_unavailable", artifacts: existing.artifacts ?? [] };
  }
  if (!Array.isArray(messages) || messages.length === 0) {
    return { status: "skip_messages_unavailable", artifacts: existing.artifacts ?? [] };
  }

  // 6. Извлечение артефактов (resolved-набор, как в indexer).
  const extracted = extractArtifacts(messages, {
    root,
    globs: artifactGlobs,
    confidentialPatterns: artifactConfidentialPatterns,
  });

  // 7. Union D6: extracted-first, dedup case-insensitive, cap 8.
  const unionSeen = new Set();
  const union = [];
  for (const p of [...extracted, ...(existing.artifacts ?? [])]) {
    const k = String(p).toLowerCase();
    if (unionSeen.has(k)) continue;
    unionSeen.add(k);
    union.push(p);
  }
  const artifacts = union.slice(0, MAX_ARTIFACTS);

  // 8. No-op guard (RI-7): case-insensitive set-равенство → без upsert.
  const existingLower = new Set((existing.artifacts ?? []).map((p) => String(p).toLowerCase()));
  if (artifacts.length === existingLower.size && artifacts.every((p) => existingLower.has(String(p).toLowerCase()))) {
    return { status: "no_change", artifacts };
  }

  // 9. Entry: спред из existing (RI-3), меняются только artifacts + version.
  const entry = {
    ...existing,
    artifacts,
    version: (existing.version ?? 0) + 1,
    embedding: toF32(existing.embedding),
  };
  // G2-parity: maskEntry перед upsert (artifacts — resolved-набор drop,
  // текст — raw-набор) — чистит stale-пути из existing под текущим конфигом.
  const masked = maskEntry(entry, {
    confidentialPatterns,
    artifactConfidentialPatterns,
  });
  await storage.upsert([masked]);
  return { status: "updated", artifacts: masked.artifacts };
}