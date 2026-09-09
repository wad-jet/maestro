import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSummary, summarizeSession, SESSIONS } from "./summarize.js";

test("parseSummary strips fences", () => {
  const r = parseSummary('```json\n{"title":"t","summary":"s","decisions":["d"]}\n```');
  assert.equal(r.title, "t");
  assert.deepEqual(r.decisions, ["d"]);
});
test("parseSummary strips bare markdown fence", () => {
  const r = parseSummary('```\n{"title":"t","summary":"s","decisions":[]}\n```');
  assert.equal(r.title, "t");
});
test("parseSummary extracts via brace matching", () => {
  const r = parseSummary('some prefix {"title":"t","summary":"s","decisions":["a","b"]} suffix');
  assert.equal(r.title, "t");
  assert.deepEqual(r.decisions, ["a", "b"]);
});
test("parseSummary rejects non-string decisions", () => {
  assert.throws(() => parseSummary('{"title":"t","summary":"s","decisions":[1]}'), /invalid/i);
});
test("parseSummary rejects invalid", () => {
  assert.throws(() => parseSummary("not json"), /invalid/i);
});
test("summarizeSession creates+prompts+deletes, session lifecycle in SESSIONS", async () => {
  assert.ok(!SESSIONS.has("sm1"));
  const client = {
    session: {
      create: async () => ({ data: { id: "sm1" } }),
      prompt: async ({ path, body }) => {
        assert.equal(path.id, "sm1");
        assert.ok(!("noReply" in body), "noReply must not be set");
        assert.deepEqual(body.model, { providerID: "prov", modelID: "m1" });
        assert.equal(body.parts[0].type, "text");
        // I1: assert membership inside prompt (before finally runs)
        assert.ok(SESSIONS.has("sm1"));
        return { data: { info: {}, parts: [{ type: "text", text: '{"title":"t","summary":"s","decisions":["d"]}' }] } };
      },
      delete: async () => ({ data: {} }),
    },
  };
  const out = await summarizeSession({ client, sessionID: "orig", transcript: "x", model: "prov/m1", summarizerModel: null });
  assert.equal(out.title, "t");
  // I1: assert absence after call completes (finally removed it)
  assert.ok(!SESSIONS.has("sm1"));
});
test("summarizerModel overrides model", async () => {
  const client = {
    session: {
      create: async () => ({ data: { id: "sm2" } }),
      prompt: async ({ body }) => { assert.deepEqual(body.model, { providerID: "other", modelID: "m2" }); return { data: { info: {}, parts: [{ type: "text", text: '{"title":"t","summary":"s","decisions":[]}' }] } }; },
      delete: async () => ({ data: {} }),
    },
  };
  const out = await summarizeSession({ client, sessionID: "orig", transcript: "x", model: "prov/m1", summarizerModel: "other/m2" });
  assert.equal(out.title, "t");
  assert.ok(!SESSIONS.has("sm2"));
});
test("summarizeSession throws when create returns no id", async () => {
  const client = {
    session: {
      create: async () => ({}),
      prompt: async () => {},
      delete: async () => {},
    },
  };
  await assert.rejects(
    summarizeSession({ client, sessionID: "x", transcript: "t", model: "a/b", summarizerModel: null }),
    /no id/
  );
});
test("summarizeSession throws when neither model parses", async () => {
  const client = {
    session: {
      create: async () => ({ data: { id: "sm3" } }),
      prompt: async () => {},
      delete: async () => {},
    },
  };
  await assert.rejects(
    summarizeSession({ client, sessionID: "x", transcript: "t", model: "nodslash", summarizerModel: null }),
    /cannot resolve summarizer model/
  );
});
test("summarizeSession throws on empty text response", async () => {
  const client = {
    session: {
      create: async () => ({ data: { id: "sm4" } }),
      prompt: async () => ({ data: { info: {}, parts: [] } }),
      delete: async () => ({ data: {} }),
    },
  };
  await assert.rejects(
    summarizeSession({ client, sessionID: "x", transcript: "t", model: "a/b", summarizerModel: null }),
    /no text/
  );
});
