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

// Дублирует COMMUNICATION_MODES из core.js (не импортируем — ESM-цикл:
// core импортирует этот файл). Enum-совпадение с core гарантируется тестами
// Task 1 (loadCommunicationConfig) и здесь.
const COMM_MODES = new Set(["plain", "professional"]);

/**
 * Локальный разбор `communication` (зеркало loadCommunicationConfig из core.js,
 * но без импорта — ESM-цикл недопустим). Ключ отсутствует → plain (дефолт);
 * невалидное значение → plain + invalid: true (soft fallback).
 * @param {object} [config]
 * @returns {{ mode: "plain"|"professional", explicit: boolean, invalid: boolean }}
 */
function parseCommunication(config) {
  const value =
    config && typeof config === "object" ? config.communication : undefined;
  if (value === undefined) return { mode: "plain", explicit: false, invalid: false };
  if (typeof value === "string" && COMM_MODES.has(value)) {
    return { mode: value, explicit: true, invalid: false };
  }
  return { mode: "plain", explicit: false, invalid: true };
}

export const SERVICE_TITLE_PREFIX = "[maestro-memory]";

/**
 * Регистрация communication-хуков (fail-soft). Состояние — closure
 * (per plugin instance), bounded: cap 1024 → clear (паттерн makeBoundedMap).
 * @param {{ client: object, config: object, log: object }} p
 * @returns {Promise<{ "chat.message": Function, "experimental.chat.system.transform": Function }>}
 */
export async function registerCommunicationHooks({ client, config, log }) {
  const comm = parseCommunication(config);
  if (comm.invalid) {
    log?.warn?.("communication:config_fallback", { error_class: "invalid_value" });
  }
  const flagSessions = new Set();
  const eligibleCache = new Map(); // sessionID → true (стабильно за сессию)

  const isEligible = async (sessionID) => {
    if (!sessionID) return false;
    if (eligibleCache.has(sessionID)) return eligibleCache.get(sessionID);
    let ok = false;
    try {
      const data = await client?.session?.get({ path: { id: sessionID } });
      // task-сессии субагентов и сервис-сессии плагина ([maestro-memory] —
      // саммаризатор/git-backfill, top-level без parent) исключены.
      ok = Boolean(data) && !data.parentID &&
        !(typeof data.title === "string" && data.title.startsWith(SERVICE_TITLE_PREFIX));
    } catch {
      ok = false; // консервативно: ошибка → без инъекции
    }
    eligibleCache.set(sessionID, ok);
    if (eligibleCache.size > 1024) eligibleCache.clear();
    return ok;
  };

  const hooks = {
    "chat.message": async (input, output) => {
      try {
        const sessionID = input?.sessionID;
        if (!sessionID || !(await isEligible(sessionID))) return;
        const text = (output?.message?.parts ?? [])
          .filter((p) => p.type === "text")
          .map((p) => p.text ?? "")
          .join(" ");
        if (detectPlainFlag(text) && !flagSessions.has(sessionID)) {
          flagSessions.add(sessionID);
          log?.info?.("communication:flag_plain", { sessionID });
        }
      } catch {
        /* fail-soft */
      }
    },

    "experimental.chat.system.transform": async ({ sessionID }, out) => {
      try {
        if (!sessionID || !(await isEligible(sessionID))) return;
        const flagMarked = flagSessions.has(sessionID);
        if (comm.mode !== "plain" && !flagMarked) return;
        const label = resolveDirectiveLabel({ flagMarked, communication: comm });
        if (out?.system) out.system.push(directiveText(label));
        log?.debug?.("communication:directive_injected", { sessionID, source: label });
      } catch {
        /* fail-soft */
      }
    },
  };
  return hooks;
}
