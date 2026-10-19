import { describe, it, beforeEach } from "node:test";
import { strict as assert } from "node:assert";
import * as ps from "./pipeline-status.js";

// ---------------------------------------------------------------------------
// pipeline-status state
// ---------------------------------------------------------------------------

describe("pipeline-status state", () => {
  beforeEach(() => ps.clearPipelineStatus());

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

describe("status block generation", () => {
  beforeEach(() => ps.clearPipelineStatus());

  it("idle generates idle block", () => {
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

// ---------------------------------------------------------------------------
// registerPipelineStatusHooks — context hook registration
// ---------------------------------------------------------------------------

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
    const result = await ps.registerPipelineStatusHooks({ client: mockClient, config: {}, log: {} });
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
    await ps.registerPipelineStatusHooks({ client: mockClient, config: {}, log: {} });
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
    await ps.registerPipelineStatusHooks({ client: mockClient, config: {}, log: {} });
    assert.ok(capturedSystem.some(s => s.text?.includes("active")));
    assert.ok(capturedSystem.some(s => s.text?.includes("step 3/18")));
  });
});

// ---------------------------------------------------------------------------
// makePipelineStatusTool — tool registration
// ---------------------------------------------------------------------------

describe("makePipelineStatusTool", () => {
  beforeEach(() => ps.clearPipelineStatus());

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
    // Use a client that allows primary sessions so guard passes and we reach param check
    const mockClient = {
      session: {
        get: async ({ sessionID }) => ({ data: { id: sessionID } })
      }
    };
    const tool = ps.makePipelineStatusTool({ client: mockClient, log: {} });
    const result = await tool.execute({ action: "set" }, { sessionID: "test-session" });
    assert.ok(result.content[0].text.toLowerCase().includes("required"));
  });
});

// ---------------------------------------------------------------------------
// progression warning (R3)
// ---------------------------------------------------------------------------

describe("progression warning", () => {
  beforeEach(() => ps.clearPipelineStatus());

  function makeTool() {
    return ps.makePipelineStatusTool({ client: {}, log: {} });
  }

  async function setStep(tool, step, totalSteps = "18.5") {
    const result = await tool.execute(
      { action: "set", step, totalSteps, description: `step ${step}` },
      { sessionID: "primary-session" },
    );
    return JSON.parse(result.content[0].text);
  }

  it("jump 0→14 warns with full canonical skipped list", async () => {
    const tool = makeTool();
    const first = await setStep(tool, 0);
    assert.equal(first.warning, undefined);
    const res = await setStep(tool, 14);
    assert.equal(res.ok, true);
    assert.equal(res.warning, "step_jump");
    assert.deepEqual(res.skipped, [
      "1", "1.5", "2", "3", "4", "5", "6", "7", "7b", "7d",
      "8", "8.5", "8.6", "9", "10", "10b", "11", "12", "12a", "13", "13f",
    ]);
  });

  it("consecutive forward (0→1) — no warning", async () => {
    const tool = makeTool();
    await setStep(tool, 0);
    const res = await setStep(tool, 1);
    assert.equal(res.ok, true);
    assert.equal(res.warning, undefined);
    assert.equal(res.skipped, undefined);
  });

  it("backward (13→10) — no warning", async () => {
    const tool = makeTool();
    await setStep(tool, 13);
    const res = await setStep(tool, 10);
    assert.equal(res.ok, true);
    assert.equal(res.warning, undefined);
  });

  it("repeat (10→10) — no warning", async () => {
    const tool = makeTool();
    await setStep(tool, 10);
    const res = await setStep(tool, 10);
    assert.equal(res.ok, true);
    assert.equal(res.warning, undefined);
  });

  it("clear resets tracker: first set after clear has no warning", async () => {
    const tool = makeTool();
    await setStep(tool, 5);
    await tool.execute({ action: "clear" }, { sessionID: "primary-session" });
    const res = await setStep(tool, 14);
    assert.equal(res.ok, true);
    assert.equal(res.warning, undefined);
  });

  it("substep adjacency (7→7b) — no warning", async () => {
    const tool = makeTool();
    await setStep(tool, 7);
    const res = await setStep(tool, "7b");
    assert.equal(res.ok, true);
    assert.equal(res.warning, undefined);
  });

  it("string steps work: \"1.5\" → \"2\" no warning (normalization)", async () => {
    const tool = makeTool();
    await setStep(tool, "1.5");
    const res = await setStep(tool, "2");
    assert.equal(res.ok, true);
    assert.equal(res.warning, undefined);
  });

  it("unknown step \"13z\" — no warning, lastStep not updated", async () => {
    const tool = makeTool();
    await setStep(tool, 13);
    const res = await setStep(tool, "13z");
    assert.equal(res.ok, true);
    assert.equal(res.warning, undefined);
    assert.equal(res.skipped, undefined);
    assert.equal(ps.getPipelineStatus().lastStep, "13");
  });

  it("unknown step does not skew jump base: 13 → \"13z\" → 14 warns from 13", async () => {
    const tool = makeTool();
    await setStep(tool, 13);
    const mid = await setStep(tool, "13z");
    assert.equal(mid.ok, true);
    assert.equal(mid.warning, undefined);
    const res = await setStep(tool, 14);
    assert.equal(res.ok, true);
    assert.equal(res.warning, "step_jump");
    assert.deepEqual(res.skipped, ["13f"]);
    assert.equal(ps.getPipelineStatus().lastStep, "14");
  });
});
