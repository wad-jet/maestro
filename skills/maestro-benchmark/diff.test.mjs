import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const DIFF = join(dirname(fileURLToPath(import.meta.url)), "diff.mjs");

let dir;
before(() => { dir = mkdtempSync(join(tmpdir(), "maestro-diff-")); });
after(() => rmSync(dir, { recursive: true, force: true }));

const base = (over = {}) => ({
  schema: 1,
  run: { date: "2026-09-25", ts: 0, mode: "auto-answer", task_id: "discount-module-v1",
         version: "4.12.0", git_head: "a".repeat(40), session_id: "s1",
         models: { haiku: "m/h", sonnet: "m/s" } },
  resources: {
    tokens: { input: 1000, output: 500, reasoning: 0, cacheRead: 100, cacheWrite: 20, cost: null },
    activeMs: 60000, hitl: 5, reviewCycles: 1, durationMs: 120000,
  },
  process: { spec: true, plan: true, specReview: "approve", finalReview: "approve",
             tests: "green", docsSynced: true, regressionEntry: true,
             merged: true, invariantsOk: true, deviations: [] },
  security: { leaks: 0, leakStatus: "pass", markerInSpec: true,
              sanitizerRedacted: 2, confidentialAccess: { allow: 1, deny: 0 } },
  analysis: { good: [], bad: [], summary: "" },
  ...over,
});

function write(name, obj) {
  const p = join(dir, name);
  writeFileSync(p, JSON.stringify(obj, null, 2));
  return p;
}

function diff(newP, oldP, ...args) {
  try {
    const out = execFileSync("node", [DIFF, newP, oldP, ...args], { encoding: "utf8" });
    return { code: 0, out };
  } catch (e) {
    return { code: e.status, out: String(e.stdout || "") + String(e.stderr || ""), err: e };
  }
}

const OLD = write("old.json", base());
const NEW = write("new.json", base({
  run: { ...base().run, version: "4.13.0", date: "2026-09-26" },
  resources: {
    ...base().resources,
    tokens: { ...base().resources.tokens, input: 2000 },
    activeMs: 30000, hitl: 3,
  },
}));

test("1. дельты метрик: abs/rel", () => {
  const { code, out } = diff(NEW, OLD);
  assert.equal(code, 0);
  const r = JSON.parse(out);
  assert.equal(r.metrics.tokens.input.abs, 1000);
  assert.equal(r.metrics.tokens.input.rel, 1);
  assert.equal(r.metrics.activeMs.abs, -30000);
  assert.equal(r.metrics.hitl.abs, -2);
  assert.equal(r.new.version, "4.13.0");
  assert.equal(r.old.version, "4.12.0");
});

test("2. null/0 — abs null, rel null", () => {
  const n = write("n1.json", base({ resources: { ...base().resources, activeMs: null } }));
  const o = write("o1.json", base({ resources: { ...base().resources, activeMs: 0 } }));
  const r = JSON.parse(diff(n, o).out);
  assert.equal(r.metrics.activeMs.abs, null);
  assert.equal(r.metrics.activeMs.rel, null);
});

test("3. флаги: same / fix / regress (bool + ранги + leakStatus)", () => {
  const n = write("n2.json", base({
    process: { ...base().process, docsSynced: false, tests: "red", specReview: "skipped" },
    security: { ...base().security, leakStatus: "fail" },
  }));
  const r = JSON.parse(diff(n, OLD).out);
  assert.equal(r.flags.spec, "same");
  assert.equal(r.flags.docsSynced, "regress");
  assert.equal(r.flags.tests, "regress");
  assert.equal(r.flags.specReview, "regress");
  assert.equal(r.flags.leakStatus, "regress");
  const n2 = write("n3.json", base({
    process: { ...base().process, docsSynced: true },
    security: { ...base().security, leakStatus: "pass" },
  }));
  const o2 = write("o2.json", base({
    process: { ...base().process, docsSynced: false, tests: "unavailable" },
  }));
  const r2 = JSON.parse(diff(n2, o2).out);
  assert.equal(r2.flags.docsSynced, "fix");
  assert.equal(r2.flags.tests, "fix");
});

test("4. models_changed: true при смене, false при переупорядочении ключей", () => {
  const n = write("n4.json", base({ run: { ...base().run, models: { haiku: "m/h2", sonnet: "m/s" } } }));
  assert.equal(JSON.parse(diff(n, OLD).out).models_changed, true);
  const reordered = write("n5.json", base({ run: { ...base().run, models: { sonnet: "m/s", haiku: "m/h" } } }));
  assert.equal(JSON.parse(diff(reordered, OLD).out).models_changed, false);
  const noModels = write("n6.json", base({ run: { ...base().run, models: {} } }));
  assert.equal(JSON.parse(diff(noModels, OLD).out).models_changed, true);
});

test("5. --md: таблица + пометка models_changed", () => {
  const n = write("n7.json", base({ run: { ...base().run, models: { haiku: "m/h2" } } }));
  const { code, out } = diff(n, OLD, "--md");
  assert.equal(code, 0);
  assert.match(out, /Сверка|дельф|Δ/i);
  assert.match(out, /модел/i);
});

test("6. отсутствие файла → exit 1; usage → exit 2", () => {
  const a = diff(join(dir, "nope.json"), OLD);
  assert.notEqual(a.code, 0);
  const b = { code: 0 };
  try {
    execFileSync("node", [DIFF], { encoding: "utf8" });
  } catch (e) { b.code = e.status; }
  assert.equal(b.code, 2);
});
