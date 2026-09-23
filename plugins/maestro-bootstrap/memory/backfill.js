import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { hostname } from "node:os";
import { confGlobMatch } from "../core.js";
import { extractArtifacts } from "./artifacts.js";
import { maskEntry } from "./mask.js";
import { prefixesOf } from "./project.js";
import { SESSIONS } from "./summarize.js";

// Локальный нормализатор embedding (spec §4.2.1 п.2): дублируется из index.js
// без рефакторинга. sqlite возвращает Buffer (BLOB) → Float32Array-view;
// Float32Array/Array — passthrough; string (JSON-массив, pgvector) — parse;
// прочее (null/…) → null.
function toF32(v) {
  if (v instanceof Float32Array) return v;
  if (Array.isArray(v)) return new Float32Array(v);
  if (typeof v === "string") {
    try { return new Float32Array(JSON.parse(v)); } catch { return null; }
  }
  if (v?.buffer) return new Float32Array(v.buffer, v.byteOffset, v.byteLength / 4);
  return null;
}

// Поля записи для полного upsert (RI-3: спред из existing — меняются только
// artifacts + version). embedding — opt-in поле scan (C1: storage.get затирает
// embedding на всех бэкендах; scan без fields его не возвращает).
export const SCAN_FIELDS = [
  "session_id", "key", "origin_project_hash", "title", "summary", "decisions",
  "artifacts", "author", "time_first", "time_last", "version", "model_id",
  "embedding", "branch", "head", "merged", "host", "origin_remote", "prefixes",
];

const MAX_ARTIFACTS = 8;

/**
 * Light-путь бэкфилла artifacts (spec §4.2.1): детерминированное извлечение
 * путей записанных файлов из сообщений сессии + union с existing.artifacts.
 *
 * Инварианты: 0 LLM (RI-5); меняет только artifacts + version (RI-3); не пишет
 * в state (RI-4 — state не входит в deps); no-op guard — case-insensitive
 * set-равенство union и existing → без upsert (RI-7); maskEntry перед upsert
 * (G2-parity: artifacts — resolved-набор, текст — raw-набор).
 *
 * @param {{ client: object, storage: object, root: string, key: string,
 *   artifactGlobs: string[], artifactConfidentialPatterns: string[],
 *   confidentialPatterns: string[], embedModelId: string }} deps
 * @param {string} sessionID
 * @returns {Promise<{ status: string, artifacts: string[] }>}
 *   status: updated | no_change | skip_no_record | skip_model_mismatch |
 *   skip_messages_unavailable | skip_no_embedding | skip_service
 */
export async function reindexSessionArtifacts(deps, sessionID) {
  const {
    client, storage, root, key, artifactGlobs,
    artifactConfidentialPatterns, confidentialPatterns, embedModelId,
  } = deps;

  // 1. Служебные сессии (саммаризатор) — вне индексации.
  if (SESSIONS.has(sessionID)) return { status: "skip_service", artifacts: [] };

  // 2. Запись — scan (embedding opt-in) + filter по session_id.
  const rows = await storage.scan({ key, fields: SCAN_FIELDS });
  const existing = rows.find((r) => r.session_id === sessionID);
  if (!existing) return { status: "skip_no_record", artifacts: [] };

  // 3. Модель записи должна совпадать с активной (смешение эмбеддингов разных
  // моделей в одном бакете ломает поиск; пере-embed = уже полный путь).
  if (existing.model_id !== embedModelId) {
    return { status: "skip_model_mismatch", artifacts: existing.artifacts ?? [] };
  }

  // 4. Пустой embedding → пере-embed = полный путь, не light.
  if (!existing.embedding || existing.embedding.length === 0) {
    return { status: "skip_no_embedding", artifacts: existing.artifacts ?? [] };
  }

  // 5. Сообщения сессии — ошибка/пусто → недоступны.
  let messages;
  try {
    const resp = await client.session.messages({ path: { id: sessionID } });
    messages = (resp?.data ?? resp) ?? [];
  } catch {
    return { status: "skip_messages_unavailable", artifacts: existing.artifacts ?? [] };
  }
  if (!Array.isArray(messages) || messages.length === 0) {
    return { status: "skip_messages_unavailable", artifacts: existing.artifacts ?? [] };
  }

  // 6. Извлечение артефактов (resolved-набор, как в indexer).
  const extracted = extractArtifacts(messages, {
    root,
    globs: artifactGlobs,
    confidentialPatterns: artifactConfidentialPatterns,
  });

  // 7. Union D6: extracted-first, dedup case-insensitive, cap 8.
  const unionSeen = new Set();
  const union = [];
  for (const p of [...extracted, ...(existing.artifacts ?? [])]) {
    const k = String(p).toLowerCase();
    if (unionSeen.has(k)) continue;
    unionSeen.add(k);
    union.push(p);
  }
  const artifacts = union.slice(0, MAX_ARTIFACTS);

  // 8. No-op guard (RI-7): case-insensitive set-равенство **post-mask union**
  // (union, отфильтрованной resolved-набором — тем же фильтром, что maskEntry
  // применяет к artifacts) и сохранённых existing.artifacts → без upsert.
  // Guard по pre-mask union запрещён (spec §4.2.1 п.8): при no-delta (extracted
  // пусто) и stale-пути в записи, матчащем ужесточенный resolved-набор,
  // pre-mask union == existing → no_change, и stale-путь никогда не чистится.
  const artifactPatterns = artifactConfidentialPatterns ?? confidentialPatterns;
  const lowerConf = artifactPatterns
    .filter((p) => typeof p === "string" && p)
    .map((p) => p.toLowerCase());
  const maskedUnion = artifacts.filter(
    (p) => typeof p === "string" && !lowerConf.some((pat) => confGlobMatch(pat, p.toLowerCase()))
  );
  const existingLower = new Set((existing.artifacts ?? []).map((p) => String(p).toLowerCase()));
  if (maskedUnion.length === existingLower.size && maskedUnion.every((p) => existingLower.has(String(p).toLowerCase()))) {
    return { status: "no_change", artifacts };
  }

  // 9. Entry: спред из existing (RI-3), меняются только artifacts + version.
  const entry = {
    ...existing,
    artifacts,
    version: (existing.version ?? 0) + 1,
    embedding: toF32(existing.embedding),
  };
  // G2-parity: maskEntry перед upsert (artifacts — resolved-набор drop,
  // текст — raw-набор) — чистит stale-пути из existing под текущим конфигом.
  const masked = maskEntry(entry, {
    confidentialPatterns,
    artifactConfidentialPatterns,
  });
  await storage.upsert([masked]);
  return { status: "updated", artifacts: masked.artifacts };
}

// ── Task 3: git-history scan + synthetic entry synthesis (spec §4.2.2-4.2.3) ──

/**
 * Plan-путь? basename `-plan.md` ИЛИ parent-каталог `plans`. План — не фича,
 * а спутник спеки (spec §4.2.2 п.1): пара spec+plan = одна фича.
 * @param {string} p  Repo-relative путь.
 * @returns {boolean}
 */
export function isPlanPath(p) {
  const s = String(p ?? "");
  if (!s) return false;
  const parts = s.split("/");
  const base = parts[parts.length - 1];
  if (base.endsWith("-plan.md")) return true;
  return parts.length > 1 && parts[parts.length - 2] === "plans";
}

/**
 * Детерминированный synthetic session_id (RI-1): `git-` + sha256(key + "|" +
 * commitSha + "|" + specPath).slice(0,12). key (effectiveKey) в хэше →
 * namespace-local ID: на централизованных бэкендах (qdrant/pgvector, общая
 * коллекция) один и тот же commit+specPath в разных namespace не коллизирует
 * (иначе foreign record → sticky `already_indexed` → фича не синтезируется);
 * intra-namespace идемпотентность сохранена (same key → same ID). spec и plan
 * одного коммита → разные ID (specPath в хэше); не коллидирует с реальными
 * `ses_*`.
 * @param {string} key  effectiveKey (namespace).
 * @param {string} commitSha
 * @param {string} specPath
 * @returns {string}
 */
export function gitFeatureSessionId(key, commitSha, specPath) {
  const h = createHash("sha256").update(`${key}|${commitSha}|${specPath}`).digest("hex");
  return `git-${h.slice(0, 12)}`;
}

// Конвенция-сосед плана (spec §4.2.2 п.4): `specs/X-design.md` →
// `plans/X-plan.md` (specs→plans, design→plan); legacy `specs/X.md` →
// `specs/X-plan.md` (та же директория). Без сегмента `specs` → null.
function conventionPlanPath(specPath) {
  const parts = String(specPath ?? "").split("/");
  const idx = parts.indexOf("specs");
  if (idx === -1) return null;
  const base = parts[parts.length - 1];
  if (base.endsWith("-design.md")) {
    const planBase = base.slice(0, -"-design.md".length) + "-plan.md";
    return [...parts.slice(0, idx), "plans", ...parts.slice(idx + 1, -1), planBase].join("/");
  }
  if (base.endsWith(".md")) {
    const planBase = base.slice(0, -".md".length) + "-plan.md";
    return [...parts.slice(0, idx + 1), ...parts.slice(idx + 1, -1), planBase].join("/");
  }
  return null;
}

// Первая H1 спеки (`# …`); fallback `Spec: <basename>` (spec §4.2.2 п.4).
function titleFromSpec(root, specPath) {
  try {
    const text = fs.readFileSync(path.join(root, specPath), "utf8");
    for (const line of String(text).split("\n")) {
      const m = line.match(/^#\s+(.+)/);
      if (m) return m[1].trim();
    }
  } catch {
    /* fail-soft: fallback ниже */
  }
  return `Spec: ${path.basename(specPath)}`;
}

// Рекурсивный обход дерева (repo-relative, posix). `.git` исключён.
function walkFiles(dir, root, out) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (e.name === ".git") continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walkFiles(full, root, out);
    else if (e.isFile()) out.push(path.relative(root, full).split(path.sep).join("/"));
  }
}

/**
 * Перепись git-истории (spec §4.2.2): кандидаты — файлы текущего дерева,
 * матчащие historyGlobs (confGlobMatch), кроме plan-путей и confidential
 * (resolved-набор, fail-closed). Для каждого — старейший добавивший коммит
 * (`git log --diff-filter=A --format="%H %ct" --reverse -- <path>`, первая
 * строка), coverage-guard по ⋃ record.artifacts (RI-2, C2: предковость по
 * head НЕ используется), план-ассоциация (конвенция → same-commit plan-подобные),
 * title из H1, merged по isAncestor, time из %ct (×1000).
 *
 * git-интерфейс (методы, fail-soft на каждый):
 *   log(root, path) → stdout `git log --diff-filter=A --format="%H %ct"
 *     --reverse -- <path>` (пусто → not_in_git; throw → gitErrors);
 *   isAncestor(root, sha, mainline) → "yes"|"no"|"error";
 *   commitMessage(root, sha) → subject (merge-детект ветки);
 *   filesOfCommit(root, sha) → repo-relative пути коммита (same-commit план).
 *
 * @param {{ root: string, historyGlobs: string[], git: object,
 *   mainline: string|null, records: Array<{artifacts: string[]}>,
 *   artifactConfidentialPatterns: string[] }} deps
 * @returns {Promise<{ features: Array, considered: number,
 *   covered: { by_artifacts: number, not_in_git: number,
 *   skip_confidential: number, plan_excluded: number }, gitErrors: Array }>}
 */
export async function scanHistory({ root, historyGlobs, git, mainline, records, artifactConfidentialPatterns }) {
  const features = [];
  const covered = { by_artifacts: 0, not_in_git: 0, skip_confidential: 0, plan_excluded: 0 };
  const gitErrors = [];
  let considered = 0;

  // Off-поведение: пустые globs → ничего не сканируем.
  if (!Array.isArray(historyGlobs) || historyGlobs.length === 0) {
    return { features, considered, covered, gitErrors };
  }
  // F1 fail-closed (Z4): resolved-набор обязателен и непуст (по построению
  // loadConfidentialConfig всегда непуст — builtin применяется всегда).
  if (!Array.isArray(artifactConfidentialPatterns) || artifactConfidentialPatterns.length === 0) {
    return { features, considered, covered, gitErrors };
  }
  // Git-адаптер fail-closed (RI-9): отсутствующий метод log (неполный T4-адаптер)
  // при optional chaining дал бы undefined → "пустой вывод" → кандидаты молча
  // стали бы not_in_git. Guard до цикла: fail LOUD (запись в gitErrors), не silent.
  if (typeof git?.log !== "function") {
    gitErrors.push({ error: "git adapter incomplete: log method missing" });
    return { features, considered, covered, gitErrors };
  }

  const lowerGlobs = historyGlobs
    .filter((g) => typeof g === "string" && g)
    .map((g) => g.toLowerCase());
  if (lowerGlobs.length === 0) return { features, considered, covered, gitErrors };
  const lowerConf = artifactConfidentialPatterns
    .filter((p) => typeof p === "string" && p)
    .map((p) => p.toLowerCase());
  if (lowerConf.length === 0) return { features, considered, covered, gitErrors };

  // Coverage-множество (RI-2): ⋃ record.artifacts, lowercase.
  const coveredArtifacts = new Set();
  for (const r of records ?? []) {
    for (const a of r?.artifacts ?? []) coveredArtifacts.add(String(a).toLowerCase());
  }

  const files = [];
  walkFiles(root, root, files);

  for (const rel of files) {
    const lowerRel = rel.toLowerCase();
    if (!lowerGlobs.some((g) => confGlobMatch(g, lowerRel))) continue;
    considered++;

    // 1. Plan-исключение (план — спутник спеки, не фича).
    if (isPlanPath(rel)) { covered.plan_excluded++; continue; }
    // 1. Confidential-исключение (fail-closed, resolved-набор).
    if (lowerConf.some((p) => confGlobMatch(p, lowerRel))) { covered.skip_confidential++; continue; }

    // 2. Старейший добавивший коммит: первая строка `git log --diff-filter=A
    //    --format="%H %ct" --reverse -- <path>`.
    let logOut;
    try {
      logOut = await git?.log?.(root, rel);
    } catch (err) {
      gitErrors.push({ path: rel, error: err instanceof Error ? err.message : String(err) });
      continue;
    }
    const firstLine = String(logOut ?? "").split("\n").map((s) => s.trim()).find(Boolean);
    if (!firstLine) { covered.not_in_git++; continue; }
    const [sha, ctStr] = firstLine.split(/\s+/);
    const ct = parseInt(ctStr, 10);
    if (!sha || !Number.isFinite(ct)) {
      gitErrors.push({ path: rel, error: `malformed git log line: ${firstLine}` });
      continue;
    }

    // 3. Coverage-guard (RI-2): путь ∈ ⋃ record.artifacts → не синтезируем.
    if (coveredArtifacts.has(lowerRel)) { covered.by_artifacts++; continue; }

    // 4. План-ассоциация: конвенция-сосед (existsSync) → same-commit
    //    plan-подобные (ровно 1); >1 → null (консервативно).
    let planPath = null;
    const conv = conventionPlanPath(rel);
    if (conv && fs.existsSync(path.join(root, conv))) {
      planPath = conv;
    } else {
      let commitFiles = [];
      try { commitFiles = await git?.filesOfCommit?.(root, sha); } catch (err) {
        // Non-fatal (auditability): planPath остаётся null, batch продолжается.
        gitErrors.push({ path: rel, error: `filesOfCommit: ${err instanceof Error ? err.message : String(err)}` });
        commitFiles = [];
      }
      const planLikes = (Array.isArray(commitFiles) ? commitFiles : [])
        .filter((f) => typeof f === "string" && f && f !== rel && isPlanPath(f));
      if (planLikes.length === 1) planPath = planLikes[0];
    }

    // 4. branch: merge-коммит → имя из сообщения (`Merge branch 'x'`), иначе "".
    let branch = "";
    try {
      const msg = String(await git?.commitMessage?.(root, sha) ?? "");
      const m = msg.match(/^Merge branch ['"]([^'"]+)['"]/);
      if (m) branch = m[1];
    } catch (err) {
      // Non-fatal (auditability): branch остаётся "", batch продолжается.
      gitErrors.push({ path: rel, error: `commitMessage: ${err instanceof Error ? err.message : String(err)}` });
      branch = "";
    }

    // 4. merged: isAncestor yes→1, no/error/null→0 (фича в листинге с пометкой).
    let merged = 0;
    if (mainline) {
      try {
        const anc = await git?.isAncestor?.(root, sha, mainline);
        if (anc === "yes") merged = 1;
      } catch { merged = 0; }
    }

    features.push({
      specPath: rel,
      planPath,
      commitSha: sha,
      branch,
      merged,
      title: titleFromSpec(root, rel),
      timeFirst: ct * 1000,
      timeLast: ct * 1000,
      artifacts: planPath ? [rel, planPath] : [rel],
    });
  }

  return { features, considered, covered, gitErrors };
}

/**
 * Синтез записи из фичи git-истории (spec §4.2.3).
 *
 * 1. Idempotency (RI-7): session_id = gitFeatureSessionId(key, commitSha,
 *    specPath); storage.get → существует → `already_indexed` (без перезаписи).
 * 2. Запись: author "git-backfill" (RI-6), version 1, prefixes = prefixesOf(key),
 *    head = commitSha, merged из feature, time из feature.
 * 3. artifacts: из feature.artifacts (scanHistory: [specPath, planPath?]) →
 *    existsSync (повторная проверка на момент run) + resolved confidential-фильтр
 *    (confGlobMatch, drop) + dedup lowercase + cap 8.
 * 4. Re-mask ДО записи (SECURITY.md §5a, G2): maskEntry — текст на raw-наборе,
 *    artifacts на resolved-наборе. LLM-вывод ВСЕГДА re-mask'ится.
 * 5. Embed только ПОСЛЕ маски (I1): embeddings(maskedTitle + "\n" + maskedSummary
 *    + "\n" + maskedDecisions.join("\n")); embeddings — embed-функция.
 *
 * @param {{ storage: object, root: string, key: string, projectHash: string,
 *   originRemote: string, embedModelId: string, embeddings: Function,
 *   confidentialPatterns: string[], artifactConfidentialPatterns: string[] }} deps
 * @param {{ specPath: string, planPath: string|null, commitSha: string,
 *   branch: string, merged: number, title: string, timeFirst: number,
 *   timeLast: number, artifacts: string[] }} feature
 * @param {{ summary: string, decisions: string[] }} llm  Результат summarize.
 * @returns {Promise<{ status: "indexed"|"already_indexed", session_id: string }>}
 */
export async function synthesizeGitEntry(deps, feature, llm) {
  const {
    storage, root, key, projectHash, originRemote, embedModelId,
    embeddings, confidentialPatterns, artifactConfidentialPatterns,
  } = deps;

  const session_id = gitFeatureSessionId(key, feature.commitSha, feature.specPath);
  const existing = await storage.get(session_id);
  if (existing) return { status: "already_indexed", session_id };

  // 3. artifacts-фильтр: dedup lowercase → existsSync → resolved-матч → cap 8.
  const artifactPatterns = artifactConfidentialPatterns ?? confidentialPatterns;
  const lowerConf = (artifactPatterns ?? [])
    .filter((p) => typeof p === "string" && p)
    .map((p) => p.toLowerCase());
  const source = Array.isArray(feature.artifacts) && feature.artifacts.length > 0
    ? feature.artifacts
    : [feature.specPath, feature.planPath].filter(Boolean);
  const seen = new Set();
  const artifacts = [];
  for (const p of source) {
    if (artifacts.length >= MAX_ARTIFACTS) break;
    const s = String(p ?? "");
    if (!s) continue;
    const k = s.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    if (!fs.existsSync(path.join(root, s))) continue;
    if (lowerConf.some((pat) => confGlobMatch(pat, k))) continue;
    artifacts.push(s);
  }

  // 2. Запись без embedding (embedding — после маски, I1).
  const entry = {
    session_id,
    key,
    origin_project_hash: projectHash,
    title: feature.title,
    summary: llm.summary,
    decisions: llm.decisions,
    artifacts,
    embedding: null,
    model_id: embedModelId,
    author: "git-backfill",
    time_first: feature.timeFirst,
    time_last: feature.timeLast,
    version: 1,
    branch: feature.branch ?? "",
    head: feature.commitSha,
    merged: feature.merged ?? 0,
    host: hostname(),
    origin_remote: originRemote ?? "",
    prefixes: prefixesOf(key ?? ""),
  };

  // 4. Re-mask ДО записи (G2-parity: текст — raw-набор, artifacts — resolved).
  const masked = maskEntry(entry, { confidentialPatterns, artifactConfidentialPatterns });

  // 5. Embed только ПОСЛЕ маски (I1).
  masked.embedding = await embeddings(
    `${masked.title}\n${masked.summary}\n${masked.decisions.join("\n")}`,
  );

  await storage.upsert([masked]);
  return { status: "indexed", session_id };
}