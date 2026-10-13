#!/usr/bin/env node
import { readFileSync, writeFileSync, unlinkSync, openSync, closeSync, mkdirSync, rmSync, existsSync, renameSync } from "node:fs";
import { join, sep, dirname } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";

const rawArgs = process.argv.slice(2);
const noChildren = rawArgs.includes("--no-children");
const args = rawArgs.filter((a) => a !== "--no-children");
if (args.length < 1) {
  process.stderr.write("Usage: timeline.mjs <sessionID> [path-to-export.json] [--no-children]\n");
  process.exit(1);
}

const sessionID = args[0];
const exportPath = args[1];

// --- child-экспорт (metrics.tokensByAgent) ---
const EXPORT_DIR = process.env.MAESTRO_TIMELINE_EXPORT_DIR || null;
const CHILD_TIMEOUT_MS = Number(process.env.MAESTRO_CHILD_EXPORT_TIMEOUT_MS) > 0 ? Number(process.env.MAESTRO_CHILD_EXPORT_TIMEOUT_MS) : 30000;
const CHILD_CONCURRENCY = 4;
const CHILD_CAP = 100;
const errTailOneLine = (t) => t.replace(/\r?\n/g, " ").trim().slice(-300) || "no stderr";

function formatMs(ms) {
  if (ms === null || ms === undefined) return "—";
  if (ms < 0) return "0 сек";
  if (ms < 60_000) {
    return `${Math.floor(ms / 1000)} сек`;
  }
  if (ms < 3_600_000) {
    const mins = Math.floor(ms / 60_000);
    const secs = Math.floor((ms % 60_000) / 1000);
    return secs > 0 ? `${mins} мин ${secs} сек` : `${mins} мин`;
  }
  const hours = Math.floor(ms / 3_600_000);
  const mins = Math.floor((ms % 3_600_000) / 60_000);
  return mins > 0 ? `${hours} ч ${mins} мин` : `${hours} ч`;
}

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
    const fd = openSync(tmpFile, "w", 0o600);
    const child = spawn("opencode", ["export", sessionID], { stdio: ["ignore", fd, "pipe"] });
    let errTail = "";
    child.stderr.on("data", (d) => { errTail = (errTail + d).slice(-500); });
    const fail = (e) => {
      try { process.stderr.write(`[timeline] export failed: ${sessionID} — ${errTailOneLine(errTail)}\n`); } catch {}
      reject(e);
    };
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      try { child.kill("SIGKILL"); } catch {}
      try { closeSync(fd); } catch {}
      try { unlinkSync(tmpFile); } catch {}
      fail(new Error("child_export_timeout"));
    }, timeoutMs);
    child.on("error", (e) => { if (done) return; done = true; clearTimeout(timer); try { closeSync(fd); } catch {}; try { unlinkSync(tmpFile); } catch {}; fail(e); });
    child.on("exit", (code) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { closeSync(fd); } catch {}
      if (code !== 0) { try { unlinkSync(tmpFile); } catch {}; fail(new Error("export_failed")); return; }
      let raw;
      try { raw = readFileSync(tmpFile, "utf-8"); } catch (e) { try { unlinkSync(tmpFile); } catch {}; fail(e); return; }
      try { unlinkSync(tmpFile); } catch {}
      if (!raw || !raw.trim()) { fail(new Error("export_failed")); return; }
      try { resolve(JSON.parse(raw)); } catch { fail(new Error("invalid_export")); }
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
        const fd = openSync(tmpFile, "w", 0o600);
        const child = spawn("opencode", ["export", sessionID], {
          stdio: ["ignore", fd, "pipe"],
        });
        let errTail = "";
        child.stderr.on("data", (d) => { errTail = (errTail + d).slice(-500); });
        child.on("exit", (code) => {
          closeSync(fd);
          if (code !== 0) {
            process.stderr.write(`[timeline] export failed: ${sessionID} — ${errTailOneLine(errTail)}\n`);
            reject(new Error("export failed"));
          } else {
            resolve();
          }
        });
        child.on("error", (e) => {
          process.stderr.write(`[timeline] export failed: ${sessionID} — ${errTailOneLine(errTail)}\n`);
          reject(e);
        });
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
  : (typeof info.model === "object" && info.model && info.model.providerID && (info.model.modelID || info.model.id)
    ? `${info.model.providerID}/${info.model.modelID || info.model.id}`
    : null);

function normalizeModel(infoModel) {
  if (!infoModel) return null;
  if (typeof infoModel === "string") return infoModel;
  if (typeof infoModel === "object" && infoModel && infoModel.providerID && (infoModel.modelID || infoModel.id)) {
    return `${infoModel.providerID}/${infoModel.modelID || infoModel.id}`;
  }
  return null;
}

// Диспатч субагента: V1 — tool "task", V2 — "subagent" (одно действие, разные имена).
const isTaskTool = (name) => name === "task" || name === "subagent";
// Shell-инструмент: V1 — "bash", V2 — "shell"; оба идут в bash-агрегацию по первому слову команды.
const isBashTool = (name) => name === "bash" || name === "shell";

// Нормализатор сообщений экспорта (V1 и V2) → единая внутренняя форма:
//   { role: "user"|"assistant", ts: number|null, parts, tokens, cost } | null.
// V1 (старый CLI): { info: { role, time: { created }, tokens, cost }, parts: [...] } — чтение как раньше.
// V2 (новый CLI):  { type, time: { created }, content: [...], tokens, cost } — плоская структура.
// Неролевые/служебные сообщения (V1 без role; V2 idle/synthetic/system/compaction/…) → null (пропуск).
// Tool-часть в обеих ветках несёт единое поле time: V1-канон { start, end } (из state.time),
// V2 добавляет blockStart (dispatch-задержка created→ran уходит в инференс-остаток блока).
let v2Detected = false; // хотя бы одно V2-сообщение распознано → слияние info.time в границы сессии
function normalizeMessage(m) {
  if (!m || typeof m !== "object") return null;
  // --- V1 ---
  if (m.info && typeof m.info === "object") {
    const role = m.info.role;
    if (role !== "user" && role !== "assistant") return null;
    const ts = m.info.time && typeof m.info.time.created === "number" ? m.info.time.created : null;
    const parts = (Array.isArray(m.parts) ? m.parts : []).map(p => {
      if (!p || typeof p !== "object" || p.type !== "tool") return p;
      // Тайминги V1 лежат в state.time — переносим в единое поле time (blockStart нет: span от start)
      const t = p.state && typeof p.state === "object" && p.state.time && typeof p.state.time === "object" ? p.state.time : {};
      return { ...p, time: { start: t.start, end: t.end } };
    });
    return { role, ts, parts, tokens: m.info.tokens, cost: m.info.cost };
  }
  // --- V2 ---
  if (m.type === "user" || m.type === "assistant") {
    const ts = m.time && typeof m.time.created === "number" ? m.time.created : null;
    const parts = [];
    for (const c of (Array.isArray(m.content) ? m.content : [])) {
      if (!c || typeof c !== "object" || c.type !== "tool") continue;
      const st = c.state && typeof c.state === "object" ? c.state : undefined;
      if (st) {
        // V2-ключи → V1-канон (??= — существующие ключи не затираем):
        // agent → subagent_type, sessionID → sessionId, description → title (диспатчи task/subagent).
        if (st.input && typeof st.input === "object") st.input.subagent_type ??= st.input.agent;
        if (st.metadata && typeof st.metadata === "object") st.metadata.sessionId ??= st.metadata.sessionID;
        if (isTaskTool(c.name) && st.input && typeof st.input === "object") st.title ??= st.input.description;
      }
      // Тайминги V2 — на самом content-item (c.time), не в state:
      // start = ran (исполнение; без ran — весь спан от created), end = completed, blockStart = created.
      const ct = c.time && typeof c.time === "object" ? c.time : {};
      parts.push({ type: "tool", tool: c.name, state: st, time: { start: ct.ran ?? ct.created, end: ct.completed, blockStart: ct.created } });
    }
    v2Detected = true;
    return { role: m.type, ts, parts, tokens: m.tokens, cost: m.cost };
  }
  return null;
}

// Нормализованные сообщения (V1/V2 → единая форма); три прохода агрегации ниже читают только их.
const norm = messages.map(normalizeMessage);

// Границы сессии: raw-метки всех сообщений (V1 — m.info.time.created, V2 — m.time.created;
// неречевые V2 idle/… в тоталы не попадают, но границы расширяют). Для V2-детектированного
// экспорта — слияние с info.time: created → старт (min), updated → конец (max).
const allTs = messages.map(m => {
  if (!m || typeof m !== "object") return undefined;
  if (m.info && typeof m.info === "object") return m.info.time && m.info.time.created;
  return m.time && m.time.created;
}).filter(t => typeof t === "number");
const sessionMarks = [...allTs];
if (v2Detected && info.time && typeof info.time === "object") {
  if (typeof info.time.created === "number") sessionMarks.push(info.time.created);
  if (typeof info.time.updated === "number") sessionMarks.push(info.time.updated);
}
const sessionStart = sessionMarks.length ? Math.min(...sessionMarks) : null;
const sessionEnd = sessionMarks.length ? Math.max(...sessionMarks) : null;
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

for (const n of norm) {
  if (!n || n.ts === null) continue;
  const role = n.role;
  const ts = n.ts;

  const parts = n.parts;
  const toolParts = parts.filter(p => typeof p === "object" && p.type === "tool");

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

    const t = tp.time || {};
    const dur = (typeof t.start === "number" && typeof t.end === "number")
      ? (t.end - t.start) : null;

    if (dur !== null) {
      toolMs += dur;
      toolTimeMs += dur;
    }

    if (isTaskTool(toolName)) {
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
    if (isBashTool(toolName) && tp.state && tp.state.input && typeof tp.state.input.command === "string") {
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
        agent: isTaskTool(toolName)
          ? (tp.state && tp.state.input && tp.state.input.subagent_type) || null
          : null,
        cmd: isBashTool(toolName) ? bashCmdKey : null,
        durationMs: dur,
        start: typeof t.start === "number" ? t.start : null,
      });
    }
  }

  const complete = toolParts.filter(p => typeof p.time?.start === "number" && typeof p.time?.end === "number");
  if (complete.length) {
    // blockStart (V2: created) захватывает dispatch-задержку (created→ran) в инференс-остаток блока;
    // V1 blockStart нет → span от start (эквивалент старому чтению state.time).
    const earliestStart = Math.min(...complete.map(p => p.time.blockStart ?? p.time.start));
    const latestEnd = Math.max(...complete.map(p => p.time.end));
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

  timeline.push({ kind: "assistant", ts, nTools, toolMs, inferenceMs: infMs });
}

// --- metrics (primary-данные) ---
let mInput = 0, mOutput = 0, mReasoning = 0, mCacheRead = 0, mCacheWrite = 0;
let costSum = 0, costSeen = false;
let questionCount = 0;
let reviewDispatches = 0;
const reviewCycles = [];
const REVIEW_RE = /\breview\b|ревью/i;

for (const n of norm) {
  if (!n) continue;
  if (n.role === "assistant") {
    const t = n.tokens;
    if (t && typeof t === "object") {
      mInput += t.input || 0;
      mOutput += t.output || 0;
      mReasoning += t.reasoning || 0;
      mCacheRead += (t.cache && t.cache.read) || 0;
      mCacheWrite += (t.cache && t.cache.write) || 0;
    }
    if (typeof n.cost === "number" && n.cost > 0) { costSum += n.cost; costSeen = true; }
  }
  const parts = n.parts;
  for (const p of parts) {
    if (typeof p !== "object" || !p || p.type !== "tool") continue;
    if (p.tool === "question") questionCount++;
    if (isTaskTool(p.tool)) {
      const st = p.state;
      if (st && st.status === "completed" && typeof st.title === "string" && REVIEW_RE.test(st.title)) {
        reviewDispatches++;
        reviewCycles.push({
          round: reviewDispatches,
          titleShort: st.title.slice(0, 80),
          sessionId: st.metadata && st.metadata.sessionId,
        });
      }
    }
  }
}

const machineActiveMs = toolTimeMs + inferenceMs;
const hitlWaitMs = idleWaitMs;
const userIdleMs = sessionDurationMs !== null && sessionDurationMs >= machineActiveMs + hitlWaitMs
  ? sessionDurationMs - (machineActiveMs + hitlWaitMs)
  : 0;

const round6 = (x) => Math.round(x * 1e6) / 1e6;
const COST_NOTE = "cost, рассчитанный opencode по provider.*.models.*.cost в конфиге opencode ($/1M токенов)";

const metrics = {
  tokens: {
    input: mInput, output: mOutput, reasoning: mReasoning,
    cacheRead: mCacheRead, cacheWrite: mCacheWrite,
    cost: costSeen ? costSum : null,
  },
  // всегда присутствует; пересчитывается после child-агрегации (primary + children)
  cost: {
    available: false,
    primaryUsd: costSeen ? round6(costSum) : null,
    byAgent: {},
    totalUsd: costSeen ? round6(costSum) : null,
    note: COST_NOTE,
  },
  activeMs: sessionDurationMs === null ? null : Math.max(0, sessionDurationMs - idleWaitMs),
  machineActiveMs: sessionDurationMs === null ? null : machineActiveMs,
  hitlWaitMs: sessionDurationMs === null ? null : hitlWaitMs,
  userIdleMs: sessionDurationMs === null ? null : userIdleMs,
  questionCount,
  reviewDispatches,
  children: noChildren ? "skipped" : "full",
  tokensByAgent: {},
  validation: sessionDurationMs === null
    ? null
    : {
        totalMs: sessionDurationMs,
        sum: machineActiveMs + hitlWaitMs,
        delta: Math.abs(sessionDurationMs - (machineActiveMs + hitlWaitMs)),
      },
  reviewCycles,
};

if (!noChildren) {
  // --- metrics.tokensByAgent (child-экспорт) ---
  const agentBuckets = {};
  const uniqueChildren = new Map(); // sessionId -> agent (первое вхождение)
  for (const n of norm) {
    if (!n) continue;
    for (const p of n.parts) {
      if (typeof p !== "object" || !p || p.type !== "tool" || !isTaskTool(p.tool)) continue;
      const st = p.state;
      if (!st || st.status !== "completed") continue;
      const sid = st.metadata && st.metadata.sessionId;
      if (!sid || typeof sid !== "string") continue;
      const agent = (st.input && st.input.subagent_type) || "unknown";
      if (!agentBuckets[agent]) agentBuckets[agent] = { count: 0, input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, skipped: 0, failed: 0, models: [], cost: 0, costSeen: false };
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
          const cc = data && data.info && data.info.cost;
          if (typeof cc === "number" && Number.isFinite(cc) && cc > 0) { b.cost += cc; b.costSeen = true; }
          // Extract and normalize child session model
          const childModel = normalizeModel(data && data.info && data.info.model);
          if (childModel && !b.models.includes(childModel)) {
            b.models.push(childModel);
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

}

// --- metrics.cost — пересчёт после child-агрегации (выполняется всегда: --no-children → byAgent пуст, primary учитывается) ---
const byAgentCost = {};
let agentCostSum = 0;
for (const [agent, b] of Object.entries(metrics.tokensByAgent || {})) {
  if (b.costSeen) { byAgentCost[agent] = round6(b.cost); agentCostSum += b.cost; }
}
const primaryCost = costSeen ? costSum : null;
const hasCost = primaryCost !== null || agentCostSum > 0;
metrics.cost = {
  available: hasCost,
  primaryUsd: primaryCost === null ? null : round6(primaryCost),
  byAgent: byAgentCost,
  totalUsd: hasCost ? round6((primaryCost || 0) + agentCostSum) : null,
  note: COST_NOTE,
};

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
    machineActiveMs,
    hitlWaitMs,
    userIdleMs,
    validation: metrics.validation,
    sessionModel: sessionModel,
    agentsModels: Object.fromEntries(
      Object.entries(metrics.tokensByAgent || {}).map(([k, v]) => [k, v.models || []])
    ),
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
