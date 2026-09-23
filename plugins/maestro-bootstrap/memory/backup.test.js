import { createHash } from "node:crypto";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, existsSync, rmSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, isAbsolute } from "node:path";
import { backupBaseName, buildJsonl, buildManifestMeta, applyRetention, listBackups, resolveBackupDir, gitIgnoreWarn, gitIgnoreFallback, runBackup, runRestore, BACKUP_FORMAT } from "./backup.js";
import { SCAN_FIELDS } from "./backfill.js";

const KEY = "test-ns";
const tmp = () => mkdtempSync(join(tmpdir(), "maestro-backup-"));

// ── Common helpers ──

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

const ROW = {
  session_id: "s1",
  key: "test-ns",
  title: "test title",
  summary: "raw secret value here",
  embedding: [1, 2, 3, 4, 5, 6, 7, 8],
  model_id: "mm",
};

// ── backupBaseName ──

test("backupBaseName: backup-<key>-<ts>", () => {
  assert.equal(backupBaseName(KEY, 1758000000000), `backup-${KEY}-1758000000000`);
});

test("backupBaseName: ts=0", () => {
  assert.equal(backupBaseName("x", 0), "backup-x-0");
});

// ── buildJsonl ──

test("buildJsonl: одна строка на запись + trailing newline", () => {
  assert.equal(buildJsonl([{ a: 1 }]), '{"a":1}\n');
});

test("buildJsonl: несколько записей", () => {
  assert.equal(buildJsonl([{ a: 1 }, { b: 2 }]), '{"a":1}\n{"b":2}\n');
});

test("buildJsonl: пусто → ''", () => {
  assert.equal(buildJsonl([]), "");
});

test("buildJsonl: запись с вложенными полями сериализуется корректно", () => {
  const obj = { session_id: "s1", author: "bot", nested: { x: 1 } };
  const lines = buildJsonl([obj]).trimEnd().split("\n");
  assert.equal(lines.length, 1);
  assert.deepEqual(JSON.parse(lines[0]), obj);
});

// ── buildManifestMeta ──

test("buildManifestMeta: полный набор полей + sha256 тела", () => {
  const m = buildManifestMeta({
    entries: [{ a: 1 }],
    key: KEY,
    storageType: "sqlite",
    modelId: "mm",
    dim: 384,
    pluginVersion: "4.7.0",
    ts: 111,
  });
  assert.equal(m.format, "maestro-memory-backup/v1");
  assert.equal(m.key, KEY);
  assert.equal(m.count, 1);
  assert.equal(m.storage_type, "sqlite");
  assert.equal(m.plugin_version, "4.7.0");
  assert.ok(Array.isArray(m.schema_fields) && m.schema_fields.includes("session_id"));
  assert.match(m.sha256, /^[a-f0-9]{64}$/);
});

test("buildManifestMeta: пустые записи → sha256 от empty string", () => {
  const m = buildManifestMeta({
    entries: [],
    key: KEY,
    storageType: "qdrant",
    modelId: "emb/v1",
    dim: 1536,
    pluginVersion: "5.0.0",
    ts: 999,
  });
  assert.equal(m.count, 0);
  assert.equal(m.storage_type, "qdrant");
  assert.equal(m.dim, 1536);
  assert.equal(m.sha256, createHash("sha256").update("").digest("hex"));
});

test("buildManifestMeta: sha256 детерминирован", () => {
  const e = [{ session_id: "s1", a: 2 }];
  const m1 = buildManifestMeta({ entries: e, key: "k", storageType: "sqlite", modelId: "m", dim: 3, pluginVersion: "1.0", ts: 1 });
  const m2 = buildManifestMeta({ entries: e, key: "k", storageType: "sqlite", modelId: "m", dim: 3, pluginVersion: "1.0", ts: 999 });
  assert.equal(m1.sha256, m2.sha256, "sha256 не зависит от ts/key");
});

// ── applyRetention ──

test("applyRetention: хранит последние N пар, удаляет старые; чужие файлы не трогает", () => {
  const dir = tmp();
  try {
    for (const ts of [1, 2, 3, 4]) {
      for (const s of [".jsonl", ".manifest.json"]) writeFileSync(join(dir, `backup-${KEY}-${ts}${s}`), "x");
    }
    writeFileSync(join(dir, "backup-OTHER-1.jsonl"), "x");
    const stale = applyRetention(dir, KEY, 2);
    assert.deepEqual(stale.sort(), [`backup-${KEY}-1`, `backup-${KEY}-2`]);
    assert.ok(existsSync(join(dir, `backup-${KEY}-4.jsonl`)));
    assert.ok(existsSync(join(dir, `backup-${KEY}-4.manifest.json`)));
    assert.ok(existsSync(join(dir, "backup-OTHER-1.jsonl")));
    assert.ok(!existsSync(join(dir, `backup-${KEY}-1.jsonl`)));
    assert.ok(!existsSync(join(dir, `backup-${KEY}-1.manifest.json`)));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("applyRetention: retention 0 → ничего не удаляет", () => {
  const dir = tmp();
  try {
    for (const s of [".jsonl", ".manifest.json"]) writeFileSync(join(dir, `backup-${KEY}-1${s}`), "x");
    assert.deepEqual(applyRetention(dir, KEY, 0), []);
    assert.ok(existsSync(join(dir, `backup-${KEY}-1.jsonl`)));
    assert.ok(existsSync(join(dir, `backup-${KEY}-1.manifest.json`)));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("applyRetention: nonexistent dir → []", () => {
  assert.deepEqual(applyRetention("/nonexistent/dir", KEY, 3), []);
});

test("applyRetention: меньше retention пар → ничего не удаляет", () => {
  const dir = tmp();
  try {
    for (const ts of [1, 2]) {
      for (const s of [".jsonl", ".manifest.json"]) writeFileSync(join(dir, `backup-${KEY}-${ts}${s}`), "x");
    }
    const stale = applyRetention(dir, KEY, 5);
    assert.deepEqual(stale, []);
    assert.ok(existsSync(join(dir, `backup-${KEY}-2.jsonl`)));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("applyRetention: удаляет orphan .jsonl-пару при retention=1, полная пара сохраняется", () => {
  const dir = tmp();
  try {
    // orphan: .jsonl без .manifest.json (ts=1)
    writeFileSync(join(dir, `backup-${KEY}-1.jsonl`), "x");
    // полная пара (ts=2)
    writeFileSync(join(dir, `backup-${KEY}-2.jsonl`), "x");
    writeFileSync(join(dir, `backup-${KEY}-2.manifest.json`), "{}");
    const stale = applyRetention(dir, KEY, 1);
    assert.deepEqual(stale.sort(), [`backup-${KEY}-1`]);
    assert.ok(!existsSync(join(dir, `backup-${KEY}-1.jsonl`)));
    assert.ok(existsSync(join(dir, `backup-${KEY}-2.jsonl`)));
    assert.ok(existsSync(join(dir, `backup-${KEY}-2.manifest.json`)));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── listBackups ──

test("listBackups: пары по убыванию ts", () => {
  const dir = tmp();
  try {
    for (const ts of [1, 2]) {
      for (const s of [".jsonl", ".manifest.json"]) writeFileSync(join(dir, `backup-${KEY}-${ts}${s}`), "x");
    }
    const list = listBackups(dir, KEY);
    assert.deepEqual(list.map((r) => r.ts), [2, 1]);
    assert.equal(list[0].file, join(dir, `backup-${KEY}-2.jsonl`));
    assert.equal(list[0].manifest_ok, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("listBackups: нет каталога → []", () => {
  assert.deepEqual(listBackups(join(tmpdir(), "nope"), KEY), []);
});

test("listBackups: пустой каталог → []", () => {
  const dir = tmp();
  try {
    assert.deepEqual(listBackups(dir, KEY), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("listBackups: без .manifest.json → manifest_ok=false", () => {
  const dir = tmp();
  try {
    writeFileSync(join(dir, `backup-${KEY}-42.jsonl`), "x");
    const list = listBackups(dir, KEY);
    assert.equal(list.length, 1);
    assert.equal(list[0].ts, 42);
    assert.equal(list[0].manifest_ok, false);
    assert.ok(list[0].jsonl);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("listBackups: size из статистики файла", () => {
  const dir = tmp();
  try {
    const content = "x".repeat(100);
    writeFileSync(join(dir, `backup-${KEY}-1.jsonl`), content);
    writeFileSync(join(dir, `backup-${KEY}-1.manifest.json`), "{}");
    const list = listBackups(dir, KEY);
    assert.equal(list[0].size, 100);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("listBackups: фильтрует файлы не от нашего key", () => {
  const dir = tmp();
  try {
    for (const s of [".jsonl", ".manifest.json"]) {
      writeFileSync(join(dir, `backup-${KEY}-1${s}`), "x");
      writeFileSync(join(dir, `backup-OTHER-1${s}`), "x");
    }
    const list = listBackups(dir, KEY);
    assert.equal(list.length, 1);
    assert.equal(list[0].ts, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("listBackups: сортировка по убыванию ts при большом наборе", () => {
  const dir = tmp();
  try {
    for (const ts of [10, 3, 7, 1, 5]) {
      for (const s of [".jsonl", ".manifest.json"]) writeFileSync(join(dir, `backup-${KEY}-${ts}${s}`), "x");
    }
    const list = listBackups(dir, KEY);
    assert.deepEqual(list.map((r) => r.ts), [10, 7, 5, 3, 1]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── resolveBackupDir ──

test("resolveBackupDir: gitRoot + relPath → абсолютный путь", () => {
  assert.equal(resolveBackupDir("a/b", "/root"), join("/root", "a", "b"));
});

test("resolveBackupDir: gitRoot=null → cwd + relPath", () => {
  const expected = join(process.cwd(), "a/b");
  assert.equal(resolveBackupDir("a/b", null), expected);
});

test("resolveBackupDir: абсолютный relPath → как есть", () => {
  assert.equal(resolveBackupDir("/abs/x", "/root"), "/abs/x");
});

// ── gitIgnoreWarn ──

test("gitIgnoreWarn: не-git-репо → not_a_git_repo", () => {
  const r = gitIgnoreWarn("/tmp/whatever", null);
  assert.equal(r.ignored, false);
  assert.equal(r.reason, "not_a_git_repo");
});

test("gitIgnoreWarn: gitignored-путь в реальном репо → ignored", () => {
  const r = gitIgnoreWarn(".maestro/memory/backup", process.cwd());
  assert.equal(r.ignored, true);
});

test("gitIgnoreWarn: не-gitignored-путь → not_ignored", () => {
  const r = gitIgnoreWarn("some/random/path", process.cwd());
  assert.equal(r.ignored, false);
  assert.equal(r.reason, "not_ignored");
});

// ── gitIgnoreFallback ──

test("gitIgnoreFallback: относительный путь матчится по .gitignore → ignored", () => {
  const baseDir = mkdtempSync(join(tmpdir(), "mb-fb-"));
  try {
    writeFileSync(join(baseDir, ".gitignore"), ".maestro/\n");
    const r = gitIgnoreFallback(".maestro/memory/backup", baseDir);
    assert.equal(r.ignored, true);
    assert.equal(r.reason, null);
  } finally {
    rmSync(baseDir, { recursive: true, force: true });
  }
});

test("gitIgnoreFallback: путь не матчится → not_ignored_fallback", () => {
  const baseDir = mkdtempSync(join(tmpdir(), "mb-fb-"));
  try {
    writeFileSync(join(baseDir, ".gitignore"), ".maestro/\n");
    const r = gitIgnoreFallback("backups/mem", baseDir);
    assert.equal(r.ignored, false);
    assert.equal(r.reason, "not_ignored_fallback");
  } finally {
    rmSync(baseDir, { recursive: true, force: true });
  }
});

// ── Helpers для runRestore ──

const RESTORE_KEY = "test-ns-12345";

function mkEntry(i, extra = {}) {
  return {
    session_id: `s${i}`,
    key: RESTORE_KEY,
    origin_project_hash: "abc123",
    title: `t${i}`,
    summary: `sum${i}`,
    decisions: [],
    author: "test",
    time_first: 1000,
    time_last: 2000,
    version: 1,
    model_id: "mm",
    embedding: [1, 2, 3, 4, 5, 6, 7, 8],
    ...extra,
  };
}

function writeBackupPair(dir, { key = RESTORE_KEY, entries, ts = 555, manifest } = {}) {
  const base = `backup-${key}-${ts}`;
  const jsonl = entries.map((e) => JSON.stringify(e)).join("\n") + "\n";
  writeFileSync(join(dir, `${base}.jsonl`), jsonl, "utf8");
  const meta = {
    format: BACKUP_FORMAT,
    plugin_version: "4.7.0",
    schema_fields: [...SCAN_FIELDS],
    model_id: "mm",
    dim: 8,
    key,
    ts,
    count: entries.length,
    sha256: createHash("sha256").update(jsonl).digest("hex"),
    storage_type: "sqlite",
    ...manifest,
  };
  writeFileSync(join(dir, `${base}.manifest.json`), JSON.stringify(meta), "utf8");
  return join(dir, `${base}.jsonl`);
}

// ── runRestore ──

test("runRestore merge: upsert; счёт overwritten/added", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mr-"));
  try {
    const storage = mkMockStorage([mkEntry(1)]); // s1 уже в БД
    const file = writeBackupPair(dir, { entries: [mkEntry(1), mkEntry(2)] });
    const r = await runRestore({
      storage, backupCfg: { path: dir }, effectiveKey: RESTORE_KEY,
      storageType: "sqlite", modelId: "mm", dim: 8, file,
      replace: false, channel: "tool",
      maskPatterns: { confidential: [], artifacts: [] },
    });
    assert.equal(r.mode, "merge");
    assert.equal(r.count, 2);
    assert.equal(r.overwritten, 1);
    assert.equal(r.added, 1);
    assert.equal(storage.upserts.length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("runRestore: embedding → Float32Array перед upsert (parity memory_import; sqlite BLOB)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mr-f32-"));
  try {
    // Реальный sqlite upsert читает e.embedding.buffer/byteOffset (TypedArray);
    // plain number[] из JSONL → Buffer.from(undefined) → crash.
    const storage = mkMockStorage([]);
    const file = writeBackupPair(dir, { entries: [mkEntry(1)] });
    await runRestore({
      storage, backupCfg: { path: dir }, effectiveKey: RESTORE_KEY,
      storageType: "sqlite", modelId: "mm", dim: 8, file,
      replace: false, channel: "tool",
      maskPatterns: { confidential: [], artifacts: [] },
    });
    const up = storage.upserts[0][0];
    assert.ok(up.embedding instanceof Float32Array, "embedding перед upsert — Float32Array");
    assert.deepEqual(Array.from(up.embedding), [1, 2, 3, 4, 5, 6, 7, 8]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("runRestore merge: maskEntry — confidential маскирует summary", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mr-mask-"));
  try {
    const storage = mkMockStorage([]);
    // maskLines матчит token (до :) — паттерн должен совпадать с токеном строки
    const file = writeBackupPair(dir, { entries: [mkEntry(1, {
      summary: "confidential/value:raw secret value here\nother line",
    })] });
    const r = await runRestore({
      storage, backupCfg: { path: dir }, effectiveKey: RESTORE_KEY,
      storageType: "sqlite", modelId: "mm", dim: 8, file,
      replace: false, channel: "tool",
      maskPatterns: { confidential: ["confidential/**"], artifacts: [] },
    });
    assert.equal(r.mode, "merge");
    const upserted = storage.upserts[0];
    assert.equal(upserted.length, 1);
    // maskEntry маскирует title/summary — строка с confidential-токеном → "[confidential]"
    assert.ok(!String(upserted[0].summary).includes("confidential/value"), "confidential token не в upserted");
    assert.ok(String(upserted[0].summary).includes("[confidential]"), "маска на месте");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("runRestore: plugin_version warn (совпадение) → null", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mr-pv1-"));
  try {
    const storage = mkMockStorage([]);
    const file = writeBackupPair(dir, { entries: [mkEntry(1)] });
    const r = await runRestore({
      storage, backupCfg: { path: dir }, effectiveKey: RESTORE_KEY,
      storageType: "sqlite", modelId: "mm", dim: 8, file,
      pluginVersion: "4.7.0",
      maskPatterns: { confidential: [], artifacts: [] },
    });
    assert.equal(r.warn, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("runRestore: plugin_version warn (несовпадение) → содержит версию файла", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mr-pv2-"));
  try {
    const storage = mkMockStorage([]);
    const file = writeBackupPair(dir, { entries: [mkEntry(1)], manifest: { plugin_version: "4.0.0" } });
    const r = await runRestore({
      storage, backupCfg: { path: dir }, effectiveKey: RESTORE_KEY,
      storageType: "sqlite", modelId: "mm", dim: 8, file,
      pluginVersion: "4.7.0",
      maskPatterns: { confidential: [], artifacts: [] },
    });
    assert.ok(r.warn && r.warn.includes("4.0.0"), `warn содержит 4.0.0: ${r.warn}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("runRestore: plugin_version без pluginVersion → warn null", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mr-pv3-"));
  try {
    const storage = mkMockStorage([]);
    const file = writeBackupPair(dir, { entries: [mkEntry(1)], manifest: { plugin_version: "4.0.0" } });
    const r = await runRestore({
      storage, backupCfg: { path: dir }, effectiveKey: RESTORE_KEY,
      storageType: "sqlite", modelId: "mm", dim: 8, file,
      maskPatterns: { confidential: [], artifacts: [] },
    });
    assert.equal(r.warn, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("runRestore replace:true + fail валидации → deleteByFilter НЕ вызван", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mr-del-"));
  try {
    const calls = [];
    const storage = {
      ...mkMockStorage([]),
      async deleteByFilter() { calls.push("delete"); return 0; },
      async upsert() { calls.push("upsert"); return 0; },
    };
    const file = writeBackupPair(dir, { entries: [mkEntry(1)], manifest: { model_id: "other" } });
    await assert.rejects(
      () => runRestore({
        storage, backupCfg: { path: dir }, effectiveKey: RESTORE_KEY,
        storageType: "sqlite", modelId: "mm", dim: 8, file,
        replace: true, channel: "tool",
        maskPatterns: { confidential: [], artifacts: [] },
      }),
      /model_id/
    );
    assert.deepEqual(calls, [], "deleteByFilter/upsert не вызваны");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("runRestore: model_id в манифесте не совпадает → fail-closed, БД не изменена", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mr2-"));
  try {
    const storage = mkMockStorage([]);
    const file = writeBackupPair(dir, { entries: [mkEntry(1)], manifest: { model_id: "other" } });
    await assert.rejects(
      () => runRestore({
        storage, backupCfg: { path: dir }, effectiveKey: RESTORE_KEY,
        storageType: "sqlite", modelId: "mm", dim: 8, file,
        replace: false, channel: "tool",
        maskPatterns: { confidential: [], artifacts: [] },
      }),
      /model_id/
    );
    assert.equal(storage.upserts.length, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("runRestore: key в манифесте не совпадает → fail-closed", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mr3-"));
  try {
    const file = writeBackupPair(dir, { key: "different-key", entries: [mkEntry(1)] });
    await assert.rejects(
      () => runRestore({
        storage: mkMockStorage([]), backupCfg: { path: dir }, effectiveKey: RESTORE_KEY,
        storageType: "sqlite", modelId: "mm", dim: 8, file,
        replace: false, channel: "tool",
        maskPatterns: { confidential: [], artifacts: [] },
      }),
      /key/
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("runRestore: sha256 не совпадает (подмена/порча) → fail-closed", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mr4-"));
  try {
    const file = writeBackupPair(dir, { entries: [mkEntry(1)] });
    writeFileSync(file, '{"tampered":true}\n', "utf8");
    await assert.rejects(
      () => runRestore({
        storage: mkMockStorage([]), backupCfg: { path: dir }, effectiveKey: RESTORE_KEY,
        storageType: "sqlite", modelId: "mm", dim: 8, file,
        replace: false, channel: "tool",
        maskPatterns: { confidential: [], artifacts: [] },
      }),
      /sha256/
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("runRestore replace (tool): delete ПОСЛЕ валидации, до upsert; mode replace", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mr5-"));
  try {
    const calls = [];
    const storage = {
      ...mkMockStorage([]),
      async deleteByFilter() { calls.push("delete"); return 0; },
      async upsert(e) { calls.push("upsert"); return e.length; },
    };
    const file = writeBackupPair(dir, { entries: [mkEntry(1)] });
    const r = await runRestore({
      storage, backupCfg: { path: dir }, effectiveKey: RESTORE_KEY,
      storageType: "sqlite", modelId: "mm", dim: 8, file,
      replace: true, channel: "tool",
      maskPatterns: { confidential: [], artifacts: [] },
    });
    assert.deepEqual(calls, ["delete", "upsert"]);
    assert.equal(r.mode, "replace");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("runRestore replace (cli, не-tty) → отказ", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mr6-"));
  try {
    const file = writeBackupPair(dir, { entries: [mkEntry(1)] });
    await assert.rejects(
      () => runRestore({
        storage: mkMockStorage([]), backupCfg: { path: dir }, effectiveKey: RESTORE_KEY,
        storageType: "sqlite", modelId: "mm", dim: 8, file,
        replace: true, channel: "cli", isTty: false,
        maskPatterns: { confidential: [], artifacts: [] },
      }),
      /не-интерактив/
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("runRestore replace (cli, tty + confirm = key) → ok", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mr7-"));
  try {
    const storage = mkMockStorage([]);
    const file = writeBackupPair(dir, { entries: [mkEntry(1)] });
    await runRestore({
      storage, backupCfg: { path: dir }, effectiveKey: RESTORE_KEY,
      storageType: "sqlite", modelId: "mm", dim: 8, file,
      replace: true, channel: "cli", isTty: true,
      confirmNamespace: RESTORE_KEY,
      maskPatterns: { confidential: [], artifacts: [] },
    });
    assert.equal(storage.upserts.length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("runRestore replace (cli, confirm != key) → отказ", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mr8-"));
  try {
    const file = writeBackupPair(dir, { entries: [mkEntry(1)] });
    await assert.rejects(
      () => runRestore({
        storage: mkMockStorage([]), backupCfg: { path: dir }, effectiveKey: RESTORE_KEY,
        storageType: "sqlite", modelId: "mm", dim: 8, file,
        replace: true, channel: "cli", isTty: true,
        confirmNamespace: "other-ns",
        maskPatterns: { confidential: [], artifacts: [] },
      }),
      /подтверждени/
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("runRestore: файл вне каталога бэкапов → отказ", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mr9-"));
  const outsideDir = mkdtempSync(join(tmpdir(), "mr9-out-"));
  try {
    const outside = join(outsideDir, "backup-k1-555.jsonl");
    writeFileSync(outside, "x", "utf8");
    await assert.rejects(
      () => runRestore({
        storage: mkMockStorage([]), backupCfg: { path: dir }, effectiveKey: RESTORE_KEY,
        storageType: "sqlite", modelId: "mm", dim: 8, file: outside,
        replace: false, channel: "tool",
        maskPatterns: { confidential: [], artifacts: [] },
      }),
      /каталог/
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(outsideDir, { recursive: true, force: true });
  }
});

test("runRestore: ..-обход за пределами каталога → отказ", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mr-dotdot-"));
  try {
    const inside = join(dir, "backup-test-1.jsonl");
    writeFileSync(inside, "{}\n", "utf8");
    const outside = join(dir, "..", "outside.jsonl");
    await assert.rejects(
      () => runRestore({
        storage: mkMockStorage([]), backupCfg: { path: dir }, effectiveKey: RESTORE_KEY,
        storageType: "sqlite", modelId: "mm", dim: 8, file: outside,
        replace: false, channel: "tool",
        maskPatterns: { confidential: [], artifacts: [] },
      }),
      /каталог/
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("runRestore: count в манифесте не совпадает с числом строк → fail-closed", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mr10-"));
  try {
    const file = writeBackupPair(dir, { entries: [mkEntry(1)], manifest: { count: 5 } });
    await assert.rejects(
      () => runRestore({
        storage: mkMockStorage([]), backupCfg: { path: dir }, effectiveKey: RESTORE_KEY,
        storageType: "sqlite", modelId: "mm", dim: 8, file,
        replace: false, channel: "tool",
        maskPatterns: { confidential: [], artifacts: [] },
      }),
      /count/
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("runRestore: schema_fields в манифесте ≠ SCAN_FIELDS → отказ", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mr-schema-"));
  try {
    const file = writeBackupPair(dir, {
      entries: [mkEntry(1)],
      manifest: { schema_fields: ["session_id", "bogus_field"] },
    });
    await assert.rejects(
      () => runRestore({
        storage: mkMockStorage([]), backupCfg: { path: dir }, effectiveKey: RESTORE_KEY,
        storageType: "sqlite", modelId: "mm", dim: 8, file,
        replace: false, channel: "tool",
        maskPatterns: { confidential: [], artifacts: [] },
      }),
      /schema_fields/
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("runRestore: manifest не содержит format → fail-closed", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mr-format-"));
  try {
    const base = `backup-${RESTORE_KEY}-555`;
    const file = join(dir, `${base}.jsonl`);
    const jsonl = JSON.stringify(mkEntry(1)) + "\n";
    writeFileSync(file, jsonl, "utf8");
    const meta = {
      plugin_version: "4.7.0",
      model_id: "mm",
      dim: 8,
      key: RESTORE_KEY,
      ts: 555,
      count: 1,
      sha256: createHash("sha256").update(jsonl).digest("hex"),
      storage_type: "sqlite",
      schema_fields: [...SCAN_FIELDS],
      // format отсутствует
    };
    writeFileSync(join(dir, `${base}.manifest.json`), JSON.stringify(meta), "utf8");
    await assert.rejects(
      () => runRestore({
        storage: mkMockStorage([]), backupCfg: { path: dir }, effectiveKey: RESTORE_KEY,
        storageType: "sqlite", modelId: "mm", dim: 8, file,
        replace: false, channel: "tool",
        maskPatterns: { confidential: [], artifacts: [] },
      }),
      /формат/
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("runRestore: manifest format != BACKUP_FORMAT → fail-closed", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mr-format2-"));
  try {
    const base = `backup-${RESTORE_KEY}-555`;
    const file = join(dir, `${base}.jsonl`);
    const jsonl = JSON.stringify(mkEntry(1)) + "\n";
    writeFileSync(file, jsonl, "utf8");
    const meta = {
      format: "maestro-memory-backup/v0",
      plugin_version: "4.7.0",
      model_id: "mm",
      dim: 8,
      key: RESTORE_KEY,
      ts: 555,
      count: 1,
      sha256: createHash("sha256").update(jsonl).digest("hex"),
      storage_type: "sqlite",
      schema_fields: [...SCAN_FIELDS],
    };
    writeFileSync(join(dir, `${base}.manifest.json`), JSON.stringify(meta), "utf8");
    await assert.rejects(
      () => runRestore({
        storage: mkMockStorage([]), backupCfg: { path: dir }, effectiveKey: RESTORE_KEY,
        storageType: "sqlite", modelId: "mm", dim: 8, file,
        replace: false, channel: "tool",
        maskPatterns: { confidential: [], artifacts: [] },
      }),
      /формат/
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("runBackup: scan вызывается с fields = SCAN_FIELDS (полнота схемы v3)", async () => {
  const seen = {};
  const storage = {
    async scan({ fields }) { seen.fields = fields; return [ROW]; },
    async upsert() { return 1; },
    async deleteByFilter() { return 0; },
    dim: 8, modelId: "mm",
  };
  const dir = mkdtempSync(join(tmpdir(), "mb-fields-"));
  try {
    await runBackup({
      storage, backupCfg: { path: dir, retention: 0 },
      effectiveKey: "k1", storageType: "sqlite", modelId: "mm", dim: 8,
      pluginVersion: "4.7.0", maskPatterns: { confidential: [], artifacts: [] },
      gitRoot: null, now: () => 1,
    });
    assert.deepEqual(seen.fields, SCAN_FIELDS);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── runBackup ──

test("runBackup: scan → maskEntry → JSONL+манифест → warn → retention → audit", async () => {
  const baseDir = mkdtempSync(join(tmpdir(), "mb-run-"));
  try {
    // .gitignore → fallback
    writeFileSync(join(baseDir, ".gitignore"), "backup\n");
    const logs = [];
    const r = await runBackup({
      storage: mkMockStorage([{
        ...ROW,
        summary: "prefix\nexact-secret-value\nsuffix",
      }]),
      backupCfg: { path: ".", retention: 0 },
      effectiveKey: "k1",
      storageType: "sqlite",
      modelId: "mm",
      dim: 8,
      pluginVersion: "4.7.0",
      maskPatterns: { confidential: ["exact-secret-value"], artifacts: [] },
      log: (msg, extra) => logs.push({ msg, extra }),
      gitRoot: baseDir,
      now: () => 123,
    });
    // resolveBackupDir(".", baseDir) = baseDir
    assert.ok(existsSync(join(baseDir, "backup-k1-123.jsonl")));
    assert.ok(existsSync(join(baseDir, "backup-k1-123.manifest.json")));
    const body = JSON.parse(readFileSync(join(baseDir, "backup-k1-123.jsonl"), "utf8"));
    // maskEntry заменяет confidential line на "[confidential]"
    assert.ok(!String(body.summary).includes("exact-secret-value"), "maskEntry обязателен");
    assert.ok(String(body.summary).includes("[confidential]"), "формат маски — [confidential]");
    const meta = JSON.parse(readFileSync(join(baseDir, "backup-k1-123.manifest.json"), "utf8"));
    assert.equal(meta.count, 1);
    assert.equal(r.warn, "not_ignored_fallback");
    assert.ok(logs.some((l) => l.msg === "memory:backup" && l.extra.count === 1));
  } finally {
    rmSync(baseDir, { recursive: true, force: true });
  }
});

test("runBackup: 0 записей → отказ, файлы не создаются", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mb-empty-"));
  try {
    await assert.rejects(
      () => runBackup({
        storage: mkMockStorage([]),
        backupCfg: { path: dir, retention: 0 },
        effectiveKey: "k1",
        storageType: "sqlite",
        modelId: "mm",
        dim: 8,
        pluginVersion: "4.7.0",
        maskPatterns: { confidential: [], artifacts: [] },
        gitRoot: null,
      }),
      /нет записей/
    );
    assert.deepEqual(readdirSync(dir), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("runBackup: storage.type != sqlite → отказ (sqlite-only guard)", async () => {
  await assert.rejects(
    () => runBackup({
      storage: mkMockStorage([ROW]),
      backupCfg: { path: "/tmp/x", retention: 0 },
      effectiveKey: "k1",
      storageType: "qdrant",
      modelId: "mm",
      dim: 8,
      pluginVersion: "4.7.0",
      maskPatterns: { confidential: [], artifacts: [] },
    }),
    /sqlite/
  );
});

// ── runBackup: форма embedding реального бэкенда (regression: smoke CLI E2E) ──
// Реальный sqlite отдаёт BLOB как Buffer (Node) / Uint8Array (bun-шим) из
// float32 LE-байтов. Без нормализации JSON.stringify пишет
// {"type":"Buffer","data":[]}, и runRestore (validateImportEntry) отклоняет
// каждую строку — бэкап unrestorable.

function mkFullRow(i, embedding) {
  return {
    session_id: `s${i}`,
    key: "test-ns",
    origin_project_hash: "abc123",
    title: `t${i}`,
    summary: `sum${i}`,
    decisions: [],
    artifacts: [],
    author: "test",
    time_first: 1000,
    time_last: 2000,
    version: 1,
    model_id: "mm",
    embedding,
  };
}

test("runBackup: sqlite-Buffer embedding → JSONL number[] + roundtrip runRestore", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mb-buf-"));
  try {
    const f32 = new Float32Array([1, 2, 3, 4, 5, 6, 7, 8]);
    const buf = Buffer.from(f32.buffer, f32.byteOffset, f32.byteLength);
    const r = await runBackup({
      storage: mkMockStorage([mkFullRow(1, buf)]),
      backupCfg: { path: dir, retention: 0 },
      effectiveKey: "test-ns",
      storageType: "sqlite",
      modelId: "mm",
      dim: 8,
      pluginVersion: "4.7.0",
      maskPatterns: { confidential: [], artifacts: [] },
      gitRoot: null,
      now: () => 123,
    });
    // JSONL — чистый JSON: embedding — массив чисел (spec §4)
    const line = JSON.parse(readFileSync(join(dir, "backup-test-ns-123.jsonl"), "utf8"));
    assert.ok(Array.isArray(line.embedding), "embedding в JSONL — массив");
    assert.deepEqual(line.embedding, [1, 2, 3, 4, 5, 6, 7, 8]);
    // Roundtrip: бэкап восстанавливается; upsert получает number[]
    const restoreStorage = mkMockStorage([]);
    const rr = await runRestore({
      storage: restoreStorage,
      backupCfg: { path: dir },
      effectiveKey: "test-ns",
      storageType: "sqlite",
      modelId: "mm",
      dim: 8,
      file: r.file,
      replace: false,
      channel: "cli",
      isTty: true,
      maskPatterns: { confidential: [], artifacts: [] },
    });
    assert.equal(rr.count, 1);
    assert.equal(rr.added, 1);
    const upEmb = restoreStorage.upserts[0][0].embedding;
    assert.ok(upEmb instanceof Float32Array, "upsert-embedding — Float32Array (parity memory_import)");
    assert.deepEqual(Array.from(upEmb), [1, 2, 3, 4, 5, 6, 7, 8]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("runBackup: Uint8Array embedding (bun-шим) → JSONL number[]", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mb-u8-"));
  try {
    const f32 = new Float32Array([0.5, -0.25, 1, 2, 3, 4, 5, 6]);
    const u8 = new Uint8Array(f32.buffer, f32.byteOffset, f32.byteLength);
    await runBackup({
      storage: mkMockStorage([mkFullRow(1, u8)]),
      backupCfg: { path: dir, retention: 0 },
      effectiveKey: "test-ns",
      storageType: "sqlite",
      modelId: "mm",
      dim: 8,
      pluginVersion: "4.7.0",
      maskPatterns: { confidential: [], artifacts: [] },
      gitRoot: null,
      now: () => 1,
    });
    const line = JSON.parse(readFileSync(join(dir, "backup-test-ns-1.jsonl"), "utf8"));
    assert.ok(Array.isArray(line.embedding), "embedding в JSONL — массив");
    assert.deepEqual(line.embedding, [0.5, -0.25, 1, 2, 3, 4, 5, 6]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
