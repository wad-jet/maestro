#!/usr/bin/env node
/**
 * Аварийный CLI memory backup/restore (spec §3): ручной запуск пользователем
 * вне opencode. Тонкая обёртка над backup.js.
 *
 * Резолвы (effectiveKey / storage-пути / confidential-наборы / modelId / dim)
 * зеркалят registerMemoryHooks (memory/index.js) — переиспользуются существующие
 * экспорты (config.js, project.js, core.js, storage.js, index.js/defaultDataDir);
 * логика не дублируется.
 *
 * Без side-effects при импорте: вся работа — в main() под guard
 * `safeRealpath(process.argv[1]) === safeRealpath(fileURLToPath(import.meta.url))`.
 *
 * Запуск: node <plugin>/memory/backup-cli.js <backup|restore --file <путь> [--replace]|list>
 * (из корня или подкаталога git-репозитория проекта с maestro.json).
 *
 * @module backup-cli
 */
import { readFileSync, existsSync, appendFileSync, mkdirSync, realpathSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, resolve, dirname } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import {
  classifyMemoryConfig,
  loadMemoryConfig,
  resolveEffectiveKey,
  resolveBackupConfig,
  resolveEffectiveTextConfig,
  sanitizeDirName,
} from "./config.js";
import { deriveProjectKey } from "./project.js";
import { getGitConfig, loadConfidentialConfig, readPluginVersion } from "../core.js";
// defaultDataDir — существующий экспорт memory/index.js (data-dir-резолв parity
// с registerMemoryHooks); топ-уровень модуля без side-effects (dynamic import
// @opencode-ai/plugin обёрнут в try/catch с shim).
import { defaultDataDir } from "./index.js";
import { createStorage } from "./storage.js";
import { runBackup, runRestore, listBackups, resolveBackupDir } from "./backup.js";

export const HELP = `Аварийный CLI memory backup/restore (spec §3) — ручной запуск вне opencode.

Использование:
  node backup-cli.js <команда> [опции]

Команды:
  backup                  Создать бэкап памяти (JSONL + манифест) в memory.backup.path
  restore --file <путь>   Восстановить из бэкапа (merge; wins restore по session_id)
                          --replace — полная замена (требует интерактивного
                          подтверждения вводом namespace; только TTY)
  list                    Перечислить бэкапы в каталоге memory.backup.path
  --help                  Показать эту справку

Запуск: из корня (или подкаталога) git-репозитория проекта с maestro.json,
где включена память (memory.enabled=true, storage.type=sqlite — v1).
`;

/**
 * git-корень из cwd; null при ошибке (не-git-каталог / нет git).
 * @param {string} cwd
 * @returns {string|null}
 */
function gitRootOf(cwd) {
  const r = spawnSync("git", ["rev-parse", "--show-toplevel"], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  if (r.error || r.status !== 0) return null;
  const p = (r.stdout ?? "").trim();
  return p || null;
}

/**
 * CLI-логгер: JSONL-append в daily-файл bootstrap-лога
 * `<dir>/maestro-bootstrap-<YYYY-MM-DD>.log`, где dir =
 * `MAESTRO_BOOTSTRAP_LOG_DIR` (паритет с makeLogger — при кастомном env лог
 * идёт в тот же каталог, что и у плагина) либо `<root>/.maestro/logs`.
 * Формат записи — как у makeLogger: { ts, level, msg, ...extra }.
 * При недоступности лога — warn в stderr; операция НЕ блокируется (spec §5.1).
 *
 * Возвращает функцию-логгер `(msg, extra) => void` (контракт log у
 * runBackup/runRestore) с свойством `.logger` — объект-логгер
 * (debug/info/warn/error) для createStorage (контракт бэкендов).
 * @param {string} root
 * @returns {{ (msg: string, extra?: object): void, logger: object }}
 */
export function cliLog(root) {
  const dir = process.env.MAESTRO_BOOTSTRAP_LOG_DIR || join(root, ".maestro", "logs");
  const write = (level, msg, extra) => {
    const now = new Date();
    const entry = JSON.stringify({ ts: now.toISOString(), level, msg, ...(extra ?? {}) });
    try {
      mkdirSync(dir, { recursive: true });
      appendFileSync(join(dir, `maestro-bootstrap-${now.toISOString().slice(0, 10)}.log`), entry + "\n");
    } catch (err) {
      process.stderr.write(`backup-cli: WARN: не удалось записать лог: ${err instanceof Error ? err.message : String(err)}\n`);
    }
  };
  const logger = {
    debug: (msg, extra) => write("debug", msg, extra),
    info: (msg, extra) => write("info", msg, extra),
    warn: (msg, extra) => write("warn", msg, extra),
    error: (msg, extra) => write("error", msg, extra),
  };
  const logFn = (msg, extra) => write("info", msg, extra);
  logFn.logger = logger;
  return logFn;
}

/**
 * Интерактивное подтверждение replace (spec §5.2.4): ввод namespace.
 * EOF (Ctrl+D) без ответа → null (runRestore честно откажется — «подтверждение
 * не совпадает», а не тихий exit 0: до фикса promise не резолвился, event loop
 * пустел, процесс завершался с кодом 0 без runRestore).
 * @param {{ effectiveKey: string, input?: object, output?: object }} opts
 *   input/output — инжектируемые потоки (тесты); по умолчанию process.stdin/stdout.
 * @returns {Promise<string|null>} введённый namespace (trim) или null при EOF.
 */
export function askReplaceConfirm({ effectiveKey, input = process.stdin, output = process.stdout }) {
  const rl = createInterface({ input, output });
  return new Promise((res) => {
    let settled = false;
    const settle = (v) => {
      if (settled) return; // close после ответа (и наоборот) → двойной resolve исключён
      settled = true;
      rl.close();
      res(v);
    };
    rl.on("close", () => settle(null)); // EOF без ответа
    rl.question(`Подтвердите replace — введите namespace (${effectiveKey}): `, (a) => settle(a.trim()));
  });
}

/**
 * Разбор аргументов команды (после action).
 * @param {string} action
 * @param {string[]} rest
 * @returns {{ file: string|null, replace: boolean } | { error: string }}
 */
function parseArgs(action, rest) {
  const out = { file: null, replace: false };
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (action === "restore" && a === "--file") {
      const v = rest[++i];
      if (v === undefined) return { error: "--file требует значение (путь к JSONL из list)" };
      out.file = resolve(v);
    } else if (action === "restore" && a === "--replace") {
      out.replace = true;
    } else {
      return { error: `неизвестный аргумент: ${a}` };
    }
  }
  return out;
}

/**
 * realpath с fallback на исходный путь (файла может ещё не быть). macOS:
 * `git rev-parse --show-toplevel` резолвит симлинки (/var → /private/var),
 * а пользовательский --file может идти через симлинк — без нормализации
 * path-guard в runRestore ложно отклонял бэкап из собственного каталога.
 * @param {string} p
 * @returns {string}
 */
function safeRealpath(p) {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
}

/**
 * Человеческий текст gitignore-warn (reason enum из gitIgnoreWarn).
 * @param {string} reason
 * @returns {string}
 */
function gitignoreWarnText(reason) {
  switch (reason) {
    case "not_ignored":
      return "каталог бэкапа НЕ в .gitignore (бэкапы могут попасть в git)";
    case "not_ignored_fallback":
      return "каталог бэкапа не найден в .gitignore (git недоступен — проверьте вручную)";
    case "not_a_git_repo":
      return "каталог бэкапа вне git-контроля (не-git-репозиторий)";
    case "git_unavailable":
      return "не удалось проверить .gitignore (git недоступен)";
    default:
      return `gitignore-check: ${reason}`;
  }
}

/**
 * Точка входа CLI. Возвращает exit code (0 = успех); ошибки — throw (guard
 * конвертирует в stderr + exit 1).
 * @returns {Promise<number>}
 */
export async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(HELP);
    return 0;
  }
  const [action, ...rest] = argv;
  if (!action || !["backup", "restore", "list"].includes(action)) {
    process.stdout.write(HELP);
    return 1;
  }

  // git-корень; root — для резолвов (мастер: gitRoot, иначе cwd).
  // safeRealpath: на macOS git rev-parse возвращает resolved-путь (/private/...),
  // а cwd/аргументы пользователя могут идти через симлинк — нормализуем обе
  // стороны в одно физическое дерево (иначе path-guard в runRestore ложно
  // отклоняет). На effectiveKey не влияет: при enabled памяти ключ — всегда
  // namespace (namespace обязателен в classifyMemoryConfig).
  const cwd = process.cwd();
  const gitRoot = gitRootOf(cwd);
  const root = safeRealpath(gitRoot ?? cwd);

  const parsed = parseArgs(action, rest);
  if (parsed.error) {
    process.stderr.write(`backup-cli: ${parsed.error}\n\n${HELP}`);
    return 1;
  }
  if (action === "restore" && !parsed.file) {
    process.stderr.write("backup-cli: restore: укажите --file <путь к JSONL из list>\n");
    return 1;
  }
  // replace-гейт (spec §5.2.4): не-tty → отказ ДО любых side-effects (storage init).
  if (action === "restore" && parsed.replace && !process.stdin.isTTY) {
    process.stderr.write("backup-cli: replace: доступен только из интерактивного терминала (запустите CLI вручную в терминале)\n");
    return 1;
  }

  // maestro.json в git-корне (или cwd) — как в плагине (root = запуск opencode).
  const maestroPath = join(root, "maestro.json");
  if (!existsSync(maestroPath)) {
    process.stderr.write(`backup-cli: не найден maestro.json: ${maestroPath}\n`);
    return 1;
  }
  let maestroJson;
  try {
    maestroJson = JSON.parse(readFileSync(maestroPath, "utf8"));
  } catch (err) {
    process.stderr.write(`backup-cli: maestro.json невалидный JSON: ${err instanceof Error ? err.message : String(err)}\n`);
    return 1;
  }

  // Конфиг — ТО ЖЕ резолв, что в registerMemoryHooks:
  // getGitConfig(root) → gitName → classify/loadMemoryConfig.
  const gitCfg = getGitConfig(root);
  const cls = classifyMemoryConfig(maestroJson, { gitName: gitCfg.name });
  if (cls.enabled !== true) {
    process.stderr.write(
      `backup-cli: memory не включён${cls.disabled_reason ? ` (причина: ${cls.disabled_reason})` : ""} — проверьте maestro.json → memory.enabled/namespace\n`
    );
    return 1;
  }
  const config = loadMemoryConfig(maestroJson, { gitName: gitCfg.name });
  const backupCfg = resolveBackupConfig(config);
  if (backupCfg.warn) {
    process.stderr.write(`backup-cli: WARN: memory.backup невалиден — применены дефолты (path=${backupCfg.path}, retention=${backupCfg.retention})\n`);
  }

  // effectiveKey — ТО ЖЕ резолв, что в registerMemoryHooks:
  // projectHash из root (deriveProjectKey: git remote → dir hash) + namespace.
  const projectKey = deriveProjectKey({ gitRemote: gitCfg.remote, absPath: root });
  const effectiveKey = resolveEffectiveKey({ projectHash: projectKey.hash, namespace: config.namespace ?? null });

  const log = cliLog(root);

  // list — storage не требует (чтение каталога бэкапов).
  if (action === "list") {
    const dir = resolveBackupDir(backupCfg.path, root);
    const rows = listBackups(dir, effectiveKey);
    if (!rows.length) {
      process.stdout.write(`бэкапов нет (каталог: ${dir})\n`);
      return 0;
    }
    const header = ["file", "ts", "size", "manifest"];
    const lines = rows.map((r) => [
      r.file,
      new Date(r.ts).toISOString(),
      `${r.size} B`,
      r.manifest_ok ? "ok" : "MISSING",
    ]);
    const widths = header.map((h, i) => Math.max(h.length, ...lines.map((l) => l[i].length)));
    const fmt = (cells) => cells.map((c, i) => c.padEnd(widths[i])).join("  ").trimEnd();
    process.stdout.write(`Бэкапы (key: ${effectiveKey}):\n`);
    process.stdout.write(fmt(header) + "\n");
    for (const l of lines) process.stdout.write(fmt(l) + "\n");
    return 0;
  }

  // Preflight (spec §5.1): v1 — только sqlite; понятная ошибка, без side-effects.
  if (config.storage.type !== "sqlite") {
    process.stderr.write(`backup-cli: v1 — только storage.type sqlite (сейчас: ${config.storage.type})\n`);
    return 1;
  }

  // Storage — ТО ЖЕ пути, что в registerMemoryHooks:
  // dataDir/defaultDataDir → moduleDir → dbPath (per-key sanitizeDirName).
  const dataDir = join(defaultDataDir(), "maestro");
  const moduleDir = config.module_dir ?? join(dataDir, "memory", "module");
  const dbPath = join(dataDir, "memory", sanitizeDirName(effectiveKey), "memory.db");
  // modelId/dim — ТО ЖЕ расчёт, что в registerMemoryHooks (openai vs local).
  const isOpenai = config.embedding.provider === "openai";
  const modelId = isOpenai
    ? `openai:${config.embedding.model}@${config.embedding.base_url}`
    : (config.embedding.model ?? config.embedding_model);
  const dim = isOpenai ? config.embedding.dim : 384;

  const storage = createStorage({
    type: config.storage.type,
    options: { dbPath, moduleDir },
    modelId,
    dim,
    textSearchConfig: resolveEffectiveTextConfig(config),
    log: log.logger,
  });
  mkdirSync(dirname(dbPath), { recursive: true });
  try {
    await storage.init();
  } catch (err) {
    // Actionable (I-1): полный путь БД + для restore — подсказка по повреждённой БД.
    process.stderr.write(`backup-cli: не удалось инициализировать storage (sqlite): ${err instanceof Error ? err.message : String(err)}\n`);
    process.stderr.write(`БД: ${dbPath}\n`);
    if (action === "restore") {
      process.stderr.write(`БД повреждена — переименуйте/удалите ${dbPath} (и ${dbPath}-wal, ${dbPath}-shm) и повторите restore.\n`);
    }
    return 1;
  }

  // maskPatterns — ТО ЖЕ confidential-наборы, что в registerMemoryHooks:
  // confidential = raw confidential.paths; artifacts = conf.paths + conf.builtin.
  const confidentialPaths = maestroJson?.confidential?.paths ?? [];
  const conf = loadConfidentialConfig(maestroJson);
  const maskPatterns = {
    confidential: confidentialPaths,
    artifacts: [...conf.paths, ...conf.builtin],
  };

  if (action === "backup") {
    const r = await runBackup({
      storage,
      backupCfg,
      effectiveKey,
      storageType: config.storage.type,
      modelId: storage.modelId,
      dim: storage.dim,
      pluginVersion: readPluginVersion(),
      maskPatterns,
      log,
      gitRoot: root,
    });
    process.stdout.write(`OK: ${r.file}\nзаписей: ${r.count}\n`);
    if (r.warn) process.stdout.write(`WARN: ${gitignoreWarnText(r.warn)}\n`);
    return 0;
  }

  // restore (parsed.file проверен до side-effects выше)
  // Нормализация симлинков (см. root выше): обе стороны path-guard в runRestore
  // в одном физическом дереве. Файла нет → исходный путь (ошибка проявится ниже).
  const file = safeRealpath(parsed.file);
  // ТTY-гейт --replace проверен выше; здесь — интерактивное подтверждение
  // (EOF без ответа → null → runRestore откажет, exit 1).
  const confirmNamespace = parsed.replace
    ? await askReplaceConfirm({ effectiveKey, input: process.stdin, output: process.stdout })
    : null;
  const r = await runRestore({
    storage,
    backupCfg,
    effectiveKey,
    storageType: config.storage.type,
    modelId: storage.modelId,
    dim: storage.dim,
    file,
    replace: parsed.replace,
    channel: "cli",
    isTty: Boolean(process.stdin.isTTY),
    confirmNamespace,
    maskPatterns,
    pluginVersion: readPluginVersion(),
    log,
    gitRoot: root,
  });
  process.stdout.write(`OK: restore (${r.mode}), записей: ${r.count}, перезаписано: ${r.overwritten}, добавлено: ${r.added}\n`);
  if (r.warn) process.stdout.write(`WARN: ${r.warn} (бэкап создан с другой версией плагина)\n`);
  return 0;
}

// Guard: main() только при прямом запуске файла (импорт — без side-effects).
// realpath с обеих сторон: плагин может лежать под симлинком (agpack/alias).
if (
  process.argv[1]
  && safeRealpath(process.argv[1]) === safeRealpath(fileURLToPath(import.meta.url))
) {
  main()
    .then((code) => process.exit(code ?? 0))
    .catch((e) => {
      process.stderr.write(`backup-cli: ${e instanceof Error ? e.message : String(e)}\n`);
      process.exit(1);
    });
}
