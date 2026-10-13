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
          return { content: [{ type: "text", text: 'maestro_pipeline_status: missing required params: step, totalSteps, description' }] };
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
