import { describe, it, before, after } from "node:test";
import { strict as assert } from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { detectGuardCommand, checkMergeMarker, resolveMergeGuardConf,
  detectCheckoutCommand, checkBranchBaseGuard,
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

describe("merge-guard checkMergeMarker: head-pin (v2)", () => {
  let root;
  const conf = { enabled: true, ttlSec: 600, headPin: true };
  const confNoHeadPin = { enabled: true, ttlSec: 600, headPin: false };
  const now = 1_000_000_000_000;
  // SHA при создании маркера
  const markerHead = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  // Фейковый HEAD (различается)
  const differentHead = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

  before(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "mg-headpin-"));
  });

  after(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  function writeMarkerV2(sessionID, headField) {
    const gates = path.join(root, ".maestro", "gates");
    fs.mkdirSync(gates, { recursive: true });
    const marker = { sessionID, ts: now - 1000, gate: 17, decision: "a" };
    if (headField !== undefined) marker.head = headField;
    fs.writeFileSync(
      path.join(gates, `merge-${sessionID}.json`),
      JSON.stringify(marker), "utf8");
  }

  const execGitMatch = { execGit: () => markerHead };
  const execGitDiff = { execGit: () => differentHead };
  const execGitThrow = { execGit: () => { throw new Error("git boom"); } };

  it("HEAD == marker.head, head_pin=true → allow/marker_ok", () => {
    writeMarkerV2("hp-ok", markerHead);
    assert.deepEqual(checkMergeMarker(root, "hp-ok", now, conf, execGitMatch),
      { allow: true, reason: "marker_ok" });
  });

  it("HEAD != marker.head, head_pin=true → deny/marker_head_mismatch", () => {
    writeMarkerV2("hp-mismatch", markerHead);
    assert.deepEqual(checkMergeMarker(root, "hp-mismatch", now, conf, execGitDiff),
      { allow: false, reason: "marker_head_mismatch" });
  });

  it("v1 marker (no head field), head_pin=true → allow (backward compat)", () => {
    writeMarkerV2("hp-v1", undefined);
    assert.deepEqual(checkMergeMarker(root, "hp-v1", now, conf, execGitDiff),
      { allow: true, reason: "marker_ok" });
  });

  it("v1 marker, head_pin=false → allow (no head-pin at all)", () => {
    writeMarkerV2("hp-nopin", undefined);
    assert.deepEqual(checkMergeMarker(root, "hp-nopin", now, confNoHeadPin, execGitDiff),
      { allow: true, reason: "marker_ok" });
  });

  it("v2 marker + execGit throws → deny/guard_error", () => {
    writeMarkerV2("hp-err", markerHead);
    assert.deepEqual(checkMergeMarker(root, "hp-err", now, conf, execGitThrow),
      { allow: false, reason: "guard_error" });
  });
});

describe("merge-guard resolveMergeGuardConf", () => {
  it("undefined config → defaults", () => {
    assert.deepEqual(resolveMergeGuardConf(undefined),
      { enabled: true, ttlSec: 600, commitGuard: "warn", branchBaseGuard: "warn", headPin: false });
  });

  it("explicit enabled: false", () => {
    assert.deepEqual(resolveMergeGuardConf({ merge_guard: { enabled: false } }),
      { enabled: false, ttlSec: 600, commitGuard: "warn", branchBaseGuard: "warn", headPin: false });
  });

  it("non-numeric ttlSec → 600", () => {
    assert.deepEqual(resolveMergeGuardConf({ merge_guard: { ttlSec: "x" } }),
      { enabled: true, ttlSec: 600, commitGuard: "warn", branchBaseGuard: "warn", headPin: false });
  });

  it("valid ttlSec → kept", () => {
    assert.deepEqual(resolveMergeGuardConf({ merge_guard: { ttlSec: 120 } }),
      { enabled: true, ttlSec: 120, commitGuard: "warn", branchBaseGuard: "warn", headPin: false });
  });

  it("commit_guard: 'deny' → commitGuard 'deny'", () => {
    assert.deepEqual(resolveMergeGuardConf({ merge_guard: { commit_guard: "deny" } }),
      { enabled: true, ttlSec: 600, commitGuard: "deny", branchBaseGuard: "warn", headPin: false });
  });

  it("commit_guard: 'off' → commitGuard 'off'", () => {
    assert.deepEqual(resolveMergeGuardConf({ merge_guard: { commit_guard: "off" } }),
      { enabled: true, ttlSec: 600, commitGuard: "off", branchBaseGuard: "warn", headPin: false });
  });

  it("commit_guard: 'bogus' → soft-fallback 'warn'", () => {
    assert.deepEqual(resolveMergeGuardConf({ merge_guard: { commit_guard: "bogus" } }),
      { enabled: true, ttlSec: 600, commitGuard: "warn", branchBaseGuard: "warn", headPin: false });
  });

  it("valid ttlSec + all new keys", () => {
    assert.deepEqual(resolveMergeGuardConf({ merge_guard: { ttlSec: 120, head_pin: true } }),
      { enabled: true, ttlSec: 120, commitGuard: "warn", branchBaseGuard: "warn", headPin: true });
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

// --- Branch-base guard tests ---
describe("merge-guard detectCheckoutCommand", () => {
  it("git checkout -b new-branch → checkout-b", () => {
    assert.deepEqual(detectCheckoutCommand("git checkout -b feature/x"), { kind: "checkout-b" });
  });

  it("git checkout -b new-branch main → checkout-b", () => {
    assert.deepEqual(detectCheckoutCommand("git checkout -b feature/x main"), { kind: "checkout-b" });
  });

  it("git checkout -b --orphan new-branch → null (skip orphan)", () => {
    assert.equal(detectCheckoutCommand("git checkout -b --orphan new-branch"), null);
  });

  it("git worktree add -b new-branch dir → worktree-add-b", () => {
    assert.deepEqual(detectCheckoutCommand("git worktree add -b feature/x .worktrees/feature/x"), { kind: "worktree-add-b" });
  });

  it("git worktree add -b new-branch dir main → worktree-add-b (has base)", () => {
    assert.deepEqual(detectCheckoutCommand("git worktree add -b feature/x .worktrees/feature/x main"), { kind: "worktree-add-b" });
  });

  it("git checkout -m → null (not -b)", () => {
    assert.equal(detectCheckoutCommand("git checkout -m"), null);
  });

  it("git checkout feature/x → null (no -b)", () => {
    assert.equal(detectCheckoutCommand("git checkout feature/x"), null);
  });

  it("echo git checkout -b → null", () => {
    assert.equal(detectCheckoutCommand('echo "git checkout -b x"'), null);
  });

  it("empty / non-string → null", () => {
    assert.equal(detectCheckoutCommand(""), null);
    assert.equal(detectCheckoutCommand(undefined), null);
  });
});

describe("merge-guard checkBranchBaseGuard", () => {
  let root;
  const confWarn = { enabled: true, branchBaseGuard: "warn", ttlSec: 600 };
  const confDeny = { enabled: true, branchBaseGuard: "deny", ttlSec: 600 };
  const confOff = { enabled: true, branchBaseGuard: "off", ttlSec: 600 };

  before(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "mg-bb-"));
  });

  after(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  const exec = (out) => ({ execGit: () => out });
  const throwExec = { execGit: () => { throw new Error("git boom"); } };

  it("mainline branch → allow/mainline_base (no explicit base needed)", () => {
    assert.deepEqual(
      checkBranchBaseGuard("git checkout -b new-branch", "checkout-b", root, root, confWarn, exec("main")),
      { allow: true, reason: "mainline_base" });
  });

  it("feature branch + explicit base → allow/explicit_base", () => {
    assert.deepEqual(
      checkBranchBaseGuard("git checkout -b new-branch main", "checkout-b", root, root, confWarn, exec("feature/x")),
      { allow: true, reason: "explicit_base" });
  });

  it("feature branch + no explicit base, warn mode → allow/branch_base_warning", () => {
    assert.deepEqual(
      checkBranchBaseGuard("git checkout -b new-branch", "checkout-b", root, root, confWarn, exec("feature/x")),
      { allow: true, reason: "branch_base_warning" });
  });

  it("feature branch + no explicit base, deny mode → deny/branch_base_violation", () => {
    assert.deepEqual(
      checkBranchBaseGuard("git checkout -b new-branch", "checkout-b", root, root, confDeny, exec("feature/x")),
      { allow: false, reason: "branch_base_violation" });
  });

  it("worktree add -b with explicit base → allow", () => {
    assert.deepEqual(
      checkBranchBaseGuard("git worktree add -b feature/x .wt feature/x", "worktree-add-b", root, root, confWarn, exec("feature/x")),
      { allow: true, reason: "explicit_base" });
  });

  it("worktree add -b without base → warn", () => {
    assert.deepEqual(
      checkBranchBaseGuard("git worktree add -b feature/x .wt", "worktree-add-b", root, root, confWarn, exec("feature/x")),
      { allow: true, reason: "branch_base_warning" });
  });

  it("off mode → allow/no check", () => {
    assert.deepEqual(
      checkBranchBaseGuard("git checkout -b new-branch", "checkout-b", root, root, confOff, exec("feature/x")),
      { allow: true, reason: "branch_base_warning" });
  });

  it("execGit throws, deny → deny/guard_error (fail-closed)", () => {
    assert.deepEqual(
      checkBranchBaseGuard("git checkout -b new-branch", "checkout-b", root, root, confDeny, throwExec),
      { allow: false, reason: "guard_error" });
  });

  it("execGit throws, warn → allow/guard_error", () => {
    assert.deepEqual(
      checkBranchBaseGuard("git checkout -b new-branch", "checkout-b", root, root, confWarn, throwExec),
      { allow: true, reason: "guard_error" });
  });
});

describe("merge-guard resolveMergeGuardConf: new keys", () => {
  it("branch_base_guard: 'deny' → kept", () => {
    assert.deepEqual(resolveMergeGuardConf({ merge_guard: { branch_base_guard: "deny" } }),
      { enabled: true, ttlSec: 600, commitGuard: "warn", branchBaseGuard: "deny", headPin: false });
  });

  it("branch_base_guard: 'off' → kept", () => {
    assert.deepEqual(resolveMergeGuardConf({ merge_guard: { branch_base_guard: "off" } }),
      { enabled: true, ttlSec: 600, commitGuard: "warn", branchBaseGuard: "off", headPin: false });
  });

  it("branch_base_guard: bogus → soft-fallback 'warn'", () => {
    assert.deepEqual(resolveMergeGuardConf({ merge_guard: { branch_base_guard: "bogus" } }),
      { enabled: true, ttlSec: 600, commitGuard: "warn", branchBaseGuard: "warn", headPin: false });
  });

  it("head_pin: true → true", () => {
    assert.deepEqual(resolveMergeGuardConf({ merge_guard: { head_pin: true } }),
      { enabled: true, ttlSec: 600, commitGuard: "warn", branchBaseGuard: "warn", headPin: true });
  });

  it("head_pin: false → false", () => {
    assert.deepEqual(resolveMergeGuardConf({ merge_guard: { head_pin: false } }),
      { enabled: true, ttlSec: 600, commitGuard: "warn", branchBaseGuard: "warn", headPin: false });
  });

  it("head_pin missing → false (default)", () => {
    assert.deepEqual(resolveMergeGuardConf({ merge_guard: {} }),
      { enabled: true, ttlSec: 600, commitGuard: "warn", branchBaseGuard: "warn", headPin: false });
  });
});
