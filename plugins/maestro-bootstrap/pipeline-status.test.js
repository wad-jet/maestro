import { describe, it, beforeEach } from "node:test";
import { strict as assert } from "node:assert";
import * as ps from "./pipeline-status.js";

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
