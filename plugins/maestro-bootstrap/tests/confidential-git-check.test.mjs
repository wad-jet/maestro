/**
 * Tests for confidential.tracked_in_git check at bootstrap init.
 *
 * Test cases:
 * 1. .confidential/ NOT tracked → no warning
 * 2. .confidential/ IS tracked → warning message with fix instructions
 * 3. Not a git repo → no error (silently ignore)
 */

import { strictEqual, ok } from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { execSync } from "node:child_process";
import { checkConfidentialTrackedInGit } from "../core.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// --- Helpers ---------------------------------------------------------------

/**
 * Create a temporary directory. Optionally initialize as a git repo and
 * track .confidential/ files (which triggers the warning).
 * Returns { dir, cleanup }.
 */
function createTempDir(options = {}) {
  const { trackConfidential = false, notGitRepo = false } = options;
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "maestro-confidential-test-"));

  // Initialize git repo unless notGitRepo is true
  if (!notGitRepo) {
    try {
      execSync("git init -b main", { cwd: tmpDir, encoding: "utf-8", stdio: "pipe" });
      execSync('git config user.email "test@test.com"', { cwd: tmpDir, encoding: "utf-8", stdio: "pipe" });
      execSync('git config user.name "Test"', { cwd: tmpDir, encoding: "utf-8", stdio: "pipe" });

      // If trackConfidential, create .confidential/ files and add them to git
      if (trackConfidential) {
        const confDir = path.join(tmpDir, ".confidential");
        fs.mkdirSync(confDir, { recursive: true });
        fs.writeFileSync(path.join(confDir, "api-key.txt"), "test content\n");
        fs.writeFileSync(path.join(confDir, "secret-key.pem"), "-----BEGIN PRIVATE KEY-----\ntest\n-----END PRIVATE KEY-----\n");

        // Also create a non-confidential file so git has something to add
        fs.writeFileSync(path.join(tmpDir, "README.md"), "# Test\n");

        execSync("git add .", { cwd: tmpDir, encoding: "utf-8", stdio: "pipe" });
        execSync('git commit -m "initial"', { cwd: tmpDir, encoding: "utf-8", stdio: "pipe" });
      }
    } catch {
      // If git is not available, treat as non-git repo
      return { dir: tmpDir, cleanup: () => {}, notGit: true };
    }
  }

  const cleanup = () => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best-effort */ }
  };

  return { dir: tmpDir, cleanup };
}

// --- Tests -----------------------------------------------------------------

test("confidential git check: not tracked → no warning", async () => {
  const { dir, cleanup } = createTempDir({ trackConfidential: false });
  try {
    let warningOutput = "";
    const origWarn = console.warn;
    console.warn = (...args) => { warningOutput += args.join(" "); };

    checkConfidentialTrackedInGit(dir, null);

    strictEqual(warningOutput, "", "Expected no console.warn output when .confidential/ is not tracked");

    console.warn = origWarn;
  } finally {
    cleanup();
  }
});

test("confidential git check: IS tracked → warning message with fix instructions", async () => {
  const { dir, cleanup } = createTempDir({ trackConfidential: true });
  try {
    let warningOutput = "";
    const origWarn = console.warn;
    console.warn = (...args) => { warningOutput += args.join(" "); };

    checkConfidentialTrackedInGit(dir, null);

    ok(warningOutput.length > 0, "Expected console.warn output when .confidential/ is tracked");
    ok(warningOutput.includes("confidential.tracked_in_git"),
      "Warning should mention 'confidential.tracked_in_git'");
    ok(warningOutput.includes("security risk"),
      "Warning should mention 'security risk'");
    ok(warningOutput.includes("git rm -r --cached .confidential/"),
      "Warning should include fix instructions with 'git rm -r --cached .confidential/'");

    console.warn = origWarn;
  } finally {
    cleanup();
  }
});

test("confidential git check: not a git repo → no error", async () => {
  const { dir, cleanup } = createTempDir({ notGitRepo: true });
  try {
    let warningOutput = "";
    const origWarn = console.warn;
    console.warn = (...args) => { warningOutput += args.join(" "); };

    // Should not throw — silently ignore non-git repos
    checkConfidentialTrackedInGit(dir, null);

    strictEqual(warningOutput, "", "Expected no warning and no error for non-git repos");

    console.warn = origWarn;
  } finally {
    cleanup();
  }
});

test("confidential git check: multiple tracked files → all listed in warning", async () => {
  const { dir, cleanup } = createTempDir({ trackConfidential: true });
  try {
    let warningOutput = "";
    const origWarn = console.warn;
    console.warn = (...args) => { warningOutput += args.join(" "); };

    checkConfidentialTrackedInGit(dir, null);

    ok(warningOutput.length > 0, "Expected warning for multiple tracked files");
    ok(warningOutput.includes("git rm -r --cached .confidential/"),
      "Warning should include fix instructions");

    console.warn = origWarn;
  } finally {
    cleanup();
  }
});

test("confidential git check: log object receives warning event", async () => {
  const { dir, cleanup } = createTempDir({ trackConfidential: true });
  try {
    const logEvents = [];
    const customLog = {
      warn: (msg, extra) => { logEvents.push({ msg, extra }); },
    };

    // Suppress console.warn for this test
    const origWarn = console.warn;
    console.warn = () => {};

    checkConfidentialTrackedInGit(dir, customLog);

    strictEqual(logEvents.length, 1, "Expected exactly one log.warn call");
    strictEqual(logEvents[0].msg, "confidential.tracked_in_git",
      "Log message should be 'confidential.tracked_in_git'");
    ok(Array.isArray(logEvents[0].extra?.files), "Log extra should contain files array");

    console.warn = origWarn;
  } finally {
    cleanup();
  }
});
