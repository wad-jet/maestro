# Regression-Entries Freshness (#103, 4.19.0) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** cross-entry reconciliation — пайплайн (шаги 11/13f) поддерживает актуальность чужих regression-entries при прогоне фичи.

**Architecture:** расширение существующих regression-хуков (M5/M6 — не новая команда/шаг): шаг 11 — cross-entry selection (механический выбор «под угрозой» entries), шаг 13f — reconciliation (existence/diff-проверки, HITL a/b/c). Механики — в главе `references/regression-registry.md`; скелет SKILL.md — компактные указатели. `active` — мутации; `verified` — read-only.

**Tech Stack:** markdown-каноны (SKILL.md, references/, manual_docs/), `npm test` (docs-drift).

**Оркестратор-чекпоинт (НЕ SDD-таска):** после T3 — прогон cross-entry 13f по новым правилам (dogfooding, критерий 5 спеки): дифф 4.19.0 трогает `skills/maestro/SKILL.md` + `references/regression-registry.md` → entries с file-аргументом `run:` = SKILL.md «под угрозой» → reconciliation + HITL в рамках этой же фичи.

---

### Task 1: Глава `regression-registry.md` — секция «Cross-entry reconciliation (13f)» + канон-фиксы

**Files:**
- Modify: `skills/maestro/references/regression-registry.md`

- [ ] **Step 1:** Прочитать канон `skills/maestro/references/regression-registry.md` (полностью) и спеку `docs/superpowers/specs/2026-10-01-regression-entries-freshness-design.md` (D1–D7).
- [ ] **Step 2:** Новая секция `## Cross-entry reconciliation (13f)` (между «Жизненный цикл» и «Команда»), ~40–50 строк, канонический стиль главы (маркдаун, без прозы-стен):
  - **Selection (шаг 11):** источник `entries/` (active — мутации; verified — read-only); entry текущей фичи — исключена; цель сценария — каскад `path` → file-аргумент `run:` (grep/sed — последний file-аргумент; `node --test <file>` — файл; `npm run <script>` — манифест) → без целей сценарий не выбирается (prose-лимитация); пересечение с file-set плана (файлы задач + `## Project Context Changes` + path-резолвящиеся risk-модули; каталог-префиксы; module-хинты «(SKILL.md):» не матчатся); cap ≤ 5 (порядок: число пересекающихся сценариев desc, тир `added` desc); остаток — в вывод 13f/progress-лог; результат — секция `## Cross-Entry Reconciliation` в плане.
  - **Сверка (13f):** пересчёт по фактическому диффу (union с планом); existence — по ВСЕМ automated-сценариям выбранного entry (цель `test -f`); diff-условные — по пересекающимся: `path:line` дрейф (LLM-суждение по строке) и числовые ожидания `→ N pass/fail/0`; категории A (локус/цель отсутствует) / B (числовое stale-подозрение); 0 запусков чужих тестов.
  - **HITL:** один гейт на все entries (entry → сценарий → категория → a/b/c); (a) обновить — локация чтением файла, число — **один bounded-запуск** этого сценария (carve-out); (b) `[Manual]`; (c) удалить; пустой active-entry запрещён → HITL: (a) cancelled в `released/` (`cancelled-features.md`) — единственный статус-переход (carve-out D4).
  - **Границы мутации:** только локации/команды/ожидания сценариев; `status`/`last_full_pass`/`released`/`added`/`risk`/`version`/`feature` — не трогаются; авто-коммит — только путь entry, `chore(regression): <feature> entry reconciled by <текущая-фича>`; no-op: пустой список selection.
- [ ] **Step 3:** Фиксы канона (та же глава):
  - строка 13: «**Дизайн:** `docs/regression-flow.md` (источник истины). Pipeline встраивает 3 хука…» → заменить ссылку: файл не существует. Новое: «Канон — эта глава. Pipeline встраивает 3 хука…» (дальше — без изменений);
  - «Жизненный цикл» — абзац: «Cross-entry-обновления (13f): active — только сценарии (локации/команды/ожидания), статусы не меняются (carve-out: empty → cancelled); verified — read-only чек (расхождения — в отчёт 13f), мутации — только через `@regression`»;
  - буллет «`1 файл = 1 фича` — sharded append-only: конфликт параллельных pipeline невозможен по построению» → уточнить: «…конфликт параллельных pipeline маловероятен по построению (исключение — cross-entry reconciliation 13f, обновляющий чужой entry; при merge-конфликте — повторная reconciliation после мержа)»;
  - «Жизненный цикл» — guard vacuous-full: «`full` на entry **без automated-сценариев** не верифицирует (статус не меняется; предупреждение в выводе)».
- [ ] **Step 4:** Проверка: `grep -c "regression-flow" skills/maestro/references/regression-registry.md` → 0; `wc -l` главы — рост ≤ ~60 строк; секция «Cross-entry reconciliation (13f)» на месте; `npm test` → 266/266.
- [ ] **Step 5:** Коммит: `git add skills/maestro/references/regression-registry.md && git commit -m "docs: #103 T1 — глава regression-registry: Cross-entry reconciliation (13f) + канон-фиксы (regression-flow, шардинг, vacuous-full)"`

### Task 2: `commands/regression.md` — vacuous-full guard + fix ссылки

**Files:**
- Modify: `commands/regression.md`

- [ ] **Step 1:** Прочитать `commands/regression.md` полностью.
- [ ] **Step 2:** Строка 8: «Дизайн: `docs/regression-flow.md`; `skills/maestro/references/regression-registry.md`.» → «Канон: `skills/maestro/references/regression-registry.md` (глава regression-registry).»
- [ ] **Step 3:** Секция «Статус-эффекты (только для `full`)» — в начало списка добавить пункт: «- Entry **без automated-сценариев**: статус НЕ меняется (не верифицируется вакуумно); предупреждение в выводе «skipped: no automated scenarios»».
- [ ] **Step 4:** Проверка: `grep -c "regression-flow" commands/regression.md` → 0; «no automated scenarios» — 1 вхождение; `npm test` → 266/266.
- [ ] **Step 5:** Коммит: `git add commands/regression.md && git commit -m "docs: #103 T2 — commands/regression.md: vacuous-full guard + fix битой ссылки (regression-flow)"`

### Task 3: SKILL.md скелет — шаг 11 (selection) + шаг 13f (reconciliation)

**Files:**
- Modify: `skills/maestro/SKILL.md` (шаг 11: блок «Regression risk + scenarios (шаг 11, а не 8.5)» ~L674–683; шаг 13f: блок «f. Regression reconciliation (P1)» ~L760–771)

- [ ] **Step 1:** Прочитать шаг 11 (блоки «Regression risk + scenarios») и 13f.f в `skills/maestro/SKILL.md` + новую секцию главы (T1) + спеку D1.
- [ ] **Step 2:** Шаг 11 — после буллета «Ни один сигнал → entry не создаётся (без рисков)» добавить подпункт (стиль скелета, коротко):
  ```
  - **Cross-entry selection (#103, 4.19.0):** «под угрозой» entries —
    `regression/entries/`, чьи цели сценариев (`path` → file-аргумент
    `run:`) пересекаются с file-set плана (cap ≤ 5). Механика —
    `references/regression-registry.md`, «Cross-entry reconciliation
    (13f)». Результат — секция `## Cross-Entry Reconciliation` в плане.
    Пересечений нет → no-op.
  ```
- [ ] **Step 3:** Шаг 13f.f — расширить (после пункта 4 «Reconciliation — отдельный хук…», **до** пункта про «Если entry не создана»):
  ```
  5. **Cross-entry reconciliation (#103, 4.19.0):** по списку из шага 11
     (пересчёт по фактическому диффу, union) — existence/diff-проверки
     чужих entries (active — мутации через HITL a/b/c; verified —
     read-only, расхождения в отчёт). 0 запусков чужих тестов (carve-out:
     bounded-запуск одного сценария при выборе (a) по числовому
     ожиданию). Механика — `references/regression-registry.md`,
     «Cross-entry reconciliation (13f)». Пустой список → no-op.
  ```
- [ ] **Step 4:** Реструктуризация skip-предложения 13f.f: «Если entry не создана (не было risk-сценариев на шаге 11) — шаг пропускается» → «Если **own-entry** не создана (не было risk-сценариев на шаге 11) — **own-entry часть** пропускается; cross-entry часть — свой no-op (пустой список selection)».
- [ ] **Step 5:** Проверка: `grep -n "Cross-entry" skills/maestro/SKILL.md` → 2+ вхождения (11 и 13f); рост скелета ≤ ~20 строк (wc -l: 1171 → ≤1191); `npm test` → 266/266 (docs-drift D3: метка «~1170 строк» в AGENTS.md — допуск ±50, не краснеет).
- [ ] **Step 6:** Коммит: `git add skills/maestro/SKILL.md && git commit -m "docs: #103 T3 — SKILL.md: шаг 11 cross-entry selection + 13f cross-entry reconciliation (указатели на главу)"`

**Оркестратор-чекпоинт (после T3, ДО T4):** прогнать cross-entry 13f по новым правилам (dogfooding, критерий 5): `git diff main...HEAD --name-only` ∩ цели entries → список «под угрозой» (ожидается: entries с grep/file-аргументами на `skills/maestro/SKILL.md` — напр. `2026-09-18-subagent-resilience.md`); reconciliation (факты) → HITL a/b/c → авто-коммит обновлённых entries (`chore(regression): …`).

### Task 4: manual_docs-синк

**Files:**
- Modify: `manual_docs/how-to/use-regression-registry.md` (77 строк; секция «Как это встраивается в pipeline» ~L26)
- Modify: `manual_docs/explanation/pipeline-overview.md` (таблица шагов — строка 13f)

- [ ] **Step 1:** Прочитать `manual_docs/how-to/use-regression-registry.md` и таблицу шагов `manual_docs/explanation/pipeline-overview.md`.
- [ ] **Step 2:** `use-regression-registry.md` — в секцию «Как это встраивается в pipeline» добавить (стиль страницы: таблицы/списки, без стен; правила читабельности R1–R6 `skills/manual-docs/SKILL.md`): абзац/список «Актуальность entries (cross-entry reconciliation, 4.19.0)»: шаг 11 выбирает entries, затронутые планом (цели сценариев ∩ file-set); 13f сверяет локации/команды/числовые ожидания (active — обновляет через HITL, verified — только отчёт); `@regression` — без изменений (standalone).
- [ ] **Step 3:** `pipeline-overview.md` — строка шага 13f в таблице шагов: добавить «+ cross-entry reconciliation чужих entries (4.19.0)» (если строка таблицы после правки > 600 знаков по методике wall-scan — вынести детали после таблицы, как в шаге 16).
- [ ] **Step 4:** Проверка: `node /tmp/wall-scan.mjs manual_docs/how-to/use-regression-registry.md manual_docs/explanation/pipeline-overview.md` → 0 стен (скрипт: fences off, списки/таблицы построчно, проза-блоки >600 = стена; если скрипта нет — воссоздать по методике); `npm test` → 266/266.
- [ ] **Step 5:** Коммит: `git add manual_docs/how-to/use-regression-registry.md manual_docs/explanation/pipeline-overview.md && git commit -m "docs: #103 T4 — manual_docs-синк: use-regression-registry (актуальность entries) + pipeline-overview (шаг 13f)"`

### Task 5: Финальный синк (changelog/roadmap/regression entry/TODO)

**Files:**
- Modify: `manual_docs/overview/changelog.md`, `docs/roadmap.md`, `TODO.md` (gitignored)
- Create: `regression/entries/2026-10-01-regression-entries-freshness.md`

- [ ] **Step 1:** `changelog.md` — раздел `## [2026-10-01]`, `> **Версия 4.19.0** — Minor-релиз: …`: Добавлено (cross-entry reconciliation: 11-selection + 13f-сверка, active/verified-границы, vacuous-full guard) / Изменено (канон: шардинг-уточнение, битая ссылка regression-flow; commands/regression.md; SKILL.md 11/13f; manual_docs).
- [ ] **Step 2:** `docs/roadmap.md` — #103 → «**Выполнено (4.19.0, 2026-10-01):**» (формат как #97: сводка + regression-ссылка).
- [ ] **Step 3:** `regression/entries/2026-10-01-regression-entries-freshness.md` — entry фичи (формат соседних): risk LOW (каноны доков, плагин не затронут); scenarios: (a) `npm test` (drift D4: «Выполнено (4.19.0)» ↔ changelog); (b) [Manual] cross-entry 13f: прогон фичи, затрагивающей файл из чужого entry → 11-селекция + 13f-сверка; regressions: шардинг-конфликт (маловероятен; mitigation — повторная reconciliation после merge); dogfooding: кейс T3-чекпоинта (SKILL.md-entries, «3 попыток»).
- [ ] **Step 4:** `TODO.md` — строка 23 («Regression entries могут устаревать…») → `[x]` + «реализовано (2026-10-01, 4.19.0, #103): …» (формат соседних; TODO gitignored).
- [ ] **Step 5:** Проверка: `npm test` → 266/266 (drift: D1a/D1b метки AGENTS/project-context = 4.18.0 = package.json — НЕ ТРОГАТЬ, bump на merge; D4 согласован); `git status` — изменены ровно 3 файла + 1 новый.
- [ ] **Step 6:** Коммит: `git add manual_docs/overview/changelog.md docs/roadmap.md regression/entries/2026-10-01-regression-entries-freshness.md && git commit -m "docs: #103 T5 — changelog 4.19.0, roadmap #103, regression entry"`

---

## Верификация (после T5, перед финальным ревью)

- `npm test` — 266/266.
- Критерии приёмки спеки 1–5 (в т.ч. dogfooding-чекпоинт T3 — выполнен оркестратором).
- Финальное ревью (шаг 16): тип артефакта {docs} → одиночный `reviewer`, критерии docs + §9.
- Merge → bump 4.19.0 (package.json, project-context §3, AGENTS-метка «~N строк, 4.19.0») → push → agpack sync → feedback-отчёт (auto).
