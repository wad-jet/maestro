# Отдельный аудит-лог confidential-доступа и блокировок — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Выделить запросы к confidential-данным (кто — какой trusted-агент и модель — какие данные читал) и блокировки запрещённого доступа в **отдельный аудит-лог** (отдельный файл в `.maestro/logs/`), а не в общий bootstrap-лог, **без дублирования**: security-события живут только в audit-логе, bootstrap-лог — только observability. Учесть аудит-лог в отчёте `maestro-feedback-report`. Сейчас: (а) успешные чтения confidential (allow) вообще не логируются; (б) `confidential.blocked` и `access_policy.blocked` пишутся в общий `maestro-bootstrap-<date>.log`; (в) имя агента/модели не фиксируется (плагин знает только `sessionID`); (г) `maestro-feedback-report` читает только bootstrap-лог и не видит `confidential.access`.

**Architecture:** В `core.js` добавить второй логгер с отдельной точкой записи (расширить `makeLogger` опциями `filePrefix`, `logDirEnv`, `filterEnv`/независимостью от bootstrap-маски), резолвить имя агента из сообщений сессии и возвращать его из `resolveIsTrustedSubagent` (объект `{ trusted, agent }` вместо `boolean`), логировать и allow, и deny для confidential-доступа в отдельный аудит-файл `maestro-audit-<date>.log`. Security-события (`confidential.access`, `access_policy.blocked`) пишутся **только** в audit-лог (bootstrap-лог их не дублирует; `confidential.blocked` убирается). **Аудит-лог НЕ фильтруется** `MAESTRO_BOOTSTRAP_LOG_MASK`/`LOG_LEVEL` — пишется всегда (security-фактура). В `tool.execute.before` — записи allow/deny. В записи — только `basename` пути (SEC-5), без содержимого confidential-данных; сбой записи аудита логируется в `console.error` (не ломая сессию). В `maestro-feedback-report` — агрегировать аудит-лог **без фильтра по единичному primary sessionID** (confidential-события живут в child-сессиях субагентов), по диапазону времени отчёта.

**Tech Stack:** Node.js (ESM, `node:test`), OpenCode plugin (`tool.execute.before`).

**Спека-источник:** требование пользователя: «Отдельный лог запросов к confidential данным, кто (какой trusted агент и модель) какие данные читал, а также блокировки запрещённого доступа».

---

## Файлы

- `plugins/maestro-bootstrap/core.js` — расширить `makeLogger` (`filePrefix`), аудит-логгер, `resolveIsTrustedSubagent` → `{ trusted, agent }`, логи allow/deny в `tool.execute.before`.
- `plugins/maestro-bootstrap/index.test.js` — тесты (TDD) + helper чтения аудит-лога.
- `plugins/maestro-bootstrap/README.md` — раздел «Аудит-лог», env `MAESTRO_AUDIT_LOG_DIR`.
- `manual_docs/reference/config.md` — секция confidential: отдельный аудит-лог.
- `manual_docs/overview/changelog.md` — запись об аудит-логе.
- `skills/maestro-feedback-report/SKILL.md` — Шаг 3 и секция «Безопасность»: читать аудит-лог (всесессионная агрегация).
- `.opencode/skills/maestro-feedback-report/SKILL.md` — **app-repo post-step** (в этом authoring-репо каталог `.opencode/skills/` отсутствует; синхронизация выполняется при развёртывании в app-репозиторий).

---

### Task 1: Аудит-логгер — расширить `makeLogger` опцией `filePrefix`

**Files:**
- Modify: `plugins/maestro-bootstrap/core.js`
- Test: `plugins/maestro-bootstrap/index.test.js`

- [ ] **Step 1: Write the failing test**

Добавь импорт в строку 6 теста (если ещё нет) и новый `describe` в конец файла:

```js
describe("maestro-bootstrap audit logger", () => {
  it("writes to a separate file when filePrefix set", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fab-audit-logger-"));
    try {
      const log = makeLogger(dir, { filePrefix: "maestro-audit", filterEnv: null });
      log.info("confidential.access", { action: "allow" });
      const auditFiles = fs.readdirSync(path.join(dir, ".maestro/logs")).filter((f) => f.includes("maestro-audit"));
      assert.equal(auditFiles.length, 1, "audit file created");
      const entries = readLogs(dir, "maestro-audit");
      const e = entries.find((x) => x.msg === "confidential.access");
      assert.ok(e, "audit entry exists");
      assert.equal(e.action, "allow");
      // общий bootstrap-лог НЕ содержит этой записи
      const bootstrap = readLogs(dir, "maestro-bootstrap");
      assert.equal(bootstrap.find((x) => x.msg === "confidential.access"), undefined);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("audit logger is NOT suppressed by MAESTRO_BOOTSTRAP_LOG_MASK/LOG_LEVEL (security invariant)", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fab-audit-filter-"));
    const savedMask = process.env.MAESTRO_BOOTSTRAP_LOG_MASK;
    const savedLevel = process.env.MAESTRO_BOOTSTRAP_LOG_LEVEL;
    try {
      process.env.MAESTRO_BOOTSTRAP_LOG_MASK = "off";     // выключить bootstrap-логирование
      process.env.MAESTRO_BOOTSTRAP_LOG_LEVEL = "error";
      const log = makeLogger(dir, { filePrefix: "maestro-audit", filterEnv: null });
      log.warn("confidential.access", { action: "deny" });
      const e = readLogs(dir, "maestro-audit").find((x) => x.msg === "confidential.access");
      assert.ok(e, "audit entry must be written even when bootstrap mask is off");
    } finally {
      if (savedMask === undefined) delete process.env.MAESTRO_BOOTSTRAP_LOG_MASK;
      else process.env.MAESTRO_BOOTSTRAP_LOG_MASK = savedMask;
      if (savedLevel === undefined) delete process.env.MAESTRO_BOOTSTRAP_LOG_LEVEL;
      else process.env.MAESTRO_BOOTSTRAP_LOG_LEVEL = savedLevel;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test plugins/maestro-bootstrap/index.test.js`
Expected: FAIL — `readLogs` не умеет фильтровать по префиксу / `makeLogger` не принимает `filePrefix`/`filterEnv`.

- [ ] **Step 3: Update `readLogs` helper**

В тесте обнови `readLogs` (строки 8-19) — принимать опциональный префикс файла:

```js
function readLogs(dir, filePrefix = "maestro-bootstrap") {
  const logDir = path.join(dir, ".maestro/logs");
  const files = fs.existsSync(logDir) ? fs.readdirSync(logDir) : [];
  const out = [];
  for (const f of files) {
    if (!f.endsWith(".log") || !f.includes(filePrefix)) continue;
    for (const line of fs.readFileSync(path.join(logDir, f), "utf8").split("\n")) {
      if (line.trim()) out.push(JSON.parse(line));
    }
  }
  return out;
}
```

- [ ] **Step 4: Implement `makeLogger` extension + filter-independence for audit**

В `core.js` измени сигнатуру `makeLogger` (строка 654). **Критично:** аудит-логгер НЕ должен подчиняться `MAESTRO_BOOTSTRAP_LOG_MASK`/`LOG_LEVEL`. Добавь опцию `filterEnv: null | string` — если `null` (аудит), маска/порог bootstrap игнорируются (все уровни включены); если строка (bootstrap, дефолт `"MAESTRO_BOOTSTRAP"`), читает обычные env:

```js
export function makeLogger(directory, {
  filePrefix = "maestro-bootstrap",
  logDirEnv = "MAESTRO_BOOTSTRAP_LOG_DIR",
  filterEnv = "MAESTRO_BOOTSTRAP",
} = {}) {
  const logDir = process.env[logDirEnv] || path.join(directory, ".maestro/logs");

  // Маска/порог: для аудита (filterEnv === null) фильтрация отключена — пишется всё.
  // Для bootstrap-лога читаются MAESTRO_BOOTSTRAP_LOG_LEVEL / MAESTRO_BOOTSTRAP_LOG_MASK.
  let enabled;
  let threshold = 10;
  let levelEnv = "debug";
  if (filterEnv !== null) {
    const levelKey = `${filterEnv}_LOG_LEVEL`;
    const maskKey = `${filterEnv}_LOG_MASK`;
    levelEnv = process.env[levelKey] || "info";
    threshold = LOG_LEVELS[levelEnv] ?? 10;
    const maskEnv = process.env[maskKey];
    enabled = new Set(
      maskEnv
        ? maskEnv.split(",").map((s) => s.trim()).filter(Boolean).filter((l) => l in LOG_LEVELS)
        : Object.keys(LOG_LEVELS).filter((l) => LOG_LEVELS[l] >= threshold),
    );
  } else {
    enabled = new Set(Object.keys(LOG_LEVELS)); // аудит: все уровни всегда
  }

  try {
    fs.mkdirSync(logDir, { recursive: true });
  } catch {
    /* logging must never break the session */
  }

  const logFileFor = (date) =>
    path.join(logDir, `${filePrefix}-${date}.log`);

  const write = (level, msg, extra) => {
    if (!enabled.has(level)) return;
    if (threshold !== null && LOG_LEVELS[level] < threshold) return;
    const now = new Date();
    const date = now.toISOString().slice(0, 10);
    const entry = JSON.stringify({ ts: now.toISOString(), level, msg, ...extra });
    try {
      fs.appendFileSync(logFileFor(date), entry + "\n");
    } catch (err) {
      // Аудит-запись не должна теряться молча: сбой пишем в console.error (не ломая сессию).
      if (filePrefix === "maestro-audit") {
        console.error(`[maestro-bootstrap] audit write failed:`, err instanceof Error ? err.message : err);
      }
    }
  };

  return {
    logDir,
    filePrefix,
    level: levelEnv,
    mask: filterEnv === null ? "all" : [...enabled].join(","),
    debug: (msg, extra) => write("debug", msg, extra),
    info: (msg, extra) => write("info", msg, extra),
    warn: (msg, extra) => write("warn", msg, extra),
    error: (msg, extra) => write("error", msg, extra),
  };
}
```

> **Инвариант (Крит.1):** аудит-лог всегда активен — `MAESTRO_BOOTSTRAP_LOG_MASK=off` и `MAESTRO_BOOTSTRAP_LOG_LEVEL` его НЕ отключают. Bootstrap-лог — как раньше.

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test plugins/maestro-bootstrap/index.test.js`
Expected: PASS (существующие bootstrap-тесты — обратная совместимость `filterEnv` по умолчанию `"MAESTRO_BOOTSTRAP"`).

- [ ] **Step 6: Commit**

```bash
git add plugins/maestro-bootstrap/core.js plugins/maestro-bootstrap/index.test.js
git commit -m "feat(bootstrap): audit logger with separate file prefix; audit filter-independent of bootstrap mask"
```

---

### Task 2: `resolveIsTrustedSubagent` возвращает `{ trusted, agent }`

**Files:**
- Modify: `plugins/maestro-bootstrap/core.js`
- Test: `plugins/maestro-bootstrap/index.test.js`

- [ ] **Step 1: Write the failing test**

Обнови существующий `describe "maestro-bootstrap confidential subagent identity"` (строки ~965-1031) — каждое `assert.equal(await resolveIsTrustedSubagent(...), <bool>)` замени на проверку поля `trusted` и `agent`:

```js
it("returns { trusted:true, agent } for trusted subagent by mode", async () => {
  const client = mockClient({
    session: { id: "child", parentID: "root" },
    messages: [{ info: { role: "assistant", mode: "design" }, parts: [] }],
  });
  const res = await resolveIsTrustedSubagent(client, new Set(["design"]), "child");
  assert.equal(res.trusted, true);
  assert.equal(res.agent, "design");
});
```

Аналогично для untrusted (agent: "haiku" → `{ trusted:false, agent:"haiku" }`), root (no parentID → `{ trusted:false, agent:undefined }`), no client (fail-closed → `{ trusted:false }`).

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test plugins/maestro-bootstrap/index.test.js`
Expected: FAIL — возвращается `boolean`, `res.trusted` undefined.

- [ ] **Step 3: Implement**

В `core.js` измени `resolveIsTrustedSubagent` (строки 493-511):

```js
export async function resolveIsTrustedSubagent(client, trustedAgents, sessionID) {
  if (!client?.session?.get) return { trusted: false, agent: undefined };
  let session;
  try {
    const resp = await client.session.get({ path: { id: sessionID } });
    session = resp?.data ?? resp;
  } catch {
    return { trusted: false, agent: undefined };
  }
  if (!session?.parentID) return { trusted: false, agent: undefined }; // root/primary
  try {
    const mresp = await client.session.messages({ path: { id: sessionID } });
    const messages = mresp?.data ?? mresp;
    const agent = agentNameFromMessages(Array.isArray(messages) ? messages : []);
    return { trusted: Boolean(agent && trustedAgents.has(agent)), agent };
  } catch {
    return { trusted: false, agent: undefined };
  }
}
```

- [ ] **Step 4: Update call-site cache**

В `MaestroBootstrapPlugin` (строка 837-839) обнови кэш, чтобы хранить объект `{ trusted, agent }` (для Task 3):

```js
let trustInfo = sessionTrustCache.get(input.sessionID);
if (trustInfo === undefined) {
  trustInfo = await resolveIsTrustedSubagent(client, trustedAgents, input.sessionID);
  sessionTrustCache.set(input.sessionID, trustInfo);
}
const action = resolveConfidentialAction(confidential, input.tool, trustInfo.trusted);
```

`resolveConfidentialAction` продолжает принимать `boolean` — передаём `trustInfo.trusted`. Сигнатуру `resolveConfidentialAction` не меняем (обратная совместимость для тестов).

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test plugins/maestro-bootstrap/index.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add plugins/maestro-bootstrap/core.js plugins/maestro-bootstrap/index.test.js
git commit -m "feat(bootstrap): resolve trusted subagent name alongside status"
```

---

### Task 3: Логировать confidential-доступ (allow и deny) в аудит-лог

**Files:**
- Modify: `plugins/maestro-bootstrap/core.js`
- Test: `plugins/maestro-bootstrap/index.test.js`

- [ ] **Step 1: Write the failing test**

Добавь `describe "maestro-bootstrap confidential audit log"` (в конец файла). Клиент — как в блоке `confidential enforcement` (строки 1053-1080), с trusted (`mode: "design"`) и untrusted (`mode: "haiku"`) сабагентами:

```js
describe("maestro-bootstrap confidential audit log", () => {
  let dir, hooks, savedLogEnv;
  const LOG_ENV = ["MAESTRO_BOOTSTRAP_LOG_MASK", "MAESTRO_BOOTSTRAP_LOG_LEVEL", "MAESTRO_BOOTSTRAP_LOG_DIR", "MAESTRO_AUDIT_LOG_DIR"];

  // makeClient/rootSessions — как в существующем блоке enforcement
  before(async () => {
    savedLogEnv = {};
    for (const k of LOG_ENV) { savedLogEnv[k] = process.env[k]; delete process.env[k]; }
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "fab-audit-"));
    fs.writeFileSync(path.join(dir, "maestro.json"), JSON.stringify({
      trust: { design: true },
      confidential: { paths: ["docs/confidential/**"], trusted: { read: "allow", write: "deny", edit: "deny" } },
    }));
    hooks = await MaestroBootstrapPlugin({ directory: dir, client: makeClient(rootSessions) });
  });

  after(() => { /* cleanup + env restore */ });

  it("logs allow when trusted subagent reads confidential", async () => {
    const out = { args: { filePath: "docs/confidential/secrets.md" } };
    await hooks["tool.execute.before"]({ tool: "read", sessionID: "childTrusted", callID: "c-a1" }, out);
    const e = readLogs(dir, "maestro-audit").find((x) => x.callID === "c-a1");
    assert.ok(e, "audit entry exists");
    assert.equal(e.msg, "confidential.access");
    assert.equal(e.action, "allow");
    assert.equal(e.agent, "design");
    assert.equal(e.tool, "read");
    assert.equal(e.target, "secrets.md"); // basename (SEC-5)
  });

  it("logs deny for untrusted subagent read of confidential", async () => {
    const out = { args: { filePath: "docs/confidential/secrets.md" } };
    await assert.rejects(
      hooks["tool.execute.before"]({ tool: "read", sessionID: "childUntrusted", callID: "c-a2" }, out),
      /confidential:deny/,
    );
    const e = readLogs(dir, "maestro-audit").find((x) => x.callID === "c-a2");
    assert.ok(e, "audit deny entry exists");
    assert.equal(e.action, "deny");
    assert.equal(e.agent, "haiku");
  });

  it("does not duplicate security events in bootstrap log", async () => {
    const out = { args: { filePath: "docs/confidential/secrets.md" } };
    await hooks["tool.execute.before"]({ tool: "read", sessionID: "childTrusted", callID: "c-a4" }, out);
    const bootstrap = readLogs(dir, "maestro-bootstrap");
    assert.equal(
      bootstrap.find((x) => x.msg === "confidential.access" || x.msg === "confidential.blocked" || x.msg === "access_policy.blocked"),
      undefined,
      "security events must NOT appear in bootstrap log",
    );
  });

  it("does not log non-confidential paths to audit log", async () => {
    const before = readLogs(dir, "maestro-audit").length;
    const out = { args: { filePath: "src/app.ts" } };
    await hooks["tool.execute.before"]({ tool: "read", sessionID: "childTrusted", callID: "c-a3" }, out);
    const after = readLogs(dir, "maestro-audit");
    assert.equal(after.length, before, "no audit entry for non-confidential read");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test plugins/maestro-bootstrap/index.test.js`
Expected: FAIL — allow-чтение не логируется; агент не резолвится.

- [ ] **Step 3: Implement audit logger + allow/deny logging**

В `MaestroBootstrapPlugin` (строка ~764, рядом с `const log = makeLogger(root)`):

```js
const log = makeLogger(root);
const auditLog = makeLogger(root, { filePrefix: "maestro-audit", logDirEnv: "MAESTRO_AUDIT_LOG_DIR", filterEnv: null });
```

В confidential-блоке (строки ~831-857) замени. **Security-события пишутся ТОЛЬКО в audit-лог** (без дублирования в bootstrap): allow при `action === "allow"`, deny при блокировке. `confidential.blocked` из bootstrap-лога **убираем** — заменяется единым `confidential.access` в audit-логе:

```js
if (confidential.exists && CONF_TOOLS.has(input.tool)) {
  const target = filePathOf(input.tool, output?.args);
  if (target && !isPluginMetaFile(root, target) && isConfidentialTarget(root, confidential.paths, target)) {
    wasConfidential = true;
    let trustInfo = sessionTrustCache.get(input.sessionID);
    if (trustInfo === undefined) {
      trustInfo = await resolveIsTrustedSubagent(client, trustedAgents, input.sessionID);
      sessionTrustCache.set(input.sessionID, trustInfo);
    }
    const action = resolveConfidentialAction(confidential, input.tool, trustInfo.trusted);
    const base = {
      sessionID: input.sessionID,
      callID: input.callID,
      tool: input.tool,
      action,
      agent: trustInfo.agent,          // имя trusted-агента (или undefined для root/untrusted-if-not-resolved)
      target: path.basename(target),   // SEC-5: только basename
    };
    if (action === "allow") {
      auditLog.info("confidential.access", base);
    } else {
      auditLog.warn("confidential.access", base);
      const err = new Error(
        `[confidential:deny] Доступ к "${target}" запрещён. ` +
          `Доступ к confidential-путям разрешён только trusted-субагентам.`,
      );
      err.confidential = true;
      throw err;
    }
  }
}
```

- [ ] **Step 4: Route `access_policy.blocked` ONLY into audit log (remove from bootstrap)**

В access_policy-блоке (строки ~874-880) **замени** запись в bootstrap-лог на запись только в аудит-лог (убрать дублирование):

```js
auditLog.warn("access_policy.blocked", {
  sessionID: input.sessionID,
  callID: input.callID,
  tool: input.tool,
  action,
  target: path.basename(target),
});
```

> **Принцип (без дублей):** bootstrap-лог `maestro-bootstrap-*.log` — только observability (`task`, `session.error`, `sanitizer.*`). Security-события (`confidential.access`, `access_policy.blocked`) — **только** в audit-лог `maestro-audit-*.log`. Ни одно security-событие не пишется в оба лога.

- [ ] **Step 5: Update existing tests that expect security events in bootstrap log**

В `index.test.js` найди существующие проверки, которые читают `confidential.blocked`/`access_policy.blocked` из bootstrap-лога, и переведи их на audit-лог (или убери, если они дублируются новыми тестами аудита):

- Блок `access policy hook` (строки ~680-702) — проверяет только `assert.rejects(...)` на `[access-policy:ask]`/`[access-policy:deny]`, не проверяет лог — **без изменений** (сам факт блокировки не меняется).
- Блок `confidential enforcement` (строки ~1049-1171) — `assert.rejects(...)` на `confidential:deny`, не проверяет лог — **без изменений**.
- Если где-то есть `readLogs(dir).find((e) => e.msg === "access_policy.blocked" || e.msg === "confidential.blocked")` — обнови на чтение audit-лога `readLogs(dir, "maestro-audit")` и `msg === "confidential.access"`.

- [ ] **Step 6: Run test to verify it passes**

Run: `node --test plugins/maestro-bootstrap/index.test.js`
Expected: PASS (все существующие + новые).

- [ ] **Step 7: Commit**

```bash
git add plugins/maestro-bootstrap/core.js plugins/maestro-bootstrap/index.test.js
git commit -m "feat(bootstrap): audit log for confidential access (allow/deny) and access policy blocks; security events only in audit log"
```

---

### Task 4: Docs — README и manual_docs (формат/структура всех логов)

**Files:**
- Modify: `plugins/maestro-bootstrap/README.md`
- Modify: `manual_docs/reference/config.md`
- Modify: `manual_docs/overview/changelog.md`

- [ ] **Step 1: Update README**

В разделе «Аудит-лог» (строки 112-118) опиши отдельный файл `maestro-audit-<date>.log`, события `confidential.access` (allow/deny), `access_policy.blocked` и полную структуру записи (поля `ts`, `level`, `msg`, `sessionID`, `callID`, `tool`, `action`, `agent`, `target` — только basename, SEC-5). В таблице env (строки 201-208) добавь `MAESTRO_AUDIT_LOG_DIR`. Уточни: security-события (`confidential.access`, `access_policy.blocked`) живут **только** в audit-логе; bootstrap-лог их не дублирует. В списке «Что логируется» (строки 188-198) убери `access_policy.blocked` и добавь `confidential.access` с пометкой «только в audit-лог».

- [ ] **Step 2: Update config.md — общий раздел «Логи плагина» (формат/структура всех записей)**

В `manual_docs/reference/config.md` добавь подраздел «Логи плагина» (после секции `confidential`), описывающий **формат и структуру записей для всех** логов плагина, а не только аудит-лога:

- **Общий JSONL-формат строки** и общие поля (`ts`, `level`, `msg`, `sessionID`, `callID`, `tool`, плюс опциональные поля по типу события).
- **Файлы и каталоги:** `maestro-bootstrap-<дата>.log` (observability) и `maestro-audit-<дата>.log` (security-фактура), оба в `.maestro/logs/` (gitignored). Каталог bootstrap-лога — `MAESTRO_BOOTSTRAP_LOG_DIR`, аудит-лога — `MAESTRO_AUDIT_LOG_DIR`.

**Таблица событий bootstrap-лога** (msg → поля → уровень):

| `msg` | Уровень | Доп. поля |
|---|---|---|
| `plugin initialized` | info | `version`, `logDir`, `level`, `mask` |
| `tool.execute.before` | info | `tool` (=task) |
| `tool.execute.after` | info | `tool`, `durationMs`, `title` (санитизирован, SEC-4) |
| `tool.execute.after.empty_result` | warn | `tool` |
| `session.error` | warn | `errorType`, `errorMessage` |
| `session.status.retry` | warn | `attempt`, `message` |
| `sanitizer.redacted` | warn | `tool`, `agent`, `redacted` |
| `sanitizer.all_rules_disabled` | warn | `tool`, `agent` |
| `sanitizer.unsafe_patterns` | warn | `count` |

> Bootstrap-лог НЕ содержит security-событий доступа (`confidential.access`,
> `access_policy.blocked`) — они только в audit-логе (без дублей).

**Таблица событий аудит-лога** (единственное место для security-фактуры):

| `msg` | Уровень | Доп. поля |
|---|---|---|
| `confidential.access` | info (allow) / warn (deny) | `tool`, `action`, `agent`, `target` (basename) |
| `access_policy.blocked` | warn | `tool`, `action`, `target` (basename) |

**Аудит-лог пишется всегда** (не подчиняется `MAESTRO_BOOTSTRAP_LOG_MASK`/`LOG_LEVEL`). Bootstrap-лог подчиняется маске/порогу. Уровни: `debug`/`info`/`warn`/`error`.

- [ ] **Step 3: Update changelog.md**

Добавь запись в `manual_docs/overview/changelog.md` об отдельном аудит-логе confidential-доступа и блокировок и о документации формата/структуры всех логов в `manual_docs/reference/config.md`.

- [ ] **Step 4: Commit**

```bash
git add plugins/maestro-bootstrap/README.md manual_docs/reference/config.md manual_docs/overview/changelog.md
git commit -m "docs: log record format/structure for all plugin logs + separate audit log"
```

---

### Task 5: Интеграция аудит-лога в `maestro-feedback-report`

**Files:**
- Modify: `skills/maestro-feedback-report/SKILL.md`
- `.opencode/skills/maestro-feedback-report/SKILL.md` — **app-repo post-step** (в authoring-репо каталога `.opencode/skills/` нет; синхронизация при развёртывании).

> **Крит.2:** `confidential.access` логируется с `input.sessionID` **дочерней (child) сессии** субагента (инвариант `resolveIsTrustedSubagent` требует `parentID`), а не primary-сессии. Скилл же фильтрует bootstrap-лог по `sessionID == текущая (primary)`. Фильтрация аудит-лога по primary sessionID **пропустила бы все** confidential-события. Поэтому аудит-лог агрегируется **по диапазону времени отчёта** (все сессии), отдельно от bootstrap-лога.

- [ ] **Step 1: Update Шаг 3 (чтение логов) в SKILL.md**

В `skills/maestro-feedback-report/SKILL.md`, в секции «Шаг 3. Дополнить данными из логов плагина» (строки 73-92), **явно раздели** два источника:

1. **Bootstrap-лог** (как раньше) — фильтр по `sessionID == текущая сессия` (primary): task-диспатчи, session.error, retry, empty_result, sanitizer.redacted.
2. **Аудит-лог** `maestro-audit-*.log` — **НЕ фильтровать по primary sessionID** (confidential-события живут в child-сессиях). Агрегировать записи за диапазон дат отчёта (текущий день / период отчёта), группируя по `sessionID`/`agent`:

```markdown
Проверь `.maestro/logs/maestro-audit-*.log` (JSONL) на записи за период отчёта.
В отличие от bootstrap-лога, аудит-лог фильтруется **по диапазону дат**, а НЕ по
`sessionID` primary-сессии: confidential-события логируются в дочерних (child)
сессиях субагентов и не привязаны к primary. Агрегируй:

- **`confidential.access`** — доступ к confidential-путям: количество `allow` и
  `deny` отдельно, имена trusted-агентов (**только имена**, без путей/данных).
```

- [ ] **Step 2: Update секцию «Безопасность»**

В секции «### Санитарные события из логов» (строки 137-140) добавь строку про `confidential.access`:

```markdown
- confidential.access: <кол-во allow / кол-во deny> + имена trusted-агентов (только имена)
```

Обнови условие «Событий безопасности не обнаружено» (строки 145-146): теперь также учитывается `confidential.access` — если allow=0 И deny=0 И sanitizer.redacted=0 И access_policy.blocked=0 → «Событий безопасности не обнаружено».

- [ ] **Step 3: App-repo sync (post-step, вне этого репо)**

Каталог `.opencode/skills/` в этом authoring-репозитории **отсутствует** (проверено). Обновлённый `skills/maestro-feedback-report/SKILL.md` синхронизируется в `.opencode/skills/maestro-feedback-report/SKILL.md` при развёртывании в app-репозиторий (sync rule). В рамках этого плана шаг **пометить как TODO-заметку**, а не выполнять копирование здесь.

- [ ] **Step 4: Commit**

```bash
git add skills/maestro-feedback-report/SKILL.md
git commit -m "feat(feedback-report): aggregate confidential.access audit log by date range across sessions"
```

---

### Task 6: Финальная верификация

**Files:** (нет изменений)

- [ ] **Step 1: Run full test suite**

Run: `node --test plugins/maestro-bootstrap/index.test.js`
Expected: все тесты зелёные.

- [ ] **Step 2: Confirm git status**

Run: `git status`
Expected: только запланированные файлы.

---

## Self-Review

**Отдельный файл аудит-лога:** → Task 1 (`filePrefix`), Task 3 (аудит-логгер в `MaestroBootstrapPlugin`). Покрыто тестами.
**Кто (trusted-агент) какие данные читал:** → Task 2 (`resolveIsTrustedSubagent` → `{ trusted, agent }`), Task 3 (запись `agent` + `target` basename). Покрыто тестами.
**Блокировки запрещённого доступа:** → Task 3 (`confidential.access` deny + `access_policy.blocked` в аудит-лог). Покрыто.
**Allow и deny (полный аудит):** → Task 3 — обе ветки пишутся. Покрыто.
**Без дублирования логов:** → Task 3 — security-события (`confidential.access`, `access_policy.blocked`) пишутся **только** в audit-лог; `confidential.blocked` удалён из bootstrap-лога; `access_policy.blocked` больше не дублируется. Покрыто тестом «does not duplicate security events in bootstrap log».
**SEC-5 (только basename, без содержимого):** → Task 3 — `path.basename(target)`. Покрыто.
**Аудит-лог пишется всегда (Крит.1):** → Task 1 — `makeLogger` опция `filterEnv: null` (аудит) отключает применение `MAESTRO_BOOTSTRAP_LOG_MASK`/`LOG_LEVEL`; тест «audit logger is NOT suppressed by mask/level». Покрыто.
**Сбой аудит-записи не теряется молча (Замечание 7):** → Task 1 — `console.error` при failed write для `filePrefix === "maestro-audit"` (сессию не ломает).
**Интеграция с `maestro-feedback-report` (Крит.2):** → Task 5 — аудит-лог агрегируется **по диапазону дат, а не по primary sessionID** (confidential-события в child-сессиях). Покрыто ручной проверкой (SKILL.md — инструкция оркестратору).
**Runtime-копия `.opencode/skills/` (Крит.3):** → Task 5 — в authoring-репо каталога нет; синхронизация помечена как app-repo post-step, копирование здесь НЕ выполняется.
**Документация формата/структуры записей:** → Task 4 — подраздел «Логи плагина» в `manual_docs/reference/config.md` с форматом/структурой **всех** записей (bootstrap + audit: общие поля, таблицы событий обоих логов, env) + README. Покрыто.
**Модель:** → имя trusted-агента резолвится; конкретная модель (если доступна в конфиге агента) в текущем плагине не извлекается. При необходимости — отдельная задача (agent model mapping). Зафиксировано как известное ограничение.
**Placeholder scan:** нет TBD/TODO; код полный.
**Type consistency:** `makeLogger(dir, { filePrefix, logDirEnv, filterEnv })` (дефолт `filterEnv: "MAESTRO_BOOTSTRAP"` — обратная совместимость bootstrap-лога; аудит — `filterEnv: null`); `resolveIsTrustedSubagent` → `{ trusted, agent }`; `resolveConfidentialAction` — без изменений (принимает boolean).