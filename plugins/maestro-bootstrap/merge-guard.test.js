import { describe, it, before, after } from "node:test";
import { strict as assert } from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { detectGuardCommand, checkMergeMarker, resolveMergeGuardConf } from "./merge-guard.js";
import { MaestroBootstrapPlugin } from "./core.js";

describe("merge-guard detectGuardCommand", () => {
  it("git merge → merge", () => {
    assert.deepEqual(detectGuardCommand("git merge --ff-only feature/x"), { kind: "merge" });
  });

  it("multi-command with git merge → merge", () => {
    assert.deepEqual(
      detectGuardCommand("git checkout main && git merge --ff-only feature/x"),
      { kind: "merge" },
    );
  });

  it("git push origin main → push-mainline", () => {
    assert.deepEqual(detectGuardCommand("git push origin main"), { kind: "push-mainline" });
  });

  it("git push origin HEAD:main → push-mainline", () => {
    assert.deepEqual(detectGuardCommand("git push origin HEAD:main"), { kind: "push-mainline" });
  });

  it("git push origin +main → push-mainline", () => {
    assert.deepEqual(detectGuardCommand("git push origin +main"), { kind: "push-mainline" });
  });

  it("git push --set-upstream origin main → push-mainline", () => {
    assert.deepEqual(
      detectGuardCommand("git push --set-upstream origin main"),
      { kind: "push-mainline" },
    );
  });

  it("git push origin master → push-mainline", () => {
    assert.deepEqual(detectGuardCommand("git push origin master"), { kind: "push-mainline" });
  });

  it("git push origin feature/x → null", () => {
    assert.equal(detectGuardCommand("git push origin feature/x"), null);
  });

  it("bare git push → null (documented limitation)", () => {
    assert.equal(detectGuardCommand("git push"), null);
  });

  it("git commit → null", () => {
    assert.equal(detectGuardCommand('git commit -m "x"'), null);
  });

  it("echo of git merge → null", () => {
    assert.equal(detectGuardCommand('echo "git merge foo"'), null);
  });

  it("npm test → null", () => {
    assert.equal(detectGuardCommand("npm test"), null);
  });

  it("other git commands → null", () => {
    assert.equal(detectGuardCommand("git checkout feature/x"), null);
    assert.equal(detectGuardCommand("git branch"), null);
    assert.equal(detectGuardCommand("git diff"), null);
    assert.equal(detectGuardCommand("git pull"), null);
  });

  it("empty / non-string → null", () => {
    assert.equal(detectGuardCommand(""), null);
    assert.equal(detectGuardCommand(undefined), null);
  });
});

describe("merge-guard checkMergeMarker", () => {
  let root;
  const conf = { enabled: true, ttlSec: 600 };
  const now = 1_000_000_000_000;

  before(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "mg-marker-"));
  });

  after(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  function writeMarker(sessionID, data) {
    const gates = path.join(root, ".maestro", "gates");
    fs.mkdirSync(gates, { recursive: true });
    const p = path.join(gates, `merge-${sessionID}.json`);
    fs.writeFileSync(p, typeof data === "string" ? data : JSON.stringify(data), "utf8");
    return p;
  }

  it("no marker file → no_marker, deny", () => {
    assert.deepEqual(checkMergeMarker(root, "ses_a", now, conf), { allow: false, reason: "no_marker" });
  });

  it("fresh valid marker → marker_ok, allow", () => {
    writeMarker("ses_b", { sessionID: "ses_b", ts: now - 1000 });
    assert.deepEqual(checkMergeMarker(root, "ses_b", now, conf), { allow: true, reason: "marker_ok" });
  });

  it("expired marker (ts = now − 700s, ttl 600) → marker_expired, deny", () => {
    writeMarker("ses_c", { sessionID: "ses_c", ts: now - 700_000 });
    assert.deepEqual(checkMergeMarker(root, "ses_c", now, conf), { allow: false, reason: "marker_expired" });
  });

  it("sessionID mismatch → marker_session_mismatch, deny", () => {
    writeMarker("ses_d", { sessionID: "other", ts: now - 1000 });
    assert.deepEqual(checkMergeMarker(root, "ses_d", now, conf), { allow: false, reason: "marker_session_mismatch" });
  });

  it("broken JSON → marker_bad_json, deny", () => {
    writeMarker("ses_e", "{not json");
    assert.deepEqual(checkMergeMarker(root, "ses_e", now, conf), { allow: false, reason: "marker_bad_json" });
  });

  it("missing ts → marker_bad_json, deny", () => {
    writeMarker("ses_f", { sessionID: "ses_f" });
    assert.deepEqual(checkMergeMarker(root, "ses_f", now, conf), { allow: false, reason: "marker_bad_json" });
  });

  it("marker path is a directory (EISDIR) → guard_error, deny", () => {
    const gates = path.join(root, ".maestro", "gates");
    fs.mkdirSync(gates, { recursive: true });
    fs.mkdirSync(path.join(gates, "merge-ses_g.json"));
    assert.deepEqual(checkMergeMarker(root, "ses_g", now, conf), { allow: false, reason: "guard_error" });
  });
});

describe("merge-guard resolveMergeGuardConf", () => {
  it("undefined config → { enabled: true, ttlSec: 600 }", () => {
    assert.deepEqual(resolveMergeGuardConf(undefined), { enabled: true, ttlSec: 600 });
  });

  it("explicit enabled: false", () => {
    assert.deepEqual(resolveMergeGuardConf({ merge_guard: { enabled: false } }), { enabled: false, ttlSec: 600 });
  });

  it("non-numeric ttlSec → 600", () => {
    assert.deepEqual(resolveMergeGuardConf({ merge_guard: { ttlSec: "x" } }), { enabled: true, ttlSec: 600 });
  });

  it("valid ttlSec → kept", () => {
    assert.deepEqual(resolveMergeGuardConf({ merge_guard: { ttlSec: 120 } }), { enabled: true, ttlSec: 120 });
  });
});

describe("merge-guard hook integration (tool.execute.before)", () => {
  let dir, hooks, savedLogEnv;
  const LOG_ENV = ["MAESTRO_BOOTSTRAP_LOG_MASK", "MAESTRO_BOOTSTRAP_LOG_LEVEL", "MAESTRO_BOOTSTRAP_LOG_DIR"];

  before(async () => {
    savedLogEnv = {};
    for (const k of LOG_ENV) {
      savedLogEnv[k] = process.env[k];
      delete process.env[k];
    }
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "mg-hook-"));
    fs.writeFileSync(
      path.join(dir, "maestro.json"),
      JSON.stringify({ merge_guard: { enabled: true, ttlSec: 600 } }),
    );
    hooks = await MaestroBootstrapPlugin({ directory: dir });
  });

  after(() => {
    fs.rmSync(dir, { recursive: true, force: true });
    for (const k of LOG_ENV) {
      if (savedLogEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedLogEnv[k];
    }
  });

  it("denies git merge without marker, allows after marker created", async () => {
    await assert.rejects(
      hooks["tool.execute.before"](
        { tool: "bash", sessionID: "ses_x", callID: "c1" },
        { args: { command: "git merge --ff-only f" } },
      ),
      /merge-guard:deny/,
    );
    const gates = path.join(dir, ".maestro", "gates");
    fs.mkdirSync(gates, { recursive: true });
    fs.writeFileSync(
      path.join(gates, "merge-ses_x.json"),
      JSON.stringify({ sessionID: "ses_x", ts: Date.now() }),
    );
    await assert.doesNotReject(
      hooks["tool.execute.before"](
        { tool: "bash", sessionID: "ses_x", callID: "c2" },
        { args: { command: "git merge --ff-only f" } },
      ),
    );
  });

  it("denies push to mainline without marker", async () => {
    await assert.rejects(
      hooks["tool.execute.before"](
        { tool: "bash", sessionID: "ses_y", callID: "c3" },
        { args: { command: "git push origin main" } },
      ),
      /merge-guard:deny/,
    );
  });

  it("allows non-guard bash commands", async () => {
    await assert.doesNotReject(
      hooks["tool.execute.before"](
        { tool: "bash", sessionID: "ses_z", callID: "c4" },
        { args: { command: 'git commit -m "x"' } },
      ),
    );
  });

  it("merge_guard.enabled: false → guard off", async () => {
    const offDir = fs.mkdtempSync(path.join(os.tmpdir(), "mg-hook-off-"));
    try {
      fs.writeFileSync(
        path.join(offDir, "maestro.json"),
        JSON.stringify({ merge_guard: { enabled: false } }),
      );
      const offHooks = await MaestroBootstrapPlugin({ directory: offDir });
      await assert.doesNotReject(
        offHooks["tool.execute.before"](
          { tool: "bash", sessionID: "ses_q", callID: "c5" },
          { args: { command: "git merge --ff-only f" } },
        ),
      );
    } finally {
      fs.rmSync(offDir, { recursive: true, force: true });
    }
  });
});
