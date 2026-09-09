# Rename команды и скилла maestro-new → maestro-setup — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Переименовать команду и скилл `maestro-new` → `maestro-setup`
(инициализация maestro для нового или уже существующего проекта) во всех
tracked-файлах authoring-репо и gitignored `.opencode/` зеркале. Без обратной
совместимости.

**Architecture:** Чистый rename: `git mv` файлов, замена ссылок
`/maestro-new`/`@maestro-new`/`skills/maestro-new`/`name: maestro-new` →
`maestro-setup`, обновление описаний. install/update-скрипты мигрируют и старые
`skills/maestro-init`, и `skills/maestro-new` → `skills/maestro-setup`, чистят
stale `.opencode/.../maestro-new*`. Исторические файлы (specs/, regression-история,
старые docs/superpowers, changelog-история v2.0.0) не трогаем.

**Tech Stack:** git, sed/bash, docs markdown.

**Spec:** `docs/superpowers/specs/2026-09-09-rename-commands-maestro-setup-design.md`

---

## File Structure

- Rename: `commands/maestro-new.md` → `commands/maestro-setup.md`
- Rename: `skills/maestro-new/` → `skills/maestro-setup/` (SKILL.md, init-context.md)
- Modify: содержимое переименованных файлов (frontmatter `name`, описания, `/maestro-setup`)
- Modify: `.opencode/commands/maestro-setup.md`, `.opencode/skills/maestro-setup/` (зеркало)
- Modify: `agpack.yml`, `maestro-install/agpack.yml` — `path: skills/maestro-setup`
- Modify: `maestro-install.sh` (3a-миграция + инструкция), `maestro-update.sh` (drop/cleanup)
- Modify: `AGENTS.md`, `SECURITY.md`, `README.md`, `docs/project-context.md`
- Modify: `agents/sanitizer.md`, `commands/{maestro-design,maestro-init,test-agents}.md`
- Modify: `skills/maestro/SKILL.md`, `skills/maestro-assistant/SKILL.md`,
  `skills/maestro-design/SKILL.md`, `skills/maestro-feedback-report/SKILL.md`
- Modify: `manual_docs/` (все ссылки) + `manual_docs/overview/changelog.md` (новая запись)
- Add: `regression/entries/2026-09-09-rename-commands-maestro-setup.md`

---

## Tasks

### Task 1: Переименовать файлы и зеркало

**Goal:** Физический rename команд/скилла в tracked и `.opencode/`.

- [ ] `git mv commands/maestro-new.md commands/maestro-setup.md`
- [ ] `git mv skills/maestro-new skills/maestro-setup`
- [ ] `mv .opencode/commands/maestro-new.md .opencode/commands/maestro-setup.md`
- [ ] `mv .opencode/skills/maestro-new .opencode/skills/maestro-setup`

### Task 2: Обновить содержимое переименованных файлов

**Goal:** Frontmatter и описания отражают новое имя и «новый/существующий проект».

- [ ] `commands/maestro-setup.md`: `description` → «Инициализация maestro для
  нового или уже существующего проекта…»; body → `skill maestro-setup`,
  `skills/maestro-setup/`, `/maestro-setup`.
- [ ] `skills/maestro-setup/SKILL.md`: `name: maestro-setup`; `description` →
  «Use when initializing maestro for a new or existing project — …»;
  `/maestro-new` → `/maestro-setup`; «нового проекта» → «нового или уже
  существующего проекта».
- [ ] `skills/maestro-setup/init-context.md`: `maestro-new` → `maestro-setup`.
- [ ] Синхронизировать `.opencode/` зеркало (cp переименованных файлов).

### Task 3: Обновить tracked-ссылки (docs/скрипты)

**Goal:** Ни одной живой ссылки на `maestro-new` вне исторических файлов.

- [ ] `AGENTS.md`, `agents/sanitizer.md`, `SECURITY.md`, `docs/project-context.md` — sed-замена.
- [ ] `commands/maestro-design.md`, `commands/maestro-init.md`, `commands/test-agents.md` — sed.
- [ ] `skills/maestro/SKILL.md`, `skills/maestro-assistant/SKILL.md`,
  `skills/maestro-design/SKILL.md`, `skills/maestro-feedback-report/SKILL.md` — sed.
- [ ] `agpack.yml`, `maestro-install/agpack.yml` — `path: skills/maestro-setup`.
- [ ] `maestro-install.sh` — 3a-миграция (init+new→setup), инструкция `/maestro-setup`,
  cleanup `.opencode/.../maestro-new*`.
- [ ] `maestro-update.sh` — drop/`existing.discard`/filter для обоих старых путей,
  cleanup `.opencode/.../maestro-new*`.
- [ ] `README.md` — все ссылки (команды, флоу, таблица, структура).

### Task 4: manual_docs

**Goal:** Синхронизация пользовательской документации (правило AGENTS.md).

- [ ] Замена во всех `manual_docs/*.md` (кроме `overview/changelog.md`).
- [ ] `manual_docs/overview/changelog.md` — новая запись [2026-09-09] о переименовании
  (исторические v2.0.0-записи про `maestro-new` не трогаем).

### Task 5: Документы фичи

**Goal:** Спека, план и regression-запись.

- [ ] `docs/superpowers/specs/2026-09-09-rename-commands-maestro-setup-design.md` — создано.
- [ ] `docs/superpowers/plans/2026-09-09-rename-commands-maestro-setup-plan.md` — этот файл.
- [ ] `regression/entries/2026-09-09-rename-commands-maestro-setup.md` — создано
  (по образцу `2026-09-01-rename-commands-maestro-new.md`, риск HIGH).

### Task 6: Проверка

**Goal:** Все критерии приёмки выполнены.

- [ ] `rg -n 'maestro-new'` по репо (исключая исторические) — 0 живых ссылок.
- [ ] `bash -n maestro-install.sh maestro-update.sh` — exit 0.
- [ ] `node --test plugins/maestro-bootstrap/index.test.js` — pass.
- [ ] Скилл `maestro-setup` в списке `skill` tool; `/maestro-setup` резолвится.
