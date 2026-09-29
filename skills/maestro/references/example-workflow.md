# Example Workflow (глава)

> Канон: example-workflow. Грузится из `skills/maestro/SKILL.md` в Overview (ориентация: первый запуск с проектом).
> Читается оркестратором (имеющим SKILL.md в контексте); внутри главы
> допускаются ссылки «см. SKILL.md, <секция скелета>» и на другие главы.

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
        - Если memory.enabled: true и memory.namespace отсутствует — информативная
          HITL-заметка (не блокирует): «Память maestro выключена (disabled_reason:
          namespace_missing). Задайте memory.namespace (формат: microservices.sales.pay
          — 1–3 сегмента, lowercase, точка-разделитель) — см.
          manual_docs/how-to/enable-memory.md.»
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
         - **Related-чек (namespace-идентичность):** если фича/spec затрагивает
           интеграцию с другими проектами/репозиториями (вне текущего домена) — проверить,
           что цель объявлена в memory.related (maestro.json). Нет → предложить правку
           конфига как задачу плана (config-as-code; после смены — рестарт opencode).
           Цель — namespace-префикс, предпочтение — точный leaf (1:1), merged-only.
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
        - Reviewer: 2 minor findings (naming, error message) -> approved
          (только-Minor — вердикт Approved без fix-диспатча); findings ->
          follow-up (non-blocking)
Шаг 17: -- HITL: pre-PR (follow-up-список: 2 Minor, не блокирует merge),
        пользователь approves merge --
Шаг 18: [agent] finishing-a-development-branch -> merge to base (--no-ff)
Шаг 18.5: [agent] feedback report — режим по директиве (нет директивы → manual: подсказка команды)
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
Шаг 18.5: [agent] feedback report — режим по директиве (нет директивы → manual: подсказка команды)
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
