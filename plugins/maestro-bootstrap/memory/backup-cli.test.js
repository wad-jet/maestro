import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { PassThrough } from "node:stream";
import { sanitizeDirName } from "./config.js";
import { cliLog, askReplaceConfirm } from "./backup-cli.js";

const CLI = fileURLToPath(new URL("./backup-cli.js", import.meta.url));

test("cli: --help → usage, exit 0", () => {
  const r = spawnSync(process.execPath, [CLI, "--help"], { encoding: "utf8" });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /backup/);
  assert.match(r.stdout, /restore/);
  assert.match(r.stdout, /list/);
});

test("cli: без команды → usage, exit 1", () => {
  const r = spawnSync(process.execPath, [CLI], { encoding: "utf8" });
  assert.equal(r.status, 1);
});

test("cli: не-git-каталог без maestro.json → понятная ошибка, exit 1", () => {
  const r = spawnSync(process.execPath, [CLI, "list"], { encoding: "utf8", cwd: "/tmp" });
  assert.equal(r.status, 1);
  assert.match(r.stdout + r.stderr, /maestro\.json/i);
});

// ── I-1: corrupt DB → actionable-ошибка с dbPath (+ restore-подсказка) ──

test("cli: corrupt DB (restore) → exit 1, stderr содержит dbPath и подсказку -wal/-shm", () => {
  const base = mkdtempSync(join(tmpdir(), "maestro-cli-corrupt-"));
  try {
    const repo = join(base, "repo");
    mkdirSync(repo, { recursive: true });
    spawnSync("git", ["init", "-q"], { cwd: repo, stdio: "ignore" });
    writeFileSync(join(repo, "maestro.json"), JSON.stringify({ memory: { enabled: true, namespace: "test-ns" } }));
    const key = "test-ns";
    const dbPath = join(base, "maestro", "memory", sanitizeDirName(key), "memory.db");
    mkdirSync(dirname(dbPath), { recursive: true });
    // Непустой мусор (не пустой файл: пустой better-sqlite3 примет как новую БД).
    writeFileSync(dbPath, "not a real sqlite db", "utf8");

    const r = spawnSync(process.execPath, [CLI, "restore", "--file", join(repo, "x.jsonl")], {
      cwd: repo, encoding: "utf8",
      env: { ...process.env, XDG_DATA_HOME: base },
    });
    assert.equal(r.status, 1);
    assert.ok(r.stderr.includes(dbPath), `stderr должен содержать dbPath. stderr:\n${r.stderr}`);
    assert.match(r.stderr, /-wal/);
    assert.match(r.stderr, /-shm/);
    assert.match(r.stderr, /повторите restore/i);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

// ── M-1: cliLog читает MAESTRO_BOOTSTRAP_LOG_DIR (паритет makeLogger) ──

test("cli: cliLog → MAESTRO_BOOTSTRAP_LOG_DIR (env) имеет приоритет", () => {
  const base = mkdtempSync(join(tmpdir(), "maestro-cli-log-"));
  const prev = process.env.MAESTRO_BOOTSTRAP_LOG_DIR;
  process.env.MAESTRO_BOOTSTRAP_LOG_DIR = base;
  try {
    const log = cliLog("/nonexistent/root/should-not-be-used");
    log("memory:test", { a: 1 });
    const files = readdirSync(base);
    assert.equal(files.length, 1);
    assert.match(files[0], /^maestro-bootstrap-\d{4}-\d{2}-\d{2}\.log$/);
    const line = JSON.parse(readFileSync(join(base, files[0]), "utf8"));
    assert.equal(line.msg, "memory:test");
    assert.equal(line.a, 1);
  } finally {
    if (prev === undefined) delete process.env.MAESTRO_BOOTSTRAP_LOG_DIR;
    else process.env.MAESTRO_BOOTSTRAP_LOG_DIR = prev;
    rmSync(base, { recursive: true, force: true });
  }
});

test("cli: cliLog без env → <root>/.maestro/logs", () => {
  const base = mkdtempSync(join(tmpdir(), "maestro-cli-log2-"));
  const prev = process.env.MAESTRO_BOOTSTRAP_LOG_DIR;
  delete process.env.MAESTRO_BOOTSTRAP_LOG_DIR;
  try {
    const log = cliLog(base);
    log("memory:test2", {});
    const dir = join(base, ".maestro", "logs");
    assert.ok(existsSync(dir), "каталог <root>/.maestro/logs создан");
    const files = readdirSync(dir);
    assert.equal(files.length, 1);
    assert.match(files[0], /^maestro-bootstrap-\d{4}-\d{2}-\d{2}\.log$/);
  } finally {
    if (prev !== undefined) process.env.MAESTRO_BOOTSTRAP_LOG_DIR = prev;
    rmSync(base, { recursive: true, force: true });
  }
});

// ── M-2: EOF на prompt replace → null (не тихий exit 0), без двойного resolve ──

test("cli: askReplaceConfirm — EOF без ответа → null (не hang/exit 0)", async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  const p = askReplaceConfirm({ input, output, effectiveKey: "ns" });
  input.end(); // EOF / Ctrl+D без ввода
  const v = await p;
  assert.equal(v, null);
});

test("cli: askReplaceConfirm — ответ → trimmed namespace (close после — без двойного resolve)", async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  const p = askReplaceConfirm({ input, output, effectiveKey: "ns" });
  input.write("  ns  \n");
  const v = await p;
  assert.equal(v, "ns");
});
