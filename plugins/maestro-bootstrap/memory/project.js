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
