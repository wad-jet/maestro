import { describe, it, before, after } from "node:test";
import { strict as assert } from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { detectGuardCommand, checkMergeMarker, resolveMergeGuardConf,
  detectCommitCommand, hasMainlineSwitch, checkCommitGuard } from "./merge-guard.js";
import { createBootstrapPlugin } from "./core.js";

// V2 mock-контекст: перехватывает зарегистрированные tool-хуки под V1-именами
// (tool.execute.before/after), чтобы интеграционные тесты оставались читаемыми.
function makeV2Ctx(directory) {
  const hooks = {};
  return {
    location: { directory },
    session: {
      get: async () => ({ data: { id: "s", parentID: null } }),
      hook: async () => ({ dispose() {} }),
    },
    event: { subscribe: async function* () {} },
    tool: {
      hook: async (name, fn) => { hooks[`tool.${name}`] = fn; return { dispose() {} }; },
      transform: async (fn) => { fn({ add() {} }); return { dispose() {} }; },
    },
    _hooks: hooks,
  };
}

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

describe("merge-guard detectCommitCommand (R4)", () => {
  it("git commit -m x → true", () =>
    assert.equal(detectCommitCommand("git commit -m x"), true));

  it("git commit-graph verify → false", () =>
    assert.equal(detectCommitCommand("git commit-graph verify"), false));

  it("git commit-tree → false", () =>
    assert.equal(detectCommitCommand("git commit-tree"), false));

  it("echo git commit → false", () =>
    assert.equal(detectCommitCommand("echo git commit"), false));

  it("npm run x → false", () =>
    assert.equal(detectCommitCommand("npm run x"), false));
});

describe("merge-guard hasMainlineSwitch (R4)", () => {
  it("git checkout main && git commit -am x → true", () =>
    assert.equal(hasMainlineSwitch("git checkout main && git commit -am x"), true));

  it("git switch master && git commit → true", () =>
    assert.equal(hasMainlineSwitch("git switch master && git commit"), true));

  it("git checkout feature/x && git commit → false", () =>
    assert.equal(hasMainlineSwitch("git checkout feature/x && git commit"), false));

  it("git checkout main -- path → true (documented false positive)", () =>
    assert.equal(hasMainlineSwitch("git checkout main -- path"), true));
});

describe("merge-guard checkCommitGuard (DI execGit, R4)", () => {
  let root;
  const now = 1_000_000_000_000;
  const conf = { enabled: true, ttlSec: 600 };

  before(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "mg-commit-"));
  });

  after(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  function marker(sid) {
    const g = path.join(root, ".maestro", "gates");
    fs.mkdirSync(g, { recursive: true });
    fs.writeFileSync(
      path.join(g, `merge-${sid}.json`),
      JSON.stringify({ sessionID: sid, ts: now - 1000, gate: 17, decision: "a" }),
    );
  }

  const exec = (out) => ({ execGit: () => out });
  const throwExec = { execGit: () => { throw new Error("git boom"); } };

  it("not-mainline branch → allow/not_mainline", () =>
    assert.deepEqual(
      checkCommitGuard("git commit -m x", root, root, "s", now, conf, "warn", exec("feature/x")),
      { allow: true, reason: "not_mainline" }));

  it("main + valid marker → allow/marker_ok", () => {
    marker("s-ok");
    assert.deepEqual(
      checkCommitGuard("git commit -m x", root, root, "s-ok", now, conf, "warn", exec("main")),
      { allow: true, reason: "marker_ok" });
  });

  it("main + no marker, warn → allow/no_marker", () =>
    assert.deepEqual(
      checkCommitGuard("git commit -m x", root, root, "s-nm", now, conf, "warn", exec("main")),
      { allow: true, reason: "no_marker" }));

  it("main + no marker, deny → deny/no_marker", () =>
    assert.deepEqual(
      checkCommitGuard("git commit -m x", root, root, "s-nm", now, conf, "deny", exec("main")),
      { allow: false, reason: "no_marker" }));

  it("detached (empty branch), warn → allow/branch_unknown", () =>
    assert.deepEqual(
      checkCommitGuard("git commit -m x", root, root, "s-d", now, conf, "warn", exec("")),
      { allow: true, reason: "branch_unknown" }));

  it("execGit throws, deny → deny/guard_error (fail-closed)", () =>
    assert.deepEqual(
      checkCommitGuard("git commit -m x", root, root, "s-e", now, conf, "deny", throwExec),
      { allow: false, reason: "guard_error" }));

  it("execGit throws, warn → allow/guard_error", () =>
    assert.deepEqual(
      checkCommitGuard("git commit -m x", root, root, "s-e", now, conf, "warn", throwExec),
      { allow: true, reason: "guard_error" }));
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
    writeMarker("ses_b", { sessionID: "ses_b", ts: now - 1000, gate: 17, decision: "a" });
    assert.deepEqual(checkMergeMarker(root, "ses_b", now, conf), { allow: true, reason: "marker_ok" });
  });

  it("expired marker (ts = now − 700s, ttl 600) → marker_expired, deny", () => {
    writeMarker("ses_c", { sessionID: "ses_c", ts: now - 700_000, gate: 17, decision: "a" });
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

  it("marker without gate/decision → marker_incomplete, deny", () => {
    writeMarker("ses_h", { sessionID: "ses_h", ts: now - 1000 });
    assert.deepEqual(checkMergeMarker(root, "ses_h", now, conf), { allow: false, reason: "marker_incomplete" });
  });

  it("marker with gate:12 → marker_incomplete, deny", () => {
    writeMarker("ses_i", { sessionID: "ses_i", ts: now - 1000, gate: 12, decision: "a" });
    assert.deepEqual(checkMergeMarker(root, "ses_i", now, conf), { allow: false, reason: "marker_incomplete" });
  });
});

describe("merge-guard resolveMergeGuardConf", () => {
  it("undefined config → { enabled: true, ttlSec: 600, commitGuard: 'warn' }", () => {
    assert.deepEqual(resolveMergeGuardConf(undefined), { enabled: true, ttlSec: 600, commitGuard: "warn" });
  });

  it("explicit enabled: false", () => {
    assert.deepEqual(resolveMergeGuardConf({ merge_guard: { enabled: false } }),
      { enabled: false, ttlSec: 600, commitGuard: "warn" });
  });

  it("non-numeric ttlSec → 600", () => {
    assert.deepEqual(resolveMergeGuardConf({ merge_guard: { ttlSec: "x" } }),
      { enabled: true, ttlSec: 600, commitGuard: "warn" });
  });

  it("valid ttlSec → kept", () => {
    assert.deepEqual(resolveMergeGuardConf({ merge_guard: { ttlSec: 120 } }),
      { enabled: true, ttlSec: 120, commitGuard: "warn" });
  });

  it("commit_guard: 'deny' → commitGuard 'deny'", () => {
    assert.deepEqual(resolveMergeGuardConf({ merge_guard: { commit_guard: "deny" } }),
      { enabled: true, ttlSec: 600, commitGuard: "deny" });
  });

  it("commit_guard: 'off' → commitGuard 'off'", () => {
    assert.deepEqual(resolveMergeGuardConf({ merge_guard: { commit_guard: "off" } }),
      { enabled: true, ttlSec: 600, commitGuard: "off" });
  });

  it("commit_guard: 'bogus' → soft-fallback 'warn'", () => {
    assert.deepEqual(resolveMergeGuardConf({ merge_guard: { commit_guard: "bogus" } }),
      { enabled: true, ttlSec: 600, commitGuard: "warn" });
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
    const ctx = makeV2Ctx(dir);
    await createBootstrapPlugin(ctx);
    hooks = ctx._hooks;
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
        { tool: "shell", sessionID: "ses_x", callID: "c1", input: { command: "git merge --ff-only f" } },
      ),
      /merge-guard:deny.*git merge/,
    );
    const gates = path.join(dir, ".maestro", "gates");
    fs.mkdirSync(gates, { recursive: true });
    fs.writeFileSync(
      path.join(gates, "merge-ses_x.json"),
      JSON.stringify({ sessionID: "ses_x", ts: Date.now(), gate: 17, decision: "a" }),
    );
    await assert.doesNotReject(
      hooks["tool.execute.before"](
        { tool: "shell", sessionID: "ses_x", callID: "c2", input: { command: "git merge --ff-only f" } },
      ),
    );
  });

  it("denies push to mainline without marker", async () => {
    await assert.rejects(
      hooks["tool.execute.before"](
        { tool: "shell", sessionID: "ses_y", callID: "c3", input: { command: "git push origin main" } },
      ),
      /merge-guard:deny.*git push \(mainline\)/,
    );
  });

  it("allows git commit in default (warn) commit-guard mode — not rejected", async () => {
    // R4: git commit is now detected by the commit guard; the temp dir is not
    // a git repo → guard_error → warn mode → allow + log (no rejection).
    await assert.doesNotReject(
      hooks["tool.execute.before"](
        { tool: "shell", sessionID: "ses_z", callID: "c4", input: { command: 'git commit -m "x"' } },
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
      const offCtx = makeV2Ctx(offDir);
      await createBootstrapPlugin(offCtx);
      const offHooks = offCtx._hooks;
      await assert.doesNotReject(
        offHooks["tool.execute.before"](
          { tool: "shell", sessionID: "ses_q", callID: "c5", input: { command: "git merge --ff-only f" } },
        ),
      );
    } finally {
      fs.rmSync(offDir, { recursive: true, force: true });
    }
  });

  it("denies git merge without marker, shows git merge text", async () => {
    await assert.rejects(
      async () => {
        await hooks["tool.execute.before"](
          { tool: "shell", sessionID: "ses_m", callID: "c6", input: { command: "git merge --ff-only f" } },
        );
      },
      /merge-guard:deny.*git merge/,
    );
  });
});
