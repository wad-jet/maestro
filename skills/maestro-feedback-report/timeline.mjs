#!/usr/bin/env node
import { readFileSync, writeFileSync, unlinkSync, openSync, closeSync, mkdirSync, rmSync, existsSync, renameSync } from "node:fs";
import { join, sep, dirname } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";

const args = process.argv.slice(2);
if (args.length < 1) {
  process.stderr.write("Usage: timeline.mjs <sessionID> [path-to-export.json]\n");
  process.exit(1);
}

const sessionID = args[0];
const exportPath = args[1];

// --- child-экспорт (metrics.tokensByAgent) ---
const EXPORT_DIR = process.env.MAESTRO_TIMELINE_EXPORT_DIR || null;
const CHILD_TIMEOUT_MS = Number(process.env.MAESTRO_CHILD_EXPORT_TIMEOUT_MS) > 0 ? Number(process.env.MAESTRO_CHILD_EXPORT_TIMEOUT_MS) : 30000;
const CHILD_CONCURRENCY = 4;
const CHILD_CAP = 100;

async function exportSession(sessionID, timeoutMs) {
  if (EXPORT_DIR) {
    // fixture-mode: <dir>/<id>.json — данные; <dir>/<id>.hang — сон max(timeoutMs*5, 2000) мс (эмуляция зависания)
    const work = (async () => {
      if (existsSync(join(EXPORT_DIR, sessionID + ".hang"))) {
        await new Promise((r) => setTimeout(r, Math.max(timeoutMs * 5, 2000)));
      }
      const p = join(EXPORT_DIR, sessionID + ".json");
      if (!existsSync(p)) throw new Error("child_export_missing");
      const raw = readFileSync(p, "utf-8");
      if (!raw || !raw.trim()) throw new Error("export_failed");
      return JSON.parse(raw);
    })();
    let timer;
    try {
      return await Promise.race([
        work,
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error("child_export_timeout")), timeoutMs);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
  return await new Promise((resolve, reject) => {
    const tmpFile = join(tmpdir(), `maestro-child-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
    const fd = openSync(tmpFile, "w");
    const child = spawn("opencode", ["export", sessionID], { stdio: ["ignore", fd, "inherit"] });
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      try { child.kill("SIGKILL"); } catch {}
      try { closeSync(fd); } catch {}
      try { unlinkSync(tmpFile); } catch {}
      reject(new Error("child_export_timeout"));
    }, timeoutMs);
    child.on("error", (e) => { if (done) return; done = true; clearTimeout(timer); try { closeSync(fd); } catch {}; try { unlinkSync(tmpFile); } catch {}; reject(e); });
    child.on("exit", (code) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { closeSync(fd); } catch {}
      if (code !== 0) { try { unlinkSync(tmpFile); } catch {}; reject(new Error("export_failed")); return; }
      let raw;
      try { raw = readFileSync(tmpFile, "utf-8"); } catch (e) { try { unlinkSync(tmpFile); } catch {}; reject(e); return; }
      try { unlinkSync(tmpFile); } catch {}
      if (!raw || !raw.trim()) { reject(new Error("export_failed")); return; }
      try { resolve(JSON.parse(raw)); } catch { reject(new Error("invalid_export")); }
    });
  });
}

let raw;

try {
  if (exportPath) {
    raw = readFileSync(exportPath, "utf-8");
    if (!raw || !raw.trim()) {
      process.stdout.write(JSON.stringify({ error: "export_failed" }) + "\n");
      process.exit(1);
    }
  } else {
    const shimDir = join(tmpdir(), `maestro-feedback-${Date.now()}`);
    mkdirSync(shimDir);
    const shimPath = join(shimDir, "opencode" + (sep === "\\" ? ".cmd" : ""));
    const tmpFile = join(tmpdir(), `opencode-export-${Date.now()}.json`);
    const shimScript = [
      '#!/bin/sh',
      'exec opencode export "$@" ' + sep + tmpFile.replace(/ /g, '\\ '),
    ].join("\n");
    writeFileSync(shimPath, shimScript, { mode: 0o755 });
    try {
      await new Promise((resolve, reject) => {
        const fd = openSync(tmpFile, "w");
        const child = spawn("opencode", ["export", sessionID], {
          stdio: ["ignore", fd, "inherit"],
        });
        child.on("exit", (code) => {
          closeSync(fd);
          if (code !== 0) {
            reject(new Error("export failed"));
          } else {
            resolve();
          }
        });
        child.on("error", reject);
      });
      raw = readFileSync(tmpFile, "utf-8");
      if (!raw || !raw.trim()) {
        process.stdout.write(JSON.stringify({ error: "export_failed" }) + "\n");
        process.exit(1);
      }
    } finally {
      try { unlinkSync(tmpFile); } catch { }
      try { rmSync(shimDir, { recursive: true, force: true }); } catch { }
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

// --- metrics (primary-данные) ---
let mInput = 0, mOutput = 0, mReasoning = 0, mCacheRead = 0, mCacheWrite = 0;
let costSum = 0, costSeen = false;
let questionCount = 0;
let reviewDispatches = 0;
const REVIEW_RE = /\breview\b|ревью/i;

for (const msg of messages) {
  const msgInfo = msg.info || {};
  if (msgInfo.role === "assistant") {
    const t = msgInfo.tokens;
    if (t && typeof t === "object") {
      mInput += t.input || 0;
      mOutput += t.output || 0;
      mReasoning += t.reasoning || 0;
      mCacheRead += (t.cache && t.cache.read) || 0;
      mCacheWrite += (t.cache && t.cache.write) || 0;
    }
    if (typeof msgInfo.cost === "number" && msgInfo.cost > 0) { costSum += msgInfo.cost; costSeen = true; }
  }
  const parts = Array.isArray(msg.parts) ? msg.parts : [];
  for (const p of parts) {
    if (typeof p !== "object" || !p || p.type !== "tool") continue;
    if (p.tool === "question") questionCount++;
    if (p.tool === "task") {
      const st = p.state;
      if (st && st.status === "completed" && typeof st.title === "string" && REVIEW_RE.test(st.title)) {
        reviewDispatches++;
      }
    }
  }
}

const metrics = {
  tokens: {
    input: mInput, output: mOutput, reasoning: mReasoning,
    cacheRead: mCacheRead, cacheWrite: mCacheWrite,
    cost: costSeen ? costSum : null,
  },
  activeMs: sessionDurationMs === null ? null : Math.max(0, sessionDurationMs - idleWaitMs),
  questionCount,
  reviewDispatches,
  tokensByAgent: {},
};

// --- metrics.tokensByAgent (child-экспорт) ---
const agentBuckets = {};
const uniqueChildren = new Map(); // sessionId -> agent (первое вхождение)
for (const msg of messages) {
  const parts = Array.isArray(msg.parts) ? msg.parts : [];
  for (const p of parts) {
    if (typeof p !== "object" || !p || p.type !== "tool" || p.tool !== "task") continue;
    const st = p.state;
    if (!st || st.status !== "completed") continue;
    const sid = st.metadata && st.metadata.sessionId;
    if (!sid || typeof sid !== "string") continue;
    const agent = (st.input && st.input.subagent_type) || "unknown";
    if (!agentBuckets[agent]) agentBuckets[agent] = { count: 0, input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, skipped: 0, failed: 0 };
    agentBuckets[agent].count++;
    if (!uniqueChildren.has(sid)) uniqueChildren.set(sid, agent);
  }
}

const childEntries = [...uniqueChildren.entries()];
const toRun = childEntries.slice(0, CHILD_CAP);
for (const [sid, agent] of childEntries.slice(CHILD_CAP)) agentBuckets[agent].skipped++;

await (async () => {
  let idx = 0;
  async function worker() {
    while (idx < toRun.length) {
      const i = idx++;
      const [sid, agent] = toRun[i];
      const b = agentBuckets[agent];
      try {
        const data = await exportSession(sid, CHILD_TIMEOUT_MS);
        const t = data && data.info && data.info.tokens;
        if (t && typeof t === "object") {
          b.input += t.input || 0;
          b.output += t.output || 0;
          b.reasoning += t.reasoning || 0;
          b.cacheRead += (t.cache && t.cache.read) || 0;
          b.cacheWrite += (t.cache && t.cache.write) || 0;
        }
      } catch (e) {
        if (e && e.message === "child_export_timeout") b.skipped++;
        else b.failed++;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CHILD_CONCURRENCY, toRun.length) }, () => worker()));
})();

metrics.tokensByAgent = agentBuckets;

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
  metrics,
};

// --- metrics JSONL (upsert, атомарно, fail-soft) ---
const METRICS_JSONL = process.env.MAESTRO_METRICS_JSONL || join(process.cwd(), ".maestro", "metrics", "history.jsonl");
try {
  mkdirSync(dirname(METRICS_JSONL), { recursive: true });
  let existing = [];
  try {
    existing = readFileSync(METRICS_JSONL, "utf-8").split("\n").filter((l) => l.trim());
  } catch {}
  const valid = [];
  for (const l of existing) {
    try { JSON.parse(l); valid.push(l); } catch {}
  }
  const record = JSON.stringify({
    sessionID: sessionID || info.id,
    date: new Date().toISOString().slice(0, 10),
    metrics,
  });
  // unique tmp (pid+ts) — parallel processes don't overwrite each other; same dir → atomic rename
  const kept = valid.filter((l) => {
    try { return JSON.parse(l).sessionID !== (sessionID || info.id); } catch { return true; }
  });
  kept.push(record);
  const tmp = `${METRICS_JSONL}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, kept.join("\n") + "\n");
  renameSync(tmp, METRICS_JSONL);
} catch (e) {
  process.stderr.write(`metrics jsonl: ${e.message}\n`);
}

process.stdout.write(JSON.stringify(result) + "\n");
