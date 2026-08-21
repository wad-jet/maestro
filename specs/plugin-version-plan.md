# Plugin Version Exposure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose the loaded `maestro-bootstrap` plugin version at runtime — via a `.maestro/plugin-version` file, the `plugin initialized` audit-log line, and a `/maestro-version` command.

**Architecture:** A single `readPluginVersion()` reads `version` from the plugin's own `package.json` (resolved relative to `core.js`, reliable for both npm and local installs). At `init`, `writePluginVersionFile()` writes that version to `<project>/.maestro/plugin-version`, and the `plugin initialized` log line gains a `version` field. The new `/maestro-version` command tells an agent to read the version file (with an explicit "not initialized" path when the file is absent). All write/read errors fail soft.

**Tech Stack:** Node.js (built-in `node:test`, ESM), OpenCode plugin/command system, JSONL logging.

**Spec:** `specs/plugin-version.md`

---

## File Structure

- `plugins/maestro-bootstrap/core.js` — add `readPluginVersion()` and `writePluginVersionFile()`, call them in `MaestroBootstrapPlugin`, add `version` field to `plugin initialized` log.
- `plugins/maestro-bootstrap/index.test.js` — add tests for the two new functions and the log field.
- `commands/maestro-version.md` — new command (Create).
- `.opencode/commands/maestro-version.md` — runtime mirror (Create, same content).
- `manual_docs/reference/commands.md` — document the new command (Modify).
- `skills/maestro-init/SKILL.md` — add `.maestro/plugin-version` to the fixed `.gitignore` list (Modify).

---

### Task 1: `readPluginVersion()` — read version from package.json

**Files:**
- Modify: `plugins/maestro-bootstrap/core.js` (add function near the config helpers, before `makeLogger`)
- Test: `plugins/maestro-bootstrap/index.test.js`

- [ ] **Step 1: Add the new names to the test import line**

Modify line 6 of `index.test.js` to add `readPluginVersion, writePluginVersionFile`:

```js
import { MaestroBootstrapPlugin, makeLogger, makeBoundedMap, sanitize, resolveSanitizeOptions, loadWhitelist, loadAccessPolicy, resolveFileAccess, filePathOf, loadTrustConfig, loadMaestroConfig, detectUnsafePatterns, allRulesDisabled, loadConfidentialConfig, resolveIsTrustedSubagent, normalizeTarget, isConfidentialTarget, readPluginVersion, writePluginVersionFile } from "./core.js";
```

- [ ] **Step 2: Write the failing test**

Add a new describe block at the end of `index.test.js`:

```js
describe("maestro-bootstrap plugin version", () => {
  it("readPluginVersion returns the version from package.json", () => {
    const version = readPluginVersion();
    assert.equal(typeof version, "string");
    assert.match(version, /^\d+\.\d+\.\d+$/);
  });

  it("writePluginVersionFile writes version to .maestro/plugin-version", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fab-ver-"));
    try {
      writePluginVersionFile(dir, "1.2.3");
      const file = path.join(dir, ".maestro/plugin-version");
      assert.ok(fs.existsSync(file), "plugin-version file must be created");
      assert.equal(fs.readFileSync(file, "utf8").trim(), "1.2.3");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("writePluginVersionFile does not throw when write fails (fail-soft)", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fab-ver-fail-"));
    try {
      // `.maestro` занят файлом → mkdirSync бросает ENOTDIR/EEXIST → write должен молча не упасть
      fs.writeFileSync(path.join(dir, ".maestro"), "occupied");
      assert.doesNotThrow(() => writePluginVersionFile(dir, "1.2.3"));
      assert.equal(fs.existsSync(path.join(dir, ".maestro/plugin-version")), false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd plugins/maestro-bootstrap && npm test`
Expected: FAIL with `readPluginVersion is not a function` (and `writePluginVersionFile is not defined`).

- [ ] **Step 4: Write minimal implementation**

Add to `core.js` (after the `makeLogger` function, before `makeBoundedMap`):

```js
/**
 * Read the plugin version from its own package.json.
 * package.json лежит рядом с core.js (и при npm-установке, и при локальном пути),
 * поэтому путь резолвится относительно import.meta.url.
 * @returns {string|undefined}  Version string, or undefined on any error (fail-soft).
 */
export function readPluginVersion() {
  try {
    const pkgPath = path.join(path.dirname(new URL(import.meta.url).pathname), "package.json");
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
    return typeof pkg.version === "string" && pkg.version ? pkg.version : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Write the plugin version to `<dir>/.maestro/plugin-version`.
 * Перезаписывается при каждом init → отражает загруженную версию.
 * Провал записи молча игнорируется (fail-soft) — версия не критична.
 * @param {string} dir      Project directory.
 * @param {string|undefined} version  Version to write (skips if undefined).
 */
export function writePluginVersionFile(dir, version) {
  if (typeof version !== "string" || !version) return;
  try {
    fs.mkdirSync(path.join(dir, ".maestro"), { recursive: true });
    fs.writeFileSync(path.join(dir, ".maestro/plugin-version"), version + "\n", "utf8");
  } catch {
    /* version file is best-effort; never break the session */
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd plugins/maestro-bootstrap && npm test`
Expected: PASS for all new tests (existing tests also pass).

- [ ] **Step 6: Commit**

```bash
git add plugins/maestro-bootstrap/core.js plugins/maestro-bootstrap/index.test.js
git commit -m "feat(bootstrap): read and write plugin version file"
```

---

### Task 2: Emit version in `plugin initialized` audit-log

**Files:**
- Modify: `plugins/maestro-bootstrap/core.js` (inside `MaestroBootstrapPlugin`)

- [ ] **Step 1: Modify `MaestroBootstrapPlugin`**

In `MaestroBootstrapPlugin` (core.js), after `const root = directory || process.cwd();` add:

```js
const version = readPluginVersion();
```

Then change the `plugin initialized` log call (currently around line 728) to include `version`:

```js
log.info("plugin initialized", {
  version,
  logDir: log.logDir,
  level: log.level,
  mask: log.mask,
});
```

Also call `writePluginVersionFile(root, version);` right before the `log.info("plugin initialized", ...)` block.

- [ ] **Step 2: Add test for the log field**

Add inside the `maestro-bootstrap plugin version` describe block:

```js
it("plugin initialized log entry includes the version field", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fab-ver-log-"));
  try {
    await MaestroBootstrapPlugin({ directory: dir });
    const entries = readLogs(dir);
    const init = entries.find((e) => e.msg === "plugin initialized");
    assert.ok(init, "plugin initialized entry must exist");
    assert.match(init.version, /^\d+\.\d+\.\d+$/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 3: Run tests**

Run: `cd plugins/maestro-bootstrap && npm test`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add plugins/maestro-bootstrap/core.js plugins/maestro-bootstrap/index.test.js
git commit -m "feat(bootstrap): include plugin version in plugin initialized log"
```

---

### Task 3: Create `/maestro-version` command

**Files:**
- Create: `commands/maestro-version.md`
- Create: `.opencode/commands/maestro-version.md`

- [ ] **Step 1: Create `commands/maestro-version.md`**

```markdown
---
description: Показать версию подключённого плагина maestro-bootstrap (из .maestro/plugin-version)
---

# /maestro-version

Покажи пользователю версию плагина `maestro-bootstrap`, подключённого в этой
сессии OpenCode.

## Действия

1. Прочитай файл `.maestro/plugin-version` (в корне текущего проекта) через `read`.
2. Если файл существует и содержит непустую версию — сообщи:
   "Подключён плагин maestro-bootstrap версии `<версия>`."
3. Если файл отсутствует или пуст — сообщи явно:
   "Плагин maestro-bootstrap не инициализирован или версия неизвестна."
   (файл пишется только при успешной инициализации плагина — это признак сбоя init).

Все сообщения пользователю — только на русском языке.
```

- [ ] **Step 2: Mirror to `.opencode/commands/maestro-version.md`**

Copy the exact same file content to `.opencode/commands/maestro-version.md`.

```bash
mkdir -p .opencode/commands && cp commands/maestro-version.md .opencode/commands/maestro-version.md
```

- [ ] **Step 3: Verify mirror is identical**

Run: `diff commands/maestro-version.md .opencode/commands/maestro-version.md`
Expected: no output (identical).

- [ ] **Step 4: Commit**

```bash
git add commands/maestro-version.md .opencode/commands/maestro-version.md
git commit -m "feat(commands): add /maestro-version command"
```

---

### Task 4: Document `/maestro-version` in manual_docs

**Files:**
- Modify: `manual_docs/reference/commands.md`

- [ ] **Step 1: Add a command section**

In `manual_docs/reference/commands.md`, after the `/test-agents` section (after line 68), insert:

```markdown
### `/maestro-version`

Показать версию плагина `maestro-bootstrap`, подключённого в текущей сессии.
Читает `.maestro/plugin-version` (пишется при инициализации плагина). Если файла
нет — сообщает, что плагин не инициализирован или версия неизвестна (признак
сбоя init плагина).
```

- [ ] **Step 2: Verify**

Read the section to confirm formatting matches surrounding command docs (consistent `###` header and paragraph style).

- [ ] **Step 3: Commit**

```bash
git add manual_docs/reference/commands.md
git commit -m "docs: document /maestro-version command"
```

---

### Task 5: Add `.maestro/plugin-version` to `.gitignore` list in maestro-init

**Files:**
- Modify: `skills/maestro-init/SKILL.md` (lines 230-235)

- [ ] **Step 1: Update the fixed `.gitignore` list**

In `skills/maestro-init/SKILL.md`, change the block at lines 230-235 from:

```
.maestro/sdd/
.maestro/last-run.md
.maestro/logs/
.maestro/feedback-reports/
```

to:

```
.maestro/sdd/
.maestro/last-run.md
.maestro/logs/
.maestro/feedback-reports/
.maestro/plugin-version
```

- [ ] **Step 2: Update the `manual_docs` if it references the list**

Check whether `manual_docs/` or `skills/maestro/SKILL.md` documents the same `.gitignore` list. If the exact list `.maestro/sdd/`, `.maestro/last-run.md`, `.maestro/logs/`, `.maestro/feedback-reports/` appears anywhere else, add `.maestro/plugin-version` there too.

Run: `rg -n "feedback-reports/|\.maestro/sdd/" skills/ manual_docs/`

- [ ] **Step 3: Commit**

```bash
git add skills/maestro-init/SKILL.md
git commit -m "chore(init): gitignore .maestro/plugin-version in new projects"
```

---

### Task 6: Final verification

**Files:**
- Test: `plugins/maestro-bootstrap/index.test.js`

- [ ] **Step 1: Run the full plugin test suite**

Run: `cd plugins/maestro-bootstrap && npm test`
Expected: all tests pass (new + existing).

- [ ] **Step 2: Manual smoke test**

Run the plugin in a throwaway directory to confirm the version file is written and logged:

```bash
TMP=$(mktemp -d) && node -e "
import('plugins/maestro-bootstrap/core.js').then(async (m) => {
  const hooks = await m.MaestroBootstrapPlugin({ directory: '$TMP' });
  const fs = await import('node:fs');
  const ver = fs.readFileSync('$TMP/.maestro/plugin-version', 'utf8').trim();
  console.log('version file:', ver);
  console.log('readPluginVersion:', m.readPluginVersion());
  await hooks.dispose();
});" && rm -rf "$TMP"
```

Expected: `version file:` and `readPluginVersion:` both print a valid semver, matching the plugin's `package.json` version.

- [ ] **Step 3: Confirm spec coverage**

Verify all spec sections are implemented:
- `readPluginVersion()` from package.json — Task 1.
- `writePluginVersionFile()` to `.maestro/plugin-version` — Task 1.
- `plugin initialized` log gains `version` field — Task 2.
- `/maestro-version` command (with not-initialized path) — Task 3.
- `commands/` mirror to `.opencode/commands/` — Task 3.
- `manual_docs/reference/commands.md` documentation — Task 4.
- `maestro-init` `.gitignore` list update — Task 5.

- [ ] **Step 4: Commit any remaining changes**

```bash
git status
git add -A
git commit -m "test(bootstrap): verify plugin version exposure end-to-end"
```