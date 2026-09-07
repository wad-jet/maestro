# Maestro Memory Layer v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the maestro memory layer with management (status/forget/dry-run), search quality (FTS5 hybrid + filters), operations (export/import, retention, sqlite-vec removal, git-config dedup), and visualization (aggregate HTML report).

**Architecture:** New storage ops (`deleteByFilter`, `prune`, `stats(key)`, `scan(key)`, FTS5 hybrid search), new tools (`memory_forget`, `memory_export/import`, `memory_recall_preview`, `memory_stats_detail`), two commands (`@maestro-memory`, `@maestro-memory-report`). No schema change (granularity → v3). Security: import re-masks + `ask` permission; report aggregates-only (SEC-4b).

**Tech Stack:** Node ESM, better-sqlite3 (FTS5), node:test; existing `plugins/maestro-bootstrap/memory/` module.

**Spec:** `docs/superpowers/specs/2026-09-07-maestro-memory-v2-design.md`

## Global Constraints

- Base: branch `feature/maestro-memory-v2` (stacked on v1). Do NOT modify v1 behavior without spec mandate.
- Plugin invariants: hooks global + try/catch-guarded; `experimental.chat.messages.transform` stays `undefined`; zero-dep default (memory deps only on `enabled: true`).
- Permission rule (spec §2.1 A2): `permission: { memory_forget: "ask", memory_export: "ask", memory_import: "ask" }` in merge-config; canon in `skills/maestro-assistant/SKILL.md` + `manual_docs/reference/config.md`.
- New tools unavailable to `[maestro-memory]` sessions (SESSIONS gate, like `memory_search`).
- `deleteByFilter`/`stats(key)`/`scan(key)` strictly key-scoped (shared backends qdrant/pg).
- Import: re-mask each entry (double-masking, `maskEntry`) before upsert; atomic validation (model_id/dim); permission `ask`.
- Report: aggregates only (SEC-4b); `include_text: false` default — no summary text in HTML.
- sqlite-vec removed (C3): package.json devDeps, provision.js manifest, provision.test.js, docs.
- Russian user-facing messages. Docs sync (manual_docs, SECURITY.md §5a, AGENTS.md, changelog) — acceptance criteria.

---

### Task 1: storage — deleteByFilter (key-scoped) + prune on all backends

**Files:**
- Modify: `plugins/maestro-bootstrap/memory/storage/sqlite.js`, `storage/qdrant.js`, `storage/pgvector.js`, `memory/storage.js` (interface)
- Test: `plugins/maestro-bootstrap/memory/storage.test.js`, `storage/qdrant.test.js`, `storage/pgvector.test.js`

**Interfaces:**
- Consumes: existing `MemoryStorage` interface.
- Produces: `deleteByFilter({ key, session_id?, author?, before? }) → number` (count deleted); `prune({ key, olderThanDays }) → number`. Key REQUIRED (throws if missing) — isolation invariant.

- [ ] **Step 1: Failing tests** (add to each backend test):

```js
test("deleteByFilter deletes within key", async () => {
  const st = createStorage({ type: "sqlite", options: { dbPath: ":memory:" }, modelId: "m", dim: 3 });
  await st.init();
  await st.upsert([mkEntry("s1", "k1", "t1", { author: "alice" }), mkEntry("s2", "k2", "t2", { author: "alice" })]);
  const n = await st.deleteByFilter({ key: "k1", author: "alice" });
  assert.equal(n, 1);
  const hits = await st.search(new Float32Array([0.1,0.2,0.3]), { top_k: 5, min_score: 0, key: "k1" });
  assert.equal(hits.length, 0);
  const hits2 = await st.search(new Float32Array([0.1,0.2,0.3]), { top_k: 5, min_score: 0, key: "k2" });
  assert.equal(hits2.length, 1);
});
test("deleteByFilter before date", async () => {
  // s1 time_last=100 (old), s2 time_last=1000 → delete before: 500 removes s1 only
});
test("deleteByFilter requires key", async () => {
  await assert.rejects(() => st.deleteByFilter({ author: "a" }), /key required/);
});
test("prune removes entries older than days", async () => {
  // s1 time_last = now - 40d, s2 time_last = now → prune(30) removes s1, keeps s2
});
```

- [ ] **Step 2:** Run — FAIL.
- [ ] **Step 3:** Implement. sqlite: `DELETE FROM memory WHERE key=? AND (session_id=?|author=?|time_last<=?)` with dynamic conditions; return `info.changes`. qdrant: `client.delete(collection, { filter: { must: [key, ...conds] } })`; count via `client.count` with same filter (before delete). pgvector: `DELETE FROM table WHERE key=$1 AND ... RETURNING session_id` → count rows. `prune`: filter `time_last < now - days*86400_000` (+ key).
- [ ] **Step 4:** Run — PASS (all backends + storage.test.js).
- [ ] **Step 5:** Commit: `feat(memory): deleteByFilter + prune storage ops (key-scoped)`

---

### Task 2: retention config + startup prune

**Files:**
- Modify: `plugins/maestro-bootstrap/memory/config.js`, `memory/index.js`, `memory/indexer.js` (call prune on startup)
- Test: `config.test.js`, `index.test.js`

**Interfaces:**
- Consumes: `prune` from Task 1, `loadMemoryConfig`.
- Produces: `config.retention_days` (null default); `indexer.onStartup` calls `storage.prune({ key, olderThanDays })` when set, logs count.

- [ ] **Step 1:** Failing test: config with `retention_days: 30` → retained; default null. Indexer startup with retention → prune called.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** Implement: add `retention_days: null` to DEFAULTS + validation (number/null). In `registerMemoryHooks`, after `indexer.onStartup()`, if `config.retention_days` → `const n = await storage.prune({ key: effectiveKey, olderThanDays: config.retention_days }); if (n) log.info("memory: retention pruned", { count: n })`.
- [ ] **Step 4:** PASS.
- [ ] **Step 5:** Commit: `feat(memory): retention policy (default off)`

---

### Task 3: FTS5 hybrid search (sqlite)

**Files:**
- Modify: `plugins/maestro-bootstrap/memory/storage/sqlite.js`
- Test: `plugins/maestro-bootstrap/memory/storage.test.js`

**Interfaces:**
- Consumes: existing sqlite storage.
- Produces: FTS5 table `memory_fts(session_id UNINDEXED, title, summary, decisions)`; backfill on init; sync on upsert/delete/deleteByFilter/prune; hybrid search in `search()` (when `fts: true` option or default) using RRF fusion (k=60): vector top-k + FTS MATCH top-k merged.

- [ ] **Step 1:** Failing tests:
```js
test("fts backfill indexes existing entries", async () => {
  // upsert s1/s2, re-init storage (new instance same dbPath) → hybrid search finds s1 by keyword
});
test("hybrid search returns FTS match even with low vector similarity", async () => {
  // s1 title "Auth refactor", embedding far from query; query "refactor" → FTS match surfaced in results
});
test("fts stays in sync after deleteByFilter/prune", async () => {
  // delete s1 → hybrid search for its keyword no longer returns it
});
```
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** Implement:
  - init: `CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(session_id UNINDEXED, title, summary, decisions)`. Backfill: `INSERT OR IGNORE INTO memory_fts SELECT session_id, title, summary, decisions FROM memory` — log count.
  - upsert: `INSERT OR REPLACE INTO memory_fts ...` (decisions = `decisions.join(" ")`).
  - delete/deleteByFilter/prune: delete matching FTS rows by session_id (collect session_ids, `DELETE FROM memory_fts WHERE session_id IN (...)`).
  - search: when `query` text present, run `SELECT session_id, bm25(memory_fts) as rank FROM memory_fts WHERE memory_fts MATCH ? AND key=?` — NOTE: FTS table has no key column; add `key UNINDEXED` to FTS schema. Match: quoted tokens + `*` prefix (`"term"*`). If MATCH syntax error → fallback vector-only + log.
  - Fusion: vector hits (top_k) + fts hits (top_k) → RRF `score = Σ 1/(60+rank)`; keep `entry.score` = vector cosine for display, rank-merge by RRF.
- [ ] **Step 4:** PASS (existing tests too).
- [ ] **Step 5:** Commit: `feat(memory): FTS5 hybrid search (RRF) with backfill+sync`

---

### Task 4: search filters (date/author/project) + cross-project (centralized)

**Files:**
- Modify: `plugins/maestro-bootstrap/memory/storage.js`, `storage/sqlite.js`, `storage/qdrant.js`, `storage/pgvector.js`, `memory/index.js` (memory_search tool), `memory/recall.js` (no change — recall stays single-key)
- Test: storage tests + `index.test.js`

**Interfaces:**
- Produces: `search(embedding, { top_k, min_score, key, date_from?, date_to?, author?, project? })`. `project` semantics: namespace | git-remote/URL (canonicalize+hash via `project.js`) | project_hash. Cross-project: qdrant/pg — search with `key`-list filter (or omit key, add `key IN (...)`); sqlite — cross-project NOT supported in v2 (per spec §2.2 B2: centralized-only preference); if `project` given on sqlite → return error "кросс-проектный поиск доступен только для централизованных бэкендов".

- [ ] **Step 1:** Failing tests:
```js
test("search filters by date range", async () => {
  // s1 time_last=100, s2 time_last=1000; date_from=500 → only s2
});
test("search filters by author", async () => { /* author: "alice" */ });
test("search with project on centralized returns cross-key results", async () => {
  // qdrant mock: search called with filter including key OR key IN — assert no key must on result
});
test("search project on sqlite throws clear error", async () => {
  await assert.rejects(() => sqliteSt.search(v, { key: "k1", project: "other" }), /централизованн/i);
});
```
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** Implement per backend. `project` → resolve to key hash (via `canonicalizeRemote`/`projectHashFromRemote` if URL) → add to conditions.
- [ ] **Step 4:** PASS.
- [ ] **Step 5:** Commit: `feat(memory): search filters (date/author/project, cross-project centralized-only)`

---

### Task 5: storage stats(key) + scan(key)

**Files:**
- Modify: `memory/storage.js`, `storage/sqlite.js`, `storage/qdrant.js`, `storage/pgvector.js`
- Test: storage tests

**Interfaces:**
- Produces: `stats({ key }) → { entries }` (key-scoped); `scan({ key, fields?: ["title","author","time_last","embedding","origin_project_hash"] }) → entries[]` (for clusters/report). All key-required.

- [ ] **Step 1:** Failing tests: stats(key) returns per-key count on sqlite/qdrant/pg (mock count with filter); scan returns requested fields only.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** Implement. sqlite: `SELECT COUNT(*) WHERE key=?`; qdrant: `client.count(collection, { filter: { must: [{key:"key", match:{value}}] } })`; pg: `SELECT count(*) FROM t WHERE key=$1`. scan: sqlite SELECT with fields; qdrant `client.scroll(collection, { filter, limit: 10000, with_payload: true })`; pg SELECT.
- [ ] **Step 4:** PASS.
- [ ] **Step 5:** Commit: `feat(memory): key-scoped stats + scan ops`

---

### Task 6: memory_forget tool + permission rule

**Files:**
- Modify: `plugins/maestro-bootstrap/memory/index.js` (register tools), `memory/index.test.js`
- Modify: `manual_docs/reference/config.md` (permission rule), `skills/maestro-assistant/SKILL.md` (canon)
- Test: `memory/index.test.js`

**Interfaces:**
- Consumes: `deleteByFilter` (Task 1), SESSIONS gate.
- Produces: tool `memory_forget({ session_id?, author?, before? })` → count string. Empty filter → validation error (Minor-1 from spec). Excluded for `[maestro-memory]` sessions.

- [ ] **Step 1:** Failing tests:
```js
test("memory_forget deletes by filter", async () => {
  // registerMemoryHooks with memory enabled + sqlite; call tool.execute with {author:"alice"} → returns count
});
test("memory_forget empty filter errors", async () => {
  // {} → throws/returns "укажите session_id, author или before"
});
test("memory_forget blocked for summarizer sessions", async () => {
  // ctx.sessionID in SESSIONS → "недоступен"
});
```
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** Implement tool in `index.js` `toolHooks` (pattern from `memory_search`). Empty filter → return error string (validation).
- [ ] **Step 4:** PASS.
- [ ] **Step 5:** Commit: `feat(memory): memory_forget tool + permission rule`

---

### Task 7: memory_export / memory_import

**Files:**
- Modify: `plugins/maestro-bootstrap/memory/index.js`, `memory/index.test.js`, `memory/mask.js` (reuse maskEntry)
- Test: `memory/index.test.js`

**Interfaces:**
- Produces: `memory_export({ path? }) → "экспортировано N записей в <path>"`; `memory_import({ path, replace? }) → "импортировано N записей"`.
- Export: JSONL full schema v1 incl `embedding` (Array.from), `model_id`; default path `<dataDir>/maestro/memory/export-<sanitizeDirName(key)>-<ts>.jsonl`; confidential project → warning line.
- Import: read+parse JSONL; validate schema + model_id/dim (atomic — validate all first); **re-mask each entry** (maskEntry); upsert; replace → deleteByFilter({key}) first. Errors → atomic (nothing imported).

- [ ] **Step 1:** Failing tests:
```js
test("export writes JSONL with embedding; import round-trips", async () => {
  // seed storage; export to temp path; import into fresh storage; search finds entry
});
test("import re-masks secrets in JSONL", async () => {
  // JSONL entry summary "API_KEY=secret123" → after import, storage summary has no "secret123"
});
test("import invalid model_id fails atomically", async () => {
  // JSONL with wrong model_id → import rejects, storage unchanged
});
test("import requires permission ask (invoked without permission → blocked)", async () => {
  // tool.execute via hooks → returns "недоступен без подтверждения" when permission missing
});
```
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** Implement. `maskEntry` already exists (v1). Atomic import: parse+validate all, then re-mask+upsert in transaction where possible (sqlite), else all-or-error before any upsert.
- [ ] **Step 4:** PASS.
- [ ] **Step 5:** Commit: `feat(memory): export/import JSONL with re-mask + atomic validation`

---

### Task 8: memory_recall_preview + memory_stats_detail tools

**Files:**
- Modify: `plugins/maestro-bootstrap/memory/index.js`, `memory/index.test.js`
- Test: `memory/index.test.js`

**Interfaces:**
- Produces: `memory_recall_preview({ query }) → top-k with scores + sources` (dry-run; same path as recall: embed → search top_k); `memory_stats_detail() → { entries, by_author: {...}, by_date: {bucket: count}, clusters: [{size, theme}], graph: [[session_a, session_b, score]] }` — clustering + O(n²) cosine computed in the tool via `scan(key)`.

- [ ] **Step 1:** Failing tests:
```js
test("memory_recall_preview returns scored hits", async () => { /* embed + search, returns score+title+author */ });
test("memory_stats_detail clusters via scan", async () => {
  // storage with 3 similar + 1 different entries → 2 clusters (sizes), theme strings present
});
test("memory_stats_detail graph edges above threshold", async () => { /* cosine > similarity_threshold */ });
```
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** Implement. `memory_stats_detail`: `scan({key, fields:["title","embedding","author","time_last","origin_project_hash"]})`; clustering — simple greedy: for each unassigned entry, group entries with cosine > `similarity_threshold` (0.7 default); theme = representative title (LLM labels in command, tool returns raw). Graph: pairwise cosine pairs > threshold, capped (e.g., 500 pairs).
- [ ] **Step 4:** PASS.
- [ ] **Step 5:** Commit: `feat(memory): recall preview + stats detail tools`

---

### Task 9: @maestro-memory command

**Files:**
- Create: `commands/maestro-memory.md`
- Test: manual (command content reviewed); `memory/index.test.js` covers the underlying `memory_stats_detail`.

**Interfaces:**
- Consumes: `memory_stats_detail`, config, storage.stats(key).
- Produces: user-facing status via agent: backend, model, entries (key-scoped), last indexed, errors count, paths, active key, tuning hints. Aggregates only (SEC-4b).

- [ ] **Step 1:** Write `commands/maestro-memory.md` (Russian): instructs agent to call `memory_stats_detail` + config; output format (aggregates); note when memory disabled (tools absent → friendly message).
- [ ] **Step 2:** Verify frontmatter (agent: default/primary), references `manual_docs/how-to/enable-memory.md` for tuning.
- [ ] **Step 3:** Commit: `feat(commands): @maestro-memory status command`

---

### Task 10: @maestro-memory-report command

**Files:**
- Create: `commands/maestro-memory-report.md`
- Modify: `plugins/maestro-bootstrap/memory/index.js` (if report needs a dedicated tool — reuse `memory_stats_detail`)
- Test: manual + verify aggregates-only via `memory_stats_detail` (no summary text when include_text false).

**Interfaces:**
- Produces: static HTML at `.maestro/memory-report-<sanitizeDirName(key)>-<ts>.html` — aggregates: timeline histogram (by_date), cluster sizes+themes, author stats, backend/model/entries, graph. NO summary/decisions text when `include_text: false`.

- [ ] **Step 1:** Write `commands/maestro-memory-report.md`: agent calls `memory_stats_detail`, renders HTML (self-contained, inline CSS/JS), writes to `.maestro/`. `include_text: true` (config) → may embed masked titles (NOT summary/decisions — per spec, masked titles allowed at `memory_search` exposure class; summary only if `include_text: true` AND explicitly documented downgrade — spec allows masked summaries at include_text true).
- [ ] **Step 2:** Verify config read (report.include_text), SEC-4b compliance in instructions.
- [ ] **Step 3:** Commit: `feat(commands): @maestro-memory-report command (aggregates)`

---

### Task 11: remove sqlite-vec

**Files:**
- Modify: `package.json` (remove devDep), `plugins/maestro-bootstrap/memory/provision.js` (manifest DEPS), `provision.test.js`, `manual_docs/reference/memory.md`, `manual_docs/how-to/enable-memory.md`, `docs/superpowers/specs/2026-09-06-maestro-memory-design.md` (v1 spec — historical; leave, note)
- Test: `npm run test:memory` green; `provision.test.js` manifest no sqlite-vec.

- [ ] **Step 1:** Failing test: provision manifest must NOT contain sqlite-vec.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** Remove from all listed files.
- [ ] **Step 4:** PASS (full memory suite).
- [ ] **Step 5:** Commit: `chore(memory): remove unused sqlite-vec dependency`

---

### Task 12: git-config dedup

**Files:**
- Modify: `plugins/maestro-bootstrap/core.js`, `memory/index.js`
- Test: core tests still green; verify single gitConfig call.

**Interfaces:**
- Produces: one `execSync("git config ...")` per init (core `user.name` + memory `user.name` + `remote.origin.url` → 1 call or cached result), cached in closure.

- [ ] **Step 1:** Test: spy on execSync count during plugin init with memory enabled → ≤1 git-config call.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** Implement: in core.js/memory/index.js, run one `git config --get user.name` (and reuse for both) + `remote.origin.url` in the same subprocess invocation if possible; cache.
- [ ] **Step 4:** PASS.
- [ ] **Step 5:** Commit: `perf(memory): deduplicate git-config calls`

---

### Task 13: E2E checklist (real Bun run) + ask-gate verification

**Files:**
- Modify: `docs/testing/maestro-sandbox-checklist.md`
- Test: manual checklist; `memory/index.test.js` (ask-gate)

**Interfaces:**
- Produces: checklist section for real-Bun run: enable memory in sandbox, run one opencode session, assert memory.db created + memory_search works + memory_forget ask-gate triggers.

- [ ] **Step 1:** Add checklist section (Russian): steps + expected outcomes.
- [ ] **Step 2:** Add test: `memory_forget` invoked without permission → blocked (already in Task 6; ensure permission object path tested).
- [ ] **Step 3:** Commit: `test(memory): real-Bun E2E checklist + ask-gate coverage`

---

### Task 14: docs sync (manual_docs, SECURITY.md, canon, changelog)

**Files:**
- Modify: `manual_docs/reference/memory.md`, `manual_docs/how-to/enable-memory.md`, `manual_docs/reference/config.md` (permission rule), `manual_docs/explanation/agents-and-trust.md` (export boundary, report aggregates), `manual_docs/reference/model-selection.md` (unchanged — verify), `skills/maestro-assistant/SKILL.md` (canon: new keys + write/boundary ask rule), `skills/maestro-new/SKILL.md` (no change — verify), `README.md`, `plugins/maestro-bootstrap/README.md`, `SECURITY.md` (§5a: import write-path, export boundary, report aggregates, cross-project opt-in), `AGENTS.md` (new commands), `manual_docs/overview/changelog.md` (v2 entry), `docs/project-context.md` (§5/§14)

**Interfaces:**
- Consumes: all v2 behavior.
- Produces: docs consistent with actual implementation (verify against code).

- [ ] **Step 1:** Update reference/memory.md — new tools, commands, config keys (retention_days, similarity_threshold, report.include_text), hybrid search, filters, cross-project.
- [ ] **Step 2:** Update how-to — retention, export/import, report, tuning via dry-run.
- [ ] **Step 3:** Update config.md — new keys + permission rule.
- [ ] **Step 4:** Update SECURITY.md §5a — import write-path (re-mask+ask), export local boundary, report aggregates, cross-project opt-in; write/boundary-tools canon.
- [ ] **Step 5:** Update canon (maestro-assistant SKILL.md), README, plugin README, AGENTS.md, changelog, project-context.
- [ ] **Step 6:** Cross-link check (`rg "memory_forget|@maestro-memory-report|retention_days" manual_docs/`).
- [ ] **Step 7:** Commit: `docs(memory): v2 full documentation sync`

---

## Self-Review

**Spec coverage:**
- §2.1 A1 (@maestro-memory) → Task 9; A2 (memory_forget) → Task 6; A3 (preview) → Task 8.
- §2.2 B1 (FTS hybrid) → Task 3; B2 (filters/cross-project) → Task 4.
- §2.3 C1 (export/import) → Task 7; C2 (retention) → Task 2; C3 (sqlite-vec) → Task 11; C4 (Bun E2E) → Task 13; C5 (git dedup) → Task 12.
- §2.4 D1/D2 (report+graph) → Tasks 8, 10.
- §3 (config) → Tasks 2, 10; §4 (security) → Tasks 6, 7, 10 (permission, re-mask, aggregates) + Task 14 (docs).
- §5 (degradation) → Task 3 (FTS fallback), Task 7 (atomic import).
- §6 (tests) → each task.
- §7 (docs) → Task 14; §8 (context) → Task 14.

**Placeholder scan:** no TBD/TODO; concrete code in storage/tool tasks. Cross-project sqlite decision per spec §2.2 B2 (centralized-only preference) — implemented as error on sqlite (explicit spec choice).

**Type consistency:** `deleteByFilter({key, ...}) → number`, `prune({key, olderThanDays}) → number`, `stats({key})`, `scan({key, fields})` consistent across Tasks 1-5, 6-8. `memory_stats_detail` consumed by Tasks 9-10. `maskEntry` reused in Task 7.

**Minor follow-ups from spec review carried into plan:** empty memory_forget filter → validation error (Task 6); export path notation `<dataDir>/maestro/memory/` (Task 7); @maestro-memory when disabled → friendly message (Task 9).

**Regression risk (pipeline step 11):** additive to memory module; no schema change. Shared-file changes: core.js (git dedup), package.json (remove sqlite-vec), docs. Baseline `npm test` (174) + `npm run test:memory` (129) guard. No migration/breaking → no regression entry.