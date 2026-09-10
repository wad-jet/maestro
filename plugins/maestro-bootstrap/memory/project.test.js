import { test } from "node:test";
import assert from "node:assert/strict";
import { canonicalizeRemote, projectHashFromRemote, projectHashFromDir, deriveProjectKey, resolveProjectKey, legacyKey, resolveSearchKeys } from "./project.js";

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

// ── resolveProjectKey (namespace-only) / legacyKey / resolveSearchKeys ──

test("resolveProjectKey validates namespace (no URL/hash)", () => {
  assert.equal(resolveProjectKey("microservices.sales.pay"), "microservices.sales.pay");
  assert.equal(resolveProjectKey("MyApp"), "myapp"); // normalized
  assert.throws(() => resolveProjectKey("git@github.com:org/api.git"));
  assert.throws(() => resolveProjectKey("8f3a2e91"));
  assert.throws(() => resolveProjectKey("bad!"));
});

test("legacyKey resolves URL→hash, hash as-is, namespace passthrough", () => {
  assert.equal(legacyKey("git@github.com:org/api.git"), projectHashFromRemote("git@github.com:org/api.git"));
  const h = "a".repeat(64);
  assert.equal(legacyKey(h), h);
  assert.equal(legacyKey("microservices.sales"), "microservices.sales");
});

test("resolveSearchKeys: own + related (own excluded, dedup, normalized)", () => {
  const keys = resolveSearchKeys({ key: "a.b.c", related: ["a.b", "a.b.c", "MyApp", "a.b"] });
  assert.deepEqual(keys, ["a.b.c", "a.b", "myapp"]);
});

test("resolveSearchKeys: explicit project adds namespace, own excluded", () => {
  const keys = resolveSearchKeys({ key: "a.b", project: "a.b" });
  assert.deepEqual(keys, ["a.b"]);
  assert.deepEqual(resolveSearchKeys({ key: "a.b", project: "x.y" }), ["a.b", "x.y"]);
});

test("resolveSearchKeys: no related/project → own only; missing key throws", () => {
  assert.deepEqual(resolveSearchKeys({ key: "a.b" }), ["a.b"]);
  assert.throws(() => resolveSearchKeys({ related: ["x"] }));
});
