import { hostname } from "node:os";
import { maskTranscript, maskEntry } from "./mask.js";
import { resolveEffectiveKey } from "./config.js";
import { SESSIONS } from "./summarize.js";
import { prefixesOf } from "./project.js";
import { extractArtifacts } from "./artifacts.js";

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
    projectKey, key, originRemote = "", confidentialPatterns = [], log = console, author = null,
    git = null, mainline = null, root = null, branchContextCap = 1000,
    // Task 3: artifact-links (spec §4.2) — извлечение путей записанных файлов.
    // artifactGlobs: default [] → off-поведение (без извлечения).
    // artifactConfidentialPatterns: resolved-набор для artifact-фильтра (Z4);
    // НЕ переиспользуем confidentialPatterns маскирования (I2) — отдельный набор.
    artifactGlobs = [], artifactConfidentialPatterns = [],
    // Task 3: аудит-лог-хелперы (spec §2.2) — пишут в memoryLog ?? log;
    // default — заглушки (backward compat: без хелперов события не пишутся).
    logInfo = () => {}, logDebug = () => {}, logWarn = () => {}, logError = () => {},
  }) {
    this.client = client;
    this.config = config;
    this.embeddings = embeddings;
    this.storage = storage;
    this.state = state;
    this.summarize = summarize;
    this.projectKey = projectKey;
    this.key = key;
    this.originRemote = originRemote;
    this.confidentialPatterns = confidentialPatterns;
    this.log = log;
    this.logInfo = logInfo;
    this.logDebug = logDebug;
    this.logWarn = logWarn;
    this.logError = logError;
    this.author = author;
    this.git = git;
    this.mainline = mainline;
    this.root = root;
    this.artifactGlobs = artifactGlobs;
    this.artifactConfidentialPatterns = artifactConfidentialPatterns;
    // Task 4: sticky branch/head per session (resolved once, reused on version++).
    // M-7: bounded Map — FIFO-эвикция старейшего при превышении cap.
    this._branchContext = new Map();
    this._branchContextCap = branchContextCap;
    // Task 3: локальный счётчик fails по sessionID — зеркалит state.recordFail
    // (state не отдаёт fails наружу); нужен для memory:index_skipped ровно в
    // момент перехода в skip (3+ fails). Растёт только на ошибочных сессиях.
    this._fails = new Map();
    this.timers = new Map();
    this.running = false;
    this.queue = new Set();
    // Task 5: tombstones (spec §5) — race-guard для режима флага
    // delete_on_session_delete: post-upsert recheck удаляет запись, если
    // сессия была удалена во время индексации (не даём «воскреснуть»).
    this._tombstones = new Set();
  }

  /**
   * Task 4: resolve branch/head for a session — sticky. On first summarization
   * of a session the git resolvers run once; subsequent re-summarizes reuse the
   * stored values (no re-resolve). Detached → branch='' but head recorded.
   * @param {string} sessionID
   * @returns {Promise<{ branch: string, head: string }>}
   */
  async _resolveBranchContext(sessionID) {
    const cached = this._branchContext.get(sessionID);
    if (cached) return cached;
    let branch = "";
    let head = "";
    if (this.git?.resolveBranch) {
      try { branch = (await this.git.resolveBranch(this.root)) ?? ""; } catch { branch = ""; }
    }
    if (this.git?.resolveHead) {
      try { head = (await this.git.resolveHead(this.root)) ?? ""; } catch { head = ""; }
    }
    const ctx = { branch, head };
    // Task 4: sticky-фикс (spec §3.3) — не кэшируем резолв с пустым head,
    // чтобы следующий re-summarize попробовал резолв заново.
    if (head) {
      this._branchContext.set(sessionID, ctx);
    }
    // M-7: bound — FIFO-эвикция старейшего ключа при превышении cap (Map
    // сохраняет порядок вставки; keys().next() — самый старый).
    if (this._branchContext.size > this._branchContextCap) {
      const oldest = this._branchContext.keys().next().value;
      this._branchContext.delete(oldest);
    }
    return ctx;
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
      // M7: prune stale state entries (older than backfill window)
      try { await this.state.prune?.((this.config.backfill_window_days ?? 30) * 86400_000); } catch {}
      const listResp = await this.client.session.list({});
      const list = (listResp?.data ?? listResp) ?? [];
      const firstRun = (await this.state.getFirstRun()) ?? Date.now();
      let queued = 0;
      // Task 3: счётчики backfill-окна (spec §4.1 memory:backfill) —
      // considered = все просмотренные сессии; indexed = поставленные в
      // debounce-очередь; skipped = остальные (инвариант: considered = indexed + skipped).
      let considered = 0;
      let skipped = 0;
      const backfillStart = Date.now();
      for (const s of list) {
        considered++;
        if (queued >= (this.config.backfill_max_per_start ?? 5)) { skipped++; continue; }
        if (s.parentID) { skipped++; continue; }
        if (s.title?.startsWith("[maestro-memory]")) {
          try { await this.client.session.delete({ path: { id: s.id } }); } catch {}
          skipped++;
          continue;
        }
        if (await this.state.isSkipped(s.id)) { skipped++; continue; }
        const updated = s.time?.updated ?? s.time_updated;
        if (!updated) { skipped++; continue; }
        if (firstRun - updated > (this.config.backfill_window_days ?? 30) * 86400_000) { skipped++; continue; }
        this._debounce(s.id);
        queued++;
      }
      // Task 3: аудит окна — по факту завершения пачки (debounce-механика:
      // фактическая индексация уходит в таймеры, здесь фиксируется очередь).
      this.logInfo?.("memory:backfill", { considered, indexed: queued, skipped });
      this.logInfo?.("memory:backfill.done", { duration_ms: Date.now() - backfillStart });
    } catch {
      // recovery best-effort, ignore errors
    }
  }

  async onSessionDeleted({ sessionID }) {
    // Runtime-очистка ВСЕГДА (spec §3.2): таймер, очередь, sticky, state.
    const t = this.timers.get(sessionID);
    if (t) { clearTimeout(t); this.timers.delete(sessionID); }
    this.queue.delete(sessionID);
    this._branchContext.delete(sessionID);
    try { await this.state.delete?.(sessionID); } catch {}
    // Race-guard (spec §5): tombstone для режима флага — post-upsert recheck.
    if (this.config.delete_on_session_delete) {
      this._tombstones.add(sessionID);
      try {
        await this.storage.delete(sessionID);
        this.logInfo?.("memory:session_deleted", { sessionID });
      } catch {
        // Audit-integrity: событие только по факту успеха (spec §5/§7).
        this.logError?.("memory:session_delete_failed", { sessionID });
      }
    } else {
      this.logInfo?.("memory:session_closed", { sessionID });
    }
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

      // I1: summarize + embed + upsert ALL inside withTimeout — bounds the LLM-dependent chain
      // so a hanging client.session.prompt cannot hold this.running (the concurrency lock) forever.
      const timeoutMs = this.config.summarize_timeout_ms ?? 120_000;
      const work = (async () => {
        // Task 4: write-gate (spec §3.3) — resolve branch/head BEFORE summarize;
        // abort early if no head (unattributed session). Sticky cache + existing
        // entry preserve previously-resolved head/branch across re-summarizes.
        const { branch, head } = await this._resolveBranchContext(sessionID);
        const existing = await this.storage.get(sessionID);
        const effHead = head || existing?.head || "";
        if (!effHead) {
          this.logDebug?.("memory:index_unattributed", { sessionID });
          return;
        }
        const effBranch = branch || existing?.branch || "";

        // Summarize inside withTimeout (I1) — if client.session.prompt hangs, timeout releases lock
        const summarizeStart = Date.now();
        const { title, summary, decisions } = await this.summarize({
          client: this.client,
          sessionID,
          transcript: masked,
          model: modelRef,
          summarizerModel: this.config.summarizer_model ?? null,
        });
        // Task 3: перф-аудит (spec §4.3) — длительность summarize; model —
        // только имя модели (spec §3: без @base_url/эндпоинта).
        this.logDebug?.("memory:summarize.duration", {
          sessionID,
          duration_ms: Date.now() - summarizeStart,
          model: modelRef?.modelID ?? null,
        });

        // Build entry, mask FIRST, then embed masked content (I1: embed after maskEntry)
        const entry = {
          session_id: sessionID,
          key,
          origin_project_hash: this.projectKey.hash,
          title,
          summary,
          decisions,
          embedding: null,
          model_id: this.embeddings.modelId,
          author: this.author ?? this.config.author ?? "unknown",
          time_first: sess?.time?.created ?? 0,
          time_last: sess?.time?.updated ?? 0,
          version: 0,
          branch: effBranch,
          head: effHead,
          merged: 0,
          host: hostname(),
          origin_remote: this.originRemote ?? "",
          prefixes: prefixesOf(this.key ?? ""),
        };

        // Task 3: artifact-links (spec §4.2) — извлечение путей записанных
        // файлов из tool-частей. Инварианты: tool-части НЕ попадают в
        // транскрипт саммаризатора (text-only, см. выше) и artifacts НЕ входят
        // в embed-вход (title+summary+decisions, см. ниже). Union с
        // existing.artifacts (D6, Z1), cap 8. Off-поведение: artifactGlobs=[]
        // → extractArtifacts возвращает [] (без извлечения).
        // Task 7 (deferred minor): union-дедуп case-insensitive (как в
        // extractArtifacts) — dedup-ключ String(p).toLowerCase(), extracted-first.
        const extracted = extractArtifacts(messages, {
          root: this.root,
          globs: this.artifactGlobs,
          confidentialPatterns: this.artifactConfidentialPatterns,
        });
        const unionSeen = new Set();
        const union = [];
        for (const p of [...extracted, ...(existing?.artifacts ?? [])]) {
          const k = String(p).toLowerCase();
          if (unionSeen.has(k)) continue;
          unionSeen.add(k);
          union.push(p);
        }
        entry.artifacts = union.slice(0, 8);

        // G2: re-mask entry before write (defense-in-depth)
        const maskedEntry = maskEntry(entry, { confidentialPatterns: this.confidentialPatterns });

        // I1: embed AFTER mask
        const vec = await this.embeddings.embed(`${maskedEntry.title}\n${maskedEntry.summary}\n${maskedEntry.decisions.join("\n")}`);
        maskedEntry.embedding = vec;

        // G5: version increment — reuse `existing` fetched by the write-gate.
        maskedEntry.version = (existing?.version ?? 0) + 1;

        // Task 4 + follow-up (2026-09-11): merged — head ∈ mainline (v5: identity
        // по head). Прежнее липкое правило (existing.merged===1 → keep) оставляло
        // merged=1 записям, чей head после ресаммаризации на feature-ветке НЕ
        // в mainline → такие записи ошибочно считались general (всегда в контексте
        // recall) и показывались в отчёте как «в main». Теперь merged
        // пересчитывается по предку head; при недоступности git/head — прежний
        // fast-path по имени ветки (branch === mainline → 1).
        let merged = effBranch && this.mainline && effBranch === this.mainline ? 1 : 0;
        if (this.git?.isAncestor && effHead && this.mainline) {
          const anc = await this.git.isAncestor(this.root, effHead, this.mainline);
          if (anc === "yes" || anc === "no") merged = anc === "yes" ? 1 : 0;
        }
        maskedEntry.merged = merged;

        // Task 5: tombstone race-guard (spec §5) — pre-check перед upsert:
        // если сессия удалена во время summarize, не пишем запись вовсе.
        if (this._tombstones.has(sessionID)) return;
        await this.storage.upsert([maskedEntry]);
        // Task 5: post-upsert recheck — сессия могла быть удалена между
        // pre-check и upsert; тогда удаляем только что записанную запись
        // (не даём «воскреснуть» удалённой сессии).
        if (this._tombstones.has(sessionID)) {
          try { await this.storage.delete(sessionID); } catch {}
          this._tombstones.delete(sessionID);
          return;
        }
        await this.state.setSummarized(sessionID);
        // Task 3: lifecycle-аудит (spec §4.1) — indexed при первой записи,
        // reindexed при пере-саммаризации повторно посещённой сессии
        // (version > 1, spec §4.4). author — из записи (maskedEntry.author).
        const author = maskedEntry.author;
        if (maskedEntry.version > 1) {
          this.logInfo?.("memory:reindexed", { sessionID, projectKey: this.projectKey.hash, author, version: maskedEntry.version });
        } else {
          this.logInfo?.("memory:indexed", { sessionID, projectKey: this.projectKey.hash, author, version: maskedEntry.version });
        }
      })();

      await withTimeout(work, timeoutMs);
    } catch (err) {
      // Task 3: root-cause-аудит (spec §4.1/§3) — enum-only: тела ошибок
      // (message/stack) в лог НЕ попадают, только error_class. Заменяет
      // прежнее «memory: indexer error» с errMsg (нарушало whitelist).
      const errorClass = err?.retryable ? "retryable" : "storage";
      this.logError?.("memory:index_error", { sessionID, error_class: errorClass });
      if (err?.retryable) {
        // retryable (сеть/timeout/5xx embed) — skip не засчитывается (I3).
        this.logDebug?.("memory:index_retryable", { sessionID });
      } else {
        try { await this.state.recordFail(sessionID); } catch {}
        // Task 3: локальный счётчик fails (state не отдаёт fails наружу) —
        // memory:index_skipped ровно в момент перехода в skip (3+ fails).
        const fails = (this._fails.get(sessionID) ?? 0) + 1;
        this._fails.set(sessionID, fails);
        if (fails >= 3) {
          this.logWarn?.("memory:index_skipped", { sessionID, fails });
        }
      }
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
    this._branchContext.clear();
    this._fails.clear();
    this._tombstones.clear();
  }
}
