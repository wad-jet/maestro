import { test } from "node:test";
import assert from "node:assert/strict";
import { maskTranscript, maskEntry } from "./mask.js";

test("maskTranscript masks key=value", () => {
  const out = maskTranscript("API_KEY=secret123\nrest", { confidentialPatterns: [] });
  assert.ok(!out.includes("secret123"));
  assert.ok(out.includes("API_KEY"));
});

test("maskTranscript hides confidential lines", () => {
  const out = maskTranscript(
    "line1\ndocs/confidential/x.md: content here\nline2",
    { confidentialPatterns: ["docs/confidential/**"] }
  );
  assert.ok(!out.includes("content here"));
  assert.ok(out.includes("[confidential]"));
  assert.ok(!out.includes("docs/confidential"));
});

test("maskTranscript respects .env pattern", () => {
  const out = maskTranscript(".env: SECRET=x\nother", { confidentialPatterns: ["*.env"] });
  assert.ok(out.includes("[confidential]"));
  assert.ok(!out.includes("SECRET=x"));
  assert.ok(out.includes("other"));
});

test("maskTranscript case-insensitive glob match", () => {
  const out = maskTranscript(
    "Docs/Confidential/x.md: hidden\nnormal line",
    { confidentialPatterns: ["docs/confidential/**"] }
  );
  assert.ok(out.includes("[confidential]"));
  assert.ok(!out.includes("Docs/Confidential"));
});

test("maskTranscript no false positive on similar name", () => {
  const out = maskTranscript(
    "docs/confidentialx.md: content\nother",
    { confidentialPatterns: ["docs/confidential/**"] }
  );
  // confidentialx.md does NOT match docs/confidential/**
  assert.ok(out.includes("docs/confidentialx.md: content"));
});

test("maskEntry masks text fields", () => {
  const e = { title: "API_KEY=abc", summary: "ok", decisions: ["x"] };
  const out = maskEntry(e, { confidentialPatterns: [] });
  assert.ok(!out.title.includes("abc"));
  assert.equal(out.summary, "ok");
});

test("maskEntry preserves keys and masks secrets in values", () => {
  const e = { title: "API_KEY=abc", summary: "ok", decisions: ["x"] };
  const out = maskEntry(e, { confidentialPatterns: [] });
  assert.equal(out.title, "API_KEY=<redacted>");
  assert.equal(out.summary, "ok");
  assert.equal(out.decisions[0], "x");
});

test("maskEntry masks confidential lines", () => {
  const e = { title: "docs/confidential/x.md: secret", summary: "normal", decisions: ["README.md"] };
  const out = maskEntry(e, { confidentialPatterns: ["docs/confidential/**"] });
  assert.ok(out.title.includes("[confidential]"));
  assert.ok(!out.title.includes("secret"));
  assert.equal(out.summary, "normal");
});

// ── Task 7 (v5.2): artifacts filter (F2) ───────────────────────────────

test("maskEntry drops artifacts matching confidential patterns (F2)", () => {
  const e = { title: "t", summary: "s", decisions: [], artifacts: ["docs/confidential/x.md", "docs/spec.md"] };
  const out = maskEntry(e, { confidentialPatterns: ["docs/confidential/**"] });
  assert.deepEqual(out.artifacts, ["docs/spec.md"], "confidential artifacts dropped (masked path is useless as pointer)");
});

test("maskEntry artifacts filter uses artifactConfidentialPatterns when provided (F2)", () => {
  const e = { title: "t", summary: "s", decisions: [], artifacts: [".env", "docs/spec.md"] };
  const out = maskEntry(e, { confidentialPatterns: [], artifactConfidentialPatterns: [".env"] });
  assert.deepEqual(out.artifacts, ["docs/spec.md"], "artifactConfidentialPatterns applied to artifacts only");
});

test("maskEntry keeps artifacts when no patterns match", () => {
  const e = { title: "t", summary: "s", decisions: [], artifacts: ["docs/spec.md", "src/index.js"] };
  const out = maskEntry(e, { confidentialPatterns: ["docs/confidential/**"] });
  assert.deepEqual(out.artifacts, ["docs/spec.md", "src/index.js"], "non-matching artifacts kept");
});
