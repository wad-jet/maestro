import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
  readFileSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureModule } from "./provision.js";

// ── helpers ──────────────────────────────────────────────────────────

function mkDirs() {
  const src = mkdtempSync(join(tmpdir(), "src-"));
  const mod = mkdtempSync(join(tmpdir(), "mod-"));
  return { src, mod };
}

function cleanup({ src, mod }) {
  rmSync(src, { recursive: true, force: true });
  rmSync(mod, { recursive: true, force: true });
}

// ── tests ────────────────────────────────────────────────────────────

test("ensureModule creates dir, writes package.json, copies sources", () => {
  const { src, mod } = mkDirs();
  writeFileSync(join(src, "index.js"), "export const x=1;");
  writeFileSync(join(src, "index.test.js"), "// test");
  writeFileSync(join(src, "readme.md"), "# docs");

  // Add a subdir with a .test.js file in src
  const subDir = join(src, "sub");
  mkdirSync(subDir, { recursive: true });
  writeFileSync(join(subDir, "a.js"), "source");
  writeFileSync(join(subDir, "a.test.js"), "should-be-excluded");

  const ok = ensureModule({ moduleDir: mod, srcDir: src, version: "3.0.0" });
  assert.ok(ok);

  // Copied source files
  assert.ok(existsSync(join(mod, "index.js")));
  assert.equal(readFileSync(join(mod, "index.js"), "utf8"), "export const x=1;");

  // Excluded *.test.js in root and subdirs
  assert.ok(!existsSync(join(mod, "index.test.js")));
  assert.ok(!existsSync(join(mod, "sub", "a.test.js")));
  // Non-test file in subdir should be copied
  assert.ok(existsSync(join(mod, "sub", "a.js")));
  assert.equal(readFileSync(join(mod, "sub", "a.js"), "utf8"), "source");

  // package.json has correct fields
  const pkg = JSON.parse(readFileSync(join(mod, "package.json"), "utf8"));
  assert.equal(pkg.name, "maestro-memory");
  assert.equal(pkg.type, "module");
  assert.equal(pkg.version, "3.0.0");
  assert.equal(pkg.private, true);
  assert.ok(pkg.dependencies);
  assert.equal(pkg.dependencies["better-sqlite3"], "^11.5.0");
  assert.equal(pkg.dependencies["@qdrant/js-client-rest"], "^1.19.0");
  assert.equal(pkg.dependencies["pg"], "^8.13.0");
  assert.equal(pkg.dependencies["@huggingface/transformers"], "^3.0.0");

  cleanup({ src, mod });
});

test("ensureModule re-syncs code on version change, keeps node_modules", () => {
  const { src, mod } = mkDirs();

  // Initial provision with v1
  writeFileSync(join(src, "index.js"), "v1");
  ensureModule({ moduleDir: mod, srcDir: src, version: "1.0.0" });
  assert.equal(readFileSync(join(mod, "index.js"), "utf8"), "v1");

  // Simulate node_modules installed by user
  const nm = join(mod, "node_modules");
  mkdirSync(nm, { recursive: true });
  writeFileSync(join(nm, "keep.txt"), "keep");

  // New version with changed source + new file
  writeFileSync(join(src, "index.js"), "v2");
  writeFileSync(join(src, "newfile.js"), "new content");

  // Re-sync on version bump
  ensureModule({ moduleDir: mod, srcDir: src, version: "2.0.0" });

  // Updated source
  assert.equal(readFileSync(join(mod, "index.js"), "utf8"), "v2");
  // New file present
  assert.ok(existsSync(join(mod, "newfile.js")));
  assert.equal(readFileSync(join(mod, "newfile.js"), "utf8"), "new content");
  // node_modules preserved
  assert.ok(existsSync(join(nm, "keep.txt")));

  cleanup({ src, mod });
});

test("ensureModule does not re-sync when version unchanged", () => {
  const { src, mod } = mkDirs();

  writeFileSync(join(src, "a.js"), "original");
  ensureModule({ moduleDir: mod, srcDir: src, version: "1.0.0" });
  assert.equal(readFileSync(join(mod, "a.js"), "utf8"), "original");

  // Change source in src but same version
  writeFileSync(join(src, "a.js"), "changed-in-src");

  // Re-provision — should NOT overwrite because version is same
  ensureModule({ moduleDir: mod, srcDir: src, version: "1.0.0" });
  // Should still be "original" (unchanged)
  assert.equal(readFileSync(join(mod, "a.js"), "utf8"), "original");

  cleanup({ src, mod });
});

test("ensureModule returns false on failure", () => {
  // moduleDir points at an existing FILE → mkdirSync throws EEXIST
  const dir = mkdtempSync(join(tmpdir(), "prov-"));
  const src = join(dir, "src");
  mkdirSync(src, { recursive: true });
  writeFileSync(join(src, "index.js"), "export const x=1;");
  const fileAsDir = join(dir, "not-a-dir");
  writeFileSync(fileAsDir, "i am a file");
  const ok = ensureModule({ moduleDir: fileAsDir, srcDir: src, version: "1.0.0" });
  assert.equal(ok, false);
  rmSync(dir, { recursive: true, force: true });
});

test("provision manifest does not include sqlite-vec", () => {
  const { src, mod } = mkDirs();
  writeFileSync(join(src, "index.js"), "export const x=1;");
  ensureModule({ moduleDir: mod, srcDir: src, version: "1.0.0" });
  const pkg = JSON.parse(readFileSync(join(mod, "package.json"), "utf8"));
  assert.equal(pkg.dependencies["sqlite-vec"], undefined);
  cleanup({ src, mod });
});

test("ensureModule excludes node_modules from src when copying", () => {
  const { src, mod } = mkDirs();

  // Create node_modules in src — should be excluded
  const srcNm = join(src, "node_modules");
  mkdirSync(srcNm, { recursive: true });
  writeFileSync(join(srcNm, "bad-pkg.js"), "evil");

  ensureModule({ moduleDir: mod, srcDir: src, version: "1.0.0" });

  assert.ok(!existsSync(join(mod, "node_modules")));

  cleanup({ src, mod });
});
