import { spawnSync } from "node:child_process";

/**
 * Единая точка запуска git-команд. Все функции модуля идут через неё.
 * Ошибка spawn (git не установлен / cwd не существует) → throw; caller сам
 * решает, как fail-soft'ить. В quiet-режиме stderr подавляется.
 * @param {string} root — cwd для git
 * @param {string[]} args — аргументы git
 * @param {{ quiet?: boolean }} [opts]
 * @returns {import("node:child_process").SpawnSyncReturns<string>}
 */
export function runGit(root, args, { quiet = false } = {}) {
  const r = spawnSync("git", args, { cwd: root, encoding: "utf8", timeout: 10_000 });
  if (r.error) throw r.error;
  if (quiet && r.stderr) r.stderr = "";
  return r;
}

/**
 * Текущая ветка (`git branch --show-current`). Detached HEAD / ошибка → "".
 * @param {string} root
 * @returns {string}
 */
export function resolveBranch(root) {
  try {
    const out = runGit(root, ["branch", "--show-current"], { quiet: true }).stdout.trim();
    return out; // detached → ""
  } catch { return ""; }
}

/**
 * Текущий HEAD (`git rev-parse HEAD`). Не 40-hex / ошибка → "".
 * @param {string} root
 * @returns {string}
 */
export function resolveHead(root) {
  try {
    const out = runGit(root, ["rev-parse", "HEAD"], { quiet: true }).stdout.trim();
    return /^[0-9a-f]{40}$/.test(out) ? out : "";
  } catch { return ""; }
}

/**
 * Локальное существование ветки: `git rev-parse --verify refs/heads/<name>^{commit}`.
 * @param {string} root
 * @param {string} name
 * @returns {boolean}
 */
export function verifyBranch(root, name) {
  if (!name) return false;
  try {
    const r = runGit(root, ["rev-parse", "--verify", `refs/heads/${name}^{commit}`], { quiet: true });
    return r.status === 0;
  } catch { return false; }
}

/** Резервная цепочка имён mainline (шаг 4 детекта). */
const RESERVE = ["main", "master", "develop"];

/**
 * Детект mainline-ветки (spec §8). Цепочка, каждый шаг — только после
 * verifyBranch (локальное существование):
 *   1. override (конфиг `memory.mainline`) — авторитетен; несуществующее имя
 *      → null сразу (без fallthrough в авто-детект);
 *   2. `git symbolic-ref refs/remotes/origin/HEAD` → срез префикса
 *      `refs/remotes/origin/` → bare имя → verifyBranch; провал → шаг 3;
 *   3. `git config --get init.defaultBranch` → verifyBranch; провал → шаг 4;
 *   4. резерв main → master → develop (каждая через verifyBranch).
 * null = mainline_unresolved (branch-context off + warn на init).
 * @param {string} root
 * @param {{ override?: string | null }} [opts]
 * @returns {{ name: string } | null}
 */
export function detectMainline(root, { override = null } = {}) {
  // Шаг 1: override (конфиг `memory.mainline`) — авторитетен. Несуществующее
  // имя → null сразу (mainline_unresolved), БЕЗ fallthrough в авто-детект.
  if (override) return verifyBranch(root, override) ? { name: override } : null;
  const steps = [];
  steps.push(() => {
    try {
      const out = runGit(root, ["symbolic-ref", "refs/remotes/origin/HEAD"], { quiet: true }).stdout.trim();
      if (!out.startsWith("refs/remotes/origin/")) return null;
      const name = out.slice("refs/remotes/origin/".length);
      return verifyBranch(root, name) ? { name } : null;
    } catch { return null; }
  });
  steps.push(() => {
    try {
      const name = runGit(root, ["config", "--get", "init.defaultBranch"], { quiet: true }).stdout.trim();
      return name && verifyBranch(root, name) ? { name } : null;
    } catch { return null; }
  });
  steps.push(() => {
    for (const name of RESERVE) if (verifyBranch(root, name)) return { name };
    return null;
  });
  for (const step of steps) { const r = step(); if (r) return r; }
  return null;
}

/**
 * Множество sha истории рефа (`git rev-list <ref>`). Fail-soft: ошибка → null.
 * @param {string} root
 * @param {string} ref
 * @returns {Set<string> | null}
 */
export function revList(root, ref) {
  try {
    const r = runGit(root, ["rev-list", ref], { quiet: true });
    if (r.status !== 0) return null;
    return new Set(r.stdout.trim() ? r.stdout.trim().split("\n") : []);
  } catch { return null; }
}

/**
 * Предикат «head достижим из mainline» (`git merge-base --is-ancestor`).
 * exit 0 → "yes", 1 → "no", >1 или spawn-ошибка → "error" (dangling/invalid).
 * @param {string} root
 * @param {string} head
 * @param {string} mainline
 * @returns {"yes" | "no" | "error"}
 */
export function isAncestor(root, head, mainline) {
  try {
    const r = runGit(root, ["merge-base", "--is-ancestor", head, mainline], { quiet: true });
    if (r.status === 0) return "yes";
    if (r.status === 1) return "no";
    return "error";
  } catch { return "error"; }
}