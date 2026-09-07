import { maskTranscript, maskEntry } from "./mask.js";
import { resolveEffectiveKey } from "./config.js";
import { SESSIONS } from "./summarize.js";

function withTimeout(p, ms) {
  return Promise.race([
    p,
    new Promise((_, rej) =>
      setTimeout(() => rej(new Error("memory: summarize timeout")), ms).unref?.()
    ),
  ]);
}

export class Indexer {
  constructor({
    client, config, embeddings, storage, state, summarize,
    projectKey, confidentialPatterns = [], log = console, author = null,
  }) {
    this.client = client;
    this.config = config;
    this.embeddings = embeddings;
    this.storage = storage;
    this.state = state;
    this.summarize = summarize;
    this.projectKey = projectKey;
    this.confidentialPatterns = confidentialPatterns;
    this.log = log;
    this.author = author;
    this.timers = new Map();
    this.running = false;
    this.queue = new Set();
  }

  _debounce(sessionID) {
    if (this.timers.has(sessionID)) clearTimeout(this.timers.get(sessionID));
    const t = setTimeout(() => this._run(sessionID).catch(() => {}), (this.config.idle_debounce_min ?? 10) * 60_000);
    t.unref?.();
    this.timers.set(sessionID, t);
  }

  async onSessionIdle({ sessionID }) {
    if (!sessionID) return;
    this._debounce(sessionID);
  }

  async onStartup() {
    try {
      const listResp = await this.client.session.list({});
      const list = (listResp?.data ?? listResp) ?? [];
      const firstRun = (await this.state.getFirstRun()) ?? Date.now();
      let queued = 0;
      for (const s of list) {
        if (queued >= (this.config.backfill_max_per_start ?? 5)) break;
        if (s.parentID) continue;
        if (s.title?.startsWith("[maestro-memory]")) {
          try { await this.client.session.delete({ path: { id: s.id } }); } catch {}
          continue;
        }
        if (await this.state.isSkipped(s.id)) continue;
        const updated = s.time?.updated ?? s.time_updated;
        if (!updated) continue;
        if (firstRun - updated > (this.config.backfill_window_days ?? 30) * 86400_000) continue;
        this._debounce(s.id);
        queued++;
      }
    } catch {
      // recovery best-effort, ignore errors
    }
  }

  async onSessionDeleted({ sessionID }) {
    try {
      await this.storage.delete(sessionID);
    } catch {
      // best-effort
    }
    // M2: clear pending timer for deleted session
    const t = this.timers.get(sessionID);
    if (t) { clearTimeout(t); this.timers.delete(sessionID); }
  }

  async _run(sessionID) {
    // M3: queue dedup via Set
    if (this.queue.has(sessionID)) return;
    if (this.running) {
      this.queue.add(sessionID);
      return;
    }
    this.running = true;
    try {
      // I3: retry throttle
      let lastAttempt = undefined;
      if (this.state.getLastAttempt) {
        lastAttempt = await this.state.getLastAttempt(sessionID);
      }
      const retryInterval = (this.config.retry_interval_min ?? 60) * 60_000;
      if (lastAttempt != null && Date.now() - lastAttempt < retryInterval) return;

      if (await this.state.isSkipped(sessionID)) return;

      // I2: exclude maestro-memory sessions
      if (SESSIONS.has(sessionID)) return;

      const sessResp = await this.client.session.get({ path: { id: sessionID } });
      const sess = sessResp?.data ?? sessResp;
      if (sess?.parentID) return;

      const msgResp = await this.client.session.messages({ path: { id: sessionID } });
      const messages = (msgResp?.data ?? msgResp) ?? [];

      // C-1: extract model from last assistant message — flat fields per SDK types
      let modelRef = null;
      for (let i = messages.length - 1; i >= 0; i--) {
        const info = messages[i]?.info ?? {};
        if (info.role === "assistant" && info.providerID && info.modelID) {
          modelRef = { providerID: info.providerID, modelID: info.modelID };
          break;
        }
      }

      // G1: min_new_messages check
      const lastSummarized = await this.state.getLastSummarized(sessionID);
      const minNew = this.config.min_new_messages ?? 3;
      if (lastSummarized != null && messages.length > 0) {
        const newCount = messages.filter((m) => {
          const tc = m.time_created ?? m.info?.time?.created ?? 0;
          return tc > lastSummarized;
        }).length;
        if (newCount < minNew) return;
      }

      const transcript = messages
        .map((m) => (m.parts ?? []).map((p) => p.type === "text" ? p.text : "").join("\n"))
        .join("\n");

      if (!transcript.trim()) return;

      // Mask confidential content BEFORE summarize
      const masked = maskTranscript(transcript, { confidentialPatterns: this.confidentialPatterns });

      const key = resolveEffectiveKey({ projectHash: this.projectKey.hash, namespace: this.config.namespace ?? null });

      // I1: build entry, mask FIRST, then embed masked content
      const entry = {
        session_id: sessionID,
        key,
        origin_project_hash: this.projectKey.hash,
        title: null,
        summary: null,
        decisions: null,
        embedding: null,
        model_id: this.embeddings.modelId,
        author: this.author ?? this.config.author ?? "unknown",
        time_first: sess?.time?.created ?? 0,
        time_last: sess?.time?.updated ?? 0,
        version: 0,
      };

      // Summarize OUTSIDE withTimeout — it can fail with clear errors
      const { title, summary, decisions } = await this.summarize({
        client: this.client,
        sessionID,
        transcript: masked,
        model: modelRef,
        summarizerModel: this.config.summarizer_model ?? null,
      });

      // I1: update entry with results, then mask
      entry.title = title;
      entry.summary = summary;
      entry.decisions = decisions;

      // G2: re-mask entry before write
      const maskedEntry = maskEntry(entry, { confidentialPatterns: this.confidentialPatterns });

      // Embed AFTER mask + wrap in withTimeout
      const timeoutMs = this.config.summarize_timeout_ms ?? 120_000;
      const work = (async () => {
        const vec = await this.embeddings.embed(`${maskedEntry.title}\n${maskedEntry.summary}\n${maskedEntry.decisions.join("\n")}`);
        maskedEntry.embedding = vec;

        // G5: version increment via storage.get
        const existing = await this.storage.get(sessionID);
        maskedEntry.version = (existing?.version ?? 0) + 1;

        await this.storage.upsert([maskedEntry]);
        await this.state.setSummarized(sessionID);
      })();

      await withTimeout(work, timeoutMs);
    } catch (err) {
      // M1: safe error message
      const errMsg = err instanceof Error ? err.message : String(err);
      this.log?.error?.("memory: indexer error", { sessionID, error: errMsg });
      try { await this.state.recordFail(sessionID); } catch {}
    } finally {
      this.running = false;
      // M3: dedup when processing queue
      const next = [...this.queue].find((sid) => sid !== sessionID);
      if (next) {
        this.queue.delete(next);
        this._run(next).catch(() => {});
      } else {
        this.queue.clear();
      }
      const t = this.timers.get(sessionID);
      if (t) { clearTimeout(t); this.timers.delete(sessionID); }
    }
  }

  dispose() {
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
  }
}
