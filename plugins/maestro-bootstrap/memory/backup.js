import { createHash } from "node:crypto";
import { existsSync, readdirSync, unlinkSync, statSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { spawnSync } from "node:child_process";
import { SCAN_FIELDS } from "./backfill.js";
import { maskEntry } from "./mask.js";

/**
 * backup.js — чистые функции для создания/перечня backup-файлов памяти.
 *
 * Без side-effects при импорте. I/O только в retention/list.
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
 * Разрешает абсолютный путь к каталогу backup.
 *
 * @param {string} relPath — относительный путь (из config).
 * @param {string?} gitRoot — корень git-репозитория (или `process.cwd()`).
 * @returns {string} абсолютный путь.
 */
export function resolveBackupDir(relPath, gitRoot) {
  return join(gitRoot || process.cwd(), relPath);
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

/** gitignore-проверка: только детерминированно (LLM warn не считает). */
export function gitIgnoreWarn(dir, gitRoot) {
  if (!gitRoot) return { ignored: false, reason: "not_a_git_repo" };
  // Относительный путь корректнее для `git -C root check-ignore`.
  const p = relative(gitRoot, dir);
  const r = spawnSync("git", ["-C", gitRoot, "check-ignore", "-q", "--", p], { encoding: "utf8" });
  if (r.error || r.status === 127 || r.status === 128) return gitIgnoreFallback(dir, gitRoot);
  return r.status === 0 ? { ignored: true, reason: null } : { ignored: false, reason: "not_ignored" };
}

/** Документированный fallback (git недоступен): наивный match по корневому .gitignore. */
export function gitIgnoreFallback(dir, gitRoot) {
  try {
    const lines = readFileSync(join(gitRoot, ".gitignore"), "utf8").split("\n").map((l) => l.trim()).filter(Boolean);
    const ignored = lines.some((l) => {
      if (l.startsWith("!")) return false;
      const p = l.endsWith("/") ? l.slice(0, -1) : l;
      return dir === p || dir.startsWith(`${p}/`);
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
