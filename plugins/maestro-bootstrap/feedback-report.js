// Feedback report mode (auto/manual/disable) — строка-директива в
// system-контекст top-level primary-сессии (режим шага 18.5 pipeline
// maestro). Self-contained модуль: НЕ импортирует core.js (core импортирует
// этот файл — ESM-цикл недопустим). Паттерны (bounded-state, fail-soft)
// повторяют communication.js.

const FEEDBACK_REPORT_MODES = new Set(["auto", "manual", "disable"]);

/**
 * Локальный разбор `feedback_report` (зеркало loadFeedbackReportConfig из
 * core.js, но без импорта — ESM-цикл недопустим). Ключ отсутствует → manual
 * (дефолт); невалидное значение → manual + invalid: true (soft fallback).
 * @param {object} [config]
 * @returns {{ mode: "auto"|"manual"|"disable", explicit: boolean, invalid: boolean }}
 */
export function parseFeedbackReport(config) {
  const value =
    config && typeof config === "object" ? config.feedback_report : undefined;
  if (value === undefined) return { mode: "manual", explicit: false, invalid: false };
  if (typeof value === "string" && FEEDBACK_REPORT_MODES.has(value)) {
    return { mode: value, explicit: true, invalid: false };
  }
  return { mode: "manual", explicit: false, invalid: true };
}

/**
 * Строка-директива (RU). Канон: «maestro.json → feedback_report: <mode>».
 * @param {string} mode  "auto" | "disable" (manual не инжектится).
 * @returns {string}
 */
export function directiveText(mode) {
  return `maestro.json → feedback_report: ${mode}`;
}

const SERVICE_TITLE_PREFIX = "[maestro-memory]";

/**
 * Регистрация feedback-report-хуков (fail-soft). Инъекция — только при
 * явном non-manual режиме и только в top-level primary-сессии (guard как у
 * communication: без parentID, без [maestro-memory]-префикса). Состояние —
 * closure (per plugin instance), bounded: cap 1024 → clear.
 * @param {{ client: object, config: object, log: object }} p
 * @returns {Promise<{ "experimental.chat.system.transform": Function }>}
 */
export async function registerFeedbackReportHooks({ client, config, log }) {
  const fr = parseFeedbackReport(config);
  if (fr.invalid) {
    log?.warn?.("feedback_report:config_fallback", { error_class: "invalid_value" });
  }
  const eligibleCache = new Map();

  const isEligible = async (sessionID) => {
    if (!sessionID) return false;
    if (eligibleCache.has(sessionID)) return eligibleCache.get(sessionID);
    let ok = false;
    try {
      const resp = await client?.session?.get({ path: { id: sessionID } });
      // Реальный SDK может вернуть обёртку { data: {...} } (прецедент
      // core.js resolveIsTrustedSubagent: resp?.data ?? resp).
      const data = resp?.data ?? resp;
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
    "experimental.chat.system.transform": async ({ sessionID }, out) => {
      try {
        if (!fr.explicit || fr.mode === "manual") return;
        if (!sessionID || !(await isEligible(sessionID))) return;
        if (out?.system) out.system.push(directiveText(fr.mode));
        log?.debug?.("feedback_report:directive_injected", { sessionID, mode: fr.mode });
      } catch {
        /* fail-soft */
      }
    },
  };
  return hooks;
}
