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

describe("maestro-bootstrap tool logging", () => {
  let dir, plugin, hooks, entries, savedLogEnv;

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
    plugin = await MaestroBootstrapPlugin({ directory: dir });
    hooks = plugin;
    entries = [];
  });

  after(() => {
    fs.rmSync(dir, { recursive: true, force: true });
    for (const k of LOG_ENV) {
      if (savedLogEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedLogEnv[k];
    }
  });

  it("should register chat.params and tool.execute hooks", () => {
    assert.equal(typeof hooks["chat.params"], "function");
    assert.equal(typeof hooks["tool.execute.before"], "function");
    assert.equal(typeof hooks["tool.execute.after"], "function");
  });

  it("should log tool execution for maestro session", async () => {
    await hooks["chat.params"]({ sessionID: "s1", agent: "maestro", model: { providerID: "p", modelID: "m" } }, {});
    await hooks["tool.execute.before"](
      { tool: "bash", sessionID: "s1", callID: "c1" },
      { args: { command: "npm run test:unit" } },
    );
    await hooks["tool.execute.after"](
      { tool: "bash", sessionID: "s1", callID: "c1", args: { command: "npm run test:unit" } },
      { title: "Test Suites: 45 passed", output: "...", metadata: {} },
    );

    entries = readLogs(dir);
    const beforeEntry = entries.find((e) => e.msg === "tool.execute.before");
    const afterEntry = entries.find((e) => e.msg === "tool.execute.after");

    assert.ok(beforeEntry, "before entry must exist");
    assert.equal(beforeEntry.level, "info");
    assert.equal(beforeEntry.tool, "bash");
    assert.equal(beforeEntry.sessionID, "s1");
    assert.equal(beforeEntry.command, "npm run test:unit");

    assert.ok(afterEntry, "after entry must exist");
    assert.equal(afterEntry.tool, "bash");
    assert.equal(afterEntry.sessionID, "s1");
    assert.equal(typeof afterEntry.durationMs, "number");
    assert.equal(afterEntry.title, "Test Suites: 45 passed");
  });

  it("should NOT log tool execution for non-maestro session", async () => {
    await hooks["chat.params"]({ sessionID: "s2", agent: "haiku", model: { providerID: "p", modelID: "m" } }, {});
    await hooks["tool.execute.before"](
      { tool: "bash", sessionID: "s2", callID: "c2" },
      { args: { command: "npm run test:unit" } },
    );
    const entries = readLogs(dir);
    assert.equal(entries.filter((e) => e.callID === "c2").length, 0);
  });

  it("should log skill and task as info level", async () => {
    await hooks["chat.params"]({ sessionID: "s1", agent: "maestro", model: { providerID: "p", modelID: "m" } }, {});
    await hooks["tool.execute.before"]({ tool: "skill", sessionID: "s1", callID: "c3" }, { args: { name: "maestro" } });
    await hooks["tool.execute.after"]({ tool: "skill", sessionID: "s1", callID: "c3", args: { name: "maestro" } }, { title: "ok", output: "", metadata: {} });

    entries = readLogs(dir);
    const skillBefore = entries.filter((e) => e.msg === "tool.execute.before" && e.tool === "skill");
    assert.ok(skillBefore.length >= 1);
    assert.equal(skillBefore[0].level, "info");
  });

  it("should log session.error for maestro session", async () => {
    await hooks["chat.params"]({ sessionID: "s1", agent: "maestro", model: { providerID: "p", modelID: "m" } }, {});
    await hooks.event({
      event: {
        type: "session.error",
        properties: {
          sessionID: "s1",
          error: { type: "message_aborted", message: "Aborted by user" },
        },
      },
    });

    entries = readLogs(dir);
    const errEntry = entries.find((e) => e.msg === "session.error");
    assert.ok(errEntry, "session.error entry must exist");
    assert.equal(errEntry.level, "warn");
    assert.equal(errEntry.sessionID, "s1");
    assert.equal(errEntry.errorType, "message_aborted");
  });

  it("should log session.status retry for maestro session", async () => {
    await hooks["chat.params"]({ sessionID: "s1", agent: "maestro", model: { providerID: "p", modelID: "m" } }, {});
    await hooks.event({
      event: {
        type: "session.status",
        properties: {
          sessionID: "s1",
          status: { type: "retry", attempt: 2, message: "rate limit", next: 5000 },
        },
      },
    });

    entries = readLogs(dir);
    const retryEntry = entries.find((e) => e.msg === "session.status.retry");
    assert.ok(retryEntry, "retry entry must exist");
    assert.equal(retryEntry.level, "warn");
    assert.equal(retryEntry.attempt, 2);
  });

  it("should NOT log session.error for non-maestro session", async () => {
    await hooks["chat.params"]({ sessionID: "s2", agent: "haiku", model: { providerID: "p", modelID: "m" } }, {});
    const before = readLogs(dir).length;
    await hooks.event({
      event: { type: "session.error", properties: { sessionID: "s2", error: { type: "api_error", message: "x" } } },
    });
    assert.equal(readLogs(dir).length, before, "no new entries for non-maestro session");
  });

  it("should log empty subagent result for task tool", async () => {
    await hooks["chat.params"]({ sessionID: "s1", agent: "maestro", model: { providerID: "p", modelID: "m" } }, {});
    await hooks["tool.execute.after"](
      { tool: "task", sessionID: "s1", callID: "c-empty", args: { description: "impl" } },
      { title: undefined, output: "", metadata: {} },
    );

    entries = readLogs(dir);
    const emptyEntry = entries.find((e) => e.msg === "tool.execute.after.empty_result");
    assert.ok(emptyEntry, "empty result entry must exist");
    assert.equal(emptyEntry.level, "warn");
    assert.equal(emptyEntry.tool, "task");
  });

  it("should NOT log empty subagent result for non-maestro session", async () => {
    await hooks["chat.params"]({ sessionID: "s2", agent: "haiku", model: { providerID: "p", modelID: "m" } }, {});
    await hooks["tool.execute.after"](
      { tool: "task", sessionID: "s2", callID: "c-empty-s2", args: { description: "impl" } },
      { title: undefined, output: "", metadata: {} },
    );

    entries = readLogs(dir);
    const emptyEntry = entries.find((e) => e.callID === "c-empty-s2");
    assert.equal(emptyEntry, undefined, "no empty_result entry for non-maestro session");
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

  // Не-ключевой тул (не skill/task/bash) логируется на debug; bash — на info;
  // session.error — на warn. env ставится ДО создания плагина (маска и порог
  // читаются при инициализации).
  async function build(mask, level) {
    delete process.env[KEY];
    delete process.env[LEVEL];
    if (mask) process.env[KEY] = mask;
    if (level) process.env[LEVEL] = level;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fab-mask-"));
    const p = await MaestroBootstrapPlugin({ directory: dir });
    return { dir, p };
  }

  async function seed(p, sessionID) {
    await p["chat.params"]({ sessionID, agent: "maestro", model: { providerID: "p", modelID: "m" } }, {});
  }

  it("default mask disables debug but keeps info/warn/error", async () => {
    const { dir, p } = await build(null);
    try {
      await seed(p, "s");
      await p["tool.execute.before"]({ tool: "read", sessionID: "s", callID: "dbg" }, {});
      await p["tool.execute.before"]({ tool: "bash", sessionID: "s", callID: "inf" }, { args: {} });
      await p.event({ event: { type: "session.error", properties: { sessionID: "s", error: { type: "x", message: "m" } } } });
      const entries = readLogs(dir);
      assert.equal(entries.find((e) => e.callID === "dbg"), undefined, "debug disabled by default");
      assert.ok(entries.find((e) => e.callID === "inf"), "info-level entry logged by default");
      assert.ok(entries.find((e) => e.msg === "session.error"), "warn-level entry logged by default");
      const init = entries.find((e) => e.msg === "plugin initialized");
      assert.equal(init.mask, "info,warn,error");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("explicit full mask re-enables debug (backward compat)", async () => {
    const { dir, p } = await build("debug,info,warn,error", "debug");
    try {
      await seed(p, "s");
      await p["tool.execute.before"]({ tool: "read", sessionID: "s", callID: "dbg" }, {});
      const entries = readLogs(dir);
      assert.ok(entries.find((e) => e.callID === "dbg"), "debug logged when explicitly in mask");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("LOG_LEVEL=debug (no mask) derives mask incl. debug", async () => {
    const { dir, p } = await build(null, "debug");
    try {
      await seed(p, "s");
      await p["tool.execute.before"]({ tool: "read", sessionID: "s", callID: "dbg" }, {});
      const entries = readLogs(dir);
      assert.ok(entries.find((e) => e.callID === "dbg"), "debug enabled via LOG_LEVEL=debug");
      const init = entries.find((e) => e.msg === "plugin initialized");
      assert.equal(init.level, "debug");
      assert.equal(init.mask, "debug,info,warn,error");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("disabling debug suppresses debug-level entries only", async () => {
    const { dir, p } = await build("info,warn,error");
    try {
      await seed(p, "s");
      await p["tool.execute.before"]({ tool: "read", sessionID: "s", callID: "dbg" }, {});
      await p["tool.execute.before"]({ tool: "bash", sessionID: "s", callID: "inf" }, { args: {} });
      await p.event({ event: { type: "session.error", properties: { sessionID: "s", error: { type: "x", message: "m" } } } });
      const entries = readLogs(dir);
      assert.equal(entries.find((e) => e.callID === "dbg"), undefined, "debug suppressed");
      assert.ok(entries.find((e) => e.callID === "inf"), "info still logged");
      assert.ok(entries.find((e) => e.msg === "session.error"), "warn still logged");
      const init = entries.find((e) => e.msg === "plugin initialized");
      assert.equal(init.mask, "info,warn,error");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("disabling warn suppresses warn-level entries only", async () => {
    const { dir, p } = await build("debug,info,error");
    try {
      await seed(p, "s");
      await p["tool.execute.before"]({ tool: "bash", sessionID: "s", callID: "inf" }, { args: {} });
      await p.event({ event: { type: "session.error", properties: { sessionID: "s", error: { type: "x", message: "m" } } } });
      const entries = readLogs(dir);
      assert.ok(entries.find((e) => e.callID === "inf"), "info still logged");
      assert.equal(entries.find((e) => e.msg === "session.error"), undefined, "warn suppressed");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("disabling info suppresses info-level entries only", async () => {
    const { dir, p } = await build("debug,warn,error", "debug"); // порог debug не режет mask-уровни
    try {
      await seed(p, "s");
      await p["tool.execute.before"]({ tool: "bash", sessionID: "s", callID: "inf" }, { args: {} });
      await p["tool.execute.before"]({ tool: "read", sessionID: "s", callID: "dbg" }, {});
      const entries = readLogs(dir);
      assert.equal(entries.find((e) => e.callID === "inf"), undefined, "info suppressed");
      assert.ok(entries.find((e) => e.callID === "dbg"), "debug still logged");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("mask intersects with MAESTRO_BOOTSTRAP_LOG_LEVEL threshold", async () => {
    const { dir, p } = await build("debug,info,warn,error", "info"); // порог отсекает debug
    try {
      await seed(p, "s");
      await p["tool.execute.before"]({ tool: "read", sessionID: "s", callID: "dbg" }, {});
      await p["tool.execute.before"]({ tool: "bash", sessionID: "s", callID: "inf" }, { args: {} });
      const entries = readLogs(dir);
      assert.equal(entries.find((e) => e.callID === "dbg"), undefined, "debug cut by threshold");
      assert.ok(entries.find((e) => e.callID === "inf"), "info still logged");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("mask without valid levels disables all levels", async () => {
    const { dir, p } = await build("bogus,nonexsistent"); // ни один уровень не валиден
    try {
      await seed(p, "s");
      await p["tool.execute.before"]({ tool: "bash", sessionID: "s", callID: "inf" }, { args: {} });
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