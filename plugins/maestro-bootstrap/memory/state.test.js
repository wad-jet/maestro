import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createState } from "./state.js";

test("state tracks fails and skip after 3", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mem-"));
  const st = createState(join(dir, "state.json"));
  assert.equal(await st.isSkipped("s1"), false);
  await st.recordFail("s1");
  await st.recordFail("s1");
  await st.recordFail("s1");
  assert.equal(await st.isSkipped("s1"), true);
  rmSync(dir, { recursive: true, force: true });
});

test("state persists and first-run", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mem-"));
  const p = join(dir, "state.json");
  const st = createState(p);
  await st.setSummarized("s2");
  const st2 = createState(p);
  assert.notEqual(await st2.getLastSummarized("s2"), null);
  assert.ok((await st2.getFirstRun()) > 0);
  rmSync(dir, { recursive: true, force: true });
});

test("state getLastAttempt returns last attempt or null", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mem-"));
  const st = createState(join(dir, "state.json"));
  assert.equal(await st.getLastAttempt("s3"), null);
  await st.recordFail("s3");
  assert.ok((await st.getLastAttempt("s3")) > 0);
  rmSync(dir, { recursive: true, force: true });
});

test("state prune removes entries without recent activity", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mem-"));
  const st = createState(join(dir, "state.json"));
  await st.setSummarized("s4"); // no lastAttempt → pruned
  await st.prune(86400_000); // 1 day
  assert.equal(await st.getLastSummarized("s4"), null, "entry without lastAttempt must be pruned");
  rmSync(dir, { recursive: true, force: true });
});