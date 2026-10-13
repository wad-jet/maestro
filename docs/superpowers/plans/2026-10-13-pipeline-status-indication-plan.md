# Pipeline Status Indication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Добавить индикацию текущего состояния пайплайна maestro — статус-блок в system prompt и инструмент `maestro_pipeline_status` для set/clear/get.

**Architecture:** Новый модуль `pipeline-status.js` (аналог `communication.js`) с ESM state, context-hook инъекцией и tool-регистрацией. Интеграция в `core.js` (хуки + transform). Оркестратор вызывает tool на каждом шаге.

**Tech Stack:** Node.js ESM, OpenCode V2 plugin API (`ctx.session.hook`, `ctx.tool.transform`), встроенный Node test runner.

**Spec:** `docs/superpowers/specs/2026-10-13-pipeline-status-indication-design.md`

## Global Constraints

- Plugin API: V2 (ctx.session.hook, ctx.tool.transform, ctx.event.subscribe).
- All user-facing messages in Russian.
- Security: SEC-4b compliance — status block contains only technical data (step numbers, descriptions), no confidential data.
- Fail-soft: all hooks and tools catch errors; failures are logged, not thrown.
- Guard on `set`/`clear`: only top-level primary sessions (parentID === undefined).
- Existing patterns: follow `communication.js` pattern for context hook registration, `core.js` pattern for tool registration.

## Review Focus

1. **Guard bypass** — non-primary session calls `set`: guard must deny, not crash.
2. **Race on state** — multiple `set` calls before next context-hook evaluation: last-write-wins, no corruption.
3. **Context hook interference** — pipeline-status injection must not break other context hooks (communication, feedback-report): each hook is independent, no shared mutable state between hooks.
4. **Dispose correctness** — plugin dispose must clean up all registrations; double-dispose must be safe.
5. **Tool input validation** — `action` must be one of `set|clear|get`; missing required params on `set` must return clear error, not crash.

---

## Task 1: Core module `pipeline-status.js`

**Files:**
- Create: `plugins/maestro-bootstrap/pipeline-status.js`
- Create: `plugins/maestro-bootstrap/pipeline-status.test.js`

**Interfaces:**
- Consumes: nothing
- Produces: `setPipelineStatus(params)`, `clearPipelineStatus()`, `getPipelineStatus()`, `registerPipelineStatusHooks({client, config, log})`, `makePipelineStatusTool({client, log})`

### Step 1: Write the module skeleton with state

In `plugins/maestro-bootstrap/pipeline-status.js`:

```js
// Pipeline Status module — V2 migration.
// Self-contained module: NOT importing core.js (ESM-cycle guard).

let state = { active: false, step: null, totalSteps: null, description: '' };

export function getPipelineStatus() {
  return { ...state };
}

export function setPipelineStatus({ step, totalSteps, description }) {
  state = { active: true, step, totalSteps, description };
}

export function clearPipelineStatus() {
  state = { active: false, step: null, totalSteps: null, description: '' };
}
```

- [ ] **Step 1: Write the module skeleton with state**

Create `plugins/maestro-bootstrap/pipeline-status.js` with:
- Module-level `let state = { active: false, step: null, totalSteps: null, description: '' }`
- Export `getPipelineStatus()` — returns shallow copy of state
- Export `setPipelineStatus({ step, totalSteps, description })` — sets state, active=true
- Export `clearPipelineStatus()` — resets state to idle

- [ ] **Step 2: Write tests for state operations**

In `plugins/maestro-bootstrap/pipeline-status.test.js`:

```js
import { describe, it, assert } from "node:test";
import * as ps from "./pipeline-status.js";

describe("pipeline-status state", () => {
  it("initial state is idle", () => {
    const s = ps.getPipelineStatus();
    assert.equal(s.active, false);
    assert.equal(s.step, null);
  });

  it("set updates state", () => {
    ps.setPipelineStatus({ step: 7, totalSteps: 18, description: "Test" });
    const s = ps.getPipelineStatus();
    assert.equal(s.active, true);
    assert.equal(s.step, 7);
    assert.equal(s.totalSteps, 18);
    assert.equal(s.description, "Test");
  });

  it("clear resets state", () => {
    ps.setPipelineStatus({ step: 5, totalSteps: 10, description: "Before" });
    ps.clearPipelineStatus();
    const s = ps.getPipelineStatus();
    assert.equal(s.active, false);
    assert.equal(s.step, null);
  });

  it("state is a copy — mutating return doesn't affect internal", () => {
    const s = ps.getPipelineStatus();
    s.active = true; // mutate
    const s2 = ps.getPipelineStatus();
    assert.equal(s2.active, false); // internal not affected
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `node --test plugins/maestro-bootstrap/pipeline-status.test.js`
Expected: FAIL — file not found / exports not defined.

- [ ] **Step 4: Implement the state operations**

The skeleton above is the implementation. It's pure ESM module — no side effects.

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test plugins/maestro-bootstrap/pipeline-status.test.js`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add plugins/maestro-bootstrap/pipeline-status.js plugins/maestro-bootstrap/pipeline-status.test.js
git commit -m "feat: add pipeline-status core module with state management"
```

### Step 2: Add status block generation

- [ ] **Step 1: Write the status block generation test**

Add to `pipeline-status.test.js`:

```js
describe("status block generation", () => {
  it("idle generates idle block", () => {
    ps.clearPipelineStatus();
    const block = ps.formatStatusBlock();
    assert.ok(block.includes("maestro pipeline: idle"));
  });

  it("active generates active block with step info", () => {
    ps.setPipelineStatus({ step: 7, totalSteps: 18, description: "Feature Classification" });
    const block = ps.formatStatusBlock();
    assert.ok(block.includes("maestro pipeline: active"));
    assert.ok(block.includes("step 7/18"));
    assert.ok(block.includes("Feature Classification"));
  });

  it("format uses totalSteps as-is (supports floats like '18.5')", () => {
    ps.setPipelineStatus({ step: 18, totalSteps: "18.5", description: "Feedback Report" });
    const block = ps.formatStatusBlock();
    assert.ok(block.includes("step 18/18.5"));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test plugins/maestro-bootstrap/pipeline-status.test.js`
Expected: FAIL — `formatStatusBlock` not defined.

- [ ] **Step 3: Implement `formatStatusBlock()`**

Add to `pipeline-status.js`:

```js
export function formatStatusBlock() {
  if (!state.active) {
    return "## maestro pipeline: idle";
  }
  const total = state.totalSteps ?? '?';
  return `## maestro pipeline: active (step ${state.step}/${total}, ${state.description})`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test plugins/maestro-bootstrap/pipeline-status.test.js`
Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
git add plugins/maestro-bootstrap/pipeline-status.js plugins/maestro-bootstrap/pipeline-status.test.js
git commit -m "feat: add status block formatting for pipeline status"
```

---

## Task 2: Context hook registration

**Files:**
- Modify: `plugins/maestro-bootstrap/pipeline-status.js` — add `registerPipelineStatusHooks`
- Modify: `plugins/maestro-bootstrap/pipeline-status.test.js` — add hook registration tests

**Interfaces:**
- Consumes: `getPipelineStatus()`, `formatStatusBlock()` from same module
- Produces: `registerPipelineStatusHooks({client, config, log}) → {dispose}`

### Step 1: Write hook registration test

Add to `pipeline-status.test.js`:

```js
import { describe, it, assert } from "node:test";
import * as ps from "./pipeline-status.js";

describe("registerPipelineStatusHooks", () => {
  it("registers a context hook and returns dispose", async () => {
    let disposed = false;
    const mockClient = {
      session: {
        hook: async (name, fn) => {
          assert.equal(name, "context");
          // Simulate: call the hook with a mock event
          const event = { system: [] };
          await fn(event);
          // Check that system block was injected
          assert.ok(event.system.some(s => typeof s === "object" && s.text?.includes("maestro pipeline")));
          return { dispose: () => { disposed = true; } };
        }
      }
    };
    const result = ps.registerPipelineStatusHooks({ client: mockClient, config: {}, log: {} });
    assert.ok(result.dispose);
    result.dispose();
    assert.equal(disposed, true);
  });

  it("injects idle block when pipeline not active", async () => {
    ps.clearPipelineStatus();
    let capturedSystem = null;
    const mockClient = {
      session: {
        hook: async (name, fn) => {
          const event = { system: [] };
          await fn(event);
          capturedSystem = event.system;
          return { dispose: () => {} };
        }
      }
    };
    ps.registerPipelineStatusHooks({ client: mockClient, config: {}, log: {} });
    assert.ok(capturedSystem.some(s => s.text?.includes("idle")));
  });

  it("injects active block when pipeline is active", async () => {
    ps.setPipelineStatus({ step: 3, totalSteps: 18, description: "Pre-flight" });
    let capturedSystem = null;
    const mockClient = {
      session: {
        hook: async (name, fn) => {
          const event = { system: [] };
          await fn(event);
          capturedSystem = event.system;
          return { dispose: () => {} };
        }
      }
    };
    ps.registerPipelineStatusHooks({ client: mockClient, config: {}, log: {} });
    assert.ok(capturedSystem.some(s => s.text?.includes("active")));
    assert.ok(capturedSystem.some(s => s.text?.includes("step 3/18")));
  });
});
```

- [ ] **Step 1: Write hook registration test**

Create the test above. Run: `node --test plugins/maestro-bootstrap/pipeline-status.test.js`
Expected: FAIL — `registerPipelineStatusHooks` not defined.

- [ ] **Step 2: Implement `registerPipelineStatusHooks`**

Add to `pipeline-status.js`:

```js
export async function registerPipelineStatusHooks({ client, config, log }) {
  const registration = await client.session.hook("context", async (event) => {
    try {
      const block = formatStatusBlock();
      if (!event.system) event.system = [];
      event.system.push({ type: "text", text: block });
      log?.debug?.("pipeline-status:injected", { block });
    } catch (err) {
      log?.error?.("pipeline-status:inject_failed", { error: err instanceof Error ? err.message : String(err) });
    }
  });
  return { dispose: () => registration?.dispose?.() };
}
```

- [ ] **Step 3: Run test to verify it passes**

Run: `node --test plugins/maestro-bootstrap/pipeline-status.test.js`
Expected: PASS (all tests).

- [ ] **Step 4: Commit**

```bash
git add plugins/maestro-bootstrap/pipeline-status.js plugins/maestro-bootstrap/pipeline-status.test.js
git commit -m "feat: register pipeline-status context hook for system prompt injection"
```

---

## Task 3: Tool registration

**Files:**
- Modify: `plugins/maestro-bootstrap/pipeline-status.js` — add `makePipelineStatusTool`
- Modify: `plugins/maestro-bootstrap/pipeline-status.test.js` — add tool tests

**Interfaces:**
- Consumes: `getPipelineStatus()`, `setPipelineStatus()`, `clearPipelineStatus()` from same module
- Produces: `makePipelineStatusTool({client, log}) → tool object` (name, description, input schema, execute)

### Step 1: Write tool tests

Add to `pipeline-status.test.js`:

```js
describe("makePipelineStatusTool", () => {
  it("get returns current state", async () => {
    ps.setPipelineStatus({ step: 5, totalSteps: 10, description: "Test" });
    const tool = ps.makePipelineStatusTool({ client: {}, log: {} });
    const result = await tool.execute({ action: "get" }, { sessionID: "test-session" });
    const content = result.content[0].text;
    assert.ok(content.includes('"active":true'));
    assert.ok(content.includes('"step":5'));
  });

  it("set returns ok true", async () => {
    const tool = ps.makePipelineStatusTool({ client: {}, log: {} });
    const result = await tool.execute({ action: "set", step: 3, totalSteps: 15, description: "Greeting" }, { sessionID: "test-session" });
    const content = result.content[0].text;
    assert.ok(content.includes('"ok":true'));
    // Verify state was actually set
    const s = ps.getPipelineStatus();
    assert.equal(s.step, 3);
  });

  it("clear returns ok true", async () => {
    ps.setPipelineStatus({ step: 1, totalSteps: 5, description: "Before" });
    const tool = ps.makePipelineStatusTool({ client: {}, log: {} });
    const result = await tool.execute({ action: "clear" }, { sessionID: "test-session" });
    const content = result.content[0].text;
    assert.ok(content.includes('"ok":true'));
    assert.equal(ps.getPipelineStatus().active, false);
  });

  it("deny: non-primary session (has parentID) cannot set/clear", async () => {
    const mockClient = {
      session: {
        get: async ({ sessionID }) => ({ data: { id: sessionID, parentID: "parent-123" } })
      }
    };
    const tool = ps.makePipelineStatusTool({ client: mockClient, log: {} });
    const result = await tool.execute({ action: "set", step: 1, totalSteps: 5, description: "X" }, { sessionID: "task-session" });
    assert.ok(result.content[0].text.includes("denied"));
  });

  it("allow: primary session (no parentID) can set/clear", async () => {
    const mockClient = {
      session: {
        get: async ({ sessionID }) => ({ data: { id: sessionID } }) // no parentID
      }
    };
    const tool = ps.makePipelineStatusTool({ client: mockClient, log: {} });
    const result = await tool.execute({ action: "set", step: 1, totalSteps: 5, description: "X" }, { sessionID: "primary-session" });
    const content = result.content[0].text;
    assert.ok(content.includes('"ok":true'));
  });

  it("error on invalid action", async () => {
    const tool = ps.makePipelineStatusTool({ client: {}, log: {} });
    const result = await tool.execute({ action: "invalid" }, { sessionID: "test-session" });
    assert.ok(result.content[0].text.toLowerCase().includes("invalid"));
  });

  it("error on set without required params", async () => {
    const tool = ps.makePipelineStatusTool({ client: {}, log: {} });
    const result = await tool.execute({ action: "set" }, { sessionID: "test-session" });
    assert.ok(result.content[0].text.toLowerCase().includes("required"));
  });
});
```

- [ ] **Step 1: Write the test**

Create the test above. Run: `node --test plugins/maestro-bootstrap/pipeline-status.test.js`
Expected: FAIL — `makePipelineStatusTool` not defined.

- [ ] **Step 2: Implement `makePipelineStatusTool`**

Add to `pipeline-status.js`:

```js
export function makePipelineStatusTool({ client, log }) {
  const guard = async (sessionID) => {
    if (!sessionID) return "session_unavailable";
    try {
      const resp = await client?.session?.get?.({ sessionID });
      const sess = resp?.data ?? resp;
      if (sess?.parentID) return "task_session";
      return null;
    } catch {
      return "session_unavailable";
    }
  };

  return {
    name: "maestro_pipeline_status",
    description: "Pipeline status indication: set, clear, or get current maestro pipeline state. Call 'set' after each pipeline step announcement, 'clear' when done, 'get' to query current status.",
    input: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["set", "clear", "get"], description: "Action: set, clear, or get pipeline status" },
        step: { type: "integer", description: "Current step number (required for set)" },
        totalSteps: { type: ["integer", "string"], description: "Total steps (supports '18.5' format; required for set)" },
        description: { type: "string", description: "Step description (required for set)" },
      },
      required: ["action"],
      additionalProperties: false,
    },
    execute: async (args, ctx) => {
      const sessionID = ctx?.sessionID;
      const action = args?.action;

      if (action === "set" || action === "clear") {
        const reason = await guard(sessionID);
        if (reason) {
          log?.info?.("pipeline_status:access_denied", { sessionID, reason, action });
          return { content: [{ type: "text", text: `maestro_pipeline_status: access denied (${reason})` }] };
        }
      }

      if (action === "set") {
        if (args.step === undefined || args.totalSteps === undefined || !args.description) {
          return { content: [{ type: "text", text: 'maestro_pipeline_status: set requires step, totalSteps, description' }] };
        }
        setPipelineStatus({ step: args.step, totalSteps: args.totalSteps, description: args.description });
        return { content: [{ type: "text", text: JSON.stringify({ ok: true }) }] };
      }

      if (action === "clear") {
        clearPipelineStatus();
        return { content: [{ type: "text", text: JSON.stringify({ ok: true }) }] };
      }

      if (action === "get") {
        return { content: [{ type: "text", text: JSON.stringify(getPipelineStatus()) }] };
      }

      return { content: [{ type: "text", text: `maestro_pipeline_status: invalid action "${action}". Use: set, clear, get` }] };
    },
  };
}
```

- [ ] **Step 3: Run test to verify it passes**

Run: `node --test plugins/maestro-bootstrap/pipeline-status.test.js`
Expected: PASS (all tests).

- [ ] **Step 4: Commit**

```bash
git add plugins/maestro-bootstrap/pipeline-status.js plugins/maestro-bootstrap/pipeline-status.test.js
git commit -m "feat: add maestro_pipeline_status tool with guard, set/clear/get"
```

---

## Task 4: Integration in `core.js`

**Files:**
- Modify: `plugins/maestro-bootstrap/core.js` — import, register hooks, register tool

**Interfaces:**
- Consumes: `registerPipelineStatusHooks`, `makePipelineStatusTool` from `pipeline-status.js`
- Produces: pipeline-status hooks registered on `ctx`, tool registered via `ctx.tool.transform`

### Step 1: Write integration tests (existing test file)

Add tests to `plugins/maestro-bootstrap/index.test.js` (or create a small integration test):

```js
// In index.test.js, add describe block:
describe("pipeline-status integration", () => {
  it("pipeline-status hooks are registered during plugin creation", async () => {
    // Mock test: verify that after MaestroBootstrapPlugin({}) creation,
    // the pipeline-status context handler is present in contextHandlers
    const p = await MaestroBootstrapPlugin();
    assert.ok(p.contextHandlers.length > 0, "pipeline-status hook should be registered");
    p.dispose();
  });

  it("pipeline-status tool is registered in transformed tools", async () => {
    const p = await MaestroBootstrapPlugin();
    assert.ok(p.tool["maestro_pipeline_status"], "tool should be registered");
    p.dispose();
  });
});
```

- [ ] **Step 1: Write integration test**

Create the test. Run: `node --test plugins/maestro-bootstrap/index.test.js`
Expected: FAIL — pipeline-status not yet integrated.

- [ ] **Step 2: Integrate in core.js**

Add to `plugins/maestro-bootstrap/core.js`:

```js
// Near top, after other imports:
import { registerPipelineStatusHooks, makePipelineStatusTool } from "./pipeline-status.js";
```

Add after "Feedback report hooks" section (around line 756):

```js
  // --- Pipeline Status hooks ---
  let pipelineStatusDispose = () => {};
  try {
    const psResult = await registerPipelineStatusHooks({ client: ctx, config, log });
    pipelineStatusDispose = psResult.dispose || (() => {});
  } catch (err) {
    log.error("pipeline-status: init failed", { error: err instanceof Error ? err.message : String(err) });
  }
```

In the tool transform section (around line 924), add:

```js
  const toolTransformRegistration = await ctx.tool.transform((editor) => {
    editor.add(makeMaestroConfigTool({ client: ctx, root, log }));
    // Pipeline Status tool — always available (guard in tool itself)
    editor.add(makePipelineStatusTool({ client: ctx, log }));
  });
```

In the cleanup return (line 930), add:

```js
    pipelineStatusDispose();
```

- [ ] **Step 3: Run integration test to verify it passes**

Run: `node --test plugins/maestro-bootstrap/index.test.js`
Expected: PASS (all tests including new integration tests).

- [ ] **Step 4: Run full test suite**

Run: `node --test plugins/maestro-bootstrap/index.test.js`
Expected: PASS (all 250+ existing tests, plus new ones).

- [ ] **Step 5: Commit**

```bash
git add plugins/maestro-bootstrap/core.js plugins/maestro-bootstrap/pipeline-status.js plugins/maestro-bootstrap/pipeline-status.test.js plugins/maestro-bootstrap/index.test.js
git commit -m "feat: integrate pipeline-status module into maestro-bootstrap plugin"
```

---

## Task 5: Orchestrator integration + documentation

**Files:**
- Modify: `skills/maestro/SKILL.md` — add tool call instruction after each step announcement
- Create: `manual_docs/reference/pipeline-status.md` — user-facing documentation
- Modify: `manual_docs/overview/changelog.md` — changelog entry

**Interfaces:**
- Consumes: nothing new — orchestrator calls existing tool `maestro_pipeline_status(action: "set", ...)`
- Produces: updated SKILL.md with tool call pattern, new documentation

### Step 1: Add tool call instruction to SKILL.md

In `skills/maestro/SKILL.md`, after the pipeline diagram (around line 198), add:

```
**Pipeline status indication:** каждый анонс шага сопровождается вызовом
`maestro_pipeline_status(action: "set", step: N, totalSteps: "18.5", description: "...")`.
Это обновляет статус-блок в system prompt и делает статус доступным по `action: "get"`.
По завершении пайплайна — `action: "clear"`. Канон: `manual_docs/reference/pipeline-status.md`.
```

**totalSteps = "18.5"** (строка — для корректного отображения дробных шагов pipeline: 7/18.5).

Также после завершения пайплайна (конец SKILL.md):

```
— После шага 18: `maestro_pipeline_status(action: "clear")`
```

- [ ] **Step 1: Update SKILL.md with pipeline status call instruction**

Add the pipeline status instruction text near the pipeline diagram. Add `action: "clear"` after step 18.

- [ ] **Step 2: Write documentation**

Create `manual_docs/reference/pipeline-status.md`:

```markdown
# Pipeline Status Indication

## Overview

When the maestro pipeline is active, a status block is injected into the agent's
system prompt showing the current pipeline step. Users can also query status
at any time via the `maestro_pipeline_status` tool.

## System Prompt Block

Format: `## maestro pipeline: active (step X/Y, Description)`

При `active: true` — блок показывает: «пайплайн активен, шаг X/Y, Описание».
Пример: `## maestro pipeline: active (step 7/18.5, Feature Classification)`.

When idle: `## maestro pipeline: idle`

## Tool: maestro_pipeline_status

### Parameters

| Parameter | Type | Required | Description |
|---|---|---|---|
| `action` | string | yes | `set`, `clear`, or `get` |
| `step` | integer | set | Current step number |
| `totalSteps` | integer/string | set | Total steps (supports `"18.5"` format for pipeline steps 0–18.5) |
| `description` | string | set | Step description |

### Examples

Set: `maestro_pipeline_status(action: "set", step: 7, totalSteps: "18.5", description: "Feature Classification")`

Get: `maestro_pipeline_status(action: "get")`

Clear: `maestro_pipeline_status(action: "clear")`

### Access Control

- `set`/`clear`: only from top-level primary sessions.
- `get`: available from any session.
```

- [ ] **Step 3: Add changelog entry**

Add to `manual_docs/overview/changelog.md`:

```markdown
## [2026-10-13]

> **Версия 5.6.7** — pipeline status indication

- Инструмент `maestro_pipeline_status` для индикации текущего шага пайплайна.
- Статус-блок в system prompt: `maestro pipeline: active (step X/Y, Description)`.
- Документация: `manual_docs/reference/pipeline-status.md`.
```

- [ ] **Step 4: Verify all references resolve**

Check that `manual_docs/reference/pipeline-status.md` is referenced correctly from SKILL.md.

- [ ] **Step 5: Commit**

```bash
git add skills/maestro/SKILL.md manual_docs/reference/pipeline-status.md manual_docs/overview/changelog.md
git commit -m "feat: add orchestrator pipeline status calls and documentation"
```
