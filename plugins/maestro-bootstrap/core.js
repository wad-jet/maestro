/**
 * Maestro Bootstrap Plugin for OpenCode.ai — V2 port.
 *
 * Rôle: глобальный, не привязан к агенту. Скилл `maestro` вызывается через
 * команду `@maestro-init` в любой primary-сессии.
 *
 * Функции:
 *  - Логирование ключевых событий: ошибки/повторы сессий, пустой результат
 *    субагента, вызовы `task` (диспатч субагентов) — для observability.
 *  - Санитайзинг промптов `task` (Уровень 1 Security Review, Этап 2):
 *    маскирование чувствительных данных по правилам Context Sanitizer.
 *  - Merge guard: блокировка git merge/push в mainline без HITL-аппрува.
 *  - Confidential control: доступ к docs/confidential/** только trusted-сабагентам.
 *
 * Логирование: JSONL to `<project>/.maestro/logs/maestro-bootstrap-<date>.log`
 */

import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { classifyMemoryConfig } from "./memory/config.js";
import { SESSIONS as MEMORY_SERVICE_SESSIONS } from "./memory/summarize.js";
import { registerCommunicationHooks } from "./communication.js";
import { registerFeedbackReportHooks } from "./feedback-report.js";
import { detectGuardCommand, checkMergeMarker, resolveMergeGuardConf } from "./merge-guard.js";

const LOG_LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

// --- Git config (cached) ----------------------------------------------------

const gitConfigCache = new Map();

export function getGitConfig(root, exec = execSync) {
  const cached = gitConfigCache.get(root);
  if (cached !== undefined) return cached;
  let result = { name: null, remote: null };
  try {
    const out = exec("git config --list", {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    const lines = String(out ?? "").split("\n");
    for (const line of lines) {
      const eq = line.indexOf("=");
      if (eq === -1) continue;
      const key = line.slice(0, eq);
      const value = line.slice(eq + 1).trim();
      if (key === "user.name") result.name = value || null;
      else if (key === "remote.origin.url") result.remote = value || null;
    }
  } catch {
    /* fail-soft */
  }
  gitConfigCache.set(root, result);
  return result;
}

// --- Context Sanitizer ------------------------------------------------------

const RULE_NAMES = ["env_secret", "data_field", "env_file", "db_credential", "private_key", "auth_header"];

const DEFAULT_RULES = { env_secret: true, data_field: true, env_file: true, db_credential: true, private_key: true, auth_header: true };

const DEFAULT_SENSITIVE_FIELDS = [
  "amount", "currency", "salary", "price", "cost", "balance", "vat", "tax_amount", "iban", "bic",
  "account_number", "bank_account", "card_number", "cvv", "pan", "contract_id", "invoice_id", "payment_id",
  "total_amount", "net_amount", "gross_amount", "discount_amount",
  "phone", "email", "address", "first_name", "last_name", "full_name", "birth_date",
  "passport", "passport_number", "inn", "kpp", "ogrn", "snils", "ssn", "tax_id",
  "client_secret", "api_key", "secret_key", "auth_token", "access_key",
  "refresh_token", "id_token", "password", "secret",
  "article_code", "counterparty_id",
];

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const toCamel = (s) => s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());

function buildDataFieldsRegex(fields) {
  const alts = [];
  for (const f of fields) {
    alts.push(f);
    if (f.includes("_")) alts.push(toCamel(f));
  }
  const alt = alts.map(escapeRegex).join("|");
  return new RegExp(`\\b["']?(?:${alt})\\w*["']?\\s*:\\s*("[^"]*"|'[^']*'|\\d[\\d.,]*|[^\\s"'<>|,;]+)`, "gi");
}

const ENV_KEYWORDS = "SECRET|KEY|TOKEN|PASSWORD|CREDENTIAL|PASS|AUTH|DSN|CERT|SALT|SIGNATURE|NONCE";
const ENV_ASSIGN = new RegExp(`\\b[A-Za-z0-9_]*(?:${ENV_KEYWORDS})[A-Z0-9_]*\\s*=\\s*("[^"]*"|'[^']*'|[^\\s;]+)`, "gi");
const ENV_FILE = /(\.env(?:\.\w+)?)\b/g;

const DEFAULT_URI_SCHEMES = ["sftp", "postgres", "postgresql", "mysql", "mongodb", "redis", "amqp", "http", "https", "ssh", "ftp", "ftps", "ldap", "ldaps", "grpc", "clickhouse", "mssql", "cassandra"];
const CONN_PASSWORD = /\b(?:password|passwd|pwd)\s*=\s*("[^"]*"|'[^']*'|[^\s;]+)/gi;
const escapeScheme = (s) => escapeRegex(s);

function buildDbUriRegex(schemes) {
  const alt = schemes.map(escapeScheme).join("|");
  return new RegExp(`\\b(?:${alt}):\\/\\/(?:[^\\s/@:]+:)?[^\\s/@]+@[^\\s]+`, "gi");
}

const PRIVATE_KEY = /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY-----/gi;
const AUTH_HEADER = /\b(?:Authorization|X-API-Key|Proxy-Authorization|X-Auth-Token)["']?\s*:\s*["']?(?:Bearer\s+|Basic\s+|Token\s+)?[^\s,;]+/gi;
const SECRET_COLON = new RegExp(`\\b[A-Za-z0-9_]*(?:${ENV_KEYWORDS})\\s*:\\s*("[^"]*"|'[^']*'|[^\\s,;]+)`, "gi");
const JWT_TOKEN = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g;

/**
 * Sanitize a prompt string by masking sensitive data.
 * V2: pure function, no side effects.
 */
export function sanitize(prompt, opts = {}) {
  if (typeof prompt !== "string" || prompt.length === 0) {
    return { text: prompt ?? "", count: 0 };
  }
  const rules = { ...DEFAULT_RULES, ...(opts.rules ?? {}) };
  for (const name of opts.disabledRules ?? []) {
    if (name in rules) rules[name] = false;
  }
  const protect = new Set(opts.patterns ?? []);
  const fields = [...DEFAULT_SENSITIVE_FIELDS, ...(opts.extraFields ?? [])];
  const schemes = [...DEFAULT_URI_SCHEMES, ...(opts.extraUriSchemes ?? [])];
  const DATA_FIELDS = buildDataFieldsRegex(fields);
  const DB_URI = buildDbUriRegex(schemes);

  const isProtected = (fragment) => {
    for (const p of protect) {
      if (p && fragment.includes(p)) return true;
    }
    return false;
  };

  let text = prompt;
  let count = 0;
  const redact = (replacer) => {
    let seen = 0;
    text = text.replace(replacer, (match, ..._args) => {
      if (isProtected(match)) return match;
      seen += 1;
      return "<redacted>";
    });
    count += seen;
  };

  if (rules.env_secret) {
    text = text.replace(ENV_ASSIGN, (match) => {
      if (isProtected(match)) return match;
      const eq = match.indexOf("=");
      const name = match.slice(0, eq + 1);
      count += 1;
      return `${name}<redacted>`;
    });
  }

  if (rules.data_field) {
    text = text.replace(DATA_FIELDS, (match) => {
      if (isProtected(match)) return match;
      const colon = match.indexOf(":");
      const name = match.slice(0, colon + 1);
      count += 1;
      return `${name} <redacted>`;
    });
  }

  if (rules.env_file) redact(ENV_FILE);
  if (rules.db_credential) { redact(DB_URI); redact(CONN_PASSWORD); }
  if (rules.private_key) redact(PRIVATE_KEY);
  if (rules.auth_header) { redact(AUTH_HEADER); redact(JWT_TOKEN); }

  if (rules.env_secret) {
    text = text.replace(SECRET_COLON, (match) => {
      if (isProtected(match)) return match;
      const colon = match.indexOf(":");
      const name = match.slice(0, colon + 1);
      count += 1;
      return `${name} <redacted>`;
    });
  }

  return { text, count };
}

// --- Config -----------------------------------------------------------------

export function loadMaestroConfig(file, dir) {
  const resolved = file || process.env.MAESTRO_CONFIG || path.join(dir || process.cwd(), "maestro.json");
  try {
    return JSON.parse(fs.readFileSync(resolved, "utf8"));
  } catch {
    return {};
  }
}

export function resolveConfigFile(root) {
  return process.env.MAESTRO_CONFIG || path.join(root, "maestro.json");
}

export function loadWhitelist(config) {
  const section = config?.sanitizer_whitelist;
  return section && typeof section === "object" ? section : {};
}

export function validateWhitelist(section) {
  const warnings = [];
  const warn = (field, type) => warnings.push({ field, type });
  if (section === undefined || section === null) return { section: {}, warnings };
  if (typeof section !== "object" || Array.isArray(section)) {
    return { section: {}, warnings: [{ field: "sanitizer_whitelist", type: "not_object" }] };
  }
  const out = {};

  if (section.rules !== undefined) {
    if (section.rules !== null && typeof section.rules === "object" && !Array.isArray(section.rules)) {
      const rules = {};
      for (const [name, value] of Object.entries(section.rules)) {
        if (RULE_NAMES.includes(name) && typeof value === "boolean") rules[name] = value;
        else if (!RULE_NAMES.includes(name)) warn("rules", "unknown_key");
        else warn("rules", "not_boolean");
      }
      out.rules = rules;
    } else {
      warn("rules", "not_object");
    }
  }

  if (section.by_agent !== undefined) {
    if (section.by_agent !== null && typeof section.by_agent === "object" && !Array.isArray(section.by_agent)) {
      const byAgent = {};
      for (const [agent, names] of Object.entries(section.by_agent)) {
        if (!Array.isArray(names)) { warn("by_agent", "not_array"); continue; }
        const valid = [];
        for (const n of names) {
          if (typeof n === "string" && RULE_NAMES.includes(n)) valid.push(n);
          else warn("by_agent", "unknown_name");
        }
        byAgent[agent] = valid;
      }
      out.by_agent = byAgent;
    } else {
      warn("by_agent", "not_object");
    }
  }

  for (const field of ["allow_values", "extra_fields", "extra_uri_schemes"]) {
    const value = section[field];
    if (value === undefined) continue;
    if (!Array.isArray(value)) { warn(field, "not_array"); continue; }
    const valid = [];
    for (const item of value) {
      if (typeof item !== "string") { warn(field, "non_string"); }
      else if (item === "") { warn(field, "empty_string"); }
      else { valid.push(item); }
    }
    out[field] = valid;
  }

  if (Object.hasOwn(section, "patterns")) { warn("patterns", "deprecated_rename"); }

  return { section: out, warnings };
}

export function resolveSanitizeOptions(whitelist, agent) {
  const rules = { ...DEFAULT_RULES, ...(whitelist.rules ?? {}) };
  const disabledRules = [];
  const byAgent = whitelist.by_agent?.[agent];
  if (Array.isArray(byAgent)) {
    for (const name of byAgent) {
      if (name in rules) { rules[name] = false; disabledRules.push(name); }
    }
  }
  const patterns = Array.isArray(whitelist.allow_values) ? whitelist.allow_values : (Array.isArray(whitelist.patterns) ? whitelist.patterns : []);
  const extraFields = Array.isArray(whitelist.extra_fields) ? whitelist.extra_fields : [];
  const extraUriSchemes = Array.isArray(whitelist.extra_uri_schemes) ? whitelist.extra_uri_schemes : [];
  return { rules, disabledRules, patterns, extraFields, extraUriSchemes };
}

const SECRET_VALUE = /\b(?:sk(?:_live|_test)?_[A-Za-z0-9]+|AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]+|github_pat_[A-Za-z0-9_]+|xox[baprs]-[A-Za-z0-9-]+)\b|-----BEGIN[^-]*PRIVATE KEY-----|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/;

export function detectUnsafePatterns(whitelist) {
  const patterns = Array.isArray(whitelist?.allow_values) ? whitelist.allow_values : (Array.isArray(whitelist?.patterns) ? whitelist.patterns : []);
  return patterns.filter((p) => SECRET_VALUE.test(String(p)));
}

export function allRulesDisabled(opts) {
  if (!opts?.rules) return false;
  const defined = Object.values(opts.rules);
  return defined.length > 0 && defined.every((v) => v === false);
}

// --- Trust & Confidential ---------------------------------------------------

export function loadTrustConfig(config) {
  const trusted = new Set();
  for (const [name, value] of Object.entries(config?.trust ?? {})) {
    if (value === true) trusted.add(name);
  }
  return trusted;
}

const CONF_TRUSTED_ACTIONS = new Set(["allow", "deny"]);
const BUILTIN_CONFIDENTIAL_PATTERNS = [".env", ".env.*", "*.pem", "*.key", "*.crt", "*.p12", "*.pfx"];

export function loadConfidentialConfig(config) {
  const section = config?.confidential;
  const defaults = { paths: ["docs/confidential/**"], trusted: { read: "allow", write: "deny", edit: "deny" } };
  const builtin = [...BUILTIN_CONFIDENTIAL_PATTERNS];
  if (!section || typeof section !== "object") {
    return { exists: false, paths: defaults.paths, builtin, trusted: { ...defaults.trusted } };
  }
  const paths = Array.isArray(section.paths) && section.paths.length > 0 ? section.paths : defaults.paths;
  const trusted = {};
  const provided = section.trusted && typeof section.trusted === "object" ? section.trusted : {};
  for (const tool of ["read", "write", "edit"]) {
    trusted[tool] = !(tool in provided) ? defaults.trusted[tool] : (CONF_TRUSTED_ACTIONS.has(provided[tool]) ? provided[tool] : "deny");
  }
  return { exists: true, paths, builtin, trusted };
}

export function resolveConfidentialAction(conf, tool, isTrustedSubagent) {
  if (!isTrustedSubagent) return "deny";
  return conf?.trusted?.[tool] === "allow" ? "allow" : "deny";
}

function agentNameFromMessages(messages) {
  for (const m of messages ?? []) {
    const info = m?.info ?? {};
    if (typeof info.agent === "string" && info.agent) return info.agent;
    if (typeof info.mode === "string" && info.mode) return info.mode;
    for (const part of m?.parts ?? []) {
      if (part?.type === "agent" && typeof part.name === "string" && part.name) return part.name;
      if (part?.type === "subtask" && typeof part.agent === "string" && part.agent) return part.agent;
    }
  }
  return undefined;
}

export async function resolveIsTrustedSubagent(client, trustedAgents, sessionID) {
  if (!client?.session?.get) return { trusted: false, agent: undefined };
  let session;
  try {
    // V2: { sessionID } + session.context() (не messages)
    const resp = await client.session.get({ sessionID });
    session = resp?.data ?? resp;
  } catch {
    return { trusted: false, agent: undefined };
  }
  if (!session?.parentID) return { trusted: false, agent: undefined };
  try {
    // V2: session.context({ sessionID }) → readonly SessionMessageInfo[]
    const mresp = await client.session.context({ sessionID });
    const messages = Array.isArray(mresp) ? mresp : (mresp?.data ?? []);
    const agent = agentNameFromMessages(messages);
    return { trusted: Boolean(agent && trustedAgents.has(agent)), agent };
  } catch {
    return { trusted: false, agent: undefined };
  }
}

export function confGlobMatch(pattern, value) {
  if (typeof pattern !== "string" || !pattern) return false;
  if (typeof value !== "string" || !value) return false;
  const patSegs = pattern.split("/");
  const valSegs = value.split("/");

  const segRe = (seg) => {
    let out = "";
    let i = 0;
    while (i < seg.length) {
      const ch = seg[i];
      if (ch === "{") {
        const end = seg.indexOf("}", i);
        if (end !== -1) {
          const alts = seg.slice(i + 1, end).split(",").map((a) => a.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
          out += `(?:${alts.join("|")})`;
          i = end + 1; continue;
        }
      }
      if (ch === "*") out += "[^/]*";
      else if (ch === "?") out += "[^/]";
      else out += ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      i += 1;
    }
    return new RegExp(`^${out}$`);
  };

  const re = patSegs.map((s) => (s === "**" ? null : segRe(s)));
  const dp = Array.from({ length: patSegs.length + 1 }, () => Array(valSegs.length + 1).fill(false));
  dp[0][0] = true;
  for (let i = 1; i <= patSegs.length; i++) {
    if (patSegs[i - 1] === "**") dp[i][0] = dp[i - 1][0];
  }
  for (let i = 1; i <= patSegs.length; i++) {
    for (let j = 1; j <= valSegs.length; j++) {
      if (patSegs[i - 1] === "**") {
        dp[i][j] = dp[i - 1][j] || dp[i][j - 1];
      } else if (re[i - 1].test(valSegs[j - 1])) {
        dp[i][j] = dp[i - 1][j - 1];
      }
    }
  }
  return dp[patSegs.length][valSegs.length];
}

export function normalizeTarget(root, target) {
  if (typeof target !== "string" || !target) return "";
  const abs = path.isAbsolute(target) ? target : path.resolve(root, target);
  const rel = path.relative(root, abs);
  return rel.split(path.sep).join("/");
}

export function isPluginMetaFile(root, target) {
  const t = normalizeTarget(root, target);
  return t === ".maestro/plugin-version";
}

export function isConfidentialTarget(root, patterns, target) {
  const rel = normalizeTarget(root, target);
  if (!rel) return false;
  const lower = rel.toLowerCase();
  for (const p of patterns ?? []) {
    if (typeof p !== "string" || !p) continue;
    if (confGlobMatch(p.toLowerCase(), lower)) return true;
  }
  return false;
}

export function filePathOf(tool, args) {
  if (!args) return undefined;
  // V2: read/edit/write принимают path, не filePath
  if ((tool === "read" || tool === "write" || tool === "edit") && typeof args.path === "string") {
    return args.path;
  }
  return undefined;
}

export function loadCommunicationConfig(config) {
  const value = config && typeof config === "object" ? config.communication : undefined;
  const COMMUNICATION_MODES = new Set(["plain", "professional"]);
  if (value === undefined) return { mode: "plain", explicit: false, invalid: false };
  if (typeof value === "string" && COMMUNICATION_MODES.has(value)) {
    return { mode: value, explicit: true, invalid: false };
  }
  return { mode: "plain", explicit: false, invalid: true };
}

export function loadFeedbackReportConfig(config) {
  const value = config && typeof config === "object" ? config.feedback_report : undefined;
  const FEEDBACK_REPORT_MODES = new Set(["auto", "manual", "disable"]);
  if (value === undefined) return { mode: "manual", explicit: false, invalid: false };
  if (typeof value === "string" && FEEDBACK_REPORT_MODES.has(value)) {
    return { mode: value, explicit: true, invalid: false };
  }
  return { mode: "manual", explicit: false, invalid: true };
}

// --- Logger -----------------------------------------------------------------

export function makeLogger(directory, { filePrefix = "maestro-bootstrap", logDirEnv = "MAESTRO_BOOTSTRAP_LOG_DIR", filterEnv = "MAESTRO_BOOTSTRAP", logDir = null } = {}) {
  const dir = logDir || process.env[logDirEnv] || path.join(directory, ".maestro/logs");
  let enabled;
  let threshold = 10;
  let levelEnv = "debug";
  if (filterEnv !== null) {
    const levelKey = `${filterEnv}_LOG_LEVEL`;
    levelEnv = process.env[levelKey] || "info";
    threshold = LOG_LEVELS[levelEnv] ?? 10;
    const maskKey = `${filterEnv}_LOG_MASK`;
    const maskEnv = process.env[maskKey];
    enabled = new Set(
      maskEnv
        ? maskEnv.split(",").map((s) => s.trim()).filter(Boolean).filter((l) => l in LOG_LEVELS)
        : Object.keys(LOG_LEVELS).filter((l) => LOG_LEVELS[l] >= threshold),
    );
  } else {
    enabled = new Set(Object.keys(LOG_LEVELS));
  }

  try { fs.mkdirSync(dir, { recursive: true }); } catch { /* logging must never break the session */ }

  const logFileFor = (date) => path.join(dir, `${filePrefix}-${date}.log`);

  const write = (level, msg, extra) => {
    if (!enabled.has(level)) return;
    if (filterEnv !== null && LOG_LEVELS[level] < threshold) return;
    const now = new Date();
    const date = now.toISOString().slice(0, 10);
    const entry = JSON.stringify({ ts: now.toISOString(), level, msg, ...extra });
    try { fs.appendFileSync(logFileFor(date), entry + "\n"); }
    catch (err) {
      if (filePrefix === "maestro-audit") {
        console.error("[maestro-bootstrap] audit write failed:", err instanceof Error ? err.message : err);
      }
    }
  };

  return {
    logDir: dir, filePrefix, level: levelEnv,
    mask: filterEnv === null ? "all" : [...enabled].join(","),
    debug: (msg, extra) => write("debug", msg, extra),
    info: (msg, extra) => write("info", msg, extra),
    warn: (msg, extra) => write("warn", msg, extra),
    error: (msg, extra) => write("error", msg, extra),
  };
}

export function makeBoundedMap(max = 1024) {
  const m = new Map();
  return {
    get: (k) => m.get(k),
    set: (k, v) => {
      if (!m.has(k) && m.size >= max) {
        const oldest = m.keys().next().value;
        if (oldest !== undefined) m.delete(oldest);
      }
      return m.set(k, v);
    },
    delete: (k) => m.delete(k),
    size: () => m.size,
    clear: () => m.clear(),
  };
}

// --- Version ----------------------------------------------------------------

export function readPluginVersion() {
  try {
    const pkgPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../package.json");
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
    return typeof pkg.version === "string" && pkg.version ? pkg.version : undefined;
  } catch { return undefined; }
}

export function writePluginVersionFile(dir, version) {
  if (typeof version !== "string" || !version) return;
  try {
    fs.mkdirSync(path.join(dir, ".maestro"), { recursive: true });
    fs.writeFileSync(path.join(dir, ".maestro/plugin-version"), version + "\n", "utf8");
  } catch { /* best-effort */ }
}

// --- Maestro config tool ----------------------------------------------------

export function makeMaestroConfigTool({ client, root, log }) {
  const guardCache = makeBoundedMap(1024);
  const SESSIONS = MEMORY_SERVICE_SESSIONS;

  const guard = async (sessionID) => {
    if (!sessionID) return "session_unavailable";
    if (SESSIONS.has(sessionID)) return "service_session";
    const cached = guardCache.get(sessionID);
    if (cached !== undefined) return cached;
    let reason;
    // Пробуем session.get. Если метод отсутствует (V2) — ловим TypeError и
    // сразу переходим к fallback. Если метод есть, но бросает — это скорее
    // "сессия не найдена", а не "API недоступен" → deny (fail-closed).
    let sessionData;
    let getUnavail = false;
    try {
      // V2: { sessionID } format
      const resp = await client?.session?.get?.({ sessionID });
      sessionData = resp?.data ?? resp;
    } catch (err) {
      const msg = err?.message ?? String(err);
      // TypeError: "client.session.get is not a function" — V2, API недоступен
      // → переходим к fallback на session.context
      if (err instanceof TypeError && msg.includes("get") && msg.includes("function")) {
        getUnavail = true;
      } else {
        // Неизвестная сессия / другой error — deny
        reason = "session_unavailable";
      }
    }
    if (reason === undefined) {
      if (!sessionData && getUnavail) {
        // V2 fallback: session.get недоступен (не существует в рантайме).
        // Пробуем session.context — если сессия существует, контекст вернётся.
        // primary-сессия: контекст не пустой (user-сообщения);
        // task-сессия: тоже не пустой, но мы не можем отличить без parentID
        // → допускаем (fail-open для недоступного API, fail-closed для отсутствия API).
        if (typeof client?.session?.context === "function") {
          try {
            const ctxResp = await client.session.context({ sessionID });
            const messages = Array.isArray(ctxResp) ? ctxResp : (ctxResp?.data ?? []);
            // Сессия существует (контекст вернулся) — допускаем вызов.
            reason = null;
          } catch {
            reason = "session_unavailable";
          }
        } else {
          reason = "session_unavailable";
        }
      } else if (!sessionData) {
        // get вернул undefined/null — fallback
        if (typeof client?.session?.context === "function") {
          try {
            const ctxResp = await client.session.context({ sessionID });
            const messages = Array.isArray(ctxResp) ? ctxResp : (ctxResp?.data ?? []);
            reason = null;
          } catch {
            reason = "session_unavailable";
          }
        } else {
          reason = "session_unavailable";
        }
      } else if (sessionData.parentID) reason = "task_session";
      else if (typeof sessionData.title === "string" && sessionData.title.startsWith("[maestro-memory]")) reason = "service_session";
      else reason = null;
    }
    guardCache.set(sessionID, reason);
    return reason;
  };

  const deny = (sessionID, reason) => {
    log?.info?.("maestro_config:access_denied", { sessionID, reason });
    return { content: [{ type: "text", text: "maestro_config: the tool is only available in top-level primary sessions" }] };
  };

  return {
    name: "maestro_config",
    description: "Read-only access to the maestro config file (maestro.json) — the sanctioned channel for reading maestro config parameters within a session. Argument section — dot-path to a section (e.g. memory, communication, sanitizer_whitelist); no argument — the whole config.",
    input: {
      type: "object",
      properties: {
        section: { type: "string", description: "Dot-path to a section (memory, memory.embedding.model, …); no argument — the whole config" },
      },
      additionalProperties: false,
    },
    execute: async (args, ctx) => {
      const sessionID = ctx?.sessionID;
      const reason = await guard(sessionID);
      if (reason) return deny(sessionID, reason);
      const section = args?.section;
      const file = resolveConfigFile(root);
      if (!fs.existsSync(file)) {
        log?.info?.("maestro_config:read", { sessionID, section: section ?? null, result: "file_missing" });
        return { content: [{ type: "text", text: JSON.stringify({ exists: false, config: {}, path: file }) }] };
      }
      let config;
      try { config = JSON.parse(fs.readFileSync(file, "utf8")); }
      catch {
        log?.info?.("maestro_config:read", { sessionID, section: section ?? null, result: "parse_error" });
        return { content: [{ type: "text", text: JSON.stringify({ exists: true, config: {}, parse_error: true, path: file }) }] };
      }
      if (section === undefined || section === null) {
        log?.info?.("maestro_config:read", { sessionID, section: null, result: "ok" });
        return { content: [{ type: "text", text: JSON.stringify({ exists: true, config, path: file }) }] };
      }
      if (typeof section !== "string" || section.startsWith(".") || section.endsWith(".") || section.split(".").some((seg) => seg.length === 0)) {
        return { content: [{ type: "text", text: `maestro_config: invalid section "${String(section)}" (dot-path, non-empty segments, no leading/trailing dots)` }] };
      }
      let value = config;
      for (const seg of section.split(".")) {
        if (value !== null && typeof value === "object" && Object.hasOwn(value, seg)) {
          value = value[seg];
        } else {
          log?.info?.("maestro_config:read", { sessionID, section, result: "section_missing" });
          return { content: [{ type: "text", text: JSON.stringify({ exists: true, config: null, section_found: false, path: file }) }] };
        }
      }
      log?.info?.("maestro_config:read", { sessionID, section, result: "ok" });
      return { content: [{ type: "text", text: JSON.stringify({ exists: true, config: value, section_found: true, path: file }) }] };
    },
  };
}

// --- V2 Plugin Factory ------------------------------------------------------

/**
 * V2 plugin factory. Called once from setup(ctx).
 * Returns a cleanup function.
 */
export async function createBootstrapPlugin(ctx) {
  const root = ctx.location.directory || process.cwd();
  // Test-seam: инъектируемая реализация маскирования (тесты fail-closed D2).
  const sanitizeFn = typeof ctx?.sanitizeImpl === "function" ? ctx.sanitizeImpl : sanitize;
  const version = readPluginVersion();
  const log = makeLogger(root);
  const auditLog = makeLogger(root, {
    filePrefix: "maestro-audit",
    logDirEnv: "MAESTRO_AUDIT_LOG_DIR",
    filterEnv: null,
  });
  const memoryLog = makeLogger(root, {
    logDir: process.env.MAESTRO_MEMORY_LOG_DIR || log.logDir,
    filePrefix: "maestro-memory",
    filterEnv: "MAESTRO_MEMORY",
  });

  // V2 detection: session.context — маркер V2 API.
  // Если отсутствует — warning, НЕ error (целевое приложение может быть на V1).
  // Plugin continues but some features may not work.
  const isV2 = typeof ctx?.session?.context === "function";
  if (!isV2) {
    const msg = "[maestro-bootstrap] Warning: OpenCode V2 runtime required for full functionality. " +
      "session.context not available — some features may not work.";
    log.warn("v2_runtime_not_available", { warning: msg });
  }

  const config = loadMaestroConfig(undefined, root);
  const validatedWhitelist = validateWhitelist(loadWhitelist(config));
  const whitelist = validatedWhitelist.section;
  if (validatedWhitelist.warnings.length > 0) {
    log.warn("sanitizer.invalid_config", { fields: validatedWhitelist.warnings.map((w) => w.field), count: validatedWhitelist.warnings.length });
  }
  const confidential = loadConfidentialConfig(config);
  const mergeGuardConf = resolveMergeGuardConf(config);
  if (!mergeGuardConf.enabled) {
    log.warn("merge_guard.disabled", { sessionID: undefined });
  }
  const trustedAgents = loadTrustConfig(config);
  const unsafePatterns = detectUnsafePatterns(whitelist);
  if (unsafePatterns.length > 0) {
    log.warn("sanitizer.unsafe_patterns", { count: unsafePatterns.length });
  }
  writePluginVersionFile(root, version);

  log.info("plugin initialized", { version, logDir: log.logDir, level: log.level, mask: log.mask });

  const toolCalls = makeBoundedMap(2048);
  const sessionTrustCache = makeBoundedMap(2048);

  // --- Memory module (optional) ---
  const memClass = classifyMemoryConfig(config, { gitName: getGitConfig(root).name });
  let memoryDispose = () => {};
  if (memClass.enabled) {
    try {
      const { registerMemoryHooks } = await import("./memory/index.js");
      const memResult = await registerMemoryHooks({
        client: ctx,  // V2: ctx IS the client
        config, log, memoryLog, root,
      });
      memoryDispose = memResult.dispose || (() => {});
    } catch (err) {
      log.error("memory: init failed", { error: err instanceof Error ? err.message : String(err) });
    }
  } else if (config?.memory && memClass.disabled_reason) {
    log.info("memory: disabled", { reason: memClass.disabled_reason });
  }

  // --- Communication hooks ---
  let commDispose = () => {};
  try {
    const commResult = await registerCommunicationHooks({ client: ctx, config, log });
    commDispose = commResult.dispose || (() => {});
  } catch (err) {
    log.error("communication: init failed", { error: err instanceof Error ? err.message : String(err) });
  }

  // --- Feedback report hooks ---
  let fbDispose = () => {};
  try {
    const fbResult = await registerFeedbackReportHooks({ client: ctx, config, log });
    fbDispose = fbResult.dispose || (() => {});
  } catch (err) {
    log.error("feedback_report: init failed", { error: err instanceof Error ? err.message : String(err) });
  }

  // --- Event subscription ---
  const eventController = new AbortController();
  void (async () => {
    try {
      for await (const event of ctx.event.subscribe({ signal: eventController.signal })) {
        try {
          const { type, properties } = event?.data ?? event ?? {};
          const sessionID = properties?.sessionID;
          if (type === "session.error") {
            const err = properties?.error;
            let errorType = null, errorMessage = null, aborted = false;
            if (err && typeof err === "object") {
              errorType = err.name ?? err.type ?? null;
              errorMessage = err.data?.message ?? err.message ?? null;
              aborted = err.name === "MessageAbortedError" || err.type === "message_aborted";
            } else if (typeof err === "string") {
              errorType = "Error";
              errorMessage = err;
            }
            log.warn("session.error", { sessionID, errorType, errorMessage, aborted });
          } else if (type === "session.status" && properties?.status?.type === "retry") {
            log.warn("session.status.retry", { sessionID, attempt: properties.status.attempt, message: properties.status.message });
          }
        } catch {
          log.error("event: error", { error: "failed to process event" });
        }
      }
    } catch { /* subscribe ends when signal is aborted */ }
  })();

  // --- Tool hook: execute.before ---
  // V2: event.input (не output), tool names: shell/subagent (не bash/task)
  const beforeRegistration = await ctx.tool.hook("execute.before", async (event) => {
    try {
      const input = event;
      if (!input || typeof input !== "object") return;

      // Merge guard
      // V2: tool = "shell" (не "bash"), аргументы в event.input (не output)
      if (input.tool === "shell" && mergeGuardConf.enabled) {
        const detected = detectGuardCommand(typeof event.input?.command === "string" ? event.input.command : "");
        if (detected) {
          const kind = detected.kind;
          const res = checkMergeMarker(root, input.sessionID, Date.now(), mergeGuardConf);
          const base = { sessionID: input.sessionID, callID: input.callID, kind, reason: res.reason };
          if (res.allow) {
            log.info("merge_guard", { action: "allow", ...base });
          } else {
            log.warn("merge_guard", { action: "deny", ...base });
            const err = new Error(
              `[merge-guard:deny] git ${kind === "merge" ? "merge" : "push (mainline)"} заблокирован: ` +
              `нет явного HITL-аппрува гейта 17. Обсуди с пользователем гейт 17, после явного (a) создай маркер и повтори.`
            );
            err.mergeGuard = true;
            throw err;
          }
        }
      }

      // Confidential control
      const CONF_TOOLS = new Set(["read", "write", "edit"]);
      if (CONF_TOOLS.has(input.tool)) {
        // V2: аргументы тула в event.input, path (не filePath)
        const target = filePathOf(input.tool, event.input);
        const isConfTarget = target && !isPluginMetaFile(root, target) &&
          ((confidential.exists && isConfidentialTarget(root, confidential.paths, target)) ||
           isConfidentialTarget(root, confidential.builtin, target));
        if (isConfTarget) {
          let trustInfo = sessionTrustCache.get(input.sessionID);
          if (trustInfo === undefined) {
            trustInfo = await resolveIsTrustedSubagent(ctx, trustedAgents, input.sessionID);
            sessionTrustCache.set(input.sessionID, trustInfo);
          }
          const action = resolveConfidentialAction(confidential, input.tool, trustInfo.trusted);
          const base = { sessionID: input.sessionID, callID: input.callID, tool: input.tool, action, agent: trustInfo.agent, target: path.basename(target) };
          if (action === "allow") {
            auditLog.info("confidential.access", base);
          } else {
            auditLog.warn("confidential.access", base);
            const err = new Error(`[confidential:deny] Доступ к "${target}" запрещён. Доступ к confidential-путям разрешён только trusted-субагентам.`);
            err.confidential = true;
            throw err;
          }
        }
      }

      // Sanitize subagent prompt
      // V2: tool = "subagent" (не "task"), промпт в event.input.prompt
      if (input.tool === "subagent" && event.input?.prompt) {
        const agent = event.input.subagent_type || event.input.model || "unknown";
        if (!trustedAgents.has(agent)) {
          const opts = resolveSanitizeOptions(whitelist, agent);
          if (allRulesDisabled(opts)) {
            log.warn("sanitizer.all_rules_disabled", { sessionID: input.sessionID, callID: input.callID, tool: input.tool, agent });
          }
          try {
            const res = sanitizeFn(event.input.prompt, opts);
            if (res.count > 0) {
              event.input.prompt = res.text;
              log.warn("sanitizer.redacted", { sessionID: input.sessionID, callID: input.callID, tool: input.tool, agent, redacted: res.count });
            }
          } catch (cause) {
            auditLog.warn("sanitizer.failed", { sessionID: input.sessionID, callID: input.callID, tool: input.tool, agent });
            const err = new Error(
              `[sanitizer:failed] Маскирование не выполнено — диспатч в ${agent} заблокирован. ` +
                `Проверьте sanitizer_whitelist в maestro.json`,
            );
            err.sanitizerFailed = true;
            err.cause = cause;
            throw err;
          }
        }
      }

      // Log subagent dispatch
      if (input.tool === "subagent") {
        toolCalls.set(input.callID, Date.now());
        log.info("tool.execute.before", { sessionID: input.sessionID, callID: input.callID, tool: input.tool });
      }
    } catch (err) {
      if (err?.confidential || err?.sanitizerFailed || err?.mergeGuard) throw err;
      log.error("tool.execute.before: error", { sessionID: input?.sessionID, error: err instanceof Error ? err.message : String(err) });
    }
  });

  // --- Tool hook: execute.after ---
  // V2: event.status/result/error (не output), tool = shell/subagent
  const afterRegistration = await ctx.tool.hook("execute.after", async (event) => {
    try {
      const input = event;
      if (!input || typeof input !== "object") return;

      const startedAt = input.tool === "subagent" ? toolCalls.get(input.callID) : undefined;
      if (startedAt !== undefined) toolCalls.delete(input.callID);

      const extra = { sessionID: input.sessionID, callID: input.callID, tool: input.tool };
      if (startedAt !== undefined) extra.durationMs = Date.now() - startedAt;

      // V2: result может содержать title; fallback на input
      const outputTitle = event.result?.title ?? event.output?.title;
      if (outputTitle) {
        const agent = input.args?.subagent_type ?? input.args?.model ?? "unknown";
        const opts = resolveSanitizeOptions(whitelist, agent);
        try {
          extra.title = sanitizeFn(String(outputTitle), opts).text;
        } catch {
          extra.title = "<unavailable>";
        }
      }

      // V2: проверяем пустой результат через event.status или event.result
      const isEmptySubagentResult = input.tool === "subagent" &&
        (!event?.result?.title && !event?.result?.output) &&
        (!event?.result?.metadata || Object.keys(event.result.metadata).length === 0);
      if (isEmptySubagentResult) {
        log.warn("tool.execute.after.empty_result", { sessionID: input.sessionID, callID: input.callID, tool: input.tool });
      }
      if (startedAt !== undefined) {
        log.info("tool.execute.after", extra);
      }
    } catch (err) {
      log.error("tool.execute.after: error", { sessionID: input?.sessionID, error: err instanceof Error ? err.message : String(err) });
    }
  });

  // --- Tool transform: custom tools ---
  const toolTransformRegistration = await ctx.tool.transform((editor) => {
    // Register memory tools (delegated to memory module, but register maestro_config here)
    editor.add(makeMaestroConfigTool({ client: ctx, root, log }));
  });

  // --- Cleanup ---
  return () => {
    eventController.abort();
    beforeRegistration?.dispose?.();
    afterRegistration?.dispose?.();
    toolTransformRegistration?.dispose?.();
    memoryDispose();
    commDispose();
    fbDispose();
    log.info("plugin disposing", {});
  };
}
