import { test } from "node:test";
import assert from "node:assert/strict";
import { canonicalizeRemote, projectHashFromRemote, projectHashFromDir, deriveProjectKey } from "./project.js";

test("ssh and https remotes canonicalize to same", () => {
  const a = canonicalizeRemote("git@github.com:Org/Repo.git");
  const b = canonicalizeRemote("https://github.com/org/repo.git");
  assert.equal(a, b);
  assert.equal(a, "github.com/org/repo");
});
test("scp syntax", () => {
  assert.equal(canonicalizeRemote("git@github.com:org/repo"), "github.com/org/repo");
});
test("nonstandard ssh port ignored", () => {
  assert.equal(canonicalizeRemote("ssh://git@host:2222/org/repo.git"), "host/org/repo");
});
test("hash is stable", () => {
  assert.equal(projectHashFromRemote("https://github.com/org/repo.git"), projectHashFromRemote("git@github.com:org/repo.git"));
  assert.match(projectHashFromRemote("https://github.com/org/repo.git"), /^[0-9a-f]{64}$/);
});
test("dir hash differs from basename", () => {
  assert.notEqual(projectHashFromDir("/home/u/a"), projectHashFromDir("/home/u/b"));
});
test("derive from remote preferred", () => {
  const r = deriveProjectKey({ gitRemote: "https://github.com/org/repo.git", absPath: "/x/y" });
  assert.equal(r.source, "remote");
  assert.equal(r.hash, projectHashFromRemote("https://github.com/org/repo.git"));
});
test("derive falls back to dir hash", () => {
  const r = deriveProjectKey({ gitRemote: null, absPath: "/home/u/a" });
  assert.equal(r.source, "dir");
  assert.equal(r.hash, projectHashFromDir("/home/u/a"));
});
test("credentials stripped", () => {
  assert.equal(canonicalizeRemote("https://user:pass@github.com/org/repo.git"), "github.com/org/repo");
});
test("dir hash differs for same basename different parent", () => {
  assert.notEqual(projectHashFromDir("/home/u/a"), projectHashFromDir("/other/u/a"));
});
