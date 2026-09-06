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
});

test("maskEntry masks text fields", () => {
  const e = { title: "API_KEY=abc", summary: "ok", decisions: ["x"] };
  const out = maskEntry(e, { confidentialPatterns: [] });
  assert.ok(!out.title.includes("abc"));
  assert.equal(out.summary, "ok");
});
