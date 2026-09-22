# Plain Language Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Режим «простой язык» для HITL-диалога: ключ `communication` в `maestro.json` (дефолт `plain`), флаг `@maestro-init --plain` (флаг > конфиг), инъекция короткой директивы плагин в top-level primary-сессии, канон в скиллах, синк manual_docs.

**Architecture:** Плагин `maestro-bootstrap` — единственный runtime-читатель `maestro.json` (primary — нативный deny). Новый модуль `plugins/maestro-bootstrap/communication.js` (self-contained, без импорта из core.js — anti-ESM-цикл) регистрирует `chat.message` (детект `--plain` → маркировка сессии) и `experimental.chat.system.transform` (инъекция директивы с parentID/title-guard'ом). Core чейнит хуки communication + memory тем же паттерном, что и существующий memory-wiring. Инвариант: `experimental.chat.messages.transform` остаётся `undefined`. Скиллы — носители правил (не читатели конфига): SKILL.md (канон-секция), commands (флаг), maestro-setup (вопрос), maestro-assistant (смена режима).

**Tech Stack:** Node.js ESM, встроенный test runner (`node --test`, без зависимостей), Markdown (скиллы/команды/доки).

**Spec:** `docs/superpowers/specs/2026-09-22-plain-language-mode-design.md`

**Spec-follow-up из ревью (включены в план):**
- FU-1: тест `chat.message` — зеркальный кейс «сервис-сессия → игнор» (Task 4).
- FU-2: док-карта — setup-вопрос → `manual_docs/tutorials/setup-project.md` (Task 12).
- FU-3: `plugins/maestro-bootstrap/README.md` в док-карту (Task 7).

**Коммит-конвенция:** per-task code-коммиты (`feat:`/`test:`/`docs:`/`chore:`); spec+plan — один коммит `docs: design + plan for plain-language-mode` (выполняется оркестратором после аппрува плана, до Task 1).

---

## File Structure

| Файл | Действие | Ответственность |
|---|---|---|
| `plugins/maestro-bootstrap/core.js` | Modify | `loadCommunicationConfig` (Task 1); чейн хуков communication+memory (Task 6) |
| `plugins/maestro-bootstrap/communication.js` | Create | `detectPlainFlag`, `SOURCE_LABELS`, `resolveDirectiveLabel`, `directiveText`, `registerCommunicationHooks` (Tasks 2–5) |
| `plugins/maestro-bootstrap/index.test.js` | Modify | Все unit-тесты фичи (Tasks 1–6) |
| `plugins/maestro-bootstrap/README.md` | Modify | Секция `communication` + hook-surface + log-события (Task 7) |
| `commands/maestro-init.md` | Modify | Флаг `--plain`, правило парсинга (Task 8) |
| `skills/maestro/SKILL.md` | Modify | Канон-секция «Простой язык (plain language)» (Task 9) |
| `skills/maestro-setup/SKILL.md` | Modify | HITL-вопрос выбора режима при создании конфига (Task 10) |
| `skills/maestro-assistant/SKILL.md` | Modify | Ключ `communication` + процедура смены режима (Task 11) |
| `manual_docs/reference/config.md` | Modify | Секция `communication` (Task 12) |
| `manual_docs/reference/commands.md` | Modify | `--plain` в `/maestro-init` (Task 12) |
| `manual_docs/tutorials/setup-project.md` | Modify | Вопрос выбора режима (Task 12) |
| `manual_docs/explanation/plain-language.md` | Create | Механика активации (Task 12) |
| `manual_docs/overview/changelog.md` | Modify | `[Unreleased]` (Task 12) |
| `regression/entries/2026-09-22-plain-language-mode.md` | Create | Regression entry (Task 13) |

---

### Task 1: `loadCommunicationConfig` в core.js

**Files:**
- Modify: `plugins/maestro-bootstrap/core.js` (вставить после `loadWhitelist`, ~строка 380)
- Test: `plugins/maestro-bootstrap/index.test.js` (новый describe-блок в конце файла + импорт в строке 6)

- [ ] **Step 1: Написать failing-тесты**

Добавить `loadCommunicationConfig` в импорт `./core.js` (строка 6 `index.test.js`) и в конец файла:

```js
describe("communication config (loadCommunicationConfig)", () => {
  it("отсутствует ключ → дефолт plain, explicit: false", () => {
    assert.deepEqual(loadCommunicationConfig({}), { mode: "plain", explicit: false, invalid: false });
  });
  it("config undefined → дефолт plain", () => {
    assert.deepEqual(loadCommunicationConfig(undefined), { mode: "plain", explicit: false, invalid: false });
  });
  it("явный plain → explicit: true", () => {
    assert.deepEqual(loadCommunicationConfig({ communication: "plain" }), { mode: "plain", explicit: true, invalid: false });
  });
  it("явный professional → explicit: true", () => {
    assert.deepEqual(loadCommunicationConfig({ communication: "professional" }), { mode: "professional", explicit: true, invalid: false });
  });
  it("невалидное (число) → fallback plain + invalid: true", () => {
    assert.deepEqual(loadCommunicationConfig({ communication: 42 }), { mode: "plain", explicit: false, invalid: true });
  });
  it("невалидное (строка вне enum) → fallback plain + invalid: true", () => {
    assert.deepEqual(loadCommunicationConfig({ communication: "simple" }), { mode: "plain", explicit: false, invalid: true });
  });
});
```

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `node --test plugins/maestro-bootstrap/index.test.js 2>&1 | tail -5`
Expected: FAIL — `loadCommunicationConfig` is not exported / is not a function.

- [ ] **Step 3: Минимальная реализация**

В `core.js`, сразу после `loadWhitelist` (~строка 380):

```js
const COMMUNICATION_MODES = new Set(["plain", "professional"]);

/**
 * Разбор `communication` из maestro.json — режим «простой язык» для HITL-диалога.
 * Ключ отсутствует → "plain" (дефолт). Невалидное значение → soft fallback в
 * дефолт + invalid: true (философия memory:config_fallback: warn, без значения).
 * @param {object} [config]  Parsed `maestro.json` (from loadMaestroConfig).
 * @returns {{ mode: "plain"|"professional", explicit: boolean, invalid: boolean }}
 */
export function loadCommunicationConfig(config) {
  const value =
    config && typeof config === "object" ? config.communication : undefined;
  if (value === undefined) return { mode: "plain", explicit: false, invalid: false };
  if (typeof value === "string" && COMMUNICATION_MODES.has(value)) {
    return { mode: value, explicit: true, invalid: false };
  }
  return { mode: "plain", explicit: false, invalid: true };
}
```

- [ ] **Step 4: Прогнать тесты**

Run: `node --test plugins/maestro-bootstrap/index.test.js 2>&1 | tail -5`
Expected: PASS (все блоки, включая новый — 0 fail).

- [ ] **Step 5: Коммит**

```bash
git add plugins/maestro-bootstrap/core.js plugins/maestro-bootstrap/index.test.js
git commit -m "feat(communication): loadCommunicationConfig — communication-ключ maestro.json (дефолт plain, soft fallback)"
```

---

### Task 2: `detectPlainFlag` (communication.js)

**Files:**
- Create: `plugins/maestro-bootstrap/communication.js`
- Test: `plugins/maestro-bootstrap/index.test.js`

- [ ] **Step 1: Написать failing-тесты**

В `index.test.js` — импорт (дополнить строку 6 не нужно; добавить отдельный импорт):

```js
import { detectPlainFlag } from "./communication.js";
```

Конец файла:

```js
describe("communication flag (detectPlainFlag)", () => {
  it("@maestro-init --plain → true", () => {
    assert.equal(detectPlainFlag('@maestro-init --plain "задача"'), true);
  });
  it("/maestro-init с режим-флагом перед --plain → true", () => {
    assert.equal(detectPlainFlag('/maestro-init -aa --plain "задача"'), true);
  });
  it("команда без флага → false", () => {
    assert.equal(detectPlainFlag('@maestro-init "задача"'), false);
  });
  it("флаг без команды → false", () => {
    assert.equal(detectPlainFlag('используй --plain в тексте'), false);
  });
  it("--plainly не матчит (word boundary) → false", () => {
    assert.equal(detectPlainFlag('@maestro-init --plainly "x"'), false);
  });
  it("не-строка → false", () => {
    assert.equal(detectPlainFlag(undefined), false);
    assert.equal(detectPlainFlag(42), false);
  });
});
```

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `node --test plugins/maestro-bootstrap/index.test.js 2>&1 | tail -5`
Expected: FAIL — Cannot find module './communication.js'.

- [ ] **Step 3: Минимальная реализация**

`plugins/maestro-bootstrap/communication.js` (новый файл):

```js
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
```

- [ ] **Step 4: Прогнать тесты**

Run: `node --test plugins/maestro-bootstrap/index.test.js 2>&1 | tail -5`
Expected: PASS.

- [ ] **Step 5: Коммит**

```bash
git add plugins/maestro-bootstrap/communication.js plugins/maestro-bootstrap/index.test.js
git commit -m "feat(communication): detectPlainFlag — детект --plain в тексте команды"
```

---

### Task 3: Source-лейблы и текст директивы

**Files:**
- Modify: `plugins/maestro-bootstrap/communication.js`
- Test: `plugins/maestro-bootstrap/index.test.js`

- [ ] **Step 1: Написать failing-тесты**

Импорт: добавить `SOURCE_LABELS, resolveDirectiveLabel, directiveText` к импорту из `./communication.js` (строка Task 2).

```js
describe("communication labels (resolveDirectiveLabel)", () => {
  const P = { communication: { mode: "professional", explicit: true, invalid: false } };
  const C = { mode: "plain", explicit: true, invalid: false };
  const D = { mode: "plain", explicit: false, invalid: false };
  const DI = { mode: "plain", explicit: false, invalid: true };

  it("флаг + professional → лейбл переопределения", () => {
    assert.equal(resolveDirectiveLabel({ flagMarked: true, communication: P }), SOURCE_LABELS.flag_override);
  });
  it("флаг + plain (explicit) → лейбл флага (без «переопределяет»)", () => {
    assert.equal(resolveDirectiveLabel({ flagMarked: true, communication: C }), SOURCE_LABELS.flag);
  });
  it("флаг + plain (дефолт) → лейбл флага", () => {
    assert.equal(resolveDirectiveLabel({ flagMarked: true, communication: D }), SOURCE_LABELS.flag);
  });
  it("без флага, plain explicit → лейбл maestro.json", () => {
    assert.equal(resolveDirectiveLabel({ flagMarked: false, communication: C }), SOURCE_LABELS.config_plain);
  });
  it("без флага, дефолт/invalid → лейбл дефолта", () => {
    assert.equal(resolveDirectiveLabel({ flagMarked: false, communication: D }), SOURCE_LABELS.default);
    assert.equal(resolveDirectiveLabel({ flagMarked: false, communication: DI }), SOURCE_LABELS.default);
  });
});

describe("communication directive (directiveText)", () => {
  it("содержит лейбл источника и security-carve-out", () => {
    const t = directiveText(SOURCE_LABELS.flag_override);
    assert.ok(t.includes(SOURCE_LABELS.flag_override));
    assert.ok(t.includes("Security-находки"));
    assert.ok(t.includes("субагентов"));
  });
});
```

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `node --test plugins/maestro-bootstrap/index.test.js 2>&1 | tail -5`
Expected: FAIL — SOURCE_LABELS is not a function / not exported.

- [ ] **Step 3: Минимальная реализация**

Дополнить `communication.js`:

```js
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
```

- [ ] **Step 4: Прогнать тесты**

Run: `node --test plugins/maestro-bootstrap/index.test.js 2>&1 | tail -5`
Expected: PASS.

- [ ] **Step 5: Коммит**

```bash
git add plugins/maestro-bootstrap/communication.js plugins/maestro-bootstrap/index.test.js
git commit -m "feat(communication): source-лейблы и текст директивы (матрица конфиг×флаг)"
```

---

### Task 4: `registerCommunicationHooks` — chat.message (маркировка флага)

**Files:**
- Modify: `plugins/maestro-bootstrap/communication.js`
- Test: `plugins/maestro-bootstrap/index.test.js`

- [ ] **Step 1: Написать failing-тесты**

Импорт: добавить `registerCommunicationHooks` к импорту `./communication.js`.

```js
describe("communication hooks (chat.message mark)", () => {
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
  const userMsg = (text) => ({ message: { parts: [{ type: "text", text }] } });

  it("флаг + eligible primary → маркировка + log communication:flag_plain", async () => {
    const log = fakeLog();
    const hooks = await registerCommunicationHooks({ client: fakeClient(), config: {}, log });
    await hooks["chat.message"]({ sessionID: "s1" }, userMsg('@maestro-init --plain "x"'));
    assert.ok(log.calls.some((c) => c.msg === "communication:flag_plain" && c.extra.sessionID === "s1"));
  });
  it("тот же флаг повторно → idempotent (один log)", async () => {
    const log = fakeLog();
    const hooks = await registerCommunicationHooks({ client: fakeClient(), config: {}, log });
    const msg = userMsg('@maestro-init --plain "x"');
    await hooks["chat.message"]({ sessionID: "s1" }, msg);
    await hooks["chat.message"]({ sessionID: "s1" }, msg);
    assert.equal(log.calls.filter((c) => c.msg === "communication:flag_plain").length, 1);
  });
  it("task-сессия (parentID задан) → без маркировки", async () => {
    const log = fakeLog();
    const hooks = await registerCommunicationHooks({
      client: fakeClient({ s1: { parentID: "s0", title: "sub" } }), config: {}, log });
    await hooks["chat.message"]({ sessionID: "s1" }, userMsg('@maestro-init --plain "x"'));
    assert.ok(!log.calls.some((c) => c.msg === "communication:flag_plain"));
  });
  it("сервис-сессия [maestro-memory] (parentID пуст) → без маркировки (FU-1)", async () => {
    const log = fakeLog();
    const hooks = await registerCommunicationHooks({
      client: fakeClient({ s1: { parentID: null, title: "[maestro-memory] summarize s1" } }),
      config: {}, log });
    await hooks["chat.message"]({ sessionID: "s1" }, userMsg('@maestro-init --plain "x"'));
    assert.ok(!log.calls.some((c) => c.msg === "communication:flag_plain"));
  });
  it("ошибка client.session.get → без маркировки (fail-soft, консервативно)", async () => {
    const log = fakeLog();
    const hooks = await registerCommunicationHooks({ client: fakeClient(), config: {}, log });
    await hooks["chat.message"]({ sessionID: "unknown" }, userMsg('@maestro-init --plain "x"'));
    assert.ok(!log.calls.some((c) => c.msg === "communication:flag_plain"));
  });
  it("невалидный communication-ключ → warn communication:config_fallback", async () => {
    const log = fakeLog();
    await registerCommunicationHooks({ client: fakeClient(), config: { communication: "nope" }, log });
    assert.ok(log.calls.some((c) => c.msg === "communication:config_fallback" && c.extra.error_class === "invalid_value"));
  });
});
```

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `node --test plugins/maestro-bootstrap/index.test.js 2>&1 | tail -5`
Expected: FAIL — registerCommunicationHooks is not a function.

- [ ] **Step 3: Минимальная реализация**

Дополнить `communication.js` (импорт `loadCommunicationConfig` НЕ из core — дублируем разбор в 3 строках, чтобы избежать ESM-цикла; источник истины — enum из core, совпадение фиксируется тестом Task 1):

```js
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
```

Примечание: `experimental.chat.system.transform` здесь уже реализован (Task 5 — только его тесты; хуки регистрируются вместе, разделение по task'ам — для изоляции TDD-циклов).

- [ ] **Step 4: Прогнать тесты**

Run: `node --test plugins/maestro-bootstrap/index.test.js 2>&1 | tail -5`
Expected: PASS.

- [ ] **Step 5: Коммит**

```bash
git add plugins/maestro-bootstrap/communication.js plugins/maestro-bootstrap/index.test.js
git commit -m "feat(communication): registerCommunicationHooks — chat.message-маркировка --plain (guard: parentID + [maestro-memory])"
```

---

### Task 5: system.transform — матрица инъекций (тесты)

**Files:**
- Test: `plugins/maestro-bootstrap/index.test.js`

Реализация — уже в Task 3/4 (лейблы + хук). Этот task доводит покрытие матрицы из спеки §3.2/§7.

- [ ] **Step 1: Написать failing-тесты** (реализация должна пройти; если нет — баг в Task 4)

```js
describe("communication hooks (system.transform matrix)", () => {
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
  const userMsg = (text) => ({ message: { parts: [{ type: "text", text }] } });
  const mark = async (hooks) => {
    await hooks["chat.message"]({ sessionID: "s1" }, userMsg('@maestro-init --plain "x"'));
  };
  const transform = async (hooks, out) => {
    await hooks["experimental.chat.system.transform"]({ sessionID: "s1" }, out);
    return out.system;
  };

  it("config plain explicit → лейбл maestro.json", async () => {
    const hooks = await registerCommunicationHooks({
      client: fakeClient(), config: { communication: "plain" }, log: fakeLog() });
    const sys = await transform(hooks, { system: [] });
    assert.equal(sys.length, 1);
    assert.ok(sys[0].includes("maestro.json (communication: plain)"));
  });
  it("config отсутствует (дефолт) → лейбл «дефолт (plain)»", async () => {
    const hooks = await registerCommunicationHooks({ client: fakeClient(), config: {}, log: fakeLog() });
    const sys = await transform(hooks, { system: [] });
    assert.equal(sys.length, 1);
    assert.ok(sys[0].includes("источник: дефолт (plain)"));
  });
  it("config professional, без флага → без инъекции", async () => {
    const hooks = await registerCommunicationHooks({
      client: fakeClient(), config: { communication: "professional" }, log: fakeLog() });
    const sys = await transform(hooks, { system: [] });
    assert.equal(sys.length, 0);
  });
  it("флаг + professional → лейбл переопределения", async () => {
    const hooks = await registerCommunicationHooks({
      client: fakeClient(), config: { communication: "professional" }, log: fakeLog() });
    await mark(hooks);
    const sys = await transform(hooks, { system: [] });
    assert.equal(sys.length, 1);
    assert.ok(sys[0].includes("переопределяет maestro.json professional"));
  });
  it("флаг + plain (дефолт) → лейбл флага БЕЗ «переопределяет» (N2)", async () => {
    const hooks = await registerCommunicationHooks({ client: fakeClient(), config: {}, log: fakeLog() });
    await mark(hooks);
    const sys = await transform(hooks, { system: [] });
    assert.equal(sys.length, 1);
    assert.ok(sys[0].includes("источник: флаг --plain"));
    assert.ok(!sys[0].includes("переопределяет"));
  });
  it("task-сессия (parentID) → без инъекции ни по какой ветке", async () => {
    const hooks = await registerCommunicationHooks({
      client: fakeClient({ s1: { parentID: "s0", title: "sub" } }),
      config: { communication: "plain" }, log: fakeLog() });
    const sys = await transform(hooks, { system: [] });
    assert.equal(sys.length, 0);
  });
  it("сервис-сессия [maestro-memory] (parentID пуст) → без инъекции (N1)", async () => {
    const hooks = await registerCommunicationHooks({
      client: fakeClient({ s1: { parentID: null, title: "[maestro-memory] summarize" } }),
      config: { communication: "plain" }, log: fakeLog() });
    const sys = await transform(hooks, { system: [] });
    assert.equal(sys.length, 0);
  });
  it("invalid-fallback → инъекция с лейблом «дефолт»", async () => {
    const hooks = await registerCommunicationHooks({
      client: fakeClient(), config: { communication: 42 }, log: fakeLog() });
    const sys = await transform(hooks, { system: [] });
    assert.equal(sys.length, 1);
    assert.ok(sys[0].includes("источник: дефолт (plain)"));
  });
});
```

- [ ] **Step 2: Прогнать тесты**

Run: `node --test plugins/maestro-bootstrap/index.test.js 2>&1 | tail -5`
Expected: PASS (реализация из Tasks 3–4 покрывает матрицу). Если какой-то кейс FAIL — фиксировать в `communication.js`, не в тестах.

- [ ] **Step 3: Коммит**

```bash
git add plugins/maestro-bootstrap/index.test.js
git commit -m "test(communication): матрица system.transform (конфиг×флаг×guard'ы) по спеке §7"
```

---

### Task 6: Wiring в core.js + coexistence с memory

**Files:**
- Modify: `plugins/maestro-bootstrap/core.js` (import + wiring в `MaestroBootstrapPlugin`)
- Test: `plugins/maestro-bootstrap/index.test.js`

- [ ] **Step 1: Написать failing-тесты**

```js
describe("communication wiring (MaestroBootstrapPlugin)", () => {
  let dir;
  before(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "fab-comm-")); });
  after(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it("communication-хуки зарегистрированы (chat.message + system.transform); messages.transform === undefined", async () => {
    fs.writeFileSync(path.join(dir, "maestro.json"), JSON.stringify({ communication: "plain" }));
    const hooks = await MaestroBootstrapPlugin({ directory: dir });
    assert.equal(typeof hooks["chat.message"], "function");
    assert.equal(typeof hooks["experimental.chat.system.transform"], "function");
    assert.equal(hooks["experimental.chat.messages.transform"], undefined);
  });
  it("без maestro.json — хуки тоже (дефолт plain), fail-soft без client", async () => {
    const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), "fab-comm2-"));
    const hooks = await MaestroBootstrapPlugin({ directory: dir2 });
    assert.equal(typeof hooks["experimental.chat.system.transform"], "function");
    // без client — инъекция не происходит (isEligible fail-soft → false)
    const out = { system: [] };
    await hooks["experimental.chat.system.transform"]({ sessionID: "s1" }, out);
    assert.equal(out.system.length, 0);
    fs.rmSync(dir2, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `node --test plugins/maestro-bootstrap/index.test.js 2>&1 | tail -5`
Expected: FAIL — `hooks["chat.message"]` undefined (сейчас присваивается только из memoryHooks, а memory выключен).

- [ ] **Step 3: Wiring**

В `core.js`:

(a) В начало (после существующих imports):

```js
import { registerCommunicationHooks } from "./communication.js";
```

(b) В `MaestroBootstrapPlugin`, после блока memory-wiring (сейчас строки ~1095–1108: `plugin.tool = ...`, `plugin["chat.message"] = memoryHooks["chat.message"];`, `plugin["experimental.chat.system.transform"] = ...`) — заменить присваивания хуков на chain:

```js
  // Communication (plain language): активен всегда (standalone-ключ enabled
  // нет; дефолт communication — "plain"). Fail-soft, как memory.
  let commHooks = {};
  try {
    commHooks = await registerCommunicationHooks({ client, config, log });
  } catch (err) {
    log.error("communication: init failed", { error: err instanceof Error ? err.message : String(err) });
  }
  plugin.tool = { ...(memoryHooks.tool ?? {}) };
  const chainHooks = (name) => {
    const a = commHooks[name];
    const b = memoryHooks[name];
    if (!a && !b) return;
    plugin[name] = async (input, out) => {
      if (a) { try { await a(input, out); } catch {} }
      if (b) { try { await b(input, out); } catch {} }
    };
  };
  chainHooks("chat.message");
  chainHooks("experimental.chat.system.transform");
```

(Удалить старые строки `plugin["chat.message"] = memoryHooks["chat.message"];` и `plugin["experimental.chat.system.transform"] = memoryHooks["experimental.chat.system.transform"];`.)

- [ ] **Step 4: Прогнать тесты**

Run: `node --test plugins/maestro-bootstrap/index.test.js 2>&1 | tail -5`
Expected: PASS, 0 fail (в т.ч. прежние memory-free тесты).

- [ ] **Step 5: Коммит**

```bash
git add plugins/maestro-bootstrap/core.js plugins/maestro-bootstrap/index.test.js
git commit -m "feat(communication): wiring в MaestroBootstrapPlugin — chain communication+memory хуки (инвариант messages.transform undefined)"
```

---

### Task 7: README плагина (FU-3)

**Files:**
- Modify: `plugins/maestro-bootstrap/README.md`

- [ ] **Step 1: Секция `communication` в «Конфигурация: maestro.json»**

После блока с описанием секций (`**trust**`, `**sanitizer_whitelist**`...) добавить:

```markdown
- **`communication`** — режим «простой язык» для HITL-диалога: `"plain"`
  (дефолт, ключ можно не указывать) | `"professional"` (упрощение выключено).
  Невалидное значение → soft fallback в `plain` + warn `communication:config_fallback`.
  Хуки: `chat.message` (детект `--plain` в `@maestro-init`) и
  `experimental.chat.system.transform` (инъекция короткой директивы только в
  top-level primary-сессии; guard: parentID + title-префикс
  `[maestro-memory]`). Лог-события: `communication:flag_plain`,
  `communication:config_fallback`, `communication:directive_injected` (debug).
```

- [ ] **Step 2: Хук-surface**

В раздел, описывающий хуки (начало файла / «Что делает»), дополнить: хуки
`chat.message`/`system.transform` теперь регистрируются всегда (ранее — только
при `memory.enabled` + `auto_recall`); `experimental.chat.messages.transform`
остаётся `undefined` (инвариант).

- [ ] **Step 3: Проверка**

Run: `node --test plugins/maestro-bootstrap/index.test.js 2>&1 | tail -3` (регрессия, доки не влияют)
Expected: PASS.

- [ ] **Step 4: Коммит**

```bash
git add plugins/maestro-bootstrap/README.md
git commit -m "docs(communication): README — communication-ключ, hook-surface, log-события"
```

---

### Task 8: `commands/maestro-init.md` — флаг `--plain`

**Files:**
- Modify: `commands/maestro-init.md`

- [ ] **Step 1: Блок про флаг**

После таблицы «Режимы запуска» и «Правило парсинга» (строки ~27–29) добавить:

```markdown
## Флаг `--plain` (простой язык)

`--plain` — НЕ режим запуска: ортогонален флагам режимов и комбинируется
(`@maestro-init --auto-answer --plain "задача"`). Per-run, не персистится.
Включает простой язык на этот запуск; **флаг > конфиг** `maestro.json`
(даже при `communication: "professional"`).

| Синтаксис | Эффект |
|---|---|
| `@maestro-init --plain "задача"` | простой язык на этот запуск |

Правило парсинга: снять `--plain` из текста задачи (вместе с режим-флагом —
оба), передать в pipeline. Канон правил — `skills/maestro/SKILL.md`, секция
«Простой язык (plain language)»; активация по конфигу — плагин (инъекция
директивы, до загрузки скилла).
```

- [ ] **Step 2: Коммит**

```bash
git add commands/maestro-init.md
git commit -m "docs(maestro-init): флаг --plain (простой язык, ортогонален режимам, флаг > конфиг)"
```

---

### Task 9: `skills/maestro/SKILL.md` — канон-секция

**Files:**
- Modify: `skills/maestro/SKILL.md` (вставить после секции «Run modes» в «Mode protocol», Overview)

- [ ] **Step 1: Секция**

```markdown
**4. Plain language (простой язык)** — режим коммуникации с HITL.
- **Активация:** (1) директива плагина в system-контексте (плагин читает
  `maestro.json → communication`, дефолт `plain`; инжектит короткую
  самодостаточную директиву в top-level primary-сессии); (2) флаг `--plain`
  в тексте команды `@maestro-init` (обходной путь без плагина; флаг > конфиг).
- **Правила (канон):** общайся с пользователем простым понятным языком —
  примеры и аналогии вместо жаргона; сложные термины только когда без них
  нельзя, с коротким пояснением; техническая конкретика — только по запросу
  или когда мысль нельзя донести иначе.
- **Не распространяется:** артефакты (спецы/планы/код/доки — остаются
  техническими), субагенты, промпты диспатча.
- **Security-находки и точные технические детали — всегда полностью.**
- **На старте пайплайна:** объявить активацию в чате с источником
  (maestro.json / дефолт / флаг).
```

- [ ] **Step 2: Коммит**

```bash
git add skills/maestro/SKILL.md
git commit -m "docs(maestro): канон-секция «Простой язык (plain language)» в Mode protocol"
```

---

### Task 10: `skills/maestro-setup/SKILL.md` — вопрос выбора режима

**Files:**
- Modify: `skills/maestro-setup/SKILL.md`

- [ ] **Step 1: Вопрос в задачу генерации конфига**

В задачу, где создаётся/обновляется `maestro.json` (задача 2/3 по канону
скилла), добавить пункт:

```markdown
- **Вопрос режима коммуникации (HITL):** «Какой режим коммуникации?
  (a) plain — простой язык для обсуждений по умолчанию (рекомендуется) —
  (b) professional — технический язык, без упрощения». Результат — ключ
  `communication` (`"plain"` | `"professional"`) в `maestro.json`. При
  обновлении существующего конфига без ключа — спросить только если
  пользователь просил правку конфига (дефолт `plain` действует молча).
```

- [ ] **Step 2: Коммит**

```bash
git add skills/maestro-setup/SKILL.md
git commit -m "docs(maestro-setup): HITL-вопрос выбора communication-режима при генерации конфига"
```

---

### Task 11: `skills/maestro-assistant/SKILL.md` — ключ + смена режима

**Files:**
- Modify: `skills/maestro-assistant/SKILL.md`

- [ ] **Step 1: Правила ключа + процедура смены**

В канон правил конфига (секция по мапу секций `maestro.json`) добавить:

```markdown
### Ключ `communication` (простой язык)

- Значения: `"plain"` (дефолт — простой язык в диалогах) | `"professional"`
  (технический язык). Невалидное → плагин делает soft fallback в `plain`
  + warn в лог.
- Область: только диалог с пользователем (все top-level primary-сессии);
  артефакты/субагенты не затрагиваются. Флаг `@maestro-init --plain` —
  per-run, приоритетнее конфига.
- **Процедура смены режима:** чтение `maestro.json` — через bash (нативный
  read-deny), правка — `edit` (нативный ask → HITL-подтверждение), затем
  **обязательно сообщить о перезапуске opencode** (конфиг плагина читается
  один раз при init — без рестарта эффект не наступит). Объяснить
  последствия: дефолт `plain`, приоритет флага, область действия.
```

- [ ] **Step 2: Коммит**

```bash
git add skills/maestro-assistant/SKILL.md
git commit -m "docs(maestro-assistant): ключ communication + процедура смены режима (bash/edit-ask/рестарт)"
```

---

### Task 12: `manual_docs/` — синхронизация (критерий приёмки)

**Files:**
- Modify: `manual_docs/reference/config.md`
- Modify: `manual_docs/reference/commands.md`
- Modify: `manual_docs/tutorials/setup-project.md`
- Create: `manual_docs/explanation/plain-language.md`
- Modify: `manual_docs/overview/changelog.md`

- [ ] **Step 1: `reference/config.md`**

(a) В «📄 maestro.json» — «Файл состоит из трёх секций» → перечислить и `communication` (плюс `memory` при упоминании — сверить с текущим текстом).
(b) После «### Секция `trust`» добавить:

```markdown
### Секция/ключ `communication`

Режим «простой язык» для HITL-диалога (верхнеуровневый ключ).

| Значение | Поведение |
|---|---|
| `"plain"` (или ключ отсутствует — **дефолт**) | простой язык во всех top-level primary-сессиях проекта (в т.ч. non-maestro чаты) |
| `"professional"` | технический язык, без упрощения |

- Невалидное значение → soft fallback в `plain` + warn `communication:config_fallback` в лог плагина.
- Область: только диалог с пользователем; спеки/планы/код/доки и субагенты не затрагиваются.
- Флаг `@maestro-init --plain` — per-run, **приоритетнее конфига** (даже `professional`).
- Смена режима — через `/maestro-assistant` (обязателен перезапуск opencode после правки).
- Механика — [Простой язык: как это работает](../explanation/plain-language.md).
```

- [ ] **Step 2: `reference/commands.md`**

В «### `/maestro-init`» — в блок синтаксиса добавить строку:

```
/maestro-init --plain "задача"               # простой язык на этот запуск (не режим; комбинируется: --auto-answer --plain)
```

и после блока:

```markdown
**`--plain`:** не режим запуска (ортогонален флагам режимов). Включает простой
язык на этот запуск; флаг > конфиг `maestro.json` (`communication`).
Канон — SKILL.md, секция «Простой язык»; ключ — [Конфигурация](config.md).
```

- [ ] **Step 3: `tutorials/setup-project.md` (FU-2)**

В шаг создания `maestro.json` добавить пункт: `/maestro-setup` задаёт вопрос
режима коммуникации (`plain` / `professional`) — результат пишется в ключ
`communication` (дефолт `plain`).

- [ ] **Step 4: `explanation/plain-language.md` (новый)**

```markdown
# Простой язык: как это работает

[Назад к оглавлению](../index.md)

## Назначение

Коротко о механике режима «простой язык» (`communication` / `--plain`):
кто читает конфиг, как корректируется поведение, границы действия.

## Механика

1. `maestro.json → communication` читает **только плагин** `maestro-bootstrap`
   (primary-сессии нельзя читать `maestro.json` — нативный deny). Скиллы не
   парсят конфиг — они содержат правила и реагируют на директиву.
2. Плагин инжектит короткую самодостаточную директиву в system-контекст
   top-level primary-сессии (`experimental.chat.system.transform`). Guard:
   task-сессии субагентов (parentID) и сервис-сессии `[maestro-memory]`
   исключены.
3. Флаг `@maestro-init --plain`: плагин детектит его в тексте первого
   сообщения (`chat.message`) и маркирует сессию; флаг > конфиг.
   Обходной путь без плагина: текст команды сам инструктирует оркестратора.
4. Источники директивы: `maestro.json (communication: plain)` /
   `дефолт (plain)` / `флаг --plain` / `флаг --plain (переопределяет
   maestro.json professional)`.

## Границы

- Применяется: диалог с пользователем (вопросы, гейты, объяснения,
  уведомления) — во всех primary-сессиях проекта.
- Не применяется: артефакты (спецы/планы/код/доки), субагенты, промпты
  диспатча. Security-находки и точные технические детали — всегда полностью.
- Без плагина: в проекте без `maestro.json` работает только флаг (через
  команду); в проекте с `maestro.json` — гейт 0 останавливает пайплайн.

Связанные страницы: [Конфигурация](../reference/config.md) ·
[Команды](../reference/commands.md)
```

- [ ] **Step 5: `overview/changelog.md`**

В `## [Unreleased]` добавить (секция `### Добавлено`):

```markdown
- **Режим «простой язык» (plain language):** ключ `communication`
  (`"plain" | "professional"`, **дефолт `plain`** — изменение поведения для
  существующих проектов: простой язык включён во всех primary-сессиях;
  откат — `"professional"`) + флаг `@maestro-init --plain` (per-run,
  приоритетнее конфига). Плагин инжектит директиву в top-level
  primary-сессии (guard: parentID + `[maestro-memory]`); канон — SKILL.md
  «Простой язык»; `/maestro-setup` спрашивает режим при генерации конфига;
  `/maestro-assistant` — смена режима (обязателен перезапуск opencode).
  Regression: `regression/entries/2026-09-22-plain-language-mode.md`.
```

- [ ] **Step 6: Проверка ссылок**

Run: `grep -rn "plain-language" manual_docs/ | head` + открыть ссылки из `index.md` (если оглавление генерируется — добавить строку в оглавление `manual_docs/index.md`).
Expected: ссылки резолвятся, оглавление обновлено.

- [ ] **Step 7: Коммит**

```bash
git add manual_docs/
git commit -m "docs(manual): plain language — config/commands/tutorial/explanation/changelog + оглавление"
```

---

### Task 13: Regression entry

**Files:**
- Create: `regression/entries/2026-09-22-plain-language-mode.md`

- [ ] **Step 1: Entry**

```markdown
# Regression — plain-language-mode

- **version:** 1
- **feature:** режим «простой язык»: communication-ключ (дефолт plain) + флаг --plain + инъекция директивы плагина
- **added:** 2026-09-22
- **status:** active
- **last_full_pass:** —
- **risk:** MEDIUM
- **category:** plugin hook-wiring (communication + memory coexistence) + флип дефолта коммуникации
- **scenarios:**
  - **unit-тесты фичи (loader/detectPlainFlag/лейблы/hook-матрица/wiring):**
    - run: `node --test plugins/maestro-bootstrap/index.test.js`
    - workdir: `/Users/odemidov/Documents/dev/github/maestro-agent`
  - **memory-тесты (коэксистенция хуков chat.message/system.transform):**
    - run: `npm run test:memory`
    - workdir: `/Users/odemidov/Documents/dev/github/maestro-agent`
  - **[Manual] инъекция только в primary:** в новой сессии (дефолтный конфиг) system-контекст содержит директиву «простой язык»; в task-сессиях субагентов и `[maestro-memory]`-саммаризатора её нет (проверка: качество саммари памяти не деградирует; log `communication:directive_injected` — только primary sessionID).
  - **[Manual] флаг против professional:** `maestro.json → communication: "professional"` + рестарт + `@maestro-init --plain "…" →` простой язык активен, директива с пометкой «переопределяет»; без флага — технический язык.
  - **[Manual] смена режима через /maestro-assistant:** после правки без рестарта эффект отсутствует; после рестарта opencode — меняется (лог `communication:config_fallback` при невалидном значении).
```

- [ ] **Step 2: Проверка структуры**

Run: `ls regression/entries/ | grep plain-language`
Expected: файл на месте; формат совпадает с соседними entry (полевой список).

- [ ] **Step 3: Коммит**

```bash
git add regression/entries/2026-09-22-plain-language-mode.md
git commit -m "docs(regression): entry plain-language-mode (hook-wiring + флип дефолта)"
```

---

## Final verification (после всех задач)

- [ ] `node --test plugins/maestro-bootstrap/index.test.js` — 0 fail.
- [ ] `npm run test:memory` — 0 fail (коэксистенция; опциональные deps в devDependencies).
- [ ] Diff-сверка с спекой: каждая секция спеки (2.1, 2.2, 2.3, 3, 4, 5, 6, 7, 8) имеет реализацию/док; spec-follow-up FU-1/2/3 закрыты.
- [ ] `grep -rn "plain" commands/ skills/ manual_docs/ plugins/maestro-bootstrap/README.md` — нет рассинхрона формулировок (дефолт plain, флаг > конфиг, область — только диалог).
- [ ] Версия НЕ бампается в этой ветке: bump `4.6.0` — отдельный коммит `chore: bump version to 4.6.0 — …` ПОСЛЕ merge на base-ветке (шаг 18 пайплайна), с переездом `[Unreleased]` в секцию релиза.
