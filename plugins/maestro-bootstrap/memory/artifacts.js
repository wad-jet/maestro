import fs from "node:fs";
import path from "node:path";
import { confGlobMatch, filePathOf } from "../core.js";

// Максимальное число извлекаемых артефактов за вызов (контракт §4.2).
const MAX_ARTIFACTS = 8;

// CR-2: патологические пути — control chars (C0 + DEL) в любом сегменте.
const CONTROL_CHARS_RE = /[\u0000-\u001f\u007f]/;

// CR-2: предельная длина пути (символов). Проверяется и на raw-пути, и на
// repo-relative результате (глубокие деревья дают длинный relative).
const MAX_PATH_LENGTH = 512;

/**
 * Извлечение артефактов (путей записанных файлов) из сессии.
 *
 * Контракт §4.2: только `write`/`edit`-части со `status: "completed"` (M2),
 * `read` исключён (D3). Пути нормализуются через realpath (root и каждый путь
 * по отдельности), приводятся к repo-relative и фильтруются:
 *  - вне root / `..`-сегмент → skip;
 *  - glob-miss по `globs` → skip (confGlobMatch, case-insensitive);
 *  - confidential-матч по `confidentialPatterns` → skip (Z4);
 *  - CR-2: длина > 512 / control chars → skip;
 *  - dedup first-seen, cap 8.
 *
 * Invariants: без LLM; throw не покидает функцию (любой сбой → `[]`).
 *
 * @param {Array<{parts: Array<object>}>} messages  Сообщения сессии.
 * @param {object} opts
 * @param {string} opts.root                 Project root (absolute).
 * @param {string[]} opts.globs              Artifact globs (пусто → `[]`).
 * @param {string[]} [opts.confidentialPatterns]  Resolved confidential globs.
 * @returns {string[]}  Repo-relative пути (posix-разделители), ≤ 8.
 */
export function extractArtifacts(messages, { root, globs, confidentialPatterns } = {}) {
  try {
    if (!Array.isArray(globs) || globs.length === 0) return [];
    if (typeof root !== "string" || !root) return [];

    const rootReal = fs.realpathSync(root);

    const lowerGlobs = globs
      .filter((g) => typeof g === "string" && g)
      .map((g) => g.toLowerCase());
    if (lowerGlobs.length === 0) return [];

    const lowerConf = (confidentialPatterns ?? [])
      .filter((p) => typeof p === "string" && p)
      .map((p) => p.toLowerCase());

    const seen = new Set();
    const out = [];

    for (const msg of messages ?? []) {
      for (const part of msg?.parts ?? []) {
        if (out.length >= MAX_ARTIFACTS) return out;
        if (part?.type !== "tool") continue;
        if (part.tool !== "write" && part.tool !== "edit") continue;
        if (part.state?.status !== "completed") continue;

        const raw = filePathOf(part.tool, part.state?.input);
        if (typeof raw !== "string" || !raw) continue;

        // CR-2: патологический raw-путь — отсекаем до realpath.
        if (raw.length > MAX_PATH_LENGTH || CONTROL_CHARS_RE.test(raw)) continue;
        // `..`-сегмент в raw-пути → skip (defensive; realpath бы его резолвил).
        if (raw.split(/[\\/]+/).includes("..")) continue;

        const abs = path.isAbsolute(raw) ? raw : path.resolve(root, raw);

        let pathReal;
        try {
          pathReal = fs.realpathSync(abs);
        } catch {
          continue; // ENOENT и прочие сбои → skip пути (I1), остальные извлекаются.
        }

        const rel = path.relative(rootReal, pathReal);
        // Вне root (или другой диск) → skip.
        if (rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) continue;

        const relPosix = rel.split(path.sep).join("/");
        // CR-2: патологический relative-путь.
        if (relPosix.length > MAX_PATH_LENGTH || CONTROL_CHARS_RE.test(relPosix)) continue;

        const lowerRel = relPosix.toLowerCase();
        // Glob-miss → skip.
        if (!lowerGlobs.some((g) => confGlobMatch(g, lowerRel))) continue;
        // Resolved confidential-матч → skip (Z4).
        if (lowerConf.some((p) => confGlobMatch(p, lowerRel))) continue;

        // Dedup first-seen.
        if (seen.has(relPosix)) continue;
        seen.add(relPosix);
        out.push(relPosix);
      }
    }
    return out;
  } catch {
    return [];
  }
}