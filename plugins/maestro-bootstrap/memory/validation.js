import { confGlobMatch } from "../core.js";

/**
 * Поля, обязательные для импорта (отражает `memory` table schema v3).
 * git-метаданные branch/head/merged — опциональны при импорте.
 */
export const IMPORT_REQUIRED = [
  "session_id", "key", "origin_project_hash", "title", "summary", "decisions",
  "model_id", "author", "time_first", "time_last", "version",
];

/**
 * Validate a parsed memory-import entry.
 *
 * Returns an error reason string, or null when valid.
 * Mutates `e.artifacts` to `[]` if absent (v5.2 optional field default).
 * @param {object} e  Parsed entry.
 * @param {{ modelId: string, dim: number }} storage  Storage model identity
 *   (set in constructors on all backends; what upsert enforces).
 * @param {string} effectiveKey  Active project key (I-4 fail-closed on mismatch).
 * @param {string[]} [artifactConfidentialPatterns=[]]  Resolved confidential set for
 *   artifacts (paths + builtin). CR-3: matching artifact elements are DROPPED
 *   (запись импортируется, элемент отбрасывается).
 * @returns {string|null}
 */
export function validateImportEntry(e, storage, effectiveKey, artifactConfidentialPatterns = []) {
  if (!e || typeof e !== "object") return "не объект";
  for (const f of IMPORT_REQUIRED) {
    if (e[f] === undefined || e[f] === null) return `отсутствует поле ${f}`;
  }
  if (!Array.isArray(e.decisions)) return "decisions не массив";
  if (!Array.isArray(e.embedding)) return "embedding не массив";
  // Task 7 (v5.2): опциональное `artifacts` — массив repo-relative строк.
  // Отсутствует → [] (старые записи). Не-массив/нарушения → reject записи.
  if (e.artifacts === undefined) {
    e.artifacts = [];
  } else if (!Array.isArray(e.artifacts)) {
    return "artifacts не массив";
  } else if (e.artifacts.length > 8) {
    return "artifacts: больше 8 элементов";
  } else {
    for (const a of e.artifacts) {
      if (typeof a !== "string") return "artifacts: элемент не строка";
      if (a.length > 512) return "artifacts: элемент длиннее 512 символов";
      if (/[\u0000-\u001f\u007f]/.test(a)) return "artifacts: элемент содержит control chars";
      // repo-relative форма: ведущий `/`, `..`-сегмент, backslash, drive-letter.
      if (a.startsWith("/")) return "artifacts: ведущий /";
      if (a.split(/[\\/]+/).includes("..")) return "artifacts: ..-сегмент";
      if (a.includes("\\")) return "artifacts: backslash";
      if (/^[a-zA-Z]:/.test(a)) return "artifacts: drive-letter";
    }
    // CR-3: после валидации — drop элементов, матчащих resolved confidential-набор.
    const lowerConf = artifactConfidentialPatterns
      .filter((p) => typeof p === "string" && p)
      .map((p) => p.toLowerCase());
    if (lowerConf.length) {
      e.artifacts = e.artifacts.filter((a) => !lowerConf.some((pat) => confGlobMatch(pat, a.toLowerCase())));
    }
  }
  // M-10: numeric time/version fields + finite embedding values.
  if (typeof e.time_first !== "number") return "time_first не число";
  if (typeof e.time_last !== "number") return "time_last не число";
  if (typeof e.version !== "number") return "version не число";
  if (!e.embedding.every((n) => typeof n === "number" && Number.isFinite(n))) {
    return "embedding содержит нечисловые/неконечные значения";
  }
  // I-4: fail-closed — файл от другого проекта не импортируем.
  if (e.key !== effectiveKey) return "key не совпадает с активным проектом";
  if (e.model_id !== storage.modelId) {
    return `model_id не совпадает (файл=${e.model_id}, хранилище=${storage.modelId})`;
  }
  if (e.embedding.length !== storage.dim) {
    return `размерность embedding не совпадает (файл=${e.embedding.length}, хранилище=${storage.dim})`;
  }
  return null;
}
