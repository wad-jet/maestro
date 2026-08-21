# Исправление Confidential-фичи: C1, C2, I1, I2 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Закрыть обходы confidential-защиты (C1 абсолютные/`./`/case-пути, C2 листинг директории), устранить неконсистентность с access_policy (I1) и проглоченный сбой инициализации плагина (I2).

**Architecture:** В `core.js` добавить нормализацию пути перед glob-матчингом (проект-относительная каноническая форма + case-insensitive матчинг для confidential-границы) и блокировку префикса директории; в `tool.execute.before` — флаг `wasConfidential` для пропуска access_policy после confidential-allow; в `index.js` — логирование сбоя инициализации.

**Tech Stack:** Node.js (ESM, `node:test`), OpenCode plugin (`tool.execute.before`).

**Спека-источник ревью:** findings C1/C2/I1/I2 из финального ревью.

---

## Файлы

- `plugins/maestro-bootstrap/core.js` — helpers `normalizeTarget`, `isConfidentialTarget`; правки `tool.execute.before`.
- `plugins/maestro-bootstrap/index.test.js` — тесты (TDD).
- `plugins/maestro-bootstrap/index.js` — логирование сбоя init (I2).
- `manual_docs/explanation/agents-and-trust.md` — уточнить docs (абсолютные пути теперь нормализуются; `bash`/`glob`/`grep` остаются риском).

---

### Task 1: Helper `normalizeTarget`

**Files:**
- Modify: `plugins/maestro-bootstrap/core.js`
- Test: `plugins/maestro-bootstrap/index.test.js`

- [ ] **Step 1: Write the failing test**

Добавь импорт `normalizeTarget` в строку 6 теста и новый `describe` в конец файла:

```js
describe("maestro-bootstrap confidential path normalization", () => {
  const root = "/proj";

  it("normalizes absolute path to project-relative", () => {
    assert.equal(normalizeTarget(root, "/proj/docs/confidential/x.md"), "docs/confidential/x.md");
  });

  it("normalizes relative and dot-prefixed to project-relative", () => {
    assert.equal(normalizeTarget(root, "docs/confidential/x.md"), "docs/confidential/x.md");
    assert.equal(normalizeTarget(root, "./docs/confidential/x.md"), "docs/confidential/x.md");
  });

  it("collapses .. traversal outside project", () => {
    assert.equal(normalizeTarget(root, "docs/confidential/../../etc/passwd"), "../etc/passwd");
  });

  it("returns empty string for empty target", () => {
    assert.equal(normalizeTarget(root, ""), "");
    assert.equal(normalizeTarget(root, undefined), "");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test plugins/maestro-bootstrap/index.test.js`
Expected: FAIL — `normalizeTarget is not defined`.

- [ ] **Step 3: Implement `normalizeTarget`**

В `core.js`, рядом с `globMatch`, добавь:

```js
/**
 * Normalize a target path to a canonical project-relative form (posix separators).
 * Сводит absolute / relative / `./` / `..` к единому виду для glob-матчинга.
 * @param {string} root    Project root (absolute).
 * @param {string} target  Raw path from tool args.
 * @returns {string}  Project-relative path with `/` separators ("" if invalid).
 */
export function normalizeTarget(root, target) {
  if (typeof target !== "string" || !target) return "";
  const abs = path.isAbsolute(target) ? target : path.resolve(root, target);
  const rel = path.relative(root, abs);
  return rel.split(path.sep).join("/");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test plugins/maestro-bootstrap/index.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plugins/maestro-bootstrap/core.js plugins/maestro-bootstrap/index.test.js
git commit -m "fix(bootstrap): normalize target paths for confidential glob matching"
```

---

### Task 2: Helper `isConfidentialTarget` (нормализация + директория + case-insensitive)

**Files:**
- Modify: `plugins/maestro-bootstrap/core.js`
- Test: `plugins/maestro-bootstrap/index.test.js`

- [ ] **Step 1: Write the failing test**

Добавь импорт `isConfidentialTarget` и тесты:

```js
describe("maestro-bootstrap isConfidentialTarget", () => {
  const root = "/proj";
  const patterns = ["docs/confidential/**"];

  it("blocks file under pattern (relative)", () => {
    assert.equal(isConfidentialTarget(root, patterns, "docs/confidential/x.md"), true);
  });
  it("blocks file under pattern (absolute)", () => {
    assert.equal(isConfidentialTarget(root, patterns, "/proj/docs/confidential/x.md"), true);
  });
  it("blocks file under pattern (dot-prefixed)", () => {
    assert.equal(isConfidentialTarget(root, patterns, "./docs/confidential/x.md"), true);
  });
  it("blocks case-variant path (case-insensitive boundary)", () => {
    assert.equal(isConfidentialTarget(root, patterns, "docs/Confidential/X.MD"), true);
  });
  it("blocks the directory itself (C2)", () => {
    assert.equal(isConfidentialTarget(root, patterns, "docs/confidential"), true);
    assert.equal(isConfidentialTarget(root, patterns, "/proj/docs/confidential"), true);
  });
  it("blocks subdirectory listing under pattern", () => {
    assert.equal(isConfidentialTarget(root, patterns, "docs/confidential/subdir"), true);
  });
  it("does not block non-confidential paths", () => {
    assert.equal(isConfidentialTarget(root, patterns, "src/app.ts"), false);
    assert.equal(isConfidentialTarget(root, patterns, "docs/readme.md"), false);
    assert.equal(isConfidentialTarget(root, patterns, "docs/confidentialx.md"), false);
  });
  it("does not block .. traversal that escapes the pattern prefix", () => {
    assert.equal(isConfidentialTarget(root, patterns, "docs/confidential/../../src/app.ts"), false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test plugins/maestro-bootstrap/index.test.js`
Expected: FAIL — `isConfidentialTarget is not defined`.

- [ ] **Step 3: Implement `isConfidentialTarget`**

В `core.js`, после `normalizeTarget`, добавь:

```js
/**
 * Check whether a target path falls within any confidential pattern.
 * Confidential — security-граница: матчинг case-insensitive (APFS/NTFS могут
 * резолвить case-варианты в тот же файл) и блокирует как файлы под паттерном,
 * так и саму директорию/поддиректории (листинг — C2).
 * @param {string} root      Project root (absolute).
 * @param {string[]} patterns  Confidential path globs (e.g. `docs/confidential/**`).
 * @param {string} target    Raw path from tool args.
 * @returns {boolean}
 */
export function isConfidentialTarget(root, patterns, target) {
  const rel = normalizeTarget(root, target);
  if (!rel) return false;
  const lower = rel.toLowerCase();
  for (const p of patterns ?? []) {
    if (typeof p !== "string" || !p) continue;
    const pat = p.toLowerCase();
    if (globMatch(pat, lower)) return true; // файл под паттерном
    if (pat.endsWith("/**")) {
      const prefix = pat.slice(0, -3); // убрать `/**`
      if (lower === prefix) return true; // сама директория
      if (lower.startsWith(prefix + "/")) return true; // поддиректория (листинг глубже)
    }
  }
  return false;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test plugins/maestro-bootstrap/index.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plugins/maestro-bootstrap/core.js plugins/maestro-bootstrap/index.test.js
git commit -m "fix(bootstrap): isConfidentialTarget normalizes, blocks dir listing, case-insensitive"
```

---

### Task 3: Wire `isConfidentialTarget` + skip access_policy after confidential (C1/C2/I1)

**Files:**
- Modify: `plugins/maestro-bootstrap/core.js`
- Test: `plugins/maestro-bootstrap/index.test.js`

- [ ] **Step 1: Write the failing test**

Добавь тесты в блок `maestro-bootstrap confidential enforcement` (или новый):

```js
describe("maestro-bootstrap confidential path bypass closure", () => {
  let dir, hooks, savedLogEnv;
  const LOG_ENV = ["MAESTRO_BOOTSTRAP_LOG_MASK", "MAESTRO_BOOTSTRAP_LOG_LEVEL", "MAESTRO_BOOTSTRAP_LOG_DIR"];

  function makeClient() {
    return {
      session: {
        get: async ({ path }) => {
          if (path.id === "root") return { data: { id: "root" } };
          if (path.id === "childUntrusted") return { data: { id: "childUntrusted", parentID: "root" } };
          throw new Error("not found");
        },
        messages: async ({ path }) => {
          if (path.id === "childUntrusted") {
            return { data: [{ info: { role: "assistant", mode: "haiku" }, parts: [] }] };
          }
          return { data: [] };
        },
      },
    };
  }

  before(async () => {
    savedLogEnv = {};
    for (const k of LOG_ENV) { savedLogEnv[k] = process.env[k]; delete process.env[k]; }
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "fab-cfix-"));
    fs.writeFileSync(path.join(dir, "maestro.json"), JSON.stringify({
      confidential: { paths: ["docs/confidential/**"] },
    }));
    hooks = await MaestroBootstrapPlugin({ directory: dir, client: makeClient() });
  });

  after(() => {
    fs.rmSync(dir, { recursive: true, force: true });
    for (const k of LOG_ENV) {
      if (savedLogEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedLogEnv[k];
    }
  });

  it("denies absolute-path read of confidential (C1)", async () => {
    const abs = path.join(dir, "docs/confidential/secrets.md");
    const out = { args: { filePath: abs } };
    await assert.rejects(
      hooks["tool.execute.before"]({ tool: "read", sessionID: "root", callID: "c1" }, out),
      /confidential:deny/,
    );
  });

  it("denies dot-prefixed read of confidential (C1)", async () => {
    const out = { args: { filePath: "./docs/confidential/secrets.md" } };
    await assert.rejects(
      hooks["tool.execute.before"]({ tool: "read", sessionID: "root", callID: "c2" }, out),
      /confidential:deny/,
    );
  });

  it("denies case-variant read of confidential (C1)", async () => {
    const out = { args: { filePath: "docs/Confidential/secrets.md" } };
    await assert.rejects(
      hooks["tool.execute.before"]({ tool: "read", sessionID: "root", callID: "c3" }, out),
      /confidential:deny/,
    );
  });

  it("denies directory listing of confidential (C2)", async () => {
    const out = { args: { filePath: "docs/confidential" } };
    await assert.rejects(
      hooks["tool.execute.before"]({ tool: "read", sessionID: "root", callID: "c4" }, out),
      /confidential:deny/,
    );
  });

  it("does not break non-confidential paths", async () => {
    const out = { args: { filePath: "src/app.ts" } };
    await hooks["tool.execute.before"]({ tool: "read", sessionID: "root", callID: "c5" }, out);
    assert.ok(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test plugins/maestro-bootstrap/index.test.js`
Expected: FAIL — absolute/`./`/case/dir cases throw no `confidential:deny` (current raw glob misses them).

- [ ] **Step 3: Implement in `tool.execute.before`**

Замени confidential-блок (строки ~732-758) на:

```js
        const CONF_TOOLS = new Set(["read", "write", "edit"]);
        let wasConfidential = false;
        if (confidential.exists && CONF_TOOLS.has(input.tool)) {
          const target = filePathOf(input.tool, output?.args);
          if (target && isConfidentialTarget(root, confidential.paths, target)) {
            wasConfidential = true;
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

И оберни access_policy-блок (строки ~760-790) в `!wasConfidential`:

```js
        if (accessPolicy.exists && FILE_TOOLS.has(input.tool) && !wasConfidential) {
```

(остальное внутри блока без изменений).

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test plugins/maestro-bootstrap/index.test.js`
Expected: PASS (все 97 + новые).

- [ ] **Step 5: Commit**

```bash
git add plugins/maestro-bootstrap/core.js plugins/maestro-bootstrap/index.test.js
git commit -m "fix(bootstrap): close path bypasses; skip access_policy after confidential"
```

---

### Task 4: Adapter — логировать сбой инициализации плагина (I2)

**Files:**
- Modify: `plugins/maestro-bootstrap/index.js`

- [ ] **Step 1: Modify the adapter**

Замени блок `try/catch` в `opencodePlugin`:

```js
  if (!_mbHooks) {
    try {
      _mbHooks = await MaestroBootstrapPlugin({
        directory: process.cwd(),
        client: input?.client,
      });
    } catch (err) {
      // I2: проглоченный сбой init тихо отключает ВСЕ хуки (confidential,
      // sanitizer, access_policy) → fail-open. Логируем, чтобы не было тихого
      // отключения защиты. Плагин не кэшируется — следующая инвокация повторит.
      console.error("[maestro-bootstrap] init failed:", err instanceof Error ? err.message : err);
      _mbHooks = null;
    }
  }
```

- [ ] **Step 2: Verify no regression**

Run: `node --test plugins/maestro-bootstrap/index.test.js`
Expected: PASS (тесты не используют адаптер напрямую; адаптер остаётся try/catch-guarded).

- [ ] **Step 3: Commit**

```bash
git add plugins/maestro-bootstrap/index.js
git commit -m "fix(bootstrap): log plugin init failure instead of silently disabling hooks"
```

---

### Task 5: Docs — уточнить поведение путей

**Files:**
- Modify: `manual_docs/explanation/agents-and-trust.md`

- [ ] **Step 1: Update the absolute-paths note**

В подсекции confidential, в «Прочее», замени пункт про абсолютные пути:

```markdown
- **Пути нормализуются** перед матчингом: absolute / `./` / relative / `..`
  сводятся к каноническому проект-относительному виду, поэтому
  `/abs/.../docs/confidential/x.md`, `./docs/confidential/x.md` и
  `docs/Confidential/...` (case-вариант) блокируются наравне с
  `docs/confidential/...`. Листинг самой директории `docs/confidential` тоже
  блокируется. `bash`/`glob`/`grep` по-прежнему не покрываются плагином —
  используйте нативные permissions OpenCode (2-й эшелон).
```

- [ ] **Step 2: Commit**

```bash
git add manual_docs/explanation/agents-and-trust.md
git commit -m "docs: clarify confidential path normalization and dir-listing block"
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

**C1 (абсолютные/`./`/case пути):** → Task 1 (normalizeTarget), Task 2 (case-insensitive матчинг), Task 3 (wire). Покрыто тестами.
**C2 (листинг директории):** → Task 2 (префикс `/**` → сама директория и поддиректории), Task 3. Покрыто.
**I1 (skip access_policy после confidential-allow):** → Task 3 (`wasConfidential`). Покрыто неявно (non-confidential path test).
**I2 (лог сбоя init):** → Task 4. Проверено чтением.
**Docs:** → Task 5.

**Placeholder scan:** нет TBD/TODO; код полный.
**Type consistency:** `normalizeTarget(root, target)`, `isConfidentialTarget(root, patterns, target)` согласованы между Task 1-3; флаг `wasConfidential` — локальный в `tool.execute.before`, используется только там.