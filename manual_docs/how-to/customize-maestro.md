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
skills/maestro/*.md            ← custodian-prompt, implementer-prompt, spec-review-prompt, stack-detection
agents/*.md                    ← конфиги агентов (custodian, haiku, sonnet, opus, fable, reviewer, sanitizer)
commands/*.md                  ← конфиги @command
plugins/maestro-bootstrap/     ← ESM-плагин OpenCode
```

> **Конфиг проекта — 4 слоя:** `MAESTRO_CONFIG` env (debug-only) →
> `<project>/maestro.json` (в git) → `<project>/.maestro/maestro.json`
> (вне git) → глобальный `~/.config/opencode/.maestro/maestro.json`;
> hybrid-семантика мержа (non-memory replace, `memory.*` soft-merge).
> Подробности — [Конфигурация](../reference/config.md).

### Шаг 2: Измените источник

Правьте файлы в authoring-репо. Например, чтобы изменить поведение pipeline —
правьте `skills/maestro/SKILL.md`.

### Шаг 3: Доставьте изменения в целевое приложение

Скиллы/агенты/команды доставляются в целевое приложение **штатным
механизмом**: скрипты `maestro-install.sh` / `maestro-update.sh`
(**wholesale copy** всего `skills/`, `commands/`, `agents/` из git-репозитория)
или ручной перенос из удалённого репозитория. При глобальной установке
OpenCode загружает их из `~/.config/opencode/` (доступны во всех проектах);
при проектной — из `.opencode/` целевого приложения. Источник (authoring-репо)
— единственная копия; частичные ручные правки зеркал не ведутся.

### Шаг 4: Обновите пользовательскую документацию

Изменение скилла влияет на `manual_docs/` — синхронизируйте её по
[чек-листу актуальности](keep-docs-up-to-date.md).

## 💡 Примеры

- **Изменить описание субагента:** правьте `agents/haiku.md`, доставка —
  `maestro-update.sh` (wholesale copy) или ручной перенос.
- **Изменить команду входа:** правьте `commands/maestro-init.md`, доставка —
  та же.
- **Добавить команду:** создайте `commands/foo.md` — авто-deploy при
  следующем обновлении (wholesale copy, регистрация не требуется).
- **Изменить pipeline:** правьте `skills/maestro/SKILL.md`, доставка —
  та же.
- **Настроить конфигурацию/структуру/контекст проекта:** используйте `/maestro-assistant` —
  консультативная точка для maestro-настройки в течение жизни проекта.

## ⚠️ Известные ограничения

- Здесь нет git-репозитория приложения и `opencode.json` — это authoring-репо.
- Не запускайте pipeline-шаги здесь (создание веток, spec, SDD) — они относятся
  к целевому приложению.

## 🔗 Связанные разделы

- [Поддержание документации в актуальном состоянии](keep-docs-up-to-date.md)
- [Агенты и модель доверия](../explanation/agents-and-trust.md)