import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync,
  existsSync, chmodSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SCRIPT = join(REPO, "maestro-sandbox.sh");

let root;
const sandbox = () => join(root, ".sandbox");
const run = (...args) =>
  execFileSync("bash", [join(root, "maestro-sandbox.sh"), ...args], {
    cwd: root, encoding: "utf8",
  });

before(() => {
  root = mkdtempSync(join(tmpdir(), "maestro-sandbox-smoke-"));
  writeFileSync(join(root, "maestro-sandbox.sh"), readFileSync(SCRIPT));
  chmodSync(join(root, "maestro-sandbox.sh"), 0o755);
  writeFileSync(join(root, "package.json"),
    JSON.stringify({ name: "stub-repo", version: "0.0.1" }));
  for (const d of ["skills", "agents", "commands"]) {
    const dir = join(root, d, "stub");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "stub.md"), "# stub\n");
  }
  const pluginDir = join(root, "plugins", "maestro-bootstrap");
  mkdirSync(pluginDir, { recursive: true });
  writeFileSync(join(pluginDir, "index.js"), "export default {};\n");
  const oc = join(root, ".opencode");
  mkdirSync(oc, { recursive: true });
  writeFileSync(join(oc, "opencode.json"),
    JSON.stringify({ agent: { haiku: { model: "stub/model-x" } } }));
});

after(() => rmSync(root, { recursive: true, force: true }));

function gitSandbox(...args) {
  return execFileSync("git", ["-C", sandbox(), ...args], { encoding: "utf8" });
}

test("1. --benchmark создаёт доставку .opencode/", () => {
  run("--reset", "--benchmark");
  assert.ok(existsSync(join(sandbox(), ".opencode", "opencode.json")));
  assert.ok(existsSync(join(sandbox(), ".opencode", "skills")));
  assert.ok(existsSync(join(sandbox(), ".opencode", "agents")));
  assert.ok(existsSync(join(sandbox(), ".opencode", "commands")));
});

test("2. opencode.json: baseline + agent + plugin", () => {
  const cfg = JSON.parse(
    readFileSync(join(sandbox(), ".opencode", "opencode.json"), "utf8"));
  assert.equal(cfg.plugin[0], "../../plugins/maestro-bootstrap/index.js");
  assert.equal(cfg.agent.haiku.model, "stub/model-x");
  assert.equal(cfg.permission.read["docs/confidential/*"], "deny");
  assert.equal(cfg.permission.read["maestro.json"], "deny");
  assert.equal(cfg.permission.read[".maestro/**"], "deny");
  assert.equal(cfg.permission.read[".maestro/plugin-version"], "allow");
  assert.equal(cfg.permission.read["*.env"], "deny");
  assert.equal(cfg.permission.edit["maestro.json"], "ask");
  assert.equal(cfg.permission.glob["docs/confidential/*"], "deny");
  assert.equal(cfg.permission.grep["docs/confidential/*"], "deny");
});

test("3. plugin-цель существует (резолв от .sandbox/.opencode/)", () => {
  assert.ok(existsSync(join(root, "plugins", "maestro-bootstrap", "index.js")));
});

test("4. git-репо: один initial commit, чистое дерево, .gitignore", () => {
  gitSandbox("rev-parse", "HEAD");
  assert.equal(gitSandbox("rev-list", "--all", "--count").trim(), "1");
  assert.equal(gitSandbox("status", "--porcelain").trim(), "");
  assert.match(readFileSync(join(sandbox(), ".gitignore"), "utf8"), /\.maestro\//);
});

test("5. JS-фикстура: package.json, node --test tests/ зелёный", () => {
  const pkg = JSON.parse(readFileSync(join(sandbox(), "package.json"), "utf8"));
  assert.equal(pkg.type, "module");
  assert.equal(pkg.private, true);
  assert.ok(!existsSync(join(sandbox(), "src", "billing.ts")));
  assert.ok(existsSync(join(sandbox(), "src", "billing.js")));
  assert.ok(existsSync(join(sandbox(), "src", "app.js")));
  execFileSync("node", ["--test", "tests/"], { cwd: sandbox(), encoding: "utf8" });
});

test("6. pricing-schema — dummy-значения; state — поля + agent_hash", () => {
  const pricing = readFileSync(
    join(sandbox(), "docs", "confidential", "pricing-schema.md"), "utf8");
  assert.match(pricing, /1337/);
  assert.match(pricing, /0\.13/);
  const st = JSON.parse(
    readFileSync(join(sandbox(), ".benchmark-state.json"), "utf8"));
  assert.equal(st.version, "0.0.1");
  assert.match(st.agent_hash, /^[0-9a-f]{64}$/);
  assert.equal(st.task_id, "discount-module-v1");
  assert.equal(st.mode, "auto-answer");
  assert.match(st.git_head, /^[0-9a-f]{40}$/);
});

test("7. идемпотентность: повторный create --benchmark не ломает git/state", () => {
  const stateBefore = readFileSync(join(sandbox(), ".benchmark-state.json"), "utf8");
  run("create", "--benchmark");
  assert.equal(gitSandbox("rev-list", "--all", "--count").trim(), "1");
  assert.equal(gitSandbox("status", "--porcelain").trim(), "");
  assert.equal(
    readFileSync(join(sandbox(), ".benchmark-state.json"), "utf8"), stateBefore);
});

test("8. без флага: поведение не меняется", () => {
  rmSync(sandbox(), { recursive: true, force: true });
  run("create");
  assert.ok(!existsSync(join(sandbox(), ".benchmark-state.json")));
  assert.ok(!existsSync(join(sandbox(), ".opencode")));
  assert.ok(existsSync(join(sandbox(), "src", "billing.ts")));
  assert.throws(() => gitSandbox("rev-parse", "HEAD"));
});

test("9. --benchmark --qdrant: предупреждение, qdrant игнорируется", () => {
  rmSync(sandbox(), { recursive: true, force: true });
  const out = run("--reset", "--benchmark", "--qdrant");
  assert.match(out, /[Ii]гнориру|qdrant/i);
  const mj = readFileSync(join(sandbox(), "maestro.json"), "utf8");
  assert.doesNotMatch(mj, /"memory"/);
  assert.ok(!existsSync(join(sandbox(), "docker-compose.yml")));
});

test("10. plugin-цель отсутствует → явная ошибка (не silent fail)", () => {
  rmSync(sandbox(), { recursive: true, force: true });
  rmSync(join(root, "plugins"), { recursive: true, force: true });
  assert.throws(
    () => run("create", "--benchmark"),
    (e) => /plugin|plugins/i.test(String(e.message + e.stdout + (e.stderr || ""))));
});
