// Communication (plain language) — режим «простой язык» для HITL-диалога.
// Self-contained модуль: НЕ импортирует core.js (core импортирует этот файл —
// ESM-цикл недопустим). Паттерны (bounded-state, fail-soft) повторяют
// memory-модуль, но без общих зависимостей.

const COMMAND_RE = /(?:@|\/)maestro-init\b/;
const FLAG_RE = /(?:^|\s)--plain(?=\s|$)/;

/**
 * Флаг `--plain` в тексте сообщения: команда @maestro-init//maestro-init
 * И флаг --plain (целое слово). Known limitation (принятый прецедент, как у
 * --auto-answer): текст задачи, содержащий оба литерала, даёт ложную
 * маркировку — принимается как допустимый риск.
 * @param {unknown} text
 * @returns {boolean}
 */
export function detectPlainFlag(text) {
  if (typeof text !== "string") return false;
  return COMMAND_RE.test(text) && FLAG_RE.test(text);
}
