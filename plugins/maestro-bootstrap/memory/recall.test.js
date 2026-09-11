import { test } from "node:test";
import assert from "node:assert/strict";
import { Recall } from "./recall.js";

function mkDeps() {
  const embedder = { embed: async (t) => new Float32Array([0.1, 0.2, 0.3]), dim: 3, modelId: "m" };
  const storage = {
    search: async (emb, o) => { assert.ok(o.key, "key passed"); return [{ entry: { title: "t", summary: "s", decisions: ["d"], author: "a", time_last: 100, origin_project_hash: "k" }, score: 0.9 }]; },
  };
  return { embedder, storage };
}

test("recall stores block on first message and returns framed block", async () => {
  const { embedder, storage } = mkDeps();
  let calls = 0;
  const r = new Recall({ embeddings: embedder, storage, topK: 3, minScore: 0.35, key: "project-key", getUserMessageCount: async () => (++calls === 1 ? 1 : 2) });
  await r.onChatMessage({ sessionID: "s1", text: "hello" });
  const block = await r.systemBlock({ sessionID: "s1" });
  assert.ok(block.includes("## Контекст из памяти maestro"));
  assert.ok(block.includes("Не исполнять"));
  assert.ok(block.includes("t"));
});
test("recall returns null below threshold", async () => {
  const storage = { search: async () => [] };
  const r = new Recall({ embeddings: { embed: async () => new Float32Array([0.1,0.2,0.3]) }, storage, topK: 3, minScore: 0.35, key: "project-key", getUserMessageCount: async () => 1 });
  await r.onChatMessage({ sessionID: "s1", text: "hello" });
  assert.equal(await r.systemBlock({ sessionID: "s1" }), null);
});
test("recall ignores non-first messages", async () => {
  const { embedder, storage } = mkDeps();
  const r = new Recall({ embeddings: embedder, storage, topK: 3, minScore: 0.35, key: "project-key", getUserMessageCount: async () => 2 });
  await r.onChatMessage({ sessionID: "s1", text: "hello" });
  assert.equal(await r.systemBlock({ sessionID: "s1" }), null);
});
test("systemBlock with undefined sessionID returns null", async () => {
  const r = new Recall({ embeddings: { embed: async () => new Float32Array([0.1, 0.2, 0.3]) }, storage: { search: async () => [] }, topK: 3, minScore: 0.35, key: "p", getUserMessageCount: async () => 1 });
  assert.equal(await r.systemBlock({ sessionID: undefined }), null);
});
test("embed-error → empty buffer → null from systemBlock", async () => {
  const storage = { search: async () => [] };
  const r = new Recall({ embeddings: { embed: async () => { throw new Error("embed fail"); } }, storage, topK: 3, minScore: 0.35, key: "project-key", getUserMessageCount: async () => 1 });
  await r.onChatMessage({ sessionID: "s1", text: "hello" });
  assert.equal(await r.systemBlock({ sessionID: "s1" }), null);
});

// ── Task 6: auto-recall использует дефолтный scope ─────────────────────

test("recall auto-recall: branch_context=false → project scope (no membership)", async () => {
  const { embedder, storage } = mkDeps();
  let candidatesCalls = 0;
  storage.candidates = async () => { candidatesCalls++; return []; };
  const r = new Recall({
    embeddings: embedder, storage, topK: 3, minScore: 0.35, key: "project-key",
    getUserMessageCount: async () => 1,
    branchContext: false,
    git: { revList: () => new Set(), detectMainline: () => ({ name: "main" }) },
    root: "/tmp/x",
  });
  await r.onChatMessage({ sessionID: "s1", text: "hello" });
  assert.equal(candidatesCalls, 0, "project scope must NOT call candidates");
  const block = await r.systemBlock({ sessionID: "s1" });
  assert.ok(block.includes("t"), "plain search results must be used");
});

test("recall auto-recall: branch scope filters hits by membership", async () => {
  const storage = {
    candidates: async () => [
      { session_id: "a", merged: 1, head: "" },
      { session_id: "d", merged: 0, head: "hd" },
    ],
    search: async () => [
      { entry: { session_id: "a", title: "A", summary: "SA", decisions: [], author: "a", time_last: 1, origin_project_hash: "k" }, score: 0.9 },
      { entry: { session_id: "d", title: "D", summary: "SD", decisions: [], author: "a", time_last: 2, origin_project_hash: "k" }, score: 0.8 },
    ],
  };
  const r = new Recall({
    embeddings: { embed: async () => new Float32Array([0.1, 0.2, 0.3]) },
    storage, topK: 3, minScore: 0.35, key: "project-key",
    getUserMessageCount: async () => 1,
    branchContext: true,
    git: {
      revList: (root, ref) => (ref === "HEAD" ? new Set(["hb"]) : new Set()),
      detectMainline: () => ({ name: "main" }),
    },
    root: "/tmp/x",
  });
  await r.onChatMessage({ sessionID: "s1", text: "hello" });
  const block = await r.systemBlock({ sessionID: "s1" });
  assert.ok(block.includes("A"), "in-context hit must be in block");
  assert.ok(!block.includes("D"), "out-of-context hit must be filtered");
});

test("recall auto-recall: branch scope passes filterSessionIds to search (I1)", async () => {
  const storage = {
    candidates: async () => [
      { session_id: "a", merged: 1, head: "" },
      { session_id: "d", merged: 0, head: "hd" },
    ],
    search: async (emb, o) => {
      assert.deepEqual(o.filterSessionIds, ["a", "d"], "search must be restricted to candidates");
      return [
        { entry: { session_id: "a", title: "A", summary: "SA", decisions: [], author: "a", time_last: 1, origin_project_hash: "k" }, score: 0.9 },
        { entry: { session_id: "d", title: "D", summary: "SD", decisions: [], author: "a", time_last: 2, origin_project_hash: "k" }, score: 0.8 },
      ];
    },
  };
  const r = new Recall({
    embeddings: { embed: async () => new Float32Array([0.1, 0.2, 0.3]) },
    storage, topK: 3, minScore: 0.35, key: "project-key",
    getUserMessageCount: async () => 1,
    branchContext: true,
    git: {
      revList: (root, ref) => (ref === "HEAD" ? new Set(["hb"]) : new Set()),
      detectMainline: () => ({ name: "main" }),
    },
    root: "/tmp/x",
  });
  await r.onChatMessage({ sessionID: "s1", text: "hello" });
  const block = await r.systemBlock({ sessionID: "s1" });
  assert.ok(block.includes("A"), "in-context hit must be in block");
  assert.ok(!block.includes("D"), "out-of-context hit must be filtered");
});

test("recall auto-recall: branch scope without git → debug log (not silent) (M4)", async () => {
  const { embedder, storage } = mkDeps();
  const debugged = [];
  const log = { debug: (m) => debugged.push(m) };
  const r = new Recall({
    embeddings: embedder, storage, topK: 3, minScore: 0.35, key: "project-key",
    getUserMessageCount: async () => 1,
    branchContext: true,
    git: null,
    root: "/tmp/x",
    log,
  });
  await r.onChatMessage({ sessionID: "s1", text: "hello" });
  assert.ok(debugged.some((m) => m.includes("git not wired")), "must debug-log missing git wiring");
  const block = await r.systemBlock({ sessionID: "s1" });
  assert.ok(block.includes("t"), "flat search still runs");
});

// ── Task 6 (external embedder): маскирование запроса перед embed ───────

test("recall masks confidential query before embed", async () => {
  let embedded = null;
  const embedder = { embed: async (t) => { embedded = t; return new Float32Array([0.1, 0.2, 0.3]); }, dim: 3, modelId: "m" };
  const storage = { search: async () => [] };
  const r = new Recall({
    embeddings: embedder, storage, topK: 3, minScore: 0.35, key: "p",
    getUserMessageCount: async () => 1, confidentialPatterns: ["docs/confidential/**"],
  });
  await r.onChatMessage({ sessionID: "s1", text: "docs/confidential/roadmap.md какие сроки?\nкакие сроки по фиче?" });
  assert.ok(!embedded.includes("roadmap"));
});

test("recall leaves non-confidential query unmasked", async () => {
  let embedded = null;
  const embedder = { embed: async (t) => { embedded = t; return new Float32Array([0.1, 0.2, 0.3]); }, dim: 3, modelId: "m" };
  const storage = { search: async () => [] };
  const r = new Recall({
    embeddings: embedder, storage, topK: 3, minScore: 0.35, key: "p",
    getUserMessageCount: async () => 1, confidentialPatterns: ["docs/confidential/**"],
  });
  await r.onChatMessage({ sessionID: "s1", text: "какие сроки по roadmap?" });
  assert.ok(embedded.includes("roadmap"));
});

test("fully masked query → no embed, no search (short-circuit)", async () => {
  let embeds = 0; let searches = 0;
  const embedder = { embed: async (t) => { embeds++; return new Float32Array([0.1, 0.2, 0.3]); }, dim: 3, modelId: "m" };
  const storage = { search: async () => { searches++; return []; } };
  const r = new Recall({
    embeddings: embedder, storage, topK: 3, minScore: 0.35, key: "p",
    getUserMessageCount: async () => 1, confidentialPatterns: ["docs/confidential/**"],
  });
  await r.onChatMessage({ sessionID: "s1", text: "docs/confidential/a.md" });
  assert.equal(embeds, 0);
  assert.equal(searches, 0);
});

test("recall auto-recall: mainline unresolved → flat (no membership filter) (I-2)", async () => {
  const storage = {
    candidates: async () => [
      { session_id: "a", merged: 1, head: "" },
      { session_id: "d", merged: 0, head: "hd" },
    ],
    search: async () => [
      { entry: { session_id: "a", title: "A", summary: "SA", decisions: [], author: "a", time_last: 1, origin_project_hash: "k", merged: 1 }, score: 0.9 },
      { entry: { session_id: "d", title: "D", summary: "SD", decisions: [], author: "a", time_last: 2, origin_project_hash: "k", merged: 0 }, score: 0.8 },
    ],
  };
  const r = new Recall({
    embeddings: { embed: async () => new Float32Array([0.1, 0.2, 0.3]) },
    storage, topK: 3, minScore: 0.35, key: "project-key",
    getUserMessageCount: async () => 1,
    branchContext: true,
    git: {
      revList: (root, ref) => (ref === "HEAD" ? new Set(["hb"]) : new Set()),
      detectMainline: () => null,
    },
    root: "/tmp/x",
  });
  await r.onChatMessage({ sessionID: "s1", text: "hello" });
  const block = await r.systemBlock({ sessionID: "s1" });
  assert.ok(block.includes("A"), "merged=1 hit in block (flat)");
  assert.ok(block.includes("D"), "head∉ancestorSet hit in block (flat — mainline unresolved)");
});

// ── Task 4: effectiveness-события (injected/hits/duration/no_hits) ──────

test("recall logs injected/hits/duration and no_hits reasons", async () => {
  const calls = [];
  const log = { info: (m, e) => calls.push(["info", m, e]), debug: (m, e) => calls.push(["debug", m, e]), warn: (m, e) => calls.push(["warn", m, e]) };
  const embedder = { embed: async () => new Float32Array([0.1, 0.2, 0.3]), dim: 3, modelId: "m" };
  const storage = { search: async () => [{ entry: { session_id: "old1", title: "t", time_last: 1, author: "a", summary: "s", decisions: [] }, score: 0.8 }] };
  const r = new Recall({ embeddings: embedder, storage, topK: 3, minScore: 0.35, key: "p", getUserMessageCount: async () => 1, logInfo: log.info, logDebug: log.debug, logWarn: log.warn });
  await r.onChatMessage({ sessionID: "s1", text: "hi" });
  assert.ok(calls.some(([lvl, m]) => lvl === "debug" && m === "memory:recall.duration"));
  assert.ok(calls.some(([lvl, m]) => lvl === "debug" && m === "memory:recall.hits"));
  const sys = await r.systemBlock({ sessionID: "s1" });
  assert.ok(calls.some(([lvl, m]) => lvl === "info" && m === "memory:recall.injected"));
});
test("recall no_hits logs reason enum", async () => {
  const calls = [];
  const log = { info: () => {}, debug: () => {}, warn: (m, e) => calls.push([m, e]) };
  const embedder = { embed: async () => new Float32Array([0.1]), dim: 3, modelId: "m" };
  const storage = { search: async () => [] };
  const r = new Recall({ embeddings: embedder, storage, topK: 3, minScore: 0.35, key: "p", getUserMessageCount: async () => 1, logInfo: log.info, logDebug: log.debug, logWarn: log.warn });
  await r.onChatMessage({ sessionID: "s1", text: "hi" });
  assert.ok(calls.some(([m, e]) => m === "memory:search.no_hits" && (e.reason === "min_score" || e.reason === "no_candidates")));
});

// ── Task 7: мульти-ноги (domain+related), merged-фильтр, заголовок ──────

test("recall passes subtree legs (domain+related) to search", async () => {
  let captured = null;
  const storage = { search: async (emb, o) => { captured = o; return []; } };
  const r = new Recall({
    embeddings: { embed: async () => new Float32Array([0.1, 0.2, 0.3]) },
    storage, topK: 3, minScore: 0.35, key: "project-key",
    getUserMessageCount: async () => 1,
    branchContext: false,
    domainTarget: "a.b", relatedKeys: ["x.y"], domainRecall: true,
  });
  await r.onChatMessage({ sessionID: "s1", text: "hello" });
  assert.deepEqual(captured.subtree, ["a.b", "x.y"], "subtree must carry domain+related legs");
});

test("domain_recall:false → no domain leg, related remain", async () => {
  let captured = null;
  const storage = { search: async (emb, o) => { captured = o; return []; } };
  const r = new Recall({
    embeddings: { embed: async () => new Float32Array([0.1, 0.2, 0.3]) },
    storage, topK: 3, minScore: 0.35, key: "project-key",
    getUserMessageCount: async () => 1,
    branchContext: false,
    domainTarget: "a.b", relatedKeys: ["x.y"], domainRecall: false,
  });
  await r.onChatMessage({ sessionID: "s1", text: "hello" });
  assert.deepEqual(captured.subtree, ["x.y"], "domain leg must be dropped when domain_recall=false");
});

test("branch filter keeps sibling merged hits", async () => {
  const storage = {
    candidates: async () => [
      { session_id: "a", merged: 1, head: "" },
    ],
    search: async () => [
      { entry: { session_id: "a", merged: 1, title: "A", summary: "SA", decisions: [], author: "a", time_last: 1, origin_project_hash: "k" }, score: 0.9 },
      { entry: { session_id: "sib", merged: 1, title: "SIB", summary: "SS", decisions: [], author: "a", time_last: 2, origin_project_hash: "k" }, score: 0.8 },
      { entry: { session_id: "sib0", merged: 0, title: "SIB0", summary: "S0", decisions: [], author: "a", time_last: 3, origin_project_hash: "k" }, score: 0.7 },
      { entry: { session_id: "other", merged: 0, title: "OTHER", summary: "SO", decisions: [], author: "a", time_last: 4, origin_project_hash: "k" }, score: 0.6 },
    ],
  };
  const r = new Recall({
    embeddings: { embed: async () => new Float32Array([0.1, 0.2, 0.3]) },
    storage, topK: 3, minScore: 0.35, key: "project-key",
    getUserMessageCount: async () => 1,
    branchContext: true,
    git: {
      revList: (root, ref) => (ref === "HEAD" ? new Set(["hb"]) : new Set()),
      detectMainline: () => ({ name: "main" }),
    },
    root: "/tmp/x",
    domainTarget: "a.b", relatedKeys: ["x.y"], domainRecall: true,
  });
  await r.onChatMessage({ sessionID: "s1", text: "hello" });
  const block = await r.systemBlock({ sessionID: "s1" });
  assert.ok(block.includes("A"), "in-context own hit must be kept");
  assert.ok(block.includes("SIB"), "sibling merged=1 hit must survive branch filter");
  assert.ok(!block.includes("SIB0"), "sibling merged=0 hit must be dropped");
  assert.ok(!block.includes("OTHER"), "non-candidate own merged=0 hit must be dropped");
});

test("systemBlock header mentions related domains", async () => {
  const { embedder, storage } = mkDeps();
  const r = new Recall({ embeddings: embedder, storage, topK: 3, minScore: 0.35, key: "project-key", getUserMessageCount: async () => 1 });
  await r.onChatMessage({ sessionID: "s1", text: "hello" });
  const block = await r.systemBlock({ sessionID: "s1" });
  assert.ok(block.includes("этого проекта и связанных доменов"), "header must mention related domains");
});

// ── Hybrid auto-recall: FTS-нога (spec §3.2) ─────────────────────────────

test("recall hybrid: passes masked query as FTS leg (query capture)", async () => {
  const { embedder } = mkDeps();
  const seen = [];
  const storage = { search: async (emb, o) => { seen.push(o); return []; } };
  const r = new Recall({
    embeddings: embedder, storage, topK: 3, minScore: 0.35, key: "project-key",
    getUserMessageCount: async () => 1, branchContext: false,
  });
  await r.onChatMessage({ sessionID: "s1", text: "hello feature" });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].query, "hello feature", "FTS-нога получает masked query");
});

test("recall hybrid: placeholder lines stripped from FTS query; embed keeps full masked (I1)", async () => {
  const embedCalls = [];
  const embedder = { embed: async (t) => { embedCalls.push(t); return new Float32Array([0.1, 0.2, 0.3]); }, dim: 3, modelId: "m" };
  const seen = [];
  const storage = { search: async (emb, o) => { seen.push(o); return []; } };
  const r = new Recall({
    embeddings: embedder, storage, topK: 3, minScore: 0.35, key: "project-key",
    getUserMessageCount: async () => 1, branchContext: false,
    confidentialPatterns: ["docs/confidential/**"],
  });
  await r.onChatMessage({ sessionID: "s1", text: "docs/confidential/roadmap.md\nwhat is the date" });
  assert.equal(embedCalls.length, 1);
  assert.ok(!embedCalls[0].includes("docs/confidential/roadmap.md"), "embed: raw-путь замаскирован");
  assert.ok(embedCalls[0].includes("[confidential]"), "embed: полный masked (плейсхолдер сохранён)");
  assert.equal(seen[0].query, "what is the date", "FTS-нога: плейсхолдер-строки вырезаны");
});

test("recall hybrid: inline <redacted> placeholder stripped from FTS query (final-review follow-up)", async () => {
  const embedCalls = [];
  const embedder = { embed: async (t) => { embedCalls.push(t); return new Float32Array([0.1, 0.2, 0.3]); }, dim: 3, modelId: "m" };
  const seen = [];
  const storage = { search: async (emb, o) => { seen.push(o); return []; } };
  const r = new Recall({
    embeddings: embedder, storage, topK: 3, minScore: 0.35, key: "project-key",
    getUserMessageCount: async () => 1, branchContext: false,
  });
  // sanitize() (внутри maskTranscript) маскирует key=value инлайн: → <redacted>.
  await r.onChatMessage({ sessionID: "s1", text: "какой хост у POSTGRES_PASSWORD=secret123" });
  assert.equal(embedCalls.length, 1);
  assert.ok(embedCalls[0].includes("<redacted>"), "embed: полный masked (инлайн-плейсхолдер сохранён)");
  assert.ok(!seen[0].query.includes("<redacted>"), "FTS-нога: <redacted>-токен вырезан");
  assert.ok(seen[0].query.includes("POSTGRES_PASSWORD"), "ключ остаётся в FTS-тексте");
});

test("recall hybrid: all-masked multi-line query → vector-only (ftsQuery empty)", async () => {
  const embedCalls = [];
  const embedder = { embed: async (t) => { embedCalls.push(t); return new Float32Array([0.1, 0.2, 0.3]); }, dim: 3, modelId: "m" };
  const seen = [];
  const storage = { search: async (emb, o) => { seen.push(o); return []; } };
  const r = new Recall({
    embeddings: embedder, storage, topK: 3, minScore: 0.35, key: "project-key",
    getUserMessageCount: async () => 1, branchContext: false,
    confidentialPatterns: ["docs/confidential/**"],
  });
  await r.onChatMessage({ sessionID: "s1", text: "docs/confidential/a.md\ndocs/confidential/b.md" });
  assert.equal(seen.length, 1, "поиск выполняется (векторный fallback)");
  assert.equal(seen[0].query, "", "FTS-текст пуст → FTS-нога не выполняется");
});

test("recall hybrid: branch scope × FTS — out-of-context FTS-only hit dropped, merged kept (spec §4)", async () => {
  const storage = {
    candidates: async () => [
      { session_id: "a", merged: 1, head: "" },
      { session_id: "d", merged: 0, head: "hd" },
    ],
    search: async (emb, o) => {
      assert.equal(o.query, "hello feature", "FTS-нога передана и в branch-scope пути");
      return [
        { entry: { session_id: "a", title: "A", summary: "SA", decisions: [], author: "a", time_last: 1, origin_project_hash: "k", merged: 1 }, score: 0.5 },
        { entry: { session_id: "d", title: "D", summary: "SD", decisions: [], author: "a", time_last: 2, origin_project_hash: "k", merged: 0 }, score: 0.5 },
      ];
    },
  };
  const r = new Recall({
    embeddings: mkDeps().embedder, storage, topK: 3, minScore: 0.35, key: "project-key",
    getUserMessageCount: async () => 1, branchContext: true,
    git: {
      revList: (root, ref) => (ref === "HEAD" ? new Set(["hb"]) : new Set()),
      detectMainline: () => ({ name: "main" }),
    },
    root: "/tmp/x",
  });
  await r.onChatMessage({ sessionID: "s1", text: "hello feature" });
  const block = await r.systemBlock({ sessionID: "s1" });
  assert.ok(block.includes("A"), "merged sibling (в членстве) FTS-only хит сохранён");
  assert.ok(!block.includes("D"), "FTS-only хит вне branch-context отброшен");
});
