import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

/**
 * Persistent per-session state for the memory indexer (retry/skip/first-run).
 * Persisted as JSON at `path`. All methods are async to match the interface
 * consumed by Indexer (Task 10).
 * @param {string} path  Path to the state JSON file.
 * @param {{ log?: { warn?: Function } }} [opts]  Аудит-лог (spec §4.2):
 *   parse-ошибка state.json → warn `memory:state.corrupt` (reason: parse_error);
 *   ENOENT (первый запуск) → не варн (spec: ENOENT не варн для нового проекта).
 * @returns {{
 *   getLastSummarized(id): Promise<number|null>,
 *   setSummarized(id): Promise<void>,
 *   recordFail(id): Promise<void>,
 *   isSkipped(id): Promise<boolean>,
 *   getLastAttempt(id): Promise<number|null>,
 *   getFirstRun(): Promise<number>,
 *   prune(maxAgeMs): Promise<void>,
 *   getEmbedderProbe(): object|null,
 *   setEmbedderProbe(info): Promise<void>,
 * }}
 */
export function createState(path, { log } = {}) {
  let data = { sessions: {}, firstRun: null };
  try {
    data = JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    // Task 7: state.corrupt — parse-ошибка (файл существует, но не JSON) → warn;
    // ENOENT (первый запуск) → не варн (spec §4.2: ENOENT не варн для нового проекта).
    if (err?.code !== "ENOENT") {
      log?.warn?.("memory:state.corrupt", { reason: "parse_error" });
    }
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
    async getLastAttempt(id) {
      return data.sessions[id]?.lastAttempt ?? null;
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
    getEmbedderProbe() {
      return data.embedderProbe ?? null;
    },
    async setEmbedderProbe(info) {
      data.embedderProbe = { at: Date.now(), ...info };
      persist();
    },
  };
}
