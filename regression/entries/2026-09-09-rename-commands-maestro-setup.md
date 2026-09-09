---
version: 1
feature: rename-commands-maestro-setup
added: 2026-09-09
status: active
risk: HIGH
---

# Rename команды и скилла: maestro-new → maestro-setup

## Суть

Переименование команды и скилла `maestro-new` → `maestro-setup`
(инициализация maestro для нового или уже существующего проекта), breaking
change без обратной совместимости: `/maestro-new`→`/maestro-setup`,
`@maestro-new`→`@maestro-setup`, `skills/maestro-new/`→`skills/maestro-setup/`,
`name: maestro-new`→`name: maestro-setup`, путь `skills/maestro-new`→
`skills/maestro-setup` в `agpack.yml`/`maestro-install/agpack.yml`.

## Сценарии риска

### 1. Контрольный grep по старым ссылкам (критерий 1 спеки)

- `path`: спека §5 (критерий 1)
- `run`: `rg -n 'maestro-new' AGENTS.md README.md docs/ manual_docs/ skills/ commands/ agents/ plugins/ maestro-install.sh maestro-update.sh agpack.yml maestro-install/ 2>/dev/null`
- `workdir`: корень репо
- Ожидание: 0 живых ссылок (допускаются только исторические записи —
  `specs/rename-commands-maestro-new*.md`, `regression/entries/2026-09-01-...`,
  старые `docs/superpowers/*`, changelog-история v2.0.0).

### 2. Sandbox runtime-проверка команд

- `path`: `docs/testing/maestro-sandbox-checklist.md`
- `run`: `./maestro-sandbox.sh` (чеклист E1) — `/maestro-setup`, `/maestro-design`,
  `/maestro-init` резолвятся; скилл `maestro-setup` в списке `skill` tool;
  `/maestro-new` отсутствует.
- `workdir`: корень репо

### 3. Синтаксис скриптов

- `path`: `maestro-install.sh`, `maestro-update.sh`
- `run`: `bash -n maestro-install.sh maestro-update.sh`
- `workdir`: корень репо
- Ожидание: exit 0.

### 4. Тесты плагина (не затронут)

- `path`: `plugins/maestro-bootstrap/index.test.js`
- `run`: `node --test plugins/maestro-bootstrap/index.test.js`
- `workdir`: корень репо
- Ожидание: pass.

### 5. Миграция agpack.yml (install/update rename-aware)

- `path`: спека §2a
- `run`: [Manual] на scratch-проекте с `agpack.yml`, содержащим
  `path: skills/maestro-init` и `path: skills/maestro-new`: прогнать
  `maestro-install.sh`/`maestro-update.sh` → записи заменены на
  `skills/maestro-setup`; stale `.opencode/commands/maestro-new.md` и
  `.opencode/skills/maestro-new/` удалены.
- `workdir`: scratch-каталог (вне репо)
