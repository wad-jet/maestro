# Confidential: отдельные файлы по имени и по маске — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Дать `confidential.paths` корректную сегментную семантику для отдельных файлов (по полному имени и по маске), включая корневую папку проекта, без регрессий в `docs/confidential/**` и без правки общего `globMatch` (access_policy не трогаем).

**Architecture:** В `core.js` добавить отдельный сегментный матчер `confGlobMatch` (используется ТОЛЬКО для confidential), в котором `**` матчит 0+ сегментов (покрывает корень), а `*`/`?` — только в пределах одного сегмента (не пересекают `/`). `isConfidentialTarget` переписать на этот матчер. Общий `globMatch` (для access_policy) не изменяется. Матчинг идёт по строке пути из `args.filePath`, диска не касается (fail-open для bash/glob/grep остаётся как есть, НЕ закрывается).

**Tech Stack:** Node.js (ESM, `node:test`), OpenCode plugin (`tool.execute.before`).

---

## Файлы

- `plugins/maestro-bootstrap/core.js` — новый экспорт `confGlobMatch`; переписать `isConfidentialTarget`.
- `plugins/maestro-bootstrap/index.test.js` — тесты (TDD).
- `manual_docs/reference/config.md` — документировать семантику масок `paths`.
- `manual_docs/explanation/agents-and-trust.md` — краткая заметка про отдельные файлы/маски.
- `skills/maestro-assistant/SKILL.md` — пометка в каноне конфига про семантику масок.
- `plugins/maestro-bootstrap/README.md` — пометка про сегментную семантику масок в секции `confidential`.

---

## Семантика матчера (зафиксирована с HITL)

- Паттерн матчится против **проект-относительного** пути (нормализуется `normalizeTarget`), case-insensitive.
- Паттерн разбивается на сегменты по `/`. Значение — тоже.
- `**` — 0+ сегментов (0 включительно ⇒ покрывает корень, напр. `**/*.pem` матчит и `app.pem`, и `certs/app.pem`).
- `*` — любые символы в пределах ОДНОГО сегмента (не пересекает `/`).
- `?` — один символ в пределах одного сегмента.
- `{a,b}` — чередование внутри сегмента (как в текущем `globMatch`).
- Паттерн без `/` и без `**` (напр. `*.env`, `maestro.json`) матчит **только файлы в корневой папке** проекта.
- Паттерн с `/**` на конце (напр. `docs/confidential/**`) по-прежнему матчит саму директорию, поддиректории и файлы внутри (поведение сохраняется идентично текущему — см. Task 2 Step 3).

---

## Обоснование: почему НЕ меняем общий `globMatch`

`globMatch` (`core.js:520`) используется и в `resolveFileAccess` (access_policy). Там маски рассчитаны на «звезда через `/`»: `allow: ["*.{ts,js,py,go,rs}"]` матчит и `src/app.ts`, `deny: ["*.env"]` матчит и `config/prod.env`. Если сделать `*` сегментным глобально — регрессия access_policy. Поэтому новый матчер живёт отдельно и применяется только в `isConfidentialTarget`.

---

### Task 1: Helper `confGlobMatch` (сегментный матчер)

**Files:**
- Modify: `plugins/maestro-bootstrap/core.js`
- Test: `plugins/maestro-bootstrap/index.test.js`

- [ ] **Step 1: Write the failing test**

Добавь `confGlobMatch` в импорт (строка 6 `index.test.js`) и новый `describe` в конец файла:

```js
describe("maestro-bootstrap confGlobMatch (segment-aware, confidential-only)", () => {
  it("full filename matches only root-level", () => {
    assert.equal(confGlobMatch("maestro.json", "maestro.json"), true);
    assert.equal(confGlobMatch("maestro.json", "src/maestro.json"), false);
    assert.equal(confGlobMatch("maestro.json", "maestro.jsonx"), false);
  });
  it("dotfile full name matches", () => {
    assert.equal(confGlobMatch(".maestro.json", ".maestro.json"), true);
  });
  it("bare mask matches only root (does not cross /)", () => {
    assert.equal(confGlobMatch("*.env", "prod.env"), true);
    assert.equal(confGlobMatch("*.env", "config/prod.env"), false);
  });
  it("recursive ** covers root and nested", () => {
    assert.equal(confGlobMatch("**/*.pem", "app.pem"), true);
    assert.equal(confGlobMatch("**/*.pem", "certs/app.pem"), true);
    assert.equal(confGlobMatch("**/*.pem", "certs/nested/app.pem"), true);
    assert.equal(confGlobMatch("**/*.pem", "app.pemx"), false);
  });
  it("nested mask with slash matches within that segment", () => {
    assert.equal(confGlobMatch("configs/*.env", "configs/prod.env"), true);
    assert.equal(confGlobMatch("configs/*.env", "prod.env"), false);
    assert.equal(confGlobMatch("configs/*.env", "configs/deep/prod.env"), false);
  });
  it("brace alternation within a segment", () => {
    assert.equal(confGlobMatch("*.{env,local}", "prod.env"), true);
    assert.equal(confGlobMatch("*.{env,local}", "prod.local"), true);
    assert.equal(confGlobMatch("*.{env,local}", "prod.yml"), false);
  });
  it("trailing /** matches directory, subdir and file inside", () => {
    assert.equal(confGlobMatch("docs/confidential/**", "docs/confidential"), true);
    assert.equal(confGlobMatch("docs/confidential/**", "docs/confidential/x.md"), true);
    assert.equal(confGlobMatch("docs/confidential/**", "docs/confidential/subdir"), true);
  });
  it("single ? matches one char within a segment", () => {
    assert.equal(confGlobMatch("?.env", "a.env"), true);
    assert.equal(confGlobMatch("?.env", "ab.env"), false);
  });
  it("returns false for empty pattern or value (defensive guard)", () => {
    assert.equal(confGlobMatch("", "prod.env"), false);
    assert.equal(confGlobMatch("*.env", ""), false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test plugins/maestro-bootstrap/index.test.js`
Expected: FAIL — `confGlobMatch is not defined`.

- [ ] **Step 3: Implement `confGlobMatch`**

В `core.js`, рядом с `globMatch`, добавь:

```js
/**
 * Segment-aware glob matcher for confidential paths ONLY.
 * Confidential-граница использует более строгую семантику, чем общий
 * `globMatch` (который оставлен для access_policy, где `*` пересекает `/`):
 *  - `**`  — 0+ сегментов (0 включительно ⇒ покрывает корень);
 *  - `*`   — любые символы в пределах ОДНОГО сегмента (не пересекает `/`);
 *  - `?`   — один символ в пределах одного сегмента;
 *  - `{a,b}` — чередование внутри сегмента.
 * Паттерн без `/` и без `**` (напр. `*.env`) матчит только корневые файлы.
 * Оба аргумента ожидаются в нижнем регистре (case-insensitive граница).
 * Пустой pattern/value → `false` (защитный guard от `("**","")` / `("*","")`).
 * @param {string} pattern  Glob pattern (lowercased).
 * @param {string} value    Project-relative path (lowercased).
 * @returns {boolean}
 */
export function confGlobMatch(pattern, value) {
  if (typeof pattern !== "string" || !pattern) return false;
  if (typeof value !== "string" || !value) return false;
  const patSegs = pattern.split("/");
  const valSegs = value.split("/");

  // regex для отдельного сегмента паттерна (без `**`).
  const segRe = (seg) => {
    let out = "";
    let i = 0;
    while (i < seg.length) {
      const ch = seg[i];
      if (ch === "{") {
        const end = seg.indexOf("}", i);
        if (end !== -1) {
          const alts = seg
            .slice(i + 1, end)
            .split(",")
            .map((a) => a.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
          out += `(?:${alts.join("|")})`;
          i = end + 1;
          continue;
        }
      }
      if (ch === "*") {
        out += "[^/]*";
      } else if (ch === "?") {
        out += "[^/]";
      } else {
        out += ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      }
      i += 1;
    }
    return new RegExp(`^${out}$`);
  };

  const re = patSegs.map((s) => (s === "**" ? null : segRe(s)));

  // DP: dp[i][j] = можно ли сопоставить паттерн[0..i) со значением[0..j).
  const dp = Array.from({ length: patSegs.length + 1 }, () =>
    Array(valSegs.length + 1).fill(false),
  );
  dp[0][0] = true;
  for (let i = 1; i <= patSegs.length; i++) {
    if (patSegs[i - 1] === "**") dp[i][0] = dp[i - 1][0];
  }
  for (let i = 1; i <= patSegs.length; i++) {
    for (let j = 1; j <= valSegs.length; j++) {
      if (patSegs[i - 1] === "**") {
        // `**` матчит 0+ сегментов.
        dp[i][j] = dp[i - 1][j] || dp[i][j - 1];
      } else if (re[i - 1].test(valSegs[j - 1])) {
        dp[i][j] = dp[i - 1][j - 1];
      }
    }
  }
  return dp[patSegs.length][valSegs.length];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test plugins/maestro-bootstrap/index.test.js`
Expected: PASS (все предыдущие + новые).

- [ ] **Step 5: Commit**

```bash
git add plugins/maestro-bootstrap/core.js plugins/maestro-bootstrap/index.test.js
git commit -m "feat(bootstrap): segment-aware confGlobMatch for confidential paths"
```

---

### Task 2: Переписать `isConfidentialTarget` на `confGlobMatch`

**Files:**
- Modify: `plugins/maestro-bootstrap/core.js:588-603`
- Test: `plugins/maestro-bootstrap/index.test.js`

- [ ] **Step 1: Write the failing test**

Добавь `describe` в конец `index.test.js`:

```js
describe("maestro-bootstrap isConfidentialTarget (single-file & mask)", () => {
  const root = "/proj";

  it("full filename at root is confidential", () => {
    assert.equal(isConfidentialTarget(root, ["maestro.json"], "maestro.json"), true);
    assert.equal(isConfidentialTarget(root, ["maestro.json"], "maestro.jsonx"), false);
    assert.equal(isConfidentialTarget(root, ["maestro.json"], "src/maestro.json"), false);
  });
  it("dotfile full name at root is confidential", () => {
    assert.equal(isConfidentialTarget(root, [".maestro.json"], ".maestro.json"), true);
  });
  it("bare mask blocks root but not nested", () => {
    assert.equal(isConfidentialTarget(root, ["*.env"], "prod.env"), true);
    assert.equal(isConfidentialTarget(root, ["*.env"], "config/prod.env"), false);
  });
  it("recursive mask covers root and nested", () => {
    assert.equal(isConfidentialTarget(root, ["**/*.pem"], "app.pem"), true);
    assert.equal(isConfidentialTarget(root, ["**/*.pem"], "certs/app.pem"), true);
    assert.equal(isConfidentialTarget(root, ["**/*.env"], "prod.env"), true);
  });
  it("nested mask with slash blocks within that segment", () => {
    assert.equal(isConfidentialTarget(root, ["configs/*.env"], "configs/prod.env"), true);
    assert.equal(isConfidentialTarget(root, ["configs/*.env"], "prod.env"), false);
  });
  it("case-variant of full filename still blocked (case-insensitive)", () => {
    assert.equal(isConfidentialTarget(root, ["Maestro.json"], "maestro.JSON"), true);
  });
  it("docs/confidential/** still blocks file, dir and subdir (regression)", () => {
    const p = ["docs/confidential/**"];
    assert.equal(isConfidentialTarget(root, p, "docs/confidential/x.md"), true);
    assert.equal(isConfidentialTarget(root, p, "docs/confidential"), true);
    assert.equal(isConfidentialTarget(root, p, "docs/confidential/subdir"), true);
  });
  it("does not block non-confidential paths", () => {
    assert.equal(isConfidentialTarget(root, ["*.env", "**/*.pem"], "src/app.ts"), false);
    assert.equal(isConfidentialTarget(root, ["*.env", "**/*.pem"], "docs/readme.md"), false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test plugins/maestro-bootstrap/index.test.js`
Expected: FAIL — `isConfidentialTarget` с маской `*.env` ошибочно вернёт `true` для `config/prod.env` (старый `globMatch` пересекает `/`), а `**/*.pem` вернёт `false` для корневого `app.pem`.

- [ ] **Step 3: Implement `isConfidentialTarget`**

Замени текущее тело `isConfidentialTarget` (строки 588–603) на:

```js
export function isConfidentialTarget(root, patterns, target) {
  const rel = normalizeTarget(root, target);
  if (!rel) return false;
  const lower = rel.toLowerCase();
  for (const p of patterns ?? []) {
    if (typeof p !== "string" || !p) continue;
    const pat = p.toLowerCase();
    // Confidential-граница: сегментный матчинг (confGlobMatch). Директория,
    // поддиректории и файлы под `dir/**` покрываются самим матчером
    // (`**` матчит 0+ сегментов), поэтому отдельный префикс не нужен.
    if (confGlobMatch(pat, lower)) return true;
  }
  return false;
}
```

Примечание: старый явный блок `if (pat.endsWith("/**")) { ... }` удаляется — его поведение (сама директория, поддиректория) теперь покрывается `confGlobMatch` через `**`-матчинг нуля сегментов (проверено в Task 1 Step 1 тестом `trailing /** matches directory, subdir and file inside`).

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test plugins/maestro-bootstrap/index.test.js`
Expected: PASS (все, включая существующие confidential-тесты).

- [ ] **Step 5: Commit**

```bash
git add plugins/maestro-bootstrap/core.js plugins/maestro-bootstrap/index.test.js
git commit -m "feat(bootstrap): isConfidentialTarget uses segment-aware confGlobMatch"
```

---

### Task 3: Интеграционный регресс (enforcement через `tool.execute.before`)

**Files:**
- Modify: `plugins/maestro-bootstrap/index.test.js`

- [ ] **Step 1: Write the failing test**

Добавь в существующий `describe("maestro-bootstrap confidential enforcement")` (около строки 1065) или новый блок:

```js
describe("maestro-bootstrap confidential enforcement by mask/filename", () => {
  let dir, hooks, savedLogEnv;
  const LOG_ENV = ["MAESTRO_BOOTSTRAP_LOG_MASK", "MAESTRO_BOOTSTRAP_LOG_LEVEL", "MAESTRO_BOOTSTRAP_LOG_DIR"];

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
  };

  before(async () => {
    savedLogEnv = {};
    for (const k of LOG_ENV) { savedLogEnv[k] = process.env[k]; delete process.env[k]; }
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "fab-fmask-"));
    fs.writeFileSync(path.join(dir, "maestro.json"), JSON.stringify({
      confidential: { paths: ["*.env", "**/*.pem", "maestro.json"] },
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

  it("denies read of root-level mask file", async () => {
    const out = { args: { filePath: "prod.env" } };
    await assert.rejects(
      hooks["tool.execute.before"]({ tool: "read", sessionID: "root", callID: "m1" }, out),
      /confidential:deny/,
    );
  });
  it("does not deny read of nested file not matching root mask", async () => {
    const out = { args: { filePath: "config/prod.env" } };
    await hooks["tool.execute.before"]({ tool: "read", sessionID: "root", callID: "m2" }, out);
    assert.ok(true);
  });
  it("denies read of recursive-mask file at root", async () => {
    const out = { args: { filePath: "app.pem" } };
    await assert.rejects(
      hooks["tool.execute.before"]({ tool: "read", sessionID: "root", callID: "m3" }, out),
      /confidential:deny/,
    );
  });
  it("denies read of recursive-mask file nested", async () => {
    const out = { args: { filePath: "certs/app.pem" } };
    await assert.rejects(
      hooks["tool.execute.before"]({ tool: "read", sessionID: "root", callID: "m4" }, out),
      /confidential:deny/,
    );
  });
  it("denies read of full filename at root", async () => {
    const out = { args: { filePath: "maestro.json" } };
    await assert.rejects(
      hooks["tool.execute.before"]({ tool: "read", sessionID: "root", callID: "m5" }, out),
      /confidential:deny/,
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test plugins/maestro-bootstrap/index.test.js`
Expected: FAIL — `nested file not matching root mask` (`config/prod.env`) блокируется старым `globMatch` (ошибочный `true`), либо `recursive-mask at root` (`app.pem`) НЕ блокируется. После Task 1–2 тесты зелёные.

- [ ] **Step 3: Run to verify it passes**

Run: `node --test plugins/maestro-bootstrap/index.test.js`
Expected: PASS (зависит от Task 1–2; если Task 1–2 уже применены, тест зелёный сразу).

- [ ] **Step 4: Commit**

```bash
git add plugins/maestro-bootstrap/index.test.js
git commit -m "test(bootstrap): enforcement of confidential by mask and filename"
```

---

### Task 4: Docs — `manual_docs/reference/config.md`

**Files:**
- Modify: `manual_docs/reference/config.md:110-150`

- [ ] **Step 1: Обновить описание ключа `paths`**

В таблице секции `confidential` замени строку ключа `paths` (строка 141):

```markdown
| `paths` | `string[]` | нет | Glob-шаблоны confidential-путей. По умолчанию `["docs/confidential/**"]`. Поддерживают папки, отдельные файлы по полному имени и по маске, включая корневую папку проекта |
```

- [ ] **Step 2: Добавить подраздел про семантику масок**

После таблицы (после строки 144), перед «Кто считается trusted-субагентом», добавь:

```markdown
**Семантика масок `paths` (сегментный матчинг):**

- Паттерн матчится против проект-относительного пути, case-insensitive.
- `**` матчит 0+ сегментов, включая корень: `**/*.pem` закрывает и `app.pem`
  (в корне), и `certs/app.pem`, и `certs/nested/app.pem`.
- `*` / `?` матчат в пределах одного сегмента (не пересекают `/`).
- Паттерн без `/` и без `**` (напр. `*.env`, `maestro.json`) закрывает **только
  файлы в корневой папке** проекта; вложенный `config/prod.env` таким паттерном
  не закрывается (для него нужен `configs/*.env` или `**/*.env`).
- `{a,b}` — чередование внутри сегмента (`*.{env,local}`).
- Паттерн с `/**` на конце (напр. `docs/confidential/**`) закрывает саму
  директорию, поддиректории и файлы внутри.

> **⚠️ Контроль маски применяется только к `read`/`write`/`edit`.**
> `bash`/`glob`/`grep` не перехватываются — confidential-файл, прочитанный
> через `bash` (`cat prod.env`), плагин не заблокирует (fail-open). Для таких
> инструментов используйте нативные permissions OpenCode (2-й эшелон).

**⚠️ Отличие от `access_policy`:** маски в `access_policy` используют общий
матчер, где `*` пересекает `/` (напр. `*.env` в `deny` матчит и `config/prod.env`).
В `confidential` маска без `/` закрывает только корневые файлы. Одна и та же
маска `*.env` в двух секциях ведёт себя по-разному — это намеренно. Для
рекурсивной защиты секретов используйте `**/*.env`.
```

- [ ] **Step 3: Commit**

```bash
git add manual_docs/reference/config.md
git commit -m "docs(config): document confidential paths mask semantics"
```

---

### Task 5: Docs — `manual_docs/explanation/agents-and-trust.md` + `skills/maestro-assistant/SKILL.md` + `plugins/maestro-bootstrap/README.md`

**Files:**
- Modify: `manual_docs/explanation/agents-and-trust.md`
- Modify: `skills/maestro-assistant/SKILL.md`
- Modify: `plugins/maestro-bootstrap/README.md`

- [ ] **Step 1: `agents-and-trust.md` — заметка в подсекции confidential**

В подсекции «Защищённая папка `docs/confidential`» (строки 103–179), в блоке «Прочее», добавь пункт:

```markdown
- **Отдельные файлы и маски в `paths`:** `confidential.paths` принимает не
  только папки, но и отдельные файлы по полному имени и по маске, включая
  корневую папку проекта (напр. `maestro.json`, `*.env`, `**/*.pem`). Маска без
  `/` закрывает только корневые файлы; `**` — корень и вложенные; `*`/`?` — в
  пределах одного сегмента. Контроль применяется к `read`/`write`/`edit`;
  `bash`/`glob`/`grep` остаются вне перехвата (fail-open).
```

- [ ] **Step 2: `skills/maestro-assistant/SKILL.md` — пометка в каноне**

В секции «Секции (семантика)», после строки 79 (описание `confidential`), добавь:

```markdown
- **`confidential.paths`** — принимает папки, отдельные файлы по полному имени
  и по маске, включая корневую папку. Сегментная семантика: `**` = 0+ сегментов
  (покрывает корень), `*`/`?` — в пределах сегмента (не через `/`), маска без `/`
  (напр. `*.env`) закрывает только корневые файлы. Контроль — `read`/`write`/`edit`;
  `bash`/`glob`/`grep` не перехватываются (fail-open).
```

- [ ] **Step 3: `plugins/maestro-bootstrap/README.md` — пометка в секции `confidential`**

В секции «Секция `confidential`» (строки 103–116) добавь абзац после описания дефолта `docs/confidential/**`:

```markdown
`confidential.paths` принимает папки, отдельные файлы по полному имени и по
маске, включая корневую папку. Сегментная семантика: `**` = 0+ сегментов
(покрывает корень), `*`/`?` — в пределах одного сегмента (не через `/`), маска
без `/` (напр. `*.env`) закрывает только корневые файлы. В отличие от
`access_policy` (где `*` пересекает `/`), в `confidential` маска сегментная.
```

- [ ] **Step 4: Commit**

```bash
git add manual_docs/explanation/agents-and-trust.md skills/maestro-assistant/SKILL.md plugins/maestro-bootstrap/README.md
git commit -m "docs: note confidential single-file/mask support and fail-open scope"
```

---

### Task 6: Финальная верификация

**Files:** (нет изменений)

- [ ] **Step 1: Run full test suite**

Run: `node --test plugins/maestro-bootstrap/index.test.js`
Expected: все тесты зелёные (предыдущие confidential-тесты + новые).

- [ ] **Step 2: Run lint (если настроен)**

Проверь, есть ли lint/typecheck в `package.json` (в корне authoring-репо плагина). Если есть — выполни. Если нет — пропусти (плагин на чистом Node, без сторонних зависимостей).

- [ ] **Step 3: Confirm git status**

Run: `git status`
Expected: только запланированные файлы: `plugins/maestro-bootstrap/core.js`, `plugins/maestro-bootstrap/index.test.js`, `manual_docs/reference/config.md`, `manual_docs/explanation/agents-and-trust.md`, `skills/maestro-assistant/SKILL.md`, `plugins/maestro-bootstrap/README.md`.

---

## Self-Review

**Спека (TODO.md строка 12):** «В списке confidential не только папки, но и отдельные файлы по полному имени или по маске, в том числе в коренной папке» → Task 1 (`confGlobMatch`), Task 2 (`isConfidentialTarget`), Task 3 (enforcement), Task 4–5 (docs). Покрыто.

**Согласованные семантики (HITL):**
- Маска без `/` (`*.env`) — только корень → Task 1/2/3 тесты (`config/prod.env` → false).
- Рекурсивная `**/*.pem` — корень + вложенные → Task 1/2/3 тесты (`app.pem` → true).

**Placeholder scan:** нет TBD/TODO; весь код в шагах полный, повторён, без ссылок «как в Task N».

**Type consistency:** `confGlobMatch(pattern, value)` — оба `string`, возвращает `boolean`; используется в `isConfidentialTarget` с `pat`/`lower`. Сигнатуры согласованы между Task 1–2. `globMatch` не изменён, `resolveFileAccess` не тронут.

**Регресс `docs/confidential/**`:** Task 1 Step 1 (`trailing /**`) и Task 2 Step 1 (`docs/confidential/** still blocks...`) — гарантируют, что удаление явного `endsWith("/**")`-блока не ломает блокировку директории/поддиректории.

**access_policy:** не затрагивается (общий `globMatch` без изменений).