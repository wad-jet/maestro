# Project Context — maestro

## 1. Название и назначение

`maestro` — система (набор OpenCode-скиллов/команд/агентов + плагин `maestro-bootstrap`)
для оркестрации фич и багфиксов в целевом приложении. Этот репозиторий — **авторский**
(authoring): здесь живут источники скиллов, агентов, команд, плагина, внутреннего
стандарта безопасности (`SECURITY.md`) и пользовательской документации (`manual_docs/`).

Проект self-hosted: он также установлен в сам себя (dogfooding) для разработки по
собственному пайплайну (`@maestro-init`, `/maestro-setup`, `/maestro-design`,
`/maestro-assistant`).

Тип проекта: авторский репозиторий (набор инструментов для OpenCode), не целевое
приложение конечного пользователя.

## 2. Цели и метрики успеха

- **Цель:** корректная, безопасная и воспроизводимая оркестрация фич/багфиксов через
  пайплайн maestro (design → spec → plan → SDD → review) в целевом приложении.
- **Безопасность:** соблюдение внутреннего стандарта ИБ `SECURITY.md` (trust-модель,
  требования P1–P5, инварианты confidential/access_policy/sanitizer).
- **Самоподдерживаемость (dogfooding):** maestro способен разрабатывать сам себя по
  собственному пайплайну.
- **Non-goals:** не является продуктовым приложением для конечных пользователей; не
  содержит бизнес-логики целевых приложений.

## 3. Стек технологий

- **Язык/рантайм:** Node.js (ESM), TypeScript-совместимые JS-модули.
- **Платформа:** OpenCode (скиллы/команды/агенты/плагин).
- **Плагин:** `plugins/maestro-bootstrap/` — ESM-плагин, тесты на встроенном
  Node test runner (`node --test`).
- **Документация:** Markdown (skills, commands, agents, SECURITY.md, manual_docs).
- **Инструменты:** git, `agpack` (доставка скиллов/команд/агентов в `.opencode/`),
  bash (скрипты `maestro-install.sh`, `maestro-sandbox.sh`).
- **Менеджер:** npm (только для плагина, `package.json`).
- **Текущая версия дистрибутива:** `3.3.1` (корневой `package.json → version`; единая
  для скиллов и плагина, см. `manual_docs/how-to/update-maestro.md`).
- **Memory layer:** опциональный модуль плагина (векторная память сессий); НЕ часть
  стандартной установки, включается по запросу (секция `memory` в `maestro.json`;
  см. `manual_docs/reference/memory.md`). **Статус: beta** — API/схема записей/конфиг
  могут меняться без обратной совместимости, данные не гарантируют миграцию.
  v2: гибридный FTS5-поиск, инструменты
  управления (`memory_forget`/`memory_export`/`memory_import`/`memory_recall_preview`/
  `memory_stats_detail`), команды `@maestro-memory`/`@maestro-memory-report`. v3a:
  **паритет бэкендов** — гибридный текстовый поиск (pg: tsvector+ts_rank, qdrant:
  payload full-text) и кросс-проектный поиск (sqlite: read-only соседние БД) на всех
  трёх бэкендах; ключ `storage.pgvector.text_search_config` (default `russian`). v3:
  **branch-aware memory** — идентичность записи по коммиту (`head`), commit-scoped
  recall (general/experience/не в контексте), промоция по `is-ancestor(head, mainline)`,
  mainline авто-детект из git, ключи `branch_context`/`mainline`; **`centralized_confidential`
  удалён** (решение локально/удалённо — только `storage.type`). **v5 (branch-governed
  lifecycle):** жизненный цикл записей — по git-якорю (head/ветка), а не сессии;
  `session.deleted` сохраняет запись (флаг `delete_on_session_delete`, default false);
  write-gate по head (non-git инертны); поле `host`; HITL `/maestro-memory-prune`.
  **v5.1 (namespace-идентичность):** обязательный валидируемый namespace
  (формат `a.b.c`, 1–3 сегмента, lowercase) — единственный ключ; домен-авто-related
  (родитель+братья, merged-only); `related` (кросс-домен, merged-only, 1:1);
  коллизии (warn-on-new); `memory_migrate` (from:auto); поля `origin_remote`/`prefixes`.
  **v4 (external
  embeddings):** опциональный внешний OpenAI-совместимый embedder
  (`memory.embedding.provider: "openai"`), probe доступности модели (старт+cooldown+
  on-demand `memory_probe`), маскирование recall-запросов. **v4 (audit log):**
  отдельный аудит-лог memory layer (`.maestro/logs/maestro-memory-<дата>.log`,
  aggregates-only field whitelist, env `MAESTRO_MEMORY_LOG_LEVEL/_MASK/_DIR`).

## 4. Архитектура

- **`skills/`** — источники скиллов maestro (`maestro`, `maestro-setup`, `maestro-design`,
  `maestro-assistant`, `maestro-feedback-report`, `manual-docs`).
- **`agents/`** — промпты субагентов (`custodian`, `sanitizer`, `opus`, `sonnet`,
  `haiku`, `fable`, `code-reviewer`).
- **`commands/`** — команды `@maestro-init`, `/maestro-setup`, `/maestro-design`, и др.
- **`plugins/maestro-bootstrap/`** — плагин: санитайзинг промптов, access_policy,
  confidential-контур, observability-логи.
- **`SECURITY.md`** — внутренний стандарт ИБ (источник истины для security-решений).
- **`manual_docs/`** — пользовательская документация (Diátaxis) для разработчиков
  целевых приложений.
- **`specs/`** — авторские design-доки/планы работы над этим репозиторием (AGENTS.md).

**Пути spec/plan:** новые спеки и планы всех фич/багфиксов — только в
`docs/superpowers/{specs,plans}/` (правило AGENTS.md, 2026-09-02). `specs/`
(корень) — историческая запись прошлых работ; новые файлы туда не добавляются.

## 5. Домены / модули

- `plugins/maestro-bootstrap/` — логика плагина (core.js, index.js, тесты).
- `plugins/maestro-bootstrap/memory/` — **опциональный** модуль памяти сессий
  (векторное хранилище sqlite/qdrant/pgvector, эмбеддинги, саммаризатор, recall,
  гибридный FTS5-поиск, инструменты `memory_search`/`memory_forget`/
  `memory_export`/`memory_import`/`memory_recall_preview`/`memory_stats_detail`/
  `memory_probe`);
  **branch-aware (v3):** идентичность записи по коммиту (`head`), commit-scoped
  recall (тиры general/experience/не в контексте/unattributed), промоция по
  `is-ancestor(head, mainline)`, mainline авто-детект, ключи
  `branch_context`/`mainline`; **`centralized_confidential` удалён** (решение
  локально/удалённо — только `storage.type`); **v5: жизненный цикл по git-якорю,
  `delete_on_session_delete` (default false), write-gate по head, поле `host`,
  `/maestro-memory-prune`**; не часть стандартной установки,
  включается по запросу (секция `memory` в `maestro.json`; см.
  `manual_docs/reference/memory.md`).
- `skills/` — скилл-спеки и поддерживающие промпты/схемы.
- `agents/` + `commands/` — определения субагентов и точек входа.
- `docs/` — project-context, тестовая документация (testing/), каталоги пайплайна
  (superpowers/).
- `manual_docs/` — пользовательская документация.
- `specs/` — исторические design-доки прошлых работ (legacy, новые не добавляются).

## 6. Ограничения и допущения

- **AGENTS.md** — авторское ограничение «не запускать pipeline в авторском репо»
  **переопределено** пользователем ради dogfooding; разработка идёт по пайплайну.
- Изменения в `skills/maestro/SKILL.md`, `commands/`, `agents/` должны отражаться в
  `manual_docs/` (критерий приёмки).
- `SECURITY.md` — источник истины для security; изменять только через согласованный
  процесс.
- `.opencode/` и `.maestro/` — доставляемое/эфемерное, в git не коммитится.

## 7. Риски

- **Дрейф канона:** `maestro-assistant` канон vs правила парсинга плагина — контроль
  конвенцией (OP-3), без авто-теста.
- **Дрейф документации:** рассинхронизация `manual_docs/` с изменениями скиллов —
  критерий приёмки, ручной контроль.
- **Dogfooding-циклическая зависимость:** правка промптов/скиллов может влиять на сам
  процесс разработки — контроль через ревью и тесты плагина.

## 8. Команда и процессы

- **Git flow:** ветки `feature/<kebab-case>` для фич/багфиксов; master/main — стабильная.
- **Ревью:** code review через `code-reviewer`/opus на ключевых шагах пайплайна.
  С 2026-09-03 (P1.1+P1.2): Minor-находки не обосновывают blocking-вердикт во
  всех трёх контурах; на spec-гейте контрольное ревью с пустыми
  Critical/Important бакетами → fast-path Approve (Minor → follow-up).
- **Доставка:** `agpack`/ручной перенос в целевые приложения.

## 9. Критерии приёмки качества

- **DoD:** реализация по spec/plan, тесты зелёные, документация синхронизирована.
- **Тесты плагина:** `node --test plugins/maestro-bootstrap/index.test.js` — без
  регрессий.
- **Синхронизация `manual_docs/`:** изменения скиллов/команд/агентов отражены в
  документации.
- **Design-доки:** спеки — `docs/superpowers/specs/YYYY-MM-DD-<feature>-design.md`,
  планы — `docs/superpowers/plans/YYYY-MM-DD-<feature>-plan.md` (AGENTS.md);
  `specs/` — только историческая запись.
- **Gate перед merge:** ревью, зелёные тесты, отсутствие незакоммиченных секретов.

## 10. Тестирование

- **Unit (плагин):** встроенный Node test runner — `node --test
  plugins/maestro-bootstrap/index.test.js` (176 тестов).
- **QA-чеклист (e2e-смоук):** `./maestro-sandbox.sh` создаёт `.sandbox/` (фиктивное
  целевое приложение), чеклист `docs/testing/maestro-sandbox-checklist.md`.
- Команды тестирования зафиксированы в §14.

## 11. Развёртывание и окружения

- **Локальная разработка:** авторский репозиторий, plugin подключается локальным путём
  `../plugins/maestro-bootstrap/index.js` (относительный путь резолвится от `.opencode/`)
  в `.opencode/opencode.json`.
- **Доставка в целевые приложения:** через `agpack` из GitHub `wad-jet/maestro` или
  ручным копированием; публикация — push в `main`.

## 12. Безопасность

- **Trust-модель:** `maestro.json → trust` — `custodian`/`sanitizer` trusted по роли;
  остальные субагенты untrusted. Снятие trust делает агентов неработоспособными.
- **Confidential-контур:** `docs/confidential/**` закрыт для primary/untrusted; trusted
  читает, запись/редактирование deny.
- **Секреты:** `.env`, `*.env.*`, `*.{pem,key,cert,secret}` — deny (built-in + config).
- **Санитайзинг:** маскировка чувствительных данных перед untrusted-диспатчем
  (`sanitizer_whitelist`).
- **Память (memory layer):** маскирование `sanitize()` до и после саммаризации —
  жёсткий инвариант: raw-confidential и секреты не уходят на сервер
  (санизированное не блокируется); решение локально/удалённо — только
  `storage.type` (`centralized_confidential` удалён); риск unmasked git-метаданных
  (`branch`/`head`/`merged`) на централизованном бэкенде (правила — `SECURITY.md`
  §5a и `manual_docs/explanation/agents-and-trust.md`).
- Источник истины — `SECURITY.md` (требования P1–P5).

## 13. Мониторинг и observability

- **Логи плагина:** JSONL в `.maestro/logs/maestro-bootstrap-<date>.log` и
  `maestro-audit-<date>.log` (session.error, task, access_policy.blocked,
  confidential.access, sanitizer.redacted).
- **Уровень логов:** env `MAESTRO_BOOTSTRAP_LOG_LEVEL` (default `info`).
- Официальных метрик/алертов нет (авторский репозиторий).

## 14. Commands

### Default (root)
TEST_COMMAND: "node --test plugins/maestro-bootstrap/index.test.js"
BUILD_COMMAND: "auto"
E2E_COMMAND: "./maestro-sandbox.sh"
LINT_COMMAND: "none"
DOCS_COVERAGE_COMMAND: "none"
OBSERVABILITY_COVERAGE_COMMAND: "none"

### Команды памяти (memory layer v2)
- `@maestro-memory` — статус memory layer (бэкенд, модель, записи, кластеры/граф, тюнинг; только агрегаты).
- `@maestro-memory-report` — статический HTML-отчёт в `.maestro/` (только агрегаты, SEC-4b; `report.include_text` — opt-in).
- `@maestro-memory-prune` — HITL-утилизация брошенных/unknown записей (листинг → подтверждение → удаление).
