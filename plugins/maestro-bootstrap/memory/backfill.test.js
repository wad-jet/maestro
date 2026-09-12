import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { hostname } from "node:os";
import { loadConfidentialConfig } from "../core.js";
import { prefixesOf } from "./project.js";
import { reindexSessionArtifacts, gitFeatureSessionId, isPlanPath, scanHistory, synthesizeGitEntry } from "./backfill.js";
import { SESSIONS } from "./summarize.js";

// ── helpers ────────────────────────────────────────────────────────────────

function makeRoot(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "backfill-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function touch(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, "x");
}

function writeMsg(filePath) {
  return { parts: [{ type: "tool", tool: "write", state: { status: "completed", input: { filePath } } }] };
}

// Непустой resolved-набор для не-confidential кейсов (F1: fail-closed —
// extractArtifacts возвращает [] при пустом наборе).
const NO_CONF = ["secrets/**"];

// Fake storage: scan проектирует колонки как реальный sqlite (fields-opt-in,
// embedding — opt-in поле, C1); upsert — spy.
function makeStorage(rows) {
  const calls = { upsert: [], scan: [] };
  return {
    calls,
    scan: async ({ key, fields }) => {
      calls.scan.push({ key, fields: [...fields] });
      return rows
        .filter((r) => r.key === key)
        .map((r) => {
          const out = {};
          for (const f of fields) if (f in r) out[f] = r[f];
          return out;
        });
    },
    upsert: async (entries) => { calls.upsert.push(entries); },
  };
}

function makeClient({ messages = null, throws = false } = {}) {
  return {
    session: {
      messages: async () => {
        if (throws) throw new Error("messages unavailable");
        return { data: messages ?? [] };
      },
    },
  };
}

// Полная строка записи (все поля, которые вернёт scan при полном fields-наборе).
function baseRow(overrides = {}) {
  return {
    session_id: "s1", key: "k", origin_project_hash: "h",
    title: "Title", summary: "Summary", decisions: ["D1"],
    artifacts: [], author: "me",
    time_first: 100, time_last: 200, version: 2,
    model_id: "m1", branch: "main", head: "abc", merged: 1,
    host: "h1", origin_remote: "", prefixes: [],
    embedding: Buffer.from(new Float32Array([0.1, 0.2, 0.3]).buffer),
    ...overrides,
  };
}

function makeDeps(overrides = {}) {
  return {
    client: makeClient(),
    storage: makeStorage([]),
    root: "/tmp",
    key: "k",
    artifactGlobs: ["docs/**"],
    artifactConfidentialPatterns: NO_CONF,
    confidentialPatterns: [],
    embedModelId: "m1",
    ...overrides,
  };
}

// ── updated ─────────────────────────────────────────────────────────────────

test("updated: union extracted-first + case-insensitive dedup + preserved fields + version+1 + single upsert", async (t) => {
  const root = makeRoot(t);
  touch(path.join(root, "docs", "spec.md"));
  touch(path.join(root, "docs", "b.md"));
  const existing = baseRow({ artifacts: ["docs/SPEC.md", "docs/c.md"] });
  const storage = makeStorage([existing]);
  const client = makeClient({
    messages: [writeMsg(path.join(root, "docs", "spec.md")), writeMsg(path.join(root, "docs", "b.md"))],
  });
  const deps = makeDeps({ root, storage, client });

  const out = await reindexSessionArtifacts(deps, "s1");

  assert.equal(out.status, "updated");
  // extracted-first: spec.md, b.md; existing: SPEC.md (case-insensitive dup), c.md.
  assert.deepEqual(out.artifacts, ["docs/spec.md", "docs/b.md", "docs/c.md"]);
  assert.equal(storage.calls.upsert.length, 1, "upsert вызван ровно 1 раз");
  const [entry] = storage.calls.upsert[0];
  assert.deepEqual(entry.artifacts, ["docs/spec.md", "docs/b.md", "docs/c.md"]);
  assert.equal(entry.version, 3, "version = existing.version + 1");
  // RI-3: остальные поля сохранены из existing.
  assert.equal(entry.title, "Title");
  assert.equal(entry.summary, "Summary");
  assert.deepEqual(entry.decisions, ["D1"]);
  assert.equal(entry.model_id, "m1");
  assert.equal(entry.head, "abc");
  assert.equal(entry.branch, "main");
  assert.equal(entry.merged, 1);
  assert.equal(entry.time_first, 100);
  assert.equal(entry.time_last, 200);
  assert.equal(entry.author, "me");
  assert.equal(entry.key, "k");
  assert.equal(entry.origin_project_hash, "h");
  // C1: embedding — opt-in поле scan (не storage.get, который затирает).
  assert.ok(storage.calls.scan[0].fields.includes("embedding"), "scan запрашивает embedding");
  // Buffer → Float32Array (нормализация; сравнение по значениям — expected
  // строится через Float32Array, чтобы учесть float32-округление).
  assert.ok(entry.embedding instanceof Float32Array);
  assert.deepEqual([...entry.embedding], [...new Float32Array([0.1, 0.2, 0.3])]);
});

test("updated: cap 8 — union обрезается, extracted-first", async (t) => {
  const root = makeRoot(t);
  const extractedPaths = [];
  const msgs = [];
  for (let i = 0; i < 8; i++) {
    const p = `docs/f${i}.md`;
    touch(path.join(root, p));
    extractedPaths.push(p);
    msgs.push(writeMsg(path.join(root, p)));
  }
  const existing = baseRow({ artifacts: ["docs/extra.md"] });
  const storage = makeStorage([existing]);
  const client = makeClient({ messages: msgs });
  const deps = makeDeps({ root, storage, client });

  const out = await reindexSessionArtifacts(deps, "s1");

  assert.equal(out.status, "updated");
  // 8 извлечённых путей занимают cap; existing.extra.md отрезан.
  assert.deepEqual(out.artifacts, extractedPaths);
  const [entry] = storage.calls.upsert[0];
  assert.equal(entry.artifacts.length, 8);
});

test("updated: maskEntry перед upsert дропает stale-путь из existing, матчащий resolved-набор", async (t) => {
  const root = makeRoot(t);
  touch(path.join(root, "docs", "spec.md"));
  const existing = baseRow({ artifacts: ["docs/old.md", "secrets/key.md"] });
  const storage = makeStorage([existing]);
  const client = makeClient({ messages: [writeMsg(path.join(root, "docs", "spec.md"))] });
  const deps = makeDeps({ root, storage, client, artifactConfidentialPatterns: ["secrets/**"] });

  const out = await reindexSessionArtifacts(deps, "s1");

  assert.equal(out.status, "updated");
  // union = [spec.md, old.md, secrets/key.md] ≠ existing → upsert; maskEntry
  // (resolved-набор) дропает secrets/key.md.
  assert.deepEqual(out.artifacts, ["docs/spec.md", "docs/old.md"]);
  const [entry] = storage.calls.upsert[0];
  assert.deepEqual(entry.artifacts, ["docs/spec.md", "docs/old.md"]);
});

test("updated: stale-purge no-delta — extracted пусто, existing содержит путь из resolved-набора → upsert чистит (post-mask guard)", async (t) => {
  const root = makeRoot(t);
  const existing = baseRow({ artifacts: ["docs/old.md", "secrets/key.md"] });
  const storage = makeStorage([existing]);
  // Сообщения непустые, но без write/edit-частей → extracted = [] (no-delta).
  const client = makeClient({ messages: [{ parts: [{ type: "text", text: "hello" }] }] });
  const deps = makeDeps({ root, storage, client, artifactConfidentialPatterns: ["secrets/**"] });

  const out = await reindexSessionArtifacts(deps, "s1");

  // Pre-mask union == existing → старый guard вернул бы no_change; post-mask
  // union (secrets/key.md отфильтрован resolved-набором) ≠ existing → upsert.
  assert.equal(out.status, "updated");
  assert.equal(storage.calls.upsert.length, 1, "upsert вызван ровно 1 раз");
  const [entry] = storage.calls.upsert[0];
  assert.deepEqual(entry.artifacts, ["docs/old.md"], "stale-путь из resolved-набора удалён");
  assert.equal(entry.version, 3, "version = existing.version + 1");
  // RI-3: остальные поля сохранены из existing.
  assert.equal(entry.title, "Title");
  assert.equal(entry.summary, "Summary");
  assert.deepEqual(entry.decisions, ["D1"]);
  assert.equal(entry.model_id, "m1");
  assert.equal(entry.head, "abc");
  assert.equal(entry.branch, "main");
  assert.equal(entry.merged, 1);
  assert.equal(entry.time_first, 100);
  assert.equal(entry.time_last, 200);
  assert.equal(entry.author, "me");
  assert.equal(entry.key, "k");
  assert.equal(entry.origin_project_hash, "h");
});

test("embedding passthrough: Float32Array из scan остаётся Float32Array", async (t) => {
  const root = makeRoot(t);
  touch(path.join(root, "docs", "spec.md"));
  const existing = baseRow({ artifacts: [], embedding: new Float32Array([0.5, 0.6]) });
  const storage = makeStorage([existing]);
  const client = makeClient({ messages: [writeMsg(path.join(root, "docs", "spec.md"))] });
  const deps = makeDeps({ root, storage, client });

  const out = await reindexSessionArtifacts(deps, "s1");

  assert.equal(out.status, "updated");
  const [entry] = storage.calls.upsert[0];
  assert.ok(entry.embedding instanceof Float32Array);
  assert.deepEqual([...entry.embedding], [...new Float32Array([0.5, 0.6])]);
});

// ── no_change ───────────────────────────────────────────────────────────────

test("no_change: case-insensitive set-равенство union и existing → upsert НЕ вызван", async (t) => {
  const root = makeRoot(t);
  touch(path.join(root, "docs", "spec.md"));
  const existing = baseRow({ artifacts: ["docs/SPEC.md"] });
  const storage = makeStorage([existing]);
  const client = makeClient({ messages: [writeMsg(path.join(root, "docs", "spec.md"))] });
  const deps = makeDeps({ root, storage, client });

  const out = await reindexSessionArtifacts(deps, "s1");

  assert.equal(out.status, "no_change");
  assert.equal(storage.calls.upsert.length, 0, "upsert не вызван (RI-7)");
});

// ── skip-ветки ──────────────────────────────────────────────────────────────

test("skip_no_record: scan пуст", async () => {
  const storage = makeStorage([]);
  const deps = makeDeps({ storage });

  const out = await reindexSessionArtifacts(deps, "s1");

  assert.equal(out.status, "skip_no_record");
  assert.equal(storage.calls.upsert.length, 0);
});

test("skip_no_record: запись есть, но session_id не найден", async () => {
  const storage = makeStorage([baseRow({ session_id: "other" })]);
  const deps = makeDeps({ storage });

  const out = await reindexSessionArtifacts(deps, "s1");

  assert.equal(out.status, "skip_no_record");
  assert.equal(storage.calls.upsert.length, 0);
});

test("skip_model_mismatch: model_id ≠ embedModelId", async () => {
  const storage = makeStorage([baseRow({ model_id: "m2" })]);
  const deps = makeDeps({ storage, embedModelId: "m1" });

  const out = await reindexSessionArtifacts(deps, "s1");

  assert.equal(out.status, "skip_model_mismatch");
  assert.equal(storage.calls.upsert.length, 0);
});

test("skip_messages_unavailable: client бросает", async () => {
  const storage = makeStorage([baseRow()]);
  const client = makeClient({ throws: true });
  const deps = makeDeps({ storage, client });

  const out = await reindexSessionArtifacts(deps, "s1");

  assert.equal(out.status, "skip_messages_unavailable");
  assert.equal(storage.calls.upsert.length, 0);
});

test("skip_messages_unavailable: пустые сообщения", async () => {
  const storage = makeStorage([baseRow()]);
  const client = makeClient({ messages: [] });
  const deps = makeDeps({ storage, client });

  const out = await reindexSessionArtifacts(deps, "s1");

  assert.equal(out.status, "skip_messages_unavailable");
  assert.equal(storage.calls.upsert.length, 0);
});

test("skip_no_embedding: embedding пустой", async () => {
  const storage = makeStorage([baseRow({ embedding: null })]);
  const deps = makeDeps({ storage });

  const out = await reindexSessionArtifacts(deps, "s1");

  assert.equal(out.status, "skip_no_embedding");
  assert.equal(storage.calls.upsert.length, 0);
});

test("skip_service: sessionID ∈ SESSIONS", async (t) => {
  SESSIONS.add("s1");
  t.after(() => SESSIONS.delete("s1"));
  const storage = makeStorage([baseRow()]);
  const deps = makeDeps({ storage });

  const out = await reindexSessionArtifacts(deps, "s1");

  assert.equal(out.status, "skip_service");
  assert.equal(storage.calls.upsert.length, 0);
});

// ── Task 3: git-history scan + synthetic entry synthesis ────────────────────

const SHA = "a".repeat(40);
const CT = 1700000000;
const SPEC = "docs/superpowers/specs/x-design.md";

// Непустой resolved-набор для не-confidential кейсов (F1: fail-closed).
const NO_CONF_RESOLVED = ["secrets/**"];

// Resolved-набор при ПУСТОМ user-confidential.paths: default docs/confidential/**
// + builtin (как строит index.js: [...conf.paths, ...conf.builtin]).
function resolvedConfidential() {
  const conf = loadConfidentialConfig({});
  return [...conf.paths, ...conf.builtin];
}

function makeTree(t, files) {
  const root = makeRoot(t);
  for (const f of files) touch(path.join(root, f));
  return root;
}

// Fake git: методы, которые scanHistory дёргает (log/isAncestor/commitMessage/
// filesOfCommit). log — stdout `git log --diff-filter=A --format="%H %ct"
// --reverse -- <path>`; первая строка = старейший добавивший коммит.
function makeGit(overrides = {}) {
  return {
    log: async () => `${SHA} ${CT}`,
    isAncestor: async () => "yes",
    commitMessage: async () => "",
    filesOfCommit: async () => [],
    ...overrides,
  };
}

function scanDeps(root, overrides = {}) {
  return {
    root,
    historyGlobs: ["docs/**"],
    git: makeGit(),
    mainline: "main",
    records: [],
    artifactConfidentialPatterns: NO_CONF_RESOLVED,
    ...overrides,
  };
}

// Fake storage для synthesizeGitEntry: get + upsert (spy).
function makeGitStorage({ existing = null } = {}) {
  const calls = { upsert: [], get: [] };
  return {
    calls,
    get: async (sid) => { calls.get.push(sid); return existing; },
    upsert: async (entries) => { calls.upsert.push(entries); },
  };
}

function gitFeature(overrides = {}) {
  return {
    specPath: SPEC,
    planPath: null,
    commitSha: SHA,
    branch: "",
    merged: 0,
    title: "My Feature",
    timeFirst: CT * 1000,
    timeLast: CT * 1000,
    artifacts: [SPEC],
    ...overrides,
  };
}

function synthDeps(overrides = {}) {
  return {
    storage: makeGitStorage(),
    root: "/tmp",
    key: "a.b.c",
    projectHash: "ph",
    originRemote: "gh/x",
    embedModelId: "m1",
    embeddings: async () => new Float32Array([0.1, 0.2]),
    confidentialPatterns: [],
    artifactConfidentialPatterns: NO_CONF_RESOLVED,
    ...overrides,
  };
}

// ── gitFeatureSessionId / isPlanPath ────────────────────────────────────────

test("gitFeatureSessionId: детерминирован, формат git- + 12 hex, spec/plan одного коммита → разные ID", () => {
  const id1 = gitFeatureSessionId(SHA, SPEC);
  const id2 = gitFeatureSessionId(SHA, SPEC);
  assert.equal(id1, id2, "детерминированность");
  assert.match(id1, /^git-[0-9a-f]{12}$/, "формат git-<12 hex>");
  const idPlan = gitFeatureSessionId(SHA, "docs/superpowers/plans/x-plan.md");
  assert.notEqual(id1, idPlan, "spec и plan одного коммита → разные ID (specPath в хэше)");
});

test("isPlanPath: basename -plan.md ИЛИ parent-каталог plans", () => {
  assert.equal(isPlanPath("docs/superpowers/plans/x-plan.md"), true);
  assert.equal(isPlanPath("docs/superpowers/specs/x-design.md"), false);
  assert.equal(isPlanPath("specs/x-plan.md"), true, "legacy specs/x-plan.md");
  assert.equal(isPlanPath("docs/superpowers/plans/x.md"), true, "parent-каталог plans");
  assert.equal(isPlanPath("docs/superpowers/specs/x.md"), false);
  assert.equal(isPlanPath(""), false);
});

// ── scanHistory ─────────────────────────────────────────────────────────────

test("scanHistory: glob-матчинг + plan-исключение + skip_confidential (default + builtin) + feature", async (t) => {
  const root = makeTree(t, [
    "docs/superpowers/specs/x-design.md",
    "docs/superpowers/plans/x-plan.md",
    "docs/confidential/secret.md",
    ".env",
    "README.md",
    "src/foo.js", // вне globs → не кандидат
  ]);
  const out = await scanHistory(scanDeps(root, {
    historyGlobs: ["docs/**", ".env", "README.md"],
    artifactConfidentialPatterns: resolvedConfidential(),
  }));

  assert.equal(out.considered, 5, "только файлы, матчащие globs");
  assert.equal(out.covered.plan_excluded, 1, "plan-путь исключён из кандидатов");
  assert.equal(out.covered.skip_confidential, 2, "docs/confidential/** (default) + .env (builtin)");
  assert.equal(out.covered.not_in_git, 0);
  assert.equal(out.covered.by_artifacts, 0);
  assert.equal(out.features.length, 2, "x-design.md + README.md");
  assert.deepEqual(out.gitErrors, []);
  const f = out.features.find((x) => x.specPath === SPEC);
  assert.ok(f, "spec в features");
  assert.equal(f.commitSha, SHA);
  assert.equal(f.merged, 1, "isAncestor yes → 1");
  assert.equal(f.timeFirst, CT * 1000, "%ct ×1000");
  assert.equal(f.timeLast, CT * 1000);
});

test("scanHistory: coverage by artifacts — record.artifacts содержит путь → covered, не в features", async (t) => {
  const root = makeTree(t, [SPEC]);
  const out = await scanHistory(scanDeps(root, {
    records: [{ artifacts: [SPEC] }],
  }));

  assert.equal(out.covered.by_artifacts, 1);
  assert.equal(out.features.length, 0);
});

test("scanHistory: coverage case-insensitive (record.artifacts uppercase)", async (t) => {
  const root = makeTree(t, [SPEC]);
  const out = await scanHistory(scanDeps(root, {
    records: [{ artifacts: ["DOCS/SUPERPOWERS/SPECS/X-DESIGN.MD"] }],
  }));

  assert.equal(out.covered.by_artifacts, 1);
  assert.equal(out.features.length, 0);
});

test("scanHistory: not_in_git — git log пуст", async (t) => {
  const root = makeTree(t, [SPEC]);
  const out = await scanHistory(scanDeps(root, {
    git: makeGit({ log: async () => "" }),
  }));

  assert.equal(out.covered.not_in_git, 1);
  assert.equal(out.features.length, 0);
});

test("scanHistory: plan-ассоциация по конвенции (specs/X-design.md → plans/X-plan.md)", async (t) => {
  const root = makeTree(t, [SPEC, "docs/superpowers/plans/x-plan.md"]);
  const out = await scanHistory(scanDeps(root));

  assert.equal(out.features.length, 1);
  const f = out.features[0];
  assert.equal(f.planPath, "docs/superpowers/plans/x-plan.md");
  assert.deepEqual(f.artifacts, [SPEC, "docs/superpowers/plans/x-plan.md"]);
});

test("scanHistory: plan-ассоциация legacy (specs/X.md → specs/X-plan.md)", async (t) => {
  const root = makeTree(t, ["specs/x.md", "specs/x-plan.md"]);
  const out = await scanHistory(scanDeps(root, { historyGlobs: ["specs/**"] }));

  assert.equal(out.features.length, 1);
  assert.equal(out.features[0].planPath, "specs/x-plan.md");
});

test("scanHistory: plan-ассоциация same-commit — только plan-подобные файлы коммита", async (t) => {
  const root = makeTree(t, [SPEC]);
  const out = await scanHistory(scanDeps(root, {
    git: makeGit({ filesOfCommit: async () => [SPEC, "docs/superpowers/plans/x-plan.md", "docs/superpowers/specs/other-design.md"] }),
  }));

  assert.equal(out.features.length, 1);
  assert.equal(out.features[0].planPath, "docs/superpowers/plans/x-plan.md");
});

test("scanHistory: >1 plan-подобного в коммите → planPath=null, artifacts=[specPath]", async (t) => {
  const root = makeTree(t, [SPEC]);
  const out = await scanHistory(scanDeps(root, {
    git: makeGit({ filesOfCommit: async () => [SPEC, "docs/superpowers/plans/a-plan.md", "docs/superpowers/plans/b-plan.md"] }),
  }));

  assert.equal(out.features.length, 1);
  assert.equal(out.features[0].planPath, null);
  assert.deepEqual(out.features[0].artifacts, [SPEC]);
});

test("scanHistory: title из первой H1; fallback Spec: <basename>", async (t) => {
  const root = makeTree(t, [SPEC]);
  fs.writeFileSync(path.join(root, SPEC), "# My Feature\n\nbody\n");
  const out = await scanHistory(scanDeps(root));
  assert.equal(out.features[0].title, "My Feature");

  const root2 = makeTree(t, ["docs/superpowers/specs/y-design.md"]);
  fs.writeFileSync(path.join(root2, "docs/superpowers/specs/y-design.md"), "no h1 here\n");
  const out2 = await scanHistory(scanDeps(root2));
  assert.equal(out2.features[0].title, "Spec: y-design.md");
});

test("scanHistory: merged по isAncestor — yes→1, no→0, error→0, mainline null→0", async (t) => {
  const root = makeTree(t, [SPEC]);
  const yes = await scanHistory(scanDeps(root, { git: makeGit({ isAncestor: async () => "yes" }) }));
  assert.equal(yes.features[0].merged, 1);
  const no = await scanHistory(scanDeps(root, { git: makeGit({ isAncestor: async () => "no" }) }));
  assert.equal(no.features[0].merged, 0);
  const err = await scanHistory(scanDeps(root, { git: makeGit({ isAncestor: async () => "error" }) }));
  assert.equal(err.features[0].merged, 0, "isAncestor error → 0, фича в листинге");
  const nullMain = await scanHistory(scanDeps(root, { mainline: null }));
  assert.equal(nullMain.features[0].merged, 0, "mainline null → 0");
});

test("scanHistory: branch из merge-сообщения (Merge branch 'x'), иначе ''", async (t) => {
  const root = makeTree(t, [SPEC]);
  const merged = await scanHistory(scanDeps(root, {
    git: makeGit({ commitMessage: async () => "Merge branch 'feature/x'" }),
  }));
  assert.equal(merged.features[0].branch, "feature/x");
  const plain = await scanHistory(scanDeps(root, {
    git: makeGit({ commitMessage: async () => "feat: something" }),
  }));
  assert.equal(plain.features[0].branch, "");
});

test("scanHistory: git-сбой → fail-soft (gitErrors, features без фичи)", async (t) => {
  const root = makeTree(t, [SPEC]);
  const out = await scanHistory(scanDeps(root, {
    git: makeGit({ log: async () => { throw new Error("boom"); } }),
  }));

  assert.equal(out.features.length, 0);
  assert.equal(out.gitErrors.length, 1);
  assert.equal(out.gitErrors[0].path, SPEC);
  assert.equal(out.considered, 1);
});

test("scanHistory: F1 early-return — пустой resolved-набор → 0 кандидатов, git не дёргается", async (t) => {
  const root = makeTree(t, [SPEC]);
  let logCalls = 0;
  const out = await scanHistory(scanDeps(root, {
    artifactConfidentialPatterns: [],
    git: makeGit({ log: async () => { logCalls++; return `${SHA} ${CT}`; } }),
  }));

  assert.equal(out.considered, 0, "ни один кандидат не рассмотрен");
  assert.equal(out.features.length, 0);
  assert.deepEqual(out.covered, { by_artifacts: 0, not_in_git: 0, skip_confidential: 0, plan_excluded: 0 });
  assert.deepEqual(out.gitErrors, []);
  assert.equal(logCalls, 0, "git.log не вызван (guard до цикла)");
});

test("scanHistory: malformed git-log line → gitErrors, batch продолжается", async (t) => {
  const root = makeTree(t, [SPEC, "docs/superpowers/specs/y-design.md"]);
  const out = await scanHistory(scanDeps(root, {
    git: makeGit({
      log: async (r, p) => (p === SPEC ? "no-separator-line" : `${SHA} ${CT}`),
    }),
  }));

  assert.equal(out.gitErrors.length, 1);
  assert.equal(out.gitErrors[0].path, SPEC);
  assert.match(out.gitErrors[0].error, /malformed git log line/);
  assert.equal(out.features.length, 1, "batch продолжается — второй файл обработан");
  assert.equal(out.features[0].specPath, "docs/superpowers/specs/y-design.md");
});

test("scanHistory: git-адаптер без log → gitErrors с явной записью, features пуст", async (t) => {
  const root = makeTree(t, [SPEC]);
  const out = await scanHistory(scanDeps(root, { git: {} }));

  assert.equal(out.features.length, 0);
  assert.equal(out.considered, 0, "ни один кандидат не рассмотрен");
  assert.equal(out.gitErrors.length, 1);
  assert.equal(out.gitErrors[0].error, "git adapter incomplete: log method missing");
  assert.deepEqual(out.covered, { by_artifacts: 0, not_in_git: 0, skip_confidential: 0, plan_excluded: 0 });
});

test("scanHistory: filesOfCommit/commitMessage throw → gitErrors (non-fatal), фича остаётся", async (t) => {
  const root = makeTree(t, [SPEC]);
  const out = await scanHistory(scanDeps(root, {
    git: makeGit({
      filesOfCommit: async () => { throw new Error("files boom"); },
      commitMessage: async () => { throw new Error("msg boom"); },
    }),
  }));

  assert.equal(out.features.length, 1, "non-fatal — фича остаётся");
  const f = out.features[0];
  assert.equal(f.planPath, null, "planPath остаётся null");
  assert.equal(f.branch, "", "branch остаётся ''");
  assert.equal(out.gitErrors.length, 2, "обе ошибки в gitErrors");
  assert.ok(out.gitErrors.some((e) => e.path === SPEC && /filesOfCommit/.test(e.error)), "filesOfCommit в gitErrors");
  assert.ok(out.gitErrors.some((e) => e.path === SPEC && /commitMessage/.test(e.error)), "commitMessage в gitErrors");
});

// ── synthesizeGitEntry ──────────────────────────────────────────────────────

test("synthesizeGitEntry: already_indexed — storage.get по session_id, без upsert и embed", async (t) => {
  const storage = makeGitStorage({ existing: { session_id: "git-whatever" } });
  const embedCalls = [];
  const embeddings = async (text) => { embedCalls.push(text); return new Float32Array([0.1]); };
  const deps = synthDeps({ storage, embeddings });

  const out = await synthesizeGitEntry(deps, gitFeature(), { summary: "s", decisions: ["d"] });

  assert.equal(out.status, "already_indexed");
  assert.equal(out.session_id, gitFeatureSessionId(SHA, SPEC));
  assert.equal(storage.calls.get.length, 1);
  assert.equal(storage.calls.get[0], gitFeatureSessionId(SHA, SPEC));
  assert.equal(storage.calls.upsert.length, 0, "без upsert");
  assert.equal(embedCalls.length, 0, "без embed");
});

test("synthesizeGitEntry: форма записи — все поля, author git-backfill, version 1, prefixes, merged из feature", async (t) => {
  const root = makeTree(t, [SPEC, "docs/superpowers/plans/x-plan.md"]);
  const storage = makeGitStorage();
  const deps = synthDeps({ storage, root });
  const feature = gitFeature({
    planPath: "docs/superpowers/plans/x-plan.md",
    branch: "feature/x",
    merged: 1,
    artifacts: [SPEC, "docs/superpowers/plans/x-plan.md"],
  });

  const out = await synthesizeGitEntry(deps, feature, { summary: "Sum", decisions: ["D1", "D2"] });

  assert.equal(out.status, "indexed");
  assert.equal(out.session_id, gitFeatureSessionId(SHA, SPEC));
  assert.equal(storage.calls.upsert.length, 1);
  const [entry] = storage.calls.upsert[0];
  assert.equal(entry.session_id, gitFeatureSessionId(SHA, SPEC));
  assert.equal(entry.key, "a.b.c");
  assert.equal(entry.origin_project_hash, "ph");
  assert.equal(entry.title, "My Feature");
  assert.equal(entry.summary, "Sum");
  assert.deepEqual(entry.decisions, ["D1", "D2"]);
  assert.equal(entry.model_id, "m1");
  assert.equal(entry.author, "git-backfill", "RI-6 author-маркер");
  assert.equal(entry.time_first, CT * 1000);
  assert.equal(entry.time_last, CT * 1000);
  assert.equal(entry.version, 1);
  assert.equal(entry.branch, "feature/x");
  assert.equal(entry.head, SHA);
  assert.equal(entry.merged, 1, "merged из feature");
  assert.equal(entry.host, hostname());
  assert.equal(entry.origin_remote, "gh/x");
  assert.deepEqual(entry.prefixes, prefixesOf("a.b.c"));
  assert.deepEqual(entry.artifacts, [SPEC, "docs/superpowers/plans/x-plan.md"]);
  assert.ok(entry.embedding instanceof Float32Array);
});

test("synthesizeGitEntry: artifacts-фильтр — existsSync=false дроп, resolved-матч дроп, dedup lowercase, cap 8", async (t) => {
  const root = makeTree(t, [
    SPEC,
    "docs/superpowers/plans/x-plan.md",
    "docs/confidential/secret.md",
    "docs/a.md", "docs/b.md", "docs/c.md", "docs/d.md", "docs/e.md", "docs/f.md",
  ]);
  const storage = makeGitStorage();
  const deps = synthDeps({ storage, root, artifactConfidentialPatterns: ["docs/confidential/**"] });
  const feature = gitFeature({
    planPath: "docs/superpowers/plans/x-plan.md",
    artifacts: [
      SPEC,
      "docs/superpowers/SPECS/x-design.md", // lowercase-дубль
      "docs/superpowers/plans/x-plan.md",
      "docs/superpowers/plans/missing-plan.md", // не существует → дроп
      "docs/confidential/secret.md", // resolved-матч → дроп
      "docs/a.md", "docs/b.md", "docs/c.md", "docs/d.md", "docs/e.md", "docs/f.md",
    ],
  });

  const out = await synthesizeGitEntry(deps, feature, { summary: "s", decisions: [] });

  assert.equal(out.status, "indexed");
  const [entry] = storage.calls.upsert[0];
  assert.equal(entry.artifacts.length, 8, "cap 8");
  assert.ok(entry.artifacts.includes(SPEC));
  assert.ok(entry.artifacts.includes("docs/superpowers/plans/x-plan.md"));
  assert.ok(!entry.artifacts.includes("docs/superpowers/SPECS/x-design.md"), "dedup lowercase");
  assert.ok(!entry.artifacts.includes("docs/superpowers/plans/missing-plan.md"), "existsSync=false дроп");
  assert.ok(!entry.artifacts.includes("docs/confidential/secret.md"), "resolved-матч дроп");
});

test("synthesizeGitEntry: re-mask LLM-вывода до embed — embed-вход от маскированного контента", async (t) => {
  const root = makeTree(t, [SPEC]);
  const storage = makeGitStorage();
  const embedInputs = [];
  const embeddings = async (text) => { embedInputs.push(text); return new Float32Array([0.1]); };
  const deps = synthDeps({
    storage, root,
    embeddings,
    confidentialPatterns: ["docs/confidential/**"],
    artifactConfidentialPatterns: ["docs/confidential/**"],
  });
  const llm = { summary: "line one\ndocs/confidential/secret.md\nline three", decisions: ["keep this"] };

  const out = await synthesizeGitEntry(deps, gitFeature(), llm);

  assert.equal(out.status, "indexed");
  assert.equal(embedInputs.length, 1, "embed вызван ровно 1 раз");
  const input = embedInputs[0];
  assert.equal(input, "My Feature\nline one\n[confidential]\nline three\nkeep this",
    "embed-вход = title + \\n + summary + \\n + decisions.join(\\n) от МАСКИРОВАННЫХ значений");
  assert.ok(!input.includes("docs/confidential/secret.md"), "raw confidential-строка не ушла в embed");
  const [entry] = storage.calls.upsert[0];
  assert.ok(!entry.summary.includes("docs/confidential/secret.md"), "upsert-запись тоже замаскирована");
  assert.ok(entry.summary.includes("[confidential]"));
  assert.ok(entry.embedding instanceof Float32Array, "embedding записан");
});