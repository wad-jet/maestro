/**
 * Maestro Bootstrap Plugin for OpenCode.ai
 *
 * Rôle (после ухода от агента `maestro`, 2026-08-18): глобальный, не привязан
 * к агенту. Скилл `maestro` вызывается через команду `@maestro` в любой
 * primary-сессии; инжекция директивы в сессии агента удалена.
 *
 * Функции:
 *  - Логирование ключевых событий: ошибки/повторы сессий, пустой результат
 *    субагента, вызовы `task` (диспатч субагентов) — для observability.
 *  - Санитайзинг промптов `task` (Уровень 1 Security Review, Этап 2):
 *    маскирование чувствительных данных по правилам Context Sanitizer.
 *
 * Логирование: JSONL to `<project>/.maestro/logs/maestro-bootstrap-<date>.log`
 * (gitignored), one file per day. Levels: debug / info / warn / error.
 * Config via env:
 *   MAESTRO_BOOTSTRAP_LOG_LEVEL  (default: info)
 *   MAESTRO_BOOTSTRAP_LOG_MASK   (default: derived from LOG_LEVEL)
 *   MAESTRO_BOOTSTRAP_LOG_DIR    (default: <directory>/.maestro)
 *   MAESTRO_CONFIG               (path to maestro.json — consolidated config)
 */

import fs from "node:fs";
import path from "node:path";

const LOG_LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

// --- Context Sanitizer (Уровень 1) -----------------------------------------

// Категории правил детекта чувствительных данных.
const RULE_NAMES = [
  "env_secret", "data_field", "env_file", "db_credential",
  "ledger_entry", "private_key", "auth_header",
];

const DEFAULT_RULES = {
  env_secret: true,
  data_field: true,
  env_file: true,
  db_credential: true,
  ledger_entry: true,
  private_key: true,
  auth_header: true,
};

// --- Поля данных (для rule `data_field`) -----------------------------------

// Чувствительные поля данных по умолчанию (base-формы). Из них строится
// динамический regex (см. buildDataFieldsRegex). Проект может дополнить через
// `extra_fields` в sanitizer-whitelist.json.
const DEFAULT_SENSITIVE_FIELDS = [
  // Финансовые
  "amount", "currency", "salary", "price", "cost", "balance",
  "vat", "tax_amount", "iban", "bic", "account_number",
  "bank_account", "card_number", "cvv", "pan",
  "contract_id", "invoice_id", "payment_id",
  // Распространённые префиксы сумм (totalAmount/netAmount ловит Ур.2-LLM)
  "total_amount", "net_amount", "gross_amount", "discount_amount",
  // PII (перс./налоговые)
  "phone", "email", "address", "first_name", "last_name",
  "full_name", "birth_date", "passport", "passport_number",
  "inn", "kpp", "ogrn", "snils", "ssn", "tax_id",
  // Секреты / credentials (для `"key": value` / `key: value` — SEC-1b)
  "client_secret", "api_key", "secret_key", "auth_token", "access_key",
  "refresh_token", "id_token", "password", "secret",
  // Бизнес-поля (существующие)
  "article_code", "counterparty_id",
];

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// camelCase-вариант snake_case поля: `card_number` → `cardNumber`,
// `counterparty_id` → `counterpartyId`. Ловит `CardNumber` и т.п.
const toCamel = (s) => s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());

/**
 * Build the `data_field` regex from a list of field names.
 * Для каждого имени добавляется camelCase-вариант (`card_number` → `cardNumber`)
 * и `\w*`-суффикс для `amountValue`/`amount_value`. `i`-флаг — регистронезависимо.
 * @param {string[]} fields  Field names.
 * @returns {RegExp}
 */
function buildDataFieldsRegex(fields) {
  const alts = [];
  for (const f of fields) {
    alts.push(f);
    if (f.includes("_")) alts.push(toCamel(f));
  }
  const alt = alts.map(escapeRegex).join("|");
  // \b перед именем (start/после "_"/кавычки/non-word), `\w*` после — суффиксы.
  return new RegExp(
    `\\b["']?(?:${alt})\\w*["']?\\s*:\\s*("[^"]*"|'[^']*'|\\d[\\d.,]*)`,
    "gi",
  );
}

// --- Secrets из окружения (rule `env_secret`) ------------------------------

// Строки вида NAME=value для секретных переменных окружения. `i`-флаг ловит
// lowercase/camelCase: `apiKey=`, `api_key=`, `dbPassword=`. Keywords —
// как UPPER, так и любой регистр. False positives возможны (substring `key`
// в `keyword`), но для security-инструмента безопаснее лишний раз замаскировать.
const ENV_KEYWORDS =
  "SECRET|KEY|TOKEN|PASSWORD|CREDENTIAL|PASS|AUTH|DSN|CERT|SALT|SIGNATURE|NONCE";
// Префикс должен быть optional/backtrackable (может быть пустым), иначе keyword
// в начале имени (`TOKEN=`, `KEY=`, `SECRET=` и т.п.) не маскируется — жадный
// `[A-Z]` съедал его начало (SEC-1). `[A-Za-z0-9_]*` ловит и camelCase
// (`apiKey=`, `dbPassword=`) и snake_case (`API_KEY=`, `POSTGRES_PASSWORD=`).
const ENV_ASSIGN = new RegExp(
  `\\b[A-Za-z0-9_]*(?:${ENV_KEYWORDS})[A-Z0-9_]*\\s*=\\s*("[^"]*"|'[^']*'|[^\\s;]+)`,
  "gi",
);

// .env файлы (без \b перед точкой — '.' не word-символ).
const ENV_FILE = /(\.env(?:\.\w+)?)\b/g;

// --- DB/SFTP credentials (rule `db_credential`) ----------------------------

// Схемы URI с встроенными credentials: scheme://user:pass@host.
const DEFAULT_URI_SCHEMES = [
  "sftp", "postgres", "postgresql", "mysql", "mongodb", "redis", "amqp",
  "http", "https", "ssh", "ftp", "ftps", "ldap", "ldaps", "grpc",
  "clickhouse", "mssql", "cassandra",
];

// Connection string (key=value) с паролем: host=db password=secret.
const CONN_PASSWORD = /\b(?:password|passwd|pwd)\s*=\s*("[^"]*"|'[^']*'|[^\s;]+)/gi;

const escapeScheme = (s) => s.replace(/\?/g, "\\?");

/**
 * Build the `db_credential` URI regex from a list of schemes.
 * @param {string[]} schemes  URI schemes.
 * @returns {RegExp}
 */
function buildDbUriRegex(schemes) {
  const alt = schemes.map(escapeScheme).join("|");
  // `i`-флаг — схемы регистронезависимо: `POSTGRES://`, `Postgres://`, `sftp://`.
  // Username опционален: ловит и `user:pass@`, и анонимный `:pass@` (SEC-1b).
  return new RegExp(
    `\\b(?:${alt}):\\/\\/(?:[^\\s/@:]+:)?[^\\s/@]+@[^\\s]+`,
    "gi",
  );
}

// --- Private keys (rule `private_key`) -------------------------------------

// PEM-блоки: -----BEGIN <type> PRIVATE KEY----- ... -----END ...-----.
// `i`-флаг — регистронезависимо (BEGIN/PRIVATE KEY в любом регистре).
const PRIVATE_KEY =
  /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/gi;

// --- Auth headers (rule `auth_header`) -------------------------------------

// Authorization / X-API-Key и т.п.: Bearer/Basic токены.
const AUTH_HEADER =
  /\b(?:Authorization|X-API-Key|Proxy-Authorization|X-Auth-Token)\s*:\s*(?:Bearer\s+|Basic\s+|Token\s+)?[^\s,;]+/gi;

// --- Colon-separated secrets (SEC-1b) --------------------------------------

// `password: value`, `token: x`, `API_KEY: value`, `client_secret: value` —
// config-стиль (двоеточие, не `=`). Префикс опционален (`[A-Za-z0-9_]*`), чтобы
// ловить `API_KEY:` и т.п.
const SECRET_COLON = new RegExp(
  `\\b[A-Za-z0-9_]*(?:${ENV_KEYWORDS})\\s*:\\s*("[^"]*"|'[^']*'|[^\\s,;]+)`,
  "gi",
);

// --- JWT (SEC-1b) ----------------------------------------------------------

// Одиночный JWT вне Authorization-заголовка: header.payload.signature (base64url).
const JWT_TOKEN =
  /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g;

// --- URI с паролем без user (SEC-1b, redis://:pass@host) ------------------

// `scheme://:password@host` — анонимный user. Ловится buildDbUriRegex (user опционален).

// Ledger-проводки покрываются rule `data_field` (те же поля) — отдельная
// обработка не нужна; `ledger_entry` оставлен как маркер (no-op).

/**
 * Sanitize a prompt string by masking sensitive data (Context Sanitizer rules).
 *
 * @param {string} prompt  Text to sanitize.
 * @param {object} [opts]
 * @param {object} [opts.rules]  Enable/disable rule categories (bool per name).
 * @param {string[]} [opts.disabledRules]  Rule names to disable (convenience).
 * @param {string[]} [opts.patterns]  Specific literal values to never treat as
 *   sensitive (whitelist patterns). Substrings matched literally are kept intact.
 * @param {string[]} [opts.extraFields]  Extra sensitive field names (data_field).
 * @param {string[]} [opts.extraUriSchemes]  Extra URI schemes (db_credential).
 * @returns {{ text: string, count: number }}  Sanitized text + number of redactions.
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

  // Функция «замаскировать» с защитой whitelist-паттернов: если найденный
  // фрагмент содержит whitelist-паттерн целиком, не трогаем.
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
    // Маскируем значения в присваиваниях, сохраняя имя переменной.
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

  if (rules.env_file) {
    redact(ENV_FILE);
  }

  if (rules.db_credential) {
    redact(DB_URI);
    redact(CONN_PASSWORD);
  }

  if (rules.private_key) {
    redact(PRIVATE_KEY);
  }

  if (rules.auth_header) {
    redact(AUTH_HEADER);
    redact(JWT_TOKEN); // standalone JWT вне заголовка (SEC-1b)
  }

  // Colon-стиль `key: value` — ПОСЛЕ структурных правил (private_key, auth_header,
  // db_credential), чтобы SECRET_COLON не съедал `-----BEGIN`, `Bearer` и т.п.
  if (rules.env_secret) {
    text = text.replace(SECRET_COLON, (match) => {
      if (isProtected(match)) return match;
      const colon = match.indexOf(":");
      const name = match.slice(0, colon + 1);
      count += 1;
      return `${name} <redacted>`;
    });
  }

  // `ledger_entry` — маркер: проводки покрываются rule `data_field` (те же
  // поля). Если data_field выключен — отдельно не маскируем (no-op).

  return { text, count };
}

// --- Consolidated config (maestro.json) ------------------------------------

/**
 * Load the maestro config from `maestro.json` (корень проекта) — единственный
 * источник конфигурации. Sections: `trust`, `access_policy`, `sanitizer_whitelist`.
 * @param {string} [file]  Explicit path. Defaults to MAESTRO_CONFIG env
 *   or `<dir>/maestro.json`.
 * @param {string} [dir]   Project directory.
 * @returns {object}  Parsed config (empty object if file missing/unreadable).
 */
export function loadMaestroConfig(file, dir) {
  const resolved =
    file || process.env.MAESTRO_CONFIG ||
    path.join(dir || process.cwd(), "maestro.json");
  try {
    return JSON.parse(fs.readFileSync(resolved, "utf8"));
  } catch {
    return {};
  }
}

/**
 * Extract the sanitizer whitelist from a parsed maestro config.
 * @param {object} config  Parsed `maestro.json` (from loadMaestroConfig).
 * @returns {{ rules?: object, by_agent?: object, patterns?: string[],
 *   extra_fields?: string[], extra_uri_schemes?: string[] }}
 */
export function loadWhitelist(config) {
  const section = config?.sanitizer_whitelist;
  return section && typeof section === "object" ? section : {};
}

/**
 * Resolve effective options for a subagent: rules (respect by_agent) + patterns.
 * @param {object} whitelist  Parsed whitelist.
 * @param {string} agent      Subagent name (from task args).
 * @returns {{ rules: object, disabledRules: string[], patterns: string[],
 *   extraFields: string[], extraUriSchemes: string[] }}
 */
export function resolveSanitizeOptions(whitelist, agent) {
  const rules = { ...DEFAULT_RULES, ...(whitelist.rules ?? {}) };
  const disabledRules = [];
  const byAgent = whitelist.by_agent?.[agent];
  if (Array.isArray(byAgent)) {
    for (const name of byAgent) {
      if (name in rules) {
        rules[name] = false;
        disabledRules.push(name);
      }
    }
  }
  const patterns = Array.isArray(whitelist.patterns) ? whitelist.patterns : [];
  const extraFields = Array.isArray(whitelist.extra_fields) ? whitelist.extra_fields : [];
  const extraUriSchemes = Array.isArray(whitelist.extra_uri_schemes) ? whitelist.extra_uri_schemes : [];
  return { rules, disabledRules, patterns, extraFields, extraUriSchemes };
}

/**
 * SEC-6: выявить whitelist-`patterns`, которые сами матчатся safety-правилами.
 * Оператор мог случайно занести реальный секрет в `patterns` — тогда он будет
 * исключён из ВСЕХ правил (footgun).
 * @param {object} whitelist  Parsed whitelist.
 * @returns {string[]}  Опасные значения (сами НЕ логируются — могут быть секретами).
 */

// Значения, которые выглядят как реальные секреты (вне контекста key=value).
// Используется для SEC-6-детекта footgun-паттернов в whitelist-`patterns`.
const SECRET_VALUE =
  /\b(?:sk(?:_live|_test)?_[A-Za-z0-9]+|AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]+|github_pat_[A-Za-z0-9_]+|xox[baprs]-[A-Za-z0-9-]+)\b|-----BEGIN[^-]*PRIVATE KEY-----|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/;

export function detectUnsafePatterns(whitelist) {
  const patterns = Array.isArray(whitelist?.patterns) ? whitelist.patterns : [];
  return patterns.filter((p) => SECRET_VALUE.test(String(p)));
}

/**
 * SEC-7: выключены ли для агента ВСЕ правила Level-1 (rules + by_agent).
 * При `hybrid`-mode Level-2 запускается только если Level-1 что-то нашёл,
 * поэтому полный off создаёт дыру (untrusted проходит без Level-1 и Level-2).
 * @param {object} opts  Результат resolveSanitizeOptions.
 * @returns {boolean}
 */
export function allRulesDisabled(opts) {
  if (!opts?.rules) return false;
  const defined = Object.values(opts.rules);
  return defined.length > 0 && defined.every((v) => v === false);
}

// --- Trust model -----------------------------------------------------------

/**
 * Extract trusted subagents from a parsed maestro config.
 * @param {object} config  Parsed `maestro.json` (from loadMaestroConfig).
 * @returns {Set<string>}  Set of trusted subagent names.
 */
export function loadTrustConfig(config) {
  const trusted = new Set();
  for (const [name, value] of Object.entries(config?.trust ?? {})) {
    if (value === true) trusted.add(name);
  }
  return trusted;
}

// --- File access control ---------------------------------------------------

/**
 * Extract the access policy from a parsed maestro config.
 * @param {object} config  Parsed `maestro.json` (from loadMaestroConfig).
 * @returns {{ exists: boolean, default: string, allow: string[], ask: string[], deny: string[] }}
 */
export function loadAccessPolicy(config) {
  const section = config?.access_policy;
  if (!section || typeof section !== "object") {
    // Секции нет → политика не enforced (fail-open).
    return { exists: false, default: "ask", allow: [], ask: [], deny: [] };
  }
  return {
    exists: true,
    default: section.default === "allow" ? "allow" : "ask",
    allow: Array.isArray(section.allow) ? section.allow : [],
    ask: Array.isArray(section.ask) ? section.ask : [],
    deny: Array.isArray(section.deny) ? section.deny : [],
  };
}

// --- Confidential access control ------------------------------------------

// Допустимые значения политики trusted для инструмента.
const CONF_TRUSTED_ACTIONS = new Set(["allow", "deny"]);

/**
 * Extract the confidential access policy from a parsed maestro config.
 * Секция `confidential` — строже access_policy и применяется к read/write/edit
 * по путям из `paths`. Для untrusted/primary — всегда deny (инвариант, не
 * конфигурируется). Для trusted-субагентов действие задаётся мапой `trusted`.
 * @param {object} config  Parsed `maestro.json`.
 * @returns {{ exists: boolean, paths: string[], trusted: {read:string, write:string, edit:string} }}
 */
export function loadConfidentialConfig(config) {
  const section = config?.confidential;
  const defaults = {
    paths: ["docs/confidential/**"],
    trusted: { read: "allow", write: "deny", edit: "deny" },
  };
  if (!section || typeof section !== "object") {
    return { exists: false, ...defaults };
  }
  const paths = Array.isArray(section.paths) && section.paths.length > 0
    ? section.paths
    : defaults.paths;
  const trusted = {};
  const provided = section.trusted && typeof section.trusted === "object" ? section.trusted : {};
  for (const tool of ["read", "write", "edit"]) {
    if (!(tool in provided)) {
      trusted[tool] = defaults.trusted[tool];
    } else {
      // Явно заданное значение: допустимо только allow|deny, иначе — deny.
      trusted[tool] = CONF_TRUSTED_ACTIONS.has(provided[tool]) ? provided[tool] : "deny";
    }
  }
  return { exists: true, paths, trusted };
}

/**
 * Resolve the confidential action for a tool call.
 * Инвариант: не trusted-субагент → всегда deny. Trusted → по `conf.trusted[tool]`.
 * @param {{ trusted: {read:string,write:string,edit:string} }} conf  Loaded confidential config.
 * @param {string} tool  Tool name (read|write|edit).
 * @param {boolean} isTrustedSubagent  Whether the call originates from a trusted subagent.
 * @returns {"allow"|"deny"}
 */
export function resolveConfidentialAction(conf, tool, isTrustedSubagent) {
  if (!isTrustedSubagent) return "deny";
  return conf?.trusted?.[tool] === "allow" ? "allow" : "deny";
}

/**
 * Extract the agent name from a session's messages (defensive).
 * Возвращает первое найденное имя: AssistantMessage.mode / UserMessage.agent /
 * AgentPart.name / SubtaskPart.agent.
 * @param {Array} messages  Response from client.session.messages (array of {info, parts}).
 * @returns {string|undefined}
 */
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

/**
 * Determine whether a tool call originates from a trusted subagent.
 * Fail-closed: без client, без parentID (primary), не резолвится агент, ошибка
 * lookup — всё трактуется как untrusted → deny.
 * @param {object|undefined} client  OpenCode SDK client (from plugin closure).
 * @param {Set<string>} trustedAgents  Trusted subagent names.
 * @param {string} sessionID  Session that made the tool call.
 * @returns {Promise<boolean>}
 */
export async function resolveIsTrustedSubagent(client, trustedAgents, sessionID) {
  if (!client?.session?.get) return false;
  let session;
  try {
    const resp = await client.session.get({ path: { id: sessionID } });
    session = resp?.data ?? resp;
  } catch {
    return false;
  }
  if (!session?.parentID) return false; // root/primary
  try {
    const mresp = await client.session.messages({ path: { id: sessionID } });
    const messages = mresp?.data ?? mresp;
    const agent = agentNameFromMessages(Array.isArray(messages) ? messages : []);
    return Boolean(agent && trustedAgents.has(agent));
  } catch {
    return false;
  }
}

/**
 * Simple glob→boolean matcher. Supports `*` (any chars), `?` (one char),
 * and `{a,b,c}` brace alternation.
 * @param {string} pattern  Glob pattern.
 * @param {string} value    Path to match.
 * @returns {boolean}
 */
function globMatch(pattern, value) {
  // {a,b,c} → (a|b|c), значения экранируются.
  let out = "";
  let i = 0;
  while (i < pattern.length) {
    const ch = pattern[i];
    if (ch === "{") {
      const end = pattern.indexOf("}", i);
      if (end !== -1) {
        const alts = pattern
          .slice(i + 1, end)
          .split(",")
          .map((a) => a.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
        out += `(?:${alts.join("|")})`;
        i = end + 1;
        continue;
      }
    }
    if (ch === "*") {
      out += ".*";
    } else if (ch === "?") {
      out += ".";
    } else {
      out += ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }
    i += 1;
  }
  return new RegExp(`^${out}$`).test(value);
}

/**
 * Normalize a target path to a canonical project-relative form (posix separators).
 * Сводит absolute / relative / `./` / `..` к единому виду для glob-матчинга.
 * @param {string} root    Project root (absolute).
 * @param {string} target  Raw path from tool args.
 * @returns {string}  Project-relative path with `/` separators ("" if invalid).
 */
export function normalizeTarget(root, target) {
  if (typeof target !== "string" || !target) return "";
  const abs = path.isAbsolute(target) ? target : path.resolve(root, target);
  const rel = path.relative(root, abs);
  return rel.split(path.sep).join("/");
}

/**
 * Check whether a target path falls within any confidential pattern.
 * Confidential — security-граница: матчинг case-insensitive (APFS/NTFS могут
 * резолвить case-варианты в тот же файл) и блокирует как файлы под паттерном,
 * так и саму директорию/поддиректории (листинг — C2).
 * @param {string} root      Project root (absolute).
 * @param {string[]} patterns  Confidential path globs (e.g. `docs/confidential/**`).
 * @param {string} target    Raw path from tool args.
 * @returns {boolean}
 */
export function isConfidentialTarget(root, patterns, target) {
  const rel = normalizeTarget(root, target);
  if (!rel) return false;
  const lower = rel.toLowerCase();
  for (const p of patterns ?? []) {
    if (typeof p !== "string" || !p) continue;
    const pat = p.toLowerCase();
    if (globMatch(pat, lower)) return true; // файл под паттерном
    if (pat.endsWith("/**")) {
      const prefix = pat.slice(0, -3); // убрать `/**`
      if (lower === prefix) return true; // сама директория
      if (lower.startsWith(prefix + "/")) return true; // поддиректория (листинг глубже)
    }
  }
  return false;
}

/**
 * Resolve access action for a path against the policy. Priority:
 * deny > ask > allow > default (наиболее строгое выигрывает).
 * @param {object} policy  Parsed access policy.
 * @param {string} path    File path being accessed.
 * @returns {"allow"|"ask"|"deny"}
 */
export function resolveFileAccess(policy, filePath) {
  if (typeof filePath !== "string" || !filePath) return policy.default || "ask";
  // Приоритет: deny=3, ask=2, allow=1. Default — только fallback, если ни один
  // паттерн не совпал. bestRank=0 означает «ничего не совпало».
  const RANK = { deny: 3, ask: 2, allow: 1 };
  let best;
  let bestRank = 0;
  const consider = (patterns, action) => {
    const rank = RANK[action] ?? 0;
    if (rank <= bestRank) return;
    for (const p of patterns ?? []) {
      if (globMatch(p, filePath)) {
        best = action;
        bestRank = rank;
        return;
      }
    }
  };
  consider(policy.allow ?? [], "allow");
  consider(policy.ask ?? [], "ask");
  consider(policy.deny ?? [], "deny");
  return best ?? (policy.default || "ask");
}

/**
 * Extract a target file path from a file tool's args for access-policy checks.
 * access-policy контролирует только `read` (чёткий filePath); bash/glob/grep
 * не покрываются (bash-пути ненадёжно извлекаются, glob/grep — паттерны).
 * Confidential-контроль распространяет `filePathOf` на `write`/`edit`
 * (у всех трёх тулов аргумент `filePath`).
 * @param {string} tool  Tool name (read|write|edit).
 * @param {object} args  Tool args.
 * @returns {string|undefined}  Path to match, if any.
 */
export function filePathOf(tool, args) {
  if (!args) return undefined;
  if ((tool === "read" || tool === "write" || tool === "edit") && typeof args.filePath === "string") {
    return args.filePath;
  }
  return undefined;
}

export function makeLogger(directory) {
  const logDir =
    process.env.MAESTRO_BOOTSTRAP_LOG_DIR ||
    path.join(directory, ".maestro/logs");
  const levelEnv = process.env.MAESTRO_BOOTSTRAP_LOG_LEVEL || "info";
  const threshold = LOG_LEVELS[levelEnv] ?? 10;
  // Явная маска — список уровней через запятую. Если не задана, выводится из
  // порога: все уровни >= LOG_LEVEL. Чтобы «и порог, и маска» давали единое
  // поведение, они применяются как пересечение.
  const maskEnv = process.env.MAESTRO_BOOTSTRAP_LOG_MASK;
  const enabled = new Set(
    maskEnv
      ? maskEnv.split(",").map((s) => s.trim()).filter(Boolean).filter((l) => l in LOG_LEVELS)
      : Object.keys(LOG_LEVELS).filter((l) => LOG_LEVELS[l] >= threshold),
  );

  try {
    fs.mkdirSync(logDir, { recursive: true });
  } catch {
    /* logging must never break the session */
  }

  const logFileFor = (date) =>
    path.join(logDir, `maestro-bootstrap-${date}.log`);

  const write = (level, msg, extra) => {
    if (!enabled.has(level)) return;
    if (LOG_LEVELS[level] < threshold) return;
    const now = new Date();
    const date = now.toISOString().slice(0, 10);
    const entry = JSON.stringify({
      ts: now.toISOString(),
      level,
      msg,
      ...extra,
    });
    try {
      fs.appendFileSync(logFileFor(date), entry + "\n");
    } catch {
      /* logging must never break the session */
    }
  };

  return {
    logDir,
    level: levelEnv,
    mask: [...enabled].join(","),
    debug: (msg, extra) => write("debug", msg, extra),
    info: (msg, extra) => write("info", msg, extra),
    warn: (msg, extra) => write("warn", msg, extra),
    error: (msg, extra) => write("error", msg, extra),
  };
}

// Ограниченная карта: при переполнении вытесняет самую старую запись по
// порядку вставки — защита от неограниченного роста в долгоживущем процессе.
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
  };
}

export const MaestroBootstrapPlugin = async ({ directory, client }) => {
  const root = directory || process.cwd();
  const log = makeLogger(root);
  const config = loadMaestroConfig(undefined, root);
  const whitelist = loadWhitelist(config);
  const accessPolicy = loadAccessPolicy(config);
  const confidential = loadConfidentialConfig(config);
  const trustedAgents = loadTrustConfig(config);
  // SEC-6: если whitelist-`patterns` содержит значения, которые сами матчатся
  // safety-правилами (оператор занёс реальный секрет) — предупредить.
  const unsafePatterns = detectUnsafePatterns(whitelist);
  if (unsafePatterns.length > 0) {
    log.warn("sanitizer.unsafe_patterns", {
      // значения НЕ логируем — это могут быть реальные секреты
      count: unsafePatterns.length,
    });
  }
  log.info("plugin initialized", {
    logDir: log.logDir,
    level: log.level,
    mask: log.mask,
  });

  // callID -> timestamp (для подсчёта длительности тула)
  const toolCalls = makeBoundedMap(2048);

  // sessionID -> trusted-статус субагента (кэш для confidential-контроля)
  const sessionTrustCache = makeBoundedMap(2048);

  const plugin = {
    config: undefined,

    event: async ({ event }) => {
      try {
        const { type, properties } = event ?? {};
        const sessionID = properties?.sessionID;
        if (type === "session.error") {
          log.warn("session.error", {
            sessionID,
            errorType: properties?.error?.type,
            errorMessage: properties?.error?.message,
          });
        } else if (type === "session.status" && properties?.status?.type === "retry") {
          log.warn("session.status.retry", {
            sessionID,
            attempt: properties.status.attempt,
            message: properties.status.message,
          });
        }
      } catch (err) {
        log.error("event: error", {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },

    "tool.execute.before": async (input, output) => {
      try {
        // Confidential control (Уровень 3+): жёсткий deny для не-trusted по
        // `confidential.paths`. Строже access_policy: если путь confidential —
        // access_policy для него не применяется (confidential выигрывает).
        // Покрывает read/write/edit. bash/glob/grep — нативные permissions.
        const CONF_TOOLS = new Set(["read", "write", "edit"]);
        let wasConfidential = false;
        if (confidential.exists && CONF_TOOLS.has(input.tool)) {
          const target = filePathOf(input.tool, output?.args);
          if (target && isConfidentialTarget(root, confidential.paths, target)) {
            wasConfidential = true;
            let isTrustedSubagent = sessionTrustCache.get(input.sessionID);
            if (isTrustedSubagent === undefined) {
              isTrustedSubagent = await resolveIsTrustedSubagent(client, trustedAgents, input.sessionID);
              sessionTrustCache.set(input.sessionID, isTrustedSubagent);
            }
            const action = resolveConfidentialAction(confidential, input.tool, isTrustedSubagent);
            if (action !== "allow") {
              log.warn("confidential.blocked", {
                sessionID: input.sessionID,
                callID: input.callID,
                tool: input.tool,
                action,
                target: path.basename(target),
              });
              const err = new Error(
                `[confidential:deny] Доступ к "${target}" запрещён. ` +
                  `Доступ к confidential-путям разрешён только trusted-субагентам.`,
              );
              err.confidential = true;
              throw err;
            }
          }
        }

        // File access control (Уровень 3): перехват file-тулов по
        // access-policy.json. `allow` → пропускаем, `ask` → блокируем с
        // сообщением (HITL решает оркестратор), `deny` → жёсткий блок.
        // Контролируется только `read` — у него чёткий filePath.
        // bash/glob/grep НЕ покрываются (bash-пути не извлекаются надёжно,
        // glob/grep работают с паттернами, не путями) — для них используйте
        // нативные permissions OpenCode (bash: ask и т.п.).
        const FILE_TOOLS = new Set(["read"]);
        if (accessPolicy.exists && FILE_TOOLS.has(input.tool) && !wasConfidential) {
          const target = filePathOf(input.tool, output?.args);
          if (target) {
            const action = resolveFileAccess(accessPolicy, target);
            if (action !== "allow") {
              // SEC-5: в лог — только basename (не раскрывать полную структуру путей);
              // полный путь остаётся только в ошибке для оркестратора.
              log.warn("access_policy.blocked", {
                sessionID: input.sessionID,
                callID: input.callID,
                tool: input.tool,
                action,
                target: path.basename(target),
              });
              const err = new Error(
                `[access-policy:${action}] Доступ к "${target}" требует подтверждения. ` +
                  `Правило: ${action}. Обратитесь к оркестратору за HITL-решением.`,
              );
              err.accessPolicy = true;
              throw err;
            }
          }
        }

        // Санитайзинг промпта task (Уровень 1 Security Review): маскируем
        // чувствительные данные ДО того, как промпт уйдёт в сабагента.
        // Авто, без HITL. Trusted сабагенты (maestro.json → trust) — skip
        // (доверенный сабагент получает промпт как есть).
        if (input.tool === "task" && output?.args?.prompt) {
          const agent = output.args.subagent_type || output.args.model || "unknown";
          if (!trustedAgents.has(agent)) {
            const opts = resolveSanitizeOptions(whitelist, agent);
            // SEC-7: для untrusted выключены ВСЕ правила Level-1 (rules+by_agent) —
            // при hybrid-mode Level-2 тоже не запустится. Предупредить.
            if (allRulesDisabled(opts)) {
              log.warn("sanitizer.all_rules_disabled", {
                sessionID: input.sessionID,
                callID: input.callID,
                tool: input.tool,
                agent,
              });
            }
            const res = sanitize(output.args.prompt, opts);
            if (res.count > 0) {
              output.args.prompt = res.text;
              log.warn("sanitizer.redacted", {
                sessionID: input.sessionID,
                callID: input.callID,
                tool: input.tool,
                agent,
                redacted: res.count,
              });
            }
          }
        }

        // Логируем только диспатч субагентов (task) — это ядро observability
        // после сокращения. Прочие тулы (bash/skill/read) не логируем детально.
        if (input.tool === "task") {
          toolCalls.set(input.callID, Date.now());
          log.info("tool.execute.before", {
            sessionID: input.sessionID,
            callID: input.callID,
            tool: input.tool,
          });
        }
      } catch (err) {
        if (err?.accessPolicy || err?.confidential) {
          // Access/confidential-нарушение — обязано дойти до OpenCode (реальный
          // блок), не замалчиваться логгером.
          throw err;
        }
        log.error("tool.execute.before: error", {
          sessionID: input?.sessionID,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },

    "tool.execute.after": async (input, output) => {
      try {
        const startedAt = input.tool === "task" ? toolCalls.get(input.callID) : undefined;
        if (startedAt !== undefined) toolCalls.delete(input.callID);
        const extra = {
          sessionID: input.sessionID,
          callID: input.callID,
          tool: input.tool,
        };
        if (startedAt !== undefined) extra.durationMs = Date.now() - startedAt;
        // SEC-4: `title` субагента — untrusted (может содержать секреты в отчёте).
        // Санитизируем перед записью в лог. Используем те же правила, что и для
        // промпта (resolveSanitizeOptions), чтобы учесть org-конфигурацию
        // sanitizer (extra_fields/extra_uri_schemes/patterns/per-agent rules).
        if (output?.title) {
          const agent = input.args?.subagent_type || input.args?.model || "unknown";
          const opts = resolveSanitizeOptions(whitelist, agent);
          extra.title = sanitize(String(output.title), opts).text;
        }
        const isEmptySubagentResult =
          input.tool === "task" &&
          (!output?.title || !output?.output) &&
          (!output?.metadata || Object.keys(output.metadata).length === 0);
        if (isEmptySubagentResult) {
          log.warn("tool.execute.after.empty_result", {
            sessionID: input.sessionID,
            callID: input.callID,
            tool: input.tool,
          });
        }
        if (startedAt !== undefined) {
          log.info("tool.execute.after", extra);
        }
      } catch (err) {
        log.error("tool.execute.after: error", {
          sessionID: input?.sessionID,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },

    dispose: async () => {
      log.info("plugin disposing", {});
    },
  };
  return plugin;
};
