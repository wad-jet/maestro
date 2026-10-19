/**
 * Merge guard (5.6.0): bash-уровневый блок `git merge` и push в mainline
 * (main/master) без явного HITL-аппрува гейта 17 (инвариант ⚑1: PR/мерж —
 * только человек). После явного (a) на гейте 17 оркестратор создаёт маркер
 * `<root>/.maestro/gates/merge-<sessionID>.json` (`{ sessionID, ts, gate: 17,
 * decision: "a" }`, TTL — `merge_guard.ttlSec`). Чистые функции, без внешних
 * зависимостей; fail-closed: любая аномалия проверки → deny.
 *
 * Commit guard (R4): bash-level control for `git commit` in mainline (current
 * branch main/master OR effective-mainline — the command itself switches to
 * main/master). Modes `merge_guard.commit_guard`: "warn" (default: allow + log
 * + one-time context notice) | "deny" (fail-closed throw) | "off".
 * Marker schema: `{"sessionID","ts","gate":17,"decision":"a"}`.
 */

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

/**
 * Детекция guard-команды в bash-строке.
 * - merge: субстринг `git merge` (ловит multi-command
 *   `git checkout main && git merge --ff-only X`); исключение — команда
 *   начинается с `echo` (первое слово): это не реальный вызов.
 * - push-mainline: `git push` + mainline-ветка (main/master) в хвосте команды
 *   (`origin main`, `origin/main`, `HEAD:main`, `+main`, `+refs/heads/main`,
 *   `--set-upstream origin main`). Bare `git push` (без аргументов) НЕ
 *   детектится — задокументированное ограничение.
 * @param {string} command  Bash-команда.
 * @returns {{kind: "merge"|"push-mainline"}|null}
 */
export function detectGuardCommand(command) {
  if (typeof command !== "string" || !command.trim()) return null;
  const first = command.trimStart().split(/\s+/)[0];
  if (first === "echo") return null;
  if (/git\s+merge\b/.test(command)) return { kind: "merge" };
  const push = command.match(/git\s+push\b/);
  if (push) {
    const tail = command.slice(push.index + push[0].length);
    if (/(\b|\+|:)(main|master)\b/.test(tail)) return { kind: "push-mainline" };
  }
  return null;
}

/**
 * Проверка маркера HITL-аппрува на merge/push-mainline.
 * Путь маркера: `<root>/.maestro/gates/merge-<sessionID>.json`, содержимое —
 * JSON `{"sessionID","ts","gate":17,"decision":"a"}` (ts — epoch ms).
 * Fail-closed: любое исключение в теле → `{ allow: false, reason: "guard_error" }`.
 * @param {string} root  Корень проекта.
 * @param {string} sessionID  sessionID текущей сессии.
 * @param {number} nowMs  Текущее время, ms (инъектируемо для тестов).
 * @param {{ttlSec: number}} conf  Конфиг гварда (TTL в секундах).
 * @returns {{allow: boolean, reason: string}}  Reasons: marker_ok | no_marker |
 *   marker_bad_json | marker_session_mismatch | marker_incomplete |
 *   marker_expired | guard_error.
 */
export function checkMergeMarker(root, sessionID, nowMs, conf) {
  try {
    const markerPath = path.join(root, ".maestro", "gates", `merge-${sessionID}.json`);
    let raw;
    try {
      raw = fs.readFileSync(markerPath, "utf8");
    } catch (err) {
      if (err && err.code === "ENOENT") return { allow: false, reason: "no_marker" };
      throw err;
    }
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      return { allow: false, reason: "marker_bad_json" };
    }
    if (
      data === null || typeof data !== "object" ||
      typeof data.sessionID !== "string" || typeof data.ts !== "number"
    ) {
      return { allow: false, reason: "marker_bad_json" };
    }
    if (data.sessionID !== sessionID) return { allow: false, reason: "marker_session_mismatch" };
    // Gate-17 validation (R4): the marker must explicitly record gate 17
    // decision (a) — a bare `{ sessionID, ts }` marker is incomplete.
    if (data.gate !== 17 || data.decision !== "a") {
      return { allow: false, reason: "marker_incomplete" };
    }
    if (nowMs - data.ts > conf.ttlSec * 1000) return { allow: false, reason: "marker_expired" };
    return { allow: true, reason: "marker_ok" };
  } catch {
    return { allow: false, reason: "guard_error" };
  }
}

/**
 * Извлечение конфига merge guard из распарсенного `maestro.json`.
 * `merge_guard.enabled` — boolean (default true); `ttlSec` — число > 0
 * (default 600); `commit_guard` (R4) — "warn" | "deny" | "off" (default
 * "warn"). Не-валидные значения → дефолт (soft-fallback).
 * @param {object} [maestroConf]  Распарсенный `maestro.json`.
 * @returns {{enabled: boolean, ttlSec: number, commitGuard: string}}
 */
export function resolveMergeGuardConf(maestroConf) {
  const section = maestroConf?.merge_guard;
  const sec = section && typeof section === "object" ? section : {};
  const commitGuard = typeof sec.commit_guard === "string"
    && ["warn", "deny", "off"].includes(sec.commit_guard) ? sec.commit_guard : "warn";
  return {
    enabled: typeof sec.enabled === "boolean" ? sec.enabled : true,
    ttlSec: typeof sec.ttlSec === "number" && sec.ttlSec > 0 ? sec.ttlSec : 600,
    commitGuard,
  };
}

/**
 * Commit-guard detection (R4): `git commit` in a bash string.
 * - Does NOT match `git commit-graph` / `git commit-tree` (word boundary).
 * - Command starting with `echo` → false (not a real call).
 * @param {string} command  Bash command.
 * @returns {boolean}
 */
export function detectCommitCommand(command) {
  if (typeof command !== "string" || !command.trim()) return false;
  const first = command.trimStart().split(/\s+/)[0];
  if (first === "echo") return false;
  return /git\s+commit(\s|$)/.test(command);
}

/**
 * Effective-mainline heuristic (R4): the command itself switches to
 * main/master (substring convention, same as push-mainline detection).
 * Documented false positive: `git checkout main -- path` → true.
 * @param {string} command  Bash command.
 * @returns {boolean}
 */
export function hasMainlineSwitch(command) {
  if (typeof command !== "string") return false;
  return /git\s+(checkout|switch)\b[\s\S]*?\b(main|master)\b/.test(command);
}

function defaultExecGit(args) {
  return execFileSync("git", args, { timeout: 3000, encoding: "utf8" });
}

/**
 * Maps a `checkMergeMarker` result to a commit-guard result per mode:
 * "warn" → allow + reason kept (caller logs + notices); "deny" → pass-through
 * (fail-closed).
 * @param {{allow: boolean, reason: string}} res  Marker check result.
 * @param {"warn"|"deny"} mode  Commit-guard mode.
 * @returns {{allow: boolean, reason: string}}
 */
function toCommitGuardResult(res, mode) {
  return mode === "deny" ? res : { allow: true, reason: res.reason };
}

/**
 * Commit-guard check (R4): `git commit` in mainline without an explicit
 * gate-17 marker.
 * - `hasMainlineSwitch(command)` → effective branch = mainline (skip git call).
 * - Otherwise current branch via `git -C <workdir> branch --show-current`:
 *   empty → `branch_unknown` (allow, detached); main/master → `checkMergeMarker`;
 *   other → `not_mainline` (allow).
 * - Git anomaly (throw/timeout) → fail-closed in "deny" mode, allow + reason
 *   `guard_error` in "warn" mode.
 * - Mainline marker result: "deny" mode passes it through (fail-closed);
 *   "warn" mode returns `allow: true` with the reason kept for the caller
 *   (warn log + one-time notice).
 * @param {string} command  Bash command (must match detectCommitCommand).
 * @param {string} workdir  Working directory for the git call.
 * @param {string} root  Project root (marker location).
 * @param {string} sessionID  Current session ID.
 * @param {number} nowMs  Current time, ms (injectable for tests).
 * @param {{ttlSec: number}} conf  Guard config.
 * @param {"warn"|"deny"} mode  Commit-guard mode.
 * @param {{execGit?: (args: string[]) => string}} [opts]  DI seam for the git
 *   call (defaults to `execFileSync("git", …)`).
 * @returns {{allow: boolean, reason: string}}  Reasons: not_mainline |
 *   branch_unknown | guard_error | marker_ok | no_marker | marker_bad_json |
 *   marker_session_mismatch | marker_incomplete | marker_expired.
 */
export function checkCommitGuard(command, workdir, root, sessionID, nowMs, conf, mode, { execGit } = {}) {
  if (hasMainlineSwitch(command)) {
    // effective branch = mainline (e.g. `git checkout main && git commit`)
    return toCommitGuardResult(checkMergeMarker(root, sessionID, nowMs, conf), mode);
  }
  let branch;
  try {
    branch = (typeof execGit === "function" ? execGit : defaultExecGit)(
      ["-C", workdir, "branch", "--show-current"]);
  } catch {
    // Anomaly: fail-closed in deny mode, allow in warn mode.
    return mode === "deny"
      ? { allow: false, reason: "guard_error" }
      : { allow: true, reason: "guard_error" };
  }
  const b = typeof branch === "string" ? branch.trim() : "";
  if (b === "") return { allow: true, reason: "branch_unknown" };
  if (b === "main" || b === "master") {
    return toCommitGuardResult(checkMergeMarker(root, sessionID, nowMs, conf), mode);
  }
  return { allow: true, reason: "not_mainline" };
}
