/**
 * Merge guard (5.6.0): bash-уровневый блок `git merge` и push в mainline
 * (main/master) без явного HITL-аппрува гейта 17 (инвариант ⚑1: PR/мерж —
 * только человек). После явного (a) на гейте 17 оркестратор создаёт маркер
 * `<root>/.maestro/gates/merge-<sessionID>.json` (`{ sessionID, ts }`, TTL —
 * `merge_guard.ttlSec`). Чистые функции, без внешних зависимостей;
 * fail-closed: любая аномалия проверки → deny.
 */

import fs from "node:fs";
import path from "node:path";

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
 * JSON `{ sessionID, ts }` (ts — epoch ms). Fail-closed: любое исключение в
 * теле → `{ allow: false, reason: "guard_error" }`.
 * @param {string} root  Корень проекта.
 * @param {string} sessionID  sessionID текущей сессии.
 * @param {number} nowMs  Текущее время, ms (инъектируемо для тестов).
 * @param {{ttlSec: number}} conf  Конфиг гварда (TTL в секундах).
 * @returns {{allow: boolean, reason: string}}  Reasons: marker_ok | no_marker |
 *   marker_bad_json | marker_session_mismatch | marker_expired | guard_error.
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
    if (nowMs - data.ts > conf.ttlSec * 1000) return { allow: false, reason: "marker_expired" };
    return { allow: true, reason: "marker_ok" };
  } catch {
    return { allow: false, reason: "guard_error" };
  }
}

/**
 * Извлечение конфига merge guard из распарсенного `maestro.json`.
 * `merge_guard.enabled` — boolean (default true); `ttlSec` — число > 0
 * (default 600). Не-валидные значения → дефолт (soft-fallback).
 * @param {object} [maestroConf]  Распарсенный `maestro.json`.
 * @returns {{enabled: boolean, ttlSec: number}}
 */
export function resolveMergeGuardConf(maestroConf) {
  const section = maestroConf?.merge_guard;
  const sec = section && typeof section === "object" ? section : {};
  return {
    enabled: typeof sec.enabled === "boolean" ? sec.enabled : true,
    ttlSec: typeof sec.ttlSec === "number" && sec.ttlSec > 0 ? sec.ttlSec : 600,
  };
}
