#!/usr/bin/env node
// Детерминированный дифф benchmark-отчётов (0 LLM).
// Использование: node diff.mjs <new.json> <old.json> [--md]
import { readFileSync } from "node:fs";

const TOKEN_KEYS = ["input", "output", "reasoning", "cacheRead", "cacheWrite"];
const RESOURCE_KEYS = ["activeMs", "hitl", "reviewCycles", "durationMs"];
const PROCESS_KEYS = ["spec", "plan", "specReview", "finalReview", "tests",
  "docsSynced", "regressionEntry", "merged", "invariantsOk"];
// Ранги: выше = лучше (для ранжированных значений).
const RANK = {
  approve: 2, "revise-approve": 1, skipped: 0,
  green: 2, unavailable: 1, red: 0,
  pass: 2, fail: 0,
};

function canon(v) {
  return JSON.stringify(v, (_k, v2) =>
    v2 && typeof v2 === "object" && !Array.isArray(v2)
      ? Object.keys(v2).sort().reduce((a, k) => ((a[k] = v2[k]), a), {})
      : v2);
}

function load(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    console.error(`diff: невозможно прочитать/парсить ${path}: ${e.message}`);
    process.exit(1);
  }
}

function numDelta(oldV, newV) {
  const o = Number(oldV);
  const n = Number(newV);
  const okO = oldV !== null && oldV !== undefined && !Number.isNaN(o);
  const okN = newV !== null && newV !== undefined && !Number.isNaN(n);
  return {
    old: oldV ?? null,
    new: newV ?? null,
    abs: okO && okN ? n - o : null,
    rel: okO && okN && o !== 0 ? (n - o) / Math.abs(o) : null,
  };
}

function flagDelta(oldV, newV) {
  if (oldV === newV) return "same";
  if (typeof oldV === "boolean" || typeof newV === "boolean") {
    return newV === true ? "fix" : "regress";
  }
  const ro = RANK[oldV] ?? -1;
  const rn = RANK[newV] ?? -1;
  return rn > ro ? "fix" : "regress";
}

function renderMd(out, neu, old) {
  const lines = [];
  lines.push(`## Сверка с прошлым прогоном (v${old.run?.version ?? "?"} → v${neu.run?.version ?? "?"})`);
  lines.push("");
  lines.push("| Метрика | old | new | Δ | Δ% |");
  lines.push("|---|---|---|---|---|");
  const row = (name, d) => {
    const rel = d.rel === null ? "—" : `${(d.rel * 100).toFixed(1)}%`;
    lines.push(`| ${name} | ${d.old ?? "—"} | ${d.new ?? "—"} | ${d.abs === null ? "—" : d.abs} | ${rel} |`);
  };
  for (const k of TOKEN_KEYS) row(`tokens.${k}`, out.metrics.tokens[k]);
  for (const k of RESOURCE_KEYS) row(k, out.metrics[k]);
  lines.push("");
  lines.push("| Флаг | old | new | Статус |");
  lines.push("|---|---|---|---|");
  for (const [k, st] of Object.entries(out.flags)) {
    lines.push(`| ${k} | ${JSON.stringify(old.process?.[k] ?? old.security?.[k])} | ${JSON.stringify(neu.process?.[k] ?? neu.security?.[k])} | ${st} |`);
  }
  if (out.models_changed) {
    lines.push("");
    lines.push("> ⚠ Модели агентов изменились между прогонами — дельфы ресурсов ограниченно интерпретируемы (модель-конфаунд: атрибуция дельф версии некорректна).");
  }
  return lines.join("\n") + "\n";
}

const [newPath, oldPath, ...rest] = process.argv.slice(2);
if (!newPath || !oldPath) {
  console.error("usage: node diff.mjs <new.json> <old.json> [--md]");
  process.exit(2);
}
const md = rest.includes("--md");
const neu = load(newPath);
const old = load(oldPath);

const out = {
  new: { version: neu.run?.version, date: neu.run?.date, file: newPath },
  old: { version: old.run?.version, date: old.run?.date, file: oldPath },
  models_changed: canon(neu.run?.models ?? {}) !== canon(old.run?.models ?? {}),
  metrics: {
    tokens: Object.fromEntries(
      TOKEN_KEYS.map((k) => [k, numDelta(old.resources?.tokens?.[k], neu.resources?.tokens?.[k])]),
    ),
    ...Object.fromEntries(
      RESOURCE_KEYS.map((k) => [k, numDelta(old.resources?.[k], neu.resources?.[k])]),
    ),
  },
  flags: Object.fromEntries(
    PROCESS_KEYS.map((k) => [k, flagDelta(old.process?.[k], neu.process?.[k])]),
  ),
};
out.flags.leakStatus = flagDelta(old.security?.leakStatus, neu.security?.leakStatus);

if (md) {
  process.stdout.write(renderMd(out, neu, old));
} else {
  console.log(JSON.stringify(out, null, 2));
}
