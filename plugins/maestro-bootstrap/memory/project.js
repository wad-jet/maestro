import { createHash } from "node:crypto";

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
 * Resolve a `project` search parameter to a storage key (spec §2.2 B2).
 * Semantics: namespace | git-remote/URL (canonicalize+hash) | project_hash.
 * @param {string} project
 * @returns {string} storage key — namespace as-is, URL/scp → sha256 hash,
 *   64-hex project_hash as-is.
 */
export function resolveProjectKey(project) {
  const s = String(project).trim();
  if (!s) throw new Error("search: project required");
  if (s.includes("://") || s.startsWith("git@")) return projectHashFromRemote(s);
  if (/^[0-9a-f]{64}$/i.test(s)) return s;
  return s; // namespace — used directly as key
}

/**
 * Build the key-set for a search. Single key by default; when `project` is
 * given (cross-project opt-in, centralized backends only) → [key, projectKey]
 * deduped. Key required when project absent.
 * @param {{ key?: string, project?: string }} opts
 * @returns {string[]}
 */
export function resolveSearchKeys({ key, project }) {
  if (project !== undefined && project !== null && project !== "") {
    const projectKey = resolveProjectKey(project);
    const keys = [key, projectKey].filter((k) => typeof k === "string" && k.length > 0);
    return [...new Set(keys)];
  }
  if (typeof key !== "string" || !key) throw new Error("search: key required");
  return [key];
}
