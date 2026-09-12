import { sanitize, confGlobMatch } from "../core.js";

function extractPathToken(line) {
  const m = line.match(/^([^:\s]+)/);
  return m ? m[1] : null;
}

function isConfidentialLine(line, patterns) {
  const token = extractPathToken(line);
  if (!token) return false;
  return patterns.some((p) => confGlobMatch(p.toLowerCase(), token.toLowerCase()));
}

function maskLines(text, { confidentialPatterns = [] } = {}) {
  return String(text)
    .split("\n")
    .map((l) => (isConfidentialLine(l, confidentialPatterns) ? "[confidential]" : l))
    .join("\n");
}

export function maskTranscript(text, { confidentialPatterns = [] } = {}) {
  const filtered = maskLines(text, { confidentialPatterns });
  return filtered.trim() ? sanitize(filtered, {}).text : "";
}

export function maskEntry(entry, { confidentialPatterns = [], artifactConfidentialPatterns = null } = {}) {
  const maskField = (s) => {
    if (typeof s !== "string") return s;
    const filtered = maskLines(s, { confidentialPatterns });
    return sanitize(filtered, {}).text;
  };
  // Task 7 (v5.2, F2): artifacts фильтруются через confidential-паттерны тем же
  // матчером (confGlobMatch) — матчащие элементы DROP (замаскированный путь
  // бесполезен как указатель). Отдельный artifactConfidentialPatterns (resolved
  // набор: paths + builtin) — маскирование текста остаётся на raw-паттернах (I2).
  const artifactPatterns = artifactConfidentialPatterns ?? confidentialPatterns;
  const lowerConf = artifactPatterns
    .filter((p) => typeof p === "string" && p)
    .map((p) => p.toLowerCase());
  const artifacts = Array.isArray(entry.artifacts)
    ? entry.artifacts.filter((p) => typeof p === "string" && !lowerConf.some((pat) => confGlobMatch(pat, p.toLowerCase())))
    : (entry.artifacts ?? []);
  return {
    ...entry,
    title: maskField(entry.title),
    summary: maskField(entry.summary),
    decisions: entry.decisions?.map(maskField) ?? [],
    artifacts,
  };
}
