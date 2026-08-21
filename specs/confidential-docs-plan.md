# Защищённая папка `docs/confidential` — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Закрыть `docs/confidential/**` (и иные конфигурируемые пути) для чтения и записи от всех, кроме trusted-субагентов, через расширение плагина `maestro-bootstrap`.

**Architecture:** Плагин в `tool.execute.before` перехватывает `read`/`write`/`edit` по confidential-путям. Идентичность отправителя определяется через `client.session.get(sessionID)` (наличие `parentID` отделяет субагента от primary) + чтение `session.messages` для имени агента (части `SubtaskPart.agent` / `AgentPart.name` / поле `info.agent`/`info.mode`). Не-trusted → жёсткий `deny`; trusted-субагент → действие по `confidential.trusted.<tool>` (дефолт: read=allow, write=deny, edit=deny). Результат резолва кэшируется в `makeBoundedMap`. Confidential имеет приоритет над `access_policy`.

**Tech Stack:** Node.js (ESM, built-in `node:test`), OpenCode plugin API (`tool.execute.before`), OpenCode SDK client (`session.get`, `session.messages`). Пакет `maestro-bootstrap`.

---

## Файловая структура

- `plugins/maestro-bootstrap/core.js` — добавить helpers (`loadConfidentialConfig`, `resolveConfidentialAction`, `resolveIsTrustedSubagent`, `filePathOf` для write/edit) + логику в `tool.execute.before`.
- `plugins/maestro-bootstrap/index.js` — пробросить `client` из входного параметра opencode-плагина в `MaestroBootstrapPlugin`.
- `plugins/maestro-bootstrap/index.test.js` — тесты (TDD).
- `manual_docs/reference/config.md` — описание секции `confidential`.
- `manual_docs/explanation/agents-and-trust.md` — модель доступа к confidential + эшелонирование (риск bash/glob/grep).
- `manual_docs/overview/changelog.md` — запись изменения.
- `plugins/maestro-bootstrap/package.json` — bump версии до `1.1.0`.
- `plugins/maestro-bootstrap/README.md` — краткое описание новой секции (опционально, по наличию раздела file access control).
- `skills/maestro-init/SKILL.md` — создание `docs/confidential/` + секция `confidential` в генерируемом `maestro.json`.

---

### Task 1: Helper `loadConfidentialConfig`

**Files:**
- Modify: `plugins/maestro-bootstrap/core.js`
- Test: `plugins/maestro-bootstrap/index.test.js`

- [ ] **Step 1: Write the failing test**

Добавь в конец `index.test.js` новый `describe` блок (после существующего, перед закрытием файла). Импорт `loadConfidentialConfig` нужно добавить в строку 6 (список импортов из `core.js`). Отдельно добавим в Task 2 импорт `resolveConfidentialAction`; здесь — только `loadConfidentialConfig`.

```js
describe("maestro-bootstrap confidential config", () => {
  it("returns defaults when section missing", () => {
    const c = loadConfidentialConfig({});
    assert.equal(c.exists, false);
    assert.deepEqual(c.paths, ["docs/confidential/**"]);
    assert.deepEqual(c.trusted, { read: "allow", write: "deny", edit: "deny" });
  });

  it("returns empty trusted when section present but empty", () => {
    const c = loadConfidentialConfig({ confidential: {} });
    assert.equal(c.exists, true);
    assert.deepEqual(c.paths, ["docs/confidential/**"]);
    // trusted: read=allow, write=deny, edit=deny (дефолт не пишется, вычисляется)
  });

  it("parses paths and trusted map", () => {
    const c = loadConfidentialConfig({
      confidential: {
        paths: ["docs/confidential/**", "secrets/internals/**"],
        trusted: { read: "deny", write: "allow", edit: "allow" },
      },
    });
    assert.equal(c.exists, true);
    assert.deepEqual(c.paths, ["docs/confidential/**", "secrets/internals/**"]);
    assert.deepEqual(c.trusted, { read: "deny", write: "allow", edit: "allow" });
  });

  it("clamps invalid trusted values to deny", () => {
    const c = loadConfidentialConfig({
      confidential: { trusted: { read: "banana", write: "allow", edit: "allow" } },
    });
    assert.equal(c.trusted.read, "deny");
    assert.equal(c.trusted.write, "allow");
    assert.equal(c.trusted.edit, "allow");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test plugins/maestro-bootstrap/index.test.js`
Expected: FAIL — `loadConfidentialConfig is not a function` (или `ReferenceError`).

- [ ] **Step 3: Implement `loadConfidentialConfig`**

В `core.js`, рядом с `loadAccessPolicy` (после строки ~410), добавь:

```js
// --- Confidential access control ------------------------------------------

// Допустимые значения политики trusted для инструмента.
const CONF_TRUSTED_ACTIONS = new Set(["allow", "deny"]);

/**
 * Extract the confidential access policy from a parsed maestro config.
 * Секция `confidential` — строже access_policy и применяется к read/write/edit
 * по путям из `paths`. Для untrusted/primary — всегда deny (инвариант, не
 * конфигурируется). Для trusted-субагентов действие задаётся мапой `trusted`.
 * @param {object} config  Parsed `maestro.json`.
 * @returns {{ exists: boolean, paths: string[], trusted: {read:string, write:string, edit:string} }}
 */
export function loadConfidentialConfig(config) {
  const section = config?.confidential;
  const defaults = {
    paths: ["docs/confidential/**"],
    trusted: { read: "allow", write: "deny", edit: "deny" },
  };
  if (!section || typeof section !== "object") {
    return { exists: false, ...defaults };
  }
  const paths = Array.isArray(section.paths) && section.paths.length > 0
    ? section.paths
    : defaults.paths;
  const trusted = {};
  for (const tool of ["read", "write", "edit"]) {
    const val = section.trusted?.[tool];
    trusted[tool] = CONF_TRUSTED_ACTIONS.has(val) ? val : defaults.trusted[tool];
  }
  return { exists: true, paths, trusted };
}

/**
 * Resolve the confidential action for a tool call.
 * Инвариант: не trusted-субагент → всегда deny. Trusted → по `conf.trusted[tool]`.
 * @param {{ trusted: {read:string,write:string,edit:string} }} conf  Loaded confidential config.
 * @param {string} tool  Tool name (read|write|edit).
 * @param {boolean} isTrustedSubagent  Whether the call originates from a trusted subagent.
 * @returns {"allow"|"deny"}
 */
export function resolveConfidentialAction(conf, tool, isTrustedSubagent) {
  if (!isTrustedSubagent) return "deny";
  return conf?.trusted?.[tool] === "allow" ? "allow" : "deny";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test plugins/maestro-bootstrap/index.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plugins/maestro-bootstrap/core.js plugins/maestro-bootstrap/index.test.js
git commit -m "feat(bootstrap): confidential config helpers (loadConfidentialConfig)"
```

---

### Task 2: Helper `resolveIsTrustedSubagent` (идентичность через client)

**Files:**
- Modify: `plugins/maestro-bootstrap/core.js`
- Test: `plugins/maestro-bootstrap/index.test.js`

- [ ] **Step 1: Write the failing test**

Добавь в тот же `describe` блок (или новый) тесты на `resolveIsTrustedSubagent`. Импорт функции добавь в строку 6.

```js
describe("maestro-bootstrap confidential subagent identity", () => {
  // Мок client с нужными методами.
  function mockClient({ session = {}, messages = [] } = {}) {
    return {
      session: {
        get: async ({ path }) => {
          if (session.id === "missing") throw new Error("not found");
          return { data: session };
        },
        messages: async () => ({ data: messages }),
      },
    };
  }

  it("denies when no client (fail-closed)", async () => {
    assert.equal(await resolveIsTrustedSubagent(undefined, new Set(["design"]), "s1"), false);
  });

  it("denies root/primary session (no parentID)", async () => {
    const client = mockClient({ session: { id: "root" } });
    assert.equal(await resolveIsTrustedSubagent(client, new Set(["design"]), "root"), false);
  });

  it("allows trusted subagent by AssistantMessage.mode", async () => {
    const client = mockClient({
      session: { id: "child", parentID: "root" },
      messages: [{ info: { role: "assistant", mode: "design" }, parts: [] }],
    });
    assert.equal(await resolveIsTrustedSubagent(client, new Set(["design"]), "child"), true);
  });

  it("denies untrusted subagent", async () => {
    const client = mockClient({
      session: { id: "child", parentID: "root" },
      messages: [{ info: { role: "assistant", mode: "haiku" }, parts: [] }],
    });
    assert.equal(await resolveIsTrustedSubagent(client, new Set(["design"]), "child"), false);
  });

  it("allows by UserMessage.agent", async () => {
    const client = mockClient({
      session: { id: "child", parentID: "root" },
      messages: [{ info: { role: "user", agent: "sanitizer" }, parts: [] }],
    });
    assert.equal(await resolveIsTrustedSubagent(client, new Set(["sanitizer"]), "child"), true);
  });

  it("allows by SubtaskPart.agent in parts", async () => {
    const client = mockClient({
      session: { id: "child", parentID: "root" },
      messages: [{ info: { role: "assistant" }, parts: [{ type: "subtask", agent: "design" }] }],
    });
    assert.equal(await resolveIsTrustedSubagent(client, new Set(["design"]), "child"), true);
  });

  it("denies when agent not resolvable", async () => {
    const client = mockClient({
      session: { id: "child", parentID: "root" },
      messages: [{ info: { role: "assistant" }, parts: [] }],
    });
    assert.equal(await resolveIsTrustedSubagent(client, new Set(["design"]), "child"), false);
  });

  it("denies on session lookup error (fail-closed)", async () => {
    const client = mockClient({ session: { id: "missing" } });
    assert.equal(await resolveIsTrustedSubagent(client, new Set(["design"]), "missing"), false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test plugins/maestro-bootstrap/index.test.js`
Expected: FAIL — `resolveIsTrustedSubagent is not defined`.

- [ ] **Step 3: Implement `resolveIsTrustedSubagent`**

В `core.js`, после `resolveConfidentialAction`, добавь:

```js
/**
 * Extract the agent name from a session's messages (defensive).
 * Возвращает первое найденное имя: AssistantMessage.mode / UserMessage.agent /
 * AgentPart.name / SubtaskPart.agent.
 * @param {Array} messages  Response from client.session.messages (array of {info, parts}).
 * @returns {string|undefined}
 */
function agentNameFromMessages(messages) {
  for (const m of messages ?? []) {
    const info = m?.info ?? {};
    if (typeof info.agent === "string" && info.agent) return info.agent;
    if (typeof info.mode === "string" && info.mode) return info.mode;
    for (const part of m?.parts ?? []) {
      if (part?.type === "agent" && typeof part.name === "string" && part.name) return part.name;
      if (part?.type === "subtask" && typeof part.agent === "string" && part.agent) return part.agent;
    }
  }
  return undefined;
}

/**
 * Determine whether a tool call originates from a trusted subagent.
 * Fail-closed: без client, без parentID (primary), не резолвится агент, ошибка
 * lookup — всё трактуется как untrusted → deny.
 * @param {object|undefined} client  OpenCode SDK client (from plugin closure).
 * @param {Set<string>} trustedAgents  Trusted subagent names.
 * @param {string} sessionID  Session that made the tool call.
 * @returns {Promise<boolean>}
 */
export async function resolveIsTrustedSubagent(client, trustedAgents, sessionID) {
  if (!client?.session?.get) return false;
  let session;
  try {
    const resp = await client.session.get({ path: { id: sessionID } });
    session = resp?.data ?? resp;
  } catch {
    return false;
  }
  if (!session?.parentID) return false; // root/primary
  try {
    const mresp = await client.session.messages({ path: { id: sessionID } });
    const messages = mresp?.data ?? mresp;
    const agent = agentNameFromMessages(Array.isArray(messages) ? messages : []);
    return Boolean(agent && trustedAgents.has(agent));
  } catch {
    return false;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test plugins/maestro-bootstrap/index.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plugins/maestro-bootstrap/core.js plugins/maestro-bootstrap/index.test.js
git commit -m "feat(bootstrap): resolveIsTrustedSubagent via client session lookup"
```

---

### Task 3: Extend `filePathOf` for `write`/`edit`

**Files:**
- Modify: `plugins/maestro-bootstrap/core.js`
- Test: `plugins/maestro-bootstrap/index.test.js`

- [ ] **Step 1: Write the failing test**

Добавь тесты в существующий `describe` для `filePathOf` (найди его в тестовом файле). Если такого блока нет — добавь новый в конец.

```js
describe("maestro-bootstrap filePathOf for confidential tools", () => {
  it("extracts filePath from read", () => {
    assert.equal(filePathOf("read", { filePath: "src/a.ts" }), "src/a.ts");
  });
  it("extracts filePath from write", () => {
    assert.equal(filePathOf("write", { filePath: "docs/confidential/x.md", content: "hi" }), "docs/confidential/x.md");
  });
  it("extracts filePath from edit", () => {
    assert.equal(filePathOf("edit", { filePath: "docs/confidential/y.md", oldString: "a", newString: "b" }), "docs/confidential/y.md");
  });
  it("returns undefined for non-file tools", () => {
    assert.equal(filePathOf("bash", { command: "ls" }), undefined);
    assert.equal(filePathOf("read", {}), undefined);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test plugins/maestro-bootstrap/index.test.js`
Expected: FAIL — `write`/`edit` возвращают `undefined`.

- [ ] **Step 3: Extend `filePathOf`**

В `core.js`, замени существующий `filePathOf` (строка ~488):

```js
/**
 * Extract a target file path from a file tool's args for access-policy checks.
 * access-policy контролирует только `read` (чёткий filePath); bash/glob/grep
 * не покрываются (bash-пути ненадёжно извлекаются, glob/grep — паттерны).
 * Confidential-контроль распространяет `filePathOf` на `write`/`edit`
 * (у всех трёх тулов аргумент `filePath`).
 * @param {string} tool  Tool name (read|write|edit).
 * @param {object} args  Tool args.
 * @returns {string|undefined}  Path to match, if any.
 */
export function filePathOf(tool, args) {
  if (!args) return undefined;
  if ((tool === "read" || tool === "write" || tool === "edit") && typeof args.filePath === "string") {
    return args.filePath;
  }
  return undefined;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test plugins/maestro-bootstrap/index.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plugins/maestro-bootstrap/core.js plugins/maestro-bootstrap/index.test.js
git commit -m "feat(bootstrap): filePathOf covers write/edit for confidential control"
```

---

### Task 4: Wire confidential logic into `tool.execute.before`

**Files:**
- Modify: `plugins/maestro-bootstrap/core.js`
- Test: `plugins/maestro-bootstrap/index.test.js`

- [ ] **Step 1: Write the failing test**

Добавь `describe` блок для интеграционного поведения через `MaestroBootstrapPlugin`. Использует мок `client` и временный `maestro.json` с секцией `confidential`. Мок-клиент должен «помнить» сессии по sessionID.

```js
describe("maestro-bootstrap confidential enforcement", () => {
  let dir, hooks, savedLogEnv;
  const LOG_ENV = ["MAESTRO_BOOTSTRAP_LOG_MASK", "MAESTRO_BOOTSTRAP_LOG_LEVEL", "MAESTRO_BOOTSTRAP_LOG_DIR"];

  // client mock: map sessionID -> { session, messages }
  function makeClient(sessions) {
    return {
      session: {
        get: async ({ path }) => {
          const rec = sessions[path.id];
          if (!rec) throw new Error("not found");
          return { data: rec.session };
        },
        messages: async ({ path }) => {
          const rec = sessions[path.id];
          if (!rec) return { data: [] };
          return { data: rec.messages };
        },
      },
    };
  }

  const rootSessions = {
    root: { session: { id: "root" }, messages: [] },
    childTrusted: {
      session: { id: "childTrusted", parentID: "root" },
      messages: [{ info: { role: "assistant", mode: "design" }, parts: [] }],
    },
    childUntrusted: {
      session: { id: "childUntrusted", parentID: "root" },
      messages: [{ info: { role: "assistant", mode: "haiku" }, parts: [] }],
    },
  };

  before(async () => {
    savedLogEnv = {};
    for (const k of LOG_ENV) { savedLogEnv[k] = process.env[k]; delete process.env[k]; }
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "fab-conf-"));
    fs.writeFileSync(path.join(dir, "maestro.json"), JSON.stringify({
      trust: { design: true },
      confidential: { paths: ["docs/confidential/**"], trusted: { read: "allow", write: "deny", edit: "deny" } },
    }));
    hooks = await MaestroBootstrapPlugin({ directory: dir, client: makeClient(rootSessions) });
  });

  after(() => {
    fs.rmSync(dir, { recursive: true, force: true });
    for (const k of LOG_ENV) {
      if (savedLogEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedLogEnv[k];
    }
  });

  it("allows trusted subagent read of confidential", async () => {
    const out = { args: { filePath: "docs/confidential/secrets.md" } };
    await hooks["tool.execute.before"]({ tool: "read", sessionID: "childTrusted", callID: "c1" }, out);
    assert.ok(true); // не должно выбросить
  });

  it("denies trusted subagent write to confidential (write=deny)", async () => {
    const out = { args: { filePath: "docs/confidential/x.md", content: "hi" } };
    await assert.rejects(
      hooks["tool.execute.before"]({ tool: "write", sessionID: "childTrusted", callID: "c2" }, out),
      /confidential:deny/,
    );
  });

  it("denies untrusted subagent read of confidential", async () => {
    const out = { args: { filePath: "docs/confidential/secrets.md" } };
    await assert.rejects(
      hooks["tool.execute.before"]({ tool: "read", sessionID: "childUntrusted", callID: "c3" }, out),
      /confidential:deny/,
    );
  });

  it("denies primary/root read of confidential", async () => {
    const out = { args: { filePath: "docs/confidential/secrets.md" } };
    await assert.rejects(
      hooks["tool.execute.before"]({ tool: "read", sessionID: "root", callID: "c4" }, out),
      /confidential:deny/,
    );
  });

  it("denies root session when no client provided (fail-closed)", async () => {
    const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), "fab-conf2-"));
    fs.writeFileSync(path.join(dir2, "maestro.json"), JSON.stringify({
      confidential: { paths: ["docs/confidential/**"] },
    }));
    const h2 = await MaestroBootstrapPlugin({ directory: dir2 });
    try {
      const out = { args: { filePath: "docs/confidential/secrets.md" } };
      await assert.rejects(
        h2["tool.execute.before"]({ tool: "read", sessionID: "root", callID: "c5" }, out),
        /confidential:deny/,
      );
    } finally {
      fs.rmSync(dir2, { recursive: true, force: true });
    }
  });

  it("does not apply confidential to non-confidential paths (passes to access_policy)", async () => {
    const out = { args: { filePath: "src/app.ts" } };
    await hooks["tool.execute.before"]({ tool: "read", sessionID: "root", callID: "c6" }, out);
    assert.ok(true); // не confidential, access_policy нет → allow
  });

  it("ignores access_policy.allow on confidential path (confidential wins)", async () => {
    const dir3 = fs.mkdtempSync(path.join(os.tmpdir(), "fab-conf3-"));
    fs.writeFileSync(path.join(dir3, "maestro.json"), JSON.stringify({
      access_policy: { default: "allow", allow: ["docs/confidential/**"] },
      confidential: { paths: ["docs/confidential/**"] },
    }));
    const h3 = await MaestroBootstrapPlugin({ directory: dir3 });
    try {
      const out = { args: { filePath: "docs/confidential/secrets.md" } };
      await assert.rejects(
        h3["tool.execute.before"]({ tool: "read", sessionID: "root", callID: "c7" }, out),
        /confidential:deny/,
      );
    } finally {
      fs.rmSync(dir3, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test plugins/maestro-bootstrap/index.test.js`
Expected: FAIL — confidential не перехватывается (исключения `confidential:deny` не бросаются).

- [ ] **Step 3: Implement confidential logic in `tool.execute.before`**

В `core.js`, внутри `MaestroBootstrapPlugin`:

1. Добавь `client` в параметры функции. Замени сигнатуру:

```js
export const MaestroBootstrapPlugin = async ({ directory, client }) => {
```

`client` — OpenCode SDK client (передаётся адаптером из входного параметра
плагина; опционален). `resolveIsTrustedSubagent` при `undefined` client вернёт
`false` (fail-closed).

2. В начале функции (рядом с `const accessPolicy = loadAccessPolicy(config);`) добавь:

```js
  const confidential = loadConfidentialConfig(config);
```

2. Рядом с `const toolCalls = makeBoundedMap(2048);` добавь кэш резолва trusted-статуса:

```js
  const sessionTrustCache = makeBoundedMap(2048);
```

3. В `tool.execute.before`, **ДО** блока access_policy, вставь confidential-ветку, а блок access_policy оставь **как есть** (без изменений, только `read`). Вставь сразу после строки `try {` (перед существующим блоком access_policy на строке ~622):

```js
        // Confidential control (Уровень 3+): жёсткий deny для не-trusted по
        // `confidential.paths`. Строже access_policy: если путь confidential —
        // access_policy для него не применяется (confidential выигрывает).
        // Покрывает read/write/edit. bash/glob/grep — нативные permissions.
        const CONF_TOOLS = new Set(["read", "write", "edit"]);
        if (confidential.exists && CONF_TOOLS.has(input.tool)) {
          const target = filePathOf(input.tool, output?.args);
          if (target && confidential.paths.some((p) => globMatch(p, target))) {
            let isTrustedSubagent = sessionTrustCache.get(input.sessionID);
            if (isTrustedSubagent === undefined) {
              isTrustedSubagent = await resolveIsTrustedSubagent(client, trustedAgents, input.sessionID);
              sessionTrustCache.set(input.sessionID, isTrustedSubagent);
            }
            const action = resolveConfidentialAction(confidential, input.tool, isTrustedSubagent);
            if (action !== "allow") {
              log.warn("confidential.blocked", {
                sessionID: input.sessionID,
                callID: input.callID,
                tool: input.tool,
                action,
                target: path.basename(target),
              });
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

Существующий блок access_policy (строки ~622-652, `FILE_TOOLS = new Set(["read"])`) **не трогаем** — access_policy по-прежнему контролирует только `read`. Для confidential-пути, прошедшего confidential-проверку (trusted-субагент, action=allow), access_policy-блок `read` тоже выполнится — но trusted-субагенты обычно имеют `allow` в access_policy или их путь вне ask/deny; это допустимое поведение (confidential не отменяет access_policy для `read`, он лишь добавляет более строгий слой). Дизайн «confidential выше access_policy» в данном плане означает: **если confidential-denied — блок всегда срабатывает независимо от access_policy**; обратное (confidential-allow + access_policy-ask) — выходит за scope и документируется в Task 9 как рекомендация выносить confidential-пути из access_policy.

4. В `catch` блоке `tool.execute.before` обнови условие пере-броса, чтобы confidential-ошибки доходили до OpenCode:

```js
      } catch (err) {
        if (err?.accessPolicy || err?.confidential) {
          // Access/confidential-нарушение — обязано дойти до OpenCode (реальный
          // блок), не замалчиваться логгером.
          throw err;
        }
        log.error("tool.execute.before: error", {
          sessionID: input?.sessionID,
          error: err instanceof Error ? err.message : String(err),
        });
      }
```

Примечание: `client` уже в сигнатуре функции (шаг 1 этого Task'а) и доступен в замыкании. В тестах без client он `undefined` — `resolveIsTrustedSubagent` вернёт `false` (fail-closed), что покрыто тестом «no client».

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test plugins/maestro-bootstrap/index.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plugins/maestro-bootstrap/core.js plugins/maestro-bootstrap/index.test.js
git commit -m "feat(bootstrap): enforce confidential deny for non-trusted in tool.execute.before"
```

---

### Task 5: Thread `client` through the adapter

**Files:**
- Modify: `plugins/maestro-bootstrap/index.js`

Примечание: сигнатура `MaestroBootstrapPlugin({ directory, client })` уже изменена в Task 4. Здесь — только адаптер, который передаёт `client` из входного объекта opencode-плагина.

- [ ] **Step 1: Modify the adapter**

`index.js` — пробросить `client` из входного объекта opencode-плагина в `MaestroBootstrapPlugin`:

```js
export default async function opencodePlugin(input) {
  if (!_mbHooks) {
    try {
      _mbHooks = await MaestroBootstrapPlugin({
        directory: process.cwd(),
        client: input?.client,
      });
    } catch {
      /* logging must not break opencode */
    }
  }
  // ... остальной код без изменений
}
```

- [ ] **Step 2: Verify no test regression**

Run: `node --test plugins/maestro-bootstrap/index.test.js`
Expected: PASS (существующие тесты не используют client — он опционален).

- [ ] **Step 3: Commit**

```bash
git add plugins/maestro-bootstrap/index.js
git commit -m "feat(bootstrap): pass opencode client into plugin for confidential identity"
```

---

### Task 6: `/maestro-init` — создать каталог `docs/confidential/`

**Files:**
- Modify: `skills/maestro-init/SKILL.md`
- Test: (нет автоматических тестов; верификация — чтением SKILL.md)

- [ ] **Step 1: Add `docs/confidential/` to the artifacts table**

В `skills/maestro-init/SKILL.md`, таблица «Артефакты, которые производит скилл»
(строка ~32), строка задачи 3а «Каталоги» — добавь `docs/confidential/`:

```markdown
| 3а. Каталоги | `.maestro/`, `docs/superpowers/{specs,plans}/`, `docs/confidential/` |
```

- [ ] **Step 2: Add `mkdir` for `docs/confidential/` in section 3а**

В разделе «### 3а. Подготовка каталогов» (строка ~102), после существующих
`mkdir -p`, добавь строку для confidential:

```markdown
- `mkdir -p docs/confidential` (защищённая папка, см. `confidential` в `maestro.json`)
```

Итоговый блок `3а` должен выглядеть так:

```markdown
Перед генерацией конфигов (идемпотентно, `mkdir -p` безопасен):
- `mkdir -p .maestro/` (для логов плагина и `last-run.md`)
- `mkdir -p docs/superpowers/specs docs/superpowers/plans` (для `/maestro-design`)
- `mkdir -p docs/confidential` (защищённая папка, см. `confidential` в `maestro.json`)
```

- [ ] **Step 3: Add `confidential` section to the generated `maestro.json`**

В разделе «### maestro.json (консолидированный конфиг, коммитится в git)»
(строка ~108), текст говорит «Три секции:». Замени на «Четыре секции:» и добавь
блок `confidential` после `access_policy` (перед `sanitizer_whitelist`):

```markdown
Четыре секции:

...

**`confidential`** — защита конфиденциальных путей (строже `access_policy`):
```json
"confidential": {
  "version": 1,
  "paths": ["docs/confidential/**"],
  "trusted": { "read": "allow", "write": "deny", "edit": "deny" }
}
```
- Дефолт: `paths: ["docs/confidential/**"]`; trusted читает, запись/редактирование —
  deny (выдаются явно). Untrusted/primary — всегда deny.
- Идемпотентность: при существующем `confidential` merge сохраняет правки; если
  секции нет — добавляется дефолтная.
```

- [ ] **Step 4: Update the файлы table row for `maestro.json`**

Если в SKILL.md есть таблица файлов (проверить; при отсутствии — пропустить шаг),
обнови описание `maestro.json` на «четыре секции (trust/access_policy/confidential/
sanitizer_whitelist)».

- [ ] **Step 5: Commit**

```bash
git add skills/maestro-init/SKILL.md
git commit -m "feat(maestro-init): create docs/confidential dir and confidential section"
```

---

### Task 7: Bump plugin version to 1.1.0

**Files:**
- Modify: `plugins/maestro-bootstrap/package.json`

- [ ] **Step 1: Update version**

В `package.json` строку `"version": "1.0.1"` замени на `"version": "1.1.0"`.

- [ ] **Step 2: Run full test suite**

Run: `node --test plugins/maestro-bootstrap/index.test.js`
Expected: PASS (все тесты зелёные).

- [ ] **Step 3: Commit**

```bash
git add plugins/maestro-bootstrap/package.json
git commit -m "chore(bootstrap): bump version to 1.1.0"
```

---

### Task 8: Documentation — `confidential` section in `config.md`

**Files:**
- Modify: `manual_docs/reference/config.md`

- [ ] **Step 1: Add the `confidential` section**

В `config.md`, после секции `### Секция access_policy` (после строки ~103, перед `### Секция sanitizer_whitelist`), добавь:

````markdown
### Секция `confidential`

Защита конфиденциальных путей: жёсткий deny чтения и записи для всех, кроме
**trusted-субагентов**. Строже `access_policy` — если путь попал в `paths`,
применяется правило `confidential`, `access_policy` для него игнорируется.

**Инвариант (не конфигурируется):** любое обращение к `paths` через
`read`/`write`/`edit` от НЕ trusted (primary/root-сессия, untrusted-субагент) →
жёсткий `deny` по всем трём инструментам.

**Конфигурируется только** политика для **trusted** по каждому инструменту
(`allow` | `deny`). Дефолт: `read: allow`, `write: deny`, `edit: deny` (читать
можно, менять — нельзя).

```json
{
  "confidential": {
    "version": 1,
    "paths": ["docs/confidential/**"],
    "trusted": {
      "read": "allow",
      "write": "deny",
      "edit": "deny"
    }
  }
}
```

| Ключ | Тип | Обязательно | Описание |
|---|---|---|---|
| `version` | `number` | нет | Версия схемы (сейчас всегда `1`) |
| `paths` | `string[]` | нет | Glob-шаблоны confidential-путей. По умолчанию `["docs/confidential/**"]` |
| `trusted.read` | `"allow"` \| `"deny"` | нет | Чтение trusted-субагентом (дефолт `allow`) |
| `trusted.write` | `"allow"` \| `"deny"` | нет | Запись trusted-субагентом (дефолт `deny`) |
| `trusted.edit` | `"allow"` \| `"deny"` | нет | Редактирование trusted-субагентом (дефолт `deny`) |

**Кто считается trusted-субагентом:** вызов `read`/`write`/`edit` к
confidential-пути, выполненный внутри дочерней сессии субагента, чьё имя есть в
секции `trust` (`maestro.json`). Primary-сессия (нет родительской сессии) всегда
deny. Trust не наследуется вложенными субагентами — каждый субагент оценивается
по своему имени.

> **⚠️ Риск: данные confidential открыты при отключённом плагине.** Защита
> `confidential` реализована **внутри плагина `maestro-bootstrap`** (перехват
> `tool.execute.before`) и **не является файловой защитой на уровне ОС**
> (не chmod/ACL, не шифрование). Это полноценный **fail-open**: если плагин не
> подключён в `opencode.json` (`plugin` без `maestro-bootstrap`), не загрузился,
> деактивирован или opencode запущен без него — `read`/`write`/`edit` в
> `docs/confidential/**` выполняются **как обычные** (без каких-либо ограничений).
> То же касается `access_policy` и sanitizer (все — в плагине): отключение
> плагина снимает ВСЮ file-политику. **Не полагайтесь на confidential как на
> единственный барьер** — при отключённом плагине данные доступны любому
> (primary и untrusted). Для гарантированного барьера на уровне ОС ограничьте
> права каталога средствами ОС/репозитория (read-only для не-нужного,
> git-криптография и т.п.). `/maestro-init` задача 5 лишь проверяет подключение
> плагина и **не блокирует** init при его отсутствии — плагин может быть не
> поднят, а confidential-данные уже созданы.
````

- [ ] **Step 2: Update the maestro.json intro line**

В строке ~15 `config.md` (описание секций `maestro.json`) добавь `confidential`:

```markdown
Файл состоит из четырёх секций: `trust`, `access_policy`, `confidential`,
`sanitizer_whitelist`.
```

- [ ] **Step 3: Update the files table**

В таблице «Файлы, создаваемые / используемые pipeline» строка про `maestro.json`
(строка ~383) — обнови описание:

```markdown
| `maestro.json` | Консолидированный конфиг (trust, access_policy, confidential, sanitizer_whitelist) | Да |
```

- [ ] **Step 4: Commit**

```bash
git add manual_docs/reference/config.md
git commit -m "docs: document confidential section in config reference"
```

---

### Task 9: Documentation — trust model + эшелонирование в `agents-and-trust.md`

**Files:**
- Modify: `manual_docs/explanation/agents-and-trust.md`

- [ ] **Step 1: Update the trust table**

В секции «Модель доверия», таблице «Уровень | Sanitize | File access control»,
добавь строку про confidential. Замени таблицу (строка ~35):

```markdown
| Уровень | Sanitize промпта | File access control |
|---|---|---|
| **trusted** (`maestro.json` → `trust` = `true`) | **skip** | **skip** (без ограничений по `access_policy`); доступ к `confidential` — по `confidential.trusted.<tool>` |
| **untrusted** (default) | Security Review (Ур.1 + Ур.2) | перехват `read` по access-policy (ask → блок); доступ к `confidential` — **всегда deny** |
```

- [ ] **Step 2: Update the maestro.json sections list**

В строке ~46 (описание `maestro.json`): «консолидированный конфиг с тремя
секциями» → «с четырьмя секциями». Замени:

```markdown
Файл `maestro.json` в корне проекта (рядом с `opencode.json`) — консолидированный
конфиг с четырьмя секциями: `trust`, `access_policy`, `confidential`,
`sanitizer_whitelist`.
```

- [ ] **Step 3: Add a subsection on confidential + эшелонирование**

После подсекции «File access control» (строка ~99), добавь:

````markdown
### Защищённая папка `docs/confidential`

Секция `confidential` в `maestro.json` закрывает конфиденциальные пути
(по умолчанию `docs/confidential/**`) для чтения и записи всем, кроме trusted-
субагентов (имена из секции `trust`). Primary-сессия и untrusted-субагенты —
жёсткий `deny` (не конфигурируется). Trusted-субагент читает по умолчанию
(`trusted.read: allow`), а запись/редактирование по умолчанию запрещены
(`trusted.write`/`trusted.edit: deny`) и выдаются явно.

**Известное ограничение (риск обхода):** плагин перехватывает только
`read`/`write`/`edit`. Содержимое confidential можно вытащить через
`bash cat`, `grep -r`, `glob` — эти тулы плагином не покрываются (пути из
bash-команд ненадёжно извлекаются).

**Рекомендуемый 2-й эшелон защиты — нативные permissions OpenCode**
(`opencode.json`), чтобы закрыть `bash`/`glob`/`grep` для confidential-путей:

```json
{
  "permission": {
    "bash": {
      "*cat*confidential*": "deny",
      "*grep*confidential*": "deny",
      "*ls*confidential*": "deny",
      "*glob*confidential*": "deny"
    }
  }
}
```

Два слоя работают независимо: плагин закрывает `read/write/edit`, native
permissions OpenCode закрывают `bash/glob/grep`. При настройке вынесите
`docs/confidential/**` из `access_policy.allow`, чтобы избежать путаницы
(confidential технически выигрывает, но явная настройка читается яснее).

**Прочее:**
- **Смена `maestro.json`** — требует рестарта opencode (конфиг читается при
  старте плагина).
- **Trust не наследуется** вложенными субагентами: даже если trusted-субагент
  диспатчит вложенного, вложенный оценивается по своему имени и получает deny,
  если не в `trust`.
- **Абсолютные пути** в `read`/`write`/`edit` (`/abs/docs/confidential/x.md`)
  матчатся как есть; для относительных используется рабочий путь инструмента.

> **⚠️ Риск: данные confidential открыты при отключённом плагине.** Вся защита
> `confidential` (как и `access_policy` и sanitizer) реализована в плагине
> `maestro-bootstrap` и **не является файловой защитой ОС (не chmod/ACL)**. Это
> fail-open: при отключённом или незагруженном плагине `read`/`write`/`edit` в
> `docs/confidential/**` выполняются без ограничений. Если данные в
> `docs/confidential/` действительно конфиденциальны и их раскрытие недопустимо
> даже без плагина — это **не** достаточный барьер: дополнительно ограничьте
> права каталога средствами ОС (read-only / владелец) или репозитория (git-crypt,
> отдельный приватный submodule/remote). Confidential — это защита от untrusted-
> агентов **при работающем плагине**, не универсальная защита данных.

**⚠️ Чего делать НЕ надо — НЕ добавлять рабочие spec/plan пути в `paths`.**
Каталоги `docs/superpowers/specs/**` и `docs/superpowers/plans/**` являются
**двухролевыми**: генерируются trusted `design` (пишет spec/plan) и читаются
trusted `sanitizer`, но **потребляются untrusted**-субагентами — `opus` (spec
review, шаг 9), implementer (`haiku`/`sonnet`, шаг 13), `code-reviewer` (шаг 16).
Если добавить эти пути в `confidential.paths`, untrusted-субагенты и primary
получат жёсткий deny на чтение spec/plan, и **процесс планирования/реализации
остановится** (untrusted не смогут читать исходники для своей работы). Защита
confidential-ДАННЫХ обеспечивается иначе: spec/plan **очищаются** sanitizer
(шаг 8.6 pipeline, «Подписи spec-файла») и лежат **вне** `docs/confidential/`;
untrusted работают по очищенным артефактам, а доступ к исходным confidential-
файлам им закрыт. Confidential покрывает **исходные данные**, а не очищенные
артефакты на их основе.
````

- [ ] **Step 4: Commit**

```bash
git add manual_docs/explanation/agents-and-trust.md
git commit -m "docs: document confidential access and layered bash protection"
```

---

### Task 10: Documentation — changelog

**Files:**
- Modify: `manual_docs/overview/changelog.md`

- [ ] **Step 1: Add an entry under `## [Unreleased]`**

Под `## [Unreleased]`, в секции `### Добавлено` (строка ~68), добавь:

```markdown
- **Защищённая папка `docs/confidential`**: секция `confidential` в `maestro.json`
  закрывает конфиденциальные пути (дефолт `docs/confidential/**`) для
  `read`/`write`/`edit` от всех, кроме trusted-субагентов. Primary/untrusted —
  жёсткий deny; trusted читает (по умолчанию), пишет только по явному
  `trusted.write`/`trusted.edit: allow`. Плагин определяет отправителя через
  `client.session.get` + `session.messages` (детект по `parentID` и имени агента).
  Ограничение: `bash`/`glob`/`grep` не покрываются — рекомендован 2-й эшелон
  через native permissions OpenCode (`permission.bash`).
```

- [ ] **Step 2: Commit**

```bash
git add manual_docs/overview/changelog.md
git commit -m "docs: changelog entry for confidential docs protection"
```

---

### Task 11: Documentation — plugin README (опционально, если есть раздел file access)

**Files:**
- Modify: `plugins/maestro-bootstrap/README.md`

- [ ] **Step 1: Add a confidential note**

Проверь, есть ли в `plugins/maestro-bootstrap/README.md` раздел о file access
control / `access_policy`. Если есть — добавь после него подраздел о `confidential`
(кратко, 3-5 строк, с примером JSON). Если раздела нет — пропусти шаг (commit
не делаем).

```markdown
### Секция `confidential`

Закрывает конфиденциальные пути (дефолт `docs/confidential/**`) для `read`/
`write`/`edit` от всех, кроме trusted-субагентов. Primary и untrusted — жёсткий
deny; trusted читает, пишет по `trusted.write`/`trusted.edit: allow`. Строже
`access_policy` и имеет приоритет. Подробнее — `manual_docs/reference/config.md`.
```

- [ ] **Step 2: Commit (только если был шаг 1)**

```bash
git add plugins/maestro-bootstrap/README.md
git commit -m "docs(bootstrap): document confidential section in README"
```

---

### Task 12: Final verification

**Files:** (нет изменений)

- [ ] **Step 1: Run full test suite**

Run: `node --test plugins/maestro-bootstrap/index.test.js`
Expected: все тесты зелёные.

- [ ] **Step 2: Verify broken links in manual_docs**

Проверь, что новые/изменённые ссылки в `manual_docs/` валидны (быстрым
grep-ом по связанным разделам). Ожидается отсутствие битых ссылок на
`config.md`, `agents-and-trust.md`.

- [ ] **Step 3: Run lint (если есть)**

Проверь наличие линта в репо (`npm run lint` / аналоги). Если есть — прогони и
зафиксируй результат. Если нет — пропусти (помечай как done без изменений).

- [ ] **Step 4: Confirm git status clean of unintended changes**

Run: `git status`
Expected: только запланированные файлы.

---

## Self-Review

**Spec coverage:**
- ✅ Конфиг `confidential` (paths + trusted per-tool) — Task 1, Task 8.
- ✅ Trusted-определение через client.session.get + parentID + имя агента — Task 2.
- ✅ read/write/edit перехват — Task 3, Task 4.
- ✅ Primary/untrusted → жёсткий deny — Task 4.
- ✅ Приоритет confidential над access_policy — Task 4.
- ✅ Bash/glob/grep риск + 2-й эшелон — Task 9 (docs).
- ✅ Ненаследование trust вложенными субагентами — Task 9 (docs).
- ✅ Рестарт при смене конфига — Task 9 (docs).
- ✅ Нормализация путей — Task 9 (docs) + Task 3 (filePathOf).
- ✅ `/maestro-init` создаёт `docs/confidential/` и секцию `confidential` — Task 6.
- ✅ Предупреждение «не добавлять `docs/superpowers/**` в `paths` (ломает SDD)» — Task 9 (docs).
- ✅ Явный `⚠️ Риск` «данные открыты при отключённом плагине (fail-open)» — Task 8 и Task 9 (docs).
- ✅ Файл дизайна `specs/confidential-docs-plan.md` — этот план.

**Placeholder scan:** нет TBD/TODO; все шаги содержат полный код и команды.

**Type consistency:** `loadConfidentialConfig` → `{ exists, paths, trusted }` согласован между Task 1 и Task 4; `resolveConfidentialAction(conf, tool, isTrustedSubagent)` согласован; `resolveIsTrustedSubagent(client, trustedAgents, sessionID)` согласован между Task 2 и Task 4; `filePathOf` единый (read/write/edit) между Task 3 и Task 4; `globMatch` переиспользуется как есть.