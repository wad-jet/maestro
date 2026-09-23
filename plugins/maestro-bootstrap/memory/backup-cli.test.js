import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

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
