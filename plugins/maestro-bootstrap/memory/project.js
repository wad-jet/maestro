import { createHash } from "node:crypto";
import { namespaceValid } from "./config.js";

export function canonicalizeRemote(rawUrl) {
  const s = String(rawUrl).trim();
  let host, path;
  if (s.includes("://")) {
    const url = new URL(s);
    host = url.hostname.toLowerCase();
    path = url.pathname.replace(/^\//, "").toLowerCase();
  } else if (s.includes(":")) {
    const idx = s.indexOf(":");
    host = s.slice(0, idx).split("@").pop().toLowerCase();
    path = s.slice(idx + 1).toLowerCase();
  } else {
    host = s.split("/")[0].toLowerCase();
    path = s.split("/").slice(1).join("/");
  }
  path = path.replace(/\.git$/, "").replace(/\/+$/, "");
  return `${host}/${path}`;
}

export function projectHashFromRemote(rawUrl) {
  return createHash("sha256").update(canonicalizeRemote(rawUrl)).digest("hex");
}

export function projectHashFromDir(absPath) {
  return createHash("sha256").update(absPath).digest("hex");
}

export function deriveProjectKey({ gitRemote, absPath }) {
  if (gitRemote) return { hash: projectHashFromRemote(gitRemote), source: "remote" };
  return { hash: projectHashFromDir(absPath), source: "dir" };
}

/**
 * Namespace-only resolver (spec §3.4): принимает только валидный namespace,
 * бросает на URL/scp/project_hash. Normalize → trim + lowercase.
 * @param {string} project
 * @returns {string} normalized namespace
 */
export function resolveProjectKey(project) {
  const s = String(project ?? "").trim().toLowerCase();
  if (!s) throw new Error(`project: невалидный namespace "${project}"`);
  if (/^[0-9a-f]{8,}$/i.test(s)) throw new Error(`project: невалидный namespace "${project}"`);
  if (!namespaceValid(s)) throw new Error(`project: невалидный namespace "${project}"`);
  return s;
}

/**
 * Legacy key resolver for migration (spec §3.6): URL/scp → hash, 64-hex → as-is,
 * namespace → passthrough. Used by migrate to convert old-format keys to
 * namespace-only form.
 *
 * Remote-детекция зеркалит canonicalizeRemote: remote — это строка с "://"
 * (URL) ИЛИ с ":" (scp-синтаксис, включая `gitlab.example.com:group/repo.git`
 * без user@). Namespace-формат (namespaceValid) никогда не содержит ":" —
 * поэтому `s.includes(":")` безопасно отличает scp-remote от namespace.
 * @param {string} v
 * @returns {string} resolved legacy key
 */
export function legacyKey(v) {
  const s = String(v).trim();
  if (s.includes("://") || s.includes(":")) return projectHashFromRemote(s);
  if (/^[0-9a-f]{64}$/i.test(s)) return s;
  return s;
}

/**
 * Все префиксы namespace-ключа (spec §3.3): для `a.b.c` → `["a","a.b"]`;
 * для односегментного ключа → `[]`. Используется при upsert (штамп prefixes)
 * и при migrateKey (пересчёт от нового ключа).
 * @param {string} key
 * @returns {string[]}
 */
export function prefixesOf(key) {
  const parts = String(key ?? "").split(".").filter(Boolean);
  const out = [];
  for (let i = 1; i < parts.length; i++) out.push(parts.slice(0, i).join("."));
  return out;
}

/**
 * Build the key-set for a search. Own namespace always included; `related` and
 * `project` add namespace-only targets (own excluded). Deduped, normalized.
 * `key` required — missing key throws (guard preserved).
 * @param {{ key: string, related?: string[], project?: string }} opts
 * @returns {string[]}
 */
export function resolveSearchKeys({ key, project, related }) {
  if (typeof key !== "string" || !key) throw new Error("search: key required");
  const keys = [key.trim().toLowerCase()];
  for (const r of related ?? []) {
    const rr = resolveProjectKey(r);
    if (rr !== keys[0]) keys.push(rr);
  }
  if (project !== undefined && project !== null && project !== "") {
    const p = resolveProjectKey(project);
    if (p !== keys[0]) keys.push(p);
  }
  return [...new Set(keys.filter((k) => typeof k === "string" && k.length > 0))];
}
