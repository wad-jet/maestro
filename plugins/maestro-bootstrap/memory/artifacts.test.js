import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { extractArtifacts } from "./artifacts.js";

// ── helpers ────────────────────────────────────────────────────────────────

function makeRoot(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "artifacts-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function writeMsg(filePath, { tool = "write", status = "completed" } = {}) {
  return {
    parts: [{ type: "tool", tool, state: { status, input: { filePath } } }],
  };
}

function touch(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, "x");
}

// ── extraction: write/edit completed ───────────────────────────────────────

test("extracts completed write path as repo-relative", (t) => {
  const root = makeRoot(t);
  const file = path.join(root, "docs", "spec.md");
  touch(file);
  const out = extractArtifacts([writeMsg(file)], { root, globs: ["docs/**"] });
  assert.deepEqual(out, ["docs/spec.md"]);
});

test("extracts completed edit path", (t) => {
  const root = makeRoot(t);
  const file = path.join(root, "docs", "spec.md");
  touch(file);
  const out = extractArtifacts([writeMsg(file, { tool: "edit" })], { root, globs: ["docs/**"] });
  assert.deepEqual(out, ["docs/spec.md"]);
});

test("relative input path resolves against root", (t) => {
  const root = makeRoot(t);
  const file = path.join(root, "docs", "spec.md");
  touch(file);
  const out = extractArtifacts([writeMsg("docs/spec.md")], { root, globs: ["docs/**"] });
  assert.deepEqual(out, ["docs/spec.md"]);
});

// ── M2: status gate ────────────────────────────────────────────────────────

test("write with status error → no artifact (M2)", (t) => {
  const root = makeRoot(t);
  const file = path.join(root, "docs", "spec.md");
  touch(file);
  const out = extractArtifacts([writeMsg(file, { status: "error" })], { root, globs: ["docs/**"] });
  assert.deepEqual(out, []);
});

test("write with status pending → no artifact (M2)", (t) => {
  const root = makeRoot(t);
  const file = path.join(root, "docs", "spec.md");
  touch(file);
  const out = extractArtifacts([writeMsg(file, { status: "pending" })], { root, globs: ["docs/**"] });
  assert.deepEqual(out, []);
});

// ── D3: read excluded ──────────────────────────────────────────────────────

test("read part → no artifact (D3)", (t) => {
  const root = makeRoot(t);
  const file = path.join(root, "docs", "spec.md");
  touch(file);
  const out = extractArtifacts([writeMsg(file, { tool: "read" })], { root, globs: ["docs/**"] });
  assert.deepEqual(out, []);
});

// ── realpath: symlinked root ───────────────────────────────────────────────

test("realpath: symlinked root still yields repo-relative paths", (t) => {
  const real = makeRoot(t);
  const link = path.join(os.tmpdir(), `artifacts-link-${process.pid}-${Date.now()}`);
  fs.symlinkSync(real, link);
  t.after(() => fs.rmSync(link, { force: true }));
  const file = path.join(link, "docs", "spec.md");
  touch(file);
  const out = extractArtifacts([writeMsg(file)], { root: link, globs: ["docs/**"] });
  assert.deepEqual(out, ["docs/spec.md"]);
});

// ── I1: ENOENT ─────────────────────────────────────────────────────────────

test("ENOENT path skipped, others extracted (I1)", (t) => {
  const root = makeRoot(t);
  const a = path.join(root, "docs", "a.md");
  const b = path.join(root, "docs", "b.md");
  touch(a); // b intentionally missing
  const out = extractArtifacts([writeMsg(a), writeMsg(b)], { root, globs: ["docs/**"] });
  assert.deepEqual(out, ["docs/a.md"]);
});

// ── outside root / `..` segment ────────────────────────────────────────────

test("path outside root skipped", (t) => {
  const root = makeRoot(t);
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "artifacts-outside-"));
  t.after(() => fs.rmSync(outside, { recursive: true, force: true }));
  const file = path.join(outside, "x.md");
  touch(file);
  const out = extractArtifacts([writeMsg(file)], { root, globs: ["**"] });
  assert.deepEqual(out, []);
});

test("path with .. segment skipped", (t) => {
  const root = makeRoot(t);
  const file = path.join(root, "docs", "a.md");
  touch(file);
  const sneaky = path.join(root, "docs", "sub") + path.sep + ".." + path.sep + "a.md";
  const out = extractArtifacts([writeMsg(sneaky)], { root, globs: ["docs/**"] });
  assert.deepEqual(out, []);
});

// ── glob matching ──────────────────────────────────────────────────────────

test("glob-miss skipped", (t) => {
  const root = makeRoot(t);
  const file = path.join(root, "src", "a.js");
  touch(file);
  const out = extractArtifacts([writeMsg(file)], { root, globs: ["docs/**"] });
  assert.deepEqual(out, []);
});

test("case-insensitive glob match (confGlobMatch)", (t) => {
  const root = makeRoot(t);
  const file = path.join(root, "DOCS", "spec.md");
  touch(file);
  const out = extractArtifacts([writeMsg(file)], { root, globs: ["docs/**"] });
  assert.deepEqual(out, ["DOCS/spec.md"]);
});

// ── Z4: confidential ───────────────────────────────────────────────────────

test("confidential path skipped even when artifact glob matches (Z4)", (t) => {
  const root = makeRoot(t);
  const file = path.join(root, "docs", "confidential", "x.md");
  touch(file);
  const out = extractArtifacts([writeMsg(file)], {
    root,
    globs: ["docs/**"],
    confidentialPatterns: ["docs/confidential/**"],
  });
  assert.deepEqual(out, []);
});

test("default docs/confidential/** and built-in *.env patterns skip (I2)", (t) => {
  const root = makeRoot(t);
  const conf = path.join(root, "docs", "confidential", "x.md");
  const env = path.join(root, ".env");
  touch(conf);
  touch(env);
  const out = extractArtifacts([writeMsg(conf), writeMsg(env)], {
    root,
    globs: ["**"],
    confidentialPatterns: ["docs/confidential/**", "*.env"],
  });
  assert.deepEqual(out, []);
});

// ── CR-2: pathological paths ───────────────────────────────────────────────

test("relative path longer than 512 chars skipped (CR-2)", (t) => {
  const root = makeRoot(t);
  const deep = path.join(root, ...Array(60).fill("dir-name"), "a.md");
  touch(deep);
  assert.ok(path.relative(root, deep).length > 512);
  const out = extractArtifacts([writeMsg(deep)], { root, globs: ["**"] });
  assert.deepEqual(out, []);
});

test("path with control chars skipped (CR-2)", (t) => {
  const root = makeRoot(t);
  const file = path.join(root, "docs", "a\u0001b.md");
  touch(file);
  const out = extractArtifacts([writeMsg(file)], { root, globs: ["docs/**"] });
  assert.deepEqual(out, []);
});

// ── dedup / cap / empty globs / unavailable root ───────────────────────────

test("dedup first-seen", (t) => {
  const root = makeRoot(t);
  const file = path.join(root, "docs", "a.md");
  touch(file);
  const out = extractArtifacts([writeMsg(file), writeMsg(file)], { root, globs: ["docs/**"] });
  assert.deepEqual(out, ["docs/a.md"]);
});

test("cap 8 artifacts", (t) => {
  const root = makeRoot(t);
  const msgs = [];
  for (let i = 0; i < 10; i++) {
    const file = path.join(root, "docs", `f${i}.md`);
    touch(file);
    msgs.push(writeMsg(file));
  }
  const out = extractArtifacts(msgs, { root, globs: ["docs/**"] });
  assert.equal(out.length, 8);
  assert.deepEqual(out, Array.from({ length: 8 }, (_, i) => `docs/f${i}.md`));
});

test("empty globs → []", (t) => {
  const root = makeRoot(t);
  const file = path.join(root, "docs", "a.md");
  touch(file);
  const out = extractArtifacts([writeMsg(file)], { root, globs: [] });
  assert.deepEqual(out, []);
});

test("unavailable root → [] without throw", () => {
  const root = path.join(os.tmpdir(), `no-such-root-${process.pid}-${Date.now()}`);
  const out = extractArtifacts([writeMsg(path.join(root, "a.md"))], { root, globs: ["**"] });
  assert.deepEqual(out, []);
});

// ── robustness: malformed messages ─────────────────────────────────────────

test("messages without parts / state → [] without throw", (t) => {
  const root = makeRoot(t);
  const file = path.join(root, "docs", "a.md");
  touch(file);
  const out = extractArtifacts(
    [{}, { parts: [] }, { parts: [{ type: "tool", tool: "write" }] }, writeMsg(file)],
    { root, globs: ["docs/**"] },
  );
  assert.deepEqual(out, ["docs/a.md"]);
});