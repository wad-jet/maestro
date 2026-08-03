/**
 * Maestro Bootstrap Plugin for OpenCode.ai
 *
 * Injects a bootstrap directive into maestro sessions via
 * experimental.chat.messages.transform — guarantees the skill `maestro`
 * is loaded and the pipeline is followed, without depending on the model
 * spontaneously calling the skill tool.
 *
 * Scope: only sessions where the active agent is `maestro`.
 * Safety: marker-based anti-duplicate injection + try/catch degradation.
 *
 * Logging: JSONL to `<project>/.maestro/maestro-bootstrap-<date>.log`
 * (gitignored), one file per day for future rotation. Levels: debug / info / warn / error.
 * Config via env:
 *   MAESTRO_BOOTSTRAP_LOG_LEVEL  (default: debug)
 *   MAESTRO_BOOTSTRAP_LOG_DIR    (default: <directory>/.maestro)
 */

import fs from "node:fs";
import path from "node:path";

const MARKER = "FMAESTRO_BOOTSTRAP_V1";
const LOG_LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

const BOOTSTRAP = `<!-- FMAESTRO_BOOTSTRAP_V1 -->
Ты — Maestro.

Шаг 1: загрузи skill \`maestro\` (tool: skill) и следуй pipeline из SKILL.md.

Правила:
- HITL-гейты строго (шаги 1.5 / 2 / 7 / 10 / 12 / 17)
- Все сообщения пользователю — только на русском
- Один коммит \`docs: design + plan for <feature>\` после шага 12
- Не импровизируй: если задача — фича/багфикс из спринта, используй pipeline

Команды: @maestro (вход), @regression (реестр), @test-* (диагностика)`;

function makeLogger(directory) {
  const logDir =
    process.env.MAESTRO_BOOTSTRAP_LOG_DIR || path.join(directory, ".maestro");
  const threshold = LOG_LEVELS[process.env.MAESTRO_BOOTSTRAP_LOG_LEVEL || "debug"] ?? 10;

  try {
    fs.mkdirSync(logDir, { recursive: true });
  } catch {
    /* logging must never break the session */
  }

  const logFileFor = (date) =>
    path.join(logDir, `maestro-bootstrap-${date}.log`);

  const write = (level, msg, extra) => {
    if (LOG_LEVELS[level] < threshold) return;
    const now = new Date();
    const date = now.toISOString().slice(0, 10);
    const entry = JSON.stringify({
      ts: now.toISOString(),
      level,
      msg,
      ...extra,
    });
    try {
      fs.appendFileSync(logFileFor(date), entry + "\n");
    } catch {
      /* logging must never break the session */
    }
  };

  return {
    logDir,
    debug: (msg, extra) => write("debug", msg, extra),
    info: (msg, extra) => write("info", msg, extra),
    warn: (msg, extra) => write("warn", msg, extra),
    error: (msg, extra) => write("error", msg, extra),
  };
}

function sessionIDOf(output) {
  for (const m of output?.messages ?? []) {
    if (m?.info?.sessionID) return m.info.sessionID;
  }
  return undefined;
}

export const MaestroBootstrapPlugin = async ({ directory }) => {
  const root = directory || process.cwd();
  const log = makeLogger(root);
  log.info("plugin initialized", {
    agent: "maestro",
    logDir: log.logDir,
    level: process.env.MAESTRO_BOOTSTRAP_LOG_LEVEL || "debug",
  });

  // sessionID -> agent (для фильтрации tool-логов по агенту)
  const agentBySession = new Map();
  // callID -> timestamp (для подсчёта длительности тула)
  const toolCalls = new Map();
  // Ключевые тулы pipeline: загрузка скилла, диспатч субагентов, bash (тесты/сборка/линт/коммиты)
  const KEY_TOOLS = new Set(["skill", "task", "bash"]);

  return {
    "chat.params": async (input) => {
      try {
        if (input?.sessionID && input?.agent) {
          agentBySession.set(input.sessionID, input.agent);
        }
      } catch (err) {
        log.error("chat.params: error", {
          sessionID: input?.sessionID,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },

    event: async ({ event }) => {
      try {
        const { type, properties } = event ?? {};
        const sessionID = properties?.sessionID;
        if (agentBySession.get(sessionID) !== "maestro") return;
        if (type === "session.error") {
          log.warn("session.error", {
            sessionID,
            errorType: properties?.error?.type,
            errorMessage: properties?.error?.message,
          });
        } else if (type === "session.status" && properties?.status?.type === "retry") {
          log.warn("session.status.retry", {
            sessionID,
            attempt: properties.status.attempt,
            message: properties.status.message,
          });
        }
      } catch (err) {
        log.error("event: error", {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },

    "tool.execute.before": async (input, output) => {
      try {
        if (agentBySession.get(input?.sessionID) !== "maestro") return;
        toolCalls.set(input.callID, Date.now());
        const isKey = KEY_TOOLS.has(input.tool);
        const extra = {
          sessionID: input.sessionID,
          callID: input.callID,
          tool: input.tool,
        };
        if (input.tool === "bash") {
          extra.command = output?.args?.command;
        }
        log[isKey ? "info" : "debug"]("tool.execute.before", extra);
      } catch (err) {
        log.error("tool.execute.before: error", {
          sessionID: input?.sessionID,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },

    "tool.execute.after": async (input, output) => {
      try {
        if (agentBySession.get(input?.sessionID) !== "maestro") return;
        const startedAt = toolCalls.get(input.callID);
        const durationMs = startedAt ? Date.now() - startedAt : undefined;
        toolCalls.delete(input.callID);
        const isKey = KEY_TOOLS.has(input.tool);
        const extra = {
          sessionID: input.sessionID,
          callID: input.callID,
          tool: input.tool,
          durationMs,
        };
        if (input.tool === "bash") {
          extra.command = input.args?.command;
        }
        if (output?.title) extra.title = output.title;
        const isEmptySubagentResult =
          input.tool === "task" &&
          (!output?.title || !output?.output) &&
          (!output?.metadata || Object.keys(output.metadata).length === 0);
        if (isEmptySubagentResult) {
          log.warn("tool.execute.after.empty_result", {
            sessionID: input.sessionID,
            callID: input.callID,
            tool: input.tool,
          });
        }
        log[isKey ? "info" : "debug"]("tool.execute.after", extra);
      } catch (err) {
        log.error("tool.execute.after: error", {
          sessionID: input?.sessionID,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },

    "experimental.chat.messages.transform": async (_input, output) => {
      const sessionID = sessionIDOf(output);
      try {
        if (!output?.messages?.length) {
          log.debug("transform: no messages, skip", { sessionID });
          return;
        }
        const firstUser = output.messages.find((m) => m?.info?.role === "user");
        if (!firstUser || !firstUser.parts?.length) {
          log.debug("transform: no user message, skip", { sessionID });
          return;
        }
        const agent = firstUser.info.agent;
        if (agent === "maestro" && sessionID) {
          agentBySession.set(sessionID, agent);
        }
        if (agent !== "maestro") {
          log.debug("transform: agent mismatch, skip", { sessionID, agent });
          return;
        }
        const hasMarker = firstUser.parts.some(
          (p) => p?.type === "text" && p.text?.includes(MARKER),
        );
        if (hasMarker) {
          log.debug("transform: marker already present, skip", { sessionID, agent });
          return;
        }
        const ref = firstUser.parts[0];
        firstUser.parts.unshift({
          ...ref,
          type: "text",
          text: BOOTSTRAP,
        });
        log.info("transform: bootstrap injected", { sessionID, agent, marker: MARKER });
      } catch (err) {
        log.error("transform: error", {
          sessionID,
          error: err instanceof Error ? err.message : String(err),
        });
        console.warn("[maestro-bootstrap]", err);
      }
    },
  };
};
