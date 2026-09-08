# Memory Layer Audit Log — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Выделить аудит-лог memory layer в отдельный `.maestro/logs/maestro-memory-<дата>.log` (JSONL) с aggregates-only field whitelist (SEC-4b+): lifecycle-аудит, root-cause, производительность и показатели эффективности.

**Architecture:** Расширить `makeLogger` в `core.js` опцией `logDir`; создать `memoryLog` (`filePrefix: "maestro-memory"`, `filterEnv: "MAESTRO_MEMORY"`, каталог `process.env.MAESTRO_MEMORY_LOG_DIR || log.logDir`) и передать в `registerMemoryHooks({ …, memoryLog })`. В memory-модуле — хелперы `logInfo/…` → `memoryLog ?? log` с carve-out для `memory: disabled`/`init failed` (остаются на bootstrap-`log`). События из spec §4 (lifecycle/root-cause/perf/effectiveness) + `timed()`-хелпер для storage-бэкендов. Дисциплина полей — spec §3.

**Tech Stack:** Node.js ESM, built-in test runner (`node --test`), reuse `makeLogger` (zero-dep).

**Spec:** `docs/superpowers/specs/2026-09-08-memory-logging-design.md` (approve; подписи `maestro:sanitize` + `maestro:review`). Таблицы событий — источник истины (§4.1–4.4), field whitelist — §3.

## Global Constraints

- **Field whitelist (spec §3, SEC-4b+):** в лог НЕ попадает текст query/summary/title/decisions, пути (в т.ч. confidential), тела ошибок (`Error.message`/`.stack`/HTTP-body → только `error_class` enum), `base_url`/эндпоинты, raw free-text `branch` (только нормализованный — стрип `[A-Z]+-\d+` → `*`), значения секретов. Разрешены: sessionID, projectKey (hash), author, branch-нормализованный, provider flag, model (имя), dim, counts/timestamps/duration_ms, min_score/top_k, len-биннинг, enum'ы.
- **Отдельный файл:** `makeLogger` расширяется опцией `logDir`; каталог `MAESTRO_MEMORY_LOG_DIR` (env) > `log.logDir` (bootstrap) > `<root>/.maestro/logs`. `filterEnv: "MAESTRO_MEMORY"` → env `MAESTRO_MEMORY_LOG_LEVEL` (default `info`), `MAESTRO_MEMORY_LOG_MASK`.
- **Carve-out:** `memory: disabled` и `memory: init failed` пишутся из `memory/index.js` через bootstrap-`log` **напрямую** (не через хелперы) — не уезжают в memoryLog.
- **Backward compat:** `registerMemoryHooks` принимает опц. `memoryLog`; fallback `memoryLog ?? log`. Без memoryLog события остаются в bootstrap-логе. ~90 тестовых вызовов не ломаются.
- **Hard-disable НЕ вводится** при непустых `confidential.paths`; вместо него `memory:log_confidential_note` (warn).
- **Zero-dep:** `provision.js DEPS` не меняется; `makeLogger` — единственное изменение core.js.
- **Уровни:** info = lifecycle + агрегаты + effectiveness; debug = per-op латентности/детали; warn = skip/retryable/mismatch/fallback/no_hits; error = сбои.
- **`experimental.chat.messages.transform`** остаётся `undefined`. Все хуки try/catch-guarded.
- **Доки синхронно** (AGENTS.md): SECURITY.md §5a + manual_docs (config.md env, memory.md логирование+эффективность, enable-memory.md диагностика, commands, changelog, project-context).

## Project Context Changes

Применяется на plan-approve (шаг 12a) к `docs/project-context.md`:
- §3 Стек (memory layer bullet): добавить «аудит-лог memory layer (отдельный `maestro-memory-<дата>.log`, aggregates-only whitelist, env `MAESTRO_MEMORY_LOG_LEVEL/_MASK/_DIR`)».

## Cross-cutting Changes

- `plugins/maestro-bootstrap/core.js` — `makeLogger` + `memoryLog` + проброс (Task 1).
- `manual_docs/reference/config.md` — env `MAESTRO_MEMORY_LOG_*` (Task 8).
- `SECURITY.md` §5a — пункт «Логирование memory layer» (Task 8).
- `manual_docs/reference/memory.md` — секции «Логирование» + «Оценка эффективности» (Task 8).
- `manual_docs/how-to/enable-memory.md` — диагностика логов (Task 8).
- `commands/maestro-memory.md` — упоминание файла лога (Task 8).
- `manual_docs/overview/changelog.md`, `docs/project-context.md` (Task 8).

## Spec Follow-up (не блокируют Approve)

- Branch-нормализация — остаточный риск (free-text вне ticket-кодов); future: hash/opt-out → пометка в docs (Task 8).
- Объём/шум debug-событий (sync `appendFileSync` на горячих путях) — документировать уровни (Task 8).
- Root-cause debug-события невидимы при default info — enable-memory.md покрывает поднятие уровня (Task 8).
- Дрейф whitelist — SEC-4b-тест в дефолтном наборе (Task 7).

## Regression Risk + Scenarios

- risk: **MEDIUM** — изменение `core.js makeLogger` (новая опция `logDir`) не должно сломать bootstrap/audit-логи.
  - scenario: `plugins/maestro-bootstrap/core.js` — run: `node --test plugins/maestro-bootstrap/index.test.js` — workdir: repo root.
- risk: **MEDIUM** — `registerMemoryHooks` сигнатура (+`memoryLog`, fallback) не должна сломать ~90 тестовых вызовов и поведение без memoryLog.
  - scenario: `plugins/maestro-bootstrap/memory/index.js` — run: `node --test plugins/maestro-bootstrap/memory/index.test.js` — workdir: repo root.
- risk: **MEDIUM** — storage-бэкенды с `log` (timed-обёртки) не должны менять поведение/тайминги и сломать storage-тесты.
  - scenario: `plugins/maestro-bootstrap/memory/storage.js` — run: `npm run test:memory` — workdir: repo root.

---

### Task 1: core.js — `makeLogger.logDir` + `memoryLog` + проброс

**Files:**
- Modify: `plugins/maestro-bootstrap/core.js` (makeLogger, `registerMemoryHooks`-вызов)
- Test: `plugins/maestro-bootstrap/index.test.js`

**Interfaces:**
- Produces: `makeLogger(directory, { logDir, filePrefix, logDirEnv, filterEnv })` — опция `logDir` (string, приоритет над env/directory); `memoryLog` передаётся в `registerMemoryHooks({ client, config, log, memoryLog, root })`.

- [ ] **Step 1: Падающие тесты** в `index.test.js` (в секции про makeLogger, рядом с существующим «writes to a separate file when filePrefix set»):

```js
test("makeLogger logDir option overrides env/directory", () => {
  const dir = mkdtempSync(join(tmpdir(), "mlog-"));
  const custom = join(dir, "custom");
  mkdirSync(custom, { recursive: true });
  const log = makeLogger(dir, { filePrefix: "maestro-memory", logDir: custom, filterEnv: "MAESTRO_MEMORY" });
  log.info("memory: test", {});
  const files = readdirSync(custom).filter((f) => f.includes("maestro-memory"));
  assert.ok(files.length === 1, "log file written to explicit logDir");
});

test("memoryLog filePrefix is maestro-memory with MAESTRO_MEMORY filter", () => {
  // registerMemoryHooks(..., { memoryLog }) — события memory пишут в maestro-memory-*.log
  // (проверяется в Task 2; здесь — только что memoryLog создаётся и передаётся:
  // переопределить через стуб, либо покрыть на Task 2)
});
```
> Для core.js: тест покрывает `makeLogger({ logDir })`. Передача `memoryLog` в `registerMemoryHooks` проверяется интеграционно в Task 2 (index.test.js), здесь достаточно makeLogger-теста + адаптации существующих тестов (если сигнатура вызова меняется).

- [ ] **Step 2: Run to verify they fail**

Run: `node --test plugins/maestro-bootstrap/index.test.js`
Expected: FAIL (нет опции `logDir` — каталог `custom` пуст).

- [ ] **Step 3: Реализовать в `core.js`**

В `makeLogger(directory, {...})` (начало функции, ~797-804):

```js
export function makeLogger(directory, {
  filePrefix = "maestro-bootstrap",
  logDirEnv = "MAESTRO_BOOTSTRAP_LOG_DIR",
  filterEnv = "MAESTRO_BOOTSTRAP",
  logDir = null,   // новая опция: явный каталог, приоритет над logDirEnv/directory
} = {}) {
  const dir =
    logDir ||
    process.env[logDirEnv] ||
    path.join(directory, ".maestro/logs");
```

> Имя переменной `logDir` конфликтует с существующим `logDir` в теле? Проверить: в функции `logDir` — const-локальная (была `const logDir = process.env[...] || ...`). Переименовать локальную в `resolvedLogDir` при необходимости; `dir` — новая.

Рядом с созданием audit-лога (после `log`):

```js
  const memoryLog = makeLogger(directory, {
    logDir: process.env.MAESTRO_MEMORY_LOG_DIR || log.logDir,
    filePrefix: "maestro-memory",
    filterEnv: "MAESTRO_MEMORY",
  });
```

В вызове `registerMemoryHooks` (~1189):

```js
      memoryHooks = await registerMemoryHooks({ client, config, log, memoryLog, root });
```

- [ ] **Step 4: Run to verify they pass**

Run: `node --test plugins/maestro-bootstrap/index.test.js`
Expected: PASS (все существующие + новый).

- [ ] **Step 5: Commit**
```bash
git add plugins/maestro-bootstrap/core.js plugins/maestro-bootstrap/index.test.js
git commit -m "feat(core): makeLogger logDir option + memoryLog (maestro-memory file)"
```

---

### Task 2: memory/index.js — `memoryLog` проброс + хелперы + carve-out

**Files:**
- Modify: `plugins/maestro-bootstrap/memory/index.js`
- Test: `plugins/maestro-bootstrap/memory/index.test.js`

**Interfaces:**
- Consumes: `memoryLog` (Task 1); `state` (существующий).
- Produces: `registerMemoryHooks({ …, memoryLog })`; хелперы `logInfo/logDebug/logWarn/logError` → `memoryLog ?? log`; carve-out для `memory: disabled`/`init failed`; существующие события переведены на хелперы.

- [ ] **Step 1: Падающие тесты** в `index.test.js`:

```js
test("memory events go to memoryLog when passed; bootstrap log stays clean (anti-dup)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mm-log-"));
  const cfg = { memory: { enabled: true, storage: { type: "sqlite" } } };
  const memoryLog = makeLogger(dir, { filePrefix: "maestro-memory", filterEnv: "MAESTRO_MEMORY" });
  const log = makeLogger(dir, { filePrefix: "maestro-bootstrap", filterEnv: "MAESTRO_BOOTSTRAP" });
  await registerMemoryHooks({ client: mkClient(), config: cfg, log, memoryLog, root: dir, deps: { storage: mkStorage(), embeddings: fakeEmbedder() } });
  const memFiles = readdirSync(path.join(dir, ".maestro/logs")).filter((f) => f.includes("maestro-memory"));
  // события probe пишутся в memory-лог
  assert.ok(memFiles.length > 0);
});
// анти-дубликат: probe-событие НЕ в bootstrap-логе, когда memoryLog передан
test("memory: disabled stays in bootstrap log (carve-out)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mm-off-"));
  const log = makeLogger(dir, { filePrefix: "maestro-bootstrap", filterEnv: "MAESTRO_BOOTSTRAP" });
  const memoryLog = makeLogger(dir, { filePrefix: "maestro-memory", filterEnv: "MAESTRO_MEMORY" });
  await registerMemoryHooks({ client: mkClient(), config: { memory: { enabled: false } }, log, memoryLog, root: dir });
  const boot = readLogs(dir, "maestro-bootstrap").join("\n");
  assert.ok(boot.includes("memory: disabled"), "carve-out: disabled остаётся в bootstrap-логе");
});
```
> `readLogs`/`makeLogger`/`mkdtempSync` — существующие хелперы index.test.js (readLogs определён на ~8).

- [ ] **Step 2: Run to verify they fail**

Run: `node --test plugins/maestro-bootstrap/memory/index.test.js`
Expected: FAIL (memoryLog не принимается/события не пишутся в memory-файл).

- [ ] **Step 3: Реализовать в `memory/index.js`**

Сигнатура + хелперы:

```js
export async function registerMemoryHooks({ client, config: maestroConfig, log, memoryLog = null, root, deps = {} }) {
  const memLog = memoryLog ?? log;
  const logInfo = (msg, extra) => memLog?.info?.(msg, extra);
  const logDebug = (msg, extra) => memLog?.debug?.(msg, extra);
  const logWarn = (msg, extra) => memLog?.warn?.(msg, extra);
  const logError = (msg, extra) => memLog?.error?.(msg, extra);
```

Carve-out: существующие `log?.info?.("memory: disabled", …)` → остаются на `log` (НЕ на memLog):

```js
  if (!config.enabled) {
    if (maestroConfig?.memory && config.disabled_reason) {
      log?.info?.("memory: disabled", { reason: config.disabled_reason }); // carve-out: bootstrap-лог
    }
    return {};
  }
```
> Аналогично: `embedding_api_key_env_missing`, `qdrant_config_invalid`, `pgvector_config_invalid`, `embedder_probe_hard_fail`-disabled — остаются на `log` (они «memory: disabled»-семейство). Остальные события (probe, warn-диагностики, retention, promotion, mainline, state.corrupt, storage.stats, forgotten) — через хелперы (`memLog`).

`log_confidential_note` — после `external_embedder_unmasked_queries` (openai + confidential.paths):

```js
    if (maestroConfig?.confidential?.paths?.length > 0) {
      logWarn("memory:log_confidential_note", {});
    }
```
> Логика: note при любом непустом confidential.paths (не только openai) — аудит-лог может покинуть машину через шеринг/бэкап; author/branch-корреляция. Если confidential.paths пусты — note не пишется.

Перевести на хелперы существующие: `unmasked_branch_metadata`, `external_embedder_unmasked_queries`, `mainline_unresolved` (init), `embedder probe OK/cached/soft/hard` (hard остаётся `return { tool: { memory_probe } }` + `log?.info?.("memory: disabled", …)` carve-out), `promotion failed`, retention prune, self-provisioning.

- [ ] **Step 4: Run to verify they pass** (все index.test.js + существующие)

Run: `node --test plugins/maestro-bootstrap/memory/index.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add plugins/maestro-bootstrap/memory/index.js plugins/maestro-bootstrap/memory/index.test.js
git commit -m "feat(memory): memoryLog threading + helpers + carve-out for disabled/init-failed"
```

---

### Task 3: indexer.js — lifecycle-события

**Files:**
- Modify: `plugins/maestro-bootstrap/memory/indexer.js`
- Test: `plugins/maestro-bootstrap/memory/indexer.test.js`

**Interfaces:**
- Consumes: `logInfo/…` передаются через конструктор `Indexer` (добавить `logInfo/logDebug/logWarn/logError` в параметры, default — заглушки); `config`, `state`.
- Produces: события spec §4.1: `indexed/reindexed/index_skipped/index_retryable/index_error/session_deleted/summarize.duration/backfill/backfill.done`.

- [ ] **Step 1: Падающие тесты** в `indexer.test.js` (по образцу существующих, с fake-логгером-шпионом):

```js
function captureLog() { const calls = []; return { calls, log: { info: (m, e) => calls.push(["info", m, e]), warn: (m, e) => calls.push(["warn", m, e]), error: (m, e) => calls.push(["error", m, e]), debug: (m, e) => calls.push(["debug", m, e]) } }; }

test("indexer logs indexed + summarize.duration on success", async () => {
  const cap = captureLog();
  const client = mkClient();
  const idx = new Indexer({
    client, config: mkConfig(), embeddings: { embed: async () => new Float32Array([0.1]), dim: 1, modelId: "m" },
    storage: mkStorage(client), state: mkState(),
    summarize: async () => ({ title: "t", summary: "s", decisions: [] }),
    projectKey: { hash: "khash", source: "remote" }, confidentialPatterns: [],
    logInfo: cap.log.info, logDebug: cap.log.debug, logWarn: cap.log.warn, logError: cap.log.error,
  });
  await idx._run("s1");
  assert.ok(cap.calls.some(([lvl, m]) => lvl === "info" && m === "memory:indexed"));
  assert.ok(cap.calls.some(([lvl, m]) => lvl === "debug" && m === "memory:summarize.duration"));
  idx.dispose();
});

test("indexer logs index_error with error_class (not message)", async () => {
  const cap = captureLog();
  const client = mkClient(); client.session.get = async () => { throw new Error("network"); };
  const idx = new Indexer({
    client, config: mkConfig(), embeddings: { embed: async () => new Float32Array([0.1]), dim: 1, modelId: "m" },
    storage: mkStorage(client), state: { ...mkState(), recordFail: async () => {} },
    summarize: async () => ({}), projectKey: { hash: "k", source: "remote" }, confidentialPatterns: [],
    logInfo: cap.log.info, logDebug: cap.log.debug, logWarn: cap.log.warn, logError: cap.log.error,
  });
  await idx._run("s1");
  const err = cap.calls.find(([lvl, m]) => m === "memory:index_error");
  assert.ok(err, "index_error logged");
  assert.ok(!JSON.stringify(err).includes("network"), "error message NOT in log (enum only)");
  idx.dispose();
});
```
> `error_class` для `_run`-catch: `err?.retryable ? "retryable" : "storage"` (или "indexer"); фиксировать enum.

- [ ] **Step 2: Run to verify they fail**

Run: `node --test plugins/maestro-bootstrap/memory/indexer.test.js`
Expected: FAIL (нет событий).

- [ ] **Step 3: Реализовать в `indexer.js`**

Конструктор: принять `logInfo/logDebug/logWarn/logError` (default `() => {}`); присвоить. В `_run`:
- после успешного upsert: `this.logInfo?.("memory:indexed", { sessionID, projectKey: this.projectKey.hash, author, version: maskedEntry.version })` (reindexed если `existing` — `version > 1` → `memory:reindexed`);
- `summarize.duration`: обернуть `this.summarize` в замер (Date.now), `this.logDebug?.("memory:summarize.duration", { sessionID, duration_ms, model })`;
- catch: `this.logError?.("memory:index_error", { sessionID, error_class: err?.retryable ? "retryable" : "storage" })`; при `err?.retryable` → `this.logDebug?.("memory:index_retryable", { sessionID })`; при recordFail-пути (3+ fails) → `this.logWarn?.("memory:index_skipped", { sessionID, fails })` (в `isSkipped`-ветке или после recordFail, если fails>=3);
- `onSessionDeleted`: `this.logInfo?.("memory:session_deleted", { sessionID })`.
- `backfill`/`backfill.done`: в цикле backfill (см. `_run`-вызовы/таймер) — `memory:backfill` { considered, indexed, skipped } и `memory:backfill.done` { duration_ms } (по завершении окна; для debounce — логировать по факту завершения очередной пачки).

> Точная реализация backfill-механики — по существующему коду indexer.js (backfill-окно/таймер); события добавляются там, где известны счётчики considered/indexed/skipped.

- [ ] **Step 4: Run to verify they pass**

Run: `node --test plugins/maestro-bootstrap/memory/indexer.test.js`
Expected: PASS (все + новые).

- [ ] **Step 5: Commit**
```bash
git add plugins/maestro-bootstrap/memory/indexer.js plugins/maestro-bootstrap/memory/indexer.test.js
git commit -m "feat(memory): indexer lifecycle events (indexed/reindexed/skipped/error/duration/backfill)"
```

---

### Task 4: recall.js — effectiveness-события

**Files:**
- Modify: `plugins/maestro-bootstrap/memory/recall.js`
- Test: `plugins/maestro-bootstrap/memory/recall.test.js`

**Interfaces:**
- Consumes: `logInfo/logDebug/logWarn` (через конструктор, default `() => {}`).
- Produces: `recall.duration`, `recall.hits`, `recall.injected`, `search.no_hits` (reason enum).

- [ ] **Step 1: Падающие тесты** в `recall.test.js`:

```js
test("recall logs injected/hits/duration and no_hits reasons", async () => {
  const calls = [];
  const log = { info: (m, e) => calls.push(["info", m, e]), debug: (m, e) => calls.push(["debug", m, e]), warn: (m, e) => calls.push(["warn", m, e]) };
  const embedder = { embed: async () => new Float32Array([0.1, 0.2, 0.3]), dim: 3, modelId: "m" };
  const storage = { search: async () => [{ entry: { session_id: "old1", title: "t", time_last: 1, author: "a", summary: "s", decisions: [] }, score: 0.8 }] };
  const r = new Recall({ embeddings: embedder, storage, topK: 3, minScore: 0.35, key: "p", getUserMessageCount: async () => 1, logInfo: log.info, logDebug: log.debug, logWarn: log.warn });
  await r.onChatMessage({ sessionID: "s1", text: "hi" });
  assert.ok(calls.some(([lvl, m]) => lvl === "debug" && m === "memory:recall.duration"));
  assert.ok(calls.some(([lvl, m]) => lvl === "debug" && m === "memory:recall.hits"));
  const sys = await r.systemBlock({ sessionID: "s1" });
  assert.ok(calls.some(([lvl, m]) => lvl === "info" && m === "memory:recall.injected"));
});
test("recall no_hits logs reason enum", async () => {
  const calls = [];
  const log = { info: () => {}, debug: () => {}, warn: (m, e) => calls.push([m, e]) };
  const embedder = { embed: async () => new Float32Array([0.1]), dim: 3, modelId: "m" };
  const storage = { search: async () => [] };
  const r = new Recall({ embeddings: embedder, storage, topK: 3, minScore: 0.35, key: "p", getUserMessageCount: async () => 1, logInfo: log.info, logDebug: log.debug, logWarn: log.warn });
  await r.onChatMessage({ sessionID: "s1", text: "hi" });
  assert.ok(calls.some(([m, e]) => m === "memory:search.no_hits" && (e.reason === "min_score" || e.reason === "no_candidates")));
});
```
> Причины no_hits (enum): `no_candidates` (branch-scope: кандидаты пусты), `mainline_unresolved` (flat), `min_score` (хиты есть, но < порога), `fts_empty`. Логировать в `onChatMessage`, когда hits пуст.

- [ ] **Step 2: Run to verify they fail**

Run: `node --test plugins/maestro-bootstrap/memory/recall.test.js`
Expected: FAIL.

- [ ] **Step 3: Реализовать в `recall.js`**

Конструктор: `logInfo/logDebug/logWarn` (default noop). В `onChatMessage`:
- обернуть embed+search в замер; `logDebug("memory:recall.duration", { duration_ms, hits: hits.length, topK, minScore, scope })`;
- `logDebug("memory:recall.hits", { hits: hits.length })`;
- если `hits.length === 0` → `logWarn("memory:search.no_hits", { reason })` (резолв причины по веткам из существующей логики).
В `systemBlock`: при ненулевом hits → `logInfo("memory:recall.injected", { records: hits.length })` (один раз на вызов; per-turn дубли — задокументировать в docs, Task 8).

- [ ] **Step 4: Run to verify they pass**

Run: `node --test plugins/maestro-bootstrap/memory/recall.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add plugins/maestro-bootstrap/memory/recall.js plugins/maestro-bootstrap/memory/recall.test.js
git commit -m "feat(memory): recall effectiveness events (injected/hits/no_hits/duration)"
```

---

### Task 5: embedder-события (local + openai)

**Files:**
- Modify: `plugins/maestro-bootstrap/memory/embeddings.js`
- Modify: `plugins/maestro-bootstrap/memory/embeddings-openai.js`
- Test: `plugins/maestro-bootstrap/memory/embeddings.test.js`, `embeddings-openai.test.js`

**Interfaces:**
- Consumes: `logDebug/logWarn/logInfo` через конструктор (default noop).
- Produces: `embed.duration` (local — без cache_hit; openai — с cache_hit), `embed.cache_stats` (openai), `http.error` (openai).

- [ ] **Step 1: Падающие тесты**:

`embeddings.test.js`:
```js
test("local embed logs duration without cache_hit", async () => {
  const calls = [];
  const log = { debug: (m, e) => calls.push([m, e]) };
  const e = new Embedder({ model: "x", cacheDir: "/tmp/x", _pipeline: fakePipeline(), _dim: 3, moduleDir: "/tmp/m", _importImpl: async () => ({}), logDebug: log.debug });
  await e.embed("hi");
  const ev = calls.find(([m]) => m === "memory:embed.duration");
  assert.ok(ev);
  assert.equal(ev[1].provider, "local");
  assert.equal("cache_hit" in ev[1], false);
});
```

`embeddings-openai.test.js`:
```js
test("openai embed logs duration with cache_hit and cache_stats", async () => {
  const calls = [];
  const log = { debug: (m, e) => calls.push([m, e]), info: (m, e) => calls.push([m, e]) };
  const fetchImpl = fakeFetch(async () => okRes());
  const e = new OpenAiEmbedder({ model: "m", baseUrl: "https://x/v1", apiKey: "k", dim: 3, fetchImpl, logDebug: log.debug, logInfo: log.info });
  await e.embed("q");
  const dur = calls.find(([m]) => m === "memory:embed.duration");
  assert.ok(dur);
  assert.equal(dur[1].provider, "external");
  assert.equal(dur[1].cache_hit, false);
});
test("openai http.error logs status_class enum, not body", async () => {
  const calls = [];
  const log = { warn: (m, e) => calls.push([m, e]) };
  const fetchImpl = fakeFetch(async () => ({ ok: false, status: 503, statusText: "Busy", text: async () => "top secret body" }));
  const e = new OpenAiEmbedder({ model: "m", baseUrl: "https://x/v1", apiKey: "k", dim: 3, fetchImpl, logWarn: log.warn });
  await assert.rejects(() => e.embed("hi"));
  const ev = calls.find(([m]) => m === "memory:http.error");
  assert.ok(ev);
  assert.ok(!JSON.stringify(ev).includes("secret body"), "HTTP body NOT in log");
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test plugins/maestro-bootstrap/memory/embeddings.test.js plugins/maestro-bootstrap/memory/embeddings-openai.test.js`
Expected: FAIL.

- [ ] **Step 3: Реализовать**

`embeddings.js` — конструктор `logDebug` (default noop); в `embed` замерить duration:
```js
    const t0 = Date.now();
    // ... существующий код (init/embed/return) ...
    this.logDebug?.("memory:embed.duration", { provider: "local", duration_ms: Date.now() - t0, len_bucket: bucket(text.length) });
```
> `bucket(len)` — хелпер биннинга (spec §3: `<100`, `100-500`, `500-2000`, `>2000`). Разместить в embeddings.js (export) или общий в index.js. Логировать в `embed` при успехе и в `probe`-вызове? Только embed (probe — отдельно).

`embeddings-openai.js` — конструктор `logDebug/logWarn/logInfo`; в `embed`: duration + cache_hit (из кэш-хита); после успешного embed при cache.size статистике → `logInfo("memory:embed.cache_stats", { hit_rate, cache_size })` (вычислять при каждой вставке или раз в N — упрощённо при каждом embed в info? Для info-уровня — раз в N вставок (напр. каждые 10) или только при debug; выбрать: cache_stats пишется каждые 10 embed-вызовов (счётчик), чтобы не шуметь). В `_post`/`embed` при не-ok 5xx → `logWarn("memory:http.error", { http_status_class: "5xx", retryable: true })`; 401/403 → `http_status_class: "auth"`; timeout/network → `error_class: "network"`.

- [ ] **Step 4: Run to verify they pass**

Run: `node --test plugins/maestro-bootstrap/memory/embeddings.test.js plugins/maestro-bootstrap/memory/embeddings-openai.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add plugins/maestro-bootstrap/memory/embeddings.js plugins/maestro-bootstrap/memory/embeddings-openai.js plugins/maestro-bootstrap/memory/embeddings.test.js plugins/maestro-bootstrap/memory/embeddings-openai.test.js
git commit -m "feat(memory): embedder events (embed.duration, cache_stats, http.error)"
```

---

### Task 6: storage-события (log threading + timed)

**Files:**
- Modify: `plugins/maestro-bootstrap/memory/storage.js`
- Modify: `plugins/maestro-bootstrap/memory/storage/{sqlite,qdrant,pgvector}.js`
- Test: `plugins/maestro-bootstrap/memory/storage.test.js`

**Interfaces:**
- Consumes: `log` (через `createStorage({ …, log })` → options бэкендов).
- Produces: `timed(log, tag, fn)`-хелпер; `storage.<op>.duration` (debug), `storage.error` (error, error_class), `cross_project_miss` (debug), `storage_init`/`storage_mismatch` (в Task 2 или здесь — storage_init/mismatch в index.js при createStorage; здесь — op-события).

- [ ] **Step 1: Падающие тесты** в `storage.test.js`:

```js
test("storage search logs duration and errors with class", async () => {
  const calls = [];
  const log = { debug: (m, e) => calls.push([m, e]), error: (m, e) => calls.push([m, e]) };
  const st = createStorage({ type: "sqlite", options: { dbPath: ":memory:", log }, modelId: "m", dim: 3 });
  await st.init();
  await st.search(new Float32Array([0.1, 0.2, 0.3]), { top_k: 3, min_score: 0.3, key: "k" });
  assert.ok(calls.some(([m]) => m === "memory:storage.search.duration"));
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test plugins/maestro-bootstrap/memory/storage.test.js`
Expected: FAIL.

- [ ] **Step 3: Реализовать**

`storage.js`:
```js
export function createStorage({ type, options, modelId, dim, textSearchConfig, log }) {
  const opts = { ...options, log };
  switch (type) {
    case "sqlite": return new SqliteStorage({ ...opts, modelId, dim });
    case "qdrant": return new QdrantStorage({ client: opts.client, collection: opts.collection, modelId, dim, log });
    case "pgvector": return new PgVectorStorage({ pool: opts.pool, table: opts.table, dim, modelId, textSearchConfig, log });
  }
}
```

`timed`-хелпер (storage.js, export):
```js
export function timed(log, tag, fn) {
  const t0 = Date.now();
  return Promise.resolve()
    .then(fn)
    .then((r) => { log?.debug?.(`memory:storage.${tag}.duration`, { op: tag, duration_ms: Date.now() - t0 }); return r; })
    .catch((err) => { log?.error?.("memory:storage.error", { op: tag, error_class: err?.code === "DIM_MISMATCH" ? "dim_mismatch" : "storage_error" }); throw err; });
}
```
> Обернуть операции в бэкендах: sqlite/qdrant/pgvector `init/upsert/search/get/candidates/delete` (где уместно). `cross_project_miss` — в sqlite cross-project поиске (read-only соседняя БД недоступна/модель не совпала) → `log?.debug?.("memory:cross_project_miss", { reason: "model_mismatch" })`.

- [ ] **Step 4: Run to verify they pass**

Run: `node --test plugins/maestro-bootstrap/memory/storage.test.js`
Expected: PASS (все + новые; существующие — без регрессий).

- [ ] **Step 5: Commit**
```bash
git add plugins/maestro-bootstrap/memory/storage.js plugins/maestro-bootstrap/memory/storage/sqlite.js plugins/maestro-bootstrap/memory/storage/qdrant.js plugins/maestro-bootstrap/memory/storage/pgvector.js plugins/maestro-bootstrap/memory/storage.test.js
git commit -m "feat(memory): storage op events (duration/error/cross_project_miss) + timed helper"
```

---

### Task 7: SEC-4b-тест + остальные события (index.js: forgotten/stats/state.corrupt)

**Files:**
- Modify: `plugins/maestro-bootstrap/memory/index.js` (storage_init/mismatch, storage.stats, memory:forgotten, state.corrupt, retention/promoted/mainline)
- Test: `plugins/maestro-bootstrap/memory/index.test.js` + новый SEC-4b-тест

**Interfaces:**
- Consumes: `memoryLog` (Task 1), хелперы (Task 2).
- Produces: `memory:forgotten`, `memory:storage.stats`, `memory:storage_init/mismatch`, `memory:state.corrupt`, `memory:retention_pruned`, `memory:promoted`, `memory:mainline_resolved/_unresolved`, и SEC-4b-тест.

- [ ] **Step 1: Падающие тесты**

```js
test("storage.stats logs entries + tier counts", async () => {
  const calls = [];
  const cfg = { memory: { enabled: true, storage: { type: "sqlite" } } };
  const hooks = await registerMemoryHooks({
    client: mkClient(), config: cfg, log: mkLog(), root: tmpdir(),
    deps: {
      storage: { ...mkStorage(), stats: async () => ({ entries: 5 }), candidates: async () => [{ merged: 1 }, { merged: 0, head: "abc" }] },
      embeddings: fakeEmbedder(),
    },
  });
  // storage.stats событие — при вызове триггера (периодический/backfill); см. реализацию
});
```
> Если `storage.stats` привязан к периодическому интервалу — тестировать через прямой вызов хелпера/эмиттера. Реализация: эмитить в backfill-цикле (после окна) + при `memory_stats_detail`? Нет — только в backfill/interval, чтобы не зависеть от запросов. Уточнить в реализации.

```js
test("SEC-4b: memory log contains no record text, paths, base_url, raw branch", async () => {
  // Прогнать фикстуры: indexer с реальными (замаскированными) данными, recall, storage — собрать maestro-memory-*.log
  // и assert: ни одна строка не содержит фрагментов title/summary/query, "docs/confidential", "https://", "PROJ-123".
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test plugins/maestro-bootstrap/memory/index.test.js`
Expected: FAIL.

- [ ] **Step 3: Реализовать в `index.js`**

- `memory:forgotten`: в `memory_forget` execute, после `storage.deleteByFilter` → `logInfo("memory:forgotten", { count, filters })` (filters — enum-имена переданных фильтров).
- `memory:storage.stats`: в backfill-цикле после окна: `const s = await storage.stats(); const cands = await storage.candidates(effectiveKey); logInfo("memory:storage.stats", { entries: s.entries, merged: count(merged==1), experience: count(head != '' && merged == 0) })`.
- `storage_init`: после `storage.init()` → `logInfo("memory:storage_init", { type: config.storage.type })`; `storage_mismatch` — при ошибке init (model/dim mismatch) → `logError("memory:storage_mismatch", { type, model, dim_expected, dim_actual })` (model — имя без @base_url; из ошибки storage).
- `state.corrupt`: при `createState` parse-fallback — в state.js нет логирования; в index.js после `createState` (или передать log в createState) → если parse-fallback и файл существовал → `logWarn("memory:state.corrupt", { reason: "parse_error" })`; ENOENT (первый запуск) → не варн. Реализация: `createState` возвращает флаг `{ corrupt: bool }` или логирует через переданный log; выбрать: передать `log` в `createState(path, { log })`, ENOENT → нет warn, parse-error → warn.
- `retention_pruned`: уже логируется (index.js:965) → перевести на `logInfo`.
- `promoted`: в промоушен-цикле (после markMerged) → `logInfo("memory:promoted", { count, branches: [...normalized], mainline })`.
- `mainline_resolved/_unresolved`: при detectMainline → `logInfo("memory:mainline_resolved", { branch: normalized })` / `logWarn("memory:mainline_unresolved", {})`.
- **branch-нормализация:** хелпер `normalizeBranch(name)` — `name.replace(/[A-Z]{1,4}-\d+/g, "*")` (экспорт из index.js или отдельный util); применять ко всем branch-полям событий.

- [ ] **Step 4: Run to verify they pass**

Run: `node --test plugins/maestro-bootstrap/memory/index.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add plugins/maestro-bootstrap/memory/index.js plugins/maestro-bootstrap/memory/index.test.js plugins/maestro-bootstrap/memory/state.js
git commit -m "feat(memory): forgotten/stats/init/mismatch/state.corrupt events + SEC-4b test + branch normalization"
```

---

### Task 8: Синхронизация документации

**Files:**
- Modify: `SECURITY.md` §5a
- Modify: `manual_docs/reference/memory.md` (Логирование + Оценка эффективности)
- Modify: `manual_docs/how-to/enable-memory.md` (диагностика логов)
- Modify: `manual_docs/reference/config.md` (env `MAESTRO_MEMORY_LOG_*`)
- Modify: `commands/maestro-memory.md` (файл лога)
- Modify: `manual_docs/overview/changelog.md`
- Modify: `docs/project-context.md` (§3 bullet)

**Interfaces:**
- Consumes: spec §3/§4/§6/§7.

- [ ] **Step 1: `SECURITY.md` §5a** — добавить пункт «Логирование memory layer»: отдельный файл `maestro-memory-<дата>.log`; aggregates-only field whitelist (spec §3): без текста записей/запросов, путей, тел ошибок (enum-only), `base_url`/эндпоинтов, raw branch (нормализуется); `.maestro/` gitignored (по умолчанию не покидает машину), doc-note при непустых `confidential.paths` (`memory:log_confidential_note`); hard-disable не вводится (аудит confidential-проектов); env `MAESTRO_MEMORY_LOG_LEVEL/_MASK/_DIR`.

- [ ] **Step 2: `manual_docs/reference/memory.md`** — секции:
- **«Логирование»:** файл, env, уровни, события (ссылка на spec §4), field whitelist, биннинг `len`, нормализация branch.
- **«Оценка эффективности»** (память vs файлы): что смотреть — `recall.injected` (>0, растёт → память работает), `recall.hits`, `backfill` (considered/indexed/skipped), `storage.stats` (entries + merged/experience), `reindexed`/`promoted`; чек-лист «память работает / молчит / дорогая»; сравнение с файлами (память даёт исторический контекст сверх статического).

- [ ] **Step 3: `manual_docs/how-to/enable-memory.md`** — подраздел «Логирование и диагностика»: где файл, греп по sessionID/`duration_ms`/`no_hits`, поднятие уровня `MAESTRO_MEMORY_LOG_LEVEL=debug` для root-cause-событий (`fts.fallback`, `index_retryable`), интерпретация `search.no_hits` (причины), определение проблем (no_hits-причины, coverage, латентность).

- [ ] **Step 4: `manual_docs/reference/config.md`** — env-секция (рядом с `MAESTRO_BOOTSTRAP_LOG_LEVEL` ~706): `MAESTRO_MEMORY_LOG_LEVEL` (default info), `MAESTRO_MEMORY_LOG_MASK`, `MAESTRO_MEMORY_LOG_DIR`.

- [ ] **Step 5: `commands/maestro-memory.md`** — в диагностике упомянуть файл лога `maestro-memory-<дата>.log` (аудит/эффективность/root-cause).

- [ ] **Step 6: `manual_docs/overview/changelog.md`** — запись о фиче.

- [ ] **Step 7: `docs/project-context.md`** — §3 memory layer bullet: «аудит-лог memory layer (отдельный `maestro-memory-<дата>.log`, aggregates-only whitelist, env `MAESTRO_MEMORY_LOG_*`)».

- [ ] **Step 8: Smoke** — `node --test plugins/maestro-bootstrap/index.test.js`
Expected: PASS.

- [ ] **Step 9: Commit**
```bash
git add SECURITY.md manual_docs commands/maestro-memory.md docs/project-context.md
git commit -m "docs: memory layer audit log — SECURITY.md, manual_docs, config env, changelog"
```

---

### Task 9: Полная верификация

- [ ] **Step 1:** `npm test` → PASS (174+).
- [ ] **Step 2:** `npm run test:memory` → PASS.
- [ ] **Step 3:** `node --check` изменённых файлов.
- [ ] **Step 4:** Regression-сценарии (из шапки плана).