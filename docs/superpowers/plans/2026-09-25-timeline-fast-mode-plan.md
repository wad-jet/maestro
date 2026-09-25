# Timeline Fast-Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `timeline.mjs` — флаг `--no-children` (fast mode ~5 с без child-атрибуции) + чистый stderr (прогресс-шум CLI подавляется, диагностика только при сбое) + синхронные правки SKILL.md и DoD-доков.

**Architecture:** CLI-парсинг фильтрует флаг из позиционных; `metrics.children: "full"|"skipped"` — дискриминатор режима (аддитивный stdout-контракт); child-пул целиком прогоняется `if (!noChildren)`; обе spawn-точки `opencode export` переводятся с `stdio: inherit` на `pipe` с буфером хвоста stderr (~500 Б), при успехе отбрасывается, при сбое — одна диагностическая строка.

**Tech Stack:** Node.js (ESM, без зависимостей), node:test, bash/sh для fake-CLI в тестах.

**Spec:** `docs/superpowers/specs/2026-09-25-timeline-fast-mode-design.md`

## Global Constraints

- Backward-compat: все прежние stdout-ключи/значения без изменений; аддитивны только `metrics.children` и флаг.
- Timeout → `skipped`, остальные child-сбои → `failed` (fail-soft, как сейчас); primary-timeout НЕ добавляется; primary parse-error → `invalid_export` (контракт без изменений).
- Подлинные локальные diagnostics (JSONL fail-soft `metrics jsonl: …`) остаются в stderr; гасится только прогресс-шум CLI.
- SEC-4b: stdout — агрегаты; stderr-диагностика — только оператору, не в отчёт/stdout-JSON.
- TDD: тест → FAIL → минимальный код → PASS → commit.
- `package.json` НЕ трогать (bump 4.11.0 — после merge); `docs/roadmap.md` НЕ трогать.
- Коммиты: per-task, стиль `feat|test|docs(feedback-report): ...`.

## Review Focus

1. Многословный stderr CLI (verbose) не блокирует pipe — обработчик `data` дренирует поток. → Тест Task 2 (успех, `noise: 5` строк).
2. Fast mode не меняет primary-метрики (tokens/activeMs/questionCount/reviewDispatches). → Task 1, тест 1 (ассерт `questionCount`).
3. JSONL: fast-прогон после full заменяет строку (upsert), `children: "skipped"` — known behavior. → Task 1, тест 4.
4. Порядок флага среди позиционных аргументов + usage при отсутствии sessionID. → Task 1, тест 3.
5. Сбой child-CLI не ломает stdout-JSON-контракт (stdout — валидный JSON, fail-soft, одна диагностическая строка). → Task 2, тест «сбой child-CLI».

---

### Task 1: Флаг `--no-children` + `metrics.children`

**Files:**
- Modify: `skills/maestro-feedback-report/timeline.mjs` (строки 7–14 — парсинг, 299–309 — metrics, 311–359 — child-пул)
- Test: `skills/maestro-feedback-report/timeline.test.mjs`

**Interfaces:**
- Consumes: ничего нового (всё уже в файле).
- Produces: `metrics.children: "full" | "skipped"` в stdout-JSON и JSONL-строке; `metrics.tokensByAgent: {}` в fast mode. Task 2/3 полагаются на это поле.

- [ ] **Step 1: Обновить baseline-ожидаемое (I-1 из spec review) и написать failing-тесты**

В `timeline.test.mjs` строка 207 (`expectedEmpty.metrics`) — добавить поле `children: "full"`:

```js
  metrics: { tokens: { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, cost: null }, activeMs: null, questionCount: 0, reviewDispatches: 0, children: "full", tokensByAgent: {} },
```

Добавить фикстуру (после `fixtureTokens`, ~строка 231) — task-часть с `metadata.sessionId` + question-часть (M-3: без task-части ассерт вакуозен):

```js
const fixtureFast = {
  info: { id: "ses_fast", model: "m", time: { created: 1000, end: 5000 } },
  messages: [
    { info: { role: "user", time: { created: 1000 } }, parts: [{ type: "text", text: "hi" }] },
    {
      info: { role: "assistant", time: { created: 2000 }, tokens: { input: 10, output: 5, reasoning: 0, cache: { read: 0, write: 0 } } },
      parts: [
        { type: "tool", tool: "question", callID: "q1", state: { status: "completed", input: {}, output: "a", time: { start: 2100, end: 2200 } }, id: "tq1" },
        { type: "tool", tool: "task", callID: "t1", state: { status: "completed", input: { subagent_type: "haiku", description: "x" }, output: "ok", metadata: { sessionId: "ses_child_fast" }, time: { start: 3000, end: 4000 } }, id: "tt1" },
      ],
    },
  ],
};
```

Новые тесты (в конец файла):

```js
test("--no-children: children=skipped, tokensByAgent пуст даже при наличии task-частей (fixture)", () => {
  const path = join(tmpDir, "fast.json");
  writeFileSync(path, JSON.stringify(fixtureFast));
  const out = execFileSync(process.execPath, [scriptPath, "ses_test", path, "--no-children"], {
    encoding: "utf-8", timeout: 30000,
    env: { ...process.env, MAESTRO_TIMELINE_EXPORT_DIR: join(tmpDir, "fast-children"), MAESTRO_METRICS_JSONL: join(tmpDir, "fast.jsonl") },
  });
  const data = JSON.parse(out.trim());
  assert.equal(data.metrics.children, "skipped");
  assert.deepEqual(data.metrics.tokensByAgent, {});
  assert.equal(data.metrics.questionCount, 1);
  assert.equal(data.metrics.tokens.input, 10);
});

test("обычный прогон: metrics.children === 'full' (regression-гард нового поля)", () => {
  const data = runFixture(fixtureTokens, "childrenFull");
  assert.equal(data.metrics.children, "full");
});

test("--no-children: порядок флага среди позиционных + usage при отсутствии sessionID", () => {
  const path = join(tmpDir, "fast2.json");
  writeFileSync(path, JSON.stringify(fixtureEmpty));
  for (const a of [
    ["--no-children", "ses_test", path],
    ["ses_test", "--no-children", path],
    ["ses_test", path, "--no-children"],
  ]) {
    const out = execFileSync(process.execPath, [scriptPath, ...a], {
      encoding: "utf-8", timeout: 30000, env: { ...process.env, MAESTRO_METRICS_JSONL: join(tmpDir, "fast2.jsonl") },
    });
    assert.equal(JSON.parse(out.trim()).metrics.children, "skipped");
  }
  let err;
  try {
    execFileSync(process.execPath, [scriptPath, "--no-children"], { encoding: "utf-8", timeout: 30000, env: { ...process.env, MAESTRO_METRICS_JSONL: join(tmpDir, "fast2.jsonl") } });
    assert.fail("ожидался exit 1 (usage)");
  } catch (e) { err = e; }
  assert.equal(err.status, 1);
  assert.match(err.stderr, /Usage/);
});

test("JSONL: fast-mode строка children=skipped; full-прогон после fast заменяет строку (upsert, known behavior)", () => {
  const path = join(tmpDir, "fast3.json");
  writeFileSync(path, JSON.stringify(fixtureEmpty));
  const jsonl = join(tmpDir, "fast3.jsonl");
  const run = (a) => execFileSync(process.execPath, [scriptPath, ...a], { encoding: "utf-8", timeout: 30000, env: { ...process.env, MAESTRO_METRICS_JSONL: jsonl } });
  run(["ses_test", path, "--no-children"]);
  let lines = readFileSync(jsonl, "utf-8").trim().split("\n");
  assert.equal(lines.length, 1);
  assert.equal(JSON.parse(lines[0]).metrics.children, "skipped");
  run(["ses_test", path]);
  lines = readFileSync(jsonl, "utf-8").trim().split("\n");
  assert.equal(lines.length, 1);
  assert.equal(JSON.parse(lines[0]).metrics.children, "full");
});
```

- [ ] **Step 2: Прогнать тесты — новые FAIL, baseline PASS**

Run: `node --test skills/maestro-feedback-report/timeline.test.mjs`
Expected: 4 новых теста FAIL (`children` отсутствует / флаг не распознан), остальные 24 PASS (expectedEmpty уже с `children: "full"` → без кода test "empty export" FAIL — это ожидаемо: он фиксирует новый контракт).

- [ ] **Step 3: Минимальная реализация**

`timeline.mjs` строки 7–14 — заменить на:

```js
const rawArgs = process.argv.slice(2);
const noChildren = rawArgs.includes("--no-children");
const args = rawArgs.filter((a) => a !== "--no-children");
if (args.length < 1) {
  process.stderr.write("Usage: timeline.mjs <sessionID> [path-to-export.json] [--no-children]\n");
  process.exit(1);
}

const sessionID = args[0];
const exportPath = args[1];
```

Строки 299–309 (`const metrics = {`) — добавить поле `children` перед `tokensByAgent`:

```js
  questionCount,
  reviewDispatches,
  children: noChildren ? "skipped" : "full",
  tokensByAgent: {},
};
```

Строки 311–359 (блок `// --- metrics.tokensByAgent (child-экспорт) ---` … `metrics.tokensByAgent = agentBuckets;`) — обернуть в:

```js
if (!noChildren) {
  // ... весь существующий блок без изменений ...
}
```

JSONL-блок (404–431) не трогать — `metrics` с `children` попадает в строку автоматически.

- [ ] **Step 4: Прогнать тесты — все PASS**

Run: `node --test skills/maestro-feedback-report/timeline.test.mjs`
Expected: 28/28 (24 baseline + 4 новых).

- [ ] **Step 5: Commit**

```bash
git add skills/maestro-feedback-report/timeline.mjs skills/maestro-feedback-report/timeline.test.mjs
git commit -m "feat(feedback-report): timeline.mjs — флаг --no-children (fast mode) + metrics.children"
```

---

### Task 2: Чистый stderr (обе spawn-точки)

**Files:**
- Modify: `skills/maestro-feedback-report/timeline.mjs` (строка 3 — импорт, ~47–74 — child spawn, ~96–110 — primary spawn)
- Test: `skills/maestro-feedback-report/timeline.test.mjs`

**Interfaces:**
- Consumes: Task 1 (поле `metrics.children` для ассертов).
- Produces: при успехе stderr helper пуст; при сбое — одна строка `[timeline] export failed: <sessionID> — <tail>` (tail ≤ 500 Б хвоста stderr CLI). stdout-контракт без изменений.

- [ ] **Step 1: Написать failing-тесты**

Импорт (строка 3): `import { execFileSync, spawn, spawnSync } from "node:child_process";`

Фикстура с task-частью (обе spawn-точки: primary + child) + helper fake-CLI (прецедент — тесты «shim opencode»/«large export»):

```js
const fixtureStderr = {
  info: { id: "ses_stderr", model: "m", time: { created: 1000, end: 5000 } },
  messages: [
    { info: { role: "user", time: { created: 1000 } }, parts: [{ type: "text", text: "hi" }] },
    {
      info: { role: "assistant", time: { created: 2000 }, tokens: { input: 5, output: 3, reasoning: 0, cache: { read: 0, write: 0 } } },
      parts: [
        { type: "tool", tool: "task", callID: "t1", state: { status: "completed", input: { subagent_type: "haiku", description: "x" }, output: "ok", metadata: { sessionId: "ses_child_bad" }, time: { start: 3000, end: 4000 } }, id: "tt1" },
      ],
    },
  ],
};

// fake-`opencode` (sh) в temp-dir в PATH: шум в stderr + JSON в stdout;
// failChild — сбой только для child-sid; failAll — сбой для всех вызовов
function makeFakeOpencode(dirName, { failChild = false, failAll = false, noise = 1 } = {}) {
  const dir = join(tmpDir, dirName);
  try { rmSync(dir, { recursive: true, force: true }); } catch { }
  mkdirSync(dir);
  const fixturePath = join(dir, "fixture.json");
  writeFileSync(fixturePath, JSON.stringify(fixtureStderr));
  const lines = ["#!/bin/sh"];
  if (failAll) {
    lines.push("echo 'boom-detail' >&2; exit 1");
  } else {
    if (failChild) lines.push('if [ "$2" = "ses_child_bad" ]; then echo "boom-detail" >&2; exit 1; fi');
    for (let i = 0; i < noise; i++) lines.push("echo 'progress-noise-" + i + "' >&2");
    lines.push('cat "' + fixturePath + '"');
  }
  const sh = join(dir, "opencode");
  writeFileSync(sh, lines.join("\n"));
  chmodSync(sh, "755");
  return dir;
}

function runReal(dir, sessionID, extraArgs = []) {
  return spawnSync(process.execPath, [scriptPath, sessionID, ...extraArgs], {
    encoding: "utf-8", timeout: 30000,
    env: { ...process.env, PATH: dir + ":" + process.env.PATH, MAESTRO_METRICS_JSONL: join(tmpDir, "real.jsonl") },
  });
}
```

Тесты (в конец файла):

```js
test("stderr: прогресс-шум CLI подавляется при успехе (обе spawn-точки, многословный stderr)", () => {
  const dir = makeFakeOpencode("stderr_ok", { noise: 5 });
  const r = runReal(dir, "ses_stderr");
  assert.equal(r.status, 0);
  const data = JSON.parse(r.stdout.trim());
  assert.ok(data.metrics.tokensByAgent.haiku, "child-пул должен был отработать (task-часть с metadata.sessionId)");
  assert.equal(r.stderr, "");
});

test("stderr: сбой child-CLI → ровно одна диагностическая строка с tail, stdout-JSON валиден (fail-soft)", () => {
  const dir = makeFakeOpencode("stderr_cfail", { failChild: true, noise: 3 });
  const r = runReal(dir, "ses_stderr_c");
  assert.equal(r.status, 0);
  const data = JSON.parse(r.stdout.trim());
  assert.equal(data.metrics.children, "full");
  assert.ok(data.metrics.tokensByAgent.haiku.failed >= 1);
  const lines = r.stderr.trim().split("\n");
  assert.equal(lines.length, 1);
  assert.match(lines[0], /\[timeline\] export failed: ses_child_bad/);
  assert.match(lines[0], /boom-detail/);
});

test("stderr: сбой primary-CLI → diag-строка + export_failed + exit 1", () => {
  const dir = makeFakeOpencode("stderr_pfail", { failAll: true });
  const r = runReal(dir, "ses_stderr_p");
  assert.equal(r.status, 1);
  assert.match(r.stdout, /"error":"export_failed"/);
  const lines = r.stderr.trim().split("\n");
  assert.equal(lines.length, 1);
  assert.match(lines[0], /\[timeline\] export failed: ses_stderr_p/);
});
```

- [ ] **Step 2: Прогнать тесты — новые FAIL**

Run: `node --test skills/maestro-feedback-report/timeline.test.mjs`
Expected: 3 новых FAIL (stderr содержит `progress-noise-*` / пуст при сбое).

- [ ] **Step 3: Минимальная реализация**

`timeline.mjs`, child-промис (функция `exportSession`, блок `return await new Promise((resolve, reject) => {` ~строка 47):

```js
  return await new Promise((resolve, reject) => {
    const tmpFile = join(tmpdir(), `maestro-child-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
    const fd = openSync(tmpFile, "w");
    const child = spawn("opencode", ["export", sessionID], { stdio: ["ignore", fd, "pipe"] });
    let errTail = "";
    child.stderr.on("data", (d) => { errTail = (errTail + d).slice(-500); });
    const fail = (e) => {
      try { process.stderr.write(`[timeline] export failed: ${sessionID} — ${errTail.trim().slice(-300) || "no stderr"}\n`); } catch {}
      reject(e);
    };
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      try { child.kill("SIGKILL"); } catch {}
      try { closeSync(fd); } catch {}
      try { unlinkSync(tmpFile); } catch {}
      fail(new Error("child_export_timeout"));
    }, timeoutMs);
    child.on("error", (e) => { if (done) return; done = true; clearTimeout(timer); try { closeSync(fd); } catch {}; try { unlinkSync(tmpFile); } catch {}; fail(e); });
    child.on("exit", (code) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { closeSync(fd); } catch {}
      if (code !== 0) { try { unlinkSync(tmpFile); } catch {}; fail(new Error("export_failed")); return; }
      let raw;
      try { raw = readFileSync(tmpFile, "utf-8"); } catch (e) { try { unlinkSync(tmpFile); } catch {}; fail(e); return; }
      try { unlinkSync(tmpFile); } catch {}
      if (!raw || !raw.trim()) { fail(new Error("export_failed")); return; }
      try { resolve(JSON.parse(raw)); } catch { fail(new Error("invalid_export")); }
    });
  });
```

Primary spawn (блок `await new Promise((resolve, reject) => {` ~строка 96):

```js
        const fd = openSync(tmpFile, "w");
        const child = spawn("opencode", ["export", sessionID], {
          stdio: ["ignore", fd, "pipe"],
        });
        let errTail = "";
        child.stderr.on("data", (d) => { errTail = (errTail + d).slice(-500); });
        child.on("exit", (code) => {
          closeSync(fd);
          if (code !== 0) {
            process.stderr.write(`[timeline] export failed: ${sessionID} — ${errTail.trim().slice(-300) || "no stderr"}\n`);
            reject(new Error("export failed"));
          } else {
            resolve();
          }
        });
        child.on("error", (e) => {
          process.stderr.write(`[timeline] export failed: ${sessionID} — ${errTail.trim().slice(-300) || "no stderr"}\n`);
          reject(e);
        });
```

- [ ] **Step 4: Прогнать тесты — все PASS**

Run: `node --test skills/maestro-feedback-report/timeline.test.mjs`
Expected: 31/31 (28 из Task 1 + 3 новых).

- [ ] **Step 5: Commit**

```bash
git add skills/maestro-feedback-report/timeline.mjs skills/maestro-feedback-report/timeline.test.mjs
git commit -m "fix(feedback-report): timeline.mjs — чистый stderr (pipe+tail, диагностика только при сбое)"
```

---

### Task 3: SKILL.md + DoD-волна + dogfooding

**Files:**
- Modify: `skills/maestro-feedback-report/SKILL.md` (секции 3c/3d + шаблон «Токены по агентам»)
- Modify: `manual_docs/overview/changelog.md`, `manual_docs/reference/commands.md`, `docs/project-context.md` (§10)
- Create: `regression/entries/2026-09-25-timeline-fast-mode.md`
- НЕ трогать: `docs/roadmap.md`, `package.json`

**Interfaces:**
- Consumes: `metrics.children` (Task 1), поведение stderr (Task 2).
- Produces: синхронные доки (DoD фичи 4.11.0).

- [ ] **Step 1: SKILL.md — 3 правки**

(a) Секция 3c, после абзаца «Скрипт сам вызывает `opencode export <Session ID>`...» (строка ~120) добавить:

```markdown
  **Сохрани stdout в temp-файл и переиспользуй** (3c/3d/шаблон) — НЕ
  перезапускай скрипт: полный прогон с child fanout (cap 100) занимает 2–4 мин.
```

(b) Секция 3d, в список полей после `reviewDispatches` добавить буллит:

```markdown
- `children` (`"full"` | `"skipped"`): fast mode — флаг `--no-children`
  (запуск ~5 c); при `"skipped"` — `tokensByAgent` пуст, атрибуция по агентам
  недоступна. **По умолчанию — полный прогон**; `--no-children` — только если
  атрибуция по агентам не нужна.
```

(c) Шаблон отчёта, блок таблицы «Токены по агентам» — перед таблицей добавить строку fallback:

```markdown
Если `metrics.children: "skipped"` — вместо таблицы: «Атрибуция по агентам
недоступна (fast mode `--no-children`)».
```

- [ ] **Step 2: DoD-доки**

(a) `manual_docs/overview/changelog.md` — в начало (после преамбулы) создать:

```markdown
## [Unreleased]

### Добавлено

- **Fast mode `--no-children` и чистый stderr в `timeline.mjs` (4.11.0):**
  быстрый прогон `@maestro-feedback-report` (~5 c) без child-атрибуции
  (`metrics.children: "skipped"`; по умолчанию — полный прогон); прогресс-шум
  CLI `opencode export` в stderr подавлен, при сбое — одна диагностическая
  строка с хвостом (подлинные diagnostics, напр. JSONL fail-soft, сохраняются).
  Known limitation: полный прогон ~2–4 мин при cap-100 child-сессиях;
  fast-прогон после full затирает атрибуцию в JSONL-строке (known behavior).
  Регресс: `regression/entries/2026-09-25-timeline-fast-mode.md`.
```

(b) `manual_docs/reference/commands.md` — в блок «**Метрики пайплайна и Effort** (4.10.0)» (~строка 95) добавить в конец блока строку:

```markdown
  Fast mode `--no-children` (запуск ~5 c, без атрибуции по агентам;
  `metrics.children: "skipped"`).
```

(c) `regression/entries/2026-09-25-timeline-fast-mode.md` — создать в каноническом формате репо (сверь структуру с ближайшими соседями, напр. `regression/entries/2026-09-24-pipeline-metrics-effort.md`): version 4.11.0 (целевая; код плагина не меняется — 4.9.0), added 2026-09-25, risk LOW, scenarios: `[Auto] node --test skills/maestro-feedback-report/timeline.test.mjs` (фактический счёт) + `[Manual] живой прогон` (факты из Step 4: stderr пуст, fast mode ~секунды, `children: "skipped"`), known limitations (полный прогон 2–4 мин; fast после full — JSONL-даунгрейд; worst-case ~12 мин при виснущих child — pre-existing 4.10.0), SEC-4b (stderr — диагностика оператора, не в отчёт), non-goals (кэш child-экспортов, concurrency/cap/timeout, dead-code shim — follow-up, streaming JSONL, Error-классы).

(d) `docs/project-context.md` §10 — строка счётчика timeline-тестов: фактический счёт из Step 5 (ожидается 31).

- [ ] **Step 3: Self-review**

- [ ] SKILL.md: 3 вставки на месте (3c — после абзаца про временный файл; 3d — буллит `children`; шаблон — fallback перед таблицей); остальные секции не тронуты (diff — только 3 вставки)
- [ ] changelog — секция `[Unreleased]` создана, буллит по канону (жирное название + версия + Регресс-ссылка)
- [ ] regression entry — структура как у соседей (порядок полей)
- [ ] project-context §10 — счёт = факт из прогона, не из плана
- [ ] `docs/roadmap.md` и `package.json` — не в diff

- [ ] **Step 4: Dogfooding (AC №2)**

Сессия с child-сессиями: `ses_f3815a664ffeVmICSkqQEpvxtW` (123 task-диспатча; полный прогон ~2–3 мин — это ожидание, не сбой):

```bash
node skills/maestro-feedback-report/timeline.mjs ses_f3815a664ffeVmICSkqQEpvxtW > /tmp/tl-full.json 2>/tmp/tl-full.err
echo "exit=$? stderr-bytes=$(wc -c < /tmp/tl-full.err)"
node skills/maestro-feedback-report/timeline.mjs ses_f3815a664ffeVmICSkqQEpvxtW --no-children > /tmp/tl-fast.json 2>/tmp/tl-fast.err
echo "exit=$? stderr-bytes=$(wc -c < /tmp/tl-fast.err)"
```

Контроли (зафиксировать факты в отчёт и regression entry): полный прогон — `metrics.children === "full"`, `tokensByAgent` непуст, **stderr пуст (0 байт)**; fast — `children === "skipped"`, `tokensByAgent === {}`, длительность ~5–10 с, stderr пуст. `.maestro/metrics/history.jsonl` — эфемерное, в git не попадает.

- [ ] **Step 5: Полный прогон тестов**

```bash
node --test skills/maestro-feedback-report/timeline.test.mjs
node --test plugins/maestro-bootstrap/index.test.js
```

Expected: всё зелёное; фактические счётчики → в project-context §10 и regression entry.

- [ ] **Step 6: Commit**

```bash
git add skills/maestro-feedback-report/SKILL.md manual_docs/overview/changelog.md manual_docs/reference/commands.md docs/project-context.md regression/entries/2026-09-25-timeline-fast-mode.md
git commit -m "docs(feedback-report): fast mode — SKILL.md + DoD-волна (4.11.0) + regression entry"
```
