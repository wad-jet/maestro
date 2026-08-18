# Что такое maestro

[Назад к оглавлению](../index.md)

## 🎯 Назначение

`maestro` — агент для OpenCode, который оркестрирует сквозную реализацию фич и
багфиксов в целевом приложении. Он проводит работу от идеи до мержа: brainstorm,
спецификация, план, реализация (SDD), ревью и документация — с HITL-гейтами на
ключевых точках.

**Core principle:** оркестратор координирует — субагенты реализуют. HITL-гейты
на ключевых точках. Spec Review — только по запросу.

## 📦 Как maestro встраивается

- **Источник истины** — конфигурация живёт в authoring-репо `maestro-agent`
  (`skills/`, `agents/`, `commands/`, `plugins/`).
- **Runtime** — OpenCode загружает копии из целевого репозитория в `.opencode/`
  (`agents/`, `skills/maestro/`, `commands/`).
- **Точка входа** — команда `@maestro` в любой primary-сессии загружает скилл и
  следует pipeline. Отдельного primary-агента `maestro` нет — только скилл и
  команда.
- **Плагин** `maestro-bootstrap` — глобальная observability (логирование
  `task`-диспатчей и ошибок сессий), не привязан к агенту.

## 🔀 Два маршрута

| Маршрут | Описание |
|---|---|
| **Feature** (шаги 0–18) | Полный цикл: project context → pre-flight → brainstorm → spec → plan → SDD → docs → review → finish |
| **Bugfix** (шаги 0–6 → D1–D7 → шаги 11–18) | Ресеч → гипотеза → probe → откат → plan → SDD → docs → review → finish |

## 🧭 Ключевые понятия

- **HITL-гейты** — точки, где агент останавливается и ждёт явного ответа
  пользователя (варианты a/b/c). Подробнее — [Справочник HITL-гейтов](../reference/hitl-gates.md).
- **Категория фичи** — определяет глубину pipeline (простая / сложная /
  архитектурная). Подробнее — [Классификация фич](../reference/feature-classification.md).
- **Режимы работы** — `efficient` (молча между гейтами) и `interactive`
  (комментирует находки по ходу).
- **Реестр регрессии** — фиксация рисков изменения кодовой базы.
  Подробнее — [Работа с реестром регрессии](../how-to/use-regression-registry.md).

## 🔗 Связанные разделы

- [Быстрый старт](quick-start.md)
- [Журнал изменений](changelog.md)
- [Устройство pipeline](../explanation/pipeline-overview.md)
- Техническая спецификация: [`skills/maestro/SKILL.md`](../../skills/maestro/SKILL.md)