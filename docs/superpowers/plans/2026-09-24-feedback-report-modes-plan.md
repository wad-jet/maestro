# Feedback Report Modes (auto/manual/disable) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ключ `maestro.json → feedback_report` (`manual`/`auto`/`disable`) + плагин-директива в system-контексте + шаг 18.5 pipeline — режим отчёта ретроспективы в конце пайплайна.

**Architecture:** Плагин `maestro-bootstrap` читает ключ при init (прецедент `communication`), инжектит одну строку-директиву в system-контекст top-level primary-сессии (только явный non-manual; `chainHooks` — третий источник `experimental.chat.system.transform`). Шаг 18.5 pipeline (промпт `skills/maestro/SKILL.md`) берёт режим из директивы: нет директивы → `manual` (безопасный дефолт). Изменений в скилл `maestro-feedback-report` — только примечание; команда всегда интерактивна.

**Tech Stack:** Node ESM, node:test (0 deps), Markdown (скиллы/команды/manual_docs).

**Spec:** `docs/superpowers/specs/2026-09-24-feedback-report-modes-design.md` (approve, opus, 3 раунда).

**Служебные константы:** baseline тестов — 210 (`node --test plugins/maestro-bootstrap/index.test.js`); версия 4.7.1 → **4.8.0** (bump — после merge, шаг 18 пайплайна, НЕ на ветке); workdir всех команд — корень репо `/Users/odemidov/Documents/dev/github/maestro-agent`.

---

### Task 1: `loadFeedbackReportConfig` в core.js (TDD)

**Files:**
- Modify: `plugins/maestro-bootstrap/core.js` (рядом с `loadCommunicationConfig`, ~L373-390)
- Test: `plugins/maestro-bootstrap/index.test.js` (новый `describe` рядом с `describe("communication config (loadCommunicationConfig)")`, ~L2180)

- [ ] **Step 1: Write the failing test**

В `plugins/maestro-bootstrap/index.test.js`: (1) добавить `loadFeedbackReportConfig` в import-строку из `./core.js` (строка 6, после `loadCommunicationConfig`); (2) добавить блок:

```js
describe("feedback_report config (loadFeedbackReportConfig)", () => {
  it("ключ отсутствует → manual (дефолт)", () => {
    assert.deepEqual(loadFeedbackReportConfig({}), { mode: "manual", explicit: false, invalid: false });
  });
  it("config отсутствует → manual (дефолт)", () => {
    assert.deepEqual(loadFeedbackReportConfig(undefined), { mode: "manual", explicit: false, invalid: false });
  });
  it("auto explicit", () => {
    assert.deepEqual(loadFeedbackReportConfig({ feedback_report: "auto" }), { mode: "auto", explicit: true, invalid: false });
  });
  it("manual explicit", () => {
    assert.deepEqual(loadFeedbackReportConfig({ feedback_report: "manual" }), { mode: "manual", explicit: true, invalid: false });
  });
  it("disable explicit", () => {
    assert.deepEqual(loadFeedbackReportConfig({ feedback_report: "disable" }), { mode: "disable", explicit: true, invalid: false });
  });
  it("невалидное (42) → manual + invalid", () => {
    assert.deepEqual(loadFeedbackReportConfig({ feedback_report: 42 }), { mode: "manual", explicit: false, invalid: true });
  });
  it("невалидное ('nope') → manual + invalid", () => {
    assert.deepEqual(loadFeedbackReportConfig({ feedback_report: "nope" }), { mode: "manual", explicit: false, invalid: true });
  });
  it("невалидное ('AUTO', регистр) → manual + invalid", () => {
    assert.deepEqual(loadFeedbackReportConfig({ feedback_report: "AUTO" }), { mode: "manual", explicit: false, invalid: true });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test plugins/maestro-bootstrap/index.test.js 2>&1 | grep -A2 "feedback_report config"`
Expected: FAIL — `loadFeedbackReportConfig is not a function` (импорт падает/не определён).

- [ ] **Step 3: Implement**

В `plugins/maestro-bootstrap/core.js` — сразу после блока `loadCommunicationConfig` (~L390):

```js
const FEEDBACK_REPORT_MODES = new Set(["auto", "manual", "disable"]);

/**
 * Разбор `feedback_report` из maestro.json — режим отчёта ретроспективы
 * (шаг 18.5 pipeline). Ключ отсутствует → "manual" (дефолт). Невалидное
 * значение → soft fallback в дефолт + invalid: true (философия
 * communication:config_fallback).
 * @param {object} [config]  Parsed `maestro.json` (from loadMaestroConfig).
 * @returns {{ mode: "auto"|"manual"|"disable", explicit: boolean, invalid: boolean }}
 */
export function loadFeedbackReportConfig(config) {
  const value =
    config && typeof config === "object" ? config.feedback_report : undefined;
  if (value === undefined) return { mode: "manual", explicit: false, invalid: false };
  if (typeof value === "string" && FEEDBACK_REPORT_MODES.has(value)) {
    return { mode: value, explicit: true, invalid: false };
  }
  return { mode: "manual", explicit: false, invalid: true };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test plugins/maestro-bootstrap/index.test.js 2>&1 | tail -6`
Expected: pass 218 (210 + 8), fail 0.

- [ ] **Step 5: Commit**

```bash
git add plugins/maestro-bootstrap/core.js plugins/maestro-bootstrap/index.test.js
git commit -m "feat(plugin): loadFeedbackReportConfig — parse feedback_report key (#113)"
```

---

### Task 2: Модуль `feedback-report.js` — `registerFeedbackReportHooks` (TDD)

**Files:**
- Create: `plugins/maestro-bootstrap/feedback-report.js`
- Test: `plugins/maestro-bootstrap/index.test.js` (новый `describe` рядом с communication-блоками, после `describe("communication hooks (system.transform matrix)")`)

- [ ] **Step 1: Write the failing test**

В `plugins/maestro-bootstrap/index.test.js` — (1) новый import-блок (рядом с communication-импортом, строки 7–13):

```js
import {
  parseFeedbackReport,
  directiveText as frDirectiveText,
  registerFeedbackReportHooks,
} from "./feedback-report.js";
```

(2) Тестовые блоки:

```js
describe("feedback-report config (parseFeedbackReport)", () => {
  it("отсутствует → manual, не explicit", () => {
    assert.deepEqual(parseFeedbackReport({}), { mode: "manual", explicit: false, invalid: false });
  });
  it("auto explicit", () => {
    assert.deepEqual(parseFeedbackReport({ feedback_report: "auto" }), { mode: "auto", explicit: true, invalid: false });
  });
  it("невалидное → manual + invalid", () => {
    assert.deepEqual(parseFeedbackReport({ feedback_report: "x" }), { mode: "manual", explicit: false, invalid: true });
  });
});

describe("feedback-report directiveText", () => {
  it("auto → строка-директива", () => {
    assert.equal(frDirectiveText("auto"), "maestro.json → feedback_report: auto");
  });
  it("disable → строка-директива", () => {
    assert.equal(frDirectiveText("disable"), "maestro.json → feedback_report: disable");
  });
});

describe("feedback-report hooks (system.transform matrix)", () => {
  function fakeClient(overrides = {}) {
    const sessions = new Map([["s1", { parentID: null, title: "primary" }]]);
    for (const [id, s] of Object.entries(overrides)) sessions.set(id, s);
    return {
      session: {
        get: async ({ path: { id } }) => {
          const s = sessions.get(id);
          if (!s) throw new Error("no session");
          return s;
        },
      },
    };
  }
  function fakeLog() {
    const calls = [];
    const fn = (level) => (msg, extra) => calls.push({ level, msg, extra });
    return { calls, info: fn("info"), warn: fn("warn"), error: fn("error"), debug: fn("debug") };
  }
  const transform = async (hooks, out, sessionID = "s1") => {
    await hooks["experimental.chat.system.transform"]({ sessionID }, out);
    return out.system;
  };

  it("auto → инъекция директивы", async () => {
    const hooks = await registerFeedbackReportHooks({ client: fakeClient(), config: { feedback_report: "auto" }, log: fakeLog() });
    const sys = await transform(hooks, { system: [] });
    assert.equal(sys.length, 1);
    assert.equal(sys[0], "maestro.json → feedback_report: auto");
  });
  it("disable → инъекция директивы", async () => {
    const hooks = await registerFeedbackReportHooks({ client: fakeClient(), config: { feedback_report: "disable" }, log: fakeLog() });
    const sys = await transform(hooks, { system: [] });
    assert.equal(sys.length, 1);
    assert.ok(sys[0].includes("feedback_report: disable"));
  });
  it("manual explicit → БЕЗ инъекции", async () => {
    const hooks = await registerFeedbackReportHooks({ client: fakeClient(), config: { feedback_report: "manual" }, log: fakeLog() });
    const sys = await transform(hooks, { system: [] });
    assert.equal(sys.length, 0);
  });
  it("ключ отсутствует → БЕЗ инъекции", async () => {
    const hooks = await registerFeedbackReportHooks({ client: fakeClient(), config: {}, log: fakeLog() });
    const sys = await transform(hooks, { system: [] });
    assert.equal(sys.length, 0);
  });
  it("невалидное → БЕЗ инъекции + warn feedback_report:config_fallback", async () => {
    const log = fakeLog();
    await registerFeedbackReportHooks({ client: fakeClient(), config: { feedback_report: "nope" }, log });
    assert.ok(log.calls.some((c) => c.msg === "feedback_report:config_fallback" && c.extra.error_class === "invalid_value"));
    const hooks2 = await registerFeedbackReportHooks({ client: fakeClient(), config: { feedback_report: "nope" }, log: fakeLog() });
    const sys = await transform(hooks2, { system: [] });
    assert.equal(sys.length, 0);
  });
  it("task-сессия (parentID) → без инъекции", async () => {
    const hooks = await registerFeedbackReportHooks({
      client: fakeClient({ s1: { parentID: "s0", title: "sub" } }),
      config: { feedback_report: "auto" }, log: fakeLog() });
    const sys = await transform(hooks, { system: [] });
    assert.equal(sys.length, 0);
  });
  it("обёртка {data}: parentID в data → без инъекции", async () => {
    const client = { session: { get: async () => ({ data: { parentID: "s0", title: "sub" } }) } };
    const hooks = await registerFeedbackReportHooks({ client, config: { feedback_report: "auto" }, log: fakeLog() });
    const sys = await transform(hooks, { system: [] });
    assert.equal(sys.length, 0);
  });
  it("сервис-сессия [maestro-memory] (parentID пуст) → без инъекции", async () => {
    const hooks = await registerFeedbackReportHooks({
      client: fakeClient({ s1: { parentID: null, title: "[maestro-memory] summarize s1" } }),
      config: { feedback_report: "auto" }, log: fakeLog() });
    const sys = await transform(hooks, { system: [] });
    assert.equal(sys.length, 0);
  });
  it("ошибка client.session.get → без инъекции (fail-soft)", async () => {
    const hooks = await registerFeedbackReportHooks({ client: fakeClient(), config: { feedback_report: "auto" }, log: fakeLog() });
    const sys = await transform(hooks, { system: [] }, "unknown");
    assert.equal(sys.length, 0);
  });
  it("debug-лог directive_injected при инъекции", async () => {
    const log = fakeLog();
    const hooks = await registerFeedbackReportHooks({ client: fakeClient(), config: { feedback_report: "auto" }, log });
    await transform(hooks, { system: [] });
    assert.ok(log.calls.some((c) => c.msg === "feedback_report:directive_injected" && c.extra.sessionID === "s1"));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test plugins/maestro-bootstrap/index.test.js 2>&1 | grep -B1 "Cannot find module"`
Expected: FAIL — `Cannot find module './feedback-report.js'`.

- [ ] **Step 3: Implement `plugins/maestro-bootstrap/feedback-report.js`**

```js
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test plugins/maestro-bootstrap/index.test.js 2>&1 | tail -6`
Expected: pass 232 (218 + 14), fail 0.

- [ ] **Step 5: Commit**

```bash
git add plugins/maestro-bootstrap/feedback-report.js plugins/maestro-bootstrap/index.test.js
git commit -m "feat(plugin): feedback-report.js — system-context directive for feedback_report mode (#113)"
```

---

### Task 3: Wiring — core.js регистрация + `chainHooks` (TDD)

**Files:**
- Modify: `plugins/maestro-bootstrap/core.js` (import ~L28; регистрация после commHooks-блока ~L1116-1121; `chainHooks` L1123-1133)
- Test: `plugins/maestro-bootstrap/index.test.js` (новый `describe` рядом с `describe("communication wiring (MaestroBootstrapPlugin)")`, ~L2412)

Ключевой класс дефекта: хук зарегистрирован, но не включён в `chainHooks` → фича «тихо мертва» при зелёных module-тестах (прецедент адаптера 3.0.3). Wiresing-тест ниже это ловит.

- [ ] **Step 1: Write the failing wiring test**

В `plugins/maestro-bootstrap/index.test.js` после блока `communication wiring`:

```js
describe("feedback-report wiring (MaestroBootstrapPlugin)", () => {
  let dir;
  before(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "fab-fr-")); });
  after(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it("feedback_report: auto → plugin-level system.transform инжектит директиву (chainHooks, 3-й источник)", async () => {
    fs.writeFileSync(path.join(dir, "maestro.json"), JSON.stringify({ feedback_report: "auto" }));
    const client = { session: { get: async () => ({ data: { parentID: null, title: "primary" } }) } };
    const hooks = await MaestroBootstrapPlugin({ directory: dir, client });
    assert.equal(typeof hooks["experimental.chat.system.transform"], "function");
    const out = { system: [] };
    await hooks["experimental.chat.system.transform"]({ sessionID: "s1" }, out);
    assert.ok(out.system.some((s) => s.includes("feedback_report: auto")));
  });

  it("ключ отсутствует → без директивы (безопасный дефолт manual)", async () => {
    const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), "fab-fr2-"));
    fs.writeFileSync(path.join(dir2, "maestro.json"), JSON.stringify({}));
    const client = { session: { get: async () => ({ data: { parentID: null, title: "primary" } }) } };
    const hooks = await MaestroBootstrapPlugin({ directory: dir2, client });
    const out = { system: [] };
    await hooks["experimental.chat.system.transform"]({ sessionID: "s1" }, out);
    assert.ok(!out.system.some((s) => s.includes("feedback_report")));
    fs.rmSync(dir2, { recursive: true, force: true });
  });

  it("enum-синхронизация: invalid-детект loadFeedbackReportConfig и registerFeedbackReportHooks совпадают", async () => {
    for (const v of ["auto", "manual", "disable", "AUTO", "nope", 42, null, ""]) {
      const coreInvalid = loadFeedbackReportConfig({ feedback_report: v }).invalid;
      const log = { calls: [], warn: (m) => log.calls.push(m), info: () => {}, error: () => {}, debug: () => {} };
      await registerFeedbackReportHooks({
        client: { session: { get: async () => { throw new Error("x"); } } },
        config: { feedback_report: v }, log });
      const hookInvalid = log.calls.includes("feedback_report:config_fallback");
      assert.equal(hookInvalid, coreInvalid, `desync для значения ${JSON.stringify(v)}`);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test plugins/maestro-bootstrap/index.test.js 2>&1 | grep -A3 "feedback-report wiring"`
Expected: FAIL — тест «auto → … инжектит директиву»: `out.system` не содержит `feedback_report: auto` (хук `system.transform` существует от commHooks, но директивы нет — fbHooks не подключён).

- [ ] **Step 3: Implement — три правки core.js**

(а) import (рядом со строкой 28 `import { registerCommunicationHooks } from "./communication.js";`):

```js
import { registerFeedbackReportHooks } from "./feedback-report.js";
```

(б) после commHooks-блока (~L1116-1121, перед `plugin.tool = …`):

```js
  // Feedback report mode (auto/manual/disable): активен всегда (standalone-
  // ключ enabled нет; дефолт — manual, директива не инжектится). Fail-soft,
  // как communication.
  let fbHooks = {};
  try {
    fbHooks = await registerFeedbackReportHooks({ client, config, log });
  } catch (err) {
    log.error("feedback_report: init failed", { error: err instanceof Error ? err.message : String(err) });
  }
```

(в) `chainHooks` (L1123-1133) — третий источник:

```js
  const chainHooks = (name) => {
    const a = commHooks[name];
    const b = memoryHooks[name];
    const c = fbHooks[name];
    if (!a && !b && !c) return;
    plugin[name] = async (input, out) => {
      if (a) { try { await a(input, out); } catch {} }
      if (b) { try { await b(input, out); } catch {} }
      if (c) { try { await c(input, out); } catch {} }
    };
  };
```

- [ ] **Step 4: Run full plugin test suite**

Run: `node --test plugins/maestro-bootstrap/index.test.js 2>&1 | tail -6`
Expected: pass 235 (232 + 3), fail 0. (Все 210 baseline — без регрессий.)

- [ ] **Step 5: Commit**

```bash
git add plugins/maestro-bootstrap/core.js plugins/maestro-bootstrap/index.test.js
git commit -m "feat(plugin): wire feedback-report hooks via chainHooks (3rd system.transform source) + wiring tests (#113)"
```

---

### Task 4: `skills/maestro/SKILL.md` — шаг 18.5 + маршруты + примеры

**Files:**
- Modify: `skills/maestro/SKILL.md` (маршруты ~L58-62; pipeline-блок после шага 18 ~L906-918; примеры ~L2213, ~L2270)

- [ ] **Step 1: Маршруты — «0–18» → «0–18.5»**

Заменить:
```
- **Feature** (шаги 0–18) — полный цикл: project context → pre-flight → brainstorm (primary + custodian Q/A) → spec → plan → SDD → docs → review → finish
- **Bugfix** (шаги 0–6 → D1–D7 → шаги 11–18) — project context → pre-flight + branch → debug sub-pipeline: ресеч → гипотеза → probe → откат → plan → SDD → docs → review → finish
```
на:
```
- **Feature** (шаги 0–18.5) — полный цикл: project context → pre-flight → brainstorm (primary + custodian Q/A) → spec → plan → SDD → docs → review → finish → feedback report
- **Bugfix** (шаги 0–6 → D1–D7 → шаги 11–18.5) — project context → pre-flight + branch → debug sub-pipeline: ресеч → гипотеза → probe → откат → plan → SDD → docs → review → finish → feedback report
```

- [ ] **Step 2: Шаг 18.5 в pipeline-блок**

В основном pipeline-блоке (Feature), сразу после `🟢 18. [agent] finishing-a-development-branch` (конец — `...на base-ветке (до push, если push ещё не выполнен).`, ~L917), ДО закрывающего ``` блока, добавить:

```
🟢 18.5. [agent] Feedback report (ретроспектива) — режим `feedback_report`
       — **Источник режима — директива плагина в system-контексте:** строка
         `maestro.json → feedback_report: <mode>` (инжектится плагин при явном
         non-manual). **Директивы нет → `manual`** (дефолт: ключ отсутствует /
         `manual` / невалидное / старая версия плагина — безопасный дефолт во
         всех случаях). Шаг 18.5 НЕ читает `maestro.json` (ни read-тулом, ни
         bash).
       — **Маршруты:** feature (все категории, включая Bounded) + bugfix.
         **Spike — НЕ выполняется** (отчёт не генерируется, заметка не
         показывается).
       — **`manual` (дефолт):** одна строка БЕЗ вопроса: «Для сбора отчёта
         ретроспективы выполните `@maestro-feedback-report`». Заметка —
         информационное сообщение: стиль следует режиму `communication`
         (plain/professional); в efficient-режиме (шаг 1.5) допустима — одна
         строка, не gate и не подтверждение.
       — **`auto`:** выполнить `skill maestro-feedback-report`. **Промпт-
         override вызова из pipeline (механика скилла не меняется — Гейт 0 и
         вопросы сохраняются для интерактивной команды):** в auto-режиме
         оркестратор не выполняет HITL-указания скилла — (а) жёсткий стоп
         Гейта 0 подавляется; (б) подтверждающие вопросы скилла подавляются,
         включая «либо подтверди у пользователя» на шаге 1 выбора сессии —
         сессию оркестратор выбирает самостоятельно (текущая сессия pipeline,
         `opencode session list`). Любой стоп/сбой/отказ → **fail-soft**: одна
         строка «Отчёт не сгенерирован: <причина>», без HITL — pipeline
         завершается, отчёт не блокирует завершение. Сообщение при успехе:
         «Отчёт сохранён в `<путь>` (режим auto). Для добавления комментариев
         выполните `@maestro-feedback-report`».
       — **`disable`:** ничего видимого.
       — **Новых HITL-gate НЕТ** ни в одном режиме. Инварианты ⚑1–4 не
         затрагиваются (не merge, не принятие спеки, не чувствительные
         изменения).
```

- [ ] **Step 3: Примеры — добавить строку 18.5**

(а) Пример Feature (~L2213), после строки `Шаг 18: [agent] finishing-a-development-branch -> merge to base (--no-ff)` добавить:
```
Шаг 18.5: [agent] feedback report — режим по директиве (нет директивы → manual: подсказка команды)
```
(б) Пример полный Bugfix (~L2270), после `Шаг 18: [agent] finishing-a-development-branch -> merge to develop (--no-ff)` добавить:
```
Шаг 18.5: [agent] feedback report — режим по директиве (нет директивы → manual: подсказка команды)
```
(в) Сокращённый пример «Багфикс (interactive mode)» (~L2287, «Шаг 18: merge») — **осознанно НЕ править** (элидированный пример). Bump-упоминания (~L231-232: «шаг 18 после merge — bump») — **не менять** (bump остаётся на шаге 18).

- [ ] **Step 4: Verify**

Run: `grep -c "18.5" skills/maestro/SKILL.md`
Expected: ≥ 6 (маршруты 2 + блок 18.5 + примеры 2 + внутренние ссылки).
Run: `grep -n "0–18.5\|11–18.5" skills/maestro/SKILL.md | head -5`
Expected: строки маршрутов + шага 18.5.

- [ ] **Step 5: Commit**

```bash
git add skills/maestro/SKILL.md
git commit -m "feat(skill): maestro SKILL.md — step 18.5 feedback report (feedback_report modes) (#113)"
```

---

### Task 5: Канон maestro-assistant + примечания скилла/команды

**Files:**
- Modify: `skills/maestro-assistant/SKILL.md` (секция «Ключ `feedback_report`» после секции «Ключ `communication`», ~L282-295)
- Modify: `skills/maestro-feedback-report/SKILL.md` (Overview, ~L43-49)
- Modify: `commands/maestro-feedback-report.md` (шапка, ~L1-12)

- [ ] **Step 1: maestro-assistant — канон-секция**

После секции «Ключ `communication` (простой язык)» (конец — `...последствия: дефолт plain, приоритет флага, область действия.`, ~L295) добавить:

```markdown
### Ключ `feedback_report` (режим отчёта ретроспективы)

- Значения: `"manual"` (дефолт — отчёт вручную `@maestro-feedback-report`;
  пайплайн на шаге 18.5 показывает однострочную подсказку) | `"auto"`
  (пайплайн автоматически собирает отчёт после шага 18, без HITL) |
  `"disable"` (отчёта нет, подсказки нет). Невалидное значение → soft
  fallback в `manual` + warn в лог плагина (`feedback_report:config_fallback`);
  в чате уведомление не выдаётся (как у `communication`).
- Область: только хук пайплайна (шаг 18.5; маршруты feature + bugfix, spike —
  не применяется). Прямой вызов `@maestro-feedback-report` — всегда
  интерактивен (HITL-фидбек), режим не влияет.
- **Механика:** плагин читает ключ при init и при явном non-manual инжектит
  строку-директиву `maestro.json → feedback_report: <mode>` в system-контекст
  top-level primary-сессии (паттерн ключа `communication`). Нет директивы →
  `manual` (безопасный дефолт: ключ отсутствует / `manual` / невалидное /
  старая версия плагина).
- **Процедура смены режима:** правка `maestro.json` (нативный ask →
  HITL-подтверждение) + **обязателен перезапуск opencode** (плагин читает
  конфиг при init — как `communication`).
- **`/maestro-setup` НЕ генерирует ключ и НЕ спрашивает про него** —
  отсутствие = `manual` (no-silent-opt-in, паттерн секции `memory`).
```

- [ ] **Step 2: maestro-feedback-report — примечание в Overview**

В `skills/maestro-feedback-report/SKILL.md`, после первой строки блока `## Overview` (после «...для последующей ретроспективы (проведение ретроспективы здесь НЕ требуется — только сбор). Отчёт сохраняется в `.maestro/feedback-reports/report-<Session ID>-<YYYY-MM-DD>.md`.») добавить:

```markdown

> **Режим пайплайна:** шаг 18.5 пайплайна maestro вызывает этот скилл
> автоматически, если в `maestro.json` задан `feedback_report: "auto"`
> (режим — из директивы плагина в system-контексте; `manual`/`disable` —
> авто-вызов не происходит). Режимы: `manual` (дефолт) / `auto` / `disable`
> — см. `manual_docs/reference/config.md`.
```

- [ ] **Step 3: commands/maestro-feedback-report.md — примечание**

В шапке, после строки «они записываются в секцию `## Пользовательский фидбек` итогового файла.» добавить:

```markdown

> **Режим пайплайна** (`maestro.json → feedback_report`: `manual` — дефолт /
> `auto` / `disable`) управляет только авто-вызовом скилла на шаге 18.5
> пайплайна. **Команда всегда интерактивна** — независимо от режима.
```

- [ ] **Step 4: Commit**

```bash
git add skills/maestro-assistant/SKILL.md skills/maestro-feedback-report/SKILL.md commands/maestro-feedback-report.md
git commit -m "docs(skill): feedback_report canon in maestro-assistant + notes in feedback-report skill/command (#113)"
```

---

### Task 6: manual_docs — синхронизация (10 файлов + grep-сверка)

**Files:**
- Modify: `manual_docs/reference/config.md` (список секций L15; новая секция после «Ключ `communication`», ~L68-81)
- Modify: `manual_docs/reference/commands.md` (секция `@maestro-feedback-report`)
- Modify: `manual_docs/explanation/pipeline-overview.md` (заголовки ~L9-10, ~L90; шаг-таблица после строки 18 ~L55; mermaid ~L85)
- Modify: `manual_docs/overview/what-is-maestro.md` (таблица маршрутов ~L40-41)
- Modify: `manual_docs/overview/quick-start.md` (~L48)
- Modify: `manual_docs/tutorials/run-first-feature.md` (~L6, ~L108, ~L111)
- Modify: `manual_docs/how-to/run-a-bugfix.md` (~L41)
- Modify: `manual_docs/examples/example-feature.md` (~L63)
- Modify: `manual_docs/index.md` (~L23, ~L50)
- Modify: `manual_docs/tutorials/setup-project.md` (~L314)
- Modify: `manual_docs/overview/changelog.md` (`[Unreleased]`, ~L10)

- [ ] **Step 1: config.md**

(а) Строка 15: `нескольких секций: `trust`, `confidential`, `sanitizer_whitelist`, `communication` (опц.), `memory` (опц.).`` → `нескольких секций: `trust`, `confidential`, `sanitizer_whitelist`, `communication` (опц.), `feedback_report` (опц.), `memory` (опц.).`
(б) После секции «Ключ `communication` (простой язык)» (конец ~L81, перед «### Секция `confidential`») вставить:

```markdown
### Ключ `feedback_report` (режим отчёта ретроспективы)

Режим нового шага 18.5 пайплайна (после merge): поведение отчёта
ретроспективы в конце пайплайна.

| Значение | Поведение в конце пайплайна (шаг 18.5) |
|---|---|
| `"manual"` (или ключ отсутствует — **дефолт**) | Авто-генерации нет; одна строка БЕЗ вопроса: «Для сбора отчёта ретроспективы выполните `@maestro-feedback-report`» |
| `"auto"` | Отчёт собирается и сохраняется автоматически (без HITL); комментарии можно дополнить позже командой |
| `"disable"` | Ни отчёта, ни подсказки |

- Невалидное значение → soft fallback в `manual` + warn
  `feedback_report:config_fallback` в лог плагина.
- Область: только пайплайн (маршруты feature + bugfix; spike — не
  применяется). Команда `@maestro-feedback-report` всегда интерактивна.
- Смена режима — правка `maestro.json` + **перезапуск opencode** (плагин
  читает конфиг при init).
- Механика — строка-директива плагина в system-контекст (паттерн ключа
  `communication`); директивы нет → `manual` (безопасный дефолт).
```

- [ ] **Step 2: commands.md**

В секции `@maestro-feedback-report` (найти заголовок секции) добавить строку: «Режим пайплайна (`maestro.json → feedback_report`: `manual` дефолт / `auto` / `disable`) управляет авто-вызовом на шаге 18.5; сама команда всегда интерактивна. Смена режима — перезапуск opencode.»

- [ ] **Step 3: pipeline-overview.md**

(а) Заголовки: «Feature-маршрут (0–18)» → «Feature-маршрут (0–18.5)»; «Bugfix-маршрут (0–6 → D1–D7 → 11–18)» → «Bugfix-маршрут (0–6 → D1–D7 → 11–18.5)» (всё вхождения заголовков; сжатый bugfix-mermaid-узел «… → Merge» — НЕ править).
(б) В шаг-таблице после строки для шага 18 добавить строку: `| 18.5 | Feedback report (ретроспектива) — режим по `maestro.json → feedback_report` (нет директивы → manual: подсказка / auto: авто-сбор без HITL / disable: ничего) |` (формат строки — как у соседних строк таблицы).
(в) В mermaid-диаграмме feature после `Step17 --> Step18["18: Merge в base"]` добавить строку: `Step18 --> Step185["18.5: Feedback report (по feedback_report)"]`.

- [ ] **Step 4: what-is-maestro.md / quick-start.md**

(а) `what-is-maestro.md` таблица маршрутов: «**Feature** (шаги 0–18)» → «**Feature** (шаги 0–18.5)»; «**Bugfix** (… → шаги 11–18)» → «шаги 11–18.5».
(б) `quick-start.md` после строки «Шаг 18 — merge в base-ветку.» добавить: «Шаг 18.5 — отчёт ретроспективы по `maestro.json → feedback_report` (manual — подсказка команды / auto — авто-сбор / disable — ничего)».

- [ ] **Step 5: run-first-feature.md / run-a-bugfix.md**

(а) `run-first-feature.md`: «(шаги 0→18)» → «(шаги 0→18.5)»; заголовок «Шаги 17–18: Завершение» → «Шаги 17–18.5: Завершение»; после строки про Шаг 18 (merge) добавить: «Шаг 18.5 — отчёт ретроспективы: режим `maestro.json → feedback_report` (manual — подсказка команды; auto — авто-сбор; disable — ничего)».
(б) `run-a-bugfix.md`: «завершение (шаги 17–18)» → «завершение (шаги 17–18.5)» + краткое упоминание: «Шаг 18.5 — отчёт ретроспективы по `feedback_report`».

- [ ] **Step 6: example-feature.md / index.md / setup-project.md**

(а) `example-feature.md` после «Шаг 18: finishing-a-development-branch -> merge to base (--no-ff)» добавить: «Шаг 18.5: feedback-report (manual — подсказка команды; режим — `maestro.json → feedback_report`)».
(б) `index.md`: «полный цикл 0→18» → «полный цикл 0→18.5»; «Feature 0→18 и Bugfix D1→D7» → «Feature 0→18.5 и Bugfix D1→D7».
(в) `setup-project.md`: «полный цикл 0→18» → «полный цикл 0→18.5».

- [ ] **Step 7: changelog.md — [Unreleased]**

В секцию `## [Unreleased]` (после заголовка, перед `## [2026-09-23]`) вставить:

```markdown
### Добавлено

- **Режимы отчёта ретроспективы (4.8.0):** ключ `maestro.json →
  feedback_report` (`"manual"` дефолт / `"auto"` / `"disable"`) — новый
  шаг 18.5 пайплайна (после merge): manual — однострочная подсказка
  команды; auto — авто-сбор отчёта без HITL (fail-soft); disable — ничего.
  Механика — плагин инжектит строку-директиву в system-контекст (паттерн
  `communication`); нет директивы → manual (безопасный дефолт, в т.ч.
  старая версия плагина). Смена режима — перезапуск opencode. Регресс:
  `regression/entries/2026-09-24-feedback-report-modes.md`.
```

- [ ] **Step 8: Grep-сверка**

Run: `grep -rin -E "0[–-]18|0→18|шаг ?18|17[–-]18|11[–-]18|step ?18" manual_docs/ skills/maestro/SKILL.md | grep -v changelog.md`
Expected: каждое попадание либо обновлено до 18.5, либо в leave-list: `reference/hitl-gates.md` («bump — шаг 18 после merge» — bump остаётся на 18), bump-строки `skills/maestro/SKILL.md` (~L231-232), сокращённый пример «Багфикс (interactive mode)» (~L2287), исторические записи changelog (исключены фильтром).
Если найдено живое вхождение вне leave-list → обновить и повторить.

- [ ] **Step 9: Commit**

```bash
git add manual_docs/
git commit -m "docs(manual_docs): sync feedback_report modes — config/commands/pipeline/10 pages + changelog (#113)"
```

---

### Task 7: Regression entry + project-context + roadmap

**Files:**
- Create: `regression/entries/2026-09-24-feedback-report-modes.md`
- Modify: `docs/project-context.md` (drift-фиксы: версия §3 ~L42; тесты §10 ~L169; §14 memory-команды ~L219-222)
- Modify: `docs/roadmap.md` (#113, ~L27-28; Волна 1, ~L12-15)

- [ ] **Step 1: Regression entry**

`regression/entries/2026-09-24-feedback-report-modes.md`:

```markdown
# Regression — feedback-report-modes

- **version:** 1
- **feature:** режимы отчёта ретроспективы auto/manual/disable: ключ `maestro.json → feedback_report` + плагин-директива в system-контексте + шаг 18.5 пайплайна
- **added:** 2026-09-24
- **status:** active
- **last_full_pass:** —
- **risk:** LOW
- **category:** plugin hook-wiring (feedback-report-директива + 3-й источник chainHooks) + процессное правило шага 18.5
- **scenarios:**
  - **unit-тесты фичи** (`loadFeedbackReportConfig` / `parseFeedbackReport` / directive-матрица / wiring):
    - run: `node --test plugins/maestro-bootstrap/index.test.js`
    - workdir: `/Users/odemidov/Documents/dev/github/maestro-agent`
  - **полный тест-сетап** (без регрессий):
    - run: `node --test plugins/maestro-bootstrap/index.test.js && npm run test:memory`
    - workdir: `/Users/odemidov/Documents/dev/github/maestro-agent`
  - **[Manual] директива только non-manual:** `maestro.json → feedback_report: "auto"` + рестарт → в новой top-level-сессии system-контекст содержит строку `maestro.json → feedback_report: auto`; при `manual`/отсутствии ключа — строки нет; в task-сессиях субагентов и `[maestro-memory]` — нет (лог `feedback_report:directive_injected` — только primary sessionID).
  - **[Manual] шаг 18.5:** прогон пайплайна (feature/bugfix) с `auto` — завершается сообщением «Отчёт сохранён в … (режим auto)» и файлом в `.maestro/feedback-reports/`; `disable` — ничего; `manual` (дефолт) — однострочная подсказка команды.
```

- [ ] **Step 2: project-context.md — drift-фиксы**

(а) СНАЧАЛА получить фактическое число тестов: Run: `node --test plugins/maestro-bootstrap/index.test.js 2>&1 | grep "ℹ tests"` → `ℹ tests <N>` (ожидается 235; **использовать фактический вывод, не число из плана**).
(б) §3 «Текущая версия дистрибутива — `4.6.0`» → «Текущая версия дистрибутива — `4.8.0`» (заметку про 4.7.1 не оставлять — версия бампнется после merge; на момент коммита этой строки в ветке написать `4.8.0` как целевую).

> Примечание для исполнителя: bump `package.json` → 4.8.0 выполняется ПОСЛЕ merge (шаг 18 пайплайна). В ветке строка project-context получает целевое значение `4.8.0` — после merge оно станет фактическим.

(в) §10 «(176 тестов)» → «(<N> тестов)» с фактическим N из п. (а).
(г) §14 — дополнить блок «### Команды памяти (memory layer v2)» недостающими буллитами (формат — как у соседних): `- `@maestro-memory-reindex` — HITL-бэкфилл памяти (dry-run листинг → run; full-reindex по явным session_id) + восстановление не-индексированных записей.` и `- `@maestro-memory-backup` — HITL backup/restore данных памяти (sqlite; double-masking, retention).` (текущий блок содержит `@maestro-memory`, `@maestro-memory-report`, `@maestro-memory-prune` — проверь по факту и добавь только отсутствующие).

- [ ] **Step 3: roadmap.md**

(а) Пункт #113 (Л ~27-28) — по паттерну записи #77:
```
3. **#113** — `@maestro-feedback-report`: режимы `auto/manual/disable` в
   `maestro.json`. **Выполнено (4.8.0, 2026-09-24)** — ключ `feedback_report`
   (дефолт `manual`), плагин-директива в system-контексте (паттерн
   `communication`), шаг 18.5 пайплайна (manual — подсказка / auto —
   авто-сбор без HITL, fail-soft / disable — ничего); spec
   `docs/superpowers/specs/2026-09-24-feedback-report-modes-design.md`.
```
(б) В заголовке/подзаголовке Волны 1 (~L12-15) добавить пометку: «Волна 1 закрыта релизом **4.8.0** (метка «4.7.x» — историческая; #113 — новая фича → minor-бамп 4.7.1 → 4.8.0)».

- [ ] **Step 4: Commit**

```bash
git add regression/entries/2026-09-24-feedback-report-modes.md docs/project-context.md docs/roadmap.md
git commit -m "docs: regression entry + project-context drift fix + roadmap #113 closed (#113)"
```

---

### Task 8: Финальная верификация (после всех task)

**Files:** — (только проверки)

- [ ] **Step 1: Полный тест-сетап**

Run: `node --test plugins/maestro-bootstrap/index.test.js 2>&1 | tail -6`
Expected: fail 0 (все 235 + baseline 210 внутри).
Run: `npm run test:memory 2>&1 | tail -6`
Expected: fail 0 (2 Bun-only skip — штатно на node).

- [ ] **Step 2: Grep-контроль застаревших ссылок**

Run: `grep -rn "feedback_report" skills/ commands/ manual_docs/ plugins/maestro-bootstrap/*.js | wc -l`
Expected: > 0 в каждой из 4 зон (скиллы / команды / доки / плагин).
Run: `grep -n "node -e" docs/superpowers/specs/2026-09-24-feedback-report-modes-design.md | grep -v "не читает" | head -3`
(информационно: в спеке bash-чтение только в негативной форме — контроль, что реализатор не унёс bash-паттерн в SKILL.md)
Run: `grep -n "node -e\|bash" skills/maestro/SKILL.md | grep -i "feedback\|18.5" | head -3`
Expected: пусто (шаг 18.5 не читает конфиг).

- [ ] **Step 3: Статус**

Report: `git log --oneline main..HEAD` — 7 коммитов (Tasks 1–7). Все тесты зелёные. Готово к финальному ревью (шаг 16 пайплайна).

---

### Post-merge (ШАГ 18 пайплайна — оркестратор, НЕ часть SDD)

После merge ветки в main (гейт 17):

1. Bump: `package.json` 4.7.1 → 4.8.0.
2. `manual_docs/overview/changelog.md`: из `[Unreleased]` создать секцию `## [2026-09-24]` + строка `> **Версия 4.8.0** — Minor-релиз: режимы отчёта ретроспективы `feedback_report` (manual/auto/disable) + шаг 18.5 пайплайна + плагин-директива.` (буллиты `[Unreleased]` переезжают в секцию релиза).
3. Синхронизация ссылок на версию (project-context.md уже 4.8.0 — проверить README по факту наличия упоминания версии).
4. Коммит: `chore: bump version to 4.8.0 — feedback-report modes (changelog/version)` на base-ветке (до push, если push ещё не выполнен).
5. Тесты на merged результате: `node --test plugins/maestro-bootstrap/index.test.js` + `npm run test:memory`.
6. **Шаг 18.5 пайплайна** (ирония-самопроверка): директива в system-контексте этой сессии — по состоянию конфига (в authoring-репо `feedback_report` не задан → `manual` → однострочная подсказка команды).
