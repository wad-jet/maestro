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

export function maskEntry(entry, { confidentialPatterns = [] } = {}) {
  const maskField = (s) => {
    if (typeof s !== "string") return s;
    const filtered = maskLines(s, { confidentialPatterns });
    return sanitize(filtered, {}).text;
  };
  return {
    ...entry,
    title: maskField(entry.title),
    summary: maskField(entry.summary),
    decisions: entry.decisions?.map(maskField) ?? [],
  };
}
