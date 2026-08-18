# Поддержание документации в актуальном состоянии

[Назад к оглавлению](../index.md)

## 🎯 Назначение

`manual_docs/` описывает использование скилла `maestro`. Скилл развивается —
значит, документация должна обновляться **вместе** с ним. Этот файл — правило
поддержания актуальности.

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
| Модели / tier / субагенты | `reference/model-selection.md`, `explanation/agents-and-trust.md` |
| Команды (`@command`) | `reference/commands.md` |
| Trust / санитайзер | `explanation/agents-and-trust.md` |
| Security Review / sanitizer-сабагент / file access control | `explanation/agents-and-trust.md`, `reference/model-selection.md`, `reference/hitl-gates.md` |
| Реестр регрессии | `how-to/use-regression-registry.md` |
| Любое изменение поведения | `overview/changelog.md` |

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