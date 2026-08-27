# Сквозной пример фичи

[Назад к оглавлению](../index.md)

## 🎯 Назначение

Сквозной пример прохождения feature-маршрута скилла `maestro` для вымышленного
стека. Показывает, как выглядят гейты, диспатчи и проверки на каждом шаге.

## 📖 Пример: «Добавить endpoint POST /api/v1/resource/{id}/activate»

```
Фича: "Добавить endpoint POST /api/v1/resource/{id}/activate"

Шаг 0:  Project Context
        - docs/project-context.md найден: REST API, SQL БД, миграции, unit + e2e
        - HITL: "Контекст актуален? (a) да — (b) обновить"
        -> (a) да
Шаг 1:  HITL: "Что делаем? (f) feature — (b) bugfix"
        -> (f) feature
Шаг 2:  HITL: "Подтверждаем старт? (a) да — pre-flight и старт — (b) отмена"
        -> (a) да
Шаг 3:  Pre-flight: git clean, на develop, не в worktree
Шаг 4:  HITL: "Изолировать в worktree? (a) worktree — (b) git checkout -b"
        -> (b) проще на одной ветке
Шаг 5:  имя ветки -> feature/resource-activation
Шаг 6:  git checkout -b feature/resource-activation
Шаг 7:  HITL: фича сложная -> идём на brainstorm
Шаг 8:  Brainstorm primary (superpowers:brainstorming) -> короткий диалог
        - confidential не затрагивается -> custodian Q/A не требуется
        - Primary пишет spec (activation flow, idempotency, error handling)
        - Открытых вопросов нет
Шаг 9:  HITL: предложен Spec Review (фича сложная) -> подтверждено
        - Диспатч opus-сабагента (subagent_type=opus, mode=spec)
        - Spec Review: verdict "approve"
Шаг 10: HITL: spec утверждён -> (a) Approve
Шаг 11: writing-plans -> Plan (3 tasks)
        - Task 1: DTO + endpoint handler (механический -> haiku)
        - Task 2: Activation business logic (интеграционный -> sonnet)
        - Task 3: Integration test + fixtures (механический -> haiku)
        - Regression risk: public API -> MEDIUM. Сценарий в entry.
Шаг 12: HITL: план утверждён -> (a) Approve
        - Создаётся entries/2026-07-31-resource-activation.md (status: active)
Шаг 13: SDD
        - Task 1 (haiku): DONE, commits [abc123]; review (sonnet) -> approved
        - Task 2 (sonnet): BLOCKED (дубликаты) -> контекст -> re-dispatch
          -> DONE, commits [def456]; review: spec fail (нет idempotency)
          -> fix-субагент -> re-review -> approved
        - Task 3 (haiku): DONE, commits [ghi789]; review -> approved
        - Regression reconciliation: path/run проверены
Шаг 14: [skill] manual-docs -> diff-сверка OK, документация обновлена
Шаг 15: тесты, coverage, lint pass
Шаг 15a: build pass
Шаг 16: requesting-code-review -> final review (opus)
        - 2 minor findings -> fix-субагент -> approved
Шаг 17: HITL: pre-PR -> (a) Approve merge
Шаг 18: finishing-a-development-branch -> merge to base (--no-ff)
```

## 💡 Ключевые наблюдения

- **Гейты** стоят на границах фаз: 7 (категория), 9 (Spec Review), 10 (spec),
  12 (plan), 17 (pre-PR).
- **Fix-loop** внутри шага 13: Task 2 прошёл BLOCKED → re-dispatch → review-fail →
  fix → re-review.
- **Три слоя ревью**: spec review (шаг 9) → per-task (шаг 13) → final (шаг 16).
  Spec **пишет** primary (шаг 8, brainstorm + custodian Q/A), **ревьюит** `opus` (untrusted, шаг 9)
  — исключает self-review.
- **Регрессия**: риски зафиксированы на шаге 12, сверены на шаге 13f.

## 🔗 Связанные разделы

- [Запуск первой фичи](../tutorials/run-first-feature.md)
- [Справочник HITL-гейтов](../reference/hitl-gates.md)
- [Устройство pipeline](../explanation/pipeline-overview.md)