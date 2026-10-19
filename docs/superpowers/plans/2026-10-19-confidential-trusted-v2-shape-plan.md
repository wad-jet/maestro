# Confidential Trusted V2 Shape — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore the trusted subagent channel (custodian/sanitizer confidential read) broken by the V1→V2 session-API shape migration, without weakening any deny path.

**Architecture:** `resolveIsTrustedSubagent` (plugins/maestro-bootstrap/core.js) currently resolves the subagent name only by scanning `session.context()` messages for V1 shapes (`m.info.agent`, `m.info.mode`, `m.parts`). OpenCode V2 returns a flat message shape (`{type: "assistant", agent: "..."}`, no `info`/`parts`) and — authoritatively — `agent` at the top level of the session object from `session.get()`. The fix: read `session.agent` first (authoritative), fall back to an extended message scan that also handles the V2 flat shape, keep all V1 checks. Direction stays fail-closed: any unresolvable identity → `{trusted: false}`.

**Tech Stack:** Node.js ESM, zero dependencies, `node --test` (built-in runner).

**Spec:** no formal spec (bugfix route, debug sub-pipeline D1–D4). Root-cause evidence lives in the branch session: live OpenCode V2 API dumps for a real denied custodian child session — `GET /api/session/{id}` → `{"agent":"custodian","parentID":"...",...}`; `GET /api/session/{id}/context` → `[{ "type":"user", "text":"..." }, { "type":"assistant", "agent":"custodian", "model":{...}, "content":[...] }, { "type":"idle" }]`. Probe (D3/D4): a test with this real shape was RED on current code, all 9 neighboring tests green, baseline 450/450.

## Global Constraints

- Node ESM; **no new dependencies**; tests — `node --test` built-in runner only.
- **Fail-closed invariant:** every unresolvable-identity branch returns `{ trusted: false, agent: undefined }` (or `{trusted: false, agent: "<resolved-but-untrusted>"}`); no code path may turn an untrusted/unresolvable session into `trusted: true`. Deny paths (primary, untrusted, no client, lookup error) are never weakened.
- **V1 compatibility:** existing V1-shape unit tests (`describe "maestro-bootstrap confidential subagent identity"`) and enforcement tests must stay green without modification.
- `agentNameFromMessages` stays **non-exported** (module-internal); `resolveIsTrustedSubagent` keeps its exported signature `async (client, trustedAgents, sessionID) → { trusted: boolean, agent?: string }`.
- Commit style: conventional commits, English (e.g. `fix(confidential): ...`).
- Working branch: `fix/confidential-trusted-v2-shape` (from main @ 6.2.0). Working tree clean before start.
- The plugin reads config/registration at opencode startup — a **real** E2E verification requires an opencode restart after merge (note at gate 17, not a task step).

## Review Focus

1. `session.context()` rejects after a successful `session.get()` that carried `session.agent` → identity must still resolve from `session.agent` (no exception, no fall-through to untrusted). Pinned by: Task 1, test "session.agent wins even when session.context rejects".
2. Real message order (user message first, assistant second): user messages carry no `agent` field — the flat-scan must not false-positive on them. Pinned by: Task 1, flat-fallback test (message array starts with a user message) and Task 1, "denies untrusted by session.agent".
3. Session with `parentID` but no agent anywhere (legacy server / empty context) → fail-closed untrusted. Pinned by existing tests "denies when agent not resolvable" and "denies root/primary session (no parentID)" (must stay green).
4. `trustedAgents` membership is exact-match, case-sensitive (names come from `maestro.json → trust`, e.g. `custodian`/`sanitizer`) — the fix must not normalize/lowercase names. Pinned by Task 1, "denies untrusted by session.agent" (exact `haiku` vs `custodian` set).
5. No public surface change: no new exports, no signature changes, no config schema change — the change is confined to two functions in core.js plus tests. Verified by task review against the diff.

---

### Task 1: V2 identity resolution (fix + test guard)

**Files:**
- Modify: `plugins/maestro-bootstrap/core.js:409-442` (`agentNameFromMessages`, `resolveIsTrustedSubagent`)
- Test: `plugins/maestro-bootstrap/index.test.js` — two describe blocks: `maestro-bootstrap confidential subagent identity` (unit, ~line 1280) and `maestro-bootstrap confidential enforcement` (integration, ~line 1383)

**Interfaces:**
- Consumes: existing exports of `plugins/maestro-bootstrap/core.js` (`resolveIsTrustedSubagent` already imported by the test file); existing test seams — `MaestroBootstrapPlugin({ directory, client })` factory and per-describe `makeClient`/`mockClient` helpers (both already present).
- Produces: no new exports. `resolveIsTrustedSubagent(client, trustedAgents, sessionID) → { trusted: boolean, agent?: string }` — same signature, extended resolution order: (1) `session.agent` from `session.get()`; (2) message scan (V2 flat `m.type === "assistant"` → `m.agent`, then V1 `m.info.agent`, `m.info.mode`, parts).

- [ ] **Step 1: Write failing unit tests**

In `plugins/maestro-bootstrap/index.test.js`, inside `describe("maestro-bootstrap confidential subagent identity", ...)` — insert after the test `denies on session lookup error (fail-closed)` (before the describe's closing `});`):

```js
  it("resolves trusted by session.agent (V2 session-level shape)", async () => {
    const client = mockClient({
      session: { id: "child", parentID: "root", agent: "custodian" },
      messages: [
        { id: "mu", type: "user", text: "Прочитай файл." },
        { id: "ma", type: "assistant", agent: "custodian", content: [] },
      ],
    });
    const res = await resolveIsTrustedSubagent(client, new Set(["custodian"]), "child");
    assert.equal(res.trusted, true);
    assert.equal(res.agent, "custodian");
  });

  it("denies untrusted by session.agent (V2 session-level shape)", async () => {
    const client = mockClient({
      session: { id: "child", parentID: "root", agent: "haiku" },
      messages: [{ id: "ma", type: "assistant", agent: "haiku", content: [] }],
    });
    const res = await resolveIsTrustedSubagent(client, new Set(["custodian"]), "child"),;
  });
```

Correct the last test (typo-free version, complete):

```js
  it("denies untrusted by session.agent (V2 session-level shape)", async () => {
    const client = mockClient({
      session: { id: "child", parentID: "root", agent: "haiku" },
      messages: [{ id: "ma", type: "assistant", agent: "haiku", content: [] }],
    });
    const res = await resolveIsTrustedSubagent(client, new Set(["custodian"]), "child");
    assert.equal(res.trusted, false);
    assert.equal(res.agent, "haiku");
  });

  it("resolves trusted by V2 flat assistant message when session.agent is absent (fallback)", async () => {
    const client = mockClient({
      session: { id: "child", parentID: "root" },
      messages: [
        { id: "mu", type: "user", text: "Прочитай файл." },
        { id: "ma", type: "assistant", agent: "custodian", content: [] },
      ],
    });
    const res = await resolveIsTrustedSubagent(client, new Set(["custodian"]), "child");
    assert.equal(res.trusted, true);
    assert.equal(res.agent, "custodian");
  });

  it("session.agent wins even when session.context rejects", async () => {
    const client = {
      session: {
        get: async () => ({ data: { id: "child", parentID: "root", agent: "custodian" } }),
        context: async () => { throw new Error("no context"); },
      },
    };
    const res = await resolveIsTrustedSubagent(client, new Set(["custodian"]), "child");
    assert.equal(res.trusted, true);
    assert.equal(res.agent, "custodian");
  });
```

- [ ] **Step 2: Run unit tests to verify they fail**

Run: `node --test --test-name-pattern="confidential subagent identity" plugins/maestro-bootstrap/index.test.js`
Expected: exactly 4 NEW tests FAIL (the two `session.agent` tests, the flat-fallback test, the context-rejects test) with `trusted` being `false` / `agent` being `undefined`; all 8 pre-existing tests in the block PASS.

- [ ] **Step 3: Implement the fix in `plugins/maestro-bootstrap/core.js`**

(a) In `agentNameFromMessages` — add the V2 flat-shape check as the FIRST check inside the message loop, before the `const info = m?.info ?? {}` line:

```js
    // V2: flat message shape — agent lives on the assistant message itself
    if (m && m.type === "assistant" && typeof m.agent === "string" && m.agent) return m.agent;
```

(b) In `resolveIsTrustedSubagent` — after the `if (!session?.parentID) return ...` line, insert the authoritative session-level check, and keep the existing context-scan as fallback (wrap in try/catch as today):

```js
  // V2: the session object carries the agent at top level — authoritative source
  if (typeof session?.agent === "string" && session.agent) {
    return { trusted: trustedAgents.has(session.agent), agent: session.agent };
  }
```

Do not touch any other branch (no-client, no-parentID, context error) — they keep returning fail-closed values.

- [ ] **Step 4: Run unit tests to verify they pass**

Run: `node --test --test-name-pattern="confidential subagent identity" plugins/maestro-bootstrap/index.test.js`
Expected: all 12 tests PASS (8 pre-existing V1 + 4 new V2).

- [ ] **Step 5: Add integration tests (test guard) to `describe("maestro-bootstrap confidential enforcement")`**

(a) In that describe's `rootSessions` object (the one used by `makeClient(rootSessions)` in its `before`), add two records after `childUntrusted`:

```js
    childTrustedV2: {
      // РЕАЛЬНЫЙ V2-шейп (live OpenCode API): session.agent top-level,
      // flat context messages {type, agent} без info/parts
      session: { id: "childTrustedV2", parentID: "root", agent: "custodian" },
      messages: [
        { id: "mv2u", type: "user", text: "Прочитай файл." },
        { id: "mv2a", type: "assistant", agent: "custodian", model: { id: "m", providerID: "p", variant: "default" }, content: [] },
      ],
    },
    childUntrustedV2: {
      session: { id: "childUntrustedV2", parentID: "root", agent: "haiku" },
      messages: [
        { id: "mu2u", type: "user", text: "Прочитай файл." },
        { id: "mu2a", type: "assistant", agent: "haiku", content: [] },
      ],
    },
```

(b) Add two tests after the first test `allows trusted subagent read of confidential`:

```js
  it("allows trusted subagent read of confidential — V2 real shape (session.agent + flat context)", async () => {
    const out = { args: { filePath: "docs/confidential/secrets.md" } };
    await hooks["tool.execute.before"]({ tool: "read", sessionID: "childTrustedV2", callID: "c-v2-1" }, out);
    assert.ok(true);
  });

  it("denies untrusted subagent read of confidential — V2 real shape (negative guard)", async () => {
    const out = { args: { filePath: "docs/confidential/secrets.md" } };
    await assert.rejects(
      hooks["tool.execute.before"]({ tool: "read", sessionID: "childUntrustedV2", callID: "c-v2-2" }, out),
      /confidential:deny/,
    );
  });
```

- [ ] **Step 6: Run integration tests to verify they pass**

Run: `node --test --test-name-pattern="confidential enforcement" plugins/maestro-bootstrap/index.test.js`
Expected: all tests PASS — including the new trusted-allow (real shape) and untrusted-deny (negative guard), and the pre-existing `denies primary/root read of confidential` (root stays denied).

- [ ] **Step 7: Run the full suite**

Run: `npm test`
Expected: all tests pass, 0 fail (baseline was 450; expect 450 + 6 new).

- [ ] **Step 8: Commit**

```bash
git add plugins/maestro-bootstrap/core.js plugins/maestro-bootstrap/index.test.js
git commit -m "fix(confidential): resolve subagent identity from V2 session/flat-message shapes (P1/P3 trusted channel)"
```

---

## Spec Coverage Matrix

| Requirement (from root-cause evidence D1–D4) | Task / step |
|---|---|
| R1: trusted V2 child (session.agent ∈ trustedAgents) → confidential read ALLOWED | Task 1, Step 1 (unit) + Step 5 (integration) |
| R2: untrusted V2 child (session.agent ∉ trustedAgents) → confidential read DENIED | Task 1, Step 1 (unit) + Step 5 (negative guard) |
| R3: no session.agent + V2 flat messages → identity resolved via extended scan (fallback) | Task 1, Step 1 (flat-fallback unit test) |
| R4: `session.context()` rejects but `session.agent` present → still resolved, no untrusted fall-through | Task 1, Step 1 (context-rejects unit test) |
| R5: V1 shapes (info.agent / info.mode / parts) keep resolving | Task 1, Step 4 (pre-existing unit suite green) |
| R6: fail-closed preserved (no client / no parentID / unresolvable / root) | Task 1, Steps 4–6 (pre-existing fail-closed tests green) |

## Self-check (executed by orchestrator, pre-gate 12)

1. **Coverage:** R1–R6 all mapped (matrix above); no requirement without a task.
2. **Plan tests vs requirements:** test expectations match D4 probe evidence (red on current code, green after Step 3); negative guard (R2) pins the deny direction through the full hook path (SEC-4b pattern).
3. **File targets:** both `Modify` targets exist (`core.js:409-442` verified by read; `index.test.js` describe blocks at ~1280/~1383 verified); no `Create` targets.
4. **Verification commands dry-run:** all commands in Steps 2/4/6/7 were executed in this session (baseline 450/450; pattern names confirmed by the D4 run output).
5. **Production path:** integration tests (Step 5) drive the real hook via the standard `MaestroBootstrapPlugin` test seam (same path the whole suite uses); final live E2E = real `custodian` dispatch after opencode restart (post-merge, note at gate 17 — not a task step).

## Regression Registry

No entry: risk-matrix signals absent — no migration, no breaking change, no public API change (plugin-internal function + tests only), no cross-layer change.

## Post-merge notes (for gate 17, not tasks)

- **Version:** bugfix → PATCH: `6.2.0 → 6.2.1` (project-context §3 rules; bump on base branch after merge, step 18).
- **E2E after restart:** plugin registers at opencode startup (OP-1) — after merge+restart, re-run the real check: dispatch `custodian` (by agent name) to read `docs/confidential/secret.md` → expect OK; primary read of the same file → expect `confidential:deny`.
- **Local config (out of scope, gitignored):** `.opencode/opencode.json` here uses V1-style standalone `variant` keys for `build`/`plan`/`custodian` — ignored by OpenCode V2 (session shows `variant: "default"`). Canonical docs are correct (inline `#variant`); the local dev config should be regenerated/edited manually (`agent.custodian.model: "akash/openai/gpt-oss-120b#high"` etc.). Not part of this branch.
