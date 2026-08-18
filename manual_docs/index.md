# Пользовательская документация: скилл `maestro`

Документация по использованию скилла `maestro` — оркестратора сквозной
реализации фич и багфиксов в целевом приложении (brainstorm → spec → plan →
SDD → review → docs, с HITL-гейтами). Вход — команда `@maestro` в любой
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

- [Запуск первой фичи](tutorials/run-first-feature.md) — полный цикл 0→18

## How-to (инструкции)

- [Запуск багфикса](how-to/run-a-bugfix.md) — debug sub-pipeline
- [Работа с реестром регрессии](how-to/use-regression-registry.md) — `@regression`
- [Кастомизация скилла](how-to/customize-maestro.md) — правка и синхронизация
- [Поддержание документации в актуальном состоянии](how-to/keep-docs-up-to-date.md)

## Reference (справочник)

- [HITL-гейты](reference/hitl-gates.md) — все точки подтверждения и варианты
- [Классификация фич](reference/feature-classification.md) — категории и матрица сигналов
- [Выбор моделей](reference/model-selection.md) — tier и субагенты
- [Команды](reference/commands.md) — доступные `@command`

## Explanation (пояснения)

- [Устройство pipeline](explanation/pipeline-overview.md) — почему он так устроен
- [Агенты и модель доверия](explanation/agents-and-trust.md) — trust, санитайзер, роли

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