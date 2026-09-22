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

export const SOURCE_LABELS = Object.freeze({
  config_plain: "источник: maestro.json (communication: plain)",
  default: "источник: дефолт (plain)",
  flag: "источник: флаг --plain",
  flag_override: "источник: флаг --plain (переопределяет maestro.json professional)",
});

/**
 * Лейбл источника директивы (матрица из спеки §3.2):
 * флаг всегда побеждает конфиг (в т.ч. professional → «переопределяет»).
 * @param {{ flagMarked: boolean, communication: { mode: string, explicit: boolean, invalid: boolean } }} p
 * @returns {string}
 */
export function resolveDirectiveLabel({ flagMarked, communication }) {
  if (flagMarked) {
    return communication.mode === "professional" ? SOURCE_LABELS.flag_override : SOURCE_LABELS.flag;
  }
  return communication.explicit ? SOURCE_LABELS.config_plain : SOURCE_LABELS.default;
}

/**
 * Короткая самодостаточная директива (RU). Точный текст — канон спеки §4.
 * @param {string} label  Один из SOURCE_LABELS.
 * @returns {string}
 */
export function directiveText(label) {
  return (
    "Общайся с пользователем простым понятным языком: примеры и аналогии " +
    "вместо жаргона; сложные термины — только когда без них нельзя, с коротким " +
    "пояснением; техническая конкретика — только по запросу или когда мысль не " +
    "донести иначе. Не распространяется на артефакты (спецы/планы/код/доки) и на " +
    "субагентов. Security-находки и точные технические детали — всегда полностью. " +
    label
  );
}
