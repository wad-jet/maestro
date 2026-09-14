# Memory Summarizer Zero-key Resolve — Implementation Plan (4.0.0)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Убрать `memory.summarizer_model` из схемы конфига памяти (zero-key); модель саммаризации резолвится из opencode-конфига через `client.config.get()` по цепочке `small_model → model → agent.maestro?.model → agent.build?.model` с fail-closed guard на git-пути и fail-soft fallback на sessions-пути.

**Architecture:** Новый no-throw модуль `memory/resolve-model.js` с enum-контрактом `{ model, source, error }` (без кэша, per-call). Sessions-путь (`indexer.js`) деградирует к текущему поведению (модель сессии) при нерезолве; git-путь (`memory_reindex`, `index.js`) — hard guard до батча (0 LLM). `summarize.js` не изменяется (промпт побайтово, `model` — не `agent`). Legacy-ключ не читается (обратная совместимость не предусматривается).

**Tech Stack:** ESM JS (Node, без зависимостей), node:test (co-located тесты).

**Spec:** `docs/superpowers/specs/2026-09-14-memory-summarizer-resolve-design.md`

## Global Constraints

- Версия: `package.json` `3.5.0` → **`4.0.0`** (major, BREAKING — spec D-5, решение spec gate 2026-09-14).
- Русский — язык доков, guard-сообщений и строк `memory_reindex` list.
- `plugins/maestro-bootstrap/memory/summarize.js` **не изменяется** (I2': промпт побайтово; в `session.prompt` — `model`, не `agent`).
- Нет новых ключей в схеме `memory` (zero-key); legacy `summarizer_model` — молчаливый игнор, **нет** warn/детекта/миграции (I5, D-5).
- Telemetry — SEC-4b aggregates-only: новое событие `memory:summarizer_unavailable` (warn, поле `reason` — enum `config_get_failed | no_model_resolved | invalid_model_ref`); в `memory:summarize.duration` поле `model_source` (enum) + `model` — effective-модель. Имена/поля добавляются в whitelist `SECURITY.md`.
- Валидация model-ссылки (I6): строка, trim, `indexOf("/") > 0`, обе части вокруг **первого** `/` непустые и без внутренних пробелов; невалидная ссылка никогда не доходит до `session.prompt`.
- Тесты: `node --test plugins/maestro-bootstrap/memory/<модуль>.test.js`; полный зелёный контур: `npm run test:memory && npm test`.
- TDD: каждый код-задач — failing test → verify fail → минимальная реализация → verify pass → commit.
- Regression entry: `regression/entries/2026-09-14-memory-summarizer-resolve.md` (формат — как `2026-09-12-memory-reindex-backfill.md`).

**Spec-follow-ups из контрольного Spec Review (5 Minor, встроены в задачи):**
- SF-1: отсутствующие (`undefined`/`null`) кандидаты пропускаются **без** установки invalid-флага (→ Task 1).
- SF-2: внутренние пробелы в частях (`"prov /m1"`, `"prov/ m1"`) — отклонять, класс degenerate-ссылок (→ Task 1).
- SF-3: явные якоря док-правок вне memory.md (config.md 381/430, model-selection.md 163/169, README 228, maestro-assistant 73/193) (→ Task 5).
- SF-4: `memory:summarize.duration` не именован в whitelist SECURITY.md (pre-existing) — добавить имя события + уточнить формулировку (→ Task 5).
- SF-5: в `model_source` duration-события (sessions-путь) возможны только `small_model | model | session` — `agent_maestro`/`agent_build` недостижимы; НЕ синтезировать такие тест-кейсы (→ Task 3).

---

### Task 1: Модуль `resolve-model.js` (no-throw резолвер, enum-контракт)

**Files:**
- Create: `plugins/maestro-bootstrap/memory/resolve-model.js`
- Test: `plugins/maestro-bootstrap/memory/resolve-model.test.js`

**Interfaces:**
- Produces:
  - `resolveSummarizerModel({ client, root, timeoutMs = 5000 }) → Promise<{ model: string|null, source: "small_model"|"model"|"agent_maestro"|"agent_build"|null, error: "config_get_failed"|"invalid_model_ref"|"no_model_resolved"|null }>`
  - `parseModelRef(s) → { providerID: string, modelID: string } | null` (split по первому `/`, обе части валидированы)
- Consumes: ничего (zero-dep модуль; локальный timeout-хелпер, НЕ импорт из `index.js` — цикл зависимостей).

- [ ] **Step 1: Write the failing tests**

Создать `plugins/maestro-bootstrap/memory/resolve-model.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveSummarizerModel, parseModelRef } from "./resolve-model.js";

const ROOT = "/tmp/root";
function mkClient(cfg, overrides = {}) {
  return { config: { get: async () => cfg }, ...overrides };
}

test("chain: small_model wins over model", async () => {
  const r = await resolveSummarizerModel({ client: mkClient({ small_model: "a/s", model: "b/m" }), root: ROOT });
  assert.deepEqual(r, { model: "a/s", source: "small_model", error: null });
});
test("chain: model when small_model absent", async () => {
  const r = await resolveSummarizerModel({ client: mkClient({ model: "b/m" }), root: ROOT });
  assert.deepEqual(r, { model: "b/m", source: "model", error: null });
});
test("chain: agent.maestro.model when model+small_model absent", async () => {
  const r = await resolveSummarizerModel({ client: mkClient({ agent: { maestro: { model: "c/m" } } }), root: ROOT });
  assert.deepEqual(r, { model: "c/m", source: "agent_maestro", error: null });
});
test("chain: agent.build.model is last", async () => {
  const r = await resolveSummarizerModel({ client: mkClient({ agent: { build: { model: "d/m" } } }), root: ROOT });
  assert.deepEqual(r, { model: "d/m", source: "agent_build", error: null });
});
test("empty config → no_model_resolved", async () => {
  const r = await resolveSummarizerModel({ client: mkClient({}), root: ROOT });
  assert.deepEqual(r, { model: null, source: null, error: "no_model_resolved" });
});
test("unwrap: {data: cfg}", async () => {
  const r = await resolveSummarizerModel({ client: mkClient({ data: { model: "b/m" } }), root: ROOT });
  assert.deepEqual(r, { model: "b/m", source: "model", error: null });
});
test("config.get reject → config_get_failed", async () => {
  const c = { config: { get: async () => { throw new Error("net"); } } };
  const r = await resolveSummarizerModel({ client: c, root: ROOT });
  assert.deepEqual(r, { model: null, source: null, error: "config_get_failed" });
});
test("client without config (sync TypeError path) → config_get_failed", async () => {
  const r = await resolveSummarizerModel({ client: {}, root: ROOT });
  assert.deepEqual(r, { model: null, source: null, error: "config_get_failed" });
});
test("client null → config_get_failed", async () => {
  const r = await resolveSummarizerModel({ client: null, root: ROOT });
  assert.deepEqual(r, { model: null, source: null, error: "config_get_failed" });
});
test("timeout (injected) → config_get_failed", async () => {
  const c = { config: { get: () => new Promise(() => {}) } };
  const r = await resolveSummarizerModel({ client: c, root: ROOT, timeoutMs: 10 });
  assert.deepEqual(r, { model: null, source: null, error: "config_get_failed" });
});
test("invalid small_model skipped → model resolves", async () => {
  const r = await resolveSummarizerModel({ client: mkClient({ small_model: "noslash", model: "b/m" }), root: ROOT });
  assert.deepEqual(r, { model: "b/m", source: "model", error: null });
});
test("all invalid → invalid_model_ref", async () => {
  const r = await resolveSummarizerModel({ client: mkClient({ small_model: "noslash", model: "x" }), root: ROOT });
  assert.deepEqual(r, { model: null, source: null, error: "invalid_model_ref" });
});
test("degenerate 'prov/' (empty modelID) rejected → next candidate", async () => {
  const r = await resolveSummarizerModel({ client: mkClient({ small_model: "prov/", model: "b/m" }), root: ROOT });
  assert.deepEqual(r, { model: "b/m", source: "model", error: null });
});
test("degenerate '/m1' (empty providerID) rejected", async () => {
  const r = await resolveSummarizerModel({ client: mkClient({ model: "/m1" }), root: ROOT });
  assert.deepEqual(r, { model: null, source: null, error: "invalid_model_ref" });
});
test("whitespace-only '   ' → invalid", async () => {
  const r = await resolveSummarizerModel({ client: mkClient({ small_model: "   " }), root: ROOT });
  assert.deepEqual(r, { model: null, source: null, error: "invalid_model_ref" });
});
test("non-string candidate (number) → invalid, skipped", async () => {
  const r = await resolveSummarizerModel({ client: mkClient({ small_model: 42, model: "b/m" }), root: ROOT });
  assert.deepEqual(r, { model: "b/m", source: "model", error: null });
});
test("trim: '  prov/m1  ' → 'prov/m1' (результат — trimmed-строка)", async () => {
  const r = await resolveSummarizerModel({ client: mkClient({ model: "  prov/m1  " }), root: ROOT });
  assert.deepEqual(r, { model: "prov/m1", source: "model", error: null });
});
test("inner whitespace in part 'prov /m1' → invalid (SF-2)", async () => {
  const r = await resolveSummarizerModel({ client: mkClient({ small_model: "prov /m1", model: "b/m" }), root: ROOT });
  assert.deepEqual(r, { model: "b/m", source: "model", error: null });
});
test("inner whitespace 'prov/ m1' → invalid", async () => {
  const r = await resolveSummarizerModel({ client: mkClient({ model: "prov/ m1" }), root: ROOT });
  assert.deepEqual(r, { model: null, source: null, error: "invalid_model_ref" });
});
test("absent candidates (undefined/null) don't set invalid flag (SF-1)", async () => {
  const r = await resolveSummarizerModel({ client: mkClient({ small_model: null, agent: {} }), root: ROOT });
  assert.deepEqual(r, { model: null, source: null, error: "no_model_resolved" });
});
test("model with '/' in modelID: 'akash/Qwen/Qwen3.8-27B'", async () => {
  const r = await resolveSummarizerModel({ client: mkClient({ small_model: "akash/Qwen/Qwen3.8-27B" }), root: ROOT });
  assert.deepEqual(r, { model: "akash/Qwen/Qwen3.8-27B", source: "small_model", error: null });
});
test("parseModelRef: '/' in modelID", () => {
  assert.deepEqual(parseModelRef("akash/Qwen/Qwen3.8-27B"), { providerID: "akash", modelID: "Qwen/Qwen3.8-27B" });
});
test("parseModelRef: degenerate → null", () => {
  assert.equal(parseModelRef("prov/"), null);
  assert.equal(parseModelRef("/m1"), null);
  assert.equal(parseModelRef("noslash"), null);
  assert.equal(parseModelRef(42), null);
  assert.equal(parseModelRef(null), null);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test plugins/maestro-bootstrap/memory/resolve-model.test.js`
Expected: FAIL — `Cannot find module './resolve-model.js'`

- [ ] **Step 3: Write minimal implementation**

Создать `plugins/maestro-bootstrap/memory/resolve-model.js`:

```js
// Zero-key резолв модели саммаризации из opencode-конфига (4.0.0, spec §4.2).
// Без кэша (I4/D-7), no-throw: контракт { model, source, error } с enum.

const CHAIN = [
  ["small_model", (c) => c.small_model],
  ["model", (c) => c.model],
  ["agent_maestro", (c) => c.agent?.maestro?.model],
  ["agent_build", (c) => c.agent?.build?.model],
];

function validRef(v) {
  if (typeof v !== "string") return null;
  const s = v.trim();
  const i = s.indexOf("/");
  if (i <= 0) return null; // нет '/' или пустой providerID
  const provider = s.slice(0, i);
  const model = s.slice(i + 1);
  if (!provider || !model) return null; // degenerate: "prov/" | "/m1"
  // Внутренние пробелы в частях — тот же класс degenerate-ссылок (SF-2).
  if (provider.trim() !== provider || model.trim() !== model) return null;
  return s;
}

export function parseModelRef(s) {
  const v = validRef(s);
  if (!v) return null;
  const i = v.indexOf("/");
  return { providerID: v.slice(0, i), modelID: v.slice(i + 1) };
}

function withLocalTimeout(p, ms) {
  let timer;
  const to = new Promise((_, rej) => {
    timer = setTimeout(() => rej(new Error("timeout")), ms);
  });
  return Promise.race([p, to]).finally(() => clearTimeout(timer));
}

/**
 * Resolves the summarization model from opencode config (GET /config).
 * Chain: small_model → model → agent.maestro.model → agent.build.model.
 * Absent (undefined/null) candidates are skipped WITHOUT setting the
 * invalid flag (SF-1); invalid candidates are skipped fail-soft with the flag.
 * Any failure of the config call (network, timeout, missing client.config —
 * incl. synchronous TypeError) → config_get_failed. No cache (I4).
 *
 * @param {object} o
 * @param {object} o.client  opencode SDK client
 * @param {string} o.root    project directory (config.get query)
 * @param {number} [o.timeoutMs]  guard-таймаут (default 5000)
 * @returns {Promise<{model: (string|null), source: ("small_model"|"model"|"agent_maestro"|"agent_build"|null), error: ("config_get_failed"|"invalid_model_ref"|"no_model_resolved"|null)}>}
 */
export async function resolveSummarizerModel({ client, root, timeoutMs = 5000 } = {}) {
  let cfg;
  try {
    const fn = client?.config?.get;
    if (typeof fn !== "function") throw new Error("client.config.get missing");
    const res = await withLocalTimeout(fn.call(client.config, { query: { directory: root } }), timeoutMs);
    cfg = res?.data ?? res;
  } catch {
    return { model: null, source: null, error: "config_get_failed" };
  }
  if (cfg == null || typeof cfg !== "object") {
    return { model: null, source: null, error: "config_get_failed" };
  }
  let sawInvalid = false;
  for (const [source, pick] of CHAIN) {
    let candidate;
    try { candidate = pick(cfg); } catch { continue; }
    if (candidate == null) continue; // absent — без invalid-флага (SF-1)
    const ref = validRef(candidate);
    if (ref) return { model: ref, source, error: null };
    sawInvalid = true;
  }
  return { model: null, source: null, error: sawInvalid ? "invalid_model_ref" : "no_model_resolved" };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test plugins/maestro-bootstrap/memory/resolve-model.test.js`
Expected: PASS (все тесты)

- [ ] **Step 5: Commit**

```bash
git add plugins/maestro-bootstrap/memory/resolve-model.js plugins/maestro-bootstrap/memory/resolve-model.test.js
git commit -m "feat(memory): zero-key summarizer model resolver (4.0.0)"
```

---

### Task 2: Удаление ключа из схемы конфига (`config.js` + `maestro.json`)

**Files:**
- Modify: `plugins/maestro-bootstrap/memory/config.js:28` (строка `summarizer_model: null,` в `DEFAULTS`)
- Modify: `maestro.json` (memory-секция: убрать ключ `summarizer_model` — dirty-ключ в рабочем дереве)
- Test: `plugins/maestro-bootstrap/memory/config.test.js` (добавить 2 теста)

**Interfaces:**
- Consumes: ничего нового.
- Produces: `DEFAULTS` без `summarizer_model`; `loadMemoryConfig`/`classifyMemoryConfig` — legacy-ключ инертен (I5).

- [ ] **Step 1: Write the failing tests**

Добавить в `plugins/maestro-bootstrap/memory/config.test.js`:

```js
test("4.0.0: DEFAULTS без summarizer_model (zero-key)", () => {
  assert.ok(!("summarizer_model" in DEFAULTS), "ключ удалён из схемы");
});
test("4.0.0: legacy summarizer_model в конфиге — инертен (I5, нет warn/детекта)", () => {
  const res = classifyMemoryConfig({
    memory: { enabled: true, namespace: "x.y", summarizer_model: "prov/m" },
  });
  assert.equal(res.enabled, true, "ключ не отключает память");
  const cfg = loadMemoryConfig({
    memory: { enabled: true, namespace: "x.y", summarizer_model: "prov/m" },
  });
  // Ключ не читается никем: поведение определяется только opencode-резолвом.
  assert.equal(cfg.enabled, true);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test plugins/maestro-bootstrap/memory/config.test.js`
Expected: FAIL — первый тест (`summarizer_model in DEFAULTS` — ключ ещё есть)

- [ ] **Step 3: Write minimal implementation**

1. `plugins/maestro-bootstrap/memory/config.js` — удалить строку 28 `  summarizer_model: null,` из `DEFAULTS`. Больше ничего не менять (passthrough через spread безопасен; `classifyMemoryConfig` не валидирует неизвестные ключи).
2. `maestro.json` — в `memory`-секции удалить строку `"summarizer_model": "akash/Qwen/Qwen3.8-27B",` (dirty-ключ authoring-репо; остальные ключи `enabled`/`namespace` сохранить).

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test plugins/maestro-bootstrap/memory/config.test.js && node --test plugins/maestro-bootstrap/memory/resolve-model.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugins/maestro-bootstrap/memory/config.js plugins/maestro-bootstrap/memory/config.test.js maestro.json
git commit -m "feat(memory): remove summarizer_model from config schema (4.0.0, zero-key)"
```

---

### Task 3: Sessions-путь (`indexer.js`) — резолв + effective model в duration-логе

**Files:**
- Modify: `plugins/maestro-bootstrap/memory/indexer.js` (импорт; блок саммаризации ~строки 252–267)
- Test: `plugins/maestro-bootstrap/memory/indexer.test.js` (добавить 4 теста)

**Interfaces:**
- Consumes: `resolveSummarizerModel({ client, root, timeoutMs? })`, `parseModelRef(s)` — из Task 1.
- Produces: `memory:summarize.duration` с полями `sessionID`, `duration_ms`, `model` (effective-модель: modelID резолвлённой модели либо modelID модели сессии при fallback), `model_source` (enum).
- **Примечание (SF-5):** на sessions-пути `model_source` принимает только `small_model | model | session` (цепочка D-4 без agent-шагов) — тест-кейсы на `agent_maestro`/`agent_build` в duration-событии НЕ писать.

- [ ] **Step 1: Write the failing tests**

Добавить в `plugins/maestro-bootstrap/memory/indexer.test.js` (паттерн — существующие тесты: `mkClient`, `mkStorage`, `mkState`, `mkGit`, `new Indexer({ ..., summarize: <mock> })`; `Indexer` уже получает `root` из index.js:838, в тестах передать `root: "/tmp/root"`):

```js
test("4.0.0 sessions: small_model из opencode-конфига → summarizerModel (mock summarize)", async () => {
  const client = {
    session: {
      get: async ({ path }) => ({ data: { id: path.id, parentID: null, title: "st", time: { created: 1, updated: 100 } } }),
      messages: async () => ({ data: [{ info: {}, parts: [{ type: "text", text: "hello" }] }] }),
      list: async () => ({ data: [] }),
    },
    config: { get: async () => ({ data: { small_model: "a/s" } }) },
  };
  const storage = {
    upserts: [],
    upsert: async (es) => { for (const e of es) storage.upserts.push(e); },
    get: async () => null, search: async () => [], delete: async () => {}, stats: async () => ({ entries: 0 }),
  };
  let captured = null;
  const durations = [];
  const idx = new Indexer({
    client, config: mkConfig(), embeddings: mkMockEmbeddings(), storage,
    state: mkState(),
    summarize: async (args) => { captured = args; return { title: "t", summary: "s", decisions: [] }; },
    projectKey: { hash: "khash", source: "remote" }, confidentialPatterns: [],
    git: mkGit(), root: "/tmp/root",
    logDebug: (ev, fields) => { if (ev === "memory:summarize.duration") durations.push(fields); },
    logWarn: () => {},
  });
  await idx._run("s1");
  assert.equal(captured.summarizerModel, "a/s", "resolved small_model передан в summarize");
  assert.equal(durations[0].model, "s", "effective modelID в duration");
  assert.equal(durations[0].model_source, "small_model");
  idx.dispose();
});

test("4.0.0 sessions: пустой резолв (нет client.config) → summarizerModel null + модель сессии в duration", async () => {
  // mkClient() без config — резолв → config_get_failed → fail-soft на модель сессии
  const client = mkClient();
  client.session.messages = async () => ({ data: [{ info: { role: "assistant", providerID: "prov", modelID: "sess-m" }, parts: [{ type: "text", text: "hello" }] }] });
  const storage = { upserts: [], upsert: async () => {}, get: async () => null, search: async () => [], delete: async () => {}, stats: async () => ({ entries: 0 }) };
  let captured = null;
  const durations = [];
  const warns = [];
  const idx = new Indexer({
    client, config: mkConfig(), embeddings: mkMockEmbeddings(), storage,
    state: mkState(),
    summarize: async (args) => { captured = args; return { title: "t", summary: "s", decisions: [] }; },
    projectKey: { hash: "khash", source: "remote" }, confidentialPatterns: [],
    git: mkGit(), root: "/tmp/root",
    logDebug: (ev, fields) => { if (ev === "memory:summarize.duration") durations.push(fields); },
    logWarn: (ev, fields) => warns.push([ev, fields]),
  });
  await idx._run("s1");
  assert.equal(captured.summarizerModel, null, "fallback: summarizerModel null → модель сессии внутри summarize.js");
  assert.equal(durations[0].model, "sess-m", "модель сессии в duration (текущее поведение)");
  assert.equal(durations[0].model_source, "session");
  assert.ok(warns.some(([ev, f]) => ev === "memory:summarizer_unavailable" && f.reason === "config_get_failed"), "warn с reason enum");
  idx.dispose();
});

test("4.0.0 sessions: invalid_model_ref → warn (симметрично, SF из Minor-1) + fail-soft", async () => {
  const client = {
    session: {
      get: async ({ path }) => ({ data: { id: path.id, parentID: null, title: "st", time: { created: 1, updated: 100 } } }),
      messages: async () => ({ data: [{ info: {}, parts: [{ type: "text", text: "hello" }] }] }),
      list: async () => ({ data: [] }),
    },
    config: { get: async () => ({ data: { model: "noslash" } }) },
  };
  const storage = { upserts: [], upsert: async () => {}, get: async () => null, search: async () => [], delete: async () => {}, stats: async () => ({ entries: 0 }) };
  let captured = null;
  const warns = [];
  const idx = new Indexer({
    client, config: mkConfig(), embeddings: mkMockEmbeddings(), storage,
    state: mkState(),
    summarize: async (args) => { captured = args; return { title: "t", summary: "s", decisions: [] }; },
    projectKey: { hash: "khash", source: "remote" }, confidentialPatterns: [],
    git: mkGit(), root: "/tmp/root",
    logWarn: (ev, fields) => warns.push([ev, fields]),
  });
  await idx._run("s1");
  assert.equal(captured.summarizerModel, null);
  assert.ok(warns.some(([ev, f]) => ev === "memory:summarizer_unavailable" && f.reason === "invalid_model_ref"));
  idx.dispose();
});

test("4.0.0 sessions: model (не small_model) → source: model", async () => {
  const client = {
    session: {
      get: async ({ path }) => ({ data: { id: path.id, parentID: null, title: "st", time: { created: 1, updated: 100 } } }),
      messages: async () => ({ data: [{ info: {}, parts: [{ type: "text", text: "hello" }] }] }),
      list: async () => ({ data: [] }),
    },
    config: { get: async () => ({ data: { model: "main/m1" } }) },
  };
  const storage = { upserts: [], upsert: async () => {}, get: async () => null, search: async () => [], delete: async () => {}, stats: async () => ({ entries: 0 }) };
  let captured = null;
  const durations = [];
  const idx = new Indexer({
    client, config: mkConfig(), embeddings: mkMockEmbeddings(), storage,
    state: mkState(),
    summarize: async (args) => { captured = args; return { title: "t", summary: "s", decisions: [] }; },
    projectKey: { hash: "khash", source: "remote" }, confidentialPatterns: [],
    git: mkGit(), root: "/tmp/root",
    logDebug: (ev, fields) => { if (ev === "memory:summarize.duration") durations.push(fields); },
  });
  await idx._run("s1");
  assert.equal(captured.summarizerModel, "main/m1");
  assert.equal(durations[0].model, "m1");
  assert.equal(durations[0].model_source, "model");
  idx.dispose();
});
```

(Если `mkMockEmbeddings` не определён в indexer.test.js — добавить: `function mkMockEmbeddings() { return { embed: async () => new Float32Array([0.1, 0.2, 0.3]), dim: 3, modelId: "m" }; }` — аналог из `memory/index.test.js`.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test plugins/maestro-bootstrap/memory/indexer.test.js`
Expected: FAIL — новые тесты (`captured.summarizerModel` = null из `this.config.summarizer_model ?? null`, `model_source` отсутствует)

- [ ] **Step 3: Write minimal implementation**

`plugins/maestro-bootstrap/memory/indexer.js`:

1. Импорт (существующие импорты вверху файла):
```js
import { resolveSummarizerModel, parseModelRef } from "./resolve-model.js";
```
2. Заменить блок ~строки 252–267 (от `const summarizeStart = Date.now();` до закрытия `logDebug("memory:summarize.duration", …)`) на:

```js
        const summarizeStart = Date.now();
        // 4.0.0: zero-key — модель саммаризации из opencode-конфига (spec §4.3).
        // Fail-soft: любой error → модель сессии (текущая семантика summarize.js).
        const resolved = await resolveSummarizerModel({ client: this.client, root: this.root });
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
        // Task 3: перф-аудит — duration; model — effective-модель саммаризации
        // (resolved, либо модель сессии при fallback); model_source — enum (SEC-4b).
        this.logDebug?.("memory:summarize.duration", {
          sessionID,
          duration_ms: Date.now() - summarizeStart,
          model: resolved.model
            ? (parseModelRef(resolved.model)?.modelID ?? null)
            : (modelRef?.modelID ?? null),
          model_source: resolved.model ? resolved.source : "session",
        });
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test plugins/maestro-bootstrap/memory/indexer.test.js`
Expected: PASS (новые + существующие тесты)

- [ ] **Step 5: Commit**

```bash
git add plugins/maestro-bootstrap/memory/indexer.js plugins/maestro-bootstrap/memory/indexer.test.js
git commit -m "feat(memory): sessions path — summarizer model from opencode config (4.0.0)"
```

---

### Task 4: Git-путь (`memory_reindex`, `index.js`) — list-строка + hard guard + resolved-модель

**Files:**
- Modify: `plugins/maestro-bootstrap/memory/index.js` (импорт; list-блок ~строки 1258–1263; run-git guard ~строки 1317–1323; `summarizerModel` ~строка 1376)
- Test: `plugins/maestro-bootstrap/memory/index.test.js` (хелпер `mkClient` + ~9 тестов `summarizer_model`, строки ~4546–4982)

**Interfaces:**
- Consumes: `resolveSummarizerModel({ client, root })` — из Task 1.
- Produces:
  - list: строка `Модель саммаризации: <model> (source: <source>)` или `Модель саммаризации: не резолвлена (<reason>) — run(source: git) недоступен` (+ warn `memory:summarizer_unavailable`); флаг `summarizer_model_missing` **удалён**.
  - run git: до батча — `memory_reindex: модель саммаризации не резолвлена (<reason>). Задайте small_model или model в opencode.json (глобальный ~/.config/opencode/opencode.json или проектный .opencode/opencode.json)` (0 summarize); при резолве — `summarizerModel: smRes.model`.

- [ ] **Step 1: Write the failing tests**

`plugins/maestro-bootstrap/memory/index.test.js`:

1. Расширить хелпер `mkClient` (строки ~38–47) — топ-левел overrides (сейчас spread только в `session`):

```js
function mkClient(overrides = {}) {
  const { session: sessionOverrides, ...rest } = overrides;
  return {
    session: {
      get: async () => ({ data: { id: "s", parentID: null } }),
      messages: async () => ({ data: [] }),
      list: async () => ({ data: [] }),
      ...sessionOverrides,
    },
    ...rest,
  };
}
```

2. Переписать тест «memory_reindex list: секция B — scanHistory + summarizer_model_missing» (~строка 4546) на новую семантику (паттерн теста сохраняется: `registerMemoryHooks` + `hooks.tool.memory_reindex.execute`):

```js
test("memory_reindex list: строка модели саммаризации — резолв из opencode-конфига (4.0.0)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mem-reindex-listM-"));
  const saved = process.env.XDG_DATA_HOME;
  process.env.XDG_DATA_HOME = dir;
  try {
    mkdirSync(join(dir, "docs/superpowers/specs"), { recursive: true });
    writeFileSync(join(dir, "docs/superpowers/specs/x-design.md"), "# My Feature\n");
    const storage = mkMockStorage();
    storage.scan = async () => [];
    const client = mkClient({ config: { get: async () => ({ data: { small_model: "prov/m2" } }) } });
    const hooks = await registerMemoryHooks({
      client, config: mkConfig(dir), log: silentLog, root: dir,
      deps: { storage, embeddings: mkMockEmbeddings(), git: mkReindexGit() },
    });
    const res = await hooks.tool.memory_reindex.execute({ action: "list" }, { sessionID: "s1" });
    assert.match(res, /Модель саммаризации: prov\/m2 \(source: small_model\)/, "строка с моделью+source");
    assert.doesNotMatch(res, /summarizer_model_missing/, "старый флаг удалён");
    await hooks.dispose?.();
  } finally {
    if (saved === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = saved;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("memory_reindex list: нерезолв → строка с reason (config_get_failed)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mem-reindex-listN-"));
  const saved = process.env.XDG_DATA_HOME;
  process.env.XDG_DATA_HOME = dir;
  try {
    mkdirSync(join(dir, "docs/superpowers/specs"), { recursive: true });
    writeFileSync(join(dir, "docs/superpowers/specs/x-design.md"), "# My Feature\n");
    const storage = mkMockStorage();
    storage.scan = async () => [];
    const hooks = await registerMemoryHooks({
      client: mkClient(), // без client.config
      config: mkConfig(dir), log: silentLog, root: dir,
      deps: { storage, embeddings: mkMockEmbeddings(), git: mkReindexGit() },
    });
    const res = await hooks.tool.memory_reindex.execute({ action: "list" }, { sessionID: "s1" });
    assert.match(res, /Модель саммаризации: не резолвлена \(config_get_failed\)/);
    assert.match(res, /run\(source: git\) недоступен/);
    await hooks.dispose?.();
  } finally {
    if (saved === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = saved;
    rmSync(dir, { recursive: true, force: true });
  }
});
```

3. Переписать «memory_reindex run git: hard guard» (~строка 4736) — guard по трём причинам (0 summarize, actionable-сообщение про opencode.json):

```js
test("memory_reindex run git: hard guard при нерезолве — 0 summarize, actionable (все причины)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mem-reindex-guard-"));
  const saved = process.env.XDG_DATA_HOME;
  process.env.XDG_DATA_HOME = dir;
  try {
    mkdirSync(join(dir, "docs/superpowers/specs"), { recursive: true });
    writeFileSync(join(dir, "docs/superpowers/specs/x-design.md"), "# My Feature\n");
    const storage = mkMockStorage();
    storage.scan = async () => [];
    const prompts = [];
    const baseClient = (configGet) => ({
      session: {
        get: async () => ({ data: { id: "s", parentID: null } }),
        messages: async () => ({ data: [] }),
        list: async () => ({ data: [] }),
        create: async () => ({ data: { id: "svc" } }),
        prompt: async (args) => { prompts.push(args); return { data: { parts: [{ type: "text", text: '{"title":"t","summary":"s","decisions":[]}' }] } }; },
        delete: async () => {},
      },
      config: { get: configGet },
    });
    const reasons = [
      [{}, "no_model_resolved"],
      [null, "config_get_failed"], // client без config
      [{ model: "noslash" }, "invalid_model_ref"],
    ];
    for (const [cfg, reason] of reasons) {
      const client = cfg === null ? mkClient() : baseClient(async () => ({ data: cfg }));
      const hooks = await registerMemoryHooks({
        client, config: mkConfig(dir), log: silentLog, root: dir,
        deps: { storage, embeddings: mkMockEmbeddings(), git: mkReindexGit() },
      });
      const res = await hooks.tool.memory_reindex.execute({ action: "run", source: "git", specs: "docs/superpowers/specs/x-design.md" }, { sessionID: "s1" });
      assert.match(res, new RegExp(`модель саммаризации не резолвлена \\(${reason}\\)`), `guard: ${reason}`);
      assert.match(res, /opencode\.json/, "actionable: указывает на opencode.json");
      assert.equal(prompts.length, 0, `0 LLM-вызовов при ${reason}`);
      await hooks.dispose?.();
    }
  } finally {
    if (saved === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = saved;
    rmSync(dir, { recursive: true, force: true });
  }
});
```

4. Переписать тесты с `config: mkConfig(dir, { summarizer_model: "prov/m2" })` (~строки 4685, 4719, 4786, 4822, 4857, 4949, 4982) — везде заменить источник модели: `mkClient({ config: { get: async () => ({ data: { model: "prov/m2" } }) } })`, config без `summarizer_model`; ассерты на resolved-модель сохранять. В тесте с `summarize_timeout_ms: 50` — таймаут-сценарий не меняется (только источник модели).

5. Добавить тест legacy-ключа (I5):

```js
test("memory_reindex: legacy summarizer_model в конфиге — инертен (I5)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mem-reindex-legacy-"));
  const saved = process.env.XDG_DATA_HOME;
  process.env.XDG_DATA_HOME = dir;
  try {
    mkdirSync(join(dir, "docs/superpowers/specs"), { recursive: true });
    writeFileSync(join(dir, "docs/superpowers/specs/x-design.md"), "# My Feature\n");
    const storage = mkMockStorage();
    storage.scan = async () => [];
    const hooks = await registerMemoryHooks({
      client: mkClient(), // без opencode-конфига
      config: mkConfig(dir, { summarizer_model: "prov/m2" }), // legacy-ключ
      log: silentLog, root: dir,
      deps: { storage, embeddings: mkMockEmbeddings(), git: mkReindexGit() },
    });
    const res = await hooks.tool.memory_reindex.execute({ action: "run", source: "git", specs: "docs/superpowers/specs/x-design.md" }, { sessionID: "s1" });
    // Legacy-ключ не работает: guard по резолву (нет opencode-модели).
    assert.match(res, /модель саммаризации не резолвлена \(config_get_failed\)/);
    await hooks.dispose?.();
  } finally {
    if (saved === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = saved;
    rmSync(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test plugins/maestro-bootstrap/memory/index.test.js`
Expected: FAIL — новые тесты (строка list отсутствует, guard по-прежнему по `config.summarizer_model`)

- [ ] **Step 3: Write minimal implementation**

`plugins/maestro-bootstrap/memory/index.js`:

1. Импорт:
```js
import { resolveSummarizerModel } from "./resolve-model.js";
```
2. list-блок — заменить (строки ~1258–1260):
```js
              if (!config.summarizer_model) {
                lines.push("Внимание: summarizer_model_missing — run(source: git) недоступен (задайте memory.summarizer_model).");
              }
```
на:
```js
              // 4.0.0: резолв модели саммаризации из opencode-конфига (zero-key).
              const smRes = await resolveSummarizerModel({ client, root });
              if (smRes.model) {
                lines.push(`Модель саммаризации: ${smRes.model} (source: ${smRes.source})`);
              } else {
                logWarn("memory:summarizer_unavailable", { reason: smRes.error });
                lines.push(`Модель саммаризации: не резолвлена (${smRes.error}) — run(source: git) недоступен`);
              }
```
3. run git — заменить guard (строки ~1317–1323):
```js
              if (!config.summarizer_model) {
                return "memory_reindex: для source=git задайте memory.summarizer_model в maestro.json (иначе summarize спеки невозможен)";
              }
```
на:
```js
              // I1' (4.0.0): guard по РЕЗОЛВУ (не по ключу) — до батча, 0 LLM.
              const smRes = await resolveSummarizerModel({ client, root });
              if (!smRes.model) {
                logWarn("memory:summarizer_unavailable", { reason: smRes.error });
                return `memory_reindex: модель саммаризации не резолвлена (${smRes.error}). Задайте small_model или model в opencode.json (глобальный ~/.config/opencode/opencode.json или проектный .opencode/opencode.json)`;
              }
```
4. Строка ~1376: `summarizerModel: config.summarizer_model,` → `summarizerModel: smRes.model,` (обновить комментарий: `// model=null — модель из opencode-резолва (hard guard выше).`).

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test plugins/maestro-bootstrap/memory/index.test.js`
Expected: PASS (переписанные + существующие тесты)

- [ ] **Step 5: Run full memory + bootstrap suites**

Run: `npm run test:memory && npm test`
Expected: PASS (весь контур зелёный)

- [ ] **Step 6: Commit**

```bash
git add plugins/maestro-bootstrap/memory/index.js plugins/maestro-bootstrap/memory/index.test.js
git commit -m "feat(memory): memory_reindex — resolve summarizer model, guard by resolution (4.0.0)"
```

---

### Task 5: Маэстро-слой — доки, SECURITY, AGENTS, TODO, changelog, версия, regression entry

**Files:**
- Modify: `manual_docs/reference/memory.md` (строки 41, 91, 508–513, 743, 794, ~977)
- Modify: `manual_docs/reference/config.md` (381, 430)
- Modify: `manual_docs/reference/model-selection.md` (163, 169–172)
- Modify: `plugins/maestro-bootstrap/README.md` (228)
- Modify: `skills/maestro-assistant/SKILL.md` (73, 193)
- Modify: `SECURITY.md` (~156–168 I1-переформулировка; ~241–243 event whitelist)
- Modify: `AGENTS.md` (строка memory-модуля)
- Modify: `TODO.md` (строка 69)
- Modify: `manual_docs/overview/changelog.md` (новая запись 4.0.0 вверху)
- Modify: `package.json` (version → `4.0.0`)
- Create: `regression/entries/2026-09-14-memory-summarizer-resolve.md`

**Interfaces:**
- Consumes: поведение из Task 1–4 (цепочка, причины, guard-сообщения).
- Produces: док-синхронизация 4.0.0 (критерий приёмки skill-изменений по AGENTS.md).

- [ ] **Step 1: `manual_docs/reference/memory.md` — все 6 вхождений + whitelist-таблица**

  - Строка 41 (JSON-пример конфига): убрать строку `"summarizer_model": null,`.
  - Строка 91 (таблица ключей): убрать строку `| summarizer_model | … |`; вместо неё — новая секция после таблицы:
    ```markdown
    #### Резолв модели саммаризации (4.0.0, zero-key)

    Ключа `summarizer_model` больше нет. Модель фонового саммаризатора
    резолвится из **opencode-конфига** (глобальный `~/.config/opencode/opencode.json`
    или проектный `.opencode/opencode.json`) по цепочке (первый валидный
    кандидат): `small_model` → `model` → `agent.maestro.model` →
    `agent.build.model`. `agent.*` — только **источник model-строки** (агенты
    не используются для саммаризации).

    - **Sessions-путь** (фоновая саммаризация): резолв → fallback на модель
      саммаризируемой сессии (fail-soft; warn `memory:summarizer_unavailable`
      с `reason`). При заданном `small_model`/`model` саммаризация сессий идёт
      на нём (не на модели сессии).
    - **Git-путь** (`memory_reindex`, `source: git`): guard **по резолву** до
      батча (0 LLM). Причины — enum: `no_model_resolved` | `config_get_failed`
      | `invalid_model_ref`. Actionable-сообщение указывает на opencode.json.
    ```
  - Строки 508–513 (секция `memory_reindex`): «Требует `memory.summarizer_model` (иначе — …)» → «Требует **резолвлённую модель саммаризации** (см. «Резолв модели саммаризации»); `list` выводит строку `Модель саммаризации: <model> (source: <source>)` или `не резолвлена (<reason>) — run(source: git) недоступен`»; удалить упоминание флага `summarizer_model_missing`.
  - Строка 743 (sessions-цепочка): `summarizer_model ?? модель саммаризируемой сессии` → «резолв из opencode-конфига (`small_model` → `model`) → модель саммаризируемой сессии».
  - Строка 794: «Требует `memory.summarizer_model` (иначе — hard guard)» → «Требует резолвлённую модель саммаризации (иначе — hard guard, 0 LLM; причины — enum)».
  - Whitelist-таблица (~строка 977): строку `| memory:summarize.duration | sessionID, duration_ms, model |` заменить на `| memory:summarize.duration | sessionID, duration_ms, model (effective), model_source (enum) |`; добавить строку `| memory:summarizer_unavailable (warn) | reason (enum: config_get_failed / no_model_resolved / invalid_model_ref) |`.

- [ ] **Step 2: `manual_docs/reference/config.md` (SF-3: явные якоря)**

  - Строка 381 (JSON-пример): убрать `"summarizer_model": null,`.
  - Строка 430 (таблица ключей): убрать строку `| summarizer_model | … |`; добавить указание: «Модель саммаризации — без ключа в `maestro.json` (4.0.0, zero-key): резолв из opencode-конфига, см. [Память maestro (reference)](memory.md) → «Резолв модели саммаризации»».

- [ ] **Step 3: `manual_docs/reference/model-selection.md` (163, 169–172)**

  - Строка 163 (таблица): убрать строку `| summarizer_model | … |`.
  - Строки 169–172 (буллит `summarizer_model`): заменить на:
    ```markdown
    - **Модель саммаризации (4.0.0, zero-key)** — ключа `summarizer_model`
      больше нет: модель резолвится из opencode-конфига по цепочке
      `small_model` → `model` → `agent.maestro.model` → `agent.build.model`
      (fallback sessions-пути — модель саммаризируемой сессии; git-путь
      `memory_reindex` — guard при нерезолве). Рекомендация: дешёвая модель в
      `small_model` — для дешёвой фоновой саммаризации; не задавать —
      саммаризация на основной модели. Саммаризатор создаёт служебную сессию
      `[maestro-memory]` (удаляется после ответа) и работает с замаскированным
      транскриптом.
    ```

- [ ] **Step 4: `plugins/maestro-bootstrap/README.md` (228) + `skills/maestro-assistant/SKILL.md` (73, 193)**

  - README.md строка 228 (JSON-пример): убрать `"summarizer_model": null,`.
  - maestro-assistant SKILL.md строка 73 (JSON-пример): убрать строку ключа.
  - maestro-assistant SKILL.md строка 193 (буллит `summarizer_model`): заменить на:
    ```markdown
    - **Модель саммаризации (4.0.0, zero-key)** — ключа `summarizer_model`
      нет; резолв из opencode-конфига: `small_model` → `model` →
      `agent.maestro.model` → `agent.build.model`; sessions-путь — fallback
      на модель сессии, git-путь (`memory_reindex`) — guard при нерезолве
      (причины enum). Отдельно от И-1 allowlist провайдеров.
    ```

- [ ] **Step 5: `SECURITY.md` (I1-переформулировка + event whitelist)**

  - Буллит «Git-history backfill — summarize спеки (Z3-adjacent, v3.5.0)» (~строки 156–168): в конец буллита добавить фразу: «(4.0.0: модель саммаризации — **наблюдаемый резолв из opencode-конфига** `small_model → model → agent.maestro/build` (zero-key, ключа `summarizer_model` нет); **fail-closed при нерезолве** — guard до батча, 0 LLM, причины enum: `no_model_resolved` / `config_get_failed` / `invalid_model_ref`).»
  - Event whitelist (~строки 241–243): в «Event-имена в whitelist (v3.5.0)» — переименовать в «(v3.5.0+)» и добавить: `memory:summarizer_unavailable` (warn) — reason enum; `memory:summarize.duration` (info) — sessionID, duration_ms, model (effective), `model_source` (enum) — закрывает pre-existing пробел (SF-4: имя события не было именовано).

- [ ] **Step 6: `AGENTS.md` (строка memory-модуля)**

  В длинном буллите `plugins/maestro-bootstrap/` (строка memory-модуля) добавить упоминание (ключ в текущей строке не упоминается — добавление, не замена): «Summarizer model resolution (4.0.0, zero-key): `small_model → model → agent.maestro/build` из opencode-конфига, без ключа `summarizer_model`; fail-closed guard на git-пути `memory_reindex`.»

- [ ] **Step 7: `TODO.md` (строка 69)**

  Закрыть пункт «Модель LLM, указанная в maestro.json, memory.summarizer_model попала в коммит…»:
  `- [x] … → ✅ **реализовано (2026-09-14, 4.0.0, BREAKING):** zero-key — ключ `summarizer_model` удалён из схемы `maestro.json`; модель саммаризации резолвится из opencode-конфига (`small_model → model → agent.maestro/build`), без обратной совместимости. Spec: docs/superpowers/specs/2026-09-14-memory-summarizer-resolve-design.md + plan; regression entry 2026-09-14-memory-summarizer-resolve.md.`

- [ ] **Step 8: `manual_docs/overview/changelog.md` — запись 4.0.0**

  Вверху (до `## [2026-09-12]`) добавить:

  ```markdown
  ## [2026-09-14]

  > **Версия 4.0.0** — Major-релиз (BREAKING): zero-key резолв модели
  > саммаризации памяти.

  ### Изменено (BREAKING)

  - **Memory layer — zero-key резолв модели саммаризации (4.0.0).** Ключ
    `memory.summarizer_model` **удалён** из схемы конфига (без обратной
    совместимости: остаток в старых конфигах молчаливо игнорируется). Модель
    фонового саммаризатора резолвится из opencode-конфига (глобальный
    `~/.config/opencode/opencode.json` / проектный `.opencode/opencode.json`)
    по цепочке `small_model → model → agent.maestro.model →
    agent.build.model` (per-call, без кэша). **Смена поведения
    sessions-пути:** при заданном `small_model`/`model` фоновая саммаризация
    сессий теперь идёт на нём (ранее — модель саммаризируемой сессии;
    fallback на модель сессии сохраняется при нерезолве, fail-soft).
    Git-путь `memory_reindex` (source: git) — **fail-closed guard по
    резолву** до батча (0 LLM): причины — enum `no_model_resolved` /
    `config_get_failed` / `invalid_model_ref`, actionable-сообщение указывает
    на opencode.json. Наблюдаемость: warn `memory:summarizer_unavailable`
    (reason enum), `memory:summarize.duration` — effective-модель +
    `model_source` (enum); `memory_reindex list` выводит строку
    «Модель саммаризации: …». Спека:
    `docs/superpowers/specs/2026-09-14-memory-summarizer-resolve-design.md`,
    план: `docs/superpowers/plans/2026-09-14-memory-summarizer-resolve-plan.md`.
  ```

- [ ] **Step 9: `package.json` + regression entry**

  - `package.json`: `"version": "3.5.0"` → `"version": "4.0.0"`.
  - Создать `regression/entries/2026-09-14-memory-summarizer-resolve.md`:

    ```yaml
    ---
    version: 1
    feature: memory-summarizer-resolve
    added: 2026-09-14
    status: active
    risk: medium
    scenarios:
      - path: plugins/maestro-bootstrap/memory/resolve-model.js
        run: node --test plugins/maestro-bootstrap/memory/resolve-model.test.js
        workdir: .
      - path: plugins/maestro-bootstrap/memory/config.js
        run: node --test plugins/maestro-bootstrap/memory/config.test.js
        workdir: .
      - path: plugins/maestro-bootstrap/memory/indexer.js
        run: node --test plugins/maestro-bootstrap/memory/indexer.test.js
        workdir: .
      - path: plugins/maestro-bootstrap/memory/index.js
        run: node --test plugins/maestro-bootstrap/memory/index.test.js
        workdir: .
      - path: plugins/maestro-bootstrap
        run: npm test
        workdir: .
    ---

    # Регрессия: memory-summarizer-resolve

    BREAKING-фича (4.0.0): zero-key резолв модели саммаризации из
    opencode-конфига (`small_model → model → agent.maestro/build`), удаление
    ключа `memory.summarizer_model`, fail-closed guard на git-пути
    `memory_reindex`.

    Ключевые риски:
    - degenerate/невалидные model-ссылки не доходят до `session.prompt` (I6);
    - git-батч не стартует без резолвленной модели (I1', 0 LLM);
    - `summarize.js` побайтово не изменён — промпт и `model` (не `agent`)
      в `session.prompt` (I2');
    - legacy-ключ инертен (I5): нет warn/детекта/override;
    - SEC-4b: только enum'ы (`reason`, `model_source`) и effective-модель.
    ```

- [ ] **Step 10: Проверка полноты док-синхронизации**

Run: `grep -rn "summarizer_model" --include="*.md" . | grep -v "docs/superpowers/specs/2026-09-1\|docs/superpowers/plans/2026-09-1\|specs/2026-"`
Expected: вхождения только в (a) текущий spec/plan (история дизайна), (b) changelog-запись 4.0.0 и TODO.md (упоминание удалённого ключа в контексте BREAKING), (c) исторические specs/plans до 2026-09-14 — и нигде больше (в live-доках ключа нет).

- [ ] **Step 11: Commit**

```bash
git add manual_docs/reference/memory.md manual_docs/reference/config.md manual_docs/reference/model-selection.md plugins/maestro-bootstrap/README.md skills/maestro-assistant/SKILL.md SECURITY.md AGENTS.md TODO.md manual_docs/overview/changelog.md package.json regression/entries/2026-09-14-memory-summarizer-resolve.md
git commit -m "docs(memory): 4.0.0 zero-key summarizer model resolution — docs/SECURITY/changelog/version"
```

---

## Self-Review (выполнено при написании плана)

1. **Spec coverage:** §4.1 → Task 2; §4.2 → Task 1; §4.3 → Task 3; §4.4 → Task 4; §4.5 → Task 2 (maestro.json) + Task 5 (доки); §4.6 → Task 5 (все якоря, включая SF-3/SF-4); §4.7 → Task 5; §5 I1'–I6 → Task 1 (I6), 2 (I5), 3 (I2'/I4), 4 (I1'); §6 тест-план → Tasks 1–4; §7 риски → зафиксированы в Global Constraints. Gaps: нет.
2. **Placeholder scan:** TBD/TODO/«аналогично» отсутствуют; все шаги — с кодом или точной инструкцией.
3. **Type consistency:** `resolveSummarizerModel({client, root, timeoutMs}) → {model, source, error}` — одинаково в Tasks 1/3/4; `parseModelRef(s) → {providerID, modelID} | null` — Tasks 1/3; enum'ы `reason`/`model_source` — Tasks 3/4/5 идентичны спеке.
