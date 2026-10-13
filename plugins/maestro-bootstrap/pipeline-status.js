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
