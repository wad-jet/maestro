import { test } from "node:test";
import assert from "node:assert/strict";
import { maskTranscript, maskEntry } from "./mask.js";

// ── Generic sanitize (regex Ур.1: key=value, .env, PEM, PII) ───────────────
// Memory НЕ маскирует бизнес-confidential (D3/SEC-5: риск признан) — только
// generic-sanitize технических секретов. Line-level confidential-фильтр
// (maskLines) удалён.

test("maskTranscript masks key=value", () => {
  const out = maskTranscript("API_KEY=secret123\nrest");
  assert.ok(!out.includes("secret123"));
  assert.ok(out.includes("API_KEY"));
});

test("maskTranscript masks .env file reference (generic sanitize)", () => {
  const out = maskTranscript(".env: SECRET=x\nother");
  assert.ok(!out.includes("SECRET=x"));
  assert.ok(out.includes("other"));
});

test("maskTranscript masks PEM private key (generic sanitize)", () => {
  const pem = "-----BEGIN RSA PRIVATE KEY-----\nabc123body\n-----END RSA PRIVATE KEY-----";
  const out = maskTranscript(`line\n${pem}\nline2`);
  assert.ok(!out.includes("abc123body"));
  assert.ok(out.includes("<redacted>"));
});

test("maskTranscript masks PII data fields (generic sanitize)", () => {
  const out = maskTranscript("phone: +79990001122\nok");
  assert.ok(!out.includes("+79990001122"));
  assert.ok(out.includes("phone"));
});

test("maskTranscript leaves business text without secrets unmasked", () => {
  const out = maskTranscript("docs/roadmap.md сроки по фиче\nкакие сроки?");
  assert.ok(out.includes("docs/roadmap.md"), "бизнес-путь не маскируется");
  assert.ok(out.includes("какие сроки?"), "обычный текст не маскируется");
});

test("maskTranscript empty/whitespace → empty string", () => {
  assert.equal(maskTranscript(""), "");
  assert.equal(maskTranscript("   "), "");
});

test("maskEntry masks text fields", () => {
  const e = { title: "API_KEY=abc", summary: "ok", decisions: ["x"] };
  const out = maskEntry(e);
  assert.ok(!out.title.includes("abc"));
  assert.equal(out.summary, "ok");
});

test("maskEntry preserves keys and masks secrets in values", () => {
  const e = { title: "API_KEY=abc", summary: "ok", decisions: ["x"] };
  const out = maskEntry(e);
  assert.equal(out.title, "API_KEY=<redacted>");
  assert.equal(out.summary, "ok");
  assert.equal(out.decisions[0], "x");
});

test("maskEntry leaves business text without secrets unmasked", () => {
  const e = { title: "docs/roadmap.md: сроки", summary: "normal text", decisions: ["README.md"] };
  const out = maskEntry(e);
  assert.ok(out.title.includes("docs/roadmap.md"), "бизнес-путь в title не маскируется");
  assert.equal(out.summary, "normal text");
  assert.equal(out.decisions[0], "README.md");
});

// ── Artifacts: pass-through (artifact-drop по confidential-паттернам удалён) ─

test("maskEntry preserves artifacts as-is (no drop)", () => {
  const e = { title: "t", summary: "s", decisions: [], artifacts: ["docs/confidential/x.md", "docs/spec.md"] };
  const out = maskEntry(e);
  assert.deepEqual(out.artifacts, ["docs/confidential/x.md", "docs/spec.md"], "artifact-пути проходят без дропа");
});

test("maskEntry: absent artifacts → empty array", () => {
  const e = { title: "t", summary: "s", decisions: [] };
  const out = maskEntry(e);
  assert.deepEqual(out.artifacts, []);
});
