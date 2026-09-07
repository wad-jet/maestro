import { maskTranscript } from "./mask.js";
import { resolveEffectiveKey } from "./config.js";

export class Indexer {
  constructor({ client, config, embeddings, storage, state, summarize, projectKey, confidentialPatterns = [] }) {
    this.client = client;
    this.config = config;
    this.embeddings = embeddings;
    this.storage = storage;
    this.state = state;
    this.summarize = summarize;
    this.projectKey = projectKey;
    this.confidentialPatterns = confidentialPatterns;
    this.timers = new Map();
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
    try {
      if (await this.state.isSkipped(sessionID)) return;

      const sessResp = await this.client.session.get({ path: { id: sessionID } });
      const sess = sessResp?.data ?? sessResp;
      if (sess?.parentID) return;

      const msgResp = await this.client.session.messages({ path: { id: sessionID } });
      const messages = (msgResp?.data ?? msgResp) ?? [];
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

      await this.storage.upsert([
        {
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
          version: 1,
        },
      ]);

      await this.state.setSummarized(sessionID);
    } catch (err) {
      try { await this.state.recordFail(sessionID); } catch {}
    } finally {
      const t = this.timers.get(sessionID);
      if (t) { clearTimeout(t); this.timers.delete(sessionID); }
    }
  }

  dispose() {
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
  }
}
