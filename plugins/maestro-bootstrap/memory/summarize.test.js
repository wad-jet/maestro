import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSummary, summarizeSession, SESSIONS } from "./summarize.js";

test("parseSummary strips fences", () => {
  const r = parseSummary('```json\n{"title":"t","summary":"s","decisions":["d"]}\n```');
  assert.equal(r.title, "t");
  assert.deepEqual(r.decisions, ["d"]);
});
test("parseSummary rejects invalid", () => {
  assert.throws(() => parseSummary("not json"), /invalid/i);
});
test("summarizeSession creates+prompts+deletes, registers session", async () => {
  const created = { id: "sm1" };
  const client = {
    session: {
      create: async () => created,
      prompt: async ({ path, body }) => {
        assert.equal(path.id, "sm1");
        assert.equal(body.noReply, true);
        assert.deepEqual(body.model, { providerID: "prov", modelID: "m1" });
        assert.equal(body.parts[0].type, "text");
        return { info: {}, parts: [{ type: "text", text: '{"title":"t","summary":"s","decisions":["d"]}' }] };
      },
      delete: async ({ path }) => { assert.equal(path.id, "sm1"); },
    },
  };
  const out = await summarizeSession({ client, sessionID: "orig", transcript: "x", model: "prov/m1", summarizerModel: null });
  assert.equal(out.title, "t");
  assert.ok(SESSIONS.has("sm1"));
});
test("summarizerModel overrides model", async () => {
  const client = {
    session: {
      create: async () => ({ id: "sm2" }),
      prompt: async ({ body }) => { assert.deepEqual(body.model, { providerID: "other", modelID: "m2" }); return { info: {}, parts: [{ type: "text", text: '{"title":"t","summary":"s","decisions":[]}' }] }; },
      delete: async () => {},
    },
  };
  const out = await summarizeSession({ client, sessionID: "orig", transcript: "x", model: "prov/m1", summarizerModel: "other/m2" });
  assert.equal(out.title, "t");
});
