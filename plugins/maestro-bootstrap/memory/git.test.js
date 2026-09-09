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

// ── M-5: detectMainline steps 2–3 ──────────────────────────────────────

test("detectMainline step 2: origin/HEAD prefix-strip + verify", () => {
  const dir = makeRepo();
  // main → trunk; origin/HEAD указывает на refs/remotes/origin/trunk.
  execFileSync("git", ["branch", "-m", "main", "trunk"], { cwd: dir, stdio: "ignore" });
  execFileSync("git", ["update-ref", "refs/remotes/origin/trunk", "HEAD"], { cwd: dir, stdio: "ignore" });
  execFileSync("git", ["symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/trunk"], { cwd: dir, stdio: "ignore" });
  // Шаг 2: symbolic-ref → срез префикса refs/remotes/origin/ → bare "trunk" →
  // verifyBranch (локальное существование) → { name: "trunk" }.
  assert.equal(detectMainline(dir).name, "trunk");
});

test("detectMainline step 2 fallthrough: origin/HEAD name absent locally → step 3/4", () => {
  const dir = makeRepo();
  // main → develop (резерв шага 4); origin/HEAD указывает на "main", которого
  // локально НЕТ (симуляция `git clone -b <ветка>`: origin/HEAD = дефолт
  // remote, локально — только выбранная ветка).
  execFileSync("git", ["branch", "-m", "main", "develop"], { cwd: dir, stdio: "ignore" });
  execFileSync("git", ["update-ref", "refs/remotes/origin/main", "HEAD"], { cwd: dir, stdio: "ignore" });
  execFileSync("git", ["symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main"], { cwd: dir, stdio: "ignore" });
  // Шаг 2: "main" не существует локально → шаг 3 (init.defaultBranch не задан)
  // → шаг 4: резерв находит develop.
  assert.equal(detectMainline(dir).name, "develop");
});

test("detectMainline step 3: init.defaultBranch naming absent branch → skipped", () => {
  const dir = makeRepo();
  // Локальный init.defaultBranch именует ветку, которой нет в репо (глобальная
  // настройка может именовать отсутствующую) → verifyBranch провал → шаг 4.
  execFileSync("git", ["config", "init.defaultBranch", "trunk"], { cwd: dir, stdio: "ignore" });
  assert.equal(detectMainline(dir).name, "main");
});
