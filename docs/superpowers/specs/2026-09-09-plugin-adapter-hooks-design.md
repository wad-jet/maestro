# Spec: Адаптер maestro-bootstrap пробрасывает хуки core в opencode (3.0.2 → 3.0.3)

Дата: 2026-09-09
Маршрут: bugfix
Версия дистрибутива: 3.0.2 → 3.0.3

## 1. Проблема

Инструменты memory layer (`memory_search`, `memory_forget`, `memory_export`,
`memory_import`, `memory_recall_preview`, `memory_stats_detail`) недоступны в
сессиях, хотя память включена (`maestro.json → memory.enabled: true`) и модуль
памяти успешно инициализируется (`maestro-memory-<дата>.log`: `storage_init`,
`promoted`, `backfill`, `storage.stats`).

Диагностика (эта сессия) показала: `memory_stats_detail` не входит в toolset
primary-сессии, в `.maestro/logs/` за 13 дней нет ни одной записи
`tool.execute.before/after` (хотя AGENTS.md описывает их как активные), нет
`memory:recall`-инъекций. Память **инициализирована**, но её хуки не доходят до
OpenCode.

**Корень:** `plugins/maestro-bootstrap/index.js` — адаптер (commit `c9e558e`,
"opencode v1.18 adapter", 2026-08-19) возвращает OpenCode **только**
`{config, event, startup, dispose}`:

```js
return {
  config: async () => ({}),
  event: async ({ event }) => { ... },
  startup: async () => {},
  dispose: async () => { ... },
};
```

При этом `MaestroBootstrapPlugin` (core.js:1207–1221) кладёт в свой `plugin`
объект также:
- `tool` — все memory-инструменты (`core.js:1207`);
- `tool.execute.before` / `tool.execute.after` — санитайзер task-промптов,
  `access_policy`, confidential-контроль, observability-логи (`core.js:1003,1142`);
- `chat.message` + `experimental.chat.system.transform` — auto_recall
  (`core.js:1208–1209`).

Адаптер эти ключи **выбрасывает**. Убеждение автора («opencode v1.18 ждёт
{config, event, startup, dispose}») неверно: загрузчик opencode
(`packages/opencode/src/plugin/index.ts`) вызывает каждый function-export
(включая `default`) с `(input, options)` и использует **весь** возвращённый
объект как hooks — триггер дергает `hook[name]` по любому ключу (`event`,
`tool.execute.before`, `tool`, `chat.message`, `experimental.*`, ...). Custom
tools регистрируются через ключ `tool` (документация opencode.ai/docs/plugins).

С `2026-08-19` (c9e558e) в реальных сессиях не работают:
- все memory-инструменты (включая `memory_stats_detail`);
- санитайзер Level 1 (маскирование секретов в `task`-промптах) — ИБ;
- `access_policy` / confidential-контроль плагина — ИБ;
- auto_recall (инъекция исторического контекста);
- observability task-диспатчей.

Тесты этого не ловят: они вызывают `MaestroBootstrapPlugin`/`registerMemoryHooks`
напрямую, минуя адаптер (`index.test.js` импортирует только `core.js`).

## 2. Цели

1. Адаптер пробрасывает в opencode **все** хуки, которые возвращает
   `MaestroBootstrapPlugin`: `tool`, `tool.execute.before/after`, `chat.message`,
   `experimental.chat.system.transform`, `event`, `dispose`.
2. Fail-soft сохраняется: сбой init плагина → минимальный каркас
   (`{config, event, startup, dispose}`), как сейчас.
3. `config` остаётся пустой функцией без `file_access: "allow"` (M12 — не
   форсировать нативные permissions).
4. Memory-инструменты (включая `memory_stats_detail`) появляются в toolset;
   `@maestro-memory-report` начинает работать.

## 3. Решение

### 3.1 Адаптер возвращает `{ ..._mbHooks, config, startup }`

В `plugins/maestro-bootstrap/index.js` заменить whitelist-return на проброс
всего hooks-объекта core:

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
  ..._mbHooks,               // tool, tool.execute.before/after, chat.message,
                             // experimental.chat.system.transform, event, dispose
  config: async () => ({}),  // core: config=undefined; M12 — БЕЗ file_access
  startup: async () => {},
};
```

- `..._mbHooks` раскрывает все хуки, которые собрал core (включая `tool`,
  `tool.execute.*`, `chat.message`, `experimental.chat.system.transform`).
- `config` перекрывается явно (в core он `undefined`; opencode вызывает
  `hook.config?.(cfg)` — optional chaining терпит `undefined`, но явная пустая
  функция детерминированнее). M12: не форсируем `file_access`.
- `startup` остаётся no-op (backward compat).

### 3.2 Комментарии адаптера

Переписать header `index.js` и inline-комментарии: убрать неверное «opencode
v1.18 ждёт {config, event, startup, dispose}»; описать реальный контракт
(любые ключи hooks-объекта) и требование пробрасывать все хуки core.

## 4. Риски / регрессия

- **High (ИБ-хуки):** восстановление `tool.execute.before/after` активирует
  санитайзер/`access_policy`/confidential в реальных сессиях — поведение,
  документированное как активное, но не работавшее с 2026-08-19. Возможно
  появление новых блокировок `access_policy` (`ask`/`deny`) и
  `confidential.access`-логов — это **ожидаемое** восстановление защит.
- **Double-init risk:** адаптер оставляет только default-export (named exports
  живут в core.js) — загрузчик не вызовет плагин дважды. Инвариант сохранён.
- **Tool precedence:** при появлении custom tools совпадений с built-in нет
  (memory_* уникальны).
- **Rollout:** плагин грузится из remote (`wad-jet/maestro`), кэш пинит коммит
  `13c219b` — нужна инвалидация `~/.cache/opencode/packages/maestro-bootstrap@git+https:`
  и перезапуск opencode; в **новой** сессии инструменты регистрируются.

## 5. Критерии приёмки

- `node --test plugins/maestro-bootstrap/index.test.js` — зелёный (включая новый
  adapter-forwarding тест).
- `npm run test:memory` — зелёный (без регрессий).
- В новой сессии: `memory_stats_detail` доступен, `@maestro-memory-report`
  создаёт HTML; в `.maestro/logs/maestro-bootstrap-<дата>.log` при task-диспатче
  появляются записи `tool.execute.before/after`; `plugin initialized` v3.0.3.
