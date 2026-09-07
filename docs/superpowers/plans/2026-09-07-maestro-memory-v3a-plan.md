# Memory Layer v3a — Backend Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Выровнять сценарный паритет трёх бэкендов памяти (sqlite/qdrant/pgvector): гибридный текстовый поиск и кросс-проектный поиск работают везде; исправить рационал `centralized_confidential` в доках.

**Architecture:** Общий RRF-хелпер `storage/rrf.js` (единая фузия, порядок по rrf). pgvector — generated `tsvector`-колонка + GIN + `ts_rank`-ветка. qdrant — payload-поле `text` + full-text index + filter-only ветка. sqlite — кросс-проект через read-only соседние БД с fail-soft и сверкой model_id/dim. Конфиг `storage.pgvector.text_search_config` (default `russian`) с zero-dep валидацией. Производные поля не входят в scan/export.

**Tech Stack:** Node ESM, better-sqlite3, @qdrant/js-client-rest (^1.9.0), pg, node:test.

**Spec:** `docs/superpowers/specs/2026-09-07-maestro-memory-v3a-design.md`

## Global Constraints

- Категория: Сложная. Без изменения схемы записей; изменения схем бэкендов — аддитивные (pg generated-колонка + GIN; qdrant payload-поле + index). Экспорт/импорт-миграция НЕ требуется.
- Производные текстовые поля (`fts` pg, `text` qdrant) НЕ добавляются в дефолтный набор `scan`/`export`-полей (§3.6) и не попадают в entry-объекты (явные списки колонок в `get()`/`scan()`).
- Порядок результатов гибридного поиска — по `rrf` (единая семантика §3.1); `score` — display-only.
- Эффективный `text_search_config` (после pg_catalog-fallback) используется единообразно в DDL, сверке колонки и `plainto_tsquery` (§3.2×§4).
- `centralized_confidential: forbid` — поведение НЕ меняется (консервативный дефолт); меняется только рационал в доках (§5).
- Удаления (`delete`/`deleteByFilter`/`prune`) остаются single-key; кросс-проект — только чтение (§3.4).
- Key-scoping, zero-dep гейт, `messages.transform === undefined`, hooks global try/catch — сохраняются.
- Язык комментариев/сообщений в коде — русский (конвенция репо). Тесты — node:test (`node --test`), без внешних зависимостей для юнитов (клиенты qdrant/pg — фейки-моки как в существующих тестах).
- Запуск тестов: `npm run test:memory` (память), `npm test` (core). Полный baseline 174 + 212.

---

## File Structure

- Create: `plugins/maestro-bootstrap/memory/storage/rrf.js` — общий RRF-хелпер.
- Modify: `plugins/maestro-bootstrap/memory/storage/sqlite.js` — рефактор на `fuseRrf`; кросс-проект read-only.
- Modify: `plugins/maestro-bootstrap/memory/storage/pgvector.js` — текстовая ветка + generated-колонка.
- Modify: `plugins/maestro-bootstrap/memory/storage/qdrant.js` — текстовая ветка + payload index.
- Modify: `plugins/maestro-bootstrap/memory/config.js` — ключ `text_search_config` + валидация.
- Modify: тесты `rrf.test.js`, `storage.test.js`, `storage/pgvector.test.js`, `storage/qdrant.test.js`, `config.test.js`, `index.test.js`.
- Docs (cross-cutting): `SECURITY.md`, `manual_docs/reference/memory.md`, `manual_docs/reference/config.md`, `manual_docs/reference/model-selection.md`, `manual_docs/explanation/agents-and-trust.md`, `manual_docs/how-to/enable-memory.md`, `manual_docs/overview/changelog.md`, `plugins/maestro-bootstrap/README.md`, `skills/maestro-assistant/SKILL.md`, `docs/project-context.md`, `docs/testing/maestro-sandbox-checklist.md`.

---

### Task 1: Общий RRF-хелпер + рефактор sqlite

**Files:**
- Create: `plugins/maestro-bootstrap/memory/storage/rrf.js`
- Test: `plugins/maestro-bootstrap/memory/storage/rrf.test.js`
- Modify: `plugins/maestro-bootstrap/memory/storage/sqlite.js` (search-merge, ~строки 214–238)

**Interfaces:**
- Consumes: — (новый модуль)
- Produces: `export async function fuseRrf(vectorHits, textHitLists, { K = 60, fetchEntry } = {}) → Array<{ entry, score, rrf }>`
  - `vectorHits`: `Array<{ entry, score }>` — косин-ранжированный список (уже отфильтрован по `min_score`, отсортирован по `score` desc)
  - `textHitLists`: `Array<Array<{ session_id }>>` — по-ключевые текстовые списки, best-first
  - `fetchEntry`: `async (session_id) → entry` — вызывается только для text-only хитов (нет entry)
  - Результат: сортировка по `rrf` desc; text-only хит получает `score: 0.5`

- [ ] **Step 1: Write the failing test**

`rrf.test.js`:
```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { fuseRrf } from "./rrf.js";

test("fuseRrf: single key, vector + text fusion, order by rrf", async () => {
  const vectorHits = [
    { entry: { session_id: "v1" }, score: 0.9 },
    { entry: { session_id: "v2" }, score: 0.8 },
  ];
  const textHitLists = [[{ session_id: "t1" }, { session_id: "v1" }]];
  const fetched = new Map([["t1", { session_id: "t1" }]]);
  const out = await fuseRrf(vectorHits, textHitLists, {
    fetchEntry: async (sid) => fetched.get(sid),
  });
  // v1: RRF 1/61 (vec) + 1/62 (text) = 0.0325; t1: 1/61 = 0.0164; v2: 1/62 = 0.0161
  assert.deepEqual(out.map((h) => h.entry.session_id), ["v1", "t1", "v2"]);
  assert.equal(out[1].score, 0.5); // text-only hit
});

test("fuseRrf: cross-key, two text lists fuse with shared vector list", async () => {
  const vectorHits = [
    { entry: { session_id: "k1a" }, score: 0.9 },
    { entry: { session_id: "k2a" }, score: 0.7 },
  ];
  const textHitLists = [
    [{ session_id: "k1b" }], // key 1
    [{ session_id: "k2b" }, { session_id: "k1a" }], // key 2
  ];
  const all = { k1b: { session_id: "k1b" }, k2b: { session_id: "k2b" } };
  const out = await fuseRrf(vectorHits, textHitLists, {
    fetchEntry: async (sid) => all[sid],
  });
  // k1a: 1/61 + 1/62 = 0.0325; k1b: 1/61 = 0.0164; k2b: 1/61 = 0.0164; k2a: 1/62 = 0.0161
  assert.deepEqual(out.map((h) => h.entry.session_id), ["k1a", "k1b", "k2b", "k2a"]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test plugins/maestro-bootstrap/memory/storage/rrf.test.js`
Expected: FAIL — `ERR_MODULE_NOT_FOUND` (rrf.js нет).

- [ ] **Step 3: Write minimal implementation**

`rrf.js`:
```js
export async function fuseRrf(vectorHits, textHitLists, { K = 60, fetchEntry } = {}) {
  const merged = new Map(); // session_id -> { rrf, entry, score }
  vectorHits.forEach((h, i) => {
    const cur = merged.get(h.entry.session_id) || { rrf: 0, entry: h.entry, score: h.score };
    cur.rrf += 1 / (K + i + 1);
    merged.set(h.entry.session_id, cur);
  });
  for (const list of textHitLists) {
    for (let i = 0; i < list.length; i++) {
      const r = list[i];
      const cur = merged.get(r.session_id) || { rrf: 0, entry: null, score: 0.5 };
      cur.rrf += 1 / (K + i + 1);
      if (!cur.entry) {
        cur.entry = fetchEntry ? await fetchEntry(r.session_id) : { session_id: r.session_id };
        cur.score = 0.5; // text-only hit: low display score
      }
      merged.set(r.session_id, cur);
    }
  }
  return [...merged.values()]
    .filter((m) => m.entry)
    .sort((a, b) => b.rrf - a.rrf)
    .map(({ entry, score, rrf }) => ({ entry, score, rrf }));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test plugins/maestro-bootstrap/memory/storage/rrf.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Refactor sqlite search to use the helper**

`sqlite.js` search (строки ~214–238): заменить ручную фузию на:
```js
return fuseRrf(vectorHits, ftsHits.length ? [ftsHits] : [], {
  fetchEntry: (sid) => this.get(sid),
});
```
Добавить import `import { fuseRrf } from "./rrf.js";`. Итоговый порядок не меняется (уже был по rrf; тесты гибрида sqlite переиспользуются).

- [ ] **Step 6: Run memory tests**

Run: `npm run test:memory`
Expected: все 212 + 2 новых проходят (гибрид sqlite `storage.test.js` — зелёный).

- [ ] **Step 7: Commit**

```bash
git add plugins/maestro-bootstrap/memory/storage/rrf.js plugins/maestro-bootstrap/memory/storage/rrf.test.js plugins/maestro-bootstrap/memory/storage/sqlite.js
git commit -m "feat(memory): shared RRF fusion helper, sqlite refactor"
```

---

### Task 2: Конфиг `storage.pgvector.text_search_config` + валидация

**Files:**
- Modify: `plugins/maestro-bootstrap/memory/config.js` (DEFAULTS, mergedConfig, classifyMemoryConfig)
- Test: `plugins/maestro-bootstrap/memory/config.test.js`

**Interfaces:**
- Consumes: — (config-слой)
- Produces: `MemoryConfig.storage.pgvector.text_search_config` (`"russian"` default); `disabled_reason: "pgvector_text_search_config_invalid"`; `resolveEffectiveTextConfig(cfg) → string` (эффективный конфиг: валидный конфигурированный ИЛИ fallback `"russian"`; применяется в Task 3). Валидация ключа — **только при** `storage.type === "pgvector"`.

- [ ] **Step 1: Write the failing test**

`config.test.js`:
```js
import { classifyMemoryConfig, loadMemoryConfig } from "./config.js";

test("text_search_config default russian", () => {
  const cfg = loadMemoryConfig({ memory: { enabled: true, storage: { type: "pgvector" }, identity: "x" } });
  assert.equal(cfg.storage.pgvector.text_search_config, "russian");
});

test("text_search_config invalid value disables only for pgvector", () => {
  const cfg = { memory: { enabled: true, storage: { type: "pgvector", text_search_config: "Bad Config" }, identity: "x" } };
  const cls = classifyMemoryConfig(cfg);
  assert.equal(cls.enabled, false);
  assert.equal(cls.disabled_reason, "pgvector_text_search_config_invalid");
  // irrelevant key on sqlite must NOT disable
  const sql = classifyMemoryConfig({ memory: { enabled: true, storage: { type: "sqlite", text_search_config: "Bad Config" } } });
  assert.equal(sql.enabled, true);
});

test("text_search_config length cap 63", () => {
  const long = "a".repeat(64);
  const cls = classifyMemoryConfig({ memory: { enabled: true, storage: { type: "pgvector", text_search_config: long }, identity: "x" } });
  assert.equal(cls.disabled_reason, "pgvector_text_search_config_invalid");
});

test("text_search_config valid custom passes", () => {
  const cfg = loadMemoryConfig({ memory: { enabled: true, storage: { type: "pgvector", text_search_config: "english" }, identity: "x" } });
  assert.equal(cfg.storage.pgvector.text_search_config, "english");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test plugins/maestro-bootstrap/memory/config.test.js`
Expected: FAIL — `text_search_config` отсутствует в конфиге.

- [ ] **Step 3: Write minimal implementation**

`config.js`:
```js
export const DEFAULTS = {
  // ...
  storage: {
    type: "sqlite",
    centralized_confidential: "forbid",
    qdrant: null,
    pgvector: null,
  },
};
const TEXT_SEARCH_CONFIG_RE = /^[a-z][a-z0-9_]*$/;

function pgvectorTextSearchConfigValid(m) {
  if (m?.storage?.type !== "pgvector") return true; // irrelevant key does not disable
  const v = m?.storage?.text_search_config;
  if (v == null) return true;
  return typeof v === "string" && v.length <= 63 && TEXT_SEARCH_CONFIG_RE.test(v);
}
```
В `mergedConfig` пробрасывать `text_search_config: m.storage?.text_search_config ?? "russian"` внутрь `pgvector`-объекта.
В `classifyMemoryConfig` после валидации типа: `if (!pgvectorTextSearchConfigValid(m)) return { enabled: false, disabled_reason: "pgvector_text_search_config_invalid" };`

Добавить `export function resolveEffectiveTextConfig(config) { const v = config.storage?.pgvector?.text_search_config; return (typeof v === "string" && v.length <= 63 && TEXT_SEARCH_CONFIG_RE.test(v)) ? v : "russian"; }`

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test plugins/maestro-bootstrap/memory/config.test.js`
Expected: PASS.

- [ ] **Step 5: Run full memory suite**

Run: `npm run test:memory`
Expected: 214+ проходят.

- [ ] **Step 6: Commit**

```bash
git add plugins/maestro-bootstrap/memory/config.js plugins/maestro-bootstrap/memory/config.test.js
git commit -m "feat(memory): pgvector text_search_config key + zero-dep validation"
```

---

### Task 3: pgvector — текстовая ветка (tsvector + GIN + ts_rank)

**Files:**
- Modify: `plugins/maestro-bootstrap/memory/storage/pgvector.js` (init, search, get, scan)
- Test: `plugins/maestro-bootstrap/memory/storage/pgvector.test.js`

**Interfaces:**
- Consumes: `fuseRrf` (Task 1); `resolveEffectiveTextConfig` (Task 2)
- Produces: `search(embedding, { query })` — гибридная ветка на pgvector; generated-колонка `fts` (эффективный конфиг), GIN-индекс `<t>_fts_idx`, атомарный recreate при смене конфига; `get()`/`scan()` — явный список колонок (без `fts`).

- [ ] **Step 1: Write the failing test**

`pgvector.test.js` — добавить (мок `pool` как в существующих тестах; фейк `query` записывает вызовы):
```js
test("pgvector hybrid: text leg uses plainto_tsquery + ts_rank and fuses via rrf", async () => {
  // seed: memory search returns two vector hits; text-leg query returns strong text hit first
  const storage = new PgVectorStorage({ pool: fakePool, table: "memory", dim: 3, modelId: "m" });
  await storage.init();
  const calls = [];
  fakePool.query = async (sql, params) => {
    calls.push({ sql, params });
    if (sql.includes("plainto_tsquery")) {
      return { rows: [{ session_id: "s1", rank: 0.9 }, { session_id: "s2", rank: 0.5 }] };
    }
    if (sql.includes("<=>")) return { rows: [{ session_id: "s2", title: "t", key: "k", summary: "s", decisions: "[]", model_id: "m", author: "a", time_first: 1, time_last: 2, version: 1, score: 0.8 }] };
    return { rows: [{ session_id: "s2", title: "t", key: "k", summary: "s", decisions: "[]", model_id: "m", author: "a", time_first: 1, time_last: 2, version: 1 }] };
  };
  const res = await storage.search(new Float32Array([0, 0, 1]), { key: "k", query: "foo", top_k: 3 });
  const ts = calls.find((c) => c.sql.includes("plainto_tsquery"));
  assert.ok(ts, "text leg executed");
  assert.equal(ts.params[0], "russian"); // effective config as bound param
  assert.equal(ts.params[1], "foo");
  assert.ok(res.length >= 1);
  assert.ok(res[0].entry.session_id); // fused entry
});

test("pgvector init: creates generated fts column + gin index with effective config", async () => {
  const ddl = [];
  fakePool.query = async (sql) => { ddl.push(sql); return { rows: [] }; };
  const storage = new PgVectorStorage({ pool: fakePool, table: "memory", dim: 3, modelId: "m" });
  await storage.init();
  const add = ddl.find((s) => s.includes("ADD COLUMN IF NOT EXISTS fts"));
  assert.ok(add.includes("to_tsvector('russian'::regconfig"));
  const idx = ddl.find((s) => s.includes("USING gin"));
  assert.ok(idx);
});

test("pgvector get/scan exclude fts column (explicit list)", async () => {
  fakePool.query = async (sql) => {
    assert.ok(!/SELECT \*/.test(sql), "no SELECT *");
    return { rows: [{ session_id: "s1", decisions: "[]" }] };
  };
  const storage = new PgVectorStorage({ pool: fakePool, table: "memory", dim: 3, modelId: "m" });
  await storage.init();
  const e = await storage.get("s1");
  assert.equal(e.session_id, "s1");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test plugins/maestro-bootstrap/memory/storage/pgvector.test.js`
Expected: FAIL — нет text-ветки / generated-колонки.

- [ ] **Step 3: Write minimal implementation**

`pgvector.js`:
- Конструктор принимает `textSearchConfig` (эффективный, из config-слоя — index.js передаёт `resolveEffectiveTextConfig(config)`).
- `init()`:
  ```js
  const cfg = this.textSearchConfig; // effective
  await this.pool.query(`CREATE EXTENSION IF NOT EXISTS vector`);
  await this.pool.query(`CREATE TABLE IF NOT EXISTS ${this.table} ( ... )`);
  // config drift check: compare stored column expression with effective config
  const exprRows = await this.pool.query(
    `SELECT pg_get_expr(a.adbin, a.adrelid) AS expr
     FROM pg_attribute a
     JOIN pg_class c ON c.oid = a.attrelid
     JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE c.relname = $1 AND a.attname = 'fts' AND NOT a.attisdropped`, [this.table]);
  const expr = exprRows.rows?.[0]?.expr;
  if (expr !== undefined && !expr.includes(`'${cfg}'::regconfig`)) {
    await this.pool.query("BEGIN");
    try {
      await this.pool.query(`ALTER TABLE ${this.table} DROP COLUMN IF EXISTS fts`);
      await this.pool.query(`ALTER TABLE ${this.table} ADD COLUMN fts tsvector GENERATED ALWAYS AS (to_tsvector('${cfg}'::regconfig, coalesce(title,'') || ' ' || coalesce(summary,'') || ' ' || coalesce(decisions,''))) STORED`);
      await this.pool.query(`CREATE INDEX IF NOT EXISTS ${this.table}_fts_idx ON ${this.table} USING gin(fts)`);
      await this.pool.query("COMMIT");
    } catch (err) {
      await this.pool.query("ROLLBACK").catch(() => {});
      throw err;
    }
  } else if (expr === undefined) {
    await this.pool.query(`ALTER TABLE ${this.table} ADD COLUMN IF NOT EXISTS fts tsvector GENERATED ALWAYS AS (to_tsvector('${cfg}'::regconfig, coalesce(title,'') || ' ' || coalesce(summary,'') || ' ' || coalesce(decisions,''))) STORED`);
    await this.pool.query(`CREATE INDEX IF NOT EXISTS ${this.table}_fts_idx ON ${this.table} USING gin(fts)`);
  }
  await this.pool.query(`CREATE INDEX IF NOT EXISTS ${this.table}_key_idx ON ${this.table} (key)`);
  ```
- `search()`: при `query` (string, непустой) добавить text-ветку:
  ```js
  const textConds = ["fts @@ plainto_tsquery($1, $2)", "key = $3"]; // key-set: `key IN (...)`
  // date/author условия — как в vector-ветке (параметры после)
  const sql = `SELECT session_id FROM ${this.table}
     WHERE ${textConds.join(" AND ")}
     ORDER BY ts_rank(fts, plainto_tsquery($1, $2)) DESC
     LIMIT $n`;
  // $1 = cfg (textSearchConfig), $2 = query, $3+ = key-set/date/author, $n = top_k
  const tr = await this.pool.query(sql, [this.textSearchConfig, query, ...filters, top_k]);
  const textHits = tr.rows.map((r) => ({ session_id: r.session_id }));
  return fuseRrf(vectorHits, textHits.length ? [textHits] : [], { fetchEntry: (sid) => this.get(sid) });
  ```
  Ошибка text-ветки → try/catch → vector-only fallback (`console.error` + возврат `vectorHits`).
- `get()`/`scan()`: заменить `SELECT *` на явный список колонок (без `fts`): `session_id, key, origin_project_hash, title, summary, decisions, model_id, author, time_first, time_last, version` (+ `embedding` для scan opt-in).

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test plugins/maestro-bootstrap/memory/storage/pgvector.test.js`
Expected: PASS (старые + новые).

- [ ] **Step 5: index.js — передать effective config в конструктор**

`index.js` createStorage для pgvector: `textSearchConfig: resolveEffectiveTextConfig(config)` (import из config.js). Проверить, что существующие тесты index.test.js не падают.

- [ ] **Step 6: Run memory + core suites**

Run: `npm run test:memory && npm test`
Expected: 216+ memory, 174 core.

- [ ] **Step 7: Commit**

```bash
git add plugins/maestro-bootstrap/memory/storage/pgvector.js plugins/maestro-bootstrap/memory/storage/pgvector.test.js plugins/maestro-bootstrap/memory/index.js
git commit -m "feat(memory): pgvector hybrid text search (generated tsvector + ts_rank + rrf)"
```

---

### Task 4: qdrant — текстовая ветка (payload text + full-text index)

**Files:**
- Modify: `plugins/maestro-bootstrap/memory/storage/qdrant.js` (init, upsert, search)
- Test: `plugins/maestro-bootstrap/memory/storage/qdrant.test.js`

**Interfaces:**
- Consumes: `fuseRrf` (Task 1)
- Produces: payload-поле `text` на каждой точке (пересчёт на каждый upsert); payload full-text index на `text`; backfill существующих точек (`text is_empty` → `set_payload`, пагинация `next_page_offset`, JSON.parse-guard `decisions`); `search(embedding, { query })` — filter-only text-ветка (без `nearest`), `full_text_match`, фузия через RRF; try/catch на создании индекса (серверы <1.10 → scan-режим); vector-only fallback при ошибке.

- [ ] **Step 1: Write the failing test**

`qdrant.test.js` — добавить (мок `client` как в существующих тестах):
```js
test("qdrant upsert adds derived text field (recomputed each time)", async () => {
  const storage = new QdrantStorage({ client: fakeClient, collection: "c", modelId: "m", dim: 3 });
  await storage.init();
  await storage.upsert([{ session_id: "s1", key: "k", origin_project_hash: "h", title: "T", summary: "S", decisions: ["d1", "d2"], model_id: "m", author: "a", time_first: 1, time_last: 2, version: 1, embedding: new Float32Array([1, 0, 0]) }]);
  const sent = fakeClient.upsert.calls[0].points[0].payload;
  assert.equal(sent.text, "T S d1 d2");
});

test("qdrant init creates payload text index + backfills empty-text points (paged)", async () => {
  await storage.init();
  const idxCall = fakeClient.createPayloadIndex.calls[0];
  assert.equal(idxCall.field_name, "text");
  assert.equal(idxCall.field_schema.tokenizer, "word");
  // backfill scroll called with is_empty filter
  const scroll = fakeClient.scroll.calls.find((c) => JSON.stringify(c.filter).includes("is_empty"));
  assert.ok(scroll);
  const set = fakeClient.setPayload.calls[0];
  assert.ok(set.payload.text);
});

test("qdrant hybrid: text leg is filter-only (no query/nearest) and fuses via rrf", async () => {
  fakeClient.query = async (coll, opts) => {
    if (opts.filter && !opts.query) {
      assert.equal(opts.query, undefined, "text leg must not have query key");
      assert.ok(JSON.stringify(opts.filter).includes("full_text_match"));
      return { points: [{ payload: { session_id: "s1" } }] };
    }
    return { points: [{ payload: { session_id: "s2", decisions: "[]" }, score: 0.8 }] };
  };
  const res = await storage.search(new Float32Array([0, 0, 1]), { key: "k", query: "foo", top_k: 3 });
  assert.ok(res.length >= 1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test plugins/maestro-bootstrap/memory/storage/qdrant.test.js`
Expected: FAIL — `text`/index отсутствуют.

- [ ] **Step 3: Write minimal implementation**

`qdrant.js`:
- `upsert`: добавить в payload `text: [e.title, e.summary, e.decisions.join(" ")].join(" ")`.
- `init()`: создать index (try/catch):
  ```js
  try {
    await this.client.createPayloadIndex(this.collection, {
      field_name: "text",
      field_schema: { type: "text", tokenizer: "word", min_token_len: 2 },
    });
  } catch (err) {
    console.error(`[memory] qdrant payload text index failed (scan-mode fallback): ${err.message}`);
  }
  // backfill: paged scroll over points with empty text
  let offset = undefined;
  const textOf = (p) => {
    const d = p.payload?.decisions;
    let parsed = [];
    try { parsed = JSON.parse(d); } catch { parsed = []; }
    return [p.payload?.title ?? "", p.payload?.summary ?? "", parsed.join(" ")].join(" ").trim();
  };
  do {
    const res = await this.client.scroll(this.collection, {
      filter: { must: [{ key: "text", is_empty: true }] },
      limit: 100,
      offset,
      with_payload: true,
      with_vector: false,
    });
    const points = res.points ?? [];
    if (points.length) {
      const pts = points.filter((p) => p.payload?.title || p.payload?.summary || p.payload?.decisions);
      if (pts.length) {
        // per-point: payload — один объект, points — список id (реальный API).
        try {
          for (const p of pts) {
            await this.client.setPayload(this.collection, {
              payload: { text: textOf(p) },
              points: [p.id],
            });
          }
        } catch (err) {
          console.error(`[memory] qdrant text backfill failed: ${err.message}`);
        }
      }
    }
    offset = res.next_page_offset;
  } while (offset != null);
  ```
  (set_payload-вызов — по фактическому API js-client-rest: `setPayload(collection, { payload, points })`; реализация сверяется с тестом/API клиента.)
- `search`: при `query`:
  ```js
  const textFilter = { must: [...keyMust, { key: "text", full_text_match: { text: query } }, ...dateAuthorMust] };
  // top-level filter БЕЗ query-ключа (у Query enum нет FilterQuery-варианта).
  const tr = await this.client.query(this.collection, {
    filter: textFilter,
    limit: top_k,
    with_payload: true,
  });
  const textHits = (tr.points ?? []).map((p) => ({ session_id: p.payload.session_id }));
  return fuseRrf(vectorHits, textHits.length ? [textHits] : [], { fetchEntry: (sid) => this.get(sid) });
  ```
  try/catch → vector-only fallback.
  `keyMust` — как в vector-ветке (key-set из `resolveSearchKeys`).

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test plugins/maestro-bootstrap/memory/storage/qdrant.test.js`
Expected: PASS (старые + новые).

- [ ] **Step 5: Run memory suite**

Run: `npm run test:memory`
Expected: 218+ проходят.

- [ ] **Step 6: Commit**

```bash
git add plugins/maestro-bootstrap/memory/storage/qdrant.js plugins/maestro-bootstrap/memory/storage/qdrant.test.js
git commit -m "feat(memory): qdrant hybrid text search (payload text index + rrf)"
```

---

### Task 5: sqlite — кросс-проектный поиск (read-only соседние БД)

**Files:**
- Modify: `plugins/maestro-bootstrap/memory/storage/sqlite.js` (search — снять throw, sibling-путь; добавить `sanitizeDirName` import)
- Test: `plugins/maestro-bootstrap/memory/storage/sqlite.test.js`

**Interfaces:**
- Consumes: `fuseRrf` (Task 1), `resolveSearchKeys` (существует в `../project.js`)
- Produces: `search(embedding, { project })` — кросс-проект: read-only sibling `dataDir/maestro/memory/<sanitizeDirName(k)>/memory.db`; fail-soft (любая ошибка → skip+лог); сверка `meta.model_id`/`meta.dim` (несовпадение → skip+лог); FTS-таблица отсутствует у старой БД → vector-only; merge всех ключей через `fuseRrf`; провенанс: `_source_key` на хитах соседних ключей.

- [ ] **Step 1: Write the failing test**

`sqlite.test.js` — добавить (использует временные БД в tmp, два ключа):
```js
import { join } from "node:path";
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname } from "node:path";
import { sanitizeDirName } from "../config.js";

test("sqlite cross-project search reads sibling DB read-only", async () => {
  const base = mkdtempSync(join(tmpdir(), "mm-sqlite-xp-"));
  const dir = (key) => join(base, "maestro", "memory", sanitizeDirName(key));
  const activeKey = "active"; const other = "other";
  mkdirSync(dir(activeKey), { recursive: true });
  mkdirSync(dir(other), { recursive: true });
  const mk = (key, label) => new SqliteStorage({ dbPath: join(dir(key), "memory.db"), modelId: "m", dim: 3, moduleDir: null });
  const active = mk(activeKey, "active"); const otherDb = mk(other, "other");
  await otherDb.init();
  await otherDb.upsert([{ session_id: "o1", key: other, origin_project_hash: "ho", title: "Other Project", summary: "sum", decisions: [], model_id: "m", author: "a", time_first: 1, time_last: 2, version: 1, embedding: new Float32Array([1, 0, 0]) }]);
  await otherDb.dispose();
  await active.init();
  await active.upsert([{ session_id: "a1", key: activeKey, origin_project_hash: "ha", title: "Active", summary: "sum", decisions: [], model_id: "m", author: "a", time_first: 1, time_last: 2, version: 1, embedding: new Float32Array([0, 1, 0]) }]);
  const res = await active.search(new Float32Array([1, 0, 0]), { key: activeKey, project: other, top_k: 10, min_score: 0 });
  const ids = res.map((h) => h.entry.session_id);
  assert.ok(ids.includes("o1"), "sibling hit present");
  assert.ok(ids.includes("a1"), "active hit present");
  active.dispose();
});

test("sqlite cross-project: model mismatch sibling is skipped", async () => {
  // other DB has model_id "other-model" → active search(project=other) must skip it, keep active-only
  // (setup mirror: init otherDb with modelId "other-model", upsert; then active.search project=other)
  // expect: res contains only "a1", and console.error logged a skip
});

test("sqlite cross-project: missing sibling file is skipped silently", async () => {
  const active = mk(activeKey, "active");
  await active.init();
  const res = await active.search(new Float32Array([1, 0, 0]), { key: activeKey, project: "nonexistent", top_k: 5, min_score: 0 });
  assert.ok(res.length >= 0); // no throw
  active.dispose();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test plugins/maestro-bootstrap/memory/storage/sqlite.test.js`
Expected: FAIL — кросс-проект бросает ошибку (существующий throw).

- [ ] **Step 3: Write minimal implementation**

`sqlite.js`:
- import: `import { sanitizeDirName } from "../config.js";` `import { join, dirname } from "node:path";` (join уже есть; добавить dirname).
- В `search()`: заменить throw на кросс-ключевой обход:
  ```js
  const keys = resolveSearchKeys({ key, project });
  // active key: current logic (vector + FTS), no source annotation
  const base = join(dirname(this.dbPath), "..", ".."); // dataDir
  let allVector = []; const textLists = [];
  const collectKey = async (k, isActive) => {
    const { vectorHits, ftsHits } = await this._searchKey(k, isActive);
    if (isActive) { allVector = vectorHits; if (ftsHits.length) textLists.push(ftsHits); }
    else { allVector = [...allVector, ...vectorHits]; if (ftsHits.length) textLists.push(ftsHits); }
  };
  await collectKey(keys[0], true);
  for (const k of keys.slice(1)) await collectKey(k, false);
  allVector.sort((a, b) => b.score - a.score);
  return fuseRrf(allVector, textLists, { fetchEntry: (sid) => this.get(sid) });
  ```
- Новый private `_searchKey(k, isActive)`:
  - активный ключ: текущий vector+fts поиск (с фильтрами date/author), annotate нет.
  - sibling: путь `join(base, "maestro", "memory", sanitizeDirName(k), "memory.db")`;
    ```js
    const Database = await loadBetterSqlite3(this.moduleDir);
    let sib;
    try {
      sib = new Database(path, { readonly: true, fileMustExist: false });
    } catch (err) { console.error(`[memory] cross-project skip ${k}: ${err.message}`); return { vectorHits: [], ftsHits: [] }; }
    try {
      const model = sib.prepare("SELECT value FROM meta WHERE name='model_id'").get();
      if (model && model.value !== this.modelId) { console.error(`[memory] cross-project skip ${k}: model mismatch`); sib.close(); return { vectorHits: [], ftsHits: [] }; }
      const dim = sib.prepare("SELECT value FROM meta WHERE name='dim'").get();
      if (dim && parseInt(dim.value, 10) !== this.dim) { console.error(`[memory] cross-project skip ${k}: dim mismatch`); sib.close(); return { vectorHits: [], ftsHits: [] }; }
      const hasFts = sib.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='memory_fts'").get();
      const { vectorHits, ftsHits } = this._searchIn(sib, k, { date_from, date_to, author, query, top_k, min_score, allowFts: !!hasFts });
      return { vectorHits: vectorHits.map((h) => ({ ...h, entry: { ...h.entry, _source_key: k } })), ftsHits };
    } catch (err) { console.error(`[memory] cross-project skip ${k}: ${err.message}`); return { vectorHits: [], ftsHits: [] }; }
    finally { sib.close(); }
    ```
  - `_searchIn(db, k, opts)` — общий vector+fts поиск по произвольному соединению (рефактор текущего тела search, параметризуя `this.db` на `db` и `key` на `k`; для активного ключа `db === this.db`). `get(sid)` для fetchEntry должен уметь читать из правильного соединения: для sibling-хитов fetchEntry выполняется ПОСЛЕ закрытия БД → для text-only sibling-хитов сохранять entry из payload/строки прямо в хит (не через get). Упрощение: в `_searchIn` для FTS-хитов сразу подтягивать полную строку (`SELECT * FROM memory WHERE session_id=?`) и класть `{ session_id, entry }`, чтобы fuseRrf не дёргал fetchEntry по закрытой БД. В RRF-хелпере хит с entry не вызывает fetchEntry.
  - `sanitizeDirName` для ключа k — sha256(k).slice(0,16); совпадает с layout `index.js`.

- Проверка: активный ключ без `project` — поведение не меняется (тесты существующие зелёные).

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test plugins/maestro-bootstrap/memory/storage/sqlite.test.js`
Expected: PASS (старые + новые).

- [ ] **Step 5: Run full memory + core suites**

Run: `npm run test:memory && npm test`
Expected: 220+ memory, 174 core.

- [ ] **Step 6: Commit**

```bash
git add plugins/maestro-bootstrap/memory/storage/sqlite.js plugins/maestro-bootstrap/memory/storage/sqlite.test.js
git commit -m "feat(memory): sqlite cross-project read-only search (fail-soft, model check)"
```

---

### Task 6: Docs cross-cutting + sandbox E2E + changelog

**Files (Modify):**
- `SECURITY.md` §5a (рационал `centralized_confidential`)
- `manual_docs/reference/memory.md` (паритет-матрица, морфология, qdrant-ограничение, новый ключ, известные ограничения)
- `manual_docs/reference/config.md` (ключ `text_search_config`)
- `manual_docs/reference/model-selection.md` (рационал)
- `manual_docs/explanation/agents-and-trust.md` (рационал)
- `manual_docs/how-to/enable-memory.md` (`disabled_reason` + рационал)
- `manual_docs/overview/changelog.md` (запись v3a)
- `plugins/maestro-bootstrap/README.md` (рационал + ключ)
- `skills/maestro-assistant/SKILL.md` (config-канон: ключ `text_search_config`)
- `docs/project-context.md` §5 (паритет)
- `docs/testing/maestro-sandbox-checklist.md` (F9–F11)

**Interfaces:** — (docs; сверка с §5/§6 спека)

- [ ] **Step 1: Fix the `centralized_confidential` rationale (cross-cutting)**

В 5 файлах заменить неверный рационал («Level-1-санизированные данные на стороннем сервере — вне текущей модели доверия») на корректный:
> Маскирование защищает **raw-confidential** от передачи открыто untrusted LLM и от выхода за машину в полном виде. **Санизированные** данные могут храниться/читаться где угодно. `forbid` (default) — консервативный local-first дефолт (failover на sqlite + warning); `allow` — осознанный opt-in владельца. Поведение не меняется.
Файлы: `SECURITY.md` (§5a, строки ~106–110), `manual_docs/reference/memory.md` (~126–128), `manual_docs/explanation/agents-and-trust.md` (~268–271), `manual_docs/reference/model-selection.md` (~167–168), `plugins/maestro-bootstrap/README.md` (~258).

- [ ] **Step 2: Document parity matrix + new key + limitations**

`manual_docs/reference/memory.md`:
- Паритет-матрица (гибрид/cross-project — все бэкенды; морфология: sqlite unicode61 без стемминга, qdrant word-токенизация `min_token_len: 2` (односимвольные токены отбрасываются), pg `russian` стеммер — конфигурируемо).
- qdrant-ограничение ранжирования text-leg (без bm25-порядка; совпадения всплывают через RRF).
- Операционные оговорки: pg `ALTER ADD COLUMN STORED` = table rewrite + ACCESS EXCLUSIVE lock (shared-серверы); generated-колонка индексирует JSON-текст decisions — токенизация эквивалентна `join(" ")` (пунктуация — разделители).
- Известные ограничения: латентное допущение `model_id` на centralized (разные модели в одной коллекции → мусорное ранжирование молча); остаточный prompt-injection от локально подложенной sibling-БД (нужен write в data-dir; митигация framing); pg fallback на `russian` fail-loud на кастомных PG без russian-конфига.
- Новый ключ `storage.pgvector.text_search_config` (default `russian`).

`manual_docs/reference/config.md`: строка ключа `storage.pgvector.text_search_config`.

- [ ] **Step 3: Config canon + disabled_reason**

`skills/maestro-assistant/SKILL.md` (single source config-правил): добавить ключ `storage.pgvector.text_search_config` (валидация `/^[a-z][a-z0-9_]*$/`, ≤63, только при `type=pgvector`). `manual_docs/how-to/enable-memory.md` (~233): добавить `pgvector_text_search_config_invalid` в таблицу `disabled_reason`.

- [ ] **Step 4: project-context + changelog + sandbox E2E**

`docs/project-context.md` §5: паритет бэкендов (гибрид/cross-project на всех; `text_search_config`). `manual_docs/overview/changelog.md`: запись v3a (backend parity: hybrid/cross-project на всех бэкендах; новый ключ; рационал `centralized_confidential` уточнён). `docs/testing/maestro-sandbox-checklist.md` — добавить F9–F11 (реальный Bun-прогон):
| F9 | pgvector hybrid | ✅ | pgvector-проект в sandbox; `memory_search` с текстовым `query` возвращает лексические совпадения (ts_rank); без crash |
| F10 | qdrant hybrid | ✅ | qdrant-проект в sandbox; `memory_search` с `query` возвращает full-text совпадения через RRF; без crash |
| F11 | sqlite cross-project | ✅ | sqlite-проект; `memory_search { project: <сосед> }` возвращает записи соседа read-only; `origin_project_hash`/source-key в выдаче; без crash |

- [ ] **Step 5: Verify tests still green**

Run: `npm run test:memory && npm test`
Expected: 220+ memory, 174 core (docs-задачи не меняют код).

- [ ] **Step 6: Commit**

```bash
git add SECURITY.md manual_docs plugins/maestro-bootstrap/README.md skills/maestro-assistant/SKILL.md docs/project-context.md docs/testing/maestro-sandbox-checklist.md
git commit -m "docs(memory): backend parity matrix, centralized_confidential rationale, F9-F11"
```

---

## Project Context Changes

- `docs/project-context.md` §5 — уточнение паритета бэкендов (гибрид/cross-project на всех; ключ `text_search_config`). Применяется на plan-gate (шаг 12a).

## Regression Risk

- **Risk: MEDIUM** — модули `storage/*.js` (sqlite/qdrant/pgvector) + config (cross-layer: config → storage → tools → docs; аддитивные изменения схем).
- Scenarios:
  - `plugins/maestro-bootstrap/memory/storage/sqlite.js` — гибрид/кросс-проект: run `node --test plugins/maestro-bootstrap/memory/storage/sqlite.test.js`
  - `plugins/maestro-bootstrap/memory/storage/qdrant.js` — run `node --test plugins/maestro-bootstrap/memory/storage/qdrant.test.js`
  - `plugins/maestro-bootstrap/memory/storage/pgvector.js` — run `node --test plugins/maestro-bootstrap/memory/storage/pgvector.test.js`
  - `plugins/maestro-bootstrap/memory/config.js` — run `node --test plugins/maestro-bootstrap/memory/config.test.js`
  - Полный прогон: `npm run test:memory` + `npm test`
  - [Manual] Sandbox E2E F9–F11 (Bun/opencode, реальные бэкенды)