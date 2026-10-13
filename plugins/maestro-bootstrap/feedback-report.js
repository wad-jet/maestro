// Feedback report mode (auto/manual/disable) — V2 migration.
// Self-contained module: NOT importing core.js (ESM-cycle guard).

const FEEDBACK_REPORT_MODES = new Set(["auto", "manual", "disable"]);

export function parseFeedbackReport(config) {
  const value =
    config && typeof config === "object" ? config.feedback_report : undefined;
  if (value === undefined) return { mode: "manual", explicit: false, invalid: false };
  if (typeof value === "string" && FEEDBACK_REPORT_MODES.has(value)) {
    return { mode: value, explicit: true, invalid: false };
  }
  return { mode: "manual", explicit: false, invalid: true };
}

export function directiveText(mode) {
  return `maestro.json → feedback_report: ${mode}`;
}

const SERVICE_TITLE_PREFIX = "[maestro-memory]";

/**
 * V2: registers feedback-report directive via ctx.session.hook("context", ...).
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
      const resp = await client?.session?.get?.({ path: { id: sessionID } });
      const data = resp?.data ?? resp;
      ok = Boolean(data) && !data.parentID &&
        !(typeof data.title === "string" && data.title.startsWith(SERVICE_TITLE_PREFIX));
    } catch {
      ok = false;
    }
    eligibleCache.set(sessionID, ok);
    if (eligibleCache.size > 1024) eligibleCache.clear();
    return ok;
  };

  // V1: system.transform — eligibility-guard + инжект директивы (без дедупа)
  const onSystemTransform = async ({ sessionID }, out) => {
    try {
      if (!fr.explicit || fr.mode === "manual") return;
      if (!sessionID || !(await isEligible(sessionID))) return;
      if (out?.system) out.system.push(directiveText(fr.mode));
      log?.debug?.("feedback_report:directive_injected", { sessionID, mode: fr.mode });
    } catch {
      /* fail-soft */
    }
  };

  // V2: context hook — та же логика + дедупликация (хук может сработать
  // повторно на request)
  const registration = await client?.session?.hook?.("context", async (event) => {
    try {
      if (!fr.explicit || fr.mode === "manual") return;
      const sessionID = event?.sessionID;
      if (!sessionID || !(await isEligible(sessionID))) return;

      const directive = directiveText(fr.mode);
      if (!event.system) event.system = [];
      if (!event.system.some(s => typeof s === "string" && s.includes("feedback_report"))) {
        event.system.push(directive);
      }
      log?.debug?.("feedback_report:directive_injected", { sessionID, mode: fr.mode });
    } catch {
      /* fail-soft */
    }
  });

  return {
    "experimental.chat.system.transform": onSystemTransform,
    dispose: () => {
      try { registration?.dispose?.(); } catch {}
    },
  };
}
