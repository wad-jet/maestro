# Memory Layer v3 — Branch-aware Memory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Привязать контекст памяти к git-истории: идентичность записи — по коммиту (`head`); recall по умолчанию commit-scoped (general = в mainline, experience = неслитая линия checkout'а); промоция в general по `is-ancestor(head, mainline)`; `centralized_confidential` удалён.

**Architecture:** Новый git-хелпер `memory/git.js` (все git-команды, дедуп-хелпер, fail-soft). Членство записи (общая таблица): `merged=1` → general; `head ∈ rev-list mainline` → general (окно pull→init); `head ∈ expSet` (rev-list HEAD \ mainline) → experience «⚠️ не в main»; иначе не в контексте. Промоция на init: per-unique-head `git merge-base --is-ancestor(head, mainline)`, key-scoped, fail-soft, heal-путь. Mainline-детект: конфиг → remote HEAD → init.defaultBranch → резерв, с verify-гейтами; `mainline_unresolved` → flat + warn. Без legacy-тира и без `centralized_confidential` (память не публиковалась — no-backward-compat).

**Tech Stack:** Node ESM, better-sqlite3, @qdrant/js-client-rest, pg, node:test.

**Spec:** `docs/superpowers/specs/2026-09-07-maestro-memory-v3-design.md`

## Global Constraints

- Идентичность записи — по `head` (коммит), НЕ по имени ветки; `branch` — display/stats только (§2/§3).
- Членство/промоция — по предикату достижимости (одна семантика для recall и промоции): `is-ancestor` ≡ членство в `rev-list` (§5/§6.1).
- Промоция строго key-scoped: `key = :effectiveKey AND merged = 0 AND head != '' AND is-ancestor(head, mainline)` (§5).
- `merged` монотонен (0→1, никогда не сбрасывается; re-summarize сохраняет) — конвергенция мульти-клон (§4/§5).
- `memory.branch_context` default `true`; `memory.mainline` default `null` (авто-детект); валидация в zero-dep гейте (§8).
- **`centralized_confidential` УДАЛЁН** — удалить из config.js (DEFAULTS/mergedConfig/classifyMemoryConfig), index.js (I5 failover), тестов, доков (§9/§10). `storage.type` = единственное решение локально/удалённо.
- No-backward-compat: схема меняется свободно; для существующих in-repo dev-БД — идемпотентный ALTER (dev-гигиена §3), не миграция.
- Жёсткий инвариант: raw-confidential + секреты не в памяти (маскирование до записи); unmasked git-метаданные — исключение с warn `unmasked_branch_metadata` (centralized + confidential.paths) (§9).
- Запуск тестов: `npm run test:memory`, `npm test`. Baseline 248 memory + 174 core.

---

## File Structure

- Create: `plugins/maestro-bootstrap/memory/git.js` (+ `git.test.js`) — git-хелпер (branch/head, mainline-детект, rev-list, is-ancestor, verify, fail-soft).
- Modify: `plugins/maestro-bootstrap/memory/config.js` (+ config.test.js) — `branch_context`/`mainline` + удаление `centralized_confidential`.
- Modify: `plugins/maestro-bootstrap/memory/storage/sqlite.js`, `pgvector.js`, `qdrant.js` (+ тесты) — поля branch/head/merged, кандидат-запрос.
- Modify: `plugins/maestro-bootstrap/memory/indexer.js` (+ test) — резолв branch/head на записи (sticky), merged fast-path.
- Modify: `plugins/maestro-bootstrap/memory/index.js` (+ test) — удаление I5-failover; mainline-детект + промоция на init; recall scope; инструменты.
- Modify: `plugins/maestro-bootstrap/memory/storage.js` (+ test) — createStorage контракт (новые поля, кандидат-запрос).
- Modify: `plugins/maestro-bootstrap/memory/recall.js` (+ test) — auto-recall scope.
- Docs (cross-cutting §10): `SECURITY.md`, `manual_docs/reference/memory.md`, `manual_docs/reference/config.md`, `manual_docs/reference/model-selection.md`, `manual_docs/explanation/agents-and-trust.md`, `manual_docs/how-to/enable-memory.md`, `manual_docs/overview/changelog.md`, `plugins/maestro-bootstrap/README.md`, `skills/maestro-assistant/SKILL.md`, `skills/maestro-new/SKILL.md`, `commands/maestro-memory.md`, `docs/project-context.md`, `docs/testing/maestro-sandbox-checklist.md`, `AGENTS.md`.

---

### Task 1: Git-хелпер `memory/git.js`

**Files:**
- Create: `plugins/maestro-bootstrap/memory/git.js`
- Test: `plugins/maestro-bootstrap/memory/git.test.js`

**Interfaces:**
- Consumes: — (новый модуль; паттерн `getGitConfig` из core.js: module-Map по root, spawnSync).
- Produces (используются Tasks 2-7):
  - `resolveBranch(root) → '' | name` — `git branch --show-current`; detached/fail → `''`.
  - `resolveHead(root) → '' | sha` — `git rev-parse HEAD`; fail → `''`.
  - `detectMainline(root, { override = null }) → { name } | null` — цепочка: override (verify `git rev-parse --verify refs/heads/<n>^{commit}`, провал → null) → `git symbolic-ref refs/remotes/origin/HEAD` (срез `refs/remotes/origin/` → bare + verify, провал → след. шаг) → `git config --get init.defaultBranch` (verify) → резерв `main`→`master`→`develop` (verify). null = mainline_unresolved.
  - `revList(root, ref) → Set<sha> | null` — `git rev-list <ref>`; fail → null (fail-soft).
  - `isAncestor(root, head, mainline) → 'yes' | 'no' | 'error'` — `git merge-base --is-ancestor`; exit 0→yes, 1→no, >1→error (dangling/invalid).
  - `verifyBranch(root, name) → boolean` — `git rev-parse --verify refs/heads/<name>^{commit}`.
- Каждая функция — через `runGit(root, args, { quiet })`: `spawnSync("git", args, { cwd: root, encoding: "utf8", timeout: 10_000 })`; ошибка spawn → throw (caller fail-soft); stderr подавляется в quiet-режиме.

- [ ] **Step 1: Write the failing test**

`git.test.js` (использует реальный git в tmp-репо; `git init` + commits):
```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { resolveBranch, resolveHead, detectMainline, revList, isAncestor, verifyBranch } from "./git.js";

function makeRepo() {
  const dir = mkdtempSync(join(tmpdir(), "mm-git-"));
  execFileSync("git", ["init", "-b", "main"], { cwd: dir, stdio: "ignore" });
  execFileSync("git", ["config", "user.email", "t@t"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "t"], { cwd: dir });
  writeFileSync(join(dir, "a.txt"), "a");
  execFileSync("git", ["add", "."], { cwd: dir });
  execFileSync("git", ["commit", "-m", "c1"], { cwd: dir });
  return dir;
}

test("resolveBranch/resolveHead return current state", () => {
  const dir = makeRepo();
  assert.equal(resolveBranch(dir), "main");
  assert.ok(/^[0-9a-f]{40}$/.test(resolveHead(dir)));
});

test("detectMainline: override wins, nonexistent override → null", () => {
  const dir = makeRepo();
  assert.equal(detectMainline(dir, { override: "main" }).name, "main");
  assert.equal(detectMainline(dir, { override: "nope" }), null);
});

test("detectMainline: no override → reserve chain (main exists)", () => {
  const dir = makeRepo();
  assert.equal(detectMainline(dir).name, "main");
});

test("revList returns ancestor set; isAncestor yes/no/error", () => {
  const dir = makeRepo();
  const head = resolveHead(dir);
  const set = revList(dir, "HEAD");
  assert.ok(set.has(head));
  assert.equal(isAncestor(dir, head, "main"), "yes");
  assert.equal(isAncestor(dir, "0".repeat(40), "main"), "no"); // not ancestor
  assert.equal(isAncestor(dir, "deadbeef", "main"), "error"); // invalid object
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test plugins/maestro-bootstrap/memory/git.test.js`
Expected: FAIL — `ERR_MODULE_NOT_FOUND` (git.js нет).

- [ ] **Step 3: Write minimal implementation**

`git.js`:
```js
import { spawnSync } from "node:child_process";

export function runGit(root, args, { quiet = false } = {}) {
  const r = spawnSync("git", args, { cwd: root, encoding: "utf8", timeout: 10_000 });
  if (r.error) throw r.error;
  return r;
}

export function resolveBranch(root) {
  try {
    const out = runGit(root, ["branch", "--show-current"], { quiet: true }).stdout.trim();
    return out; // detached → ""
  } catch { return ""; }
}

export function resolveHead(root) {
  try {
    const out = runGit(root, ["rev-parse", "HEAD"], { quiet: true }).stdout.trim();
    return /^[0-9a-f]{40}$/.test(out) ? out : "";
  } catch { return ""; }
}

export function verifyBranch(root, name) {
  if (!name) return false;
  try {
    const r = runGit(root, ["rev-parse", "--verify", `refs/heads/${name}^{commit}`], { quiet: true });
    return r.status === 0;
  } catch { return false; }
}

const RESERVE = ["main", "master", "develop"];

export function detectMainline(root, { override = null } = {}) {
  const steps = [];
  if (override) steps.push(() => (verifyBranch(root, override) ? { name: override } : null));
  steps.push(() => {
    try {
      const out = runGit(root, ["symbolic-ref", "refs/remotes/origin/HEAD"], { quiet: true }).stdout.trim();
      if (!out.startsWith("refs/remotes/origin/")) return null;
      const name = out.slice("refs/remotes/origin/".length);
      return verifyBranch(root, name) ? { name } : null;
    } catch { return null; }
  });
  steps.push(() => {
    try {
      const name = runGit(root, ["config", "--get", "init.defaultBranch"], { quiet: true }).stdout.trim();
      return name && verifyBranch(root, name) ? { name } : null;
    } catch { return null; }
  });
  steps.push(() => {
    for (const name of RESERVE) if (verifyBranch(root, name)) return { name };
    return null;
  });
  for (const step of steps) { const r = step(); if (r) return r; }
  return null;
}

export function revList(root, ref) {
  try {
    const r = runGit(root, ["rev-list", ref], { quiet: true });
    if (r.status !== 0) return null;
    return new Set(r.stdout.trim() ? r.stdout.trim().split("\n") : []);
  } catch { return null; }
}

export function isAncestor(root, head, mainline) {
  try {
    const r = runGit(root, ["merge-base", "--is-ancestor", head, mainline], { quiet: true });
    if (r.status === 0) return "yes";
    if (r.status === 1) return "no";
    return "error";
  } catch { return "error"; }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test plugins/maestro-bootstrap/memory/git.test.js`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add plugins/maestro-bootstrap/memory/git.js plugins/maestro-bootstrap/memory/git.test.js
git commit -m "feat(memory): git resolver (branch/head, mainline detect, rev-list, is-ancestor)"
```

---

### Task 2: Конфиг — `branch_context`/`mainline` + удаление `centralized_confidential`

**Files:**
- Modify: `plugins/maestro-bootstrap/memory/config.js`, `config.test.js`, `plugins/maestro-bootstrap/memory/index.js` (I5 failover)
- Test: `plugins/maestro-bootstrap/memory/config.test.js`

**Interfaces:**
- Consumes: — (config-слой; zero-dep).
- Produces: `MemoryConfig.branch_context` (bool, default `true`); `MemoryConfig.mainline` (string|null, default `null`); `centralized_confidential` УДАЛЁН (все места); `disabled_reason`: `branch_context_invalid`/`mainline_invalid` (убрать `centralized_confidential_invalid`).

- [ ] **Step 1: Write the failing tests**

`config.test.js`:
```js
test("branch_context default true; mainline default null", () => {
  const cfg = loadMemoryConfig({ memory: { enabled: true } });
  assert.equal(cfg.branch_context, true);
  assert.equal(cfg.mainline, null);
});

test("branch_context invalid disables; mainline invalid disables", () => {
  assert.equal(classifyMemoryConfig({ memory: { enabled: true, branch_context: "yes" } }).disabled_reason, "branch_context_invalid");
  assert.equal(classifyMemoryConfig({ memory: { enabled: true, mainline: "bad name!" } }).disabled_reason, "mainline_invalid");
});

test("mainline validation: regex + length 100", () => {
  assert.equal(classifyMemoryConfig({ memory: { enabled: true, mainline: "a".repeat(101) } }).disabled_reason, "mainline_invalid");
  assert.equal(classifyMemoryConfig({ memory: { enabled: true, mainline: "develop" } }).enabled, true);
});

test("centralized_confidential removed from config", () => {
  const cfg = loadMemoryConfig({ memory: { enabled: true, storage: { type: "sqlite" }, centralized_confidential: "forbid" } });
  assert.equal(cfg.storage.centralized_confidential, undefined); // ключ игнорируется/удалён
});
```
Также: удалить тесты `centralized_confidential default forbid`, `invalid value disables`, `allow enables with identity` — ключ больше не существует. `centralized_identity_missing` остаётся (identity для centralized — по-прежнему).

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test plugins/maestro-bootstrap/memory/config.test.js`
Expected: FAIL — нет branch_context/mainline; centralized_confidential ещё в DEFAULTS.

- [ ] **Step 3: Implement**

`config.js`:
- `DEFAULTS`: `branch_context: true`, `mainline: null`; убрать `centralized_confidential` из `storage`.
- `MAINLINE_RE = /^[a-zA-Z0-9_\/.-]+$/`; `mainlineValid(m)`: `m?.mainline == null` → true; string, ≤100, regex.
- `branchContextValid(m)`: `m?.branch_context == null` → true; `typeof === "boolean"`.
- `classifyMemoryConfig`: после storage-type/identity проверок — `if (!branchContextValid(m)) return { enabled: false, disabled_reason: "branch_context_invalid" }`; `if (!mainlineValid(m)) return { enabled: false, disabled_reason: "mainline_invalid" }`. Убрать блок `centralized_confidential` валидации.
- `mergedConfig`: убрать `centralized_confidential`; пробросить `branch_context`/`mainline`.

`index.js`:
- Удалить блок I5 (строки ~224-230): `isCentralized && centralized_confidential === "forbid" && confidentialPaths.length > 0 → storage.type = "sqlite"`.
- Убрать ссылку на `config.storage.centralized_confidential` (в classify уже нет).

- [ ] **Step 4: Run tests to verify pass**

Run: `node --test plugins/maestro-bootstrap/memory/config.test.js` + `npm run test:memory` (248 − удалённые + новые, ~248).
Expected: PASS; `npm test` (174) — PASS (index.js I5-удаление не ломает core).

- [ ] **Step 5: Secret-scan + commit**

```bash
git add plugins/maestro-bootstrap/memory/config.js plugins/maestro-bootstrap/memory/config.test.js plugins/maestro-bootstrap/memory/index.js
git commit -m "feat(memory): branch_context/mainline config; remove centralized_confidential"
```

---

### Task 3: Схема — поля branch/head/merged в 3 бэкендах + кандидат-запрос

**Files:**
- Modify: `plugins/maestro-bootstrap/memory/storage/sqlite.js`, `pgvector.js`, `qdrant.js`, `storage.js` (+ тесты)
- Test: `storage.test.js`, `storage/pgvector.test.js`, `storage/qdrant.test.js`

**Interfaces:**
- Consumes: — (схема; поля добавляются в запись).
- Produces: каждый бэкенд хранит `branch` (TEXT, `''` detached), `head` (TEXT, `''` unattributed), `merged` (INT 0/1); `upsert(entries)` принимает `{..., branch, head, merged}`; `get`/`scan` возвращают их (SCAN_FIELDS + branch/head/merged); метод кандидатов для recall: `candidates(key) → entries с merged=1 OR head != ''` (sqlite/pg: WHERE; qdrant: все точки ключа, JS-фильтр).
- SCAN_FIELDS (все 3): добавить `branch`, `head`, `merged` (легитимные метаданные, не derived — §3).

- [ ] **Step 1: Write the failing tests**

`storage.test.js` (sqlite):
```js
test("sqlite schema has branch/head/merged; legacy dev rows → unattributed", async () => {
  // создать storage, upsert entry с branch/head/merged; get() возвращает их
  // (fresh CREATE TABLE с колонками)
});
test("sqlite ALTER dev-hygiene: old-schema table gains columns idempotently", async () => {
  // вручную создать таблицу v2 (без колонок), затем init → ALTER ADD COLUMN; повторный init не падает
});
test("sqlite candidates(key) returns merged=1 OR head != ''", async () => {
  // записи: merged=1, head set, head='' merged=0 → candidates включает первые две
});
```
`pgvector.test.js` / `qdrant.test.js`: аналогичные (ADD COLUMN IF NOT EXISTS; payload всегда branch/head/merged; candidates).

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test plugins/maestro-bootstrap/memory/storage.test.js`
Expected: FAIL — колонки отсутствуют / upsert не принимает поля.

- [ ] **Step 3: Implement**

`sqlite.js`:
- CREATE TABLE (fresh) + ALTER dev-hygiene: `PRAGMA table_info(memory)` → если нет `branch` → `ALTER TABLE memory ADD COLUMN branch TEXT NOT NULL DEFAULT ''`, `head TEXT NOT NULL DEFAULT ''`, `merged INTEGER NOT NULL DEFAULT 0`. Идемпотентно (guard).
- `upsert`: INSERT/UPDATE включает `branch`, `head`, `merged`.
- `get`/`scan`: возвращают поля; `SCAN_FIELDS` += branch/head/merged.
- `candidates(key)`: `SELECT * FROM memory WHERE key = ? AND (merged = 1 OR head != '')`.

`pgvector.js`:
- `ADD COLUMN IF NOT EXISTS branch TEXT NOT NULL DEFAULT ''`, `head TEXT NOT NULL DEFAULT ''`, `merged INT NOT NULL DEFAULT 0`.
- upsert/get/scan + SCAN_FIELDS; `candidates(key)`.
- Осторожно: get/scan — явные списки колонок (не `SELECT *`; fts-исключение из v3a сохраняется).

`qdrant.js`:
- payload всегда `branch`/`head`/`merged` (detached → `''`); upsert.
- scan SCAN_FIELDS += branch/head/merged.
- `candidates(key)`: `scroll` по key, JS-фильтр `merged === 1 || head !== ''` (qdrant не фильтрует `!= ''` дешёво).

`storage.js`: контракт createStorage передаёт новые поля без изменений (upsert/get/scan уже пробрасывают); добавить `candidates` в интерфейс хранилищ.

- [ ] **Step 4: Run tests**

Run: `npm run test:memory` (248 + новые). Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plugins/maestro-bootstrap/memory/storage/
git commit -m "feat(memory): branch/head/merged schema + candidates query on all backends"
```

---

### Task 4: Запись — резолв branch/head на саммаризации (sticky) + merged fast-path

**Files:**
- Modify: `plugins/maestro-bootstrap/memory/indexer.js` (+ `indexer.test.js`), `plugins/maestro-bootstrap/memory/index.js` (передать git-резолвер/директиву)
- Test: `indexer.test.js`

**Interfaces:**
- Consumes: `resolveBranch`/`resolveHead` (Task 1); `config.branch_context`/`mainline`.
- Produces: на первой саммаризации сессии резолвятся `branch`/`head` (sticky: переиспользуются на version++); `merged` fast-path: `branch === mainline ? 1 : 0` (mainline не резолвнут → 0; heal на init, Task 5); detached → `branch=''`, `head` записывается; re-summarize не сбрасывает `merged`.

- [ ] **Step 1: Write the failing tests**

`indexer.test.js`:
```js
test("summarize attaches branch/head (sticky) and merged fast-path", async () => {
  // mock git resolver: branch=feature/x, head=sha, mainline=main → merged=0
  // первая саммаризация → entry.branch=feature/x, entry.head=sha, merged=0
  // re-summarize (version++) → те же branch/head (sticky), merged сохраняется
});
test("branch==mainline → merged=1 fast-path; mainline unresolved → merged=0", async () => {
  // branch=main → merged=1; mainline=null (unresolved) → merged=0 (heal позже)
});
test("detached → branch='' but head recorded", async () => {
  // resolveBranch → '' → branch='', head=sha
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test plugins/maestro-bootstrap/memory/indexer.test.js`
Expected: FAIL — entry не несёт branch/head/merged.

- [ ] **Step 3: Implement**

`indexer.js`:
- В `summarizeSession`-контракт добавить `branch`/`head` (передаются из диспетчера).
- При первой саммаризации сессии (version === 1): `branch = resolveBranch(root)`, `head = resolveHead(root)`. sticky: сохранить в `state` (по session_id) и переиспользовать на version++.
- `merged`: `branch && branch === mainline ? 1 : 0` (mainline — из config, если не null; авто-детект на init, Task 5; на записи используем config.mainline или null).
- detached: `branch = ''`, `head` остаётся.
- `upsert`-вызов включает новые поля.

`index.js`:
- Передать git-резолвер/`mainline` в indexer-конструктор.

- [ ] **Step 4: Run tests**

Run: `npm run test:memory` (251+). Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plugins/maestro-bootstrap/memory/indexer.js plugins/maestro-bootstrap/memory/indexer.test.js plugins/maestro-bootstrap/memory/index.js
git commit -m "feat(memory): write-time branch/head resolution (sticky) + merged fast-path"
```

---

### Task 5: Mainline-детект + промоция (init)

**Files:**
- Modify: `plugins/maestro-bootstrap/memory/index.js` (+ `index.test.js`), `plugins/maestro-bootstrap/memory/storage.js` (проброс)
- Test: `index.test.js`

**Interfaces:**
- Consumes: `detectMainline`, `isAncestor`, `verifyBranch` (Task 1); `config.mainline`; `candidates` (Task 3).
- Produces: на init: `mainline = detectMainline(root, { override: config.mainline })`; `mainline === null` → warn `mainline_unresolved` + промоция пропускается (flat). Промоция: для кандидатов ключа `merged=0 AND head != ''` — дедуп по уникальным head → `isAncestor(head, mainline)`; `'yes'` → `merged = 1` (key-scoped UPDATE по session_id); `'error'` → skip + debug-лог; `'no'` → пропуск. Heal-путь: транковые записи окна unresolved → на первом резолвнутом init промоутятся.

- [ ] **Step 1: Write the failing tests**

`index.test.js`:
```js
test("init: mainline detected → promotion marks merged=1 for ancestor heads (key-scoped)", async () => {
  // sqlite storage; записи key=A: h1 (в mainline), h2 (нет), key=B: h1 (чужой проект)
  // detectMainline → main; isAncestor(h1,main)=yes, h2=no
  // после init: A.h1.merged=1, A.h2.merged=0, B.h1.merged=0 (key-scoped!)
});
test("init: mainline unresolved → warn + promotion skipped", async () => {
  // detectMainline → null → console.error mainline_unresolved; ни одна запись не промоутится
});
test("init: heal — trunk records from unresolved window promote on first resolved init", async () => {
  // записи branch=main merged=0 head=H (написаны при unresolved) → isAncestor(H,main)=yes → merged=1
});
test("init: dangling head → isAncestor error → skip + debug log, pass continues", async () => {
  // одна запись с битым head (0x...deadbeef) → 'error' → skip, остальные промоутятся
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test plugins/maestro-bootstrap/memory/index.test.js`
Expected: FAIL — промоции нет.

- [ ] **Step 3: Implement**

`index.js` (в `registerMemoryHooks` init-пути):
```js
const mainline = detectMainline(root, { override: config.mainline ?? null });
if (!mainline) {
  log.warn?.("memory: mainline_unresolved — branch-context flat (нет резолвнутого mainline)");
} else {
  const candidates = await storage.candidates(effectiveKey);
  const uniqueHeads = [...new Set(candidates.filter(c => c.merged === 0 && c.head).map(c => c.head))];
  for (const head of uniqueHeads) {
    const r = isAncestor(root, head, mainline.name);
    if (r === "yes") {
      // key-scoped UPDATE merged=1 по всем записям key+head (не пересекает чужие ключи)
      await storage.markMerged(effectiveKey, head);
    } else if (r === "error") {
      log.debug?.(`memory: promotion skip head=${head} (dangling/invalid)`);
    } // 'no' → пропуск
  }
}
```
`storage.markMerged(key, head)` — добавить в sqlite/pg/qdrant (UPDATE ... WHERE key AND head; qdrant: setPayload по совпадающим id).
Интеграция: mainline-детект выполняется при init (паттерн fts_backfilled — каждый старт сессии плагина).

- [ ] **Step 4: Run tests**

Run: `npm run test:memory` (255+). Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plugins/maestro-bootstrap/memory/index.js plugins/maestro-bootstrap/memory/index.test.js plugins/maestro-bootstrap/memory/storage.js plugins/maestro-bootstrap/memory/storage.test.js
git commit -m "feat(memory): mainline detect + key-scoped head-based promotion (heal, fail-soft)"
```

---

### Task 6: Recall — commit-based membership + scope param

**Files:**
- Modify: `plugins/maestro-bootstrap/memory/index.js` (memory_search execute), `plugins/maestro-bootstrap/memory/recall.js` (+ tests), `plugins/maestro-bootstrap/memory/storage.js` (candidates + markMerged контракт уже есть)
- Test: `index.test.js`, `recall.test.js`

**Interfaces:**
- Consumes: `revList`, `detectMainline` (Task 1); `candidates` (Task 3); `config.branch_context`.
- Produces: `memory_search { scope: "branch"|"project" }` (default `branch`). Членство по таблице §6.1 (сверху вниз): merged=1 → general; head ∈ mainlineSet → general; head ∈ expSet → experience «⚠️ не в main»; иначе не в контексте. Наборы per-recall: `ancestorSet = revList(HEAD)`, `mainlineSet = revList(mainline)` (unresolved → ∅), `expSet = ancestorSet \ mainlineSet`. fail-soft: revList null → наборы пусты → recall = merged=1 only. auto-recall — дефолтный scope.

- [ ] **Step 1: Write the failing tests**

`index.test.js`:
```js
test("memory_search scope=branch: membership by head sets", async () => {
  // storage: a (merged=1), b (head∈mainline), c (head∈expSet), d (head∉ancestor)
  // revList HEAD = {b,c,...}, revList mainline = {b,...}
  // search scope=branch → a,b,c; d excluded; c annotated ⚠️
});
test("memory_search scope=project → all entries (flat)", async () => {
  // → a,b,c,d
});
test("memory_search fail-soft: revList null → only merged=1", async () => {
  // revList возвращает null → результат только a
});
test("memory_search scope=branch with branch_context=false → default project", async () => {
  // конфиг false → без scope-параметра = project; явный scope=branch побеждает
});
```
`recall.test.js`: auto-recall использует дефолтный scope.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test plugins/maestro-bootstrap/memory/index.test.js`
Expected: FAIL — нет scope/членства.

- [ ] **Step 3: Implement**

`index.js` memory_search execute:
```js
const scope = args.scope ?? (config.branch_context === false ? "project" : "branch");
// candidates = await storage.candidates(effectiveKey) (merged=1 OR head != '')
if (scope === "project") { // все кандидаты, обычный ранжинг (без членства)
} else {
  const mainline = detectMainline(root, { override: config.mainline ?? null });
  const ancestorSet = revList(root, "HEAD");
  const mainlineSet = mainline ? revList(root, mainline.name) : new Set();
  const expSet = ancestorSet ? new Set([...ancestorSet].filter(h => !mainlineSet.has(h))) : null;
  // membership:
  const inContext = candidates.filter(c =>
    c.merged === 1 ||
    (mainlineSet && mainlineSet.has(c.head)) ||
    (expSet && expSet.has(c.head))
  );
  const experienceIds = new Set(inContext.filter(c => c.merged === 0 && expSet.has(c.head)).map(c => c.session_id));
  // ранжинг по inContext; аннотация experienceIds «⚠️ не в main»
}
```
Fail-soft: `ancestorSet === null || mainlineSet === null` → `inContext = candidates.filter(c => c.merged === 1)` + debug-лог.
`memory_search` schema: `scope: "branch"|"project"` (optional).
`recall.js`: auto-recall вызывает ту же логику с дефолтным scope.

- [ ] **Step 4: Run tests**

Run: `npm run test:memory` (260+). Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plugins/maestro-bootstrap/memory/index.js plugins/maestro-bootstrap/memory/index.test.js plugins/maestro-bootstrap/memory/recall.js plugins/maestro-bootstrap/memory/recall.test.js
git commit -m "feat(memory): commit-based recall membership + scope param + annotation"
```

---

### Task 7: Инструменты — scope в выводе, разбивка по тирам, диагностики

**Files:**
- Modify: `plugins/maestro-bootstrap/memory/index.js` (memory_stats_detail/@maestro-memory), `commands/maestro-memory.md` (шаблон вывода)
- Test: `index.test.js`

**Interfaces:**
- Consumes: членство Task 6; `candidates`/`scan` (Task 3).
- Produces: `memory_stats_detail`/`@maestro-memory`: разбивка по тирам (merged / experience / unknown / dead), по веткам (display); дублируемые диагностики: `disabled_reason` (если память off), `mainline_unresolved`, `unmasked_branch_metadata` (если centralized + confidential.paths).

- [ ] **Step 1: Write the failing tests**

`index.test.js`:
```js
test("memory_stats_detail includes tier/branch breakdown", async () => {
  // записи: merged=1 ×2, experience ×1, dead (head∉ancestor) ×1 → вывод содержит разбивку
});
test("@maestro-memory duplicates disabled_reason / mainline_unresolved diagnostics", async () => {
  // память off → вывод содержит disabled_reason; mainline_unresolved → warn в выдаче
});
```

- [ ] **Step 2: Run test to verify it fails** → FAIL.

- [ ] **Step 3: Implement**

`index.js`: `memory_stats_detail` — после существующей агрегации добавить tier-разбивку (по членству Task 6 для текущего checkout) и branch-разбивку; `@maestro-memory` шаблон — секция «Тиры» + диагностические строки (`disabled_reason`, `mainline_unresolved`, `unmasked_branch_metadata` при условии). `commands/maestro-memory.md` шаблон вывода — обновить (Шаг 3 разбивка по тирам).

- [ ] **Step 4: Run tests** → PASS (265+).

- [ ] **Step 5: Commit**

```bash
git add plugins/maestro-bootstrap/memory/index.js plugins/maestro-bootstrap/memory/index.test.js commands/maestro-memory.md
git commit -m "feat(memory): tier/branch stats + duplicated diagnostics in @maestro-memory"
```

---

### Task 8: Docs cross-cutting (§10, 13 пунктов) + sandbox F12–F16

**Files (Modify):** `SECURITY.md` §5a, `manual_docs/reference/memory.md`, `manual_docs/reference/config.md`, `manual_docs/reference/model-selection.md`, `manual_docs/explanation/agents-and-trust.md`, `manual_docs/how-to/enable-memory.md`, `manual_docs/overview/changelog.md`, `plugins/maestro-bootstrap/README.md`, `skills/maestro-assistant/SKILL.md`, `skills/maestro-new/SKILL.md`, `commands/maestro-memory.md`, `docs/project-context.md`, `docs/testing/maestro-sandbox-checklist.md`, `AGENTS.md`.

**Interfaces:** docs; сверка с §10 спека (13 пунктов).

- [ ] **Step 1: SECURITY.md §5a** — жёсткий инвариант (raw+секреты не на сервер; маскирование — гарантия; `storage.type` — единственное решение; `centralized_confidential` удалён; риск unmasked git-метаданных); переформулировать буллет `memory_export` (§10.5).
- [ ] **Step 2: memory.md** — секция branch-aware (тиры, членство по head, промоция, scope, squash/rebase-loss, mainline авто-детект + `mainline_unresolved`, gitflow-guidance, fork-caveat, удаление `centralized_confidential`); убрать fallback-строку диагностики (§10.1).
- [ ] **Step 3: config.md** — `branch_context`/`mainline`; удаление `centralized_confidential` (§10.2).
- [ ] **Step 4: maestro-assistant/SKILL.md** — config-канон (+ `branch_context`/`mainline`, удаление ключа) (§10.3).
- [ ] **Step 5: enable-memory.md** — `disabled_reason` (убрать `centralized_confidential_invalid`; добавить `branch_context_invalid`/`mainline_invalid`), тиры, `mainline_unresolved`, `unmasked_branch_metadata` в выдаче `@maestro-memory` (§10.4).
- [ ] **Step 6: changelog.md** — запись v3 (§10.6).
- [ ] **Step 7: sandbox F12–F16** — commit-scoped recall (стек видит базу, имя-реюз не контаминирует), промоция после мержа (head-based), scope=project override, мульти-проект centralized (F15), heal (F16) (§10.7).
- [ ] **Step 8: project-context.md §5** — branch-aware + «`centralized_confidential` удалён» (§10.8).
- [ ] **Step 9: README.md** — branch-aware blurb; убрать failover-лог, `centralized_confidential_invalid`, пример конфига и буллет ключа (§10.9); `AGENTS.md` blurb.
- [ ] **Step 10: agents-and-trust.md** — заменить «Гейт централизованных бэкендов» инвариантом §9 (§10.10).
- [ ] **Step 11: model-selection.md** — убрать `centralized_confidential` (§10.11).
- [ ] **Step 12: maestro-new/SKILL.md** — удалить «`centralized_confidential`: всегда forbid» (§10.12).
- [ ] **Step 13: commands/maestro-memory.md** — шаблон вывода тиры/диагностики (§10.13).
- [ ] **Step 14: Verify** — `npm test` (174), `npm run test:memory` (265+), grep «centralized_confidential» по живым докам = 0 (кроме исторических specs/plans).
- [ ] **Step 15: Commit**

```bash
git add SECURITY.md manual_docs plugins/maestro-bootstrap/README.md skills/maestro-assistant/SKILL.md skills/maestro-new/SKILL.md commands/maestro-memory.md docs/project-context.md docs/testing/maestro-sandbox-checklist.md AGENTS.md
git commit -m "docs(memory): branch-aware v3 — tiers, mainline detect, centralized_confidential removal, F12-F16"
```

---

## Project Context Changes

- `docs/project-context.md` §5 — branch-aware модель + «`centralized_confidential` удалён» (§10.8). Применяется на plan-gate (шаг 12a).

## Regression Risk

- **Risk: HIGH** — ядро recall изменено (commit-scoped по умолчанию); схема записей расширена; удалён конфиг-ключ (cross-cutting). Модули: `memory/index.js`, `memory/indexer.js`, `memory/recall.js`, `memory/config.js`, `memory/storage/*`, `memory/git.js`.
- Scenarios:
  - `plugins/maestro-bootstrap/memory/index.js` — recall/промоция: run `node --test plugins/maestro-bootstrap/memory/index.test.js`
  - `plugins/maestro-bootstrap/memory/storage/` (sqlite/pg/qdrant schema + candidates): run `node --test plugins/maestro-bootstrap/memory/storage.test.js`; `node --test plugins/maestro-bootstrap/memory/storage/pgvector.test.js`; `node --test plugins/maestro-bootstrap/memory/storage/qdrant.test.js`
  - `plugins/maestro-bootstrap/memory/git.js` — run `node --test plugins/maestro-bootstrap/memory/git.test.js`
  - `plugins/maestro-bootstrap/memory/config.js` — run `node --test plugins/maestro-bootstrap/memory/config.test.js`
  - Полный прогон: `npm run test:memory` + `npm test`
  - [Manual] Sandbox E2E F12–F16 (Bun/opencode, реальные git-сценарии)