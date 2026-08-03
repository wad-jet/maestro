import { describe, it, before, after } from "node:test";
import { strict as assert } from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { MaestroBootstrapPlugin } from "./index.js";

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
  let dir, plugin, hooks, entries;

  before(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "fab-test-"));
    plugin = await MaestroBootstrapPlugin({ directory: dir });
    hooks = plugin;
    entries = [];
  });

  after(() => {
    fs.rmSync(dir, { recursive: true, force: true });
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