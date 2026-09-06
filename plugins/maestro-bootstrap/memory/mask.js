import { sanitize } from "../core.js";

function isConfidentialLine(line, patterns) {
  return patterns.some((p) => line.includes(p.replace("/**", "")));
}

export function maskTranscript(text, { confidentialPatterns = [] } = {}) {
  const lines = String(text)
    .split("\n")
    .map((l) => (isConfidentialLine(l, confidentialPatterns) ? "[confidential]" : l));
  return sanitize(lines.join("\n"), {}).text;
}

export function maskEntry(entry, { confidentialPatterns = [] } = {}) {
  const mask = (s) => (typeof s === "string" ? sanitize(s, {}).text : s);
  return {
    ...entry,
    title: mask(entry.title),
    summary: mask(entry.summary),
    decisions: entry.decisions?.map(mask) ?? [],
  };
}
