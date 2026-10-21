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
 * @param {{ttlSec: number, headPin: boolean}} conf  Конфиг гварда (TTL в секундах, head-pin flag).
 * @param {{ execGit?: (args: string[]) => string }} [opts]  DI seam (для head-pin).
 * @returns {{allow: boolean, reason: string}}  Reasons: marker_ok | no_marker |
 *   marker_bad_json | marker_session_mismatch | marker_incomplete |
 *   marker_expired | marker_head_mismatch | guard_error.
 */
export function checkMergeMarker(root, sessionID, nowMs, conf, { execGit } = {}) {
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

    // Head-pin validation (v2 marker): если маркер содержит head и head_pin включен
    // HEAD обязан совпадать с маркером (detect post-approve mutation).
    // Маркер без поля head (v1) игнорируем head-pin (backward compat).
    if (conf.headPin && typeof data.head === "string") {
      let currentHead;
      try {
        currentHead = (typeof execGit === "function" ? execGit : defaultExecGit)(
          ["-C", root, "rev-parse", "HEAD"]);
      } catch {
        return { allow: false, reason: "guard_error" };
      }
      if (currentHead.trim() !== data.head.trim()) {
        return { allow: false, reason: "marker_head_mismatch" };
      }
    }

    return { allow: true, reason: "marker_ok" };
  } catch {
    return { allow: false, reason: "guard_error" };
  }
}

/**
 * Извлечение конфига merge guard из распарсенного `maestro.json`.
 * `merge_guard.enabled` — boolean (default true); `ttlSec` — число > 0
 * (default 600); `commit_guard` (R4) — "warn" | "deny" | "off" (default
 * "warn"); `branch_base_guard` — "warn" | "deny" | "off" (default "warn");
 * `head_pin` — boolean (default false). Не-валидные значения → дефолт (soft-fallback).
 * @param {object} [maestroConf]  Распарсенный `maestro.json`.
 * @returns {{enabled: boolean, ttlSec: number, commitGuard: string, branchBaseGuard: string, headPin: boolean}}
 */
export function resolveMergeGuardConf(maestroConf) {
  const section = maestroConf?.merge_guard;
  const sec = section && typeof section === "object" ? section : {};
  const commitGuard = typeof sec.commit_guard === "string"
    && ["warn", "deny", "off"].includes(sec.commit_guard) ? sec.commit_guard : "warn";
  const branchBaseGuard = typeof sec.branch_base_guard === "string"
    && ["warn", "deny", "off"].includes(sec.branch_base_guard) ? sec.branch_base_guard : "warn";
  const headPin = typeof sec.head_pin === "boolean" ? sec.head_pin : false;
  return {
    enabled: typeof sec.enabled === "boolean" ? sec.enabled : true,
    ttlSec: typeof sec.ttlSec === "number" && sec.ttlSec > 0 ? sec.ttlSec : 600,
    commitGuard,
    branchBaseGuard,
    headPin,
  };
}


/**
 * Извлечение последнего сегмента составной bash-команды (`&&`, `||`, `;`, `|`):
 * `git checkout main && git checkout -b fix/x` → `git checkout -b fix/x`.
 * Гварды оценивают фактическое итоговое действие, а не подстроку из
 * произвольного сегмента (ремедиация инцидента: «сначала на main, потом
 * ветку» не должна ложно срабатывать).
 * @param {string} command  Bash-команда.
 * @returns {string}
 */
export function lastCommandSegment(command) {
  if (typeof command !== "string" || !command.trim()) return "";
  const segments = command.split(/\s*(?:&&|\|\||;|\|)\s*/);
  return segments[segments.length - 1] ?? "";
}

/**
 * Детект команд, требующих branch-base guard:
 * - `git checkout -b <branch>` (без --orphan/-t)
 * - `git worktree add -b <branch> <dir>`
 * Возвращает `{ kind: "checkout-b"|"worktree-add-b" }` или null.
 * @param {string} command  Bash-команда.
 * @returns {{ kind: "checkout-b"|"worktree-add-b" }|null}
 */
export function detectCheckoutCommand(command) {
  if (typeof command !== "string" || !command.trim()) return null;
  // Segment-aware: оцениваем последний сегмент составной команды
  // (`git checkout main && git checkout -b fix/x` → детект по второму сегменту).
  const cmd = lastCommandSegment(command);
  if (!cmd.trim()) return null;
  const first = cmd.trimStart().split(/\s+/)[0];
  if (first === "echo") return null;
  // git checkout -b <branch> [--orphan] [--track] [<base>]
  const checkoutMatch = cmd.match(/git\s+checkout\s+-b\s+(\S+)/);
  if (checkoutMatch) {
    // Has --orphan → skip (not creating from HEAD)
    if (/\s--orphan\b/.test(cmd)) return null;
    return { kind: "checkout-b" };
  }
  // git worktree add -b <branch> <dir> [<base>]
  const worktreeMatch = cmd.match(/git\s+worktree\s+add\s+-b\s+(\S+)/);
  if (worktreeMatch) return { kind: "worktree-add-b" };
  return null;
}

/**
 * Проверка branch-base guard.
 * 1. Текущая ветка == mainline (main/master/develop)?
 * 2. Если нет → есть ли явный base-аргумент в команде?
 * 3. Нет base + не mainline → warn/deny.
 * @param {string} command  Bash-команда (из detectCheckoutCommand).
 * @param {"checkout-b"|"worktree-add-b"} detectedKind  Тип команды.
 * @param {string} root  Корень проекта.
 * @param {string} workdir  Working directory для git-вызова.
 * @param {{ branchBaseGuard: string, ttlSec: number }} conf  Конфиг гварда.
 * @param {{ execGit?: (args: string[]) => string }} [opts]  DI seam.
 * @returns {{ allow: boolean, reason: string }}
 */
export function checkBranchBaseGuard(command, detectedKind, root, workdir, conf, { execGit } = {}) {
  // Segment-aware: base-детекция по последнему сегменту составной команды
  const cmd = lastCommandSegment(command);
  // Составная команда с переключением на mainline перед созданием ветки
  // (`git checkout main && git checkout -b fix/x`) — эквивалент явного base
  // (ремедиационный паттерн инцидента; сегменты до последнего).
  const segments = command.split(/\s*(?:&&|\|\||;|\|)\s*/);
  const hasMainlineSwitch = segments.slice(0, -1).some((s) =>
    /^git\s+(?:checkout|switch)\s+(?:main|master|develop)\b/.test(s.trim()));
  // Проверяем наличие явного base-аргумента в команде
  const hasExplicitBase = detectedKind === "checkout-b"
    // git checkout -b <branch> <base> — base в конце команды (2+ слов после -b <branch>)
    ? /\s+-b\s+\S+\s+\S+\s*$/.test(cmd) && !/--orphan/.test(cmd)
    : detectedKind === "worktree-add-b"
      // git worktree add -b <branch> <dir> [<base>] — с base = 7+ токенов, без base = 6
      ? cmd.trim().split(/\s+/).length >= 7
      : false;

  // Определяем текущую ветку
  let branch;
  try {
    branch = (typeof execGit === "function" ? execGit : defaultExecGit)(
      ["-C", workdir, "branch", "--show-current"]);
  } catch {
    return conf.branchBaseGuard === "deny"
      ? { allow: false, reason: "guard_error" }
      : { allow: true, reason: "guard_error" };
  }
  const b = typeof branch === "string" ? branch.trim() : "";

  // Если текущая ветка — mainline → разрешаем (guard не нужен)
  const mainlines = ["main", "master", "develop"];
  if (mainlines.includes(b)) return { allow: true, reason: "mainline_base" };

  // Если указан явный base (аргументом или pre-switch на mainline) → разрешаем
  if (hasExplicitBase || hasMainlineSwitch) return { allow: true, reason: "explicit_base" };

  // Нет base на не-mainline ветке → warn или deny
  if (conf.branchBaseGuard === "deny") {
    return { allow: false, reason: "branch_base_violation" };
  }
  return { allow: true, reason: "branch_base_warning" };
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
