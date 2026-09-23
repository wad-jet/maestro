import { createHash } from "node:crypto";
import { existsSync, readdirSync, unlinkSync, statSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join, relative, isAbsolute } from "node:path";
import { spawnSync } from "node:child_process";
import { SCAN_FIELDS } from "./backfill.js";
import { maskEntry } from "./mask.js";
import { validateImportEntry } from "./validation.js";

/**
 * backup.js — функции для создания/перечня/восстановления backup-файлов памяти.
 *
 * Без side-effects при импорте. I/O в retention/list/runBackup/runRestore.
 *
 * Формат:
 *   backup-<key>-<ts>.jsonl          — JSONL записей
 *   backup-<key>-<ts>.manifest.json  — манифест (метаданные + sha256)
 *
 * @module backup
 */

/**
 * Возвращает базовое имя backup-пары (без расширения).
 *
 * @param {string} key — namespace/key памяти.
 * @param {number} ts — timestamp в миллисекундах.
 * @returns {string} `backup-${key}-${ts}`.
 */
export function backupBaseName(key, ts) {
  return `backup-${key}-${ts}`;
}

/**
 * Сериализует массив записей в JSONL (одна строка на запись, trailing `\n`).
 * Пустой массив → пустая строка.
 *
 * @param {unknown[]} entries — записи памяти.
 * @returns {string} JSONL-строка.
 */
export function buildJsonl(entries) {
  if (!entries.length) return "";
  return entries.map((e) => JSON.stringify(e)).join("\n") + "\n";
}

/** Формат манифеста backup. */
export const BACKUP_FORMAT = "maestro-memory-backup/v1";

/**
 * Формирует мета-объект манифеста backup.
 *
 * @param {object} opts
 * @param {unknown[]} opts.entries — записи (для sha256).
 * @param {string} opts.key — namespace/key.
 * @param {string} opts.storageType — тип хранилища (`sqlite` | `qdrant` | `pgvector`).
 * @param {string} opts.modelId — модель эмбеддингов.
 * @param {number} opts.dim — размерность эмбеддингов.
 * @param {string} opts.pluginVersion — версия плагина.
 * @param {number} opts.ts — timestamp.
 * @returns {{ format: string, plugin_version: string, schema_fields: string[], model_id: string, dim: number, key: string, ts: number, count: number, sha256: string, storage_type: string }}
 */
export function buildManifestMeta({
  entries,
  key,
  storageType,
  modelId,
  dim,
  pluginVersion,
  ts,
}) {
  return {
    format: BACKUP_FORMAT,
    plugin_version: pluginVersion,
    schema_fields: [...SCAN_FIELDS],
    model_id: modelId,
    dim,
    key,
    ts,
    count: entries.length,
    sha256: createHash("sha256").update(buildJsonl(entries)).digest("hex"),
    storage_type: storageType,
  };
}

/**
 * Разрешает путь к каталогу backup.
 *
 * @param {string} relPath — относительный или абсолютный путь; абсолютный
 *   возвращается как есть, относительный — относительно root.
 * @param {string?} gitRoot — корень git-репозитория (или `process.cwd()`).
 * @returns {string} абсолютный путь.
 */
export function resolveBackupDir(relPath, gitRoot) {
  const root = gitRoot || process.cwd();
  if (isAbsolute(relPath)) return relPath;
  return join(root, relPath);
}

/**
 * Применяет политику ретенши: удаляет старейшие пары .jsonl/.manifest.json,
 * сохраняя последние `retention` пар. Чужие файлы не трогает.
 *
 * Отрицательные retention — поведение не определено; валидация (целое ≥ 0) —
 * на вызывающем (resolveBackupConfig).
 *
 * @param {string} dir — путь к каталогу.
 * @param {string} key — namespace/key (фильтр имён).
 * @param {number} retention — сколько последних пар хранить (0 = off).
 * @returns {string[]} базовые имена удалённых пар.
 */
export function applyRetention(dir, key, retention) {
  if (!retention) return [];
  if (!existsSync(dir)) return [];

  const prefix = `backup-${key}-`;
  const bases = new Set();

  for (const f of readdirSync(dir)) {
    if (!f.startsWith(prefix)) continue;
    if (f.endsWith(".jsonl")) bases.add(f.slice(0, -".jsonl".length));
    else if (f.endsWith(".manifest.json")) bases.add(f.slice(0, -".manifest.json".length));
  }

  const sorted = [...bases]
    .filter((b) => /^\d+$/.test(b.slice(prefix.length)))
    .sort((a, b) => Number(b.slice(prefix.length)) - Number(a.slice(prefix.length)));

  const stale = sorted.slice(retention);
  for (const b of stale) {
    for (const f of [`${b}.jsonl`, `${b}.manifest.json`]) {
      try {
        unlinkSync(join(dir, f));
      } catch {
        /* файла нет — ок */
      }
    }
  }
  return stale;
}

/**
 * Перечисляет backup-пары в каталоге, отсортированные по убыванию timestamp.
 *
 * @param {string} dir — путь к каталогу.
 * @param {string} key — namespace/key (фильтр имён).
 * @returns {Array<{ file: string, manifest: string, ts: number, jsonl: boolean, manifest_ok: boolean, size: number }>}
 */
export function listBackups(dir, key) {
  if (!existsSync(dir)) return [];

  const prefix = `backup-${key}-`;
  const map = new Map();

  const get = (base) => {
    const tsPart = base.slice(prefix.length);
    if (!/^\d+$/.test(tsPart)) return null;
    if (!map.has(base)) {
      map.set(base, {
        base,
        ts: Number(tsPart),
        jsonl: false,
        manifest: false,
        size: 0,
      });
    }
    return map.get(base);
  };

  for (const f of readdirSync(dir)) {
    if (!f.startsWith(prefix)) continue;

    if (f.endsWith(".jsonl")) {
      const base = f.slice(0, -".jsonl".length);
      const r = get(base);
      if (r) {
        r.jsonl = true;
        try {
          const st = statSync(join(dir, f));
          r.size = st.size;
        } catch {
          /* ok */
        }
      }
    } else if (f.endsWith(".manifest.json")) {
      const base = f.slice(0, -".manifest.json".length);
      const r = get(base);
      if (r) r.manifest = true;
    }
  }

  return [...map.values()].sort((a, b) => b.ts - a.ts).map((r) => ({
    file: join(dir, `${r.base}.jsonl`),
    manifest: join(dir, `${r.base}.manifest.json`),
    ts: r.ts,
    jsonl: r.jsonl,
    manifest_ok: r.manifest,
    size: r.size,
  }));
}

/**
 * gitignore-проверка: только детерминированно (LLM warn не считает).
 *
 * @param {string} dir — путь (абсолютный или cwd-relative); нормализуется
 *   `relative(gitRoot, …)`. Реальный вызывающий (runBackup) передаёт абсолютный dir.
 * @param {string?} gitRoot — корень git-репозитория.
 * @returns {{ ignored: boolean, reason: string|null }}
 */
export function gitIgnoreWarn(dir, gitRoot) {
  if (!gitRoot) return { ignored: false, reason: "not_a_git_repo" };
  // Относительный путь корректнее для `git -C root check-ignore`.
  const p = relative(gitRoot, dir);
  const r = spawnSync("git", ["-C", gitRoot, "check-ignore", "-q", "--", p], { encoding: "utf8" });
  if (r.error || r.status === 127 || r.status === 128) return gitIgnoreFallback(p, gitRoot);
  return r.status === 0 ? { ignored: true, reason: null } : { ignored: false, reason: "not_ignored" };
}

/**
 * Документированный fallback (git недоступен): наивный match по корневому .gitignore.
 *
 * @param {string} relPath — относительный к `gitRoot` путь (уже посчитанный
 *   `relative(gitRoot, relPath)` из вызывающего).
 * @param {string} gitRoot — корень git-репозитория.
 * @returns {{ ignored: boolean, reason: string|null }}
 */
export function gitIgnoreFallback(relPath, gitRoot) {
  try {
    const lines = readFileSync(join(gitRoot, ".gitignore"), "utf8").split("\n").map((l) => l.trim()).filter(Boolean);
    const ignored = lines.some((l) => {
      if (l.startsWith("!")) return false;
      const p = l.endsWith("/") ? l.slice(0, -1) : l;
      return relPath === p || relPath.startsWith(`${p}/`);
    });
    return ignored ? { ignored: true, reason: null } : { ignored: false, reason: "not_ignored_fallback" };
  } catch {
    return { ignored: false, reason: "git_unavailable" };
  }
}

/**
 * Бэкап (spec §5.1): preflight → scan(SCAN_FIELDS) → maskEntry (текущий
 * confidential-набор) → JSONL+манифест → gitignore-warn → retention → audit.
 * Ошибки — throw (обёртки tool/CLI форматируют).
 *
 * @param {object} opts
 * @param {object} opts.storage — хранилище с методами scan/upsert/deleteByFilter
 * @param {string} opts.storageType — тип хранилища (sqlite-only)
 * @param {string} opts.effectiveKey — namespace/key для имени файла
 * @param {string} opts.modelId — модель эмбеддингов
 * @param {number} opts.dim — размерность эмбеддингов
 * @param {string} opts.pluginVersion — версия плагина
 * @param {object} opts.maskPatterns — { confidential: string[], artifacts: string[] }
 * @param {object} opts.backupCfg — { path: string, retention: number }
 * @param {(msg: string, extra: object) => void} [opts.log] — опциональный логгер
 * @param {string?} [opts.gitRoot] — корень git-репозитория
 * @param {() => number} [opts.now] — детерминированный таймстамп
 * @returns {{ file: string, manifest: string, count: number, warn: string|null }}
 */
export async function runBackup({ storage, backupCfg, effectiveKey, storageType, modelId, dim, pluginVersion, maskPatterns, log, gitRoot, now = () => Date.now() }) {
  if (storageType !== "sqlite") throw new Error("memory_backup: v1 — только storage.type sqlite");

  const rows = await storage.scan({ key: effectiveKey, fields: SCAN_FIELDS });
  if (!rows.length) throw new Error("memory_backup: нет записей для бэкапа");

  const entries = rows.map((r) =>
    maskEntry(r, { confidentialPatterns: maskPatterns.confidential, artifactConfidentialPatterns: maskPatterns.artifacts })
  );

  const ts = now();
  const dir = resolveBackupDir(backupCfg.path, gitRoot);
  mkdirSync(dir, { recursive: true });

  const meta = buildManifestMeta({ entries, key: effectiveKey, storageType, modelId, dim, pluginVersion, ts });
  const base = backupBaseName(effectiveKey, ts);
  const jsonlPath = join(dir, `${base}.jsonl`);
  const manifestPath = join(dir, `${base}.manifest.json`);

  writeFileSync(jsonlPath, buildJsonl(entries), "utf8");
  writeFileSync(manifestPath, JSON.stringify(meta, null, 2) + "\n", "utf8");

  const gi = gitIgnoreWarn(dir, gitRoot);
  const removed = applyRetention(dir, effectiveKey, backupCfg.retention);

  log?.("memory:backup", { path: jsonlPath, count: entries.length, sha256: meta.sha256, warn: gi.ignored ? null : gi.reason, removed: removed.length });

  return { file: jsonlPath, manifest: manifestPath, count: entries.length, warn: gi.ignored ? null : gi.reason };
}

/**
 * Restore (spec §5.2): файл обязан быть в каталоге бэкапов; валидация sha256 +
 * манифеста (fail-closed набор) + всех строк — ДО изменений; merge (дефолт) /
 * replace (tool — нативный ask + replace:true; cli — isTty + ввод namespace).
 * Счёт: overwritten/added.
 *
 * @param {object} opts
 * @param {object} opts.storage — хранилище с методами scan/upsert/deleteByFilter
 * @param {string} opts.storageType — тип хранилища (sqlite-only)
 * @param {string} opts.effectiveKey — namespace/key
 * @param {string} opts.modelId — модель эмбеддингов
 * @param {number} opts.dim — размерность эмбеддингов
 * @param {string} opts.file — абсолютный путь к .jsonl файлу
 * @param {boolean} [opts.replace=false] — replace (true) или merge (false)
 * @param {string} [opts.channel="tool"] — "tool" | "cli"; неизвестные значения
 *   при replace:true не проходят cli-гейты (валидация — debt)
 * @param {boolean} [opts.isTty=false] — true если CLI интерактивный терминал
 * @param {string?} [opts.confirmNamespace=null] — namespace для подтверждения replace (cli)
 * @param {object} opts.maskPatterns — { confidential: string[], artifacts: string[] }
 * @param {string?} [opts.pluginVersion] — версия плагина для warn-only сравнения
 * @param {(msg: string, extra: object) => void} [opts.log] — опциональный логгер
 * @param {string?} [opts.gitRoot] — корень git-репозитория
 * @returns {{ count: number, mode: "merge"|"replace", overwritten: number, added: number, warn: string|null }}
 */
export async function runRestore({ storage, backupCfg, effectiveKey, storageType, modelId, dim, file, replace = false, channel = "tool", isTty = false, confirmNamespace = null, maskPatterns, pluginVersion, log, gitRoot }) {
  if (storageType !== "sqlite") throw new Error("memory_backup: v1 — только storage.type sqlite");
  const dir = resolveBackupDir(backupCfg.path, gitRoot);

  // Path-guard: file должен быть внутри backup directory (防目录穿越)
  const rel = relative(dir, file);
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) throw new Error("memory_backup: файл должен быть бэкапом из memory.backup.path (каталог бэкапов)");

  const manifestPath = file.endsWith(".jsonl") ? `${file.slice(0, -".jsonl".length)}.manifest.json` : file;
  if (!existsSync(manifestPath)) throw new Error("memory_backup: нет манифеста (fail-closed)");

  let meta;
  try {
    const rawMeta = readFileSync(manifestPath, "utf8");
    meta = JSON.parse(rawMeta);
    if (typeof meta !== "object" || meta === null) throw new Error("not object");
  } catch {
    throw new Error("memory_backup: манифест невалиден (fail-closed)");
  }

  const raw = readFileSync(file, "utf8");
  if (meta.format !== BACKUP_FORMAT) throw new Error("memory_backup: формат манифеста не поддерживается (fail-closed)");
  if (createHash("sha256").update(raw).digest("hex") !== meta.sha256) throw new Error("memory_backup: sha256 не совпадает (порча или подмена файла)");

  if (meta.storage_type !== storageType) throw new Error(`memory_backup: storage_type не совпадает (манифест: ${meta.storage_type})`);
  if (meta.key !== effectiveKey) throw new Error(`memory_backup: key не совпадает (манифест: ${meta.key})`);
  if (meta.model_id !== modelId) throw new Error(`memory_backup: model_id не совпадает (манифест: ${meta.model_id})`);
  if (meta.dim !== dim) throw new Error(`memory_backup: dim не совпадает (манифест: ${meta.dim})`);
  if (!Array.isArray(meta.schema_fields) || JSON.stringify([...meta.schema_fields].sort()) !== JSON.stringify([...SCAN_FIELDS].sort())) throw new Error("memory_backup: schema_fields манифеста несовместимы (fail-closed)");

  // plugin_version warn-only (паритет с runBackup)
  const versionWarn = (meta.plugin_version && pluginVersion && meta.plugin_version !== pluginVersion)
    ? `plugin_version: ${meta.plugin_version}`
    : null;

  const entries = [];
  const lines = raw.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      throw new Error(`memory_backup: строка ${i + 1} невалидна: не JSON`);
    }
    const reason = validateImportEntry(parsed, storage, effectiveKey, maskPatterns.artifacts);
    if (reason) throw new Error(`memory_backup: строка ${i + 1} невалидна: ${reason}`);
    entries.push(parsed);
  }
  if (entries.length !== meta.count) throw new Error("memory_backup: count манифеста не совпадает с числом строк");

  if (replace) {
    if (channel === "cli") {
      if (!isTty) throw new Error("memory_backup: replace из не-интерактивного вызова запрещён — запустите CLI вручную");
      if (confirmNamespace !== effectiveKey) throw new Error("memory_backup: подтверждение replace не совпадает с namespace");
    }
    await storage.deleteByFilter({ key: effectiveKey });
  }

  const existing = new Set((await storage.scan({ key: effectiveKey, fields: ["session_id"] })).map((r) => r.session_id));
  const masked = entries.map((e) => maskEntry(e, { confidentialPatterns: maskPatterns.confidential, artifactConfidentialPatterns: maskPatterns.artifacts }));
  await storage.upsert(masked);
  const added = masked.filter((e) => !existing.has(e.session_id)).length;
  const overwritten = masked.length - added;
  log?.("memory:restore", { file, count: masked.length, mode: replace ? "replace" : "merge", overwritten, added, sha256: meta.sha256, warn: versionWarn });
  return { count: masked.length, mode: replace ? "replace" : "merge", overwritten, added, warn: versionWarn };
}
