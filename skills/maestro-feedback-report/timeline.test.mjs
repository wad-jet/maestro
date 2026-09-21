import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const scriptPath = join(process.cwd(), "skills", "maestro-feedback-report", "timeline.mjs");
const tmpDir = mkdtempSync(join(tmpdir(), "timeline-test-"));

process.on("exit", () => { rmSync(tmpDir, { recursive: true, force: true }); });

function runFixture(data, name) {
  const path = join(tmpDir, `${name}.json`);
  writeFileSync(path, JSON.stringify(data));
  const out = execFileSync(process.execPath, [scriptPath, "ses_test", path], {
    encoding: "utf-8",
    timeout: 30000,
  });
  return JSON.parse(out.trim());
}

function runFixtureFail(name) {
  const path = join(tmpDir, `${name}.txt`);
  writeFileSync(path, "not json at all");
  try {
    const out = execFileSync(process.execPath, [scriptPath, "ses_test", path], {
      encoding: "utf-8",
      timeout: 30000,
    });
    return { stdout: out.trim(), code: 0 };
  } catch (e) {
    return { stdout: e.stdout ? e.stdout.trim() : "", code: e.status };
  }
}

const fixtureAgentsTools = {
  info: { id: "ses_test", model: { providerID: "openai", modelID: "gpt-4" }, time: { created: 1000, end: 1000 } },
  messages: [
    {
      info: { role: "user", time: { created: 1000 }, id: "msg_1", sessionID: "ses_test" },
      parts: [{ type: "text", text: "hello" }],
    },
    {
      info: { role: "assistant", time: { created: 2000 }, agent: "haiku", id: "msg_2", sessionID: "ses_test" },
      parts: [
        { type: "text", text: "ok" },
        {
          type: "tool", tool: "task", callID: "c1",
          state: { status: "completed", input: { subagent_type: "sonnet", description: "test" }, output: "done", time: { start: 3000, end: 8000 } },
          id: "t1", sessionID: "ses_test", messageID: "msg_2",
        },
        {
          type: "tool", tool: "task", callID: "c2",
          state: { status: "completed", input: { subagent_type: "haiku", description: "test2" }, output: "done2", time: { start: 8500, end: 11500 } },
          id: "t2", sessionID: "ses_test", messageID: "msg_2",
        },
        {
          type: "tool", tool: "task", callID: "c2b",
          state: { status: "completed", input: { subagent_type: "sonnet", description: "test3" }, output: "done3", time: { start: 12000, end: 16000 } },
          id: "t2b", sessionID: "ses_test", messageID: "msg_2",
        },
        {
          type: "tool", tool: "read", callID: "c3",
          state: { status: "completed", input: { filePath: "/a.js" }, output: "x", time: { start: 16500, end: 21500 } },
          id: "t3", sessionID: "ses_test", messageID: "msg_2",
        },
        {
          type: "tool", tool: "read", callID: "c4",
          state: { status: "completed", input: { filePath: "/b.js" }, output: "y", time: { start: 21500, end: 26500 } },
          id: "t4", sessionID: "ses_test", messageID: "msg_2",
        },
        {
          type: "tool", tool: "bash", callID: "c5",
          state: { status: "completed", input: { command: "node --test test/**/*.js" }, output: "ok", time: { start: 27000, end: 32000 } },
          id: "t5", sessionID: "ses_test", messageID: "msg_2",
        },
        {
          type: "tool", tool: "bash", callID: "c6",
          state: { status: "completed", input: { command: "git status" }, output: "clean", time: { start: 32500, end: 32600 } },
          id: "t6", sessionID: "ses_test", messageID: "msg_2",
        },
        {
          type: "tool", tool: "question", callID: "c7",
          state: { status: "completed", input: { text: "yes?" }, output: "yes", time: { start: 33000, end: 33100 } },
          id: "t7", sessionID: "ses_test", messageID: "msg_2",
        },
      ],
    },
    {
      info: { role: "user", time: { created: 30000 }, id: "msg_3", sessionID: "ses_test" },
      parts: [{ type: "text", text: "done" }],
    },
  ],
};

const fixtureTopOps = {
  info: { id: "ses_top", model: "openai/gpt-4", time: { created: 100, end: 100 } },
  messages: [
    {
      info: { role: "user", time: { created: 100 }, id: "u1", sessionID: "ses_top" },
      parts: [{ type: "text", text: "go" }],
    },
    {
      info: { role: "assistant", time: { created: 200 }, agent: "haiku", id: "a1", sessionID: "ses_top" },
      parts: [
        { type: "text", text: "ok" },
        {
          type: "tool", tool: "bash", callID: "tb1",
          state: { status: "completed", input: { command: "node test.js" }, output: "ok", time: { start: 300, end: 15300 } },
          id: "t1", sessionID: "ses_top", messageID: "a1",
        },
        {
          type: "tool", tool: "read", callID: "tr1",
          state: { status: "completed", input: { filePath: "/x.js" }, output: "x", time: { start: 15400, end: 20400 } },
          id: "t2", sessionID: "ses_top", messageID: "a1",
        },
        {
          type: "tool", tool: "task", callID: "tt1",
          state: { status: "completed", input: { subagent_type: "sonnet", description: "do" }, output: "d", time: { start: 20500, end: 23500 } },
          id: "t3", sessionID: "ses_top", messageID: "a1",
        },
        {
          type: "tool", tool: "read", callID: "tr2",
          state: { status: "completed", input: { filePath: "/y.js" }, output: "y", time: { start: 24000, end: 29000 } },
          id: "t4", sessionID: "ses_top", messageID: "a1",
        },
        {
          type: "tool", tool: "question", callID: "tq1",
          state: { status: "completed", input: { text: "?" }, output: "yes", time: { start: 29100, end: 29200 } },
          id: "t5", sessionID: "ses_top", messageID: "a1",
        },
      ],
    },
  ],
};

const fixtureTimeline = {
  info: { id: "ses_tl", model: { providerID: "openai", modelID: "gpt-3.5" }, time: { created: 1000, end: 1000 } },
  messages: [
    {
      info: { role: "user", time: { created: 1000 }, id: "u1", sessionID: "ses_tl" },
      parts: [{ type: "text", text: "start" }],
    },
    {
      info: { role: "assistant", time: { created: 5000 }, agent: "sonnet", id: "a1", sessionID: "ses_tl" },
      parts: [
        { type: "text", text: "working" },
        {
          type: "tool", tool: "read", callID: "r1",
          state: { status: "completed", input: { filePath: "/a" }, output: "a", time: { start: 6000, end: 11000 } },
          id: "tr1", sessionID: "ses_tl", messageID: "a1",
        },
        {
          type: "tool", tool: "read", callID: "r2",
          state: { status: "completed", input: { filePath: "/b" }, output: "b", time: { start: 21000, end: 26000 } },
          id: "tr2", sessionID: "ses_tl", messageID: "a1",
        },
      ],
    },
    {
      info: { role: "user", time: { created: 65000 }, id: "u2", sessionID: "ses_tl" },
      parts: [{ type: "text", text: "continue" }],
    },
  ],
};

const fixtureNoEnd = {
  info: { id: "ses_noend", model: "openai/gpt-4", time: { created: 100, end: 100 } },
  messages: [
    {
      info: { role: "user", time: { created: 100 }, id: "u1", sessionID: "ses_noend" },
      parts: [{ type: "text", text: "run" }],
    },
    {
      info: { role: "assistant", time: { created: 200 }, agent: "haiku", id: "a1", sessionID: "ses_noend" },
      parts: [
        { type: "text", text: "running" },
        {
          type: "tool", tool: "bash", callID: "c1",
          state: { status: "running", input: { command: "sleep 100" }, output: null, time: { start: 300 } },
          id: "t1", sessionID: "ses_noend", messageID: "a1",
        },
      ],
    },
  ],
};

const fixtureEmpty = {
  info: { id: "ses_empty", model: "openai/gpt-4", time: { created: 1000, end: 1000 } },
  messages: [],
};

const expectedEmpty = {
  session: { id: "ses_empty", start: null, end: null, durationMs: null, model: "openai/gpt-4" },
  totals: { toolOps: 0, toolTimeMs: 0, inferenceMs: 0, userMessages: 0, idleWaitMs: 0 },
  agents: {},
  tools: {},
  bash: {},
  top_ops: [],
  gaps: [],
  timeline: [],
};

test("aggregates agents/tools/bash", () => {
  const data = runFixture(fixtureAgentsTools, "agents_tools");
  assert.equal(data.totals.toolOps, 8);
  assert.equal(data.totals.toolTimeMs, 27200);
  assert.equal(data.agents.sonnet.count, 2);
  assert.equal(data.agents.sonnet.totalMs, 9000);
  assert.equal(data.agents.haiku.count, 1);
  assert.equal(data.agents.haiku.totalMs, 3000);
  assert.equal(data.tools.task.count, 3);
  assert.equal(data.tools.read.count, 2);
  assert.equal(data.tools.bash.count, 2);
  assert.equal(data.tools.question.count, 1);
  assert.equal(data.bash.node.count, 1);
  assert.equal(data.bash.node.totalMs, 5000);
  assert.equal(data.bash.git.count, 1);
  assert.equal(data.bash.git.totalMs, 100);
});

test("top_ops order", () => {
  const data = runFixture(fixtureTopOps, "top_ops");
  assert.equal(data.top_ops.length, 5);
  assert.equal(data.top_ops[0].tool, "bash");
  assert.equal(data.top_ops[0].durationMs, 15000);
  assert.equal(data.top_ops[1].tool, "read");
  assert.equal(data.top_ops[1].durationMs, 5000);
  assert.equal(data.top_ops[2].tool, "read");
  assert.equal(data.top_ops[2].durationMs, 5000);
});

test("timeline and user_wait/inference", () => {
  const data = runFixture(fixtureTimeline, "timeline");
  assert.equal(data.timeline.length, 3);
  assert.equal(data.timeline[0].kind, "user");
  assert.equal(data.timeline[1].kind, "assistant");
  assert.equal(data.timeline[1].inferenceMs, 10000);
  assert.equal(data.timeline[2].kind, "user");
  assert.equal(data.totals.idleWaitMs, 60000);
  const userWaitGap = data.gaps.find(g => g.type === "user_wait");
  assert.ok(userWaitGap);
  assert.equal(userWaitGap.ms, 60000);
  const inferenceGap = data.gaps.find(g => g.type === "inference");
  assert.ok(inferenceGap);
  assert.equal(inferenceGap.ms, 10000);
});

test("operation without end not in sums", () => {
  const data = runFixture(fixtureNoEnd, "no_end");
  assert.equal(data.totals.toolOps, 1);
  assert.equal(data.totals.toolTimeMs, 0);
  assert.equal(data.top_ops.length, 0);
  assert.equal(data.tools.bash.count, 1);
});

test("invalid export", () => {
  const r = runFixtureFail("invalid");
  assert.equal(r.code, 1);
  const data = JSON.parse(r.stdout);
  assert.equal(data.error, "invalid_export");
});

test("empty export", () => {
  const data = runFixture(fixtureEmpty, "empty");
  assert.deepEqual(data, expectedEmpty);
});

test("top_ops limited to 10", () => {
  const ops = [];
  for (let i = 0; i < 12; i++) {
    ops.push({
      type: "tool", tool: i < 4 ? "bash" : i < 8 ? "read" : "task", callID: `t${i}`,
      state: {
        status: "completed",
        input: i < 4 ? { command: `cmd ${i}` } : i < 8 ? { filePath: `/f${i}` } : { subagent_type: "sonnet", description: `d${i}` },
        output: "ok",
        time: { start: i * 2000 + 300, end: i * 2000 + 300 + (i + 1) * 1000 },
      },
      id: `t${i}`, sessionID: "ses_top10", messageID: "a1",
    });
  }
  const fixture = {
    info: { id: "ses_top10", model: "openai/gpt-4", time: { created: 100, end: 100 } },
    messages: [
      {
        info: { role: "user", time: { created: 100 }, id: "u1", sessionID: "ses_top10" },
        parts: [{ type: "text", text: "go" }],
      },
      {
        info: { role: "assistant", time: { created: 200 }, agent: "haiku", id: "a1", sessionID: "ses_top10" },
        parts: [{ type: "text", text: "ok" }, ...ops],
      },
    ],
  };
  const data = runFixture(fixture, "top10");
  assert.equal(data.top_ops.length, 10, "top_ops must be limited to 10");
  // durations: (i+1)*1000 → [1000,2000,...,12000]; sorted desc → top[0]=12000(11), top[9]=3000(2)
  assert.equal(data.top_ops[0].durationMs, 12000);
  assert.equal(data.top_ops[9].durationMs, 3000);
});

test("gaps limited to 5", () => {
  const messages = [];
  // 7 messages: user1, assistant1(with inference gap), user2, assistant2, user3, assistant3, user4
  // This creates user_wait gaps: user2-user1, user3-user2, user4-user3 = 3 user_wait
  // Plus inference gaps inside assistant blocks
  // Let's create 8 user_wait gaps to exceed 5
  for (let i = 0; i < 8; i++) {
    const ts = (i + 1) * 10000;
    messages.push({
      info: { role: "user", time: { created: ts }, id: `u${i}`, sessionID: "ses_gaps" },
      parts: [{ type: "text", text: `msg ${i}` }],
    });
  }
  // Add assistant messages between each user to get user_wait gaps
  const fullMessages = [];
  for (let i = 0; i < 8; i++) {
    fullMessages.push(messages[i]);
    if (i < 7) {
      fullMessages.push({
        info: { role: "assistant", time: { created: (i + 1) * 10000 + 100 }, agent: "haiku", id: `a${i}`, sessionID: "ses_gaps" },
        parts: [{ type: "text", text: "ok" }],
      });
    }
  }
  const fixture = {
    info: { id: "ses_gaps", model: "openai/gpt-4", time: { created: 100, end: 100 } },
    messages: fullMessages,
  };
  const data = runFixture(fixture, "gaps5");
  const userWaitGaps = data.gaps.filter(g => g.type === "user_wait");
  assert.ok(userWaitGaps.length <= 5, `gaps limited to 5, got ${userWaitGaps.length}`);
});

test("empty file yields export_failed", () => {
  const path = join(tmpDir, "empty.json");
  writeFileSync(path, "");
  try {
    execFileSync(process.execPath, [scriptPath, "ses_empty", path], {
      encoding: "utf-8",
      timeout: 30000,
    });
    assert.fail("should have thrown");
  } catch (e) {
    const data = JSON.parse(e.stdout.trim());
    assert.equal(data.error, "export_failed");
    assert.equal(e.status, 1);
  }
});
