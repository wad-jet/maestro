import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { backupBaseName, buildJsonl, buildManifestMeta, applyRetention, listBackups, resolveBackupDir } from "./backup.js";

const KEY = "test-ns";
const tmp = () => mkdtempSync(join(tmpdir(), "maestro-backup-"));

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
  assert.match(m.sha256, /^[a-f0-9]{64}$/);
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

test("applyRetention: удаление только парных файлов (если .jsonl есть, .manifest.json тоже удаляется и наоборот)", () => {
  const dir = tmp();
  try {
    writeFileSync(join(dir, `backup-${KEY}-1.jsonl`), "x");
    // .manifest.json нет — ok
    const stale = applyRetention(dir, KEY, 0);
    assert.deepEqual(stale, []);
    assert.ok(existsSync(join(dir, `backup-${KEY}-1.jsonl`)));
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
