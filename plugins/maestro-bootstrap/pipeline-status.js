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
