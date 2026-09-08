import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { resolveBranch, resolveHead, detectMainline, revList, isAncestor, verifyBranch } from "./git.js";

function makeRepo() {
  const dir = mkdtempSync(join(tmpdir(), "mm-git-"));
  execFileSync("git", ["init", "-b", "main"], { cwd: dir, stdio: "ignore" });
  execFileSync("git", ["config", "user.email", "t@t"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "t"], { cwd: dir });
  writeFileSync(join(dir, "a.txt"), "a");
  execFileSync("git", ["add", "."], { cwd: dir });
  execFileSync("git", ["commit", "-m", "c1"], { cwd: dir });
  return dir;
}

test("resolveBranch/resolveHead return current state", () => {
  const dir = makeRepo();
  assert.equal(resolveBranch(dir), "main");
  assert.ok(/^[0-9a-f]{40}$/.test(resolveHead(dir)));
});

test("resolveBranch/resolveHead on detached HEAD → branch ''", () => {
  const dir = makeRepo();
  const head = resolveHead(dir);
  execFileSync("git", ["checkout", "--detach", head], { cwd: dir, stdio: "ignore" });
  assert.equal(resolveBranch(dir), "");
  assert.ok(/^[0-9a-f]{40}$/.test(resolveHead(dir)));
});

test("verifyBranch: existing branch true, missing/empty false", () => {
  const dir = makeRepo();
  assert.equal(verifyBranch(dir, "main"), true);
  assert.equal(verifyBranch(dir, "nope"), false);
  assert.equal(verifyBranch(dir, ""), false);
});

test("detectMainline: override wins, nonexistent override → null", () => {
  const dir = makeRepo();
  assert.equal(detectMainline(dir, { override: "main" }).name, "main");
  assert.equal(detectMainline(dir, { override: "nope" }), null);
});

test("detectMainline: no override → reserve chain (main exists)", () => {
  const dir = makeRepo();
  assert.equal(detectMainline(dir).name, "main");
});

test("revList: invalid ref → null (fail-soft, not empty Set)", () => {
  const dir = makeRepo();
  assert.equal(revList(dir, "deadbeef"), null);
});

test("revList returns ancestor set; isAncestor yes/no/error", () => {
  const dir = makeRepo();
  const head = resolveHead(dir);
  const set = revList(dir, "HEAD");
  assert.ok(set.has(head));
  assert.equal(isAncestor(dir, head, "main"), "yes");
  // side-branch commit — valid object, not an ancestor of main → "no"
  execFileSync("git", ["checkout", "-b", "feature"], { cwd: dir, stdio: "ignore" });
  writeFileSync(join(dir, "b.txt"), "b");
  execFileSync("git", ["add", "."], { cwd: dir });
  execFileSync("git", ["commit", "-m", "c2"], { cwd: dir });
  const sideHead = resolveHead(dir);
  assert.equal(isAncestor(dir, sideHead, "main"), "no");
  assert.equal(isAncestor(dir, "deadbeef", "main"), "error"); // invalid object
});