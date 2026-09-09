# Spec: Memory layer под Bun — совместимость sqlite-бэкенда (3.0.1)

Дата: 2026-09-09
Маршрут: bugfix
Версия дистрибутива: 3.0.0 → 3.0.1

## 1. Проблема

Memory layer (beta) не работает под opencode runtime (Bun). На старте:

```
memory: init failed — 'better-sqlite3' is not yet supported in Bun
Track the status in https://github.com/oven-sh/bun/issues/4290
```

`better-sqlite3` — нативный Node-модуль (node-gyp/N-API). opencode исполняет
плагины под Bun, который его не поддерживает. Результат: storage init падает,
`memory.db` не создаётся, память disabled несмотря на probe OK.

**Корень:** `plugins/maestro-bootstrap/memory/storage/sqlite.js:26` —
`loadBetterSqlite3()` грузит better-sqlite3 из `module_dir`. Тесты это не
ловили: `npm run test:memory` гоняется под Node, где better-sqlite3 работает
(runtime gap test vs production).

## 2. Цели

1. Memory layer запускается под Bun (opencode runtime): storage init OK,
   `memory.db` создаётся, все операции (upsert/search/scan/delete/prune/
   candidates/markMerged) работают.
2. Обратная совместимость под Node (dev/тесты) не ломается.
3. Одна кодовая база: драйвер выбирается рантаймом, остальной код не
   дублируется.
4. Синхронизация: изменения скиллов/доков по консистентности онбординга
   memory layer в рамках той же версии.

## 3. Решение

### 3.1 Драйвер: runtime-детект + адаптер

В `storage/sqlite.js` заменить `loadBetterSqlite3()` на `loadSqliteDriver()`
с выбором по рантайму:

- `process.versions.bun` присутствует → драйвер **node:sqlite**
  (`DatabaseSync`), обёрнутый в better-sqlite3-совместимый адаптер.
- иначе (Node) → **better-sqlite3** (текущее поведение, тесты не меняются).
- недоступен ни один → actionable-ошибка с указанием шагов.

**node:sqlite — почему:** встроенный модуль Node ≥22.5 (у нас Node 24) и
реализован в Bun (DatabaseSync). API-совместимость подтверждена
диагностикой на Node 24: BLOB→`Uint8Array` (Float32Array-view в `_searchIn`
работает), bare named-params (`@x` в SQL + `{x}` в run), FTS5 + `bm25()`,
`run().changes`.

**Адаптер-шим** (малая поверхность, остальной код sqlite.js не трогаем):

| better-sqlite3 | node:sqlite (адаптер) |
|---|---|
| `db.pragma(s)` | `db.exec("PRAGMA " + s)` |
| `db.transaction(fn)` | `BEGIN`/`COMMIT`/`ROLLBACK`-обёртка (2 места, оба top-level) |
| `new Database(p, { readonly, fileMustExist })` | `readonly` → `readOnly`; fileMustExist не нужен (readonly+нет файла → throw → skip) |
| `db.closed` | `!db.isOpen` |

Возвращаемый объект — единый лучше-sqlite3-подобный интерфейс `Database`,
чтобы вызовы в `_init`/`_collectKey`/`_searchIn` и т.д. не менялись.

### 3.2 Диагностика: путь данных в статусе

В `memory/index.js` (`memory_stats_detail`, ~строка 969-975) добавить строку
`Каталог данных: ${dataDir}` в `out`-массив. `dataDir` уже в замыкании
`registerMemoryHooks` (:393). Даёт ответ на частый вопрос «где мои данные».

### 3.3 Консистентность скиллов (онбординг memory)

- `skills/maestro-new/SKILL.md` (§143-170): добавить обязательное
  permission-правило (`memory_forget/export/import: "ask"` в merge-config при
  включении памяти) + ссылку на 4-шаговую последовательность включения.
- `skills/maestro-assistant/SKILL.md` (канон `memory`): заменить
  «перезапуск + напоминание про npm install» на явную последовательность:
  (1) рестарт → self-provision, (2) `npm install` в `module_dir`, (3) рестарт
  №2, (4) верификация (probe-лог / `@maestro-memory` / блок «Контекст из
  памяти»). Убрать устаревшее «память v2» → актуальная терминология.

### 3.4 Docs-sync

- `manual_docs/how-to/enable-memory.md`: runtime-заметка (Bun → node:sqlite) +
  предупреждение, что `npm install` при первой установке может занять >5 мин.
- `manual_docs/reference/memory.md`: сверить упоминания драйвера
  (better-sqlite3) с новой реальностью (node:sqlite под Bun); отметить, что
  `@maestro-memory` показывает каталог данных.

## 4. Non-goals

- Не трогаем qdrant/pgvector бэкенды (не затронуты: клиенты pure-JS/fetch,
  под Bun работают).
- Не меняем схему `memory`-таблицы, не делаем миграций данных.
- Не решаем npm audit (2 high — транзитивные deps, отдельная тема).

## 5. Риски

1. **Bun `node:sqlite` не проверен локально** (нет bun CLI). Финальная
   проверка — в самом opencode после деплоя; логика шима покрывается
   adapter-тестами под Node (node:sqlite-путь).
2. **transformers.js под Bun** на реальном embed — не проверен (probe грузит
   только модуль, не модель). Если embed упадёт после фикса sqlite — отдельный
   багфикс.
3. FTS5 в Bun `node:sqlite` — ожидаемо есть (как в Node 24); если нет —
   vector-only fallback уже заложен (`_searchIn`, allowFts).

## 6. DoD

- Storage init под Bun: нет `memory: init failed`, `memory.db` создан.
- `npm test` (175) и `npm run test:memory` (391 + новые adapter-тесты) зелёные.
- `memory_stats_detail` выводит `Каталог данных: ...`.
- Скиллы maestro-new/maestro-assistant консистентны по онбордингу.
- `manual_docs` синхронизированы.
- Версия 3.0.1; коммит + push.
