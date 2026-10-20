import { sanitize } from "../core.js";

/**
 * Маскирование текстов памяти: ТОЛЬКО generic sanitize (Ур.1:
 * key=value, .env-ссылки, DB-URI, PEM, auth-заголовки, JWT, PII-поля).
 *
 * Business-confidential маскирование (line-level confidential-фильтр,
 * placeholder "[confidential]") удалено (retire-confidential, spec §4.2,
 * D3/M5/SEC-5): риск признан осознанным; memory не фильтрует содержимое
 * по confidential.paths.
 *
 * @param {string} text  Исходный текст (транскрипт / запрос / spec).
 * @returns {string}  Замаскированный текст; пустой/белый вход → "".
 */
export function maskTranscript(text) {
  const t = String(text ?? "");
  if (!t.trim()) return "";
  return sanitize(t, {}).text;
}

/**
 * Маскирование текстовых полей записи (title/summary/decisions) через
 * generic sanitize. Artifacts — pass-through как есть (паттерн-дропа нет).
 *
 * @param {object} entry  Запись памяти.
 * @returns {object}  Копия записи с замаскированными текстовыми полями.
 */
export function maskEntry(entry) {
  const maskField = (s) => {
    if (typeof s !== "string") return s;
    return sanitize(s, {}).text;
  };
  const artifacts = Array.isArray(entry.artifacts) ? entry.artifacts : (entry.artifacts ?? []);
  return {
    ...entry,
    title: maskField(entry.title),
    summary: maskField(entry.summary),
    decisions: entry.decisions?.map(maskField) ?? [],
    artifacts,
  };
}
