// Zero-key резолв модели саммаризации из opencode-конфига (4.0.0, spec §4.2).
// Без кэша (I4/D-7), no-throw: контракт { model, source, error } с enum.

const CHAIN = [
  ["small_model", (c) => c.small_model],
  ["model", (c) => c.model],
  ["agent_maestro", (c) => c.agent?.maestro?.model],
  ["agent_build", (c) => c.agent?.build?.model],
];

function validRef(v) {
  if (typeof v !== "string") return null;
  const s = v.trim();
  const i = s.indexOf("/");
  if (i <= 0) return null; // нет '/' или пустой providerID
  const provider = s.slice(0, i);
  const model = s.slice(i + 1);
  if (!provider || !model) return null; // degenerate: "prov/" | "/m1"
  // Внутренние пробелы в частях — тот же класс degenerate-ссылок (SF-2).
  if (provider.trim() !== provider || model.trim() !== model) return null;
  return s;
}

export function parseModelRef(s) {
  const v = validRef(s);
  if (!v) return null;
  const i = v.indexOf("/");
  return { providerID: v.slice(0, i), modelID: v.slice(i + 1) };
}

function withLocalTimeout(p, ms) {
  let timer;
  const to = new Promise((_, rej) => {
    timer = setTimeout(() => rej(new Error("timeout")), ms);
  });
  return Promise.race([p, to]).finally(() => clearTimeout(timer));
}

/**
 * Resolves the summarization model from opencode config (GET /config).
 * Chain: small_model → model → agent.maestro.model → agent.build.model.
 * Absent (undefined/null) candidates are skipped WITHOUT setting the
 * invalid flag (SF-1); invalid candidates are skipped fail-soft with the flag.
 * Any failure of the config call (network, timeout, missing client.config —
 * incl. synchronous TypeError) → config_get_failed. No cache (I4).
 *
 * @param {object} o
 * @param {object} o.client  opencode SDK client
 * @param {string} o.root    project directory (config.get query)
 * @param {number} [o.timeoutMs]  guard-таймаут (default 5000)
 * @returns {Promise<{model: (string|null), source: ("small_model"|"model"|"agent_maestro"|"agent_build"|null), error: ("config_get_failed"|"invalid_model_ref"|"no_model_resolved"|null)}>}
 */
export async function resolveSummarizerModel({ client, root, timeoutMs = 5000 } = {}) {
  let cfg;
  try {
    const fn = client?.config?.get;
    if (typeof fn !== "function") throw new Error("client.config.get missing");
    const res = await withLocalTimeout(fn.call(client.config, { query: { directory: root } }), timeoutMs);
    cfg = res?.data ?? res;
  } catch {
    return { model: null, source: null, error: "config_get_failed" };
  }
  if (cfg == null || typeof cfg !== "object") {
    return { model: null, source: null, error: "config_get_failed" };
  }
  let sawInvalid = false;
  for (const [source, pick] of CHAIN) {
    let candidate;
    try { candidate = pick(cfg); } catch { continue; }
    if (candidate == null) continue; // absent — без invalid-флага (SF-1)
    const ref = validRef(candidate);
    if (ref) return { model: ref, source, error: null };
    sawInvalid = true;
  }
  return { model: null, source: null, error: sawInvalid ? "invalid_model_ref" : "no_model_resolved" };
}
