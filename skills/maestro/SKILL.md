---
name: maestro
description: Use when implementing a feature end-to-end — orchestrates brainstorm, spec, plan, implementation, review, and docs with HITL gates
---

# Maestro

## Overview

Сквозная реализация фич и багфиксов: от дизайна до мержа. Оркестратор читает
этот скилл и управляет pipeline, диспатча субагентов на каждом этапе.

**Core principle:** Оркестратор координирует — субагенты реализуют. HITL-gates
на ключевых точках. Spec review — только по запросу.

**Два маршрута на шаге 1:**
- **Feature** (шаги 0–18) — полный цикл: project context → pre-flight → brainstorm → spec → plan → SDD → docs → review → finish
- **Bugfix** (шаги 0–6 → D1–D7 → шаги 11–18) — project context → pre-flight + branch → debug sub-pipeline: ресеч → гипотеза → probe → откат → plan → SDD → docs → review → finish

**Mode protocol:** Два уровня режимов:

**1. Permissions mode** (plan / build) — регулирует право на изменение файлов.
Шаги 🟡 Plan — чтение/анализ/опрос. Шаги 🟢 Build — изменение файлов авторизовано
(пермишен-система `edit: ask` уже обеспечивает gate). Диспатч субагентов через
`task: allow` не ограничен режимом — субагенты получают собственные права независимо.

**2. Interaction mode** (efficient / interactive) — выбирается на шаге 1.5.
Efficient — агент работает молча **между gates**, но все структурные gates исполняются обязательно: сложность фичи (шаг 7), предложение Spec Review (шаг 9), spec-gate (10), plan-gate (12), pre-PR (17). Efficient mode сокращает диалог внутри шага, но не убирает сам gate. Если пользователь не ответил на gate — STOP, пауза.
Interactive — агент комментирует находки по ходу работы, задаёт уточняющие вопросы
в неоднозначных ситуациях. Подробнее — шаг 1.5.

**REQUIRED SUB-SKILLS:**
- superpowers:brainstorming — для сложных фич (3+ модуля, новая таблица, public API)
- superpowers:writing-plans — создание implementation plan
- superpowers:subagent-driven-development — исполнение plan (implementer + reviewer per task)
- superpowers:test-driven-development — TDD-дисциплина для шага 13 (SDD)
- superpowers:using-git-worktrees — изоляция workspace
- manual-docs (локальный скил репозитория) — пользовательская документация
- superpowers:requesting-code-review — финальное ревью
- superpowers:finishing-a-development-branch — завершение
- superpowers:systematic-debugging — поиск и анализ багов (debug sub-pipeline)

## When to Use

- Пользователь вызвал `@maestro` для работы над фичей, багфиксом или задачей из спринта.

**Когда НЕ использовать (redirect после вызова):**
- Trivial fix (1-2 строки) — перенаправить на `@haiku` с TDD напрямую
- Рефакторинг без изменения поведения — `subagent-driven-development` напрямую

Классификация сложности и решение о глубине pipeline — ответственность оркестратора (шаг 7), а не пользовательская эвристика.

## Feature Classification

Фичи делятся на четыре категории. Назначение категории влияет на pipeline
(какие шаги выполняются), необходимость Spec Review и tier модели для SDD.

### Категории

| Категория | Примеры | Pipeline | Spec Review | SDD | Модель SDD |
|---|---|---|---|---|---|
| **Trivial fix** (1-2 строки) | Typos, config tweak, rename, single-line bugfix | TDD + commit напрямую; pipeline не запускается | Нет | Нет | — |
| **Простая фича** | Новый simple endpoint, UI-компонент без стейта, добавление поля к existing DTO | Шаги 2-7 → gate: простая → план (шаги 11-12) → SDD (шаг 13) | Нет (пропускается) | 1-2 task-а без review-package | **Haiku** |
| **Сложная фича** | Новая сущность с миграцией, multi-step flow, новый публичный endpoint с auth/rate-limiting | Полный pipeline: шаги 2-7 → spec (8) → опц. Spec Review (9) → gate (10) → план (11-12) → SDD (13) | Рекомендован | Multi-task, review-package per task | **Sonnet** (**Opus** для key task) |
| **Архитектурная фича** | Новая таблица + сервис + контроллер + тесты, новый middleware, breaking change, cross-module refactoring | Полный pipeline + обязательный Spec Review | **Обязателен** | Multi-task, review-package per task, redesign после review если verdict `revise` | **Opus** |

### Критерии — матрица сигналов

Назначение категории происходит на HITL-шаге **braingate: выгрузка контекста**
(после brainstorm). Оркестратор задаёт пользователю эти вопросы и относит
фичу к категории:

| Сигнал || Простая | Сложная | Архитектурная |
|---|---|---|---|---|
| **Сколько файлов?** || 1-2 | 3+ | 5+ |
| **Миграция БД?** || Нет | Опционально | Да (новая таблица / NOT NULL) |
| **Public API?** || Нет | Да | Да (breaking change) |
| **Breaking change?** || Нет | Нет | Да |
| **Новый модуль?** || Нет | Опционально | Да |
| **Cross-layer change?** (endpoint → сервис → репозиторий → тесты) || Нет | Да (≥3 слоя) | Да |
| **Cross-service change?** (изменения в нескольких независимых сервисах/репозиториях) || Нет | Да (при ≥3 файлов суммарно или др. Complex-сигнал) | Да (при cross-layer) |

Если хотя бы один сигнал попадает в колонку «Сложная» или «Архитектурная»,
фича НЕ считается простой, и шаги 8-10 (spec + опциональный Spec Review)
выполняются.

### Почему это важно

**Простая и сложная фича — это не просто объём работы. Это разные уровни
риска для кодовой базы:**

| Аспект | Простая | Сложная |
|---|---|---|
| **Spec** | 3 предложения в user story достаточны | Без формального spec архитектурная ошибка обнаружится только на code-review (шаг 16) — дорогой реверс |
| **Spec Review** | Избыточен — ошибка ограничена 1-2 файлами | Ловит проблемы на spec-уровне, ДО строки кода. Стоимость review << стоимость переписывания |
| **SDD model tier** | **Haiku** хватает — механическая трансляция | **Sonnet+** нужен для multi-file coordination. **Haiku** тут медленнее из-за лишних туров |
| **Откат** | Легко — 1-2 файла, git revert | Тяжело — миграции, breaking changes, каскадные изменения |

## Pipeline

**Режим шагов:** 🟡 Plan mode — чтение/анализ/опрос; 🟢 Build mode — изменение
файлов авторизовано (см. Mode protocol в Overview).

```
🟡  0. [agent] Load Project Context
      — Читает docs/project-context.md (если существует)
      — Если файла нет: HITL-диалог для создания по 14 категориям
        (включая секцию 14 — Commands, см. ниже). Перечень категорий —
        см. `skills/init/init-context.md`; для нового проекта рекомендуется
        команда `/maestro-init` (создаёт context + дизайн + scaffold + roadmap).
      — Если файл есть: HITL-подтверждение актуальности
            — Устанавливает PROJECT_CONTEXT (переменная сессии)
            — Извлекает команды из секции 14 (Commands):
              - `$TEST_COMMAND` — тесты (значение: явная команда / `auto` / `none`)
              - `$BUILD_COMMAND` — сборка
              - `$E2E_COMMAND` — e2e-тесты
              - `$DOCS_COVERAGE_COMMAND` — coverage документации
              - `$OBSERVABILITY_COVERAGE_COMMAND` — observability coverage
              - `$LINT_COMMAND` — линтер
            — Если команда не задана или `auto` — агент определяет
              автоматически по `stack-detection.md` (см. шаг 15a).
              Результат детекта → HITL persist (предложить записать).
            — Если команда = `none` — шаг pipeline пропускается без эскалации.
            — Контекст передаётся всем последующим шагам и субагентам

      **Regression registry:** разрешить `REGISTRY_DIR` один раз на шаге 0
      (как trust-config.json), кэшировать в переменной сессии:
      ```bash
      REGISTRY_DIR="$(git rev-parse --show-toplevel)/regression"
      ```
      - Реестр закоммичен в git (корень репо, `regression/`) — идентичен из
        любого worktree/клона; трюков с git-common-dir не нужно
      - `.maestro/` в `.gitignore` — только эфемерное (sdd/, last-run,
        sanitizer-log); реестр в git
      - Структура (`regression/entries/`, `regression/released/`,
        `regression/cancelled-features.md`) закоммичена через `.gitkeep` —
        каталоги существуют всегда

      **Секция 14 — формат Commands:**
      ```yaml
      ## 14. Commands

      ### Default (root)
      TEST_COMMAND: "npm run test:unit"
      BUILD_COMMAND: "npm run build"
      LINT_COMMAND: "npm run lint"

      ### web/
      TEST_COMMAND: "npm run test:e2e"
      BUILD_COMMAND: "npm run build"
      ```
      Значения: явная строка (команда) | `auto` (авто-детект) | `none` (пропуск).

      ВАРИАНТЫ HITL:
        (a) загрузить и подтвердить актуальность
        (b) создать/обновить контекст
        (c) пропустить
        (d) отмена
🟡  1. [agent] Load `skill maestro`
      -- HITL GATE: "Что делаем? (f) feature — (b) bugfix — (c) отмена" --
      Выбор:
        - (b) → шаги 0–6 (project context + pre-flight + branch) → Debug Sub-pipeline (шаги D1–D7) → шаги 11–18 (plan → SDD → docs → review → finish)
        - (f) → основной pipeline (шаги 0–18)
🟡 1.5. -- HITL GATE: выбрать режим работы --
      "Как будем работать? (a) efficient — (b) interactive — (c) отмена"
      (a) efficient — текущее поведение: агент работает молча, HITL только на gates
      (b) interactive — агент комментирует находки, задаёт уточняющие вопросы по ходу
      (c) отмена → STOP, pipeline завершён
🟡  2. -- HITL GATE: запустить pre-flight диагностику? (a) да — (b) отмена — (c) skip в interactive --
      В efficient mode: (a) да — (b) отмена → STOP
      В interactive mode: (a) да — (b) skip → D1 — (c) отмена
🟡  3. [agent] Pre-flight: диагностика состояния (см. ниже Фазу 1)
🟡  4. [agent] Pre-flight: запрос действия у пользователя (см. ниже Фазу 2)
🟡  5. [agent] Имя ветки (inline-конвенция)
      — Имя зависит от маршрута шага 1:
        - feature → `feature/<kebab-case>`, например `feature/export-csv`
        - bugfix → `fix/<kebab-case>`, например `fix/login-null-pointer`
        - hotfix → `hotfix/<kebab-case>`, например `hotfix/fix-broken-tests`
      — `<kebab-case>` — короткое название на латинице, выводится оркестратором,
        без отдельного скила. При неоднозначности — уточнить у пользователя.
🟢  6. [agent] Изоляция:
      - Если выбран worktree -> using-git-worktrees (git worktree add -b <branch>)
      - Если выбрана просто ветка -> git checkout -b <branch>
🟡  7. -- HITL GATE: категория фичи (см. Feature Classification) --
      ВАРИАНТЫ:
        (a) Сложная / Архитектурная — полный pipeline (шаги 8-10).
            Оркестратор применяет матрицу сигналов, предлагает категорию,
            пользователь подтверждает.
        (b) Простая — шаги 8-10 пропускаются, сразу к плану (шаг 11).
            Требования берутся из user story напрямую, formal spec не создаётся.
            Spec Review по умолчанию пропускается.
        (c) Отмена
      Если (a) → Spec Review РЕКОМЕНДОВАН для сложных, ОБЯЗАТЕЛЕН
      для архитектурных. Оркестратор предложит его на шаге 9.
🟢  8. [agent] Brainstorming -> Spec (обязательно для сложных фич)
🟡  8.5. [agent] Оценка изменений контекста
      — Оркестратор анализирует spec: появились ли новые категории,
        изменения стека, команды или уточнения для проектного контекста.
      — Если да — запоминает как pending context changes.
      — Если нет — ничего не происходит.
      — **HITL не требуется.** Изменения контекста будут зафиксированы
        в плане (шаг 11) и применены автоматически после аппрува плана
        (шаг 12a).
🟢  9. [HITL] Spec Review на spec:
      - **Для сложных фич: оркестратор ОБЯЗАН предложить Spec Review.
        Шаг 10 (spec gate) не наступает, пока пользователь не ответил
        на предложение (да/нет).**
      - Для простых — пропускается.
      - Для архитектурных — **обязателен**, пользователь не может отказаться.
      - Режим: spec (единственный) — ревьюит spec: архитектура, требования,
        риски дизайна
      - Диспатч: OpenCode — `task` tool с `subagent_type=opus`;
        Claude Code — Agent tool с `model=opus` + инструкция ревьюера
      - Промпт ревьюера: `spec-review-prompt.md` из этого скилла
      - Передать: spec + контекст + встроенный чеклист + вопросы
      - Получить: structured review (severity-бакеты + verdict approve/revise/reject)
🟡 10. -- HITL GATE: spec утверждён (с учётом экспертного ревью) --
      Оркестратор ПОКАЗЫВАЕТ diff правок (что изменилось после review).
      ВАРИАНТЫ:
        (a) Approve — spec готов, переходим к плану (шаг 11)
        (b) Revise — вернуться к шагу 8, доработать spec, повторный review
        (c) Reject — фича отменяется, STOP
🟢 11. [agent] writing-plans -> Implementation Plan
      After writing, оркестратор ПРОВЕРЯЕТ plan на качество:
      - Meta-commentary в тексте? ("Let me", "Actually", "I think", "Wait —")
      - Placeholders? ("TODO", "FIXME", "TBD")
      - Блоки кода без указания языка?
      - **Поле `**Service:**`:** если фича затрагивает несколько сервисов
        (полиглот-монорепо), каждая задача должна содержать опциональное
        поле `**Service:**` с путём к директории сервиса
        (например, `**Service:** services/etl-go/`). Если задача относится
        к корню репо или сервис один — поле опускается. Это поле
        используется оркестратором на шаге 13 для резолва команд
        (см. c.1 Pre-dispatch resolution).
      - **Если есть pending context changes (шаг 8.5):** добавить в plan
        секцию `## Project Context Changes` — что изменилось, какие
        категории/команды/стек нужно обновить в `docs/project-context.md`.
        Эта секция ревьюится на gates шага 12 вместе с планом.
      - **Regression risk + scenarios (шаг 11, а не 8.5):** оркестратор
        анализирует plan по сигналам матрицы риска (см. секцию
        «Regression Registry»):
        - Migration / Breaking change → HIGH на affected
        - Cross-layer / Public API → MEDIUM
        - Ни один сигнал → entry не создаётся (без рисков)
        Определяет `risk`-модули и для каждого — `scenarios`:
        `path:line` + `run:` (готовая точечная команда, резолв по
        `**Service:**` + Tier-модели) + `workdir:`. Manual-проверки —
        как `[Manual]`.
      Если есть → исправить до gate (переписать через Write, не Edit)
🟡 12. -- HITL GATE: plan утверждён --
      ВАРИАНТЫ:
        (a) Approve — план готов.
            — Если plan содержит секцию `## Project Context Changes`:
              оркестратор применяет изменения к `docs/project-context.md`
              (автономно, без дополнительного HITL).
            — **Regression entry (шаг 12a):** если на шаге 11 определены
              risk-сценарии → создать
              `$REGISTRY_DIR/entries/YYYY-MM-DD-<feature-name>.md`
              (без HITL): `version: 1`, `feature:`, `added:`, `status: active`,
              `risk:`, `scenarios:` (с `run:`/`workdir:`). При повторном
              Approve после Revise (12b) — entry перегенерируется
              (перезапись с актуальными `run:`/`workdir:`)
            — Оркестратор коммитит spec, plan, изменения контекста **и entry**
              одним коммитом (см. "Git: design-документы" в File Path
              Conventions), затем переходит к SDD (шаг 13)
        (b) Revise — вернуться к шагу 11, доработать план
        (c) Отмена
🟢 13. [agent] subagent-driven-development:
      a. **Pre-clean:** удалить `.maestro/sdd/*.md` (кроме `.gitkeep`).
         Предотвращает смешивание контекста между фичами — stale файлы
         прошлых фич сбивают субагентов.
      b. Читает plan, создаёт todos для всех tasks
      c. **Pre-dispatch resolution** (если plan содержит поле `**Service:**`):
         - Прочитать `**Service:**` из task brief (извлекается task-brief скриптом)
         - Если Service задан:
           * Найти в секции 14 Commands подсекцию `### <service-path>/`
           * Если найдена → взять TEST, BUILD, LINT из неё
           * Если не найдена → Tier 2 авто-детект по `stack-detection.md`
             в директории service (HITL persist при успехе, Tier 3 при неудаче)
           * `workdir` = service-path (относительно корня репо)
           * Передать в dispatch context: workdir + resolved commands
         - Если Service не задан → root поведение:
           * `workdir` = repo root
           * Commands из `### Default (root)` в секции 14 Commands
           * (текущее поведение — backward compat)
      d. Per task: dispatch implementer-субагента (implementer-prompt.md) -> **обязательный** task review
         — implementer-prompt.md находится в `skills/maestro/implementer-prompt.md`
          — Диспатч по tier (см. секцию "Шаг → Tier" в Model Selection):
           - OpenCode: `task` tool с `subagent_type=haiku` (механический) или
             `subagent_type=sonnet` (интеграционный)
           - Claude Code: Agent tool с `model=haiku` или `model=sonnet`
         — Task review: `subagent_type=sonnet` (OpenCode) / `model=sonnet` (Claude Code)
         — Если task зависит от другого (например, endpoint без тестов), указать:
           "Note: tests for this code may fail until Task N is completed — это ожидаемо"
         — Добавить codebase-pattern чеклист из implementer-prompt.md в контекст
         — **Каждый task после DONE проходит task-reviewer (spec compliance + code quality).
           Пропуск task review — anti-pattern.**
      e. Progress-лог в .maestro/sdd/progress.md (через SDD Durable Progress)
      f. **Regression reconciliation (P1):** после реализации, до выхода из
         шага 13, оркестратор сверяет entry с кодом (без HITL для факта —
         HITL только для решений):
         1. Проверить существование каждого `path`-файла сценария (`test -f`)
         2. Для существующих — проверить, что `run:` исполняется (`exit 0`)
         3. Расхождения → HITL:
            - (a) обновить entry: перегенерировать `run:`/`path:line` по факту
            - (b) пометить сценарий `[Manual]` (тест не автоматизирован)
            - (c) удалить сценарий из entry
         4. Reconciliation — отдельный хук, не перегенерация всей entry
            (статус и `last_full_pass` сохраняются). Если entry не создана
            (не было risk-сценариев на шаге 11) — шаг пропускается
🟢 14. [agent] manual-docs -> обновление пользовательской документации
🟡 15. [agent] Финальные проверки:
          **Регрессия здесь НЕ запускается** — `@regression` только standalone,
          по явному запросу пользователя (см. секцию «Regression Registry»).
          Для каждой подсекции в секции 14 Commands (`### Default (root)`,
          `### services/etl-go/`, etc.):
          - TEST_COMMAND — если не `none` → выполнить (см. условия пропуска)
          - E2E_COMMAND — если не `none` → выполнить
          - DOCS_COVERAGE_COMMAND — если не `none` → выполнить
          - OBSERVABILITY_COVERAGE_COMMAND — если не `none` → выполнить
          - LINT_COMMAND — если не `none` → выполнить
          - BUILD_COMMAND → выполнить на шаге 15a

          Если команда упала с "command not found" → HITL:
          (a) ожидаемо (сервис не затронут) — пропустить подсекцию
          (b) установить toolchain и повторить
          (c) реальная ошибка — fix-loop к шагу 13

          **Разрешение команды (3 Tier):**
          Tier 1: явно в project-context.md → выполнить как есть
          Tier 2: `auto` или не задана → авто-детект по `stack-detection.md`:
            ├─ один кандидат → выполнить + HITL persist (предложить записать)
            ├─ несколько кандидатов → HITL выбор + silent persist
            └─ ни одного → Tier 3
          Tier 3: HITL-эскалация:
            "Не удалось определить X.
            (a) указать команду вручную
            (b) пропустить с подтверждением
            (c) отмена pipeline"
            **Молчаливый skip недопустим** — требуется явное подтверждение.

          **Условный пропуск `$TEST_COMMAND`:**
          - **Багфикс (probe == fix):** если git diff фикса совпадает с git diff
            probe (D3), то `$TEST_COMMAND` уже выполнен на шаге D4 — не повторять.
            Проверка: `git diff <base-commit>..HEAD | sha256sum` vs probe-diff hash.
          - **Feature (≤2 файла, clean review):** если шаг 16 (requesting-code-review)
            не выявил critical issues — `$TEST_COMMAND` опционален, достаточно coverage.
          - **Coverage-тесты** выполняются всегда независимо от прочего.

          **Если команда = `none`** → шаг пропускается без эскалации
          (осознанное решение пользователя).

          **Если команда упала при выполнении** → HITL:
            (a) fix context — обновить запись в project-context.md
            (b) real fail — исправлять код (fix-loop к шагу 13)
            (c) skip с подтверждением — продолжить без проверки
🟢 15a. [agent] Build check (до code review):
          Для каждой подсекции в секции 14 Commands:
          - BUILD_COMMAND → развернуть по Tier-модели
            (явная / авто-детект из `stack-detection.md` / HITL / `none`)
          - При успешном детекте команды, отсутствующей в контексте →
            HITL persist (предложить записать в секцию 14 Commands)
          - Если build fail ("command not found") → HITL:
            (a) ожидаемо — пропустить подсекцию
            (b) real fail — fix-loop к шагу 13
            (c) skip с подтверждением
🟡 16. [agent] requesting-code-review -> финальное ревью
🟡 17. -- HITL GATE: pre-PR --
      Оркестратор ПОКАЗЫВАЕТ: git log, test results, coverage status.
      ВАРИАНТЫ:
        (a) Approve merge — переходим к шагу 18 (finishing-a-development-branch)
        (b) Fix — вернуться к шагу 13, исправить issues
        (c) Отмена
🟢 18. [agent] finishing-a-development-branch
      — При fast-forward merge: `$TEST_COMMAND` на merged результате
        не выполняется. Fast-forward = HEAD feature-ветки становится
        HEAD base-ветки — diff идентичен, тесты уже пройдены на шаге 15.
        Проверка: `git merge-base --is-ancestor HEAD <base-branch>`.
```

## HITL Gate Protocol

Decision gates (шаги 10, 12, 17) — явный вопрос с вариантами (a)/(b)/(c).
Остальные gates в pipeline (шаги 1, 2, 7, D2, D6, D7) следуют тому же
протоколу, но с вариантами, специфичными для каждого gate (см. inline-описание
в pipeline). Оркестратор ОБЯЗАН следовать этому протоколу для всех gates:

**Полный перечень gates в pipeline:**

Feature:
- Шаг 0 — загрузка Project Context (загрузить/создать/пропустить/отмена)
- Шаг 1 — выбор маршрута (feature/bugfix/cancel)
- Шаг 1.5 — выбор режима (efficient/interactive/cancel)
- Шаг 2 — запуск pre-flight (да/отмена/skip в interactive)
- Шаг 7 — сложность фичи (сложная/простая/отмена)
- Шаг 10 — spec утверждён (approve/revise/reject)
- Шаг 12 — plan утверждён (approve/revise/cancel)
- Шаг 17 — pre-PR (approve merge/fix/cancel)

Bugfix:
- Шаг D2 — утвердить гипотезу (да/новая гипотеза)
- Шаг D6 — гипотеза подтверждена (да/нет)
- Шаг D7 — переход к фиксу (да/отмена)

0. **Язык HITL:** все вопросы, варианты и сообщения пользователю на HITL gates — ТОЛЬКО на русском языке

1. **Показать контекст:**
   - Шаг 10 (spec gate) — diff правок spec после review
   - Шаг 12 (plan gate) — список task-ов с краткими описаниями
   - Шаг 17 (pre-PR) — `git log --oneline`, test results, coverage status

2. **Задать вопрос с вариантами (a)/(b)/(c):**
   - Никогда не спрашивать "Continue?" или "Утверждаешь?" — только structured options
   - Варианты: Approve / Revise (с указанием куда вернуться) / Reject (отмена фичи)

3. **Дождаться ответа:**
   - Не принимать молчание за approval
   - **«Continue» / «Proceed» / «Давай» не являются approval для последующих gates.**
     Ответ «continue» переводит pipeline ровно на один следующий шаг.
     Gate X+1 требует отдельного явного ответа.
     Оркестратор НЕ имеет права экстраполировать «continue» на всю цепочку gates.
   - Если ответа нет → STOP, pipeline на паузе

4. **После ответа:**
   - (a) Approve → следующий шаг pipeline
   - (b) Revise → вернуться к указанному шагу, исправить, повторный gate
   - (c) Reject → STOP, pipeline завершён

## Debug Sub-pipeline (багфикс)

Запускается при выборе `(b) bugfix` на шаге 1. Заменяет шаги 7–10 основного
pipeline; после завершения переход на шаг 11 (writing-plans).

```
🟡 D1. [agent] systematic-debugging + ресеч кода
      — читает логи, воспроизводит проблему, формирует гипотезы
🟡 D2. -- HITL GATE: утвердить гипотезу --
      "Гипотеза: <описание>. Начинаем probe? (a) да — (b) новая гипотеза"
      (b) → вернуться к D1
🟢 D3. [agent] Probe-фаза: внести временные изменения
      — изменяет файлы для проверки гипотезы
      — каждую правку записывает в .probe-changes.md:
        ```md
        ## Probe N: <гипотеза>
        - Файл: path/to/file.ts:42
        - Original: `<original snippet>`
        - Change: `<probe snippet>`
        - Status: active
        ```
🟡 D4. [agent] Проверка гипотезы
      — запуск, тесты, логи — гипотеза подтвердилась?
🟢 D5. [agent] Откат probe-кода (всегда, независимо от результата)
      — читает .probe-changes.md, для каждого status=active:
        1. Открывает файл
        2. Находит original по контексту
        3. Выполняет edit reverse
        4. Меняет status → reverted
      — Если .probe-changes.md не найден → использовать git diff для поиска
      — После отката: git status показывает diff фикса, не probe
🟡 D6. -- HITL GATE: гипотеза подтверждена? (a) да — (b) нет --
      — (b) → вернуться к D1 (новая гипотеза)
      — (a) → переход к D7
🟡 D7. -- HITL GATE: гипотеза подтверждена, переходим к фиксу --
      "Probe-изменения откачены. Планируем фикс? (a) да — (b) отмена"
      — (a) → переход к шагу 11 (writing-plans) основного pipeline (шаги 8–10 пропускаются)
```

**Важно:**
- `systematic-debugging` — обязательный sub-skill для багфиксов
- `.probe-changes.md` — под gitignore (не коммитится)
- После D7 план фикса пишется на шаге 11; spec (шаги 8–10) пропускается
- Для тривиальных багфиксов (1–2 строки) maestro не используется —
  см. раздел "Когда НЕ использовать": redirect на @haiku с TDD напрямую

## Pre-flight: диагностика и запрос действия

Двухфазная проверка перед созданием ветки.

> Модель НЕ запускает pre-flight автоматически. Перед диагностикой (шаг 2
> pipeline) модель запрашивает подтверждение у пользователя через HITL gate.
>
> **Interactive mode:** pre-flight — опциональная диагностика, не gate.
> При выборе (b) "skip → D1" pre-flight пропускается, pipeline переходит
> к D1. В лог записывается: `pre-flight: skipped (interactive mode)`.
> В efficient mode (b) — отмена → STOP (как сейчас).

### Фаза 1: Диагностика

Оркестратор собирает три факта:

1. **Состояние working tree** — `git status --porcelain`
   - `clean` — нет незакоммиченных изменений
   - `dirty` — есть незакоммиченные изменения

2. **Текущая ветка** — `git branch --show-current`
   - `develop` / `main` — на base-ветке
   - `feature/xxx` — на feature-ветке

3. **Связанный worktree** — `test "$GIT_DIR" != "$GIT_COMMON"`
   - `true` — уже в linked worktree
   - `false` — в основном репо

4. **Baseline тесты** — для каждой подсекции в секции 14 Commands:
     - Выполнить TEST_COMMAND из этой подсекции
     - Если команда не найдена → пропустить подсекцию (нет тестов)
     - Если команда упала с "command not found" → HITL:
       (a) ожидаемо (toolchain не установлен) — пропустить
       (b) установить toolchain и повторить
       (c) real fail — исправить
     - Все зелёные → продолжать pipeline
     - Есть failures → см. Escalation таблицу ("Baseline tests fail")

5. **Baseline cache** — переменная сессии `BASELINE_VERIFIED`
     - Если `BASELINE_VERIFIED=true` → baseline не выполняется
       (уже пройден для всех сервисов в этой сессии)
     - Если `unset` → выполнить baseline для всех подсекций,
       установить `BASELINE_VERIFIED=true`

### Фаза 2: Запрос действия

Оркестратор выбирает сценарий по состоянию и задаёт вопрос пользователю.

**Сценарий A: base + clean + не worktree**
> "Изолировать в worktree? **(a)** worktree — **(b)** git checkout -b — **(c)** отмена"

**Сценарий B: base + dirty + не worktree**
> "Tree нечистый. Как поступим? **(a)** worktree (не трогаем dirty) — **(b)** commit → git checkout -b — **(c)** stash → git checkout -b — **(d)** отмена"

**Сценарий C: на feature-ветке**
> "Текущая ветка feature/old-xxx, не base. **(a)** переключиться на develop → worktree — **(b)** переключиться → git checkout -b — **(c)** ветвиться отсюда — **(d)** отмена"

**Сценарий D: в worktree от прошлой фичи**
> "Уже в worktree на feature/old-xxx. **(a)** выйти в основной репо → создать новый worktree — **(b)** ветвиться отсюда ($GIT_DIR уже есть) — **(c)** отмена"

После выбора пользователя оркестратор:
- Создаёт ветку (`feature/<kebab-case>` / `fix/<kebab-case>` / `hotfix/<kebab-case>` по inline-конвенции + `git checkout -b`)
- Опционально — worktree (`using-git-worktrees`)

## Интеграция с существующими скиллами

| Фаза | Скилл/Инструмент |
|---|---|
| Дизайн | `brainstorming` |
| План | `writing-plans` |
| Ветка | inline-конвенция `feature/<kebab-case>` / `fix/<kebab-case>` / `hotfix/<kebab-case>` (определяет имя ветки) |
| Изоляция | `using-git-worktrees` (worktree) / `git checkout -b` (простая ветка) |
| Имплементация | `subagent-driven-development` + `test-driven-development` |
| Документация | `manual-docs` (локальный скил репозитория) |
| Ревью | `requesting-code-review` |
| Завершение | `finishing-a-development-branch`, `git-commit` |
| Регрессия | `@regression` (standalone, по запросу) — реестр рисков `regression/` (в git) |

## Model Selection

Модели настраиваются пользователем. Выбор делает оркестратор по tier-правилам
ниже. Способ диспатча зависит от харнеса:

- **Claude Code:** параметр `model` у Agent tool (алиасы `haiku`/`sonnet`/`opus`/`fable`)
- **OpenCode:** диспатч **именованного сабагента** через `task` tool с
  `subagent_type` = `haiku` | `sonnet` | `opus`. Модель жёстко привязана к
  сабагенту в `opencode.json` → `agent.{haiku,sonnet,opus}.model`. Task tool
  не поддерживает per-dispatch выбор модели — поэтому для OpenCode оркестратор
  выбирает **сабагента**, а не модель.

### Tier → тип задачи

| Tier | Когда использовать | OpenCode сабагент |
|---|---|---|
| **Haiku** (Быстрая/дешёвая) | Механические task-и: 1-2 файла, полный spec, трансляция+тесты | `haiku` |
| **Sonnet** (средняя/сбалансированная) | Интеграционные task-и: multi-file, pattern matching, debugging | `sonnet` |
| **Opus** (наиболее мощная) | Архитектура, design judgment, final whole-branch review | `opus` |
| **Fable** (креативная) | Примеры, метафоры, аналогии, пояснения в стиле историй | `fable` |

### Шаг → Tier (встроенный `step_to_tier`)

| Шаг | Tier | OpenCode сабагент |
|---|---|---|
| `spec_review` (шаг 9) | opus | `opus` |
| `task_reviewer` (шаг 13, per-task) | sonnet | `sonnet` |
| `code_review` (шаг 16) | opus | `code-reviewer` |
| `implementer_mechanical` (шаг 13, 1-2 файла) | haiku | `haiku` |
| `implementer_integration` (шаг 13, multi-file) | sonnet | `sonnet` |
| `explain` (по запросу, примеры/метафоры) | fable | `fable` |

**Fix-loop эскалация (rounds 4-5):** минимум на tier выше предыдущей попытки.

> Без явного выбора tier сабагент наследует модель сессии (часто самую дорогую)
> — это молча разрушает экономику tier-выбора. Всегда диспатчить сабагента
> нужного tier'а.

### OpenCode: именованные сабагенты

Сабагенты объявлены в `.opencode/agents/` как markdown-файлы. Модели
настраиваются в `opencode.json`, пермишены — в `.opencode/agents/*.md`:

| Сабагент | Файл конфигурации |
|---|---|
| `haiku` | `.opencode/agents/haiku.md` + `opencode.json → agent.haiku.model` |
| `sonnet` | `.opencode/agents/sonnet.md` + `opencode.json → agent.sonnet.model` |
| `opus` | `.opencode/agents/opus.md` + `opencode.json → agent.opus.model` |
| `code-reviewer` | `.opencode/agents/code-reviewer.md` + `opencode.json → agent.code-reviewer.model` |
| `fable` | `.opencode/agents/fable.md` + `opencode.json → agent.fable.model` |

Все под-агенты `hidden: true` — не показываются в `@`-меню, вызываются только
программно через `task` tool.

- `permission` — `haiku`/`sonnet` могут редактировать файлы и запускать bash
  (имплементация), `opus`/`fable` — read-only без bash (ревью, объяснения),
  `code-reviewer` — `bash: allow` (git diff/log/show), `edit: deny` (без мутаций).
- `task: deny` — агенты не диспатчат вложенные под-агенты
  (один уровень вложенности).

**При диспатче:** оркестратор по таблице «Шаг → Tier» определяет нужный tier,
маппит tier → имя агента (`haiku`/`sonnet`/`opus`/`code-reviewer`/`fable`), диспатчит через `task`
tool с `subagent_type` = имени агента. Доступность модели обеспечивает
провайдер OpenCode — отдельная проверка не требуется.

**Trust check перед диспатчем:** оркестратор проверяет `trust-config.json`
(загружен на шаге 0). Если сабагента нет в файле или значение ≠ `true` —
untrusted: применяет Context Sanitizer к промпту. Санитайзер работает
автоматически, без HITL.

### OpenCode Dispatch Override

SDD-шаблоны из superpowers (`implementer-prompt.md`, `task-reviewer-prompt.md`,
`code-reviewer.md`) используют Claude Code-конвенцию:
```
Subagent (general-purpose):
  model: haiku
  prompt: |
    ...
```

OpenCode `task` tool **не принимает** параметр `model` — модель жёстко
привязана к именованному сабагенту в `opencode.json`. Поэтому оркестратор
транслирует вызов по таблице «Шаг → Tier»:

| SDD-шаблон пишет | Шаг → Tier | OpenCode subagent_type |
|---|---|---|
| `Subagent (general-purpose): model: haiku` | `implementer_mechanical` | `haiku` |
| `Subagent (general-purpose): model: sonnet` | `implementer_integration` | `sonnet` |
| `Subagent (general-purpose): model: sonnet` | `task_reviewer` | `sonnet` |
| `Subagent (general-purpose): model: opus` (или без model) | `spec_review` | `opus` |
| `Subagent (general-purpose): model: opus` (или без model) | `code_review` | `code-reviewer` |

**Правила трансляции:**
1. Поле `model:` в SDD-шаблонах **игнорируется** — агент определяется по `step_to_tier`.
2. Имя `general-purpose` не регистрируется как сабагент — это артефакт
   Claude Code-конвенции. В OpenCode он транслируется в named-агента.
3. Prompt из шаблона передаётся как `prompt` в `task` tool без изменений.

Пример:
```
# Вместо SDD-нотации:
Subagent (general-purpose):
  model: haiku
  prompt: |  # implementer-prompt.md
    ...

# OpenCode-диспатч:
task(
  subagent_type="haiku",
  prompt="..."  # implementer-prompt.md
)
```

## Trust Model

Оркестратор работает в сессии дефолтной модели — считается **доверенной**.
Любой сабагент — отдельный инференс/сессия; данные покидают контекст
оркестратора. Поэтому **по умолчанию все сабагенты untrusted**.

### Trust levels

| Уровень | Описание | Контроль |
|---|---|---|
| **trusted** | Указан в `trust-config.json` со значением `true` | Без ограничений — данные передаются как есть |
| **untrusted** | Не указан в `trust-config.json` или значение ≠ `true` | Перед диспатчем применяется Context Sanitizer |

### Subagent Trust Matrix

| Сабагент | Trust по умолчанию |
|---|---|
| `haiku` | untrusted |
| `sonnet` | untrusted |
| `opus` | untrusted |
| `code-reviewer` | untrusted |
| `fable` | untrusted |

Значение по умолчанию для любого сабагента — **untrusted**.
Меняется только через `trust-config.json` (см. ниже).
От модели в `opencode.json` trust не зависит.

### Управление: trust-config.json

Файл `trust-config.json` в корне проекта (рядом с `opencode.json`).
Перечисляет **только trusted** сабагентов. Всё, чего нет в файле — untrusted.

```json
{
  "haiku": true
}
```

- **Ключ:** имя сабагента (`haiku`, `sonnet`, `opus` и т.д.)
- **Значение:** только `true` = trusted. Любое другое значение → untrusted
- Если файла нет → **все сабагенты untrusted** (безопасное значение по умолчанию)
- Файл коммитится в git — trust-level policy проекта

**Как применять:**

1. Оркестратор читает `trust-config.json` **один раз за сессию** — на шаге 0
   (Load Project Context), кэширует для всех последующих диспатчей
2. При каждом диспатче сабагента (шаги 9, 13, 16): проверить кэш. Если
   сабагент есть в файле с `true` → trusted, иначе → untrusted
3. Изменения в `trust-config.json` вступают в силу со следующей сессии
4. Файл обязателен к проверке — игнорировать его нельзя

## Context Sanitizer

Лёгковесный автоматический фильтр, применяемый к промпту **перед диспатчем**
в untrusted сабагента. Не создаёт HITL-диалогов, не дублирует операции.

### Что фильтруется

1. **Secrets из окружения:** переменные с именами, содержащими
   `SECRET`, `KEY`, `TOKEN`, `PASSWORD`, `CREDENTIAL`, `PASS`, `AUTH`
   — заменяются на `<redacted:env.NAME>`.
2. **Чувствительные поля данных:** в примерах данных, JSON-samples,
   test fixtures — поля `amount`, `currency`, `article_code`,
   `counterparty_id` заменяются на `<redacted>`.
3. **Файлы .env / .env.\*:** если упоминаются в контексте — заменяются
   на `<redacted:.env file>`.
4. **SFTP/DB credentials:** строки вида `sftp://...`, `postgresql://...`,
   `mongodb://...` с credentials — заменяются на `<redacted:connection>`.
5. **Raw ledger entries:** если контекст содержит неанонимизированные
   проводки — применяется маскинг полей из п.2.

### Что НЕ фильтруется

- Агрегированные данные (итоги, суммы отчётов) — не содержат деталей проводок
- Схемы БД без данных (Prisma schema, DTO без инстансов)
- Код и конфиги (кроме `.env`)
- Имена таблиц/колонок (метаданные, не данные)

### Когда применяется

На всех шагах, где происходит диспатч untrusted сабагента.
Trust-уровень определяется по `trust-config.json` (см. Trust Model):

| Шаг | Сабагент | Санитайзер |
|---|---|---|
| Шаг 9 — Spec Review | `opus` | Применяется (untrusted) |
| Шаг 13 — SDD implementer | `haiku` / `sonnet` | Применяется (untrusted) |
| Шаг 13 — SDD task-reviewer | `sonnet` | Применяется (untrusted) |
| Шаг 16 — Code Review | `code-reviewer` | Применяется (untrusted) |

Если сабагент отмечен как trusted в `trust-config.json` — санитайзер
**не применяется** (риск принят пользователем).

### Правила применения

1. Санитайзер запускается **автоматически** при диспатче untrusted сабагента
2. **Без HITL** — пользователь не уведомляется о санитайзинге
3. Оригинальный контекст оркестратора **не изменяется** — санитайзер
   создаёт копию промпта для untrusted сабагента
4. Аудит-лог: в `.maestro/sanitizer-log.md` записывается:
   - timestamp
   - сабагент
   - что отфильтровано (без содержимого)
   - размер промпта до/после

## Spec Review (опционально)

Диспатчится по HITL **на spec** (шаг 9), до её утверждения. Для сложных фич
(3+ модуля / новая таблица / public API) оркестратор **предлагает** Spec Review
на spec-gate; для простых — пропускает. Окончательное решение — за пользователем.

**Режим:** `spec` (единственный) — ревьюит spec: архитектуру, требования, риски
дизайна. План ещё не существует — ревью предотвращает архитектурные ошибки до
планирования.

**Формат:** severity-бакеты (Critical / Important / Minor) + verdict
(approve / revise / reject). Без числового scoring — единый формат с task-reviewer
и final code review.

**Модель:** **opus** (см. секцию "Шаг → Tier" в Model Selection).

Используйте промпт: `spec-review-prompt.md` из этого скилла.

## Границы ревью

В pipeline три ревью — они **не дублируются**: разные артефакты, разное время,
разные промпт-файлы. Не пытаться их сливать.

| Ревью | Артефакт | Стадия | Триггер | Tier / Сабагент | Формат |
|---|---|---|---|---|---|---|
| **(a) Spec Review** | spec | шаг 9, pre-spec-gate | HITL (автопредложение на сложных) | **opus** | бакеты + approve/revise/reject |
| **(b) SDD task-reviewer** | diff одной задачи | шаг 13, per-task | авто после DONE | **sonnet**, по риску diff'а | ✅/❌/⚠️ + Approved/Needs fixes |
| **(c) requesting-code-review** | diff всей ветки | шаг 16, post-impl | авто | **opus** | бакеты + Yes/No/With fixes |

- (a) — единственный gate **до кодирования**; оценивает spec (архитектура/риски), не код.
- (b) — per-task код-гейт **во время** реализации; узкий scope.
- (c) — финальный код-гейт **после** реализации; широкий scope (вся ветка),
  ловит cross-task проблемы, которые (b) не видит.
- Концептуально пересекается только «correctness + test strategy», но на разных
  объектах (spec vs код). Реальное code-review-пересечение (b)+(c) — намеренное.

## Обработка сбоев

| Ситуация | Действие |
|---|---|
| **HITL pre-flight: отмена (шаг 2b)** | В efficient: STOP — pipeline завершён. В interactive: skip → D1. Никаких cleanup не требуется (ветка ещё не создана). |
| **HITL шаг 1.5: отмена (1.5c)** | STOP — pipeline завершён. Пользователь отказался от запуска. |
| **Spec gate: revise (10b)** | Вернуться к шагу 8 (brainstorm), доработать spec, повторный review |
| **Plan gate: revise (12b)** | Вернуться к шагу 11 (writing-plans), доработать план |
| **Spec review: revise** | Вернуться к шагу 8, доработать spec, повторить review (шаг 9) |
| **Spec review: reject** | Эскалация к пользователю: пересмотр требований или отмена фичи |
| **Gate: отмена (шаги 7c, 10c, 12c, 17c, D7b)** | STOP + cleanup: удалить feature-ветку (`git branch -D <branch>`) и worktree (`git worktree remove <path>`), если создан. Решение оставить в `regression/cancelled-features.md` (в git) для последующей архивации. **Regression cleanup:** если `entries/<YYYY-MM-DD-<feature>>.md` существует → `git mv entries/X.md released/X.md`, `status: cancelled`, `released: <дата>`, дописать решение в `regression/cancelled-features.md` и закоммитить оба файла (`chore(regression): <feature> cancelled`) (только после шага 12a; до 12a entry ещё не создан — no-op). |
| **Implementer: BLOCKED** | Оркестратор: (1) дать контекст, (2) мощнее модель, (3) разбить задачу, (4) эскалация |
| **Implementer: NEEDS_CONTEXT** | Оркестратор предоставляет недостающий контекст, re-dispatch |
| **Implementer: DONE_WITH_CONCERNS** | Оркестратор читает concerns; если correctness/scope — адресовать до review |
| **Plan quality check fail** | Исправить plan (переписать через Write), повторно проверить |
| **Coverage-тесты fail** | Implementer фиксит -> re-run -> если 2 раза fail, эскалация к пользователю |
| **Build check fail** | **Fix-loop:** (1) диагностировать ошибку сборки, (2) исправить, (3) перезапустить build, (4) перейти к code review. Если fix-loop не помогает — эскалация к пользователю |
| **Pre-flight: dirty tree (сценарий B)** | Спросить: worktree / commit+checkout / stash+checkout / отмена |
| **Pre-flight: на feature-ветке (сценарий C)** | Спросить: switch+worktree / switch+checkout / ветвиться отсюда / отмена |
| **Pre-flight: в worktree (сценарий D)** | Спросить: выйти+новый worktree / ветвиться отсюда / отмена |
| **Изоляция: worktree creation fail** | Эскалация к пользователю (проблема с git/окружением) |
| **Изоляция: git checkout -b fail** | Эскалация к пользователю (проблема с git/окружением) |
| **Code review: issues** | Dispatch fix-субагента -> re-review (по SDD-циклу) |
| **Pre-PR gate: reject (17b)** | Вернуться к шагу 13 (реализация), исправить issues |
| **Baseline tests fail** | **Вариант A (hotfix):** (1) stash текущих изменений, если есть (`git stash -u`), (2) создать `hotfix/fix-broken-tests` от base-ветки, (3) зафиксить тесты, (4) PR → merge в base, (5) rebase feature-ветки на base, (6) stash pop.<br>**Вариант B (proceed):** Продолжить pipeline — baseline failure зафиксирован как known issue. Записать в commit сообщение фичи: `baseline: tests fail — see <issue/pr>`.<br>**Вариант C (skip):** Пропустить фичу — вернуться к base, завести отдельную задачу на фикс тестов. |
| **Command not detected (Tier 3)** | HITL: (a) указать вручную — (b) пропустить с подтверждением — (c) отмена pipeline. **Молчаливый skip недопустим.** |
| **Command ambiguous (несколько кандидатов детекта)** | HITL: выбор из списка → silent persist в project-context.md (секция 14) |
| **Command failed at runtime (не сборка)** | HITL: (a) fix context — обновить запись в project-context.md — (b) real fail — fix-loop к шагу 13 — (c) skip с подтверждением |
| **Build check fail** | HITL: (a) fix context — обновить команду сборки — (b) real fail — диагностика + fix-loop — (c) skip с подтверждением |
| **Baseline tests: flaky/deterministic fail** | Повторить 2 раза — если повторяется → Вариант A |
| **Probe: гипотеза не подтвердилась (шаг D6)** | Вернуться к D1, новая гипотеза |
| **Probe: откат probe не удался (шаг D5)** | Ручной revert: `git checkout <файл>` или эскалация к пользователю |
| **Probe: .probe-changes.md не найден (шаг D5)** | Использовать `git diff` для идентификации probe-изменений; восстановить список вручную |
| **Project Context file not found (шаг 0)** | Создать через HITL-диалог по 14 категориям (включая секцию 14 — Commands) |
| **Project Context outdated (шаг 0)** | Показать diff изменений, запросить обновление |
| **Project Context skipped (шаг 0c)** | Все последующие шаги работают без контекста. Запись в лог: `project-context: skipped` |
| **Context gap found during spec/plan/SDD** | Включить в plan как `## Project Context Changes` (шаг 11); после аппрува плана (шаг 12a) применяется автономно |
| **Regression: entry reconciliation fail (шаг 13f)** | Расхождения `path`/`run:` с кодом → HITL: (a) обновить entry — (b) пометить `[Manual]` — (c) удалить сценарий. НЕ перегенерация всей entry |

## Regression Registry

Реестр рисков регрессии: что под риском при изменении кодовой базы, в каких
модулях, какими сценариями это проверяется. Cross-feature агрегация —
через команду `@regression` (см. `commands/regression.md`).

**Дизайн:** `docs/regression-flow.md` (источник истины). Pipeline встраивает
3 хука: анализ (шаг 11), запись (шаг 12a), reconciliation (шаг 13f).

### Структура (реестр в git)

```
$REGISTRY_DIR = $(git rev-parse --show-toplevel)/regression
├── cancelled-features.md            ← решения об отменах (в git)
├── entries/YYYY-MM-DD-<feature>.md     ← active/verified (1 файл = 1 фича)
└── released/YYYY-MM-DD-<feature>.md    ← released/cancelled (архив)
```

- Реестр закоммичен в git (корень репо). Per-worktree остаются `.maestro/sdd/`,
  `.maestro/sanitizer-log.md`, `.maestro/last-run.md` (в `.gitignore`)
- `1 файл = 1 фича` — sharded append-only: конфликт параллельных pipeline
  невозможен по построению, flock не нужен
- Параллельные worktree: каждая фича коммитит свой entry в свою ветку;
  `@regression full/release` корректен на main после мержа веток
- Статус-мутации (`verified`/демоция/release/purge/cancel) → авто-коммит
  из `@regression`: `git add <entry> && git commit -m "chore(regression): ..."`
  (только конкретный путь, не `git add -A`); при неудаче — dirty + warning

### Формат entry

```md
# version: 1
- feature: etl-retry
- added: 2026-07-31
- status: active            # active / verified / released / cancelled
- last_full_pass:           # дата последнего зелёного full (пусто = не был)
- released:                 # дата перехода в released/cancelled (для purge)
- risk:
  - ETL Engine: HIGH
  - Webhook dispatcher: MEDIUM
- scenarios:
  - `src/ai-worker/processors/etl.processor.spec.ts:95` — retry при таймауте
    run: npm run test:unit -- --testPathPattern=etl.processor.spec.ts
    workdir: .
  - [Manual] Экспорт CSV 50k строк
```

- `path:line` — локатор для человека/отчёта; `run:` — что исполняется;
  `workdir:` — из какого каталога (резолв при записи, шаг 11). Опционально
  `timeout: <сек>` — per-scenario override дефолта 120с
- `[Manual]` — ручная проверка, автоматически не выполняется, release
  не блокирует (предупреждение в выводе)
- Матрица риска (анализ на шаге 11 по плану):
  Migration / Breaking change → HIGH; Cross-layer (≥3) / Public API → MEDIUM.
  Ни один сигнал → entry не создаётся

### Жизненный цикл (без git-детекта)

```
active ── full, все pass ──→ verified   (остаётся в entries/)
verified ── full, любой fail ──→ active  (демоция, last_full_pass очищается)
verified ── @regression release ──→ released
active ── отмена (Gate: отмена) ──→ released (status: cancelled)
```

- `full` — единственный авторитет для `verified`; `smoke` статусы не меняет
- Прогон и релиз развязаны: `full` ставит `verified`, перенос — только
  явный `@regression release`
- Проект на паузе: `entries/` не трогается никогда; purge работает только
  с `released/` (по возрасту от поля `released:`)
- Семантика статусов — без git (нет детекта мержей/diff). Персистентность —
  в git: каждая мутация статуса коммитится авто-коммитом

### Команда

`@regression smoke|full [active] [--timeout <сек>] | release | purge [days=30] | purge preview`
— подробности в `commands/regression.md`.

## File Path Conventions

- Spec файлы: `docs/superpowers/specs/YYYY-MM-DD-<feature-name>-design.md`
- Plan файлы: `docs/superpowers/plans/YYYY-MM-DD-<feature-name>-plan.md`
- Roadmap: `docs/roadmap.md` (MVP + этапы развития; создаётся `/maestro-init`
  для новых проектов) — вход для планирования спринтов
- SDD progress: `.maestro/sdd/progress.md` (в gitignore)
- Regression registry: `regression/entries/YYYY-MM-DD-<feature-name>.md`
  (в git, см. секцию «Regression Registry»)

### Git: design-документы (spec + plan + regression entry)

`superpowers` (SDD) не коммитит spec/plan — это артефакты **до** SDD, и их
коммит — зона ответственности `maestro`. SDD ожидает чистый BASE-коммит
перед стартом (он отмеряет code-коммиты от него), поэтому к шагу 13 working
tree должен быть чистым.

- **Когда:** после gate шага 12 (plan утверждён). Spec, plan и regression
  entry коммитятся **одним коммитом**, до старта SDD.
- **Сообщение:** `docs: design + plan for <feature-name>` (или `docs: spec + plan
  for <feature-name>`).
- **Почему одним, а не двумя:** spec, plan и entry — связанная группа
  дизайн-артефактов (entry — сценарии рисков из плана, шаг 12a); отдельные
  коммиты дают историю без дополнительной ценности. Code-коммиты (по
  task) делает уже SDD — их не дублируем.
- **BASE для SDD:** последний коммит (этот design+plan). SDD отмеряет от него
  свои per-task code-коммиты.
- **Простые фичи** (шаг 7b — spec не создаётся): если план пишется, коммитить
  его тем же правилом; если и план пропущен (trivial fix) — design-коммита нет,
  SDD стартует от текущего HEAD.
- **Отмена (10c/12c):** cleanup ветки/worktree по строке 348 — design-коммит
  уходит вместе с веткой.

## Ограничения

- Implementer-субагент НЕ занимается дизайном — только имплементация одного task по готовому plan
- Spec Review — только по HITL, никогда не запускается автоматически
- SKILL.md читает оркестратор; dispatch суб-агентов идёт через `Task` tool
- `implementer-prompt.md` — self-contained, не требует загрузки скилла субагентом
- Агенты синхронизируются: `agents/*.md` → `.opencode/agents/*.md`
- Команды синхронизируются: `commands/*.md` → `.opencode/commands/*.md`
- Все скиллы синхронизируются: `skills/` → `.opencode/skills/`
- Регрессия НЕ запускается автоматически на шаге 15 — только standalone `@regression`

## Polyrepo: когда фича затрагивает 2+ репозиториев

Если сервисы находятся в независимых git-репозиториях (polyrepo),
maestro pipeline запускается отдельно в каждом репо.
Pipeline не имеет механизма cross-repo координации (координированные
ветки, атомарный merge, cross-repo review) — это фундаментальное
ограничение.

### Рекомендуемая стратегия: P1 — двойной запуск (manual coordination)

1. **Определите контракт** (API, shared schema, data format) — зафиксируйте
   в spec первого репо.
2. **Запустите maestro в repo A** — полный pipeline (feature/bugfix)
   для одной стороны контракта.
3. **Запустите maestro в repo B** — полный pipeline для второй
   стороны. Spec обоих репо должен описывать один и тот же контракт.
4. **Spec Review** рекомендован для обоих запусков (cross-repo контракт —
   архитектурное решение).
5. **Мерж по порядку:** если repo A меняет API, мерж repo A должен
   предшествовать мержу repo B (consumer-first). Или наоборот.

### Когда выбрать P1

- **Loose coupling** — контракт стабилен, изменения редки
- **Разные команды** — каждый репо ведёт отдельная команда
- **5+ сервисов** — монорепо не масштабируется

### Когда выбрать монорепо (Option C)

- **Tight coupling** — частые cross-service фичи
- **Одна команда** — все сервисы ведёт одна группа
- **2-4 сервиса** — комфортный размер для монорепо

Подробнее: `docs/superpowers/specs/2026-07-30-polyglot-monorepo-support-design.md` (секция 10).

## Anti-patterns (Чего НЕ делать)

| Никогда не делать | Почему |
|---|---|
| **Jump to fix before pipeline** | Создаёт non-atomic commits, затрудняет review и root-cause analysis. Pipeline steps 3–13 ДОЛЖНЫ быть выполнены ДО code-правок (пометка: step 6 создаёт ветку, step 8 — spec — это не code; code-правки начинаются с SDD на step 13) |
| **Skip baseline test check** | Новые test-fail'ы маскируют регрессии от текущей фичи. Всегда стартуйте с зелёного состояния |
| **Mix bugfix + feature в одном коммите** | Diff невозможно чистить в `git bisect`, невозможно откатить |
| **Run tests post-commit** | Commit с failing tests pollutes git history |
| **Рационализировать «тут простой fix, тесты потом» | Простые fix'и ломают базис для всех последующих задач — тесты ДО фикса |
| **Пропускать task-review при SDD** | Без review имплементация отклоняется от спецификации незаметно. Каждый task — review. |
| **Chain-approval: принимать "continue" за approval всех последующих gates** | Gate X+1 не имеет ответа пользователя. Каждый gate — отдельный вопрос, "continue" переводит только на следующий шаг. |
| **Re-asking confirmed facts during implementation** | После D6 (гипотеза подтверждена) и шага 12 (план утверждён) ответы на ключевые вопросы уже установлены. Повторные вопросы в ходе реализации — потеря времени и признак неполной гипотезы. Если неясность возникла — вернуться к D1 для новой гипотезы, а не продолжать с вопросами. |
| **Silently skip tests/build when command not detected** | Пропуск тестов или сборки без явного подтверждения пользователя — скатывание к anti-pattern «Skip baseline test check». Tier 3 (HITL-эскалация) обязателен. |
| **Auto-detect picks first candidate without confirming if ambiguous** | Неоднозначность требует HITL: если детект нашёл несколько кандидатов, агент не выбирает сам, а представляет список пользователю. |

## Example Workflow

> Пример использует вымышленный стек для иллюстрации pipeline. Реальные
> команды (`$TEST_COMMAND`, `$BUILD_COMMAND`) и архитектура определяются
> Project Context на шаге 0.

```
Фича: "Добавить endpoint POST /api/v1/resource/{id}/activate"

Шаг 0:  [agent] Project Context
        - docs/project-context.md найден: REST API, SQL БД, миграции,
          unit + e2e тесты, CI/CD, auth
        - HITL: "Контекст актуален? (a) да — (b) обновить"
        -> Пользователь: (a) да
        - PROJECT_CONTEXT загружен
Шаг 1:  [agent] Загружает skill maestro
        -> HITL: "Что делаем? (f) feature — (b) bugfix"
        -> Пользователь: (f) feature
Шаг 2:  [agent] "Запустить pre-flight диагностику? (a) да — (b) отмена"
        -> Пользователь: (a) да
Шаг 3:  [agent] Pre-flight — Фаза 1: диагностика
        - git status: clean
        - На develop
        - Не в worktree
Шаг 4:  [agent] Pre-flight — Фаза 2: запрос
        "Изолировать в worktree? (a) worktree — (b) git checkout -b"
        -> Пользователь: (b) проще на одной ветке
Шаг 5:  [agent] имя ветки (inline-конвенция) -> feature/resource-activation
Шаг 6:  [agent] git checkout -b feature/resource-activation
Шаг 7:  -- HITL: фича сложная -> идём на brainstorm --
Шаг 8:  [agent] Brainstorming -> Spec
         - Спека: activation flow, idempotency, error handling
         - Контекст не изменился (нет новых категорий/команд/стека) → шаг 8.5: изменений нет
Шаг 9:  [HITL] Оркестратор предлагает Spec Review на spec (фича сложная)
        -> Пользователь подтверждает
        - [agent] Диспатчит opus-сабагента (subagent_type=opus) с mode=spec
        - Spec Review: verdict "approve" — архитектура корректна, рисков нет
Шаг 10: -- HITL: spec утверждён (с учётом экспертного ревью) --
Шаг 11: [agent] writing-plans -> Plan (3 tasks)
        - Task 1: DTO + endpoint handler (механический → haiku)
        - Task 2: Activation business logic (интеграционный → sonnet)
        - Task 3: Integration test + fixtures (механический → haiku)
        - Regression risk: public API → MEDIUM на API gateway/auth.
          Сценарии: `src/api/activate.spec.ts:40` (run: jest ...) workdir: .
Шаг 12: -- HITL: пользователь approves plan --
        - (a) Approve: создаётся `entries/2026-07-31-resource-activation.md`
          (status: active, risk, scenarios) — без HITL
Шаг 13: [agent] SDD: dispatch implementer (Task 1 → haiku)
        - Implementer: DONE, commits [abc123]
        - [agent] dispatch task-reviewer (sonnet) -> approved
        - Progress ledger: "Task 1: complete (commits base..abc123, review clean)"
        ---
        Task 2 (sonnet):
        - Implementer: BLOCKED (неясна обработка дубликатов)
        - [agent] предоставляет контекст из spec -> re-dispatch
        - Implementer: DONE, commits [def456]
        - Reviewer (sonnet): spec fail (missing idempotency check)
        - [agent] dispatch fix-субагента -> re-review -> approved
        - Progress ledger: "Task 2: complete (commits abc123..def456, review clean after fix)"
        ---
        Task 3 (haiku):
        - Implementer: DONE, commits [ghi789]
        - Reviewer (sonnet): approved
        - Regression reconciliation: path/run: проверены — совпадают с кодом
Шаг 14: [agent] manual-docs -> документация обновлена
Шаг 15: [agent] Финальные проверки: $TEST_COMMAND, $DOCS_COVERAGE_COMMAND,
        $OBSERVABILITY_COVERAGE_COMMAND pass
Шаг 15a: [agent] $BUILD_COMMAND — сборка проходит
Шаг 16: [agent] requesting-code-review -> final review (opus)
        - Reviewer: 2 minor findings (naming, error message)
        - [agent] dispatch ONE fix-субагента с обоими findings -> fix -> approved
Шаг 17: -- HITL: pre-PR, пользователь approves merge --
Шаг 18: [agent] finishing-a-development-branch -> merge to base (--no-ff)
```

```
Багфикс: "500 при активации узла с дублирующимся reference"

Шаг 0:  [agent] Project Context
        - docs/project-context.md найден, контекст актуален
        -> Пользователь: (a) да
        - PROJECT_CONTEXT загружен
Шаг 1:  [agent] Загружает skill maestro
        -> HITL: "Что делаем? (f) feature — (b) bugfix"
        -> Пользователь: (b) bugfix
Шаг D1: [agent] systematic-debugging + ресеч кода
        - Читает error log: duplicate key violation на event_store.reference
        - Читает nodes.service.ts: activate() → eventStore.append() без проверки reference
        - Гипотеза: "reference UNIQUE constraint бросает 500 — нет проверки перед insert"
Шаг D2: -- HITL: "Гипотеза: duplicate key violation. Начинаем probe? (a) да — (b) новая гипотеза"
        -> Пользователь: (a) да
Шаг D3: [agent] Probe-фаза
        - В nodes.service.ts:42 добавляет try-catch вокруг eventStore.append()
        - Логирует reference в catch
        - Пишет в .probe-changes.md:
          ```
          ## Probe 1: duplicate key violation
          - Файл: src/nodes/nodes.service.ts:42
          - Original: `await this.eventStore.append(event);`
          - Change: `try { await this.eventStore.append(event); } catch (e) { console.log('ref:', reference); throw e; }`
          - Status: active
          ```
Шаг D4: [agent] Проверка гипотезы
        - curl -X POST /nodes/test/activate (с тем же reference)
        - В логе: 'ref: dup-ref-123'
        - Гипотеза подтверждена
Шаг D5: [agent] Откат probe-кода
        - Читает .probe-changes.md, Probe 1
        - Открывает nodes.service.ts:42, находит try-catch, заменяет на оригинал
        - Status → reverted
Шаг D6: -- HITL: гипотеза подтверждена? (a) да — (b) нет
        -> Пользователь: (a) да
Шаг D7: -- HITL: probe откачен. Планируем фикс?
        -> Пользователь: (a) да
Шаг 11: [agent] writing-plans -> Plan (1 task)
        - Task 1: Проверка reference на уникальность до eventStore.append()
          + 409 Conflict response
        - Regression risk: ломает существующий flow активации → HIGH на nodes.
          Сценарий: `src/nodes/nodes.service.spec.ts:60` (run: jest ...) workdir: .
Шаг 12: -- HITL: план утверждён --
        - (a) Approve: создаётся `entries/2026-07-31-node-duplicate-ref.md`
Шаг 13: [agent] SDD: dispatch implementer (Task 1)
        - Implementer: DONE, commits [fix123]
        - Reviewer: approved
        - Regression reconciliation: path/run: проверены — совпадают с кодом
Шаг 14: [agent] manual-docs -> manual_docs/reference/api-endpoints.md обновлён
Шаг 15: [agent] Финальные проверки: $TEST_COMMAND, $DOCS_COVERAGE_COMMAND, $OBSERVABILITY_COVERAGE_COMMAND pass
Шаг 16: [agent] requesting-code-review -> final review -> approved
Шаг 17: -- HITL: pre-PR, пользователь approves merge --
Шаг 18: [agent] finishing-a-development-branch -> merge to develop (--no-ff)
```

```
Багфикс (interactive mode):

Шаг 0:  -> Пользователь: (a) загрузить и подтвердить (контекст актуален)
Шаг 1:  -> Пользователь: (b) bugfix
Шаг 1.5: -> Выбор: (b) interactive
Шаг 2:  -> Пользователь: (b) skip → D1
Шаг D1: [agent] systematic-debugging
        - "Вижу дубликаты KUCOIN_API_SECRET ×3 в сообщении. Открываю код."
        - "Строка 96: push(key) без dedup. Это баг."
        -> Пользователь: (a) да, probe
Шаг D2: -- HITL: "Гипотеза: missingFromScript без dedup. Начинаем probe? (a) да — (b) новая гипотеза" --
        -> Пользователь: (a) да
...
Шаг 18: merge
```
