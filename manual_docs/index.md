# Пользовательская документация: скилл `maestro`

Документация по использованию скилла `maestro` — оркестратора сквозной
реализации фич и багфиксов в целевом приложении (design → spec → plan →
SDD → review → docs, с HITL-гейтами). Вход — команда `/maestro` в любой
primary-сессии.

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
- [Обновление maestro](how-to/update-maestro.md) — доставка новой версии скиллов и плагина, контроль версии
- [Поддержание документации в актуальном состоянии](how-to/keep-docs-up-to-date.md)

## Reference (справочник)

- [HITL-гейты](reference/hitl-gates.md) — все точки подтверждения и варианты
- [Классификация фич](reference/feature-classification.md) — категории и матрица сигналов
- [Выбор моделей](reference/model-selection.md) — tier и субагенты
- [Команды](reference/commands.md) — доступные `@command`
- [Конфигурация](reference/config.md) — maestro.json, .opencode/opencode.json, env vars

## Explanation (пояснения)

- [Всё: pipeline — Feature и Bugfix](explanation/pipeline-overview.md) — полный flow: Feature 0→18 и Bugfix D1→D7
- [Агенты и модель доверия](explanation/agents-and-trust.md) — trust, sanitizer, роли
- [Project Context (14 категорий)](explanation/project-context.md) — формат `docs/project-context.md`

## Примеры

- [Сквозной пример фичи](examples/example-feature.md)