// Pipeline Status module — V2 migration.
// Self-contained module: NOT importing core.js (ESM-cycle guard).

// Canonical pipeline step sequence (R3 progression tracking).
const CANON_STEPS = ["-1","0","1","1.5","2","3","4","5","6","7","7b","7d","8","8.5","8.6","9","10","10b","11","12","12a","13","13f","14","15","15a","16","17","18","18.5"];

// Substeps resolve to their parent for position comparison.
const PARENT_STEPS = { "7b": "7", "7d": "7", "10b": "10", "12a": "12" };

let state = {
  active: false,
  step: null,
  totalSteps: null,
  description: '',
  lastStep: null,
  firstAfterClear: true,
  lastWarning: null,
  lastSkipped: null,
};

// Module-level log sink (set by the tool factory); optional, never required.
let moduleLog = null;

export function setPipelineStatusLog(log) {
  moduleLog = log;
}

function normalizeStep(step) {
  return String(step).trim();
}

function parentStep(s) {
  return PARENT_STEPS[s] ?? s;
}

function stepPosition(s) {
  return CANON_STEPS.indexOf(parentStep(s));
}

export function getPipelineStatus() {
  return { ...state };
}

export function setPipelineStatus({ step, totalSteps, description }) {
  const next = normalizeStep(step);
  const pos = stepPosition(next);
  let lastWarning = null;
  let lastSkipped = null;
  let lastStep = state.lastStep;

  if (pos === -1) {
    // Unknown step: no warning, tracker (lastStep) is NOT updated.
    moduleLog?.info?.("pipeline_status:unknown_step", { step });
  } else {
    if (lastStep !== null && !state.firstAfterClear) {
      const lastPos = stepPosition(lastStep);
      if (pos > lastPos && pos > lastPos + 1) {
        lastWarning = "step_jump";
        lastSkipped = CANON_STEPS.slice(CANON_STEPS.indexOf(lastStep) + 1, pos);
      }
    }
    lastStep = next;
  }

  state = { ...state, active: true, step, totalSteps, description, lastStep, firstAfterClear: false, lastWarning, lastSkipped };
}

export function clearPipelineStatus() {
  state = {
    active: false,
    step: null,
    totalSteps: null,
    description: '',
    lastStep: null,
    firstAfterClear: true,
    lastWarning: null,
    lastSkipped: null,
  };
}

export function formatStatusBlock() {
  if (!state.active) {
    return "## maestro pipeline: idle";
  }
  const total = state.totalSteps ?? '?';
  return `## maestro pipeline: active (step ${state.step}/${total}, ${state.description})`;
}

// ---------------------------------------------------------------------------
// Context hook registration — mirrors communication.js pattern
// ---------------------------------------------------------------------------

export async function registerPipelineStatusHooks({ client, config, log }) {
  const registration = await client?.session?.hook?.("context", async (event) => {
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

// ---------------------------------------------------------------------------
// Tool: maestro_pipeline_status
// ---------------------------------------------------------------------------

export function makePipelineStatusTool({ client, log }) {
  setPipelineStatusLog(log);
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
    description: "Pipeline status indication: set, clear, or get current maestro pipeline state. Call 'set' after each pipeline step announcement, 'clear' when done, 'get' to query current status. A forward jump over canonical steps returns a step_jump warning — respond with one line in chat (justify the skip-path or roll back).",
    input: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["set", "clear", "get"], description: "Action: set, clear, or get pipeline status" },
        step: { type: ["number", "string"], description: "Current step (required for set; supports '7b', '18.5', '-1')" },
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
          return { content: [{ type: "text", text: 'maestro_pipeline_status: missing required params: step, totalSteps, description' }] };
        }
        setPipelineStatus({ step: args.step, totalSteps: args.totalSteps, description: args.description });
        const { lastWarning, lastSkipped } = getPipelineStatus();
        const payload = lastWarning
          ? { ok: true, warning: lastWarning, skipped: lastSkipped }
          : { ok: true };
        return { content: [{ type: "text", text: JSON.stringify(payload) }] };
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
