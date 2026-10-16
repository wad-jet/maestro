import { describe, it, before, after, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createBootstrapPlugin, makeLogger, makeBoundedMap, sanitize, resolveSanitizeOptions, loadWhitelist, validateWhitelist, filePathOf, loadTrustConfig, loadMaestroConfig, detectUnsafePatterns, allRulesDisabled, loadConfidentialConfig, resolveIsTrustedSubagent, normalizeTarget, isConfidentialTarget, confGlobMatch, readPluginVersion, writePluginVersionFile, isPluginMetaFile, loadCommunicationConfig, loadFeedbackReportConfig, makeMaestroConfigTool, resolveConfigFile, resolveGlobalDir } from "./core.js";
import { DEFAULTS } from "./memory/config.js";
import {
  detectPlainFlag,
  SOURCE_LABELS,
  resolveDirectiveLabel,
  directiveText,
  registerCommunicationHooks,
} from "./communication.js";
import {
  parseFeedbackReport,
  directiveText as frDirectiveText,
  registerFeedbackReportHooks,
} from "./feedback-report.js";
import { clearPipelineStatus } from "./pipeline-status.js";
import opencodePlugin from "./index.js";

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

// Изоляция глобального слоя конфига (6.0.0): тесты не должны зависеть от реального
// ~/.config/opencode/.maestro (или XDG_CONFIG_HOME) машины — resolveGlobalDir()
// смотрит в пустой временный каталог. Глобальный слой для отдельных тестов
// создаётся явно внутри XDG_TEST_HOME (никогда — в реальном home).
const savedXDG = process.env.XDG_CONFIG_HOME;
const XDG_TEST_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "maestro-test-xdg-"));
process.env.XDG_CONFIG_HOME = XDG_TEST_HOME;
const globalConfigPath = () => path.join(XDG_TEST_HOME, "opencode", ".maestro", "maestro.json");
const clearGlobalConfig = () => fs.rmSync(path.join(XDG_TEST_HOME, "opencode"), { recursive: true, force: true });
after(() => {
  clearGlobalConfig();
  if (savedXDG === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = savedXDG;
  fs.rmSync(XDG_TEST_HOME, { recursive: true, force: true });
});

// ─────────────────────────────────────────────────────────────────────────────
// V1→V2 compat: тесты написаны под V1-интерфейс (фабрика возвращает hooks-объект
// с event / tool.execute.before / tool.execute.after / dispose / tool). В V2
// плагин создаётся createBootstrapPlugin(ctx) через контекст. Ниже — mock ctx,
// который перехватывает зарегистрированные хуки и предоставляет управляемый
// event-поток; возвращаемый V1-стиль hooks вызывает те же V2-обработчики.
// ─────────────────────────────────────────────────────────────────────────────

// Event-шина: core.js вызывает ctx.event.subscribe({signal}) → async generator.
// push(event) детерминированно дожидается, пока обработчик core не обработает
// событие (ack после yield, т.е. после тела for-await).
function makeEventBus() {
  const subs = new Set();
  return {
    subscribe({ signal } = {}) {
      const sub = { queue: [], waiter: null };
      subs.add(sub);
      return (async function* () {
        try {
          while (!signal?.aborted) {
            if (!sub.queue.length) {
              await new Promise((r) => { sub.waiter = r; });
              if (signal?.aborted) return;
            }
            const holder = sub.queue.shift();
            yield holder.event;
            // Генератор возобновляется, только когда цикл core обработал event.
            holder.acks += 1;
            if (holder.acks >= subs.size) holder.resolve();
          }
        } finally {
          subs.delete(sub);
        }
      })();
    },
    push(event) {
      const holders = [...subs];
      if (holders.length === 0) return Promise.resolve();
      const holder = { event, acks: 0, resolve: () => {} };
      const p = new Promise((r) => { holder.resolve = r; });
      for (const sub of holders) {
        sub.queue.push(holder);
        const w = sub.waiter;
        sub.waiter = null;
        if (w) w();
      }
      return p;
    },
  };
}

async function MaestroBootstrapPlugin({ directory, client, sanitizeImpl } = {}) {
  const dir = directory ?? process.cwd();
  const disposers = [];
  const toolHooks = {};
  const transformedTools = {};
  const contextHandlers = [];
  const bus = makeEventBus();
  // V1→V2 compat: конвертирует V1-вызовы тестов в V2-формат плагина
  // Тесты вызывают (input, output), плагин ждёт { input, output? }
  const v1ToV2 = (name, input, output) => {
    if (output !== undefined) {
      // V1-формат: (input, output)
      const v1Output = output;
      const tool = input.tool === "bash" ? "shell" : input.tool === "task" ? "subagent" : input.tool;
      // V1: filePath → V2: path (для read/write/edit)
      let convertedInput = v1Output.args || {};
      if (convertedInput?.filePath !== undefined && ["read", "write", "edit"].includes(tool)) {
        convertedInput = { ...convertedInput, path: convertedInput.filePath };
        delete convertedInput.filePath;
      }
      const evt = { ...input, tool, input: convertedInput };
      // For after-hook: map output fields to result
      if (name === "execute.after") {
        evt.result = {
          title: v1Output.title,
          output: v1Output.output,
          metadata: v1Output.metadata,
        };
      }
      return evt;
    }
    // Уже V2-формат: один аргумент
    return input;
  };
  const ctx = {
    location: { directory: dir },
    sanitizeImpl, // test-seam: fail-closed D2 (core.js)
    session: {
      // V2-формат: { sessionID }
      get: async ({ sessionID }) => {
        if (client?.session?.get) return client.session.get({ sessionID });
        throw new Error("no client (test)");
      },
      context: async ({ sessionID }) => (client?.session?.context ? client.session.context({ sessionID }) : { data: [] }),
      // V2 fallback: test-seam для отключения session.context (no-fallback сценарий)
      context__noFallback: false,
      // V2: session.list не существует
      hook: async (name, fn) => {
        if (name === "context") contextHandlers.push(fn);
        const d = () => {};
        disposers.push(d);
        return { dispose: d };
      },
    },
    event: { subscribe: (opts) => bus.subscribe(opts) },
    tool: {
      hook: async (name, fn) => {
        if (name === "execute.before") {
          toolHooks[`tool.execute.before`] = (input, output) => fn(v1ToV2(name, input, output));
        } else if (name === "execute.after") {
          toolHooks[`tool.execute.after`] = (input, output) => fn(v1ToV2(name, input, output));
        }
        const d = () => {};
        disposers.push(d);
        return { dispose: d };
      },
      transform: async (fn) => {
        fn({ add: (t) => { transformedTools[t.name] = t; } });
        const d = () => {};
        disposers.push(d);
        return { dispose: d };
      },
    },
  };
  const cleanup = await createBootstrapPlugin(ctx);
  // V2: context-хендлеры (communication + feedback-report) вызываются через contextHandlers
  // V1-хуки (chat.message, system.transform) — не вызываются в V2-рантайме
  // для тестов используем V2 API напрямую
  return {
    ...toolHooks,
    event: async ({ event }) => { await bus.push(event); },
    dispose: () => {
      for (const d of disposers) { try { d(); } catch { /* fail-soft */ } }
      try { cleanup?.(); } catch { /* fail-soft */ }
    },
    tool: transformedTools,
    // V2 context handlers для прямого вызова в тестах
    contextHandlers,
  };
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

  it("should swallow errors from extended event handler (fail-soft)", async () => {
    // The event hook must not throw even if the memory handler throws.
    // Inject by calling the hook with a malformed event (e.g., session.idle with no properties).
    await assert.doesNotReject(() => hooks.event({ event: { type: "session.idle", properties: {} } }));
  });

  it("should log task dispatch (before/after) globally, no agent filter", async () => {
    await hooks["tool.execute.before"](
      { tool: "subagent", sessionID: "any-session", callID: "c-task" },
      { description: "impl task 1" },
    );
    await hooks["tool.execute.after"](
      { tool: "subagent", sessionID: "any-session", callID: "c-task" },
      { title: "DONE", output: "ok", metadata: {} },
    );

    entries = readLogs(dir);
    const beforeEntry = entries.find((e) => e.msg === "tool.execute.before" && e.callID === "c-task");
    const afterEntry = entries.find((e) => e.msg === "tool.execute.after" && e.callID === "c-task");

    assert.ok(beforeEntry, "subagent before entry must exist (global, no agent)");
    assert.equal(beforeEntry.level, "info");
    assert.equal(beforeEntry.tool, "subagent");
    assert.equal(beforeEntry.sessionID, "any-session");

    assert.ok(afterEntry, "subagent after entry must exist");
    assert.equal(afterEntry.tool, "subagent");
    assert.equal(typeof afterEntry.durationMs, "number");
    assert.equal(afterEntry.title, "DONE");
  });

  it("should sanitize sensitive data in task title before logging (SEC-4)", async () => {
    await hooks["tool.execute.before"](
      { tool: "subagent", sessionID: "sec-session", callID: "c-sec" },
      { description: "impl" },
    );
    await hooks["tool.execute.after"](
      { tool: "subagent", sessionID: "sec-session", callID: "c-sec" },
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
        { tool: "subagent", sessionID: "cfg-session", callID: "c-cfg" },
        { args: { subagent_type: "haiku", description: "impl" } },
      );
      await cfgHooks["tool.execute.after"](
        { tool: "subagent", sessionID: "cfg-session", callID: "c-cfg", args: { subagent_type: "haiku", description: "impl" } },
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
      { tool: "shell", sessionID: "s1", callID: "c-bash" },
      { args: { command: "npm run test:unit" } },
    );
    await hooks["tool.execute.after"](
      { tool: "shell", sessionID: "s1", callID: "c-bash", args: { command: "npm run test:unit" } },
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

  it("should log session.error robust to Error object (name + data.message)", async () => {
    await hooks.event({
      event: {
        type: "session.error",
        properties: {
          sessionID: "robust-error-session",
          error: new Error("Aborted"),
        },
      },
    });

    entries = readLogs(dir);
    const errEntry = entries.find((e) => e.msg === "session.error" && e.sessionID === "robust-error-session");
    assert.ok(errEntry, "session.error entry must exist for Error object");
    assert.equal(errEntry.errorType, "Error");
    assert.equal(errEntry.errorMessage, "Aborted");
  });

  it("should log session.error robust to Error with data.message", async () => {
    await hooks.event({
      event: {
        type: "session.error",
        properties: {
          sessionID: "robust-data-session",
          error: { name: "AbortError", data: { message: "User cancelled" } },
        },
      },
    });

    entries = readLogs(dir);
    const errEntry = entries.find((e) => e.msg === "session.error" && e.sessionID === "robust-data-session");
    assert.ok(errEntry, "session.error entry must exist for data.message format");
    assert.equal(errEntry.errorType, "AbortError");
    assert.equal(errEntry.errorMessage, "User cancelled");
  });

  it("should log session.error robust to legacy {type, message}", async () => {
    await hooks.event({
      event: {
        type: "session.error",
        properties: {
          sessionID: "robust-legacy-session",
          error: { type: "message_aborted", message: "Legacy abort" },
        },
      },
    });

    entries = readLogs(dir);
    const errEntry = entries.find((e) => e.msg === "session.error" && e.sessionID === "robust-legacy-session");
    assert.ok(errEntry, "session.error entry must exist for legacy format");
    assert.equal(errEntry.errorType, "message_aborted");
    assert.equal(errEntry.errorMessage, "Legacy abort");
    assert.equal(errEntry.aborted, true);
  });

  it("should log session.error robust to raw string", async () => {
    await hooks.event({
      event: {
        type: "session.error",
        properties: {
          sessionID: "robust-string-session",
          error: "Something went wrong",
        },
      },
    });

    entries = readLogs(dir);
    const errEntry = entries.find((e) => e.msg === "session.error" && e.sessionID === "robust-string-session");
    assert.ok(errEntry, "session.error entry must exist for string error");
    assert.equal(errEntry.errorType, "Error");
    assert.equal(errEntry.errorMessage, "Something went wrong");
  });

  it("should log session.error robust when error has name but no data/message", async () => {
    await hooks.event({
      event: {
        type: "session.error",
        properties: {
          sessionID: "robust-no-data-session",
          error: { name: "TimeoutError" },
        },
      },
    });

    entries = readLogs(dir);
    const errEntry = entries.find((e) => e.msg === "session.error" && e.sessionID === "robust-no-data-session");
    assert.ok(errEntry, "session.error entry must exist for name-only error");
    assert.equal(errEntry.errorType, "TimeoutError");
    assert.equal(errEntry.errorMessage, null);
  });

  it("should log session.error with aborted: false for non-aborted Error object", async () => {
    await hooks.event({
      event: {
        type: "session.error",
        properties: {
          sessionID: "aborted-false-session",
          error: { name: "OverloadedError", data: { message: "x" } },
        },
      },
    });

    entries = readLogs(dir);
    const errEntry = entries.find((e) => e.msg === "session.error" && e.sessionID === "aborted-false-session");
    assert.ok(errEntry, "session.error entry must exist");
    assert.equal(errEntry.errorType, "OverloadedError");
    assert.equal(errEntry.errorMessage, "x");
    assert.equal(errEntry.aborted, false);
  });

  it("should log session.error with aborted: true for MessageAbortedError", async () => {
    await hooks.event({
      event: {
        type: "session.error",
        properties: {
          sessionID: "aborted-true-session",
          error: { name: "MessageAbortedError" },
        },
      },
    });

    entries = readLogs(dir);
    const errEntry = entries.find((e) => e.msg === "session.error" && e.sessionID === "aborted-true-session");
    assert.ok(errEntry, "session.error entry must exist");
    assert.equal(errEntry.errorType, "MessageAbortedError");
    assert.equal(errEntry.errorMessage, null);
    assert.equal(errEntry.aborted, true);
  });

  it("should log session.error with null fields for empty object", async () => {
    await hooks.event({
      event: {
        type: "session.error",
        properties: {
          sessionID: "empty-obj-session",
          error: {},
        },
      },
    });

    entries = readLogs(dir);
    const errEntry = entries.find((e) => e.msg === "session.error" && e.sessionID === "empty-obj-session");
    assert.ok(errEntry, "session.error entry must exist");
    assert.equal(errEntry.errorType, null);
    assert.equal(errEntry.errorMessage, null);
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
      { tool: "subagent", sessionID: "any-session", callID: "c-empty", args: { description: "impl" } },
      { title: undefined, output: "", metadata: {} },
    );

    entries = readLogs(dir);
    const emptyEntry = entries.find((e) => e.msg === "tool.execute.after.empty_result" && e.callID === "c-empty");
    assert.ok(emptyEntry, "empty result entry must exist (global)");
    assert.equal(emptyEntry.level, "warn");
    assert.equal(emptyEntry.tool, "subagent");
  });

  it("should NOT log empty subagent result for non-empty task result", async () => {
    await hooks["tool.execute.after"](
      { tool: "subagent", sessionID: "s1", callID: "c-not-empty", args: { description: "impl" } },
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
      { rules: { env_secret: false, data_field: false, env_file: false, db_credential: false, private_key: false, auth_header: false } },
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

  it("loadMaestroConfig: файл отсутствует → нет non-memory ключей, memory — дефолты (6.0.0)", () => {
    const config = loadMaestroConfig("/nonexistent/maestro.json");
    assert.ok(!("communication" in config), "non-memory ключи должны отсутствовать");
    assert.equal(config.memory.enabled, false);
    assert.equal(config.memory.namespace, null);
    assert.equal(config.memory.embedding.model, DEFAULTS.embedding_model);
  });

  it("loadMaestroConfig parses valid maestro.json", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fab-mc-"));
    try {
      fs.writeFileSync(path.join(dir, "maestro.json"), JSON.stringify({
        trust: { custodian: true, sanitizer: true },
        sanitizer_whitelist: { patterns: ["safe_value"], extra_fields: ["custom_field"] },
      }));
      const config = loadMaestroConfig(undefined, dir);
      assert.deepEqual(config.trust, { custodian: true, sanitizer: true });
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

  // --- T2 (D3): H-1 unquoted PII, H-2 JSON-auth, H-3 ENCRYPTED-PEM,
  // --- D3(s) полный escape extra_uri_schemes (4.21.0) ---
  it("H-1: unquoted PII-значения у кураторских полей маскируются (email/phone/iban)", () => {
    const res = sanitize("email: john@doe.com phone: +7-900-123-45-67 iban: DE89370400440532013000");
    assert.ok(res.count > 0, "unquoted-значения маскируются (до D3 — только quoted/числа)");
    assert.doesNotMatch(res.text, /john@doe\.com/);
    assert.doesNotMatch(res.text, /\+7-900-123-45-67/);
    assert.doesNotMatch(res.text, /DE89370400440532013000/);
    assert.match(res.text, /<redacted>/);
  });

  it("H-1: quoted-варианты по-прежнему маскируются (анти-регрессия)", () => {
    const res = sanitize('{"email": "j@d.com", "phone": "+7-900-000-00-00"}');
    assert.equal(res.count, 2);
    assert.doesNotMatch(res.text, /j@d\.com/);
    assert.doesNotMatch(res.text, /\+7-900-000-00-00/);
    assert.match(res.text, /"email": <redacted>/);
  });

  it("H-2: JSON-auth-заголовок маскируется целиком — имя НЕ сохраняется (семантика redact())", () => {
    const res = sanitize('"Authorization": "Bearer ghp_abc123def456"');
    assert.equal(res.count, 1);
    assert.doesNotMatch(res.text, /ghp_abc123def456/);
    assert.doesNotMatch(res.text, /Authorization/, "весь матч → <redacted>, имя заголовка не сохраняется");
    // Фактическая семантика regex из спеки: матч начинается с имени (\b),
    // ведущая кавычка перед именем — вне матча; закрывающая кавычка значения
    // поглощается токеном `[^\s,;]+`.
    assert.equal(res.text, '"<redacted>');
  });

  it("H-2: Authorization c токеном и , -разделителем — маскируется только токен (no over-mask)", () => {
    const res = sanitize("Authorization: Bearer tok, X: y");
    assert.equal(res.count, 1);
    assert.doesNotMatch(res.text, /\btok\b/);
    assert.match(res.text, /<redacted>, X: y/, "X: y задет не должна быть");
  });

  it("H-3: ENCRYPTED-PEM маскируется (ENCRYPTED в альтернации BEGIN и END)", () => {
    const res = sanitize(
      "-----BEGIN ENCRYPTED PRIVATE KEY-----\nMIIE...\n-----END ENCRYPTED PRIVATE KEY-----",
    );
    assert.equal(res.count, 1);
    assert.doesNotMatch(res.text, /MIIE/);
    assert.doesNotMatch(res.text, /ENCRYPTED/);
    assert.match(res.text, /<redacted>/);
  });

  it("H-3: стандартные PEM (RSA/OPENSSH/без типа) по-прежнему маскируются (анти-регрессия)", () => {
    for (const type of ["RSA ", "OPENSSH ", ""]) {
      const pem = `-----BEGIN ${type}PRIVATE KEY-----\nMIIE...\n-----END ${type}PRIVATE KEY-----`;
      const res = sanitize(pem);
      assert.ok(res.count >= 1, `PEM ${type || "(без типа)"} маскируется`);
      assert.doesNotMatch(res.text, /MIIE/);
    }
  });

  it("D4.5 (D3(s)): extra_uri_schemes [\"bad(\"] — строка провалидирована D1, regex строится, sanitize не бросает", () => {
    const { section, warnings } = validateWhitelist({ extra_uri_schemes: ["bad("] });
    assert.deepEqual(section.extra_uri_schemes, ["bad("], "D1 строку не отбрасывает (строка, не-пустая)");
    assert.equal(warnings.length, 0);
    const opts = resolveSanitizeOptions(section, "haiku");
    let res;
    // До D3(s): escapeScheme экранировал только `?` → `new RegExp` бросал
    // SyntaxError (`bad(` — несбалансированная скобка) на каждом диспатче.
    // После: полный escapeRegex — regex валиден, `bad\(` просто не матчит.
    assert.doesNotThrow(() => { res = sanitize("postgres://user:pass@host/db", opts); });
    assert.equal(res.count, 1, "дефолтные схемы работают как раньше");
    assert.match(res.text, /<redacted>/);
    assert.doesNotMatch(res.text, /pass@/);
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
    await hooks["tool.execute.before"]({ tool: "subagent", sessionID: "s", callID: "c-san" }, output);
    assert.match(output.args.prompt, /POSTGRES_PASSWORD=<redacted>/);
    assert.doesNotMatch(output.args.prompt, /topsecret/);
  });

  it("does not modify prompt when nothing sensitive", async () => {
    const output = { args: { subagent_type: "sonnet", prompt: "Implement a simple endpoint" } };
    await hooks["tool.execute.before"]({ tool: "subagent", sessionID: "s", callID: "c-clean" }, output);
    assert.equal(output.args.prompt, "Implement a simple endpoint");
  });

  it("leaves non-task tools untouched", async () => {
    const output = { args: { command: "cat .env" } };
    await hooks["tool.execute.before"]({ tool: "shell", sessionID: "s", callID: "c-bash" }, output);
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
    await hooks["tool.execute.before"]({ tool: "subagent", sessionID: "s", callID: "c-trusted" }, output);
    assert.match(output.args.prompt, /topsecret/, "trusted prompt not sanitized");
  });

  it("sanitizes prompt for untrusted subagent (haiku)", async () => {
    const output = { args: { subagent_type: "haiku", prompt: "Check POSTGRES_PASSWORD=topsecret" } };
    await hooks["tool.execute.before"]({ tool: "subagent", sessionID: "s", callID: "c-untrusted" }, output);
    assert.doesNotMatch(output.args.prompt, /topsecret/, "untrusted prompt sanitized");
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
      await p["tool.execute.before"]({ tool: "subagent", sessionID: "s", callID: "inf" }, { args: { description: "t" } });
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
      await p["tool.execute.before"]({ tool: "subagent", sessionID: "s", callID: "inf" }, { args: { description: "t" } });
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
      await p["tool.execute.before"]({ tool: "subagent", sessionID: "s", callID: "inf" }, { args: { description: "t" } });
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
      await p["tool.execute.before"]({ tool: "subagent", sessionID: "s", callID: "inf" }, { args: { description: "t" } });
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
      await p["tool.execute.before"]({ tool: "subagent", sessionID: "s", callID: "inf" }, { args: { description: "t" } });
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
        get: async ({ sessionID }) => {
          if (session.id === "missing") throw new Error("not found");
          return { data: session };
        },
        context: async ({ sessionID }) => ({ data: messages }),
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
    assert.equal(filePathOf("read", { path: "src/a.ts" }), "src/a.ts");
  });
  it("extracts filePath from write", () => {
    assert.equal(filePathOf("write", { path: "docs/confidential/x.md", content: "hi" }), "docs/confidential/x.md");
  });
  it("extracts filePath from edit", () => {
    assert.equal(filePathOf("edit", { path: "docs/confidential/y.md", oldString: "a", newString: "b" }), "docs/confidential/y.md");
  });
  it("returns undefined for non-file tools", () => {
    assert.equal(filePathOf("bash", { command: "ls" }), undefined);
    assert.equal(filePathOf("read", {}), undefined);
    assert.equal(filePathOf("glob", { pattern: "**/*.ts" }), undefined);
    assert.equal(filePathOf("grep", { pattern: "foo", path: "src" }), undefined);
    assert.equal(filePathOf("subagent", { description: "subagent" }), undefined);
  });
});

describe("maestro-bootstrap confidential enforcement", () => {
  let dir, hooks, savedLogEnv;
  const LOG_ENV = ["MAESTRO_BOOTSTRAP_LOG_MASK", "MAESTRO_BOOTSTRAP_LOG_LEVEL", "MAESTRO_BOOTSTRAP_LOG_DIR"];

  function makeClient(sessions) {
    return {
      session: {
        get: async ({ sessionID }) => {
          const rec = sessions[sessionID];
          if (!rec) throw new Error("not found");
          return { data: rec.session };
        },
        context: async ({ sessionID }) => {
          const rec = sessions[sessionID];
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

  it("does not apply confidential to non-confidential paths", async () => {
    const out = { args: { filePath: "src/app.ts" } };
    await hooks["tool.execute.before"]({ tool: "read", sessionID: "root", callID: "c6" }, out);
    assert.ok(true);
  });

  it("confidential wins over any allow", async () => {
    const dir3 = fs.mkdtempSync(path.join(os.tmpdir(), "fab-conf3-"));
    fs.writeFileSync(path.join(dir3, "maestro.json"), JSON.stringify({
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

});

describe("maestro-bootstrap plugin version file access", () => {
  let dir, hooks, savedLogEnv;
  const LOG_ENV = ["MAESTRO_BOOTSTRAP_LOG_MASK", "MAESTRO_BOOTSTRAP_LOG_LEVEL", "MAESTRO_BOOTSTRAP_LOG_DIR"];

  before(async () => {
    savedLogEnv = {};
    for (const k of LOG_ENV) { savedLogEnv[k] = process.env[k]; delete process.env[k]; }
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "fab-ver-access-"));
    fs.writeFileSync(path.join(dir, "maestro.json"), JSON.stringify({}));
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

  it("read of .maestro/plugin-version does not throw (no file-access gate)", async () => {
    const out = { args: { filePath: ".maestro/plugin-version" } };
    // без file-access gate не должно блокироваться
    await hooks["tool.execute.before"]({ tool: "read", sessionID: "root", callID: "c-ver" }, out);
    assert.ok(true, "plugin version read must not be blocked");
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

  it("makeLogger logDir option overrides env/directory", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mlog-"));
    const custom = path.join(dir, "custom");
    fs.mkdirSync(custom, { recursive: true });
    try {
      const log = makeLogger(dir, { filePrefix: "maestro-memory", logDir: custom, filterEnv: "MAESTRO_MEMORY" });
      log.info("memory: test", {});
      const files = fs.readdirSync(custom).filter((f) => f.includes("maestro-memory"));
      assert.ok(files.length === 1, "log file written to explicit logDir");
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
        get: async ({ sessionID }) => {
          const rec = sessions[sessionID];
          if (!rec) throw new Error("not found");
          return { data: rec.session };
        },
        context: async ({ sessionID }) => {
          const rec = sessions[sessionID];
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
      bootstrap.find((x) => x.msg === "confidential.access" || x.msg === "confidential.blocked"),
      undefined,
      "security events must NOT appear in bootstrap log",
    );
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
      await h["tool.execute.before"]({ tool: "subagent", sessionID: "s", callID: "ut-pr-cust" }, output);
      assert.doesNotMatch(output.args.prompt, /s3cr3t/, "un-trusted custodian prompt sanitized");
    } finally {
      fs.rmSync(d, { recursive: true, force: true });
    }
  });

  it("un-trusted sanitizer: dispatch prompt sanitized — recursion (custodian trusted, sanitizer not)", async () => {
    const { d, h } = await makeHooks({ custodian: true });
    try {
      const output = { args: { subagent_type: "sanitizer", prompt: "Check POSTGRES_PASSWORD=s3cr3t" } };
      await h["tool.execute.before"]({ tool: "subagent", sessionID: "s", callID: "ut-pr-san" }, output);
      assert.doesNotMatch(output.args.prompt, /s3cr3t/, "un-trusted sanitizer prompt sanitized (recursion)");
    } finally {
      fs.rmSync(d, { recursive: true, force: true });
    }
  });

  it("trusted custodian: dispatch prompt NOT sanitized (control)", async () => {
    const { d, h } = await makeHooks({ custodian: true });
    try {
      const output = { args: { subagent_type: "custodian", prompt: "Check POSTGRES_PASSWORD=s3cr3t" } };
      await h["tool.execute.before"]({ tool: "subagent", sessionID: "s", callID: "ut-pr-ctrl" }, output);
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

describe("maestro-bootstrap V2 entry (Plugin.define)", () => {
  const savedCwd = process.cwd();
  let dir;

  before(async () => {
    // Пустой temp-dir без maestro.json → memory off → детерминированно,
    // без тяжёлых импортов memory-модуля.
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "maestro-v2-"));
    process.chdir(dir);
  });

  after(() => {
    process.chdir(savedCwd);
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  });

  it("default export is a V2 definition: id + setup (no V1 config/startup)", () => {
    assert.equal(opencodePlugin.id, "maestro-bootstrap");
    assert.equal(typeof opencodePlugin.setup, "function");
    // M12 (V2): V1-хуки config/startup отсутствуют — плагин не форсирует
    // config (file_access и др.), инъекция — только через ctx.
    assert.equal(opencodePlugin.config, undefined);
    assert.equal(opencodePlugin.startup, undefined);
  });

  it("setup registers tool hooks, event, dispose and tools via ctx", async () => {
    const hooks = await MaestroBootstrapPlugin({ directory: dir });
    assert.equal(typeof hooks["tool.execute.before"], "function");
    assert.equal(typeof hooks["tool.execute.after"], "function");
    assert.equal(typeof hooks.event, "function");
    assert.equal(typeof hooks.dispose, "function");
    // maestro_config регистрируется через ctx.tool.transform; memory-тулы —
    // в том же ключе (пусто при memory off).
    assert.equal(Object.hasOwn(hooks.tool, "maestro_config"), true);
    assert.equal(Object.hasOwn(hooks, "tool"), true);
  });

  it("fail-soft: setup with failing ctx → no reject (session не ломается)", async () => {
    const badCtx = {
      location: { directory: dir },
      session: {
        get: async () => ({ data: { id: "s", parentID: null } }),
        hook: async () => ({ dispose: () => {} }),
      },
      event: { subscribe: async function* () {} },
      tool: {
        hook: async () => { throw new Error("boom"); },
        transform: async () => { throw new Error("boom"); },
      },
    };
    await assert.doesNotReject(() => opencodePlugin.setup(badCtx));
  });
});

describe("communication config (loadCommunicationConfig)", () => {
  it("отсутствует ключ → дефолт plain, explicit: false", () => {
    assert.deepEqual(loadCommunicationConfig({}), { mode: "plain", explicit: false, invalid: false });
  });
  it("config undefined → дефолт plain", () => {
    assert.deepEqual(loadCommunicationConfig(undefined), { mode: "plain", explicit: false, invalid: false });
  });
  it("явный plain → explicit: true", () => {
    assert.deepEqual(loadCommunicationConfig({ communication: "plain" }), { mode: "plain", explicit: true, invalid: false });
  });
  it("явный professional → explicit: true", () => {
    assert.deepEqual(loadCommunicationConfig({ communication: "professional" }), { mode: "professional", explicit: true, invalid: false });
  });
  it("невалидное (число) → fallback plain + invalid: true", () => {
    assert.deepEqual(loadCommunicationConfig({ communication: 42 }), { mode: "plain", explicit: false, invalid: true });
  });
  it("невалидное (строка вне enum) → fallback plain + invalid: true", () => {
    assert.deepEqual(loadCommunicationConfig({ communication: "simple" }), { mode: "plain", explicit: false, invalid: true });
  });
});

describe("feedback_report config (loadFeedbackReportConfig)", () => {
  it("ключ отсутствует → manual (дефолт)", () => {
    assert.deepEqual(loadFeedbackReportConfig({}), { mode: "manual", explicit: false, invalid: false });
  });
  it("config отсутствует → manual (дефолт)", () => {
    assert.deepEqual(loadFeedbackReportConfig(undefined), { mode: "manual", explicit: false, invalid: false });
  });
  it("auto explicit", () => {
    assert.deepEqual(loadFeedbackReportConfig({ feedback_report: "auto" }), { mode: "auto", explicit: true, invalid: false });
  });
  it("manual explicit", () => {
    assert.deepEqual(loadFeedbackReportConfig({ feedback_report: "manual" }), { mode: "manual", explicit: true, invalid: false });
  });
  it("disable explicit", () => {
    assert.deepEqual(loadFeedbackReportConfig({ feedback_report: "disable" }), { mode: "disable", explicit: true, invalid: false });
  });
  it("невалидное (42) → manual + invalid", () => {
    assert.deepEqual(loadFeedbackReportConfig({ feedback_report: 42 }), { mode: "manual", explicit: false, invalid: true });
  });
  it("невалидное ('nope') → manual + invalid", () => {
    assert.deepEqual(loadFeedbackReportConfig({ feedback_report: "nope" }), { mode: "manual", explicit: false, invalid: true });
  });
  it("невалидное ('AUTO', регистр) → manual + invalid", () => {
    assert.deepEqual(loadFeedbackReportConfig({ feedback_report: "AUTO" }), { mode: "manual", explicit: false, invalid: true });
  });
});

describe("communication flag (detectPlainFlag)", () => {
  it("@maestro-init --plain → true", () => {
    assert.equal(detectPlainFlag('@maestro-init --plain "задача"'), true);
  });
  it("/maestro-init с режим-флагом перед --plain → true", () => {
    assert.equal(detectPlainFlag('/maestro-init -aa --plain "задача"'), true);
  });
  it("команда без флага → false", () => {
    assert.equal(detectPlainFlag('@maestro-init "задача"'), false);
  });
  it("флаг без команды → false", () => {
    assert.equal(detectPlainFlag('используй --plain в тексте'), false);
  });
  it("--plainly не матчит (word boundary) → false", () => {
    assert.equal(detectPlainFlag('@maestro-init --plainly "x"'), false);
  });
  it("не-строка → false", () => {
    assert.equal(detectPlainFlag(undefined), false);
    assert.equal(detectPlainFlag(42), false);
  });
});

describe("communication labels (resolveDirectiveLabel)", () => {
  const P = { mode: "professional", explicit: true, invalid: false };
  const C = { mode: "plain", explicit: true, invalid: false };
  const D = { mode: "plain", explicit: false, invalid: false };
  const DI = { mode: "plain", explicit: false, invalid: true };

  it("флаг + professional → лейбл переопределения", () => {
    assert.equal(resolveDirectiveLabel({ flagMarked: true, communication: P }), SOURCE_LABELS.flag_override);
  });
  it("флаг + plain (explicit) → лейбл флага (без «переопределяет»)", () => {
    assert.equal(resolveDirectiveLabel({ flagMarked: true, communication: C }), SOURCE_LABELS.flag);
  });
  it("флаг + plain (дефолт) → лейбл флага", () => {
    assert.equal(resolveDirectiveLabel({ flagMarked: true, communication: D }), SOURCE_LABELS.flag);
  });
  it("без флага, plain explicit → лейбл maestro.json", () => {
    assert.equal(resolveDirectiveLabel({ flagMarked: false, communication: C }), SOURCE_LABELS.config_plain);
  });
  it("без флага, дефолт/invalid → лейбл дефолта", () => {
    assert.equal(resolveDirectiveLabel({ flagMarked: false, communication: D }), SOURCE_LABELS.default);
    assert.equal(resolveDirectiveLabel({ flagMarked: false, communication: DI }), SOURCE_LABELS.default);
  });
});

describe("communication directive (directiveText)", () => {
  it("содержит лейбл источника и security-carve-out", () => {
    const t = directiveText(SOURCE_LABELS.flag_override);
    assert.ok(t.includes(SOURCE_LABELS.flag_override));
    assert.ok(t.includes("Security-находки"));
    assert.ok(t.includes("субагентов"));
  });
});

// =============================================================================
// Config resolve: 4-слойный резолв + hybrid merge (6.0.0, global install)
// Слои: MAESTRO_CONFIG (env, debug-only full override) > <root>/maestro.json
// > <root>/.maestro/maestro.json > <globalDir>/maestro.json (XDG-aware).
// Global-слой в тестах — через XDG_TEST_HOME (см. топ уровня) или явный
// globalDir-аргумент resolveConfigFile; реальный ~/.config не затрагивается.
// =============================================================================

describe("config resolve (4-layer, 6.0.0)", () => {
  const makeDirs = (prefix) => ({
    root: fs.mkdtempSync(path.join(os.tmpdir(), `mc-${prefix}-root-`)),
    gd: fs.mkdtempSync(path.join(os.tmpdir(), `mc-${prefix}-gd-`)),
  });
  const writeJson = (p, objOrStr) => {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, typeof objOrStr === "string" ? objOrStr : JSON.stringify(objOrStr));
  };
  const withEnv = (fn) => {
    const saved = process.env.MAESTRO_CONFIG;
    delete process.env.MAESTRO_CONFIG;
    try { return fn(); }
    finally {
      if (saved === undefined) delete process.env.MAESTRO_CONFIG;
      else process.env.MAESTRO_CONFIG = saved;
    }
  };

  // --- resolveGlobalDir ---

  it("resolveGlobalDir: XDG_CONFIG_HOME → <xdg>/opencode/.maestro", () => {
    assert.equal(resolveGlobalDir(), path.join(XDG_TEST_HOME, "opencode", ".maestro"));
  });

  it("resolveGlobalDir: без XDG_CONFIG_HOME → <home>/.config/opencode/.maestro", () => {
    const saved = process.env.XDG_CONFIG_HOME;
    delete process.env.XDG_CONFIG_HOME;
    try {
      assert.equal(resolveGlobalDir(), path.join(os.homedir(), ".config", "opencode", ".maestro"));
    } finally {
      if (saved === undefined) delete process.env.XDG_CONFIG_HOME;
      else process.env.XDG_CONFIG_HOME = saved;
    }
  });

  // --- resolveConfigFile ---

  it("resolveConfigFile: env override wins over all files", () => {
    const d = makeDirs("env");
    try {
      writeJson(path.join(d.root, "maestro.json"), {});
      writeJson(path.join(d.root, ".maestro", "maestro.json"), {});
      writeJson(path.join(d.gd, "maestro.json"), {});
      return withEnv(() => {
        process.env.MAESTRO_CONFIG = path.join(d.gd, "debug-maestro.json");
        assert.equal(resolveConfigFile(d.root, d.gd), path.join(d.gd, "debug-maestro.json"));
      });
    } finally {
      fs.rmSync(d.root, { recursive: true, force: true });
      fs.rmSync(d.gd, { recursive: true, force: true });
    }
  });

  it("resolveConfigFile: root beats .maestro and global", () => {
    const d = makeDirs("root");
    try {
      writeJson(path.join(d.root, "maestro.json"), {});
      writeJson(path.join(d.root, ".maestro", "maestro.json"), {});
      writeJson(path.join(d.gd, "maestro.json"), {});
      return withEnv(() => {
        assert.equal(resolveConfigFile(d.root, d.gd), path.join(d.root, "maestro.json"));
      });
    } finally {
      fs.rmSync(d.root, { recursive: true, force: true });
      fs.rmSync(d.gd, { recursive: true, force: true });
    }
  });

  it("resolveConfigFile: .maestro beats global (root отсутствует)", () => {
    const d = makeDirs("local");
    try {
      writeJson(path.join(d.root, ".maestro", "maestro.json"), {});
      writeJson(path.join(d.gd, "maestro.json"), {});
      return withEnv(() => {
        assert.equal(resolveConfigFile(d.root, d.gd), path.join(d.root, ".maestro", "maestro.json"));
      });
    } finally {
      fs.rmSync(d.root, { recursive: true, force: true });
      fs.rmSync(d.gd, { recursive: true, force: true });
    }
  });

  it("resolveConfigFile: global only → global path", () => {
    const d = makeDirs("global");
    try {
      writeJson(path.join(d.gd, "maestro.json"), {});
      return withEnv(() => {
        assert.equal(resolveConfigFile(d.root, d.gd), path.join(d.gd, "maestro.json"));
      });
    } finally {
      fs.rmSync(d.root, { recursive: true, force: true });
      fs.rmSync(d.gd, { recursive: true, force: true });
    }
  });

  it("resolveConfigFile: none → null", () => {
    const d = makeDirs("none");
    try {
      return withEnv(() => {
        assert.equal(resolveConfigFile(d.root, d.gd), null);
      });
    } finally {
      fs.rmSync(d.root, { recursive: true, force: true });
      fs.rmSync(d.gd, { recursive: true, force: true });
    }
  });

  it("resolveConfigFile: broken root JSON → .maestro path (fallback, не выбрасывает)", () => {
    const d = makeDirs("broken-root");
    try {
      writeJson(path.join(d.root, "maestro.json"), "{invalid");
      writeJson(path.join(d.root, ".maestro", "maestro.json"), {});
      writeJson(path.join(d.gd, "maestro.json"), {});
      return withEnv(() => {
        assert.doesNotThrow(() => {
          assert.equal(resolveConfigFile(d.root, d.gd), path.join(d.root, ".maestro", "maestro.json"));
        });
      });
    } finally {
      fs.rmSync(d.root, { recursive: true, force: true });
      fs.rmSync(d.gd, { recursive: true, force: true });
    }
  });

  it("resolveConfigFile: all broken → null + не выбрасывает", () => {
    const d = makeDirs("all-broken");
    try {
      writeJson(path.join(d.root, "maestro.json"), "{invalid");
      writeJson(path.join(d.root, ".maestro", "maestro.json"), "{invalid");
      writeJson(path.join(d.gd, "maestro.json"), "{invalid");
      return withEnv(() => {
        assert.doesNotThrow(() => {
          assert.equal(resolveConfigFile(d.root, d.gd), null);
        });
      });
    } finally {
      fs.rmSync(d.root, { recursive: true, force: true });
      fs.rmSync(d.gd, { recursive: true, force: true });
    }
  });

  // --- loadMaestroConfig: hybrid merge ---

  it("loadMaestroConfig: non-memory keys из активного файла (replace, не merge)", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mc-hm-nm-root-"));
    try {
      writeJson(path.join(root, "maestro.json"), { communication: "professional" });
      writeJson(globalConfigPath(), { communication: "plain" });
      const config = loadMaestroConfig(undefined, root);
      assert.equal(config.communication, "professional");
    } finally {
      clearGlobalConfig();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("loadMaestroConfig: memory soft-merge — global enabled + project namespace", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mc-hm-soft-root-"));
    try {
      writeJson(globalConfigPath(), { memory: { enabled: true, embedding: { model: "M1" } } });
      writeJson(path.join(root, ".maestro", "maestro.json"), { memory: { namespace: "a.b.c" } });
      const config = loadMaestroConfig(undefined, root);
      assert.equal(config.memory.enabled, true);
      assert.equal(config.memory.namespace, "a.b.c");
      assert.equal(config.memory.embedding.model, "M1");
    } finally {
      clearGlobalConfig();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("loadMaestroConfig: project enabled:false блокирует global enabled:true", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mc-hm-block-root-"));
    try {
      writeJson(globalConfigPath(), { memory: { enabled: true } });
      writeJson(path.join(root, "maestro.json"), { memory: { enabled: false } });
      const config = loadMaestroConfig(undefined, root);
      assert.equal(config.memory.enabled, false);
    } finally {
      clearGlobalConfig();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("loadMaestroConfig: embedding.model — project override global", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mc-hm-model-root-"));
    try {
      writeJson(globalConfigPath(), { memory: { embedding: { model: "M1" } } });
      writeJson(path.join(root, "maestro.json"), { memory: { embedding: { model: "M2" } } });
      const config = loadMaestroConfig(undefined, root);
      assert.equal(config.memory.embedding.model, "M2");
    } finally {
      clearGlobalConfig();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("loadMaestroConfig: memory нигде нет → enabled:false, namespace:null, model===DEFAULTS", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mc-hm-none-root-"));
    try {
      const config = loadMaestroConfig(undefined, root);
      assert.equal(config.memory.enabled, false);
      assert.equal(config.memory.namespace, null);
      assert.equal(config.memory.embedding.model, DEFAULTS.embedding_model);
    } finally {
      clearGlobalConfig();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("loadMaestroConfig: broken root → non-memory fallback к .maestro/", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mc-hm-brk-root-"));
    try {
      writeJson(path.join(root, "maestro.json"), "{invalid");
      writeJson(path.join(root, ".maestro", "maestro.json"), { feedback_report: "auto" });
      const config = loadMaestroConfig(undefined, root);
      assert.equal(config.feedback_report, "auto");
    } finally {
      clearGlobalConfig();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("loadMaestroConfig: активный файл без memory наследует global memory", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mc-hm-inh-root-"));
    try {
      writeJson(path.join(root, "maestro.json"), { communication: "x" });
      writeJson(globalConfigPath(), { memory: { enabled: true } });
      const config = loadMaestroConfig(undefined, root);
      assert.equal(config.communication, "x");
      assert.equal(config.memory.enabled, true);
      assert.equal(config.memory.namespace, null);
    } finally {
      clearGlobalConfig();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("loadMaestroConfig: global как активный файл → idempotent (не дублирует, не ломает)", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mc-hm-ga-root-"));
    try {
      writeJson(globalConfigPath(), { memory: { enabled: true, embedding: { model: "MG" } } });
      const config = loadMaestroConfig(undefined, root);
      assert.equal(config.memory.enabled, true);
      assert.equal(config.memory.namespace, null);
      assert.equal(config.memory.embedding.model, "MG");
    } finally {
      clearGlobalConfig();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("maestro_config tool (read-only maestro.json, spec 2026-09-24)", () => {
  let dir;
  let savedMAESTRO;

  const cfgPath = () => path.join(dir, "maestro.json");
  const lines = (msg) => readLogs(dir).filter((e) => e.msg === msg);
  const clientWith = (sessions) => ({
    session: {
      get: async ({ sessionID }) => {
        const s = sessions[sessionID];
        if (!s) throw new Error("no session");
        return s;
      },
    },
  });
  const primary = () => clientWith({ s1: { parentID: null, title: "primary" } });
  const run = (t, args, sessionID = "s1") => t.execute(args ?? {}, { sessionID });
  // V2: execute возвращает { content: [{ type, text }] }, не строку
  const getText = (result) => {
    if (typeof result === "string") return result;
    if (result?.content?.[0]?.text) return result.content[0].text;
    return String(result);
  };
  const jrun = async (t, args, sid) => JSON.parse(getText(await run(t, args, sid)));
  const makeTool = async (config, client = primary()) => {
    if (config === null) fs.rmSync(cfgPath(), { force: true });
    else
      fs.writeFileSync(
        cfgPath(),
        typeof config === "string" ? config : JSON.stringify(config),
      );
    const plugin = await MaestroBootstrapPlugin({ directory: dir, client });
    return plugin.tool.maestro_config;
  };
  const cleanup = () => fs.rmSync(cfgPath(), { force: true });

  before(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "maestro-config-tool-"));
    savedMAESTRO = process.env.MAESTRO_CONFIG;
    delete process.env.MAESTRO_CONFIG;
  });
  after(() => {
    cleanup();
    if (savedMAESTRO === undefined) delete process.env.MAESTRO_CONFIG;
    else process.env.MAESTRO_CONFIG = savedMAESTRO;
    fs.rmSync(dir, { recursive: true, force: true });
  });
  afterEach(cleanup);

  it("1. весь конфиг: exists + config + path; аудит ok", async () => {
    const t = await makeTool({ trust: { custodian: true } });
    const out = await jrun(t, {});
    assert.equal(out.exists, true);
    assert.deepEqual(out.config, { trust: { custodian: true } });
    assert.equal(out.path, cfgPath());
    assert.ok(lines("maestro_config:read").some((e) => e.result === "ok"));
  });

  it("2. section: top-level и вложенный dot-path; null-значение найдено", async () => {
    const t = await makeTool({ memory: { enabled: true, embedding: { model: null, dim: 384 } } });
    const top = await jrun(t, { section: "memory" });
    assert.equal(top.section_found, true);
    assert.equal(top.config.enabled, true);
    const nested = await jrun(t, { section: "memory.embedding.dim" });
    assert.equal(nested.section_found, true);
    assert.equal(nested.config, 384);
    const nullVal = await jrun(t, { section: "memory.embedding.model" });
    assert.equal(nullVal.section_found, true);
    assert.equal(nullVal.config, null);
  });

  it("3. section не найден → section_found: false + аудит section_missing", async () => {
    const t = await makeTool({ trust: {} });
    const out = await jrun(t, { section: "nope" });
    assert.equal(out.section_found, false);
    assert.equal(out.config, null);
    assert.ok(lines("maestro_config:read").some((e) => e.result === "section_missing"));
  });

  it("4. файл отсутствует → exists: false + аудит file_missing", async () => {
    const t = await makeTool(null);
    const out = await jrun(t, {});
    assert.equal(out.exists, false);
    assert.deepEqual(out.config, {});
    assert.ok(lines("maestro_config:read").some((e) => e.result === "file_missing"));
  });

  it("5. невалидный JSON в root → fallback-цепочка исчерпана → exists:false (6.0.0); env со сломанным JSON → parse_error", async () => {
    // 4-слойный резолв: сломанный root — это warning + fallback к следующим
    // слоям, а не parse_error (spec §3.2.1). Все слои пусты → file_missing.
    const t = await makeTool("{ not json");
    const out = await jrun(t, {});
    assert.equal(out.exists, false);
    assert.deepEqual(out.config, {});
    assert.ok(lines("maestro_config:read").some((e) => e.result === "file_missing"));

    // parse_error сохраняется для MAESTRO_CONFIG env-override (debug) со сломанным JSON.
    const envFile = path.join(dir, "env-broken.json");
    fs.writeFileSync(envFile, "{ not json");
    process.env.MAESTRO_CONFIG = envFile;
    try {
      const t2 = await makeTool(null);
      const out2 = await jrun(t2, {});
      assert.equal(out2.parse_error, true);
      assert.ok(lines("maestro_config:read").some((e) => e.result === "parse_error"));
    } finally {
      fs.rmSync(envFile, { force: true });
      delete process.env.MAESTRO_CONFIG;
    }
  });

  it("6. невалидный section → сообщение об ошибке, без throw", async () => {
    const t = await makeTool({ a: { b: 1 } });
    for (const bad of ["", ".x", "a..b", "a."]) {
      const msg = getText(await run(t, { section: bad }));
      assert.match(msg, /invalid section/i);
    }
  });

  it("6a. dot-path: inherited-свойства (proto-chain) → section_missing", async () => {
    const t = await makeTool({ trust: {} });
    for (const bad of ["__proto__", "constructor"]) {
      const out = await jrun(t, { section: bad });
      assert.equal(out.section_found, false);
      assert.equal(out.config, null);
    }
  });

  it("7. Guard: task-сессия (parentID) → deny task_session, без данных конфига", async () => {
    const t = await makeTool(
      { trust: { custodian: true } },
      clientWith({ t1: { parentID: "s0", title: "sub" } }),
    );
    const msg = getText(await run(t, {}, "t1"));
    assert.match(msg, /only available in top-level primary sessions/);
    assert.ok(!msg.includes("custodian"));
    assert.ok(
      lines("maestro_config:access_denied").some((e) => e.reason === "task_session"),
    );
  });

  it("8. Guard: service-сессия (title [maestro-memory]) → deny service_session", async () => {
    const t = await makeTool(
      {},
      clientWith({ s2: { parentID: null, title: "[maestro-memory] summarize s1" } }),
    );
    const msg = getText(await run(t, {}, "s2"));
    assert.match(msg, /only available in top-level primary sessions/);
    assert.ok(
      lines("maestro_config:access_denied").some((e) => e.reason === "service_session"),
    );
  });

  it("9. Guard: SESSIONS (fast-check до session.get) → deny service_session", async () => {
    const { SESSIONS } = await import("./memory/summarize.js");
    const t = await makeTool({}, clientWith({})); // session.get бы бросил — fast-check сработает раньше
    SESSIONS.add("svc-1");
    try {
      const msg = getText(await run(t, {}, "svc-1"));
      assert.match(msg, /only available in top-level primary sessions/);
      assert.ok(
        lines("maestro_config:access_denied").some(
          (e) => e.reason === "service_session" && e.sessionID === "svc-1",
        ),
      );
    } finally {
      SESSIONS.delete("svc-1");
    }
  });

  it("10. Guard: session.get-ошибка / нет sessionID → deny session_unavailable (fail-closed)", async () => {
    const t = await makeTool({}, primary());
    const msg1 = getText(await run(t, {}, "unknown")); // не в map → throw
    assert.match(msg1, /only available in top-level primary sessions/);
    const msg2 = getText(await t.execute({}, {})); // ctx без sessionID
    assert.match(msg2, /only available in top-level primary sessions/);
    assert.ok(
      lines("maestro_config:access_denied").filter(
        (e) => e.reason === "session_unavailable",
      ).length >= 2,
    );
  });

  it("11. Guard: primary-сессия → ok", async () => {
    const t = await makeTool({ communication: "plain" });
    const out = await jrun(t, { section: "communication" });
    assert.equal(out.config, "plain");
  });

  it("12. регистрация безусловна (без секции memory в конфиге)", async () => {
    const t = await makeTool({ trust: {} });
    assert.equal(typeof t.execute, "function");
  });

  it("13. MAESTRO_CONFIG override → path в ответе", async () => {
    const alt = path.join(dir, "custom-config.json");
    fs.writeFileSync(alt, JSON.stringify({ custom: true }));
    process.env.MAESTRO_CONFIG = alt;
    try {
      const t = await makeTool({ ignored: true }); // основной файл есть, override побеждает
      const out = await jrun(t, {});
      assert.equal(out.path, alt);
      assert.equal(out.config.custom, true);
    } finally {
      delete process.env.MAESTRO_CONFIG;
    }
  });
});

// =============================================================================
// V2 fallback для guard maestro_config (session.get → session.context)
// =============================================================================

describe("maestro_config V2 fallback (session.get unavailable → context fallback)", () => {
  let dir, savedMAESTRO;

  const cfgPath = () => path.join(dir, "maestro.json");
  const lines = (msg) => readLogs(dir).filter((e) => e.msg === msg);
  const getText = (result) => {
    if (typeof result === "string") return result;
    if (result?.content?.[0]?.text) return result.content[0].text;
    return String(result);
  };

  before(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "maestro-config-v2-"));
    savedMAESTRO = process.env.MAESTRO_CONFIG;
    delete process.env.MAESTRO_CONFIG;
  });
  after(() => {
    if (savedMAESTRO === undefined) delete process.env.MAESTRO_CONFIG;
    else process.env.MAESTRO_CONFIG = savedMAESTRO;
    fs.rmSync(dir, { recursive: true, force: true });
  });
  afterEach(() => { try { fs.rmSync(cfgPath(), { force: true }); } catch {} });

  it("V2: session.get бросает TypeError → fallback на session.context → allow", async () => {
    // V2: session.get не существует → TypeError: "get is not a function".
    // Guard ловит TypeError → fallback на session.context → allow.
    // Non-TypeError (например, "unknown session") → deny (старое поведение).
    const clientGetTypeError = {
      session: {
        get: async () => { throw new TypeError("session.get is not a function"); },
        context: async ({ sessionID }) => ({
          data: [{ info: { role: "user", content: "test" } }],
        }),
      },
    };
    fs.writeFileSync(cfgPath(), JSON.stringify({ memory: { enabled: true } }));
    const plugin = await MaestroBootstrapPlugin({ directory: dir, client: clientGetTypeError });
    const t = plugin.tool.maestro_config;
    const out = JSON.parse(getText(await t.execute({}, { sessionID: "s1" })));
    assert.equal(out.exists, true, "guard должен пропустить (fallback allow при TypeError)");
    assert.equal(out.config.memory.enabled, true);
  });

  it("V2: session.get бросает Error → deny (не TypeError, старое поведение)", async () => {
    // Если session.get существует, но бросает (не TypeError) — deny.
    // Это сохраняет backward-compat для сценария "неизвестная сессия".
    const clientGetError = {
      session: {
        get: async () => { throw new Error("session not found"); },
        context: async () => ({ data: [] }),
      },
    };
    fs.writeFileSync(cfgPath(), JSON.stringify({ trust: {} }));
    const plugin = await MaestroBootstrapPlugin({ directory: dir, client: clientGetError });
    const t = plugin.tool.maestro_config;
    const msg = getText(await t.execute({}, { sessionID: "s-err" }));
    assert.match(msg, /only available in top-level primary sessions/);
  });

  it("V2: session.get возвращает null → fallback → allow (даже с пустым контекстом)", async () => {
    const clientNull = {
      session: {
        get: async () => null,
        context: async () => ({ data: [] }),
      },
    };
    fs.writeFileSync(cfgPath(), JSON.stringify({ communication: "plain" }));
    const plugin = await MaestroBootstrapPlugin({ directory: dir, client: clientNull });
    const t = plugin.tool.maestro_config;
    const out = JSON.parse(getText(await t.execute({}, { sessionID: "s2" })));
    assert.equal(out.exists, true, "guard пропустит даже с пустым контекстом");
  });

  it("V2: session.get undefined → fallback на session.context → allow (fail-open)", async () => {
    // session.get undefined — guard видит undefined через optional chaining
    // (краткое замыкание mock'а: ctx.session.get — обёртка,
    //  но когда client.session.get === undefined, mock бросает "no client").
    // Поэтому используем get: async () => null, что тоже даёт !data.
    const clientNoGet = {
      session: {
        get: async () => null, // === undefined по семантике
        context: async ({ sessionID }) => ({
          data: [{ info: { role: "user", content: "hello" } }],
        }),
      },
    };
    fs.writeFileSync(cfgPath(), JSON.stringify({ trust: { custodian: true } }));
    const plugin = await MaestroBootstrapPlugin({ directory: dir, client: clientNoGet });
    const t = plugin.tool.maestro_config;
    const out = JSON.parse(getText(await t.execute({}, { sessionID: "s3" })));
    assert.equal(out.exists, true, "guard должен пропустить (fallback allow)");
    assert.deepEqual(out.config, { trust: { custodian: true } });
    assert.ok(lines("maestro_config:read").some((e) => e.result === "ok"));
  });

  it("V2 guard: no-fallback deny — прямое тестирование guard-логики", async () => {
    // Тестируем guard напрямую: session.get → null, context → бросает.
    // Это изолирует guard-логику от plugin mock'а.
    const { makeMaestroConfigTool } = await import("./core.js");

    const denyClient = {
      session: {
        get: async () => null,
        context: async () => { throw new Error("context not available"); },
      },
    };
    const tool = makeMaestroConfigTool({
      client: { session: denyClient.session },
      root: dir,
      log: { info: () => {}, warn: () => {}, error: () => {} },
    });
    const msg = getText(await tool.execute({}, { sessionID: "s-no-fallback" }));
    assert.match(msg, /only available in top-level primary sessions/);
  });
});

// =============================================================================
// Sanitizer Hardening T1 (4.21.0): D1 — валидация sanitizer_whitelist при init
// (H-4/H-5/H-7) + D2 — fail-closed на сбое маскирования.
// Spec: docs/superpowers/specs/2026-10-01-sanitizer-hardening-design.md
// =============================================================================

describe("sanitizer hardening T1 (D1: validateWhitelist)", () => {
  it("H-5: allow_values [[]] → элемент отброшен + warn; маскирование по validated-opts работает", () => {
    const { section, warnings } = validateWhitelist({ allow_values: [[]] });
    assert.deepEqual(section.allow_values, []);
    assert.ok(warnings.some((w) => w.field === "allow_values"), "warn по allow_values");
    const opts = resolveSanitizeOptions(section, "haiku");
    const res = sanitize("POSTGRES_PASSWORD=x", opts);
    assert.ok(res.count > 0, "маскирование работает (bypass H-5 закрыт)");
  });

  it("H-4: extra_fields [123]/[\"\"] и extra_uri_schemes [\"\"] → отброшены; sanitize не бросает", () => {
    const { section, warnings } = validateWhitelist({
      extra_fields: [123, ""],
      extra_uri_schemes: [""],
    });
    assert.deepEqual(section.extra_fields, []);
    assert.deepEqual(section.extra_uri_schemes, []);
    assert.ok(warnings.some((w) => w.field === "extra_fields" && w.type === "non_string"));
    assert.ok(warnings.some((w) => w.field === "extra_fields" && w.type === "empty_string"));
    assert.ok(warnings.some((w) => w.field === "extra_uri_schemes" && w.type === "empty_string"));
    // Без валидации sanitize бросил бы (buildDataFieldsRegex: f.includes —
    // не функция для числа). Провалидированные opts — без ошибок.
    const opts = resolveSanitizeOptions(section, "haiku");
    let res;
    assert.doesNotThrow(() => { res = sanitize('{"amount": 1}', opts); });
    assert.match(res.text, /<redacted>/);
  });

  it("H-7: rules с typo-ключом → отброшен; 6×false + мусорный truthy-ключ → allRulesDisabled === true", () => {
    const { section, warnings } = validateWhitelist({
      rules: {
        auth_headers: true, // typo-ключ (H-7)
        bogus: true,        // мусорный truthy-ключ
        env_secret: false, data_field: false, env_file: false,
        db_credential: false, private_key: false,
        auth_header: false,
      },
    });
    assert.ok(!Object.hasOwn(section.rules, "auth_headers"), "typo-ключ отброшен");
    assert.ok(!Object.hasOwn(section.rules, "bogus"), "мусорный ключ отброшен");
    assert.equal(Object.keys(section.rules).length, 6);
    assert.equal(warnings.filter((w) => w.field === "rules").length, 2);
    assert.equal(
      allRulesDisabled(resolveSanitizeOptions(section, "haiku")),
      true,
      "SEC-7 работает: все 7 правил выключены (мусор не подавляет warn)",
    );
  });

  it("D1: rules не-объект → секция игнорируется (дефолты ON) + warn", () => {
    const { section, warnings } = validateWhitelist({ rules: "off" });
    assert.ok(!("rules" in section), "секция игнорируется");
    assert.ok(warnings.some((w) => w.field === "rules" && w.type === "not_object"));
    assert.equal(
      allRulesDisabled(resolveSanitizeOptions(section, "haiku")),
      false,
      "дефолты ON",
    );
  });

  it("H-7: by_agent с не-массив value → warn/игнор (data_field НЕ выключается)", () => {
    const { section, warnings } = validateWhitelist({ by_agent: { haiku: "data_field" } });
    assert.deepEqual(section.by_agent, {});
    assert.ok(warnings.some((w) => w.field === "by_agent" && w.type === "not_array"));
    const opts = resolveSanitizeOptions(section, "haiku");
    assert.equal(opts.rules.data_field, true, "data_field не выключен");
  });

  it("D1: by_agent с неизвестным именем / не-строкой → элементы отброшены + warn", () => {
    const { section, warnings } = validateWhitelist({
      by_agent: { haiku: ["data_field", "nope", 42] },
    });
    assert.deepEqual(section.by_agent, { haiku: ["data_field"] });
    assert.equal(warnings.filter((w) => w.field === "by_agent").length, 2);
  });

  it("D1: валидная секция проходит без изменений, без warn", () => {
    const valid = {
      rules: { env_secret: false },
      by_agent: { haiku: ["data_field"] },
      allow_values: ["safe_value"],
      extra_fields: ["custom_field"],
      extra_uri_schemes: ["crm"],
    };
    const { section, warnings } = validateWhitelist(valid);
    assert.deepEqual(section, valid);
    assert.equal(warnings.length, 0);
  });

  it("D1: не-массив allow_values/extra_fields/extra_uri_schemes → поле игнорируется + warn", () => {
    const { section, warnings } = validateWhitelist({
      allow_values: "x",
      extra_fields: 42,
      extra_uri_schemes: null,
    });
    assert.ok(!("allow_values" in section));
    assert.ok(!("extra_fields" in section));
    assert.ok(!("extra_uri_schemes" in section));
    assert.equal(warnings.filter((w) => w.type === "not_array").length, 3);
  });
});

describe("sanitizer hardening T1 (D1: init-валидация, plugin)", () => {
  let dir, savedEnv;
  const ENV = [
    "MAESTRO_BOOTSTRAP_LOG_MASK", "MAESTRO_BOOTSTRAP_LOG_LEVEL",
    "MAESTRO_BOOTSTRAP_LOG_DIR", "MAESTRO_AUDIT_LOG_DIR", "MAESTRO_CONFIG",
  ];

  before(() => {
    savedEnv = {};
    for (const k of ENV) { savedEnv[k] = process.env[k]; delete process.env[k]; }
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "fab-hard-d1-"));
  });

  after(() => {
    for (const k of ENV) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("H-5: patterns [[]] через plugin — промпт диспатча маскируется", async () => {
    const d = path.join(dir, "h5");
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, "maestro.json"), JSON.stringify({
      sanitizer_whitelist: { patterns: [[]] },
    }));
    const h = await MaestroBootstrapPlugin({ directory: d });
    const output = { args: { subagent_type: "haiku", prompt: "Check POSTGRES_PASSWORD=s3cr3t" } };
    await h["tool.execute.before"]({ tool: "subagent", sessionID: "s-h5", callID: "c-h5" }, output);
    assert.doesNotMatch(output.args.prompt, /s3cr3t/, "H-5: промпт замаскирован");
    assert.match(output.args.prompt, /<redacted>/);
  });

  it("warn sanitizer.invalid_config — ровно 1 при init (N диспатчей → всё ещё 1)", async () => {
    const d = path.join(dir, "warn");
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, "maestro.json"), JSON.stringify({
      sanitizer_whitelist: { allow_values: [[]], extra_fields: [123] },
    }));
    const h = await MaestroBootstrapPlugin({ directory: d });
    let entries = readLogs(d).filter((e) => e.msg === "sanitizer.invalid_config");
    assert.equal(entries.length, 1, "ровно один warn при init");
    // SEC-4b: в warn только имена полей и тип, без значений элементов.
    assert.ok(entries[0].fields.every((f) => f === "allow_values" || f === "extra_fields"));
    assert.ok(entries[0].fields.includes("allow_values"));
    assert.ok(entries[0].fields.includes("extra_fields"));
    assert.equal(entries[0].count, 2);
    // N диспатчей → warn не повторяется (валидация — один раз при init).
    for (let i = 0; i < 3; i++) {
      const out = { args: { subagent_type: "haiku", prompt: `hello ${i}` } };
      await h["tool.execute.before"]({ tool: "subagent", sessionID: "s-w", callID: `c-w-${i}` }, out);
    }
    entries = readLogs(d).filter((e) => e.msg === "sanitizer.invalid_config");
    assert.equal(entries.length, 1, "warn не на каждом диспатче");
  });
});

describe("sanitizer hardening T1 (D2: fail-closed)", () => {
  // Test-seam: фабрика принимает sanitizeImpl (default — реальный sanitize).
  // Бросающая реализация форсирует сбой маскирования (H-4).
  const ENV = [
    "MAESTRO_BOOTSTRAP_LOG_MASK", "MAESTRO_BOOTSTRAP_LOG_LEVEL",
    "MAESTRO_BOOTSTRAP_LOG_DIR", "MAESTRO_AUDIT_LOG_DIR", "MAESTRO_CONFIG",
  ];
  let savedEnv;
  let auditDir;

  // Чтение audit-JSONL из явного каталога (MAESTRO_AUDIT_LOG_DIR → tmp),
  // по образцу readLogs.
  function readAudit() {
    const files = fs.existsSync(auditDir) ? fs.readdirSync(auditDir) : [];
    const out = [];
    for (const f of files) {
      if (!f.includes("maestro-audit")) continue;
      for (const line of fs.readFileSync(path.join(auditDir, f), "utf8").split("\n")) {
        if (line.trim()) out.push(JSON.parse(line));
      }
    }
    return out;
  }

  async function makeThrowingHooks() {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), "fab-hard-fc-"));
    const h = await MaestroBootstrapPlugin({
      directory: d,
      sanitizeImpl: () => { throw new Error("boom"); },
    });
    return { d, h };
  }

  before(() => {
    savedEnv = {};
    for (const k of ENV) { savedEnv[k] = process.env[k]; delete process.env[k]; }
    auditDir = fs.mkdtempSync(path.join(os.tmpdir(), "fab-hard-fc-audit-"));
    process.env.MAESTRO_AUDIT_LOG_DIR = auditDir;
  });

  after(() => {
    for (const k of ENV) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
    fs.rmSync(auditDir, { recursive: true, force: true });
  });

  it("сбой sanitize в task-ветке → диспатч заблокирован + audit sanitizer.failed", async () => {
    const { d, h } = await makeThrowingHooks();
    try {
      const output = { args: { subagent_type: "haiku", prompt: "Check POSTGRES_PASSWORD=s3cr3t" } };
      await assert.rejects(
        h["tool.execute.before"]({ tool: "subagent", sessionID: "s-fc1", callID: "fc-1" }, output),
        (err) => {
          assert.match(err.message, /\[sanitizer:failed\]/);
          assert.match(err.message, /haiku/);
          assert.match(err.message, /sanitizer_whitelist/);
          assert.equal(err.sanitizerFailed, true, "маркер на ошибке");
          return true;
        },
      );
      // Аудит-запись (security-фактура сбойного маскирования).
      const e = readAudit().find((x) => x.msg === "sanitizer.failed" && x.callID === "fc-1");
      assert.ok(e, "audit-запись sanitizer.failed должна существовать");
      assert.equal(e.sessionID, "s-fc1");
      assert.equal(e.agent, "haiku");
      // Audit-only: дубль в bootstrap-лог не пишется (конвенция).
      const bootstrap = readLogs(d).filter((x) => x.msg === "sanitizer.failed");
      assert.equal(bootstrap.length, 0, "security-событие не дублируется в bootstrap");
    } finally {
      fs.rmSync(d, { recursive: true, force: true });
    }
  });

  it("title-ветка (after): сбой sanitize → title <unavailable>, без throw", async () => {
    const { d, h } = await makeThrowingHooks();
    try {
      // before без prompt — call регистрируется (toolCalls), сбой маскирования
      // в этой ветке не возникает.
      await h["tool.execute.before"](
        { tool: "subagent", sessionID: "s-fc2", callID: "fc-t1" },
        { args: { subagent_type: "haiku", description: "impl" } },
      );
      await assert.doesNotReject(
        h["tool.execute.after"](
          { tool: "subagent", sessionID: "s-fc2", callID: "fc-t1", args: { subagent_type: "haiku" } },
          { title: "report API_KEY=leak123", output: "ok", metadata: {} },
        ),
        "сбой маскирования title не ломает сессию",
      );
      const e = readLogs(d).find((x) => x.msg === "tool.execute.after" && x.callID === "fc-t1");
      assert.ok(e, "запись tool.execute.after должна существовать");
      assert.equal(e.title, "<unavailable>", "title не логируется (fail-soft)");
    } finally {
      fs.rmSync(d, { recursive: true, force: true });
    }
  });
});

// =============================================================================
// Pipeline Status Integration (Task 4)
// =============================================================================

describe("pipeline-status integration", () => {
  let dir, savedEnv;
  const ENV = [
    "MAESTRO_BOOTSTRAP_LOG_MASK", "MAESTRO_BOOTSTRAP_LOG_LEVEL",
    "MAESTRO_BOOTSTRAP_LOG_DIR", "MAESTRO_CONFIG",
  ];

  before(() => {
    savedEnv = {};
    for (const k of ENV) { savedEnv[k] = process.env[k]; delete process.env[k]; }
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "fab-ps-integration-"));
  });

  after(() => {
    for (const k of ENV) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("pipeline-status hooks are registered during plugin creation", async () => {
    const p = await MaestroBootstrapPlugin({ directory: dir });
    assert.ok(p.contextHandlers.length > 0, "pipeline-status hook should be registered");
    p.dispose();
  });

  it("pipeline-status tool is registered in transformed tools", async () => {
    const p = await MaestroBootstrapPlugin({ directory: dir });
    assert.ok("maestro_pipeline_status" in p.tool, "tool should be registered");
    assert.equal(typeof p.tool.maestro_pipeline_status.execute, "function");
    p.dispose();
  });

  it("pipeline-status tool returns idle status when not set", async () => {
    clearPipelineStatus();
    const p = await MaestroBootstrapPlugin({ directory: dir });
    const tool = p.tool.maestro_pipeline_status;
    const result = await tool.execute({ action: "get" }, { sessionID: "s1" });
    const out = typeof result === "string" ? result : result.content?.[0]?.text;
    const parsed = JSON.parse(out);
    assert.equal(parsed.active, false, "status should be idle");
    p.dispose();
  });

  it("pipeline-status tool set and clear works", async () => {
    const mockClient = {
      session: {
        get: async ({ sessionID }) => ({ data: { parentID: null, title: "test" } }),
      },
    };
    const p = await MaestroBootstrapPlugin({ directory: dir, client: mockClient });
    const tool = p.tool.maestro_pipeline_status;

    // Set status
    const setResult = await tool.execute(
      { action: "set", step: 5, totalSteps: 18.5, description: "testing" },
      { sessionID: "s1" },
    );
    const setResultText = typeof setResult === "string" ? setResult : setResult.content?.[0]?.text;
    assert.equal(JSON.parse(setResultText).ok, true);

    // Get status
    const getResult = await tool.execute({ action: "get" }, { sessionID: "s1" });
    const getText = typeof getResult === "string" ? getResult : getResult.content?.[0]?.text;
    const status = JSON.parse(getText);
    assert.equal(status.active, true);
    assert.equal(status.step, 5);
    assert.equal(status.totalSteps, 18.5, "totalSteps preserved as input value");
    assert.equal(status.description, "testing");

    // Clear status
    const clearResult = await tool.execute({ action: "clear" }, { sessionID: "s1" });
    const clearText = typeof clearResult === "string" ? clearResult : clearResult.content?.[0]?.text;
    assert.equal(JSON.parse(clearText).ok, true);

    p.dispose();
  });
});
