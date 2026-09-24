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
| ключ отсутствует / `"manual"` (**дефолт**) | Авто-генерации нет. Однострочная заметка БЕЗ вопроса: «Для сбора отчёта ретроспективы выполните `@maestro-feedback-report`» |
| `"auto"` | Автоматически выполняется `skill maestro-feedback-report` (без HITL): отчёт собран и сохранён; сообщение: «Отчёт сохранён в `<путь>` (режим auto). Для добавления комментариев выполните `@maestro-feedback-report`» |
| `"disable"` | Ни заметки, ни генерации — шаг 18.5 не делает ничего видимого |

- Невалидное значение (не одно из трёх) → **soft fallback в `manual`** +
  однострочное уведомление в чате (паттерн `communication:config_fallback`).
- Ключ читается **каждый запуск** на шаге 18.5 (см. ниже) → **перезапуск
  opencode при смене значения НЕ требуется** (в отличие от `communication`,
  который читает плагин при init).

### 2. Новый шаг 18.5 pipeline (`skills/maestro/SKILL.md`)

После шага 18 (merge + bump версии):

- **Маршруты:** feature (все категории, включая Bounded) + bugfix.
  **Spike — НЕ выполняется** (маршрут без шагов 11–18; отчёт не генерируется,
  заметка не показывается).
- **Чтение ключа:** `maestro.json` — через bash (`node -e` — нативный
  read-deny на `maestro.json`; канон: maestro-assistant, «Процедура смены
  режима»). Ключ отсутствует → `manual`.
- **`auto`:** вызов `skill maestro-feedback-report` (у скилла собственный
  Гейт 0). Сбой/стоп скилла (напр., плагин не загружен) → **fail-soft**:
  «Отчёт не сгенерирован: <причина>» — pipeline завершается, отчёт не
  блокирует завершение.
- **`manual`:** только однострочная заметка. **`disable`:** ничего.
- **Новых HITL-gate НЕТ** ни в одном режиме: `manual` — информационная
  заметка; `auto` — поведение, заданное пользователем в конфиге (HITL-обход
  не происходит — вопрос по сути не существует). Инварианты ⚑1–4
  не затрагиваются (не merge, не принятие спеки, не чувствительные изменения).

### 3. Прямой вызов `@maestro-feedback-report` — без изменений

Команда остаётся интерактивной всегда (шаг 2 команды — HITL-фидбек).
Режим из конфига влияет **только** на хук pipeline (шаг 18.5).

## Non-goals

- **Без изменений плагина:** плагин читает только свои ключи
  (`trust`/`confidential`/`sanitizer_whitelist`/`memory`/`communication`),
  неизвестные игнорирует (проверено: `core.js` — пермиссивный read). Режим —
  процессное правило скилла (промпт), не механика.
- Без периодов/лимитов отчёта, без авто-отправки (#99 — отдельный пункт),
  без изменений формата отчёта и шагов скилла.
- Без отчёта на Spike-маршруте.

## Файлы

| Файл | Изменение |
|---|---|
| `skills/maestro/SKILL.md` | шаг 18.5 (pipeline feature + bugfix, обзоры маршрутов «0–18» → «0–18.5», пример feature) |
| `skills/maestro-assistant/SKILL.md` | канон: секция «Ключ `feedback_report`» (значения, дефолт, fallback, чтение через bash, **без перезапуска**, смена — правка `maestro.json`) |
| `skills/maestro-feedback-report/SKILL.md` | Overview: примечание «вызов из pipeline (шаг 18.5, режим auto) — тот же скилл; режим — `maestro.json → feedback_report`» |
| `commands/maestro-feedback-report.md` | примечание: режимы pipeline — `maestro.json → feedback_report`; команда всегда интерактивна |
| `manual_docs/reference/config.md` | секция «Ключ `feedback_report`» + список секций (строка 15) |
| `manual_docs/reference/commands.md` | секция `@maestro-feedback-report`: режимы |
| `manual_docs/overview/changelog.md` | `[Unreleased]` |
| `regression/entries/2026-09-24-feedback-report-modes.md` | риск LOW (только промпт/конфиг, без кода) |
| `docs/project-context.md` | pending context changes (шаг 8.5): дрейф версии 4.6.0 → 4.8.0, «176 тестов» → 210, §14 — полный список memory-команд (+`@maestro-memory-reindex`, `@maestro-memory-backup`, `memory_probe`) |
| `docs/roadmap.md` | #113 — выполнено; Волна 1 закрыта |

## Тестирование

- Изменений кода нет → новых unit-тестов нет. Существующие:
  `node --test plugins/maestro-bootstrap/index.test.js` (210) — без регрессий.
- `npm run test:memory` — без регрессий.
- Верификация — diff-сверка доков (AGENTS.md: manual_docs-синк — критерий
  приёмки) + regression entry.

## Риски

- **R1 (LLM «забывает» шаг 18.5):** шаг вставлен в основной pipeline-блок
  сразу после 18 + в пример feature + regression entry. Отчёт некритичен
  (fail-soft), забывание не ломает pipeline.
- **R2 (auto в конце долгой сессии):** `opencode export` работает для живой
  сессии (используется в `timeline.mjs`) — данные полные.

## Ключевые решения (auto-ai, решение оркестратора)

- **D1:** строка, а не объект (`feedback_report: "auto"`) — YAGNI,
  консистентно с `communication`.
- **D2:** дефолт `manual` (roadmap M2) — консервативно до готовности #99.
- **D3:** `auto` = только скилл (без HITL-шага фидбека): комментарии можно
  дополнить позже через команду — интерактивность команды не трогается.
- **D4:** без перезапуска opencode (конфиг читается per-run на шаге 18.5).
- **D5:** Spike — без отчёта (маршрут без финальных шагов).

<!-- maestro:sanitize
status: CLEAN
date: 2026-09-24
reviewer: sanitizer
hash: 4fadb35cc91b5f61925d62252d3d81edba59900f6ba72f3a7c505ee7d9291519
-->
