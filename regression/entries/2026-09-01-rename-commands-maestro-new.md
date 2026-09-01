---
version: 1
feature: rename-commands-maestro-new
added: 2026-09-01
status: active
risk: HIGH
---

# Rename commands: maestro-init → maestro-new, maestro → maestro-init

## Суть

Переименование команд maestro (breaking change v2.0.0): `/maestro-init`→`/maestro-new`
(bootstrap проекта), `/maestro`→`/maestro-init` (вход в пайплайн), скилл
`maestro-init`→`maestro-new`, скрипт `maestro-init.sh`→`maestro-install.sh`. Скилл
`maestro` не переименовывается.

## Сценарии риска

### 1. Контрольный grep по старым ссылкам (критерий 4 спеки)

- `path`: спека §6 (критерий 4)
- `run`: `rg -n 'maestro-init|@maestro\b|/maestro\b|maestro-init\.sh|skills/maestro-init' --glob '!specs/**' --glob '!TODO.md' AGENTS.md README.md docs/ manual_docs/ skills/ commands/ agents/ plugins/ maestro-install.sh maestro-update.sh agpack.yml maestro-install/ 2>/dev/null`
- `workdir`: корень репо
- Ожидание: `maestro-init` — только как пайплайн-вход; `@maestro`/`maestro-init.sh` — 0.

### 2. Sandbox runtime-проверка команд

- `path`: `docs/testing/maestro-sandbox-checklist.md`
- `run`: `./maestro-sandbox.sh` (чеклист E1) — `/maestro-new`, `/maestro-design`, `/maestro-init` резолвятся; `/maestro` отсутствует; скилл `maestro-new` в списке `skill` tool.
- `workdir`: корень репо

### 3. Сквозная миграция целевого проекта (scratch)

- `path`: спека §5, §6 (критерий 7)
- `run`: [Manual] на scratch-проекте со старым agpack.yml (`skills/maestro-init`): прогнать новый `maestro-update.sh` → запись заменена на `skills/maestro-new`; реальный `agpack sync` без FetchError; stale `.opencode/commands/maestro.md` и `.opencode/skills/maestro-init/` удалены.
- `workdir`: scratch-каталог (вне репо)

### 4. Тесты плагина (не затронут)

- `path`: `plugins/maestro-bootstrap/index.test.js`
- `run`: `node --test plugins/maestro-bootstrap/index.test.js`
- `workdir`: корень репо
- Ожидание: 176/176 pass.

### 5. Синтаксис скриптов

- `path`: `maestro-install.sh`, `maestro-update.sh`
- `run`: `bash -n maestro-install.sh maestro-update.sh`
- `workdir`: корень репо
- Ожидание: exit 0.