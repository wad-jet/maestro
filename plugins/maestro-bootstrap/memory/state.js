import { readFileSync, writeFileSync, mkdirSync, renameSync } from "node:fs";
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
 *   recordFail(id, errorClass?): Promise<void>,
 *   isSkipped(id): Promise<boolean>,
 *   getLastAttempt(id): Promise<number|null>,
 *   getFirstRun(): Promise<number>,
 *   prune(maxAgeMs): Promise<void>,
 *   delete(id): Promise<void>,
 *   getEmbedderProbe(): object|null,
 *   setEmbedderProbe(info): Promise<void>,
 *   clearSkip(id): Promise<void>,
 *   unindexed(): Promise<Array<object>>,
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
    async recordFail(id, errorClass) {
      const s = data.sessions[id] ?? {};
      s.fails = (s.fails ?? 0) + 1;
      s.lastAttempt = Date.now();
      if (errorClass != null) s.lastErrorClass = errorClass;
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
    /**
     * #77 (spec §5.1): сброс permanent-skip и throttle-якоря. Вызывается ТОЛЬКО
     * внутри full-reindex по явном session_id (indexer.reindexSession) —
     * авто-сбросов нет. lastAttempt → null (C1): иначе следующий штатный _run
     * уйдёт по retry-throttle (retry_interval_min) молча. No-op без записи.
     */
    async clearSkip(id) {
      const s = data.sessions[id];
      if (!s) return;
      s.skip = false;
      s.fails = 0;
      s.lastAttempt = null;
      persist();
    },
    /**
     * #77 (spec §5.2, N1): неиндексированные сессии — ВРЕМЕННОЙ критерий:
     * skip === true ИЛИ (lastAttempt != null И (lastSummarized == null ИЛИ
     * lastAttempt > lastSummarized)). Самовосстановившаяся сессия
     * (lastSummarized > lastAttempt) — НЕ в списке, даже с персистентным
     * fails > 0 (setSummarized не сбрасывает fails).
     * @returns {Promise<Array<{ id: string, fails: number, skip: boolean,
     *   lastAttempt: number|null, lastSummarized: number|null,
     *   lastErrorClass: string|null }>>}
     */
    async unindexed() {
      const out = [];
      for (const [id, s] of Object.entries(data.sessions)) {
        const stale = s.skip === true ||
          (s.lastAttempt != null && (s.lastSummarized == null || s.lastAttempt > s.lastSummarized));
        if (!stale) continue;
        out.push({
          id,
          fails: s.fails ?? 0,
          skip: Boolean(s.skip),
          lastAttempt: s.lastAttempt ?? null,
          lastSummarized: s.lastSummarized ?? null,
          lastErrorClass: s.lastErrorClass ?? null,
        });
      }
      return out;
    },
    async delete(id) {
      delete data.sessions[id];
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

/**
 * Atomic write helper — writes to `.tmp` then renames.
 * @param {string} path
 * @param {object} data
 */
function persistAtomic(path, data) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(data), "utf8");
  renameSync(tmp, path);
}

/**
 * Per-project state: tracks `lastKey` (e.g. "embedding.model@hash") per project.
 * @param {string} path  Path to the project-state JSON file.
 * @returns {{
 *   getLastKey(): Promise<string|null>,
 *   setLastKey(k): Promise<void>,
 * }}
 */
export function createProjectState(path) {
  let data = { lastKey: null };
  try { data = JSON.parse(readFileSync(path, "utf8")); } catch { /* first run */ }
  return {
    async getLastKey() { return data.lastKey ?? null; },
    async setLastKey(k) { data.lastKey = k; persistAtomic(path, data); },
  };
}

/**
 * Per-key seen-set: tracks origin hashes that have been indexed for a key.
 * @param {string} path  Path to the key-state JSON file.
 * @returns {{
 *   getSeenOrigins(): Promise<string[]>,
 *   setSeenOrigins(list): Promise<void>,
 *   addSeenOrigin(h): Promise<void>,
 * }}
 */
export function createKeyState(path) {
  let data = { seen: [] };
  try { data = JSON.parse(readFileSync(path, "utf8")); } catch { /* first run */ }
  return {
    async getSeenOrigins() { return Array.isArray(data.seen) ? [...data.seen] : []; },
    async setSeenOrigins(list) { data.seen = [...new Set(list)]; persistAtomic(path, data); },
    async addSeenOrigin(h) { data.seen = [...new Set([...(data.seen ?? []), h])]; persistAtomic(path, data); },
  };
}
