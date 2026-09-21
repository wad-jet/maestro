#!/usr/bin/env node
import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";

const args = process.argv.slice(2);
if (args.length < 1) {
  process.stderr.write("Usage: timeline.mjs <sessionID> [path-to-export.json]\n");
  process.exit(1);
}

const sessionID = args[0];
const exportPath = args[1];
let raw;

try {
  if (exportPath) {
    raw = readFileSync(exportPath, "utf-8");
    if (!raw || !raw.trim()) {
      process.stdout.write(JSON.stringify({ error: "export_failed" }) + "\n");
      process.exit(1);
    }
  } else {
    const tmpFile = join(tmpdir(), `opencode-export-${Date.now()}.json`);
    try {
      const out = execFileSync("opencode", ["export", sessionID], {
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 60000,
      });
      if (!out || !out.trim()) {
        process.stdout.write(JSON.stringify({ error: "export_failed" }) + "\n");
        process.exit(1);
      }
      writeFileSync(tmpFile, out);
      raw = readFileSync(tmpFile, "utf-8");
    } finally {
      try { unlinkSync(tmpFile); } catch { }
    }
  }
} catch {
  process.stdout.write(JSON.stringify({ error: "export_failed" }) + "\n");
  process.exit(1);
}

let exportData;
try {
  exportData = JSON.parse(raw);
} catch {
  process.stdout.write(JSON.stringify({ error: "invalid_export" }) + "\n");
  process.exit(1);
}

const info = exportData.info || {};
const messages = Array.isArray(exportData.messages) && exportData.messages.every(m => typeof m === "object" && m) ? exportData.messages : [];

const sessionModel = typeof info.model === "string"
  ? info.model
  : (typeof info.model === "object" && info.model && info.model.providerID && info.model.modelID
    ? `${info.model.providerID}/${info.model.modelID}`
    : null);

const allTs = messages.map(m => m.info && m.info.time && m.info.time.created).filter(t => typeof t === "number");
const sessionStart = allTs.length ? Math.min(...allTs) : null;
const sessionEnd = allTs.length ? Math.max(...allTs) : null;
const sessionDurationMs = sessionStart !== null && sessionEnd !== null ? sessionEnd - sessionStart : null;

let toolOpsCount = 0;
let toolTimeMs = 0;
let inferenceMs = 0;
let userMessages = 0;
let idleWaitMs = 0;

const agents = {};
const tools = {};
const bash = {};
const topOps = [];
const timeline = [];
const gaps = [];
let assistantTs = null;

for (const msg of messages) {
  const role = (msg.info && msg.info.role) || null;
  const ts = msg.info && msg.info.time && typeof msg.info.time.created === "number"
    ? msg.info.time.created : null;
  if (!role || ts === null) continue;
  if (role !== "user" && role !== "assistant") continue;

  const parts = Array.isArray(msg.parts) ? msg.parts : [];
  const toolParts = parts.filter(p => typeof p === "object" && p.type === "tool");
  const toolStates = toolParts.map(p => p.state).filter(s => typeof s === "object" && s);

  if (role === "assistant") assistantTs = ts;

    if (role === "user") {
    userMessages++;
    const userGap = Math.max(0, ts - (assistantTs || ts));
    idleWaitMs += userGap;
    if (userGap > 0) {
      gaps.push({ type: "user_wait", ms: userGap, afterTs: assistantTs, beforeTs: ts });
    }
    timeline.push({ kind: "user", ts, nTools: 0, toolMs: 0, inferenceMs: 0 });
    continue;
  }

  let nTools = 0;
  let toolMs = 0;
  let infMs = 0;
  for (const tp of toolParts) {
    const toolName = tp.tool || null;
    if (!toolName) continue;
    nTools++;
    toolOpsCount++;

    const st = tp.state || {};
    const t = st.time || {};
    const dur = (typeof t.start === "number" && typeof t.end === "number")
      ? (t.end - t.start) : null;

    if (dur !== null) {
      toolMs += dur;
      toolTimeMs += dur;
    }

    if (toolName === "task") {
      const agent = (tp.state && tp.state.input && tp.state.input.subagent_type) || "unknown";
      if (!agents[agent]) agents[agent] = { count: 0, totalMs: 0, maxMs: 0 };
      agents[agent].count++;
      agents[agent].totalMs += dur !== null ? dur : 0;
      agents[agent].maxMs = Math.max(agents[agent].maxMs, dur !== null ? dur : 0);
    }

    if (!tools[toolName]) tools[toolName] = { count: 0, totalMs: 0, maxMs: 0 };
    tools[toolName].count++;
    tools[toolName].totalMs += dur !== null ? dur : 0;
    tools[toolName].maxMs = Math.max(tools[toolName].maxMs, dur !== null ? dur : 0);

    let bashCmdKey = null;
    if (toolName === "bash" && tp.state && tp.state.input && typeof tp.state.input.command === "string") {
      const rawCmd = tp.state.input.command.trim().replace(/^["']+|["']+$/g, "");
      const key = rawCmd ? rawCmd.split(/\s+/)[0] : "unknown";
      const firstWord = key.startsWith("/") ? key.split("/").pop() : key;
      bashCmdKey = firstWord;
      if (!bash[firstWord]) bash[firstWord] = { count: 0, totalMs: 0, maxMs: 0, longestMs: 0 };
      bash[firstWord].count++;
      bash[firstWord].totalMs += dur !== null ? dur : 0;
      bash[firstWord].maxMs = Math.max(bash[firstWord].maxMs, dur !== null ? dur : 0);
      bash[firstWord].longestMs = Math.max(bash[firstWord].longestMs, dur !== null ? dur : 0);
    }

    if (dur !== null) {
      topOps.push({
        tool: toolName,
        agent: toolName === "task"
          ? (tp.state && tp.state.input && tp.state.input.subagent_type) || null
          : null,
        cmd: toolName === "bash" ? bashCmdKey : null,
        durationMs: dur,
        start: typeof t.start === "number" ? t.start : null,
      });
    }
  }

  if (toolStates.length) {
    const complete = toolStates.filter(s => typeof s.time?.start === "number" && typeof s.time?.end === "number");
    if (complete.length) {
      const earliestStart = Math.min(...complete.map(s => s.time.start));
      const latestEnd = Math.max(...complete.map(s => s.time.end));
      const span = latestEnd - earliestStart;
      infMs = Math.max(0, span - toolMs);
      inferenceMs += infMs;
      for (let i = 1; i < complete.length; i++) {
        const prevEnd = complete[i - 1].time.end;
        const currStart = complete[i].time.start;
        const gap = currStart - prevEnd;
        if (gap > 5000) {
          gaps.push({ type: "inference", ms: gap, afterTs: prevEnd, beforeTs: currStart });
        }
      }
    }
  }

  timeline.push({ kind: "assistant", ts, nTools, toolMs, inferenceMs: infMs });
}

const topOpsResult = topOps.sort((a, b) => b.durationMs - a.durationMs).slice(0, 10);
const gapsResult = gaps.sort((a, b) => b.ms - a.ms).slice(0, 5);

for (const [key, val] of Object.entries(agents)) {
  agents[key] = { count: val.count, totalMs: val.totalMs, maxMs: val.maxMs };
}
for (const [key, val] of Object.entries(tools)) {
  tools[key] = { count: val.count, totalMs: val.totalMs, maxMs: val.maxMs };
}
for (const [key, val] of Object.entries(bash)) {
  bash[key] = { count: val.count, totalMs: val.totalMs, maxMs: val.maxMs, longestMs: val.longestMs };
}

const sortedTools = Object.entries(tools).sort((a, b) => b[1].totalMs - a[1].totalMs || b[1].maxMs - a[1].maxMs || a[0].localeCompare(b[0]));
const sortedAgents = Object.entries(agents).sort((a, b) => b[1].totalMs - a[1].totalMs || b[1].maxMs - a[1].maxMs || a[0].localeCompare(b[0]));
const sortedBash = Object.entries(bash).sort((a, b) => b[1].totalMs - a[1].totalMs || b[1].maxMs - a[1].maxMs || a[0].localeCompare(b[0]));

timeline.sort((a, b) => a.ts - b.ts);

const result = {
  session: {
    id: info.id || null,
    start: sessionStart,
    end: sessionEnd,
    durationMs: sessionDurationMs,
    model: sessionModel,
  },
  totals: {
    toolOps: toolOpsCount,
    toolTimeMs,
    inferenceMs,
    userMessages,
    idleWaitMs,
  },
  agents: Object.fromEntries(sortedAgents),
  tools: Object.fromEntries(sortedTools),
  bash: Object.fromEntries(sortedBash),
  top_ops: topOpsResult,
  gaps: gapsResult,
  timeline,
};

process.stdout.write(JSON.stringify(result) + "\n");
