// Restricted-data directive (D2, retire-confidential) — V2 migration.
// Self-contained module: NOT importing core.js (ESM-cycle guard).
//
// Директива `restricted-data paths: p1, p2` — в system-контекст top-level
// primary-сессий: источник restricted-набора для оркестратора (D2).
// Формат строки канонический (spec §8): одна строка, repo-relative пути,
// через запятую. Пустой набор → директивы нет (SKILL: нет директивы —
// confidential-данных нет, кроме built-in секретов ядра).
//
// Drift-сверка (M2): строка-зеркало `**Confidential-данные:** p1, p2` в
// §12 docs/project-context.md — человеческая документация, не процессный
// источник. При init сверка с фактическим набором → warn `confidential:drift`
// при расхождении (детектор миграционного окна, I2; нарушенного порядка
// миграции). Fail-soft: битая/отсутствующая строка — warn, не throw;
// директива всё равно инжектится (source of truth — нативный конфиг).

import fs from "node:fs";
import path from "node:path";

// Маркер дедупа директивы в system-контексте (канон §8).
export const RESTRICTED_DIRECTIVE_PREFIX = "restricted-data paths:";

// Service-сессии (memory layer) — директивы не получают (тот же префикс,
// что в communication.js / feedback-report.js).
const SERVICE_TITLE_PREFIX = "[maestro-memory]";

// Строка-зеркало §12 docs/project-context.md (канонический формат M2).
// Строка — буллет внутри §12; незаанкорированная (может стоять в любом месте).
const SECTION12_LINE_RE = /\*\*Confidential-данные:\*\*[ \t]*(.+)/;

export function restrictedDirectiveText(paths) {
  const list = (Array.isArray(paths) ? paths : [])
    .filter((p) => typeof p === "string" && p.trim() !== "")
    .map((p) => p.trim());
  if (list.length === 0) return null;
  return `${RESTRICTED_DIRECTIVE_PREFIX} ${list.join(", ")}`;
}

/**
 * V2: регистрирует restricted-data-хуки через ctx.session.hook("context", ...).
 * Возвращает V2 dispose + V1-совместимые хуки (system.transform) — те же
 * правила (eligibility/дедуп/пустой набор), что в context hook (тестовая
 * совместимость).
 * Паттерн registerCommunicationHooks (communication.js), без label-логики.
 *
 * getDataPaths: () => string[] — колбэк из core (new-режим — нативный
 * derived-набор; legacy, D5 — union(native, confidential.paths)).
 */
export async function registerRestrictedDataHooks({ client, log, getDataPaths }) {
  const eligibleCache = new Map();

  const isEligible = async (sessionID) => {
    if (!sessionID) return false;
    if (eligibleCache.has(sessionID)) return eligibleCache.get(sessionID);
    let ok = false;
    try {
      // V2: { sessionID } format
      const resp = await client?.session?.get?.({ sessionID });
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

  // Инжект директивы (общий для V1 transform и V2 context hook).
  // Пустой набор → не инжектить; дедуп — по маркеру префикса (хук может
  // сработать повторно на request).
  const directiveFor = () => {
    const paths = (typeof getDataPaths === "function" ? getDataPaths() : []) ?? [];
    if (!Array.isArray(paths) || paths.length === 0) return null;
    return restrictedDirectiveText(paths);
  };

  const alreadyPresent = (system) =>
    system.some((s) => typeof s === "string" && s.includes(RESTRICTED_DIRECTIVE_PREFIX)) ||
    system.some((s) => typeof s === "object" && s?.text && s.text.includes(RESTRICTED_DIRECTIVE_PREFIX));

  // V1: system.transform — eligibility-guard + инжект (plain string, как в V1)
  const onSystemTransform = async ({ sessionID } = {}, out) => {
    try {
      if (!sessionID || !(await isEligible(sessionID))) return;
      const directive = directiveFor();
      if (!directive || !out?.system || alreadyPresent(out.system)) return;
      out.system.push(directive);
      log?.debug?.("restricted_data:directive_injected", { sessionID });
    } catch {
      /* fail-soft */
    }
  };

  // V2: context hook — eligibility-guard + инжект с дедупом
  const registration = await client?.session?.hook?.("context", async (event) => {
    try {
      const sessionID = event?.sessionID;
      if (!sessionID || !(await isEligible(sessionID))) return;
      const directive = directiveFor();
      if (!directive) return;
      if (!event.system) event.system = [];
      if (!alreadyPresent(event.system)) {
        event.system.push({ type: "text", text: directive });
      }
      log?.debug?.("restricted_data:directive_injected", { sessionID });
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

/**
 * Drift-сверка при init (M2): читаем docs/project-context.md (root), ищем
 * строку-зеркало §12 и сверяем её набор с фактическим restricted-набором.
 * Расхождение (вкл. отсутствие строки при непустом наборе, битую/пустую
 * строку, отсутствие/нечитаемый файл) → log.warn("confidential:drift",
 * { directive, section12 }). Без throw — drift-сверка никогда не роняет
 * init (fail-soft). Совпадение (вкл. пустой набор и отсутствующую строку)
 * → warn'а нет.
 */
export function checkSection12Drift(root, dataPaths, log) {
  try {
    let section12 = null;
    try {
      const text = fs.readFileSync(path.join(root, "docs", "project-context.md"), "utf8");
      const m = text.match(SECTION12_LINE_RE);
      if (m) section12 = (m[1] ?? "").trim();
    } catch {
      section12 = null; // файл отсутствует/не читается — fail-soft
    }
    const documented = section12
      ? section12.split(",").map((p) => p.trim()).filter(Boolean)
      : [];
    const actual = (Array.isArray(dataPaths) ? dataPaths : [])
      .filter((p) => typeof p === "string" && p.trim() !== "")
      .map((p) => p.trim());
    const sameSet = actual.length === documented.length &&
      actual.every((p) => documented.includes(p));
    if (!sameSet) {
      log?.warn?.("confidential:drift", {
        directive: actual.length > 0 ? restrictedDirectiveText(actual) : null,
        section12,
      });
    }
  } catch {
    /* fail-soft: drift-сверка не роняет init */
  }
}
