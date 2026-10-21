/**
 * entrypoint-verify — поведенческая верификация docker/entrypoint.sh
 * (spec docker-serve task 23 → plan task 13, step 2).
 *
 * Метод: целевая функция извлекается из entrypoint.sh и исполняется в
 * изолированном bash-субпроцессе (non-root: chown stubbed через PATH; env
 * детерминирован — OC_* из окружения запускающего процесса отбрасываются).
 * Docker-контейнер и opencode server здесь НЕ поднимаются — runtime-
 * подтверждение — docker smoke (docs/testing/maestro-sandbox-checklist.md,
 * секция H; ./maestro-sandbox.sh --docker — статическая часть).
 *
 * (a) `XDG_CONFIG_HOME` уважается opencode server на Linux — механизм
 *     entrypoint: глобальный скелет сидится в $XDG_CONFIG_HOME/opencode/
 *     (XDG Base Directory spec), XDG_DATA_HOME/XDG_CACHE_HOME экспортируются
 *     до drop, serve-процесс (после gosu) наследует env.
 * (b) `plugin:<absolute path>` matching в policy deny — в т.ч. после
 *     добавления кастомного плагина в allowlist; generate_provider_allowlist
 *     заменяет только provider.use-allow записи, integration.use (plugin-
 *     allowlist) не трогает, идемпотентен.
 * (c) Seed-логика: пустой config-dir на первом запуске → копируется baked
 *     skeleton; повторный запуск → существующий конфиг НЕ перезаписывается;
 *     baked skeleton отсутствует → warn + без crash.
 * (d) `git clean -fd -e .opencode` не удаляет mount point.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const ENTRYPOINT_SRC = fs.readFileSync(
  path.join(REPO_ROOT, "docker", "entrypoint.sh"),
  "utf8",
);
const ETC_CONFIG = JSON.parse(
  fs.readFileSync(path.join(REPO_ROOT, "docker", "etc-opencode.json"), "utf8"),
);

const hasBash = spawnSync("bash", ["--version"], { stdio: "ignore" }).status === 0;
const hasJq = spawnSync("jq", ["--version"], { stdio: "ignore" }).status === 0;
const hasGit = spawnSync("git", ["--version"], { stdio: "ignore" }).status === 0;
const bashTest = hasBash ? test : test.skip;
const bashJqTest = hasJq && hasBash ? test : test.skip;
const gitTest = hasGit && hasBash ? test : test.skip;

// --- helpers -------------------------------------------------------------------

function extractFunction(src, name) {
  const lines = src.split("\n");
  const start = lines.findIndex((l) => l.startsWith(`${name}() {`));
  assert.ok(start >= 0, `функция ${name} не найдена в entrypoint.sh`);
  for (let i = start; i < lines.length; i++) {
    if (lines[i] === "}") return lines.slice(start, i + 1).join("\n");
  }
  assert.fail(`функция ${name} — не найдено закрывающий '}'`);
}

/**
 * Изолированный bash-субпроцесс: извлечённые функции + stub log/die +
 * chown-stub (non-root macOS/Linux) + детерминированный env.
 * patch: [ [old, new], … ] — точные подстановки в исходнике entrypoint
 * (используется только для подмены baked-skeleton путей на temp-фикстуры —
 * логика под тестом не меняется).
 */
function runEntrypointCase({ fnNames, header = "", call = "", env = {}, patch = [] } = {}) {
  let src = ENTRYPOINT_SRC;
  for (const [from, to] of patch) {
    assert.ok(src.includes(from), `patch-цель не найдена: ${from}`);
    src = src.split(from).join(to);
  }
  const parts = [
    "#!/bin/bash",
    "set -euo pipefail",
    'log() { echo "[log] $*" >&2; }',
    'die() { echo "[die] $*" >&2; exit 1; }',
    'DROP_UID="${RUN_UID:-1000}"',
    'DROP_GID="${RUN_GID:-1000}"',
  ];
  for (const fn of fnNames) parts.push(extractFunction(src, fn));
  parts.push(header, call);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "maestro-ep-verify-"));
  const bin = path.join(dir, "bin");
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, "chown"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  const file = path.join(dir, "case.sh");
  fs.writeFileSync(file, parts.join("\n") + "\n");
  const baseEnv = { ...process.env };
  for (const k of Object.keys(baseEnv)) {
    if (/^OC_[A-Z0-9_]+_MODEL$/.test(k) || k === "OC_PROVIDERS_JSON" || k === "OPENCODE_DEFAULT_AGENT") {
      delete baseEnv[k];
    }
  }
  let res;
  try {
    res = spawnSync("bash", [file], {
      encoding: "utf8",
      env: { ...baseEnv, PATH: `${bin}:${baseEnv.PATH}`, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  return { status: res.status, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

/** Фикстура baked skeleton: 2 кандидата seed_skeleton (root / opt). */
function bakedFixture(dir, { root = true, opt = false } = {}) {
  const rootSrc = path.join(dir, "baked-root.json");
  const optSrc = path.join(dir, "baked-opt.json");
  const patch = [];
  if (root) {
    fs.writeFileSync(rootSrc, JSON.stringify({ default_agent: "build", seeded: "root" }));
  }
  if (opt) {
    fs.writeFileSync(optSrc, JSON.stringify({ default_agent: "build", seeded: "opt" }));
  }
  patch.push(["/root/.config/opencode/opencode.json", rootSrc]);
  patch.push(["/opt/maestro/user-opencode.json", optSrc]);
  return { rootSrc, optSrc, patch };
}

// policy matcher (та же семантика, что в docker-verification.test.mjs) --------

function normalizePluginPath(p) {
  if (typeof p !== "string" || p.length < 2) return p;
  return p.endsWith("/") ? p.slice(0, -1) : p;
}

function decidePluginPolicy(policies, pluginPath) {
  const target = `plugin:${normalizePluginPath(pluginPath)}`;
  let wildcard = null;
  let exact = null;
  for (const pol of policies) {
    if (pol.action !== "integration.use") continue;
    if (pol.resource === "plugin:*") {
      wildcard = pol;
      continue;
    }
    if (pol.resource === target) exact = pol;
  }
  return (exact ?? wildcard)?.effect ?? "deny";
}

// --- (a) XDG_CONFIG_HOME уважается opencode server (Linux) ----------------------

test("entrypoint (a): XDG — export XDG_DATA_HOME/XDG_CACHE_HOME, serve наследует env", () => {
  assert.ok(
    ENTRYPOINT_SRC.includes("export XDG_DATA_HOME=/data"),
    "XDG_DATA_HOME=/data экспортируется до drop",
  );
  assert.ok(
    ENTRYPOINT_SRC.includes("export XDG_CACHE_HOME=/cache"),
    "XDG_CACHE_HOME=/cache экспортируется до drop",
  );
  assert.ok(
    ENTRYPOINT_SRC.includes('exec gosu "${DROP_UID}:${DROP_GID}" opencode serve'),
    "serve — через gosu, env процесса наследуется (без scrubbing)",
  );
});

bashTest("entrypoint (a): XDG_CONFIG_HOME — seed-цель $XDG_CONFIG_HOME/opencode (не $HOME/.config)", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "maestro-ep-xdg-"));
  try {
    const xdg = path.join(dir, "xdg"); // XDG_CONFIG_HOME
    const home = path.join(dir, "home"); // HOME — должен НЕ использоваться
    fs.mkdirSync(xdg);
    fs.mkdirSync(home);
    const { patch } = bakedFixture(dir, { root: true });

    const res = runEntrypointCase({
      fnNames: ["seed_skeleton"],
      call: "seed_skeleton",
      env: { XDG_CONFIG_HOME: xdg, HOME: home },
      patch,
    });
    assert.equal(res.status, 0, `seed_skeleton: ${res.stderr}`);
    const target = path.join(xdg, "opencode", "opencode.json");
    assert.ok(fs.existsSync(target), "skeleton сидится в $XDG_CONFIG_HOME/opencode/");
    assert.equal(JSON.parse(fs.readFileSync(target, "utf8")).seeded, "root");
    assert.ok(
      !fs.existsSync(path.join(home, ".config", "opencode", "opencode.json")),
      "HOME-fallback не используется, когда XDG_CONFIG_HOME задан",
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

bashTest("entrypoint (a): XDG_CONFIG_HOME не задан — fallback $HOME/.config (runtime HOME serving-user)", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "maestro-ep-xdg2-"));
  try {
    const home = path.join(dir, "home");
    fs.mkdirSync(home);
    const { patch } = bakedFixture(dir, { root: true });
    const res = runEntrypointCase({
      fnNames: ["seed_skeleton"],
      call: "seed_skeleton",
      env: { HOME: home },
      patch,
    });
    assert.equal(res.status, 0, `seed_skeleton: ${res.stderr}`);
    const target = path.join(home, ".config", "opencode", "opencode.json");
    assert.ok(fs.existsSync(target), "без XDG_CONFIG_HOME — $HOME/.config/opencode/");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// --- (b) plugin:<absolute path> matching в policy deny ---------------------------

test("entrypoint (b): plugin:<absolute path> — кастомный плагин из allowlist → allow, остальные → deny", () => {
  // Сценарий spec §2.15 (Volume override): operator добавляет allow для
  // кастомного плагина в /etc/opencode/opencode.json.
  const custom = "/opt/plugins/custom-verified";
  const policies = [
    ...ETC_CONFIG.policies,
    { action: "integration.use", resource: `plugin:${custom}`, effect: "allow" },
  ];
  assert.equal(decidePluginPolicy(policies, custom), "allow", "кастомный плагин из allowlist → allow");
  assert.equal(decidePluginPolicy(policies, "/opt/plugins/custom-verified-evil"), "deny");
  assert.equal(decidePluginPolicy(policies, "/opt/plugins/../workspace/evil"), "deny");
  assert.equal(decidePluginPolicy(policies, "./opt/plugins/custom-verified"), "deny");
  // Исходный allowlist не тронут.
  assert.equal(decidePluginPolicy(policies, "/opt/maestro/plugins/maestro-bootstrap"), "allow");
  assert.equal(decidePluginPolicy(policies, "/opt/superpowers"), "allow");
  assert.equal(decidePluginPolicy(policies, "/workspace/myapp/.opencode/plugins/evil"), "deny");
});

bashJqTest("entrypoint (b): generate_provider_allowlist — только provider.use, integration.use сохранён, идемпотентно", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "maestro-ep-providers-"));
  try {
    const etc = path.join(dir, "opencode.json");
    fs.copyFileSync(path.join(REPO_ROOT, "docker", "etc-opencode.json"), etc);
    const integrationBefore = ETC_CONFIG.policies.filter((p) => p.action === "integration.use");

    const run = () =>
      runEntrypointCase({
        fnNames: ["oc_model_vars", "generate_provider_allowlist"],
        header: `ETC_CONFIG="${etc}"`,
        call: "generate_provider_allowlist",
        env: { OC_BUILD_MODEL: "akash/model-x", OC_PLAN_MODEL: "openai/gpt-x" },
      });

    const r1 = run();
    assert.equal(r1.status, 0, `generate_provider_allowlist: ${r1.stderr}`);
    const cfg1 = JSON.parse(fs.readFileSync(etc, "utf8"));
    // integration.use (plugin-allowlist: deny plugin:* + allow-записи) — не тронут.
    assert.deepEqual(
      cfg1.policies.filter((p) => p.action === "integration.use"),
      integrationBefore,
      "generate_provider_allowlist не модифицирует integration.use записи",
    );
    const allowProviders = cfg1.policies
      .filter((p) => p.action === "provider.use" && p.effect === "allow")
      .map((p) => p.resource)
      .sort();
    assert.deepEqual(allowProviders, ["akash", "openai"], "allow-записи из OC_*_MODEL provider-ID");
    assert.ok(
      cfg1.policies.some(
        (p) => p.action === "provider.use" && p.resource === "*" && p.effect === "deny",
      ),
      "базовый provider.use deny сохранён",
    );
    // chmod 644 — читаемость для serving-пользователя (mktemp-файл 600).
    assert.equal(fs.statSync(etc).mode & 0o777, 0o644, "конфиг chmod 644 после записи");

    const r2 = run();
    assert.equal(r2.status, 0, `повторный прогон: ${r2.stderr}`);
    const cfg2 = JSON.parse(fs.readFileSync(etc, "utf8"));
    const allowCount = cfg2.policies.filter(
      (p) => p.action === "provider.use" && p.effect === "allow",
    ).length;
    assert.equal(allowCount, 2, "идемпотентно: повторный прогон не дублирует allow-записи");
    assert.deepEqual(
      cfg2.policies.filter((p) => p.action === "integration.use"),
      integrationBefore,
      "integration.use сохранён и после второго прогона",
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// --- (c) seed-логика ---------------------------------------------------------------

bashTest("entrypoint (c): seed — пустой config-dir на первом запуске → baked skeleton скопирован", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "maestro-ep-seed-"));
  try {
    const xdg = path.join(dir, "xdg");
    fs.mkdirSync(xdg);
    const { rootSrc, patch } = bakedFixture(dir, { root: true });
    const res = runEntrypointCase({
      fnNames: ["seed_skeleton"],
      call: "seed_skeleton",
      env: { XDG_CONFIG_HOME: xdg, HOME: path.join(dir, "home") },
      patch,
    });
    assert.equal(res.status, 0, `seed_skeleton: ${res.stderr}`);
    const target = path.join(xdg, "opencode", "opencode.json");
    assert.ok(fs.existsSync(target), "skeleton скопирован на первом запуске");
    assert.equal(
      fs.readFileSync(target, "utf8"),
      fs.readFileSync(rootSrc, "utf8"),
      "контент = baked skeleton (бесшовная копия)",
    );
    assert.ok(res.stderr.includes("seeded global skeleton"), "log: seeded global skeleton");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

bashTest("entrypoint (c): seed — повторный запуск существующий конфиг НЕ перезаписывает", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "maestro-ep-seed2-"));
  try {
    const xdg = path.join(dir, "xdg");
    const custom = JSON.stringify({ default_agent: "plan", operator_custom: true }, null, 2);
    fs.mkdirSync(path.join(xdg, "opencode"), { recursive: true });
    const target = path.join(xdg, "opencode", "opencode.json");
    fs.writeFileSync(target, custom);
    const { patch } = bakedFixture(dir, { root: true });
    const res = runEntrypointCase({
      fnNames: ["seed_skeleton"],
      call: "seed_skeleton",
      env: { XDG_CONFIG_HOME: xdg, HOME: path.join(dir, "home") },
      patch,
    });
    assert.equal(res.status, 0, `seed_skeleton: ${res.stderr}`);
    assert.equal(
      fs.readFileSync(target, "utf8"),
      custom,
      "операторский конфиг не перезаписывается на повторном запуске",
    );
    assert.ok(res.stderr.includes("seed skipped"), "log: seed skipped");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

bashTest("entrypoint (c): seed — baked skeleton отсутствует → warn + без crash, файл не создан", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "maestro-ep-seed3-"));
  try {
    const xdg = path.join(dir, "xdg");
    fs.mkdirSync(xdg);
    const res = runEntrypointCase({
      fnNames: ["seed_skeleton"],
      call: "seed_skeleton",
      env: { XDG_CONFIG_HOME: xdg, HOME: path.join(dir, "home") },
      patch: [
        ["/root/.config/opencode/opencode.json", path.join(dir, "nope-root.json")],
        ["/opt/maestro/user-opencode.json", path.join(dir, "nope-opt.json")],
      ],
    });
    assert.equal(res.status, 0, "отсутствие skeleton — не ошибка запуска");
    assert.ok(!fs.existsSync(path.join(xdg, "opencode", "opencode.json")), "файл не создан");
    assert.ok(res.stderr.includes("baked skeleton not found"), "log: warn baked skeleton not found");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

bashTest("entrypoint (c): seed — приоритет кандидатов: root-кандидат раньше opt-кандидата", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "maestro-ep-seed4-"));
  try {
    const xdg = path.join(dir, "xdg");
    fs.mkdirSync(xdg);
    const { patch } = bakedFixture(dir, { root: true, opt: true });
    const res = runEntrypointCase({
      fnNames: ["seed_skeleton"],
      call: "seed_skeleton",
      env: { XDG_CONFIG_HOME: xdg, HOME: path.join(dir, "home") },
      patch,
    });
    assert.equal(res.status, 0, `seed_skeleton: ${res.stderr}`);
    const target = path.join(xdg, "opencode", "opencode.json");
    assert.equal(JSON.parse(fs.readFileSync(target, "utf8")).seeded, "root", "первый кандидат в списке wins");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// --- (d) git clean -fd -e .opencode — mount point не удаляется ---------------------

test("entrypoint (d): git clean в entrypoint несёт -e .opencode и -e .confidential", () => {
  const lines = ENTRYPOINT_SRC.split("\n");
  const idx = lines.findIndex((l) => /git .*clean -fd/.test(l));
  assert.ok(idx >= 0, "entrypoint использует git clean -fd (mode A update fallback)");
  let block = lines[idx];
  for (let i = idx + 1; i < lines.length && /\\$/.test(lines[i - 1]); i++) {
    block += "\n" + lines[i];
  }
  assert.ok(block.includes("-e .opencode"), "git clean: -e .opencode (mount point)");
  assert.ok(block.includes("-e .confidential"), "git clean: -e .confidential (mount point)");
});

gitTest("entrypoint (d): git clean -fd -e .opencode -e .confidential — mount points выживают, stray-файлы удаляются", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "maestro-ep-clean-"));
  const g = (args) => {
    const r = spawnSync("git", args, { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    assert.equal(r.status, 0, `git ${args.join(" ")}: ${r.stderr}`);
    return r.stdout;
  };
  try {
    g(["init", "-q"]);
    g(["config", "user.email", "t@t.com"]);
    g(["config", "user.name", "t"]);
    fs.writeFileSync(path.join(dir, "README.md"), "tracked\n");
    g(["add", "-A"]);
    g(["commit", "-qm", "init"]);
    // Untracked-контент: имитация bind-mounted каталогов + stray-файл.
    fs.mkdirSync(path.join(dir, ".opencode"));
    fs.writeFileSync(path.join(dir, ".opencode", "plugin.js"), "module.exports = {}\n");
    fs.mkdirSync(path.join(dir, ".confidential"));
    fs.writeFileSync(path.join(dir, ".confidential", "data.txt"), "confidential\n");
    fs.writeFileSync(path.join(dir, "stray.txt"), "stray\n");
    g(["clean", "-fd", "-e", ".opencode", "-e", ".confidential"]);
    assert.ok(!fs.existsSync(path.join(dir, "stray.txt")), "stray-файл удалён");
    assert.ok(fs.existsSync(path.join(dir, ".opencode", "plugin.js")), "mount point .opencode не удалён");
    assert.ok(fs.existsSync(path.join(dir, ".confidential", "data.txt")), "mount point .confidential не удалён");
    assert.ok(fs.existsSync(path.join(dir, "README.md")), "tracked-файл не тронут");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// --- (e) {env:} whitelist validation (review: Important fix) ---------------------

test("entrypoint (e): {env:} whitelist — разрешённые переменные проходят", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "maestro-ep-whitelist-"));
  try {
    const cfg = path.join(dir, "opencode.json");
    // Only whitelisted {env:} placeholders
    fs.writeFileSync(cfg, JSON.stringify({
      agents: {
        build: { model: "{env:OC_BUILD_MODEL}" },
        plan: { model: "{env:OC_PLAN_MODEL}" },
      },
      default_agent: "{env:OPENCODE_DEFAULT_AGENT}",
    }));
    const escaped = cfg.replace(/"/g, '\\"');
    const res = runEntrypointCase({
      fnNames: ["validate_env_whitelist"],
      call: `validate_env_whitelist "${escaped}"`,
      env: {},
    });
    assert.equal(res.status, 0, `allowed vars: ${res.stderr}`);
    assert.ok(res.stderr.includes("{env:} whitelist OK"), "log: whitelist OK");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("entrypoint (e): {env:} whitelist — запрещённые переменные отклоняются", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "maestro-ep-whitelist-"));
  try {
    const cfg = path.join(dir, "opencode.json");
    // Forbidden: OPENAI_API_KEY is not whitelisted
    fs.writeFileSync(cfg, JSON.stringify({
      agents: {
        build: { model: "{env:OC_BUILD_MODEL}" },
      },
      env_vars: { key: "{env:OPENAI_API_KEY}" },
    }));
    const escaped = cfg.replace(/"/g, '\\"');
    const res = runEntrypointCase({
      fnNames: ["validate_env_whitelist"],
      call: `validate_env_whitelist "${escaped}"`,
      env: {},
    });
    assert.notEqual(res.status, 0, "forbidden vars: expected non-zero");
    assert.ok(res.stderr.includes("Forbidden {env:} placeholders"), "die message: forbidden placeholders");
    assert.ok(res.stderr.includes("OPENAI_API_KEY"), "die message: mentions the bad var");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("entrypoint (e): {env:} whitelist — файл без {env:} пропускается", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "maestro-ep-whitelist-"));
  try {
    const cfg = path.join(dir, "opencode.json");
    fs.writeFileSync(cfg, JSON.stringify({
      agents: { build: { model: "akash/Qwen3.6-35B-A3B" } },
      default_agent: "build",
    }));
    const escaped = cfg.replace(/"/g, '\\"');
    const res = runEntrypointCase({
      fnNames: ["validate_env_whitelist"],
      call: `validate_env_whitelist "${escaped}"`,
      env: {},
    });
    assert.equal(res.status, 0, "no placeholders: passes");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
