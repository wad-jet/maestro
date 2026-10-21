# Pipeline Isolation & Merge-Scope Hardening — Implementation Plan

> **Для agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Предотвратить инцидент, где merge в mainline протаскивает чужие незавершённые коммиты (2026-10-21), через три уровня защиты: процессное правило (SKILL.md), механические гарды плагина и ревью merge-scope на гейте 17.

**Architecture:** Изменения касаются SKILL.md (3 шага пайплайна), merge-guard.js (новый guard + head-pin), core.js (хук branch-base guard), tests, и документации. Все изменения минимальны и локальны.

**Tech Stack:** Node.js ESM, Node test runner.

**Spec:** `docs/superpowers/specs/2026-10-21-pipeline-isolation-hardening-design.md`

## Global Constraints

- Версия: `6.4.0` → `6.5.0` (minor, процессное правило + фича плагина)
- Рабочий язык: русский (HITL gates, сообщения)
- Плагин обязателен для всех новых механизмов (P5-гейт)
- backward compatible: head-pin marker v2 — v1 markers (без head) игнорируют head-pin
- `merge_guard.branch_base_guard` default: `"warn"`; `merge_guard.head_pin` default: `false`
- All tests via `node --test plugins/maestro-bootstrap/index.test.js`
- `maestro.json` read-only через `maestro_config` тул (P6)

## Review Focus

1. **Branch-base regex:** `git worktree add -b <branch> <dir>` без явного base-аргумента (4-й аргумент — dir, 3-й должен быть base). Regex не должен ложно матчить `git worktree add <dir> -b <branch>`.
2. **Head-pin backward compat:** маркер без поля `head` → old behavior (allow). Проверить JSON parse — отсутствие поля ≠ error.
3. **SKILL.md drift:** указатели на шаги 3/6/17 в manual_docs/ должны резолвиться.
4. **Test isolation:** новые тесты не должны ломать существующие 250+ тестов.
5. **Merge-guard hook collision:** branch-base hook не должен интерферировать с merge/push-mainline guards (разные detect-функции, разные константы error).

---

## Task 1: SKILL.md — Step 3 (workspace occupancy) + Step 6 (isolation HITL)

**Files:**
- Modify: `skills/maestro/SKILL.md` (steps 3 and 6 sections)

**Interfaces:**
- Consumes: none (documentation-only)
- Produces: new text blocks that orchestrator follows at steps 3 and 6

**Steps:**

- [ ] **Step 1: Locate current Step 3 text in SKILL.md**
  Read `skills/maestro/SKILL.md`, find the step 3 section (Pre-flight diagnostics). Identify where to insert the new workspace occupancy block.

- [ ] **Step 2: Insert workspace occupancy check into Step 3**
  After the existing pre-flight signals, add:
  ```
  — **Workspace occupancy (новый):**
     - `git branch --show-current` ≠ mainline (main/master/develop, auto-детект)
       И ветка матчит паттерн `feature/*|fix/*|hotfix/*` → **SIGNAL: workspace occupied by foreign feature**
       (показать имя ветки) → isolation recommendation = **worktree**
     - `git branch --show-current` ≠ mainline, other pattern → сигнал + явный HITL
     - `git branch --show-current` == mainline → "free workspace"
  ```
  Include a one-line output to session: "Предуведомление: текущий workspace занят веткой `<name>` (чужая активная фича). Рекомендуется worktree."

- [ ] **Step 3: Modify Step 6 to explicit HITL gate**
  Replace current implicit step 6 with explicit gate:
  ```
  🟢  6. [agent] Загрузить `using-git-worktrees`
        -- HITL GATE: выбрать изоляцию --
        (a) worktree [рекомендуется, если workspace occupied]
            `git worktree add -b <branch> <dir> <mainline>`
        (b) plain branch
            `git checkout -b <branch> <mainline>`
            Только при mainline + clean tree
        (c) отмена
        Примечание:
          - База ВСЕГДА <mainline> — явный, не implicit HEAD
          - Исключение (stacked на чужую фичу): только явный HITL
            «Я знаю, что делаю: стекаю поверх <branch>» — с предупреждением о рисках
          - Записать в session vars: BRANCH_BASE_SHA, BRANCH_NAME
          - При worktree: вызвать `tools.opencode.session_move` к worktree-dir
  ```

- [ ] **Step 4: Run docs-drift check**
  ```bash
  node maestro-install/docs-drift.test.mjs
  ```
  Ensure no drift introduced by SKILL.md changes.

- [ ] **Step 5: Commit**
  ```bash
  git add skills/maestro/SKILL.md
  git commit -m "docs(SKILL.md): workspace occupancy (step 3) + isolation HITL (step 6)"
  ```

---

## Task 2: SKILL.md — Step 17 (merge-scope review)

**Files:**
- Modify: `skills/maestro/SKILL.md` (gate 17 section)

**Interfaces:**
- Consumes: `BRANCH_BASE_SHA` from step 6 (session var, documented in Task 1)
- Produces: new pre-merge gate text

**Steps:**

- [ ] **Step 1: Locate current Gate 17 text in SKILL.md**
  Read `skills/maestro/SKILL.md`, find gate 17 (pre-PR) section.

- [ ] **Step 2: Add merge-scope review before marker gate**
  Before the gate-17 marker creation, add a new HITL gate:
  ```
  -- HITL GATE: ревью merge-scope --
  Оркестратор обязан показать:
    $ git log --oneline <mainline>..HEAD
    $ git diff --stat <mainline>...HEAD
  — и сравнить с ожидаемыми коммитами пайплайна (design+plan + SDD tasks).

  Если в scope обнаружены коммиты, не созданные этим пайплайном
  (до шага 6, или чужая ветка):
    **HARD STOP**: «Merge scope содержит N чужих коммитов»
    (a) rebase fix branch onto mainline и продолжить
    (b) продолжить с явным acknowledge: «я осознаю, что мержит чужую работу»
    (c) отмена

  Если scope чист — продолжить к маркеру гейта 17.

  Механический индикатор: merge-base(mainline, HEAD) должно == BRANCH_BASE_SHA
  (записано при создании ветки). Расхождение = сигнал «scope загрязнён».
  ```

- [ ] **Step 3: Run docs-drift check**
  ```bash
  node maestro-install/docs-drift.test.mjs
  ```

- [ ] **Step 4: Commit**
  ```bash
  git add skills/maestro/SKILL.md
  git commit -m "docs(SKILL.md): merge-scope review gate 17 (hard stop for foreign commits)"
  ```

---

## Task 3: Plugin — Branch-base guard

**Files:**
- Modify: `plugins/maestro-bootstrap/merge-guard.js`
- Modify: `plugins/maestro-bootstrap/core.js` (hook)
- Modify: `plugins/maestro-bootstrap/merge-guard.test.js` (tests)
- Modify: `plugins/maestro-bootstrap/index.test.js` (integration)

**Interfaces:**
- Consumes: `merge_guard.branch_base_guard` from `maestro.json` (via `resolveMergeGuardConf`)
- Produces: new exported function `detectCheckoutCommand`, new function `checkBranchBaseGuard`

**Steps:**

- [ ] **Step 1: Add config key to resolveMergeGuardConf**
  In `resolveMergeGuardConf`, add:
  ```js
  const branchBaseGuard = typeof sec.branch_base_guard === "string"
    && ["warn", "deny", "off"].includes(sec.branch_base_guard)
    ? sec.branch_base_guard : "warn";
  // ...
  return {
    enabled: typeof sec.enabled === "boolean" ? sec.enabled : true,
    ttlSec: typeof sec.ttlSec === "number" && sec.ttlSec > 0 ? sec.ttlSec : 600,
    commitGuard,
    branchBaseGuard,
    headPin: typeof sec.head_pin === "boolean" ? sec.head_pin : false,
  };
  ```

- [ ] **Step 2: Add detectCheckoutCommand function**
  After `detectGuardCommand`, add:
  ```js
  /**
   * Детект команд, требующих branch-base guard:
   * - `git checkout -b <name>` (без --orphan/-t), не mainline branch
   * - `git worktree add -b <name> <dir>`
   * Возвращает `{ kind: "checkout-b"|"worktree-add-b" }` или null.
   */
  export function detectCheckoutCommand(command) {
    if (typeof command !== "string" || !command.trim()) return null;
    const first = command.trimStart().split(/\s+/)[0];
    if (first === "echo") return null;
    // git checkout -b <branch> [--orphan] [--track] [<base>]
    const checkoutMatch = command.match(/git\s+checkout\s+-b\s+(\S+)/);
    if (checkoutMatch) {
      // Has --orphan or --t/--track → skip (not creating from head)
      if (/\s--orphan\b/.test(command)) return null;
      if (/\s-[^-b]\s/.test(command) && /-t/.test(command)) return null;
      return { kind: "checkout-b" };
    }
    // git worktree add -b <branch> <dir> [<base>]
    const worktreeMatch = command.match(/git\s+worktree\s+add\s+-b\s+(\S+)/);
    if (worktreeMatch) return { kind: "worktree-add-b" };
    return null;
  }
  ```

- [ ] **Step 3: Add checkBranchBaseGuard function**
  ```js
  /**
   * Проверка branch-base guard.
   * 1. Текущая ветка == mainline (main/master/develop)?
   * 2. Если нет → есть ли явный base-аргумент в команде?
   * 3. Нет base + не mainline → warn/deny.
   * @param {string} command  Bash command (from detectCheckoutCommand).
   * @param {string} root  Project root.
   * @param {string} workdir  Working directory for git call.
   * @param {{branchBaseGuard: string}} conf  Config.
   * @param {{execGit?: (args: string[]) => string}} [opts]  DI seam.
   * @returns {{allow: boolean, reason: string}}
   */
  export function checkBranchBaseGuard(command, detectedKind, root, workdir, conf, { execGit } = {}) {
    // Check if there's an explicit base argument
    const hasExplicitBase = detectedKind === "checkout-b"
      ? /\s+-b\s+\S+\s+/.test(command) && !/--orphan/.test(command) && /\s+\S+\s*$/.test(command)
      : detectedKind === "worktree-add-b"
        ? /\s+-b\s+\S+\s+\S+\s+\S+/.test(command)  // -b branch dir base (4+ args)
        : false;

    // Determine current branch
    let branch;
    try {
      branch = (typeof execGit === "function" ? execGit : defaultExecGit)(
        ["-C", workdir, "branch", "--show-current"]);
    } catch {
      return conf.branchBaseGuard === "deny"
        ? { allow: false, reason: "guard_error" }
        : { allow: true, reason: "guard_error" };
    }
    const b = typeof branch === "string" ? branch.trim() : "";

    // If current branch is mainline → allow (no guard needed)
    const mainlines = ["main", "master", "develop"];
    if (mainlines.includes(b)) return { allow: true, reason: "mainline_base" };

    // If explicit base provided → allow
    if (hasExplicitBase) return { allow: true, reason: "explicit_base" };

    // No base on non-mainline → warn or deny
    if (conf.branchBaseGuard === "deny") {
      return { allow: false, reason: "branch_base_violation" };
    }
    return { allow: true, reason: "branch_base_warning" };
  }
  ```

- [ ] **Step 4: Add integration hook in core.js**
  In `core.js`, add a new `if` block in `tool.execute.before` (after merge guard, before commit guard):
  ```js
  // Branch-base guard
  if (input.tool === "shell" && mergeGuardConf.enabled && mergeGuardConf.branchBaseGuard !== "off") {
    const cmd = typeof event.input?.command === "string" ? event.input.command : "";
    const detected = detectCheckoutCommand(cmd);
    if (detected) {
      const workdir = typeof event.input?.workdir === "string" ? event.input.workdir : root;
      const res = checkBranchBaseGuard(cmd, detected.kind, root, workdir, mergeGuardConf);
      const base = { sessionID: input.sessionID, callID: input.callID, kind: detected.kind, reason: res.reason };
      if (res.allow) {
        if (res.reason === "branch_base_warning") {
          log.warn("branch_base_guard", { action: "warn", ...base });
        }
      } else {
        log.warn("branch_base_guard", { action: "deny", ...base });
        const err = new Error(
          `[branch-base-guard:deny] Создание ветки заблокировано: текущая ветка не mainline без явного base.`
        );
        err.mergeGuard = true;
        throw err;
      }
    }
  }
  ```

- [ ] **Step 5: Write unit tests in merge-guard.test.js**
  Add `describe("merge-guard branch-base")`:
  - `it("detects git checkout -b")`
  - `it("detects git worktree add -b")`
  - `it("skips git checkout -b --orphan")`
  - `it("allows from mainline without explicit base")`
  - `it("allows checkout -b <base> from any branch")`
  - `it("warns from non-mainline without base, mode warn")`
  - `it("denies from non-mainline without base, mode deny")`
  - `it("allow when explicit base in worktree add -b")`

- [ ] **Step 6: Write integration test in index.test.js**
  Add test: `it("branch_base_guard: 'deny' → checkout -b from non-mainline without base throws")`
  Use a real git repo on feature/branch, write cfg with `branch_base_guard: "deny"`, call `tool.execute.before` with `git checkout -b new-branch`, expect reject.

- [ ] **Step 7: Run all plugin tests**
  ```bash
  node --test plugins/maestro-bootstrap/index.test.js
  node --test plugins/maestro-bootstrap/merge-guard.test.js
  ```
  Ensure all 250+ existing tests still pass + new tests pass.

- [ ] **Step 8: Commit**
  ```bash
  git add plugins/maestro-bootstrap/merge-guard.js plugins/maestro-bootstrap/core.js plugins/maestro-bootstrap/merge-guard.test.js plugins/maestro-bootstrap/index.test.js
  git commit -m "feat(plugin): branch-base guard (warn/deny mode, prevents checkout -b from non-mainline)"
  ```

---

## Task 4: Plugin — Head-pin маркера гейта 17

**Files:**
- Modify: `plugins/maestro-bootstrap/merge-guard.js` (modify `checkMergeMarker`)
- Modify: `plugins/maestro-bootstrap/merge-guard.test.js` (add head-pin tests)

**Interfaces:**
- Consumes: `merge_guard.head_pin` from config
- Produces: enhanced `checkMergeMarker` that validates HEAD on merge

**Steps:**

- [ ] **Step 1: Modify checkMergeMarker to support head-pin**
  The function signature stays the same, but adds:
  - After successful marker validation, check for `head` field
  - If `head` field exists and `head_pin` config is true:
    - Run `git rev-parse HEAD` via execGit (pass DI seam)
    - Compare with marker.head
    - Mismatch → `{ allow: false, reason: "marker_head_mismatch" }`
  - If no `head` field → skip head-pin check (backward compat with v1 markers)

  Update the function to accept an additional `opts` param for `execGit`:
  ```js
  export function checkMergeMarker(root, sessionID, nowMs, conf, { execGit } = {}) {
    // ... existing code ...
    // After gate check, add head-pin validation:
    if (conf.headPin && typeof data.head === "string") {
      // Marker v2 has head field AND head_pin enabled
      let currentHead;
      try {
        currentHead = (typeof execGit === "function" ? execGit : defaultExecGit)(
          ["-C", root, "rev-parse", "HEAD"]);
      } catch {
        return { allow: false, reason: "guard_error" };
      }
      if (currentHead.trim() !== data.head.trim()) {
        return { allow: false, reason: "marker_head_mismatch" };
      }
    }
    return { allow: true, reason: "marker_ok" };
  }
  ```

- [ ] **Step 2: Update hook in core.js to pass HEAD at marker creation time**
  In the orchestrator flow (core.js, where marker file is conceptually "validated" — but the marker file is written by the orchestrator, not the plugin), we don't need to change the hook. The orchestrator writes the marker file with `head: <SHA>` — the plugin just reads and validates. The plugin hook only needs to pass `execGit` for the HEAD comparison.
  
  Update the hook to inject execGit:
  ```js
  const res = checkMergeMarker(root, input.sessionID, Date.now(), mergeGuardConf, {
    execGit: (args) => execFileSync("git", args, { timeout: 3000, encoding: "utf8" })
  });
  ```

- [ ] **Step 3: Add head-pin tests in merge-guard.test.js**
  Add `describe("merge-guard head-pin")`:
  - `it("allows merge when HEAD == marker.head (head_pin true)")`
  - `it("denies merge when HEAD != marker.head (head_pin true)")`
  - `it("allows v1 marker (no head field) for backward compat")`
  - `it("ignores head_pin config when marker has no head field")`

- [ ] **Step 4: Run all tests**
  ```bash
  node --test plugins/maestro-bootstrap/merge-guard.test.js
  node --test plugins/maestro-bootstrap/index.test.js
  ```

- [ ] **Step 5: Commit**
  ```bash
  git add plugins/maestro-bootstrap/merge-guard.js plugins/maestro-bootstrap/core.js plugins/maestro-bootstrap/merge-guard.test.js
  git commit -m "feat(plugin): head-pin merge marker v2 (detects post-approve HEAD mutation)"
  ```

---

## Task 5: Docs sync + changelog + regression entry

**Files:**
- Modify: `SECURITY.md` (§7 — open questions / hardening)
- Modify: `manual_docs/overview/changelog.md` (new section)
- Create: `regression/entries/INC-2026-10-21-merge-scope-contamination.md`

**Steps:**

- [ ] **Step 1: Add regression entry**
  Create `regression/entries/INC-2026-10-21-merge-scope-contamination.md`:
  ```markdown
  ---
  id: INC-2026-10-21-merge-scope-contamination
  date: 2026-10-21
  severity: medium
  category: process
  status: resolved
  resolved_by: feature/pipeline-isolation-hardening
  ---
  # Merge-scope contamination (2026-10-21)

  **Суть:** merge в mainline протащил 3 чужих docker-serve коммита через
  ошибочное ветвление от feature-ветки.

  **Impact:** 1126 строк спеки в main (docker-serve v17 design) без своего гейта 17.

  **Timeline:**
  - 09:47 — merge guard approved (gate 17)
  - 09:48 — merge fast-forward 906aadd→3b80b9e (4 коммита вместо 1)
  - 11:00 — обнаружение через `git log main`

  **Root cause:**
  1. Workspace занят чужой фичей (feature/docker-serve-design), не детектируется
  2. Ветка создана от feature HEAD, а не mainline
  3. Merge-guard проверяет только наличие маркера, не содержимое merge

  **Mitigation:** pipeline-isolation-hardening (эта фича) — branch-base guard,
  head-pin marker, merge-scope review gate 17.
  ```

- [ ] **Step 2: Update SECURITY.md §7**
  Add to §7 (Открытые вопросы / roadmap ИБ):
  ```markdown
  - Pipeline isolation hardening: branch-base guard + head-pin marker v2
    (this feature, resolved by feature/pipeline-isolation-hardening).
  ```

- [ ] **Step 3: Update changelog.md**
  Add section to `manual_docs/overview/changelog.md`:
  ```markdown
  ## [2026-10-21]

  > **Версия 6.5.0** — pipeline isolation hardening (branch-base guard, head-pin merge marker v2, merge-scope review gate 17)

  - **Новое:** pipeline isolation hardening — предотвращение протаскивания чужих коммитов при merge (SKILL.md steps 3/6/17, plugin merge-guard: branch-base guard, head-pin marker, merge-scope review).
  - **Инструменты:** `@maestro-memory*` (включены в стандарт)
  ```
  (adjust to match existing changelog format exactly)

- [ ] **Step 4: Verify docs-drift**
  ```bash
  node maestro-install/docs-drift.test.mjs
  ```

- [ ] **Step 5: Commit**
  ```bash
  git add SECURITY.md manual_docs/overview/changelog.md regression/entries/
  git commit -m "docs: regression entry + changelog + SECURITY.md for pipeline isolation hardening"
  ```

---

## Task 6: Design+Plan commit + baseline

**Files:**
- Commit: `skills/maestro/SKILL.md`, `docs/superpowers/plans/`, `regression/entries/`, `SECURITY.md`, `manual_docs/overview/changelog.md`

**Steps:**

- [ ] **Step 1: Verify all worktree changes are clean for design+plan commit**
  ```bash
  git status --short
  ```
  Should show only staged changes from Tasks 1-5.

- [ ] **Step 2: Commit design + plan (convention: one commit before SDD)**
  ```bash
  git commit -m "docs: design + plan for pipeline-isolation-hardening"
  ```
  This is the BASE commit for SDD (Task 7+).

- [ ] **Step 3: Verify clean baseline for SDD**
  ```bash
  git log --oneline -1
  # Should show the design+plan commit
  git diff main --stat
  # Should show all changed files
  ```

---

> **Plan complete.** Для имплементации выберите:
> - **Subagent-driven** — subagent реализует каждый task, reviewer проверяет перед следующим
> - **Native** — я реализую каждый task в текущей сессии, reviewer в конце

> **Рекомендую: Subagent-driven**, потому что Tasks 1-2 (SKILL.md) и Tasks 3-4 (plugin code) независимы и могут идти параллельно; Task 5 (docs) — зависим от Tasks 1-4.
