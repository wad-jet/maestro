# Spec: приведение документации в соответствие (README ↔ manual_docs)

> Статус: черновик для разработки. Дата: 2026-08-20.
> Репо: `maestro-agent` (authoring). Масштаб: контент/документация, не код.

## Постановка

Привести документацию репозитория к единой структуре: README становится тонким
индексом-интро (обзор, онбординг, ссылки), ручная документация `manual_docs/`
становится единственным источником деталей. Сейчас:

- README содержит много таблиц и конфигов (агенты, tiers, конфиги, security,
  команды, модели, flow), частично дублирующих manual_docs.
- `manual_docs/explanation/` содержит 14 пустых болванок — 13 `step-*.md` +
  `debug-sub-pipeline.md` («[Детали в разработке]»), фрагментирующих описание
  pipeline по шагам.
- Есть несоответствия: `@maestro` вместо `/maestro`, прочерки вместо ссылок,
  устаревшие ссылки.

## Цели

1. README = тонкий индекс: обзор + онбординг + ссылки. Все детали — в manual_docs.
2. Одна flow-page `explanation/pipeline-overview.md` описывает весь pipeline
   (feature + bugfix маршруты): таблицы шагов + mermaid-диаграммы + пояснения.
3. Удалить 14 болванок (`step-*.md` + `debug-sub-pipeline.md`); index.md очищается.
4. Конфиги вынести в `reference/config.md`.
5. Исправить несоответствия (ссылки, `/maestro`, прочерки).
6. Сохранить тематические углубления (reference/explanation) как есть.

## НЕ входит в scope

- Изменение поведения скилла, команд, плагина. Только документация.
- Переписывание `skills/maestro/SKILL.md` (источник истины, не трогаем).
- Заполнение существующих `overview/`, `tutorials/`, `how-to/` новым контентом
  (вне этой спеки; только удаление/правка несоответствий на них).

## Текущее состояние

- `README.md` — 12 разделов, многие дублируют manual_docs (агенты, конфиги,
  security, команды, модели, flow-таблицы+mermaid).
- `manual_docs/explanation/` — 13 пустых `step-*.md` (все «[Детали в разработке]`)
  + `pipeline-overview.md` (55 строк, обзор «почему так», не flow) +
  `agents-and-trust.md`, `project-context.md` (заполнены).
- `manual_docs/reference/` — `hitl-gates.md`, `feature-classification.md`,
  `model-selection.md`, `commands.md` (заполнены).
- `manual_docs/index.md` — перечисляет все 13 болванок; строка «Вход — команда
  `@maestro`» (устаревший префикс).
- README «Подход к разработке» — таблицы маршрутов + mermaid (feature+bugfix).

## Целевое состояние

### README.md (тонкий индекс)

Остаются разделы:

- Шапка (что это, authoring-репо, ссылка на manual_docs)
- «Что это» (компоненты, сжато)
- «Быстрый старт» (онбординг: скопировать в целевой проект, `/maestro-init`,
  запуск `/maestro`)
- «Структура репо»
- «Синхронизация» (source → runtime copy)
- «Тесты плагина»
- «Документация» (одна ссылка на manual_docs/index.md — вход в полные доки)

Удаляются (переносятся в manual_docs):

- «Подход к разработке» (таблицы+mermaid) → `explanation/pipeline-overview.md`
- «Агенты и tiers» → `reference/model-selection.md` (уже есть, README ссылается)
- «Конфигурация» (maestro.json, opencode.json, env vars) → `reference/config.md`
- «Security и Sanitizer» → `explanation/agents-and-trust.md` (уже есть)
- «Команды» → `reference/commands.md` (уже есть)
- «Рекомендации по моделям» → `reference/model-selection.md` (уже есть)

README в разделе «Документация» заменяет список ссылок на одну ссылку
manual_docs/index.md (вход в Diátaxis).

### manual_docs/explanation/pipeline-overview.md (переработать)

Полная flow-page, заменяет текущий обзор + 13 болванок. Структура:

1. **Предисловие** — вход `/maestro`, HITL-гейты (кратко, ссылка на hitl-gates).
2. **Feature-маршрут (0–18)**:
   - Таблица: шаг → назначение → ссылки на углубления (project-context,
     feature-classification, hitl-gates, agents-and-trust, config, model-selection).
   - Mermaid-диаграмма TB (перенос из README).
   - Пояснение каждого шага (компактно, «зачем» + «как влияет на пользователя»).
3. **Bugfix-маршрут (0–6 → D1–D7 → 11–18)**:
   - Таблица шагов D1–D7 + ссылки.
   - Mermaid-диаграмма TB с петлёй D6→D1.
   - Пояснения debug sub-pipeline.
4. **Связанные разделы** — ссылки на reference/explanation углубления.

Источники: `skills/maestro/SKILL.md` (истина), текущие таблицы/диаграммы из README,
`reference/hitl-gates.md`, `reference/feature-classification.md`. Стиль — Diátaxis
explanation: «как устроен pipeline и почему», а не близкий к тексту пересказ SKILL.md.

### manual_docs/reference/config.md (новая)

Справочник формата/ключей конфигов:

- `maestro.json`: секции `trust`, `access_policy`, `sanitizer_whitelist` (JSON-пример).
- `opencode.json`: регистрация плагина + модели агентов (`agent.*`).
- Переменные окружения: `MAESTRO_BOOTSTRAP_LOG_LEVEL`, `MAESTRO_BOOTSTRAP_LOG_DIR`
  (дефолт `.maestro/logs`), `MAESTRO_BOOTSTRAP_LOG_MASK`, `MAESTRO_CONFIG`,
  `MAESTRO_SANITIZER_MODE` (гибридный режим sanitizer, `skills/maestro/SKILL.md`).
- Разрешение конфигов (resolution order), дефолты, fail-open.
- Источник: `plugins/maestro-bootstrap/README.md`, `examples/maestro.example.json`.

### Удалить

- `manual_docs/explanation/step-0-project-context.md`
- `manual_docs/explanation/step-1-route-selection.md`
- `manual_docs/explanation/step-15-interaction-mode.md`
- `manual_docs/explanation/step-2-6-preflight-isolation.md`
- `manual_docs/explanation/step-7-feature-classification.md`
- `manual_docs/explanation/step-8-spec-formation.md`
- `manual_docs/explanation/step-9-spec-review.md`
- `manual_docs/explanation/step-11-implementation-plan.md`
- `manual_docs/explanation/step-13-sdd.md`
- `manual_docs/explanation/step-14-documentation.md`
- `manual_docs/explanation/step-15-checks.md`
- `manual_docs/explanation/step-16-code-review.md`
- `manual_docs/explanation/step-18-merge.md`
- `manual_docs/explanation/debug-sub-pipeline.md`

(содержимое — краткие наброски — переносится в pipeline-overview.md)

### manual_docs/index.md

- Убрать список 13 болванок step-*.md и debug-sub-pipeline из навигации.
- Добавить: `reference/config.md` в Reference.
- Исправить `@maestro` → `/maestro` (шапка, разделы: quick-start, commands ссылки).
- Пройденные pages: pipeline-overview.md остаётся в Explanation (заголовок/аннотацию
  обновить под «весь pipeline»).

### Несоответствия (фикс по user-facing доки)

`@maestro`, `@maestro-init`, `@regression`, `@test-*` в контексте команд →
`/maestro`, `/maestro-init`, `/regression`, `/test-*`. Осторожно: `@` остаётся
для агентов (`@haiku` и т.п.) и `@command` как родового понятия конфиг-файла.

**Scope файлов под @→/ фикс (user-facing):**
- `manual_docs/reference/commands.md` — все `@maestro`/`@regression`/`@test-*`
- `manual_docs/overview/what-is-maestro.md`
- `manual_docs/overview/quick-start.md`
- `manual_docs/tutorials/setup-project.md`
- `manual_docs/how-to/use-regression-registry.md`
- `manual_docs/explanation/agents-and-trust.md`
- `manual_docs/explanation/pipeline-overview.md` (при переработке)
- `plugins/maestro-bootstrap/README.md` (docs плагина, также user-facing)
- `manual_docs/index.md` (шапка, ссылки)

**Исключения (НЕ править):**
- `manual_docs/overview/changelog.md` — историческая летопись: фиксирует прошлые
  состояния с префиксом @ как было на тот момент. История не переписывается.
- `AGENTS.md` — dev/agent-facing инструкция, не user-facing доки (вне scope;
  при желании отдельная задача).
- `@` для агентов и `@command` (родовое) — сохраняется.

Прочерки `—` в flow-таблицах (README/manual_docs, шаги 8.5, D3/D4/D5 и т.п.) →
реальные ссылки на pipeline-overview.md или тематические страницы (где есть).

**Проверка битых ссылок:** после реструктуры прогнать проверку существования
всех `*.md`-ссылок в `manual_docs/` (grep-based: каждый указанный путь должен
существовать; битые — исправить).

## Решения

- README — тонкий индекс (по решению пользователя).
- Одна flow-page в `explanation/pipeline-overview.md` (переработка существующей,
  не новый файл), а не 13 болванок.
- Конфиги — `reference/config.md` (справочник ключей, не explanation).
- Тематические углубления (hitl-gates, feature-classification, model-selection,
  commands, agents-and-trust, project-context) сохраняются и остаются источником
  глубоких тем; flow-page на них ссылается.

## Критерии приёмки

- README не содержит таблиц агентов/конфигов/security/команд/flow; вместо них —
  ссылки на manual_docs.
- `manual_docs/explanation/pipeline-overview.md` — полная flow-page: feature и
  bugfix маршруты, таблицы + mermaid, пояснения, ссылки на углубления.
- 13 болванок step-*.md + debug-sub-pipeline.md удалены; index.md очищен.
- `manual_docs/reference/config.md` создан и заполнен (maestro.json, opencode.json,
  env).
- Во всех user-facing доки (README, manual_docs pages, plugins/README) нет ни
  одного `@maestro`/`@maestro-init`/`@regression`/`@test-*` в контексте команд —
  только `/...`. Исключение: changelog.md (история), AGENTS.md, `@` для агентов,
  `@command` (родовое). Проверка — grep по scope-файлам.
- Нет битых ссылок в manual_docs (grep-based проверка существования всех
  `*.md`-путей), прочерки `—` в flow-таблицах заменены реальными ссылками.
- manual_docs/index.md — валидная навигация (все перечисленные файлы существуют,
  удалённые step-*.md/debug-sub-pipeline.md из списков убраны, config.md добавлен).

## Открытые вопросы (решить до/в ходе)

- Полнота config.md: зеркалить все ключи из `plugins/maestro-bootstrap/README.md`
  или только дефолтные? Решение — покрыть дефолтные ключи и структуру, детальные
  whitelist-rules оставить со ссылкой на plugins-README.
- Как глубоко расписывать каждый шаг в pipeline-overview.md (объём)? Решение —
  компактно: строка таблицы + 1–2 предложения «зачем/как влияет» + ссылки.