# External OpenAI-compatible Embedder + Probe — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Добавить опциональный внешний embedder через OpenAI-совместимый `/embeddings` API (`memory.embedding.provider: "openai"`) с проверкой работоспособности (probe: старт + cooldown + on-demand), маскированием recall-запросов и синхронной документацией. Локальный transformers.js embedder остаётся дефолтом.

**Architecture:** Новый конфиг-блок `memory.embedding` (провайдер `local`|`openai`; `embedding_model` — legacy-алиас для local). Класс `OpenAiEmbedder` + `EmbedRetryableError` реализуют единый интерфейс `{ embed → Float32Array, dim, modelId, init, probe }`. Диспатч в `registerMemoryHooks`; `modelId`/`dim` для storage берутся из конфига. Probe: локальный — лёгкий чек зависимости, внешний — один POST `"probe"`; стартовый прогон до `createStorage` с кэшем в `state.json` (ключ = identity embedder), гибрид hard/soft. Recall/`memory_search`/`memory_recall_preview` маскируют запрос перед embed (всегда) с short-circuit пустого запроса.

**Tech Stack:** Node.js ESM, built-in test runner (`node --test`, без deps), глобальный `fetch` (Node 18+/Bun) — без новых зависимостей в `provision.js DEPS`.

**Spec:** `docs/superpowers/specs/2026-09-08-external-embeddings-design.md` (approve; подписи `maestro:sanitize` + `maestro:review`). План аргументирует от spec; дублирование требований — дефект.

## Global Constraints

- **Zero-dep гейт:** `plugins/maestro-bootstrap` сам zero-dependency; memory-модуль self-provisions deps. `OpenAiEmbedder` — только глобальный `fetch`; **`provision.js DEPS` не меняется**.
- **API-ключи:** только через `api_key_env` (ссылка на env), никогда plaintext в `maestro.json` (SECURITY.md §5a). В кэш probe — только имена env, не значения.
- **Маскирование:** контент записей маскируется до/после LLM; embed строго по post-mask тексту (spec §5.1). Recall-запросы маскируются **всегда**; пустой замаскированный запрос → short-circuit всего поиска (spec §3.4).
- **Probe:** `probe() → { ok, hard, detail }`; hard (детерминированные конфиг-ошибки) → память off + actionable; soft (сеть/timeout/5xx) → warn + fail-soft (spec §4). Cached hard никогда не шорт-кейтится (live re-probe). Стартовый probe — **до** `createStorage`.
- **Retryable-ошибки** (сеть/timeout/5xx embed) НЕ считают в skip-after-3 индексатора (`err.retryable === true`), иначе временный сбой провайдера безвозвратно теряет память сессий (spec §3.2).
- **`experimental.chat.messages.transform`** остаётся `undefined`. Все хуки try/catch-guarded.
- **Смена модели/провайдера → переиндексация** (инвариант); `modelId` для openai = `openai:${model}@${base_url}` (trailing-slash нормализуется в mergedConfig).
- **Доки синхронно** (AGENTS.md): SECURITY.md + maestro-assistant канон + manual_docs + README + changelog + commands + project-context (полный список — spec §6). Рабочий язык — русский.
- **Тесты:** `node --test plugins/maestro-bootstrap/index.test.js` (root), `npm run test:memory`.

## Project Context Changes

Применяется на plan-approve (шаг 12a) к `docs/project-context.md`:
- §3 Стек (memory layer bullet): добавить «v4 (external embeddings): опциональный внешний OpenAI-совместимый embedder (`memory.embedding.provider: "openai"`), probe доступности (старт+cooldown+on-demand)».
- §5 Домены/модули (memory module bullet): добавить tool `memory_probe` в перечень инструментов.

## Cross-cutting Changes

Файлы, затрагиваемые конфиг-схемой (`memory.embedding` / `probe_cooldown_min`), — отдельные задачи плана:
- `skills/maestro-assistant/SKILL.md` — канон конфига (Task 10).
- `plugins/maestro-bootstrap/README.md` — пример конфига (Task 10).
- `manual_docs/reference/{config,model-selection,memory}.md` (Task 10).
- `manual_docs/how-to/enable-memory.md` (Task 10).
- `manual_docs/explanation/agents-and-trust.md` (Task 10).
- `manual_docs/overview/changelog.md` (Task 10).
- `commands/maestro-memory.md`, `commands/maestro-memory-report.md` (Task 10).
- `SECURITY.md` §5a (Task 10).

## Spec Follow-up (не блокируют Approve)

Транслируются в задачи: guard-probe композиция (Task 5), `memory_probe` в off-состоянии (Task 8), short-circuit всего поиска (Task 6).

## Regression Risk + Scenarios

- risk: **MEDIUM** — расширение конфиг-схемы (legacy `embedding_model` не должен сломаться; `memory.embedding` — новый блок).
  - scenario: `plugins/maestro-bootstrap/memory/config.js` — run: `node --test plugins/maestro-bootstrap/memory/config.test.js` — workdir: repo root.
- risk: **MEDIUM** — storage `model_id`/`dim` для local не меняются (dim 384, model_id = имя модели); переиндексация существующих локальных БД не требуется.
  - scenario: `plugins/maestro-bootstrap/memory/index.js` — run: `node --test plugins/maestro-bootstrap/memory/index.test.js plugins/maestro-bootstrap/memory/storage.test.js` — workdir: repo root.
- risk: **MEDIUM** — recall/search маскирование теперь всегда (меняет поведение локального path); пустой замаскированный запрос не должен ломать поиск.
  - scenario: `plugins/maestro-bootstrap/memory/recall.js` — run: `node --test plugins/maestro-bootstrap/memory/recall.test.js plugins/maestro-bootstrap/memory/index.test.js` — workdir: repo root.

---

### Task 1: Конфиг — блок `memory.embedding` + `probe_cooldown_min`

**Files:**
- Modify: `plugins/maestro-bootstrap/memory/config.js`
- Test: `plugins/maestro-bootstrap/memory/config.test.js`

**Interfaces:**
- Produces: `loadMemoryConfig(...)` возвращает `config.embedding` = `{ provider, model, base_url, api_key_env, dim }` (всегда заполненный) и `config.probe_cooldown_min` (default 30); `classifyMemoryConfig(...)` → `disabled_reason: "embedding_invalid"` / `"probe_cooldown_min_invalid"`.

- [ ] **Step 1: Падающие тесты** в `config.test.js`:

```js
test("embedding block defaults (local)", () => {
  const cfg = loadMemoryConfig({ memory: { enabled: true } });
  assert.deepEqual(cfg.embedding, {
    provider: "local",
    model: "Xenova/paraphrase-multilingual-MiniLM-L12-v2",
    base_url: "https://api.openai.com/v1",
    api_key_env: null,
    dim: null,
  });
  assert.equal(cfg.probe_cooldown_min, 30);
});

test("legacy embedding_model feeds embedding.model (local); embedding.model wins", () => {
  const cfg = loadMemoryConfig({ memory: { enabled: true, embedding_model: "legacy" } });
  assert.equal(cfg.embedding.model, "legacy");
  const cfg2 = loadMemoryConfig({ memory: { enabled: true, embedding_model: "legacy", embedding: { model: "new" } } });
  assert.equal(cfg2.embedding.model, "new");
});

test("openai provider requires model/api_key_env/dim else embedding_invalid", () => {
  assert.equal(classifyMemoryConfig({ memory: { enabled: true, embedding: { provider: "openai" } } }).disabled_reason, "embedding_invalid");
  const ok = { memory: { enabled: true, embedding: { provider: "openai", model: "text-embedding-3-small", api_key_env: "EMB_KEY", dim: 1536 } } };
  assert.equal(classifyMemoryConfig(ok).disabled_reason, null);
});

test("unknown provider / non-object embedding → embedding_invalid", () => {
  assert.equal(classifyMemoryConfig({ memory: { enabled: true, embedding: { provider: "foo" } } }).disabled_reason, "embedding_invalid");
  assert.equal(classifyMemoryConfig({ memory: { enabled: true, embedding: "x" } }).disabled_reason, "embedding_invalid");
});

test("openai model does not fall back to legacy embedding_model", () => {
  const cfg = loadMemoryConfig({ memory: { enabled: true, embedding_model: "legacy", embedding: { provider: "openai", model: "m", api_key_env: "K", dim: 3 } } });
  assert.equal(cfg.embedding.model, "m");
});

test("base_url trailing slashes normalized", () => {
  const cfg = loadMemoryConfig({ memory: { enabled: true, embedding: { provider: "openai", model: "m", api_key_env: "K", dim: 3, base_url: "https://x/v1/" } } });
  assert.equal(cfg.embedding.base_url, "https://x/v1");
});

test("dim ignored for local; probe_cooldown_min validation", () => {
  const cfg = loadMemoryConfig({ memory: { enabled: true, embedding: { dim: 512 } } });
  assert.equal(cfg.embedding.dim, null);
  assert.equal(classifyMemoryConfig({ memory: { enabled: true, probe_cooldown_min: 0 } }).disabled_reason, "probe_cooldown_min_invalid");
  assert.equal(classifyMemoryConfig({ memory: { enabled: true, probe_cooldown_min: 5 } }).disabled_reason, null);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test plugins/maestro-bootstrap/memory/config.test.js`
Expected: FAIL (`cfg.embedding` undefined / reasons не выдаются).

- [ ] **Step 3: Реализовать в `config.js`**

В `DEFAULTS` (после `embedding_model`):

```js
  embedding: {
    provider: "local",
    model: null,
    base_url: "https://api.openai.com/v1",
    api_key_env: null,
    dim: null,
  },
  probe_cooldown_min: 30,
```

Валидаторы (рядом с `branchContextValid`):

```js
const EMBEDDING_PROVIDERS = new Set(["local", "openai"]);

function embeddingValid(m) {
  const e = m.embedding;
  if (e == null) return true; // отсутствует → local default
  if (typeof e !== "object" || Array.isArray(e)) return false;
  const provider = e.provider ?? "local";
  if (!EMBEDDING_PROVIDERS.has(provider)) return false;
  if (provider === "openai") {
    if (typeof e.model !== "string" || e.model.length === 0) return false;
    if (typeof e.api_key_env !== "string" || e.api_key_env.length === 0) return false;
    if (e.dim == null || !Number.isInteger(e.dim) || e.dim <= 0) return false;
  }
  return true;
}

function probeCooldownValid(m) {
  if (m?.probe_cooldown_min == null) return true;
  return typeof m.probe_cooldown_min === "number" && m.probe_cooldown_min > 0;
}
```

В `mergedConfig` (вычислить перед `return`):

```js
function mergedConfig(m) {
  const type = m.storage?.type ?? "sqlite";
  const provider = m.embedding?.provider ?? "local";
  const embedding = {
    provider,
    model: m.embedding?.model ?? (provider === "local" ? (m.embedding_model ?? DEFAULTS.embedding_model) : null),
    base_url: (m.embedding?.base_url ?? "https://api.openai.com/v1").replace(/\/+$/, ""),
    api_key_env: m.embedding?.api_key_env ?? null,
    dim: m.embedding?.dim ?? null,
  };
  return {
    ...DEFAULTS,
    ...m,
    embedding,
    probe_cooldown_min: m.probe_cooldown_min ?? DEFAULTS.probe_cooldown_min,
    storage: { /* без изменений */ },
  };
}
```

В `classifyMemoryConfig` (после `storage_type_invalid`-проверки):

```js
  if (!embeddingValid(m)) return { enabled: false, disabled_reason: "embedding_invalid" };
  if (!probeCooldownValid(m)) return { enabled: false, disabled_reason: "probe_cooldown_min_invalid" };
```

- [ ] **Step 4: Run to verify they pass**

Run: `node --test plugins/maestro-bootstrap/memory/config.test.js`
Expected: PASS (включая старые тесты).

- [ ] **Step 5: Commit**
```bash
git add plugins/maestro-bootstrap/memory/config.js plugins/maestro-bootstrap/memory/config.test.js
git commit -m "feat(memory): memory.embedding config block (local|openai) + probe_cooldown_min"
```

---

### Task 2: `state.js` — кэш probe

**Files:**
- Modify: `plugins/maestro-bootstrap/memory/state.js`
- Test: `plugins/maestro-bootstrap/memory/state.test.js`

**Interfaces:**
- Produces: `createState(path)` возвращает `getEmbedderProbe(): Promise<object|null>` и `setEmbedderProbe(info): Promise<void>`.

- [ ] **Step 1: Падающие тесты** в `state.test.js`:

```js
test("embedder probe cache round-trip", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mm-state-"));
  const s = createState(join(dir, "state.json"));
  assert.equal(await s.getEmbedderProbe(), null);
  const info = { modelId: "openai:m@https://x/v1", dim: 3, apiKeyEnv: "K", ok: true, hard: false, detail: "OK (dim 3)" };
  await s.setEmbedderProbe(info);
  const got = await s.getEmbedderProbe();
  assert.equal(got.ok, true);
  assert.equal(got.modelId, info.modelId);
  assert.equal(typeof got.at, "number");
});
```
> Импорт `mkdtempSync`/`tmpdir` — по образцу существующих тестов `state.test.js`.

- [ ] **Step 2: Run to verify it fails**

Run: `node --test plugins/maestro-bootstrap/memory/state.test.js`
Expected: FAIL (`getEmbedderProbe is not a function`).

- [ ] **Step 3: Реализовать в `state.js`** (добавить к возвращаемому объекту):

```js
    getEmbedderProbe() {
      return data.embedderProbe ?? null;
    },
    async setEmbedderProbe(info) {
      data.embedderProbe = { at: Date.now(), ...info };
      persist();
    },
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test plugins/maestro-bootstrap/memory/state.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add plugins/maestro-bootstrap/memory/state.js plugins/maestro-bootstrap/memory/state.test.js
git commit -m "feat(memory): embedder probe cache in state.json"
```

---

### Task 3: `Embedder.probe()` — локальный лёгкий чек

**Files:**
- Modify: `plugins/maestro-bootstrap/memory/embeddings.js`
- Test: `plugins/maestro-bootstrap/memory/embeddings.test.js`

**Interfaces:**
- Consumes: существующий `Embedder`.
- Produces: `async probe(): Promise<{ ok, hard, detail }>` — не форсирует загрузку модели (spec §4.2). Конструктор принимает опц. `_importImpl` (тестовая инъекция).

- [ ] **Step 1: Падающие тесты** в `embeddings.test.js`:

```js
test("probe ok when transformers importable", async () => {
  const e = new Embedder({ model: "x", cacheDir: "/tmp/x", _pipeline: null, _dim: 3, moduleDir: "/tmp/m", _importImpl: async () => ({}) });
  const p = await e.probe();
  assert.equal(p.ok, true);
  assert.equal(p.hard, false);
});

test("probe hard when transformers missing", async () => {
  const e = new Embedder({ model: "x", cacheDir: "/tmp/x", _pipeline: null, _dim: 3, moduleDir: "/tmp/m", _importImpl: async () => { throw new Error("not found"); } });
  const p = await e.probe();
  assert.equal(p.ok, false);
  assert.equal(p.hard, true);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test plugins/maestro-bootstrap/memory/embeddings.test.js`
Expected: FAIL (`e.probe is not a function`).

- [ ] **Step 3: Реализовать в `embeddings.js`**

В конструкторе: `this._importImpl = _importImpl ?? null;` (параметр добавляется). Метод:

```js
  async probe() {
    const imp = this._importImpl ?? (() => import(`${this.moduleDir}/node_modules/@huggingface/transformers`));
    try {
      await imp();
    } catch {
      return { ok: false, hard: true, detail: `transformers не установлен — выполните npm install в ${this.moduleDir} (см. manual_docs/how-to/enable-memory.md)` };
    }
    return { ok: true, hard: false, detail: "зависимость на месте; загрузка модели — лениво (первый embed)" };
  }
```

- [ ] **Step 4: Run to verify they pass**

Run: `node --test plugins/maestro-bootstrap/memory/embeddings.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add plugins/maestro-bootstrap/memory/embeddings.js plugins/maestro-bootstrap/memory/embeddings.test.js
git commit -m "feat(memory): Embedder.probe() light availability check"
```

---

### Task 4: `OpenAiEmbedder` + `EmbedRetryableError` + probe

**Files:**
- Create: `plugins/maestro-bootstrap/memory/embeddings-openai.js`
- Test: `plugins/maestro-bootstrap/memory/embeddings-openai.test.js`

**Interfaces:**
- Consumes: `makeBoundedMap` из `../core.js`.
- Produces:
  - `class EmbedRetryableError extends Error` с `this.retryable = true`.
  - `class OpenAiEmbedder` — `constructor({ model, baseUrl, apiKey, dim = null, apiKeyEnv = null, timeoutMs = 15000, fetchImpl = globalThis.fetch, cache = makeBoundedMap(256) })`, методы `embed(text) → Promise<Float32Array>`, `get dim()`, `get modelId() = openai:${model}@${baseUrl}`, `async init() → this`, `async probe() → { ok, hard, detail }`.

- [ ] **Step 1: Падающие тесты** в `embeddings-openai.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { OpenAiEmbedder, EmbedRetryableError } from "./embeddings-openai.js";

function fakeFetch(respond) {
  const calls = [];
  const fn = async (url, opts) => { calls.push({ url, opts }); return respond(url, opts, calls.length); };
  fn.calls = calls;
  return fn;
}
const okRes = () => ({ ok: true, status: 200, statusText: "OK", json: async () => ({ data: [{ embedding: [0.1, 0.2, 0.3] }] }) });

test("embed posts /embeddings with auth, returns Float32Array", async () => {
  const fetchImpl = fakeFetch(async () => okRes());
  const e = new OpenAiEmbedder({ model: "m", baseUrl: "https://api.openai.com/v1", apiKey: "sk-xyz", dim: 3, fetchImpl });
  const v = await e.embed("hello");
  assert.ok(v instanceof Float32Array);
  assert.equal(v.length, 3);
  assert.equal(e.modelId, "openai:m@https://api.openai.com/v1");
  const c = fetchImpl.calls[0];
  assert.equal(c.url, "https://api.openai.com/v1/embeddings");
  assert.equal(c.opts.headers.Authorization, "Bearer sk-xyz");
  assert.deepEqual(JSON.parse(c.opts.body), { model: "m", input: "hello" });
});

test("dimension mismatch throws actionable with actual dim", async () => {
  const fetchImpl = fakeFetch(async () => ({ ok: true, status: 200, statusText: "OK", json: async () => ({ data: [{ embedding: [1, 2] }] }) }));
  const e = new OpenAiEmbedder({ model: "m", baseUrl: "https://x/v1", apiKey: "k", dim: 3, fetchImpl });
  await assert.rejects(() => e.embed("hi"), /dimension mismatch \(api=2, config=3\)/);
});

test("5xx and network → EmbedRetryableError; 401 → plain Error", async () => {
  const e1 = new OpenAiEmbedder({ model: "m", baseUrl: "https://x/v1", apiKey: "k", dim: 3, fetchImpl: fakeFetch(async () => ({ ok: false, status: 503, statusText: "Busy", text: async () => "" })) });
  await assert.rejects(() => e1.embed("hi"), (err) => err instanceof EmbedRetryableError);
  const e2 = new OpenAiEmbedder({ model: "m", baseUrl: "https://x/v1", apiKey: "k", dim: 3, fetchImpl: fakeFetch(async () => ({ ok: false, status: 401, statusText: "Unauthorized", text: async () => "" })) });
  await assert.rejects(() => e2.embed("hi"), (err) => !(err instanceof EmbedRetryableError));
  const e3 = new OpenAiEmbedder({ model: "m", baseUrl: "https://x/v1", apiKey: "k", dim: 3, fetchImpl: fakeFetch(async () => { throw new Error("ECONNREFUSED"); }) });
  await assert.rejects(() => e3.embed("hi"), (err) => err instanceof EmbedRetryableError);
});

test("cache dedups identical text (single fetch)", async () => {
  let n = 0;
  const fetchImpl = fakeFetch(async () => { n++; return okRes(); });
  const e = new OpenAiEmbedder({ model: "m", baseUrl: "https://x/v1", apiKey: "k", dim: 3, fetchImpl });
  await e.embed("q");
  await e.embed("q");
  assert.equal(n, 1);
});

test("probe classification", async () => {
  const mk = (respond) => new OpenAiEmbedder({ model: "m", baseUrl: "https://x/v1", apiKey: "k", dim: 3, apiKeyEnv: "EMB_KEY", fetchImpl: fakeFetch(respond) });
  assert.deepEqual(await mk(async () => okRes()).probe(), { ok: true, hard: false, detail: "OK (dim 3)" });
  const p401 = await mk(async () => ({ ok: false, status: 401, statusText: "Unauthorized", text: async () => "" })).probe();
  assert.equal(p401.ok, false); assert.equal(p401.hard, true); assert.ok(p401.detail.includes("EMB_KEY"));
  const p404 = await mk(async () => ({ ok: false, status: 404, statusText: "Not Found", text: async () => "" })).probe();
  assert.equal(p404.hard, true);
  const p503 = await mk(async () => ({ ok: false, status: 503, statusText: "Busy", text: async () => "" })).probe();
  assert.equal(p503.hard, false);
  const pNet = await mk(async () => { throw new Error("timeout"); }).probe();
  assert.equal(pNet.hard, false);
  const pDim = await mk(async () => ({ ok: true, status: 200, statusText: "OK", json: async () => ({ data: [{ embedding: [1, 2] }] }) })).probe();
  assert.equal(pDim.hard, true);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test plugins/maestro-bootstrap/memory/embeddings-openai.test.js`
Expected: FAIL (модуль не существует).

- [ ] **Step 3: Реализовать `embeddings-openai.js`**

```js
import { makeBoundedMap } from "../core.js";

export class EmbedRetryableError extends Error {
  constructor(message) {
    super(message);
    this.name = "EmbedRetryableError";
    this.retryable = true;
  }
}

export class OpenAiEmbedder {
  constructor({ model, baseUrl, apiKey, dim = null, apiKeyEnv = null, timeoutMs = 15000, fetchImpl = globalThis.fetch, cache = makeBoundedMap(256) }) {
    this.model = model;
    this.baseUrl = baseUrl;
    this.apiKey = apiKey;
    this.apiKeyEnv = apiKeyEnv;
    this._dim = dim;
    this.timeoutMs = timeoutMs;
    this.fetchImpl = fetchImpl;
    this.cache = cache;
  }
  get dim() { return this._dim; }
  get modelId() { return `openai:${this.model}@${this.baseUrl}`; }
  async init() { return this; }
  async _post(text) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await this.fetchImpl(`${this.baseUrl}/embeddings`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.apiKey}` },
        body: JSON.stringify({ model: this.model, input: text }),
        signal: controller.signal,
      });
    } catch (err) {
      throw new EmbedRetryableError(`openai embeddings network error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      clearTimeout(timer);
    }
  }
  async embed(text) {
    const hit = this.cache.get(text);
    if (hit) return hit;
    const res = await this._post(text);
    if (!res.ok) {
      if (res.status >= 500) {
        throw new EmbedRetryableError(`openai embeddings ${res.status} ${res.statusText}: ${(await res.text()).slice(0, 200)}`);
      }
      throw new Error(`openai embeddings ${res.status} ${res.statusText}: ${(await res.text()).slice(0, 200)}`);
    }
    const data = await res.json();
    const vec = new Float32Array(data.data[0].embedding);
    if (this._dim != null && vec.length !== this._dim) {
      throw new Error(`openai embeddings dimension mismatch (api=${vec.length}, config=${this._dim}) — см. manual_docs/how-to/enable-memory.md`);
    }
    this._dim = this._dim ?? vec.length;
    this.cache.set(text, vec);
    return vec;
  }
  async probe() {
    let res;
    try {
      res = await this._post("probe");
    } catch (err) {
      return { ok: false, hard: false, detail: err instanceof Error ? err.message : String(err) };
    }
    if (res.status === 401 || res.status === 403) {
      return { ok: false, hard: true, detail: `API-ключ отклонён (${res.status}) — проверьте env ${this.apiKeyEnv}` };
    }
    if (res.status === 404) {
      return { ok: false, hard: true, detail: "модель/URL не найдены (404) — проверьте model/base_url" };
    }
    if (!res.ok) return { ok: false, hard: false, detail: `API временно недоступен (${res.status})` };
    const data = await res.json();
    const dim = data.data[0].embedding.length;
    if (this._dim != null && dim !== this._dim) {
      return { ok: false, hard: true, detail: `dimension mismatch (api=${dim}, config=${this._dim})` };
    }
    return { ok: true, hard: false, detail: `OK (dim ${dim})` };
  }
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `node --test plugins/maestro-bootstrap/memory/embeddings-openai.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add plugins/maestro-bootstrap/memory/embeddings-openai.js plugins/maestro-bootstrap/memory/embeddings-openai.test.js
git commit -m "feat(memory): OpenAiEmbedder + EmbedRetryableError + probe"
```

---

### Task 5: Wiring в `registerMemoryHooks` — диспатч, dim, ключ, стартовый probe

**Files:**
- Modify: `plugins/maestro-bootstrap/memory/index.js`
- Test: `plugins/maestro-bootstrap/memory/index.test.js`

**Interfaces:**
- Consumes: `config.embedding` (Task 1), `state.getEmbedderProbe/setEmbedderProbe` (Task 2), `Embedder.probe` (Task 3), `OpenAiEmbedder` (Task 4).
- Produces:
  - `registerMemoryHooks` создаёт `OpenAiEmbedder` при `provider === "openai"`, иначе `Embedder`.
  - `modelId`/`dim` для `createStorage` из конфига (spec §3.3).
  - Проверка `api_key_env` (openai) → память off до storage.
  - Стартовый probe (кэш по identity + гибрид hard/soft; cached hard → live re-probe) **до** `createStorage`.
  - init-warn `external_embedder_unmasked_queries` при openai + непустые `confidential.paths`.

- [ ] **Step 1: Падающие тесты** в `index.test.js`:

```js
test("openai provider missing api key env → memory off", async () => {
  delete process.env.MM_KEY_UNSET;
  const cfg = { memory: { enabled: true, storage: { type: "sqlite" }, embedding: { provider: "openai", model: "m", api_key_env: "MM_KEY_UNSET", dim: 3 } } };
  const hooks = await registerMemoryHooks({ client: mkClient(), config: cfg, log: mkLog(), root: tmpdir() });
  assert.deepEqual(hooks, {});
});

test("openai provider with key + injected deps registers hooks", async () => {
  process.env.MM_KEY_SET = "sk-test";
  const cfg = { memory: { enabled: true, storage: { type: "sqlite" }, embedding: { provider: "openai", model: "m", api_key_env: "MM_KEY_SET", base_url: "https://x/v1", dim: 3 } } };
  const hooks = await registerMemoryHooks({
    client: mkClient(), config: cfg, log: mkLog(), root: tmpdir(),
    deps: { storage: mkStorage(), embeddings: { probe: async () => ({ ok: true, hard: false, detail: "ok" }), dim: 3, modelId: "openai:m@https://x/v1" } },
  });
  delete process.env.MM_KEY_SET;
  assert.ok(hooks.memory_search);
});

test("startup probe hard fail → memory off (hooks {})", async () => {
  const cfg = { memory: { enabled: true, storage: { type: "sqlite" } } };
  const hooks = await registerMemoryHooks({
    client: mkClient(), config: cfg, log: mkLog(), root: tmpdir(),
    deps: { storage: mkStorage(), embeddings: { probe: async () => ({ ok: false, hard: true, detail: "dimension mismatch" }), dim: 3, modelId: "m" } },
  });
  assert.deepEqual(hooks, {});
});

test("startup probe soft fail → hooks registered (fail-soft)", async () => {
  const cfg = { memory: { enabled: true, storage: { type: "sqlite" } } };
  const hooks = await registerMemoryHooks({
    client: mkClient(), config: cfg, log: mkLog(), root: tmpdir(),
    deps: { storage: mkStorage(), embeddings: { probe: async () => ({ ok: false, hard: false, detail: "network" }), dim: 3, modelId: "m" } },
  });
  assert.ok(hooks.memory_search);
});

test("cooldown cache keyed by identity: same config → single live probe", async () => {
  let probes = 0;
  const fake = { probe: async () => { probes++; return { ok: true, hard: false, detail: "ok" }; }, dim: 3, modelId: "m" };
  const cfg = { memory: { enabled: true, storage: { type: "sqlite" } } };
  const root = tmpdir();
  await registerMemoryHooks({ client: mkClient(), config: cfg, log: mkLog(), root, deps: { storage: mkStorage(), embeddings: fake } });
  await registerMemoryHooks({ client: mkClient(), config: cfg, log: mkLog(), root, deps: { storage: mkStorage(), embeddings: fake } });
  assert.equal(probes, 1);
});

test("cache identity mismatch (different modelId) → live probe again", async () => {
  let probes = 0;
  const mkFake = (modelId) => ({ probe: async () => { probes++; return { ok: true, hard: false, detail: "ok" }; }, dim: 3, modelId });
  const cfg = { memory: { enabled: true, storage: { type: "sqlite" } } };
  const root = tmpdir();
  await registerMemoryHooks({ client: mkClient(), config: cfg, log: mkLog(), root, deps: { storage: mkStorage(), embeddings: mkFake("m") } });
  await registerMemoryHooks({ client: mkClient(), config: cfg, log: mkLog(), root, deps: { storage: mkStorage(), embeddings: mkFake("m2") } });
  assert.equal(probes, 2);
});

test("cached hard → live re-probe (no shortcut)", async () => {
  let probes = 0;
  const fake = { probe: async () => { probes++; return { ok: false, hard: true, detail: "dim mismatch" }; }, dim: 3, modelId: "m" };
  const cfg = { memory: { enabled: true, storage: { type: "sqlite" } } };
  const root = tmpdir();
  const h1 = await registerMemoryHooks({ client: mkClient(), config: cfg, log: mkLog(), root, deps: { storage: mkStorage(), embeddings: fake } });
  assert.deepEqual(h1, {});
  const h2 = await registerMemoryHooks({ client: mkClient(), config: cfg, log: mkLog(), root, deps: { storage: mkStorage(), embeddings: fake } });
  assert.deepEqual(h2, {});
  assert.equal(probes, 2);
});

test("init-warn external_embedder_unmasked_queries when openai + confidential paths", async () => {
  process.env.MM_KEY_SET = "k";
  const logs = [];
  const cfg = { memory: { enabled: true, storage: { type: "sqlite" }, confidential: { paths: ["docs/confidential/**"] }, embedding: { provider: "openai", model: "m", api_key_env: "MM_KEY_SET", dim: 3 } } };
  await registerMemoryHooks({
    client: mkClient(), config: cfg, log: { warn: (m) => logs.push(m) }, root: tmpdir(),
    deps: { storage: mkStorage(), embeddings: { probe: async () => ({ ok: true, hard: false, detail: "ok" }), dim: 3, modelId: "openai:m@https://api.openai.com/v1" } },
  });
  delete process.env.MM_KEY_SET;
  assert.ok(logs.some((l) => String(l).includes("external_embedder_unmasked_queries")));
});
```

> `mkClient/mkLog/tmpdir/mkStorage` — существующие хелперы `index.test.js` (см. соседние тесты с `deps.storage`/`deps.embeddings`).

- [ ] **Step 2: Run to verify they fail**

Run: `node --test plugins/maestro-bootstrap/memory/index.test.js`
Expected: FAIL (новая логика не реализована).

- [ ] **Step 3: Реализовать в `index.js`**

Импорты:

```js
import { Embedder } from "./embeddings.js";
import { OpenAiEmbedder } from "./embeddings-openai.js";
```

В `registerMemoryHooks`, сразу после pgvector-проверки (в блоке try, до storage):

```js
    const isOpenai = config.embedding.provider === "openai";
    if (isOpenai && !process.env[config.embedding.api_key_env]) {
      log?.info?.("memory: disabled", { reason: "embedding_api_key_env_missing" });
      return {};
    }
```

`modelId`/`dim` + конструирование embeddings ДО `createStorage`. Текущий флоу: storage (~302-312) создаётся раньше embeddings (~341). Переставить: вычисляем `modelId`/`dim`, конструируем `embeddings`, выполняем probe, затем `createStorage`/`init` + остальное. Вычислить `modelId`/`dim` рядом с `storageOptions`:

```js
    const modelId = isOpenai
      ? `openai:${config.embedding.model}@${config.embedding.base_url}`
      : (config.embedding.model ?? config.embedding_model);
    const dim = isOpenai ? config.embedding.dim : 384;
    const embeddings = deps.embeddings ?? (isOpenai
      ? new OpenAiEmbedder({
          model: config.embedding.model,
          baseUrl: config.embedding.base_url,
          apiKey: process.env[config.embedding.api_key_env],
          apiKeyEnv: config.embedding.api_key_env,
          dim: config.embedding.dim,
        })
      : new Embedder({ model: config.embedding.model ?? config.embedding_model, cacheDir: memoryDataDir, moduleDir }));
```

Затем **probe (ДО `createStorage`/`storage.init()`)** — spec §4.4 (hard-fail не создаёт storage), затем `createStorage` с `modelId`/`dim` (вместо `config.embedding_model`/`384`):

```js
    const state = createState(statePath);
    const cooldownMs = config.probe_cooldown_min * 60_000;
    const identity = { modelId, dim, apiKeyEnv: config.embedding.api_key_env ?? null };
    const cached = await state.getEmbedderProbe();
    const cacheValid = cached && cached.modelId === identity.modelId && cached.dim === identity.dim && cached.apiKeyEnv === identity.apiKeyEnv;
    if (cacheValid && Date.now() - cached.at < cooldownMs && cached.ok) {
      log?.info?.("memory: embedder probe (cached)", { ok: true, detail: cached.detail });
    } else if (cacheValid && Date.now() - cached.at < cooldownMs && !cached.hard) {
      log?.warn?.("memory: embedder probe (cached soft fail)", { detail: cached.detail });
    } else {
      const p = await probeWithGuard(embeddings, 20000); // guard > provider timeout 15s (follow-up 1)
      await state.setEmbedderProbe({ ...identity, ...p });
      if (p.ok) {
        log?.info?.("memory: embedder probe OK", { detail: p.detail });
      } else if (p.hard) {
        log?.info?.("memory: disabled", { reason: "embedder_probe_hard_fail", detail: p.detail });
        return { memory_probe: makeMemoryProbeTool({ embeddings, state, log }) };
      } else {
        log?.warn?.("memory: embedder probe failed", { detail: p.detail });
      }
    }
```

Хелперы (top-level, в этом же файле):

```js
async function probeWithGuard(embeddings, guardMs) {
  if (!embeddings.probe) return { ok: true, hard: false, detail: "probe недоступен (deps mock)" };
  let timer;
  const guard = new Promise((resolve) => {
    timer = setTimeout(() => resolve({ ok: false, hard: false, detail: "probe timeout (guard)" }), guardMs);
  });
  try {
    return await Promise.race([
      embeddings.probe().catch((err) => ({ ok: false, hard: false, detail: `probe exception: ${err instanceof Error ? err.message : String(err)}` })),
      guard,
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function makeMemoryProbeTool({ embeddings, state, log }) {
  return tool({
    description: "Live-проверка доступности модели эмбеддингов (probe): ключ, модель, размерность, сеть. Принудительно, минуя cooldown.",
    args: {},
    execute: async (args, ctx) => {
      try {
        if (SESSIONS.has(ctx?.sessionID)) return "Инструмент недоступен для служебных сессий.";
        const p = await embeddings.probe();
        await state.setEmbedderProbe({ modelId: embeddings.modelId, dim: embeddings.dim, apiKeyEnv: null, ...p });
        return `Проверка embedder (${embeddings.modelId}): ${p.ok ? "OK" : "FAIL"}${p.hard ? " (конфигурация)" : ""} — ${p.detail}`;
      } catch (err) {
        return `memory_probe failed: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  });
}
```
> `makeMemoryProbeTool` переиспользуется в Task 8 для штатного `toolHooks`.

Порядок в `registerMemoryHooks`: `state` сейчас создаётся на ~342 — поднять создание `state` выше (до probe). `statePath` уже определён на ~258. Ветка hard-fail с `return { memory_probe }` — см. блок probe выше (~668-670), дублировать не нужно.

init-warn (после создания embeddings, рядом с существующим `unmasked_branch_metadata`):

```js
    const confidentialPaths = maestroConfig?.confidential?.paths ?? [];
    if (isOpenai && confidentialPaths.length > 0) {
      log?.warn?.("memory: external_embedder_unmasked_queries — запросы и контент (замаскированные best-effort) уходят генерическому внешнему вендору");
    }
```
> `confidentialPaths` уже вычисляется на ~343; переместить/переиспользовать.

- [ ] **Step 4: Run to verify they pass** (все тесты `index.test.js`, включая legacy)

Run: `node --test plugins/maestro-bootstrap/memory/index.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add plugins/maestro-bootstrap/memory/index.js plugins/maestro-bootstrap/memory/index.test.js
git commit -m "feat(memory): provider dispatch + dim + startup probe (identity cache, hybrid)"
```

---

### Task 6: Маскирование recall-запросов + short-circuit

**Files:**
- Modify: `plugins/maestro-bootstrap/memory/recall.js`
- Modify: `plugins/maestro-bootstrap/memory/index.js`
- Test: `plugins/maestro-bootstrap/memory/recall.test.js`, `plugins/maestro-bootstrap/memory/index.test.js`

**Interfaces:**
- Consumes: `maskTranscript` из `./mask.js`; `confidentialPaths` (index.js).
- Produces: `Recall` принимает `confidentialPatterns`; все три query call-site маскируют перед embed; пустой замаскированный запрос → short-circuit всего поиска (spec §3.4, follow-up 3).

- [ ] **Step 1: Падающие тесты**

В `recall.test.js`:

```js
test("recall masks confidential query before embed", async () => {
  let embedded = null;
  const embedder = { embed: async (t) => { embedded = t; return new Float32Array([0.1, 0.2, 0.3]); }, dim: 3, modelId: "m" };
  const storage = { search: async () => [] };
  const r = new Recall({
    embeddings: embedder, storage, topK: 3, minScore: 0.35, key: "p",
    getUserMessageCount: async () => 1, confidentialPatterns: ["docs/confidential/**"],
  });
  await r.onChatMessage({ sessionID: "s1", text: "docs/confidential/roadmap.md какие сроки?" });
  assert.ok(!embedded.includes("roadmap"));
});

test("recall leaves non-confidential query unmasked", async () => {
  let embedded = null;
  const embedder = { embed: async (t) => { embedded = t; return new Float32Array([0.1, 0.2, 0.3]); }, dim: 3, modelId: "m" };
  const storage = { search: async () => [] };
  const r = new Recall({
    embeddings: embedder, storage, topK: 3, minScore: 0.35, key: "p",
    getUserMessageCount: async () => 1, confidentialPatterns: ["docs/confidential/**"],
  });
  await r.onChatMessage({ sessionID: "s1", text: "какие сроки по roadmap?" });
  assert.ok(embedded.includes("roadmap"));
});

test("fully masked query → no embed, no search (short-circuit)", async () => {
  let embeds = 0; let searches = 0;
  const embedder = { embed: async (t) => { embeds++; return new Float32Array([0.1, 0.2, 0.3]); }, dim: 3, modelId: "m" };
  const storage = { search: async () => { searches++; return []; } };
  const r = new Recall({
    embeddings: embedder, storage, topK: 3, minScore: 0.35, key: "p",
    getUserMessageCount: async () => 1, confidentialPatterns: ["docs/confidential/**"],
  });
  await r.onChatMessage({ sessionID: "s1", text: "docs/confidential/a.md" });
  assert.equal(embeds, 0);
  assert.equal(searches, 0);
});
```

> Условие short-circuit: `!masked || masked.trim() === "[confidential]"` — однострочный полностью
> замаскированный запрос после `maskTranscript` превращается в `[confidential]` (не `""`), см. Step 3.

В `index.test.js` (маскирование в `memory_search` — по образцу существующего теста вызова execute):

```js
test("memory_search masks confidential query before embed", async () => {
  const seen = [];
  const cfg = { memory: { enabled: true, storage: { type: "sqlite" }, confidential: { paths: ["docs/confidential/**"] } } };
  const hooks = await registerMemoryHooks({
    client: mkClient(), config: cfg, log: mkLog(), root: tmpdir(),
    deps: { storage: mkStorage(), embeddings: { embed: async (t) => { seen.push(t); return new Float32Array([0.1, 0.2, 0.3]); }, probe: async () => ({ ok: true, hard: false, detail: "ok" }), dim: 3, modelId: "m" } },
  });
  await hooks.memory_search.execute({ query: "docs/confidential/roadmap.md сроки" }, { sessionID: "s1" });
  assert.ok(!seen[0].includes("roadmap"));
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test plugins/maestro-bootstrap/memory/recall.test.js plugins/maestro-bootstrap/memory/index.test.js`
Expected: FAIL (query уходит без маскирования / embed вызывается на пустом).

- [ ] **Step 3: Реализовать**

`recall.js`:

```js
import { maskTranscript } from "./mask.js";
// конструктор: добавить параметр confidentialPatterns = []
// и this.confidentialPatterns = confidentialPatterns;
```

В `onChatMessage` (замена embed-вызова):

```js
      const masked = maskTranscript(text, { confidentialPatterns: this.confidentialPatterns });
      if (!masked || masked.trim() === "[confidential]") { this.buffer.set(sessionID, []); return; } // short-circuit всего поиска
      const vec = await this.embeddings.embed(masked);
```

`index.js`:
- импорт: `import { maskEntry, maskTranscript } from "./mask.js";`
- конструктор `Recall`: добавить `confidentialPatterns: confidentialPaths,`.
- `memory_search` execute (~409): short-circuit + маскирование:

```js
            const maskedQuery = maskTranscript(args.query, { confidentialPatterns: confidentialPaths });
            if (!maskedQuery || maskedQuery.trim() === "[confidential]") return "Ничего не найдено.";
            const vec = await embeddings.embed(maskedQuery);
```

- `memory_recall_preview` execute (~609): аналогично:

```js
            const maskedQuery = maskTranscript(args.query, { confidentialPatterns: confidentialPaths });
            if (!maskedQuery || maskedQuery.trim() === "[confidential]") return "Ничего не найдено.";
            const vec = await embeddings.embed(maskedQuery);
```

- [ ] **Step 4: Run to verify they pass**

Run: `node --test plugins/maestro-bootstrap/memory/recall.test.js plugins/maestro-bootstrap/memory/index.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add plugins/maestro-bootstrap/memory/recall.js plugins/maestro-bootstrap/memory/index.js plugins/maestro-bootstrap/memory/recall.test.js plugins/maestro-bootstrap/memory/index.test.js
git commit -m "feat(memory): mask recall/search queries before embed + empty short-circuit"
```

---

### Task 7: Индексатор — retryable-ошибки не считают в skip

**Files:**
- Modify: `plugins/maestro-bootstrap/memory/indexer.js`
- Test: `plugins/maestro-bootstrap/memory/indexer.test.js`

**Interfaces:**
- Consumes: `EmbedRetryableError.retryable === true` (Task 4).
- Produces: при embed-провале с `err.retryable === true` — без `recordFail` (лог остаётся).

- [ ] **Step 1: Падающий тест** в `indexer.test.js` (по образцу теста «indexer _run calls recordFail on error», ~строка 128):

```js
test("indexer retryable embed error does not recordFail", async () => {
  let failCalled = false;
  const client = mkClient();
  const storage = mkStorage(client);
  const idx = new Indexer({
    client, config: mkConfig(),
    embeddings: {
      embed: async () => { const e = new Error("network"); e.retryable = true; throw e; },
      dim: 1, modelId: "m",
    },
    storage,
    state: { ...mkState(), recordFail: async () => { failCalled = true; } },
    summarize: async () => ({ title: "t", summary: "s", decisions: [] }),
    projectKey: { hash: "khash", source: "remote" }, confidentialPatterns: [],
  });
  await idx._run("s1");
  assert.equal(failCalled, false);
  idx.dispose();
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test plugins/maestro-bootstrap/memory/indexer.test.js`
Expected: FAIL (recordFail вызван → spy бросил).

- [ ] **Step 3: Реализовать в `indexer.js`** (в catch, ~245-249):

```js
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      this.log?.error?.("memory: indexer error", { sessionID, error: errMsg });
      if (err?.retryable) {
        this.log?.warn?.("memory: retryable embed error — skip не засчитывается", { sessionID });
      } else {
        try { await this.state.recordFail(sessionID); } catch {}
      }
    }
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test plugins/maestro-bootstrap/memory/indexer.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add plugins/maestro-bootstrap/memory/indexer.js plugins/maestro-bootstrap/memory/indexer.test.js
git commit -m "fix(memory): retryable embed errors do not count into skip-after-3"
```

---

### Task 8: On-demand — `memory_probe` tool + статус в `memory_stats_detail` + `@maestro-memory`

**Files:**
- Modify: `plugins/maestro-bootstrap/memory/index.js`
- Modify: `commands/maestro-memory.md`
- Test: `plugins/maestro-bootstrap/memory/index.test.js`

**Interfaces:**
- Produces: tool `memory_probe` (read-only, live-probe минуя cooldown; **регистрируется даже при off-состоянии** — follow-up 2); в `memory_stats_detail` — строка последнего cached-статуса probe.

- [ ] **Step 1: Падающие тесты** в `index.test.js`:

```js
test("memory_probe tool runs live probe and reports", async () => {
  let probed = 0;
  const cfg = { memory: { enabled: true, storage: { type: "sqlite" } } };
  const hooks = await registerMemoryHooks({
    client: mkClient(), config: cfg, log: mkLog(), root: tmpdir(),
    deps: { storage: mkStorage(), embeddings: { probe: async () => { probed++; return { ok: true, hard: false, detail: "OK (dim 3)" }; }, dim: 3, modelId: "m" } },
  });
  const out = await hooks.memory_probe.execute({}, { sessionID: "s1" });
  assert.ok(String(out).includes("OK"));
  assert.equal(probed, 1);
});

test("memory_probe registered even when probe hard-fail (off-state)", async () => {
  const cfg = { memory: { enabled: true, storage: { type: "sqlite" } } };
  const hooks = await registerMemoryHooks({
    client: mkClient(), config: cfg, log: mkLog(), root: tmpdir(),
    deps: { storage: mkStorage(), embeddings: { probe: async () => ({ ok: false, hard: true, detail: "dim mismatch" }), dim: 3, modelId: "m" } },
  });
  assert.ok(hooks.memory_probe, "memory_probe должен быть зарегистрирован при off");
  assert.equal(hooks.memory_search, undefined);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test plugins/maestro-bootstrap/memory/index.test.js`
Expected: FAIL (нет `memory_probe` / hooks `{}` при hard).

- [ ] **Step 3: Реализовать в `index.js`**

`makeMemoryProbeTool` и off-состояние уже реализованы в Task 5 (hard-fail → `{ memory_probe }`). Здесь — штатный `toolHooks` и статус в stats:

В штатный `toolHooks` добавить `memory_probe: makeMemoryProbeTool({ embeddings, state, log })` (для зарегистрированного состояния). В `memory_stats_detail` — строка probe (из `state.getEmbedderProbe()`), после «Модель: …»:

```js
            const cachedProbe = await state.getEmbedderProbe();
            if (cachedProbe) out.push(`Проверка embedder: ${cachedProbe.ok ? "OK" : "FAIL"}${cachedProbe.hard ? " (конфигурация)" : ""} (${cachedProbe.detail}, ${new Date(cachedProbe.at).toISOString()})`);
```
> `out` — массив строк отчёта `memory_stats_detail` (см. существующий код ~691).

`commands/maestro-memory.md`:
- В отчёт добавить строку **Проверка embedder:** (из `memory_stats_detail`).
- В шаг 1 маппинг новых `disabled_reason`: `embedding_invalid`, `embedding_api_key_env_missing`, `probe_cooldown_min_invalid`, `embedder_probe_hard_fail`.
- Если статус probe FAIL/нет данных → вызвать `memory_probe` (live) и показать результат + рекомендации.

- [ ] **Step 4: Run to verify they pass**

Run: `node --test plugins/maestro-bootstrap/memory/index.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add plugins/maestro-bootstrap/memory/index.js plugins/maestro-bootstrap/memory/index.test.js commands/maestro-memory.md
git commit -m "feat(memory): memory_probe tool (on-demand) + probe status in stats + @maestro-memory"
```

---

### Task 9: How-to «Выбор и замена модели эмбеддингов»

**Files:**
- Create: `manual_docs/how-to/choose-embedding-model.md`
- Modify: `manual_docs/index.md` (ссылка)
- Modify: `manual_docs/how-to/enable-memory.md` (ссылка из раздела «Offline: предзагрузка»)

**Interfaces:**
- Produces: user-facing how-to (критерии, настройка local/external, замена → переиндексация, проверка доступности).

- [ ] **Step 1: Создать `manual_docs/how-to/choose-embedding-model.md`**

Структура (по образцу `choose-models.md`, русский):

```markdown
# Выбор и замена модели эмбеддингов

[Назад к оглавлению](../index.md)

## 🎯 Назначение

Как выбирать, настраивать и заменять модель эмбеддингов memory layer
(`memory.embedding_model` / `memory.embedding`). Методика + механика; справочник
ключей — [Память maestro (reference)](../reference/memory.md) и
[Конфигурация (reference)](../reference/config.md).

## 📖 Критерии выбора

| Ось | Локальная (transformers.js) | Внешняя (OpenAI-совместимый API) |
|---|---|---|
| Качество recall | MiniLM-384 (RU+EN); слабее крупных провайдерских | text-embedding-3, multilingual-e5 и т.п. — обычно выше |
| Размерность | **384** (фиксирована для local; модель обязана быть 384-мерной) | **конфигурируемая** (`embedding.dim`, обязателен; равен нативной размерности модели) |
| Offline | Работает офлайн после однократной загрузки (~120 МБ кэш) | Нет: каждый embed — сетевой вызов |
| Приватность | Данные не покидают машину | Контент записей маскируется; recall-запросы маскируются всегда (best-effort); данные уходят провайдеру — осознанный opt-in (init-warn при confidential.paths) |
| Стоимость | 0 (локальный CPU/WASM) | Токены + rate-limits |

## 📖 Как настроить

Локальная (default):

```json
{ "memory": { "enabled": true, "embedding_model": "Xenova/paraphrase-multilingual-MiniLM-L12-v2" } }
```

или через блок (эквивалентно):

```json
{ "memory": { "enabled": true, "embedding": { "provider": "local", "model": "Xenova/paraphrase-multilingual-MiniLM-L12-v2" } } }
```

Внешняя:

```json
{
  "memory": {
    "enabled": true,
    "embedding": {
      "provider": "openai",
      "model": "text-embedding-3-small",
      "base_url": "https://api.openai.com/v1",
      "api_key_env": "MAESTRO_MEMORY_EMBED_KEY",
      "dim": 1536
    }
  }
}
```

Правила: `api_key_env` — имя env-переменной, никогда plaintext; `dim` обязателен
и равен **нативной** размерности модели (Matryoshka-усечение не поддерживается);
`base_url` — любой OpenAI-совместимый `/embeddings` (OpenAI, LiteLLM/one-api,
vLLM); trailing-slash нормализуется.

## 📖 Как заменить

Смена модели/провайдера → **переиндексация**: удалить
`<data-dir>/maestro/memory/<hash>/` (sqlite) или коллекцию/таблицу
(qdrant/pgvector) и включить заново (backfill). Проверка активной модели:
`@maestro-memory` (Модель: …, для внешней — `openai:<model>@<base_url>`).

> ⚠️ Локальная замена — только модели **dim 384** (например
> `Xenova/multilingual-e5-small`).

## 📖 Проверка доступности

`@maestro-memory` → строка «Проверка embedder» (последний статус) или tool
`memory_probe` (live, минуя cooldown). При `FAIL (конфигурация)` — исправить
конфиг и перезапустить opencode (авто-перепроверка на старте). Внешний
провайдер проверяется при старте не чаще `probe_cooldown_min` (default 30 мин).

## 🔗 Связанные разделы

- [Как включить память maestro](enable-memory.md)
- [Память maestro (reference)](../reference/memory.md)
- [Выбор моделей (reference)](../reference/model-selection.md)
- [SECURITY.md](../../SECURITY.md) — §5a
```

- [ ] **Step 2: `manual_docs/index.md`** — в секцию How-to добавить:
```md
- [Выбор и замена модели эмбеддингов](how-to/choose-embedding-model.md) — критерии, настройка, переиндексация, проверка
```

- [ ] **Step 3: `manual_docs/how-to/enable-memory.md`** — в разделе «Offline: предзагрузка» после сноски про переиндексацию добавить:
```md
> Методика выбора/замены модели — [Выбор и замена модели эмбеддингов](choose-embedding-model.md).
```

- [ ] **Step 4: Commit**
```bash
git add manual_docs/how-to/choose-embedding-model.md manual_docs/index.md manual_docs/how-to/enable-memory.md
git commit -m "docs: how-to for choosing/replacing embedding model"
```

---

### Task 10: Синхронизация документации и канона

**Files:**
- Modify: `SECURITY.md`
- Modify: `skills/maestro-assistant/SKILL.md`
- Modify: `manual_docs/reference/config.md`
- Modify: `manual_docs/reference/model-selection.md`
- Modify: `manual_docs/reference/memory.md`
- Modify: `manual_docs/how-to/enable-memory.md`
- Modify: `manual_docs/explanation/agents-and-trust.md`
- Modify: `manual_docs/overview/changelog.md`
- Modify: `plugins/maestro-bootstrap/README.md`
- Modify: `commands/maestro-memory-report.md`
- Modify: `docs/project-context.md`

**Interfaces:**
- Consumes: конфиг-схема (Task 1), поведение (Tasks 2-8).

- [ ] **Step 1: `SECURITY.md` §5a** — пункт «Локальность» переформулировать:

```
- **Локальность (default) / внешний embedder (opt-in).** Эмбеддинги локальных
  провайдеров — в процессе, кэш модели — локальный; единственный сетевой вызов —
  однократная загрузка модели (offline-режим с предзагрузкой). Опциональный
  `memory.embedding.provider: "openai"` — OpenAI-совместимый API: контент записей
  маскируется до эмбеддинга (инвариант ниже), **recall-запросы маскируются всегда**
  (best-effort, line-level по `confidential.paths`), ключ — только через
  `api_key_env` (никогда plaintext), запросы/контент покидают машину — осознанный
  opt-in. При непустых `confidential.paths` — init-warn
  `external_embedder_unmasked_queries`. Проверка работоспособности модели на старте
  (probe) не влияет на модель доверия. `storage.type` остаётся единственным
  решением локально/удалённо для записей.
```

- [ ] **Step 2: `skills/maestro-assistant/SKILL.md`** — в memory-разделе канона добавить описание блока `memory.embedding` (provider/model/base_url/api_key_env/dim), legacy `embedding_model`, `probe_cooldown_min` (те же значения, что в spec §2.1).

- [ ] **Step 3: `manual_docs/reference/config.md`** — в таблицу секции `memory` добавить строки для `embedding`-блока (provider/model/base_url/api_key_env/dim), legacy-примечание к `embedding_model`, `probe_cooldown_min` (default 30).

- [ ] **Step 4: `manual_docs/reference/model-selection.md`** — в раздел «Модели памяти» добавить блок «Внешний embedder (opt-in)» (по spec §1/§5): плюсы, риски (данные покидают машину, маскирование, offline нет, стоимость), dim обязателен, ключ через env, смена → переиндексация.

- [ ] **Step 5: `manual_docs/reference/memory.md`** — обновить конфиг-таблицу (`embedding` блок, `probe_cooldown_min`), отметить `model_id` для openai (`openai:<model>@<base_url>`, валидация экспорта/импорта).

- [ ] **Step 6: `manual_docs/how-to/enable-memory.md`** — подраздел «Внешний embedder (OpenAI-совместимый API)» (пример конфига, dim обязателен, ключ через env, данные покидают машину, init-warn, смена → переиндексация) + раздел «Проверка работоспособности» (probe на старте, cooldown, `memory_probe`, `@maestro-memory`).

- [ ] **Step 7: `manual_docs/explanation/agents-and-trust.md`** — memory-раздел: локальность по умолчанию; внешний провайдер — opt-in с маскированием запросов и документированным выходом данных наружу (trust-модель не меняется).

- [ ] **Step 8: `manual_docs/overview/changelog.md`** — запись о фиче (external embedder + probe + маскирование запросов).

- [ ] **Step 9: `plugins/maestro-bootstrap/README.md`** — в примере конфига memory добавить `embedding`-блок.

- [ ] **Step 10: `commands/maestro-memory-report.md`** — строка «Модель: `<embedding_model>`» → провайдер/модель (`openai: <model>@<base_url>`).

- [ ] **Step 11: `docs/project-context.md`** — применить секцию «Project Context Changes» (из шапки плана): §3 и §5.

- [ ] **Step 12: Smoke-проверка**

Run: `node --test plugins/maestro-bootstrap/index.test.js`
Expected: PASS (docs не влияют).

- [ ] **Step 13: Commit**
```bash
git add SECURITY.md skills/maestro-assistant/SKILL.md manual_docs plugins/maestro-bootstrap/README.md commands/maestro-memory-report.md docs/project-context.md
git commit -m "docs: external embedder config + privacy + probe (SECURITY.md, manual_docs, canon, changelog)"
```

---

### Task 11: Полная верификация

**Files:**
- None (запуск тестов).

- [ ] **Step 1: Прогнать весь тест-сьют плагина**

Run: `npm test`
Expected: PASS.

- [ ] **Step 2: Прогнать memory-тесты**

Run: `npm run test:memory`
Expected: PASS.

- [ ] **Step 3: Синтаксис изменённых файлов**

Run: `node --check plugins/maestro-bootstrap/memory/embeddings-openai.js plugins/maestro-bootstrap/memory/embeddings.js plugins/maestro-bootstrap/memory/index.js plugins/maestro-bootstrap/memory/recall.js plugins/maestro-bootstrap/memory/indexer.js plugins/maestro-bootstrap/memory/config.js plugins/maestro-bootstrap/memory/state.js`
Expected: без ошибок.

- [ ] **Step 4: Regression-сценарии** (из шапки плана) — прогнать команды.