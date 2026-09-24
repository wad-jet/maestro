# Spec: режимы `@maestro-feedback-report` (auto/manual/disable) в `maestro.json` (#113)

- **Дата:** 2026-09-24
- **Roadmap:** Волна 1, пункт #113 (quick win к релизу)
- **Версия:** 4.7.1 → 4.8.0 (minor — новая фича / процессное правило скилла)
- **Статус:** draft

## Проблема

Отчёт ретроспективы (`@maestro-feedback-report`) генерируется только по
ручному запросу пользователя. TODO: «Отдельный шаг после финального,
подготовка отчёта (maestro-feedback-report). Рассмотреть возможность
отключения с помощью параметра конфигурации maestro.json. Варианты значений:
auto / manual / disable». Роадмап (M2): дефолт — консервативно `manual`,
пока не готов #99 («куда присылать feedback-reports») — auto-дефолт
нежелателен, т.к. отчётам ещё некуда направляться.

## Решение

### 1. Новый верхнеуровневый ключ `maestro.json`: `feedback_report` (строка)

| Значение | Поведение в конце pipeline (новый шаг 18.5) |
|---|---|
| ключ отсутствует / `"manual"` (**дефолт**) | Авто-генерации нет. Одна строка БЕЗ вопроса: «Для сбора отчёта ретроспективы выполните `@maestro-feedback-report`». Заметка — информационное сообщение: стиль следует режиму `communication` (plain/professional); в efficient-режиме (шаг 1.5) допустима — одна строка, не gate и не подтверждение |
| `"auto"` | Автоматически выполняется `skill maestro-feedback-report` (без HITL): отчёт собран и сохранён; сообщение: «Отчёт сохранён в `<путь>` (режим auto). Для добавления комментариев выполните `@maestro-feedback-report`» |
| `"disable"` | Ни заметки, ни генерации — шаг 18.5 не делает ничего видимого |

- Невалидное значение (не одно из трёх) → **soft fallback в `manual`** +
  warn в лог плагина (`feedback_report:config_fallback`, паттерн
  `communication:config_fallback`); в чате уведомление не выдаётся (как у
  `communication`).
- **Механика — плагин (HITL-решение, вариант B):** читает конфиг
  `maestro.json` только плагин (при init, как `communication`/`memory`/
  `trust`); оркестратор/bash ключ **не читают**. Плагин транслирует режим
  скиллам — одной строкой-директивой в system-контекст top-level
  primary-сессии (см. §2). **Смена значения требует перезапуска opencode**
  (конфиг читается при init — прецедент `communication`).

### 2. Новый шаг 18.5 pipeline (`skills/maestro/SKILL.md`)

После шага 18 (merge + bump версии):

- **Маршруты:** feature (все категории, включая Bounded) + bugfix.
  **Spike — НЕ выполняется** (маршрут без шагов 11–18; отчёт не генерируется,
  заметка не показывается).
- **Источник режима — директива плагина в system-контексте.** Плагин
  (мастер-модуль `maestro-bootstrap`) при init разбирает `feedback_report`
  (значения `auto`/`manual`/`disable`; ключ отсутствует → `manual`) и
  **инжектит директиву только при явном non-manual** (`auto`/`disable`):
  одна строка `maestro.json → feedback_report: <mode>` в system-контекст
  top-level primary-сессии (механизм `experimental.chat.system.transform`,
  guard идентичен `communication`: только top-level primary, task-сессии
  субагентов и `[maestro-memory]` исключены; fail-soft). Невалидное
  значение → `manual` + warn `feedback_report:config_fallback` (директива
  не инжектится). **Директивы в system-контексте нет → `manual`** (дефолт:
  ключ отсутствует / значение `manual` / невалидное / старая версия
  плагина — безопасный дефолт во всех случаях). Шаг 18.5 **не читает
  `maestro.json`** (ни read-тулом, ни bash).
- **`auto`:** вызов `skill maestro-feedback-report` (у скилла собственный
  Гейт 0). **Требование к тексту шага 18.5 (промпт-override вызова из
  pipeline; механика скилла не меняется — Гейт 0 и вопросы сохраняются для
  интерактивной команды):** в auto-режиме оркестратор не выполняет
  HITL-указания скилла — (а) жёсткий стоп Гейта 0 (напр., плагин не
  загружен) подавляется; (б) подтверждающие вопросы скилла подавляются,
  включая «либо подтверди у пользователя» на шаге 1 выбора сессии — сессию
  оркестратор выбирает самостоятельно (текущая сессия pipeline,
  `opencode session list`). Любой стоп/сбой/отказ → **fail-soft**: одна
  строка «Отчёт не сгенерирован: <причина>», без HITL — pipeline
  завершается, отчёт не блокирует завершение.
- **`manual`:** только однострочная заметка. **`disable`:** ничего.
- **Новых HITL-gate НЕТ** ни в одном режиме: `manual` — информационная
  заметка; `auto` — поведение, заданное пользователем в конфиге: HITL-точки
  самого скилла (Гейт 0, подтверждающие вопросы) подавляются текстом шага
  18.5 (см. bullet `auto` выше), новых gate шаг 18.5 не добавляет.
  Инварианты ⚑1–4 не затрагиваются (не merge, не принятие спеки, не
  чувствительные изменения).

### 3. Прямой вызов `@maestro-feedback-report` — без изменений

Команда остаётся интерактивной всегда (шаг 2 команды — HITL-фидбек).
Режим из конфига влияет **только** на хук pipeline (шаг 18.5).

## Non-goals

- **Охват изменений плагина — только директива:** разбор ключа + инъекция
  одной строки в system-контекст (прецедент `communication.js`). Без новых
  tool-инструментов, без валидации всей схемы `maestro.json`, без
  re-read-конфига per-run (без перезапуска НЕ делаем — прецедент
  `communication`: конфиг читается при init).
- Без периодов/лимитов отчёта, без авто-отправки (#99 — отдельный пункт),
  без изменений формата отчёта и шагов скилла.
- Без отчёта на Spike-маршруте.

## Файлы

| Файл | Изменение |
|---|---|
| `plugins/maestro-bootstrap/feedback-report.js` | **новый self-contained модуль** (паттерн `communication.js`, НЕ импортирует core.js): разбор `feedback_report` из config (enum `auto`/`manual`/`disable`; отсутствует → manual; невалидное → manual + `invalid: true`), текст директивы, `registerFeedbackReportHooks({client, config, log})` → хук `experimental.chat.system.transform`: инъекция `maestro.json → feedback_report: <mode>` только при явном non-manual, guard top-level primary (без task-сессий/`[maestro-memory]`), fail-soft, warn `feedback_report:config_fallback` |
| `plugins/maestro-bootstrap/core.js` | регистрация `registerFeedbackReportHooks` (рядом с `registerCommunicationHooks`, fail-soft try/catch) + **расширение `chainHooks`: хуки директивы — третий источник в цепочке `experimental.chat.system.transform`** (сегодня ровно два: `commHooks` + `memoryHooks`; без расширения зарегистрированный хук — dead code, директива не инжектится) |
| `plugins/maestro-bootstrap/index.test.js` | unit-тесты: parse (enum/дефолт/невалидное), инъекция директивы (только non-manual, только top-level primary, без task/`[maestro-memory]`), отсутствие директивы при manual/ключе-нет, warn при невалидном, fail-soft (сбой хука не ломает chat) |
| `skills/maestro/SKILL.md` | шаг 18.5 (pipeline feature + bugfix, обзоры маршрутов «0–18» → «0–18.5»; примеры: **feature (L2213) и полный bugfix (L2270) — добавить строку 18.5**; сокращённый пример «Багфикс (interactive mode)» (L2287, «Шаг 18: merge») — осознанно оставить (элидированный пример); bump-упоминания (L231–232) остаются — bump на шаге 18. В тексте шага 18.5 — источник режима: директива плагина в system-контексте, нет директивы → manual; промпт-override для `auto` по §2: подавление Гейта 0 и подтверждающих вопросов скилла, выбор сессии самостоятельно) |
| `skills/maestro-assistant/SKILL.md` | канон: секция «Ключ `feedback_report`» (значения, дефолт, fallback — невалидное → manual + warn в лог; **читает плагин при init — смена значения требует перезапуска opencode** (прецедент `communication`), смена — правка `maestro.json`; **при `/maestro-setup` ключ не генерируется и не спрашивается — отсутствие = manual**, no-silent-opt-in по паттерну секции `memory`) |
| `skills/maestro-feedback-report/SKILL.md` | Overview: примечание «вызов из pipeline (шаг 18.5, режим auto) — тот же скилл; режим — `maestro.json → feedback_report`» |
| `commands/maestro-feedback-report.md` | примечание: режимы pipeline — `maestro.json → feedback_report`; команда всегда интерактивна |
| `manual_docs/reference/config.md` | секция «Ключ `feedback_report`» (значения, дефолт, fallback, «смена — правка `maestro.json` + перезапуск opencode») + список секций (строка 15) |
| `manual_docs/reference/commands.md` | секция `@maestro-feedback-report`: режимы |
| `manual_docs/explanation/pipeline-overview.md` | конец пайплайна: заголовки «Feature-маршрут (0–18)» → «(0–18.5)», «Bugfix-маршрут (0–6 → D1–D7 → 11–18)» → «… → 11–18.5»; шаг-таблица — строка «18.5 | Feedback report» после строки 18 с поведением по `feedback_report`; mermaid — после `Step17 --> Step18["18: Merge в base"]` добавить `Step18 --> Step185["18.5: Feedback report (по feedback_report)"]`. Bugfix-mermaid (сжатый узел «… → Merge») — без правки (шаги 13–18 элидированы) |
| `manual_docs/overview/what-is-maestro.md` | таблица маршрутов: «**Feature** (шаги 0–18)» → «(шаги 0–18.5)», «**Bugfix** (… → шаги 11–18)» → «шаги 11–18.5» |
| `manual_docs/overview/quick-start.md` | после «Шаг 18 — merge в base-ветку.» — строка «Шаг 18.5 — отчёт ретроспективы по `maestro.json → feedback_report` (manual — подсказка команды / auto — авто-сбор / disable — ничего)» |
| `manual_docs/tutorials/run-first-feature.md` | «(шаги 0→18)» → «(шаги 0→18.5)»; заголовок «Шаги 17–18: Завершение» → «Шаги 17–18.5: Завершение»; после «Шаг 18 — merge…» — строка про 18.5 (режимы) |
| `manual_docs/how-to/run-a-bugfix.md` | «завершение (шаги 17–18)» → «завершение (шаги 17–18.5)» + краткое упоминание 18.5 (режим из `feedback_report`) |
| `manual_docs/examples/example-feature.md` | после «Шаг 18: finishing-a-development-branch -> merge to base (--no-ff)» — строка «Шаг 18.5: feedback-report (manual — подсказка команды; режим — `maestro.json → feedback_report`)» |
| `manual_docs/index.md` | «полный цикл 0→18» и «Feature 0→18 и Bugfix D1→D7» → «0→18.5» |
| `manual_docs/tutorials/setup-project.md` | «полный цикл 0→18» → «0→18.5» |
| `manual_docs/overview/changelog.md` | `[Unreleased]` |
| `regression/entries/2026-09-24-feedback-report-modes.md` | риск LOW (плагин — добавительный fail-soft хук; промпт; конфиг) |
| `docs/project-context.md` | pending context changes (шаг 8.5): дрейф версии 4.6.0 → 4.8.0, «176 тестов» → `<N>` (**N — фактическое число тестов из прогона `npm test` на момент записи; значение из спеки не использовать**), §14 — полный список memory-команд (+`@maestro-memory-reindex`, `@maestro-memory-backup`, `memory_probe`) |
| `docs/roadmap.md` | #113 — «**Выполнено (4.8.0, <дата>)**» (паттерн записи #77); пометить в Волне 1: волна закрывается релизом **4.8.0**, метка волны «4.7.x» — историческая, противоречия с minor-правилом нет (#113 — новая фича → бамп 4.7.1 → 4.8.0) |

## Тестирование

- **Новые unit-тесты плагина** (в `index.test.js`): parse `feedback_report`
  (enum / отсутствует → manual / невалидное → manual + invalid), инъекция
  директивы (только явный non-manual; только top-level primary; task-сессии
  и `[maestro-memory]` исключены), warn `feedback_report:config_fallback`
  при невалидном, fail-soft хука. Существующие:
  `node --test plugins/maestro-bootstrap/index.test.js` — без регрессий
  (база 210 + новые).
- **Wiring-тест (I1, прецедент `describe("communication wiring (MaestroBootstrapPlugin)")`):**
  `MaestroBootstrapPlugin` с `feedback_report: "auto"` в maestro.json →
  plugin-level `experimental.chat.system.transform` инжектит директиву.
  Ловит «мёртвую» сборку: хук зарегистрирован, но не включён в `chainHooks`
  (класс дефекта адаптера 3.0.3 — зелёные module-тесты, фича не работает).
  Число тестов для drift-фикса
  `docs/project-context.md` фиксировать фактическим выводом прогона на
  момент записи (см. «Файлы»), не значением из спеки.
- `npm run test:memory` — без регрессий.
- Верификация — diff-сверка доков (AGENTS.md: manual_docs-синк — критерий
  приёмки) + regression entry.
- Grep-сверка конца пайплайна в manual_docs **и `skills/maestro/SKILL.md`**
  — case-insensitive-паттерн `0[–-]18|0→18|шаг ?18|17[–-]18|11[–-]18|step ?18`
  (оба варианта дефиса — en-dash и hyphen; латинский `Step 18`): каждое
  попадание либо обновлено до 18.5, либо осознанно оставлено без правки:
  исторические записи `overview/changelog.md` и «bump — шаг 18 после merge»
  в `reference/hitl-gates.md` (bump остаётся на шаге 18).
- Bump `package.json` 4.7.1 → 4.8.0 — шаг 18 по правилам версионирования
  project-context §3, отдельный коммит `chore: bump version to 4.8.0 —
  feedback-report modes (changelog/version)` на base-ветке после merge.

## Риски

- **R1 (LLM «забывает» шаг 18.5):** шаг вставлен в основной pipeline-блок
  сразу после 18 + в пример feature + regression entry. Отчёт некритичен
  (fail-soft), забывание не ломает pipeline.
- **R2 (auto в конце долгой сессии):** `opencode export` работает для живой
  сессии (используется в `timeline.mjs`) — данные полные.
- **R3 (старая версия плагина / не подключён):** директивы в system-контексте
  нет → режим всегда `manual` (безопасный дефолт: авто-поведения не
  включится само); `auto`-режим просто не активируется. Никаких breaking
  эффектов на старый плагин: неизвестный ключ игнорируется.

## Ключевые решения (auto-ai: решение оркестратора; D6 — HITL)

- **D1:** строка, а не объект (`feedback_report: "auto"`) — YAGNI,
  консистентно с `communication`.
- **D2:** дефолт `manual` (roadmap M2) — консервативно до готовности #99.
- **D3:** `auto` = только скилл (без HITL-шага фидбека): комментарии можно
  дополнить позже через команду — интерактивность команды не трогается.
- **D5:** Spike — без отчёта (маршрут без финальных шагов).
- **D6 (HITL, подтверждено пользователем 2026-09-24):** механизм — вариант
  **B**: конфиг `maestro.json` читает только плагин (при init), плагин
  транслирует режим скиллам — строкой-директивой в system-контекст
  (прецедент `communication`); step 18.5 bash/read-чтение конфига **не
  выполняет**. Смена режима — правка `maestro.json` + перезапуск opencode.
  (Вариант A — per-run bash-чтение на шаге 18.5 без изменений плагина —
  отклонён: обход нативного read-deny, расхождение с архитектурой
  «читает только плагин».)

<!-- maestro:sanitize
status: CLEAN
date: 2026-09-24
reviewer: sanitizer
hash: 4fadb35cc91b5f61925d62252d3d81edba59900f6ba72f3a7c505ee7d9291519
-->

<!-- maestro:review
reviewer: opus
date: 2026-09-24
verdict: approve
hash: fc57e073121b37adf8e83c463b3a3e4b8d1dd2ad828496e73aa1d6bca28858d9
-->
