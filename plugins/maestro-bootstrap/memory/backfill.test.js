import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { reindexSessionArtifacts } from "./backfill.js";
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