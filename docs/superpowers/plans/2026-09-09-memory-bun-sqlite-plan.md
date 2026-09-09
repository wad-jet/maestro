# Memory layer под Bun — Implementation Plan (3.0.1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Починить memory layer под opencode runtime (Bun), где `better-sqlite3` не поддерживается, заменив sqlite-драйвер на `node:sqlite` под Bun (с better-sqlite3-совместимым шимом), сохранив better-sqlite3 под Node; плюс диагностика пути данных, консистентность скиллов и docs-sync. Версия 3.0.0 → 3.0.1.

**Architecture:** В `storage/sqlite.js` вводится `loadSqliteDriver(moduleDir, opts)` — селектор драйвера по рантайму: `process.versions.bun` → `node:sqlite` (DatabaseSync), обёрнутый в класс `NodeSqliteDatabase`, повторяющий нужную поверхность better-sqlite3 (`pragma`→`exec`, `transaction`→BEGIN/COMMIT/ROLLBACK, `readOnly`→`readOnly`, `closed`→`!open`); Node → существующий `loadBetterSqlite3`. Остальной код sqlite.js не меняется (единый интерфейс). Добавляется строка `Каталог данных` в `memory_stats_detail`. Правятся скиллы (консистентный онбординг) и docs.

**Tech Stack:** Node.js (ESM), `node:sqlite` (DatabaseSync, Node ≥22.5 / Bun), better-sqlite3 (Node-путь), встроенный Node test runner (`node --test`).

**Spec:** `docs/superpowers/specs/2026-09-09-memory-bun-sqlite-design.md`

---

## File Structure

- Modify: `plugins/maestro-bootstrap/memory/storage/sqlite.js` — driver-loader + шим node:sqlite (объявить и использовать `loadSqliteDriver`).
- Test: `plugins/maestro-bootstrap/memory/storage/sqlite.test.js` — **новый файл** (адаптер/интеграция node:sqlite-пути).
- Modify: `plugins/maestro-bootstrap/memory/index.js` — строка `Каталог данных` в `memory_stats_detail` (~:969-975).
- Modify: `skills/maestro-new/SKILL.md` (§143-170) — permission-правило + ссылка на последовательность.
- Modify: `skills/maestro-assistant/SKILL.md` (секция `memory`) — явная последовательность + терминология.
- Modify: `manual_docs/how-to/enable-memory.md` — runtime-заметка + npm install >5 мин.
- Modify: `manual_docs/reference/memory.md` — упоминания драйвера + каталог данных в статусе.
- Modify: `package.json` — version 3.0.0 → 3.0.1.

---

## Task 1: Драйвер-селектор + шим node:sqlite

**Files:**
- Modify: `plugins/maestro-bootstrap/memory/storage/sqlite.js`
- Test: `plugins/maestro-bootstrap/memory/storage/sqlite.test.js` (создать)

- [ ] **Step 1: Написать падающий тест на node:sqlite-путь**

Создать `plugins/maestro-bootstrap/memory/storage/sqlite.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { SqliteStorage } from "./sqlite.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function mkEntry(session_id, key, title, extra = {}) {
  return {
    session_id, key, origin_project_hash: key, title, summary: "s",
    decisions: [], embedding: new Float32Array([0.1, 0.2, 0.3]),
    model_id: "m", author: "a", time_first: 1, time_last: 2, version: 1,
    ...extra,
  };
}

test("sqlite (node:sqlite driver) full round-trip: init/upsert/search/fts/delete", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mem-ns-"));
  const st = new SqliteStorage({ dbPath: join(dir, "memory.db"), modelId: "m", dim: 3, forceDriver: "node:sqlite" });
  try {
    await st.init();
    await st.upsert([mkEntry("s1", "k1", "hello world"), mkEntry("s2", "k1", "other")]);
    const hits = await st.search(new Float32Array([0.1, 0.2, 0.3]), { top_k: 2, min_score: 0.5, key: "k1" });
    assert.equal(hits.length, 1);
    assert.equal(hits[0].entry.session_id, "s1");
    const fts = await st.search(new Float32Array([0.1, 0.2, 0.3]), { top_k: 2, min_score: 0, key: "k1", query: "hello" });
    assert.ok(fts.some((h) => h.entry.session_id === "s1"), "FTS hit expected");
    const sts = await st.stats({ key: "k1" });
    assert.equal(sts.entries, 2);
    await st.delete("s1");
    const after = await st.stats({ key: "k1" });
    assert.equal(after.entries, 1);
  } finally {
    await st.dispose();
    rmSync(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Запустить тест — убедиться, что падает**

Run: `node --test plugins/maestro-bootstrap/memory/storage/sqlite.test.js`
Expected: FAIL — `SqliteStorage` не принимает `forceDriver`, драйвер всё ещё better-sqlite3 (на Node тест, вероятно, пройдёт на better-sqlite3 — **если пройдёт, намеренно добавить флаг, чтобы тест с `forceDriver:"node:sqlite"` падал**: на Node 24 при несуществующем `forceDriver` код использует better-sqlite3, а не node:sqlite — это и есть «падает относительно требуемого поведения»). Критерий: до реализации тест НЕ использует node:sqlite (нет `forceDriver`-поддержки).

- [ ] **Step 3: Реализовать `loadSqliteDriver` + шим `NodeSqliteDatabase`**

В `plugins/maestro-bootstrap/memory/storage/sqlite.js`:

Заменить сигнатуру/вызовы. Сначала добавить в начало файла:

```js
// Селектор sqlite-драйвера по рантайму:
//  - Bun (opencode runtime): better-sqlite3 не поддерживается (oven-sh/bun#4290)
//    → node:sqlite (DatabaseSync), обёрнутый в better-sqlite3-совместимый шим.
//  - Node: better-sqlite3 как раньше (тесты/dev).
//  - forceDriver (тесты): принудительно выбрать "node:sqlite" | "better-sqlite3".
export async function loadSqliteDriver(moduleDir, { force = null } = {}) {
  if (force === "node:sqlite" || (!force && process.versions.bun)) {
    return makeNodeSqliteDatabase();
  }
  return loadBetterSqlite3(moduleDir);
}

// Шим: better-sqlite3-совместимая поверхность поверх node:sqlite DatabaseSync.
// Ленивый импорт node:sqlite (встроенный модуль; Node ≥22.5, Bun) — чтобы не
// ломать Node <22.5 и не грузить на better-sqlite3-пути.
function requireNodeSqlite() {
  // process.getBuiltinModule доступен в Node ≥22.3 и в Bun (node:sqlite реализован).
  const m = globalThis.process?.getBuiltinModule?.("node:sqlite");
  if (!m?.DatabaseSync) throw new Error("[memory] node:sqlite недоступен: запустите opencode на Bun или Node ≥22.5");
  return m;
}

function makeNodeSqliteDatabase() {
  return class NodeSqliteDatabase {
    constructor(path, opts = {}) {
      const { DatabaseSync } = requireNodeSqlite();
      this._db = new DatabaseSync(path, { readOnly: !!opts.readonly, open: true });
      this._readonly = !!opts.readonly;
    }
    pragma(sql) { this._db.exec(`PRAGMA ${sql}`); }
    exec(sql) { this._db.exec(sql); }
    prepare(sql) { return this._db.prepare(sql); }
    transaction(fn) {
      return (...args) => {
        this._db.exec("BEGIN");
        try {
          const r = fn(...args);
          this._db.exec("COMMIT");
          return r;
        } catch (e) {
          try { this._db.exec("ROLLBACK"); } catch { /* noop */ }
          throw e;
        }
      };
    }
    close() { this._db.close(); }
    // node:sqlite: db.isOpen — boolean; db.open — метод открытия (не путать!).
    get closed() { return !this._db.isOpen; }
  };
}
```

Заменить оба вызова `loadBetterSqlite3(...)` в `_init` (:58) и `_collectKey` (:239) на `loadSqliteDriver(this.moduleDir, { force: this.forceDriver })`, а в конструкторе принять `forceDriver`:

```js
constructor({ dbPath, modelId, dim, moduleDir, log, forceDriver = null }) {
  this.dbPath = dbPath;
  this.modelId = modelId;
  this.dim = dim;
  this.moduleDir = moduleDir;
  this.forceDriver = forceDriver; // тесты: "node:sqlite" | "better-sqlite3"
  this.log = log ?? null;
  this.db = null;
}
```

В `_init`:
```js
const Database = await loadSqliteDriver(this.moduleDir, { force: this.forceDriver });
```
В `_collectKey`:
```js
const Database = await loadSqliteDriver(this.moduleDir, { force: this.forceDriver });
```

- [ ] **Step 4: Запустить тест — убедиться, что проходит**

Run: `node --test plugins/maestro-bootstrap/memory/storage/sqlite.test.js`
Expected: PASS (тест с `forceDriver:"node:sqlite"` использует шим node:sqlite).

- [ ] **Step 5: Проверить, что existing-тесты storage зелёные**

Run: `node --test plugins/maestro-bootstrap/memory/storage.test.js`
Expected: PASS (лучше-sqlite3-путь без изменений; `forceDriver` default null → better-sqlite3).

- [ ] **Step 6: Commit**

```bash
git add plugins/maestro-bootstrap/memory/storage/sqlite.js plugins/maestro-bootstrap/memory/storage/sqlite.test.js
git commit -m "fix(memory): sqlite driver selection (node:sqlite under Bun, better-sqlite3 under Node)"
```

---

## Task 2: Диагностика — `Каталог данных` в memory_stats_detail

**Files:**
- Modify: `plugins/maestro-bootstrap/memory/index.js` (~:969-975)

- [ ] **Step 1: Внести правку**

В `out`-массив (рядом с `Key:`/`Бэкенд:`/`Модель:`/`Записей:`) добавить строку с путём данных. `dataDir` уже в замыкании `registerMemoryHooks` (:393 = `join(defaultDataDir(), "maestro")`).

```js
const out = [
  `Key: ${effectiveKey}`,
  `Бэкенд: ${config.storage.type}`,
  `Модель: ${embeddings.modelId}`,
  `Каталог данных: ${dataDir}`,
  `Записей: ${entries}`,
];
```

- [ ] **Step 2: Проверить существующие тесты**

Run: `npm run test:memory`
Expected: PASS (391 + новые; тест, проверяющий `out`, если есть, — обновить ожидание, добавив строку).

Если в `memory/index.test.js` есть тест, сверяющий содержимое memory_stats_detail, — дополнить ожидание строкой `Каталог данных: <path>`.

- [ ] **Step 3: Commit**

```bash
git add plugins/maestro-bootstrap/memory/index.js
git commit -m "feat(memory): report data dir in memory_stats_detail (@maestro-memory)"
```

---

## Task 3: Скиллы — консистентный онбординг memory

**Files:**
- Modify: `skills/maestro-new/SKILL.md` (§143-170)
- Modify: `skills/maestro-assistant/SKILL.md` (секция `memory`)

- [ ] **Step 1: maestro-new — permission-правило + ссылка**

В `skills/maestro-new/SKILL.md` после строки про минимальный канон (`{ "enabled": true }`, ~:168-170) добавить:

```markdown
При включении памяти в merge-конфиг (`.opencode/opencode.json` или global)
добавить нативные permission для write/boundary-tools (обязательное правило,
канон `maestro-assistant`):
`permission: { memory_forget: "ask", memory_export: "ask", memory_import: "ask" }`
(opencode default для новых тулов — allow, поэтому правило обязательно).

Последовательность включения (канон, см. `manual_docs/how-to/enable-memory.md`):
(1) добавить секцию `memory`, (2) рестарт opencode → self-provision `module_dir`,
(3) `npm install` в `module_dir`, (4) рестарт №2, (5) верификация
(probe-лог / `@maestro-memory` / блок «Контекст из памяти maestro»).
```

- [ ] **Step 2: maestro-assistant — явная последовательность + терминология**

В `skills/maestro-assistant/SKILL.md`, в правиле «После правки `memory`» заменить сжатую формулировку на явную последовательность и убрать устаревшее «память v2» (актуально — branch-aware v3):

```markdown
**Онбординг memory (явная последовательность):** после добавления секции `memory`
в `maestro.json` — (1) рестарт opencode → плагин self-provision'ит `module_dir`
(создаёт каталог + `package.json`); (2) `npm install` в `module_dir`; (3) рестарт
№2 (активация; cached hard-fail → live re-probe при старте); (4) верификация —
probe-лог (`memory: embedder probe OK`, отсутствие `memory: init failed`),
`@maestro-memory`, блок «Контекст из памяти maestro» в system prompt.
Полная инструкция — `manual_docs/how-to/enable-memory.md`.

**Write/boundary-tools → permission `ask` (обязательное правило).** При включении
памяти в merge-config (`.opencode/opencode.json` или global) добавляется нативное
правило `permission: { memory_forget: "ask", memory_export: "ask", memory_import: "ask" }`
(opencode default для новых тулов — allow, поэтому правило обязательно). Канон для
будущих тулов: новые write/boundary-tools → permission `ask`.
```

(В тексте канона заменить «памяти v2» → «памяти» без номера версии, т.к. текущая — v3 branch-aware.)

- [ ] **Step 3: Commit**

```bash
git add skills/maestro-new/SKILL.md skills/maestro-assistant/SKILL.md
git commit -m "docs(skills): consistent memory onboarding (permission rule + step sequence) in maestro-new/maestro-assistant"
```

---

## Task 4: Docs-sync (manual_docs)

**Files:**
- Modify: `manual_docs/how-to/enable-memory.md`
- Modify: `manual_docs/reference/memory.md`

- [ ] **Step 1: enable-memory.md — runtime-заметка + npm install таймаут**

В `manual_docs/how-to/enable-memory.md`:
1. В шаге 3 (npm install) добавить блок-предупреждение про длительность:
```markdown
> **Время установки:** при первой установке `npm install` может занять больше
> 5 минут (тяжёлые нативные deps: `better-sqlite3`, `@huggingface/transformers`).
> Если процесс оборвался по таймауту — просто повторите команду (npm-кэш ускоряет
> повторный запуск).
```
2. Добавить runtime-заметку (в конце краткой инструкции, после шага 4 / блока проверки):
```markdown
> **Рантайм:** opencode исполняет плагины под Bun, где нативный `better-sqlite3`
> не поддерживается. Под Bun sqlite-бэкенд автоматически использует встроенный
> `node:sqlite` (DatabaseSync) — отдельная установка не требуется. Под Node.js
> (dev/тесты) по-прежнему используется `better-sqlite3`.
```

- [ ] **Step 2: reference/memory.md — драйвер + каталог в статусе**

В `manual_docs/reference/memory.md`:
1. В строке про `sqlite` бэкенд (~:149, «better-sqlite3, per-key файл ...») уточнить:
   драйвер выбирается рантаймом: Bun → `node:sqlite`, Node → `better-sqlite3`.
2. В раздел про `@maestro-memory` / memory_stats_detail добавить: вывод включает
   `Каталог данных: <path>` (резолвнутый `<data-dir>/maestro`).

- [ ] **Step 3: Commit**

```bash
git add manual_docs/how-to/enable-memory.md manual_docs/reference/memory.md
git commit -m "docs: memory runtime note (Bun/node:sqlite), npm install timeout, data dir in status"
```

---

## Task 5: Версия 3.0.1

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Правка версии**

В `package.json` изменить `"version": "3.0.0"` → `"version": "3.0.1"`.

- [ ] **Step 2: Полный прогон тестов**

Run: `node --test plugins/maestro-bootstrap/index.test.js` → Expected: 175 pass.
Run: `npm run test:memory` → Expected: 391 + новые adapter pass.

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "chore: bump version to 3.0.1"
```

---

## Self-Review

**Spec coverage:**
- §3.1 драйвер → Task 1 ✅
- §3.2 каталог данных в статусе → Task 2 ✅
- §3.3 скиллы → Task 3 ✅
- §3.4 docs-sync → Task 4 ✅
- §6 DoD версия 3.0.1 → Task 5 ✅
- Non-goals (qdrant/pgvector, schema, npm audit) — не трогаем ✅

**Placeholder scan:** кода нет в каждом шаге, где нужно; команды с ожидаемым выводом указаны. ✅

**Type consistency:** `loadSqliteDriver(moduleDir, { force })` возвращает класс-конструктор; `SqliteStorage` принимает `forceDriver`; `createStorage`/вызовы через `loadSqliteDriver(this.moduleDir, { force: this.forceDriver })` — согласованы. `NodeSqliteDatabase` повторяет поверхность better-sqlite3 (pragma/exec/prepare/transaction/close/closed); `closed` = `!isOpen` (проверено на Node 24: `isOpen` boolean, `open` — метод). ✅

---

## Execution Handoff

План сохранён в `docs/superpowers/plans/2026-09-09-memory-bun-sqlite-plan.md`. Два варианта исполнения:
1. **Subagent-Driven (рекомендуется)** — свежий субагент на задачу + ревью между задачами.
2. **Inline Execution** — задачи в текущей сессии с чекпоинтами.
