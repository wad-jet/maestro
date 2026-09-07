import { maskTranscript, maskEntry } from "./mask.js";
import { resolveEffectiveKey } from "./config.js";

export class Indexer {
  constructor({ client, config, embeddings, storage, state, summarize, projectKey, confidentialPatterns = [], log = console }) {
    this.client = client;
    this.config = config;
    this.embeddings = embeddings;
    this.storage = storage;
    this.state = state;
    this.summarize = summarize;
    this.projectKey = projectKey;
    this.confidentialPatterns = confidentialPatterns;
    this.log = log;
    this.timers = new Map();
    this.running = false;
    this.queue = [];
  }

  _debounce(sessionID) {
    if (this.timers.has(sessionID)) clearTimeout(this.timers.get(sessionID));
    const t = setTimeout(() => this._run(sessionID), (this.config.idle_debounce_min ?? 10) * 60_000);
    t.unref?.();
    this.timers.set(sessionID, t);
  }

  async onSessionIdle({ sessionID }) {
    this._debounce(sessionID);
  }

  async onStartup() {
    try {
      const listResp = await this.client.session.list({});
      const list = (listResp?.data ?? listResp) ?? [];
      const firstRun = await this.state.getFirstRun();
      let queued = 0;
      for (const s of list) {
        if (queued >= (this.config.backfill_max_per_start ?? 5)) break;
        if (s.parentID) continue;
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
  }

  async _run(sessionID) {
    // G3: concurrency-1 queue
    if (this.running) {
      this.queue.push(sessionID);
      return;
    }
    this.running = true;
    try {
      if (await this.state.isSkipped(sessionID)) return;

      const sessResp = await this.client.session.get({ path: { id: sessionID } });
      const sess = sessResp?.data ?? sessResp;
      if (sess?.parentID) return;

      const msgResp = await this.client.session.messages({ path: { id: sessionID } });
      const messages = (msgResp?.data ?? msgResp) ?? [];

      // G1: min_new_messages check
      const lastSummarized = await this.state.getLastSummarized(sessionID);
      const minNew = this.config.min_new_messages ?? 3;
      if (lastSummarized != null && messages.length > 0) {
        // Count messages newer than lastSummarized
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

      // session has no `model` field in v1 — pass null, summarize handles it
      const { title, summary, decisions } = await this.summarize({
        client: this.client,
        sessionID,
        transcript: masked,
        model: sess?.model ?? null,
        summarizerModel: this.config.summarizer_model ?? null,
      });

      const vec = await this.embeddings.embed(`${title}\n${summary}\n${decisions.join("\n")}`);
      const key = resolveEffectiveKey({ projectHash: this.projectKey.hash, namespace: this.config.namespace ?? null });

      // G5: version increment via storage.get
      const existing = await this.storage.get(sessionID);
      const version = (existing?.version ?? 0) + 1;

      // G2: re-mask entry before write (defense-in-depth)
      const entry = {
        session_id: sessionID,
        key,
        origin_project_hash: this.projectKey.hash,
        title,
        summary,
        decisions,
        embedding: vec,
        model_id: this.embeddings.modelId,
        author: this.config.author ?? "unknown",
        time_first: sess?.time?.created ?? 0,
        time_last: sess?.time?.updated ?? 0,
        version,
      };
      const maskedEntry = maskEntry(entry, { confidentialPatterns: this.confidentialPatterns });

      await this.storage.upsert([maskedEntry]);

      await this.state.setSummarized(sessionID);
    } catch (err) {
      // G4: error logging
      this.log?.error?.("memory: indexer error", { sessionID, error: err.message });
      try { await this.state.recordFail(sessionID); } catch {}
    } finally {
      // G3: release lock, process next queued item
      this.running = false;
      if (this.queue.length > 0) {
        this._run(this.queue.shift());
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
