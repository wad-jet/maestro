import { createHash } from "node:crypto";
import { existsSync, readdirSync, unlinkSync, statSync } from "node:fs";
import { join } from "node:path";
import { SCAN_FIELDS } from "./backfill.js";

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

const MAX_JSONL_SIZE = 100 * 1024; // 100 KB

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
    format: "maestro-memory-backup/v1",
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
 * @returns {Array<{ file: string, manifest: string, ts: number, jsonl: boolean, manifest_ok: boolean, size: number, jsonl_size_ok: boolean }>}
 */
export function listBackups(dir, key) {
  if (!existsSync(dir)) return [];

  const prefix = `backup-${key}-`;
  const map = new Map();

  const get = (base) => {
    if (!map.has(base)) {
      map.set(base, {
        base,
        ts: Number(base.slice(prefix.length)),
        jsonl: false,
        manifest: false,
        size: 0,
        jsonl_size_ok: true,
      });
    }
    return map.get(base);
  };

  for (const f of readdirSync(dir)) {
    if (!f.startsWith(prefix)) continue;

    if (f.endsWith(".jsonl")) {
      const r = get(f.slice(0, -".jsonl".length));
      r.jsonl = true;
      try {
        const st = statSync(join(dir, f));
        r.size = st.size;
        r.jsonl_size_ok = st.size <= MAX_JSONL_SIZE;
      } catch {
        /* ok */
      }
    } else if (f.endsWith(".manifest.json")) {
      get(f.slice(0, -".manifest.json".length)).manifest = true;
    }
  }

  return [...map.values()]
    .filter((r) => Number.isInteger(r.ts))
    .sort((a, b) => b.ts - a.ts)
    .map((r) => ({
      file: join(dir, `${r.base}.jsonl`),
      manifest: join(dir, `${r.base}.manifest.json`),
      ts: r.ts,
      jsonl: r.jsonl,
      manifest_ok: r.manifest,
      size: r.size,
      jsonl_size_ok: r.jsonl_size_ok,
    }));
}
