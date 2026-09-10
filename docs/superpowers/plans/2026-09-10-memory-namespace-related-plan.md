# Namespace-Идентичность и Связи Проектов (memory v5.1) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Единая читаемая идентичность проекта (обязательный валидируемый namespace как единственный ключ), домен-авто-related (иерархия), явные `related`-связи, детекция коллизий, `memory_migrate` для пере-keying. Инкремент к ветке `feature/memory-branch-lifecycle` (поверх уже реализованного v5 lifecycle; версия остаётся 3.2.0).

**Architecture:** `key = namespace` (обязательный, формат `^[a-z0-9]([a-z0-9-]{0,30}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,30}[a-z0-9])?){0,2}$`, нормализация trim+lowercase ДО валидации). Поля записей `origin_remote` + `prefixes` (guard-ALTER). Единый оператор `subtreeLeg(T)` (merged-only) для домен-авто/`related`/`project:`. Домен = последний префикс. Persist: `lastKey` — per-project `<memoryDataDir>/<hash(absPath)>/state.json`, seen-set — per-key `<memoryDataDir>/<hash(key)>/state.json`, атомарно (tmp+rename). `memory_migrate` (ask): `from: auto|namespace|hash`, max-version-wins.

**Tech Stack:** Node.js (ESM), better-sqlite3/node:sqlite, qdrant, pgvector, git (spawnSync), OpenCode plugin tools, node --test.

**Spec:** `docs/superpowers/specs/2026-09-10-memory-related-namespace-design.md` (см. §3–§9; задачи ссылаются на секции).

**Команды:** `node --test plugins/maestro-bootstrap/index.test.js` и `npm run test:memory`. Точечные — по файлу теста.

**Контекст:** namespace обязателен для enabled; отсутствие → `namespace_missing`, невалидный → `namespace_invalid`, `related` невалиден → `related_invalid` (приоритет: `namespace_missing` > `namespace_invalid` > `related_invalid`). `origin_remote` = `canonicalizeRemote(origin remote)`; `prefixes` = все префиксы ключа (для `a.b.c` → `["a","a.b"]`). `domain_recall` (default true) — off-switch домен-ног.

---

## File Structure

| Файл | Роль | Тип |
|---|---|---|
| `memory/config.js` | namespace/related/domain_recall валидация + нормализация | Modify |
| `memory/config.test.js` | тесты валидации/нормализации | Modify |
| `memory/project.js` | `resolveProjectKey` (namespace-only), `legacyKey` (URL/hash для migrate), `subtreeLeg`-семантика в `resolveSearchKeys` | Modify |
| `memory/project.test.js` | тесты резолверов | Modify |
| `memory/storage/{sqlite,pgvector,qdrant}.js` | поля `origin_remote`+`prefixes`, subtree-ноги, `migrateKey`, sqlite `meta.key`+кэш | Modify |
| `memory/storage.test.js` (+pgvector/qdrant) | тесты бэкендов | Modify |
| `memory/indexer.js` | штампы `origin_remote`+`prefixes` | Modify |
| `memory/indexer.test.js` | тесты штампов | Modify |
| `memory/index.js` | init: namespace_missing/key_changed/namespace_shared; домен+related-ноги; `project:`; tool `memory_migrate`; prune origin-guard | Modify |
| `memory/index.test.js` | тесты index/tools | Modify |
| `memory/state.js` | per-project lastKey + per-key seen-set (атомарно) | Modify |
| `memory/state.test.js` | тесты persist | Modify |
| `memory/recall.js` | мульти-ноги + merged-фильтр + preview-паритет + заголовок | Modify |
| `memory/recall.test.js` | тесты recall | Modify |
| `skills/maestro/SKILL.md`, `skills/maestro-setup/SKILL.md`, `skills/maestro-assistant/SKILL.md`, `commands/maestro-memory.md` | скиллы/команда | Modify |
| `manual_docs/...`, `AGENTS.md`, `README.md`, `SECURITY.md`, `docs/project-context.md`, `regression/entries/2026-09-10-memory-namespace-related.md` | доки + entry | Modify/Create |

---

### Task 1: Config — namespace обязателен + формат + related + domain_recall

**Files:**
- Modify: `plugins/maestro-bootstrap/memory/config.js`
- Test: `plugins/maestro-bootstrap/memory/config.test.js`

- [ ] **Step 1: Failing tests**

В `config.test.js` (по образцу существующих валидаций) добавить:
```js
test("namespace_missing disables when enabled without namespace", () => {
  assert.equal(classifyMemoryConfig({ memory: { enabled: true } }).disabled_reason, "namespace_missing");
});
test("namespace valid format passes", () => {
  assert.equal(classifyMemoryConfig({ memory: { enabled: true, namespace: "microservices.sales.pay" } }).enabled, true);
});
test("namespace normalized before validation (MyApp → myapp)", () => {
  const cfg = loadMemoryConfig({ memory: { enabled: true, namespace: "MyApp" } });
  assert.equal(cfg.namespace, "myapp");
});
test("namespace invalid format disables", () => {
  const bad = ["-foo", "foo-", "Foo", "a..b", "a.b.c.d", "a".repeat(33), "a.b."];
  for (const n of bad) {
    assert.equal(classifyMemoryConfig({ memory: { enabled: true, namespace: n } }).disabled_reason, "namespace_invalid", `namespace ${n}`);
  }
});
test("related invalid disables; valid passes; own dedup", () => {
  assert.equal(classifyMemoryConfig({ memory: { enabled: true, namespace: "x", related: ["bad!name"] } }).disabled_reason, "related_invalid");
  assert.equal(classifyMemoryConfig({ memory: { enabled: true, namespace: "x", related: ["a.b", "a.b", "MyApp"] } }).enabled, true);
});
test("domain_recall default true; false passes; invalid disables", () => {
  assert.equal(classifyMemoryConfig({ memory: { enabled: true, namespace: "x" } }).enabled, true);
  assert.equal(classifyMemoryConfig({ memory: { enabled: true, namespace: "x", domain_recall: false } }).enabled, true);
  assert.equal(classifyMemoryConfig({ memory: { enabled: true, namespace: "x", domain_recall: "yes" } }).disabled_reason, "domain_recall_invalid");
});
test("disabled_reason priority: namespace_missing > namespace_invalid > related_invalid", () => {
  assert.equal(classifyMemoryConfig({ memory: { enabled: true, namespace: "Bad!", related: ["bad!"] } }).disabled_reason, "namespace_invalid");
  assert.equal(classifyMemoryConfig({ memory: { enabled: true, namespace: "x", related: ["bad!"] } }).disabled_reason, "related_invalid");
});
```

- [ ] **Step 2: Run to verify fail**

Run: `node --test plugins/maestro-bootstrap/memory/config.test.js`
Expected: FAIL — новые причины отсутствуют.

- [ ] **Step 3: Implement**

В `config.js`:
- `DEFAULTS`: добавить `related: null`, `domain_recall: true`.
- Хелпер нормализации/валидации namespace:
```js
const NAMESPACE_RE = /^[a-z0-9]([a-z0-9-]{0,30}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,30}[a-z0-9])?){0,2}$/;
export function normalizeNamespace(ns) {
  if (typeof ns !== "string") return null;
  return ns.trim().toLowerCase();
}
export function namespaceValid(ns) {
  const n = normalizeNamespace(ns);
  return typeof n === "string" && n.length > 0 && n.length <= 100 && NAMESPACE_RE.test(n);
}
function namespaceMissing(m) { return !m?.namespace; }
function namespaceInvalid(m) { return m?.namespace != null && !namespaceValid(m.namespace); }
function relatedValid(m) {
  const r = m?.related;
  if (r == null) return true;
  return Array.isArray(r) && r.length <= 16 && r.every((x) => namespaceValid(x));
}
function domainRecallValid(m) {
  if (m?.domain_recall == null) return true;
  return typeof m.domain_recall === "boolean";
}
```
- В `classifyMemoryConfig` (приоритет: namespace_missing > namespace_invalid > related_invalid > domain_recall_invalid, до остальных существующих чеков):
```js
  if (namespaceMissing(m)) return { enabled: false, disabled_reason: "namespace_missing" };
  if (namespaceInvalid(m)) return { enabled: false, disabled_reason: "namespace_invalid" };
  if (!relatedValid(m)) return { enabled: false, disabled_reason: "related_invalid" };
  if (!domainRecallValid(m)) return { enabled: false, disabled_reason: "domain_recall_invalid" };
```
- В `mergedConfig`: нормализовать namespace и related-записи:
```js
  return {
    ...DEFAULTS, ...m,
    namespace: m?.namespace != null ? normalizeNamespace(m.namespace) : null,
    related: m?.related != null ? m.related.map((x) => normalizeNamespace(x)) : null,
    ...
  };
```
- В `resolveEffectiveKey` (config.js): убрать hash/path-дефолт — ключ = namespace (при обязательности namespace вызывается только с ним; при отсутствии вернуть namespace как есть — fallback не нужен):
```js
export function resolveEffectiveKey({ projectHash, namespace }) {
  return namespace ?? projectHash; // namespace обязателен (validate раньше); fallback не используется
}
```
(сохранить сигнатуру для обратной совместимости вызовов, но поведение гарантируется валидацией).

- [ ] **Step 4: Run tests**

Run: `node --test plugins/maestro-bootstrap/memory/config.test.js`
Expected: PASS (новые + существующие).

- [ ] **Step 5: Commit**

```bash
git add plugins/maestro-bootstrap/memory/config.js plugins/maestro-bootstrap/memory/config.test.js
git commit -m "feat(memory): mandatory validated namespace (format+normalize), related, domain_recall"
```

---

### Task 2: project.js — namespace-only резолверы + subtreeLeg-семантика

**Files:**
- Modify: `plugins/maestro-bootstrap/memory/project.js`
- Test: `plugins/maestro-bootstrap/memory/project.test.js`

- [ ] **Step 1: Failing tests**

В `project.test.js` (создать/дополнить):
```js
test("resolveProjectKey validates namespace (no URL/hash forms)", () => {
  assert.equal(resolveProjectKey("microservices.sales.pay"), "microservices.sales.pay");
  assert.throws(() => resolveProjectKey("git@github.com:org/api.git"), /namespace/);
  assert.throws(() => resolveProjectKey("8f3a2e91"), /namespace/);
});
test("legacyKey resolves URL and hash for migrate only", () => {
  assert.equal(legacyKey("git@github.com:org/api.git"), projectHashFromRemote("git@github.com:org/api.git"));
  assert.equal(legacyKey("8f3a2e91"), "8f3a2e91");
  assert.equal(legacyKey("microservices.sales"), "microservices.sales"); // namespace passthrough
});
test("resolveSearchKeys: own key + related legs, own excluded, dedup", () => {
  const keys = resolveSearchKeys({ key: "a.b.c", related: ["a.b", "a.b.c", "MyApp"] });
  // related нормализуется: "a.b", "a.b.c"(=own → excluded), "myapp"
  assert.deepEqual(keys, ["a.b.c", "a.b", "myapp"]);
});
test("subtreeSearchKeys: target prefix → own + subtree legs merged-only set", () => {
  // subtreeLeg не отдельная функция; семантика в search-бэкендах. Здесь проверяем
  // контракт: keys с префиксом, own исключён.
});
```
(Адаптировать под фактические экспорты project.js: `resolveProjectKey`, `legacyKey` (новый), `resolveSearchKeys`.)

- [ ] **Step 2: Run to verify fail**

Run: `node --test plugins/maestro-bootstrap/memory/project.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement**

В `project.js`:
- `resolveProjectKey(project)` — только namespace (валидация через `namespaceValid`, бросок с понятным сообщением для невалидного):
```js
import { namespaceValid } from "./config.js";
export function resolveProjectKey(project) {
  const s = String(project ?? "").trim().toLowerCase();
  if (!namespaceValid(s)) throw new Error(`project: невалидный namespace "${project}"`);
  return s;
}
```
- `legacyKey(v)` — для migrate: URL → hash remote; 64-hex → as-is; иначе namespace passthrough:
```js
export function legacyKey(v) {
  const s = String(v).trim();
  if (s.includes("://") || s.startsWith("git@")) return projectHashFromRemote(s);
  if (/^[0-9a-f]{64}$/i.test(s)) return s;
  return s; // namespace
}
```
- `resolveSearchKeys({ key, project, related })` — namespace-only, own исключён, dedup, нормализация:
```js
export function resolveSearchKeys({ key, project, related }) {
  const keys = [key];
  for (const r of related ?? []) {
    const rr = resolveProjectKey(r);
    if (rr !== key) keys.push(rr);
  }
  if (project !== undefined && project !== null && project !== "") {
    const p = resolveProjectKey(project);
    if (p !== key) keys.push(p);
  }
  return [...new Set(keys.filter(Boolean))];
}
```
(Примечание: subtreeLeg-семантика реализуется в бэкендах через ключи префикса; `resolveSearchKeys` отдаёт точные related/own — префикс-расширение в storage, см. Task 3. Импорт `namespaceValid` из config.js — без циклической зависимости.)

- [ ] **Step 4: Run tests**

Run: `node --test plugins/maestro-bootstrap/memory/project.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plugins/maestro-bootstrap/memory/project.js plugins/maestro-bootstrap/memory/project.test.js
git commit -m "feat(memory): namespace-only resolveProjectKey, legacyKey for migrate, search keys with related dedup"
```

---

### Task 3: Storage — origin_remote + prefixes поля, subtree-ноги, migrateKey

**Files:**
- Modify: `plugins/maestro-bootstrap/memory/storage/{sqlite,pgvector,qdrant}.js`
- Test: `plugins/maestro-bootstrap/memory/storage.test.js` (+ pgvector/qdrant test files)

- [ ] **Step 1: Failing tests** (по образцу host round-trip тестов из v5)

Для sqlite:
```js
test("origin_remote + prefixes round-trip", async () => {
  // create storage, init, upsert entry с origin_remote + prefixes, get → assert
});
test("subtree leg via meta.key enumeration: sibling bucket prefix", async () => {
  // создать два бакета (a.b.c и a.b.d) с meta.key, search с subtree prefix "a.b"
  // → sibling-хиты (merged=1) включены, unmerged нет
});
test("migrateKey max-version-wins", async () => {
  // целевой бакет имеет запись session_id v=5; источник v=2 → после migrate version остаётся 5
});
```
Для pgvector/qdrant: аналогичные тесты на mocked-клиентах (поля origin_remote/prefixes в payload/строках, subtree-фильтр, migrateKey).

- [ ] **Step 2: Run to verify fail**

Run: `node --test plugins/maestro-bootstrap/memory/storage.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement**

**sqlite.js:**
- SCAN_FIELDS: добавить `origin_remote`, `prefixes`.
- `_init`: `CREATE TABLE` + guard-ALTER для `origin_remote TEXT NOT NULL DEFAULT ''`, `prefixes TEXT NOT NULL DEFAULT ''` (JSON-массив); запись `meta.key = <effectiveKey>` при init (INSERT OR REPLACE).
- `_upsert`: колонки/`@`/`ins.run` для `origin_remote` (`e.origin_remote ?? ""`) и `prefixes` (`JSON.stringify(e.prefixes ?? [])`).
- `_get`/`scan`: маппинг `prefixes` из JSON (`try parse → []`).
- Subtree-нога в `_search`: новый параметр `subtree` (массив префиксов-целей) + `related`. Для каждой цели: перебор соседних БД по `meta.key` (кэш `this._siblingKeys` с инвалидацией — re-enumerate при промахе ноги), фильтр `meta.key === T` или `LIKE 'T.%'`, merged=1. Активная нога — own key (без mergedOnly), sibling — mergedOnly (существующая механика `_collectKey`).
- `migrateKey(fromKey, toKey, { deleteSource })`: открыть соседнюю БД `<hash(fromKey)>/memory.db` read-only; model_id/dim проверка (мета); для каждой записи — `existing = get(toKey, session_id)`; `if (!existing || source.version > existing.version) upsert в активную (переписав `key`=toKey, `prefixes` пересчитав); else skip`; при `deleteSource` — удалить файл + `-wal`/`-shm`.

**pgvector.js:**
- Таблица: `origin_remote TEXT NOT NULL DEFAULT ''`, `prefixes TEXT NOT NULL DEFAULT ''` + `ADD COLUMN IF NOT EXISTS`.
- INSERT/ON CONFLICT + SELECT-списки: добавить поля; маппинг `prefixes` (JSON строку → array).
- Subtree-нога в `_search`: для целей `T` — `(key = $1 OR key LIKE $1 || '.%')` + merged=1 (sibling). Активная — как есть.
- `migrateKey`: `UPDATE ... SET key=$to, prefixes=$newPrefixes, origin_remote=origin_remote WHERE key=$from AND (не-version-конфликт)` — max-version-wins через подзапрос/`NOT EXISTS (SELECT 1 FROM t WHERE session_id=t.session_id AND version >= t.version)`.

**qdrant.js:**
- Upsert payload: `origin_remote`, `prefixes` (массив). Создание keyword-индекса для `prefixes` — идемпотентно (try/catch или check-existing).
- get/scan/search маппинг полей.
- Subtree-нога: фильтр `key = T OR prefixes: match any [T]` + merged=1.
- `migrateKey`: scroll по `key=from`; для каждой точки — существующая точка по `uuidFrom(session_id)` в целевой ноге... фактически целиком в одной коллекции: прочитать существующую точку (по `uuidFrom(session_id)`) → `if (!existing || from.version > existing.version) setPayload {key: to, prefixes: recalc}`; при `deleteSource` — собрать ids ДО setPayload, удалить по ids после.

- [ ] **Step 4: Run tests**

Run: `node --test plugins/maestro-bootstrap/memory/storage.test.js` (+ pgvector/qdrant suite)
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plugins/maestro-bootstrap/memory/storage/
git commit -m "feat(memory): origin_remote+prefixes fields, subtree legs, migrateKey (max-version-wins)"
```

---

### Task 4: Indexer — штампы origin_remote + prefixes

**Files:**
- Modify: `plugins/maestro-bootstrap/memory/indexer.js`
- Test: `plugins/maestro-bootstrap/memory/indexer.test.js`

- [ ] **Step 1: Failing tests**

```js
test("entry carries origin_remote and prefixes", async () => {
  // mkIndexer с git.resolveHead/... ; run; entry = storage.get
  assert.equal(entry.origin_remote, "github.com/org/api");
  assert.deepEqual(entry.prefixes, ["microservices", "microservices.sales"]);
});
test("single-segment namespace → prefixes empty", async () => { /* assert [] */ });
```
(Хелперы: `resolveHead` → 40-hex; namespace в конфиге; canonical remote из `gitCfg.remote` через переданный резолвер.)

- [ ] **Step 2: Run to verify fail** → `node --test plugins/maestro-bootstrap/memory/indexer.test.js` (FAIL).

- [ ] **Step 3: Implement**

В `indexer.js`:
- В entry (рядом с `host`): `origin_remote: this.originRemote ?? ""`, `prefixes: prefixesOf(this.key)`.
- В constructor: принять `originRemote`, `key` (namespace). `prefixesOf(key)`:
```js
function prefixesOf(key) {
  const seg = String(key).split(".");
  const out = [];
  for (let i = 1; i < seg.length; i++) out.push(seg.slice(0, i).join("."));
  return out;
}
```
(`microservices.sales.pay` → `["microservices","microservices.sales"]`; single-segment → `[]`.)

- [ ] **Step 4: Run tests** → PASS.

- [ ] **Step 5: Commit**

```bash
git add plugins/maestro-bootstrap/memory/indexer.js plugins/maestro-bootstrap/memory/indexer.test.js
git commit -m "feat(memory): stamp origin_remote + prefixes on index"
```

---

### Task 5: state.js — per-project lastKey + per-key seen-set (атомарно)

**Files:**
- Modify: `plugins/maestro-bootstrap/memory/state.js`
- Test: `plugins/maestro-bootstrap/memory/state.test.js`

- [ ] **Step 1: Failing tests**

```js
test("per-project lastKey: independent of key (N1)", async () => {
  const s = createProjectState(dir + "/project.json"); // последний ключ проекта
  await s.setLastKey("a.b");
  assert.equal(await s.getLastKey(), "a.b");
  // ключ сменился → файл тот же → lastKey виден
  const s2 = createProjectState(dir + "/project.json");
  assert.equal(await s2.getLastKey(), "a.b");
});
test("per-key seen-set round-trip", async () => {
  const s = createKeyState(dir + "/key.json");
  await s.addSeenOrigin("h1");
  await s.addSeenOrigin("h2");
  assert.deepEqual(await s.getSeenOrigins(), ["h1", "h2"]);
});
test("atomic write: tmp+rename (не полузаписанный файл)", async () => {
  // запись переживает создание; файл корректный JSON
});
```
(Адаптировать имена под фактические экспорты state.js — либо новые фабрики `createProjectState`/`createKeyState` с атомарным persist.)

- [ ] **Step 2: Run to verify fail** → FAIL.

- [ ] **Step 3: Implement**

В `state.js`: добавить атомарную запись (tmp+rename) и два набора методов:
- `createProjectState(path)` → `getLastKey()/setLastKey(k)` (персист `{lastKey}`), атомарно.
- `createKeyState(path)` → `getSeenOrigins()/addSeenOrigin(h)/setSeenOrigins(list)`, атомарно.
Атомарность:
```js
function persistAtomic(path, data) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(data), "utf8");
  renameSync(tmp, path);
}
```
(Импорты `renameSync` из node:fs. Существующий `createState` не трогаем — его persist остаётся как есть для indexer-состояния.)

- [ ] **Step 4: Run tests** → PASS.

- [ ] **Step 5: Commit**

```bash
git add plugins/maestro-bootstrap/memory/state.js plugins/maestro-bootstrap/memory/state.test.js
git commit -m "feat(memory): per-project lastKey + per-key seen-set with atomic writes"
```

---

### Task 6: index.js — init-warns, домен+related-ноги, memory_migrate, prune guard

**Files:**
- Modify: `plugins/maestro-bootstrap/memory/index.js`
- Test: `plugins/maestro-bootstrap/memory/index.test.js`

- [ ] **Step 1: Failing tests**

```js
test("init logError namespace_missing when enabled without namespace", async () => {
  // registerMemoryHooks с maestro.json {memory:{enabled:true}} → logError "memory:namespace_missing"
});
test("init warn key_changed when lastKey differs (per-project)", async () => {
  // state per-project file с lastKey="a.b"; конфиг namespace="a.c" → warn "memory:key_changed"
});
test("init warn namespace_shared on new foreign origin (warn-once)", async () => {
  // бакет содержит записи с origin h1 (seen) и h2 (новый) → warn; повторный init с теми же → info
});
test("memory_search project: namespace-prefix subtree legs", async () => {
  // search с project:"a.b" → subtree legs; URL/hash → ошибка
});
test("memory_migrate from:auto migrates legacy hash bucket", async () => {
  // from:auto → legacyKey(canonical remote) → migrateKey; результат + memory:migrated
});
test("memory_migrate from:namespace validates format", async () => {
  // from:"Bad!" → сообщение «невалидный namespace»
});
test("memory_prune marks and excludes foreign-origin from batch", async () => {
  // записи с origin ≠ own → «чужой проект», не в batch-all
});
```
(По образцу существующих init-warn/tool-тестов в index.test.js; хелперы registerMemoryHooks с XDG tmpdir.)

- [ ] **Step 2: Run to verify fail** → FAIL.

- [ ] **Step 3: Implement**

В `index.js` (registerMemoryHooks):
- **Init**: при `!config.namespace` → `logError("memory:namespace_missing", {})` (после disabled-ветки). Per-project state: `const projState = createProjectState(join(memoryDataDir, sanitizeDirName(projectKey.hash), "state.json"))` — wait: per-project файл = `<memoryDataDir>/<hash(absPath)>/state.json`. `projectKey.hash` = hash(remote|absPath) — тот же источник, что absPath-hash для fallback. Для remote-проектов hash(absPath) недоступен как «project-стабильный»... По спеке: per-project = `<hash(absPath)>`. Реализация: `sanitizeDirName(absPath)` (hash от absPath) как имя каталога. При init: `lastKey = await projState.getLastKey()`; `if (lastKey && lastKey !== config.namespace) logWarn("memory:key_changed", {})`; `await projState.setLastKey(config.namespace)`.
- **seen-set**: per-key state `<memoryDataDir>/<hash(key)>/state.json`; при init: `scan({key, fields:["origin_project_hash"]})` → distinct; `seen = await keyState.getSeenOrigins()`; `newOnes = distinct.filter(h => !seen.includes(h))`; `if (newOnes.length) logWarn("memory:namespace_shared", {count: distinct.length}) else logInfo(...)`; `await keyState.setSeenOrigins(distinct)`.
- **Домен/related-ноги**: вычислить `domainTarget` (последний префикс namespace) и `relatedKeys = config.related.map(resolveProjectKey)` (dedup, минус own). Передать в `Recall` (constructor `{relatedKeys, domainTarget, domainRecall}`).
- **memory_search**: `searchOpts.subtree = [...(domain_recall ? [domainTarget] : []), ...relatedKeys]` (вместо project-only); `project:` param → `searchOpts.subtree.push(resolveProjectKey(project))` (namespace-only; URL/hash → сообщение «только namespace»).
- **tool `memory_migrate`** (permission ask, после memory_prune):
```js
memory_migrate: tool({
  description: "Перенос записей памяти из бакета-источника в текущий (пере-keying namespace). permission: ask.",
  args: {
    from: tool.schema.string().describe("auto | namespace | hash"),
    delete_source: tool.schema.boolean().optional().describe("удалить источник после переноса (default false)"),
  },
  execute: async (args, ctx) => {
    try {
      if (SESSIONS.has(ctx?.sessionID)) return "memory_migrate недоступен для служебных сессий.";
      if (!args?.from) return "memory_migrate: укажите from (auto | namespace | hash)";
      let fromKey;
      if (args.from === "auto") {
        fromKey = legacyKey(gitCfg.remote ?? ""); // remote отсутствует → слепая зона → подсказка
        if (!gitCfg.remote) return "memory_migrate: репо без remote — укажите from:<hash> или from:<namespace>";
      } else {
        try { fromKey = legacyKey(args.from); } catch { return "memory_migrate: невалидный from"; }
      }
      if (fromKey === config.namespace) return "memory_migrate: from совпадает с текущим ключом (no-op).";
      const n = await storage.migrateKey(fromKey, config.namespace, { deleteSource: args.delete_source === true });
      logInfo("memory:migrated", { count: n });
      return `Перенесено ${n} записей из ${fromKey}.${args.delete_source ? " Источник удалён." : ""}`;
    } catch (err) { return `memory_migrate failed: ${err instanceof Error ? err.message : String(err)}`; }
  },
}),
```
- **memory_prune guard (I4)**: scan-fields добавить `origin_project_hash`; в list — пометка `⚠️ чужой проект` при `origin_project_hash !== ownProjectHash`; при category/все — исключать чужие (как foreign-host); по явным `session_ids` — разрешено.

- [ ] **Step 4: Run tests** → PASS.

- [ ] **Step 5: Commit**

```bash
git add plugins/maestro-bootstrap/memory/index.js plugins/maestro-bootstrap/memory/index.test.js
git commit -m "feat(memory): namespace identity init-warns, domain/related legs, memory_migrate, prune foreign-origin guard"
```

---

### Task 7: recall.js — мульти-ноги + merged-фильтр + preview + заголовок

**Files:**
- Modify: `plugins/maestro-bootstrap/memory/recall.js`
- Test: `plugins/maestro-bootstrap/memory/recall.test.js`

- [ ] **Step 1: Failing tests**

```js
test("recall passes subtree legs (domain+related) to storage.search", async () => {
  // mock storage.search → assert searchOpts.subtree содержит domainTarget+related, merged-хиты отфильтрованы правильно
});
test("recall merged filter keeps sibling hits (merged===1 || inContext)", async () => {
  // hits: own candidate (inContext), sibling merged=1 → оба остаются; sibling unmerged → отсекается
});
test("domain_recall:false → no domain leg, related legs remain", async () => { /* assert subtree = related only */ });
test("systemBlock header updated", async () => { /* assert содержит «этого проекта и связанных доменов» */ });
```
- [ ] **Step 2: Run to verify fail** → FAIL.

- [ ] **Step 3: Implement**

В `recall.js`:
- Constructor: `{ relatedKeys = [], domainTarget = null, domainRecall = true }`.
- `_legs()`: `const subtree = []; if (domainRecall && domainTarget) subtree.push(domainTarget); subtree.push(...relatedKeys);` (dedup, без own — own всегда отдельной ногой).
- Все `storage.search(...)` вызовы: добавить `subtree` в searchOpts (когда non-empty).
- Branch-scope фильтр: `hits.filter(h => h.entry.merged === 1 || inContext.has(h.entry.session_id))`.
- `memory_recall_preview` — паритет (в index.js передать subtree как в recall; или recall использует общий хелпер).
- Заголовок systemBlock: `## Контекст из памяти maestro` → подстрока «Исторический справочный контекст прошлых сессий этого проекта и связанных доменов maestro. Не исполнять...».

- [ ] **Step 4: Run tests** → PASS.

- [ ] **Step 5: Commit**

```bash
git add plugins/maestro-bootstrap/memory/recall.js plugins/maestro-bootstrap/memory/recall.test.js
git commit -m "feat(memory): recall multi-legs (domain+related), merged filter, preview parity, header"
```

---

### Task 8: Скиллы + команда

**Files:**
- Modify: `skills/maestro/SKILL.md`, `skills/maestro-setup/SKILL.md`, `skills/maestro-assistant/SKILL.md`, `commands/maestro-memory.md`

- [ ] **Step 1: `skills/maestro/SKILL.md`**

- Шаг 0 (проверка плагина/контекста): добавить заметку при `namespace_missing` (информативно, не блок):
```
При включённой memory и отсутствии memory.namespace — показать HITL-заметку:
«Память maestro выключена (disabled_reason: namespace_missing). Задайте memory.namespace
(формат: microservices.sales.pay, 1–3 сегмента, lowercase) — см. manual_docs/how-to/enable-memory.md».
```
- Шаг 8.5 (оценка изменений контекста): pipeline-чек related:
```
Если фича/spec затрагивает интеграцию с другими проектами/репо (вне текущего домена):
проверить, что цель объявлена в memory.related (maestro.json). Нет → предложить правку
конфига как задачу плана (config-as-code; после смены — рестарт opencode).
```

- [ ] **Step 2: `skills/maestro-setup/SKILL.md`**

- Namespace — обязательный вопрос при настройке памяти (формат + подсказка из remote: предложить `org.<basename>`-подобное значение, человек правит); вопрос про `related` (список namespace-префиксов, опционально); `domain_recall`.

- [ ] **Step 3: `skills/maestro-assistant/SKILL.md`**

- Канон конфиг-ключей: `namespace` (обязателен, формат, нормализация), `related` (префикс-семантика, merged-only, кросс-домен, 1:1 предпочтение), `domain_recall` (off-switch), `memory_migrate` (from: auto|namespace|hash, ask), config-as-code + рестарт после смены.

- [ ] **Step 4: `commands/maestro-memory.md`**

- Секция «Ключ»: namespace, домен, related-цели, проекты в бакете (по `origin_remote`), диагностика коллизий. При `namespace_missing` — подсказка задать namespace.

- [ ] **Step 5: Commit**

```bash
git add skills/ commands/maestro-memory.md
git commit -m "feat(skills): namespace identity — maestro-init note, setup question, assistant canon, @maestro-memory Key section"
```

---

### Task 9: Доки + regression entry

**Files:** (Modify/Create; см. spec §6)

- [ ] **Step 1: `manual_docs/reference/memory.md`**

- §«Изоляция»: обязательный namespace (формат, нормализация, `namespace_missing`/`namespace_invalid`); домены (иерархия, авто-related merged-only); `related` (кросс-домен, 1:1 предпочтение, subtree opt-in); `memory_migrate` (from:auto|namespace|hash, max-version-wins, delete_source); коллизии (детекция, warn-on-new); адресация namespace-only; поля `origin_remote`/`prefixes`.
- Сцена: API (`microservices.sales.orders`) + frontend (`microservices.sales.web`) + сервис (`microservices.checkout.notifications`, `related: ["microservices.sales.orders"]`).

- [ ] **Step 2: `manual_docs/reference/config.md`**

- Ключи `namespace` (обязателен, формат, нормализация), `related` (массив namespace-префиксов, ≤16), `domain_recall` (boolean, default true). Причины `namespace_missing`/`namespace_invalid`/`related_invalid`/`domain_recall_invalid` + приоритет.

- [ ] **Step 3: `manual_docs/how-to/enable-memory.md`**

- Namespace обязателен (примеры); upgrading: задать namespace → `memory_migrate from:auto`.

- [ ] **Step 4: `manual_docs/overview/changelog.md`** — дополнение записи `[2026-09-10]`:

```
- **Memory layer — namespace-идентичность (v5.1), без обратной совместимости.**
  1. `memory.namespace` обязателен (формат `microservices.sales.pay`, 1–3 сегмента,
     lowercase; нормализация trim+lowercase). Без него память disabled
     (`namespace_missing`); восстановление — задать namespace + `memory_migrate from:auto`.
  2. Убраны URL/hash-формы адресации (`related`/`project:` — namespace-префиксы).
  3. Домен-авто-related (иерархия: родитель + братья, merged-only; `domain_recall` off-switch).
  4. `related` — кросс-доменные связи (merged-only, 1:1 предпочтение).
  5. `memory_migrate` — пере-keying (from: auto|namespace|hash).
  6. Поля записей `origin_remote`/`prefixes`.
```

- [ ] **Step 5: `manual_docs/explanation/agents-and-trust.md`**

- Экспозиция читаемых ключей/`origin_remote` на centralized (git-метаданные, SECURITY §5a); trust-модель домен-ног (writer-side маскирование, конвенционная граница, off-switch).

- [ ] **Step 6: `AGENTS.md`, `plugins/maestro-bootstrap/README.md`, `SECURITY.md`, `docs/project-context.md`**

- Синхронизация описаний (namespace-идентичность, related, migrate, домены; пути удаления + `memory_migrate` в SECURITY.md).

- [ ] **Step 7: Regression entry** — `regression/entries/2026-09-10-memory-namespace-related.md` (пер-фича, по образцу):

```markdown
---
version: 1
feature: memory-namespace-related
added: 2026-09-10
status: active
risk: high
scenarios:
  - path: plugins/maestro-bootstrap/memory/config.js
    run: node --test plugins/maestro-bootstrap/memory/config.test.js
    workdir: .
  - path: plugins/maestro-bootstrap/memory/index.js
    run: node --test plugins/maestro-bootstrap/memory/index.test.js
    workdir: .
---

# Регрессия: memory-namespace-related

Breaking: обязательный namespace (без него — disabled `namespace_missing`).
## Manual-сценарии
- enabled без namespace → disabled + logError + /maestro-init заметка.
- `MyApp` → ключ `myapp` (нормализация).
- Домен: сервис в microservices.sales.* видит merged-знания братьев; `domain_recall:false` — нет.
- `related: ["microservices.sales.orders"]` — merged-only из API; `related: ["microservices.sales"]` — поддерево.
- `memory_migrate from:auto` переносит легаси hash-бакет; max-version-wins; `from:auto` без remote → подсказка.
- prune: чужой проект (по origin_project_hash) помечен + исключён из batch.
- Коллизия: новый чужой origin → warn-once; стабильный → info.
```

- [ ] **Step 8: Verify**

```bash
rg -ln "namespace|related|memory_migrate|domain_recall" manual_docs/ skills/ SECURITY.md AGENTS.md commands/
```
Expected: перечисленные файлы.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "docs(memory): namespace identity v5.1 — memory/config/enable-memory/changelog/agents-and-trust/AGENTS/README/SECURITY/context + regression entry"
```

---

### Task 10: Полная верификация

- [ ] **Step 1:** `node --test plugins/maestro-bootstrap/index.test.js` → PASS.
- [ ] **Step 2:** `npm run test:memory` → PASS (2 skipped — внешние депы).
- [ ] **Step 3:** rg-чек ключей/событий в доках vs код (namespace_missing, namespace_shared, key_changed, memory:migrated, related_invalid, domain_recall_invalid).
- [ ] **Step 4:** `git status` чист.
- [ ] **Step 5:** Коммитов не требуется (верификация без изменений).

---

## Self-Review (соответствие спеку §3–§9)

- §3.1 (namespace обязателен, demotion remote) → Task 1, 4, 6.
- §3.2 (формат/нормализация/приоритет) → Task 1, 9.
- §3.3 (prefixes, домен-авто, subtreeLeg ×3 бэкенда, инвариант hash) → Task 3, 4, 7.
- §3.4 (related, 1:1, дедуп, no transitive, domain_recall:false opt-in) → Task 2, 6, 7, 9.
- §3.5 (коллизии warn-on-new, persist, асимметрия, ложные срабатывания) → Task 5, 6, 9.
- §3.6 (migrate: from:auto/namespace/hash, max-version-wins, delete_source, слепые зоны, persist lastKey per-project N1, key_changed) → Task 3, 5, 6, 9.
- §3.7 (адресация namespace-only, normalize+validate project:) → Task 2, 6.
- §3.8 (top_k мониторинг, origin) → Task 7 (ноги), аудит-лог без изменений.
- §3.9 (breaking, поля origin_remote/prefixes, prune guard I4) → Task 3, 6, 9.
- §4 (конфиг) → Task 1, 9.
- §5 (по файлам) → Tasks 1-8.
- §6 (доки + версия) → Task 9.
- §7 (безопасность: ask-пути, trust-модель домен-ног, экспозиция) → Task 6 (migrate ask), 8, 9.
- §8 (риски) → Task 10.
- §9 (DoD: namespace_missing/invalid, ноги, коллизии, migrate, key_changed, prune-guard, preview, domain_recall:false, related_invalid, отдельный entry) → Tasks 1, 3, 5, 6, 7, 9, 10.
- Spec-follow-ups: M-A (from:<namespace> normalize+validate — Task 6), M-B (внутридоменный related = конвенция, формат-only — Task 8/9), M-C (позитивный кейс related-нормализации — Task 1/9).

**Пробелов не выявлено.**