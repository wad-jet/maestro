# Maestro Config Read Tool (`maestro_config`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Чтение параметров `maestro.json` в сессии — только через read-only плагин-тул `maestro_config` (native `ask`, только top-level primary; сабагенты — per-agent `deny` + плагинный fail-closed guard). Миграция 7+ точек с bash-чтения на тул, канон R6, P6 SECURITY.md, `test -f` как единственный bash-остаток (existence-only).

**Architecture:** Плагин `maestro-bootstrap` регистрирует тул **бесусловно** (не gated на `memory.enabled`) в `core.js` рядом с memory-tools: `maestro_config(section?)` → `{exists, config, section_found?, parse_error?, path}` (JSON-string, без redact). Guard — только top-level primary (parentID → deny; title `[maestro-memory]`/`SESSIONS` → deny; ошибка/отсутствие `sessionID` → deny fail-closed; bounded-cache 1024, паттерн `communication.js`). Tool shim — новый общий zero-dep файл `tool-shim.js` (try-import `@opencode-ai/plugin`, fallback identity+zod). `loadMaestroConfig` НЕ меняется (plugin-internal); тул читает файл сам (путь = `MAESTRO_CONFIG || <root>/maestro.json` — parity). Аудит: `maestro_config:read` (result ok/file_missing/parse_error/section_missing) и `maestro_config:access_denied` (reason).

**Tech Stack:** Node ESM, node:test (0 deps), Markdown (скиллы/команды/manual_docs/SECURITY.md).

**Spec:** `docs/superpowers/specs/2026-09-24-maestro-config-read-tool-design.md` (approve, opus, 3 раунда, Gate 10 approved).

**Служебные константы:**
- Baseline тестов: **236** pass / 0 fail (`node --test plugins/maestro-bootstrap/index.test.js`); после Task 1 — **249**.
- Версия: 4.8.0 → **4.9.0** (bump — после merge, шаг 18 пайплайна, НЕ на ветке; package.json на ветке не трогаем).
- Workdir всех команд — корень репо `/Users/odemidov/Documents/dev/github/maestro-agent`.
- **Каноническая формулировка правила (использовать дословно, self-contained, везде, где требуется правило):**
  > Чтение параметров `maestro.json` в сессии — только через плагин-тул `maestro_config` (native `ask`; только top-level primary; сабагенты — per-agent deny). Чтение через `read`/`glob`/`grep` и bash (`cat`/`sed`/`node -e`/иные) — запрещено. Исключение: existence-only `test -f maestro.json` (1 бит, без раскрытия параметров). Тул недоступен (плагин не загружен / устарел) — конфиг не читается: сообщение «перезапустите opencode / обновите плагин»; bash-fallback запрещён.
- **Правила для всех doc-task:** не вносить изменения в код в doc-task; коммиты — после каждого task; сообщения/доки — на русском.

---

### Task 1: Плагин-тул `maestro_config` — `tool-shim.js` + `core.js` + 13 тестов (TDD) [opus — ключевой task]

**Files:**
- Create: `plugins/maestro-bootstrap/tool-shim.js`
- Modify: `plugins/maestro-bootstrap/core.js` (imports ~L23-29; новые функции после `loadMaestroConfig` ~L357; регистрация ~L1152)
- Test: `plugins/maestro-bootstrap/index.test.js` (новый `describe` в конце файла, import-строка ~L1)

- [ ] **Step 1: Write the failing tests**

В `plugins/maestro-bootstrap/index.test.js`: (1) import-строка из `./core.js` (L1) дополнить `makeMaestroConfigTool` и `resolveConfigFile`; (2) в конец файла добавить блок:

```js
describe("maestro_config tool (read-only maestro.json, spec 2026-09-24)", () => {
  let dir;
  let savedMAESTRO;

  const cfgPath = () => path.join(dir, "maestro.json");
  const lines = (msg) => readLogs(dir).filter((e) => e.msg === msg);
  const clientWith = (sessions) => ({
    session: {
      get: async ({ path: { id } }) => {
        const s = sessions[id];
        if (!s) throw new Error("no session");
        return s;
      },
    },
  });
  const primary = () => clientWith({ s1: { parentID: null, title: "primary" } });
  const run = (t, args, sessionID = "s1") => t.execute(args ?? {}, { sessionID });
  const jrun = async (t, args, sid) => JSON.parse(await run(t, args, sid));
  const makeTool = async (config, client = primary()) => {
    if (config === null) fs.rmSync(cfgPath(), { force: true });
    else
      fs.writeFileSync(
        cfgPath(),
        typeof config === "string" ? config : JSON.stringify(config),
      );
    const plugin = await MaestroBootstrapPlugin({ directory: dir, client });
    return plugin.tool.maestro_config;
  };
  const cleanup = () => fs.rmSync(cfgPath(), { force: true });

  before(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "maestro-config-tool-"));
    savedMAESTRO = process.env.MAESTRO_CONFIG;
    delete process.env.MAESTRO_CONFIG;
  });
  after(() => {
    cleanup();
    if (savedMAESTRO === undefined) delete process.env.MAESTRO_CONFIG;
    else process.env.MAESTRO_CONFIG = savedMAESTRO;
    fs.rmSync(dir, { recursive: true, force: true });
  });
  afterEach(cleanup);

  it("1. весь конфиг: exists + config + path; аудит ok", async () => {
    const t = await makeTool({ trust: { custodian: true } });
    const out = await jrun(t, {});
    assert.equal(out.exists, true);
    assert.deepEqual(out.config, { trust: { custodian: true } });
    assert.equal(out.path, cfgPath());
    assert.ok(lines("maestro_config:read").some((e) => e.result === "ok"));
  });

  it("2. section: top-level и вложенный dot-path; null-значение найдено", async () => {
    const t = await makeTool({ memory: { enabled: true, embedding: { model: null, dim: 384 } } });
    const top = await jrun(t, { section: "memory" });
    assert.equal(top.section_found, true);
    assert.equal(top.config.enabled, true);
    const nested = await jrun(t, { section: "memory.embedding.dim" });
    assert.equal(nested.section_found, true);
    assert.equal(nested.config, 384);
    const nullVal = await jrun(t, { section: "memory.embedding.model" });
    assert.equal(nullVal.section_found, true);
    assert.equal(nullVal.config, null);
  });

  it("3. section не найден → section_found: false + аудит section_missing", async () => {
    const t = await makeTool({ trust: {} });
    const out = await jrun(t, { section: "nope" });
    assert.equal(out.section_found, false);
    assert.equal(out.config, null);
    assert.ok(lines("maestro_config:read").some((e) => e.result === "section_missing"));
  });

  it("4. файл отсутствует → exists: false + аудит file_missing", async () => {
    const t = await makeTool(null);
    const out = await jrun(t, {});
    assert.equal(out.exists, false);
    assert.deepEqual(out.config, {});
    assert.ok(lines("maestro_config:read").some((e) => e.result === "file_missing"));
  });

  it("5. невалидный JSON → parse_error: true + аудит parse_error", async () => {
    const t = await makeTool("{ not json");
    const out = await jrun(t, {});
    assert.equal(out.parse_error, true);
    assert.ok(lines("maestro_config:read").some((e) => e.result === "parse_error"));
  });

  it("6. невалидный section → сообщение об ошибке, без throw", async () => {
    const t = await makeTool({ a: { b: 1 } });
    for (const bad of ["", ".x", "a..b", "a."]) {
      const msg = await run(t, { section: bad });
      assert.match(msg, /invalid section/i);
    }
  });

  it("7. Guard: task-сессия (parentID) → deny task_session, без данных конфига", async () => {
    const t = await makeTool(
      { trust: { custodian: true } },
      clientWith({ t1: { parentID: "s0", title: "sub" } }),
    );
    const msg = await run(t, {}, "t1");
    assert.match(msg, /only available in top-level primary sessions/);
    assert.ok(!msg.includes("custodian"));
    assert.ok(
      lines("maestro_config:access_denied").some((e) => e.reason === "task_session"),
    );
  });

  it("8. Guard: service-сессия (title [maestro-memory]) → deny service_session", async () => {
    const t = await makeTool(
      {},
      clientWith({ s2: { parentID: null, title: "[maestro-memory] summarize s1" } }),
    );
    const msg = await run(t, {}, "s2");
    assert.match(msg, /only available in top-level primary sessions/);
    assert.ok(
      lines("maestro_config:access_denied").some((e) => e.reason === "service_session"),
    );
  });

  it("9. Guard: SESSIONS (fast-check до session.get) → deny service_session", async () => {
    const { SESSIONS } = await import("./memory/summarize.js");
    const t = await makeTool({}, clientWith({})); // session.get бы бросил — fast-check сработает раньше
    SESSIONS.add("svc-1");
    try {
      const msg = await run(t, {}, "svc-1");
      assert.match(msg, /only available in top-level primary sessions/);
      assert.ok(
        lines("maestro_config:access_denied").some(
          (e) => e.reason === "service_session" && e.sessionID === "svc-1",
        ),
      );
    } finally {
      SESSIONS.delete("svc-1");
    }
  });

  it("10. Guard: session.get-ошибка / нет sessionID → deny session_unavailable (fail-closed)", async () => {
    const t = await makeTool({}, primary());
    const msg1 = await run(t, {}, "unknown"); // не в map → throw
    assert.match(msg1, /only available in top-level primary sessions/);
    const msg2 = await t.execute({}, {}); // ctx без sessionID
    assert.match(msg2, /only available in top-level primary sessions/);
    assert.ok(
      lines("maestro_config:access_denied").filter(
        (e) => e.reason === "session_unavailable",
      ).length >= 2,
    );
  });

  it("11. Guard: primary-сессия → ok", async () => {
    const t = await makeTool({ communication: "plain" });
    const out = await jrun(t, { section: "communication" });
    assert.equal(out.config, "plain");
  });

  it("12. регистрация безусловна (без секции memory в конфиге)", async () => {
    const t = await makeTool({ trust: {} });
    assert.equal(typeof t.execute, "function");
  });

  it("13. MAESTRO_CONFIG override → path в ответе", async () => {
    const alt = path.join(dir, "custom-config.json");
    fs.writeFileSync(alt, JSON.stringify({ custom: true }));
    process.env.MAESTRO_CONFIG = alt;
    try {
      const t = await makeTool({ ignored: true }); // основной файл есть, override побеждает
      const out = await jrun(t, {});
      assert.equal(out.path, alt);
      assert.equal(out.config.custom, true);
    } finally {
      delete process.env.MAESTRO_CONFIG;
    }
  });
});
```

Примечание: `readLogs(dir)`, `MaestroBootstrapPlugin`, `fs`, `os`, `path` — уже в scope файла (используются существующими тестами).

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test plugins/maestro-bootstrap/index.test.js 2>&1 | grep -B2 -A6 "maestro_config tool"`
Expected: FAIL — `makeMaestroConfigTool is not a function` (import падает) — 13 тестов красные.

- [ ] **Step 3: Implement**

(3a) Новый файл `plugins/maestro-bootstrap/tool-shim.js`:

```js
/**
 * Общий tool-shim: `tool()` / `tool.schema` (zero-dep).
 *
 * При наличии `@opencode-ai/plugin` (целевой opencode-runtime, peer-зависимость)
 * использует нативный tool + zod; при его отсутствии (тестовая среда) —
 * identity-fallback + минимальный zod-совместимый schema-builder. Дублирует
 * `memory/index.js` → вынесен для переиспользания (memory-модуль на него
 * не мигрируем — из-за стабильности).
 */

let native;
try {
  native = await import("@opencode-ai/plugin");
} catch {
  native = null;
}

const isFn = (v) => typeof v === "function";

const makeSchema = () => {
  const base = {
    optional: () => base,
    nullable: () => base,
    describe: () => base,
    array: () => base,
  };
  return {
    string: () => base,
    number: () => base,
    boolean: () => base,
    object: () => base,
    literal: () => base,
    enum: () => base,
    union: () => base,
    record: () => base,
    any: () => base,
    unknown: () => base,
    array: () => base,
  };
};

const makeTool = (def) => def;

export const tool =
  native?.tool &&
  isFn(native.tool) &&
  native.schema &&
  isFn(native.schema.string)
    ? native.tool
    : Object.assign(makeTool, { schema: makeSchema() });
```

(3b) `plugins/maestro-bootstrap/core.js` — (i) в import-блок (L23-29) добавить две строки (рядом с `import { classifyMemoryConfig } from "./memory/config.js";`):

```js
import { tool } from "./tool-shim.js";
import { SESSIONS as MEMORY_SERVICE_SESSIONS } from "./memory/summarize.js";
```

(ii) сразу после `loadMaestroConfig` (~L357, до `loadWhitelist`) добавить:

```js
/**
 * Пути к конфигу для тула `maestro_config`: env `MAESTRO_CONFIG` или
 * `<root>/maestro.json` (parity с loadMaestroConfig).
 * @param {string} root  Корень проекта.
 * @returns {string}
 */
export function resolveConfigFile(root) {
  return process.env.MAESTRO_CONFIG || path.join(root, "maestro.json");
}

/**
 * Read-only тул `maestro_config` — санкционированный канал чтения
 * параметров `maestro.json` в сессии (spec 2026-09-24, §3.1).
 * Fail-closed guard: только top-level primary-сессии — deny: task-сессия
 * (parentID), service-сессия (title `[maestro-memory]` / MEMORY_SERVICE_SESSIONS),
 * session.get-ошибка или отсутствие sessionID (паттерн communication.js).
 * Ответ — JSON-string, без redact (diff-merge требует правки значений
 * пользователем, см. spec §3.1/§3.4). Аудит: `maestro_config:read` (result
 * ok/file_missing/parse_error/section_missing), `maestro_config:access_denied`
 * (reason task_session/service_session/session_unavailable).
 * @param {{ client: object, root: string, log: object }} p
 * @returns {object} tool-деф (description/args/execute)
 */
export function makeMaestroConfigTool({ client, root, log }) {
  const guardCache = makeBoundedMap(1024); // sessionID → null (ok) | reason
  const guard = async (sessionID) => {
    if (!sessionID) return "session_unavailable";
    if (MEMORY_SERVICE_SESSIONS.has(sessionID)) return "service_session";
    if (guardCache.has(sessionID)) return guardCache.get(sessionID);
    let reason;
    try {
      const resp = await client?.session?.get({ path: { id: sessionID } });
      const data = resp?.data ?? resp;
      if (!data) reason = "session_unavailable";
      else if (data.parentID) reason = "task_session";
      else if (
        typeof data.title === "string" &&
        data.title.startsWith("[maestro-memory]")
      )
        reason = "service_session";
      else reason = null;
    } catch {
      reason = "session_unavailable"; // консервативно: ошибка → deny
    }
    guardCache.set(sessionID, reason);
    return reason;
  };
  const deny = (sessionID, reason) => {
    log?.info?.("maestro_config:access_denied", { sessionID, reason });
    return "maestro_config: the tool is only available in top-level primary sessions";
  };

  return tool({
    description:
      "Read-only access to the maestro config file (maestro.json) — the sanctioned " +
      "channel for reading maestro config parameters within a session. Argument " +
      "section — dot-path to a section (e.g. memory, communication, " +
      "sanitizer_whitelist); no argument — the whole config.",
    args: {
      section: tool.schema
        .string()
        .optional()
        .describe(
          "Dot-path to a section (memory, memory.embedding.model, …); no argument — the whole config",
        ),
    },
    execute: async (args, ctx) => {
      const sessionID = ctx?.sessionID;
      const reason = await guard(sessionID);
      if (reason) return deny(sessionID, reason);
      const section = args?.section;
      const file = resolveConfigFile(root);
      if (!fs.existsSync(file)) {
        log?.info?.("maestro_config:read", {
          sessionID,
          section: section ?? null,
          result: "file_missing",
        });
        return JSON.stringify({ exists: false, config: {}, path: file });
      }
      let config;
      try {
        config = JSON.parse(fs.readFileSync(file, "utf8"));
      } catch {
        log?.info?.("maestro_config:read", {
          sessionID,
          section: section ?? null,
          result: "parse_error",
        });
        return JSON.stringify({
          exists: true,
          config: {},
          parse_error: true,
          path: file,
        });
      }
      if (section === undefined || section === null) {
        log?.info?.("maestro_config:read", {
          sessionID,
          section: null,
          result: "ok",
        });
        return JSON.stringify({ exists: true, config, path: file });
      }
      if (
        typeof section !== "string" ||
        section.startsWith(".") ||
        section.endsWith(".") ||
        section.split(".").some((seg) => seg.length === 0)
      ) {
        return `maestro_config: invalid section "${String(
          section,
        )}" (dot-path, non-empty segments, no leading/trailing dots)`;
      }
      let value = config;
      for (const seg of section.split(".")) {
        if (value !== null && typeof value === "object" && seg in value) {
          value = value[seg];
        } else {
          log?.info?.("maestro_config:read", {
            sessionID,
            section,
            result: "section_missing",
          });
          return JSON.stringify({
            exists: true,
            config: null,
            section_found: false,
            path: file,
          });
        }
      }
      log?.info?.("maestro_config:read", {
        sessionID,
        section,
        result: "ok",
      });
      return JSON.stringify({
        exists: true,
        config: value,
        section_found: true,
        path: file,
      });
    },
  });
}
```

Примечание: `fs`, `path`, `makeBoundedMap` уже импортированы/определены в core.js.

(iii) регистрация (~L1152, сейчас `plugin.tool = { ...(memoryHooks.tool ?? {}) };`):

```js
plugin.tool = {
  ...(memoryHooks.tool ?? {}),
  maestro_config: makeMaestroConfigTool({ client, root, log }),
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test plugins/maestro-bootstrap/index.test.js 2>&1 | tail -20`
Expected: PASS — 249 тестов (236 baseline + 13 новых), 0 fail.

- [ ] **Step 5: Commit**

```bash
git add plugins/maestro-bootstrap/tool-shim.js plugins/maestro-bootstrap/core.js plugins/maestro-bootstrap/index.test.js
git commit -m "feat(plugin): maestro_config read-only tool for maestro.json (guard fail-closed, audit) — spec 2026-09-24"
```

---

### Task 2: Канон R6 — `skills/maestro-assistant/SKILL.md` [sonnet]

**Files:**
- Modify: `skills/maestro-assistant/SKILL.md` (R6-базовый JSON ~L351, правила R6 ~L362, Per-agent exceptions ~L368, workflow step 1 ~L434, communication-процедура ~L291)

Все замены — точечные, текст до/после:

- [ ] **Step 1: R6-базовый JSON** — в блоке базового JSON (после `"grep": { "*": "allow", "maestro.json": "deny", ".maestro/**": "deny" },`) добавить строку `"maestro_config": "ask"` (заменить блок grep→edit на):

До:
```json
  "grep": { "*": "allow", "maestro.json": "deny", ".maestro/**": "deny" },
  "edit": { "*": "allow", "maestro.json": "ask" }
```
После:
```json
  "grep": { "*": "allow", "maestro.json": "deny", ".maestro/**": "deny" },
  "edit": { "*": "allow", "maestro.json": "ask" },
  "maestro_config": "ask"
```

- [ ] **Step 2: Правила R6** — после буллета «Bash word-based patterns — запрещены.» (и до «### Global deny (безопасность по умолчанию)») добавить буллет:

```markdown
- **Чтение параметров `maestro.json`** — только через плагин-тул `maestro_config`
  (native `ask`, только top-level primary-сессии; сабагенты — per-agent deny, см.
  Per-agent exceptions). Чтение через `read`/`glob`/`grep` и bash
  (`cat`/`sed`/`node -e`/иные) — запрещено. Исключение: existence-only
  `test -f maestro.json` (1 бит, без раскрытия параметров). Тул недоступен
  (плагин не загружен / устарел) — конфиг не читается: сообщение
  «перезапустите opencode / обновите плагин»; bash-fallback запрещён.
```

- [ ] **Step 3: Per-agent exceptions** — после буллета «**`fable`:** …» (последний буллет секции) добавить:

```markdown
- **`maestro_config`:** per-agent `deny` для **всех** сабагентов (untrusted и
  trusted) — тул доступен только в top-level primary-сессиях (native ask +
  плагинный fail-closed guard).
```

- [ ] **Step 4: Workflow step 1** (сейчас ~L434):

До:
```
1. Прочитай текущие артефакты (`maestro.json` — через bash, `cat`/`sed`: native
   permission-слой deny-ит `read`-тул; `.opencode/opencode.json` / `project-context.md`).
```
После:
```
1. Прочитай текущие артефакты (`maestro.json` — плагин-тул `maestro_config`
   (native ask; `read` нативно denied, bash-чтение запрещено правилом R6);
   `.opencode/opencode.json` / `project-context.md`). Тул недоступен — конфиг
   не читать: «перезапустите opencode / обновите плагин».
```

- [ ] **Step 5: Communication-процедура** (сейчас ~L291):

До:
```
   Чтение `maestro.json` — через bash (native read-deny), edit — `edit` (ask по
   нативному permission), остальные артефакты — `read`/`edit`.
```
После:
```
   Чтение `maestro.json` — плагин-тул `maestro_config` (arg `section:
   "communication"`; native ask), edit — `edit` (ask по нативному permission),
   остальные артефакты — `read`/`edit`.
```

- [ ] **Step 6: Verify**

Run:
```bash
grep -n "через bash" skills/maestro-assistant/SKILL.md | grep "maestro.json"   # → пусто
grep -c "maestro_config" skills/maestro-assistant/SKILL.md                     # ≥ 5
```

- [ ] **Step 7: Commit**

```bash
git add skills/maestro-assistant/SKILL.md
git commit -m "docs(skill): maestro-assistant — R6 canon: maestro_config sanctioned read channel, per-agent deny, workflow/communication updates"
```

---

### Task 3: Миграция flows — skills [sonnet]

**Files:**
- Modify: `skills/maestro/SKILL.md` (step 0, ~L1629-1635)
- Modify: `skills/maestro-setup/SKILL.md` (~L150, ~L154)
- Modify: `skills/maestro-setup/init-context.md` (~L149)
- Modify: `skills/maestro-design/SKILL.md` (frontmatter ~L13, preflight ~L73)

- [ ] **Step 1: `skills/maestro/SKILL.md`** (step 0 — trust-кэш):

До:
```
1. Оркестратор читает `maestro.json` **один раз за сессию** — на шаге 0 (Load
   Project Context), **через bash** (`cat`/`sed`): native permission-слой
   deny-ит `read`-тул. Кэширует для всех последующих диспатчей
```
После:
```
1. Оркестратор читает `maestro.json` **один раз за сессию** — на шаге 0 (Load
   Project Context) — **плагин-тулом `maestro_config`** (native `ask`;
   `read`-тул нативно denied, bash-чтение запрещено правилом R6). Кэширует для
   всех последующих диспатчей. Тул недоступен — конфиг не читается: «перезапустите
   opencode / обновите плагин (≥ 4.9.0)»; bash-fallback запрещён.
```

- [ ] **Step 2: `skills/maestro-setup/SKILL.md`** (diff-merge):

До:
```
**Чтение текущего `maestro.json`** (existing project, diff по секциям) —
**через bash** (`cat`/`sed`), не через read-тул: native permission-слой deny-ит
`read` по `maestro.json` (см. канон нативных permissions в `maestro-assistant`).
```
После:
```
**Чтение текущего `maestro.json`** (existing project, diff по секциям) —
**плагин-тулом `maestro_config`** (весь конфиг; native `ask`). `read`-тул —
нативно denied, bash-чтение запрещено (см. канон нативных permissions в
`maestro-assistant`). Тул недоступен — «перезапустите opencode / обновите плагин
(≥ 4.9.0)», конфиг не читать.
```

- [ ] **Step 3: `skills/maestro-setup/SKILL.md`** (генерация нативных permissions):

До (финал абзаца ~L154-157):
```
  `read`/`glob`/`grep` deny `maestro.json`/`.maestro/**`, `read`-allow
  `.maestro/plugin-version`, `edit`-ask `maestro.json`.
```
После:
```
  `read`/`glob`/`grep` deny `maestro.json`/`.maestro/**`, `read`-allow
  `.maestro/plugin-version`, `edit`-ask `maestro.json`, глобально
  `maestro_config` — `ask`, per-agent `maestro_config` — `deny` для всех
  сабагентов.
```

- [ ] **Step 4: `skills/maestro-setup/init-context.md`**:

До:
```
  `.maestro/plugin-version`, `edit`-ask `maestro.json`. Чтение текущего
  `maestro.json` (сравнение секций) — через bash (`cat`/`sed`), не через read-тул
  (нативный deny).
```
После:
```
  `.maestro/plugin-version`, `edit`-ask `maestro.json`, `maestro_config` — `ask`
  + per-agent `deny` (все сабагенты). Чтение текущего `maestro.json`
  (сравнение секций) — плагин-тулом `maestro_config` (`read`-тул нативно
  denied, bash-чтение запрещено).
```

- [ ] **Step 5: `skills/maestro-design/SKILL.md`** (frontmatter, ~L13-14):

До:
```
  Existence-check/чтение `maestro.json` — **через bash** (`cat`/`sed`/`test`):
  native permission-слой deny-ит `read`-тул по `maestro.json`.
```
После:
```
  Existence-check `maestro.json` — `test -f maestro.json` (existence-only: 1 бит,
  без раскрытия параметров); чтение параметров — плагин-тулом `maestro_config`
  (native `ask`; bash-чтение запрещено, `read`-тул нативно denied).
```

- [ ] **Step 6: `skills/maestro-design/SKILL.md`** (preflight, ~L73):

До:
```
- `maestro.json` существует (конфиг maestro) — проверка через bash (`test -f`/`cat`),
  нативный deny блокирует read-тул;
```
После:
```
- `maestro.json` существует (конфиг maestro) — `test -f maestro.json`
  (existence-only; `read`-тул нативно denied, параметры — тулом `maestro_config`);
```

- [ ] **Step 7: Verify**

Run:
```bash
grep -n "через bash" skills/maestro/SKILL.md skills/maestro-setup/SKILL.md skills/maestro-setup/init-context.md skills/maestro-design/SKILL.md | grep "maestro.json"   # → пусто
grep -l "maestro_config" skills/maestro/SKILL.md skills/maestro-setup/SKILL.md skills/maestro-setup/init-context.md skills/maestro-design/SKILL.md   # → 4 файла
```

- [ ] **Step 8: Commit**

```bash
git add skills/maestro/SKILL.md skills/maestro-setup/SKILL.md skills/maestro-setup/init-context.md skills/maestro-design/SKILL.md
git commit -m "docs(skill): maestro/setup/design — maestro.json reads migrated to maestro_config tool, test -f existence-only"
```

---

### Task 4: Миграция flows — commands (включая §3.4a restructure) [sonnet]

**Files:**
- Modify: `commands/maestro-assistant.md` (~L11-12)
- Modify: `commands/maestro-setup.md` (~L20-21)
- Modify: `commands/maestro-design.md` (~L12-13)
- Modify: `commands/maestro-memory.md` (step 1.2 ~L14-32, step 2 ~L54)
- Modify: `commands/maestro-memory-report.md` (step 1 ~L15-32, step 1a ~L43, step 2 ~L80)

- [ ] **Step 1: `commands/maestro-assistant.md`**:

До:
```
- `maestro.json` (trust / confidential / sanitizer_whitelist) — чтение через bash
  (`cat`/`sed`), нативный deny блокирует read-тул
```
После:
```
- `maestro.json` (trust / confidential / sanitizer_whitelist) — чтение
  параметров — плагин-тулом `maestro_config` (native `ask`); `read`/`glob`/`grep`
  нативно denied, bash-чтение запрещено (канон — в скилле `maestro-assistant`)
```

- [ ] **Step 2: `commands/maestro-setup.md`**:

До:
```
- `maestro.json` (diff по секциям) — через bash (`cat`/`sed`), не через read-тул
  (нативный deny по `maestro.json`).
```
После:
```
- `maestro.json` (diff по секциям) — плагин-тулом `maestro_config` (`read`-тул
  нативно denied, bash-чтение запрещено).
```

- [ ] **Step 3: `commands/maestro-design.md`**:

До:
```
- Чтение `project-context.md`, `docs/roadmap.md`, `maestro.json` (existence-check)
  — через **bash** (`cat`/`sed`/`test -f`), нативный deny блокирует read-тул по
  `maestro.json`/`.maestro/**`.
```
После:
```
- Чтение `project-context.md`, `docs/roadmap.md` — `read`; existence-check
  `maestro.json` — `test -f` (existence-only), чтение параметров —
  плагин-тулом `maestro_config` (`read`-тул нативно denied по
  `maestro.json`/`.maestro/**`, bash-чтение запрещено).
```

- [ ] **Step 4: `commands/maestro-memory.md` — step 1.2** (§3.4a: гейт до чтения конфига):

До:
```
1.2. Если `memory_stats_detail` **недоступен** (нет в tool-списке):
   - Прочитай `maestro.json` через bash: `memory.enabled`, `memory.storage.type`.
   - Определи причину (`disabled_reason`) из `maestro.json`:
```
После:
```
1.2. Если `memory_stats_detail` **недоступен** (нет в tool-списке):
   - **Гейт `maestro_config`:** если плагин-тул `maestro_config` тоже
     **недоступен** → вывод «Перезапустите opencode / обновите плагин
     maestro-bootstrap (≥ 4.9.0)» (дистинкция по `.maestro/plugin-version`:
     `< 4.9.0` → «плагин устарел — обновите и перезапустите opencode»; свежей
     init-записи в `.maestro/logs/` нет → «плагин не загружен — перезапустите
     opencode»). **Конфиг НЕ читать (bash-fallback запрещён).**
   - Если `maestro_config` доступен → прочитай секцию `memory` через тул
     (`section: "memory"`, native `ask`): `memory.enabled`,
     `memory.storage.type`.
   - Определи причину (`disabled_reason`) из прочитанной секции:
```
(остальной шаг 1.2 — классификация disabled_reason — без изменений).

- [ ] **Step 5: `commands/maestro-memory.md` — step 2** (~L54):

До:
```
1. Прочитай `maestro.json` (файл в корне проекта) **через bash** (`cat`/`sed`) —
   native permission-слой deny-ит `read`-тул по `maestro.json`.
```
После:
```
1. Прочитай секцию `memory` (файл `maestro.json` в корне проекта) плагин-тулом
   `maestro_config` (`section: "memory"`, native `ask`). Тул недоступен —
   «Перезапустите opencode / обновите плагин (≥ 4.9.0)», команда прерывается
   (bash-fallback запрещён).
```

- [ ] **Step 6: `commands/maestro-memory-report.md` — step 1** (гейт §3.4a):

До:
```
1. Прочитай `maestro.json` через bash (cat/sed — нативный deny-ит read-тул):
   `memory.enabled`, `memory.storage.type`, `memory.module_dir`.
2. Ветвление:
```
После:
```
1. **Гейт `maestro_config`:** если плагин-тул `maestro_config` **недоступен** →
   вывод «Перезапустите opencode / обновите плагин maestro-bootstrap (≥ 4.9.0)»
   (дистинкция по `.maestro/plugin-version` как в `@maestro-memory` шаг 1.2) —
   завершение. **Конфиг НЕ читать (bash-fallback запрещён).** Если доступен →
   прочитай секцию `memory` через тул (`section: "memory"`): `memory.enabled`,
   `memory.storage.type`, `memory.module_dir`.
2. Ветвление:
```
(ветвление — без изменений).

- [ ] **Step 7: `commands/maestro-memory-report.md` — step 1a** (сужение):

До:
```
## Шаг 1a. Fallback: прямое чтение sqlite (только при sqlite-бэкенде, tool недоступен)
```
После:
```
## Шаг 1a. Fallback: прямое чтение sqlite (только при sqlite-бэкенде, плагин
загружен/актуален, но `memory_stats_detail` временно недоступен)
```

- [ ] **Step 8: `commands/maestro-memory-report.md` — step 2** (~L80):

До:
```
1. Извлеки `memory.report.include_text` из уже прочитанного в шаге 1 `maestro.json`
   (чтение через bash — нативный permission-слой deny-ит `read`-тул по
   `maestro.json`).
   Если отсутствует → `false` (по умолчанию).
```
После:
```
1. Извлеки `memory.report.include_text` из уже прочитанной в шаге 1 секции
   `memory` (плагин-тул `maestro_config` — `read`-тул нативно denied,
   bash-чтение запрещено). Если отсутствует → `false` (по умолчанию).
```

- [ ] **Step 9: Verify**

Run:
```bash
grep -n "bash" commands/maestro-memory.md commands/maestro-memory-report.md commands/maestro-assistant.md commands/maestro-setup.md commands/maestro-design.md | grep -i "maestro.json"   # → только упоминания «bash-чтение запрещено»
grep -c "maestro_config" commands/maestro-memory.md commands/maestro-memory-report.md   # оба ≥ 3
```

- [ ] **Step 10: Commit**

```bash
git add commands/maestro-assistant.md commands/maestro-setup.md commands/maestro-design.md commands/maestro-memory.md commands/maestro-memory-report.md
git commit -m "docs(command): memory/setup/design/assistant commands — maestro_config gate (3.4a) + migration off bash reads"
```

---

### Task 5: SECURITY.md P6 + manual_docs [sonnet]

**Files:**
- Modify: `SECURITY.md` (P6, ~L46-52)
- Modify: `manual_docs/reference/config.md` (note ~L41-43, JSON агентов ~L581-660, R1+R4 quote ~L663)
- Modify: `manual_docs/reference/commands.md` (~L124, ~L134, ~L147)
- Modify: `manual_docs/reference/memory.md` (~L792, ~L802, ~L835)
- Modify: `manual_docs/explanation/agents-and-trust.md` (~L120-121)

- [ ] **Step 1: `SECURITY.md` P6** — заменить P6-блок:

До:
```
### P6. Защита конфигурационного файла (`maestro.json`)

`maestro.json` (trust / confidential / sanitizer_whitelist) **не читается**
сабагентами в ходе пайплайна — только оркестратором на шаге 0 и при явном
HITL-запросе пользователя. Файл содержит sensitive-конфиг (список trusted-агентов,
конфиг confidential-каталогов, whitelist sanitizer) и его чтение untrusted-агентом
может раскрыть структуру защиты проекта. `maestro.json` **git-ignored** (секреты:
API-ключи, credentials) и защищён **нативным permission-слоем** OpenCode
(`read`/`glob`/`grep` deny + `edit` ask в `.opencode/opencode.json` или global —
fail-closed, независим от плагина) — см. канон нативных permissions в
`maestro-assistant`.
```
После:
```
### P6. Защита конфигурационного файла (`maestro.json`)

`maestro.json` (trust / confidential / sanitizer_whitelist) защищён
**многоуровнево**:

1. **Sanctioned channel (в сессии):** чтение параметров — только через
   плагин-тул `maestro_config` (read-only, `maestro.json` в корне; native
   permission `ask`; только top-level primary-сессия — сабагенты: per-agent
   `deny` в конфиге + плагинный fail-closed guard: task/service-сессии и
   session-ошибки отклоняются). `maestro.json` не читается сабагентами в ходе
   пайплайна — только оркестратором на шаге 0 (кэш) и при явном HITL-запросе.
2. **Нативный permission-слой OpenCode (fail-closed, без плагина):**
   `read`/`glob`/`grep` deny + `edit` ask в `.opencode/opencode.json` или
   global — см. канон нативных permissions в `maestro-assistant`.
3. **Proцессный канон (R6):** чтение через bash (`cat`/`sed`/`node -e`/иные)
   запрещено; допущен только existence-only `test -f maestro.json` (1 бит, без
   раскрытия параметров).

Файл содержит sensitive-конфиг (список trusted-агентов, конфиг
confidential-каталогов, whitelist sanitizer) и его чтение untrusted-агентом
может раскрыть структуру защиты проекта. `maestro.json` **git-ignored**
(секреты: API-ключи, credentials).

**Residual (документировано, не устраняется в 4.9.0):** ручной `bash cat
maestro.json` через native `bash: allow` (первичная сессия) остаётся
(аналогично tamper `.opencode/opencode.json`, P5) — процессный канон запрещает
чтение конфига bash-командами в потоке пайплайна; технический запрет bash
не вводится (R6-консистентность: нативный deny только на
`read`/`glob`/`grep`/`edit`).
```

- [ ] **Step 2: `manual_docs/reference/config.md`** — (i) note ~L41-43:

До:
```
> **ИБ:** версия плагина — только `.maestro/plugin-version` (semver-only);
> конфиг `maestro.json` защищается **нативно** — deny `read`/`glob`/`grep` +
> edit-ask в `.opencode/opencode.json` (см. [`SECURITY.md`](../../../SECURITY.md)).
```
После:
```
> **ИБ:** версия плагина — только `.maestro/plugin-version` (semver-only);
> конфиг `maestro.json` защищается **нативно** — deny `read`/`glob`/`grep` +
> edit-ask в `.opencode/opencode.json`; санкционированный канал чтения
> параметров в сессии — плагин-тул `maestro_config` (permission `ask`, только
> top-level primary; сабагенты — per-agent deny + плагинный fail-closed guard);
> bash-чтение запрещено процессным каноном
> (см. [`SECURITY.md`](../../../SECURITY.md) → P6).
```

(ii) JSON «Агенты: модели» — в **каждый** `permission`-блок сабагента (custodian, sanitizer, haiku, sonnet, opus, fable, code-reviewer) добавить `"maestro_config": "deny",` (перед `"hidden"`).

(iii) R1+R4-цитата (~L663) — до:
```
> **Нативный permission-бастион (R1+R4).** Помимо плагина, init пишет нативный
> deny-baseline для confidential (`read`/`edit`) и 2-й эшелон для `bash`/`glob`/
> `grep` в merge-config. Канон и семантика (`*` пересекает `/`, last-match-wins) —
> в скилле `maestro-assistant`. Подробнее про риски обхода плагина через
> `bash`/`glob`/`grep` — см. [Агенты и модель доверия](../explanation/agents-and-trust.md).
```
После (дописать в конец цитаты):
```
> **Нативный permission-бастион (R1+R4).** Помимо плагина, init пишет нативный
> deny-baseline для confidential (`read`/`edit`) и 2-й эшелон для `bash`/`glob`/
> `grep` в merge-config. Канон и семантика (`*` пересекает `/`, last-match-wins) —
> в скилле `maestro-assistant`. Подробнее про риски обхода плагина через
> `bash`/`glob`/`grep` — см. [Агенты и модель доверия](../explanation/agents-and-trust.md).
> Чтение параметров `maestro.json` в сессии — только плагин-тулом `maestro_config`
> (global `ask`; saбагенты — per-agent `deny`); bash-чтение запрещено (P6).
```

- [ ] **Step 3: `manual_docs/reference/commands.md`**:

(i) ~L124 (блок `/maestro-assistant`):
До:
```
Обрабатывает: `maestro.json` (trust/confidential/sanitizer_whitelist),
```
После:
```
Обрабатывает: `maestro.json` (trust/confidential/sanitizer_whitelist;
чтение параметров — плагин-тулом `maestro_config`),
```

(ii) ~L134 (блок `@maestro-memory`):
До:
```
(`top_k`, `min_score`, `retention_days`). Данные — из `memory_stats_detail` +
чтение `maestro.json`. Только агрегаты (SEC-4b). При недоступном
```
После:
```
(`top_k`, `min_score`, `retention_days`). Данные — из `memory_stats_detail` +
секция `memory` плагин-тулом `maestro_config` (тул недоступен —
«перезапустите opencode / обновите плагин», конфиг не читается). Только
агрегаты (SEC-4b). При недоступном
```

(iii) ~L147:
До:
```
При недоступном `memory_stats_detail` команда ветвится по `maestro.json`:
`enabled: false` → «мастер выключен»; …
```
(точное текущее содержимое — по факту файла) После:
```
При недоступном `memory_stats_detail` команда ветвится по секции `memory`,
прочитанной плагин-тулом `maestro_config` (сам тул недоступен →
«перезапустите opencode / обновите плагин (≥ 4.9.0)», конфиг не читается,
bash-fallback запрещён): `enabled: false` → …
```
— остальной абзац (ветвление `enabled: true` + sqlite → fallback) дополнить
условием «+ плагин загружен/актуален» у fallback-ветки.

- [ ] **Step 4: `manual_docs/reference/memory.md`**:

(i) ~L792:
До:
```
`retention_days`). Данные — из `memory_stats_detail` + чтение `maestro.json`.
```
После:
```
`retention_days`). Данные — из `memory_stats_detail` + секция `memory`
плагин-тулом `maestro_config`.
```

(ii) ~L802-805:
До:
```
При недоступном `memory_stats_detail` команда различает: «память выключена»
(`memory.enabled: false`), «конфиг-невалиден» (честная причина по
`disabled_reason`) и «плагин недоступен» (`enabled: true` + инструмент
недоступен → перезапустить opencode).
```
После:
```
При недоступном `memory_stats_detail` команда различает: «память выключена»
(`memory.enabled: false`), «конфиг-невалиден» (честная причина по
`disabled_reason`) и «плагин недоступен» (`enabled: true` + инструмент
недоступен → перезапустить opencode). Отделение «плагин не загружен /
устарел» — сам тул `maestro_config` недоступен → «перезапустите opencode /
обновите плагин (≥ 4.9.0)» (конфиг не читается).
```

(iii) ~L835:
До:
```
При недоступном `memory_stats_detail` команда ветвится по `maestro.json`:
`enabled: false` → «Память выключена»; `enabled: true` + конфиг-невалиден →
честная причина по `disabled_reason`; `enabled: true` + sqlite → **fallback** на
прямое чтение sqlite (упрощённый HTML с плашкой «Плагин недоступен», только
агрегаты, `include_text` не поддерживается); `enabled: true` + qdrant/pgvector →
«Плагин недоступен; бэкенд централизованный — fallback невозможен».
```
После:
```
При недоступном `memory_stats_detail` команда ветвится по секции `memory`,
прочитанной плагин-тулом `maestro_config` (сам тул недоступен →
«перезапустите opencode / обновите плагин (≥ 4.9.0)», конфиг не читается):
`enabled: false` → «Память выключена»; `enabled: true` + конфиг-невалиден →
честная причина по `disabled_reason`; `enabled: true` + sqlite + плагин
загружен/актуален → **fallback** на прямое чтение sqlite (упрощённый HTML с
плашкой «Плагин недоступен», только агрегаты, `include_text` не
поддерживается); `enabled: true` + qdrant/pgvector → «Плагин недоступен;
бэкенд централизованный — fallback невозможен».
```

- [ ] **Step 5: `manual_docs/explanation/agents-and-trust.md`** (~L120-121):

До:
```
> **`maestro.json` защищён нативно** — deny `read`/`glob`/`grep` + edit-ask в
> `.opencode/opencode.json` (fail-closed, см. SECURITY.md → P6).
```
После:
```
> **`maestro.json` защищён нативно** — deny `read`/`glob`/`grep` + edit-ask в
> `.opencode/opencode.json` (fail-closed, см. SECURITY.md → P6).
> Санкционированный канал чтения параметров в сессии — плагин-тул
> `maestro_config` (permission `ask`, только top-level primary; сабагенты —
> per-agent deny + плагинный fail-closed guard); bash-чтение запрещено
> процессным каноном.
```

- [ ] **Step 6: Verify**

Run:
```bash
grep -c "maestro_config" SECURITY.md manual_docs/reference/config.md manual_docs/reference/commands.md manual_docs/reference/memory.md manual_docs/explanation/agents-and-trust.md   # все ≥ 1
grep -n "Residual" SECURITY.md   # P6
```

- [ ] **Step 7: Commit**

```bash
git add SECURITY.md manual_docs/reference/config.md manual_docs/reference/commands.md manual_docs/reference/memory.md manual_docs/explanation/agents-and-trust.md
git commit -m "docs(security,manual_docs): P6 rewording (sanctioned channel + residual) + sync config/commands/memory/agents-and-trust"
```

---

### Task 6: project-context + spec-followups + sandbox checklist [sonnet]

**Files:**
- Modify: `docs/project-context.md` (§6, §12)
- Modify: `docs/superpowers/specs/2026-09-24-maestro-config-read-tool-design.md` (followups M-A, M-B)
- Modify: `docs/testing/maestro-sandbox-checklist.md` (секция A)

- [ ] **Step 1: `docs/project-context.md` §6** (в конце секции «Конфигурация» добавить буллет):

```markdown
- **Чтение параметров `maestro.json` в сессии** — только плагин-тулом
  `maestro_config` (native `ask`, top-level primary; сабагенты — per-agent deny +
  плагинный fail-closed guard); bash-чтение запрещено, existence-only — `test -f`
  (4.9.0).
```

- [ ] **Step 2: `docs/project-context.md` §12** (после буллета «File access — натив…»):

```markdown
- **`maestro_config`** — read-only плагин-тул для параметров `maestro.json`
  (global `ask`; только top-level primary — сабагенты per-agent `deny` +
  плагинный fail-closed guard; bash-чтение запрещено процессным каноном;
  4.9.0).
```

- [ ] **Step 3: Spec-followup M-A** — в `docs/superpowers/specs/2026-09-24-maestro-config-read-tool-design.md` §3.9 заменить упоминание «следующий номер после #113» на:

```
файл `regression/entries/2026-09-24-maestro-config-read-tool.md` (конвенция
`<date>-<topic>.md`)
```

- [ ] **Step 4: Spec-followup M-B** — в том же спеке §7 пункт 2 заменить «не ссылаются» на «не вызывают» (в предложении про ветку, где `maestro_config` отсутствует).

- [ ] **Step 5: `docs/testing/maestro-sandbox-checklist.md`** — в секцию A (Base/конфиг) добавить строку:

```markdown
| A8 | `maestro_config`: primary — ok (возвращает конфиг); сабагент — deny + `maestro_config:access_denied` в логе; ветка «тул недоступен» не читает конфиг (bash-fallback отсутствует) | ✅/❌ | … |
```
(формат строки — как у соседних строк той же секции).

- [ ] **Step 6: Verify**

Run:
```bash
grep -c "maestro_config" docs/project-context.md docs/testing/maestro-sandbox-checklist.md   # ≥1 / ≥1
grep -n "не ссылаются\|следующий номер после" docs/superpowers/specs/2026-09-24-maestro-config-read-tool-design.md   # → пусто
```

- [ ] **Step 7: Commit**

```bash
git add docs/project-context.md docs/superpowers/specs/2026-09-24-maestro-config-read-tool-design.md docs/testing/maestro-sandbox-checklist.md
git commit -m "docs: project-context (maestro_config rule) + spec followups M-A/M-B + sandbox checklist A8"
```

---

### Task 7: Dogfooding merge-config — `.opencode/opencode.json` [haiku, БЕЗ коммита]

**Files:**
- Modify: `.opencode/opencode.json` (gitignored — в коммит НЕ попадает)

- [ ] **Step 1:** В блоке `permission` (global) добавить `"maestro_config": "ask"` (idempotent — если уже есть, пропустить).

- [ ] **Step 2:** В `permission` каждого сабагента (`agent.custodian`, `agent.sanitizer`, `agent.haiku`, `agent.sonnet`, `agent.opus`, `agent.fable`, `agent.code-reviewer`) добавить `"maestro_config": "deny"` (idempotent).

- [ ] **Step 3: Verify**

Run:
```bash
node -e 'JSON.parse(require("fs").readFileSync(".opencode/opencode.json","utf8")); console.log("valid JSON")'
grep -c '"maestro_config"' .opencode/opencode.json   # ≥ 8 (1 global + 7 per-agent)
```

- [ ] **Step 4: НЕ коммитить** (файл gitignored). Зафиксировать результат в report-файле SDD.

---

### Faza: финальная верификация (после всех task)

- [ ] `node --test plugins/maestro-bootstrap/index.test.js` → 249 pass / 0 fail.
- [ ] Глобальный grep-остатков:
```bash
grep -rn "через bash" skills/ commands/ | grep "maestro.json"      # → пусто (кроме формулировок «запрещено»)
grep -rn "cat.*maestro.json\|sed.*maestro.json" skills/ commands/  # → пусто (кроме формулировок «запрещено»)
```
- [ ] Плагин работает без `maestro.json` (init не падает): покрыт тестом Task 1 (makeTool(null)).
- [ ] Task review по каждому task (task-reviewer: sonnet; Task 1 — opus).
- [ ] Code Review (code-reviewer) → Security Audit (sanitizer) перед merge.

---

## Spec Coverage Matrix

| Spec-секция | Task |
|---|---|
| §3.1 contract (ответ/section/ошибки/без redact) | Task 1 (impl + tests 1-6, 11, 13) |
| §3.2 permissions (global ask, per-agent deny) | Task 2 (канон), Task 3 (setup-генерация), Task 5 (config.md), Task 7 (local) |
| §3.3 plugin-side guard (fail-closed, bounded cache) | Task 1 (impl + tests 7-10) |
| §3.4 canonical rule line + миграция flows (8 точек) | Task 2 (assistanт), Task 3 (skills), Task 4 (commands) |
| §3.4a tool-unavailable ветка (memory/memory-report, сужение 1a) | Task 4 steps 4-8 |
| §3.5 SECURITY.md P6 | Task 5 step 1 |
| §3.6 manual_docs sync | Task 5 steps 2-5 |
| §3.7 project-context §6/§12 | Task 6 steps 1-2 |
| §3.8 sandbox checklist | Task 6 step 5 |
| §3.9 regression entry | step 12a пайплайна (оркестратор) — файл `regression/entries/2026-09-24-maestro-config-read-tool.md` (конвенция `<date>-<topic>.md`, M-A) |
| Тесты (13) | Task 1 |
| Acceptance criteria | Фазы финальной верификации |

## Project Context Changes (step 12a — оркестратор, без дополнительного HITL)

- `docs/project-context.md` §6 — буллет про `maestro_config` (текст — Task 6 step 1; **не** дублируется task'ом 12a — применяет Task 6, 12a сверяет).
- `docs/project-context.md` §12 — буллет (текст — Task 6 step 2).
- `docs/project-context.md` §3 — версия: **НЕ менять на ветке** (bump 4.9.0 — шаг 18 после merge).

## Regression Risk + Scenarios (step 12a — entry создаёт оркестратор)

**Уровень: MEDIUM** (новый публичный плагин-API + cross-layer: 11+ файлов доков/скиллов/команд, SECURITY.md, 7+ flows; код — 1 новый модуль + 1 точка регистрации).

Сценарии для entry:
1. **Primary-канал:** `maestro_config` в top-level primary возвращает конфиг/секцию; audit `maestro_config:read result=ok` в `.maestro/logs/`.
2. **Subagent-deny:** вызов из task-сессии (и из service-сессии) → deny + audit `maestro_config:access_denied reason=task_session|service_session`; в deny-ответе нет данных конфига (тест 7).
3. **Fail-closed:** `session.get`-ошибка / отсутствие `sessionID` → deny `session_unavailable` (тест 10).
4. **Tool-unavailable branch:** ветки `@maestro-memory`/`@maestro-memory-report` при отсутствии тула не читают `maestro.json` (bash-fallback отсутствует в тексте команд).
5. **Diff-merge:** `maestro-setup` diff по секциям сохраняет пользовательские `sanitizer_whitelist.patterns` (redact в ответе НЕТ — тест 1 deepEqual).
6. **Без маэстро-конфига:** плагин init без `maestro.json` — тул зарегистрирован, ответ `exists:false` (тесты 4, 12).

Entry: `regression/entries/2026-09-24-maestro-config-read-tool.md` (создаётся оркестратором в 12a; коммитится вместе со spec+plan).

## Self-check (выполнено при написании плана)

1. **Покрытие spec** — см. Spec Coverage Matrix: все §3.1-§3.9 + 13 тестов + acceptance покрыты; gaps: нет.
2. **Placeholder-скан** — «TBD/TODO/добавить тесты» отсутствуют; каждый step имеет точный текст/код; исключения явно помечены («точное текущее содержимое — по факту файла» в Task 5 step 3(iii) — строка одна, подменяется read'ом исполнителем; остальной контекст приведён).
3. **Согласованность типов/имён** — `maestro_config`, `makeMaestroConfigTool`, `resolveConfigFile`, `tool-shim.js`, `MAESTRO_CONFIG` — единые во всех tasks; audit-сообщения `maestro_config:read`/`maestro_config:access_denied` совпадают impl/tests.
4. **Файлы/цели** — все Modify-пути существуют (сверено по grep/read в этой сессии): `plugins/maestro-bootstrap/core.js`, `index.test.js`, `skills/{maestro,maestro-assistant,maestro-setup,maestro-design}/**`, `commands/maestro-{assistant,setup,design,memory,memory-report}.md`, `SECURITY.md`, `manual_docs/{reference/{config,commands,memory},explanation/agents-and-trust}.md`, `docs/project-context.md`, `docs/testing/maestro-sandbox-checklist.md`, `.opencode/opencode.json`; Create-пути: `plugins/maestro-bootstrap/tool-shim.js`.
5. **Public-shim тест** — тесты ходят через публичный `MaestroBootstrapPlugin({directory, client})` (factory) + `plugin.tool.maestro_config`; утилитары `makeMaestroConfigTool`/`resolveConfigFile` экспортируются (импорт в тесте — smoke на экспорт).
