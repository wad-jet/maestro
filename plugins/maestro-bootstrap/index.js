/**
 * Maestro Bootstrap Plugin for OpenCode.ai
 *
 * Rôle (после ухода от агента `maestro`, 2026-08-18): глобальный, не привязан
 * к агенту. Скилл `maestro` вызывается через команду `@maestro` в любой
 * primary-сессии; инжекция директивы в сессии агента удалена.
 *
 * Оставшиеся функции:
 *  - Логирование ключевых событий: ошибки/повторы сессий, пустой результат
 *    субагента, вызовы `task` (диспатч субагентов) — для observability.
 *  - (Sanitizer / санитайзинг task-промптов добавляется отдельной задачей —
 *    Этап 2, см. SECURITY-REVIEW-PLAN.md.)
 *
 * Логирование: JSONL to `<project>/.maestro/maestro-bootstrap-<date>.log`
 * (gitignored), one file per day. Levels: debug / info / warn / error.
 * Config via env:
 *   MAESTRO_BOOTSTRAP_LOG_LEVEL  (default: info)
 *   MAESTRO_BOOTSTRAP_LOG_MASK   (default: derived from LOG_LEVEL)
 *   MAESTRO_BOOTSTRAP_LOG_DIR    (default: <directory>/.maestro)
 */

import fs from "node:fs";
import path from "node:path";

const LOG_LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

export function makeLogger(directory) {
  const logDir =
    process.env.MAESTRO_BOOTSTRAP_LOG_DIR || path.join(directory, ".maestro");
  const levelEnv = process.env.MAESTRO_BOOTSTRAP_LOG_LEVEL || "info";
  const threshold = LOG_LEVELS[levelEnv] ?? 10;
  // Явная маска — список уровней через запятую. Если не задана, выводится из
  // порога: все уровни >= LOG_LEVEL. Чтобы «и порог, и маска» давали единое
  // поведение, они применяются как пересечение.
  const maskEnv = process.env.MAESTRO_BOOTSTRAP_LOG_MASK;
  const enabled = new Set(
    maskEnv
      ? maskEnv.split(",").map((s) => s.trim()).filter(Boolean).filter((l) => l in LOG_LEVELS)
      : Object.keys(LOG_LEVELS).filter((l) => LOG_LEVELS[l] >= threshold),
  );

  try {
    fs.mkdirSync(logDir, { recursive: true });
  } catch {
    /* logging must never break the session */
  }

  const logFileFor = (date) =>
    path.join(logDir, `maestro-bootstrap-${date}.log`);

  const write = (level, msg, extra) => {
    if (!enabled.has(level)) return;
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
    level: levelEnv,
    mask: [...enabled].join(","),
    debug: (msg, extra) => write("debug", msg, extra),
    info: (msg, extra) => write("info", msg, extra),
    warn: (msg, extra) => write("warn", msg, extra),
    error: (msg, extra) => write("error", msg, extra),
  };
}

// Ограниченная карта: при переполнении вытесняет самую старую запись по
// порядку вставки — защита от неограниченного роста в долгоживущем процессе.
export function makeBoundedMap(max = 1024) {
  const m = new Map();
  return {
    get: (k) => m.get(k),
    set: (k, v) => {
      if (!m.has(k) && m.size >= max) {
        const oldest = m.keys().next().value;
        if (oldest !== undefined) m.delete(oldest);
      }
      return m.set(k, v);
    },
    delete: (k) => m.delete(k),
    size: () => m.size,
  };
}

export const MaestroBootstrapPlugin = async ({ directory }) => {
  const root = directory || process.cwd();
  const log = makeLogger(root);
  log.info("plugin initialized", {
    logDir: log.logDir,
    level: log.level,
    mask: log.mask,
  });

  // callID -> timestamp (для подсчёта длительности тула)
  const toolCalls = makeBoundedMap(2048);

  return {
    event: async ({ event }) => {
      try {
        const { type, properties } = event ?? {};
        const sessionID = properties?.sessionID;
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
        // Логируем только диспатч субагентов (task) — это ядро observability
        // после сокращения. Прочие тулы (bash/skill/read) не логируем детально.
        if (input.tool === "task") {
          toolCalls.set(input.callID, Date.now());
          log.info("tool.execute.before", {
            sessionID: input.sessionID,
            callID: input.callID,
            tool: input.tool,
          });
        }
      } catch (err) {
        log.error("tool.execute.before: error", {
          sessionID: input?.sessionID,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },

    "tool.execute.after": async (input, output) => {
      try {
        const startedAt = input.tool === "task" ? toolCalls.get(input.callID) : undefined;
        if (startedAt !== undefined) toolCalls.delete(input.callID);
        const extra = {
          sessionID: input.sessionID,
          callID: input.callID,
          tool: input.tool,
        };
        if (startedAt !== undefined) extra.durationMs = Date.now() - startedAt;
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
        if (startedAt !== undefined) {
          log.info("tool.execute.after", extra);
        }
      } catch (err) {
        log.error("tool.execute.after: error", {
          sessionID: input?.sessionID,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },
  };
};