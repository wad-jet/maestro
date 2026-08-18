# Кастомизация скилла

[Назад к оглавлению](../index.md)

## 🎯 Назначение

Как изменять скилл `maestro` и связанные конфиги, и поддерживать их в
согласованном состоянии между authoring-репо и целевым приложением.

## 📖 Пошаговая инструкция

### Шаг 1: Найдите источник истины

Конфигурация живёт в authoring-репо `maestro-agent`:

```
skills/maestro/SKILL.md        ← спецификация pipeline (главный файл)
skills/maestro/*.md            ← implementer-prompt, spec-review-prompt, stack-detection
agents/*.md                    ← конфиги агентов (maestro, haiku, sonnet, opus, fable, code-reviewer)
commands/*.md                  ← конфиги @command
plugins/maestro-bootstrap/     ← ESM-плагин OpenCode
```

### Шаг 2: Измените источник

Правьте файлы в authoring-репо. Например, чтобы изменить поведение pipeline —
правьте `skills/maestro/SKILL.md`.

### Шаг 3: Синхронизируйте runtime-копии

OpenCode загружает скиллы/агентов/команды из целевого приложения (`.opencode/`).
После правки источника обновите и копию:

| Источник | Runtime-копия |
|---|---|
| `agents/*.md` | `.opencode/agents/*.md` |
| `commands/*.md` | `.opencode/commands/*.md` |
| любой скилл в `skills/` | `.opencode/skills/<name>/SKILL.md` |
| `skills/manual-docs/SKILL.md` | `.opencode/skills/manual-docs/SKILL.md` |

### Шаг 4: Обновите пользовательскую документацию

Изменение скилла влияет на `manual_docs/` — синхронизируйте её по
[чек-листу актуальности](keep-docs-up-to-date.md).

## 💡 Примеры

- **Изменить описание агента:** `agents/maestro.md` → `.opencode/agents/maestro.md`.
- **Добавить команду:** `commands/foo.md` → `.opencode/commands/foo.md`.
- **Изменить pipeline:** `skills/maestro/SKILL.md` → `.opencode/skills/maestro/SKILL.md`.

## ⚠️ Известные ограничения

- Здесь нет git-репозитория приложения и `opencode.json` — это authoring-репо.
- Не запускайте pipeline-шаги здесь (создание веток, spec, SDD) — они относятся
  к целевому приложению.

## 🔗 Связанные разделы

- [Поддержание документации в актуальном состоянии](keep-docs-up-to-date.md)
- [Агенты и модель доверия](../explanation/agents-and-trust.md)