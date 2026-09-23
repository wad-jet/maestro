# Memory Backup/Restore (v1, sqlite) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Детерминированный бэкап/восстановление данных memory layer (tool `memory_backup` + CLI + команда `@maestro-memory-backup`) с double-masking, манифестом, retention и gitignore-warn.

**Architecture:** Вся логика — в чистом модуле `plugins/maestro-bootstrap/memory/backup.js` (инжектируемые storage/конфиг, без side-effects при импорте). Два входа: tool `memory_backup` (action: backup|restore|list, нативный `ask`-гейт) и тонкая ESM-CLI-обёртка `backup-cli.js` (аварийный ручной запуск вне opencode). Маскирование переиспользует `maskEntry` (import-механику), валидацию строк — `validateImportEntry` (вынесен в `validation.js`). Формат: JSONL схемы v3 (field-list = `SCAN_FIELDS`) + отдельный манифест; retention по строгому паттерну имён.

**Tech Stack:** Node ESM, 0 deps в ядре модуля; Node built-in test runner (`npm run test:memory`); git CLI (spawn) для check-ignore.

**Spec:** `docs/superpowers/specs/2026-09-22-memory-backup-restore-design.md` (approve, 2026-09-22).

---

## File Structure

| Файл | Ответственность |
|---|---|
| `plugins/maestro-bootstrap/memory/validation.js` | **Новый.** `validateImportEntry` — вынесен из `index.js:380` (общий для import/backup/restore) |
| `plugins/maestro-bootstrap/memory/backup.js` | **Новый.** вся логика backup/restore/list: naming, jsonl, manifest, retention, gitignore-warn, preflight, потоки |
| `plugins/maestro-bootstrap/memory/backup-cli.js` | **Новый.** тонкая ESM-обёртка CLI (аргументы → `runBackup`/`runRestore`/`listBackups`), без side-effects при импорте |
| `plugins/maestro-bootstrap/memory/config.js` | + `resolveBackupConfig` (мягкий fallback, память НЕ отключается) |
| `plugins/maestro-bootstrap/memory/backfill.js` | + `export` у `SCAN_FIELDS` |
| `plugins/maestro-bootstrap/memory/index.js` | - вынос `validateImportEntry`; + tool `memory_backup` в `registerMemoryHooks` |
| `plugins/maestro-bootstrap/memory/backup.test.js` | **Новый.** unit-тесты backup.js |
| `plugins/maestro-bootstrap/memory/config.test.js` | + тесты `resolveBackupConfig` |
| `plugins/maestro-bootstrap/memory/backup-cli.test.js` | **Новый.** CLI smoke через `child_process` |
| `plugins/maestro-bootstrap/memory/index.test.js` | + строка `memory_backup` в ask-gate contract-тесте |
| `commands/maestro-memory-backup.md` | **Новая** команда (обёртка над tool) |
| `.opencode/opencode.json` (gitignored, merge-config) | + `"memory_backup": "ask"` |
| docs-синк (Task 9) | `manual_docs/{reference/memory.md,reference/config.md,reference/commands.md,how-to/enable-memory.md,how-to/memory-backup-restore.md(новый),explanation/agents-and-trust.md,reference/model-selection.md,overview/changelog.md}`, `SECURITY.md` §5a, `AGENTS.md`, `plugins/maestro-bootstrap/README.md`, `skills/maestro-assistant/SKILL.md`, `skills/maestro-setup/SKILL.md` |
| `regression/entries/2026-09-22-memory-backup-restore.md` | **Новый** regression entry |
| `package.json` | version 4.6.1 → 4.7.0 |

---

### Task 1: Refactor — вынести `validateImportEntry` в `validation.js` + экспортировать `SCAN_FIELDS`

**Files:**
- Create: `plugins/maestro-bootstrap/memory/validation.js`
- Modify: `plugins/maestro-bootstrap/memory/index.js:380` (удалить локальную функцию, добавить импорт)
- Modify: `plugins/maestro-bootstrap/memory/backfill.js:28` (`const SCAN_FIELDS` → `export const SCAN_FIELDS`)
- Test: `plugins/maestro-bootstrap/memory/validation.test.js` (новый)

- [ ] **Step 1: Написать failing-тест** (`plugins/maestro-bootstrap/memory/validation.test.js`)

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { validateImportEntry } from "./validation.js";

const storage = { dim: 8, modelId: "test-model" };

test("validateImportEntry: валидная запись → null", () => {
  const e = { session_id: "s1", key: "k1", title: "t", summary: "s", embedding: [1,2,3,4,5,6,7,8], model_id: "test-model" };
  assert.equal(validateImportEntry(e, storage, "k1"), null);
});

test("validateImportEntry: чужой key → причина", () => {
  const e = { session_id: "s1", key: "OTHER", title: "t", summary: "s", embedding: [1,2,3,4,5,6,7,8], model_id: "test-model" };
  assert.match(validateImportEntry(e, storage, "k1"), /key/);
});

test("validateImportEntry: несовпадение model_id → причина", () => {
  const e = { session_id: "s1", key: "k1", title: "t", summary: "s", embedding: [1,2,3,4,5,6,7,8], model_id: "other" };
  assert.match(validateImportEntry(e, storage, "k1"), /model_id/);
});

test("validateImportEntry: dim-несовпадение → причина", () => {
  const e = { session_id: "s1", key: "k1", title: "t", summary: "s", embedding: [1,2,3], model_id: "test-model" };
  assert.match(validateImportEntry(e, storage, "k1"), /dim/);
});
```

- [ ] **Step 2: Проверить FAIL**

Run: `node --test plugins/maestro-bootstrap/memory/validation.test.js`
Expected: FAIL — `Cannot find module './validation.js'`

- [ ] **Step 3: Реализация**

`plugins/maestro-bootstrap/memory/validation.js` — перенести функцию `validateImportEntry` из `index.js:380` **без изменений** (только `export`), с JSDoc. В `index.js`: удалить тело функции (строка 380), добавить в импорты `import { validateImportEntry } from "./validation.js";`. В `backfill.js:28`: `const SCAN_FIELDS` → `export const SCAN_FIELDS`.

- [ ] **Step 4: Проверить PASS + регрессия**

Run: `node --test plugins/maestro-bootstrap/memory/validation.test.js && npm run test:memory && npm test`
Expected: PASS (все; import-поведение не изменено — существующие тесты `memory_import` в index.test.js зелёные)

- [ ] **Step 5: Commit**

```bash
git add plugins/maestro-bootstrap/memory/validation.js plugins/maestro-bootstrap/memory/validation.test.js plugins/maestro-bootstrap/memory/index.js plugins/maestro-bootstrap/memory/backfill.js
git commit -m "refactor(memory): validateImportEntry → validation.js (общий для import/backup); export SCAN_FIELDS"
```

---

### Task 2: Конфиг `memory.backup` — `resolveBackupConfig` (мягкий fallback)

**Files:**
- Modify: `plugins/maestro-bootstrap/memory/config.js`
- Test: `plugins/maestro-bootstrap/memory/config.test.js`

Семантика (spec §6): `path` — строка (default `.maestro/memory/backup`); `retention` — целое ≥ 0, `0` = без ограничений (default `3`); невалидное значение секции → soft fallback на дефолты + warn (память НЕ отключается, в отличие от `*_invalid`).

- [ ] **Step 1: Написать failing-тесты** (в `config.test.js`)

```js
test("resolveBackupConfig: секция отсутствует → дефолты, warn false", () => {
  assert.deepEqual(resolveBackupConfig({}), { path: ".maestro/memory/backup", retention: 3, warn: false });
});

test("resolveBackupConfig: явные значения → используются", () => {
  assert.deepEqual(resolveBackupConfig({ backup: { path: "backups/mem", retention: 5 } }), { path: "backups/mem", retention: 5, warn: false });
});

test("resolveBackupConfig: retention 0 → 0 (off), warn false", () => {
  assert.deepEqual(resolveBackupConfig({ backup: { retention: 0 } }), { path: ".maestro/memory/backup", retention: 0, warn: false });
});

test("resolveBackupConfig: невалидный path (число) → дефолт + warn true", () => {
  assert.deepEqual(resolveBackupConfig({ backup: { path: 42 } }), { path: ".maestro/memory/backup", retention: 3, warn: true });
});

test("resolveBackupConfig: невалидный retention (-1) → дефолт + warn true", () => {
  assert.deepEqual(resolveBackupConfig({ backup: { retention: -1 } }), { path: ".maestro/memory/backup", retention: 3, warn: true });
});

test("resolveBackupConfig: backup = массив → дефолты + warn true", () => {
  assert.deepEqual(resolveBackupConfig({ backup: [] }), { path: ".maestro/memory/backup", retention: 3, warn: true });
});
```

- [ ] **Step 2: Проверить FAIL**

Run: `node --test plugins/maestro-bootstrap/memory/config.test.js`
Expected: FAIL — `resolveBackupConfig is not a function`

- [ ] **Step 3: Реализация** (в `config.js`)

```js
export const BACKUP_DEFAULTS = { path: ".maestro/memory/backup", retention: 3 };

/**
 * memory.backup: мягкий fallback (spec §6). Невалидная секция → дефолты + warn: true
 * (память НЕ отключается; warn-источник — memory:config_fallback при старте).
 * retention: 0 = без ограничений; null/undefined = дефолт.
 */
export function resolveBackupConfig(m) {
  const b = m?.backup;
  const valid =
    b == null ||
    (typeof b === "object" && !Array.isArray(b) &&
      (b.path == null || (typeof b.path === "string" && b.path.trim() !== "")) &&
      (b.retention == null || (typeof b.retention === "number" && Number.isInteger(b.retention) && b.retention >= 0)));
  const path = valid && typeof b?.path === "string" && b.path.trim() ? b.path.trim() : BACKUP_DEFAULTS.path;
  const retention = valid && Number.isInteger(b?.retention) && b.retention >= 0 ? b.retention : BACKUP_DEFAULTS.retention;
  return { path, retention, warn: !valid };
}
```

В `registerMemoryHooks` (index.js) при старте: если `resolveBackupConfig(maestroConfig.memory).warn` → `logInfo("memory:config_fallback", { field: "backup" })` (однократно, паттерн существующих warn).

- [ ] **Step 4: Проверить PASS + регрессия**

Run: `node --test plugins/maestro-bootstrap/memory/config.test.js && npm run test:memory`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugins/maestro-bootstrap/memory/config.js plugins/maestro-bootstrap/memory/config.test.js plugins/maestro-bootstrap/memory/index.js
git commit -m "feat(memory): memory.backup — resolveBackupConfig с soft fallback (spec §6)"
```

---

### Task 3: `backup.js` — naming, JSONL, манифест, retention (чистые функции)

**Files:**
- Create: `plugins/maestro-bootstrap/memory/backup.js`
- Test: `plugins/maestro-bootstrap/memory/backup.test.js`

- [ ] **Step 1: Написать failing-тесты** (`backup.test.js`)

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, readdirSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { backupBaseName, buildJsonl, buildManifestMeta, applyRetention, listBackups } from "./backup.js";

const KEY = "ai.opencode.maestro";
const tmp = () => mkdtempSync(join(tmpdir(), "maestro-backup-"));

test("backupBaseName: backup-<key>-<ts>", () => {
  assert.equal(backupBaseName(KEY, 1758000000000), `backup-${KEY}-1758000000000`);
});

test("buildJsonl: одна строка на запись + trailing newline; пусто → ''", () => {
  assert.equal(buildJsonl([{ a: 1 }]), '{"a":1}\n');
  assert.equal(buildJsonl([]), "");
});

test("buildManifestMeta: полный набор полей + sha256 тела", () => {
  const m = buildManifestMeta({ entries: [{ a: 1 }], key: KEY, storageType: "sqlite", modelId: "mm", dim: 384, pluginVersion: "4.7.0", ts: 111 });
  assert.equal(m.format, "maestro-memory-backup/v1");
  assert.equal(m.key, KEY);
  assert.equal(m.count, 1);
  assert.equal(m.storage_type, "sqlite");
  assert.equal(m.plugin_version, "4.7.0");
  assert.ok(Array.isArray(m.schema_fields) && m.schema_fields.includes("session_id"));
  assert.match(m.sha256, /^[a-f0-9]{64}$/);
});

test("applyRetention: хранит последние N пар, удаляет старые; чужие файлы не трогает", () => {
  const dir = tmp();
  for (const ts of [1, 2, 3, 4]) for (const s of [".jsonl", ".manifest.json"]) writeFileSync(join(dir, `backup-${KEY}-${ts}${s}`), "x");
  writeFileSync(join(dir, "backup-OTHER-1.jsonl"), "x");
  const stale = applyRetention(dir, KEY, 2);
  assert.deepEqual(stale.sort(), [`backup-${KEY}-1`, `backup-${KEY}-2`]);
  assert.ok(existsSync(join(dir, `backup-${KEY}-4.jsonl`)));
  assert.ok(existsSync(join(dir, "backup-OTHER-1.jsonl")));
  assert.ok(!existsSync(join(dir, `backup-${KEY}-1.manifest.json`)));
});

test("applyRetention: retention 0 → ничего не удаляет", () => {
  const dir = tmp();
  for (const s of [".jsonl", ".manifest.json"]) writeFileSync(join(dir, `backup-${KEY}-1${s}`), "x");
  assert.deepEqual(applyRetention(dir, KEY, 0), []);
  assert.ok(existsSync(join(dir, `backup-${KEY}-1.jsonl`)));
});

test("listBackups: пары по убыванию ts; нет каталога → []", () => {
  const dir = tmp();
  for (const ts of [1, 2]) for (const s of [".jsonl", ".manifest.json"]) writeFileSync(join(dir, `backup-${KEY}-${ts}${s}`), "x");
  const list = listBackups(dir, KEY);
  assert.deepEqual(list.map((r) => r.ts), [2, 1]);
  assert.equal(list[0].file, join(dir, `backup-${KEY}-2.jsonl`));
  assert.equal(list[0].manifest_ok, true);
  assert.deepEqual(listBackups(join(tmp(), "nope"), KEY), []);
});
```

- [ ] **Step 2: Проверить FAIL**

Run: `node --test plugins/maestro-bootstrap/memory/backup.test.js`
Expected: FAIL — `Cannot find module './backup.js'`

- [ ] **Step 3: Реализация** (`backup.js`)

```js
import { createHash } from "node:crypto";
import { existsSync, readdirSync, unlinkSync, readFileSync, statSync, spawnSync } from "node:fs";
import { join } from "node:path";
import { SCAN_FIELDS } from "./backfill.js";

export function backupBaseName(key, ts) { return `backup-${key}-${ts}`; }

export function buildJsonl(entries) {
  if (!entries.length) return "";
  return entries.map((e) => JSON.stringify(e)).join("\n") + "\n";
}

export function buildManifestMeta({ entries, key, storageType, modelId, dim, pluginVersion, ts }) {
  return {
    format: "maestro-memory-backup/v1",
    plugin_version: pluginVersion,
    schema_fields: [...SCAN_FIELDS],
    model_id: modelId,
    dim,
    key,
    ts,
    count: entries.length,
    sha256: createHash("sha256").update(buildJsonl(entries)).digest("hex"),
    storage_type: storageType,
  };
}

export function resolveBackupDir(relPath, gitRoot) {
  return join(gitRoot || process.cwd(), relPath);
}

export function applyRetention(dir, key, retention) {
  if (!retention) return [];
  if (!existsSync(dir)) return [];
  const prefix = `backup-${key}-`;
  const bases = new Set();
  for (const f of readdirSync(dir)) {
    if (!f.startsWith(prefix)) continue;
    if (f.endsWith(".jsonl")) bases.add(f.slice(0, -".jsonl".length));
    else if (f.endsWith(".manifest.json")) bases.add(f.slice(0, -".manifest.json".length));
  }
  const sorted = [...bases]
    .filter((b) => /^\d+$/.test(b.slice(prefix.length)))
    .sort((a, b) => Number(b.slice(prefix.length)) - Number(a.slice(prefix.length)));
  const stale = sorted.slice(retention);
  for (const b of stale) {
    for (const f of [`${b}.jsonl`, `${b}.manifest.json`]) {
      try { unlinkSync(join(dir, f)); } catch { /* файла нет — ок */ }
    }
  }
  return stale;
}

export function listBackups(dir, key) {
  if (!existsSync(dir)) return [];
  const prefix = `backup-${key}-`;
  const map = new Map();
  const get = (base) => {
    if (!map.has(base)) map.set(base, { base, ts: Number(base.slice(prefix.length)), jsonl: false, manifest: false, size: 0 });
    return map.get(base);
  };
  for (const f of readdirSync(dir)) {
    if (!f.startsWith(prefix)) continue;
    if (f.endsWith(".jsonl")) {
      const r = get(f.slice(0, -".jsonl".length));
      r.jsonl = true;
      try { r.size = statSync(join(dir, f)).size; } catch { /* ok */ }
    } else if (f.endsWith(".manifest.json")) {
      get(f.slice(0, -".manifest.json".length)).manifest = true;
    }
  }
  return [...map.values()]
    .filter((r) => Number.isInteger(r.ts))
    .sort((a, b) => b.ts - a.ts)
    .map((r) => ({ file: join(dir, `${r.base}.jsonl`), manifest: join(dir, `${r.base}.manifest.json`), ts: r.ts, jsonl: r.jsonl, manifest_ok: r.manifest, size: r.size }));
}
```

- [ ] **Step 4: Проверить PASS**

Run: `node --test plugins/maestro-bootstrap/memory/backup.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugins/maestro-bootstrap/memory/backup.js plugins/maestro-bootstrap/memory/backup.test.js
git commit -m "feat(memory): backup.js — naming/JSONL/манифест/retention/list (чистые функции)"
```

---

### Task 4: `backup.js` — gitignore-warn + `runBackup`

**Files:**
- Modify: `plugins/maestro-bootstrap/memory/backup.js`
- Test: `plugins/maestro-bootstrap/memory/backup.test.js`

- [ ] **Step 1: Написать failing-тесты** (дополнить `backup.test.js`)

```js
import { gitIgnoreWarn, runBackup } from "./backup.js";

function mkMockStorage(rows) {
  const upserts = [];
  return {
    upserts,
    async scan({ fields }) { return rows; },
    async upsert(entries) { upserts.push(entries); return entries.length; },
    async deleteByFilter() { return 0; },
    dim: 8, modelId: "mm",
  };
}
const ROW = { session_id: "s1", key: "k1", title: "t", summary: "raw secret value here", embedding: [1,2,3,4,5,6,7,8], model_id: "mm" };

test("gitIgnoreWarn: не-git-репо → not_a_git_repo", () => {
  const r = gitIgnoreWarn("/tmp/whatever", null);
  assert.equal(r.ignored, false);
  assert.equal(r.reason, "not_a_git_repo");
});

test("gitIgnoreWarn: gitignored-путь в реальном репо → ignored", () => {
  const r = gitIgnoreWarn(".maestro/memory/backup", process.cwd());
  assert.equal(r.ignored, true);
});

test("runBackup: scan → maskEntry → JSONL+манифест → warn → retention → audit", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mb-run-"));
  const logs = [];
  const r = await runBackup({
    storage: mkMockStorage([ROW]),
    backupCfg: { path: dir, retention: 0 },
    effectiveKey: "k1", storageType: "sqlite", modelId: "mm", dim: 8,
    pluginVersion: "4.7.0",
    maskPatterns: { confidential: ["raw secret value here"], artifacts: [] },
    log: (msg, extra) => logs.push({ msg, extra }),
    gitRoot: null, now: () => 123,
  });
  assert.ok(existsSync(join(dir, "backup-k1-123.jsonl")));
  assert.ok(existsSync(join(dir, "backup-k1-123.manifest.json")));
  const body = JSON.parse(readFileSync(join(dir, "backup-k1-123.jsonl"), "utf8"));
  assert.ok(!String(body.summary).includes("raw secret value here"), "maskEntry обязателен");
  assert.ok(body.summary.includes("[masked") || body.summary.length < ROW.summary.length, "маскирование применилось");
  const meta = JSON.parse(readFileSync(join(dir, "backup-k1-123.manifest.json"), "utf8"));
  assert.equal(meta.count, 1);
  assert.equal(r.warn, "not_a_git_repo");
  assert.ok(logs.some((l) => l.msg === "memory:backup" && l.extra.count === 1));
});

test("runBackup: 0 записей → отказ, файлы не создаются", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mb-empty-"));
  await assert.rejects(
    () => runBackup({ storage: mkMockStorage([]), backupCfg: { path: dir, retention: 0 }, effectiveKey: "k1", storageType: "sqlite", modelId: "mm", dim: 8, pluginVersion: "4.7.0", maskPatterns: { confidential: [], artifacts: [] }, gitRoot: null }),
    /нет записей/
  );
  assert.deepEqual(readdirSync(dir), []);
});

test("runBackup: storage.type != sqlite → отказ (sqlite-only guard)", async () => {
  await assert.rejects(
    () => runBackup({ storage: mkMockStorage([ROW]), backupCfg: { path: "/tmp/x", retention: 0 }, effectiveKey: "k1", storageType: "qdrant", modelId: "mm", dim: 8, pluginVersion: "4.7.0", maskPatterns: { confidential: [], artifacts: [] } }),
    /sqlite/
  );
});
```

- [ ] **Step 2: Проверить FAIL**

Run: `node --test plugins/maestro-bootstrap/memory/backup.test.js`
Expected: FAIL — `gitIgnoreWarn`/`runBackup` are not exported

- [ ] **Step 3: Реализация** (дополнить `backup.js`)

```js
import { maskEntry } from "./mask.js";
import { mkdirSync, writeFileSync } from "node:fs"; // добавить в импорты

/** gitignore-проверка: только детерминированно (LLM warn не считает). */
export function gitIgnoreWarn(dir, gitRoot) {
  if (!gitRoot) return { ignored: false, reason: "not_a_git_repo" };
  const r = spawnSync("git", ["-C", gitRoot, "check-ignore", "-q", "--", dir], { encoding: "utf8" });
  if (r.error || r.status === 127) return gitIgnoreFallback(dir, gitRoot);
  return r.status === 0 ? { ignored: true, reason: null } : { ignored: false, reason: "not_ignored" };
}

/** Документированный fallback (git недоступен): наивный match по корневому .gitignore. */
export function gitIgnoreFallback(dir, gitRoot) {
  try {
    const lines = readFileSync(join(gitRoot, ".gitignore"), "utf8").split("\n").map((l) => l.trim()).filter(Boolean);
    const ignored = lines.some((l) => {
      if (l.startsWith("!")) return false;
      const p = l.endsWith("/") ? l.slice(0, -1) : l;
      return dir === p || dir.startsWith(`${p}/`);
    });
    return ignored ? { ignored: true, reason: null } : { ignored: false, reason: "not_ignored_fallback" };
  } catch {
    return { ignored: false, reason: "git_unavailable" };
  }
}

/**
 * Бэкап (spec §5.1): preflight → scan(SCAN_FIELDS) → maskEntry (текущий
 * confidential-набор) → JSONL+манифест → gitignore-warn → retention → audit.
 * Ошибки — throw (обёртки tool/CLI форматируют).
 */
export async function runBackup({ storage, backupCfg, effectiveKey, storageType, modelId, dim, pluginVersion, maskPatterns, log, gitRoot, now = () => Date.now() }) {
  if (storageType !== "sqlite") throw new Error("memory_backup: v1 — только storage.type sqlite");
  const rows = await storage.scan({ key: effectiveKey, fields: SCAN_FIELDS });
  if (!rows.length) throw new Error("memory_backup: нет записей для бэкапа");
  const entries = rows.map((r) =>
    maskEntry(r, { confidentialPatterns: maskPatterns.confidential, artifactConfidentialPatterns: maskPatterns.artifacts })
  );
  const ts = now();
  const dir = resolveBackupDir(backupCfg.path, gitRoot);
  mkdirSync(dir, { recursive: true });
  const meta = buildManifestMeta({ entries, key: effectiveKey, storageType, modelId, dim, pluginVersion, ts });
  const base = backupBaseName(effectiveKey, ts);
  const jsonlPath = join(dir, `${base}.jsonl`);
  const manifestPath = join(dir, `${base}.manifest.json`);
  writeFileSync(jsonlPath, buildJsonl(entries), "utf8");
  writeFileSync(manifestPath, JSON.stringify(meta, null, 2) + "\n", "utf8");
  const gi = gitIgnoreWarn(dir, gitRoot);
  const removed = applyRetention(dir, effectiveKey, backupCfg.retention);
  log?.("memory:backup", { path: jsonlPath, count: entries.length, sha256: meta.sha256, warn: gi.ignored ? null : gi.reason, removed: removed.length });
  return { file: jsonlPath, manifest: manifestPath, count: entries.length, warn: gi.ignored ? null : gi.reason };
}
```

- [ ] **Step 4: Проверить PASS + регрессия**

Run: `node --test plugins/maestro-bootstrap/memory/backup.test.js && npm run test:memory`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugins/maestro-bootstrap/memory/backup.js plugins/maestro-bootstrap/memory/backup.test.js
git commit -m "feat(memory): runBackup — scan→maskEntry→JSONL+манифест→gitignore-warn→retention→audit"
```

---

### Task 5: `backup.js` — `runRestore` (валидация, fail-closed манифест, merge/replace, счёт)

**Files:**
- Modify: `plugins/maestro-bootstrap/memory/backup.js`
- Test: `plugins/maestro-bootstrap/memory/backup.test.js`

- [ ] **Step 1: Написать failing-тесты** (дополнить `backup.test.js`)

```js
import { runRestore } from "./backup.js";
import { validateImportEntry } from "./validation.js";

function mkEntry(i) {
  return { session_id: `s${i}`, key: "k1", title: `t${i}`, summary: `sum${i}`, embedding: [1,2,3,4,5,6,7,8], model_id: "mm" };
}
function writeBackup(dir, { key = "k1", entries, ts = 555, manifest = {} } = {}) {
  const base = `backup-${key}-${ts}`;
  writeFileSync(join(dir, `${base}.jsonl`), entries.map((e) => JSON.stringify(e)).join("\n") + "\n", "utf8");
  const meta = { format: "maestro-memory-backup/v1", plugin_version: "4.7.0", schema_fields: [], model_id: "mm", dim: 8, key, ts, count: entries.length, sha256: "", storage_type: "sqlite", ...manifest };
  meta.sha256 = createHash256(buildJsonl(entries));
  writeFileSync(join(dir, `${base}.manifest.json`), JSON.stringify(meta), "utf8");
  return join(dir, `${base}.jsonl`);
}
function createHash256(s) { return createHash("sha256").update(s).digest("hex"); }
// (createHash импортировать из node:crypto в тест)

test("runRestore merge: upsert с maskEntry; счёт overwritten/added", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mr-"));
  const storage = mkMockStorage([mkEntry(1)]); // s1 уже в БД
  const file = writeBackup(dir, { entries: [mkEntry(1), mkEntry(2)] });
  const r = await runRestore({ storage, backupCfg: { path: dir }, effectiveKey: "k1", storageType: "sqlite", modelId: "mm", dim: 8, file, replace: false, channel: "tool", maskPatterns: { confidential: [], artifacts: [] }, gitRoot: null });
  assert.equal(r.mode, "merge");
  assert.equal(r.overwritten, 1);
  assert.equal(r.added, 1);
  assert.equal(storage.upserts.length, 1);
});

test("runRestore: несовпадение model_id в манифесте → fail-closed, БД не изменена", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mr2-"));
  const storage = mkMockStorage([]);
  const file = writeBackup(dir, { entries: [mkEntry(1)], manifest: { model_id: "other" } });
  await assert.rejects(() => runRestore({ storage, backupCfg: { path: dir }, effectiveKey: "k1", storageType: "sqlite", modelId: "mm", dim: 8, file, replace: false, channel: "tool", maskPatterns: { confidential: [], artifacts: [] }, gitRoot: null }), /model_id/);
  assert.equal(storage.upserts.length, 0);
});

test("runRestore: несовпадение key → fail-closed", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mr3-"));
  const file = writeBackup(dir, { key: "OTHER", entries: [mkEntry(1)] });
  await assert.rejects(() => runRestore({ storage: mkMockStorage([]), backupCfg: { path: dir }, effectiveKey: "k1", storageType: "sqlite", modelId: "mm", dim: 8, file, replace: false, channel: "tool", maskPatterns: { confidential: [], artifacts: [] }, gitRoot: null }), /key/);
});

test("runRestore: sha256 не совпадает → fail-closed (порча/подмена)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mr4-"));
  const file = writeBackup(dir, { entries: [mkEntry(1)] });
  writeFileSync(file, '{"tampered":true}\n', "utf8");
  await assert.rejects(() => runRestore({ storage: mkMockStorage([]), backupCfg: { path: dir }, effectiveKey: "k1", storageType: "sqlite", modelId: "mm", dim: 8, file, replace: false, channel: "tool", maskPatterns: { confidential: [], artifacts: [] }, gitRoot: null }), /sha256/);
});

test("runRestore replace: channel=tool — очистка ПОСЛЕ валидации, до upsert", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mr5-"));
  const calls = [];
  const storage = { ...mkMockStorage([]), async deleteByFilter() { calls.push("delete"); return 0; }, async upsert(e) { calls.push("upsert"); return e.length; } };
  const file = writeBackup(dir, { entries: [mkEntry(1)] });
  const r = await runRestore({ storage, backupCfg: { path: dir }, effectiveKey: "k1", storageType: "sqlite", modelId: "mm", dim: 8, file, replace: true, channel: "tool", maskPatterns: { confidential: [], artifacts: [] }, gitRoot: null });
  assert.deepEqual(calls, ["delete", "upsert"]);
  assert.equal(r.mode, "replace");
});

test("runRestore replace: channel=cli, не-tty → отказ", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mr6-"));
  const file = writeBackup(dir, { entries: [mkEntry(1)] });
  await assert.rejects(() => runRestore({ storage: mkMockStorage([]), backupCfg: { path: dir }, effectiveKey: "k1", storageType: "sqlite", modelId: "mm", dim: 8, file, replace: true, channel: "cli", isTty: false, confirmNamespace: "k1", maskPatterns: { confidential: [], artifacts: [] }, gitRoot: null }), /не-интерактив/);
});

test("runRestore replace: channel=cli, tty + confirmNamespace = key → ок", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mr7-"));
  const storage = mkMockStorage([]);
  const file = writeBackup(dir, { entries: [mkEntry(1)] });
  await runRestore({ storage, backupCfg: { path: dir }, effectiveKey: "k1", storageType: "sqlite", modelId: "mm", dim: 8, file, replace: true, channel: "cli", isTty: true, confirmNamespace: "k1", maskPatterns: { confidential: [], artifacts: [] }, gitRoot: null });
  assert.equal(storage.upserts.length, 1);
});

test("runRestore replace: channel=cli, confirmNamespace != key → отказ", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mr8-"));
  const file = writeBackup(dir, { entries: [mkEntry(1)] });
  await assert.rejects(() => runRestore({ storage: mkMockStorage([]), backupCfg: { path: dir }, effectiveKey: "k1", storageType: "sqlite", modelId: "mm", dim: 8, file, replace: true, channel: "cli", isTty: true, confirmNamespace: "nope", maskPatterns: { confidential: [], artifacts: [] }, gitRoot: null }), /подтверждени/);
});

test("runRestore: файл вне каталога бэкапов → отказ", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mr9-"));
  const outside = join(mkdtempSync(join(tmpdir(), "mr9-out-")), "backup-k1-555.jsonl");
  writeFileSync(outside, "x", "utf8");
  await assert.rejects(() => runRestore({ storage: mkMockStorage([]), backupCfg: { path: dir }, effectiveKey: "k1", storageType: "sqlite", modelId: "mm", dim: 8, file: outside, replace: false, channel: "tool", maskPatterns: { confidential: [], artifacts: [] }, gitRoot: null }), /каталог/);
});
```

- [ ] **Step 2: Проверить FAIL**

Run: `node --test plugins/maestro-bootstrap/memory/backup.test.js`
Expected: FAIL — `runRestore` is not exported

- [ ] **Step 3: Реализация** (дополнить `backup.js`; импорты: `readFileSync` уже есть, `resolveBackupDir`, `buildJsonl`, `validateImportEntry` из `./validation.js`, `maskEntry`)

```js
/**
 * Restore (spec §5.2): файл обязан быть в каталоге бэкапов (basename из list);
 * валидация sha256 + манифеста (fail-closed набор) + всех строк — ДО изменений;
 * merge (дефолт) / replace (двойной гейт: tool — нативный ask + replace:true;
 * cli — isTty + ввод namespace). Счёт: overwritten/added.
 */
export async function runRestore({ storage, backupCfg, effectiveKey, storageType, modelId, dim, file, replace = false, channel = "tool", isTty = false, confirmNamespace = null, maskPatterns, log, gitRoot }) {
  if (storageType !== "sqlite") throw new Error("memory_backup: v1 — только storage.type sqlite");
  const dir = resolveBackupDir(backupCfg.path, gitRoot);
  if (!file.startsWith(`${dir}${sep()}`)) throw new Error("memory_backup: файл должен быть бэкапом из memory.backup.path (каталог бэкапов)");

  const manifestPath = file.endsWith(".jsonl") ? `${file.slice(0, -".jsonl".length)}.manifest.json` : file;
  if (!existsSync(manifestPath)) throw new Error("memory_backup: нет манифеста (fail-closed)");
  const meta = JSON.parse(readFileSync(manifestPath, "utf8"));
  const raw = readFileSync(file, "utf8");
  if (createHash("sha256").update(raw).digest("hex") !== meta.sha256) throw new Error("memory_backup: sha256 не совпадает (порча или подмена файла)");

  if (meta.storage_type !== storageType) throw new Error(`memory_backup: storage_type не совпадает (манифест: ${meta.storage_type})`);
  if (meta.key !== effectiveKey) throw new Error(`memory_backup: key не совпадает (манифест: ${meta.key})`);
  if (meta.model_id !== modelId) throw new Error(`memory_backup: model_id не совпадает (манифест: ${meta.model_id})`);
  if (meta.dim !== dim) throw new Error(`memory_backup: dim не совпадает (манифест: ${meta.dim})`);
  if (!Array.isArray(meta.schema_fields) || !meta.schema_fields.every((f) => SCAN_FIELDS.includes(f))) throw new Error("memory_backup: schema_fields манифеста несовместимы (fail-closed)");
  const versionWarn = meta.plugin_version && meta.plugin_version !== process.env.MAESTRO_PLUGIN_VERSION ? `plugin_version: ${meta.plugin_version}` : null;

  const entries = [];
  for (let i = 0; i < raw.split("\n").length; i++) {
    const line = raw.split("\n")[i].trim();
    if (!line) continue;
    const parsed = JSON.parse(line); // бросит при не-JSON — до изменений
    const reason = validateImportEntry(parsed, storage, effectiveKey, maskPatterns.artifacts);
    if (reason) throw new Error(`memory_backup: строка ${i + 1} невалидна: ${reason}`);
    entries.push(parsed);
  }
  if (entries.length !== meta.count) throw new Error("memory_backup: count манифеста не совпадает с числом строк");

  if (replace) {
    if (channel === "cli") {
      if (!isTty) throw new Error("memory_backup: replace из не-интерактивного вызова запрещён — запустите CLI вручную");
      if (confirmNamespace !== effectiveKey) throw new Error("memory_backup: подтверждение replace не совпадает с namespace");
    }
    await storage.deleteByFilter({ key: effectiveKey }); // ПОСЛЕ успешной валидации
  }

  const existing = new Set((await storage.scan({ key: effectiveKey, fields: ["session_id"] })).map((r) => r.session_id));
  const masked = entries.map((e) => maskEntry(e, { confidentialPatterns: maskPatterns.confidential, artifactConfidentialPatterns: maskPatterns.artifacts }));
  await storage.upsert(masked);
  const added = masked.filter((e) => !existing.has(e.session_id)).length;
  const overwritten = masked.length - added;
  log?.("memory:restore", { file, count: masked.length, mode: replace ? "replace" : "merge", overwritten, added, sha256: meta.sha256, warn: versionWarn });
  return { count: masked.length, mode: replace ? "replace" : "merge", overwritten, added, warn: versionWarn };
}

function sep() { return (typeof process !== "undefined" && process.platform === "win32") ? "\\" : "/"; }
```

- [ ] **Step 4: Проверить PASS + регрессия**

Run: `node --test plugins/maestro-bootstrap/memory/backup.test.js && npm run test:memory`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugins/maestro-bootstrap/memory/backup.js plugins/maestro-bootstrap/memory/backup.test.js
git commit -m "feat(memory): runRestore — fail-closed манифест, merge/replace-гейты, счёт overwritten/added"
```

---

### Task 6: CLI `backup-cli.js` + smoke-тест

**Files:**
- Create: `plugins/maestro-bootstrap/memory/backup-cli.js`
- Test: `plugins/maestro-bootstrap/memory/backup-cli.test.js`

- [ ] **Step 1: Написать failing-тест (smoke)** (`backup-cli.test.js`)

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

const CLI = new URL("./backup-cli.js", import.meta.url).pathname;

test("cli: --help → usage, exit 0", () => {
  const r = spawnSync(process.execPath, [CLI, "--help"], { encoding: "utf8" });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /backup.*restore.*list/s);
});

test("cli: вне git-репо / без maestro.json → понятная ошибка, exit 1", () => {
  const r = spawnSync(process.execPath, [CLI, "list"], { encoding: "utf8", cwd: "/tmp" });
  assert.equal(r.status, 1);
  assert.match(r.stdout + r.stderr, /maestro\.json|memory/i);
});
```

- [ ] **Step 2: Проверить FAIL**

Run: `node --test plugins/maestro-bootstrap/memory/backup-cli.test.js`
Expected: FAIL — нет файла CLI

- [ ] **Step 3: Реализация** (`backup-cli.js`)

Тонкая ESM-обёртка; **без side-effects при импорте** (вся работа в `main()` под `import.meta.url === ...`-проверкой):

```js
#!/usr/bin/env node
/**
 * Аварийный CLI memory backup/restore (spec §3). Ручной запуск пользователем
 * вне opencode. Тонкая обёртка над backup.js; конфиг/data-dir — через
 * loadMemoryConfig/resolveEffectiveKey; preflight схемы — createStorage+init.
 */
import { readFileSync, existsSync, appendFileSync, mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { loadMemoryConfig, resolveEffectiveKey, resolveBackupConfig, classifyMemoryConfig } from "./config.js";
import { createStorage } from "./storage.js";
import { runBackup, runRestore, listBackups, resolveBackupDir } from "./backup.js";

const HELP = `Использование: node backup-cli.js <command> [opts]
  backup                 — бэкап активной памяти (double-masking, retention)
  restore --file <путь> [--replace] — восстановление (replace — только интерактивно)
  list                   — список бэкапов
  --help
`;

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes("--help")) { process.stdout.write(HELP); return 0; }
  const [action, ...rest] = argv;
  if (!action || !["backup", "restore", "list"].includes(action)) { process.stdout.write(HELP); return 1; }

  const gitRoot = gitRootOf(cwd0());
  const maestroPath = join(gitRoot || cwd0(), "maestro.json");
  if (!existsSync(maestroPath)) { process.stderr.write(`backup-cli: не найден ${maestroPath}\n`); return 1; }
  const maestro = JSON.parse(readFileSync(maestroPath, "utf8"));
  const mem = maestro.memory;
  if (classifyMemoryConfig(mem).enabled !== true) { process.stderr.write("backup-cli: memory не включён (maestro.json → memory.enabled)\n"); return 1; }
  const config = loadMemoryConfig(mem);
  const backupCfg = resolveBackupConfig(mem);
  const effectiveKey = resolveEffectiveKey({ projectHash: null, namespace: config.namespace }); // резолв projectHash — как в index.js (root)
  const storage = await createStorage({ type: config.storage.type, options: storageOptions(config), modelId: config.embedding?.model ?? null, dim: config.embedding?.dim ?? null, textSearchConfig: config.storage.pgvector?.text_search_config, log: cliLog(gitRoot || cwd0()) }).then((s) => s.init ? s.init() : s).then((s) => s);
  const maskPatterns = resolvedPatterns(mem); // как в index.js: conf.paths + builtin (readConfidentialConfig)

  if (action === "list") {
    const rows = listBackups(resolveBackupDir(backupCfg.path, gitRoot || cwd0()), effectiveKey);
    process.stdout.write(rows.length ? rows.map((r) => `${r.file}  ts=${r.ts}  size=${r.size}B  manifest=${r.manifest_ok ? "ok" : "MISSING"}`).join("\n") + "\n" : "бэкапов нет\n");
    return 0;
  }
  if (action === "backup") {
    const r = await runBackup({ storage, backupCfg, effectiveKey, storageType: config.storage.type, modelId: storage.modelId, dim: storage.dim, pluginVersion: pluginVersionOf(), maskPatterns, log: (m, e) => cliLog(gitRoot || cwd0())(m, e), gitRoot: gitRoot || cwd0() });
    process.stdout.write(`OK: ${r.file}\nзаписей: ${r.count}${r.warn ? `\nWARN: ${r.warn} — каталог бэкапа НЕ в .gitignore (бэкапы могут попасть в git)\n` : ""}\n`);
    return 0;
  }
  // restore
  const fileArg = rest.indexOf("--file");
  const file = fileArg >= 0 ? resolve(rest[fileArg + 1]) : undefined;
  const replace = rest.includes("--replace");
  if (!file) { process.stderr.write("restore: укажите --file <путь к JSONL из list>\n"); return 1; }
  let confirm = null;
  if (replace) {
    if (!process.stdin.isTTY) { process.stderr.write("replace: доступен только из интерактивного терминала\n"); return 1; }
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    confirm = await new Promise((res) => rl.question(`Подтвердите replace — введите namespace (${effectiveKey}): `, (a) => { rl.close(); res(a.trim()); }));
  }
  const r = await runRestore({ storage, backupCfg, effectiveKey, storageType: config.storage.type, modelId: storage.modelId, dim: storage.dim, file, replace, channel: "cli", isTty: !!process.stdin.isTTY, confirmNamespace: confirm, maskPatterns, log: (m, e) => cliLog(gitRoot || cwd0())(m, e), gitRoot: gitRoot || cwd0() });
  process.stdout.write(`OK: restore (${r.mode}), записей: ${r.count}, перезаписано: ${r.overwritten}, добавлено: ${r.added}${r.warn ? `\nWARN: ${r.warn}\n` : ""}\n`);
  return 0;
}
// вспомогательные: cwd0()=process.cwd(); gitRootOf(dir)=spawnSync git rev-parse --show-toplevel (null при ошибке);
// pluginVersionOf() — require-free: читать package.json module_dir (dirname fileURLToPath(import.meta.url)/../package.json) → version;
// cliLog(root) — JSONL-append в .maestro/logs/maestro-bootstrap-<YYYY-MM-DD>.log (mkdir recursive), при ошибке — warn в stderr;
// storageOptions(config)/resolvedPatterns(mem) — те же резолвы, что в registerMemoryHooks (qdrant/pgvector-опции; conf.paths+conf.builtin).

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().then((c) => process.exit(c)).catch((e) => { process.stderr.write(`backup-cli: ${e instanceof Error ? e.message : String(e)}\n`); process.exit(1); });
}
```

(В комментарии «вспомогательные» — реализовать при SDD: 4 функции по 3-10 строк; точные резолвы `storageOptions`/`resolvedPatterns` копировать из `registerMemoryHooks` (index.js:750-830), не дублировать логику — при возможности вынести общий helper.)

- [ ] **Step 4: Проверить PASS**

Run: `node --test plugins/maestro-bootstrap/memory/backup-cli.test.js`
Expected: PASS

- [ ] **Step 5: Ручной smoke в репо**

Run: `node plugins/maestro-bootstrap/memory/backup-cli.js list` (в корне репо, с module_dir deps: `cd .maestro/memory/module && npm install`, если ещё не установлено)
Expected: `бэкапов нет` (или список) — без stack trace.

- [ ] **Step 6: Commit**

```bash
git add plugins/maestro-bootstrap/memory/backup-cli.js plugins/maestro-bootstrap/memory/backup-cli.test.js
git commit -m "feat(memory): backup-cli.js — аварийный CLI (backup/restore/list) без opencode"
```

---

### Task 7: Tool `memory_backup` в `registerMemoryHooks` + ask-gate тест

**Files:**
- Modify: `plugins/maestro-bootstrap/memory/index.js` (блок после `memory_import`, ~строка 1556)
- Test: `plugins/maestro-bootstrap/memory/index.test.js`

- [ ] **Step 1: Написать failing-тест** (в `index.test.js`)

```js
test("ask-gate contract: memory_backup — permission ask (write/boundary-tool)", () => {
  // паттерн существующего ask-gate contract-теста (строка ~2623): проверить,
  // что MERGE_CONFIG_PERMISSIONS (или канон-константа, где перечислены
  // memory_*: "ask") содержит memory_backup
  assert.ok(ASK_TOOLS.includes("memory_backup"), "memory_backup должен быть в списке ask-тулов");
});
```
(Если ask-gate-тест проверяет не константу, а merge-config-артефакт — адаптировать под тот же механизм; канон-список ask-тулов в этом репо — в `skills/maestro-setup/SKILL.md`/`maestro-assistant` SKILL.md, в плагине — где уже перечислены `memory_forget/export/import/migrate`.)

- [ ] **Step 2: Проверить FAIL**

Run: `node --test plugins/maestro-bootstrap/memory/index.test.js -g "ask-gate"`
Expected: FAIL

- [ ] **Step 3: Реализация** — в `index.js`, после блока `memory_import` (в том же объекте tools), добавить:

```js
      memory_backup: tool({
        description:
          "Бэкап/восстановление данных memory layer (v1, sqlite). action: backup (double-masking, gitignore-warn, retention) | restore (merge по умолчанию; replace — только с явным replace: true) | list (бэкапы в memory.backup.path).",
        args: {
          action: tool.schema.string().describe("backup | restore | list"),
          file: tool.schema.string().optional().describe("restore: путь к JSONL из list (только внутри memory.backup.path)"),
          replace: tool.schema.boolean().optional().describe("restore: true — очистить активный key (аварийно; только явное подтверждение)"),
        },
        execute: async (args, ctx) => {
          try {
            if (SESSIONS.has(ctx?.sessionID)) return "memory_backup недоступен для служебных сессий.";
            if (!args?.action) return "memory_backup: укажите action (backup | restore | list)";
            const backupCfg = resolveBackupConfig(maestroConfig?.memory);
            const dir = resolveBackupDir(backupCfg.path, root);
            if (args.action === "list") {
              const rows = listBackups(dir, effectiveKey);
              if (!rows.length) return "memory_backup: бэкапов нет";
              return rows.map((r) => `${r.file}  ts=${r.ts}  size=${r.size}B  manifest=${r.manifest_ok ? "ok" : "MISSING"}`).join("\n");
            }
            if (args.action === "backup") {
              const r = await runBackup({ storage, backupCfg, effectiveKey, storageType: config.storage.type, modelId: storage.modelId, dim: storage.dim, pluginVersion: PLUGIN_VERSION, maskPatterns: { confidential: confidentialPaths, artifacts: artifactConfidentialPatterns }, log: logInfo, gitRoot: root });
              return `OK: ${r.file}\nзаписей: ${r.count}${r.warn ? `\nWARN: ${r.warn} — каталог бэкапа НЕ в .gitignore` : ""}`;
            }
            if (args.action === "restore") {
              if (!args.file) return "memory_backup: restore требует file (уточните через action: \"list\")";
              const r = await runRestore({ storage, backupCfg, effectiveKey, storageType: config.storage.type, modelId: storage.modelId, dim: storage.dim, file: resolve(args.file), replace: args.replace === true, channel: "tool", maskPatterns: { confidential: confidentialPaths, artifacts: artifactConfidentialPatterns }, log: logInfo, gitRoot: root });
              return `OK: restore (${r.mode}), записей: ${r.count}, перезаписано: ${r.overwritten}, добавлено: ${r.added}${r.warn ? `\nWARN: ${r.warn}` : ""}`;
            }
            return "memory_backup: неизвестный action (backup | restore | list)";
          } catch (err) {
            return `memory_backup failed: ${err instanceof Error ? err.message : String(err)}`;
          }
        },
      }),
```

Импорт в `index.js`: `import { runBackup, runRestore, listBackups, resolveBackupDir } from "./backup.js";` + `resolveBackupConfig` уже из `./config.js`. (`PLUGIN_VERSION` — существующая константа плагина; `confidentialPaths`/`artifactConfidentialPatterns`/`effectiveKey`/`root`/`logInfo` — существующие замыкания `registerMemoryHooks`.)

- [ ] **Step 4: Проверить PASS + регрессия**

Run: `node --test plugins/maestro-bootstrap/memory/index.test.js && npm test && npm run test:memory`
Expected: PASS (все)

- [ ] **Step 5: Commit**

```bash
git add plugins/maestro-bootstrap/memory/index.js plugins/maestro-bootstrap/memory/index.test.js
git commit -m "feat(memory): tool memory_backup (backup|restore|list) в registerMemoryHooks"
```

---

### Task 8: Merge-config + команда `@maestro-memory-backup`

**Files:**
- Modify: `.opencode/opencode.json` (gitignored, merge-config этого репо)
- Create: `commands/maestro-memory-backup.md`
- Modify: `skills/maestro-setup/SKILL.md` (генератор merge-config: добавить `memory_backup: "ask"` в канон-блок permissions памяти)

- [ ] **Step 1: Merge-config**

В `permission`-блоке `.opencode/opencode.json` (рядом с `memory_forget/export/import/migrate: "ask"`) добавить:

```json
"memory_backup": "ask"
```

(Идемпотентно; если при этом обнаружится дрейф — отсутствие `memory_prune`/`memory_reindex` — добавить их тоже, уведомив HITL: это исправление дрейфа, не новая фича.)

- [ ] **Step 2: `skills/maestro-setup/SKILL.md`** — в канон-блок merge-config (где перечислены `memory_forget: "ask", memory_export: "ask", ...`) добавить `"memory_backup": "ask"` (+ `memory_prune`, `memory_reindex`, если отсутствуют — синхронно с фактическим каноном).

- [ ] **Step 3: Команда** (`commands/maestro-memory-backup.md`)

```markdown
---
description: HITL-бэкап и восстановление данных memory layer (list → выбор → backup/restore)
---

# @maestro-memory-backup

Бэкап и восстановление данных **memory layer** с HITL-подтверждением.

**Язык:** все сообщения пользователю — только на русском.

## Шаг 1. Доступность

Если `memory_backup` tool недоступен (память не включена) — сообщить и завершить.

## Шаг 2. Листинг

Вызвать `memory_backup` с `action: "list"`. Показать список (файл, ts, size, статус манифеста).

## Шаг 3. Действие (HITL)

Вопрос: (a) backup — (b) restore (выбрать файл из листинга; merge по умолчанию) — (c) restore --replace (аварийно) — (d) отмена.

- (a) → `memory_backup` `action: "backup"` → показать вывод (в т.ч. WARN про gitignore).
- (b) → `memory_backup` `action: "restore", file: <выбранный>` → показать счёт (перезаписано/добавлено).
- (c) → **явное предупреждение**: «будет удалена ВСЯ память проекта, затем восстановлена из <файл>» → отдельное HITL-подтверждение → `memory_backup` `action: "restore", file: <файл>, replace: true` (нативный `ask` сработает дополнительно).
- (d) → завершить.

## Аварийный CLI (без opencode)

Команда НЕ вызывает CLI через bash. При запросе пользователя на восстановление без
opencode — показать инструкцию:

```
node <module_dir>/memory/backup-cli.js list
node <module_dir>/memory/backup-cli.js restore --file <путь> [--replace]
```

(module_dir — из вывода `@maestro-memory`; replace — только из интерактивного терминала.)
```

- [ ] **Step 4: Проверка**

Run: `node -e 'JSON.parse(require("fs").readFileSync(".opencode/opencode.json","utf8"))' && npm test`
Expected: валидный JSON; тесты PASS.

- [ ] **Step 5: Commit**

```bash
git add commands/maestro-memory-backup.md skills/maestro-setup/SKILL.md
git commit -m "feat(memory): команда @maestro-memory-backup + memory_backup: ask в merge-config каноне"
```

(.opencode/opencode.json не коммитится — gitignored.)

---

### Task 9: Docs-синхронизация (канон-точки spec §10)

**Files:** (все Modify, кроме how-to — Create)
- `manual_docs/reference/memory.md`
- `manual_docs/how-to/memory-backup-restore.md` (**новый**)
- `manual_docs/reference/config.md` (permission-блок)
- `manual_docs/how-to/enable-memory.md` (permission-список)
- `manual_docs/reference/commands.md` (новая команда)
- `manual_docs/explanation/agents-and-trust.md` (зеркало SECURITY.md)
- `manual_docs/reference/model-selection.md` (зеркало SECURITY.md)
- `SECURITY.md` §5a
- `AGENTS.md` (memory-строка)
- `plugins/maestro-bootstrap/README.md` (permission-список + события лога)
- `skills/maestro-assistant/SKILL.md` (канон: `memory.backup` в JSON-каноне + `memory_backup` в ask-тулах)
- `manual_docs/overview/changelog.md` (секция 4.7.0)

- [ ] **Step 1: `manual_docs/reference/memory.md`** — раздел tool `memory_backup` (action, аргументы, гейты) + ключи `memory.backup.{path,retention}` (дефолты, семантика retention 0 = off, soft fallback) + CLI-секция (аварийный запуск).

- [ ] **Step 2: `manual_docs/how-to/memory-backup-restore.md`** (новый) — пошагово: (1) штатный бэкап через `@maestro-memory-backup`; (2) восстановление merge; (3) аварийный replace (предупреждение + двойное подтверждение); (4) CLI без opencode (в т.ч. с другой машины: bootstrap-последовательность `git clone maestro`/agpack → первый запуск opencode (self-provision module_dir) → `npm install` в module_dir → CLI); (5) раздел «Бэкапы — только в приватные репо» (C3) + модель «коммит = осознанная настройка» (дефолт `.maestro/memory/backup` под `.maestro/` — не коммитится; override пути или gitignore-исключение → warn при каждом бэкапе); (6) restore при закрытом opencode (SQLITE_BUSY); (7) restore устаревшего бэкапа в merge откатывает свежие записи (для DR — replace); (8) sha256 — детекция порчи, не защита от подделки; (9) escape-hatch: отказ restore из-за смены `schema_fields` → восстановить пином версии плагина, создавшей бэкап, затем апгрейд; (10) предупреждение: дефолтный путь — machine-local (эфемерный), долговечность — только осознанный override.

- [ ] **Step 3: `SECURITY.md` §5a** — добавить backup/restore в канон write/boundary-операций памяти (ask) + инъекционный контур restore-файла (недоверенный ввод; валидация + maskEntry + replace-гейты). Зеркала: `agents-and-trust.md`, `model-selection.md` (короткие правки по правилу AGENTS.md).

- [ ] **Step 4: Остальные точки** — `config.md` (permission-блок: `memory_backup: "ask"`), `enable-memory.md` (permission-список), `commands.md` (описание команды), `AGENTS.md` (memory-строка: добавить `memory_backup` в перечисление tools/команд), `plugins/maestro-bootstrap/README.md` (permission-список + log-события `memory:backup`/`memory:restore`), `skills/maestro-assistant/SKILL.md` (JSON-канон: секция `backup` в `memory`; ask-тулы: `memory_backup: "ask"`).

- [ ] **Step 5: Changelog** (`manual_docs/overview/changelog.md`) — секция 4.7.0: «Backup/restore memory layer (sqlite)».

- [ ] **Step 6: Проверка**

Run: `grep -rn "memory_prune\|maestro-memory-prune" manual_docs/ SECURITY.md AGENTS.md plugins/maestro-bootstrap/README.md skills/ | grep -v changelog | grep -v "plans/" | grep -v "specs/"`
Expected: каждая найденная канон-точка покрыта правкой (в той же точке появился `memory_backup`/`maestro-memory-backup`).

- [ ] **Step 7: Commit**

```bash
git add manual_docs/ SECURITY.md AGENTS.md plugins/maestro-bootstrap/README.md skills/
git commit -m "docs(memory): backup/restore — manual_docs/SECURITY/AGENTS/README/каноны (spec §10)"
```

---

### Task 10: Regression entry + version bump + финальная верификация

**Files:**
- Create: `regression/entries/2026-09-22-memory-backup-restore.md`
- Modify: `package.json` (4.6.1 → 4.7.0)
- Modify: `TODO.md` (локальный, gitignored — отметить #101 как реализованный)

- [ ] **Step 1: Regression entry** — по формату существующих `regression/entries/*.md`: фича, риск (data-loss/injection при restore), триггер регрессии (повторное удаление памяти после restore; нарушение retention-паттерна; обход maskEntry при бэкапе), проверка.

- [ ] **Step 2: Version bump**

```bash
node -e 'const fs=require("fs");const p="package.json";const j=JSON.parse(fs.readFileSync(p,"utf8"));j.version="4.7.0";fs.writeFileSync(p,JSON.stringify(j,null,2)+"\n")'
```

- [ ] **Step 3: Финальная верификация**

Run: `npm test && npm run test:memory`
Expected: PASS (все).

Run: grep-верификация (паттерн из Task 9 Step 6, расширенный до дефисных форм): `grep -rn "memory[-_]prune" manual_docs/ SECURITY.md AGENTS.md plugins/maestro-bootstrap/README.md skills/ | grep -v changelog | grep -vE "(plans/|specs/)"`
Expected: в каждой канон-точке есть и `memory[-_]backup`.

- [ ] **Step 4: E2E-manual smoke (HITL-наблюдение)**

1. `@maestro-memory-backup` → list (пусто) → backup → OK + warn `not_a_git_repo`/`not_ignored` по факту.
2. Повторный backup × 4 → retention (default 3) оставил 3 пары.
3. `restore` merge из бэкапа → счёт корректен.
4. `restore --replace` через HITL (два подтверждения) → память восстановлена.

- [ ] **Step 5: Commit**

```bash
git add regression/entries/2026-09-22-memory-backup-restore.md package.json
git commit -m "chore: bump version to 4.7.0 — memory backup/restore (regression entry + version)"
```

- [ ] **Step 6: TODO.md (локально)** — отметить #101: `- [x] ... → ✅ реализовано (2026-09-22, 4.7.0): ...`.

---

## Self-Review (выполнено при написании)

1. **Spec coverage:** §3 артефакты → Tasks 1-8; §4 формат → Tasks 3,5; §5.1 → Task 4; §5.2 → Task 5,7; §6 конфиг → Task 2; §7 (module_dir-гигиена: бэкапы вне module_dir — Task 3/4 path от git-корня; версионирование — манифест Task 3/5; SQLITE_BUSY — how-to Task 9) → Tasks 4,5,9; §8 security → Tasks 4,5,7,8,9; §9 тесты → Tasks 1-7 (все 11 пунктов); §10 docs → Task 9; §11 DoD → Tasks 9,10.
2. **Placeholders:** проверено — все шаги с кодом/командами; CLI-вспомогательные функции (Task 6) описаны с точными источниками резолвов (index.js:750-830) — допустимая детализация при SDD (рефакторинг-копирование, не дизайн).
3. **Type consistency:** `runBackup`/`runRestore`/`listBackups`/`resolveBackupDir`/`backupBaseName`/`buildJsonl`/`buildManifestMeta`/`applyRetention`/`gitIgnoreWarn` — сигнатуры согласованы между Task 3-7; `maskPatterns: {confidential, artifacts}` сквозной; `channel: "tool"|"cli"` согласован Task 5/6/7.
