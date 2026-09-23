# Memory Fail-Loud + Восстановление по Требованию (#77) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** «Громкий» fail-closed memory layer: уведомление в сессию при потере данных индексирования (per-session + process-level) и восстановление отсутствующих/stale записей одной HITL-командой (`memory_reindex` full-reindex со сбросом permanent-skip).

**Architecture:** (1) `state.js` получает `clearSkip`/`unindexed()`/`recordFail(id, errorClass)`; (2) `indexer._run` декомпозируется на guards + `_pipeline` (стадии с поимённой классификацией ошибок §4.1), который вызывают и `_run` (с guards), и новый `reindexSession` (без guards, синхронно для tool'а); (3) `index.js` владеет bounded unsaved-реестром и инжектит notice через `experimental.chat.system.transform` (независимо от `auto_recall`), а «тихие off»-пути init возвращают сокращённый набор хуков с process-level notice; (4) `memory_reindex` (explicit session_ids) диспатчит по временному критерию N1: актуальная запись → artifacts top-up (0 LLM), stale/отсутствующая → `reindexSession` + post-fact-статус; (5) `memory_stats_detail` показывает блок «не индексированные сессии».

**Tech Stack:** Node.js ESM, `node:test` + `node:assert/strict`, без внешних зависимостей (memory-модуль `plugins/maestro-bootstrap/memory/`).

**Spec:** `docs/superpowers/specs/2026-09-23-memory-fail-loud-design.md` (rev.5, approved; читать вместе с планом).

## Global Constraints

- Версия: 4.7.0 → **4.7.1** (Wave 1, 4.7.x по `docs/roadmap.md`); bump — только Task 9.
- Новых ключей `maestro.json` **нет** (уведомление — always-on, spec §6).
- `SECURITY.md` **не изменяется** (данные не переносятся, spec §8).
- `memory/backfill.js` **не меняется** (artifacts-путь — регрессия, spec §3).
- SEC-4b: логи/уведомления/статусы — только enum-классы и числа (session_id допустим — паритет существующего вывода); тела ошибок, тексты сессий, пути — наружу не уходят.
- Все hook-функции — `try/catch`-guarded, fail-soft (ошибка → без инъекции, без броска наружу).
- Retryable-ошибки (`.retryable === true`, сеть/5xx embedder) — **не** съедают страйки и **не** ставят unsaved-флаг (регрессия, `indexer.js:383-385`).
- Тесты: `npm run test:memory` и `npm test` — 0 fail после каждого task.
- Язык user-facing текстов (notice, статусы, доки) — русский.

## Review Focus

1. **Бэкенд упал в середине дня** (upsert throw × 3 → permanent-skip) — пользователь должен видеть notice в живой сессии (не в логе) и восстановить запись `memory_reindex` (full-reindex снимает skip). Покрыто: Task 5 (notice), Task 8 (E2E восстановление).
2. **`auto_recall: false`** — notice-хук обязан работать (I1); существующий M2-тест (`index.test.js`, «auto_recall false → no … hooks», ~строка 376) утверждает `transform === undefined` — его СЕМАНТИКА меняется: hook существует (notice-only), recall-блок не инжектится. Покрыто: Task 5, шаг 2.
3. **Свежий `lastAttempt`** (только что страйк, retry-throttle `retry_interval_min=60` активен) — `reindexSession` не гардится throttle'ом (C1): иначе восстановление «потерянной» сессии будет молча проглатывано. Покрыто: Task 4, тест T4-1.
4. **После `clearSkip` + ровно один новый страйк** — `memory:index_skipped` НЕ возникает (локальное зеркало `indexer._fails` сброшено, F5): иначе warn сработает при state=1. Покрыто: Task 4, тест T4-5.
5. **Retryable embed-ошибка** — флага **нет**, страйка **нет** (регрессия `indexer.test.js:184`). Покрыто: Task 3, тест T3-3.

## Файловая карта

| Файл | Task | Ответственность |
|---|---|---|
| `plugins/maestro-bootstrap/memory/state.js` | 1 | `recordFail(id, errorClass)`, `clearSkip(id)`, `unindexed()` |
| `plugins/maestro-bootstrap/memory/state.test.js` | 1 | тесты state |
| `plugins/maestro-bootstrap/memory/indexer.js` | 2, 3, 4 | `_pipeline`, классификация ошибок, `reindexSession` |
| `plugins/maestro-bootstrap/memory/indexer.test.js` | 2, 3, 4 | тесты индексирования |
| `plugins/maestro-bootstrap/memory/index.js` | 5, 6, 7 | unsaved-реестр, notice-хуки, off-пути, reindex-диспатч, stats-блок |
| `plugins/maestro-bootstrap/memory/index.test.js` | 5, 6, 7, 8 | интеграционные тесты |
| `commands/maestro-memory.md`, `commands/maestro-memory-reindex.md` | 9 | сценарии |
| `manual_docs/`, `AGENTS.md`, `changelog.md`, `package.json`, `regression/entries/` | 9 | доки + регресс-реестр + версия |

---

### Task 1: `state.js` — `recordFail(id, errorClass)`, `clearSkip(id)`, `unindexed()`

**Model:** haiku (механическая трансляция, 1 файл + тесты)

**Files:**
- Modify: `plugins/maestro-bootstrap/memory/state.js:49-56` (recordFail), после `:72` (add clearSkip/unindexed)
- Test: `plugins/maestro-bootstrap/memory/state.test.js`

**Interfaces:**
- Consumes: ничего нового (внутренности `createState`).
- Produces (используют Task 3-7):
  - `state.recordFail(id, errorClass?)` — как сейчас + хранит `lastErrorClass` (если `errorClass != null`).
  - `state.clearSkip(id)` — `skip=false, fails=0, lastAttempt=null` (no-op если записи нет).
  - `state.unindexed()` → `Promise<Array<{ id, fails, skip, lastAttempt, lastSummarized, lastErrorClass }>>` — **временной** критерий (spec N1): `skip === true` **или** (`lastAttempt != null` и (`lastSummarized == null` или `lastAttempt > lastSummarized`)). Самовосстановившаяся сессия (`lastSummarized > lastAttempt`) — **не** в списке, даже с персистентным `fails > 0`.

- [ ] **Step 1: Write the failing tests**

В конец `plugins/maestro-bootstrap/memory/state.test.js` (импорты уже есть: `createState`, `mkdtempSync`, `tmpdir`, `join`, `rmSync`, `assert`):

```js
test("#77: recordFail(id, errorClass) stores lastErrorClass", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mem-"));
  const st = createState(join(dir, "state.json"));
  await st.recordFail("s1", "storage_error");
  const u = await st.unindexed();
  assert.equal(u.length, 1);
  assert.equal(u[0].id, "s1");
  assert.equal(u[0].fails, 1);
  assert.equal(u[0].skip, false);
  assert.equal(u[0].lastErrorClass, "storage_error");
  assert.ok(u[0].lastAttempt > 0);
  rmSync(dir, { recursive: true, force: true });
});

test("#77: recordFail без errorClass — lastErrorClass null (backward compat)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mem-"));
  const st = createState(join(dir, "state.json"));
  await st.recordFail("s1");
  const u = await st.unindexed();
  assert.equal(u[0].lastErrorClass, null);
  rmSync(dir, { recursive: true, force: true });
});

test("#77: clearSkip resets skip/fails/lastAttempt (C1)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mem-"));
  const st = createState(join(dir, "state.json"));
  await st.recordFail("s1"); await st.recordFail("s1"); await st.recordFail("s1");
  assert.equal(await st.isSkipped("s1"), true);
  await st.clearSkip("s1");
  assert.equal(await st.isSkipped("s1"), false);
  assert.equal(await st.getLastAttempt("s1"), null, "lastAttempt сброшен в null (C1: throttle не блокирует повтор)");
  assert.equal((await st.unindexed()).length, 0);
  await st.clearSkip("nope"); // no-op, без броска
  rmSync(dir, { recursive: true, force: true });
});

test("#77: unindexed() — временной критерий (N1)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mem-"));
  const st = createState(join(dir, "state.json"));
  // самовосстановившаяся: lastSummarized ПОСЛЕ lastAttempt → НЕ в списке (даже fails>0)
  await st.recordFail("healed");
  await st.setSummarized("healed");
  // stale: lastAttempt ПОСЛЕ lastSummarized → в списке
  await st.setSummarized("stale");
  await st.recordFail("stale");
  // permanent-skip → в списке
  await st.recordFail("skip3"); await st.recordFail("skip3"); await st.recordFail("skip3");
  // чистая → не в списке
  await st.setSummarized("clean");
  const ids = (await st.unindexed()).map((x) => x.id).sort();
  assert.deepEqual(ids, ["skip3", "stale"]);
  rmSync(dir, { recursive: true, force: true });
});

test("#77: unindexed() — lastAttempt без lastSummarized (запись не создавалась) → в списке", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mem-"));
  const st = createState(join(dir, "state.json"));
  await st.recordFail("fresh-fail", "embedder_error");
  const u = (await st.unindexed());
  assert.equal(u.length, 1);
  assert.equal(u[0].lastSummarized, null);
  assert.equal(u[0].lastErrorClass, "embedder_error");
  rmSync(dir, { recursive: true, force: true });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test plugins/maestro-bootstrap/memory/state.test.js 2>&1 | tail -20`
Expected: FAIL — `st.unindexed is not a function` / `st.clearSkip is not a function`.

- [ ] **Step 3: Implement in `state.js`**

В `createState` заменить `recordFail` (строки 49-56) на:

```js
    async recordFail(id, errorClass) {
      const s = data.sessions[id] ?? {};
      s.fails = (s.fails ?? 0) + 1;
      s.lastAttempt = Date.now();
      if (errorClass != null) s.lastErrorClass = errorClass;
      if (s.fails >= 3) s.skip = true;
      data.sessions[id] = s;
      persist();
    },
```

После `prune` (строка ~72) добавить:

```js
    /**
     * #77 (spec §5.1): сброс permanent-skip и throttle-якоря. Вызывается ТОЛЬКО
     * внутри full-reindex по явном session_id (indexer.reindexSession) —
     * авто-сбросов нет. lastAttempt → null (C1): иначе следующий штатный _run
     * уйдёт по retry-throttle (retry_interval_min) молча. No-op без записи.
     */
    async clearSkip(id) {
      const s = data.sessions[id];
      if (!s) return;
      s.skip = false;
      s.fails = 0;
      s.lastAttempt = null;
      persist();
    },
    /**
     * #77 (spec §5.2, N1): неиндексированные сессии — ВРЕМЕННОЙ критерий:
     * skip === true ИЛИ (lastAttempt != null И (lastSummarized == null ИЛИ
     * lastAttempt > lastSummarized)). Самовосстановившаяся сессия
     * (lastSummarized > lastAttempt) — НЕ в списке, даже с персистентным
     * fails > 0 (setSummarized не сбрасывает fails).
     * @returns {Promise<Array<{ id: string, fails: number, skip: boolean,
     *   lastAttempt: number|null, lastSummarized: number|null,
     *   lastErrorClass: string|null }>>}
     */
    async unindexed() {
      const out = [];
      for (const [id, s] of Object.entries(data.sessions)) {
        const stale = s.skip === true ||
          (s.lastAttempt != null && (s.lastSummarized == null || s.lastAttempt > s.lastSummarized));
        if (!stale) continue;
        out.push({
          id,
          fails: s.fails ?? 0,
          skip: Boolean(s.skip),
          lastAttempt: s.lastAttempt ?? null,
          lastSummarized: s.lastSummarized ?? null,
          lastErrorClass: s.lastErrorClass ?? null,
        });
      }
      return out;
    },
```

Обновить JSDoc-сигнатуру `createState` (блок `@returns`, строки ~12-23): добавить `clearSkip(id): Promise<void>`, `unindexed(): Promise<Array<object>>`, поменять `recordFail(id)` → `recordFail(id, errorClass?)`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test plugins/maestro-bootstrap/memory/state.test.js 2>&1 | tail -5`
Expected: PASS, 0 fail (включая все существующие тесты файла).

- [ ] **Step 5: Commit**

```bash
git add plugins/maestro-bootstrap/memory/state.js plugins/maestro-bootstrap/memory/state.test.js
git commit -m "feat(memory): state clearSkip/unindexed + recordFail errorClass (#77)"
```

---

### Task 2: `indexer.js` — декомпозиция `_run` → guards + `_pipeline` (чистый рефактор)

**Model:** opus (key task: переструктурировка конкурентного кода, guards/queue)

**Files:**
- Modify: `plugins/maestro-bootstrap/memory/indexer.js:176-409` (`_run`)
- Test: `plugins/maestro-bootstrap/memory/indexer.test.js` (регрессия — существующие тесты не трогаем)

**Interfaces:**
- Consumes: Task 1 не требуется (recordFail вызывается с одним аргументом — backward compat).
- Produces: `indexer._pipeline(sessionID)` → `Promise<{ status: string }>` где status ∈ `"ok" | "unattributed" | "no_new_messages" | "skip_service" | "failed:<class>"`. Поведение `_run` **не меняется** (все существующие тесты `indexer.test.js` зелёные без правок). `reindexSession` (Task 4) вызовет `_pipeline` напрямую.

**Семантика рефактора:**
- `_run` сохраняет ВСЕ guards как есть: queue dedup (`this.queue`), `this.running`, retry-throttle (`:186-191`), `isSkipped` (`:193`), `SESSIONS` (`:196`) — и `finally`-обработку queue/timers (`:396-408`).
- Всё после guards (session.get → parentID → messages → min_new → transcript → maskTranscript → key → withTimeout(work) → catch) переезжает в `_pipeline`.
- В `_pipeline` обработка ошибки — пока ТОЖДЕ (как сейчас: `error_class = err?.retryable ? "retryable" : "storage"`), но возвращается как `{ status: "failed:<class>" }` вместо void. Записи в лог — без изменений (`memory:index_error`, `memory:index_retryable`, `memory:index_skipped`, `memory:index_unattributed`, `memory:indexed`, `memory:reindexed`).
- `parentID`-выход в `_pipeline` → `{ status: "skip_service" }` (для `_run` игнорируется; Task 6 использует).
- `SESSIONS.has` в `_pipeline` НЕ дублируется (guard остаётся в `_run`; tool Task 6 пре-чекает сам — R2).

- [ ] **Step 1: Write the failing test (контракт `_pipeline`)**

В конец `plugins/maestro-bootstrap/memory/indexer.test.js` (хелперы `mkClient/mkStorage/mkConfig/mkState/mkGit` — в файле, строки 9-84):

```js
test("#77: _pipeline returns outcome statuses (refactor contract)", async () => {
  const client = mkClient();
  const storage = mkStorage(client);
  const idx = new Indexer({
    client, config: mkConfig(),
    embeddings: { embed: async () => new Float32Array([0.1]), dim: 1, modelId: "m" },
    storage, state: mkState(),
    summarize: async () => ({ title: "t", summary: "s", decisions: [] }),
    projectKey: { hash: "k", source: "remote" }, confidentialPatterns: [],
    git: mkGit(),
  });
  const ok = await idx._pipeline("s1");
  assert.equal(ok.status, "ok");
  assert.equal(client.upserts.length, 1, "record written");
  idx.dispose();
});

test("#77: _pipeline → unattributed (write-gate, head '')", async () => {
  const client = mkClient();
  const storage = mkStorage(client);
  const idx = new Indexer({
    client, config: mkConfig(),
    embeddings: { embed: async () => new Float32Array([0.1]), dim: 1, modelId: "m" },
    storage, state: mkState(),
    summarize: async () => ({ title: "t", summary: "s", decisions: [] }),
    projectKey: { hash: "k", source: "remote" }, confidentialPatterns: [],
    git: { resolveBranch: async () => "", resolveHead: async () => "" },
  });
  const r = await idx._pipeline("s1");
  assert.equal(r.status, "unattributed");
  assert.equal(client.upserts.length, 0);
  idx.dispose();
});

test("#77: _pipeline → no_new_messages (пустой транскрипт)", async () => {
  const client = mkClient(null); // messages: []
  const storage = mkStorage(client);
  const idx = new Indexer({
    client, config: mkConfig(),
    embeddings: { embed: async () => new Float32Array([0.1]), dim: 1, modelId: "m" },
    storage, state: mkState(),
    summarize: async () => ({ title: "t", summary: "s", decisions: [] }),
    projectKey: { hash: "k", source: "remote" }, confidentialPatterns: [],
    git: mkGit(),
  });
  const r = await idx._pipeline("s1");
  assert.equal(r.status, "no_new_messages");
  idx.dispose();
});

test("#77: _pipeline → skip_service (parentID)", async () => {
  const client = mkClient();
  client.session.get = async () => ({
    data: { id: "s1", parentID: "p1", title: "st", time: { created: 1, updated: 100 } },
  });
  const idx = new Indexer({
    client, config: mkConfig(),
    embeddings: { embed: async () => new Float32Array([0.1]), dim: 1, modelId: "m" },
    storage: mkStorage(client), state: mkState(),
    summarize: async () => ({}),
    projectKey: { hash: "k", source: "remote" }, confidentialPatterns: [],
  });
  const r = await idx._pipeline("s1");
  assert.equal(r.status, "skip_service");
  idx.dispose();
});

test("#77: _run delegates to _pipeline (regression: guards intact)", async () => {
  // throttle: свежий lastAttempt → _run НЕ доходит до _pipeline
  const client = mkClient();
  let pipelineCalls = 0;
  const storage = mkStorage(client);
  const idx = new Indexer({
    client, config: mkConfig({ retry_interval_min: 60 }),
    embeddings: { embed: async () => new Float32Array([0.1]), dim: 1, modelId: "m" },
    storage, state: {
      ...mkState(),
      getLastAttempt: async () => Date.now(), // свежий attempt
    },
    summarize: async () => ({}),
    projectKey: { hash: "k", source: "remote" }, confidentialPatterns: [],
  });
  const origPipeline = idx._pipeline.bind(idx);
  idx._pipeline = async (...a) => { pipelineCalls++; return origPipeline(...a); };
  await idx._run("s1");
  assert.equal(pipelineCalls, 0, "throttle guard не снят");
  idx.dispose();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test plugins/maestro-bootstrap/memory/indexer.test.js 2>&1 | tail -20`
Expected: FAIL — `idx._pipeline is not a function`.

- [ ] **Step 3: Рефактор `_run` в `_run` + `_pipeline`**

В `indexer.js` заменить метод `_run` (строки 176-409) на два метода — перенос существующего кода БЕЗ изменения логики:

```js
  async _run(sessionID) {
    // M3: queue dedup via Set
    if (this.queue.has(sessionID)) return;
    if (this.running) {
      this.queue.add(sessionID);
      return;
    }
    this.running = true;
    try {
      // I3: retry throttle
      let lastAttempt = undefined;
      if (this.state.getLastAttempt) {
        lastAttempt = await this.state.getLastAttempt(sessionID);
      }
      const retryInterval = (this.config.retry_interval_min ?? 60) * 60_000;
      if (lastAttempt != null && Date.now() - lastAttempt < retryInterval) return;

      if (await this.state.isSkipped(sessionID)) return;

      // I2: exclude maestro-memory sessions
      if (SESSIONS.has(sessionID)) return;

      await this._pipeline(sessionID);
    } finally {
      this.running = false;
      // M3: dedup when processing queue
      const next = [...this.queue].find((sid) => sid !== sessionID);
      if (next) {
        this.queue.delete(next);
        this._run(next).catch(() => {});
      } else {
        this.queue.clear();
      }
      const t = this.timers.get(sessionID);
      if (t) { clearTimeout(t); this.timers.delete(t); }
    }
  }

  /**
   * #77 (spec §5.1.1): пайплайн стадий штатного индексирования —
   * session.read → min_new → transcript → maskTranscript → write-gate →
   * summarize → maskEntry → embed → upsert → setSummarized.
   * _run вызывает его после guards; reindexSession (Task 4) — напрямую,
   * в обход running/queue/throttle-гардов.
   * @param {string} sessionID
   * @returns {Promise<{ status: string }>} "ok" | "unattributed" |
   *   "no_new_messages" | "skip_service" | "failed:<class>"
   */
  async _pipeline(sessionID) {
    try {
      const sessResp = await this.client.session.get({ path: { id: sessionID } });
      const sess = sessResp?.data ?? sessResp;
      if (sess?.parentID) return { status: "skip_service" };

      const msgResp = await this.client.session.messages({ path: { id: sessionID } });
      const messages = (msgResp?.data ?? msgResp) ?? [];

      // C-1: extract model from last assistant message — flat fields per SDK types
      let modelRef = null;
      for (let i = messages.length - 1; i >= 0; i--) {
        const info = messages[i]?.info ?? {};
        if (info.role === "assistant" && info.providerID && info.modelID) {
          modelRef = { providerID: info.providerID, modelID: info.modelID };
          break;
        }
      }

      // G1: min_new_messages check
      const lastSummarized = await this.state.getLastSummarized(sessionID);
      const minNew = this.config.min_new_messages ?? 3;
      if (lastSummarized != null && messages.length > 0) {
        const newCount = messages.filter((m) => {
          const tc = m.time_created ?? m.info?.time?.created ?? 0;
          return tc > lastSummarized;
        }).length;
        if (newCount < minNew) return { status: "no_new_messages" };
      }

      const transcript = messages
        .map((m) => (m.parts ?? []).map((p) => p.type === "text" ? p.text : "").join("\n"))
        .join("\n");

      if (!transcript.trim()) return { status: "no_new_messages" };

      // Mask confidential content BEFORE summarize
      const masked = maskTranscript(transcript, { confidentialPatterns: this.confidentialPatterns });

      const key = resolveEffectiveKey({ projectHash: this.projectKey.hash, namespace: this.config.namespace ?? null });

      // I1: summarize + embed + upsert ALL inside withTimeout
      const timeoutMs = this.config.summarize_timeout_ms ?? 120_000;
      const work = (async () => {
        // Task 4: write-gate (spec §3.3) — resolve branch/head BEFORE summarize
        const { branch, head } = await this._resolveBranchContext(sessionID);
        const existing = await this.storage.get(sessionID);
        const effHead = head || existing?.head || "";
        if (!effHead) {
          this.logDebug?.("memory:index_unattributed", { sessionID });
          return { status: "unattributed" };
        }
        const effBranch = branch || existing?.branch || "";

        // Summarize inside withTimeout (I1)
        const summarizeStart = Date.now();
        const resolved = await resolveSummarizerModel({ client: this.client, root: this.root, chain: "core" });
        if (resolved.error) {
          this.logWarn?.("memory:summarizer_unavailable", { reason: resolved.error });
        }
        const { title, summary, decisions } = await this.summarize({
          client: this.client,
          sessionID,
          transcript: masked,
          model: modelRef,
          summarizerModel: resolved.model,
        });
        this.logDebug?.("memory:summarize.duration", {
          sessionID,
          duration_ms: Date.now() - summarizeStart,
          model: resolved.model
            ? (parseModelRef(resolved.model)?.modelID ?? null)
            : (modelRef?.modelID ?? null),
          model_source: resolved.model ? resolved.source : "session",
        });

        // Build entry, mask FIRST, then embed masked content
        const entry = {
          session_id: sessionID,
          key,
          origin_project_hash: this.projectKey.hash,
          title,
          summary,
          decisions,
          embedding: null,
          model_id: this.embeddings.modelId,
          author: this.author ?? this.config.author ?? "unknown",
          time_first: sess?.time?.created ?? 0,
          time_last: sess?.time?.updated ?? 0,
          version: 0,
          branch: effBranch,
          head: effHead,
          merged: 0,
          host: hostname(),
          origin_remote: this.originRemote ?? "",
          prefixes: prefixesOf(this.key ?? ""),
        };

        const extracted = extractArtifacts(messages, {
          root: this.root,
          globs: this.artifactGlobs,
          confidentialPatterns: this.artifactConfidentialPatterns,
        });
        const unionSeen = new Set();
        const union = [];
        for (const p of [...extracted, ...(existing?.artifacts ?? [])]) {
          const k = String(p).toLowerCase();
          if (unionSeen.has(k)) continue;
          unionSeen.add(k);
          union.push(p);
        }
        entry.artifacts = union.slice(0, 8);

        // G2: re-mask entry before write (defense-in-depth)
        const maskedEntry = maskEntry(entry, {
          confidentialPatterns: this.confidentialPatterns,
          artifactConfidentialPatterns: this.artifactConfidentialPatterns,
        });

        // I1: embed AFTER mask
        const vec = await this.embeddings.embed(`${maskedEntry.title}\n${maskedEntry.summary}\n${maskedEntry.decisions.join("\n")}`);
        maskedEntry.embedding = vec;

        // G5: version increment
        maskedEntry.version = (existing?.version ?? 0) + 1;

        let merged = effBranch && this.mainline && effBranch === this.mainline ? 1 : 0;
        if (this.git?.isAncestor && effHead && this.mainline) {
          const anc = await this.git.isAncestor(this.root, effHead, this.mainline);
          if (anc === "yes" || anc === "no") merged = anc === "yes" ? 1 : 0;
        }
        maskedEntry.merged = merged;

        // Task 5: tombstone race-guard — pre-check
        if (this._tombstones.has(sessionID)) return { status: "no_new_messages" };
        await this.storage.upsert([maskedEntry]);
        // post-upsert recheck
        if (this._tombstones.has(sessionID)) {
          try { await this.storage.delete(sessionID); } catch {}
          this._tombstones.delete(sessionID);
          return { status: "no_new_messages" };
        }
        await this.state.setSummarized(sessionID);
        const author = maskedEntry.author;
        if (maskedEntry.version > 1) {
          this.logInfo?.("memory:reindexed", { sessionID, projectKey: this.projectKey.hash, author, version: maskedEntry.version });
        } else {
          this.logInfo?.("memory:indexed", { sessionID, projectKey: this.projectKey.hash, author, version: maskedEntry.version });
        }
        return { status: "ok" };
      })();

      return await withTimeout(work, timeoutMs);
    } catch (err) {
      // Переходная классификация (Task 3 заменит на поимённую по стадиям):
      // enum-only (SEC-4b) — тела ошибок в лог НЕ попадают.
      const errorClass = err?.retryable ? "retryable" : "storage";
      this.logError?.("memory:index_error", { sessionID, error_class: errorClass });
      if (err?.retryable) {
        // retryable (сеть/timeout/5xx embed) — skip не засчитывается (I3).
        this.logDebug?.("memory:index_retryable", { sessionID });
      } else {
        try { await this.state.recordFail(sessionID); } catch {}
        // локальный счётчик fails — memory:index_skipped при переходе в skip
        const fails = (this._fails.get(sessionID) ?? 0) + 1;
        this._fails.set(sessionID, fails);
        if (fails >= 3) {
          this.logWarn?.("memory:index_skipped", { sessionID, fails });
        }
      }
      return { status: `failed:${errorClass}` };
    }
  }
```

Детали переноса:
- Все существующие комментарии-пометки задач (Task 4/5, I1/I2/I3, G1/G2/G5, C-1) перенести за соответствующим кодом.
- Tombstone-выходы (было `return` в void-функции) теперь возвращают `{ status: "no_new_messages" }` — осознанная прикидка: «сессия удалена во время работы — записи нет и не будет». Для `_run` результат игнорируется, поведение не меняется.
- `this.running`/`this.queue`/timers — ТОЛЬКО в `_run` (`finally`), не в `_pipeline`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test plugins/maestro-bootstrap/memory/indexer.test.js 2>&1 | tail -5`
Expected: PASS, 0 fail — **включая все существующие тесты без единой правки** (регрессий нет). Если существующий тест упал — рефактор изменил поведение: исправить рефактор, а не тест.

- [ ] **Step 5: Commit**

```bash
git add plugins/maestro-bootstrap/memory/indexer.js plugins/maestro-bootstrap/memory/indexer.test.js
git commit -m "refactor(memory): _run → guards + _pipeline (outcome statuses, #77)"
```

---

### Task 3: `indexer.js` — классификация ошибок по стадиям + unsaved-триггеры

**Model:** opus (key task: семантика страйков/retryable — риск регрессии)

**Files:**
- Modify: `plugins/maestro-bootstrap/memory/indexer.js` (constructor: `setUnsaved`/`clearUnsaved`; `_pipeline` work: stage try/catch; `_pipeline` catch: классификация)
- Test: `plugins/maestro-bootstrap/memory/indexer.test.js`

**Interfaces:**
- Consumes: Task 1 (`state.recordFail(id, errorClass)`), Task 2 (`_pipeline`).
- Produces:
  - Constructor-депсы (default no-op, backward compat): `setUnsaved: (sessionID, errorClass) => void`, `clearUnsaved: (sessionID) => void`.
  - Stage-tag на ошибках: summarize → `index_error`, non-retryable embed → `embedder_error`, upsert → `storage_error`, прочее (session.get/messages, withTimeout-fallback) → default `index_error` (spec §4.1, F4).
  - Log `memory:index_error` теперь несёт реальный класс (ранее всегда `"storage"` для non-retryable).
  - `memory:unsaved_notice`/`memory:unsaved_cleared` логирует **index.js** (Task 5), не indexer: indexer только вызывает `setUnsaved`/`clearUnsaved`.

- [ ] **Step 1: Write the failing tests**

В конец `indexer.test.js`:

```js
// ── #77 Task 3: классификация ошибок + unsaved-триггеры ──

function mkUnsaved() {
  const set = []; const clear = [];
  return {
    set, clear,
    setUnsaved: (sid, cls) => { set.push([sid, cls]); },
    clearUnsaved: (sid) => { clear.push(sid); },
  };
}

test("#77 T3-1: upsert-ошибка → failed:storage_error + recordFail(class) + setUnsaved", async () => {
  const client = mkClient();
  const storage = { ...mkStorage(client), upsert: async () => { throw new Error("db down"); } };
  const fails = [];
  const u = mkUnsaved();
  const idx = new Indexer({
    client, config: mkConfig(),
    embeddings: { embed: async () => new Float32Array([0.1]), dim: 1, modelId: "m" },
    storage,
    state: { ...mkState(), recordFail: async (sid, cls) => { fails.push([sid, cls]); } },
    summarize: async () => ({ title: "t", summary: "s", decisions: [] }),
    projectKey: { hash: "k", source: "remote" }, confidentialPatterns: [],
    git: mkGit(),
    setUnsaved: u.setUnsaved, clearUnsaved: u.clearUnsaved,
  });
  const r = await idx._pipeline("s1");
  assert.equal(r.status, "failed:storage_error");
  assert.deepEqual(fails, [["s1", "storage_error"]]);
  assert.deepEqual(u.set, [["s1", "storage_error"]]);
  assert.deepEqual(u.clear, []);
  idx.dispose();
});

test("#77 T3-2: non-retryable embed → failed:embedder_error", async () => {
  const client = mkClient();
  const fails = [];
  const u = mkUnsaved();
  const idx = new Indexer({
    client, config: mkConfig(),
    embeddings: { embed: async () => { throw new Error("local embedder down"); }, dim: 1, modelId: "m" },
    storage: mkStorage(client),
    state: { ...mkState(), recordFail: async (sid, cls) => { fails.push([sid, cls]); } },
    summarize: async () => ({ title: "t", summary: "s", decisions: [] }),
    projectKey: { hash: "k", source: "remote" }, confidentialPatterns: [],
    git: mkGit(),
    setUnsaved: u.setUnsaved, clearUnsaved: u.clearUnsaved,
  });
  const r = await idx._pipeline("s1");
  assert.equal(r.status, "failed:embedder_error");
  assert.deepEqual(fails, [["s1", "embedder_error"]]);
  assert.deepEqual(u.set, [["s1", "embedder_error"]]);
  idx.dispose();
});

test("#77 T3-3: retryable embed → failed:retryable, БЕЗ recordFail и БЕЗ setUnsaved (регрессия)", async () => {
  const client = mkClient();
  let failCalled = false;
  const u = mkUnsaved();
  const idx = new Indexer({
    client, config: mkConfig(),
    embeddings: {
      embed: async () => { const e = new Error("network"); e.retryable = true; throw e; },
      dim: 1, modelId: "m",
    },
    storage: mkStorage(client),
    state: { ...mkState(), recordFail: async () => { failCalled = true; } },
    summarize: async () => ({ title: "t", summary: "s", decisions: [] }),
    projectKey: { hash: "k", source: "remote" }, confidentialPatterns: [],
    git: mkGit(),
    setUnsaved: u.setUnsaved, clearUnsaved: u.clearUnsaved,
  });
  const r = await idx._pipeline("s1");
  assert.equal(r.status, "failed:retryable");
  assert.equal(failCalled, false, "retryable не съедал страйк");
  assert.deepEqual(u.set, [], "retryable НЕ ставит unsaved-флаг");
  idx.dispose();
});

test("#77 T3-4: summarize-ошибка → failed:index_error", async () => {
  const client = mkClient();
  const fails = [];
  const idx = new Indexer({
    client, config: mkConfig(),
    embeddings: { embed: async () => new Float32Array([0.1]), dim: 1, modelId: "m" },
    storage: mkStorage(client),
    state: { ...mkState(), recordFail: async (sid, cls) => { fails.push([sid, cls]); } },
    summarize: async () => { throw new Error("llm down"); },
    projectKey: { hash: "k", source: "remote" }, confidentialPatterns: [],
    git: mkGit(),
  });
  const r = await idx._pipeline("s1");
  assert.equal(r.status, "failed:index_error");
  assert.deepEqual(fails, [["s1", "index_error"]]);
  idx.dispose();
});

test("#77 T3-5: session.get-ошибка (default-класс, F4) → failed:index_error + recordFail", async () => {
  const client = mkClient();
  client.session.get = async () => { throw new Error("network"); };
  const fails = [];
  const u = mkUnsaved();
  const idx = new Indexer({
    client, config: mkConfig(),
    embeddings: { embed: async () => new Float32Array([0.1]), dim: 1, modelId: "m" },
    storage: mkStorage(client),
    state: { ...mkState(), recordFail: async (sid, cls) => { fails.push([sid, cls]); } },
    summarize: async () => ({}),
    projectKey: { hash: "k", source: "remote" }, confidentialPatterns: [],
    setUnsaved: u.setUnsaved, clearUnsaved: u.clearUnsaved,
  });
  const r = await idx._pipeline("s1");
  assert.equal(r.status, "failed:index_error");
  assert.deepEqual(fails, [["s1", "index_error"]]);
  assert.deepEqual(u.set, [["s1", "index_error"]]);
  idx.dispose();
});

test("#77 T3-6: успешный индекс → clearUnsaved (G4)", async () => {
  const client = mkClient();
  const u = mkUnsaved();
  const idx = new Indexer({
    client, config: mkConfig(),
    embeddings: { embed: async () => new Float32Array([0.1]), dim: 1, modelId: "m" },
    storage: mkStorage(client), state: mkState(),
    summarize: async () => ({ title: "t", summary: "s", decisions: [] }),
    projectKey: { hash: "k", source: "remote" }, confidentialPatterns: [],
    git: mkGit(),
    setUnsaved: u.setUnsaved, clearUnsaved: u.clearUnsaved,
  });
  const r = await idx._pipeline("s1");
  assert.equal(r.status, "ok");
  assert.deepEqual(u.clear, ["s1"], "clearUnsaved после успешного setSummarized");
  idx.dispose();
});

test("#77 T3-7: log memory:index_error несёт стадииный класс (enum-only)", async () => {
  const cap = { calls: [] };
  const mk = (lvl) => (m, extra) => cap.calls.push([lvl, m, extra]);
  const client = mkClient();
  const storage = { ...mkStorage(client), upsert: async () => { throw new Error("db down"); } };
  const idx = new Indexer({
    client, config: mkConfig(),
    embeddings: { embed: async () => new Float32Array([0.1]), dim: 1, modelId: "m" },
    storage, state: mkState(),
    summarize: async () => ({ title: "t", summary: "s", decisions: [] }),
    projectKey: { hash: "k", source: "remote" }, confidentialPatterns: [],
    git: mkGit(),
    logInfo: mk("info"), logDebug: mk("debug"), logWarn: mk("warn"), logError: mk("error"),
  });
  await idx._pipeline("s1");
  const err = cap.calls.find(([lvl, m]) => m === "memory:index_error");
  assert.ok(err);
  assert.equal(err[2].error_class, "storage_error");
  assert.ok(!JSON.stringify(err).includes("db down"), "enum-only: сообщение ошибки в лог не попадает");
  idx.dispose();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test plugins/maestro-bootstrap/memory/indexer.test.js 2>&1 | rg "#77 T3"`
Expected: FAIL — `failed:storage` (старый класс) вместо `failed:storage_error`, `u.set` пуст и т.п.

- [ ] **Step 3: Implement**

(a) Constructor (`indexer.js`, после `artifactConfidentialPatterns = [],` ~строка 27):

```js
    // #77 (spec §4.2, M1): unsaved-реестр владет index.js; indexer получает
    // колбэки (default no-op — backward compat). setUnsaved — при hard-fail
    // (non-retryable), clearUnsaved — при успешном setSummarized.
    setUnsaved = () => {}, clearUnsaved = () => {},
```

И в теле конструктора (рядом с присваиваниями `this.artifactGlobs`): `this.setUnsaved = setUnsaved; this.clearUnsaved = clearUnsaved;`

(b) Stage-tag внутри `work` (три точечные обёртки, остальной код `work` не трогать):

summarize — заменить `const { title, summary, decisions } = await this.summarize({...});` на:

```js
        let title, summary, decisions;
        try {
          ({ title, summary, decisions } = await this.summarize({
            client: this.client,
            sessionID,
            transcript: masked,
            model: modelRef,
            summarizerModel: resolved.model,
          }));
        } catch (e) {
          if (!e?.retryable) e.errorClass = "index_error";
          throw e;
        }
```

embed — заменить прямой вызов `const vec = await this.embeddings.embed(...);` на:

```js
        // I1: embed AFTER mask
        let vec;
        try {
          vec = await this.embeddings.embed(`${maskedEntry.title}\n${maskedEntry.summary}\n${maskedEntry.decisions.join("\n")}`);
        } catch (e) {
          if (!e?.retryable) e.errorClass = "embedder_error";
          throw e;
        }
        maskedEntry.embedding = vec;
```

upsert — обёртка:

```js
        if (this._tombstones.has(sessionID)) return { status: "no_new_messages" };
        try {
          await this.storage.upsert([maskedEntry]);
        } catch (e) {
          e.errorClass = "storage_error";
          throw e;
        }
```

(c) Catch-блок `_pipeline` — новая классификация (заменяет переходный вариант из Task 2):

```js
    } catch (err) {
      // #77 (spec §4.1): поимённая классификация — stage-tag (e.errorClass),
      // поставленный обёртками стадий; default — index_error (F4: ошибки
      // session.get/messages и fallback withTimeout). enum-only (SEC-4b):
      // тела ошибок в лог НЕ попадают.
      if (err?.retryable) {
        // retryable (сеть/timeout/5xx embed) — skip не засчитывается (I3),
        // unsaved-флаг НЕ ставится (spec §4.1: НЕ триггер).
        this.logError?.("memory:index_error", { sessionID, error_class: "retryable" });
        this.logDebug?.("memory:index_retryable", { sessionID });
        return { status: "failed:retryable" };
      }
      const errorClass = err?.errorClass ?? "index_error";
      this.logError?.("memory:index_error", { sessionID, error_class: errorClass });
      try { await this.state.recordFail(sessionID, errorClass); } catch {}
      // локальный счётчик fails — memory:index_skipped при переходе в skip
      const fails = (this._fails.get(sessionID) ?? 0) + 1;
      this._fails.set(sessionID, fails);
      if (fails >= 3) {
        this.logWarn?.("memory:index_skipped", { sessionID, fails });
      }
      this.setUnsaved?.(sessionID, errorClass);
      return { status: `failed:${errorClass}` };
    }
```

(d) `clearUnsaved` — в `work`, сразу после `await this.state.setSummarized(sessionID);`:

```js
        await this.state.setSummarized(sessionID);
        this.clearUnsaved?.(sessionID);
```

- [ ] **Step 4: Run all indexer tests**

Существующий тест `indexer.test.js:917` («indexer logs index_error with error_class (not message)», session.get throw) — assertion только «message не в лог»: **не меняется**. Тест `:970` (retryable, `error_class: "retryable"`) — **не меняется**.

Run: `node --test plugins/maestro-bootstrap/memory/indexer.test.js 2>&1 | tail -5`
Expected: PASS, 0 fail (все T3-x + вся регрессия).

- [ ] **Step 5: Commit**

```bash
git add plugins/maestro-bootstrap/memory/indexer.js plugins/maestro-bootstrap/memory/indexer.test.js
git commit -m "feat(memory): per-stage error classification + unsaved triggers (#77)"
```

---

### Task 4: `indexer.js` — `reindexSession(id)` (полный re-index)

**Model:** opus (key task: C1/C2 — синхронная семантика + post-fact)

**Files:**
- Modify: `plugins/maestro-bootstrap/memory/indexer.js` (новый метод после `_pipeline`)
- Test: `plugins/maestro-bootstrap/memory/indexer.test.js`

**Interfaces:**
- Consumes: Task 1 (`state.clearSkip`), Task 2 (`_pipeline`), Task 3 (классификация).
- Produces: `indexer.reindexSession(sessionID)` → `Promise<{ status: string }>`:
  - `"ok"` — пайплайн дошёл до `setSummarized` (post-fact-проверку записи делает **tool**, Task 6);
  - `"unattributed"` / `"no_new_messages"` — early-exit-outcomes (N3: не выводятся из post-fact «записи нет»);
  - `"failed:<class>"` — ошибка стадии (класс §4.1; повторный страйк после clearSkip — осознанно: хранилище всё ещё лежит → честный skip-цикл).
  - Guard-исходы (`not_found`, `skip_service`) — **не** возвращает: пре-чекает tool (R2).

**Семантика (spec §5.1.1):** НЕ идёт через running-queue и НЕ гардится `this.running`; retry-throttle **не применяется** (метод не читает `lastAttempt`); перед пайплайном — `state.clearSkip(id)` (C1: `lastAttempt → null`) + сброс локального зеркала `this._fails.delete(id)` (F5). Гонка с in-flight `_run` — осознанный benign-race (N4, guard не добавляется).

- [ ] **Step 1: Write the failing tests**

В конец `indexer.test.js`:

```js
// ── #77 Task 4: reindexSession ──

test("#77 T4-1: reindexSession bypasses retry-throttle (C1, свежий lastAttempt)", async () => {
  const client = mkClient();
  const storage = mkStorage(client);
  const calls = { summarize: 0, clearSkip: 0 };
  const idx = new Indexer({
    client, config: mkConfig({ retry_interval_min: 60 }),
    embeddings: { embed: async () => new Float32Array([0.1]), dim: 1, modelId: "m" },
    storage,
    state: {
      ...mkState(),
      getLastAttempt: async () => Date.now(), // свежий attempt: штатный _run ушёл бы в throttle
      clearSkip: async () => { calls.clearSkip++; },
    },
    summarize: async () => { calls.summarize++; return { title: "t", summary: "s", decisions: [] }; },
    projectKey: { hash: "k", source: "remote" }, confidentialPatterns: [],
    git: mkGit(),
  });
  const r = await idx.reindexSession("s1");
  assert.equal(r.status, "ok");
  assert.equal(calls.summarize, 1, "summarize вызван (throttle не блокирует)");
  assert.equal(calls.clearSkip, 1, "clearSkip вызван");
  assert.equal(client.upserts.length, 1);
  idx.dispose();
});

test("#77 T4-2: reindexSession сбрасывает skip (isSkipped=true до вызова)", async () => {
  const client = mkClient();
  const stateCalls = { clearSkip: [] };
  const idx = new Indexer({
    client, config: mkConfig(),
    embeddings: { embed: async () => new Float32Array([0.1]), dim: 1, modelId: "m" },
    storage: mkStorage(client),
    state: {
      ...mkState(),
      isSkipped: async () => true, // до clearSkip сессия в skip
      clearSkip: async (id) => { stateCalls.clearSkip.push(id); },
    },
    summarize: async () => ({ title: "t", summary: "s", decisions: [] }),
    projectKey: { hash: "k", source: "remote" }, confidentialPatterns: [],
    git: mkGit(),
  });
  const r = await idx.reindexSession("s1");
  assert.equal(r.status, "ok");
  assert.deepEqual(stateCalls.clearSkip, ["s1"]);
  idx.dispose();
});

test("#77 T4-3: write-gate head '' → unattributed, запись НЕ создана, summarize не вызван (C2)", async () => {
  const client = mkClient();
  const storage = mkStorage(client);
  let summarizeCalls = 0;
  const idx = new Indexer({
    client, config: mkConfig(),
    embeddings: { embed: async () => new Float32Array([0.1]), dim: 1, modelId: "m" },
    storage,
    state: { ...mkState(), clearSkip: async () => {} },
    summarize: async () => { summarizeCalls++; return { title: "t", summary: "s", decisions: [] }; },
    projectKey: { hash: "k", source: "remote" }, confidentialPatterns: [],
    git: { resolveBranch: async () => "", resolveHead: async () => "" },
  });
  const r = await idx.reindexSession("s1");
  assert.equal(r.status, "unattributed");
  assert.equal(summarizeCalls, 0, "write-gate: summarize до head не вызывается");
  assert.equal(client.upserts.length, 0);
  idx.dispose();
});

test("#77 T4-4: пустой транскрипт → no_new_messages (edge: запись удалена memory_forget)", async () => {
  const client = mkClient(null); // messages: []
  const idx = new Indexer({
    client, config: mkConfig(),
    embeddings: { embed: async () => new Float32Array([0.1]), dim: 1, modelId: "m" },
    storage: mkStorage(client),
    state: { ...mkState(), clearSkip: async () => {} },
    summarize: async () => ({ title: "t", summary: "s", decisions: [] }),
    projectKey: { hash: "k", source: "remote" }, confidentialPatterns: [],
    git: mkGit(),
  });
  const r = await idx.reindexSession("s1");
  assert.equal(r.status, "no_new_messages");
  idx.dispose();
});

test("#77 T4-5: хранилище лежит → failed:storage_error + recordFail с 0; после clearSkip + 1 страйк index_skipped НЕ возникает (F5)", async () => {
  const cap = { calls: [] };
  const mk = (lvl) => (m, extra) => cap.calls.push([lvl, m, extra]);
  const client = mkClient();
  const storage = { ...mkStorage(client), upsert: async () => { throw new Error("db down"); } };
  const fails = [];
  const idx = new Indexer({
    client, config: mkConfig(),
    embeddings: { embed: async () => new Float32Array([0.1]), dim: 1, modelId: "m" },
    storage,
    state: {
      ...mkState(),
      clearSkip: async () => {},
      recordFail: async (sid, cls) => { fails.push([sid, cls]); },
    },
    summarize: async () => ({ title: "t", summary: "s", decisions: [] }),
    projectKey: { hash: "k", source: "remote" }, confidentialPatterns: [],
    git: mkGit(),
    logInfo: mk("info"), logDebug: mk("debug"), logWarn: mk("warn"), logError: mk("error"),
  });
  idx._fails.set("s1", 3); // искусственно: зеркало до clearSkip = 3 (без сброса warn бы сработал)
  const r = await idx.reindexSession("s1");
  assert.equal(r.status, "failed:storage_error");
  assert.deepEqual(fails, [["s1", "storage_error"]], "recordFail вызван (счётчик пересоздан с 0)");
  const skip = cap.calls.find(([lvl, m]) => m === "memory:index_skipped");
  assert.equal(skip, undefined, "F5: mirror сброшен → warn при 1 новом страйке не возникает");
  idx.dispose();
});

test("#77 T4-6: reindexSession не трогает this.running/queue (синхронный, C2)", async () => {
  const client = mkClient();
  const idx = new Indexer({
    client, config: mkConfig(),
    embeddings: { embed: async () => new Float32Array([0.1]), dim: 1, modelId: "m" },
    storage: mkStorage(client),
    state: { ...mkState(), clearSkip: async () => {} },
    summarize: async () => ({ title: "t", summary: "s", decisions: [] }),
    projectKey: { hash: "k", source: "remote" }, confidentialPatterns: [],
    git: mkGit(),
  });
  idx.running = true; // штатный _run в работе
  const r = await idx.reindexSession("s1");
  assert.equal(r.status, "ok", "reindexSession не гардится this.running");
  assert.equal(idx.queue.size, 0, "в очередь не ставится");
  idx.dispose();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test plugins/maestro-bootstrap/memory/indexer.test.js 2>&1 | rg "#77 T4"`
Expected: FAIL — `idx.reindexSession is not a function`.

- [ ] **Step 3: Implement `reindexSession`**

В `indexer.js`, сразу после `_pipeline`:

```js
  /**
   * #77 (spec §5.1.1): полный re-index сессии — синхронный для tool'а
   * (memory_reindex, Task 6). НЕ идёт через running-queue и не гардится
   * this.running; retry-throttle НЕ применяется (последствие сброса
   * lastAttempt в clearSkip, C1). Guard-исходы (not_found, skip_service)
   * пре-чекает tool (R2) — здесь не проверяются.
   * Гонка с in-flight _run той же сессии — осознанный benign-race (N4):
   * возможный двойной summarize (LLM-стоимость) + двойной version-bump;
   * данные безопасны (upsert по session_id), guard не добавляется (YAGNI).
   * @param {string} sessionID
   * @returns {Promise<{ status: string }>} "ok" | "unattributed" |
   *   "no_new_messages" | "failed:<class>"
   */
  async reindexSession(sessionID) {
    // C1: сброс permanent-skip + throttle-якоря (lastAttempt → null);
    // F5: сброс локального зеркала _fails — иначе memory:index_skipped
    // сработает преждевременно после нового страйка (state=1, local >= 3).
    // Вызывается только по явным ID (HITL) — авто-сбросов нет.
    try { await this.state.clearSkip?.(sessionID); } catch {}
    this._fails.delete(sessionID);
    return await this._pipeline(sessionID);
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test plugins/maestro-bootstrap/memory/indexer.test.js 2>&1 | tail -5`
Expected: PASS, 0 fail.

- [ ] **Step 5: Commit**

```bash
git add plugins/maestro-bootstrap/memory/indexer.js plugins/maestro-bootstrap/memory/indexer.test.js
git commit -m "feat(memory): reindexSession — full synchronous re-index with skip reset (#77)"
```

---

### Task 5: `index.js` — unsaved-реестр + notice-хуки (per-session + process-level)

**Model:** sonnet (multi-file-интеграция; опора на прецедент `communication.js:135`)

**Files:**
- Modify: `plugins/maestro-bootstrap/memory/index.js`:
  - после log-хелперов (~строка 411, ДО `try`): константы текстов + `isNoticeEligible` + `processNotice`
  - off-пути: `:440-442` (qdrant_config_invalid), `:444-449` (pgvector_config_invalid), `:455-458` (api_key_env_missing), `:498-504` (qdrant client), `:513-520` (pg client), `:576-581` (probe hard-fail), catch `:1831-1836` (init failed)
  - перед `new Indexer` (`:746`): unsaved-реестр + `setUnsaved`/`clearUnsaved`
  - `:746-775`: проброс `setUnsaved`/`clearUnsaved` в Indexer
  - `:1780-1810`: transform-хук — комбайн (recall за `auto_recall` + notice независимо, I1)
- Test: `plugins/maestro-bootstrap/memory/index.test.js`

**Interfaces:**
- Consumes: Task 3 (Indexer принимает `setUnsaved`/`clearUnsaved`), `makeBoundedMap` (импорт уже есть, `index.js:6`), `SESSIONS` (импорт уже есть).
- Produces:
  - hooks: `"experimental.chat.system.transform"` — в полном наборе ВСЕГДА (даже при `auto_recall: false`); в сокращённом наборе off-путов — только notice.
  - Log: `memory:unsaved_notice` (info; per-session: `{ sessionID, reason }` 1× на установку флага; process: `{ scope: "process", reason }`), `memory:unsaved_cleared` (debug; `{ sessionID }`).
  - Reason-enum: per-session — `storage_error|embedder_error|index_error`; process — `init_failed|config_invalid|client_not_installed|api_key_env_missing|probe_hard_fail`.
  - Состав сокращённого набора: off-пути → `{ transform }` (tools НЕТ); probe hard-fail → `{ tool: { memory_probe }, transform }` (I2).

**Тексты (канон, spec §4.3; тесты ассертят по маркерам «НЕ сохранены» и «@maestro-memory-reindex»):**

```js
const noticeSessionText = (reason) =>
  `maestro memory: данные этой сессии НЕ сохранены в памяти (причина: ${reason}). Не рассуждай о «памяти проекта» как о актуальной по этой теме. Восстановление: @maestro-memory-reindex (по требованию); при перезапуске opencode повтор возможен, пока сессия не ушла в skip (3 неудачи).`;
const noticeProcessText = (reason) =>
  `maestro memory: не работает в этом процессе (причина: ${reason}) — данные сессий не сохраняются, поиск по памяти недоступен. Проверьте доступность хранилища; после перезапуска opencode сохранение восстановится.`;
```

- [ ] **Step 1: Write the failing tests**

В конец `index.test.js` (хелперы `mkConfig/mkClient/mkMockStorage/mkMockEmbeddings` — в файле, строки 17-78; `execSync` для git init уже импортирован, строка 4):

```js
// ── #77 Task 5: notice-хуки (per-session + process-level) ──

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function noticeFixture(overrides = {}) {
  // git repo с head — write-gate проходит, _run доходит до upsert
  const dir = mkdtempSync(join(tmpdir(), "mem-notice-"));
  execSync("git init -q -b main", { cwd: dir, stdio: "ignore" });
  execSync("git -c user.email=t@t.local -c user.name=t commit -q --allow-empty -m x", { cwd: dir, stdio: "ignore" });
  let upsertImpl = null;
  const storage = {
    ...mkMockStorage(),
    upsert: async (es) => { if (upsertImpl) await upsertImpl(es); },
    get: async () => null,
  };
  const client = {
    session: {
      get: async ({ path }) => ({ data: { id: path.id, parentID: null, title: "st", time: { created: 1, updated: 100 } } }),
      messages: async () => ({ data: [{ info: { role: "user", time: { created: 50 } }, parts: [{ type: "text", text: "hello" }] }] }),
      list: async () => ({ data: [] }),
    },
  };
  const events = [];
  const log = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };
  for (const k of ["debug", "info", "warn", "error"]) {
    log[k] = (m, extra) => { events.push([k, m, extra]); };
  }
  const cfg = mkConfig(dir, {
    idle_debounce_min: 0.001,   // 100ms — _run в тестах
    retry_interval_min: 0,       // без throttle-блокировки повторов
    min_new_messages: 1,
    ...overrides.config,
  });
  const setUpsertFail = (fail) => { upsertImpl = fail ? async () => { throw new Error("db down"); } : null; };
  return {
    dir, storage, client, log, events, cfg, setUpsertFail,
    init: async (depsOverrides = {}) => registerMemoryHooks({ client, config: cfg, log, root: dir, deps: { embeddings: mkMockEmbeddings(), storage, ...depsOverrides } }),
  };
}

test("#77 T5-1: upsert-fail → unsaved-флаг → transform инжектит notice; после успешного re-index — снят", async () => {
  const f = noticeFixture();
  const saved = process.env.XDG_DATA_HOME;
  process.env.XDG_DATA_HOME = f.dir;
  try {
    f.setUpsertFail(true);
    const hooks = await f.init();
    const idle = () => hooks.event({ event: { type: "session.idle", properties: { sessionID: "s1" } } });
    idle();
    await sleep(300);
    const notice = f.events.find(([lvl, m]) => m === "memory:unsaved_notice");
    assert.ok(notice, "unsaved_notice в логе");
    assert.equal(notice[2].reason, "storage_error");
    let out = { system: [] };
    await hooks["experimental.chat.system.transform"]({ sessionID: "s1" }, out);
    assert.ok(out.system.some((s) => s.includes("НЕ сохранены")), "notice инжектится");
    assert.ok(out.system.some((s) => s.includes("@maestro-memory-reindex")), "маркер команды восстановления");
    // восстановление: upsert ожил → повторный idle → успех → флаг снят
    f.setUpsertFail(false);
    idle();
    await sleep(300);
    assert.ok(f.events.some(([lvl, m]) => m === "memory:unsaved_cleared"), "unsaved_cleared в логе");
    out = { system: [] };
    await hooks["experimental.chat.system.transform"]({ sessionID: "s1" }, out);
    assert.equal(out.system.filter((s) => s.includes("НЕ сохранены")).length, 0, "notice снят");
    await hooks.dispose?.();
  } finally {
    if (saved === undefined) delete process.env.XDG_DATA_HOME; else process.env.XDG_DATA_HOME = saved;
    rmSync(f.dir, { recursive: true, force: true });
  }
});

test("#77 T5-2: guard — task-сессия (parentID) без инъекции (паритет communication-guard)", async () => {
  const f = noticeFixture();
  const saved = process.env.XDG_DATA_HOME;
  process.env.XDG_DATA_HOME = f.dir;
  try {
    const hooks = await f.init();
    f.client.session.get = async ({ path }) => ({ data: { id: path.id, parentID: "p1", title: "st" } });
    const out = { system: [] };
    await hooks["experimental.chat.system.transform"]({ sessionID: "s1" }, out);
    assert.equal(out.system.filter((s) => s.includes("НЕ сохранены")).length, 0, "task-сессия — без notice");
    await hooks.dispose?.();
  } finally {
    if (saved === undefined) delete process.env.XDG_DATA_HOME; else process.env.XDG_DATA_HOME = saved;
    rmSync(f.dir, { recursive: true, force: true });
  }
});

test("#77 T5-3: retryable embed-ошибка → unsaved-флага НЕТ (регрессия)", async () => {
  const f = noticeFixture();
  const saved = process.env.XDG_DATA_HOME;
  process.env.XDG_DATA_HOME = f.dir;
  try {
    const hooks = await f.init({ embeddings: { embed: async () => { const e = new Error("network"); e.retryable = true; throw e; }, dim: 3, modelId: "m" } });
    hooks.event({ event: { type: "session.idle", properties: { sessionID: "s1" } } });
    await sleep(300);
    assert.ok(!f.events.some(([lvl, m]) => m === "memory:unsaved_notice"), "retryable не ставит флаг");
    assert.ok(f.events.some(([lvl, m]) => m === "memory:index_retryable"), "retryable-аудит на месте");
    await hooks.dispose?.();
  } finally {
    if (saved === undefined) delete process.env.XDG_DATA_HOME; else process.env.XDG_DATA_HOME = saved;
    rmSync(f.dir, { recursive: true, force: true });
  }
});

test("#77 T5-4: init-fail (storage.init throw) → сокращённый набор (notice, БЕЗ tools), reason init_failed", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mem-initfail-"));
  const saved = process.env.XDG_DATA_HOME;
  process.env.XDG_DATA_HOME = dir;
  try {
    const badStorage = { ...mkMockStorage(), init: async () => { throw new Error("qdrant down"); } };
    const events = [];
    const log = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };
    for (const k of ["debug", "info", "warn", "error"]) log[k] = (m, e) => { events.push([k, m, e]); };
    const hooks = await registerMemoryHooks({ client: mkClient(), config: mkConfig(dir), log, root: dir, deps: { embeddings: mkMockEmbeddings(), storage: badStorage } });
    assert.equal(hooks.tool, undefined, "tools отсутствуют (fail → нет memory-поверхности)");
    assert.equal(typeof hooks["experimental.chat.system.transform"], "function", "notice-хук зарегистрирован");
    assert.ok(events.some(([lvl, m]) => m === "memory: init failed"), "bootstrap-лог «memory: init failed» без изменений");
    assert.ok(events.some(([lvl, m, e]) => m === "memory:unsaved_notice" && e.scope === "process" && e.reason === "init_failed"));
    const out = { system: [] };
    await hooks["experimental.chat.system.transform"]({ sessionID: "s1" }, out);
    assert.ok(out.system[0].includes("не работает в этом процессе"), "process-notice");
    assert.ok(out.system[0].includes("init_failed"), "reason в notice");
  } finally {
    if (saved === undefined) delete process.env.XDG_DATA_HOME; else process.env.XDG_DATA_HOME = saved;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("#77 T5-5: auto_recall false + init-fail → notice-хук ВСЁ РАВНО зарегистрирован (I1)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mem-recall-off-"));
  const saved = process.env.XDG_DATA_HOME;
  process.env.XDG_DATA_HOME = dir;
  try {
    const badStorage = { ...mkMockStorage(), init: async () => { throw new Error("down"); } };
    const hooks = await registerMemoryHooks({
      client: mkClient(), config: mkConfig(dir, { auto_recall: false }), log: { debug() {}, info() {}, warn() {}, error() {} },
      root: dir, deps: { embeddings: mkMockEmbeddings(), storage: badStorage },
    });
    assert.equal(typeof hooks["experimental.chat.system.transform"], "function", "I1: notice вне auto_recall-условия");
    assert.equal(hooks["chat.message"], undefined, "chat.message (recall) при auto_recall false — отсутствует");
    const out = { system: [] };
    await hooks["experimental.chat.system.transform"]({ sessionID: "s1" }, out);
    assert.equal(out.system.length, 1, "process-notice инжектится");
  } finally {
    if (saved === undefined) delete process.env.XDG_DATA_HOME; else process.env.XDG_DATA_HOME = saved;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("#77 T5-6: probe_hard_fail → { tool: { memory_probe }, transform } — memory_probe на месте (I2)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mem-probe-notice-"));
  const saved = process.env.XDG_DATA_HOME;
  process.env.XDG_DATA_HOME = dir;
  try {
    const hooks = await registerMemoryHooks({
      client: mkClient(), config: mkConfig(dir), log: { debug() {}, info() {}, warn() {}, error() {} },
      root: dir,
      deps: { storage: mkMockStorage(), embeddings: { probe: async () => ({ ok: false, hard: true, detail: "dim mismatch" }), dim: 3, modelId: "m" } },
    });
    assert.ok(hooks.tool.memory_probe, "memory_probe сохранён (I2)");
    assert.equal(hooks.tool.memory_search, undefined, "остальные tools отсутствуют");
    assert.equal(typeof hooks["experimental.chat.system.transform"], "function");
    const out = { system: [] };
    await hooks["experimental.chat.system.transform"]({ sessionID: "s1" }, out);
    assert.ok(out.system[0].includes("probe_hard_fail"), "reason в notice");
  } finally {
    if (saved === undefined) delete process.env.XDG_DATA_HOME; else process.env.XDG_DATA_HOME = saved;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("#77 T5-7: notice fail-soft — session.get throw в guard → без инъекции, без броска", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mem-notice-fs-"));
  const saved = process.env.XDG_DATA_HOME;
  process.env.XDG_DATA_HOME = dir;
  try {
    const badStorage = { ...mkMockStorage(), init: async () => { throw new Error("down"); } };
    const client = { session: { get: async () => { throw new Error("opencode down"); }, list: async () => ({ data: [] }) } };
    const hooks = await registerMemoryHooks({ client, config: mkConfig(dir), log: { debug() {}, info() {}, warn() {}, error() {} }, root: dir, deps: { embeddings: mkMockEmbeddings(), storage: badStorage } });
    const out = { system: [] };
    await hooks["experimental.chat.system.transform"]({ sessionID: "s1" }, out); // не бросает
    assert.equal(out.system.length, 0);
  } finally {
    if (saved === undefined) delete process.env.XDG_DATA_HOME; else process.env.XDG_DATA_HOME = saved;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("#77 T5-8: re-entry — fail → clear → fail → ВТОРОЙ unsaved_notice (1× на установку флага)", async () => {
  const f = noticeFixture();
  const saved = process.env.XDG_DATA_HOME;
  process.env.XDG_DATA_HOME = f.dir;
  try {
    f.setUpsertFail(true);
    const hooks = await f.init();
    const idle = () => hooks.event({ event: { type: "session.idle", properties: { sessionID: "s1" } } });
    idle(); await sleep(300);
    f.setUpsertFail(false);
    idle(); await sleep(300); // clear
    f.setUpsertFail(true);
    idle(); await sleep(300); // новый fail
    const notices = f.events.filter(([lvl, m]) => m === "memory:unsaved_notice");
    assert.equal(notices.length, 2, "re-entry: второй event после clear + новый fail");
    await hooks.dispose?.();
  } finally {
    if (saved === undefined) delete process.env.XDG_DATA_HOME; else process.env.XDG_DATA_HOME = saved;
    rmSync(f.dir, { recursive: true, force: true });
  }
});

test("#77 T5-9: статические off-пути → сокращённый набор + reason по таблице §4.4", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mem-staticoff-"));
  const saved = process.env.XDG_DATA_HOME;
  process.env.XDG_DATA_HOME = dir;
  try {
    const mkLog = () => {
      const events = [];
      const log = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };
      for (const k of ["debug", "info", "warn", "error"]) log[k] = (m, e) => { events.push([k, m, e]); };
      return { log, events };
    };
    // qdrant_config_invalid
    {
      const { log, events } = mkLog();
      const hooks = await registerMemoryHooks({ client: mkClient(), config: mkConfig(dir, { storage: { type: "qdrant" } }), log, root: dir, deps: { embeddings: mkMockEmbeddings() } });
      assert.equal(hooks.tool, undefined);
      assert.equal(typeof hooks["experimental.chat.system.transform"], "function");
      assert.ok(events.some(([l, m, e]) => m === "memory:unsaved_notice" && e.reason === "config_invalid"));
    }
    // api_key_env_missing (openai без env)
    {
      const { log, events } = mkLog();
      const savedKey = process.env.MEM_TEST_KEY;
      delete process.env.MEM_TEST_KEY;
      try {
        const hooks = await registerMemoryHooks({ client: mkClient(), config: mkConfig(dir, { embedding: { provider: "openai", model: "x", base_url: "https://x", api_key_env: "MEM_TEST_KEY", dim: 3 } }), log, root: dir, deps: { embeddings: mkMockEmbeddings() } });
        assert.equal(hooks.tool, undefined);
        assert.ok(events.some(([l, m, e]) => m === "memory:unsaved_notice" && e.reason === "api_key_env_missing"));
      } finally {
        if (savedKey !== undefined) process.env.MEM_TEST_KEY = savedKey;
      }
    }
  } finally {
    if (saved === undefined) delete process.env.XDG_DATA_HOME; else process.env.XDG_DATA_HOME = saved;
    rmSync(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Update stale existing tests (M2 + probe-hard-fail)**

(a) `index.test.js` ~строка 376, тест «M2: auto_recall false → no chat.message/system.transform hooks»: заменить ассерт
`assert.equal(hooks["experimental.chat.system.transform"], undefined);`
на:
```js
    // #77 (I1): transform-хук живёт независимо от auto_recall (notice-слой);
    // recall-инъекция внутри хука выключена.
    assert.equal(typeof hooks["experimental.chat.system.transform"], "function");
    const out = { system: [] };
    await hooks["experimental.chat.system.transform"]({ sessionID: "s1" }, out);
    assert.equal(out.system.length, 0, "auto_recall false → recall-блоков нет");
```

(b) `index.test.js:3205` («startup probe hard fail → memory off (memory_probe only…)») — добавить ассерт:
```js
    assert.equal(typeof hooks["experimental.chat.system.transform"], "function", "#77: process-notice на hard-fail");
```

(c) Поиск: `rg 'system.transform' plugins/maestro-bootstrap/memory/index.test.js` — любой существующий тест, утверждающий `undefined` для transform при ВКЛЮЧЁННОЙ памяти (или при off-путях), обновить по той же логике: hook теперь обязан существовать.

- [ ] **Step 3: Run tests to verify they fail**

Run: `node --test plugins/maestro-bootstrap/memory/index.test.js 2>&1 | rg "#77 T5|fail " | head -20`
Expected: FAIL — notice-хуки ещё не зарегистрированы.

- [ ] **Step 4: Implement in `index.js`**

(a) После log-хелперов (после строки ~411, ПЕРЕД `const gitCfg`):

```js
  // #77 (spec §4.3): тексты уведомлений — канон (RU, самодостаточные,
  // без данных сессии — SEC-4b). Тесты ассертят по ключевым маркерам.
  const noticeSessionText = (reason) =>
    `maestro memory: данные этой сессии НЕ сохранены в памяти (причина: ${reason}). Не рассуждай о «памяти проекта» как о актуальной по этой теме. Восстановление: @maestro-memory-reindex (по требованию); при перезапуске opencode повтор возможен, пока сессия не ушла в skip (3 неудачи).`;
  const noticeProcessText = (reason) =>
    `maestro memory: не работает в этом процессе (причина: ${reason}) — данные сессий не сохраняются, поиск по памяти недоступен. Проверьте доступность хранилища; после перезапуска opencode сохранение восстановится.`;
  // Guard (паритет communication.js isEligible, spec §4.2): только top-level
  // сессии без сервис-сессий; fail-soft (ошибка → без инъекции).
  const isNoticeEligible = async (sessionID) => {
    if (!sessionID) return false;
    try {
      const resp = await client?.session?.get?.({ path: { id: sessionID } });
      const data = resp?.data ?? resp;
      return Boolean(data) && !data.parentID && !SESSIONS.has(sessionID) &&
        !(typeof data.title === "string" && data.title.startsWith("[maestro-memory]"));
    } catch {
      return false;
    }
  };
  // Process-level notice (spec §4.4): «тихий off»-путь init → сокращённый
  // набор хуков с notice вместо return {}. Reason-enum — §4.4/§7.
  const processNotice = (reason) => {
    logInfo("memory:unsaved_notice", { scope: "process", reason });
    return {
      "experimental.chat.system.transform": async ({ sessionID }, out) => {
        try {
          if (!(await isNoticeEligible(sessionID))) return;
          if (out?.system) out.system.push(noticeProcessText(reason));
        } catch {
          /* fail-soft */
        }
      },
    };
  };
```

(b) Off-пути — заменить `return {}`:
- `qdrant_config_invalid` (~:441): `return processNotice("config_invalid");`
- `pgvector_config_invalid` (~:448): `return processNotice("config_invalid");`
- `embedding_api_key_env_missing` (~:457): `return processNotice("api_key_env_missing");`
- qdrant client_not_installed (~:503): `return processNotice("client_not_installed");`
- pg client_not_installed (~:519): `return processNotice("client_not_installed");`
- probe hard-fail (~:577-581):
```js
        const probeNotice = processNotice("probe_hard_fail");
        return { tool: { memory_probe: makeMemoryProbeTool({ embeddings, state, log, apiKeyEnv }) }, ...probeNotice };
```
- catch init (~:1831-1836): сохранить `log?.error?.("memory: init failed", ...)` и заменить `return {};` на `return processNotice("init_failed");`

(c) Перед `new Indexer` (перед строкой ~746):

```js
    // #77 (spec §4.2, M1): unsaved-реестр (bounded, in-memory) — владение
    // index.js; indexer получает колбэки. 1× на установку флага; re-entry
    // (clear + новый fail) — новый event (spec §7).
    const unsaved = makeBoundedMap(1024);
    const setUnsaved = (sid, reason) => {
      if (unsaved.get(sid) === undefined) logInfo("memory:unsaved_notice", { sessionID: sid, reason });
      unsaved.set(sid, reason);
    };
    const clearUnsaved = (sid) => {
      if (unsaved.get(sid) !== undefined) {
        logDebug("memory:unsaved_cleared", { sessionID: sid });
        unsaved.delete(sid);
      }
    };
```

И в `new Indexer({...})` (после `root,` ~:774):
```js
      setUnsaved, clearUnsaved,
```

(d) Transform-хук (заменить блок `:1802-1809`; `chat.message` остаётся внутри условия `auto_recall !== false`, старый transform-хук из него удаляется):

```js
    // M2: auto_recall off → без chat.message (recall). #77 (I1): transform —
    // комбайн: recall-блок за auto_recall + notice-слой НЕЗАВИСИМО (уведомление
    // о потере данных — не функция recall).
    hooks["experimental.chat.system.transform"] = async ({ sessionID }, out) => {
      if (config.auto_recall !== false) {
        try {
          const b = await recall.systemBlock({ sessionID });
          if (b && out?.system) out.system.push(b);
        } catch {
          /* fail-quiet */
        }
      }
      try {
        if (!(await isNoticeEligible(sessionID))) return;
        const reason = unsaved.get(sessionID);
        if (reason && out?.system) out.system.push(noticeSessionText(reason));
      } catch {
        /* fail-soft */
      }
    };
```

- [ ] **Step 5: Run all memory tests**

Run: `npm run test:memory 2>&1 | tail -8`
Expected: 0 fail (новые T5-x + обновлённые M2/probe + вся регрессия).

- [ ] **Step 6: Commit**

```bash
git add plugins/maestro-bootstrap/memory/index.js plugins/maestro-bootstrap/memory/index.test.js
git commit -m "feat(memory): unsaved-registry + in-session notice hooks, loud off-paths (#77)"
```

---

### Task 6: `index.js` — `memory_reindex` full-reindex (диспатч по критерию N1)

**Model:** sonnet (интеграция; опора на существующий tool-код `:1094-1257`)

**Files:**
- Modify: `plugins/maestro-bootstrap/memory/index.js:1214-1257` (run / source: "sessions" — явные session_ids), `:1095` (description)
- Test: `plugins/maestro-bootstrap/memory/index.test.js`

**Interfaces:**
- Consumes: Task 1 (`state.isSkipped/getLastSummarized/getLastAttempt`), Task 4 (`indexer.reindexSession`), `reindexSessionArtifacts` (без изменений), `storage.get(sid)`.
- Produces:
  - Диспатч для **явных** `session_ids` (spec §5.1, N1-критерий):
    1. pre-check (R2): `client.session.get` → нет/ошибка → `not_found`; `parentID`/`SESSIONS` → `skip_service`;
    2. запись существует И актуальна (`!isSkipped && (lastAttempt == null || lastSummarized >= lastAttempt)`) → artifacts top-up (0 LLM) → статусы artifacts-пути без изменений (`updated|no_change|skip_*`);
    3. иначе (нет / `skip` / `lastAttempt > lastSummarized`) → `indexer.reindexSession(sid)` → статус: `ok` + post-fact `storage.get(sid)` → `indexed`; early-exit/failed — как есть (`unattributed`/`no_new_messages`/`failed:<class>`).
  - `all_empty`-ветка (по снапшоту) — **без изменений** (только explicit-ids идут через новый диспатч).
  - Cap: `max` (20/вызов) — общий (как сейчас).
  - Log `memory:reindex.sessions` — расширение полей: `full_index` (число попыток full-reindex), `indexed`, `not_found`, `skip_service`, `unattributed`, `no_new_messages`, `failed` (агрегаты, SEC-4b).
  - Ответ tool'а — строки `- <sid>: <status>` (как сейчас) + агрегатная строка с новыми счётчиками.

- [ ] **Step 1: Write the failing tests**

В конец `index.test.js`:

```js
// ── #77 Task 6: memory_reindex full-reindex ──

async function reindexFixture(overrides = {}) {
  const dir = mkdtempSync(join(tmpdir(), "mem-reidx-"));
  execSync("git init -q -b main", { cwd: dir, stdio: "ignore" });
  execSync("git -c user.email=t@t.local -c user.name=t commit -q --allow-empty -m x", { cwd: dir, stdio: "ignore" });
  const records = new Map(); // session_id → record
  const storage = {
    ...mkMockStorage(),
    scan: async () => [...records.values()],
    get: async (sid) => records.get(sid) ?? null,
    upsert: async (es) => { for (const e of es) records.set(e.session_id, e); },
  };
  const state = {
    summarized: new Map(), attempts: new Map(), skips: new Map(),
    getLastSummarized: async (id) => state.summarized.get(id) ?? null,
    setSummarized: async (id) => { state.summarized.set(id, Date.now()); },
    getLastAttempt: async (id) => state.attempts.get(id) ?? null,
    recordFail: async (id) => { state.attempts.set(id, Date.now()); },
    isSkipped: async (id) => state.skips.get(id) === true,
    clearSkip: async (id) => { state.skips.delete(id); state.attempts.delete(id); },
    unindexed: async () => [],
    getFirstRun: async () => Date.now(),
    getEmbedderProbe: async () => null,
  };
  const client = {
    session: {
      get: async ({ path }) => (overrides.missing ? null : { data: { id: path.id, parentID: overrides.parentIDs?.has(path.id) ? "p1" : null, title: "st", time: { created: 1, updated: 100 } } }),
      messages: async () => ({ data: overrides.emptyMessages ? [] : [{ info: { role: "user", time: { created: 50 } }, parts: [{ type: "text", text: "hello world" }] }] }),
      list: async () => ({ data: [] }),
      prompt: async () => ({ data: { parts: [{ type: "text", text: JSON.stringify({ title: "t", summary: "s", decisions: [] }) }] } }),
    },
  };
  let hooks;
  const init = async () => {
    hooks = await registerMemoryHooks({
      client, config: mkConfig(dir), log: { debug() {}, info() {}, warn() {}, error() {} },
      root: dir, deps: { embeddings: { embed: async () => new Float32Array([0.1, 0.2, 0.3]), dim: 3, modelId: "m" }, storage },
    });
    return hooks;
  };
  const run = async (args) => hooks.tool.memory_reindex.execute(args, { sessionID: "top" });
  return { dir, records, state, storage, client, init, run, hooks: () => hooks };
}

test("#77 T6-1: отсутствующая запись + fresh lastAttempt → full re-index → indexed (post-fact)", async () => {
  const f = await reindexFixture();
  const saved = process.env.XDG_DATA_HOME;
  process.env.XDG_DATA_HOME = f.dir;
  try {
    await f.init();
    f.state.attempts.set("s1", Date.now()); // C1: только что страйк, throttle активен
    const out = await f.run({ action: "run", source: "sessions", session_ids: "s1" });
    assert.ok(out.includes("s1: indexed"), `indexed в ответе: ${out}`);
    assert.ok(f.records.has("s1"), "запись создана в storage (post-fact)");
    assert.equal(f.state.attempts.get("s1"), undefined, "clearSkip: lastAttempt сброшен");
    await f.hooks().dispose?.();
  } finally {
    if (saved === undefined) delete process.env.XDG_DATA_HOME; else process.env.XDG_DATA_HOME = saved;
    rmSync(f.dir, { recursive: true, force: true });
  }
});

test("#77 T6-2: skip=true + запись существует → full re-index, skip сброшен", async () => {
  const f = await reindexFixture();
  const saved = process.env.XDG_DATA_HOME;
  process.env.XDG_DATA_HOME = f.dir;
  try {
    await f.init();
    f.records.set("s2", { session_id: "s2", key: "test.ns", version: 1, title: "old", summary: "old", decisions: [], embedding: new Float32Array([0.1, 0.2, 0.3]), head: "b".repeat(40), branch: "main" });
    f.state.skips.set("s2", true);
    const out = await f.run({ action: "run", source: "sessions", session_ids: "s2" });
    assert.ok(out.includes("s2: indexed"), `indexed: ${out}`);
    assert.equal(f.state.skips.get("s2"), undefined, "skip сброшен");
    await f.hooks().dispose?.();
  } finally {
    if (saved === undefined) delete process.env.XDG_DATA_HOME; else process.env.XDG_DATA_HOME = saved;
    rmSync(f.dir, { recursive: true, force: true });
  }
});

test("#77 T6-3: stale-record (F1): запись существует, fails=1, lastAttempt > lastSummarized → full re-index (не artifacts top-up)", async () => {
  const f = await reindexFixture();
  const saved = process.env.XDG_DATA_HOME;
  process.env.XDG_DATA_HOME = f.dir;
  try {
    await f.init();
    f.records.set("s3", { session_id: "s3", key: "test.ns", version: 1, title: "old", summary: "old", decisions: [], embedding: new Float32Array([0.1, 0.2, 0.3]), head: "c".repeat(40), branch: "main", model_id: "m" });
    f.state.summarized.set("s3", Date.now() - 1000);
    f.state.attempts.set("s3", Date.now()); // stale: attempt после summarized
    const out = await f.run({ action: "run", source: "sessions", session_ids: "s3" });
    assert.ok(out.includes("s3: indexed"), `full-reindex, не updated: ${out}`);
    assert.ok(f.records.get("s3").version >= 2, "запись пересаммаризирована (version bump)");
    await f.hooks().dispose?.();
  } finally {
    if (saved === undefined) delete process.env.XDG_DATA_HOME; else process.env.XDG_DATA_HOME = saved;
    rmSync(f.dir, { recursive: true, force: true });
  }
});

test("#77 T6-4: актуальная запись → artifacts top-up, 0 LLM (регрессия п.1)", async () => {
  const f = await reindexFixture();
  const saved = process.env.XDG_DATA_HOME;
  process.env.XDG_DATA_HOME = f.dir;
  try {
    await f.init();
    f.records.set("s4", { session_id: "s4", key: "test.ns", version: 1, title: "t", summary: "s", decisions: [], embedding: new Float32Array([0.1, 0.2, 0.3]), head: "d".repeat(40), branch: "main", model_id: "m", artifacts: [] });
    const out = await f.run({ action: "run", source: "sessions", session_ids: "s4" });
    assert.ok(/s4: (updated|no_change|skip_\w+)/.test(out), `artifacts-статус: ${out}`);
    assert.ok(!out.includes("s4: indexed"), "не full-reindex");
    await f.hooks().dispose?.();
  } finally {
    if (saved === undefined) delete process.env.XDG_DATA_HOME; else process.env.XDG_DATA_HOME = saved;
    rmSync(f.dir, { recursive: true, force: true });
  }
});

test("#77 T6-5: пустой транскрипт → no_new_messages (edge: запись удалена memory_forget)", async () => {
  const f = await reindexFixture({ emptyMessages: true });
  const saved = process.env.XDG_DATA_HOME;
  process.env.XDG_DATA_HOME = f.dir;
  try {
    await f.init();
    const out = await f.run({ action: "run", source: "sessions", session_ids: "s5" });
    assert.ok(out.includes("s5: no_new_messages"), `no_new_messages: ${out}`);
    assert.ok(!f.records.has("s5"), "запись не создана");
    await f.hooks().dispose?.();
  } finally {
    if (saved === undefined) delete process.env.XDG_DATA_HOME; else process.env.XDG_DATA_HOME = saved;
    rmSync(f.dir, { recursive: true, force: true });
  }
});

test("#77 T6-6: сессия не найдена → not_found, без броска", async () => {
  const f = await reindexFixture({ missing: true });
  const saved = process.env.XDG_DATA_HOME;
  process.env.XDG_DATA_HOME = f.dir;
  try {
    await f.init();
    const out = await f.run({ action: "run", source: "sessions", session_ids: "ghost" });
    assert.ok(out.includes("ghost: not_found"), `not_found: ${out}`);
    await f.hooks().dispose?.();
  } finally {
    if (saved === undefined) delete process.env.XDG_DATA_HOME; else process.env.XDG_DATA_HOME = saved;
    rmSync(f.dir, { recursive: true, force: true });
  }
});

test("#77 T6-7: task-сессия (parentID) → skip_service (F3)", async () => {
  const f = await reindexFixture({ parentIDs: new Set(["task1"]) });
  const saved = process.env.XDG_DATA_HOME;
  process.env.XDG_DATA_HOME = f.dir;
  try {
    await f.init();
    const out = await f.run({ action: "run", source: "sessions", session_ids: "task1" });
    assert.ok(out.includes("task1: skip_service"), `skip_service: ${out}`);
    await f.hooks().dispose?.();
  } finally {
    if (saved === undefined) delete process.env.XDG_DATA_HOME; else process.env.XDG_DATA_HOME = saved;
    rmSync(f.dir, { recursive: true, force: true });
  }
});

test("#77 T6-8: хранилище лежит при full-reindex → failed: storage_error + повторный recordFail (счётчик с 0)", async () => {
  const f = await reindexFixture();
  const saved = process.env.XDG_DATA_HOME;
  process.env.XDG_DATA_HOME = f.dir;
  try {
    await f.init();
    f.storage.upsert = async () => { throw new Error("db down"); };
    f.state.skips.set("s9", true);
    const out = await f.run({ action: "run", source: "sessions", session_ids: "s9" });
    assert.ok(out.includes("s9: failed: storage_error"), `failed: ${out}`);
    assert.ok(f.state.attempts.get("s9"), "recordFail вызван (счётчик с 0 после clearSkip)");
    await f.hooks().dispose?.();
  } finally {
    if (saved === undefined) delete process.env.XDG_DATA_HOME; else process.env.XDG_DATA_HOME = saved;
    rmSync(f.dir, { recursive: true, force: true });
  }
});

test("#77 T6-9: cap 20 — 25 явных ID → обработано 20, cap-пометка в ответе (M2)", async () => {
  const f = await reindexFixture({ missing: true });
  const saved = process.env.XDG_DATA_HOME;
  process.env.XDG_DATA_HOME = f.dir;
  try {
    await f.init();
    const ids = Array.from({ length: 25 }, (_, i) => `s${i}`).join(",");
    const out = await f.run({ action: "run", source: "sessions", session_ids: ids });
    const processed = (out.match(/s\d+: /g) ?? []).length;
    assert.equal(processed, 20, `cap 20: ${processed}`);
    assert.ok(out.includes("cap"), "cap-пометка в ответе");
    await f.hooks().dispose?.();
  } finally {
    if (saved === undefined) delete process.env.XDG_DATA_HOME; else process.env.XDG_DATA_HOME = saved;
    rmSync(f.dir, { recursive: true, force: true });
  }
});
```

Примечания к фикстуре:
- `XDG_DATA_HOME` задаётся ПОСЛЕ создания `dir` (до `init`), как во всех тестах `index.test.js` (git-repo dir — root).
- Write-gate в full-reindex: git head резолвится из реального tmp-repo (commit создан) — проходит.
- T6-5 (write-gate `unattributed`) покрывается на indexer-уровне (T4-3) — дублировать в tool-фикстуре не нужно.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test plugins/maestro-bootstrap/memory/index.test.js 2>&1 | rg "#77 T6"`
Expected: FAIL — явные ID сейчас идут напрямую в `reindexSessionArtifacts` (`skip_no_record`).

- [ ] **Step 3: Implement диспатч**

В блоке `if (args.source === "sessions")` (`index.js:1214-1257`) заменить тело (от `let ids = ...` до `return` с агрегатом) на:

```js
              let explicit = args.session_ids ? args.session_ids.split(",").map((s) => s.trim()).filter(Boolean) : [];
              let snapshotIds = [];
              if (args.all_empty) {
                if (reindexSnapshot === null) {
                  return "memory_reindex: сначала выполните list (action: \"list\"), затем run с all_empty — выбор по снапшоту листинга";
                }
                snapshotIds = [...reindexSnapshot.sessions.keys()];
              }
              const uniqueExplicit = [...new Set(explicit)];
              const uniqueAll = [...new Set(snapshotIds)];
              const capped = uniqueExplicit.length > max || uniqueAll.length > max;
              const selExplicit = uniqueExplicit.slice(0, max);
              const selAll = uniqueAll.slice(0, max).filter((id) => !selExplicit.includes(id));
              const selected = [...selExplicit, ...selAll];
              if (!selected.length) return "memory_reindex: ничего не выбрано для индексации (sessions).";
              const agg = {
                selected: selected.length, updated: 0, no_change: 0, already_indexed: 0,
                // #77: full-reindex-счётчики (агрегаты, SEC-4b)
                indexed: 0, full_index: 0, not_found: 0, skip_service: 0,
                unattributed: 0, no_new_messages: 0, failed: 0,
                skipped: {},
              };
              const lines = [];
              // #77 (spec §5.1): диспатч явных ID по временному критерию N1 —
              // тот же, что у state.unindexed(). all_empty (снапшот) — legacy:
              // только artifacts top-up.
              const artifactsDeps = {
                client, storage, root, key: effectiveKey,
                artifactGlobs: config.artifact_globs,
                artifactConfidentialPatterns,
                confidentialPatterns: confidentialPaths,
                embedModelId: embeddings.modelId,
              };
              for (const sid of selected) {
                try {
                  let status;
                  if (selExplicit.includes(sid)) {
                    // pre-check (R2): not_found / skip_service — ДО reindexSession
                    let sess = null;
                    try {
                      const resp = await client.session.get({ path: { id: sid } });
                      sess = resp?.data ?? resp;
                    } catch { /* sess = null → not_found */ }
                    if (!sess || typeof sess !== "object") {
                      status = "not_found";
                    } else if (sess.parentID || SESSIONS.has(sid)) {
                      status = "skip_service";
                    } else {
                      const rec = await storage.get(sid);
                      const lastSum = await state.getLastSummarized(sid);
                      const lastAtt = await state.getLastAttempt(sid);
                      const isSkip = await state.isSkipped(sid);
                      const stale = isSkip || (lastAtt != null && (lastSum == null || lastAtt > lastSum));
                      if (rec && !stale) {
                        const r = await reindexSessionArtifacts(artifactsDeps, sid);
                        status = r.status;
                      } else {
                        agg.full_index++;
                        const r = await indexer.reindexSession(sid);
                        if (r.status === "ok") {
                          const post = await storage.get(sid); // post-fact-арбитр (C2)
                          status = post ? "indexed" : "failed: index_error";
                        } else {
                          status = r.status; // unattributed | no_new_messages | failed:<class>
                        }
                      }
                    }
                  } else {
                    // legacy (all_empty): artifacts top-up, 0 LLM
                    const r = await reindexSessionArtifacts(artifactsDeps, sid);
                    status = r.status;
                  }
                  if (status === "updated") agg.updated++;
                  else if (status === "no_change") agg.no_change++;
                  else if (status === "indexed") agg.indexed++;
                  else if (status === "not_found") agg.not_found++;
                  else if (status === "skip_service") agg.skip_service++;
                  else if (status === "unattributed") agg.unattributed++;
                  else if (status === "no_new_messages") agg.no_new_messages++;
                  else if (status.startsWith("failed:")) agg.failed++;
                  else agg.skipped[status] = (agg.skipped[status] ?? 0) + 1;
                  lines.push(`- ${sid}: ${status}`);
                } catch (err) {
                  agg.skipped.error = (agg.skipped.error ?? 0) + 1;
                  lines.push(`- ${sid}: error`);
                }
              }
              // Task 4: телеметрия — aggregates-only (SEC-4b).
              logInfo("memory:reindex.sessions", {
                selected: agg.selected, updated: agg.updated, no_change: agg.no_change,
                already_indexed: agg.already_indexed,
                full_index: agg.full_index, indexed: agg.indexed,
                not_found: agg.not_found, skip_service: agg.skip_service,
                unattributed: agg.unattributed, no_new_messages: agg.no_new_messages,
                failed: agg.failed, skipped: agg.skipped,
              });
              const capNote = capped ? ` (cap: взяты первые ${max})` : "";
              return `memory_reindex (sessions): selected=${agg.selected}, updated=${agg.updated}, no_change=${agg.no_change}, indexed=${agg.indexed}, full_index=${agg.full_index}, failed=${agg.failed}, skipped=${JSON.stringify(agg.skipped)}${capNote}\n` + lines.join("\n");
```

Обновить `description` tool'а (строка ~1095): добавить `; явные session_ids с отсутствующей/stale-записью — полный re-index (LLM, сброс skip)`.

- [ ] **Step 4: Run all memory tests**

Run: `npm run test:memory 2>&1 | tail -8`
Expected: 0 fail (T6-x + существующие `memory_reindex`-тесты — `all_empty`/git-пути не тронуты).

- [ ] **Step 5: Commit**

```bash
git add plugins/maestro-bootstrap/memory/index.js plugins/maestro-bootstrap/memory/index.test.js
git commit -m "feat(memory): memory_reindex full-reindex dispatch (N1 criterion, #77)"
```

---

### Task 7: `index.js` — `memory_stats_detail`: блок «не индексированные сессии»

**Model:** haiku (механическая вставка + тест)

**Files:**
- Modify: `plugins/maestro-bootstrap/memory/index.js:1665-1668` (после probe-строки, перед «По авторам:»)
- Test: `plugins/maestro-bootstrap/memory/index.test.js`

**Interfaces:**
- Consumes: Task 1 (`state.unindexed()`).
- Produces: в выводе `memory_stats_detail` блок: `Не индексированные сессии: N` + строки `  <session_id> | skip=<0|1> | fails=<n> | reason=<класс|-> | last_attempt=<ISO|->`, cap 20 строк + `  …(+N ещё)`; 0 → одна строка `Не индексированные сессии: 0 (все сессии проиндексированы)`. SEC-4b: session_id + enum/числа (паритет существующего вывода).

- [ ] **Step 1: Write the failing tests**

В конец `index.test.js`. **Важно:** state-файл `registerMemoryHooks` создаётся по внутреннему пути `<XDG_DATA_HOME>/maestro/memory/state.json` — тесты заполняют **именно его** ДО `init`:

```js
test("#77 T7-1: memory_stats_detail — unindexed-блок (cap 20 + «…(+N ещё)»)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mem-stats-"));
  const saved = process.env.XDG_DATA_HOME;
  process.env.XDG_DATA_HOME = dir;
  try {
    const { createState } = await import("./state.js");
    const st = createState(join(dir, "maestro", "memory", "state.json"));
    // 22 stale-сессии → cap 20
    for (let i = 0; i < 22; i++) await st.recordFail(`u${i}`, i % 2 ? "storage_error" : "embedder_error");
    // одна самовосстановившаяся → НЕ в списке (N1)
    await st.recordFail("healed");
    await st.setSummarized("healed");
    const hooks = await registerMemoryHooks({
      client: mkClient(), config: mkConfig(dir), log: { debug() {}, info() {}, warn() {}, error() {} },
      root: dir,
      deps: { embeddings: mkMockEmbeddings(), storage: { ...mkMockStorage(), scan: async () => [] } },
    });
    const out = await hooks.tool.memory_stats_detail.execute({}, { sessionID: "top" });
    assert.ok(out.includes("Не индексированные сессии: 22"), `блок с N=22: ${out.slice(0, 500)}`);
    assert.ok(out.includes("…(+2 ещё)"), "cap-пометка");
    assert.ok(!out.includes("healed"), "самовосстановившаяся не в списке (N1)");
    assert.ok(out.includes("reason=storage_error"));
    assert.ok(out.includes("reason=embedder_error"));
    await hooks.dispose?.();
  } finally {
    if (saved === undefined) delete process.env.XDG_DATA_HOME; else process.env.XDG_DATA_HOME = saved;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("#77 T7-2: memory_stats_detail — все проиндексированы → 0-строка", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mem-stats0-"));
  const saved = process.env.XDG_DATA_HOME;
  process.env.XDG_DATA_HOME = dir;
  try {
    const hooks = await registerMemoryHooks({
      client: mkClient(), config: mkConfig(dir), log: { debug() {}, info() {}, warn() {}, error() {} },
      root: dir,
      deps: { embeddings: mkMockEmbeddings(), storage: { ...mkMockStorage(), scan: async () => [] } },
    });
    const out = await hooks.tool.memory_stats_detail.execute({}, { sessionID: "top" });
    assert.ok(out.includes("Не индексированные сессии: 0"), `0-строка: ${out.slice(0, 400)}`);
    await hooks.dispose?.();
  } finally {
    if (saved === undefined) delete process.env.XDG_DATA_HOME; else process.env.XDG_DATA_HOME = saved;
    rmSync(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test plugins/maestro-bootstrap/memory/index.test.js 2>&1 | rg "T7-"`
Expected: FAIL — блока «Не индексированные сессии» нет.

- [ ] **Step 3: Implement**

В `memory_stats_detail.execute`, после probe-строки (~строка 1667, перед `out.push("По авторам:");`):

```js
            // #77 (spec §5.2): неиндексированные сессии (G2) — временной
            // критерий state.unindexed(); cap 20 строк + «…(+N ещё)».
            // SEC-4b: session_id + enum/числа — паритет существующего вывода.
            let unindexed = [];
            try { unindexed = await state.unindexed(); } catch { /* fail-soft */ }
            if (unindexed.length === 0) {
              out.push("Не индексированные сессии: 0 (все сессии проиндексированы)");
            } else {
              out.push(`Не индексированные сессии: ${unindexed.length}`);
              const rows = unindexed.slice(0, 20);
              for (const u of rows) {
                out.push(`  ${u.id} | skip=${u.skip ? 1 : 0} | fails=${u.fails} | reason=${u.lastErrorClass ?? "-"} | last_attempt=${u.lastAttempt ? new Date(u.lastAttempt).toISOString() : "-"}`);
              }
              if (unindexed.length > rows.length) out.push(`  …(+${unindexed.length - rows.length} ещё)`);
            }
```

- [ ] **Step 4: Run all memory tests**

Run: `npm run test:memory 2>&1 | tail -5`
Expected: 0 fail.

- [ ] **Step 5: Commit**

```bash
git add plugins/maestro-bootstrap/memory/index.js plugins/maestro-bootstrap/memory/index.test.js
git commit -m "feat(memory): memory_stats_detail unindexed-sessions block (#77)"
```

---

### Task 8: E2E — full-reindex восстанавливает потерюнную запись (реальный sqlite + mock-LLM)

**Model:** sonnet

**Files:**
- Test: `plugins/maestro-bootstrap/memory/index.test.js` (E2E-блок; DoD: «Full-reindex восстанавливает отсутствующую запись (E2E-тест с реальным sqlite + mock-LLM) и снимает permanent-skip»)

**Interfaces:**
- Consumes: Tasks 1-7 (вся цепочка), `createStorage` (`./storage.js`), `Indexer` (`./indexer.js`), `createState` (`./state.js`).
- Produces: E2E-тест без изменения продуктового кода. Если тест вскроет баг в цепочке — чинить в соответствующем модуле (фикс — в этом же task, с обновлением теста).

- [ ] **Step 1: Write the E2E test**

В конец `index.test.js`:

```js
// ── #77 Task 8: E2E — реальный sqlite + mock-LLM ──

test("#77 E2E: full re-index restores lost sqlite record and resets permanent-skip", async () => {
  const { createState } = await import("./state.js");
  const { Indexer } = await import("./indexer.js");
  const { createStorage } = await import("./storage.js");
  const dir = mkdtempSync(join(tmpdir(), "mem-e2e-"));
  const saved = process.env.XDG_DATA_HOME;
  process.env.XDG_DATA_HOME = dir;
  const head = "e".repeat(40);
  try {
    const state = createState(join(dir, "state.json"));
    const embeddings = { embed: async () => new Float32Array([0.1, 0.2, 0.3]), dim: 3, modelId: "m" };
    const client = {
      session: {
        get: async () => ({ data: { id: "s1", parentID: null, title: "st", time: { created: 1, updated: 100 } } }),
        messages: async () => ({ data: [{ info: { role: "user", time: { created: 50 } }, parts: [{ type: "text", text: "hello e2e" }] }] }),
        list: async () => ({ data: [] }),
      },
    };
    const summarize = async () => ({ title: "t", summary: "s-e2e", decisions: [] });
    const cfg = {
      min_new_messages: 1, idle_debounce_min: 10, backfill_window_days: 30,
      backfill_max_per_start: 5, retry_interval_min: 0, namespace: null,
      top_k: 3, min_score: 0.35, author: "test",
    };
    const mkIdx = () => new Indexer({
      client, config: cfg, embeddings, storage, state, summarize,
      projectKey: { hash: "khash", source: "remote" }, confidentialPatterns: [],
      git: { resolveBranch: async () => "main", resolveHead: async () => head },
      logInfo: () => {}, logDebug: () => {}, logWarn: () => {}, logError: () => {},
    });
    const storage = createStorage({ type: "sqlite", options: { dbPath: join(dir, "memory.db") }, modelId: "m", dim: 3 });
    await storage.init();
    const origUpsert = storage.upsert.bind(storage);

    // 1. Бэкенд «падает»: upsert throw × 3 → permanent-skip, записей нет
    const idx = mkIdx();
    storage.upsert = async () => { throw new Error("qdrant down"); };
    for (let i = 0; i < 3; i++) await idx._pipeline("s1");
    assert.equal(await state.isSkipped("s1"), true, "permanent-skip после 3 страйков");
    assert.equal((await storage.scan({ key: "khash" })).length, 0, "потеря данных");
    idx.dispose();

    // 2. Бэкенд «ожил»: штатный путь НЕ восстанавливает (skip-guard _run) —
    // восстановление ТОЛЬКО по требованию (non-goal: live-recovery)
    storage.upsert = origUpsert;
    const idxRun = mkIdx();
    await idxRun._run("s1");
    assert.equal((await storage.scan({ key: "khash" })).length, 0, "skip-сессия штатным путём не восстанавливается");
    idxRun.dispose();

    // 3. HITL: memory_reindex → reindexSession → запись восстановлена
    const idx2 = mkIdx();
    const r = await idx2.reindexSession("s1");
    assert.equal(r.status, "ok");
    const rows = await storage.scan({ key: "khash" });
    assert.equal(rows.length, 1, "запись восстановлена (post-fact)");
    assert.equal(rows[0].session_id, "s1");
    assert.ok(rows[0].summary.length > 0, "summary из mock-LLM");
    assert.equal(await state.isSkipped("s1"), false, "permanent-skip снят");
    assert.equal(rows[0].head, head, "head из git-резолва");

    // 4. Повторный прогон после восстановления — честный early-exit (no_new_messages)
    const r2 = await idx2._pipeline("s1");
    assert.equal(r2.status, "no_new_messages", "новых сообщений нет — early-exit");
    storage.dispose();
    idx2.dispose();
  } finally {
    if (saved === undefined) delete process.env.XDG_DATA_HOME; else process.env.XDG_DATA_HOME = saved;
    rmSync(dir, { recursive: true, force: true });
  }
});
```

Примечания:
- `key` записи = `resolveEffectiveKey({ projectHash: "khash", namespace: null })` = `"khash"` — scan по этому key.
- `min_new_messages: 1` + сообщения с `time.created: 50`: первый прогон (lastSummarized null) — check не применяется; после восстановления — все сообщения «старые» → `no_new_messages`.
- Если `createStorage`/`Indexer` не экспортируются ожидаемым образом — сверить с импортами `index.js` (они там есть: `import { createStorage } from "./storage.js"`).

- [ ] **Step 2: Run the E2E test**

Run: `node --test plugins/maestro-bootstrap/memory/index.test.js 2>&1 | rg "#77 E2E|fail "`
Expected: PASS. Если FAIL — чинить в модуле (не ослаблять тест).

- [ ] **Step 3: Run full suites**

Run: `npm run test:memory 2>&1 | tail -5 && npm test 2>&1 | tail -5`
Expected: 0 fail в обоих сьютах.

- [ ] **Step 4: Commit**

```bash
git add plugins/maestro-bootstrap/memory/index.test.js
git commit -m "test(memory): E2E full-reindex restores lost sqlite record, skip reset (#77)"
```

---

### Task 9: Документация, команды, регресс-реестр, changelog, версия 4.7.1

**Model:** haiku (трансляция; текст — из спеки §10)

**Files:**
- Modify: `commands/maestro-memory.md`, `commands/maestro-memory-reindex.md`, `manual_docs/reference/memory.md`, `manual_docs/reference/commands.md`, `AGENTS.md`, `changelog.md`, `package.json` (version)
- Create: `manual_docs/how-to/restore-unsaved-session-memory.md`, `regression/entries/memory-fail-loud.md`
- **НЕ трогать:** `docs/roadmap.md` (#77 закрывается после merge — на шаге финиша ветки), `SECURITY.md`, `skills/maestro/SKILL.md`

- [ ] **Step 1: `commands/maestro-memory.md`** — добавить сценарий:

```markdown
## Не индексированные сессии

`memory_stats_detail` показывает блок «Не индексированные сессии: N» — сессии,
данные которых НЕ сохранены в памяти (сбой индексирования). Для каждой —
reason-класс, skip-флаг, время последней попытки. 0 — «все сессии
проиндексированы». Если N > 0 — предложить пользователю восстановление через
`@maestro-memory-reindex` (явные session_id из списка).
```

- [ ] **Step 2: `commands/maestro-memory-reindex.md`** — добавить сценарий:

```markdown
## Восстановить память за сессию, которая не сохранилась

Если сессия получила уведомление «данные НЕ сохранены в памяти» (или
`@maestro-memory` показал «Не индексированные сессии > 0»):

1. `memory_reindex` `action: "list"` — ориентир (не обязателен для явных ID).
2. `memory_reindex` `action: "run", source: "sessions", session_ids: "<id из уведомления/статуса>"`.
3. Явный ID с отсутствующей или stale-записью → **полный re-index** (LLM-summarize
   из сессии; затраты — как у штатного индексирования, один summarize на сессию) +
   сброс permanent-skip. Актуальная запись → artifacts top-up (0 LLM).
4. Статусы: `indexed` (восстановлено), `unattributed` (нет git-head),
   `no_new_messages` (мало нового), `not_found`, `skip_service`,
   `failed: <класс>` (хранилище всё ещё недоступно — повторить позже).
```

- [ ] **Step 3: `manual_docs/reference/memory.md`** — таблица «Ошибки и деградация»: обновить строки:

```markdown
| Ситуация | Поведение |
|---|---|
| Бэкенд недоступен (при старте) | Память off в процессе; **уведомление в сессию (system-notice)** «память не работает в этом процессе (причина)» на каждой top-level сессии; инструменты памяти недоступны |
| Сбой индексации во время работы | **Уведомление в текущую сессию** «данные НЕ сохранены в памяти (причина)» при первой неудаче (не после 3); retryable-сбои (сеть) уведомление не генерируют; восстановление — `@maestro-memory-reindex` (full-reindex) или перезапуск opencode |
| «skip after 3» (permanent-skip) | Сбрасывается `memory_reindex` (full-reindex по явному session_id); до сброса штатное индексирование сессию не берёт |
```

+ секция `memory_reindex`: абзац «Полный re-index (full-reindex): явный session_id с отсутствующей/stale-записью → LLM-summarize из сессии + сброс skip; статусы — indexed/unattributed/no_new_messages/not_found/skip_service/failed:<класс>».
+ секция `@maestro-memory`: «Блок „Не индексированные сессии: N" — cap 20 строк».

- [ ] **Step 4: `manual_docs/how-to/restore-unsaved-session-memory.md`** (новая, короткая):

```markdown
# Память сессии не сохранилась — как восстановить

Если в сессии появилось уведомление «maestro memory: данные этой сессии НЕ
сохранены в памяти (причина: …)» — запись сессии в память не попала (сбой
хранилища/эмбеддера). Данные самой сессии в opencode целы.

1. Посмотреть масштаб: `@maestro-memory` → блок «Не индексированные сессии».
2. Восстановить: `@maestro-memory-reindex` → `action: "run", source: "sessions",
   session_ids: "<id>"`. Запись пересаммаризируется (LLM-затраты) и пишется в
   хранилище; permanent-skip сбрасывается.
3. Если статус `failed: storage_error` — хранилище всё ещё недоступно:
   восстановить доступ (URL/ключ/сеть) и повторить. Перезапуск opencode тоже
   позволяет повторить индексирование, пока сессия не ушла в skip.
```

- [ ] **Step 5: `manual_docs/reference/commands.md`** — строки по `@maestro-memory` (unindexed-блок) и `@maestro-memory-reindex` (full-reindex) — по тексту Step 1-2.

- [ ] **Step 6: `AGENTS.md`** — в описание плагина (`plugins/maestro-bootstrap/`, memory-абзац), добавить:
`Fail-loud (4.7.1): при сбое индексирования — уведомление в сессию (system-notice, per-session + process-level); восстановление — memory_reindex full-reindex по явным session_id (сброс permanent-skip); memory_stats_detail — блок «не индексированные сессии». Команда @maestro-memory-reindex расширяется сценарием восстановления.`

- [ ] **Step 7: `changelog.md`** — новая секция (формат — как у 4.7.0):

```markdown
## 4.7.1 (2026-09-23)

### Added
- Memory: «громкий» fail-closed — уведомление в сессию при сбое индексирования
  (per-session: первая hard-ошибка; process-level: бэкенд down при старте);
  уведомление снимается после успешного индексирования.
- Memory: `memory_reindex` — полный re-index (full-reindex) отсутствующей/stale
  записи по явным session_id (LLM-summarize из сессии, сброс permanent-skip).
- Memory: `memory_stats_detail` — блок «Не индексированные сессии: N»
  (reason-класс, skip, последняя попытка; cap 20).

### Changed
- `memory:index_error` — error_class теперь стадииный
  (storage_error/embedder_error/index_error/retryable); retryable-ошибки, как и
  раньше, не съедают страйки.
```

- [ ] **Step 8: `package.json`** — `"version": "4.7.0"` → `"version": "4.7.1"`.

- [ ] **Step 9: `regression/entries/memory-fail-loud.md`** (новый; формат — как у соседей в `regression/entries/`):

```markdown
# memory-fail-loud (#77)

**Риск:** повторная ТИХАЯ потеря данных сессий при недоступном хранилище
(уведомление не доходит / восстановление не работает) — пользователь продолжает
«рассуждать о памяти проекта» как об актуальной.

**Триггеры отката:**
- `memory:unsaved_notice` не эмитится при upsert-fail (regression: T5-1/T3-1).
- Notice не инжектится при `auto_recall: false` (I1; T5-5).
- `memory_reindex` (explicit id, запись отсутствует) не создаёт запись
  (post-fact; T6-1, E2E T8).
- Permanent-skip не сбрасывается full-reindex'ом (T4-2/T6-2/E2E).
- Retryable-ошибка ставит unsaved-флаг (ложная тревога; T3-3/T5-3).

**Тесты:** `npm run test:memory` (T3-x, T4-x, T5-x, T6-x, T7-x, E2E #77).
**Статус:** открыт (закрывается с merge фичи в main).
```

- [ ] **Step 10: Docs-верификация (grep по канон-точкам, критерий AGENTS.md)**

Run:
```bash
rg -n "НЕ сохранены|не работает в этом процессе" commands/ manual_docs/ | head
rg -n "full-reindex|Не индексированные" commands/maestro-memory-reindex.md manual_docs/reference/memory.md manual_docs/reference/commands.md AGENTS.md changelog.md | head
rg -n "4.7.1" changelog.md package.json | head
```
Expected: все канон-точки на месте (уведомления, full-reindex, unindexed-блок, версия).

- [ ] **Step 11: Final test run + commit**

Run: `npm run test:memory 2>&1 | tail -5 && npm test 2>&1 | tail -5`
Expected: 0 fail.

```bash
git add commands/ manual_docs/ AGENTS.md changelog.md package.json regression/entries/memory-fail-loud.md
git commit -m "docs(memory): fail-loud + full-reindex — docs, commands, regression, 4.7.1 (#77)"
```

---

## Self-Review (выполнен автором плана)

1. **Spec coverage:** §4.1 → Task 3; §4.2 → Task 5 (I1/I2, guard, bounded, vладение M1); §4.3 → Task 5 (тексты); §4.4 → Task 5 (off-пути поимённо); §5.1/§5.1.1/§5.1.2 → Task 4+6 (C1/C2/N1/N3/N4/R2, статусы, cap, clearSkip+F5); §5.2 → Task 7; §5.3 → Task 9 (команда); §6 (no config) → не тронут; §7 (лог-события) → Task 5 (unsaved_notice/cleared, process-scope) + Task 6 (full_index в reindex.sessions); §8 (security) → маскирование переиспользует пайплайн (Task 2), SEC-4b в тестах T3-7; §9 (тесты 1-20) → T3-1..7 (8), T4-1..6 (12-16, 17 через T6-6), T5-1..9 (1-7, 9-11), T6-1..9 (13a, 14 через T4-3, 15, 17-19), T7-1..2 (20), E2E (DoD).
2. **Placeholder scan:** TBD/TODO/«похоже на Task N» — нет; каждый шаг — с кодом или точной командой.
3. **Type consistency:** `recordFail(id, errorClass?)`, `clearSkip(id)`, `unindexed()` — едины в Task 1/3/4/6/7; `setUnsaved(sessionID, errorClass)`/`clearUnsaved(sessionID)` — едины в Task 3/5; статусы `_pipeline`/`reindexSession` — едины в Task 2/3/4/6.
4. **Review Focus:** все 5 строк привязаны к тестам (см. секцию).
