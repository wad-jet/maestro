import { describe, it, before, after } from "node:test";
import { strict as assert } from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { MaestroBootstrapPlugin, makeLogger, makeBoundedMap } from "./index.js";

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