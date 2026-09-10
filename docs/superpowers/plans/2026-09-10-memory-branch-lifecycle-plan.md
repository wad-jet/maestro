# Branch-Governed Lifecycle для Memory Layer (v5) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Жизненный цикл записей памяти переводится с opencode-сессии на git-якорь (head/ветка): сессия удалена → запись выживает (флаг `delete_on_session_delete`, default off), write-gate по head, поле `host`, HITL-команда `/maestro-memory-prune`. Версия 3.1.0 → 3.2.0.

**Architecture:** Драйвер lifecycle — `head` (commit sha), не `session_id`. Индексер: резолв якоря до summarize (write-gate), sticky-кэш не хранит пустой резолв, head-preserve. `onSessionDeleted` чистит runtime-состояние всегда, storage.delete — только при флаге (tombstone + post-upsert recheck против race). Новый tool `memory_prune` (permission ask): fetch --prune → листинг по категориям надёжности якоря (remote-merged/remote-alive/local-only/dead/unknown) → HITL → удаление строго по явному снапшоту session_ids/heads после host-guard. Поле `host` (hostname) добавляется во все бэкенды (guard-ALTER, beta: без сложных миграций).

**Tech Stack:** Node.js (ESM), better-sqlite3/node:sqlite, qdrant, pgvector, git (spawnSync), OpenCode plugin tools, node --test.

**Spec:** `docs/superpowers/specs/2026-09-10-memory-branch-lifecycle-design.md` (см. §3-§9; задачи ссылаются на секции, не переписывают требования).

**Команды:** тесты `node --test plugins/maestro-bootstrap/index.test.js` (index+core) и `npm run test:memory` (memory-модуль). Конкретные файлы тестов запускаются точечно.

**Контекст (session/машина):** host = `os.hostname()`. Git-множества: локальные = `rev-list --branches`, remote = `rev-list --remotes`; теги исключены.

---

## File Structure

| Файл | Роль | Тип |
|---|---|---|
| `plugins/maestro-bootstrap/memory/config.js` | `delete_on_session_delete` в DEFAULTS + валидатор + classify | Modify |
| `plugins/maestro-bootstrap/memory/config.test.js` | тесты флага | Modify |
| `plugins/maestro-bootstrap/memory/state.js` | метод `delete(id)` | Modify |
| `plugins/maestro-bootstrap/memory/state.test.js` | тест `delete` | Modify |
| `plugins/maestro-bootstrap/memory/storage/sqlite.js` | колонка `host` + SCAN_FIELDS + upsert/get/scan/export | Modify |
| `plugins/maestro-bootstrap/memory/storage/pgvector.js` | колонка `host` | Modify |
| `plugins/maestro-bootstrap/memory/storage/qdrant.js` | payload `host` | Modify |
| `plugins/maestro-bootstrap/memory/storage.test.js` | тесты host round-trip | Modify |
| `plugins/maestro-bootstrap/memory/indexer.js` | write-gate, sticky-фикс, head-preserve, host, onSessionDeleted rework, tombstone, audit | Modify |
| `plugins/maestro-bootstrap/memory/indexer.test.js` | тесты indexer | Modify |
| `plugins/maestro-bootstrap/memory/git.js` | `revListAll(root, {local,remote})` | Modify |
| `plugins/maestro-bootstrap/memory/git.test.js` | тесты revListAll | Modify |
| `plugins/maestro-bootstrap/memory/index.js` | tool `memory_prune`, init-warn, export/import host | Modify |
| `plugins/maestro-bootstrap/memory/index.test.js` | тесты tool/prune/export-import | Modify |
| `commands/maestro-memory-prune.md` | slash-команда | Create |
| `manual_docs/...` , `AGENTS.md`, `README.md`, `SECURITY.md`, `skills/*`, `package.json`, `docs/project-context.md`, `regression/entries/...` | docs + версия | Modify |

---

### Task 1: Конфиг-флаг `delete_on_session_delete`

**Files:**
- Modify: `plugins/maestro-bootstrap/memory/config.js`
- Test: `plugins/maestro-bootstrap/memory/config.test.js`

- [ ] **Step 1: Добавить флаг в DEFAULTS**

В `config.js` в объект `DEFAULTS` (после `retention_days: null`):
```js
  delete_on_session_delete: false,
```

- [ ] **Step 2: Валидатор + classify**

Добавить функцию рядом с `branchContextValid` (config.js):
```js
/**
 * delete_on_session_delete: null (default false) или boolean; иначе → invalid
 * (memory disabled). Shared by classifyMemoryConfig and loadMemoryConfig.
 */
function deleteOnSessionDeleteValid(m) {
  if (m?.delete_on_session_delete == null) return true;
  return typeof m.delete_on_session_delete === "boolean";
}
```
В `classifyMemoryConfig` после `if (!branchContextValid(m)) ...` добавить:
```js
  if (!deleteOnSessionDeleteValid(m)) return { enabled: false, disabled_reason: "delete_on_session_delete_invalid" };
```

- [ ] **Step 3: Тесты**

В `config.test.js` добавить:
```js
test("delete_on_session_delete default false", () => {
  const cfg = loadMemoryConfig({ memory: { enabled: true } });
  assert.equal(cfg.delete_on_session_delete, false);
});
test("delete_on_session_delete from config", () => {
  const cfg = loadMemoryConfig({ memory: { enabled: true, delete_on_session_delete: true } });
  assert.equal(cfg.delete_on_session_delete, true);
});
test("delete_on_session_delete invalid disables", () => {
  assert.equal(classifyMemoryConfig({ memory: { enabled: true, delete_on_session_delete: "yes" } }).disabled_reason, "delete_on_session_delete_invalid");
});
```

- [ ] **Step 4: Run tests**

Run: `node --test plugins/maestro-bootstrap/memory/config.test.js`
Expected: PASS (новые 3 + старые).

- [ ] **Step 5: Commit**

```bash
git add plugins/maestro-bootstrap/memory/config.js plugins/maestro-bootstrap/memory/config.test.js
git commit -m "feat(memory): delete_on_session_delete config flag (default false)"
```

---

### Task 2: state.js — метод `delete(id)`

**Files:**
- Modify: `plugins/maestro-bootstrap/memory/state.js`
- Test: `plugins/maestro-bootstrap/memory/state.test.js`

- [ ] **Step 1: Failing test**

В `state.test.js` добавить:
```js
test("delete removes session row", async () => {
  const s = createState(join(tmpdir(), `state-${Date.now()}.json`));
  await s.setSummarized("s1");
  assert.equal(await s.getLastSummarized("s1"), null, "setSummarized stores ts");
  // Прямой вызов delete
  await s.delete("s1");
  assert.equal(await s.getLastSummarized("s1"), null);
});
```
(если такого теста/файла нет — создать `plugins/maestro-bootstrap/memory/state.test.js` с импортом `createState`, `mkdirSync`/`join`/`tmpdir` по образцу других тестов модуля).

- [ ] **Step 2: Run to verify fail**

Run: `node --test plugins/maestro-bootstrap/memory/state.test.js`
Expected: FAIL — `s.delete is not a function`.

- [ ] **Step 3: Implement**

В `state.js` в возвращаемый объект добавить метод:
```js
    async delete(id) {
      delete data.sessions[id];
      persist();
    },
```

- [ ] **Step 4: Run to verify pass**

Run: `node --test plugins/maestro-bootstrap/memory/state.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plugins/maestro-bootstrap/memory/state.js plugins/maestro-bootstrap/memory/state.test.js
git commit -m "feat(memory): state.delete(id) for session cleanup"
```

---

### Task 3: Storage — поле `host` (3 бэкенда)

**Files:**
- Modify: `plugins/maestro-bootstrap/memory/storage/sqlite.js`
- Modify: `plugins/maestro-bootstrap/memory/storage/pgvector.js`
- Modify: `plugins/maestro-bootstrap/memory/storage/qdrant.js`
- Test: `plugins/maestro-bootstrap/memory/storage.test.js`

- [ ] **Step 1: sqlite — колонка + SCAN_FIELDS + upsert**

В `sqlite.js`:
- `SCAN_FIELDS` (строки 117-121) добавить `"host"`:
```js
const SCAN_FIELDS = [
  "session_id", "key", "origin_project_hash", "title", "summary", "decisions",
  "author", "time_first", "time_last", "version", "model_id", "embedding",
  "branch", "head", "merged", "host",
];
```
- В `_init` в `CREATE TABLE IF NOT EXISTS` (после `merged INTEGER NOT NULL DEFAULT 0`) добавить строку:
```js
        host TEXT NOT NULL DEFAULT '',
```
- После guard-ALTER для `merged` (строка 192) добавить:
```js
      if (!cols.includes("host")) db.exec("ALTER TABLE memory ADD COLUMN host TEXT NOT NULL DEFAULT ''");
```
- В `_upsert` (строки 257-259) добавить `host` в колонки и VALUES:
```js
    const ins = this.db.prepare(`INSERT OR REPLACE INTO memory
      (session_id, key, origin_project_hash, title, summary, decisions, embedding, model_id, author, time_first, time_last, version, branch, head, merged, host)
      VALUES (@session_id, @key, @origin_project_hash, @title, @summary, @decisions, @embedding, @model_id, @author, @time_first, @time_last, @version, @branch, @head, @merged, @host)`);
```
- В `ins.run({...})` (после `merged: e.merged ?? 0`) добавить:
```js
          host: e.host ?? "",
```
- В `_get` (SELECT с полями) добавить `host` в список колонок и в возвращаемый объект (проверить текущую форму; `host: row.host ?? ""`).

- [ ] **Step 2: pgvector**

В `pgvector.js`:
- Таблица (строка ~36): `session_id TEXT PRIMARY KEY` рядом добавить в список колонок `host` (схема: `host TEXT NOT NULL DEFAULT ''`).
- `INSERT ... ON CONFLICT` (строки 128-131): добавить `host` в колонки и в `SET host=$N`.
- SELECT-списки (get/scan/search — строки 202, 297, 313): добавить `host`.
- Признать: `ALTER TABLE ADD COLUMN IF NOT EXISTS host TEXT NOT NULL DEFAULT ''` в init (или guard по `information_schema`) — по существующему паттерну миграций pgvector.

- [ ] **Step 3: qdrant**

В `qdrant.js`:
- В `upsert` payload (строка ~113): добавить `host: e.host ?? ""`.
- В `get`/`scan`/`search` чтении payload: добавить `host: p.payload.host ?? ""` в формируемый entry.

- [ ] **Step 4: Тест round-trip**

В `storage.test.js` добавить тест (по образцу существующих sqlite round-trip тестов; утилиты `mkEntry` — если есть — дополнить `host: "h1"`):
```js
test("host round-trips through sqlite upsert/get", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mem-host-"));
  const st = await createSqlite({ dbPath: join(dir, "m.db"), modelId: "x", dim: 3, moduleDir: null, forceDriver: "better-sqlite3" });
  await st.init();
  const e = mkEntry("s1", "k", "t", { host: "macbook-01" });
  await st.upsert([{ ...e, embedding: new Float32Array([0.1, 0.2, 0.3]), model_id: "x" }]);
  const got = await st.get("s1");
  assert.equal(got.host, "macbook-01");
  await st.dispose();
  rmSync(dir, { recursive: true, force: true });
});
```
(`createSqlite`/`mkEntry` — по фактическим именам тестового модуля; при расхождении адаптировать.)

- [ ] **Step 5: Run tests**

Run: `node --test plugins/maestro-bootstrap/memory/storage.test.js`
Expected: PASS (новый + существующие; старые записи без host получают `''`).

- [ ] **Step 6: Commit**

```bash
git add plugins/maestro-bootstrap/memory/storage/
git commit -m "feat(memory): host provenance field across sqlite/pgvector/qdrant"
```

---

### Task 4: Indexer — write-gate, sticky-фикс, head-preserve, host

**Files:**
- Modify: `plugins/maestro-bootstrap/memory/indexer.js`
- Test: `plugins/maestro-bootstrap/memory/indexer.test.js`

- [ ] **Step 1: Failing tests**

В `indexer.test.js` добавить (по образцу существующих тестов indexer — `mkIndexer`, mock client, mock embeddings):
```js
test("write-gate: no head → no summarize call, no record, no state mark", async () => {
  let summarized = 0;
  const idx = mkIndexer({
    client: mkClient({ session: "s1", messages: [{ time_created: 1, parts: [{ type: "text", text: "hello" }] }] }),
    git: { resolveBranch: async () => "", resolveHead: async () => "" },
    summarize: async () => { summarized++; return { title: "T", summary: "S", decisions: [] }; },
  });
  await idx._run("s1");
  assert.equal(summarized, 0, "summarize must not run without head");
  assert.equal(await idx.storage.get("s1"), undefined, "no record written");
});
test("head-preserve: failed re-resolve does not wipe existing head", async () => {
  const idx = mkIndexer({
    client: mkClient({ session: "s1", messages: [...] }),
    git: { resolveBranch: async () => "feature/x", resolveHead: async () => "aaaa".repeat(10) },
    summarize: async () => ({ title: "T", summary: "S", decisions: [] }),
  });
  await idx._run("s1"); // первый прогон с head
  // Второй прогон: резолв упал (пустой)
  idx.git.resolveHead = async () => "";
  await idx.storage.setSummarized?.("s1"); // эмуляция следующего idle
  await idx._run("s1");
  const e = await idx.storage.get("s1");
  assert.equal(e.head, "aaaa".repeat(10), "existing head preserved");
});
```
(Адаптировать под реальные сигнатуры mocks в тестовом файле — `mkClient`, `mkIndexer`, `state`.)

- [ ] **Step 2: Run to verify fail**

Run: `node --test plugins/maestro-bootstrap/memory/indexer.test.js`
Expected: FAIL — сейчас summarize вызывается, head затирается.

- [ ] **Step 3: Implement — резолв до summarize + write-gate**

В `indexer.js` `_run`, **внутри `work()`**, переместить резолв якоря в начало (до `this.summarize`). Сейчас резолв на строках 231-232 (после summarize). Новая структура:
```js
        // Write-gate (spec §3.3): резолв якоря ДО summarize. head==='' → abort.
        const { branch, head } = await this._resolveBranchContext(sessionID);
        // Head-preserve: уже заякоренная запись не затирается пустым резолвом.
        const existing = await this.storage.get(sessionID);
        const effHead = head || existing?.head || "";
        if (!effHead) {
          this.logDebug?.("memory:index_unattributed", { sessionID });
          return;
        }
        const effBranch = branch || existing?.branch || "";
        const summarizeStart = Date.now();
        const { title, summary, decisions } = await this.summarize({ ... });
        // ... (далее по коду, заменить branch/head на effBranch/effHead; убрать
        // повторный вызов _resolveBranchContext и storage.get ниже)
```
Требуется: `existing` переиспользовать для `version` (строка 261) и merged-fast-path (строки 267-271) — убрать дублирующий `storage.get`.

- [ ] **Step 4: Sticky-фикс**

В `_resolveBranchContext` (строки 60-79): не кэшировать пустой head:
```js
    const ctx = { branch, head };
    // Sticky-фикс (spec §3.3): пустой резолв НЕ кэшируется — re-resolve при
    // следующем вызове (транзиентный сбой самоизлечивается).
    if (head) {
      this._branchContext.set(sessionID, ctx);
      // M-7: bound — FIFO-эвикция ...
    }
    return ctx;
```
(Сохранить FIFO-эвикцию.)

- [ ] **Step 5: host в entry**

В построении `entry` (строка 235) добавить поле:
```js
          host: os.hostname(),
```
и добавить `import { hostname } from "node:os";` в начало файла (или `os.hostname()` — по конвенции файла).

- [ ] **Step 6: Run tests**

Run: `node --test plugins/maestro-bootstrap/memory/indexer.test.js`
Expected: PASS (новые + существующие; проверить, что существующий тест «indexer deletes on session deleted» ещё актуален до Task 5).

- [ ] **Step 7: Commit**

```bash
git add plugins/maestro-bootstrap/memory/indexer.js plugins/maestro-bootstrap/memory/indexer.test.js
git commit -m "feat(memory): write-gate by head, sticky-cache fix, head-preserve, host field"
```

---

### Task 5: Indexer — onSessionDeleted rework (флаг, cleanup, tombstone, audit)

**Files:**
- Modify: `plugins/maestro-bootstrap/memory/indexer.js`
- Test: `plugins/maestro-bootstrap/memory/indexer.test.js` + `plugins/maestro-bootstrap/memory/index.test.js`

- [ ] **Step 1: Failing tests**

В `indexer.test.js` обновить/добавить:
```js
test("onSessionDeleted with flag off (default): record survives, runtime cleared", async () => {
  const idx = mkIndexer({ config: { delete_on_session_delete: false }, state: mkState() });
  await idx.storage.upsert([mkEntryWithHead("s1")]);
  await idx.onSessionDeleted({ sessionID: "s1" });
  assert.ok(await idx.storage.get("s1"), "record must survive by default");
  assert.equal(idx.timers.has("s1"), false, "timer cleared");
  assert.equal(idx._branchContext.has("s1"), false, "sticky cleared");
});
test("onSessionDeleted with flag on: record deleted, audit on success only", async () => {
  let logged = [];
  const idx = mkIndexer({ config: { delete_on_session_delete: true }, logInfo: (m) => logged.push(m) });
  await idx.storage.upsert([mkEntryWithHead("s1")]);
  await idx.onSessionDeleted({ sessionID: "s1" });
  assert.equal(await idx.storage.get("s1"), undefined, "record deleted when flag on");
  assert.ok(logged.includes("memory:session_deleted"));
});
test("onSessionDeleted queue cleanup", async () => {
  const idx = mkIndexer({ config: {} });
  idx.queue.add("s1");
  await idx.onSessionDeleted({ sessionID: "s1" });
  assert.equal(idx.queue.has("s1"), false, "queued session removed");
});
test("session_closed logged when record survives (flag off)", async () => {
  let logged = [];
  const idx = mkIndexer({ config: { delete_on_session_delete: false }, logInfo: (m) => logged.push(m) });
  await idx.onSessionDeleted({ sessionID: "s1" });
  assert.ok(logged.includes("memory:session_closed"));
});
```
В `index.test.js` — обновить пиновый тест «session.deleted must remove the memory entry» (строки 180-201): дефолт теперь выживает:
```js
test("event dispatches session.deleted → record survives by default", async () => {
  // ... (запись "victim")
  await hooks.event({ event: { type: "session.deleted", properties: { sessionID: "victim" } } });
  const row = db2.prepare("SELECT * FROM memory WHERE session_id = ?").get("victim");
  assert.ok(row, "session.deleted must NOT remove the memory entry by default");
});
```

- [ ] **Step 2: Run to verify fail**

Run: `node --test plugins/maestro-bootstrap/memory/indexer.test.js plugins/maestro-bootstrap/memory/index.test.js`
Expected: FAIL (старое поведение).

- [ ] **Step 3: Implement**

В `indexer.js`:
- В constructor добавить `this._tombstones = new Set();`
- `onSessionDeleted` — новая версия:
```js
  async onSessionDeleted({ sessionID }) {
    // Runtime-очистка ВСЕГДА (spec §3.2): таймер, очередь, sticky, state.
    const t = this.timers.get(sessionID);
    if (t) { clearTimeout(t); this.timers.delete(sessionID); }
    this.queue.delete(sessionID);
    this._branchContext.delete(sessionID);
    try { await this.state.delete?.(sessionID); } catch {}
    // Race-guard (spec §5): tombstone для режима флага — post-upsert recheck.
    if (this.config.delete_on_session_delete) {
      this._tombstones.add(sessionID);
      try {
        await this.storage.delete(sessionID);
        this.logInfo?.("memory:session_deleted", { sessionID });
      } catch {
        // Audit-integrity: событие только по факту успеха (spec §5).
        this.logError?.("memory:session_delete_failed", { sessionID });
      }
    } else {
      this.logInfo?.("memory:session_closed", { sessionID });
    }
  }
```
- В `_run`, внутри `work()`, перед `upsert` добавить tombstone-проверку, и после upsert — post-upsert recheck:
```js
        // Tombstone race-guard (spec §5): удаление сессии во время in-flight summarize.
        if (this._tombstones.has(sessionID)) return;
        await this.storage.upsert([maskedEntry]);
        if (this._tombstones.has(sessionID)) {
          try { await this.storage.delete(sessionID); } catch {}
          this._tombstones.delete(sessionID);
          return;
        }
```
- В `dispose()` добавить `this._tombstones.clear();`
- В `_run` (строка 316-317) — уже чистит таймер после работы; без изменений.

- [ ] **Step 4: Run tests**

Run: `node --test plugins/maestro-bootstrap/memory/indexer.test.js plugins/maestro-bootstrap/memory/index.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plugins/maestro-bootstrap/memory/indexer.js plugins/maestro-bootstrap/memory/indexer.test.js plugins/maestro-bootstrap/memory/index.test.js
git commit -m "feat(memory): session.deleted keeps record by default; flag-driven delete + tombstone + audit"
```

---

### Task 6: git.js — множества достижимости local/remote

**Files:**
- Modify: `plugins/maestro-bootstrap/memory/git.js`
- Test: `plugins/maestro-bootstrap/memory/git.test.js`

- [ ] **Step 1: Failing test**

В `git.test.js`:
```js
test("revListAll local/remote sets", () => {
  const root = mkGitRepo(); // helper: инициализирует репо, коммит, ветку, remote-tracking
  const local = revListAll(root, { local: true });
  const remote = revListAll(root, { remote: true });
  assert.ok(local instanceof Set);
  assert.ok(remote instanceof Set);
});
```

- [ ] **Step 2: Run to verify fail**

Run: `node --test plugins/maestro-bootstrap/memory/git.test.js`
Expected: FAIL — `revListAll is not defined`.

- [ ] **Step 3: Implement**

В `git.js` после `revList`:
```js
/**
 * Множества достижимости из групп refs (spec §3.6 prune-категорий).
 * local: `git rev-list --branches` (refs/heads/*); remote: `git rev-list --remotes`
 * (refs/remotes/*). Теги исключены. Fail-soft: ошибка → null.
 * @param {string} root
 * @param {{ local?: boolean, remote?: boolean }} [opts]
 * @returns {{ local: Set<string>|null, remote: Set<string>|null }}
 */
export function revListAll(root, { local = false, remote = false } = {}) {
  const out = { local: null, remote: null };
  if (local) out.local = revList(root, "--branches");
  if (remote) out.remote = revList(root, "--remotes");
  return out;
}
```
(`revList("--branches")` — git-аргумент как есть.)

- [ ] **Step 4: Run to verify pass**

Run: `node --test plugins/maestro-bootstrap/memory/git.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plugins/maestro-bootstrap/memory/git.js plugins/maestro-bootstrap/memory/git.test.js
git commit -m "feat(memory): revListAll local/remote reachability sets"
```

---

### Task 7: index.js — tool `memory_prune` + init-warn + export/import host

**Files:**
- Modify: `plugins/maestro-bootstrap/memory/index.js`
- Test: `plugins/maestro-bootstrap/memory/index.test.js`

- [ ] **Step 1: Failing tests**

В `index.test.js`:
```js
test("memory_prune list categories (dead + unknown candidates)", async () => {
  // mock storage.candidates/scan, git revListAll/detectMainline/revList
  const out = await tools.memory_prune.execute({ action: "list" }, { sessionID: "s1" });
  assert.match(out, /dead|unknown/);
});
test("memory_prune delete executes only by explicit ids (no raw category)", async () => {
  let deleteCalls = [];
  // mock storage.deleteByFilter записывает аргументы
  await tools.memory_prune.execute({ action: "delete", session_ids: ["s1", "s2"] }, { sessionID: "s1" });
  assert.deepEqual(deleteCalls, [["s1"], ["s2"]]);
});
test("init-warn when delete_on_session_delete true + centralized", async () => {
  // registerMemoryHooks с config.storage.type qdrant + flag true → logWarn
  // содержит memory:delete_on_session_delete_centralized
});
```
(Зарегистрировать tools через `registerMemoryHooks` с mocks, как в существующих тестах tools.)

- [ ] **Step 2: Run to verify fail**

Run: `node --test plugins/maestro-bootstrap/memory/index.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement — init-warn**

В init (рядом с существующими warn-эмиссиями, например `unmasked_branch_metadata`):
```js
    if (config.delete_on_session_delete && (config.storage?.type === "qdrant" || config.storage?.type === "pgvector")) {
      logWarn("memory:delete_on_session_delete_centralized", {});
    }
```

- [ ] **Step 4: Implement — tool `memory_prune`**

Добавить tool после `memory_forget` (схема args как у других tools):
```js
      memory_prune: tool({
        description:
          "HITL-утилизация брошенных/unknown записей памяти: листинг по категориям надёжности git-якоря и удаление строго по явному набору session_ids/heads (permission: ask).",
        args: {
          action: tool.schema.string().describe("list | delete"),
          session_ids: tool.schema.array(tool.schema.string()).optional().describe("явный список session_id для удаления"),
          heads: tool.schema.array(tool.schema.string()).optional().describe("явный список head для удаления (резолвится в записи)"),
          category: tool.schema.string().optional().describe("для delete: dead | unknown (резолвится tool-слоем в явный набор после host-guard)"),
        },
        execute: async (args, ctx) => {
          try {
            if (SESSIONS.has(ctx?.sessionID)) return "memory_prune недоступен для служебных сессий.";
            if (!args?.action) return "memory_prune: укажите action (list | delete)";
            const host = hostname();
            const sets = revListAll(root, { local: true, remote: true });
            const mainline = detectMainline(root, { override: config.mainline ?? null });
            const mainlineSet = mainline ? revList(root, mainline.name) : new Set();
            const candidates = await storage.scan({ key: effectiveKey, fields: ["session_id", "branch", "head", "host", "author", "time_last"] });
            // Категоризация (spec §3.6)
            const classify = (c) => {
              const head = c.head ?? "";
              if (!head) return "unknown";
              if (sets.remote && mainlineSet.has(head)) return "remote-merged";
              if (sets.remote?.has(head)) return "remote-alive";
              if (sets.local?.has(head)) return "local-only";
              return "dead";
            };
            const central = config.storage?.type === "qdrant" || config.storage?.type === "pgvector";
            if (args.action === "list") {
              const lines = [`Git-якорь по состоянию refs на ${host} (mainline: ${mainline?.name ?? "не определён"})`];
              const grouped = {};
              for (const c of candidates) {
                const cat = classify(c);
                (grouped[cat] ??= []).push(c);
              }
              for (const cat of ["remote-merged", "remote-alive", "local-only", "dead", "unknown"]) {
                const g = grouped[cat] ?? [];
                if (!g.length) continue;
                lines.push(`## ${cat} (${g.length})`);
                for (const c of g) {
                  const foreign = central && c.host && c.host !== host ? " ⚠️ чужой хост" : "";
                  lines.push(`- ${c.session_id} | head=${c.head || "(нет)"} | ветка=${c.branch || "-"} | host=${c.host || "?"} | автор=${c.author} | ${c.time_last}${foreign}`);
                }
              }
              lines.push("Предупреждение: head-недостижимость ≠ ветка не влита — squash-merge/rebase/cherry-pick тоже дают недостижимость.");
              lines.push("dead/unknown — кандидаты; foreign-host записи исключены из batch-all (см. — выбор по явным session_ids/heads).");
              return lines.join("\n");
            }
            // delete: резолв в явный набор ПОСЛЕ host-guard (spec §3.6 шаг 4)
            let ids = [...(args.session_ids ?? [])];
            for (const h of args.heads ?? []) {
              ids.push(...candidates.filter((c) => c.head === h).map((c) => c.session_id));
            }
            if (args.category) {
              const cand = candidates.filter((c) => classify(c) === args.category);
              const allowed = central ? cand.filter((c) => !c.host || c.host === host) : cand;
              ids.push(...allowed.map((c) => c.session_id));
            }
            if (!ids.length) return "memory_prune: ничего не выбрано для удаления.";
            const snapshot = [...new Set(ids)];
            const deleted = [];
            for (const sid of snapshot) {
              const n = await storage.deleteByFilter({ key: effectiveKey, session_id: sid });
              deleted.push(n);
            }
            const total = deleted.reduce((a, b) => a + b, 0);
            logInfo("memory:pruned", { count: total, records: snapshot.length });
            return `Удалено ${total} записей (${snapshot.length} session_id).`;
          } catch (err) {
            return `memory_prune failed: ${err instanceof Error ? err.message : String(err)}`;
          }
        },
      }),
```
Импорты: `hostname` из `node:os`, `revListAll` из `./git.js` (в деструктуризации `deps.git ?? {}` — сейчас `revList` уже из git.js; `revListAll` добавить туда же).

- [ ] **Step 5: export/import host (optional-поле)**

В `index.js`:
- В `memory_export` tool, `fields` список добавить `"host"` (после `merged`).
- В `IMPORT_REQUIRED` НЕ добавлять host (optional). В `validateImportEntry` — не требуется проверка. `maskEntry` прокидывает host (spread). В `memory_import` re-mask сохранит host как есть.

- [ ] **Step 6: Run tests**

Run: `node --test plugins/maestro-bootstrap/memory/index.test.js`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add plugins/maestro-bootstrap/memory/index.js plugins/maestro-bootstrap/memory/index.test.js
git commit -m "feat(memory): memory_prune tool (HITL) + init-warn flag+centralized + host in export"
```

---

### Task 8: команда `/maestro-memory-prune`

**Files:**
- Create: `commands/maestro-memory-prune.md`

- [ ] **Step 1: Создать команду** (фронтматтер по образцу `commands/maestro-memory.md`):

```markdown
---
description: HITL-утилизация брошенных/unknown записей памяти maestro (листинг → подтверждение → удаление)
---

# @maestro-memory-prune

Покажи кандидатов на удаление в **memory layer** и удали их с HITL-подтверждением.

**Язык:** все сообщения пользователю — только на русском.

## Шаг 1. Доступность

1. Вызови инструмент `memory_prune` с `action: "list"`.
2. Если инструмент недоступен / память выключена → покажи причину (см. `@maestro-memory`).

## Шаг 2. Листинг

Покажи категории (remote-merged/remote-alive — не кандидаты; local-only — живая, с host;
dead — кандидат; unknown — кандидат 1-го класса). Укажи `git fetch --prune` (выполнить с
согласия пользователя, затем повторить list — листинг честен по свежести fetch).
Покажи squash/rebase-предупреждение.

## Шаг 3. HITL-подтверждение

Спроси: удалить выборочно (session_ids/heads) или категорией (dead/unknown). На
централизованных бэкендах foreign-host записи исключены из batch-all.
Никогда не удаляй без явного подтверждения пользователем (permission: ask).

## Шаг 4. Удаление

Вызови `memory_prune` с `action: "delete"` и явным набором. Покажи результат.
```

- [ ] **Step 2: Проверить доступность через @maestro-memory pattern** (как другие команды).

- [ ] **Step 3: Commit**

```bash
git add commands/maestro-memory-prune.md
git commit -m "feat(commands): /maestro-memory-prune HITL command"
```

---

### Task 9: Docs sync + версия 3.2.0

**Files:** (все — Modify; см. spec §6)

- [ ] **Step 1: package.json + README.md + docs/project-context.md**

`package.json` `"version": "3.1.0"` → `"3.2.0"`. Синхронно обновить упоминание `3.1.0` в `README.md` и `docs/project-context.md` (строка «Текущая версия дистрибутива» + §3.4 memory-описание: добавить v5 branch-governed lifecycle).

- [ ] **Step 2: changelog**

`manual_docs/overview/changelog.md` — запись `## [2026-09-10]` (сверху, Keep-a-Changelog) — секции «Изменено» с подсветкой breaking-changes:
1. `session.deleted` больше не удаляет запись по умолчанию (флаг `delete_on_session_delete`; privacy-сценарии v1 — включать флагом; флаг рекомендуется только для sqlite);
2. non-git проекты не получают память (write-gate по head);
3. write-gate: сессии без git-якоря не суммаризируются;
4. новый `/maestro-memory-prune` (HITL), поле `host`;
5. «для существующих сетапов добавьте `memory_prune: "ask"` в `permission`»;
6. memory layer — v5 (branch-governed lifecycle), beta без обратной совместимости.

- [ ] **Step 3: manual_docs/reference/memory.md**

- Callout вверху секции жизненного цикла: «**Изменение жизненного цикла (3.2.0)** — запись выживает при удалении сессии; lifecycle по git-якорю; см. changelog».
- §«Удаление сессии»: переписать — запись выживает, runtime-очистка всегда, флаг `delete_on_session_delete`.
- Секция идентичности записи: «идентичность (matching/промоция) — по `head`; ключ хранения — `session_id`; жизненный цикл — по ветке/HEAD».
- Новая секция «Утилизация (`/maestro-memory-prune`)»: категории, host-guard, squash-предупреждение, permission `ask`.

- [ ] **Step 4: manual_docs/how-to/enable-memory.md**

- Предупреждение: «non-git проекты не получают память (write-gate по head)»;
- permission-сниппет: добавить `memory_prune: "ask"`.

- [ ] **Step 5: manual_docs/reference/config.md**

- Ключ `delete_on_session_delete` (default false, boolean; рекомендация «только sqlite»);
- permission-сниппет: `memory_prune: "ask"`.

- [ ] **Step 6: manual_docs/reference/commands.md**

- Строка `@maestro-memory-prune`.

- [ ] **Step 7: manual_docs/explanation/agents-and-trust.md**

- Канон «write/boundary-tools → permission `ask`»: добавить `memory_prune`.

- [ ] **Step 8: AGENTS.md + plugins/maestro-bootstrap/README.md + SECURITY.md**

- `AGENTS.md`: уточнить memory-описание — «идентичность записи по head (matching/промоция); ключ хранения — session_id; жизненный цикл — по git-ветке; `delete_on_session_delete` (default off); `/maestro-memory-prune`».
- `plugins/maestro-bootstrap/README.md`: те же ключевые пункты + hooks-список без изменений.
- `SECURITY.md`: пути удаления — `memory_forget` + `memory_prune` + опц. флаг; «нет тихих удалений» сохранён.

- [ ] **Step 9: skills/maestro-setup/SKILL.md + skills/maestro-assistant/SKILL.md**

- `maestro-setup`: permission-сниппет добавить `memory_prune: "ask"`.
- `maestro-assistant`: канон нового ключа `delete_on_session_delete` + `memory_prune: "ask"`.

- [ ] **Step 10: Verify docs references**

Run: `rg -n "3\.1\.0|maestro-new" --glob '!node_modules' --glob '!.git' README.md docs/ manual_docs/ plugins/maestro-bootstrap/README.md package.json`
Expected: `3.2.0`; `maestro-new` — только исторические упоминания (changelog/specs), не как канон.

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "docs(memory): branch-governed lifecycle v5 — memory.md, config, commands, changelog, AGENTS.md, SECURITY.md, skills canon; version 3.2.0"
```

---

### Task 10: Regression entry + полная верификация

**Files:**
- Create: `regression/entries/2026-09-10-memory-branch-lifecycle.md`

- [ ] **Step 1: Regression entry** (по образцу `regression/entries/2026-09-08-memory-audit-log.md`):

```markdown
---
version: 1
feature: memory-branch-lifecycle
added: 2026-09-10
status: active
risk: high
scenarios:
  - path: plugins/maestro-bootstrap/memory/indexer.js
    run: node --test plugins/maestro-bootstrap/memory/indexer.test.js plugins/maestro-bootstrap/memory/index.test.js
    workdir: .
  - path: plugins/maestro-bootstrap/memory/index.js
    run: node --test plugins/maestro-bootstrap/memory/index.test.js
    workdir: .
---

# Регрессия: memory-branch-lifecycle

## Manual-сценарии
- TUI-delete сессии → запись выживает (флаг off); флаг on → запись удаляется.
- `/maestro-memory-prune`: list → категории dead/unknown; delete по явным ids.
- Squash-предупреждение в выводе list.
- dead/unknown записи после удаления ветки; foreign-host исключение из batch-all.
```

- [ ] **Step 2: Full test suite**

Run: `node --test plugins/maestro-bootstrap/index.test.js && npm run test:memory`
Expected: PASS (0 fail; допустимы 2 skipped в memory — внешние депы).

- [ ] **Step 3: Cross-cutting check**

Run: `rg -ln "delete_on_session_delete|memory_prune|memory:pruned|memory:session_closed|memory:session_delete_failed" plugins/ manual_docs/ skills/ commands/`
Expected: файлы, перечисленные в задачах 1-9.

- [ ] **Step 4: Commit**

```bash
git add regression/entries/2026-09-10-memory-branch-lifecycle.md
git commit -m "test(memory): regression entry memory-branch-lifecycle + verification"
```

---

## Self-Review (соответствие спеку §3-§9)

- §3.1 (git-якорь как драйвер) → Task 4, 5.
- §3.2 (запись выживает, runtime-очистка, флаг, init-warn, retiring privacy) → Task 1, 5, 7, 9.
- §3.3 (write-gate, sticky-фикс, head-preserve) → Task 4.
- §3.4 (инертность индексера, structural/transient) → Task 4 (write-gate) — инертность реализуется per-run гейтом (резолв пуст → abort); структурная/транзиентная разница — warn в init (Task 7 init-warn блок) + per-run gate.
- §3.5 (поле host) → Task 3, 4, 7 (export).
- §3.6 (prune: fetch, категории, host-guard, явный снапшот, squash-предупреждение) → Task 6, 7, 8.
- §3.7 (beta, guard-ALTER, optional host в export) → Task 3, 7.
- §4 (конфиг) → Task 1.
- §5 (по файлам) → Tasks 1-7.
- §6 (docs + версия 3.2.0 + канон скиллов) → Task 9.
- §7 (безопасность: permission ask, пути удаления, audit) → Task 5, 7, 9.
- §8 (регрессионные риски) → Task 10.
- §9 (DoD: session.deleted верификация, regression entry) → Task 10; верификация события — manual-сценарий.
- Minor-следствия (spec-follow-up): bounded tombstone (Task 5 dispose+clear), `memory:session_delete_failed`/`memory:pruned` аудит (Task 5/7), SCAN_FIELDS host (Task 3), selector all → явные ids (Task 7), export/import → index.js (Task 7), fetch timeout — в команде (Task 8).

**Пробелов не выявлено.**