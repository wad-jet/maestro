# Pipeline Metrics & Effort Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Блок «Метрики пайплайна и Effort» в `@maestro-feedback-report`: 0-LLM механика в `timeline.mjs` (токены primary/child-сессий, cost, activeMs, HITL, циклы ревью, JSONL-история) + раздел отчёта с методологией Effort.

**Architecture:** Один helper (`timeline.mjs`, ESM, 0 deps) вычисляет новый блок `metrics` из того же `opencode export` (primary) + child-экспортов сабагентов (по `task.state.metadata.sessionId`, concurrency 4, cap 100, таймаут 30 c, fail-soft) и атомарно пишет строку в `.maestro/metrics/history.jsonl` (upsert по sessionID). Отчётный скилл получает готовые агрегаты (stdout-JSON) и добавляет LLM-нарратив («факторы влияния», фактические циклы). Плагин НЕ меняется.

**Tech Stack:** Node.js ESM, встроенный test runner (`node --test`), `opencode export` CLI, Markdown-скиллы.

**Spec:** `docs/superpowers/specs/2026-09-24-pipeline-metrics-effort-design.md` (approve, подписи sanitize+review).

## Global Constraints

- Node.js ESM, **0 новых зависимостей** (только node built-ins + существующий `opencode` CLI в PATH).
- **0 LLM** в механике helper'а: stdout-JSON и JSONL — только детерминированные агрегаты.
- **SEC-4b:** в stdout/JSONL/отчёт — только агрегаты (числа, имена агентов); `state.title` используется **только in-process** для матчинга и нигде не выводится; temp-файлы экспортов удаляются.
- **Backward-compat:** существующие ключи stdout-JSON (`session/totals/agents/tools/bash/top_ops/gaps/timeline`) — без изменений.
- Child-экспорт всегда **без флага `--sanitize`** (флаг редактит `tool-title`/`tool-state-metadata`).
- Детерминированные константы: **concurrency 4, cap 100, таймаут 30 c** (таймаут override-ится env-переменной для тестов).
- JSONL: `.maestro/metrics/history.jsonl` (override env `MAESTRO_METRICS_JSONL`), запись **tmp+rename** (атомарно), чтение с пропуском невалидных строк (self-healing), upsert по `sessionID` (M-9).
- Тест-сеамы (env, production-по умолчанию): `MAESTRO_TIMELINE_EXPORT_DIR` (fixture-каталог child-экспортов), `MAESTRO_CHILD_EXPORT_TIMEOUT_MS` (таймаут), `MAESTRO_METRICS_JSONL` (путь JSONL). Все тесты — с изолированными значениями (M-8: фикстурные прогоны не пишут в реальный `.maestro/`).
- **Плагин не меняется:** `node --test plugins/maestro-bootstrap/index.test.js` — без регрессий; фактический счёт — из прогона (прецедент #113, хардкод числа не использовать).
- **Версия 4.10.0 — НЕ на ветке:** bump — шаг 18 пайплайна после merge на main (паттерн #113); `package.json` в план не входит.
- Workdir всех команд — корень репо `/Users/odemidov/Documents/dev/github/maestro-agent`.
- Коммиты — per-task (SDD); сообщения: `feat(feedback-report): ...` / `docs(feedback-report): ...`.

## Spec-follow-up (OQ-5, не блокировали Approve — исполняются в плане)

- **M-8** (изоляция тестов от JSONL-записи) → Task 2 (runFixture env + cwd-изоляция новых тестов).
- **M-9** (атомарность history.jsonl: tmp+rename + self-healing read) → Task 3.
- **Answers-1** (cross-check top-level `info.tokens` — ассерт тестов/dogfooding, в runtime не попадает) → Task 1 (тест cross-check) + Task 5 (dogfooding-контроль).
- **Answers-2** (асимметрия «Агенты» 3c vs `tokensByAgent.count`) → Task 4 (пометка в шаблоне отчёта).
- **Answers-3** (Таблица решений A1 — «(фиксируется: 4)») → Task 4 НЕ затрагивает spec; фиксируется в плане (эта строка) — правка approved-спеки не требуется.
- **Риски #1 (уточнение формулировки, из контрольного ревью):** «типично 25–50 c; худший случай ~12.5 мин (ceil(100/4) × 30 c — все child-экспорты зависли)». Уточнение живёт здесь (план), approved-спека не правится.

## Review Focus

1. **Сессия с task-частями > 100 unique child-сессий** → cap: первые 100 экспортируются, остальные `skipped`; run завершается, вывод валиден. (Тест — Task 2.)
2. **Зависший child-`opencode export`** → таймаут (30 c / test-env) → `skipped`, основной вывод и JSONL не блокируются. (Тест — Task 2.)
3. **Дрейф формата экспорта** (нет `info.tokens` / `metadata.sessionId` / `title` / `state` у task-части) → нули/null/0, без исключений; backward-compat-ключи идентичны. (Тесты — Task 1 + 2.)
4. **Два параллельных запуска helper'а** (auto-режим, две сессии) → upsert через tmp+rename без torn-строк; невалидные строки пропускаются при чтении. (Тест — Task 3.)
5. **Провайдер без прайсинга** (все `info.cost` = 0/absent) → `cost: null` (не 0); отчёт показывает «—». (Тест — Task 1; шаблон — Task 4.)

## File Structure

| Файл | Ответственность |
|---|---|
| `skills/maestro-feedback-report/timeline.mjs` (modify) | CLI-скрипт: существующие агрегаты + новый блок `metrics` + child-экспорт + JSONL-запись. Один файл, как сейчас (247 → ~400 строк) — split не требуется (единая ответственность: агрегаты сессии) |
| `skills/maestro-feedback-report/timeline.test.mjs` (modify) | Фикстурные тесты (spawn-скрипт с 2-м аргументом export-JSON + env-сеамы) |
| `skills/maestro-feedback-report/SKILL.md` (modify) | Раздел «Метрики пайплайна и Effort» + шаблон отчёта |
| `manual_docs/reference/commands.md` (modify) | Синк описания `@maestro-feedback-report` |
| `manual_docs/overview/changelog.md` (modify) | Буллит в `[Unreleased]` |
| `docs/project-context.md` (modify) | §10 — число timeline-тестов + фикс дрейфа plugin-test-count (236 → актуальный из прогона) |
| `docs/roadmap.md` (modify) | #109/#115 → выполнено (4.10.0) + историческая пометка метки «4.8.x» |
| `regression/entries/2026-09-24-pipeline-metrics-effort.md` (create) | Regression entry |

Test baseline: `timeline.test.mjs` — 11 тестов (`node --test skills/maestro-feedback-report/timeline.test.mjs`).

---

### Task 1: `metrics`-блок (primary-данные): tokens, activeMs, questionCount, reviewDispatches

**Files:**
- Modify: `skills/maestro-feedback-report/timeline.mjs`
- Test: `skills/maestro-feedback-report/timeline.test.mjs`

**Interfaces:**
- Consumes: существующий парсинг `exportData` (messages, `sessionDurationMs`, `idleWaitMs`) — не меняется.
- Produces: `result.metrics = { tokens: {input, output, reasoning, cacheRead, cacheWrite, cost}, activeMs: number|null, questionCount: number, reviewDispatches: number }` — Task 2 расширяет тем же объектом (`tokensByAgent`), Task 3 пишет его в JSONL.

- [ ] **Step 1: Write the failing tests**

В `timeline.test.mjs` — новые фикстуры и тесты (добавить после существующих):

```js
const fixtureTokens = {
  info: { id: "ses_tok", model: "m", cost: 1.5, tokens: { input: 130, output: 70, reasoning: 5, cache: { read: 10, write: 2 } } },
  messages: [
    { info: { role: "user", time: { created: 1000 } }, parts: [{ type: "text", text: "hi" }] },
    {
      info: { role: "assistant", time: { created: 2000 }, tokens: { input: 100, output: 50, reasoning: 5, cache: { read: 10, write: 2 } }, cost: 1.0 },
      parts: [
        { type: "tool", tool: "question", callID: "q1", state: { status: "completed", input: {}, output: "a", time: { start: 2100, end: 2200 } }, id: "tq1" },
      ],
    },
    {
      info: { role: "assistant", time: { created: 3000 }, tokens: { input: 30, output: 20, reasoning: 0, cache: { read: 0, write: 0 } }, cost: 0.5 },
      parts: [
        { type: "tool", tool: "task", callID: "r1", state: { status: "completed", input: { subagent_type: "opus", description: "x" }, output: "ok", title: "Review feature X", time: { start: 3100, end: 3500 } }, id: "tr1" },
        { type: "tool", tool: "task", callID: "r2", state: { status: "completed", input: { subagent_type: "opus", description: "y" }, output: "ok", title: "Preview check", time: { start: 3600, end: 3900 } }, id: "tr2" },
        { type: "tool", tool: "task", callID: "r3", state: { status: "pending", input: { subagent_type: "opus", description: "z" }, title: "Review spec", time: { start: 4000 } }, id: "tr3" },
        { type: "tool", tool: "task", callID: "r4", state: { status: "completed", input: { subagent_type: "opus", description: "w" }, output: "ok", title: "Ревью по спеке", time: { start: 4100, end: 4400 } }, id: "tr4" },
      ],
    },
  ],
};

test("metrics.tokens — сумма по assistant-сообщениям + cross-check с info.tokens", () => {
  const out = runFixture(fixtureTokens, "tokens");
  assert.deepEqual(out.metrics.tokens, { input: 130, output: 70, reasoning: 5, cacheRead: 10, cacheWrite: 2, cost: 1.5 });
  // cross-check (spec Answers-1): сумма сообщений == top-level info.tokens
  const top = fixtureTokens.info.tokens;
  assert.equal(out.metrics.tokens.input, top.input);
  assert.equal(out.metrics.tokens.cacheRead, top.cache.read);
});

test("metrics.tokens.cost — все 0/absent → null", () => {
  const data = {
    info: { id: "ses_nc", model: "m" },
    messages: [
      { info: { role: "user", time: { created: 1000 } }, parts: [] },
      { info: { role: "assistant", time: { created: 2000 }, tokens: { input: 10, output: 5, reasoning: 0, cache: { read: 0, write: 0 } }, cost: 0 }, parts: [] },
    ],
  };
  const out = runFixture(data, "cost-null");
  assert.equal(out.metrics.tokens.cost, null);
});

test("metrics.activeMs — duration − idleWait (floor 0); null без таймстампов", () => {
  const out = runFixture(fixtureTokens, "tokens");
  // duration = 4400−1000 = 3400; idleWait: user-gap до первого assistant (2000−2000=0; assistantTs изначально null → max(0, ts−ts)=0)
  assert.equal(out.metrics.activeMs, 3400 - (out.totals.idleWaitMs || 0));
  const noTs = { info: { id: "ses_nt" }, messages: [{ info: { role: "user" }, parts: [] }] };
  const out2 = runFixture(noTs, "no-ts");
  assert.equal(out2.metrics.activeMs, null);
});

test("metrics.questionCount и reviewDispatches — completed-only, граница слова", () => {
  const out = runFixture(fixtureTokens, "tokens");
  assert.equal(out.metrics.questionCount, 1);
  assert.equal(out.metrics.reviewDispatches, 2); // "Review feature X" + "Ревью по спеке"; "Preview" и pending — нет
});

test("metrics — drift-формата: нет tokens/title/state → нули, без исключений", () => {
  const data = {
    info: { id: "ses_drift" },
    messages: [
      { info: { role: "assistant", time: { created: 2000 } }, parts: [
        { type: "tool", tool: "task", callID: "d1", state: { status: "completed", input: { subagent_type: "opus" } }, id: "td1" },
      ] },
    ],
  };
  const out = runFixture(data, "drift");
  assert.deepEqual(out.metrics.tokens, { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, cost: null });
  assert.equal(out.metrics.reviewDispatches, 0);
  assert.equal(out.metrics.questionCount, 0);
});
```

Обновить существующий тест «empty export» (full `deepEqual` всего stdout): в expected-объект добавить:

```js
metrics: { tokens: { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, cost: null }, activeMs: null, questionCount: 0, reviewDispatches: 0, tokensByAgent: {} },
```

Ключ `tokensByAgent` присутствует в `metrics` **с Task 1** (пустой объект; Task 2 наполнит) — единая форма на всех этапах, ассерт Task 1 включает `tokensByAgent: {}`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test skills/maestro-feedback-report/timeline.test.mjs`
Expected: FAIL — «Cannot read properties of undefined (reading 'tokens')» / `out.metrics` undefined (5 новых тестов), 11 baseline PASS.

- [ ] **Step 3: Implement minimal code**

В `timeline.mjs`, после цикла `for (const msg of messages) {...}` (до `topOpsResult`), добавить:

```js
// --- metrics (primary-данные) ---
let mInput = 0, mOutput = 0, mReasoning = 0, mCacheRead = 0, mCacheWrite = 0;
let costSum = 0, costSeen = false;
let questionCount = 0;
let reviewDispatches = 0;
const REVIEW_RE = /\breview\b|ревью/i;

for (const msg of messages) {
  const info = msg.info || {};
  if (info.role === "assistant") {
    const t = info.tokens;
    if (t && typeof t === "object") {
      mInput += t.input || 0;
      mOutput += t.output || 0;
      mReasoning += t.reasoning || 0;
      mCacheRead += (t.cache && t.cache.read) || 0;
      mCacheWrite += (t.cache && t.cache.write) || 0;
    }
    if (typeof info.cost === "number" && info.cost > 0) { costSum += info.cost; costSeen = true; }
  }
  const parts = Array.isArray(msg.parts) ? msg.parts : [];
  for (const p of parts) {
    if (typeof p !== "object" || !p || p.type !== "tool") continue;
    if (p.tool === "question") questionCount++;
    if (p.tool === "task") {
      const st = p.state;
      if (st && st.status === "completed" && typeof st.title === "string" && REVIEW_RE.test(st.title)) {
        reviewDispatches++;
      }
    }
  }
}

const metrics = {
  tokens: {
    input: mInput, output: mOutput, reasoning: mReasoning,
    cacheRead: mCacheRead, cacheWrite: mCacheWrite,
    cost: costSeen ? costSum : null,
  },
  activeMs: sessionDurationMs === null ? null : Math.max(0, sessionDurationMs - idleWaitMs),
  questionCount,
  reviewDispatches,
  tokensByAgent: {},
};
```

В объект `result` (вместе с `timeline`) добавить ключ `metrics`.

Примечание: ключ `tokensByAgent` присутствует в `metrics` с Task 1 (пустой объект — Task 2 наполнит); expected empty-export включает `tokensByAgent: {}` сразу.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test skills/maestro-feedback-report/timeline.test.mjs`
Expected: PASS — 11 baseline + 5 новых = 16.

- [ ] **Step 5: Commit**

```bash
git add skills/maestro-feedback-report/timeline.mjs skills/maestro-feedback-report/timeline.test.mjs
git commit -m "feat(feedback-report): timeline.mjs — metrics-блок (tokens/activeMs/questionCount/reviewDispatches) + тесты"
```

---

### Task 2: `tokensByAgent` — child-экспорт (concurrency 4, cap 100, таймаут 30 c, fail-soft) + M-8 изоляция тестов

**Files:**
- Modify: `skills/maestro-feedback-report/timeline.mjs`
- Test: `skills/maestro-feedback-report/timeline.test.mjs`

**Interfaces:**
- Consumes: `result.metrics` из Task 1 (наполняет `tokensByAgent`); парсинг task-частей.
- Produces: `metrics.tokensByAgent = { [subagent_type]: { count, input, output, reasoning, cacheRead, cacheWrite, skipped, failed } }`; env-сеамы `MAESTRO_TIMELINE_EXPORT_DIR`, `MAESTRO_CHILD_EXPORT_TIMEOUT_MS` (используются тестами Task 3/5 и dogfooding'ом).
- Функция `exportSession(sessionID, { timeoutMs })` — модуль-внутренняя; production — spawn `opencode export <id>` (tmp-файл, timeout), fixture-mode (`MAESTRO_TIMELINE_EXPORT_DIR`) — чтение `<dir>/<id>.json`, `<dir>/<id>.hang` — сон `max(timeoutMs*5, 2000)` мс (эмуляция зависания).

- [ ] **Step 1: M-8 — изоляция существующих тестов**

В `timeline.test.mjs` — `runFixture`/`runFixtureFail` дополнить env (чтобы ЛЮБЫЕ фикстурные прогоны не писали в реальный `.maestro/`):

```js
const fixtureMetricsJsonl = join(tmpDir, "metrics-history.jsonl");

function runFixture(data, name, extraEnv = {}) {
  const path = join(tmpDir, `${name}.json`);
  writeFileSync(path, JSON.stringify(data));
  const out = execFileSync(process.execPath, [scriptPath, "ses_test", path], {
    encoding: "utf-8",
    timeout: 30000,
    env: { ...process.env, MAESTRO_METRICS_JSONL: fixtureMetricsJsonl, ...extraEnv },
  });
  return JSON.parse(out.trim());
}
```

(`runFixtureFail` — аналогично env-параметром; signature-смена вызовов не требуется.)

- [ ] **Step 2: Write the failing tests (tokensByAgent)**

```js
function childFixture(id, tokens) {
  return JSON.stringify({ info: { id, tokens }, messages: [] });
}

test("tokensByAgent — атрибуция по child-экспорту (fixture-mode)", () => {
  const exportDir = join(tmpDir, "child-export-1");
  mkdirSync(exportDir, { recursive: true });
  writeFileSync(join(exportDir, "child_a.json"), childFixture("child_a", { input: 100, output: 10, reasoning: 0, cache: { read: 5, write: 0 } }));
  writeFileSync(join(exportDir, "child_b.json"), childFixture("child_b", { input: 50, output: 5, reasoning: 0, cache: { read: 0, write: 0 } }));
  const data = {
    info: { id: "ses_ca" },
    messages: [
      { info: { role: "assistant", time: { created: 2000 } }, parts: [
        { type: "tool", tool: "task", callID: "c1", state: { status: "completed", input: { subagent_type: "sonnet" }, output: "ok", metadata: { sessionId: "child_a" }, time: { start: 2100, end: 2500 } }, id: "tc1" },
        { type: "tool", tool: "task", callID: "c2", state: { status: "completed", input: { subagent_type: "haiku" }, output: "ok", metadata: { sessionId: "child_b" }, time: { start: 2600, end: 2900 } }, id: "tc2" },
      ] },
    ],
  };
  const out = runFixture(data, "by-agent", { MAESTRO_TIMELINE_EXPORT_DIR: exportDir });
  assert.deepEqual(out.metrics.tokensByAgent.sonnet, { count: 1, input: 100, output: 10, reasoning: 0, cacheRead: 5, cacheWrite: 0, skipped: 0, failed: 0 });
  assert.deepEqual(out.metrics.tokensByAgent.haiku, { count: 1, input: 50, output: 5, reasoning: 0, cacheRead: 0, cacheWrite: 0, skipped: 0, failed: 0 });
});

test("tokensByAgent — дубль sessionId: токены 1 раз, count = task-части; атрибуция по первому subagent_type", () => {
  const exportDir = join(tmpDir, "child-export-2");
  mkdirSync(exportDir, { recursive: true });
  writeFileSync(join(exportDir, "child_d.json"), childFixture("child_d", { input: 77, output: 7, reasoning: 0, cache: { read: 0, write: 0 } }));
  const data = {
    info: { id: "ses_dup" },
    messages: [
      { info: { role: "assistant", time: { created: 2000 } }, parts: [
        { type: "tool", tool: "task", callID: "c1", state: { status: "completed", input: { subagent_type: "sonnet" }, output: "ok", metadata: { sessionId: "child_d" }, time: { start: 2100, end: 2500 } }, id: "tc1" },
        { type: "tool", tool: "task", callID: "c2", state: { status: "completed", input: { subagent_type: "haiku" }, output: "ok", metadata: { sessionId: "child_d" }, time: { start: 2600, end: 2900 } }, id: "tc2" },
      ] },
    ],
  };
  const out = runFixture(data, "dup", { MAESTRO_TIMELINE_EXPORT_DIR: exportDir });
  assert.deepEqual(out.metrics.tokensByAgent.sonnet, { count: 1, input: 77, output: 7, reasoning: 0, cacheRead: 0, cacheWrite: 0, skipped: 0, failed: 0 });
  assert.deepEqual(out.metrics.tokensByAgent.haiku, { count: 1, input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, skipped: 0, failed: 0 });
});

test("tokensByAgent — без metadata.sessionId → игнор; failed (нет fixture); over-cap → skipped", () => {
  const exportDir = join(tmpDir, "child-export-3");
  mkdirSync(exportDir, { recursive: true });
  const parts = [];
  for (let i = 0; i < 105; i++) {
    parts.push({ type: "tool", tool: "task", callID: "c" + i, state: { status: "completed", input: { subagent_type: "haiku" }, output: "ok", metadata: { sessionId: "cap_" + i }, time: { start: 1000 + i, end: 1100 + i } }, id: "tc" + i });
  }
  parts.push({ type: "tool", tool: "task", callID: "cnometa", state: { status: "completed", input: { subagent_type: "sonnet" }, output: "ok", time: { start: 2000, end: 2100 } }, id: "tcn" });
  // 105 unique → первые 100 в cap; cap_0 fixture нет → failed; остальные cap_1..cap_99 fixtures
  for (let i = 1; i < 100; i++) writeFileSync(join(exportDir, `cap_${i}.json`), childFixture("cap_" + i, { input: 1, output: 1, reasoning: 0, cache: { read: 0, write: 0 } }));
  const data = { info: { id: "ses_cap" }, messages: [{ info: { role: "assistant", time: { created: 1000 } }, parts }] };
  const out = runFixture(data, "cap", { MAESTRO_TIMELINE_EXPORT_DIR: exportDir });
  const h = out.metrics.tokensByAgent.haiku;
  assert.equal(h.count, 105);
  assert.equal(h.failed, 1);   // cap_0 — нет fixture
  assert.equal(h.skipped, 5);  // cap_100..cap_104 — over-cap
  assert.equal(h.input, 99);   // cap_1..cap_99
  assert.equal(out.metrics.tokensByAgent.sonnet, undefined); // без metadata.sessionId — не ведру
});

test("tokensByAgent — зависший child-экспорт (таймаут) → skipped, вывод не блокируется", async () => {
  const exportDir = join(tmpDir, "child-export-4");
  mkdirSync(exportDir, { recursive: true });
  writeFileSync(join(exportDir, "hang_1.hang"), "");
  const data = {
    info: { id: "ses_hang" },
    messages: [
      { info: { role: "assistant", time: { created: 2000 } }, parts: [
        { type: "tool", tool: "task", callID: "c1", state: { status: "completed", input: { subagent_type: "opus" }, output: "ok", metadata: { sessionId: "hang_1" }, time: { start: 2100, end: 2500 } }, id: "tc1" },
      ] },
    ],
  };
  const out = runFixture(data, "hang", { MAESTRO_TIMELINE_EXPORT_DIR: exportDir, MAESTRO_CHILD_EXPORT_TIMEOUT_MS: "200" });
  assert.deepEqual(out.metrics.tokensByAgent.opus, { count: 1, input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, skipped: 1, failed: 0 });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `node --test skills/maestro-feedback-report/timeline.test.mjs`
Expected: FAIL — `tokensByAgent` всегда `{}` (4 новых теста); остальные PASS.

- [ ] **Step 4: Implement child-экспорт**

В `timeline.mjs`:

(a) Imports: добавить `existsSync`, `renameSync` (renameSync — Task 3, можно добавить сейчас), `tmpdir` уже есть.

(b) Конфиг-константы (верх, после args):

```js
const EXPORT_DIR = process.env.MAESTRO_TIMELINE_EXPORT_DIR || null;
const CHILD_TIMEOUT_MS = Number(process.env.MAESTRO_CHILD_EXPORT_TIMEOUT_MS) > 0 ? Number(process.env.MAESTRO_CHILD_EXPORT_TIMEOUT_MS) : 30000;
const CHILD_CONCURRENCY = 4;
const CHILD_CAP = 100;
```

(c) Функция экспорта:

```js
async function exportSession(sessionID, timeoutMs) {
  if (EXPORT_DIR) {
    if (existsSync(join(EXPORT_DIR, sessionID + ".hang"))) {
      await new Promise((r) => setTimeout(r, Math.max(timeoutMs * 5, 2000)));
    }
    const p = join(EXPORT_DIR, sessionID + ".json");
    if (!existsSync(p)) throw new Error("child_export_missing");
    const raw = readFileSync(p, "utf-8");
    if (!raw || !raw.trim()) throw new Error("export_failed");
    return JSON.parse(raw); // invalid → throw (invalid_export)
  }
  return await new Promise((resolve, reject) => {
    const tmpFile = join(tmpdir(), `maestro-child-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
    const fd = openSync(tmpFile, "w");
    const child = spawn("opencode", ["export", sessionID], { stdio: ["ignore", fd, "inherit"] });
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      try { child.kill("SIGKILL"); } catch {}
      try { closeSync(fd); } catch {}
      try { unlinkSync(tmpFile); } catch {}
      reject(new Error("child_export_timeout"));
    }, timeoutMs);
    child.on("error", (e) => { if (done) return; done = true; clearTimeout(timer); try { closeSync(fd); } catch {}; try { unlinkSync(tmpFile); } catch {}; reject(e); });
    child.on("exit", (code) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { closeSync(fd); } catch {}
      if (code !== 0) { try { unlinkSync(tmpFile); } catch {}; reject(new Error("export_failed")); return; }
      let raw;
      try { raw = readFileSync(tmpFile, "utf-8"); } catch (e) { try { unlinkSync(tmpFile); } catch {}; reject(e); return; }
      try { unlinkSync(tmpFile); } catch {}
      if (!raw || !raw.trim()) { reject(new Error("export_failed")); return; }
      try { resolve(JSON.parse(raw)); } catch { reject(new Error("invalid_export")); }
    });
  });
}
```

(d) Сбор child-списка + пул (после `metrics` из Task 1, до `topOpsResult`):

```js
// --- metrics.tokensByAgent (child-экспорт) ---
const agentBuckets = {};
const uniqueChildren = new Map(); // sessionId -> agent (первое вхождение)
for (const msg of messages) {
  const parts = Array.isArray(msg.parts) ? msg.parts : [];
  for (const p of parts) {
    if (typeof p !== "object" || !p || p.type !== "tool" || p.tool !== "task") continue;
    const st = p.state;
    if (!st || st.status !== "completed") continue;
    const sid = st.metadata && st.metadata.sessionId;
    if (!sid || typeof sid !== "string") continue;
    const agent = (st.input && st.input.subagent_type) || "unknown";
    if (!agentBuckets[agent]) agentBuckets[agent] = { count: 0, input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, skipped: 0, failed: 0 };
    agentBuckets[agent].count++;
    if (!uniqueChildren.has(sid)) uniqueChildren.set(sid, agent);
  }
}

const childEntries = [...uniqueChildren.entries()];
const toRun = childEntries.slice(0, CHILD_CAP);
for (const [sid, agent] of childEntries.slice(CHILD_CAP)) agentBuckets[agent].skipped++;

await (async () => {
  let idx = 0;
  async function worker() {
    while (idx < toRun.length) {
      const i = idx++;
      const [sid, agent] = toRun[i];
      const b = agentBuckets[agent];
      try {
        const data = await exportSession(sid, CHILD_TIMEOUT_MS);
        const t = data && data.info && data.info.tokens;
        if (t && typeof t === "object") {
          b.input += t.input || 0;
          b.output += t.output || 0;
          b.reasoning += t.reasoning || 0;
          b.cacheRead += (t.cache && t.cache.read) || 0;
          b.cacheWrite += (t.cache && t.cache.write) || 0;
        }
      } catch (e) {
        if (e && e.message === "child_export_timeout") b.skipped++;
        else b.failed++;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CHILD_CONCURRENCY, toRun.length) }, () => worker()));
})();

metrics.tokensByAgent = agentBuckets;
```

Примечание: верхний уровень скрипта — модуль-код (top-level `await` допустим в ESM; текущий скрипт уже использует `await` в main-потоке при экспорте primary — сохранять тот же паттерн: код child-экспорта — после чтения primary-экспорта и до формирования `result`).

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test skills/maestro-feedback-report/timeline.test.mjs`
Expected: PASS — 16 + 4 = 20. Контроль: `ls .maestro/metrics/` — **не** создан (изоляция M-8).

- [ ] **Step 6: Commit**

```bash
git add skills/maestro-feedback-report/timeline.mjs skills/maestro-feedback-report/timeline.test.mjs
git commit -m "feat(feedback-report): timeline.mjs — tokensByAgent: child-экспорт (concurrency 4, cap 100, таймаут 30 c, fail-soft) + M-8 изоляция тестов"
```

---

### Task 3: JSONL-история `.maestro/metrics/history.jsonl` (upsert, атомарно, fail-soft)

**Files:**
- Modify: `skills/maestro-feedback-report/timeline.mjs`
- Test: `skills/maestro-feedback-report/timeline.test.mjs`

**Interfaces:**
- Consumes: `result.metrics` (готовый блок — Task 1+2).
- Produces: файл `.maestro/metrics/history.jsonl` (или `MAESTRO_METRICS_JSONL`): строки `{ sessionID, date, metrics }`; повторный запуск с тем же sessionID — строка заменена (upsert). Stdout-контракт не меняется.

- [ ] **Step 1: Write the failing tests**

```js
test("JSONL — запись строки (sessionID, date, metrics)", () => {
  const jsonl = join(tmpDir, "j1/history.jsonl");
  runFixture({ info: { id: "ses_j1" }, messages: [] }, "j1", { MAESTRO_METRICS_JSONL: jsonl });
  const lines = readFileSync(jsonl, "utf-8").trim().split("\n").map((l) => JSON.parse(l));
  assert.equal(lines.length, 1);
  assert.equal(lines[0].sessionID, "ses_test");
  assert.match(lines[0].date, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(typeof lines[0].metrics === "object" && lines[0].metrics.tokens);
});

test("JSONL — upsert по sessionID: повторный запуск заменяет строку", () => {
  const jsonl = join(tmpDir, "j2/history.jsonl");
  runFixture({ info: { id: "ses_j2" }, messages: [] }, "j2a", { MAESTRO_METRICS_JSONL: jsonl });
  runFixture({ info: { id: "ses_j2", tokens: { input: 999 } }, messages: [
    { info: { role: "assistant", time: { created: 2000 }, tokens: { input: 999, output: 0, reasoning: 0, cache: { read: 0, write: 0 } } }, parts: [] },
  ] }, "j2b", { MAESTRO_METRICS_JSONL: jsonl });
  const lines = readFileSync(jsonl, "utf-8").trim().split("\n").map((l) => JSON.parse(l));
  assert.equal(lines.length, 1);
  assert.equal(lines[0].metrics.tokens.input, 999);
});

test("JSONL — невалидные строки пропускаются (self-healing), валидные чужие сохраняются", () => {
  const dir = join(tmpDir, "j3");
  mkdirSync(dir, { recursive: true });
  const jsonl = join(dir, "history.jsonl");
  writeFileSync(jsonl, '{"sessionID":"ses_old","date":"2026-01-01","metrics":{}}\n{broken\n');
  runFixture({ info: { id: "ses_j3" }, messages: [] }, "j3", { MAESTRO_METRICS_JSONL: jsonl });
  const lines = readFileSync(jsonl, "utf-8").trim().split("\n").map((l) => JSON.parse(l));
  assert.equal(lines.length, 2); // ses_old (валидная) + ses_test; broken — удалён
  assert.ok(lines.some((l) => l.sessionID === "ses_old"));
});

test("JSONL — fail-soft: неписательный путь → stdout не меняется, код 0", () => {
  const out = runFixture({ info: { id: "ses_j4" }, messages: [] }, "j4", { MAESTRO_METRICS_JSONL: "/proc/never-writable/history.jsonl" });
  assert.ok(out.metrics); // stdout валиден
});
```

(`readFileSync` — импортировать в тесты, если ещё нет.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test skills/maestro-feedback-report/timeline.test.mjs`
Expected: FAIL — файл не создаётся (JSONL ещё не реализуется).

- [ ] **Step 3: Implement JSONL-запись**

В `timeline.mjs` (после child-экспорта, до `process.stdout.write`):

```js
// --- metrics JSONL (upsert, атомарно, fail-soft) ---
const METRICS_JSONL = process.env.MAESTRO_METRICS_JSONL
  || join(process.cwd(), ".maestro", "metrics", "history.jsonl");

try {
  mkdirSync(dirname(METRICS_JSONL), { recursive: true });
  let existing = [];
  try {
    existing = readFileSync(METRICS_JSONL, "utf-8").split("\n").filter((l) => l.trim());
  } catch {}
  const valid = [];
  for (const l of existing) {
    try { JSON.parse(l); valid.push(l); } catch {} // self-healing: невалидные строки пропускаем
  }
  const record = JSON.stringify({
    sessionID: info.id || sessionID,
    date: new Date().toISOString().slice(0, 10),
    metrics,
  });
  valid.splice(0, valid.length, ...valid.filter((l) => {
    try { return JSON.parse(l).sessionID !== (info.id || sessionID); } catch { return true; }
  }));
  valid.push(record);
  const tmp = METRICS_JSONL + ".tmp";
  writeFileSync(tmp, valid.join("\n") + "\n");
  renameSync(tmp, METRICS_JSONL);
} catch (e) {
  process.stderr.write(`metrics jsonl: ${e.message}\n`);
}
```

Imports: `dirname` из `node:path` (join уже есть).

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test skills/maestro-feedback-report/timeline.test.mjs`
Expected: PASS — 20 + 4 = 24.

- [ ] **Step 5: Commit**

```bash
git add skills/maestro-feedback-report/timeline.mjs skills/maestro-feedback-report/timeline.test.mjs
git commit -m "feat(feedback-report): timeline.mjs — JSONL-история .maestro/metrics/history.jsonl (upsert, tmp+rename, self-healing, fail-soft)"
```

---

### Task 4: Раздел «Метрики пайплайна и Effort» в `skills/maestro-feedback-report/SKILL.md`

**Files:**
- Modify: `skills/maestro-feedback-report/SKILL.md` (раздел 3d + шаблон отчёта)

**Interfaces:**
- Consumes: stdout-JSON `timeline.mjs` → блок `metrics` (Task 1–3).
- Produces: инструкция для LLM-сборщика отчёта; новый раздел в шаблоне (после «Таймлайн и длительности операций»).

- [ ] **Step 1: Инструкции (секция 3d после 3c)**

Добавить в SKILL.md после секции 3c:

```markdown
### 3d. Метрики пайплайна и Effort (данные opencode-сессии)

Источник — тот же запуск `timeline.mjs` из 3c: stdout-JSON дополнительно
содержит блок `metrics`:

- `tokens` (primary-сессия): `input/output/reasoning/cacheRead/cacheWrite`,
  `cost` (число или `null` — провайдер без прайсинга);
- `tokensByAgent` (по `subagent_type`): `count` (task-диспатчей с известной
  child-сессией; **может быть меньше** таблицы «Агенты» из 3c — туда входят
  все task-части), токены child-сессий, `skipped`/`failed`
  (over-cap/таймаут/сбой child-экспорта — пометка «атрибуция неполная»);
- `activeMs` (активное время = wall − user_wait; `null` без таймстампов);
- `questionCount` (HITL-гейты); `reviewDispatches` (механический ориентир
  циклов ревью — title-хэвистика; истина — нарратив из диалога).

Механика пишет строку в `.maestro/metrics/history.jsonl` (upsert по
sessionID; эфемерное, gitignored — пользовательская база для статистики,
анализ — вне команды).

**Fallback:** блок `metrics` отсутствует (export сбой) → «Нет данных по
метрикам: <причина>» (паттерн 3c).
```

- [ ] **Step 2: Секция шаблона отчёта (после «Таймлайн и длительности операций»)**

```markdown
## Метрики пайплайна и Effort
> Источник: `metrics`-блок `timeline.mjs` (0 LLM) + bootstrap-лог (retry, 3a)
> + ход диалога (нарратив). Только агрегаты (SEC-4b).

### Итоговая статистика
- **Токены (primary):** input <N> / output <N> / reasoning <N> / cache read <N> / cache write <N>; cost: <\$X | —>
- **Токены по агентам:**

| Агент | Диспатчей* | Input | Output | Атрибуция |
|---|---|---|---|---|
| <subagent_type> | <N> | <N> | <N> | <полная | неполная: skipped N / failed M> |

\* диспатчей с известной child-сессией; может быть меньше таблицы «Агенты» (3c).

- **Активное время:** <H ч M мин> (доля <P>% от wall-длительности сессии)
- **HITL:** question-гейтов <N>; retry-повторов: <из 3a>
- **Циклы ревью:** механический ориентир — <reviewDispatches>; по ходу диалога: <LLM: сколько фактических циклов ревью/фиксов и почему (сколько раундов до approve, где откат)>

### Effort (методология)
> Effort = итоговая статистика + нормализованное активное время + факторы
> влияния. Числовой score НЕ присваивается (методология закреплена в спеке
> #109/#115; калибровка по базе запусков — #89, не в этой команде).

- **Факторы влияния (+/−):** <LLM-разбор по собранным данным (паттерн 3c
  «Что повлияло»): что определяло длительность/токены (агенты, циклы ревью,
  паузы, stop-and-fix), что помогло/вредило; обезличенные формулировки>
```

- [ ] **Step 3: Сверка (self-review)**

- [ ] Раздел в шаблоне — ровно после «Таймлайн и длительности операций» (до «Что было хорошо»).
- [ ] Все числовые поля раздела имеют источник в `metrics`/3a/диалоге (нет «свободных» метрик).
- [ ] SEC-4b: в секции нет инструкций копировать title/тексты/пути.
- [ ] Fallback-формулировка совпадает с паттерном 3c.

- [ ] **Step 4: Commit**

```bash
git add skills/maestro-feedback-report/SKILL.md
git commit -m "docs(feedback-report): SKILL.md — раздел «Метрики пайплайна и Effort» (шаблон + методология Effort + fallback)"
```

---

### Task 5: DoD-волна — manual_docs, project-context, roadmap, regression entry, dogfooding-верификация

**Files:**
- Modify: `manual_docs/reference/commands.md`, `manual_docs/overview/changelog.md`, `docs/project-context.md`, `docs/roadmap.md`
- Create: `regression/entries/2026-09-24-pipeline-metrics-effort.md`

**Interfaces:**
- Consumes: всё из Tasks 1–4.
- Produces: синхронизированные доки + regression entry + dogfooding-эвиденс.

- [ ] **Step 1: `manual_docs/reference/commands.md`**

В описании `@maestro-feedback-report` добавить секцию (по факту структуры отчёта из Task 4):

```markdown
- **Метрики пайплайна и Effort** (4.10.0): итоговая статистика запуска —
  токены (primary + по сабагентам через child-сессии), cost (— при отсутствии
  прайсинга), активное время (wall − user_wait), HITL-гейты, retry, циклы
  ревью (механический ориентир + нарратив); методология Effort — без
  числового score (статистика + факторы влияния). Механика — `timeline.mjs`
  (0 LLM, concurrency 4 / cap 100 / таймаут 30 c, fail-soft); накопительная
  история — `.maestro/metrics/history.jsonl` (эфемерное, gitignored).
```

- [ ] **Step 2: `manual_docs/overview/changelog.md`** — буллит в `[Unreleased] → Добавлено`:

```markdown
- **Метрики пайплайна и Effort (4.10.0):** новый раздел отчёта
  `@maestro-feedback-report` — итоговая статистика запуска: токены
  (primary-сессия + по сабагентам через child-экспорт сессий, cap 100,
  таймаут 30 c, fail-soft), cost (— без прайсинга), активное время
  (wall − user_wait), HITL-гейты, retry, циклы ревью (title-хэвистика —
  механический ориентир + LLM-нарратив). Методология Effort — без числового
  score: статистика + нормализованное активное время + «факторы влияния
  (+/−)». Накопительная история — `.maestro/metrics/history.jsonl` (upsert по
  sessionID, атомарно, эфемерное). Механика — `timeline.mjs` (0 LLM, тот же
  источник — `opencode export`).
```

- [ ] **Step 3: `docs/project-context.md` §10**

- [ ] Указать фактическое число timeline-тестов (из прогона Task 1–3, ожидается 24 — взять факт) и **сверить/зафиксировать** число plugin-тестов: прогнать `node --test plugins/maestro-bootstrap/index.test.js`, заменить «236» фактическим счётчиком (дрейф после read-tool-фичи 4.9.0 — I-3).
- [ ] При необходимости — строка про `timeline.mjs` (metrics-блок) в §10/§5.

- [ ] **Step 4: `docs/roadmap.md`**

Волна 2, пункт 1:

```markdown
1. **#109 + #115** — единый блок метрик пайплайна в feedback-report.
   **Выполнено (4.10.0, 2026-09-24)** — раздел «Метрики пайплайна и Effort»:
   токены (primary + child-сессии сабагентов), cost, активное время, HITL,
   retry, циклы ревью; методология Effort — без числового score (статистика +
   факторы влияния); JSONL-история `.maestro/metrics/history.jsonl`. Spec
   `docs/superpowers/specs/2026-09-24-pipeline-metrics-effort-design.md`.
```

+ пометка у заголовка Волны 2 (паттерн #113): метка «4.8.x» — историческая (версия ушла на 4.9.0 read-tool-фичей; #109/#115 → 4.10.0).

- [ ] **Step 5: `regression/entries/2026-09-24-pipeline-metrics-effort.md`** (формат — по соседним entries):

```markdown
# Метрики пайплайна и Effort в @maestro-feedback-report (#109+#115)

- **Дата:** 2026-09-24
- **Версия:** 4.10.0
- **Риск:** LOW
- **Описание:** расширение `timeline.mjs` (блок `metrics`: токены primary +
  child-сессии сабагентов (concurrency 4, cap 100, таймаут 30 c, fail-soft),
  cost (null без прайсинга), activeMs, questionCount, reviewDispatches
  (title-хэвистика, in-process), JSONL `.maestro/metrics/history.jsonl`
  (upsert по sessionID, tmp+rename, self-healing)) + раздел «Метрики пайплайна
  и Effort» в отчёте (методология Effort — без числового score).
- **SEC:** SEC-4b — только агрегаты; title не выводится; temp-файлы удаляются;
  child-экспорт без `--sanitize`.
- **Тесты:** `timeline.test.mjs` (24: 11 baseline + 13 новых, включая
  backward-compat, cap/skipped, timeout, upsert, fail-soft, drift-формата).
- **Spec:** docs/superpowers/specs/2026-09-24-pipeline-metrics-effort-design.md
- **Non-goals:** #89 (майк-оценки), #95, #107, кросс-сессийный агрегатор,
  изменения пайплайна maestro, числовой Effort-score.
```

(Число тестов — фактическое из прогона, не с этого места.)

- [ ] **Step 6: Dogfooding-верификация (AC #6)**

```bash
node skills/maestro-feedback-report/timeline.mjs <SessionID живой сессии с task-частями>
```

Контроли: `metrics.tokens.input > 0`; `cost` — число|null; `tokensByAgent` непуст (при наличии task-частей с child-сессиями); строка `history.jsonl` записана (`.maestro/metrics/history.jsonl` — эфемерное, не коммитить). **Cross-check (Answers-1):** `metrics.tokens.input` == top-level `info.tokens.input` экспорта (совпадение зафиксировать в выводе; расхождение — только при aborted/variant-генерациях, записать в entry как примечание).

- [ ] **Step 7: Полный прогон тестов**

```bash
node --test skills/maestro-feedback-report/timeline.test.mjs
node --test plugins/maestro-bootstrap/index.test.js
```

Expected: всё зелёное; счётчики — фактические (в §10 — из этого прогона).

- [ ] **Step 8: Commit**

```bash
git add manual_docs/reference/commands.md manual_docs/overview/changelog.md docs/project-context.md docs/roadmap.md regression/entries/2026-09-24-pipeline-metrics-effort.md
git commit -m "docs(feedback-report): DoD-волна #109+#115 — manual_docs/project-context/roadmap/regression entry (4.10.0)"
```

---

## Final Verification (после всех задач)

- [ ] `node --test skills/maestro-feedback-report/timeline.test.mjs` — зелёное (24).
- [ ] `node --test plugins/maestro-bootstrap/index.test.js` — без регрессий (счёт — из прогона).
- [ ] `./maestro-sandbox.sh` — e2e-смоук (feedback-report в чеклисте не представлен — dogfooding-прогон Step 6 Task 5 и есть позитивная верификация; sandbox — контроль общего регресса).
- [ ] `git status` — чистое дерево; `.maestro/` не в индексе.
- [ ] Grep-сверка: `metrics`/`tokensByAgent`/`history.jsonl` упоминаются согласованно (SKILL.md, manual_docs, regression entry, project-context).
- [ ] Версия: `package.json` на ветке НЕ трогаем (bump 4.10.0 — шаг 18 после merge).
