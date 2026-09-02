import { describe, it, before, after } from "node:test";
import { strict as assert } from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { MaestroBootstrapPlugin, makeLogger, makeBoundedMap, sanitize, resolveSanitizeOptions, loadWhitelist, loadAccessPolicy, resolveFileAccess, filePathOf, loadTrustConfig, loadMaestroConfig, detectUnsafePatterns, allRulesDisabled, loadConfidentialConfig, resolveIsTrustedSubagent, normalizeTarget, isConfidentialTarget, confGlobMatch, readPluginVersion, writePluginVersionFile, isPluginMetaFile } from "./core.js";

function readLogs(dir, filePrefix = "maestro-bootstrap") {
  const logDir = path.join(dir, ".maestro/logs");
  const files = fs.existsSync(logDir) ? fs.readdirSync(logDir) : [];
  const out = [];
  for (const f of files) {
    if (!f.endsWith(".log") || !f.includes(filePrefix)) continue;
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

  it("should sanitize sensitive data in task title before logging (SEC-4)", async () => {
    await hooks["tool.execute.before"](
      { tool: "task", sessionID: "sec-session", callID: "c-sec" },
      { args: { description: "impl" } },
    );
    await hooks["tool.execute.after"](
      { tool: "task", sessionID: "sec-session", callID: "c-sec", args: { description: "impl" } },
      { title: "report: API_KEY=sk123456 PASSWORD=hunter2", output: "ok", metadata: {} },
    );

    entries = readLogs(dir);
    const afterEntry = entries.find((e) => e.msg === "tool.execute.after" && e.callID === "c-sec");
    assert.ok(afterEntry, "after entry must exist");
    assert.doesNotMatch(afterEntry.title, /sk123456/, "secret key must be sanitized");
    assert.doesNotMatch(afterEntry.title, /hunter2/, "password must be sanitized");
    assert.match(afterEntry.title, /<redacted>/, "title should contain redaction marker");
  });

  it("should honor configured extra_fields when sanitizing task title (SEC-4 config path)", async () => {
    const cfgDir = fs.mkdtempSync(path.join(os.tmpdir(), "fab-title-cfg-"));
    try {
      fs.writeFileSync(
        path.join(cfgDir, "maestro.json"),
        JSON.stringify({
          sanitizer_whitelist: { extra_fields: ["internal_ssn"] },
        }),
      );
      const cfgHooks = await MaestroBootstrapPlugin({ directory: cfgDir });
      await cfgHooks["tool.execute.before"](
        { tool: "task", sessionID: "cfg-session", callID: "c-cfg" },
        { args: { subagent_type: "haiku", description: "impl" } },
      );
      await cfgHooks["tool.execute.after"](
        { tool: "task", sessionID: "cfg-session", callID: "c-cfg", args: { subagent_type: "haiku", description: "impl" } },
        { title: 'report: internal_ssn: "123-45-6789"', output: "ok", metadata: {} },
      );

      const cfgEntry = readLogs(cfgDir).find((e) => e.msg === "tool.execute.after" && e.callID === "c-cfg");
      assert.ok(cfgEntry, "after entry must exist for configured-whitelist plugin");
      assert.doesNotMatch(cfgEntry.title, /123-45-6789/, "configured extra_field must be sanitized in title");
      assert.match(cfgEntry.title, /<redacted>/, "title should contain redaction marker");
    } finally {
      fs.rmSync(cfgDir, { recursive: true, force: true });
    }
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

  it("does not mask the provenance marker 'из confidential' (OQ-10/S10)", () => {
    const res = sanitize("Фрагмент основан на данных из confidential: поле balance.");
    assert.equal(res.count, 0, "provenance marker is metadata, not a value");
    assert.match(res.text, /из confidential/);
  });

  it("does not false-positive on the provenance marker (A6)", () => {
    const res = sanitize("из confidential — секция 3.1 (тип: число, обязательное)");
    assert.equal(res.count, 0);
    assert.equal(res.text, "из confidential — секция 3.1 (тип: число, обязательное)");
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

  it("masks http(s) URI credentials (http:// and https://)", () => {
    const res = sanitize("a=http://user:pw@h/path b=https://user:sp@h/path");
    assert.equal(res.count, 2);
    assert.doesNotMatch(res.text, /pw@/);
    assert.doesNotMatch(res.text, /sp@/);
    assert.doesNotMatch(res.text, /:pw/);
    assert.doesNotMatch(res.text, /:sp/);
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
    // count=2: `password=` маскируется и env_secret, и conn_password (defense in depth)
    assert.equal(res.count, 2);
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
    // count=2: PEM-блок (private_key) + `key:` (SECRET_COLON) — оба маскируют.
    assert.equal(res.count, 2);
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

  it("detectUnsafePatterns flags secret-like whitelist patterns, ignores safe (SEC-6)", () => {
    const whitelist = {
      patterns: [
        "safe_value",
        "test-cp-1",
        "sk_live_1234567890abcdef",
        "AKIAIOSFODNN7EXAMPLE",
        "ghp_abcdef123456",
        "-----BEGIN RSA PRIVATE KEY-----",
      ],
    };
    const dangerous = detectUnsafePatterns(whitelist);
    assert.ok(dangerous.includes("sk_live_1234567890abcdef"));
    assert.ok(dangerous.includes("AKIAIOSFODNN7EXAMPLE"));
    assert.ok(dangerous.includes("ghp_abcdef123456"));
    assert.ok(dangerous.includes("-----BEGIN RSA PRIVATE KEY-----"));
    assert.ok(!dangerous.includes("safe_value"));
    assert.ok(!dangerous.includes("test-cp-1"));
  });

  it("allRulesDisabled detects full rule-off for an agent (SEC-7)", () => {
    const allOff = resolveSanitizeOptions(
      { rules: { env_secret: false, data_field: false, env_file: false, db_credential: false, ledger_entry: false, private_key: false, auth_header: false } },
      "haiku",
    );
    assert.equal(allRulesDisabled(allOff), true);
    const defaults = resolveSanitizeOptions({}, "haiku");
    assert.equal(allRulesDisabled(defaults), false);
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
        trust: { custodian: true, sanitizer: true },
        access_policy: { default: "ask", allow: ["src/**"] },
        sanitizer_whitelist: { patterns: ["safe_value"], extra_fields: ["custom_field"] },
      }));
      const config = loadMaestroConfig(undefined, dir);
      assert.deepEqual(config.trust, { custodian: true, sanitizer: true });
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

  // --- SEC-1: однословные секрет-keyword маскируются (регрессия) ---
  it("masks single-word secret keywords at name start (SEC-1)", () => {
    for (const s of ["TOKEN=abc", "KEY=abc", "SECRET=abc", "AUTH=abc", "CREDENTIAL=abc"]) {
      const res = sanitize(s);
      assert.doesNotMatch(res.text, /=abc/, `${s} value must be masked`);
    }
  });

  it("still masks prefixed and camelCase secret keywords (no regression)", () => {
    const res = sanitize(
      "API_KEY=abc POSTGRES_PASSWORD=def JWT_SECRET=ghi apiKey=jkl dbPassword=mno",
    );
    for (const m of ["abc", "def", "ghi", "jkl", "mno"]) {
      assert.doesNotMatch(res.text, new RegExp(m), `value ${m} must be masked`);
    }
  });

  // --- SEC-1b: colon-стиль, JSON-ключи, URI с анонимным user, JWT ---
  it("masks colon-style secrets (password: x, API_KEY: x) (SEC-1b)", () => {
    const res = sanitize("password: supersecret123 API_KEY: 1234567890abcdef");
    assert.doesNotMatch(res.text, /supersecret123/);
    assert.doesNotMatch(res.text, /1234567890abcdef/);
  });

  it("masks JSON secret keys (client_secret, apiKey, password) (SEC-1b)", () => {
    const res = sanitize('{"client_secret": "s3cr3t", "apiKey": "abcd1234", "password": "p@ss"}');
    assert.doesNotMatch(res.text, /s3cr3t/);
    assert.doesNotMatch(res.text, /abcd1234/);
    assert.doesNotMatch(res.text, /p@ss/);
  });

  it("masks URI with anonymous user (postgres://:pass@host) (SEC-1b)", () => {
    const res = sanitize("postgres://:mypass@host:5432/db redis://:mysecret@localhost:6379/0");
    assert.doesNotMatch(res.text, /mypass/);
    assert.doesNotMatch(res.text, /mysecret/);
  });

  it("masks standalone JWT outside Authorization header (SEC-1b)", () => {
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.signature";
    const res = sanitize(`Bearer ${jwt} token=${jwt} session=${jwt}`);
    assert.doesNotMatch(res.text, /eyJhbGci/);
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

  it("filePathOf extracts target for read/write/edit, not bash/glob/grep", () => {
    assert.equal(filePathOf("read", { filePath: "a.ts" }), "a.ts");
    assert.equal(filePathOf("read", {}), undefined);
    assert.equal(filePathOf("write", { filePath: "docs/confidential/x.md", content: "hi" }), "docs/confidential/x.md");
    assert.equal(filePathOf("edit", { filePath: "docs/confidential/y.md", oldString: "a", newString: "b" }), "docs/confidential/y.md");
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

describe("maestro-bootstrap confidential config", () => {
  it("returns defaults when section missing", () => {
    const c = loadConfidentialConfig({});
    assert.equal(c.exists, false);
    assert.deepEqual(c.paths, ["docs/confidential/**"]);
    assert.deepEqual(c.trusted, { read: "allow", write: "deny", edit: "deny" });
  });

  it("returns default trusted when section present but empty", () => {
    const c = loadConfidentialConfig({ confidential: {} });
    assert.equal(c.exists, true);
    assert.deepEqual(c.paths, ["docs/confidential/**"]);
    assert.deepEqual(c.trusted, { read: "allow", write: "deny", edit: "deny" });
  });

  it("parses paths and trusted map", () => {
    const c = loadConfidentialConfig({
      confidential: {
        paths: ["docs/confidential/**", "secrets/internals/**"],
        trusted: { read: "deny", write: "allow", edit: "allow" },
      },
    });
    assert.equal(c.exists, true);
    assert.deepEqual(c.paths, ["docs/confidential/**", "secrets/internals/**"]);
    assert.deepEqual(c.trusted, { read: "deny", write: "allow", edit: "allow" });
  });

  it("clamps invalid trusted values to deny", () => {
    const c = loadConfidentialConfig({
      confidential: { trusted: { read: "banana", write: "allow", edit: "allow" } },
    });
    assert.equal(c.trusted.read, "deny");
    assert.equal(c.trusted.write, "allow");
    assert.equal(c.trusted.edit, "allow");
  });

  it("always exposes builtin set regardless of section presence (OQ-3)", () => {
    const noSection = loadConfidentialConfig({});
    assert.deepEqual(noSection.builtin, [".env", ".env.*", "*.pem", "*.key", "*.crt", "*.p12", "*.pfx"]);
    const withSection = loadConfidentialConfig({ confidential: { paths: ["secrets/**"] } });
    assert.deepEqual(withSection.builtin, [".env", ".env.*", "*.pem", "*.key", "*.crt", "*.p12", "*.pfx"]);
  });
});

describe("maestro-bootstrap confidential subagent identity", () => {
  function mockClient({ session = {}, messages = [] } = {}) {
    return {
      session: {
        get: async ({ path }) => {
          if (session.id === "missing") throw new Error("not found");
          return { data: session };
        },
        messages: async () => ({ data: messages }),
      },
    };
  }

  it("denies when no client (fail-closed)", async () => {
    const res = await resolveIsTrustedSubagent(undefined, new Set(["custodian"]), "s1");
    assert.equal(res.trusted, false);
    assert.equal(res.agent, undefined);
  });

  it("denies root/primary session (no parentID)", async () => {
    const client = mockClient({ session: { id: "root" } });
    const res = await resolveIsTrustedSubagent(client, new Set(["custodian"]), "root");
    assert.equal(res.trusted, false);
    assert.equal(res.agent, undefined);
  });

  it("allows trusted subagent by AssistantMessage.mode", async () => {
    const client = mockClient({
      session: { id: "child", parentID: "root" },
      messages: [{ info: { role: "assistant", mode: "custodian" }, parts: [] }],
    });
    const res = await resolveIsTrustedSubagent(client, new Set(["custodian"]), "child");
    assert.equal(res.trusted, true);
    assert.equal(res.agent, "custodian");
  });

  it("denies untrusted subagent", async () => {
    const client = mockClient({
      session: { id: "child", parentID: "root" },
      messages: [{ info: { role: "assistant", mode: "haiku" }, parts: [] }],
    });
    const res = await resolveIsTrustedSubagent(client, new Set(["custodian"]), "child");
    assert.equal(res.trusted, false);
    assert.equal(res.agent, "haiku");
  });

  it("allows by UserMessage.agent", async () => {
    const client = mockClient({
      session: { id: "child", parentID: "root" },
      messages: [{ info: { role: "user", agent: "sanitizer" }, parts: [] }],
    });
    const res = await resolveIsTrustedSubagent(client, new Set(["sanitizer"]), "child");
    assert.equal(res.trusted, true);
    assert.equal(res.agent, "sanitizer");
  });

  it("allows by SubtaskPart.agent in parts", async () => {
    const client = mockClient({
      session: { id: "child", parentID: "root" },
      messages: [{ info: { role: "assistant" }, parts: [{ type: "subtask", agent: "custodian" }] }],
    });
    const res = await resolveIsTrustedSubagent(client, new Set(["custodian"]), "child");
    assert.equal(res.trusted, true);
    assert.equal(res.agent, "custodian");
  });

  it("denies when agent not resolvable", async () => {
    const client = mockClient({
      session: { id: "child", parentID: "root" },
      messages: [{ info: { role: "assistant" }, parts: [] }],
    });
    const res = await resolveIsTrustedSubagent(client, new Set(["custodian"]), "child");
    assert.equal(res.trusted, false);
    assert.equal(res.agent, undefined);
  });

  it("denies on session lookup error (fail-closed)", async () => {
    const client = mockClient({ session: { id: "missing" } });
    const res = await resolveIsTrustedSubagent(client, new Set(["custodian"]), "missing");
    assert.equal(res.trusted, false);
    assert.equal(res.agent, undefined);
  });
});

describe("maestro-bootstrap filePathOf for confidential tools", () => {
  it("extracts filePath from read", () => {
    assert.equal(filePathOf("read", { filePath: "src/a.ts" }), "src/a.ts");
  });
  it("extracts filePath from write", () => {
    assert.equal(filePathOf("write", { filePath: "docs/confidential/x.md", content: "hi" }), "docs/confidential/x.md");
  });
  it("extracts filePath from edit", () => {
    assert.equal(filePathOf("edit", { filePath: "docs/confidential/y.md", oldString: "a", newString: "b" }), "docs/confidential/y.md");
  });
  it("returns undefined for non-file tools", () => {
    assert.equal(filePathOf("bash", { command: "ls" }), undefined);
    assert.equal(filePathOf("read", {}), undefined);
  });
});

describe("maestro-bootstrap confidential enforcement", () => {
  let dir, hooks, savedLogEnv;
  const LOG_ENV = ["MAESTRO_BOOTSTRAP_LOG_MASK", "MAESTRO_BOOTSTRAP_LOG_LEVEL", "MAESTRO_BOOTSTRAP_LOG_DIR"];

  function makeClient(sessions) {
    return {
      session: {
        get: async ({ path }) => {
          const rec = sessions[path.id];
          if (!rec) throw new Error("not found");
          return { data: rec.session };
        },
        messages: async ({ path }) => {
          const rec = sessions[path.id];
          if (!rec) return { data: [] };
          return { data: rec.messages };
        },
      },
    };
  }

  const rootSessions = {
    root: { session: { id: "root" }, messages: [] },
    childTrusted: {
      session: { id: "childTrusted", parentID: "root" },
      messages: [{ info: { role: "assistant", mode: "custodian" }, parts: [] }],
    },
    childUntrusted: {
      session: { id: "childUntrusted", parentID: "root" },
      messages: [{ info: { role: "assistant", mode: "haiku" }, parts: [] }],
    },
  };

  before(async () => {
    savedLogEnv = {};
    for (const k of LOG_ENV) { savedLogEnv[k] = process.env[k]; delete process.env[k]; }
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "fab-conf-"));
    fs.writeFileSync(path.join(dir, "maestro.json"), JSON.stringify({
      trust: { custodian: true },
      confidential: { paths: ["docs/confidential/**"], trusted: { read: "allow", write: "deny", edit: "deny" } },
    }));
    hooks = await MaestroBootstrapPlugin({ directory: dir, client: makeClient(rootSessions) });
  });

  after(() => {
    fs.rmSync(dir, { recursive: true, force: true });
    for (const k of LOG_ENV) {
      if (savedLogEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedLogEnv[k];
    }
  });

  it("allows trusted subagent read of confidential", async () => {
    const out = { args: { filePath: "docs/confidential/secrets.md" } };
    await hooks["tool.execute.before"]({ tool: "read", sessionID: "childTrusted", callID: "c1" }, out);
    assert.ok(true);
  });

  it("denies trusted subagent write to confidential (write=deny)", async () => {
    const out = { args: { filePath: "docs/confidential/x.md", content: "hi" } };
    await assert.rejects(
      hooks["tool.execute.before"]({ tool: "write", sessionID: "childTrusted", callID: "c2" }, out),
      /confidential:deny/,
    );
  });

  it("denies untrusted subagent read of confidential", async () => {
    const out = { args: { filePath: "docs/confidential/secrets.md" } };
    await assert.rejects(
      hooks["tool.execute.before"]({ tool: "read", sessionID: "childUntrusted", callID: "c3" }, out),
      /confidential:deny/,
    );
  });

  it("denies primary/root read of confidential", async () => {
    const out = { args: { filePath: "docs/confidential/secrets.md" } };
    await assert.rejects(
      hooks["tool.execute.before"]({ tool: "read", sessionID: "root", callID: "c4" }, out),
      /confidential:deny/,
    );
  });

  it("trusted allow does not persist state — root remains denied after trusted read (per-call)", async () => {
    const trusted = { args: { filePath: "docs/confidential/secrets.md" } };
    const root = { args: { filePath: "docs/confidential/secrets.md" } };
    await hooks["tool.execute.before"]({ tool: "read", sessionID: "childTrusted", callID: "c-trust" }, trusted);
    await assert.rejects(
      hooks["tool.execute.before"]({ tool: "read", sessionID: "root", callID: "c-root" }, root),
      /confidential:deny/,
    );
  });

  it("denies root session when no client provided (fail-closed)", async () => {
    const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), "fab-conf2-"));
    fs.writeFileSync(path.join(dir2, "maestro.json"), JSON.stringify({
      confidential: { paths: ["docs/confidential/**"] },
    }));
    const h2 = await MaestroBootstrapPlugin({ directory: dir2 });
    try {
      const out = { args: { filePath: "docs/confidential/secrets.md" } };
      await assert.rejects(
        h2["tool.execute.before"]({ tool: "read", sessionID: "root", callID: "c5" }, out),
        /confidential:deny/,
      );
    } finally {
      fs.rmSync(dir2, { recursive: true, force: true });
    }
  });

  it("does not apply confidential to non-confidential paths (passes to access_policy)", async () => {
    const out = { args: { filePath: "src/app.ts" } };
    await hooks["tool.execute.before"]({ tool: "read", sessionID: "root", callID: "c6" }, out);
    assert.ok(true);
  });

  it("ignores access_policy.allow on confidential path (confidential wins)", async () => {
    const dir3 = fs.mkdtempSync(path.join(os.tmpdir(), "fab-conf3-"));
    fs.writeFileSync(path.join(dir3, "maestro.json"), JSON.stringify({
      access_policy: { default: "allow", allow: ["docs/confidential/**"] },
      confidential: { paths: ["docs/confidential/**"] },
    }));
    const h3 = await MaestroBootstrapPlugin({ directory: dir3 });
    try {
      const out = { args: { filePath: "docs/confidential/secrets.md" } };
      await assert.rejects(
        h3["tool.execute.before"]({ tool: "read", sessionID: "root", callID: "c7" }, out),
        /confidential:deny/,
      );
    } finally {
      fs.rmSync(dir3, { recursive: true, force: true });
    }
  });
});

describe("maestro-bootstrap built-in confidential (OQ-3, Task 2b)", () => {
  // Built-in набор применяется независимо от секции `confidential` в maestro.json
  // (в т.ч. при её отсутствии): .env, .env.*, *.pem, *.key, *.crt, *.p12, *.pfx.
  let dir, hooks, savedLogEnv;
  const LOG_ENV = ["MAESTRO_BOOTSTRAP_LOG_MASK", "MAESTRO_BOOTSTRAP_LOG_LEVEL", "MAESTRO_BOOTSTRAP_LOG_DIR"];

  function makeClient(sessions) {
    return {
      session: {
        get: async ({ path }) => {
          const rec = sessions[path.id];
          if (!rec) throw new Error("not found");
          return { data: rec.session };
        },
        messages: async ({ path }) => {
          const rec = sessions[path.id];
          if (!rec) return { data: [] };
          return { data: rec.messages };
        },
      },
    };
  }

  const rootSessions = {
    root: { session: { id: "root" }, messages: [] },
    childTrusted: {
      session: { id: "childTrusted", parentID: "root" },
      messages: [{ info: { role: "assistant", mode: "custodian" }, parts: [] }],
    },
    childUntrusted: {
      session: { id: "childUntrusted", parentID: "root" },
      messages: [{ info: { role: "assistant", mode: "haiku" }, parts: [] }],
    },
  };

  before(async () => {
    savedLogEnv = {};
    for (const k of LOG_ENV) { savedLogEnv[k] = process.env[k]; delete process.env[k]; }
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "fab-builtin-"));
    // НЕТ секции `confidential` — built-in всё равно должен срабатывать.
    fs.writeFileSync(path.join(dir, "maestro.json"), JSON.stringify({
      trust: { custodian: true },
    }));
    hooks = await MaestroBootstrapPlugin({ directory: dir, client: makeClient(rootSessions) });
  });

  after(() => {
    fs.rmSync(dir, { recursive: true, force: true });
    for (const k of LOG_ENV) {
      if (savedLogEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedLogEnv[k];
    }
  });

  it("denies primary/root read of .env (built-in, no confidential section)", async () => {
    const out = { args: { filePath: ".env" } };
    await assert.rejects(
      hooks["tool.execute.before"]({ tool: "read", sessionID: "root", callID: "bi-root-env" }, out),
      /confidential:deny/,
    );
  });

  it("denies primary/root read of .env.* (built-in)", async () => {
    const out = { args: { filePath: ".env.production" } };
    await assert.rejects(
      hooks["tool.execute.before"]({ tool: "read", sessionID: "root", callID: "bi-root-envx" }, out),
      /confidential:deny/,
    );
  });

  it("denies primary/root read of private key (built-in)", async () => {
    for (const f of ["deploy.pem", "jwt.key", "cert.crt", "client.p12", "ca.pfx"]) {
      const out = { args: { filePath: f } };
      await assert.rejects(
        hooks["tool.execute.before"]({ tool: "read", sessionID: "root", callID: `bi-root-${f}` }, out),
        /confidential:deny/,
        `expected deny for ${f}`,
      );
    }
  });

  it("denies untrusted subagent read of .env (built-in)", async () => {
    const out = { args: { filePath: ".env" } };
    await assert.rejects(
      hooks["tool.execute.before"]({ tool: "read", sessionID: "childUntrusted", callID: "bi-u-env" }, out),
      /confidential:deny/,
    );
  });

  it("denies write/edit to .env for primary (built-in)", async () => {
    await assert.rejects(
      hooks["tool.execute.before"](
        { tool: "write", sessionID: "root", callID: "bi-w-env" },
        { args: { filePath: ".env", content: "SECRET=x" } },
      ),
      /confidential:deny/,
    );
    await assert.rejects(
      hooks["tool.execute.before"](
        { tool: "edit", sessionID: "root", callID: "bi-e-env" },
        { args: { filePath: ".env", oldString: "a", newString: "b" } },
      ),
      /confidential:deny/,
    );
  });

  it("built-in does not block nested file under a dot-prefixed dir (root-only mask)", async () => {
    // Маска `.env` без `/` матчит только корневые файлы; `dir/.env` — не блокируется.
    const out = { args: { filePath: "config/env/.env" } };
    await hooks["tool.execute.before"]({ tool: "read", sessionID: "root", callID: "bi-nested" }, out);
    assert.ok(true);
  });

  it("built-in .env.* does not block a regular env.ts source file", async () => {
    const out = { args: { filePath: "src/env.ts" } };
    await hooks["tool.execute.before"]({ tool: "read", sessionID: "root", callID: "bi-envts" }, out);
    assert.ok(true);
  });

  it("confidential.paths EXTENDS built-in, not replaces (config present)", async () => {
    const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), "fab-builtin2-"));
    fs.writeFileSync(path.join(dir2, "maestro.json"), JSON.stringify({
      confidential: { paths: ["secrets/internals/**"] },
    }));
    const h2 = await MaestroBootstrapPlugin({ directory: dir2 });
    try {
      // Пользовательский confidential-путь блокируется.
      await assert.rejects(
        h2["tool.execute.before"](
          { tool: "read", sessionID: "root", callID: "bi-cfg-path" },
          { args: { filePath: "secrets/internals/token.txt" } },
        ),
        /confidential:deny/,
      );
      // Built-in (.env) по-прежнему блокируется — расширяет, а не заменяет.
      await assert.rejects(
        h2["tool.execute.before"](
          { tool: "read", sessionID: "root", callID: "bi-cfg-env" },
          { args: { filePath: ".env" } },
        ),
        /confidential:deny/,
      );
    } finally {
      fs.rmSync(dir2, { recursive: true, force: true });
    }
  });
});

describe("maestro-bootstrap confidential path normalization", () => {
  const root = "/proj";

  it("normalizes absolute path to project-relative", () => {
    assert.equal(normalizeTarget(root, "/proj/docs/confidential/x.md"), "docs/confidential/x.md");
  });

  it("normalizes relative and dot-prefixed to project-relative", () => {
    assert.equal(normalizeTarget(root, "docs/confidential/x.md"), "docs/confidential/x.md");
    assert.equal(normalizeTarget(root, "./docs/confidential/x.md"), "docs/confidential/x.md");
  });

  it("collapses .. traversal to project-relative (escapes confidential prefix)", () => {
    assert.equal(normalizeTarget(root, "docs/confidential/../../etc/passwd"), "etc/passwd");
  });

  it("returns empty string for empty target", () => {
    assert.equal(normalizeTarget(root, ""), "");
    assert.equal(normalizeTarget(root, undefined), "");
  });
});

describe("maestro-bootstrap isConfidentialTarget", () => {
  const root = "/proj";
  const patterns = ["docs/confidential/**"];

  it("blocks file under pattern (relative)", () => {
    assert.equal(isConfidentialTarget(root, patterns, "docs/confidential/x.md"), true);
  });
  it("blocks file under pattern (absolute)", () => {
    assert.equal(isConfidentialTarget(root, patterns, "/proj/docs/confidential/x.md"), true);
  });
  it("blocks file under pattern (dot-prefixed)", () => {
    assert.equal(isConfidentialTarget(root, patterns, "./docs/confidential/x.md"), true);
  });
  it("blocks case-variant path (case-insensitive boundary)", () => {
    assert.equal(isConfidentialTarget(root, patterns, "docs/Confidential/X.MD"), true);
  });
  it("blocks the directory itself (C2)", () => {
    assert.equal(isConfidentialTarget(root, patterns, "docs/confidential"), true);
    assert.equal(isConfidentialTarget(root, patterns, "/proj/docs/confidential"), true);
  });
  it("blocks subdirectory listing under pattern", () => {
    assert.equal(isConfidentialTarget(root, patterns, "docs/confidential/subdir"), true);
  });
  it("does not block non-confidential paths", () => {
    assert.equal(isConfidentialTarget(root, patterns, "src/app.ts"), false);
    assert.equal(isConfidentialTarget(root, patterns, "docs/readme.md"), false);
    assert.equal(isConfidentialTarget(root, patterns, "docs/confidentialx.md"), false);
  });
  it("does not block .. traversal that escapes the pattern prefix", () => {
    assert.equal(isConfidentialTarget(root, patterns, "docs/confidential/../../src/app.ts"), false);
  });
});

describe("maestro-bootstrap confidential path bypass closure", () => {
  let dir, hooks, savedLogEnv;
  const LOG_ENV = ["MAESTRO_BOOTSTRAP_LOG_MASK", "MAESTRO_BOOTSTRAP_LOG_LEVEL", "MAESTRO_BOOTSTRAP_LOG_DIR"];

  function makeClient() {
    return {
      session: {
        get: async ({ path }) => {
          if (path.id === "root") return { data: { id: "root" } };
          if (path.id === "childUntrusted") return { data: { id: "childUntrusted", parentID: "root" } };
          throw new Error("not found");
        },
        messages: async ({ path }) => {
          if (path.id === "childUntrusted") {
            return { data: [{ info: { role: "assistant", mode: "haiku" }, parts: [] }] };
          }
          return { data: [] };
        },
      },
    };
  }

  before(async () => {
    savedLogEnv = {};
    for (const k of LOG_ENV) { savedLogEnv[k] = process.env[k]; delete process.env[k]; }
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "fab-cfix-"));
    fs.writeFileSync(path.join(dir, "maestro.json"), JSON.stringify({
      confidential: { paths: ["docs/confidential/**"] },
    }));
    hooks = await MaestroBootstrapPlugin({ directory: dir, client: makeClient() });
  });

  after(() => {
    fs.rmSync(dir, { recursive: true, force: true });
    for (const k of LOG_ENV) {
      if (savedLogEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedLogEnv[k];
    }
  });

  it("denies absolute-path read of confidential (C1)", async () => {
    const abs = path.join(dir, "docs/confidential/secrets.md");
    const out = { args: { filePath: abs } };
    await assert.rejects(
      hooks["tool.execute.before"]({ tool: "read", sessionID: "root", callID: "c1" }, out),
      /confidential:deny/,
    );
  });

  it("denies dot-prefixed read of confidential (C1)", async () => {
    const out = { args: { filePath: "./docs/confidential/secrets.md" } };
    await assert.rejects(
      hooks["tool.execute.before"]({ tool: "read", sessionID: "root", callID: "c2" }, out),
      /confidential:deny/,
    );
  });

  it("denies case-variant read of confidential (C1)", async () => {
    const out = { args: { filePath: "docs/Confidential/secrets.md" } };
    await assert.rejects(
      hooks["tool.execute.before"]({ tool: "read", sessionID: "root", callID: "c3" }, out),
      /confidential:deny/,
    );
  });

  it("denies directory listing of confidential (C2)", async () => {
    const out = { args: { filePath: "docs/confidential" } };
    await assert.rejects(
      hooks["tool.execute.before"]({ tool: "read", sessionID: "root", callID: "c4" }, out),
      /confidential:deny/,
    );
  });

  it("does not break non-confidential paths", async () => {
    const out = { args: { filePath: "src/app.ts" } };
    await hooks["tool.execute.before"]({ tool: "read", sessionID: "root", callID: "c5" }, out);
    assert.ok(true);
  });
});

describe("maestro-bootstrap plugin version", () => {
  it("readPluginVersion returns the version from the repo root package.json", () => {
    const rootPkgPath = path.resolve(
      path.dirname(new URL(import.meta.url).pathname),
      "../../package.json"
    );
    const expected = JSON.parse(fs.readFileSync(rootPkgPath, "utf8")).version;
    const version = readPluginVersion();
    assert.equal(typeof version, "string");
    assert.match(version, /^\d+\.\d+\.\d+$/);
    assert.equal(version, expected, "version must come from the single root package.json");
  });

  it("writePluginVersionFile writes version to .maestro/plugin-version", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fab-ver-"));
    try {
      writePluginVersionFile(dir, "1.2.3");
      const file = path.join(dir, ".maestro/plugin-version");
      assert.ok(fs.existsSync(file), "plugin-version file must be created");
      assert.equal(fs.readFileSync(file, "utf8").trim(), "1.2.3");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("writePluginVersionFile does not throw when write fails (fail-soft)", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fab-ver-fail-"));
    try {
      // `.maestro` занят файлом → mkdirSync бросает ENOTDIR/EEXIST → write должен молча не упасть
      fs.writeFileSync(path.join(dir, ".maestro"), "occupied");
      assert.doesNotThrow(() => writePluginVersionFile(dir, "1.2.3"));
      assert.equal(fs.existsSync(path.join(dir, ".maestro/plugin-version")), false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("plugin initialized log entry includes the version field", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fab-ver-log-"));
    try {
      await MaestroBootstrapPlugin({ directory: dir });
      const entries = readLogs(dir);
      const init = entries.find((e) => e.msg === "plugin initialized");
      assert.ok(init, "plugin initialized entry must exist");
      assert.match(init.version, /^\d+\.\d+\.\d+$/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("isPluginMetaFile covers plugin-version only", () => {
    const dir = process.cwd();
    assert.equal(isPluginMetaFile(dir, ".maestro/plugin-version"), true);
    assert.equal(isPluginMetaFile(dir, ".maestro/expected-version"), false);
    assert.equal(isPluginMetaFile(dir, ".maestro/logs/x.log"), false);
  });

  it("read of maestro.json IS still blocked by restrictive access_policy (ИБ)", async () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), "fab-json-acc-"));
    fs.writeFileSync(path.join(d, "maestro.json"), JSON.stringify({
      access_policy: { version: 1, default: "deny", allow: [], ask: [], deny: ["**"] },
    }));
    const hooks = await MaestroBootstrapPlugin({ directory: d });
    const out = { args: { filePath: "maestro.json" } };
    await assert.rejects(
      hooks["tool.execute.before"]({ tool: "read", sessionID: "root", callID: "c2" }, out),
      /access-policy/,
    );
    fs.rmSync(d, { recursive: true, force: true });
  });
});

describe("maestro-bootstrap plugin version file access", () => {
  let dir, hooks, savedLogEnv;
  const LOG_ENV = ["MAESTRO_BOOTSTRAP_LOG_MASK", "MAESTRO_BOOTSTRAP_LOG_LEVEL", "MAESTRO_BOOTSTRAP_LOG_DIR"];

  before(async () => {
    savedLogEnv = {};
    for (const k of LOG_ENV) { savedLogEnv[k] = process.env[k]; delete process.env[k]; }
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "fab-ver-access-"));
    // Строгий access_policy: всё — ask (default), ничего не allow.
    fs.writeFileSync(path.join(dir, "maestro.json"), JSON.stringify({
      access_policy: { default: "ask", allow: [], ask: [], deny: [] },
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

  it("isPluginMetaFile identifies .maestro/plugin-version", () => {
    assert.equal(isPluginMetaFile(dir, ".maestro/plugin-version"), true);
    assert.equal(isPluginMetaFile(dir, "src/app.ts"), false);
    assert.equal(isPluginMetaFile(dir, ".maestro/logs/x.log"), false);
  });

  it("read of .maestro/plugin-version is NOT blocked by restrictive access_policy", async () => {
    const out = { args: { filePath: ".maestro/plugin-version" } };
    // не должно выбросить [access-policy:ask]
    await hooks["tool.execute.before"]({ tool: "read", sessionID: "root", callID: "c-ver" }, out);
    assert.ok(true, "plugin version read must not be blocked");
  });

  it("read of a normal file still blocked by restrictive access_policy", async () => {
    const out = { args: { filePath: "docs/readme.md" } };
    await assert.rejects(
      hooks["tool.execute.before"]({ tool: "read", sessionID: "root", callID: "c-blocked" }, out),
      /access-policy:ask/,
    );
  });
});

describe("maestro-bootstrap audit logger", () => {
  it("writes to a separate file when filePrefix set", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fab-audit-logger-"));
    try {
      const log = makeLogger(dir, { filePrefix: "maestro-audit", filterEnv: null });
      log.info("confidential.access", { action: "allow" });
      const auditFiles = fs.readdirSync(path.join(dir, ".maestro/logs")).filter((f) => f.includes("maestro-audit"));
      assert.equal(auditFiles.length, 1, "audit file created");
      const entries = readLogs(dir, "maestro-audit");
      const e = entries.find((x) => x.msg === "confidential.access");
      assert.ok(e, "audit entry exists");
      assert.equal(e.action, "allow");
      const bootstrap = readLogs(dir, "maestro-bootstrap");
      assert.equal(bootstrap.find((x) => x.msg === "confidential.access"), undefined);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("audit logger is NOT suppressed by MAESTRO_BOOTSTRAP_LOG_MASK/LOG_LEVEL (security invariant)", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fab-audit-filter-"));
    const savedMask = process.env.MAESTRO_BOOTSTRAP_LOG_MASK;
    const savedLevel = process.env.MAESTRO_BOOTSTRAP_LOG_LEVEL;
    try {
      process.env.MAESTRO_BOOTSTRAP_LOG_MASK = "off";
      process.env.MAESTRO_BOOTSTRAP_LOG_LEVEL = "error";
      const log = makeLogger(dir, { filePrefix: "maestro-audit", filterEnv: null });
      log.warn("confidential.access", { action: "deny" });
      const e = readLogs(dir, "maestro-audit").find((x) => x.msg === "confidential.access");
      assert.ok(e, "audit entry must be written even when bootstrap mask is off");
    } finally {
      if (savedMask === undefined) delete process.env.MAESTRO_BOOTSTRAP_LOG_MASK;
      else process.env.MAESTRO_BOOTSTRAP_LOG_MASK = savedMask;
      if (savedLevel === undefined) delete process.env.MAESTRO_BOOTSTRAP_LOG_LEVEL;
      else process.env.MAESTRO_BOOTSTRAP_LOG_LEVEL = savedLevel;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("maestro-bootstrap confidential audit log", () => {
  let dir, hooks, savedLogEnv;
  const LOG_ENV = ["MAESTRO_BOOTSTRAP_LOG_MASK", "MAESTRO_BOOTSTRAP_LOG_LEVEL", "MAESTRO_BOOTSTRAP_LOG_DIR", "MAESTRO_AUDIT_LOG_DIR"];

  function makeClient(sessions) {
    return {
      session: {
        get: async ({ path }) => {
          const rec = sessions[path.id];
          if (!rec) throw new Error("not found");
          return { data: rec.session };
        },
        messages: async ({ path }) => {
          const rec = sessions[path.id];
          if (!rec) return { data: [] };
          return { data: rec.messages };
        },
      },
    };
  }

  const rootSessions = {
    childTrusted: {
      session: { id: "childTrusted", parentID: "root" },
      messages: [{ info: { role: "assistant", mode: "custodian" }, parts: [] }],
    },
    childUntrusted: {
      session: { id: "childUntrusted", parentID: "root" },
      messages: [{ info: { role: "assistant", mode: "haiku" }, parts: [] }],
    },
  };

  before(async () => {
    savedLogEnv = {};
    for (const k of LOG_ENV) { savedLogEnv[k] = process.env[k]; delete process.env[k]; }
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "fab-audit-enf-"));
    fs.writeFileSync(path.join(dir, "maestro.json"), JSON.stringify({
      trust: { custodian: true },
      confidential: { paths: ["docs/confidential/**"], trusted: { read: "allow", write: "deny", edit: "deny" } },
    }));
    hooks = await MaestroBootstrapPlugin({ directory: dir, client: makeClient(rootSessions) });
  });

  after(() => {
    fs.rmSync(dir, { recursive: true, force: true });
    for (const k of LOG_ENV) {
      if (savedLogEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedLogEnv[k];
    }
  });

  it("logs allow with agent when trusted subagent reads confidential", async () => {
    const out = { args: { filePath: "docs/confidential/secrets.md" } };
    await hooks["tool.execute.before"]({ tool: "read", sessionID: "childTrusted", callID: "c-a1" }, out);
    const e = readLogs(dir, "maestro-audit").find((x) => x.callID === "c-a1");
    assert.ok(e, "audit entry exists");
    assert.equal(e.msg, "confidential.access");
    assert.equal(e.action, "allow");
    assert.equal(e.agent, "custodian");
    assert.equal(e.tool, "read");
    assert.equal(e.target, "secrets.md");
  });

  it("logs deny with agent for untrusted subagent read of confidential", async () => {
    const out = { args: { filePath: "docs/confidential/secrets.md" } };
    await assert.rejects(
      hooks["tool.execute.before"]({ tool: "read", sessionID: "childUntrusted", callID: "c-a2" }, out),
      /confidential:deny/,
    );
    const e = readLogs(dir, "maestro-audit").find((x) => x.callID === "c-a2");
    assert.ok(e, "audit deny entry exists");
    assert.equal(e.action, "deny");
    assert.equal(e.agent, "haiku");
  });

  it("does not duplicate security events in bootstrap log", async () => {
    const out = { args: { filePath: "docs/confidential/secrets.md" } };
    await hooks["tool.execute.before"]({ tool: "read", sessionID: "childTrusted", callID: "c-a4" }, out);
    const bootstrap = readLogs(dir, "maestro-bootstrap");
    assert.equal(
      bootstrap.find((x) => x.msg === "confidential.access" || x.msg === "confidential.blocked" || x.msg === "access_policy.blocked"),
      undefined,
      "security events must NOT appear in bootstrap log",
    );
  });

  it("logs access_policy.blocked only in audit log", async () => {
    const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), "fab-audit-ap-"));
    try {
      fs.writeFileSync(path.join(dir2, "maestro.json"), JSON.stringify({
        access_policy: { default: "ask", allow: [], ask: ["docs/**"], deny: [] },
      }));
      const h2 = await MaestroBootstrapPlugin({ directory: dir2 });
      const out = { args: { filePath: "docs/architecture.md" } };
      await assert.rejects(
        h2["tool.execute.before"]({ tool: "read", sessionID: "root", callID: "c-ap1" }, out),
        /access-policy:ask/,
      );
      const audit = readLogs(dir2, "maestro-audit").find((x) => x.callID === "c-ap1");
      assert.ok(audit, "access_policy.blocked in audit log");
      assert.equal(audit.msg, "access_policy.blocked");
      assert.equal(audit.target, "architecture.md");
      const bootstrap = readLogs(dir2, "maestro-bootstrap");
      assert.equal(bootstrap.find((x) => x.msg === "access_policy.blocked"), undefined, "not duplicated in bootstrap");
    } finally {
      fs.rmSync(dir2, { recursive: true, force: true });
    }
  });

  it("does not log non-confidential paths to audit log", async () => {
    const before = readLogs(dir, "maestro-audit").length;
    const out = { args: { filePath: "src/app.ts" } };
    await hooks["tool.execute.before"]({ tool: "read", sessionID: "childTrusted", callID: "c-a3" }, out);
    assert.equal(readLogs(dir, "maestro-audit").length, before, "no audit entry for non-confidential read");
  });
});

describe("maestro-bootstrap un-trusted custodian/sanitizer: confidential deny", () => {
  // Агент с именем custodian, но не в trust-сете → deny (не trusted по имени,
  // а по maestro.json). Trust = runtime-решение плагина, не свойство агента.
  let dir, hooks, savedLogEnv;
  const LOG_ENV = ["MAESTRO_BOOTSTRAP_LOG_MASK", "MAESTRO_BOOTSTRAP_LOG_LEVEL", "MAESTRO_BOOTSTRAP_LOG_DIR"];

  function makeClient(sessions) {
    return {
      session: {
        get: async ({ path }) => {
          const rec = sessions[path.id];
          if (!rec) throw new Error("not found");
          return { data: rec.session };
        },
        messages: async ({ path }) => {
          const rec = sessions[path.id];
          if (!rec) return { data: [] };
          return { data: rec.messages };
        },
      },
    };
  }

  const rootSessions = {
    childUntrusted: {
      session: { id: "childUntrusted", parentID: "root" },
      messages: [{ info: { role: "assistant", mode: "custodian" }, parts: [] }],
    },
  };

  before(async () => {
    savedLogEnv = {};
    for (const k of LOG_ENV) { savedLogEnv[k] = process.env[k]; delete process.env[k]; }
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "fab-untrust-"));
    // custodian: false — агент с именем custodian, но не trusted.
    fs.writeFileSync(path.join(dir, "maestro.json"), JSON.stringify({
      trust: { custodian: false },
      confidential: { paths: ["docs/confidential/**"], trusted: { read: "allow", write: "deny", edit: "deny" } },
    }));
    hooks = await MaestroBootstrapPlugin({ directory: dir, client: makeClient(rootSessions) });
  });

  after(() => {
    fs.rmSync(dir, { recursive: true, force: true });
    for (const k of LOG_ENV) {
      if (savedLogEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedLogEnv[k];
    }
  });

  it("un-trusted custodian: confidential read deny (trust: false)", async () => {
    const out = { args: { filePath: "docs/confidential/secrets.md" } };
    await assert.rejects(
      hooks["tool.execute.before"]({ tool: "read", sessionID: "childUntrusted", callID: "ut-conf" }, out),
      /confidential:deny/,
    );
  });

  it("un-trusted custodian: .env deny (built-in, trust: false)", async () => {
    const out = { args: { filePath: ".env" } };
    await assert.rejects(
      hooks["tool.execute.before"]({ tool: "read", sessionID: "childUntrusted", callID: "ut-env" }, out),
      /confidential:deny/,
    );
  });
});

describe("maestro-bootstrap un-trusted custodian/sanitizer: prompt sanitize", () => {
  // task-санитайзинг проверяет trustedAgents.has(subagent_type) без session
  // resolution — client mock не нужен (по паттерну "trusted skip", L560).
  let dir, hooks, savedLogEnv;
  const LOG_ENV = ["MAESTRO_BOOTSTRAP_LOG_MASK", "MAESTRO_BOOTSTRAP_LOG_LEVEL", "MAESTRO_BOOTSTRAP_LOG_DIR", "MAESTRO_CONFIG"];

  async function makeHooks(trust) {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), "fab-untrust-pr-"));
    fs.writeFileSync(path.join(d, "maestro.json"), JSON.stringify({ trust }));
    const h = await MaestroBootstrapPlugin({ directory: d });
    return { d, h };
  }

  before(() => {
    savedLogEnv = {};
    for (const k of LOG_ENV) { savedLogEnv[k] = process.env[k]; delete process.env[k]; }
  });

  after(() => {
    for (const k of LOG_ENV) {
      if (savedLogEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedLogEnv[k];
    }
  });

  it("un-trusted custodian: dispatch prompt sanitized (trust empty)", async () => {
    const { d, h } = await makeHooks({});
    try {
      const output = { args: { subagent_type: "custodian", prompt: "Check POSTGRES_PASSWORD=s3cr3t" } };
      await h["tool.execute.before"]({ tool: "task", sessionID: "s", callID: "ut-pr-cust" }, output);
      assert.doesNotMatch(output.args.prompt, /s3cr3t/, "un-trusted custodian prompt sanitized");
    } finally {
      fs.rmSync(d, { recursive: true, force: true });
    }
  });

  it("un-trusted sanitizer: dispatch prompt sanitized — recursion (custodian trusted, sanitizer not)", async () => {
    const { d, h } = await makeHooks({ custodian: true });
    try {
      const output = { args: { subagent_type: "sanitizer", prompt: "Check POSTGRES_PASSWORD=s3cr3t" } };
      await h["tool.execute.before"]({ tool: "task", sessionID: "s", callID: "ut-pr-san" }, output);
      assert.doesNotMatch(output.args.prompt, /s3cr3t/, "un-trusted sanitizer prompt sanitized (recursion)");
    } finally {
      fs.rmSync(d, { recursive: true, force: true });
    }
  });

  it("trusted custodian: dispatch prompt NOT sanitized (control)", async () => {
    const { d, h } = await makeHooks({ custodian: true });
    try {
      const output = { args: { subagent_type: "custodian", prompt: "Check POSTGRES_PASSWORD=s3cr3t" } };
      await h["tool.execute.before"]({ tool: "task", sessionID: "s", callID: "ut-pr-ctrl" }, output);
      assert.match(output.args.prompt, /s3cr3t/, "trusted custodian prompt not sanitized");
    } finally {
      fs.rmSync(d, { recursive: true, force: true });
    }
  });
});

describe("maestro-bootstrap confGlobMatch (segment-aware, confidential-only)", () => {
  it("full filename matches only root-level", () => {
    assert.equal(confGlobMatch("maestro.json", "maestro.json"), true);
    assert.equal(confGlobMatch("maestro.json", "src/maestro.json"), false);
    assert.equal(confGlobMatch("maestro.json", "maestro.jsonx"), false);
  });
  it("dotfile full name matches", () => {
    assert.equal(confGlobMatch(".maestro.json", ".maestro.json"), true);
  });
  it("bare mask matches only root (does not cross /)", () => {
    assert.equal(confGlobMatch("*.env", "prod.env"), true);
    assert.equal(confGlobMatch("*.env", "config/prod.env"), false);
  });
  it("recursive ** covers root and nested", () => {
    assert.equal(confGlobMatch("**/*.pem", "app.pem"), true);
    assert.equal(confGlobMatch("**/*.pem", "certs/app.pem"), true);
    assert.equal(confGlobMatch("**/*.pem", "certs/nested/app.pem"), true);
    assert.equal(confGlobMatch("**/*.pem", "app.pemx"), false);
  });
  it("nested mask with slash matches within that segment", () => {
    assert.equal(confGlobMatch("configs/*.env", "configs/prod.env"), true);
    assert.equal(confGlobMatch("configs/*.env", "prod.env"), false);
    assert.equal(confGlobMatch("configs/*.env", "configs/deep/prod.env"), false);
  });
  it("brace alternation within a segment", () => {
    assert.equal(confGlobMatch("*.{env,local}", "prod.env"), true);
    assert.equal(confGlobMatch("*.{env,local}", "prod.local"), true);
    assert.equal(confGlobMatch("*.{env,local}", "prod.yml"), false);
  });
  it("trailing /** matches directory, subdir and file inside", () => {
    assert.equal(confGlobMatch("docs/confidential/**", "docs/confidential"), true);
    assert.equal(confGlobMatch("docs/confidential/**", "docs/confidential/x.md"), true);
    assert.equal(confGlobMatch("docs/confidential/**", "docs/confidential/subdir"), true);
  });
  it("single ? matches one char within a segment", () => {
    assert.equal(confGlobMatch("?.env", "a.env"), true);
    assert.equal(confGlobMatch("?.env", "ab.env"), false);
  });
  it("returns false for empty pattern or value (defensive guard)", () => {
    assert.equal(confGlobMatch("", "prod.env"), false);
    assert.equal(confGlobMatch("*.env", ""), false);
  });
});

describe("maestro-bootstrap isConfidentialTarget (single-file & mask)", () => {
  const root = "/proj";

  it("full filename at root is confidential", () => {
    assert.equal(isConfidentialTarget(root, ["maestro.json"], "maestro.json"), true);
    assert.equal(isConfidentialTarget(root, ["maestro.json"], "maestro.jsonx"), false);
    assert.equal(isConfidentialTarget(root, ["maestro.json"], "src/maestro.json"), false);
  });
  it("dotfile full name at root is confidential", () => {
    assert.equal(isConfidentialTarget(root, [".maestro.json"], ".maestro.json"), true);
  });
  it("bare mask blocks root but not nested", () => {
    assert.equal(isConfidentialTarget(root, ["*.env"], "prod.env"), true);
    assert.equal(isConfidentialTarget(root, ["*.env"], "config/prod.env"), false);
  });
  it("recursive mask covers root and nested", () => {
    assert.equal(isConfidentialTarget(root, ["**/*.pem"], "app.pem"), true);
    assert.equal(isConfidentialTarget(root, ["**/*.pem"], "certs/app.pem"), true);
    assert.equal(isConfidentialTarget(root, ["**/*.env"], "prod.env"), true);
  });
  it("nested mask with slash blocks within that segment", () => {
    assert.equal(isConfidentialTarget(root, ["configs/*.env"], "configs/prod.env"), true);
    assert.equal(isConfidentialTarget(root, ["configs/*.env"], "prod.env"), false);
  });
  it("case-variant of full filename still blocked (case-insensitive)", () => {
    assert.equal(isConfidentialTarget(root, ["Maestro.json"], "maestro.JSON"), true);
  });
  it("docs/confidential/** still blocks file, dir and subdir (regression)", () => {
    const p = ["docs/confidential/**"];
    assert.equal(isConfidentialTarget(root, p, "docs/confidential/x.md"), true);
    assert.equal(isConfidentialTarget(root, p, "docs/confidential"), true);
    assert.equal(isConfidentialTarget(root, p, "docs/confidential/subdir"), true);
  });
  it("does not block non-confidential paths", () => {
    assert.equal(isConfidentialTarget(root, ["*.env", "**/*.pem"], "src/app.ts"), false);
    assert.equal(isConfidentialTarget(root, ["*.env", "**/*.pem"], "docs/readme.md"), false);
  });
  it("single ? wildcard at root via isConfidentialTarget", () => {
    assert.equal(isConfidentialTarget(root, ["?.env"], "a.env"), true);
    assert.equal(isConfidentialTarget(root, ["?.env"], "ab.env"), false);
    assert.equal(isConfidentialTarget(root, ["?.env"], "sub/a.env"), false);
  });
  it("brace alternation at root via isConfidentialTarget", () => {
    assert.equal(isConfidentialTarget(root, ["*.{env,local}"], "prod.env"), true);
    assert.equal(isConfidentialTarget(root, ["*.{env,local}"], "prod.local"), true);
    assert.equal(isConfidentialTarget(root, ["*.{env,local}"], "prod.yml"), false);
  });
  it("matcher would catch .maestro/plugin-version under .maestro/** (exemption is separate)", () => {
    assert.equal(isConfidentialTarget(root, [".maestro/**"], ".maestro/plugin-version"), true);
  });
});

describe("maestro-bootstrap confidential enforcement by mask/filename", () => {
  let dir, hooks, savedLogEnv;
  const LOG_ENV = ["MAESTRO_BOOTSTRAP_LOG_MASK", "MAESTRO_BOOTSTRAP_LOG_LEVEL", "MAESTRO_BOOTSTRAP_LOG_DIR"];

  function makeClient(sessions) {
    return {
      session: {
        get: async ({ path }) => {
          const rec = sessions[path.id];
          if (!rec) throw new Error("not found");
          return { data: rec.session };
        },
        messages: async ({ path }) => {
          const rec = sessions[path.id];
          if (!rec) return { data: [] };
          return { data: rec.messages };
        },
      },
    };
  }

  const rootSessions = {
    root: { session: { id: "root" }, messages: [] },
  };

  before(async () => {
    savedLogEnv = {};
    for (const k of LOG_ENV) { savedLogEnv[k] = process.env[k]; delete process.env[k]; }
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "fab-fmask-"));
    fs.writeFileSync(path.join(dir, "maestro.json"), JSON.stringify({
      confidential: { paths: ["*.env", "**/*.pem", "maestro.json", ".maestro/**"] },
    }));
    hooks = await MaestroBootstrapPlugin({ directory: dir, client: makeClient(rootSessions) });
  });

  after(() => {
    fs.rmSync(dir, { recursive: true, force: true });
    for (const k of LOG_ENV) {
      if (savedLogEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedLogEnv[k];
    }
  });

  it("denies read of root-level mask file", async () => {
    const out = { args: { filePath: "prod.env" } };
    await assert.rejects(
      hooks["tool.execute.before"]({ tool: "read", sessionID: "root", callID: "m1" }, out),
      /confidential:deny/,
    );
  });
  it("does not deny read of nested file not matching root mask", async () => {
    const out = { args: { filePath: "config/prod.env" } };
    await hooks["tool.execute.before"]({ tool: "read", sessionID: "root", callID: "m2" }, out);
    assert.ok(true);
  });
  it("denies read of recursive-mask file at root", async () => {
    const out = { args: { filePath: "app.pem" } };
    await assert.rejects(
      hooks["tool.execute.before"]({ tool: "read", sessionID: "root", callID: "m3" }, out),
      /confidential:deny/,
    );
  });
  it("denies read of recursive-mask file nested", async () => {
    const out = { args: { filePath: "certs/app.pem" } };
    await assert.rejects(
      hooks["tool.execute.before"]({ tool: "read", sessionID: "root", callID: "m4" }, out),
      /confidential:deny/,
    );
  });
  it("denies read of full filename at root", async () => {
    const out = { args: { filePath: "maestro.json" } };
    await assert.rejects(
      hooks["tool.execute.before"]({ tool: "read", sessionID: "root", callID: "m5" }, out),
      /confidential:deny/,
    );
  });
  it("does not block .maestro/plugin-version even under .maestro/** confidential", async () => {
    const out = { args: { filePath: ".maestro/plugin-version" } };
    await hooks["tool.execute.before"]({ tool: "read", sessionID: "root", callID: "m6" }, out);
    assert.ok(true, "plugin version read must not be blocked by .maestro/** confidential");
  });
});
