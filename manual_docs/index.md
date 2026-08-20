# Пользовательская документация: скилл `maestro`

Документация по использованию скилла `maestro` — оркестратора сквозной
реализации фич и багфиксов в целевом приложении (design → spec → plan →
SDD → review → docs, с HITL-гейтами). Вход — команда `/maestro` в любой
primary-сессии.

> **Источник контента:** спецификация pipeline — `skills/maestro/SKILL.md`.
> При изменении скилла обновляйте эту документацию (см.
> [Как поддерживать доку в актуальном состоянии](how-to/keep-docs-up-to-date.md)).

## Быстрый старт

Новичку начните с [Что такое maestro](overview/what-is-maestro.md) и
[Быстрый старт](overview/quick-start.md). Если хотите пройти полный цикл —
откройте [Запуск первой фичи](tutorials/run-first-feature.md).

## Overview

- [Что такое maestro](overview/what-is-maestro.md) — назначение, маршруты, принципы
- [Быстрый старт](overview/quick-start.md) — минимальный путь к запуску фичи
- [Журнал изменений](overview/changelog.md) — история версий скилла

## Tutorials (обучение)

- [Настройка проекта для maestro](tutorials/setup-project.md) — подготовка проекта (`/maestro-init`, `/maestro-design`, модели по тирам)
- [Запуск первой фичи](tutorials/run-first-feature.md) — полный цикл 0→18

## How-to (инструкции)

- [Запуск багфикса](how-to/run-a-bugfix.md) — debug sub-pipeline
- [Работа с реестром регрессии](how-to/use-regression-registry.md) — `/regression`
- [Кастомизация скилла](how-to/customize-maestro.md) — правка и синхронизация
- [Поддержание документации в актуальном состоянии](how-to/keep-docs-up-to-date.md)

## Reference (справочник)

- [HITL-гейты](reference/hitl-gates.md) — все точки подтверждения и варианты
- [Классификация фич](reference/feature-classification.md) — категории и матрица сигналов
- [Выбор моделей](reference/model-selection.md) — tier и субагенты
- [Команды](reference/commands.md) — доступные `@command`

## Explanation (пояснения)

- [Устройство pipeline](explanation/pipeline-overview.md) — почему так устроен
- [Агенты и модель доверия](explanation/agents-and-trust.md) — trust, sanitizer, роли
- [Project Context (14 категорий)](explanation/project-context.md) — формат `docs/project-context.md`
- Пошаговые шаги pipeline:
  - [Step 0 — Project Context](explanation/step-0-project-context.md)
  - [Step 1 — Выбор маршрута](explanation/step-1-route-selection.md)
  - [Step 1.5 — Режим работы](explanation/step-15-interaction-mode.md)
  - [Steps 2–6 — Pre-flight и изоляция](explanation/step-2-6-preflight-isolation.md)
  - [Step 7 — Категория фичи](explanation/step-7-feature-classification.md)
  - [Step 8 — Spec Formation](explanation/step-8-spec-formation.md)
  - [Step 9 — Spec Review](explanation/step-9-spec-review.md)
  - [Step 11 — Implementation Plan](explanation/step-11-implementation-plan.md)
  - [Step 13 — SDD](explanation/step-13-sdd.md)
  - [Step 14 — Documentation](explanation/step-14-documentation.md)
  - [Steps 15–15a — Checks и Build](explanation/step-15-checks.md)
  - [Step 16 — Code Review](explanation/step-16-code-review.md)
  - [Step 18 — Merge](explanation/step-18-merge.md)
- [Debug sub-pipeline (D1–D7)](explanation/debug-sub-pipeline.md)

## Примеры

- [Сквозной пример фичи](examples/example-feature.md)

---

## Связь источников

```
skills/maestro/SKILL.md  ──→  manual_docs/          (описывает pipeline)
commands/*.md            ──→  reference/commands.md
agents/*.md              ──→  reference/model-selection.md,
                              explanation/agents-and-trust.md
git log / CHANGELOG      ──→  overview/changelog.md
```

Полная техническая спецификация pipeline — в [`skills/maestro/SKILL.md`](../skills/maestro/SKILL.md)
(документация для разработчиков, не дублируется здесь).