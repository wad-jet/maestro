# Feedback-report: V2-timeline + fail-loud + верификация записи — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `timeline.mjs` работает с V2-экспортом opencode (команда + формат + тайминги) и падает явно при нераспознанном формате; SKILL.md требует верификацию записи файла отчёта до сообщения «Отчёт сохранён».

**Architecture:** Один нормализатор `normalizeMessage()` приводит V1- и V2-экспорты к единой внутренней форме (V1-shape: `role/ts/parts[].time/state`); все существующие проходы агрегации работают с нормализованными сообщениями без изменения семантики. Команда экспорта: V2-first (`opencode session export`) с silent-legacy-fallback (`opencode export`), режим кэшируется. Guard формата срабатывает до записи `history.jsonl`.

**Tech Stack:** Node.js ESM (`node:fs`, `node:child_process`), node:test (`node --test`), без новых зависимостей.

**Spec:** `docs/superpowers/specs/2026-10-13-feedback-report-v2-timeline-design.md`

## Global Constraints

- V1-поведение не меняется: все существующие тесты `timeline.test.mjs` проходят (единственное исключение — адаптация fake-`opencode` шимов под сдвиг аргументов: `$2`→`$3`, Task 3).
- Контракт ошибок: stdout `{"error":"<код>"}` + exit 1; stdout при успехе — один JSON.
- stderr: ровно одна диагностическая строка при итоговом сбое; промежуточный сбой V2-команды перед успешным legacy-fallback — молчит.
- SEC-4b: в stdout/stderr/ошибках — только агрегаты, без содержимого сессии.
- Канон-тексты (SKILL.md, changelog, commands.md) — на русском.
- Версия: `package.json` → `5.6.6`; маркеры версий синхронно (AGENTS.md, `docs/project-context.md`, changelog) — `maestro-install/docs-drift.test.mjs` должен быть зелёным.
- Регистрация в `npm test` уже есть (`skills/maestro-feedback-report/timeline.test.mjs`) — новых записей не требуется.

## Review Focus

1. **V1 CLI (legacy-окружение):** `opencode session export` неизвестна → fallback `opencode export` должен пройти молча (stderr пуст, статус 0). Тест в Task 3.
2. **V2 tool без `ran`:** длительность не теряется — fallback `completed − created`. Тест в Task 2.
3. **Дрейф формата в будущем:** messages есть, распознано 0 → `format_unrecognized`, exit 1, `history.jsonl` не тронут. Тест в Task 4.
4. **V2-сообщения неречевых типов (idle/synthetic/system) между user/assistant:** не ломают парсер, не попадают в тоталы, но расширяют границы сессии (raw-метки). Тест в Task 2.
5. **Режим CLI не «переоткрывается» на сбое конкретной сессии:** после успешного primary через `session export` сбойный child-экспорт даёт `failed++`, а не повторный выбор команды (иначе legacy-фейк «вылечил» бы его). Тест в Task 3 (адаптированный failChild).

---

### Task 1: Нормализатор форматов V1+V2 (`normalizeMessage`)

**Files:**
- Modify: `skills/maestro-feedback-report/timeline.mjs:165-304, 314-343, 386-444` (три прохода агрегации)
- Test: `skills/maestro-feedback-report/timeline.test.mjs` (новая fixture + тесты)

**Interfaces:**
- Produces (внутренний контракт последующих задач):
  - `normalizeMessage(m)` → `{ role: "user"|"assistant", ts: number|null, parts: NormalizedPart[], tokens, cost } | null`
  - `NormalizedPart` (tool): `{ type: "tool", tool: string, state: object, time: { start, end, blockStart? } }` — поле `time` вводит Task 2; в Task 1 агрегация всё ещё читает старый путь `tp.state.time`, меняются только `role/ts/parts/tokens/cost`-источники
  - V2-маппинги: role ← `m.type`; ts ← `m.time.created`; parts ← `m.content[]` (`tool: c.name`, `state: c.state`); tokens/cost ← `m.tokens`/`m.cost`; `state.input.subagent_type ??= state.input.agent`; `state.metadata.sessionId ??= state.metadata.sessionID`; `state.title ??= state.input.description` (для subagent/task-тулов)
  - Сообщения V2-типов `idle`/`synthetic`/`system`/`compaction`/… → `null` (пропуск, как V1-неролевые)

- [ ] **Step 1: Написать падающий тест — V2-структура**

Fixture `fixtureV2` (полный V2-экспорт; тайминги НЕ проверяются в этом таске):

```js
const fixtureV2 = {
  info: { id: "ses_v2", model: { providerID: "akash", id: "X/Y" },
          time: { created: 1000, updated: 9000 } },
  messages: [
    { id: "m1", time: { created: 1000 }, type: "user", text: "go", files: [], agents: [] },
    { id: "m2", time: { created: 2000, streamed: 2001, completed: 6000 }, type: "assistant",
      agent: "haiku", model: { id: "X/Y", providerID: "akash" },
      content: [
        { type: "text", text: "ok" },
        { type: "tool", id: "t1", name: "shell", executed: true,
          state: { status: "completed", input: { command: "node test.js" } } },
        { type: "tool", id: "t2", name: "subagent", executed: true,
          state: { status: "completed", input: { agent: "sonnet", description: "Review feature X", prompt: "p" },
                   metadata: { sessionID: "child_v2a", status: "completed", truncated: false } } },
        { type: "tool", id: "t3", name: "question", executed: true,
          state: { status: "completed", input: { questions: [] } } },
      ],
      tokens: { input: 100, output: 50, reasoning: 5, cache: { read: 10, write: 2 } },
      cost: 0.001, finish: "stop" },
    { id: "m3", time: { created: 8500 }, type: "idle" },
  ],
};
```

Тест `"V2-экспорт: структура (roles/tools/agents/bash/metrics)"` — assertions:

```js
const out = runFixture(fixtureV2, "v2_struct");
assert.equal(out.totals.userMessages, 1);
assert.equal(out.totals.toolOps, 3);
assert.equal(out.tools.shell.count, 1);
assert.equal(out.tools.subagent.count, 1);
assert.equal(out.tools.question.count, 1);
assert.equal(out.agents.sonnet.count, 1);          // input.agent → агент
assert.equal(out.bash.node.count, 1);              // shell → bash-агрегация по первому слову
assert.deepEqual(out.metrics.tokens, { input: 100, output: 50, reasoning: 5, cacheRead: 10, cacheWrite: 2, cost: 0.001 });
assert.equal(out.metrics.questionCount, 1);
assert.equal(out.metrics.reviewCycles.length, 1);   // title из input.description
assert.equal(out.metrics.reviewCycles[0].titleShort, "Review feature X");
assert.equal(out.session.model, "akash/X/Y");
```

Плюс child-атрибуция (fixture-mode): положить `child_v2a.json` в `MAESTRO_TIMELINE_EXPORT_DIR` c `{ info: { id, tokens: { input: 70, output: 7, reasoning: 0, cache: { read: 0, write: 0 } } }, messages: [] }` →
`assert.deepEqual(out.metrics.tokensByAgent.sonnet.count, 1)` и `tokensByAgent.sonnet.input === 70`.

- [ ] **Step 2: Прогнать — убедиться, что падает**

Run: `node --test skills/maestro-feedback-report/timeline.test.mjs`
Expected: FAIL (новый тест: `toolOps: 0` вместо 3, `userMessages: 0`)

- [ ] **Step 3: Реализовать `normalizeMessage()` в `timeline.mjs` и перевести три прохода на нормализованные сообщения**

До основного цикла: `const norm = messages.map(normalizeMessage);`. Три существующих прохода (основная агрегация `202-304`, metrics `314-343`, child-fanout `386-444`) читают `n.role/n.ts/n.parts/n.tokens/n.cost` вместо `msg.info.*/msg.parts`. V1-ветка нормализатора переносит текущее чтение (`m.info.role`, `m.info.time.created`, `m.parts`, `m.info.tokens/cost`) без изменений. Чтение таймингов в этом таске — как сейчас (`state.time`), единое поле `time` на части вводит Task 2.

- [ ] **Step 4: Прогнать все тесты**

Run: `node --test skills/maestro-feedback-report/timeline.test.mjs`
Expected: PASS — все существующие + новый (V1-фикстуры идут через нормализатор без изменения поведения)

- [ ] **Step 5: Commit**

```bash
git add skills/maestro-feedback-report/timeline.mjs skills/maestro-feedback-report/timeline.test.mjs
git commit -m "feat: timeline.mjs — normalizeMessage для V1+V2 форматов экспорта"
```

### Task 2: V2-тайминги и границы сессии

**Files:**
- Modify: `skills/maestro-feedback-report/timeline.mjs` (нормализатор: `time` на tool-частях; границы сессии)
- Test: `skills/maestro-feedback-report/timeline.test.mjs`

**Interfaces:**
- Consumes: `NormalizedPart` из Task 1; агрегация читает `tp.time.{start, end, blockStart?}` вместо `tp.state.time`
- Produces: V2-часть получает `time: { start: c.time.ran ?? c.time.created, end: c.time.completed, blockStart: c.time.created }`; V1 — `time: { start: state.time.start, end: state.time.end }` (`blockStart` нет → span от `start`)

- [ ] **Step 1: Написать падающие тесты — тайминги и границы**

Дополнить `fixtureV2` (Task 1) таймингами: `t1.time = { created: 2100, ran: 2200, completed: 3200 }`, `t2.time = { created: 3300, ran: 3400, completed: 5400 }`, `t3.time = { created: 5500, ran: 5500, completed: 5600 }`; в `info.time` сделать значения отличными от меток сообщений: `time: { created: 500, updated: 9000 }` (иначе merge-поведение не различить тестом). Тест `"V2-тайминги: ran→completed, top_ops, инференс, границы"`:

```js
assert.equal(out.totals.toolTimeMs, 3100);            // 1000 + 2000 + 100
assert.equal(out.top_ops[0].tool, "subagent");
assert.equal(out.top_ops[0].durationMs, 2000);
assert.equal(out.totals.inferenceMs, 400);            // span(blockStart 2100 → completed 5600) = 3500 − 3100
assert.equal(out.session.start, 500);               // info.time.created (min с метками сообщений)
assert.equal(out.session.end, 9000);                // info.time.updated (max с метками сообщений)
assert.equal(out.session.durationMs, 8500);
assert.equal(out.metrics.machineActiveMs, 3500);      // toolTimeMs + inferenceMs
```

Тест `"V2 tool без ran: спан created→completed"` — отдельный item `time: { created: 100, completed: 300 }` → `durationMs === 200` в `top_ops`.

Тест `"V2 idle-сообщения расширяют границы сессии"`: idle `m3` с `time.created: 9500` и `info.time.updated: 9000` → `session.end === 9500`.

- [ ] **Step 2: Прогнать — падает**

Run: `node --test skills/maestro-feedback-report/timeline.test.mjs`
Expected: FAIL (`toolTimeMs: 0` вместо 3100; session bounds по-другому)

- [ ] **Step 3: Реализовать**

В нормализаторе V2-ветки — синтез `time` (см. Interfaces); V1-ветка — перенос `state.time` в `time`. В основной агрегации заменить чтение `tp.state.time` на `tp.time`; span блока — `earliestStart = Math.min(...complete.map(p => p.time.blockStart ?? p.time.start))`. Границы сессии: raw-метки всех сообщений (V1 `m.info.time.created` / V2 `m.time.created`) + если экспорт V2-детектирован (хотя бы одно V2-сообщение распознано) — слить `info.time.created`/`info.time.updated`.

- [ ] **Step 4: Прогнать все тесты**

Run: `node --test skills/maestro-feedback-report/timeline.test.mjs`
Expected: PASS (включая V1-фикстуры `formatMs`/`top_ops`/`timeline` — чтение `time` эквивалентно старому `state.time`)

- [ ] **Step 5: Commit**

```bash
git add skills/maestro-feedback-report/timeline.mjs skills/maestro-feedback-report/timeline.test.mjs
git commit -m "feat: timeline.mjs — V2 tool-тайминги (ran→completed) и границы сессии"
```

### Task 3: Команда экспорта V2-first + legacy-fallback, удаление мёртвого shim

**Files:**
- Modify: `skills/maestro-feedback-report/timeline.mjs:41-99` (child `exportSession`), `:101-155` (primary-путь: удалить мёртвый shim 111–119, spawn с fallback)
- Test: `skills/maestro-feedback-report/timeline.test.mjs` (адаптация `makeFakeOpencode` + новые тесты)

**Interfaces:**
- Produces: `runExport(sessionID, timeoutMs)` → Promise<exportData> — общий для primary и child; внутри — модульный кэш `cliMode` (`null | "v2" | "legacy"`): первый вызов пробует `opencode session export <id>`, при non-zero exit/пустом stdout — `opencode export <id>`; успех фиксирует режим; итоговый сбой — ровно одна stderr-строка `[timeline] export failed: <id> — <tail>` (хвост последней попытки)

- [ ] **Step 1: Адаптировать существующие fake-шимы и написать новые тесты**

`makeFakeOpencode` (строки 870–888) и многострочный тест (929–941): проверка sessionID `$2` → `$3` (первый вызов теперь `opencode session export <id>`: `$1=session`, `$2=export`, `$3=<id>`). Остальные шимы (без проверок аргументов) не меняются.

Новые тесты:

`"V2-first: session export — успешен, fallback не вызывается"` — шим: `if [ "$1" = "session" ] && [ "$2" = "export" ]; then cat fixture; else echo "unknown-command" >&2; exit 1; fi` →
`assert.equal(r.status, 0)`, `assert.equal(r.stderr, "")`, JSON распарсен.

`"legacy-fallback: session export падает → export ок; промежуточный сбой молчит"` — шим: `if [ "$1" = "session" ]; then echo "boom-intermediate" >&2; exit 1; fi; cat fixture` →
`assert.equal(r.status, 0)`, `assert.equal(r.stderr, "")`.

- [ ] **Step 2: Прогнать — новые падают**

Run: `node --test skills/maestro-feedback-report/timeline.test.mjs`
Expected: FAIL (скрипт вызывает `opencode export <id>` → первый шим отвечает unknown-command)

- [ ] **Step 3: Реализовать `runExport()` + кэш режима**

Оба spawn-сайта (primary и child `exportSession`) используют `runExport`. Промежуточный сбой V2-команды — без stderr. Удалить мёртвый shim-блок (строки 111–119: `shimDir`/`shimPath`/`shimScript` — создаётся и удаляется, никогда не выполняется). Fixture-режим `MAESTRO_TIMELINE_EXPORT_DIR` и путь с 2-м аргументом (готовый export JSON) не трогают CLI.

- [ ] **Step 4: Прогнать все тесты**

Run: `node --test skills/maestro-feedback-report/timeline.test.mjs`
Expected: PASS — включая адаптированные failChild/failAll/multiline (одна diag-строка; `failed >= 1` без «лечения» через legacy — см. Review Focus 5)

- [ ] **Step 5: Commit**

```bash
git add skills/maestro-feedback-report/timeline.mjs skills/maestro-feedback-report/timeline.test.mjs
git commit -m "fix: timeline.mjs — opencode session export (V2-first) с legacy-fallback"
```

### Task 4: Fail-loud guard `format_unrecognized`

**Files:**
- Modify: `skills/maestro-feedback-report/timeline.mjs` (guard после нормализации, до child-fanout и записи `history.jsonl`)
- Test: `skills/maestro-feedback-report/timeline.test.mjs`

**Interfaces:**
- Produces: `messages.length > 0` И распознано 0 сообщений с ролью user/assistant → stdout `{"error":"format_unrecognized"}` + exit 1. Подсчёт — по роли (V1-сообщение с ролью, но без ts, guard не триггерит — тест «no-ts» уже существует).

- [ ] **Step 1: Написать падающий тест**

Тест `"format_unrecognized: нераспознанные сообщения → exit 1, history.jsonl не тронут"`: fixture `{ info: { id: "ses_x" }, messages: [{ foo: 1 }, { bar: { baz: 2 } }] }`, `MAESTRO_METRICS_JSONL` — путь к заранее созданному файлу с одной валидной строкой `{"sessionID":"ses_old"}`. Запуск — по паттерну существующего теста `"empty file yields export_failed"` (строки 378–393: `execFileSync` в try/catch, из `e.stdout`/`e.status`):

```js
assert.equal(e.status, 1);
assert.deepEqual(JSON.parse(stdout), { error: "format_unrecognized" });
// jsonl: единственная строка ses_old сохранилась, новой записи нет
const lines = readFileSync(jsonl, "utf-8").trim().split("\n");
assert.equal(lines.length, 1);
assert.equal(JSON.parse(lines[0]).sessionID, "ses_old");
```

- [ ] **Step 2: Прогнать — падает**

Run: `node --test skills/maestro-feedback-report/timeline.test.mjs`
Expected: FAIL (сейчас exit 0 с пустыми агрегатами)

- [ ] **Step 3: Реализовать guard**

После `norm` (Task 1) и до metrics-проходов/child-fanout/jsonl: при `messages.length > 0 && recognized === 0` → stdout + exit 1. Guard стоит раньше записи `history.jsonl` (строки 505–540).

- [ ] **Step 4: Прогнать все тесты**

Run: `node --test skills/maestro-feedback-report/timeline.test.mjs`
Expected: PASS — включая существующие `invalid export`, `empty export` (messages: [] — guard не триггерит), `no-ts` (роль без ts — не триггерит), drift-формат (роль распознана — не триггерит)

- [ ] **Step 5: Commit**

```bash
git add skills/maestro-feedback-report/timeline.mjs skills/maestro-feedback-report/timeline.test.mjs
git commit -m "fix: timeline.mjs — fail-loud guard format_unrecognized до записи history.jsonl"
```

### Task 5: Канон SKILL.md — верификация записи + silent-empty + актуализация 3c

**Files:**
- Modify: `skills/maestro-feedback-report/SKILL.md:132-155` (3c), `:432-436` (4b «Завершение»)

**Interfaces:**
- Consumes: поведение из Tasks 3–4 (V2-first команда, `format_unrecognized`)

- [ ] **Step 1: Правки 3c**

Строка 134: «Источник — экспорт сессии `opencode export`» → `opencode session export`. Строка 147: «Скрипт сам вызывает `opencode export <Session ID>`» → «Скрипт сам вызывает `opencode session export <Session ID>` (V2; на старом CLI — автоматический fallback на legacy-команду)». Fallback (строка 153): добавить `{"error":"format_unrecognized"}` в перечень. После fallback-абзаца добавить правило:

```markdown
- **Правило silent-empty:** скрипт успешен (exit 0), но `totals.toolOps = 0` И
  `totals.userMessages = 0` при наличии активности в сессии → трактовать как
  «Нет данных по таймлайну: формат не распознан» (не как пустую сессию) и
  записать это в секцию отчёта.
```

- [ ] **Step 2: Правка 4b «Завершение»**

Перед пунктом «Сообщи: "Отчёт сохранён в `<путь>`"» добавить:

```markdown
- **Верификация записи (обязательно):** перед сообщением пользователю проверь
  через bash (`ls -la <путь>`), что файл существует и размер > 0. Только при
  подтверждённом существовании сообщай «Отчёт сохранён в `<путь>`». Если файл
  не существует или пуст — НЕ сообщай «сохранён»: честно скажи, что запись не
  удалась, разберись в причине, перезапиши и верифицируй повторно. Путь без
  улики существования не сообщается.
```

- [ ] **Step 3: Прогнать тесты репо**

Run: `npm test`
Expected: PASS — commands-skill-coverage не затронут, docs-drift пока зелёный (маркеры версий — Task 6)

- [ ] **Step 4: Commit**

```bash
git add skills/maestro-feedback-report/SKILL.md
git commit -m "docs: feedback-report SKILL.md — верификация записи отчёта, silent-empty, session export"
```

### Task 6: Версия 5.6.6, changelog, синхронизация доков, финальная верификация

**Files:**
- Modify: `package.json` (version), `manual_docs/overview/changelog.md`, `AGENTS.md` + `docs/project-context.md` (маркеры версий), `manual_docs/reference/commands.md` (§ `/maestro-feedback-report`)

**Interfaces:**
- Consumes: все предыдущие таски

- [ ] **Step 1: Версия и changelog**

`package.json`: `"version": "5.6.6"`. В `manual_docs/overview/changelog.md` под `## [Unreleased]` — блок `> **Версия 5.6.6** — Patch: feedback-report — V2-совместимость timeline.mjs (команда `opencode session export` с legacy-fallback, нормализация V1/V2, тайминги ran→completed), fail-loud guard format_unrecognized, обязательная верификация записи отчёта в каноне скилла` с разделом `### Исправлено` (по образцу 5.6.5). Проверить grep-ом и обновить маркеры `5.6.5` → `5.6.6` в `AGENTS.md` и `docs/project-context.md`.

- [ ] **Step 2: commands.md**

§ `/maestro-feedback-report`: «через `opencode export` + helper `timeline.mjs`» → `opencode session export`. После блока U5 — bullet:

```markdown
**U6 (2026-10-13): Верификация записи.** Перед сообщением «Отчёт сохранён в
`<путь>`» — обязательная bash-проверка существования файла (`ls -la`, размер > 0);
путь без подтверждённого файла не сообщается.
```

- [ ] **Step 3: Финальный полный прогон**

Run: `npm test`
Expected: PASS — все файлы (включая docs-drift с маркерами 5.6.6)

- [ ] **Step 4: Контрольная проверка на реальном экспорте**

Run: `node skills/maestro-feedback-report/timeline.mjs <Session ID>` для текущей сессии без 2-го аргумента (реальный CLI-путь)
Expected: exit 0, JSON с ненулевыми `totals` и `toolTimeMs` (для сессии с активностью)

- [ ] **Step 5: Commit**

```bash
git add package.json manual_docs/overview/changelog.md manual_docs/reference/commands.md AGENTS.md docs/project-context.md
git commit -m "chore: bump 5.6.6 — changelog, доки команд, маркеры версий"
```

- [ ] **Step 6: Push — через гейт 17 (HITL)**

Пуш в main только после явного HITL-аппрува пользователя (гейт 17, маркер merge-guard). До аппрува — только локальные коммиты.
