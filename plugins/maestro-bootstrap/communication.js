// Communication (plain language) — V2 migration.
// Self-contained module: NOT importing core.js (ESM-cycle guard).

const COMMAND_RE = /(?:@|\/)maestro-init\b/;
const FLAG_RE = /(?:^|\s)--plain(?=\s|$)/;

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

export function resolveDirectiveLabel({ flagMarked, communication }) {
  if (flagMarked) {
    return communication.mode === "professional" ? SOURCE_LABELS.flag_override : SOURCE_LABELS.flag;
  }
  return communication.explicit ? SOURCE_LABELS.config_plain : SOURCE_LABELS.default;
}

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

const COMM_MODES = new Set(["plain", "professional"]);

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
 * V2: registers communication hooks via ctx.session.hook("context", ...).
 * Returns a cleanup function (for ctx.tool.hook / session.hook disposal).
 */
export async function registerCommunicationHooks({ client, config, log }) {
  const comm = parseCommunication(config);
  if (comm.invalid) {
    log?.warn?.("communication:config_fallback", { error_class: "invalid_value" });
  }
  const flagSessions = new Set();
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

  const registration = await client?.session?.hook?.("context", async (event) => {
    try {
      const sessionID = event?.sessionID;
      if (!sessionID || !(await isEligible(sessionID))) return;

      // Detect --plain flag in last user message
      if (event?.messages) {
        const lastUserMsg = [...event.messages].reverse().find(m => m?.role === "user");
        const text = lastUserMsg?.content ?? "";
        if (detectPlainFlag(text) && !flagSessions.has(sessionID)) {
          flagSessions.add(sessionID);
          log?.info?.("communication:flag_plain", { sessionID });
        }
      }

      // Inject plain language directive
      const flagMarked = flagSessions.has(sessionID);
      if (comm.mode === "plain" || flagMarked) {
        const label = resolveDirectiveLabel({ flagMarked, communication: comm });
        const directive = directiveText(label);
        if (!event.system) event.system = [];
        // Avoid duplicates
        if (!event.system.some(s => typeof s === "string" && s.includes("Общайся с пользователем простым")) &&
            !event.system.some(s => typeof s === "object" && s.text?.includes("Общайся с пользователем простым"))) {
          event.system.push(directive);
        }
        log?.debug?.("communication:directive_injected", { sessionID, source: label });
      }
    } catch {
      /* fail-soft */
    }
  });

  return {
    dispose: () => {
      try { registration?.dispose?.(); } catch {}
    },
  };
}
