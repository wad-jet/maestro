import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, chmodSync, openSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const scriptPath = join(process.cwd(), "skills", "maestro-feedback-report", "timeline.mjs");
const tmpDir = mkdtempSync(join(tmpdir(), "timeline-test-"));

process.on("exit", () => { rmSync(tmpDir, { recursive: true, force: true }); });

const fixtureMetricsJsonl = join(tmpDir, "metrics-history.jsonl");

function runFixture(data, name, extraEnv = {}) {
  const path = join(tmpDir, `${name}.json`);
  writeFileSync(path, JSON.stringify(data));
  const out = execFileSync(process.execPath, [scriptPath, "ses_test", path], {
    encoding: "utf-8",
    timeout: 30000,
    env: { ...process.env, MAESTRO_METRICS_JSONL: fixtureMetricsJsonl, ...extraEnv },
  });
  return JSON.parse(out.trim());
}

function runFixtureFail(name, extraEnv = {}) {
  const path = join(tmpDir, `${name}.txt`);
  writeFileSync(path, "not json at all");
  try {
    const out = execFileSync(process.execPath, [scriptPath, "ses_test", path], {
      encoding: "utf-8",
      timeout: 30000,
      env: { ...process.env, MAESTRO_METRICS_JSONL: fixtureMetricsJsonl, ...extraEnv },
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
  metrics: { tokens: { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, cost: null }, activeMs: null, questionCount: 0, reviewDispatches: 0, children: "full", tokensByAgent: {} },
};

const fixtureTokens = {
  info: { id: "ses_tok", model: "m", cost: 0.01, tokens: { input: 130, output: 70, reasoning: 5, cache: { read: 10, write: 2 } } },
  messages: [
    { info: { role: "user", time: { created: 1000 } }, parts: [{ type: "text", text: "hi" }] },
    {
      info: { role: "assistant", time: { created: 2000 }, tokens: { input: 100, output: 50, reasoning: 5, cache: { read: 10, write: 2 } }, cost: 0.001 },
      parts: [
        { type: "tool", tool: "question", callID: "q1", state: { status: "completed", input: {}, output: "a", time: { start: 2100, end: 2200 } }, id: "tq1" },
      ],
    },
    {
      info: { role: "assistant", time: { created: 3000 }, tokens: { input: 30, output: 20, reasoning: 0, cache: { read: 0, write: 0 } }, cost: 0.0005 },
      parts: [
        { type: "tool", tool: "task", callID: "r1", state: { status: "completed", input: { subagent_type: "opus", description: "x" }, output: "ok", title: "Review feature X", time: { start: 3100, end: 3500 } }, id: "tr1" },
        { type: "tool", tool: "task", callID: "r2", state: { status: "completed", input: { subagent_type: "opus", description: "y" }, output: "ok", title: "Preview check", time: { start: 3600, end: 3900 } }, id: "tr2" },
        { type: "tool", tool: "task", callID: "r3", state: { status: "pending", input: { subagent_type: "opus", description: "z" }, title: "Review spec", time: { start: 4000 } }, id: "tr3" },
        { type: "tool", tool: "task", callID: "r4", state: { status: "completed", input: { subagent_type: "opus", description: "w" }, output: "ok", title: "Ревью по спеке", time: { start: 4100, end: 4400 } }, id: "tr4" },
      ],
    },
  ],
};

const fixtureFast = {
  info: { id: "ses_fast", model: "m", time: { created: 1000, end: 5000 } },
  messages: [
    { info: { role: "user", time: { created: 1000 } }, parts: [{ type: "text", text: "hi" }] },
    {
      info: { role: "assistant", time: { created: 2000 }, tokens: { input: 10, output: 5, reasoning: 0, cache: { read: 0, write: 0 } } },
      parts: [
        { type: "tool", tool: "question", callID: "q1", state: { status: "completed", input: {}, output: "a", time: { start: 2100, end: 2200 } }, id: "tq1" },
        { type: "tool", tool: "task", callID: "t1", state: { status: "completed", input: { subagent_type: "haiku", description: "x" }, output: "ok", metadata: { sessionId: "ses_child_fast" }, time: { start: 3000, end: 4000 } }, id: "tt1" },
      ],
    },
  ],
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
  assert.ok(userWaitGaps.length === 5, `gaps limited to 5, got ${userWaitGaps.length}`);
});

test("empty file yields export_failed", () => {
  const path = join(tmpDir, "empty.json");
  writeFileSync(path, "");
  try {
    execFileSync(process.execPath, [scriptPath, "ses_empty", path], {
      encoding: "utf-8",
      timeout: 30000,
      env: { ...process.env, MAESTRO_METRICS_JSONL: join(tmpDir, "metrics-history-empty.jsonl") },
    });
    assert.fail("should have thrown");
  } catch (e) {
    const data = JSON.parse(e.stdout.trim());
    assert.equal(data.error, "export_failed");
    assert.equal(e.status, 1);
  }
});

test("path-less export path (shim opencode)", () => {
  const fixtureData = {
    info: {
      id: "ses_shim",
      model: { providerID: "openai", modelID: "gpt-4" },
      time: { created: 1000, end: 1000 },
    },
    messages: [
      {
        info: { role: "user", time: { created: 1000 }, id: "u1", sessionID: "ses_shim" },
        parts: [{ type: "text", text: "start" }],
      },
      {
        info: { role: "assistant", time: { created: 2000 }, agent: "haiku", id: "a1", sessionID: "ses_shim" },
        parts: [
          { type: "text", text: "ok" },
          {
            type: "tool", tool: "read", callID: "r1",
            state: {
              status: "completed", input: { filePath: "/x.js" }, output: "x",
              time: { start: 1000, end: 2000 },
            },
            id: "tr1", sessionID: "ses_shim", messageID: "a1",
          },
        ],
      },
    ],
  };
  const shimDir = join(tmpDir, "shim");
  try { rmSync(shimDir, { recursive: true, force: true }); } catch { }
  mkdirSync(shimDir);
  const fixturePath = join(shimDir, "fixture.json");
  writeFileSync(fixturePath, JSON.stringify(fixtureData));
  const shimPath = join(shimDir, "opencode");
  writeFileSync(shimPath, [
    '#!/bin/sh',
    'cat "' + fixturePath + '"',
  ].join("\n"));
  chmodSync(shimPath, "755");

  const shimPathEnv = shimDir + ":" + process.env.PATH;
  const out = execFileSync(process.execPath, [scriptPath, "ses_shim"], {
    encoding: "utf-8",
    timeout: 30000,
    env: { ...process.env, PATH: shimPathEnv, MAESTRO_METRICS_JSONL: join(tmpDir, "metrics-history-shim.jsonl") },
  });
  const data = JSON.parse(out.trim());
  assert.equal(data.session.id, "ses_shim");
  assert.equal(data.totals.toolOps, 1);
  assert.equal(data.totals.toolTimeMs, 1000);
  assert.equal(data.totals.inferenceMs, 0);
  assert.equal(data.totals.userMessages, 1);
  assert.equal(data.totals.idleWaitMs, 0);
  assert.equal(Object.keys(data.tools).length, 1);
  assert.equal(data.tools.read.count, 1);
});

test("large export >128K via spawn path (regression)", () => {
  const largeText = "x".repeat(200000);
  const fixtureData = {
    info: {
      id: "ses_large",
      model: { providerID: "openai", modelID: "gpt-4" },
      time: { created: 1000, end: 1000 },
    },
    messages: [
      {
        info: { role: "user", time: { created: 1000 }, id: "u1", sessionID: "ses_large" },
        parts: [{ type: "text", text: largeText }],
      },
      {
        info: { role: "assistant", time: { created: 2000 }, agent: "haiku", id: "a1", sessionID: "ses_large" },
        parts: [
          { type: "text", text: "ok" },
          {
            type: "tool", tool: "task", callID: "c1",
            state: { status: "completed", input: { subagent_type: "sonnet", description: "test" }, output: "done", time: { start: 3000, end: 8000 } },
            id: "t1", sessionID: "ses_large", messageID: "a1",
          },
        ],
      },
    ],
  };
  const shimDir = join(tmpDir, "shim_large");
  try { rmSync(shimDir, { recursive: true, force: true }); } catch { }
  mkdirSync(shimDir);
  const fixturePath = join(shimDir, "fixture.json");
  writeFileSync(fixturePath, JSON.stringify(fixtureData));
  const shimPath = join(shimDir, "opencode");
  writeFileSync(shimPath, [
    '#!/bin/sh',
    'cat "' + fixturePath + '"',
  ].join("\n"));
  chmodSync(shimPath, "755");

  const shimPathEnv = shimDir + ":" + process.env.PATH;
  const out = execFileSync(process.execPath, [scriptPath, "ses_large"], {
    encoding: "utf-8",
    timeout: 30000,
    env: { ...process.env, PATH: shimPathEnv, MAESTRO_METRICS_JSONL: join(tmpDir, "metrics-history-large.jsonl") },
  });
  const data = JSON.parse(out.trim());
  assert.equal(data.session.id, "ses_large");
  assert.equal(data.totals.toolOps, 1);
  assert.equal(data.totals.toolTimeMs, 5000);
  assert.equal(data.totals.userMessages, 1);
});

test("metrics.tokens — сумма по assistant-сообщениям + cross-check с info.tokens", () => {
  const out = runFixture(fixtureTokens, "tokens");
  assert.deepEqual(out.metrics.tokens, { input: 130, output: 70, reasoning: 5, cacheRead: 10, cacheWrite: 2, cost: 0.0015 });
  // cross-check (spec Answers-1): сумма сообщений == top-level info.tokens
  const top = fixtureTokens.info.tokens;
  assert.equal(out.metrics.tokens.input, top.input);
  assert.equal(out.metrics.tokens.cacheRead, top.cache.read);
});

test("metrics.tokens.cost — все 0/absent → null", () => {
  const data = {
    info: { id: "ses_nc", model: "m" },
    messages: [
      { info: { role: "user", time: { created: 1000 } }, parts: [] },
      { info: { role: "assistant", time: { created: 2000 }, tokens: { input: 10, output: 5, reasoning: 0, cache: { read: 0, write: 0 } }, cost: 0 }, parts: [] },
    ],
  };
  const out = runFixture(data, "cost-null");
  assert.equal(out.metrics.tokens.cost, null);
});

test("metrics.activeMs — duration − idleWait (floor 0); null без таймстампов", () => {
  const out = runFixture(fixtureTokens, "tokens");
  assert.equal(out.metrics.activeMs, 2000 - (out.totals.idleWaitMs || 0));
  const noTs = { info: { id: "ses_nt" }, messages: [{ info: { role: "user" }, parts: [] }] };
  const out2 = runFixture(noTs, "no-ts");
  assert.equal(out2.metrics.activeMs, null);
});

test("metrics.questionCount и reviewDispatches — completed-only, граница слова", () => {
  const out = runFixture(fixtureTokens, "tokens");
  assert.equal(out.metrics.questionCount, 1);
  assert.equal(out.metrics.reviewDispatches, 2); // "Review feature X" + "Ревью по спеке"; "Preview" и pending — нет
});

test("metrics — drift-формата: нет tokens/title/state → нули, без исключений", () => {
  const data = {
    info: { id: "ses_drift" },
    messages: [
      { info: { role: "assistant", time: { created: 2000 } }, parts: [
        { type: "tool", tool: "task", callID: "d1", state: { status: "completed", input: { subagent_type: "opus" } }, id: "td1" },
      ] },
    ],
  };
  const out = runFixture(data, "drift");
  assert.deepEqual(out.metrics.tokens, { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, cost: null });
  assert.equal(out.metrics.reviewDispatches, 0);
  assert.equal(out.metrics.questionCount, 0);
});

function childFixture(id, tokens) {
  return JSON.stringify({ info: { id, tokens }, messages: [] });
}

test("tokensByAgent — атрибуция по child-экспорту (fixture-mode)", () => {
  const exportDir = join(tmpDir, "child-export-1");
  mkdirSync(exportDir, { recursive: true });
  writeFileSync(join(exportDir, "child_a.json"), childFixture("child_a", { input: 100, output: 10, reasoning: 0, cache: { read: 5, write: 0 } }));
  writeFileSync(join(exportDir, "child_b.json"), childFixture("child_b", { input: 50, output: 5, reasoning: 0, cache: { read: 0, write: 0 } }));
  const data = {
    info: { id: "ses_ca" },
    messages: [
      { info: { role: "assistant", time: { created: 2000 } }, parts: [
        { type: "tool", tool: "task", callID: "c1", state: { status: "completed", input: { subagent_type: "sonnet" }, output: "ok", metadata: { sessionId: "child_a" }, time: { start: 2100, end: 2500 } }, id: "tc1" },
        { type: "tool", tool: "task", callID: "c2", state: { status: "completed", input: { subagent_type: "haiku" }, output: "ok", metadata: { sessionId: "child_b" }, time: { start: 2600, end: 2900 } }, id: "tc2" },
      ] },
    ],
  };
  const out = runFixture(data, "by-agent", { MAESTRO_TIMELINE_EXPORT_DIR: exportDir });
  assert.deepEqual(out.metrics.tokensByAgent.sonnet, { count: 1, input: 100, output: 10, reasoning: 0, cacheRead: 5, cacheWrite: 0, skipped: 0, failed: 0 });
  assert.deepEqual(out.metrics.tokensByAgent.haiku, { count: 1, input: 50, output: 5, reasoning: 0, cacheRead: 0, cacheWrite: 0, skipped: 0, failed: 0 });
});

test("tokensByAgent — дубль sessionId: токены 1 раз, count = task-части; атрибуция по первому subagent_type", () => {
  const exportDir = join(tmpDir, "child-export-2");
  mkdirSync(exportDir, { recursive: true });
  writeFileSync(join(exportDir, "child_d.json"), childFixture("child_d", { input: 77, output: 7, reasoning: 0, cache: { read: 0, write: 0 } }));
  const data = {
    info: { id: "ses_dup" },
    messages: [
      { info: { role: "assistant", time: { created: 2000 } }, parts: [
        { type: "tool", tool: "task", callID: "c1", state: { status: "completed", input: { subagent_type: "sonnet" }, output: "ok", metadata: { sessionId: "child_d" }, time: { start: 2100, end: 2500 } }, id: "tc1" },
        { type: "tool", tool: "task", callID: "c2", state: { status: "completed", input: { subagent_type: "haiku" }, output: "ok", metadata: { sessionId: "child_d" }, time: { start: 2600, end: 2900 } }, id: "tc2" },
      ] },
    ],
  };
  const out = runFixture(data, "dup", { MAESTRO_TIMELINE_EXPORT_DIR: exportDir });
  assert.deepEqual(out.metrics.tokensByAgent.sonnet, { count: 1, input: 77, output: 7, reasoning: 0, cacheRead: 0, cacheWrite: 0, skipped: 0, failed: 0 });
  assert.deepEqual(out.metrics.tokensByAgent.haiku, { count: 1, input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, skipped: 0, failed: 0 });
});

test("tokensByAgent — без metadata.sessionId → игнор; failed (нет fixture); over-cap → skipped", () => {
  const exportDir = join(tmpDir, "child-export-3");
  mkdirSync(exportDir, { recursive: true });
  const parts = [];
  for (let i = 0; i < 105; i++) {
    parts.push({ type: "tool", tool: "task", callID: "c" + i, state: { status: "completed", input: { subagent_type: "haiku" }, output: "ok", metadata: { sessionId: "cap_" + i }, time: { start: 1000 + i, end: 1100 + i } }, id: "tc" + i });
  }
  parts.push({ type: "tool", tool: "task", callID: "cnometa", state: { status: "completed", input: { subagent_type: "sonnet" }, output: "ok", time: { start: 2000, end: 2100 } }, id: "tcn" });
  for (let i = 1; i < 100; i++) writeFileSync(join(exportDir, `cap_${i}.json`), childFixture("cap_" + i, { input: 1, output: 1, reasoning: 0, cache: { read: 0, write: 0 } }));
  const data = { info: { id: "ses_cap" }, messages: [{ info: { role: "assistant", time: { created: 1000 } }, parts }] };
  const out = runFixture(data, "cap", { MAESTRO_TIMELINE_EXPORT_DIR: exportDir });
  const h = out.metrics.tokensByAgent.haiku;
  assert.equal(h.count, 105);
  assert.equal(h.failed, 1);   // cap_0 — нет fixture
  assert.equal(h.skipped, 5);  // cap_100..cap_104 — over-cap
  assert.equal(h.input, 99);   // cap_1..cap_99
  assert.equal(out.metrics.tokensByAgent.sonnet, undefined); // без metadata.sessionId — не ведру
});

test("JSONL — запись строки (sessionID, date, metrics)", () => {
  const jsonl = join(tmpDir, "j1/history.jsonl");
  runFixture({ info: { id: "ses_j1" }, messages: [] }, "j1", { MAESTRO_METRICS_JSONL: jsonl });
  const lines = readFileSync(jsonl, "utf-8").trim().split("\n").map((l) => JSON.parse(l));
  assert.equal(lines.length, 1);
  assert.equal(lines[0].sessionID, "ses_test");
  assert.match(lines[0].date, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(typeof lines[0].metrics === "object" && lines[0].metrics.tokens);
});

test("JSONL — upsert по sessionID: повторный запуск заменяет строку", () => {
  const jsonl = join(tmpDir, "j2/history.jsonl");
  runFixture({ info: { id: "ses_j2" }, messages: [] }, "j2a", { MAESTRO_METRICS_JSONL: jsonl });
  runFixture({ info: { id: "ses_j2", tokens: { input: 999 } }, messages: [
    { info: { role: "assistant", time: { created: 2000 }, tokens: { input: 999, output: 0, reasoning: 0, cache: { read: 0, write: 0 } } }, parts: [] },
  ] }, "j2b", { MAESTRO_METRICS_JSONL: jsonl });
  const lines = readFileSync(jsonl, "utf-8").trim().split("\n").map((l) => JSON.parse(l));
  assert.equal(lines.length, 1);
  assert.equal(lines[0].metrics.tokens.input, 999);
});

test("JSONL — невалидные строки пропускаются (self-healing), валидные чужие сохраняются", () => {
  const dir = join(tmpDir, "j3");
  mkdirSync(dir, { recursive: true });
  const jsonl = join(dir, "history.jsonl");
  writeFileSync(jsonl, '{"sessionID":"ses_old","date":"2026-01-01","metrics":{}}\n{broken\n');
  runFixture({ info: { id: "ses_j3" }, messages: [] }, "j3", { MAESTRO_METRICS_JSONL: jsonl });
  const lines = readFileSync(jsonl, "utf-8").trim().split("\n").map((l) => JSON.parse(l));
  assert.equal(lines.length, 2); // ses_old (валидная) + ses_test; broken — удалён
  assert.ok(lines.some((l) => l.sessionID === "ses_old"));
});

test("JSONL — fail-soft: неписательный путь → stdout не меняется, код 0", () => {
  const jsonl = "/proc/never-writable/history.jsonl";
  const out = runFixture({ info: { id: "ses_j4" }, messages: [] }, "j4", { MAESTRO_METRICS_JSONL: jsonl });
  assert.ok(out.metrics); // stdout валиден
});

test("tokensByAgent — зависший child-экспорт (таймаут) → skipped, вывод не блокируется", async () => {
  const exportDir = join(tmpDir, "child-export-4");
  mkdirSync(exportDir, { recursive: true });
  writeFileSync(join(exportDir, "hang_1.hang"), "");
  const data = {
    info: { id: "ses_hang" },
    messages: [
      { info: { role: "assistant", time: { created: 2000 } }, parts: [
        { type: "tool", tool: "task", callID: "c1", state: { status: "completed", input: { subagent_type: "opus" }, output: "ok", metadata: { sessionId: "hang_1" }, time: { start: 2100, end: 2500 } }, id: "tc1" },
      ] },
    ],
  };
  const out = runFixture(data, "hang", { MAESTRO_TIMELINE_EXPORT_DIR: exportDir, MAESTRO_CHILD_EXPORT_TIMEOUT_MS: "200" });
  assert.deepEqual(out.metrics.tokensByAgent.opus, { count: 1, input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, skipped: 1, failed: 0 });
});

test("--no-children: children=skipped, tokensByAgent пуст даже при наличии task-частей (fixture)", () => {
  const path = join(tmpDir, "fast.json");
  writeFileSync(path, JSON.stringify(fixtureFast));
  const out = execFileSync(process.execPath, [scriptPath, "ses_test", path, "--no-children"], {
    encoding: "utf-8", timeout: 30000,
    env: { ...process.env, MAESTRO_TIMELINE_EXPORT_DIR: join(tmpDir, "fast-children"), MAESTRO_METRICS_JSONL: join(tmpDir, "fast.jsonl") },
  });
  const data = JSON.parse(out.trim());
  assert.equal(data.metrics.children, "skipped");
  assert.deepEqual(data.metrics.tokensByAgent, {});
  assert.equal(data.metrics.questionCount, 1);
  assert.equal(data.metrics.tokens.input, 10);
});

test("обычный прогон: metrics.children === 'full' (regression-гард нового поля)", () => {
  const data = runFixture(fixtureTokens, "childrenFull");
  assert.equal(data.metrics.children, "full");
});

test("--no-children: порядок флага среди позиционных + usage при отсутствии sessionID", () => {
  const path = join(tmpDir, "fast2.json");
  writeFileSync(path, JSON.stringify(fixtureEmpty));
  for (const a of [
    ["--no-children", "ses_test", path],
    ["ses_test", "--no-children", path],
    ["ses_test", path, "--no-children"],
  ]) {
    const out = execFileSync(process.execPath, [scriptPath, ...a], {
      encoding: "utf-8", timeout: 30000, env: { ...process.env, MAESTRO_METRICS_JSONL: join(tmpDir, "fast2.jsonl") },
    });
    assert.equal(JSON.parse(out.trim()).metrics.children, "skipped");
  }
  let err;
  try {
    execFileSync(process.execPath, [scriptPath, "--no-children"], { encoding: "utf-8", timeout: 30000, env: { ...process.env, MAESTRO_METRICS_JSONL: join(tmpDir, "fast2.jsonl") } });
    assert.fail("ожидался exit 1 (usage)");
  } catch (e) { err = e; }
  assert.equal(err.status, 1);
  assert.match(err.stderr, /Usage/);
});

test("JSONL: fast-mode строка children=skipped; full-прогон после fast заменяет строку (upsert, known behavior)", () => {
  const path = join(tmpDir, "fast3.json");
  writeFileSync(path, JSON.stringify(fixtureEmpty));
  const jsonl = join(tmpDir, "fast3.jsonl");
  const run = (a) => execFileSync(process.execPath, [scriptPath, ...a], { encoding: "utf-8", timeout: 30000, env: { ...process.env, MAESTRO_METRICS_JSONL: jsonl } });
  run(["ses_test", path, "--no-children"]);
  let lines = readFileSync(jsonl, "utf-8").trim().split("\n");
  assert.equal(lines.length, 1);
  assert.equal(JSON.parse(lines[0]).metrics.children, "skipped");
  run(["ses_test", path]);
  lines = readFileSync(jsonl, "utf-8").trim().split("\n");
  assert.equal(lines.length, 1);
  assert.equal(JSON.parse(lines[0]).metrics.children, "full");
});

const fixtureStderr = {
  info: { id: "ses_stderr", model: "m", time: { created: 1000, end: 5000 } },
  messages: [
    { info: { role: "user", time: { created: 1000 } }, parts: [{ type: "text", text: "hi" }] },
    {
      info: { role: "assistant", time: { created: 2000 }, tokens: { input: 5, output: 3, reasoning: 0, cache: { read: 0, write: 0 } } },
      parts: [
        { type: "tool", tool: "task", callID: "t1", state: { status: "completed", input: { subagent_type: "haiku", description: "x" }, output: "ok", metadata: { sessionId: "ses_child_bad" }, time: { start: 3000, end: 4000 } }, id: "tt1" },
      ],
    },
  ],
};

// fake-`opencode` (sh) в temp-dir в PATH: шум в stderr + JSON в stdout;
// failChild — сбой только для child-sid; failAll — сбой для всех вызовов
function makeFakeOpencode(dirName, { failChild = false, failAll = false, noise = 1 } = {}) {
  const dir = join(tmpDir, dirName);
  try { rmSync(dir, { recursive: true, force: true }); } catch { }
  mkdirSync(dir);
  const fixturePath = join(dir, "fixture.json");
  writeFileSync(fixturePath, JSON.stringify(fixtureStderr));
  const lines = ["#!/bin/sh"];
  if (failAll) {
    lines.push("echo 'boom-detail' >&2; exit 1");
  } else {
    if (failChild) lines.push('if [ "$2" = "ses_child_bad" ]; then echo "boom-detail" >&2; exit 1; fi');
    for (let i = 0; i < noise; i++) lines.push("echo 'progress-noise-" + i + "' >&2");
    lines.push('cat "' + fixturePath + '"');
  }
  const sh = join(dir, "opencode");
  writeFileSync(sh, lines.join("\n"));
  chmodSync(sh, "755");
  return dir;
}

function runReal(dir, sessionID, extraArgs = []) {
  return spawnSync(process.execPath, [scriptPath, sessionID, ...extraArgs], {
    encoding: "utf-8", timeout: 30000,
    env: { ...process.env, PATH: dir + ":" + process.env.PATH, MAESTRO_METRICS_JSONL: join(tmpDir, "real.jsonl") },
  });
}

test("stderr: прогресс-шум CLI подавляется при успехе (обе spawn-точки, многословный stderr)", () => {
  const dir = makeFakeOpencode("stderr_ok", { noise: 5 });
  const r = runReal(dir, "ses_stderr");
  assert.equal(r.status, 0);
  const data = JSON.parse(r.stdout.trim());
  assert.ok(data.metrics.tokensByAgent.haiku, "child-пул должен был отработать (task-часть с metadata.sessionId)");
  assert.equal(r.stderr, "");
});

test("stderr: сбой child-CLI → ровно одна диагностическая строка с tail, stdout-JSON валиден (fail-soft)", () => {
  const dir = makeFakeOpencode("stderr_cfail", { failChild: true, noise: 3 });
  const r = runReal(dir, "ses_stderr_c");
  assert.equal(r.status, 0);
  const data = JSON.parse(r.stdout.trim());
  assert.equal(data.metrics.children, "full");
  assert.ok(data.metrics.tokensByAgent.haiku.failed >= 1);
  const lines = r.stderr.trim().split("\n");
  assert.equal(lines.length, 1);
  assert.match(lines[0], /\[timeline\] export failed: ses_child_bad/);
  assert.match(lines[0], /boom-detail/);
});

test("stderr: сбой primary-CLI → diag-строка + export_failed + exit 1", () => {
  const dir = makeFakeOpencode("stderr_pfail", { failAll: true });
  const r = runReal(dir, "ses_stderr_p");
  assert.equal(r.status, 1);
  assert.match(r.stdout, /"error":"export_failed"/);
  const lines = r.stderr.trim().split("\n");
  assert.equal(lines.length, 1);
  assert.match(lines[0], /\[timeline\] export failed: ses_stderr_p/);
});
