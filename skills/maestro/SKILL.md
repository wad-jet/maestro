---
name: maestro
description: Use when implementing a feature end-to-end — orchestrates brainstorm (via primary + custodian Q/A), spec, plan, implementation, review, and docs with HITL gates
---

## Гейт 0 — Проверка плагина maestro-bootstrap (обязательный)

**Язык HITL:** русский.

1. **Маркер проекта.** Если в корне проекта есть `maestro.json` — это проект под
   управлением maestro, выполняется проверка плагина (шаг 2). Если `maestro.json`
   НЕТ — проект не под maestro, гейт пропускается, работаем как обычно.

2. **Плагин реально работал.** Открой самый свежий файл
   `.maestro/logs/maestro-bootstrap-<дата>.log` (по имени-дате). Найди строку
   `plugin initialized`. Если есть И её ISO-`ts` не старше 24 часов от текущего
   момента — плагин работает, продолжить работу. Иначе → шаг 3 (стоп).

3. **Жёсткий STOP (без «продолжить»).** Останови работу и покажи HITL:

   > **Плагин `maestro-bootstrap` не подключён или не загружен.**
   > Защита `docs/confidential/**` НЕ действует: confidential-данные могут быть
   > доступны untrusted-агентам и primary-сессии. `access_policy` и sanitizer тоже
   > не работают (все — в плагине `maestro-bootstrap`).
   >
   > Продолжение работы запрещено. Единственный способ продолжить — подключить
   > плагин и перезапустить opencode:
   > ```
   > opencode plugin "maestro-bootstrap@git+https://github.com/wad-jet/maestro.git"
   > # spec добавить в global ~/.config/opencode/opencode.json (реком.) или .opencode/opencode.json
   > ```
   >
   > (a) Подключить плагин и перезапустить opencode — затем повторить команду
   > (c) Отмена / стоп

   Допустимы ТОЛЬКО исходы (a) и (c). Варианта «продолжить как есть» НЕТ.
   При (a): объяснить, что нужно перезапустить opencode и повторить команду,
   НЕ продолжать pipeline в текущей сессии. При (c): завершить работу.

# Maestro

## Overview

Сквозная реализация фич и багфиксов: от дизайна до мержа. Оркестратор читает
этот скилл и управляет pipeline, диспатча субагентов на каждом этапе.

**Core principle:** Оркестратор координирует — субагенты реализуют. HITL-gates
на ключевых точках. Spec review — только по запросу.

**Три маршрута на шаге 1:**
- **Feature** (шаги 0–18) — полный цикл: project context → pre-flight → brainstorm (primary + custodian Q/A) → spec → plan → SDD → docs → review → finish
- **Bugfix** (шаги 0–6 → D1–D7 → шаги 11–18) — project context → pre-flight + branch → debug sub-pipeline: ресеч → гипотеза → probe → откат → plan → SDD → docs → review → finish
- **Spike** (feasibility/ресеч/прототип, OQ-6/OQ-9) — короткий ресеч кода/прототип → вывод-рекомендация; **без spec/plan/мержа**; код — throwaway. Использует Spike-path скилла brainstorming (см. шаг 1, вариант (s)). Шаги 11-18 НЕ выполняются.

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
- `custodian` сабагент (trusted) — Q/A-брокер по confidential для сложных фич (3+ модуля, новая таблица, public API): отвечает primary агрегатами (без значений), spec пишет primary
- superpowers:writing-plans — создание implementation plan
- superpowers:subagent-driven-development — исполнение plan (implementer + reviewer per task)
- superpowers:test-driven-development — TDD-дисциплина для шага 13 (SDD)
- superpowers:using-git-worktrees — изоляция workspace
- manual-docs (локальный скил репозитория) — обязательное обновление пользовательской документации целевого приложения (шаг 14, diff-сверка)
- superpowers:requesting-code-review — финальное ревью
- superpowers:finishing-a-development-branch — завершение
- superpowers:systematic-debugging — поиск и анализ багов (debug sub-pipeline)

## When to Use

- Пользователь вызвал `@maestro-init` для работы над фичей, багфиксом или задачей из спринта.

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
| **Простая фича** | Новый simple endpoint, UI-компонент без стейта, добавление поля к existing DTO | Шаги 2-7 → gate: простая (Bounded) → короткий дизайн в чате → approval → SDD (шаг 13) | Нет (пропускается) | 1-2 task-а без review-package | **Haiku** |
| **Сложная фича** | Новая сущность с миграцией, multi-step flow, новый публичный endpoint с auth/rate-limiting | Полный pipeline: шаги 2-7 → spec (8) → опц. Spec Review (9) → gate (10) → план (11-12) → SDD (13). **Fast-track** (шаг 7d): внешний spec вместо шага 8 | Рекомендован | Multi-task, review-package per task | **Sonnet** (**Opus** для key task) |
| **Архитектурная фича** | Новая таблица + сервис + контроллер + тесты, новый middleware, breaking change, cross-module refactoring | Полный pipeline + обязательный Spec Review | **Обязателен** | Multi-task, review-package per task, redesign после review если verdict `revise` | **Opus** |

### Критерии — матрица сигналов

Назначение категории происходит на HITL-шаге **braingate: выгрузка контекста**
(до дизайна на шаге 8). Оркестратор задаёт пользователю эти вопросы и относит
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

### Маппинг маршрутов на пути brainstorm (OQ-6)

| Маршрут maestro | Путь superpowers:brainstorming | Spec | Примечание |
|---|---|---|---|
| **Spike** (шаг 1, вариант (s)) | Spike | Нет (вывод — рекомендация) | feasibility/ресеч/прототип; без spec/plan/мержа; throwaway-код |
| **Простая фича** (шаг 7b) | Bounded | Нет | короткий дизайн в чате → approval → SDD |
| **Сложная/Архитектурная** (шаг 7a) | Architectural | Да (шаг 8) | полный spec → review → gate → plan |
| **Bugfix** (шаг 1, вариант (b)) | — (debug sub-pipeline) | Нет | systematic-debugging (D1-D7), НЕ Spike |

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
        см. `skills/maestro-new/init-context.md`; для нового проекта рекомендуется
        команда `/maestro-new` (создаёт context + конфиг; дизайн/scaffold/roadmap — `/maestro-design`).
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
      (как maestro.json), кэшировать в переменной сессии:
      ```bash
      REGISTRY_DIR="$(git rev-parse --show-toplevel)/regression"
      ```
      - Реестр закоммичен в git (корень репо, `regression/`) — идентичен из
        любого worktree/клона; трюков с git-common-dir не нужно
      - `.maestro/` и `.opencode/` целиком в `.gitignore` (только эфемерное/
        доставляемое: sdd/, last-run, logs/, feedback-reports/, plugin-version);
        реестр в git
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
      -- HITL GATE: "Что делаем? (f) feature — (b) bugfix — (s) spike — (c) отмена" --
      Выбор:
        - (b) → шаги 0–6 (project context + pre-flight + branch) → Debug Sub-pipeline (шаги D1–D7) → шаги 11–18 (plan → SDD → docs → review → finish)
        - (f) → основной pipeline (шаги 0–18)
        - (s) → **Spike** (feasibility/ресеч/прототип, OQ-6/OQ-9):
            — короткий ресеч кода/прототип → вывод-рекомендация; БЕЗ spec/plan/мержа.
            — Изоляция НЕ требуется (опц. временный worktree для прототипа,
              НЕ мержится/удаляется). Pre-flight — минимум (`git status` только).
            — Артефакты: рекомендация — в ответе primary (не в spec-файле);
              throwaway-код не коммитить (или удалить), не мержить в main.
            — Исследователь — primary (Spike-path скилла brainstorming); при
              необходимости — диспатч `haiku` для прототипа.
            — HITL-gates: шаг 1 (выбор spike) + nod на план + финальный
              «принять/продолжить/отмена».
            — Spike ≠ bugfix: debug sub-pipeline (D1-D7) НЕ применяется.
            — Шаги 11-18 НЕ выполняются. Выход: HITL решает — оформить как
              feature/bugfix/завершить.
🟡 1.5. -- HITL GATE: выбрать режим работы --
      "Как будем работать? (a) efficient — (b) interactive — (c) отмена"
      (a) efficient — текущее поведение: агент работает молча, HITL только на gates
      (b) interactive — агент комментирует находки, задаёт уточняющие вопросы по ходу
      (c) отмена → STOP, pipeline завершён
🟡  2. -- HITL GATE: подтверждение старта (pre-flight) --
      Pre-flight — read-only диагностика состояния (working tree, ветка,
      worktree, baseline-тесты) перед созданием ветки. Вопрос возник потому,
      что "да" = фактический старт работы и запуск потенциально долгих
      baseline-тестов; это последняя точка отмены до изоляции. Реакция нужна,
      чтобы не начинать молча.
      В efficient mode: (a) да — запустить pre-flight и начать — (b) отмена → STOP
      В interactive mode (зависит от маршрута шага 1):
        - bugfix: (a) да — (b) skip → D1 — (c) отмена
        - feature: (a) да — (b) skip → шаг 5 (без pre-flight) — (c) отмена
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
        (b) Простая — по **Bounded-логике** (OQ-6): короткий дизайн в чате →
            approval → SDD. Шаги 8-10 пропускаются (no formal spec). Вместо
            полного writing-plans (шаг 11) — **короткий дизайн** (краткое
            описание подхода + план в чате, не формальный plan-документ),
            затем approval и SDD (шаг 13). Requirements берутся из user story
            напрямую. Spec Review по умолчанию пропускается.
        (c) Отмена
      Если (a) → Spec Review РЕКОМЕНДОВАН для сложных, ОБЯЗАТЕЛЕН
      для архитектурных. Оркестратор предложит его на шаге 9.
      Если (a) → **Fast-track (внешний spec)**: оркестратор проверяет
      `docs/superpowers/specs/*.md` (конвенция `YYYY-MM-DD-<feature>-design.md`).
      Найден один или несколько → HITL: «Обнаружен spec `<path>`.
      (d) использовать — fast-track / (e) создать заново (шаг 8)».
      Несколько файлов → список на выбор. Не найден → пользователь может
      указать путь вручную; иначе — нормальный путь (шаг 8).
      После выбора (d) → **проверка подписей** (см. «Подписи spec-файла»):
        - валидная review-подпись → шаги 9/10 пропускаются без вопроса (auto);
        - нет/stale → HITL вариант B: «Уже отревьюен извне?
          (a) пропустить review / (b) прогнать (шаги 9+10)»;
        - валидная sanitize-подпись (`status: CLEAN`) → шаг 8.6 пропускается;
          иначе → шаг 8.6 выполняется.
      Схема Revise (шаг 10b) совместима с fast-track re-entry: review-подпись
      ставится при Approve (шаг 10); правки до Approve идут через opus+оркестратора.
      Любая правка spec меняет hash → подпись stale → при повторном входе (re-entry)
      8.6/9 перезапускаются (правило 3).
      Fast-track применим только для сложных/архитектурных фич (шаг 7a).
🟢  8. [agent] Brainstorm (primary) + Custodian Q/A -> Spec (обязательно для сложных фич)
       — **Brainstorm ведёт primary** (superpowers:brainstorming, interactive/диалоговый
         скилл). Primary грузит `superpowers:brainstorming` через `skill`-инструмент
         и ведёт диалог с пользователем по канону скилла: классификация пути →
         вопросы по одному → подходы → секционный дизайн → approval. HITL напрямую.
       — **Custodian (trusted) — Q/A-брокер по confidential.** Primary диспатчит
         `custodian` через `task` tool с `subagent_type=custodian` (модель из
         `agent.custodian.model`, opus-tier), когда нужен confidential-контекст.
       — `custodian` trusted → промпт НЕ санизируется (видит полный контекст).
       — Передать: `{questions}`, `{context}` (project context + паттерны),
         `{confidential_paths}`.
       — Промпт: `custodian-prompt.md` из этого скилла (self-contained).
       — `custodian` НЕ пишет spec (`edit: deny`), НЕ ведёт brainstorm; отвечает
         агрегатами (тип/ограничение/чувствительность/связь) БЕЗ raw-значений,
         помечает provenance.
       — **Spec пишет primary** по результатам brainstorm + Q/A-ответы custodian.
         Primary помечает confidential-фрагменты **бинарным маркером `из confidential`**
         (по пометкам custodian, без категории/значений).
       — Если primary нужен confidential-контекст для вопросов → re-dispatch
         `custodian` с Q/A-ответами. Сходимость: если вопросы перестали появляться
         → HITL: (a) продолжить / (b) упростить scope / (c) стоп.
       — Запись в лог: `custodian: Q/A answered; primary: spec created at <spec_path>`
🟢  8.5. [agent] Оценка изменений контекста
       — **Fast-track (шаг 7d):** шаг 8.5 выполняется ТАКЖЕ — внешний spec
         анализируется на изменения контекста/cross-cutting (план на шаге 11
         зависит от 8.5; fast-track пропускает только шаг 8 «Brainstorm + Spec»).
       — Оркестратор анализирует spec: появились ли новые категории,
         изменения стека, команды или уточнения для проектного контекста.
       — Если да — запоминает как pending context changes.
       — Если нет — ничего не происходит.
       — **Cross-cutting scan:** если spec меняет конфиг-схему/ключи (удаление,
         переименование, перенос ключа) — оркестратор выполняет grep по
         изменённым ключам в `examples/`, конфигах, доках и запоминает
         найденные файлы как pending cross-cutting changes (вместе с context
         changes). Они попадают в plan (шаг 11) как задачи на обновление
         затронутых файлов.
        — **HITL не требуется.** Изменения контекста будут зафиксированы
          в плане (шаг 11) и применены автоматически после аппрува плана
          (шаг 12a).
        — **Spec-follow-up (OQ-5):** оркестратор фиксирует spec-follow-up из
          особого случая шага 10b (вариант (b)) и плато OQ-4 (вариант (c)) как
          **отдельный pending-список** (рядом с `pending context changes` /
          `pending cross-cutting changes`), с пометкой причины («не хватает
          контекста» / «несущественно/scope»). Каждый follow-up помечается
          **«не блокирует Approve»**. Хранение — orchestral-состояние сессии,
          **не в spec-файле** (не загрязнять spec/подписи). На шаге 11
          follow-up транслируется в задачи плана (или секцию плана) наравне
          с context/cross-cutting changes.
🟡  8.6. [agent] Spec security review (Точка 1, см. Security Review)
       — Только для фич, где есть spec (сложные/архитектурные).
       — **Fast-track (шаг 7d):** если в spec есть валидная sanitize-подпись
         `status: CLEAN` (hash совпадает) → шаг 8.6 пропускается. При
         `FINDINGS_ACCEPTED`, отсутствии или stale-подписи → выполняется.
       — Оркестратор диспатчит сабагент `sanitizer` (trusted) с spec.
       — Sanitizer помечает чувствительные данные, возвращает structured-блок
         `SANITIZER FINDINGS` + `STATUS: CLEAN | FINDINGS_FOUND`.
       — При `FINDINGS_FOUND` → HITL-гейт (Трактовка Y):
         (a) вычистить и продолжить — оркестратор вычищает spec по пометкам
         (b) продолжить как есть (принять риск)
         (c) стоп
       — **SEC-2 (файл-артефакт):** подпись `CLEAN` ставится только если
         содержимое spec проходит Уровень 1 (regex-санитайзер плагина) с
         **0 находок** — оркестратор прогоняет содержимое spec-файла через
         sanitize, а не только промпт диспатча. При `FINDINGS_ACCEPTED`
         (вариант (b)) spec остаётся под `ask` в access_policy (не `allow`):
         untrusted ревьюеры (opus/implementer/code-reviewer) читают
         spec/plan/diff только через file-access gate с HITL — чувствительные
         данные не уходят молча.
       — После `CLEAN` или (a)/(b) оркестратор **штампует подпись
         `<!-- maestro:sanitize -->`** в конец spec файла (см. «Подписи
         spec-файла»): `status: CLEAN | FINDINGS_ACCEPTED` + date + hash
          (sha256 содержимого без `maestro:*` блоков).
        — **Перезапуск 8.6 (OQ-2):** полный прогон 8.6 выполняется на **первой**
          итерации (после первичной записи spec; spec пишет primary по результатам
          brainstorm + Q/A `custodian`). На повторных **opus-циклах** (правки
          untrusted opus + применение оркестратором, шаг 10b) 8.6 **НЕ
          выполняется** — opus видит только очищенный spec, новые real-значения
          неоткуда; остаётся Ур.1 (Слой 5) при применении правки. Полный
          повторный 8.6 выполняется **только при вовлечении trusted-контура**:
          особый случай (a) → trusted `custodian` (мог вновь занести confidential)
          или opus-trusted (B-5, защита untrusted снята). Подписи инвалидируются
          hash'ем (см. «Подписи spec-файла»).
🟢  9. [HITL] Spec Review на spec:
        - **Spec уже прошёл security review (шаг 8.6)** — opus получает
          очищенный spec; security-проверку не дублирует (см. Security Review).
          Spec написан primary (шаг 8, brainstorm + custodian Q/A) или взят внешним
          (fast-track, шаг 7d).
        - **Fast-track (шаг 7d):** валидная review-подпись → шаг пропущен
          (auto). Нет/stale → уже согласовано на шаге 7 (вариант B):
          (a) пропустить — шаги 9/10 не выполняются, подпись не ставится;
          (b) прогнать — выполнить шаг 9 + шаг 10, при Approve поставить
          review-подпись.
        - **Для сложных фич: оркестратор ОБЯЗАН предложить Spec Review.
          Шаг 10 (spec gate) не наступает, пока пользователь не ответил
          на предложение (да/нет).**
        - Для простых — пропускается.
        - Для архитектурных — **обязателен**, пользователь не может отказаться.
        - Режим: spec (единственный) — ревьюит spec: архитектура, требования,
          риски дизайна
        - Диспатч: OpenCode — `task` tool с `subagent_type=opus`;
          Claude Code — Agent tool с `model=opus` + инструкция ревьюера
        - **Перед диспатчем opus (untrusted) — Точка 2 Security Review:**
          оркестратор прогоняет промпт через sanitize (Ур.1 плагин + Ур.2
          сабагент sanitizer, см. ниже). Trusted opus (если в maestro.json) → skip.
        - Промпт ревьюера: `spec-review-prompt.md` из этого скилла
        - Передать: spec + контекст + встроенный чеклист + вопросы
        - **На Revise-цикле (шаг 10b) дополнительно передать `previous_verdict`
          + `previous_findings`** — очищенные результаты прошлого ревью opus
          (прошли Ур.1), для подтверждения закрытия прошлых замечаний.
        - **Хранение `previous_verdict`/`previous_findings` (OQ-5, Task 6
          Step 1b):** orchestral-состояние сессии (по аналогии с pending context
          / cross-cutting / spec-follow-up), НЕ в spec-файле (не загрязнять spec
          и подписи). Передаются в следующий диспатч opus вместе с актуальным
          очищенным spec. Подписи `maestro:review`/`maestro:sanitize` отвечают
          за стабильность содержимого (hash), а `previous_verdict` — за историю
          ревью в пределах сессии; это разные механизмы, не смешивать. При
          повторном входе (re-entry) через fast-track `previous_verdict` сессии
          не сохраняется (новая сессия) — opus-ревью стартует с чистого
          состояния; это допустимо и согласуется с правилом 3 (Stale-детект).
        - **Opus игнорирует `<!-- maestro:* -->` metadata-блоки** (подписи) —
          ревьюит только содержимое spec.
        - Получить: structured review (severity-бакеты + verdict approve/revise/reject)
🟡 10. -- HITL GATE: spec утверждён (с учётом экспертного ревью) --
      Оркестратор ПОКАЗЫВАЕТ diff правок (что изменилось после review).
      ВАРИАНТЫ:
        (a) Approve — spec готов, переходим к плану (шаг 11). Оркестратор
            **штампует подпись `<!-- maestro:review -->`** в конец spec файла
            (см. «Подписи spec-файла»): reviewer: opus + date + verdict: approve
            + hash (sha256 содержимого без `maestro:*` блоков).
        (b) Revise — вернуться к шагу 9 (повторный Spec Review); НЕ выполняется
            полное переписывание spec доверенным агентом (в новой модели —
            декомпозиция design→custodian+primary; custodian — Q/A-брокер, не
            переписыватель). Оркестратор re-dispatch'ит `opus` (untrusted) с
            обратной связью: предыдущий вердикт + список замечаний + текущий
            очищенный spec. opus возвращает **структурированные правки**
            (заменить/добавить/удалить, ссылки на секции). Оркестратор прогоняет
            текст правок через Ур.1 (regex-sanitizer плагина, Слой 5) и
            **инкрементально применяет их к spec** (Edit). Повторный 8.6 на
            обычном opus-цикле **НЕ выполняется** (OQ-2): opus видит только
            очищенный spec; полный повторный 8.6 нужен только при вовлечении
            trusted-контура (особый случай (a) → правку готовит trusted
            `custodian` по Q/A-агрегатам, без значений, применяет primary;
            opus-trusted B-5). Затем — повторный Spec Review (шаг 9). Подписи
            становятся stale (hash меняется) → при необходимости 8.6/9
            перезапускаются. Если для правки требуется confidential-контекст
            (opus не видит его) → HITL-эскалация (см. ниже «Особый случай»).
        (c) Reject — фича отменяется, STOP

        **Особый случай (правка требует confidential-контекста).**
        Оркестратор применяет правки opus молча, если они синтаксически
        согласованы со spec И не затрагивают помеченные confidential-фрагменты.
        HITL ставится при:
          (1) правка/вопрос затрагивает секцию, помеченную `из confidential`;
          (2) opus явно пометил «требует уточнения контекста»;
          (3) правка ссылается на отсутствующие в spec сущности/поля (выход за scope).
        Вопросы opus обрабатываются отдельно от правок (по паттерну шага 8):
        оркестратор сначала отвечает на те, что покрыты spec; остальные → HITL.
        Варианты HITL (и для правок, и для вопросов):
          (a) правку/вопрос решает trusted `custodian` (отвечает по confidential
              агрегатами, без значений; на основе его Q/A оркестратор применяет
              правку), затем 8.6 + 9;
          (b) зафиксировать как follow-up на spec-уровне (решать на шаге 11/13);
          (c) отмена.
        opus и оркестратор НЕ получают confidential-данных; маркер provenance —
        метаданные без значений; единственный мост из confidential-контура —
        вызов trusted `custodian` (a) по Q/A или HITL-решение (b).

        **Сходимость Revise (OQ-4, guard плато).** Оркестратор ведёт счётчик
        раундов Revise и список новых Critical/Important на каждом (на базе
        `previous_findings`, см. шаг 9 / spec-review-prompt). Если **2
        последовательных раунда** opus не добавили ни одного **нового**
        Critical/Important (только повторяют/уточняют прошлые) → оркестратор
        поднимает HITL: «Достигнуто плато: 2 раунда без новых Critical/Important.
        (a) Approve spec / (b) продолжить ещё / (c) follow-up оставшиеся».
        Новый Critical/Important **обнуляет** счётчик «2 раунда». Повторяющиеся
        не-закрытые замечания НЕ считаются «новыми».
🟢 11. [agent] writing-plans -> Implementation Plan
      **Fast-track (шаг 7d):** план пишется ИЗ внешнего spec (шаг 8 пропущен).
      After writing, оркестратор ПРОВЕРЯЕТ plan на качество:
      - Meta-commentary в тексте? ("Let me", "Actually", "I think", "Wait —")
      - Placeholders? ("TODO", "FIXME", "TBD")
      - Блоки кода без указания языка?
      - **Число LLM-вызовов в псевдокоде тестов** — считать с учётом ВСЕХ моделей
        в контуре (decomposer + agent loop и др.), а не только agent loop.
      - **Поле `**Service:**`:** если фича затрагивает несколько сервисов
        (полиглот-монорепо), каждая задача должна содержать опциональное
        поле `**Service:**` с путём к директории сервиса
        (например, `**Service:** services/etl-go/`). Если задача относится
        к корню репо или сервис один — поле опускается. Это поле
        используется оркестратором на шаге 13 для резолва команд
        (см. c.1 Pre-dispatch resolution).
      - **Размер задачи:** если задача затрагивает > ~8–10 файлов — разбить
        на подзадачи (отдельные диспатчи). Guidance, не жёсткий лимит: крупный
        рефакторинг с механическими правками может оставаться одной задачей
        по решению оркестратора с HITL-подтверждением при неоднозначности.
      - **Дублирование spec:** план ссылается на секции spec по имени
        (например, «см. spec §3.1»), не переписывает требования дословно.
        Полное дублирование содержимого spec в плане — дефект качества,
        исправить до plan-gate.
      - **Если есть pending context changes (шаг 8.5):** добавить в plan
        секцию `## Project Context Changes` — что изменилось, какие
        категории/команды/стек нужно обновить в `docs/project-context.md`.
        Эта секция ревьюится на gates шага 12 вместе с планом.
      - **Если есть pending cross-cutting changes (шаг 8.5):** добавить
        задачи на обновление затронутых файлов (examples, конфиги, доки)
        как отдельные задачи плана.
      - **Если есть spec-follow-up (шаг 8.5):** транслировать его в задачи
        плана (или секцию плана) наравне с context/cross-cutting changes;
        каждый follow-up помечен «не блокирует Approve» (OQ-5).
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
      a. **Pre-clean:** очистить `.maestro/sdd/` от файлов прошлых фич.
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
          — **Точка 2 Security Review:** перед диспатчем implementer (и
            task-reviewer) — если сабагент untrusted, прогнать промпт через
            sanitize (Ур.1 плагин + Ур.2 сабагент sanitizer). Trusted → skip.
            См. секцию «Security Review».
          — **Если имплементация расходится с планом** (число вызовов, сигнатуры,
            контракты) — оркестратор исправляет план **в момент выявления**, до
            перехода к следующему task. Не откладывать до pre-PR (шаг 17).
            Исправленный план — актуальный source of truth для последующих задач.
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
🟢 14. [skill] manual-docs -> обновление пользовательской документации (обязательно)
       — Оркестратор загружает скилл `manual-docs` через skill-инструмент
         (не субагент; `step_to_tier` не затрагивается).
       — **Acceptance criteria:** каждое пользовательское изменение кода имеет
         отражение в `manual_docs/` целевого приложения:
         - новый/изменённый API-эндпоинт → строка в справочнике (`reference/`);
         - новый/изменённый модуль/конфиг/поведение → how-to/reference/explanation;
         - изменённое пользовательское поведение → обновлённая соответствующая страница.
       — **Diff-сверка:** оркестратор сверяет diff кода с изменениями в `manual_docs/`.
         В efficient-режиме — молча; в interactive — комментирует находки.
       — **HITL только при расхождении** (без расхождений — гейта нет):
         (a) дополнить доку до выхода из шага → вернуться к 14;
         (b) документировать как follow-up (не блокирует merge);
         (c) skip с подтверждением (осознанный пропуск).
       — **Coverage НЕ выполняется на этом шаге** — `DOCS_COVERAGE_COMMAND`
         остаётся на шаге 15 (единая точка проверки coverage, без дублирования).
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
          - **Feature (≤2 файла, low-risk):** если фича мала (≤2 файла) и план
            не содержит risk-сценарии (шаг 11, Regression Registry) —
            `$TEST_COMMAND` опционален, достаточно coverage. Решение принимается
            на шаге 15 (НЕ зависит от шага 16 — последний выполняется ПОЗЖЕ).
          - **После шага 16:** если code review (шаг 16) выявил critical issues
            и фикс-loop (шаг 13) менял код — `$TEST_COMMAND` выполняется заново
            (условие «low-risk» сбрасывается, пропуск аннулируется).
          - **Coverage-тесты** выполняются всегда независимо от прочего.

          **Compile-time-ассерты в тестах:** если тест-файлы содержат
          статические ассерты (`@ts-expect-error`, `satisfies`, `assert_type`,
          const-eval, trait-bound checks) И тест-раннер не выполняет статанализ
          (swc/esbuild/vitest/jest без typecheck) — проверить, что эти файлы
          в scope инструмента статанализа проекта (tsconfig `include`/`exclude`,
          mypy config и т.п.). Если исключены — инвариант молча не проверяется;
          поднять как follow-up задачу (не блокирует), не allow silent pass.
          Для нетипизированных стеков — no-op. Best-effort: распознаются не
          все ассерты — acceptable overhead, не enforcement.

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
      — **Точка 2 Security Review:** перед диспатчем code-reviewer (untrusted)
        — прогон промпта через sanitize. Trusted code-reviewer → skip.
      — **Secret-scan в scope ревью (SEC-3):** code-reviewer проверяет diff
        ветки на хардкод-секреты (`sk-`, `AKIA[0-9A-Z]{16}`, `-----BEGIN`,
        `client_secret`, `token=`/`key=`) и на коммит `.env*`/`*.pem/key/cert`.
        0 находок — иначе критическое issue (блокирует merge).
      — **Трекинг issues:** оркестратор ведёт fix-loop после code review и
        трекает состояние каждого issue: `fixed` / `open (blocking)` /
        `follow-up (non-blocking)`. Follow-up фиксируется отдельно (не
        блокирует merge), не молчаливо.
🟡 17. -- HITL GATE: pre-PR --
      Оркестратор ПОКАЗЫВАЕТ: git log, test results, coverage status
      **и список открытых issues (open + follow-up) с severity** из шага 16.
      **Secret-scan pre-PR (SEC-3):** перед гейтом оркестратор прогоняет
      отрицательный grep по `git diff <base>..HEAD` на секреты
      (`sk-`, `AKIA[0-9A-Z]{16}`, `-----BEGIN`, `client_secret`, `token=`/`key=`)
      и на `.env*`/`*.pem/key/cert`; 0 находок — иначе (b) Fix до merge.
      ВАРИАНТЫ:
        (a) Approve merge — переходим к шагу 18 (finishing-a-development-branch)
        (b) Fix — вернуться к шагу 13, исправить issues. Если открытых
            issues нет — вариант помечается: «(b) Fix — нет открытых
            замечаний (только follow-up, не блокирует)».
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
- Шаг 1 — выбор маршрута (feature/bugfix/spike/cancel)
- Шаг 1 — Spike (выбор): nod на план + финальный «принять/продолжить/отмена»
- Шаг 1.5 — выбор режима (efficient/interactive/cancel)
- Шаг 2 — подтверждение старта + pre-flight (да/отмена/skip в interactive)
- Шаг 7 — сложность фичи (сложная/простая/отмена) + fast-track (d)/(e) + вариант B (внешний review)
- Шаг 8.6 — spec security review: при `FINDINGS_FOUND` (вычистить и продолжить /
  продолжить как есть (принять риск) / стоп)
- Шаг 10 — spec утверждён (approve/revise/reject)
- Шаг 10 — **Особый случай Revise** (правке/вопросу нужен confidential-контекст):
  (a) решает trusted `custodian` (Q/A-агрегат, без значений) / (b) follow-up /
  (c) отмена (см. шаг 10b, «Особый случай»)
- Шаг 10 — **Сходимость Revise** (плато: 2 раунда без новых Critical/Important):
  (a) Approve spec / (b) продолжить ещё / (c) follow-up оставшиеся (см. шаг 10b)
- Шаг 12 — plan утверждён (approve/revise/cancel)
- Шаг 17 — pre-PR (approve merge/fix/cancel)
- Security Review (Точка 2) — при находке sanitizer перед untrusted-диспатчем
  (вычистить и продолжить / продолжить как есть (принять риск) / стоп)
- File access control — untrusted сабагент при попытке доступа к файлу
  (разрешить / запретить)

Bugfix:
- Шаг D2 — утвердить гипотезу (да/новая гипотеза)
- Шаг D6 — гипотеза подтверждена (да/нет)
- Шаг D7 — переход к фиксу (да/отмена)

0. **Язык HITL:** все вопросы, варианты и сообщения пользователю на HITL gates — ТОЛЬКО на русском языке

1. **Показать контекст:**
   - Шаг 10 (spec gate) — diff правок spec после review
   - Шаг 12 (plan gate) — список task-ов с краткими описаниями
   - Шаг 17 (pre-PR) — `git log --oneline`, test results, coverage status,
     список открытых issues (open + follow-up) с severity из шага 16

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
> pipeline) модель запрашивает подтверждение **старта работы** через HITL gate;
> диагностика — следствие «да».
>
> **Interactive mode:** pre-flight — опциональная диагностика, не gate.
> При выборе (b) "skip" pre-flight пропускается: для bugfix — переход к D1,
> для feature — к шагу 5 (имя ветки). В лог записывается:
> `pre-flight: skipped (interactive mode)`.
> В efficient mode (b) — отмена → STOP.

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
| Дизайн | `custodian` сабагент (trusted) — Q/A-брокер по confidential: отвечает primary агрегатами (без значений); spec пишет primary |
| План | `writing-plans` |
| Ветка | inline-конвенция `feature/<kebab-case>` / `fix/<kebab-case>` / `hotfix/<kebab-case>` (определяет имя ветки) |
| Изоляция | `using-git-worktrees` (worktree) / `git checkout -b` (простая ветка) |
| Имплементация | `subagent-driven-development` + `test-driven-development` |
| Документация | `manual-docs` (локальный скил репозитория) — обязательный шаг 14, diff-сверка; coverage на шаге 15 |
| Ревью | `requesting-code-review` |
| Завершение | `finishing-a-development-branch`, `git-commit` |
| Регрессия | `@regression` (standalone, по запросу) — реестр рисков `regression/` (в git) |
| Конфигурация/процессы | `maestro-assistant` (загружается по ходу pipeline при вопросах настройки конфигурации/структуры/процессов) |

**Загрузка `maestro-assistant` по ходу pipeline (OP-5):** при возникновении вопроса настройки
конфигурации/процессов maestro загружает `maestro-assistant` полностью через `skill` tool (как
init), следует его правилам, затем решает и продолжает pipeline (без консультативной петли).
Перед загрузкой — probe наличия скилла; если скилл отсутствует — мягкое предупреждение
«assistant не установлен, правила конфигурации недоступны», pipeline продолжается (не блокирует).

## Model Selection

Модели настраиваются пользователем. Выбор делает оркестратор по tier-правилам
ниже. Способ диспатча зависит от харнеса:

- **Claude Code:** параметр `model` у Agent tool (алиасы `haiku`/`sonnet`/`opus`/`fable`)
- **OpenCode:** диспатч **именованного сабагента** через `task` tool с
  `subagent_type` = `haiku` | `sonnet` | `opus`. Модель жёстко привязана к
  сабагенту в merge-конфиге (`agent.{haiku,sonnet,opus}.model` в
  `.opencode/opencode.json` или global). Task tool
  не поддерживает per-dispatch выбор модели — поэтому для OpenCode оркестратор
  выбирает **сабагента**, а не модель.

### Tier → тип задачи

| Tier | Когда использовать | OpenCode сабагент |
|---|---|---|
| **Haiku** (Быстрая/дешёвая) | Механические task-и: 1-2 файла, полный spec, трансляция+тесты | `haiku` |
| **Sonnet** (средняя/сбалансированная) | Интеграционные task-и: multi-file, pattern matching, debugging | `sonnet` |
| **Opus** (наиболее мощная) | Архитектура, spec formation, design judgment, final whole-branch review | `custodian` (Q/A по confidential), `opus` (spec review), `code-reviewer` (code review). На Revise (шаг 10b) `opus` **выдаёт структурированные правки**, а не пишет в файл (`edit: deny` сохраняется) |
| **Fable** (креативная) | Примеры, метафоры, аналогии, пояснения в стиле историй | `fable` |

### Шаг → Tier (встроенный `step_to_tier`)

| Шаг | Tier | OpenCode сабагент |
|---|---|---|
| `spec_formation` (шаг 8) | opus | `custodian` (trusted, Q/A по confidential) |
| `spec_review` (шаг 9) | opus | `opus` (untrusted; на Revise-цикле выдаёт правки, применяет оркестратор) |
| `security_review` (шаг 8.6) | sanitizer | `sanitizer` (trusted) |
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
настраиваются в `.opencode/opencode.json` или global (merge), пермишены — в
`.opencode/agents/*.md`:

| Сабагент | Файл конфигурации |
|---|---|
| `haiku` | `.opencode/agents/haiku.md` + `agent.haiku.model` (`.opencode/opencode.json`/global) |
| `sonnet` | `.opencode/agents/sonnet.md` + `agent.sonnet.model` (`.opencode/opencode.json`/global) |
| `opus` | `.opencode/agents/opus.md` + `agent.opus.model` (`.opencode/opencode.json`/global) |
| `custodian` | `.opencode/agents/custodian.md` + `agent.custodian.model` (`.opencode/opencode.json`/global) |
| `code-reviewer` | `.opencode/agents/code-reviewer.md` + `agent.code-reviewer.model` (`.opencode/opencode.json`/global) |
| `fable` | `.opencode/agents/fable.md` + `agent.fable.model` (`.opencode/opencode.json`/global) |
| `sanitizer` | `.opencode/agents/sanitizer.md` + `agent.sanitizer.model` (`.opencode/opencode.json`/global) |

Все под-агенты, кроме `code-reviewer`, объявлены `hidden: true` — не показываются
в `@`-меню, вызываются только программно через `task` tool. `code-reviewer`
(`hidden: false`) виден в `@`-меню — standalone-ревью доступно напрямую.

- `permission` — `haiku`/`sonnet` могут редактировать файлы и запускать bash
  (имплементация), `opus`/`fable`/`sanitizer` — read-only без bash (ревью,
  объяснения, security-пометки). **`opus` сохраняет `edit: deny` на Revise-цикле:
  он выдаёт структурированные правки, а применяет их к spec оркестратор**,
  `code-reviewer` — `bash: allow` (git
  diff/log/show), `edit: deny` (без мутаций), `custodian` — `edit: deny`
  (Q/A-брокер, не пишет spec), `bash: deny` (без запуска команд), `task: deny`
  (без вложенных сабагентов).
- `task: deny` — агенты не диспатчат вложенные под-агенты
  (один уровень вложенности).

**При диспатче:** оркестратор по таблице «Шаг → Tier» определяет нужный tier,
маппит tier → имя агента (`haiku`/`sonnet`/`opus`/`custodian`/`code-reviewer`/`fable`/`sanitizer`),
диспатчит через `task` tool с `subagent_type` = имени агента. Доступность модели
обеспечивает провайдер OpenCode — отдельная проверка не требуется.

**Trust check перед диспатчем (два измерения):** оркестратор проверяет
`maestro.json` (загружен на шаге 0). Trust-статус управляет **двумя**
измерениями защиты:

| Trust | Sanitize промпта | File access control |
|---|---|---|
| **trusted** (`true` в `maestro.json`) | **skip** | **skip** (без ограничений) |
| **untrusted** (default) | Уровень 1 + Уровень 2 (см. Security Review) | HITL на каждый доступ к файлу |

- **Sanitize промпта:** для untrusted — прогон через Security Review (см.
  одноимённую секцию). Для trusted — промпт уходит как есть.
- **File access control:** untrusted сабагент при попытке `read` ask/deny-файла →
  HITL: `(a) разрешить` / `(b) запретить` (см. Security Review). Trusted — без
  ограничений. Покрывается только `read`; bash/glob/grep — нативные permissions.
  Реализовано плагином `maestro-bootstrap` (перехват `read` по
  `maestro.json`).
- **`sanitizer` сабагент — trusted:** единственный, кому разрешено видеть сырые
  данные (чтобы пометить). Его собственный промпт при диспатче **не** санизируется
  (он доверенный) — рекурсии нет.

### Anti-loop: диспатч и повторы

Guard от петель диспатча (пустые/ошибочные результаты субагентов, текстовые
«нарративы диспатча» без реального вызова). Применяется ко всем диспатчам
субагентов (шаги 9, 13, 16):

1. **Диспатч — только через реальный `task` tool.** Не наррировать
   «Диспатчу Task N.» текстом без вызова `task` с `subagent_type`. Текст без
   вызова = петля, а не диспатч — так не делать.
2. **Пустой/ошибочный результат субагента — не ретраить вслепую.** Не более
   3 попыток по одному и тому же `(subagent_type, задача)` в рамках одного хода
   (до следующего user-сообщения). «Ход» = непрерывная автономная работа
   оркестратора между HITL gates; ответ пользователя обнуляет счётчик.
   **Перед повторным диспатчем — проверить рабочее дерево** (`git status
   --porcelain`) и дифф (`git diff`). Пустой отчёт ≠ нет работы: имплементер
   мог внести правки, но не закоммитить и не отчитаться. В этом случае не
   диспатчить повторно, а потребовать отчёт по чек-листу (Status / Files /
   Test output / Commit SHA) из `implementer-prompt.md`.
3. **Превышение лимита → HITL:** пояснить пользователю статус (сколько попыток,
   последняя ошибка/пустой результат) и предложить варианты:
   (a) продолжить / (b) изменить формулировку / (c) отменить.
   Без ответа — STOP, ничего не диспатчить дальше.
4. **Связь с Fix-loop эскалацией (rounds 4-5, см. выше):** эскалация tier
   применяется к *содержательным* повторам (когда результат есть, но ревью
   находит проблемы). При *пустом* результате — сразу HITL (п. 2-3),
   без тиражирования tier-эскалаций на пустые попытки.

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
привязана к именованному сабагенту в merge-конфиге (`.opencode/opencode.json` или
global). Поэтому оркестратор
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

Оркестратор работает в primary-сессии дефолтной модели — **НЕ доверен**:
доступ к `confidential/**` для него закрыт (плагин deny'ит root/primary,
инвариант конфига; см. `SECURITY.md` → P1).
Любой сабагент — отдельный инференс/сессия; данные покидают контекст
оркестратора. Поэтому **по умолчанию все сабагенты untrusted**.

### Недоступность модели trusted-агента (P3, см. `SECURITY.md`)

При недоступности/ошибке модели trusted-агента (`custodian`/`sanitizer`):

- **Запрещено** подставлять другой `subagent_type` или модель для продолжения
  работы с конфиденциальным контекстом.
- Допустимы ТОЛЬКО:
  - (a) HITL с пояснением статуса и вариантами,
  - (b) ретрай той же пары `(subagent_type, задача)` (лимит 3, как в anti-loop),
  - (c) стоп.
- Автоматического fallback на не-trusted агента/модель не существует и **не
  допускается**.

### Trust levels

| Уровень | Описание | Контроль |
|---|---|---|
| **trusted** | Указан в `maestro.json` со значением `true` | **Skip** sanitize промпта + **skip** file access control — данные передаются как есть, доступ к файлам без ограничений |
| **untrusted** | Не указан в `maestro.json` или значение ≠ `true` | Перед диспатчем — Security Review (sanitizer); во время работы — file access control (HITL на каждый доступ к файлу) |

### Subagent Trust Matrix

| Сабагент | Trust по умолчанию | Примечание |
|---|---|---|
| `haiku` | untrusted | |
| `sonnet` | untrusted | |
| `opus` | untrusted | Spec review + правки на Revise. **Если указан trusted (`trust.opus: true`)** — Слои 2 (маскирование промпта) и 3-5 (confidential-deny / access_policy / Ур.1) для него НЕ действуют: opus получает промпт как есть и доступ к файлам по конфигу; гарантия «opus не видит confidential» снимается. Это осознанное решение конфигурации (пользователь расширил доверие). Рекомендация — не помечать opus trusted; при необходимости фиксировать с пониманием последствий. |
| `code-reviewer` | untrusted | |
| `fable` | untrusted | |
| `custodian` | **trusted** | Q/A-брокер по confidential (шаг 8): читает confidential-источники, отвечает primary агрегатами (тип/ограничение/чувствительность/связь) БЕЗ raw-значений. Его промпт при диспатче не санизируется. Если `trust: false`/absent — агент **non-functional** (confidential deny + sanitize промпта); не fallback, а блокировка роли. |
| `sanitizer` | **trusted** | Security review: единственный, кому разрешено видеть сырые данные (чтобы пометить). Его промпт при диспатче не санизируется — рекурсии нет. Если `trust: false`/absent — агент **non-functional** (рекурсия: промпт санизируется до него); не fallback. |

Значение по умолчанию для любого сабагента — **untrusted**, кроме `custodian` и
`sanitizer` (trusted по своей роли). Меняется только через `maestro.json`
(см. ниже). От модели в merge-конфиге (`.opencode/opencode.json` или global)
trust не зависит.

### Управление: maestro.json

Файл `maestro.json` в корне проекта — консолидированный
конфиг: три секции (`trust`, `access_policy`, `sanitizer_whitelist`). Секция
`trust` перечисляет **только trusted** сабагентов. Всё, чего нет в секции —
untrusted.

```json
{
  "trust": {
    "custodian": true,
    "sanitizer": true
  },
  "access_policy": { ... },
  "sanitizer_whitelist": { ... }
}
```

- **Ключ в `trust`:** имя сабагента (`custodian`, `sanitizer`, `haiku`, `sonnet`, `opus` и т.д.)
- **Значение:** только `true` = trusted. Любое другое значение → untrusted
- Если файла `maestro.json` нет → **все сабагенты untrusted** (безопасное значение по умолчанию)
- Файл коммитится в git — trust-level + security policy проекта
- `maestro.json` — единственный источник конфигурации. Старые `trust-config.json`,
  `.maestro/access-policy.json`, `.maestro/sanitizer-whitelist.json` больше
  **не читаются** плагином.

**Как применять:**

1. Оркестратор читает `maestro.json` **один раз за сессию** — на шаге 0
   (Load Project Context), кэширует для всех последующих диспатчей
2. При каждом диспатче сабагента (шаги 8, 9, 13, 16): проверить кэш. Если
   сабагент есть в секции `trust` с `true` → trusted, иначе → untrusted
3. Изменения в `maestro.json` вступают в силу со следующей сессии
4. Файл обязателен к проверке — игнорировать его нельзя

## Context Sanitizer (правила детекта)

Правила детекта чувствительных данных — основа для пометок (сабагент
`sanitizer`) и маскирования (плагин `maestro-sanitizer`, Этап 2). Сама
процедура security review описана в секции [Security Review](#security-review)
ниже — два уровня (плагин + сабагент), HITL-гейт, file access control.

### Что фильтруется

1. **Secrets из окружения:** переменные (case-insensitive: `API_KEY`,
   `apiKey`, `api_key`) с keywords `SECRET`, `KEY`, `TOKEN`, `PASSWORD`,
   `CREDENTIAL`, `PASS`, `AUTH`, `DSN`, `CERT`, `SALT`, `SIGNATURE`, `NONCE`
   — заменяются на `<redacted:env.NAME>`.
2. **Чувствительные поля данных:** в примерах данных, JSON-samples,
   test fixtures — финансовые (`amount`, `salary`, `iban`, `card_number`,
   `cvv`, `vat`, `total_amount`, `balance`, `account_number` и т.д.) и PII
   (`phone`, `email`, `inn`, `snils`, `passport`, `birth_date` и т.д.) поля
   заменяются на `<redacted>`. Детект **регистронезависим** (`Amount`,
   `AMOUNT`); суффиксы (`amountValue`, `amount_value`) и camelCase-варианты
   snake-полей (`cardNumber`) покрываются автоматически. Список расширяем
   через `extra_fields` в секции `sanitizer_whitelist` файла `maestro.json`.
3. **Файлы .env / .env.\*:** если упоминаются в контексте — заменяются
   на `<redacted:.env file>`.
4. **SFTP/DB credentials:** строки вида `sftp://...`, `postgresql://...`,
   `mysql://...`, `ssh://...`, `ldap://...`, `clickhouse://...` с встроенными
   credentials, а также connection-string params `password=...`, `pwd=...`
   — заменяются на `<redacted:connection>`. Детект регистронезависим
   (`POSTGRES://`). Схемы расширяемы через `extra_uri_schemes`.
5. **Private keys:** PEM-блоки `-----BEGIN ... PRIVATE KEY-----`
   (регистронезависимо) — заменяются на `<redacted>`.
6. **Auth headers:** `Authorization: Bearer ...`, `X-API-Key: ...` —
   заменяются на `<redacted>`.
7. **Raw ledger entries:** если контекст содержит неанонимизированные
   проводки — применяется маскинг полей из п.2.

### Ограничения детекта (regex-Ур.1)

- Multi-line/heredoc значения (`API_KEY=\nsecret`) не покрываются (I7).
- CamelCase-префиксы базовых полей без явной записи (например, `netAmount`
  для поля `amount`) — частично: покрываются только явные префиксные варианты
  (`total_amount`, `net_amount`, `gross_amount`); остальное ловит Ур.2.
- Короткие поля (`pan`, `inn`, `ssn`) маскируются только на границах слова —
  снижает false positives (`company`, `japan` не маскируются).
- Подход: **false positives > false negatives** — лишняя маскировка безопаснее
  пропуска; подавляется через `patterns` в whitelist.
- Entropy-детект (неизвестные форматы токенов) не реализован намеренно —
  ловит Ур.2 (LLM).

### Что НЕ фильтруется

- Агрегированные данные (итоги, суммы отчётов) — не содержат деталей проводок
- Схемы БД без данных (Prisma schema, DTO без инстансов)
- Код и конфиги (кроме `.env`)
- Имена таблиц/колонок (метаданные, не данные)

### Когда применяется

На всех шагах, где происходит диспатч untrusted сабагента.
Trust-уровень определяется по `maestro.json` (см. Trust Model):

| Шаг | Сабагент | Security Review |
|---|---|---|
| Шаг 8 — Custodian Q/A | `custodian` | **Skip** (trusted — видит полный контекст для агрегации по confidential) |
| Шаг 9 — Spec Review | `opus` | Применяется (untrusted) |
| Шаг 13 — SDD implementer | `haiku` / `sonnet` | Применяется (untrusted) |
| Шаг 13 — SDD task-reviewer | `sonnet` | Применяется (untrusted) |
| Шаг 16 — Code Review | `code-reviewer` | Применяется (untrusted) |
| (внутри Security Review) | `sanitizer` | **Skip** (trusted — видит сырые данные для пометок) |

Если сабагент отмечен как trusted в `maestro.json` — sanitize промпта
**не проводится** (риск принят пользователем).

### Правила применения

1. Уровень 1 (плагин, Этап 2) — авто-маскирование, **без HITL**
2. Уровень 2 (сабагент `sanitizer`) — пометки, при находке → HITL
   (Трактовка Y, см. Security Review)
3. Оригинальный контекст оркестратора **не изменяется** — санитайзер
   создаёт копию промпта для untrusted сабагента
4. Аудит-лог: плагин пишет события sanitizer в общий лог
   `.maestro/logs/maestro-bootstrap-<date>.log` с маркерами `sanitizer.redacted`
   (что замаскировано, без содержимого) и `access_policy.blocked` (файл-доступ):
   - timestamp
   - сабагент / sessionID
   - что замаскировано/заблокировано (без содержимого)

## Security Review

Двухуровневая защита чувствительных данных перед диспатчем в untrusted сабагенты
+ file access control во время работы. Цель: субагенты не должны получить
чувствительные данные; минимум данных доходит даже до trusted-модели sanitizer.

### Архитектура

```
Диспатч в сабагента:
  trust check (maestro.json)
    │
    ├── trusted → SKIP sanitize + SKIP file access control → диспатч как есть
    │
    └── untrusted →
         [УРОВЕНЬ 1] maestro-sanitizer (плагин, Этап 2) ── авто, БЕЗ HITL
            regex-детект + маскирование по правилам Context Sanitizer
            нет находок → промпт уходит
            ▼
         [УРОВЕНЬ 2] сабагент sanitizer (trusted, read-only) ── всегда, доп. слой
            находит и ПОМЕЧАЕТ чувствительные данные (не вычищает)
            пометки есть → HITL до clean:
            ▼
         [HITL] (a) вычистить и продолжить / (b) продолжить как есть (принять риск) / (c) стоп
            │
         [FILE ACCESS CONTROL] — во время работы untrusted сабагента:
            `read` ask/deny-файла → блок (HITL решает оркестратор)
```

### Точки встраивания в pipeline

- **Точка 1 — Spec security review:** после шага 8 (spec), до шага 9 (Spec
  Review) и планирования. Сабагент `sanitizer` проверяет spec на чувствительные
  данные. Только для фич, где есть spec (сложные/архитектурные). **Перезапуск
  на каждый Revise-цикл** (шаг 10 → Revise → шаг 8 → повторный прогон sanitizer).
  В fast-track (шаг 7d) пропускается только при валидной sanitize-подписи
  (`status: CLEAN`); после прогона оркестратор штампует подпись
  `<!-- maestro:sanitize -->` (см. «Подписи spec-файла»).
- **Точка 2 — Перед диспатчем untrusted:** перед каждой отправкой промпта в
  untrusted субагентов (шаги 9/13/16). Выполняется всегда. Trusted сабагенты
  пропускают (skip sanitize).

### Роль сабагента sanitizer

- Trusted (видит сырые данные), read-only (`edit: deny`, `bash: deny`),
  `task: deny`.
- **Помечает** чувствительные данные (где, что, почему) — не вычищает.
- **Оркестратор вычищает** промпт по пометкам (если пользователь выбрал (a)).
- Формат выхода — structured-блок `SANITIZER FINDINGS` (см. `agents/sanitizer.md`):
  `location / type / reason / snippet_hint` + `STATUS: CLEAN | FINDINGS_FOUND`.

### HITL-гейт при находке (Трактовка Y)

При `STATUS: FINDINGS_FOUND` оркестратор показывает находки пользователю и
запрашивает решение **до** clean:

- `(a) вычистить и продолжить` — оркестратор вычищает по пометкам, диспатчит
  очищенный промпт.
- `(b) продолжить как есть (принять риск)` — диспатч с sensitive-данными; явное
  решение пользователя.
- `(c) стоп` — остановить процесс.

Утечка sensitive в untrusted возможна только по выбору (b).

### Когда запускать Уровень 2 (sanitizer-сабагент)

- **По умолчанию — всегда** (на каждом untrusted-диспатче + на spec review).
- Опция (env/конфиг `MAESTRO_SANITIZER_MODE=hybrid`) переключает на гибрид:
  spec review всегда + диспатч только если Уровень 1 что-то нашёл или недоступен.
- **Исключение — обычные opus-циклы Revise (OQ-2, шаг 10b):** Ур.2-сабагент
  НЕ запускается (полный 8.6 не выполняется). Полный формат пометок
  `location: <секция/строка>` используется ТОЛЬКО в случаях вовлечения
  trusted-контура (полный 8.6). На opus-циклах защита — Ур.1 (Слой 5 при
  применении правки) + маскирование входа opus (Слой 2). Вопрос «полный vs
  diff» снимается: на opus-циклах прогона sanitizer нет.

### File access control (реализовано в плагине)

Untrusted сабагент при попытке `read` ask/deny-файла → блокировка плагином
`maestro-bootstrap` по `maestro.json` → `access_policy` (`allow` → пропуск, `ask` →
блок с HITL-сигналом оркестратору, `deny` → жёсткий блок). Trusted — без
ограничений (skip sanitize промпта; file access — по maestro.json). Файл
правил формирует сабагент `sanitizer` (по структуре проекта/стеку) или вручную.
Если файла нет — плагин не блокирует (fail-open), полагаясь на нативные
permissions OpenCode.

**Покрываются только `read`.** `bash`/`glob`/`grep` НЕ покрываются access-policy
(пути из bash-команд ненадёжно извлекаются; glob/grep работают с паттернами) —
для них используйте нативные permissions OpenCode (`bash: ask` и т.п.).

**HITL-flow при блоке (ask):** плагин бросает ошибку с маркером
`[access-policy:ask]`. Оркестратор ловит маркер в результате сабагента и
запрашивает HITL:
- `(a) разрешить` — дописать путь/паттерн в `allow`-секцию
  `maestro.json`, затем **re-dispatch** сабагента;
- `(b) запретить` — сообщить сабагенту/продолжить без файла;
- `(c) стоп` — остановить процесс.
При `deny` — жёсткий блок без HITL (сабагент получает ошибку, оркестратор
решает по ситуации).

### Этапность

- **Этап 1 (сделан):** сабагент `sanitizer` (Уровень 2) + HITL-гейт + правила +
  file access control инструктивно. Sanitizer там **primary**.
- **Этап 2 (сделан):** в плагине `maestro-bootstrap` реализованы Уровень 1
  (авто-маскирование промптов task) + file access control (перехват file-тулов
  по maestro.json) + whitelist. Сабагент остаётся доп. слоем (Уровень 2)
  и генерирует/поддерживает maestro.json.

### Known gaps Этапа 1 (закрыты на Этапе 2)

- **Принцип «минимум данных до trusted sanitizer»** — закрыт: Уровень 1 (плагин)
  маскирует промпт до sanitizer-сабагента.
- **Этап 1 модель-зависим** — закрыт: плагин санизирует промпт автоматически
  при каждом task-диспатче.
- **File access control не enforced** — закрыт: плагин перехватывает file-тулы
  по maestro.json.

## Spec Review (опционально)

Диспатчится по HITL **на spec** (шаг 9), до её утверждения. Для сложных фич
(3+ модуля / новая таблица / public API) оркестратор **предлагает** Spec Review
на spec-gate; для простых — пропускает. Окончательное решение — за пользователем.

**Вход:** spec, написанный primary (шаг 8, brainstorm + custodian Q/A) и очищенный
`sanitizer` (шаг 8.6). `opus` — независимый ревьюер (untrusted), ревьюит то, что
создал другой контур (primary) — исключает конфликт интересов self-review.

**Режим:** `spec` (единственный) — ревьюит spec: архитектуру, требования, риски
дизайна. План ещё не существует — ревью предотвращает архитектурные ошибки до
планирования.

**Формат:** severity-бакеты (Critical / Important / Minor) + verdict
(approve / revise / reject). Без числового scoring — единый формат с task-reviewer
и final code review.

**Модель:** **opus** (см. секцию "Шаг → Tier" в Model Selection).

Используйте промпт: `spec-review-prompt.md` из этого скилла.

## Подписи spec-файла

Метаданные о пройденном ревью/санизации, встроенные в spec файл. Используются
fast-track (шаг 7d) для детекта «внешний spec уже отревьюен/санизирован» и для
re-entry (повторный запуск `maestro` на том же spec).

**Формат:** HTML-комментарии в конце spec файла — невидимы в рендере, не
загрязняют markdown-иерархию. **Ставит только оркестратор** (trusted): opus —
untrusted, sanitizer — read-only (`edit: deny`); ни один из сабагентов писать
в spec не может.

```markdown
<!-- maestro:review
reviewer: opus
date: 2026-08-19
verdict: approve
hash: <sha256 содержимого spec без блоков maestro:*>
-->
```

```markdown
<!-- maestro:sanitize
status: CLEAN | FINDINGS_ACCEPTED
date: 2026-08-19
hash: <sha256 содержимого spec без блоков maestro:*>
-->
```

**Правила:**

1. **Hash scope:** sha256 по содержимому spec без блоков `maestro:*` (от
   `<!-- maestro:` до ближайшего `-->`). Иначе подпись влияет на собственный hash.
2. **Review-подпись** штампуется на шаге 10 при Approve; `verdict:` всегда
   `approve`. **Sanitize-подпись** штампуется на шаге 8.6 после `CLEAN` или
   выбора (a)/(b); `FINDINGS_ACCEPTED` = пользователь осознанно принял риск.
3. **Stale-детект:** любая правка spec меняет hash → подпись stale →
   трактуется как отсутствующая.
4. **`FINDINGS_ACCEPTED` не даёт skip 8.6 при re-entry** — spec содержит
   sensitive, повторная санизация безопаснее (консервативно).
5. **Stale-клир:** вырезание `maestro:*` блоков перед ре-диспатчем `custodian`
   актуально **только при первичном Q/A-вызове `custodian` (шаг 8)** и при особом
   случае (a) шага 10b (`custodian-prompt.md` о подписях не знает). На обычном
   Revise-цикле (правки untrusted opus + применение оркестратором) ре-диспатч
   `custodian` не происходит → Stale-клир не применяется.
6. **Revise-loop:** шаг 10 = Revise → spec правится через opus+оркестратора
   (оркестратор применяет правки, Ур.1) → hash меняется → подписи stale.
   Повторный Spec Review (шаг 9) перезапускается всегда. Повторный 8.6 —
   **только при вовлечении trusted-контура** (особый случай (a) → `custodian`;
   opus-trusted B-5), см. OQ-2.
7. **Разграничение с Точкой 2:** подпись spec файла НЕ отменяет sanitize
   промптов на 13d/16 — Точка 2 санизирует сборку промпта, а не файл.
8. **Forgeability:** блок можно вставить вручную. Принято как конвенция
   (как sanitizer-блоки); hash гарантирует соответствие подписи содержимому.

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
| **HITL шаг 2: skip (interactive)** | Pre-flight пропускается: bugfix → D1; feature → шаг 5 (имя ветки). В efficient (b) — отмена → STOP. Cleanup не требуется (ветка ещё не создана). |
| **HITL шаг 1.5: отмена (1.5c)** | STOP — pipeline завершён. Пользователь отказался от запуска. |
| **Spec gate: revise (10b)** | re-dispatch `opus` (untrusted) для правок, оркестратор применяет их к spec (Ур.1, Слой 5); повторный Spec Review (шаг 9). При необходимости confidential-контекста — HITL: (a) trusted `custodian` (Q/A-агрегат) / (b) follow-up. Повторный 8.6 только при вовлечении trusted-контура (OQ-2). |
| **Внешний spec невалидный (шаг 7d)** | Пустой / нечитаемый / не содержит требований → HITL: (a) создать заново через шаг 8 (brainstorm primary + custodian Q/A) / (b) указать другой путь / (c) отмена |
| **Plan gate: revise (12b)** | Вернуться к шагу 11 (writing-plans), доработать план |
| **Spec review: revise** | re-dispatch `opus` для правок, оркестратор применяет их (Ур.1); при необходимости confidential-контекста — HITL: (a) trusted `custodian` / (b) follow-up. Повторить review (шаг 9); 8.6 только при trusted-контуре (OQ-2). |
| **Spec review: reject** | Эскалация к пользователю: пересмотр требований или отмена фичи |
| **`custodian`/`sanitizer`: `confidential:deny`** | Агент untrusted (проверить `maestro.json` → `trust`: absent/`false`) — он non-functional без доверия. Предупредить: "custodian/sanitizer не trusted (проверьте `maestro.json` → `trust`), без доверия агент не может выполнять свою роль" → HITL: (a) обновить конфиг и перезапустить / (b) стоп. Не ретраить как обычную ошибку сабагента. |
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

- Реестр закоммичен в git (корень репо). Per-worktree остаётся `.maestro/`
   (в `.gitignore` целиком)
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
- Roadmap: `docs/roadmap.md` (MVP + этапы развития; создаётся `/maestro-design`
  для новых проектов) — вход для планирования спринтов
- SDD progress: `.maestro/sdd/progress.md` (в `.gitignore`, весь `.maestro/`)
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
- **Отмена (10c/12c):** cleanup ветки/worktree (см. «Gate: отмена» в таблице
  «Обработка сбоев») — design-коммит уходит вместе с веткой.

## Ограничения

- Implementer-субагент НЕ занимается дизайном — только имплементация одного task по готовому plan
- Spec Review — только по HITL, никогда не запускается автоматически
- SKILL.md читает оркестратор; dispatch суб-агентов идёт через `Task` tool
- `implementer-prompt.md` — self-contained, не требует загрузки скилла субагентом
- Агенты/команды/скиллы доставляются в целевое приложение штатным механизмом (вручную из
  удалённого репозитория или через `agpack`); отдельное `.opencode/`-зеркалирование не требуется
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
| **Использовать `git stash` в manual-проверках оркестратора** | В репо с посторонними stash-entries `git stash pop` может применить чужой stash → конфликт. Для проверки pre-existing состояния использовать неразрушающие методы: `git diff --name-only <base>...HEAD` + точечный линтер по нашим файлам. |

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
Шаг 2:  [agent] "Подтверждаем старт? (a) да — pre-flight и начало — (b) отмена"
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
Шаг 7:  -- HITL: фича сложная -> идём на дизайн --
Шаг 8:  [agent] Brainstorm (primary) -> Spec
         - Primary грузит superpowers:brainstorming, ведёт диалог с пользователем
         - confidential не затрагивается → custodian Q/A не требуется
         - Primary пишет spec (activation flow, idempotency, error handling)
         - Открытых вопросов нет
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
Шаг 14: [skill] manual-docs -> diff-сверка OK, документация обновлена
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
Шаг 14: [skill] manual-docs -> manual_docs/reference/configuration.md обновлён, diff-сверка OK
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
