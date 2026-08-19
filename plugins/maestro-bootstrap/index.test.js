import { describe, it, before, after } from "node:test";
import { strict as assert } from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { MaestroBootstrapPlugin, makeLogger, makeBoundedMap, sanitize, resolveSanitizeOptions, loadWhitelist, loadAccessPolicy, resolveFileAccess, filePathOf, loadTrustConfig, loadMaestroConfig } from "./core.js";

function readLogs(dir) {
  const logDir = path.join(dir, ".maestro");
  const files = fs.existsSync(logDir) ? fs.readdirSync(logDir) : [];
  const out = [];
  for (const f of files) {
    if (!f.endsWith(".log")) continue;
    for (const line of fs.readFileSync(path.join(logDir, f), "utf8").split("\n")) {
      if (line.trim()) out.push(JSON.parse(line));
    }
  }
  return out;
}

describe("maestro-bootstrap global logging", () => {
  let dir, hooks, entries, savedLogEnv;

  const LOG_ENV = [
    "MAESTRO_BOOTSTRAP_LOG_MASK",
    "MAESTRO_BOOTSTRAP_LOG_LEVEL",
    "MAESTRO_BOOTSTRAP_LOG_DIR",
  ];

  before(async () => {
    // Изолируем env: блок полагается на дефолтные настройки логгера, чтобы
    // внешние переменные окружения не меняли поведение (и невалидировали).
    savedLogEnv = {};
    for (const k of LOG_ENV) {
      savedLogEnv[k] = process.env[k];
      delete process.env[k];
    }
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "fab-test-"));
    hooks = await MaestroBootstrapPlugin({ directory: dir });
    entries = [];
  });

  after(() => {
    fs.rmSync(dir, { recursive: true, force: true });
    for (const k of LOG_ENV) {
      if (savedLogEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedLogEnv[k];
    }
  });

  it("should register event and tool.execute hooks, no chat.params/transform", () => {
    assert.equal(typeof hooks.event, "function");
    assert.equal(typeof hooks["tool.execute.before"], "function");
    assert.equal(typeof hooks["tool.execute.after"], "function");
    // Инжекция и привязка к агенту удалены (уход от агента maestro)
    assert.equal(hooks["experimental.chat.messages.transform"], undefined);
    assert.equal(hooks["chat.params"], undefined);
  });

  it("should log task dispatch (before/after) globally, no agent filter", async () => {
    await hooks["tool.execute.before"](
      { tool: "task", sessionID: "any-session", callID: "c-task" },
      { args: { description: "impl task 1" } },
    );
    await hooks["tool.execute.after"](
      { tool: "task", sessionID: "any-session", callID: "c-task", args: { description: "impl task 1" } },
      { title: "DONE", output: "ok", metadata: {} },
    );

    entries = readLogs(dir);
    const beforeEntry = entries.find((e) => e.msg === "tool.execute.before" && e.callID === "c-task");
    const afterEntry = entries.find((e) => e.msg === "tool.execute.after" && e.callID === "c-task");

    assert.ok(beforeEntry, "task before entry must exist (global, no agent)");
    assert.equal(beforeEntry.level, "info");
    assert.equal(beforeEntry.tool, "task");
    assert.equal(beforeEntry.sessionID, "any-session");

    assert.ok(afterEntry, "task after entry must exist");
    assert.equal(afterEntry.tool, "task");
    assert.equal(typeof afterEntry.durationMs, "number");
    assert.equal(afterEntry.title, "DONE");
  });

  it("should NOT log non-task tools (bash/skill) in detail", async () => {
    const before = readLogs(dir).length;
    await hooks["tool.execute.before"](
      { tool: "bash", sessionID: "s1", callID: "c-bash" },
      { args: { command: "npm run test:unit" } },
    );
    await hooks["tool.execute.after"](
      { tool: "bash", sessionID: "s1", callID: "c-bash", args: { command: "npm run test:unit" } },
      { title: "ok", output: "...", metadata: {} },
    );
    await hooks["tool.execute.before"](
      { tool: "skill", sessionID: "s1", callID: "c-skill" },
      { args: { name: "maestro" } },
    );
    await hooks["tool.execute.after"](
      { tool: "skill", sessionID: "s1", callID: "c-skill", args: { name: "maestro" } },
      { title: "ok", output: "", metadata: {} },
    );

    const added = readLogs(dir).slice(before);
    assert.equal(added.filter((e) => e.callID === "c-bash").length, 0, "bash not logged");
    assert.equal(added.filter((e) => e.callID === "c-skill").length, 0, "skill not logged");
  });

  it("should log session.error globally", async () => {
    await hooks.event({
      event: {
        type: "session.error",
        properties: {
          sessionID: "any-session",
          error: { type: "message_aborted", message: "Aborted by user" },
        },
      },
    });

    entries = readLogs(dir);
    const errEntry = entries.find((e) => e.msg === "session.error");
    assert.ok(errEntry, "session.error entry must exist (global)");
    assert.equal(errEntry.level, "warn");
    assert.equal(errEntry.sessionID, "any-session");
    assert.equal(errEntry.errorType, "message_aborted");
  });

  it("should log session.status retry globally", async () => {
    await hooks.event({
      event: {
        type: "session.status",
        properties: {
          sessionID: "any-session",
          status: { type: "retry", attempt: 2, message: "rate limit", next: 5000 },
        },
      },
    });

    entries = readLogs(dir);
    const retryEntry = entries.find((e) => e.msg === "session.status.retry");
    assert.ok(retryEntry, "retry entry must exist (global)");
    assert.equal(retryEntry.level, "warn");
    assert.equal(retryEntry.attempt, 2);
  });

  it("should log empty subagent result for task tool globally", async () => {
    await hooks["tool.execute.after"](
      { tool: "task", sessionID: "any-session", callID: "c-empty", args: { description: "impl" } },
      { title: undefined, output: "", metadata: {} },
    );

    entries = readLogs(dir);
    const emptyEntry = entries.find((e) => e.msg === "tool.execute.after.empty_result" && e.callID === "c-empty");
    assert.ok(emptyEntry, "empty result entry must exist (global)");
    assert.equal(emptyEntry.level, "warn");
    assert.equal(emptyEntry.tool, "task");
  });

  it("should NOT log empty subagent result for non-empty task result", async () => {
    await hooks["tool.execute.after"](
      { tool: "task", sessionID: "s1", callID: "c-not-empty", args: { description: "impl" } },
      { title: "DONE", output: "ok", metadata: {} },
    );

    entries = readLogs(dir);
    const emptyEntry = entries.find((e) => e.callID === "c-not-empty" && e.msg === "tool.execute.after.empty_result");
    assert.equal(emptyEntry, undefined, "no empty_result for non-empty result");
  });
});

describe("maestro-bootstrap sanitize (Context Sanitizer, Level 1)", () => {
  it("masks env secret assignments, keeping the variable name", () => {
    const res = sanitize("POSTGRES_PASSWORD=s3cr3t and API_TOKEN=abc");
    assert.equal(res.count, 2);
    assert.match(res.text, /POSTGRES_PASSWORD=<redacted>/);
    assert.match(res.text, /API_TOKEN=<redacted>/);
  });

  it("does not mask a non-secret env var", () => {
    const res = sanitize("POSTGRES_HOST=localhost");
    assert.equal(res.count, 0);
    assert.equal(res.text, "POSTGRES_HOST=localhost");
  });

  it("masks sensitive data fields in JSON", () => {
    const res = sanitize('{"amount": 1234.5, "currency": "USD", "name": "ok"}');
    assert.equal(res.count, 2);
    assert.match(res.text, /"amount": <redacted>/);
    assert.match(res.text, /"currency": <redacted>/);
    assert.match(res.text, /"name": "ok"/);
  });

  it("masks .env file references", () => {
    const res = sanitize("config from .env.local is loaded");
    assert.equal(res.count, 1);
    assert.match(res.text, /<redacted>/);
    assert.doesNotMatch(res.text, /\.env\.local/);
  });

  it("masks DB/SFTP URIs with embedded credentials", () => {
    const res = sanitize("postgres://user:pw123@db:5432/app sftp://alice:secret@host/path");
    assert.equal(res.count, 2);
    assert.doesNotMatch(res.text, /pw123/);
    assert.doesNotMatch(res.text, /secret/);
  });

  it("masks additional DB/SFTP URI schemes (ssh, ldap, clickhouse)", () => {
    const res = sanitize("ssh://root:rpass@host ldap://cn=admin:pw@ldap.example ftp://u:fpw@host");
    assert.equal(res.count, 3);
    assert.doesNotMatch(res.text, /rpass/);
    assert.doesNotMatch(res.text, /:pw@/);
    assert.doesNotMatch(res.text, /fpw/);
  });

  it("masks connection-string password params (key=value)", () => {
    const res = sanitize("host=db port=5432 user=admin password=s3cr3t dbname=app");
    assert.equal(res.count, 1);
    assert.doesNotMatch(res.text, /s3cr3t/);
    assert.match(res.text, /host=db/);
  });

  it("masks camelCase/snake_case sensitive field variants", () => {
    const res = sanitize('{"amountValue": 99.9, "ibanCode": "DE89...", "total_amount": 120}');
    assert.equal(res.count, 3);
    assert.doesNotMatch(res.text, /99\.9/);
    assert.doesNotMatch(res.text, /DE89/);
    assert.doesNotMatch(res.text, /120/);
  });

  it("masks PII and financial fields from expanded list", () => {
    const res = sanitize('{"card_number": "4111...", "phone": "+7-900-000-00-00", "inn": "7701234567"}');
    assert.equal(res.count, 3);
    assert.doesNotMatch(res.text, /4111/);
    assert.doesNotMatch(res.text, /\+7-900/);
    assert.doesNotMatch(res.text, /7701234567/);
  });

  it("masks lowercase/camelCase env secret assignments", () => {
    const res = sanitize("apiKey=abc123 dbPassword=secret accessToken=xyz");
    assert.equal(res.count, 3);
    assert.doesNotMatch(res.text, /abc123/);
    assert.doesNotMatch(res.text, /secret/);
    assert.doesNotMatch(res.text, /xyz/);
  });

  it("masks env secrets with new keywords (dsn, cert, salt)", () => {
    const res = sanitize("DB_DSN=postgres://h/p app_cert=base64str password_salt=abc");
    assert.equal(res.count, 3);
    assert.doesNotMatch(res.text, /base64str/);
    assert.doesNotMatch(res.text, /abc/);
  });

  it("masks private key blocks", () => {
    const res = sanitize("key:\n-----BEGIN RSA PRIVATE KEY-----\nMIIE...\n-----END RSA PRIVATE KEY-----");
    assert.equal(res.count, 1);
    assert.doesNotMatch(res.text, /MIIE/);
  });

  it("masks authorization headers", () => {
    const res = sanitize("Authorization: Bearer eyJhbGciOiJIUzI1NiJ9 X-API-Key: key123");
    assert.equal(res.count, 2);
    assert.doesNotMatch(res.text, /eyJhbGci/);
    assert.doesNotMatch(res.text, /key123/);
  });

  it("masks case-insensitive matches across rules", () => {
    const res = sanitize(
      '{"CardNumber": "4111", "Amount": 5} POSTGRES://u:pw@h ' +
        "-----BEGIN rsa private key-----\nMIIE\n-----END rsa private key-----",
    );
    assert.equal(res.count, 4);
    assert.doesNotMatch(res.text, /4111/);
    assert.doesNotMatch(res.text, /pw@h/);
    assert.doesNotMatch(res.text, /MIIE/);
  });

  it("masks camelCase variants of snake_case fields", () => {
    const res = sanitize('{"counterpartyId": "cp-1", "accountNumber": "A100"}');
    assert.equal(res.count, 2);
    assert.doesNotMatch(res.text, /cp-1/);
    assert.doesNotMatch(res.text, /A100/);
  });

  it("respects extra_fields via sanitize opts", () => {
    const res = sanitize('{"custom_field": "secret-value", "amount": 1}', { extraFields: ["custom_field"] });
    assert.equal(res.count, 2);
    assert.doesNotMatch(res.text, /secret-value/);
  });

  it("respects extra_uri_schemes via sanitize opts", () => {
    const res = sanitize("crm://bob:pw@crm.example/resource", { extraUriSchemes: ["crm"] });
    assert.equal(res.count, 1);
    assert.doesNotMatch(res.text, /pw@/);
  });

  it("respects extra_fields/extra_uri_schemes via resolveSanitizeOptions", () => {
    const whitelist = { patterns: [], extra_fields: ["internal_id"], extra_uri_schemes: ["grpc"] };
    const opts = resolveSanitizeOptions(whitelist, "haiku");
    assert.deepEqual(opts.extraFields, ["internal_id"]);
    assert.deepEqual(opts.extraUriSchemes, ["grpc"]);
    const res = sanitize('{"internal_id": "sec", "amount": 1}', opts);
    assert.equal(res.count, 2);
    assert.doesNotMatch(res.text, /"sec"/);
  });

  it("respects disabled rule categories via rules", () => {
    const res = sanitize('POSTGRES_PASSWORD=abc {"amount": 1}', { rules: { env_secret: false } });
    assert.match(res.text, /POSTGRES_PASSWORD=abc/);
    assert.match(res.text, /<redacted>/);
  });

  it("respects by_agent disabled rules via resolveSanitizeOptions", () => {
    const whitelist = { rules: {}, by_agent: { "code-reviewer": ["data_field"] }, patterns: [] };
    const opts = resolveSanitizeOptions(whitelist, "code-reviewer");
    assert.equal(opts.rules.data_field, false);
    assert.deepEqual(opts.disabledRules, ["data_field"]);
    const res = sanitize('{"amount": 1, "currency": "USD"}', opts);
    assert.equal(res.count, 0, "data_field disabled for code-reviewer");
  });

  it("keeps whitelist patterns intact", () => {
    const opts = resolveSanitizeOptions({ patterns: ["test-cp-1"] }, "haiku");
    const res = sanitize('{"counterparty_id": "test-cp-1", "amount": 5}', opts);
    assert.match(res.text, /test-cp-1/);
    assert.match(res.text, /<redacted>/);
  });

  it("returns empty result for empty/non-string input", () => {
    assert.deepEqual(sanitize(""), { text: "", count: 0 });
    assert.deepEqual(sanitize(undefined), { text: "", count: 0 });
  });

  it("loadWhitelist returns {} when no sanitizer_whitelist section", () => {
    assert.deepEqual(loadWhitelist({}), {});
  });

  it("loadWhitelist extracts sanitizer_whitelist section from config", () => {
    assert.deepEqual(
      loadWhitelist({ sanitizer_whitelist: { patterns: ["x"], rules: { env_secret: false } } }),
      { patterns: ["x"], rules: { env_secret: false } },
    );
  });

  it("loadMaestroConfig returns {} when file missing", () => {
    assert.deepEqual(loadMaestroConfig("/nonexistent/maestro.json"), {});
  });

  it("loadMaestroConfig parses valid maestro.json", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fab-mc-"));
    try {
      fs.writeFileSync(path.join(dir, "maestro.json"), JSON.stringify({
        trust: { design: true, sanitizer: true },
        access_policy: { default: "ask", allow: ["src/**"] },
        sanitizer_whitelist: { patterns: ["safe_value"], extra_fields: ["custom_field"] },
      }));
      const config = loadMaestroConfig(undefined, dir);
      assert.deepEqual(config.trust, { design: true, sanitizer: true });
      assert.deepEqual(config.access_policy.allow, ["src/**"]);
      assert.deepEqual(config.sanitizer_whitelist.patterns, ["safe_value"]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("loadWhitelist reads sanitizer_whitelist from maestro.json config", () => {
    const config = {
      sanitizer_whitelist: { patterns: ["from_maestro_json"], extra_fields: ["proj_field"] },
    };
    const wl = loadWhitelist(config);
    assert.deepEqual(wl.patterns, ["from_maestro_json"]);
    assert.deepEqual(wl.extra_fields, ["proj_field"]);
  });
});

describe("maestro-bootstrap sanitizer hook (Level 1 in tool.execute.before)", () => {
  let dir, hooks, savedLogEnv;

  const LOG_ENV = ["MAESTRO_BOOTSTRAP_LOG_MASK", "MAESTRO_BOOTSTRAP_LOG_LEVEL", "MAESTRO_BOOTSTRAP_LOG_DIR", "MAESTRO_CONFIG"];

  before(async () => {
    savedLogEnv = {};
    for (const k of LOG_ENV) {
      savedLogEnv[k] = process.env[k];
      delete process.env[k];
    }
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "fab-sanitize-hook-"));
    hooks = await MaestroBootstrapPlugin({ directory: dir });
  });

  after(() => {
    fs.rmSync(dir, { recursive: true, force: true });
    for (const k of LOG_ENV) {
      if (savedLogEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedLogEnv[k];
    }
  });

  it("redacts prompt with a secret in task args", async () => {
    const output = { args: { subagent_type: "haiku", prompt: "Implement with POSTGRES_PASSWORD=topsecret" } };
    await hooks["tool.execute.before"]({ tool: "task", sessionID: "s", callID: "c-san" }, output);
    assert.match(output.args.prompt, /POSTGRES_PASSWORD=<redacted>/);
    assert.doesNotMatch(output.args.prompt, /topsecret/);
  });

  it("does not modify prompt when nothing sensitive", async () => {
    const output = { args: { subagent_type: "sonnet", prompt: "Implement a simple endpoint" } };
    await hooks["tool.execute.before"]({ tool: "task", sessionID: "s", callID: "c-clean" }, output);
    assert.equal(output.args.prompt, "Implement a simple endpoint");
  });

  it("leaves non-task tools untouched", async () => {
    const output = { args: { command: "cat .env" } };
    await hooks["tool.execute.before"]({ tool: "bash", sessionID: "s", callID: "c-bash" }, output);
    assert.equal(output.args.command, "cat .env");
  });
});

describe("maestro-bootstrap trusted skip (D2/D3)", () => {
  let dir, hooks, savedLogEnv;

  const LOG_ENV = ["MAESTRO_BOOTSTRAP_LOG_MASK", "MAESTRO_BOOTSTRAP_LOG_LEVEL", "MAESTRO_BOOTSTRAP_LOG_DIR", "MAESTRO_CONFIG"];

  before(async () => {
    savedLogEnv = {};
    for (const k of LOG_ENV) {
      savedLogEnv[k] = process.env[k];
      delete process.env[k];
    }
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "fab-trust-"));
    // maestro.json: sanitizer trusted, haiku нет.
    fs.writeFileSync(path.join(dir, "maestro.json"), JSON.stringify({
      trust: { sanitizer: true },
    }));
    hooks = await MaestroBootstrapPlugin({ directory: dir });
  });

  after(() => {
    fs.rmSync(dir, { recursive: true, force: true });
    for (const k of LOG_ENV) {
      if (savedLogEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedLogEnv[k];
    }
  });

  it("loadTrustConfig extracts trusted agents from config", () => {
    const trusted = loadTrustConfig({ trust: { sanitizer: true } });
    assert.ok(trusted.has("sanitizer"));
    assert.ok(!trusted.has("haiku"));
  });

  it("loadTrustConfig returns empty set when trust section absent", () => {
    assert.equal(loadTrustConfig({}).size, 0);
  });

  it("skips sanitize for trusted subagent (sanitizer)", async () => {
    const output = { args: { subagent_type: "sanitizer", prompt: "Check POSTGRES_PASSWORD=topsecret" } };
    await hooks["tool.execute.before"]({ tool: "task", sessionID: "s", callID: "c-trusted" }, output);
    assert.match(output.args.prompt, /topsecret/, "trusted prompt not sanitized");
  });

  it("sanitizes prompt for untrusted subagent (haiku)", async () => {
    const output = { args: { subagent_type: "haiku", prompt: "Check POSTGRES_PASSWORD=topsecret" } };
    await hooks["tool.execute.before"]({ tool: "task", sessionID: "s", callID: "c-untrusted" }, output);
    assert.doesNotMatch(output.args.prompt, /topsecret/, "untrusted prompt sanitized");
  });
});

describe("maestro-bootstrap access policy (file access control)", () => {
  it("loadAccessPolicy returns exists:false when section absent", () => {
    const p = loadAccessPolicy({});
    assert.equal(p.exists, false);
    assert.equal(p.default, "ask");
  });

  it("loadAccessPolicy extracts access_policy section from config", () => {
    const p = loadAccessPolicy({ access_policy: { default: "ask", allow: ["src/**"], ask: ["docs/**"], deny: ["*.env"] } });
    assert.equal(p.exists, true);
    assert.deepEqual(p.allow, ["src/**"]);
    assert.deepEqual(p.ask, ["docs/**"]);
  });

  it("resolveFileAccess allow-matches code paths", () => {
    const policy = { default: "ask", allow: ["src/**", "*.{ts,js}"], ask: ["docs/**"], deny: ["*.env"] };
    assert.equal(resolveFileAccess(policy, "src/app.ts"), "allow");
    assert.equal(resolveFileAccess(policy, "index.ts"), "allow");
  });

  it("resolveFileAccess ask-matches protected paths", () => {
    const policy = { default: "ask", allow: ["src/**"], ask: ["docs/**", "*.config.*"], deny: [] };
    assert.equal(resolveFileAccess(policy, "docs/architecture.md"), "ask");
    assert.equal(resolveFileAccess(policy, "webpack.config.js"), "ask");
  });

  it("resolveFileAccess deny always wins", () => {
    const policy = { default: "ask", allow: ["src/**"], ask: [], deny: ["src/.env"] };
    assert.equal(resolveFileAccess(policy, "src/.env"), "deny");
    assert.equal(resolveFileAccess(policy, "src/other.ts"), "allow");
  });

  it("resolveFileAccess falls back to default when no pattern matches", () => {
    const policy = { default: "ask", allow: ["src/**"], ask: [], deny: [] };
    assert.equal(resolveFileAccess(policy, "misc/readme.txt"), "ask");
    const allowDefault = { default: "allow", allow: [], ask: ["docs/**"], deny: [] };
    assert.equal(resolveFileAccess(allowDefault, "anything"), "allow");
  });

  it("filePathOf extracts target only for read tool", () => {
    assert.equal(filePathOf("read", { filePath: "a.ts" }), "a.ts");
    assert.equal(filePathOf("read", {}), undefined);
    // bash/glob/grep не покрываются access-policy (C1/I4) — возвращают undefined.
    assert.equal(filePathOf("glob", { pattern: "src/**" }), undefined);
    assert.equal(filePathOf("bash", { command: "cat docs/x.md" }), undefined);
    assert.equal(filePathOf("grep", { pattern: "secret" }), undefined);
    assert.equal(filePathOf("task", { prompt: "x" }), undefined);
  });
});

describe("maestro-bootstrap access policy hook", () => {
  let dir, hooks, savedLogEnv;

  const LOG_ENV = ["MAESTRO_BOOTSTRAP_LOG_MASK", "MAESTRO_BOOTSTRAP_LOG_LEVEL", "MAESTRO_BOOTSTRAP_LOG_DIR", "MAESTRO_CONFIG"];

  before(async () => {
    savedLogEnv = {};
    for (const k of LOG_ENV) {
      savedLogEnv[k] = process.env[k];
      delete process.env[k];
    }
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "fab-ap-hook-"));
    // Создаём maestro.json с access_policy: code allow, docs/config ask.
    fs.writeFileSync(
      path.join(dir, "maestro.json"),
      JSON.stringify({
        access_policy: { default: "ask", allow: ["src/**", "*.{ts,js}"], ask: ["docs/**", "*.config.*"], deny: ["*.env"] },
      }),
    );
    hooks = await MaestroBootstrapPlugin({ directory: dir });
  });

  after(() => {
    fs.rmSync(dir, { recursive: true, force: true });
    for (const k of LOG_ENV) {
      if (savedLogEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedLogEnv[k];
    }
  });

  it("allows code file reads (allow match)", async () => {
    const output = { args: { filePath: "src/app.ts" } };
    await hooks["tool.execute.before"]({ tool: "read", sessionID: "s", callID: "c1" }, output);
    // не должно выбросить ошибку
    assert.ok(true);
  });

  it("throws on ask-matched path (docs/config)", async () => {
    const output = { args: { filePath: "docs/architecture.md" } };
    await assert.rejects(
      hooks["tool.execute.before"]({ tool: "read", sessionID: "s", callID: "c2" }, output),
      /access-policy:ask/,
    );
  });

  it("throws on deny-matched path (.env)", async () => {
    const output = { args: { filePath: "src/.env" } };
    await assert.rejects(
      hooks["tool.execute.before"]({ tool: "read", sessionID: "s", callID: "c3" }, output),
      /access-policy:deny/,
    );
  });
});

describe("maestro-bootstrap log mask (MAESTRO_BOOTSTRAP_LOG_MASK)", () => {
  // Каждый case строит собственный плагин, т.к. маска читается при инициализации.
  const KEY = "MAESTRO_BOOTSTRAP_LOG_MASK";
  const LEVEL = "MAESTRO_BOOTSTRAP_LOG_LEVEL";
  let saved;

  before(() => {
    saved = { key: process.env[KEY], level: process.env[LEVEL] };
    delete process.env[KEY];
    delete process.env[LEVEL];
  });

  after(() => {
    if (saved.key === undefined) delete process.env[KEY];
    else process.env[KEY] = saved.key;
    if (saved.level === undefined) delete process.env[LEVEL];
    else process.env[LEVEL] = saved.level;
  });

  // Плагин сокращён (уход от агента maestro): только `task` логируется на info,
  // session.error — на warn; debug-логов тулов нет. env ставится ДО создания
  // плагина (маска и порог читаются при инициализации).
  async function build(mask, level) {
    delete process.env[KEY];
    delete process.env[LEVEL];
    if (mask) process.env[KEY] = mask;
    if (level) process.env[LEVEL] = level;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fab-mask-"));
    const p = await MaestroBootstrapPlugin({ directory: dir });
    return { dir, p };
  }

  async function seed(_p, _sessionID) {}

  it("default mask keeps info/warn/error, no debug for tools", async () => {
    const { dir, p } = await build(null);
    try {
      await seed(p, "s");
      await p["tool.execute.before"]({ tool: "task", sessionID: "s", callID: "inf" }, { args: { description: "t" } });
      await p.event({ event: { type: "session.error", properties: { sessionID: "s", error: { type: "x", message: "m" } } } });
      const entries = readLogs(dir);
      assert.ok(entries.find((e) => e.callID === "inf"), "info-level entry logged by default");
      assert.ok(entries.find((e) => e.msg === "session.error"), "warn-level entry logged by default");
      const init = entries.find((e) => e.msg === "plugin initialized");
      assert.equal(init.mask, "info,warn,error");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("disabling info suppresses info-level entries only", async () => {
    const { dir, p } = await build("warn,error", "debug");
    try {
      await seed(p, "s");
      await p["tool.execute.before"]({ tool: "task", sessionID: "s", callID: "inf" }, { args: { description: "t" } });
      await p.event({ event: { type: "session.error", properties: { sessionID: "s", error: { type: "x", message: "m" } } } });
      const entries = readLogs(dir);
      assert.equal(entries.find((e) => e.callID === "inf"), undefined, "info suppressed");
      assert.ok(entries.find((e) => e.msg === "session.error"), "warn still logged");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("disabling warn suppresses warn-level entries only", async () => {
    const { dir, p } = await build("debug,info,error");
    try {
      await seed(p, "s");
      await p["tool.execute.before"]({ tool: "task", sessionID: "s", callID: "inf" }, { args: { description: "t" } });
      await p.event({ event: { type: "session.error", properties: { sessionID: "s", error: { type: "x", message: "m" } } } });
      const entries = readLogs(dir);
      assert.ok(entries.find((e) => e.callID === "inf"), "info still logged");
      assert.equal(entries.find((e) => e.msg === "session.error"), undefined, "warn suppressed");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("mask intersects with MAESTRO_BOOTSTRAP_LOG_LEVEL threshold", async () => {
    const { dir, p } = await build("debug,info,warn,error", "info"); // порог отсекает debug (нет debug-тулов)
    try {
      await seed(p, "s");
      await p["tool.execute.before"]({ tool: "task", sessionID: "s", callID: "inf" }, { args: { description: "t" } });
      const entries = readLogs(dir);
      assert.ok(entries.find((e) => e.callID === "inf"), "info still logged (info >= threshold)");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("mask without valid levels disables all levels", async () => {
    const { dir, p } = await build("bogus,nonexsistent"); // ни один уровень не валиден
    try {
      await seed(p, "s");
      await p["tool.execute.before"]({ tool: "task", sessionID: "s", callID: "inf" }, { args: { description: "t" } });
      await p.event({ event: { type: "session.error", properties: { sessionID: "s", error: { type: "x", message: "m" } } } });
      const entries = readLogs(dir);
      assert.equal(entries.find((e) => e.msg === "plugin initialized"), undefined, "no logs with invalid-only mask");
      assert.equal(entries.find((e) => e.callID === "inf"), undefined, "no info with invalid-only mask");
      assert.equal(entries.find((e) => e.msg === "session.error"), undefined, "no warn with invalid-only mask");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("maestro-bootstrap makeLogger (level filtering)", () => {
  const KEY = "MAESTRO_BOOTSTRAP_LOG_MASK";
  const LEVEL = "MAESTRO_BOOTSTRAP_LOG_LEVEL";
  let saved;

  before(() => {
    saved = { key: process.env[KEY], level: process.env[LEVEL] };
    delete process.env[KEY];
    delete process.env[LEVEL];
  });

  after(() => {
    if (saved.key === undefined) delete process.env[KEY];
    else process.env[KEY] = saved.key;
    if (saved.level === undefined) delete process.env[LEVEL];
    else process.env[LEVEL] = saved.level;
  });

  function build(mask, level) {
    delete process.env[KEY];
    delete process.env[LEVEL];
    if (mask) process.env[KEY] = mask;
    if (level) process.env[LEVEL] = level;
    const host = fs.mkdtempSync(path.join(os.tmpdir(), "fab-host-"));
    const log = makeLogger(host);
    return { host, log };
  }

  function cleanup(host) {
    fs.rmSync(host, { recursive: true, force: true });
  }

  it("error level can be disabled by mask", () => {
    const { host, log } = build("debug,info,warn"); // без error
    try {
      log.error("some.error", { detail: "x" });
      const entries = readLogs(host);
      assert.equal(entries.find((e) => e.msg === "some.error"), undefined, "error suppressed when not in mask");
    } finally {
      cleanup(host);
    }
  });

  it("error level logged when in mask", () => {
    const { host, log } = build("debug,info,warn,error");
    try {
      log.error("some.error", { detail: "x" });
      const entries = readLogs(host);
      const entry = entries.find((e) => e.msg === "some.error");
      assert.ok(entry, "error logged when in mask");
      assert.equal(entry.level, "error");
      assert.equal(entry.detail, "x");
    } finally {
      cleanup(host);
    }
  });

  it("error level can be disabled by threshold when mask includes it", () => {
    const { host, log } = build(null, "error"); // mask выведен из порога: только error
    try {
      log.error("some.error", {});
      const entries = readLogs(host);
      assert.ok(entries.find((e) => e.msg === "some.error"), "error logged at threshold error");
    } finally {
      cleanup(host);
    }
  });

  it("invalid LOG_LEVEL value falls back to debug threshold", () => {
    const { host, log } = build(null, "bogus"); // невалидный уровень → порог 10 (debug)
    try {
      log.debug("d", {});
      log.error("e", {});
      const entries = readLogs(host);
      assert.ok(entries.find((e) => e.msg === "d"), "debug logged (threshold fallback)");
      assert.ok(entries.find((e) => e.msg === "e"), "error logged");
    } finally {
      cleanup(host);
    }
  });
});

describe("maestro-bootstrap makeBoundedMap", () => {
  it("evicts oldest entry when exceeding max", () => {
    const m = makeBoundedMap(2);
    m.set("a", 1);
    m.set("b", 2);
    m.set("c", 3); // вытесняет "a"
    assert.equal(m.size(), 2);
    assert.equal(m.get("a"), undefined, "oldest evicted");
    assert.equal(m.get("b"), 2);
    assert.equal(m.get("c"), 3);
  });

  it("delete reduces size and allows reuse", () => {
    const m = makeBoundedMap(2);
    m.set("a", 1);
    m.set("b", 2);
    m.delete("a");
    m.set("c", 3);
    m.set("d", 4); // вытесняет "b" (старейший из оставшихся)
    assert.equal(m.size(), 2);
    assert.equal(m.get("b"), undefined);
    assert.equal(m.get("c"), 3);
    assert.equal(m.get("d"), 4);
  });

  it("resetting existing key does not evict (size stable)", () => {
    const m = makeBoundedMap(2);
    m.set("a", 1);
    m.set("b", 2);
    m.set("a", 10);
    assert.equal(m.size(), 2, "re-set does not grow size");
    assert.equal(m.get("a"), 10);
    assert.equal(m.get("b"), 2);
  });
});