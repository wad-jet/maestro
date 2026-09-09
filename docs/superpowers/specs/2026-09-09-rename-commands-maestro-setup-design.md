# Spec: Переименование команды и скилла maestro-new → maestro-setup

Дата: 2026-09-09
Маршрут: feature (authoring-репо)
Версия дистрибутива: без изменения версии плагина (только docs/skills/commands)

## 1. Проблема

Имя команды и скилла `maestro-new` больше не отражает назначение: setup
работает не только для **нового**, но и для **уже существующего** проекта
(детектит существующий `project-context.md`, merge-ит конфиги идемпотентно).
Требуется переименовать в `maestro-setup` с явной формулировкой «для нового или
уже существующего проекта».

Обратная совместимость со старым именем **не сохраняется** (breaking rename):
алиасы не создаются, старые файлы не дублируются.

## 2. Решение

| Было | Стало |
|---|---|
| `commands/maestro-new.md` | `commands/maestro-setup.md` |
| `skills/maestro-new/SKILL.md` | `skills/maestro-setup/SKILL.md` |
| `skills/maestro-new/init-context.md` | `skills/maestro-setup/init-context.md` |
| `name: maestro-new` (frontmatter) | `name: maestro-setup` |
| команда `/maestro-new`, `@maestro-new` | `/maestro-setup`, `@maestro-setup` |
| `path: skills/maestro-new` (agpack.yml) | `path: skills/maestro-setup` |

Описание скилла/команды: «инициализация maestro для нового или уже существующего
проекта». Все ссылки в authoring-репо и `manual_docs/` обновляются.

### 2a. install/update-скрипты (rename-aware)

- `maestro-install.sh` (3a): мигрировать `skills/maestro-init` **и**
  `skills/maestro-new` → `skills/maestro-setup`; финальная инструкция
  `/maestro-setup`.
- `maestro-update.sh`: drop-логика (rename-aware) — дропать и
  `skills/maestro-init`, и `skills/maestro-new`; `existing.discard` — оба;
  filter путей — оба; cleanup stale `.opencode/.../maestro-new*`.

## 3. Затронутые файлы

- `commands/maestro-setup.md` (rename), `skills/maestro-setup/{SKILL.md,init-context.md}` (rename)
- `agpack.yml`, `maestro-install/agpack.yml` — путь `skills/maestro-setup`
- `maestro-install.sh`, `maestro-update.sh` — миграция/cleanup
- `AGENTS.md`, `SECURITY.md`, `README.md`, `docs/project-context.md`
- `agents/sanitizer.md`, `commands/{maestro-design,maestro-init,test-agents}.md`
- `skills/maestro/{SKILL.md}`, `skills/maestro-assistant/SKILL.md`,
  `skills/maestro-design/SKILL.md`, `skills/maestro-feedback-report/SKILL.md`
- `manual_docs/` — все ссылки + `overview/changelog.md` (новая запись)
- `.opencode/` (gitignored зеркало) — синхронизировать команду и скилл

## 4. НЕ трогаем (исторические записи)

- `specs/rename-commands-maestro-new*.md`, `regression/entries/2026-09-01-...`,
  старые `docs/superpowers/*`, changelog-история про v2.0.0.

## 5. Критерии приёмки

1. `rg -n 'maestro-new'` по репо (исключая исторические файлы и упоминания
   внутри исторических записей) — 0 живых ссылок.
2. `bash -n maestro-install.sh maestro-update.sh` — exit 0.
3. `node --test plugins/maestro-bootstrap/index.test.js` — pass (плагин не затронут).
4. Скилл `maestro-setup` в списке `skill` tool; `/maestro-setup` резолвится.
