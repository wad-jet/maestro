import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

/**
 * Persistent per-session state for the memory indexer (retry/skip/first-run).
 * Persisted as JSON at `path`. All methods are async to match the interface
 * consumed by Indexer (Task 10).
 * @param {string} path  Path to the state JSON file.
 * @returns {{
 *   getLastSummarized(id): Promise<number|null>,
 *   setSummarized(id): Promise<void>,
 *   recordFail(id): Promise<void>,
 *   isSkipped(id): Promise<boolean>,
 *   getFirstRun(): Promise<number>,
 *   prune(maxAgeMs): Promise<void>,
 * }}
 */
export function createState(path) {
  let data = { sessions: {}, firstRun: null };
  try {
    data = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    /* fresh state */
  }
  if (!data.firstRun) data.firstRun = Date.now();
  const persist = () => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(data), "utf8");
  };
  return {
    async getLastSummarized(id) {
      return data.sessions[id]?.lastSummarized ?? null;
    },
    async setSummarized(id) {
      data.sessions[id] = { ...(data.sessions[id] ?? {}), lastSummarized: Date.now() };
      persist();
    },
    async recordFail(id) {
      const s = data.sessions[id] ?? {};
      s.fails = (s.fails ?? 0) + 1;
      s.lastAttempt = Date.now();
      if (s.fails >= 3) s.skip = true;
      data.sessions[id] = s;
      persist();
    },
    async isSkipped(id) {
      return Boolean(data.sessions[id]?.skip);
    },
    async getFirstRun() {
      return data.firstRun;
    },
    async prune(maxAgeMs) {
      const cutoff = Date.now() - maxAgeMs;
      for (const [k, v] of Object.entries(data.sessions)) {
        if (!v.lastAttempt || v.lastAttempt < cutoff) delete data.sessions[k];
      }
      persist();
    },
  };
}
