/**
 * docker-verification — plugin-слой docker-serve: верификация managed-пolicies
 * (plugin-allowlist) и anti-redirect контракта OPENCODE_CONFIG_CONTENT.
 *
 * Scope: статический конфиг-слой (docker/etc-opencode.json,
 * docker/user-opencode.json) + поведение docker/entrypoint.sh
 * (inject_opencode_config в изолированном bash-субпроцессе). Opencode server
 * здесь НЕ поднимается — runtime-подтверждение deny plugin:* + allowlist +
 * env-инъекции — docker smoke (docs/testing/maestro-sandbox-checklist.md,
 * секция H; ./maestro-sandbox.sh --docker — статическая часть).
 *
 * (a) `plugin:<path>` matching для абсолютных путей: managed-allowlist
 *     (docker/etc-opencode.json) пропускaет плагины, объявленные в global
 *     skeleton, и отклоняет всё остальное (catch-all `deny plugin:*`).
 * (b) Core-плагины (Console, policy) не ломаются от `deny plugin:*`:
 *     core-функциональность — не config-declared плагины (встроенные в
 *     сервер); образ декларирует только allowlisted directory-form
 *     абсолютные пути; `allow plugin:*` нет (обнулила бы baseline).
 * (c) OPENCODE_CONFIG_CONTENT anti-redirect: entrypoint инъектирует строго
 *     agents.*.model + providers + default_agent (spec §2.8), и инъектируемый
 *     конфиг имеет высший приоритет (загружается после project-слоя) —
 *     repo-конфиг не может перенаправить agents.*.model на кастомный endpoint.
 *
 * Семантика матчера зафиксирована этим тестом (допущение об opencode core;
 * оба разумных варианта precedence дают одинаковый результат для managed-
 * конфига — это и проверяется):
 *   - точный entry (plugin:/abs/path) приоритетнее wildcard (plugin:*);
 *   - среди entries одной специфичности — позже объявленный wins
 *     (last-match-wins);
 *   - нет совпавшего правила → deny (fail-closed).
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
const ETC_CONFIG = JSON.parse(
  fs.readFileSync(path.join(REPO_ROOT, "docker", "etc-opencode.json"), "utf8"),
);
const SKELETON = JSON.parse(
  fs.readFileSync(path.join(REPO_ROOT, "docker", "user-opencode.json"), "utf8"),
);
const ENTRYPOINT_SRC = fs.readFileSync(
  path.join(REPO_ROOT, "docker", "entrypoint.sh"),
  "utf8",
);

const hasBash = spawnSync("bash", ["--version"], { stdio: "ignore" }).status === 0;
const hasJq = spawnSync("jq", ["--version"], { stdio: "ignore" }).status === 0;
const bTest = hasJq && hasBash ? test : test.skip;

// --- policy matcher (смысл зафиксирован в шапке файла) -----------------------

function normalizePluginPath(p) {
  if (typeof p !== "string" || p.length < 2) return p;
  return p.endsWith("/") ? p.slice(0, -1) : p;
}

/** effect policy-решения для plugin-пути: exact wins over wildcard, last wins, fail-closed deny. */
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

// --- (a) plugin:<path> matching для абсолютных путей --------------------------

test("docker (a): skeleton-плагины разрешены allowlist'ом (deny plugin:* не ломает существующие)", () => {
  const plugins = SKELETON.plugins;
  assert.ok(Array.isArray(plugins) && plugins.length > 0, "skeleton декларирует plugins");
  for (const p of plugins) {
    assert.equal(
      decidePluginPolicy(ETC_CONFIG.policies, p),
      "allow",
      `plugin ${p} (объявлен в global skeleton) должен быть разрешён /etc/opencode policies`,
    );
  }
});

test("docker (a): catch-all deny plugin:* присутствует (premise security baseline)", () => {
  const hasDenyAll = ETC_CONFIG.policies.some(
    (p) => p.action === "integration.use" && p.resource === "plugin:*" && p.effect === "deny",
  );
  assert.ok(hasDenyAll, "deny plugin:* baseline обязателен (spec §2.14)");
});

test("docker (a): плагины вне allowlist отклоняются (deny)", () => {
  const cases = [
    "/workspace/myapp/.opencode/plugins/evil", // plugin, инжектнутый репо
    "/workspace/myapp/plugins/evil",
    "/opt/plugins/other",
    "plugins/maestro-bootstrap", // относительный путь
    "./opt/superpowers", // не нормализованный относительный
  ];
  for (const p of cases) {
    assert.equal(
      decidePluginPolicy(ETC_CONFIG.policies, p),
      "deny",
      `plugin ${p} вне allowlist должен быть denied`,
    );
  }
});

test("docker (a): нет prefix/suffix-путаницы и traversal-обходов", () => {
  const cases = [
    "/opt/superpowers-evil", // префикс allow-пути — другое имя
    "/opt/maestro/plugins/maestro-bootstrap/backup", // суффикс-подкаталог
    "/opt/maestro/plugins/maestro-bootstrap/../superpowers", // без canonicalize → deny
    "/opt/superpowers/../maestro/plugins/maestro-bootstrap",
  ];
  for (const p of cases) {
    assert.equal(
      decidePluginPolicy(ETC_CONFIG.policies, p),
      "deny",
      `plugin ${p}: матчинг — точное совпадение абсолютного пути (fail-closed)`,
    );
  }
});

test("docker (a): allow-записи — абсолютные пути directory-form (opencode v2)", () => {
  const allows = ETC_CONFIG.policies.filter(
    (p) =>
      p.action === "integration.use" &&
      p.effect === "allow" &&
      p.resource.startsWith("plugin:") &&
      p.resource !== "plugin:*",
  );
  assert.ok(allows.length > 0, "allow-записи для плагинов должны существовать");
  for (const a of allows) {
    const res = a.resource.slice("plugin:".length);
    assert.ok(res.startsWith("/"), `allow ${a.resource} — только абсолютные пути`);
    assert.ok(!res.endsWith(".js"), `allow ${a.resource} — directory-form (file-path отбрасывается в v2)`);
  }
});

test("docker (a): нет allow plugin:* (обнулил бы deny-baseline)", () => {
  const bad = ETC_CONFIG.policies.some(
    (p) => p.action === "integration.use" && p.resource === "plugin:*" && p.effect === "allow",
  );
  assert.ok(!bad, "allow plugin:* не допускается");
});

// --- (b) core-плагины (Console, policy) не ломаются от deny plugin:* ----------

test("docker (b): core не ломается — объявленные плагины = ровно allowlist (двунаправленно)", () => {
  const allowSet = new Set(
    ETC_CONFIG.policies
      .filter(
        (p) =>
          p.action === "integration.use" &&
          p.effect === "allow" &&
          p.resource.startsWith("plugin:") &&
          p.resource !== "plugin:*",
      )
      .map((p) => normalizePluginPath(p.resource.slice("plugin:".length))),
  );
  const declared = SKELETON.plugins.map(normalizePluginPath);
  // Каждый объявленный плагин разрешён → deny plugin:* его не блокирует.
  for (const d of declared) {
    assert.ok(
      allowSet.has(d),
      `объявленный плагин ${d} должен быть в allowlist'е (иначе deny plugin:* его ломает)`,
    );
  }
  // Каждый allow-путь соответствует объявленному плагину → allowlist не
  // расширяет поверхность загрузки за декларируемый набор.
  for (const a of allowSet) {
    assert.ok(
      declared.includes(a),
      `allow-запись ${a} должна соответствовать плагину, объявленному в skeleton`,
    );
  }
});

test("docker (b): core не ломается — только baked absolute directory-form, без npm-specifier и core-имён", () => {
  // Core-функциональность (Console UI, policy engine) — встроенные в opencode
  // server компоненты, НЕ config-declared плагины: policy-ресурс plugin:* их
  // не гейтит. Статическая фиксация: в config-слоях нет записей, которые бы
  // зависели от plugin-ресурса с чужим именем (npm-specifier мог бы резолвиться
  // в кэш и конфликтовать; core-имена — не декларируются).
  for (const d of SKELETON.plugins) {
    assert.ok(d.startsWith("/opt/"), `plugin ${d} — baked абсолютный путь`);
    assert.ok(!d.startsWith("@"), `plugin ${d} — npm-specifier недопустим (supply-chain)`);
    assert.ok(!/(console|policy)/i.test(d), `plugin ${d} — core-имена не декларируются`);
  }
});

// --- (c) OPENCODE_CONFIG_CONTENT anti-redirect ---------------------------------

test("docker (c): anti-redirect — skeleton-модели только {env:OC_*_MODEL} (нет baked model)", () => {
  const agents = SKELETON.agents;
  assert.ok(agents && typeof agents === "object", "skeleton декларирует agents");
  let count = 0;
  for (const [name, ag] of Object.entries(agents)) {
    if (!ag || typeof ag !== "object" || !("model" in ag)) continue;
    count++;
    assert.match(
      ag.model,
      /^\{env:OC_[A-Z0-9_]+_MODEL\}$/,
      `agents.${name}.model — placeholder {env:OC_*_MODEL} (без baked-модели): ${ag.model}`,
    );
  }
  assert.ok(count >= 8, "skeleton несёт модели для стандартной пятёрки + build/plan/reviewer");
});

test("docker (c): anti-redirect — top-level skeleton без permissions/policies/instructions", () => {
  for (const key of ["permissions", "policies", "instructions"]) {
    assert.ok(
      !(key in SKELETON),
      `top-level ${key} в skeleton — зона managed-слоя /etc/opencode (spec §2.8)`,
    );
  }
});

test("docker (c): anti-redirect — default_agent=build (skeleton + entrypoint default)", () => {
  assert.equal(SKELETON.default_agent, "build");
  assert.ok(
    ENTRYPOINT_SRC.includes("OPENCODE_DEFAULT_AGENT:-build"),
    "entrypoint: default default_agent=build",
  );
});

// --- (c) behavioral: inject_opencode_config из entrypoint.sh --------------------

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
 * Запуск inject_opencode_config в изолированном bash-субпроцессе.
 * env детерминирован: OC_*_MODEL / OC_PROVIDERS_JSON / OPENCODE_DEFAULT_AGENT
 * из окружения запускающего процесса отбрасываются (только явно переданные).
 */
function runInject(extraEnv = {}) {
  const parts = [
    "#!/bin/bash",
    "set -euo pipefail",
    'log() { echo "[log] $*" >&2; }',
    'die() { echo "[die] $*" >&2; exit 1; }',
    extractFunction(ENTRYPOINT_SRC, "oc_model_vars"),
    extractFunction(ENTRYPOINT_SRC, "inject_opencode_config"),
    "inject_opencode_config",
    'printf \'%s\' "$OPENCODE_CONFIG_CONTENT"',
  ];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "maestro-dock-verify-"));
  const file = path.join(dir, "run.sh");
  fs.writeFileSync(file, parts.join("\n") + "\n");
  const env = { ...process.env };
  for (const k of Object.keys(env)) {
    if (/^OC_[A-Z0-9_]+_MODEL$/.test(k) || k === "OC_PROVIDERS_JSON" || k === "OPENCODE_DEFAULT_AGENT") {
      delete env[k];
    }
  }
  Object.assign(env, extraEnv);
  let res;
  try {
    res = spawnSync("bash", [file], { encoding: "utf8", env, stdio: ["ignore", "pipe", "pipe"] });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  return { status: res.status, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

/**
 * Documented merge (spec §2.8): OPENCODE_CONFIG_CONTENT — высший приоритет,
 * загружается после project-слоя. Инъектируемый контент несёт строго
 * agents.*.model / providers / default_agent — по этим ключам инъектируемое
 * значение заменяет значение repo-конфига.
 */
function applyInjected(repoConfig, injected) {
  const merged = structuredClone(repoConfig);
  for (const [agent, def] of Object.entries(injected.agents ?? {})) {
    merged.agents = merged.agents ?? {};
    merged.agents[agent] = { ...(merged.agents[agent] ?? {}), ...def };
  }
  if (injected.providers) merged.providers = injected.providers;
  if (injected.default_agent) merged.default_agent = injected.default_agent;
  return merged;
}

bTest("docker (c): inject_opencode_config — строгий контракт (строго agents/providers/default_agent)", () => {
  const providers = {
    akash: { npm: "@ai-sdk/openai-compatible", options: { baseURL: "https://models.example.test" } },
  };
  const res = runInject({
    OC_BUILD_MODEL: "akash/model-x",
    OC_SONNET_MODEL: "other/model-y",
    OC_PROVIDERS_JSON: JSON.stringify(providers),
  });
  assert.equal(res.status, 0, `inject_opencode_config: ${res.stderr}`);
  const content = JSON.parse(res.stdout);
  assert.deepEqual(
    Object.keys(content).sort(),
    ["agents", "default_agent", "providers"],
    "инъектируемый конфиг — строго agents + providers + default_agent (spec §2.8): " +
      "permissions/policies/plugins/instructions запрещены",
  );
  assert.deepEqual(content.agents, {
    build: { model: "akash/model-x" },
    sonnet: { model: "other/model-y" },
  });
  assert.equal(content.default_agent, "build");
  assert.deepEqual(content.providers, providers);
});

bTest("docker (c): inject_opencode_config — без OC_*_MODEL: только default_agent=build", () => {
  const res = runInject({});
  assert.equal(res.status, 0, res.stderr);
  const content = JSON.parse(res.stdout);
  assert.deepEqual(Object.keys(content).sort(), ["default_agent"]);
  assert.equal(content.default_agent, "build");
});

bTest("docker (c): inject_opencode_config — OPENCODE_DEFAULT_AGENT переопределяет default", () => {
  const res = runInject({ OPENCODE_DEFAULT_AGENT: "plan" });
  assert.equal(res.status, 0, res.stderr);
  const content = JSON.parse(res.stdout);
  assert.equal(content.default_agent, "plan");
});

bTest("docker (c): inject_opencode_config — невалидный OC_PROVIDERS_JSON → fail-closed", () => {
  const res = runInject({ OC_PROVIDERS_JSON: "{not-json" });
  assert.notEqual(res.status, 0, "невалидный providers-JSON должен ронять entrypoint");
});

bTest("docker (c): anti-redirect — repo-конфиг не может перенаправить agents.*.model", () => {
  const res = runInject({ OC_BUILD_MODEL: "akash/model-x" });
  assert.equal(res.status, 0, res.stderr);
  const injected = JSON.parse(res.stdout);
  const repoConfig = {
    agents: { build: { model: "evil/attacker-endpoint" } },
    instructions: ["repo-controlled instructions"],
    permissions: { read: { "*": "allow" } },
  };
  const merged = applyInjected(repoConfig, injected);
  assert.equal(
    merged.agents.build.model,
    "akash/model-x",
    "инъектированная модель имеет высший приоритет (spec §2.8) — repo-redirect не действует",
  );
  // Остальные repo-ключи сохраняются (инъекция их не трогает) — но модель
  // и default_agent контролируются env-слоем.
  assert.equal(merged.instructions?.[0], "repo-controlled instructions");
  assert.equal(merged.default_agent, "build");
});
