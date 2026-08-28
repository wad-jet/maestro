# Project Context — maestro

## 1. Название и назначение

`maestro` — система (набор OpenCode-скиллов/команд/агентов + плагин `maestro-bootstrap`)
для оркестрации фич и багфиксов в целевом приложении. Этот репозиторий — **авторский**
(authoring): здесь живут источники скиллов, агентов, команд, плагина, внутреннего
стандарта безопасности (`SECURITY.md`) и пользовательской документации (`manual_docs/`).

Проект self-hosted: он также установлен в сам себя (dogfooding) для разработки по
собственному пайплайну (`@maestro`, `/maestro-init`, `/maestro-design`,
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
  bash (скрипты `maestro-init.sh`, `maestro-sandbox.sh`).
- **Менеджер:** npm (только для плагина, `package.json`).

## 4. Архитектура

- **`skills/`** — источники скиллов maestro (`maestro`, `maestro-init`, `maestro-design`,
  `maestro-assistant`, `maestro-feedback-report`, `manual-docs`).
- **`agents/`** — промпты субагентов (`custodian`, `sanitizer`, `opus`, `sonnet`,
  `haiku`, `fable`, `code-reviewer`).
- **`commands/`** — команды `@maestro`, `/maestro-init`, `/maestro-design`, и др.
- **`plugins/maestro-bootstrap/`** — плагин: санитайзинг промптов, access_policy,
  confidential-контур, observability-логи.
- **`SECURITY.md`** — внутренний стандарт ИБ (источник истины для security-решений).
- **`manual_docs/`** — пользовательская документация (Diátaxis) для разработчиков
  целевых приложений.
- **`specs/`** — авторские design-доки/планы работы над этим репозиторием (AGENTS.md).

**Сосуществование путей spec/plan:** пайплайн maestro пишет spec/plan в
`docs/superpowers/{specs,plans}/` (дефолт, `skills/maestro/SKILL.md`). Авторские
design-доки этого репо лежат в `specs/` (корень, правило AGENTS.md). Оба пути
сосуществуют: пайплайн использует `docs/superpowers/`, ручные авторские доки —
`specs/`. Не путать назначение.

## 5. Домены / модули

- `plugins/maestro-bootstrap/` — логика плагина (core.js, index.js, тесты).
- `skills/` — скилл-спеки и поддерживающие промпты/схемы.
- `agents/` + `commands/` — определения субагентов и точек входа.
- `docs/` — project-context, тестовая документация (testing/), каталоги пайплайна
  (superpowers/).
- `manual_docs/` — пользовательская документация.
- `specs/` — авторские design-доки.

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
- **Доставка:** `agpack`/ручной перенос в целевые приложения.

## 9. Критерии приёмки качества

- **DoD:** реализация по spec/plan, тесты зелёные, документация синхронизирована.
- **Тесты плагина:** `node --test plugins/maestro-bootstrap/index.test.js` — без
  регрессий.
- **Синхронизация `manual_docs/`:** изменения скиллов/команд/агентов отражены в
  документации.
- **Design-доки:** specs и планы создаются в `specs/` (AGENTS.md), планы — в `specs/*-plan.md`.
- **Gate перед merge:** ревью, зелёные тесты, отсутствие незакоммиченных секретов.

## 10. Тестирование

- **Unit (плагин):** встроенный Node test runner — `node --test
  plugins/maestro-bootstrap/index.test.js` (171 тест).
- **QA-чеклист (e2e-смоук):** `./maestro-sandbox.sh` создаёт `.sandbox/` (фиктивное
  целевое приложение), чеклист `docs/testing/maestro-sandbox-checklist.md`.
- Команды тестирования зафиксированы в §14.

## 11. Развёртывание и окружения

- **Локальная разработка:** авторский репозиторий, plugin подключается локальным путём
  (`./plugins/maestro-bootstrap/index.js`) в `.opencode/opencode.json`.
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