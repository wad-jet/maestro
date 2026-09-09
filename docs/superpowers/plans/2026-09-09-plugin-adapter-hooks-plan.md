# Адаптер maestro-bootstrap пробрасывает хуки core — Implementation Plan (3.0.3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Починить адаптер `plugins/maestro-bootstrap/index.js`, который с commit `c9e558e` возвращает opencode только `{config, event, startup, dispose}` и выбрасывает хуки core (`tool` — memory-инструменты, `tool.execute.before/after` — санитайзер/access_policy/confidential, `chat.message` + `experimental.chat.system.transform` — auto_recall). Версия 3.0.2 → 3.0.3.

**Architecture:** Заменить whitelist-return адаптера на `return { ..._mbHooks, config: async () => ({}), startup: async () => {} }`. Fail-soft (сбой init → минимальный каркас) сохранить. `config` остаётся пустой функцией без `file_access` (M12). Проброс `..._mbHooks` раскрывает `tool`, `tool.execute.before/after`, `chat.message`, `experimental.chat.system.transform`, `event`, `dispose`. Переписать header-комментарий (неверный «контракт 4 ключей»).

**Tech Stack:** Node.js (ESM), встроенный Node test runner (`node --test`).

**Spec:** `docs/superpowers/specs/2026-09-09-plugin-adapter-hooks-design.md`

---

## File Structure

- Modify: `plugins/maestro-bootstrap/index.js` — адаптер: проброс `..._mbHooks` + `config`/`startup`; переписать header-комментарий.
- Test: `plugins/maestro-bootstrap/index.test.js` — **добавить** describe «adapter forwards core hooks» (проброс `tool.execute.before/after`, `event`, `dispose`, `startup`, `config`, ключа `tool`).
- Modify: `plugins/maestro-bootstrap/README.md` — краткая заметка: адаптер обязан пробрасывать все хуки core.
- Modify: `AGENTS.md` — устаревший gotcha «opencode.json doesn't exist here» (локальный gitignored `.opencode/opencode.json` регистрирует плагин).
- Modify: `regression/entries/2026-09-09-plugin-adapter-hooks.md` — **новый файл** (risk HIGH).
- Modify: `package.json` — version 3.0.2 → 3.0.3.
- Modify: `package-lock.json` — синхронизация version (npm version 3.0.3).
- Modify: `README.md` (корень) — версия `3.0.2` → `3.0.3` (стр. ~80).
- Modify: `docs/project-context.md` — «Текущая версия дистрибутива: `3.0.2`» → `3.0.3` (стр. 38).

---

## Tasks

### Task 1: Адаптер пробрасывает хуки core

**Goal:** `plugins/maestro-bootstrap/index.js` возвращает opencode все хуки, которые собрал `MaestroBootstrapPlugin`.

- [ ] Заменить финальный return адаптера:
  ```js
  if (!_mbHooks) {
    return {
      config: async () => ({}),
      event: async () => {},
      startup: async () => {},
      dispose: async () => {},
    };
  }
  return {
    ..._mbHooks,
    config: async () => ({}),
    startup: async () => {},
  };
  ```
- [ ] Переписать header-комментарий `index.js` (убрать «opencode v1.18 ждёт {config, event, startup, dispose}»; описать реальный контракт: opencode вызывает function-export и использует весь возвращённый объект как hooks — любые ключи `tool`, `tool.execute.*`, `chat.message`, `experimental.*`).
- [ ] Сохранить `config` без `file_access` (M12) и `startup` как no-op.

### Task 2: Тест adapter-forwarding

**Goal:** `plugins/maestro-bootstrap/index.test.js` покрывает проброс хуков адаптером (default import из `./index.js`).

- [ ] Новый `describe("maestro-bootstrap adapter forwarding core hooks")`:
  - chdir в пустой temp-dir (нет `maestro.json` → memory off → детерминированно, без тяжёлых импортов; save/restore cwd);
  - `import opencodePlugin from "./index.js"`; `const hooks = await opencodePlugin({})`;
  - assert `typeof hooks["tool.execute.before"] === "function"`;
  - assert `typeof hooks["tool.execute.after"] === "function"`;
  - assert `typeof hooks.event === "function"` и `typeof hooks.dispose === "function"`;
  - assert `typeof hooks.startup === "function"`;
  - assert `typeof hooks.config === "function"` и `(await hooks.config({})).file_access === undefined` (M12);
  - assert `Object.hasOwn(hooks, "tool") === true` (memory-инструменты; `{}` при memory off).

### Task 3: README плагина + AGENTS.md

**Goal:** документация отражает контракт адаптера и текущую реальность конфига.

- [ ] `plugins/maestro-bootstrap/README.md` — одна строка: адаптер обязан пробрасывать все хуки core (`tool`, `tool.execute.*`, `chat.message`, `experimental.*`), не только `config/event/startup/dispose`.
- [ ] `AGENTS.md` — исправить gotcha «**`opencode.json` doesn't exist here**»: локальный gitignored `.opencode/opencode.json` существует и регистрирует плагин из remote; корневого `opencode.json` нет.

### Task 4: Version bump 3.0.3 + regression entry

**Goal:** единая версия дистрибутива и реестр регрессии.

- [ ] `npm version 3.0.3 --no-git-tag-version` (обновит `package.json` + `package-lock.json`).
- [ ] `README.md` (корень) — `3.0.2` → `3.0.3`.
- [ ] `docs/project-context.md` — «Текущая версия дистрибутива: `3.0.2`» → `3.0.3`.
- [ ] Создать `regression/entries/2026-09-09-plugin-adapter-hooks.md` (risk HIGH, ИБ-хуки):
  - scenarios: adapter-forwarding тест (`node --test plugins/maestro-bootstrap/index.test.js`); memory (`npm run test:memory`); [Manual] после релиза — перезапуск opencode, `memory_stats_detail` в toolset, `@maestro-memory-report`, `tool.execute.before/after` в логах.

### Task 5: Прогон тестов

**Goal:** оба тестовых прогона зелёные.

- [ ] `node --test plugins/maestro-bootstrap/index.test.js` — зелёный (включая новый adapter-тест).
- [ ] `npm run test:memory` — зелёный (без регрессий).

---

## Verification

- `git diff` финальный — только перечисленные файлы; нет незакоммиченных секретов.
- После коммита + push origin main: инвалидация `~/.cache/opencode/packages/maestro-bootstrap@git+https:`, перезапуск opencode → `.maestro/plugin-version` = 3.0.3, `plugin initialized 3.0.3` в логах.
- В **новой** сессии: `memory_stats_detail` доступен, `@maestro-memory-report` создаёт HTML; task-диспатч → `tool.execute.before/after` в логах.

## Project Context Changes

- `docs/project-context.md` §3 стр. 38: версия дистрибутива `3.0.2` → `3.0.3`.
- Примечание §11: фактический `.opencode/opencode.json` использует remote URL плагина (не локальный путь) — зафиксировать как наблюдение (не блокирует).
