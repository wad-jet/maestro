# Поддержание документации в актуальном состоянии

[Назад к оглавлению](../index.md)

## 🎯 Назначение

`manual_docs/` описывает использование скилла `maestro`. Скилл развивается —
значит, документация должна обновляться **вместе** с ним. Этот файл — правило
поддержания актуальности.

> **Два разных понятия, не путать:**
> - Скилл `manual-docs` (`skills/manual-docs/SKILL.md`) — **generic user-docs
>   скилл для целевого приложения**, загружается на шаге 14 пайплайна maestro.
> - Это правило (данный файл) — синхронизация `manual_docs/` **самого maestro**,
>   т.е. документации скилла maestro. Это отдельное правило, не требующее скилла
>   `manual-docs`.

## 📖 Правило

Изменение `skills/maestro/SKILL.md`, `commands/*.md` или `agents/*.md` требует
синхронизации `manual_docs/`. Актуальность `manual_docs/` — часть критериев
приёмки правок скилла.

## 📖 Чек-лист «изменил скилл → обнови деку»

| Что изменилось в скилле | Что обновить в `manual_docs/` |
|---|---|
| Шаги feature-pipeline | `tutorials/run-first-feature.md`, `overview/quick-start.md` |
| Маршрут багфикса (debug sub-pipeline) | `how-to/run-a-bugfix.md` |
| HITL-гейты / варианты ответов | `reference/hitl-gates.md` |
| Категории фич / матрица сигналов | `reference/feature-classification.md` |
| Модели / tier / субагенты | `reference/model-selection.md`, `explanation/agents-and-trust.md`, `how-to/choose-models.md` |
| Команды (`@command`) | `reference/commands.md` |
| `/maestro-assistant` (конфиг/структура/контекст) | `reference/commands.md`, `reference/config.md`, `explanation/agents-and-trust.md` |
| `/maestro-init` / `/maestro-design` (setup, конфиг, модели) | `tutorials/setup-project.md`, `reference/commands.md` |
| Trust / санитайзер | `explanation/agents-and-trust.md`, `how-to/choose-models.md` |
| Обновление/доставка до версии (skills + plugin, контроль) | `how-to/update-maestro.md` |
| Security Review / sanitizer-сабагент / file access control | `explanation/agents-and-trust.md`, `reference/model-selection.md`, `reference/hitl-gates.md` |
| Реестр регрессии | `how-to/use-regression-registry.md` |
| Шаг 14 (docs: diff-сверка, HITL при расхождении) | `explanation/pipeline-overview.md`, `tutorials/run-first-feature.md` |
| `DOCS_COVERAGE_COMMAND` (fallback diff-сверка) | `explanation/project-context.md`, `skills/maestro/stack-detection.md` |
| Любое изменение поведения | `overview/changelog.md` |

> **Синк канона ↔ производные:** полный JSON-канон `maestro.json` живёт в
> `skills/maestro-assistant/SKILL.md`. При его правке — обновить производные
> (`manual_docs/reference/config.md` таблицы, README плагина), держа синхронно с
> правилами парсинга плагина (`loadMaestroConfig` и др.).

## 💡 Как найти, что изменилось

1. Сравните `skills/maestro/SKILL.md` с тем, что описано в `manual_docs/`.
2. Просмотрите `git log` authoring-репо на предмет новых коммитов по `skills/`,
   `agents/`, `commands/`.
3. Для каждой секции из чек-листа проверьте соответствие.

## ⚠️ Частые ошибки

| Ошибка | Исправление |
|---|---|
| Дока «на потом», отдельно от правки скилла | Обновлять `manual_docs/` в том же коммите/PR |
| Изменил шаги pipeline, забыл туториал | Сверять по чек-листу |
| Не обновил `changelog.md` | Добавлять запись в каждом PR по скиллу |

## 🔗 Связанные разделы

- [Кастомизация скилла](customize-maestro.md)
- [Журнал изменений](../overview/changelog.md)