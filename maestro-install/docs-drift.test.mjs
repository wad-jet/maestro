// Детерминированный тест-чекер дрейфа документации (0 LLM, 0 зависимостей).
// Проверяет, что «встроенные» факты в доках не расходятся с фактическим
// состоянием репо. Каждая проверка — checkX(repoRoot), возвращающая массив
// строк-нарушений.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import {
  readFileSync,
  readdirSync,
  existsSync,
  statSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
  mkdirSync,
} from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// --- Helpers ---

function read(rel, base = ROOT) {
  return readFileSync(join(base, rel), "utf8");
}

function globRecursive(dir, pattern, base = ROOT) {
  const full = join(base, dir);
  if (!existsSync(full)) return [];
  const results = [];
  const stack = [full];
  while (stack.length) {
    const cur = stack.pop();
    const entries = readdirSync(cur);
    for (const e of entries) {
      const p = join(cur, e);
      const s = statSync(p);
      if (s.isDirectory()) {
        stack.push(p);
      } else if (pattern.test(e)) {
        results.push(p);
      }
    }
  }
  return results;
}

// ============================================================
// D1 — версия (labels)
// ============================================================

const SEMVER = /\b(\d+\.\d+\.\d+)\b/g;

/**
 * D1c allowlist categories — match by category keywords, not by line text.
 * Each category is a reason the version mention is acceptable.
 */
function isVersionAllowlisted(line, currentVer) {
  if (line.includes(currentVer)) return true;
  // 1. migration / ex-pomетки
  if (line.includes("Миграция (") || line.includes("(ex ")) return true;
  // 2. rename-protection
  if (line.includes("не переименовывается")) return true;
  // 3. dated historical mentions
  if (/\(\d{4}-\d{2}/.test(line)) return true;
  // 4. IP addresses (127.0.0.1 etc.) — not version references
  if (
    /(?:^|[^0-9])\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}(?:[^0-9]|$)/.test(line)
  )
    return true;
  // 5. contextual version mentions — исторические примеры, не встроенные факты
  if (
    line.includes("пример") ||
    line.includes("закрыл") ||
    line.includes("устаревший")
  )
    return true;
  // 6. версия в скобках-атрибуции (X.Y.Z) — не дрейф, а указание на версию
  if (/\([^)]*?\d+\.\d+\.\d+[^)]*\)/.test(line)) return true;
  // 7. blockquote continuation lines (migration notes)
  if (/^>/.test(line)) return true;
  // 8. spec-секция ссылки (§N.N / §N.N.N) — номера разделов спеки, не версии
  if (/[§]\s*\d/.test(line)) return true;
  // default: violation
  return false;
}

function checkD1(repoRoot) {
  const violations = [];
  const pkg = JSON.parse(read("package.json", repoRoot));
  const V = pkg.version;
  const agents = read("AGENTS.md", repoRoot);
  const context = read("docs/project-context.md", repoRoot);

  // D1a — AGENTS.md метка (~N строк, X.Y.Z)
  const agentLabel = agents.match(/~\d+ строк, (\d+\.\d+\.\d+)/);
  if (!agentLabel) {
    violations.push("AGENTS.md — не найдена метка (~N строк, X.Y.Z)");
  } else if (agentLabel[1] !== V) {
    violations.push(
      `AGENTS.md — метка версии ${agentLabel[1]} != package.json ${V}`
    );
  }

  // D1b — docs/project-context.md
  const ctxMatch = context.match(/`(\d+\.\d+\.\d+)` \(единая для скиллов/);
  if (!ctxMatch) {
    violations.push(
      "docs/project-context.md — не найдена строка с версией (единая для скиллов)"
    );
  } else if (ctxMatch[1] !== V) {
    violations.push(
      `docs/project-context.md — версия ${ctxMatch[1]} != package.json ${V}`
    );
  }

  // D1c — broad scan manual_docs + README.md
  // Exclude: changelog.md (история версий)
  const manualGlob = join(repoRoot, "manual_docs");
  if (existsSync(manualGlob)) {
    const mdFiles = globRecursive("manual_docs", /\.md$/, repoRoot);
    for (const fp of mdFiles) {
      const rel = fp.slice(repoRoot.length + 1);
      if (
        rel.includes("/overview/changelog.md")
      )
        continue;
      const content = readFileSync(fp, "utf8");
      const lines = content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const matches = [...line.matchAll(SEMVER)];
        for (const m of matches) {
          if (!isVersionAllowlisted(line, V)) {
            violations.push(
              `${rel}:${i + 1} — stale version ${m[1]} (текущая ${V})`
            );
          }
        }
      }
    }
  }
  // README.md
  if (existsSync(join(repoRoot, "README.md"))) {
    const content = read("README.md", repoRoot);
    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const matches = [...line.matchAll(SEMVER)];
      for (const m of matches) {
        if (!isVersionAllowlisted(line, V)) {
          violations.push(
            `README.md:${i + 1} — stale version ${m[1]} (текущая ${V})`
          );
        }
      }
    }
  }
  return violations;
}

// ============================================================
// D2 — устаревшие имена
// ============================================================

// Бывшие имена; при каждом rename добавлять сюда.
// Миграции не удаляем — доки-история в changelog защищена allowlist'ом.
const STALE_NAMES = [
  "code-reviewer", // бывший агент ревью
  "Code Review", // терминология шага 16 → Artifact Review (4.16.0+, 5.0)
  "maestro-new", // бывший /команда и скилл (→ maestro-setup)
  "maestro-init.sh", // бывший установочный скрипт (→ maestro-install.sh)
  "feature-agent", // бывший primary-агент (→ maestro)
  "feature-agent-bootstrap", // бывший плагин (→ maestro-bootstrap)
];

/**
 * D2 allowlist categories — line text patterns that allow stale names.
 */
function isStaleAllowlisted(line) {
   // 1. migration notes (включая комментарии в install/update скриптах)
   if (line.includes("Миграция ") || line.includes("stale после rename"))
     return true;
  // 2. rename-aware scripts — миграция содержит stale имена
  if (line.includes("M-5") || line.includes("M-9")) return true;
  // 3. миграционный контекст stale-имён (rename, stale после rename, →)
  if (/\brename\b/.test(line) || /stale после rename/.test(line) || /→/.test(line))
    return true;
  // 4. .sh скрипты миграции — данные, проверки, regex содержат stale имена
  if (line.includes("skills/maestro-init") || line.includes("skills/maestro-new"))
    return true;
   if (line.includes("maestro-init|maestro-new"))
     return true;
    // 5. external / rename-protection
    if (line.includes("(ex ") || line.includes("не переименовывается")) return true;
    // 6. external template references (Claude Code-конвенция)
    if (line.includes("Claude Code")) return true;
    // 7. dated historical mentions
    if (/\(\d{4}-\d{2}/.test(line)) return true;
    // 8. blockquote continuation lines (markdown > ...) — migration notes
    if (/^>/.test(line)) return true;
  return false;
}

function checkD2(repoRoot) {
  const violations = [];
  // Поверхности: skills/**/*.md, commands/*.md, agents/*.md,
  // manual_docs/**/*.md, README.md, AGENTS.md, docs/project-context.md,
  // maestro.json, *.sh (корень)

  // Flat patterns — один уровень, без рекурсии (строки — имена файлов/гlobs)

  const flatPatterns = [
    { dir: "commands", pattern: "*.md" },
    { dir: "agents", pattern: "*.md" },
    "README.md",
    "AGENTS.md",
    "docs/project-context.md",
    "maestro.json",
    { dir: ".", pattern: "*.sh" },
  ];

  // Recursive patterns — **/*.md
  const recPatterns = [
    "skills/**/*.md",
    "manual_docs/**/*.md",
  ];

  function listFiles(pattern, base) {
    if (typeof pattern === "string" && !pattern.includes("/**")) {
      // Абсолютный путь или относительный файл
      const fp = join(base, pattern);
      return existsSync(fp) ? [fp] : [];
    }
    if (typeof pattern === "object") {
      const { dir, pattern: ptn } = pattern;
      const fullDir = join(base, dir);
      if (!existsSync(fullDir)) return [];
      const re = new RegExp(`^${ptn.replace(/\./g, "\\.").replace(/\*/g, ".*")}$`);
      return readdirSync(fullDir)
        .filter((e) => re.test(e))
        .map((e) => join(fullDir, e));
    }
    // Fallback: recursive
    const subDir = pattern.substring(0, pattern.indexOf("/"));
    return globRecursive(subDir, /\.md$/, base);
  }

  for (const pat of flatPatterns) {
    const files = listFiles(pat, repoRoot);
    for (const fp of files) {
      const rel = fp.slice(repoRoot.length + 1);
      if (
        rel.includes("changelog.md") ||
        rel.includes("/regression/")
      )
        continue;
      const content = readFileSync(fp, "utf8");
      const lines = content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (isStaleAllowlisted(line)) continue;
        for (const name of STALE_NAMES) {
          if (line.includes(name)) {
            violations.push(`${rel}:${i + 1} — stale name «${name}»`);
          }
        }
      }
    }
  }

  for (const pat of recPatterns) {
    const files = globRecursive(pat.substring(0, pat.indexOf("/")), /\.md$/, repoRoot);
    for (const fp of files) {
      const rel = fp.slice(repoRoot.length + 1);
      if (
        rel.includes("changelog.md") ||
        rel.includes("/regression/") ||
        rel.includes("/specs/") ||
        rel.includes("docs/superpowers/")
      )
        continue;
      const content = readFileSync(fp, "utf8");
      const lines = content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (isStaleAllowlisted(line)) continue;
        for (const name of STALE_NAMES) {
          if (line.includes(name)) {
            violations.push(`${rel}:${i + 1} — stale name «${name}»`);
          }
        }
      }
    }
  }

  return violations;
}

// ============================================================
// D3 — счётчик-метка
// ============================================================

function checkD3(repoRoot) {
  const violations = [];
  const agents = read("AGENTS.md", repoRoot);
  const skillPath = join(repoRoot, "skills", "maestro", "SKILL.md");
  if (!existsSync(skillPath)) {
    violations.push("skills/maestro/SKILL.md не найден");
    return violations;
  }
  const skillContent = readFileSync(skillPath, "utf8");
  // wc -l = count of \n characters
  const actualLines = skillContent.split("\n").length - 1;
  const labelMatch = agents.match(/~(\d+) строк/);
  if (!labelMatch) {
    violations.push("AGENTS.md — не найдена метка (~N строк, ...)");
    return violations;
  }
  const labelN = parseInt(labelMatch[1], 10);
  if (Math.abs(labelN - actualLines) > 50) {
    violations.push(
      `AGENTS.md — метка ~${labelN} строк, фактически ${actualLines} (обнови метку)`
    );
  }
  return violations;
}

// ============================================================
// D4 — статусы roadmap/TODO ↔ changelog
// ============================================================

function checkD4(repoRoot) {
  const violations = [];
  const changelogPath = join(repoRoot, "manual_docs", "overview", "changelog.md");
  if (!existsSync(changelogPath)) {
    violations.push("changelog.md не найден");
    return violations;
  }
  const changelog = readFileSync(changelogPath, "utf8");
  const clVersions = new Set(
    [...changelog.matchAll(/Версия(?:\s+дистрибутива)?\s+(\d+\.\d+\.\d+)/g)]
      .map((m) => m[1])
      .concat(
        [...changelog.matchAll(/\*\*(\d+\.\d+\.\d+)\*\*(?:\s+\()/g)].map(
          (m) => m[1]
        )
      )
  );

  const roadmapPath = join(repoRoot, "docs", "roadmap.md");
  if (existsSync(roadmapPath)) {
    const roadmap = read("docs/roadmap.md", repoRoot);
    const lines = roadmap.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const matches = [...line.matchAll(/Выполнено\s*\(([^)]+)\)/g)];
      for (const m of matches) {
        const allVers = [...m[1].matchAll(/(\d+\.\d+\.\d+)/g)];
        for (const v of allVers) {
          if (!clVersions.has(v[1])) {
            violations.push(
              `docs/roadmap.md:${i + 1} — «Выполнено (${m[1]})» версия ${v[1]} нет в changelog`
            );
          }
        }
      }
    }
  }

  const todoPath = join(repoRoot, "TODO.md");
  if (existsSync(todoPath)) {
    const todo = read("TODO.md", repoRoot);
    const lines = todo.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const matches = [...line.matchAll(/реализовано\s*\(([^)]+)\)/g)];
      for (const m of matches) {
        const allVers = [...m[1].matchAll(/(\d+\.\d+\.\d+)/g)];
        for (const v of allVers) {
          if (!clVersions.has(v[1])) {
            violations.push(
              `TODO.md:${i + 1} — «реализовано (${m[1]})» версия ${v[1]} нет в changelog`
            );
          }
        }
      }
    }
  }
  return violations;
}

// ============================================================
// D5 — pipeline compliance: инвариантные маркеры в SKILL.md и auto-ai-prompt
// ============================================================

function checkD5(repoRoot) {
  const violations = [];
  const skill = read("skills/maestro/SKILL.md", repoRoot);

  // 1. Gate 17 всегда HITL (⚑1)
  if (!skill.includes("Всегда HITL (⚑1)")) {
    violations.push("SKILL.md: gate 17 не содержит «Всегда HITL (⚑1)»");
  }

  // 2. Step 18: условие bump — «Версионирование: да»
  if (!skill.includes("Версионирование: да")) {
    violations.push("SKILL.md: step 18 не ссылается на условие bump «Версионирование: да»");
  }

  // 3. Simple feature line: «после SDD — шаги 14–18.5 для всех категорий»
  if (!skill.includes("14–18.5")) {
    violations.push("SKILL.md: простая фича не содержит указание «14–18.5 для всех категорий»");
  }

  // 4. auto-ai-decision-prompt.md: hard-rule merge/push (⚑1)
  const aiPrompt = read("skills/maestro/auto-ai-decision-prompt.md", repoRoot);
  if (!aiPrompt.includes("⚑1") || !aiPrompt.includes("merge") || !aiPrompt.includes("HITL_REQUIRED")) {
    violations.push("auto-ai-decision-prompt.md: нет hard-rule ⚑1 для merge/push");
  }

  return violations;
}

// ============================================================
// D6 — install/update-скрипты существуют в корне (6.0.0: доставка через скрипты + manifest)
// ============================================================

const INSTALL_SCRIPTS = ["maestro-install.sh", "maestro-update.sh"];

function checkD6(repoRoot) {
  const violations = [];
  for (const name of INSTALL_SCRIPTS) {
    if (!existsSync(join(repoRoot, name))) {
      violations.push(`корневой скрипт ${name} не найден (delivery сломана)`);
    }
  }
  return violations;
}

// ============================================================
// D7 — отсутствие legacy-имени доставки (6.0.0: wholesale copy)
// ============================================================

// 6.0.0 — legacy-механизм доставки удалён (wholesale copy вместо него).
// D7: его имя должно отсутствовать (case-insensitive) в пользовательских доках:
// manual_docs/how-to/**, manual_docs/reference/**, manual_docs/index.md.
// D8: root-файлы (README/AGENTS/SECURITY), manual_docs/explanation/** и
// manual_docs/overview/what-is-maestro.md — с допуском исторических пометок
// (строки с «удалён/удалены/отказ/legacy/removed/obsolete»).
// manual_docs/overview/changelog.md — вне обеих проверок (entry 6.0.0
// легитимно упоминает «отказ от legacy-механизма»).
const LEGACY_DELIVERY_NAME = "agpack";

function checkD7(repoRoot) {
  const violations = [];
  const files = [];
  for (const dir of ["how-to", "reference"]) {
    for (const fp of globRecursive(join("manual_docs", dir), /\.md$/, repoRoot)) {
      files.push(fp);
    }
  }
  const indexMd = join(repoRoot, "manual_docs", "index.md");
  if (existsSync(indexMd)) files.push(indexMd);

  for (const fp of files) {
    const rel = fp.slice(repoRoot.length + 1);
    const lines = readFileSync(fp, "utf8").split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].toLowerCase().includes(LEGACY_DELIVERY_NAME)) {
        violations.push(
          `${rel}:${i + 1} — legacy-доставка «${LEGACY_DELIVERY_NAME}» (удалена в 6.0.0; доставка — wholesale copy)`
        );
      }
    }
  }
  return violations;
}

// ============================================================
// D8 — отсутствие legacy-имени доставки в root/explanation/overview (6.0.0)
// ============================================================

// Строки с историческими пометками допустимы (case-insensitive):
// «удалён/удалены/отказ/legacy/removed/obsolete».
const LEGACY_DELIVERY_HISTORY =
  /удалён|удалены|отказ|legacy|removed|obsolete/i;

function checkD8(repoRoot) {
  const violations = [];
  const files = [];
  for (const rel of [
    "README.md",
    "AGENTS.md",
    "SECURITY.md",
    "manual_docs/overview/what-is-maestro.md",
  ]) {
    const fp = join(repoRoot, rel);
    if (existsSync(fp)) files.push(fp);
  }
  for (const fp of globRecursive(
    join("manual_docs", "explanation"),
    /\.md$/,
    repoRoot
  )) {
    files.push(fp);
  }
  for (const fp of files) {
    const rel = fp.slice(repoRoot.length + 1);
    const lines = readFileSync(fp, "utf8").split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].toLowerCase().includes(LEGACY_DELIVERY_NAME)) {
        if (LEGACY_DELIVERY_HISTORY.test(lines[i])) continue;
        violations.push(
          `${rel}:${i + 1} — legacy-доставка «${LEGACY_DELIVERY_NAME}» (удалена в 6.0.0; доставка — wholesale copy)`
        );
      }
    }
  }
  return violations;
}

// ============================================================
// D9 — порядок слоёв 4-слойного конфига (6.1.0: слой 2 = .maestro/, слой 3 = root)
// ============================================================

// Положительная часть: 4-слойные таблицы, где строка слоя 2 —
// `.maestro/maestro.json`, строка слоя 3 — корневой `maestro.json`.
const D9_LAYER_TABLE_FILES = [
  "manual_docs/reference/config.md",
  "manual_docs/explanation/agents-and-trust.md",
];

// Отрицательная часть — whitelist «живых» доков (spec §3.6-2). Исторические
// файлы (changelog.md, docs/roadmap.md, TODO.md, specs/**, docs/superpowers/**)
// намеренно вне сканирования: записи версий до 6.1.0 легитимно описывают
// старый порядок.
const D9_WHITELIST = [
  "manual_docs/reference/config.md",
  "manual_docs/explanation/agents-and-trust.md",
  "manual_docs/explanation/plain-language.md",
  "manual_docs/how-to/customize-maestro.md",
  "manual_docs/how-to/memory-backup-restore.md",
  "plugins/maestro-bootstrap/README.md",
  "skills/maestro/SKILL.md",
  "skills/maestro-setup/SKILL.md",
];

// Формы путей проектных слоёв в доках — в backtick'ах, с префиксом
// <project>/ или <root>/. Глобальный `~/.config/opencode/.maestro/maestro.json`
// и безпрефиксные упоминания («root `maestro.json`», «`.maestro/maestro.json`»)
// не покрываются — ложные срабатывания исключены.
const D9_ROOT_FORM = /`<(?:project|root)>\/maestro\.json`/g; // слой 3 (root)
const D9_DOT_FORMS = [
  "`<project>/.maestro/maestro.json`", // слой 2 (.maestro/)
  "`<root>/.maestro/maestro.json`",
];
// Цепочка старого порядка: root-слой ПЕРЕД .maestro/-слоем. Соседние пункты
// цепочки: ровно один разделитель (→ или >) между слоями, без второго
// разделителя и без другого упоминания maestro.json между ними; окно ≤ 150
// символов (скобочные пометки «(в git)» + перенос строки).
const D9_GAP_MAX = 150;

function d9LineAt(content, index) {
  return content.slice(0, index).split("\n").length;
}

// Позиция разделителя цепочки. Для «>» важно: символ «>» входит в префикс
// <root> путей — такая «>» разделителем не считается.
function d9SepIndex(text, sep) {
  if (sep !== ">") return text.indexOf(sep);
  let i = 0;
  for (;;) {
    i = text.indexOf(">", i);
    if (i === -1) return -1;
    if (!text.slice(i - 5, i).endsWith("<root")) return i;
    i += 1;
  }
}

function findOldOrderChains(content, sep) {
  const hits = [];
  for (const m of content.matchAll(D9_ROOT_FORM)) {
    const start = m.index + m[0].length;
    const rest = content.slice(start, start + D9_GAP_MAX * 2);
    const sepIdx = d9SepIndex(rest, sep);
    if (sepIdx === -1 || sepIdx > D9_GAP_MAX) continue;
    // до разделителя — пометка (например « (в git)»); чужое упоминание
    // maestro.json не допустимо
    if (rest.slice(0, sepIdx).includes("maestro.json")) continue;
    // после разделителя — до следующего (соседство: второго разделителя нет)
    const after = rest.slice(sepIdx + sep.length);
    const nextSep = d9SepIndex(after, sep);
    const window =
      nextSep === -1 ? after.slice(0, D9_GAP_MAX) : after.slice(0, nextSep);
    if (D9_DOT_FORMS.some((f) => window.includes(f))) hits.push(m.index);
  }
  return hits;
}

function findOldOrderLists(content) {
  const hits = [];
  // Нумерованный список: root-пункт перед .maestro/-пунктом. Метка пункта —
  // сам путь (после «N.» — только пробелы/табы и **); .maestro/-пункт —
  // следующий пункт того же списка (≤ 3 строки продолжения, без пустых).
  const re =
    /(?:^|\n)[ \t]*\d+\.[ \t]*(?:\*\*)?[ \t]*`<(?:project|root)>\/maestro\.json`/g;
  for (const m of content.matchAll(re)) {
    const after = content.slice(m.index + m[0].length, m.index + m[0].length + 300);
    const next =
      /^[^\n]*(?:\n(?![ \t]*\d+\.)(?!\n)[^\n]*){0,3}\n[ \t]*\d+\.[ \t]*(?:\*\*)?[ \t]*`<(?:project|root)>\/\.maestro\/maestro\.json`/;
    if (next.test(after)) hits.push(m.index);
  }
  return hits;
}

function checkD9LayerTable(content, file) {
  const violations = [];
  const lines = content.split("\n");
  // Блоки таблицы: последовательные строки, начинающиеся с |
  const blocks = [];
  let cur = [];
  for (const l of lines) {
    if (/^\s*\|/.test(l)) {
      cur.push(l);
    } else if (cur.length) {
      blocks.push(cur);
      cur = [];
    }
  }
  if (cur.length) blocks.push(cur);
  // Таблица 4 слоёв — по строке слоя 1 с MAESTRO_CONFIG
  const table = blocks.find(
    (b) => b.some((l) => /^\s*\|\s*1\s*\|/.test(l) && l.includes("MAESTRO_CONFIG"))
  );
  if (!table) {
    violations.push(`${file} — не найдена таблица 4 слоёв (слой 1 = MAESTRO_CONFIG)`);
    return violations;
  }
  const row2 = table.find((l) => /^\s*\|\s*2\s*\|/.test(l));
  const row3 = table.find((l) => /^\s*\|\s*3\s*\|/.test(l));
  if (!row2) {
    violations.push(`${file} — не найдена строка слоя 2 в таблице 4 слоёв`);
  } else if (!row2.includes(".maestro/maestro.json")) {
    violations.push(
      `${file} — строка слоя 2: ожидалось \`<project>/.maestro/maestro.json\` (с 6.1.0: слой 2 = .maestro/, слой 3 = root)`
    );
  }
  if (!row3) {
    violations.push(`${file} — не найдена строка слоя 3 в таблице 4 слоёв`);
  } else if (
    !/`<(?:project|root)>\/maestro\.json`/.test(row3) ||
    row3.includes(".maestro/maestro.json")
  ) {
    violations.push(
      `${file} — строка слоя 3: ожидался корневой \`<project>/maestro.json\` (без префикса .maestro/)`
    );
  }
  return violations;
}

function checkD9(repoRoot) {
  const violations = [];

  // 1. Положительная: 4-слойные таблицы — слой 2 = .maestro/, слой 3 = root.
  for (const file of D9_LAYER_TABLE_FILES) {
    if (!existsSync(join(repoRoot, file))) {
      violations.push(`${file} — не найден`);
      continue;
    }
    violations.push(...checkD9LayerTable(read(file, repoRoot), file));
  }

  // 2. Отрицательная: цепочки (→, >) и нумерованные списки старого порядка —
  // только по whitelist (исторические файлы не читаются).
  for (const file of D9_WHITELIST) {
    const fp = join(repoRoot, file);
    if (!existsSync(fp)) continue; // нет файла (fixture) — нечего сканировать
    // Blockquote-декорация не есть синтаксис цепочки: ведущий «> » снимается,
    // чтобы цепочка в блокквоте анализировалась так же.
    const content = read(file, repoRoot)
      .split("\n")
      .map((l) => l.replace(/^\s*>\s?/, ""))
      .join("\n");
    // Все найденные места (дедупликация: одна цепочка может попасть под оба
    // разделителя; сортировка по позиции)
    const hits = [
      ...new Set([
        ...findOldOrderChains(content, "→"),
        ...findOldOrderChains(content, ">"),
        ...findOldOrderLists(content),
      ]),
    ].sort((a, b) => a - b);
    for (const hit of hits) {
      violations.push(
        `${file}:${d9LineAt(content, hit)} — старый порядок слоёв (root перед .maestro/): с 6.1.0 слой 2 = .maestro/maestro.json, слой 3 = root maestro.json`
      );
    }
  }

  return violations;
}

// ============================================================
// D10 — inline-канон maestro.json в skills/maestro-assistant/SKILL.md
// (6.4.0, B): секции "confidential" и "trust" удалены из схемы — канон
// их не несёт (предотвращение канон-дрейфа; старые ключи — warn + игнор)
// ============================================================

// Первый json-блок файла — inline-канон maestro.json (эталон формата).
function parseAssistantCanon(content) {
  const m = content.match(/```json\n([\s\S]*?)```/);
  if (!m) return null;
  try {
    return JSON.parse(m[1]);
  } catch {
    return null;
  }
}

function checkD10(repoRoot) {
  const violations = [];
  const rel = "skills/maestro-assistant/SKILL.md";
  const fp = join(repoRoot, rel);
  if (!existsSync(fp)) {
    violations.push(`${rel} не найден`);
    return violations;
  }
  const canon = parseAssistantCanon(read(rel, repoRoot));
  if (!canon || typeof canon !== "object") {
    violations.push(
      `${rel} — inline-канон maestro.json не распарсился (первый JSON-блок должен быть валидным)`
    );
    return violations;
  }
  // Опознание канона: эталон формата несёт `sanitizer_whitelist`.
  if (!("sanitizer_whitelist" in canon)) {
    violations.push(
      `${rel} — первый JSON-блок не похож на канон maestro.json (нет ключа sanitizer_whitelist)`
    );
    return violations;
  }
  for (const key of ["confidential", "trust"]) {
    if (key in canon) {
      violations.push(
        `${rel} — inline-канон maestro.json несёт удалённую секцию "${key}" (6.4.0, B: секции вне схемы; старые ключи — warn + игнор)`
      );
    }
  }
  return violations;
}

// Fixtures
// ============================================================

// D9 fixture: 4-слойная таблица с верным порядком (6.1.0: слой 2 = .maestro/,
// слой 3 = root). Используется createFixtures() и D9-кейсами self-тестов.
const D9_TABLE = [
  "| # | Слой | Путь | Где живёт |",
  "|---|---|---|---|",
  "| 1 | `MAESTRO_CONFIG` (env) | произвольный путь | debug-only |",
  "| 2 | Проектный (локальный) | `<project>/.maestro/maestro.json` | вне git |",
  "| 3 | Проектный (командный) | `<project>/maestro.json` | в git |",
  "| 4 | Глобальный (машинный) | `~/.config/opencode/.maestro/maestro.json` | машина |",
].join("\n");

let TMP_DIR;

function createFixtures() {
  TMP_DIR = mkdtempSync(join(tmpdir(), "docs-drift-"));
  // package.json
  writeFileSync(
    join(TMP_DIR, "package.json"),
    JSON.stringify({ name: "fixture", version: "9.9.9" })
  );
  // AGENTS.md — D1a violation (версия 8.8.8), D3 violation (метка 1300 строк, SKILL.md = 1171)
  writeFileSync(
    join(TMP_DIR, "AGENTS.md"),
    `- \`skills/maestro/SKILL.md\` — скелет (~1300 строк, 8.8.8): test\n`
  );
  // docs/project-context.md — D1b violation
  const docsDir = join(TMP_DIR, "docs");
  if (!existsSync(docsDir)) mkdirSync(docsDir, { recursive: true });
  writeFileSync(
    join(docsDir, "project-context.md"),
    "`8.8.8` (единая для скиллов и плагина)\n"
  );
  // manual_docs — D2 violation: stale name без allowlist
  const mdocsDir = join(TMP_DIR, "manual_docs", "how-to");
  if (!existsSync(mdocsDir)) mkdirSync(mdocsDir, { recursive: true });
  writeFileSync(
    join(mdocsDir, "drift.md"),
    "Пример: feature-agent bootstrap\n"
  );
  // docs/roadmap.md — D4 violation: «Выполнено (7.7.7)» нет в changelog
  const fakeChangelog = "# Changelog\n\n> **Версия 4.16.0**\n";
  const overviewDir = join(TMP_DIR, "manual_docs", "overview");
  if (!existsSync(overviewDir)) mkdirSync(overviewDir, { recursive: true });
  writeFileSync(
    join(overviewDir, "changelog.md"),
    fakeChangelog
  );
  writeFileSync(
    join(TMP_DIR, "docs", "roadmap.md"),
    "- **Выполнено (7.7.7)** — feature X\n"
  );
  // skills/maestro/SKILL.md — реальное количество строк
  const skillsDir = join(TMP_DIR, "skills", "maestro");
  if (!existsSync(skillsDir)) mkdirSync(skillsDir, { recursive: true });
  writeFileSync(
    join(skillsDir, "SKILL.md"),
    new Array(1172).join("line\n")
  );
  // D1c planted violations: README.md + manual_docs без allowlist-контекста
  writeFileSync(
    join(TMP_DIR, "README.md"),
    "Установленная версия — 7.7.7\n"
  );
  writeFileSync(
    join(mdocsDir, "planted.md"),
    "текущая версия 6.6.6\n"
  );
  const referenceDir = join(TMP_DIR, "manual_docs", "reference");
  if (!existsSync(referenceDir)) mkdirSync(referenceDir, { recursive: true });
  writeFileSync(
    join(referenceDir, "planted.md"),
    "текущая версия 5.5.5\n"
  );
  // D2 probe: maestro-update.sh с не-миграционной строкой на stale имя
  const updateSh = join(TMP_DIR, "maestro-update.sh");
  const originalUpdateSh = read("maestro-update.sh", ROOT);
  writeFileSync(updateSh, originalUpdateSh);
  // D5 fixture: auto-ai-decision-prompt.md (пока без маркера → violation)
  const aiFixDir = join(TMP_DIR, "skills", "maestro");
  if (!existsSync(aiFixDir)) mkdirSync(aiFixDir, { recursive: true });
  writeFileSync(
    join(aiFixDir, "auto-ai-decision-prompt.md"),
    "## Hard Rules\n1. Security rule only\n"
  );
  // D9 fixture: 4-слойные таблицы с ВЕРНЫМ порядком (слой 2 = .maestro/,
  // слой 3 = root) — положительная часть должна пройти
  writeFileSync(join(referenceDir, "config.md"), `# Конфигурация\n\n${D9_TABLE}\n`);
  const explFixDir = join(TMP_DIR, "manual_docs", "explanation");
  if (!existsSync(explFixDir)) mkdirSync(explFixDir, { recursive: true });
  writeFileSync(
    join(explFixDir, "agents-and-trust.md"),
    `# Trust-модель\n\n${D9_TABLE}\n`
  );
}

// ============================================================
// Tests
// ============================================================

test("docs-drift fixtures: каждый check возвращает нарушения", () => {
  createFixtures();
  // D1a — AGENTS.md версия 8.8.8 != 9.9.9
  const d1a = checkD1(TMP_DIR);
  assert.ok(
    d1a.some((v) => v.includes("AGENTS.md") && v.includes("8.8.8")),
    `D1a fixture violation: ${JSON.stringify(d1a)}`
  );
  // D1b — project-context версия 8.8.8 != 9.9.9
  assert.ok(
    d1a.some((v) => v.includes("project-context") && v.includes("8.8.8")),
    `D1b fixture violation: ${JSON.stringify(d1a)}`
  );
  // D1c — planted stale version в README.md
  assert.ok(
    d1a.some((v) => v.includes("README.md") && v.includes("7.7.7")),
    `D1c planted README fixture violation: ${JSON.stringify(d1a)}`
  );
  // D1c — planted stale version в manual_docs/how-to/planted.md
  assert.ok(
    d1a.some((v) => v.includes("planted.md") && v.includes("6.6.6")),
    `D1c planted manual_docs fixture violation: ${JSON.stringify(d1a)}`
  );
  // D1c — planted stale version в manual_docs/reference/planted.md
  assert.ok(
    d1a.some((v) => v.includes("reference/planted.md") && v.includes("5.5.5")),
    `D1c planted reference fixture violation: ${JSON.stringify(d1a)}`
  );
  // D2 — stale name feature-agent
  const d2 = checkD2(TMP_DIR);
  assert.ok(
    d2.some((v) => v.includes("drift.md") && v.includes("feature-agent")),
    `D2 fixture violation: ${JSON.stringify(d2)}`
  );
  // D2 probe — stale имя в .sh без миграционного контекста
  writeFileSync(
    join(TMP_DIR, "maestro-update.sh"),
    read("maestro-update.sh", ROOT) + "# old name code-reviewer\n"
  );
  const d2probe = checkD2(TMP_DIR);
  assert.ok(
    d2probe.some((v) => v.includes("maestro-update.sh") && v.includes("code-reviewer")),
    `D2 probe fixture: ${JSON.stringify(d2probe)}`
  );
  // D3 — метка 1300 vs SKILL.md 1171, diff > 50
  const d3 = checkD3(TMP_DIR);
  assert.ok(
    d3.some((v) => v.includes("обнови метку")),
    `D3 fixture violation: ${JSON.stringify(d3)}`
  );
  // D4 — «Выполнено (7.7.7)» нет в changelog
  const d4 = checkD4(TMP_DIR);
  assert.ok(
    d4.some((v) => v.includes("7.7.7") && v.includes("changelog")),
    `D4 fixture violation: ${JSON.stringify(d4)}`
  );
  // D6 — в fixture нет maestro-install.sh (maestro-update.sh есть — D2 probe) → violation
  const d6 = checkD6(TMP_DIR);
  assert.deepEqual(
    d6,
    ["корневой скрипт maestro-install.sh не найден (delivery сломана)"],
    `D6 fixture violation: ${JSON.stringify(d6)}`
  );
  // D6 real fixture: скрипт создан → 0 нарушений
  writeFileSync(join(TMP_DIR, "maestro-install.sh"), "#!/bin/sh\n");
  assert.deepEqual(
    checkD6(TMP_DIR),
    [],
    `D6 real fixture should pass: ${JSON.stringify(checkD6(TMP_DIR))}`
  );
  // D7 — planted legacy-имя доставки в how-to
  writeFileSync(
    join(TMP_DIR, "manual_docs", "how-to", "legacy-planted.md"),
    "Доставка через legacy-пакетный менеджер AgPack\n"
  );
  const d7 = checkD7(TMP_DIR);
  assert.ok(
    d7.some((v) => v.includes("legacy-planted.md")),
    `D7 fixture violation: ${JSON.stringify(d7)}`
  );
  // D7 — planted имя в index.md тоже ловится
  writeFileSync(
    join(TMP_DIR, "manual_docs", "index.md"),
    "Навигация: установка через AgPack\n"
  );
  const d7b = checkD7(TMP_DIR);
  assert.ok(
    d7b.some((v) => v.includes("manual_docs/index.md")),
    `D7 index.md fixture violation: ${JSON.stringify(d7b)}`
  );
  // D8 — planted legacy-имя в README.md (без исторической пометки) → violation
  const readmeBase = readFileSync(join(TMP_DIR, "README.md"), "utf8");
  writeFileSync(
    join(TMP_DIR, "README.md"),
    readmeBase + "Доставка через agpack sync\n"
  );
  const d8 = checkD8(TMP_DIR);
  assert.ok(
    d8.some((v) => v.includes("README.md") && v.includes("agpack")),
    `D8 fixture violation: ${JSON.stringify(d8)}`
  );
  // D8 — planted legacy-имя в explanation → violation
  const explDir = join(TMP_DIR, "manual_docs", "explanation");
  if (!existsSync(explDir)) mkdirSync(explDir, { recursive: true });
  writeFileSync(
    join(explDir, "planted.md"),
    "Настройка через agpack\n"
  );
  assert.ok(
    checkD8(TMP_DIR).some((v) => v.includes("explanation/planted.md")),
    `D8 explanation fixture violation: ${JSON.stringify(checkD8(TMP_DIR))}`
  );
  // D8 — историческая пометка «удалён в 6.0.0» → allowlist (0 нарушений)
  writeFileSync(
    join(TMP_DIR, "README.md"),
    readmeBase + "Legacy-механизм доставки agpack удалён в 6.0.0\n"
  );
  rmSync(join(explDir, "planted.md"), { force: true });
  const d8allow = checkD8(TMP_DIR);
  assert.deepEqual(
    d8allow,
    [],
    `D8 history-allowlist fixture should pass: ${JSON.stringify(d8allow)}`
  );
  // D9 — положительная: 4-слойные таблицы с верным порядком (слой 2 =
  // .maestro/, слой 3 = root) → 0 нарушений
  assert.deepEqual(
    checkD9(TMP_DIR),
    [],
    `D9 fixture: correct-order tables should pass: ${JSON.stringify(
      checkD9(TMP_DIR)
    )}`
  );
  // D9 — set-mention (неупорядоченное перечисление без приоритета) НЕ триггерит
  const customizeFix = join(
    TMP_DIR,
    "manual_docs",
    "how-to",
    "customize-maestro.md"
  );
  writeFileSync(
    customizeFix,
    "Слои конфига — неупорядоченный набор: (root `<project>/maestro.json`, " +
      "`<project>/.maestro/maestro.json`, глобальный) — приоритет не описан.\n"
  );
  assert.deepEqual(
    checkD9(TMP_DIR),
    [],
    `D9 fixture: set-mention should not trigger: ${JSON.stringify(
      checkD9(TMP_DIR)
    )}`
  );
  // D9 — цепочка `→` старого порядка в «живом» доке (whitelist) → violation
  writeFileSync(
    customizeFix,
    readFileSync(customizeFix, "utf8") +
      "Приоритет: `MAESTRO_CONFIG` env → `<project>/maestro.json` (в git) → " +
      "`<project>/.maestro/maestro.json` (вне git) → глобальный.\n"
  );
  assert.ok(
    checkD9(TMP_DIR).some((v) => v.includes("customize-maestro.md")),
    `D9 fixture: old arrow-chain in live doc should fail: ${JSON.stringify(
      checkD9(TMP_DIR)
    )}`
  );
  // D9 — та же цепочка старого порядка в «историческом» файле (changelog,
  // вне whitelist) → PASS (не сканируется)
  const changelogFix = join(TMP_DIR, "manual_docs", "overview", "changelog.md");
  writeFileSync(
    changelogFix,
    readFileSync(changelogFix, "utf8") +
      "- **4-слойный конфиг:** `MAESTRO_CONFIG` env → `<project>/maestro.json` " +
      "(в git) → `<project>/.maestro/maestro.json` (вне git) → глобальный.\n"
  );
  assert.ok(
    !checkD9(TMP_DIR).some((v) => v.includes("changelog")),
    `D9 fixture: historical changelog must not be scanned: ${JSON.stringify(
      checkD9(TMP_DIR)
    )}`
  );
  // D9 — цепочка `>` старого порядка (multi-line) в whitelist-доке → violation
  const memoryFix = join(
    TMP_DIR,
    "manual_docs",
    "how-to",
    "memory-backup-restore.md"
  );
  writeFileSync(
    memoryFix,
    "Резолв: `MAESTRO_CONFIG` env > `<root>/maestro.json` >\n" +
      "`<root>/.maestro/maestro.json` > глобальный\n"
  );
  assert.ok(
    checkD9(TMP_DIR).some((v) => v.includes("memory-backup-restore.md")),
    `D9 fixture: old gt-chain should fail: ${JSON.stringify(
      checkD9(TMP_DIR)
    )}`
  );
  // D9 — нумерованный список: root-пункт ПЕРЕД .maestro/-пунктом → violation
  const pluginFixDir = join(TMP_DIR, "plugins", "maestro-bootstrap");
  if (!existsSync(pluginFixDir)) mkdirSync(pluginFixDir, { recursive: true });
  writeFileSync(
    join(pluginFixDir, "README.md"),
    "Порядок разрешения (4 слоя):\n\n" +
      "1. **`MAESTRO_CONFIG`** (env)\n" +
      "2. **`<project>/maestro.json`** (в git)\n" +
      "3. **`<project>/.maestro/maestro.json`** (вне git)\n" +
      "4. **`<globalDir>/maestro.json`** (глобальный)\n"
  );
  assert.ok(
    checkD9(TMP_DIR).some((v) => v.includes("maestro-bootstrap/README.md")),
    `D9 fixture: old numbered list should fail: ${JSON.stringify(
      checkD9(TMP_DIR)
    )}`
  );
  // D9 — таблица с НЕверным порядком (root = слой 2) → violation
  const configFix = join(TMP_DIR, "manual_docs", "reference", "config.md");
  writeFileSync(
    configFix,
    "# Конфигурация\n" +
      "\n" +
      [
        "| # | Слой | Путь | Где живёт |",
        "|---|---|---|---|",
        "| 1 | `MAESTRO_CONFIG` (env) | произвольный путь | debug-only |",
        "| 2 | Проектный (командный) | `<project>/maestro.json` | в git |",
        "| 3 | Проектный (локальный) | `<project>/.maestro/maestro.json` | вне git |",
        "| 4 | Глобальный (машинный) | `~/.config/opencode/.maestro/maestro.json` | машина |",
      ].join("\n") +
      "\n"
  );
  assert.ok(
    checkD9(TMP_DIR).some(
      (v) => v.includes("reference/config.md") && v.includes("слоя 2")
    ),
    `D9 fixture: wrong-order table should fail: ${JSON.stringify(
      checkD9(TMP_DIR)
    )}`
  );
  // D9 — возврат верного порядка в таблице → табличная часть чистая
  writeFileSync(configFix, `# Конфигурация\n\n${D9_TABLE}\n`);
  const d9tables = checkD9(TMP_DIR).filter(
    (v) =>
      v.includes("reference/config.md") || v.includes("agents-and-trust.md")
  );
  assert.deepEqual(
    d9tables,
    [],
    `D9 fixture: correct-order tables should pass after restore: ${JSON.stringify(
      d9tables
    )}`
  );
  // D10 — inline-канон с удалёнными секциями (trust/confidential) → violation
  const assistantFixDir = join(TMP_DIR, "skills", "maestro-assistant");
  if (!existsSync(assistantFixDir)) mkdirSync(assistantFixDir, { recursive: true });
  writeFileSync(
    join(assistantFixDir, "SKILL.md"),
    [
      "# Maestro Assistant",
      "",
      "## Канон `maestro.json`",
      "",
      "```json",
      "{",
      '  "trust": { "custodian": true, "sanitizer": true },',
      '  "confidential": { "paths": ["docs/confidential/**"] },',
      '  "sanitizer_whitelist": {}',
      "}",
      "```",
      "",
    ].join("\n")
  );
  const d10 = checkD10(TMP_DIR);
  assert.ok(
    d10.some((v) => v.includes('"confidential"')),
    `D10 fixture violation (confidential): ${JSON.stringify(d10)}`
  );
  assert.ok(
    d10.some((v) => v.includes('"trust"')),
    `D10 fixture violation (trust): ${JSON.stringify(d10)}`
  );
  // D10 — канон без удалённых секций → 0 нарушений
  writeFileSync(
    join(assistantFixDir, "SKILL.md"),
    [
      "# Maestro Assistant",
      "",
      "## Канон `maestro.json`",
      "",
      "```json",
      "{",
      '  "sanitizer_whitelist": {}',
      "}",
      "```",
      "",
    ].join("\n")
  );
  assert.deepEqual(
    checkD10(TMP_DIR),
    [],
    `D10 fixture: clean canon should pass: ${JSON.stringify(checkD10(TMP_DIR))}`
  );
  // D5 — pipeline compliance: все маркеры отсутствуют в fixture → violation
  const d5 = checkD5(TMP_DIR);
  assert.ok(
    d5.some((v) => v.includes("SKILL.md")),
    `D5 fixture violation (SKILL.md): ${JSON.stringify(d5)}`
  );
  assert.ok(
    d5.some((v) => v.includes("auto-ai-decision-prompt")),
    `D5 fixture violation (auto-ai-prompt): ${JSON.stringify(d5)}`
  );
  // D5 real repo fixture: добавить маркеры в fixture SKILL.md и auto-ai-prompt
  const skillFix = join(TMP_DIR, "skills", "maestro", "SKILL.md");
  writeFileSync(
    skillFix,
    new Array(1172).join("line\n") +
    "🟡 17. -- HITL GATE: pre-PR\nВсегда HITL (⚑1)\n" +
    "🟢 18. [agent] finishing\nBump версии (если project context §3: Версионирование: да)\n" +
    "Простая фича: после SDD шаги 14–18.5 для всех категорий\n"
  );
  const aiFixDir = join(TMP_DIR, "skills", "maestro");
  writeFileSync(
    join(aiFixDir, "auto-ai-decision-prompt.md"),
    "## Hard Rules\n1. **Merge/push hard-rule (⚑1).** Decisions on merge — HITL_REQUIRED.\n"
  );
  const d5fix = checkD5(TMP_DIR);
  assert.deepEqual(
    d5fix,
    [],
    `D5 real fixture should pass after markers added: ${JSON.stringify(d5fix)}`
  );
});

test("docs-drift real repo: 0 нарушений", () => {
  let totalViolations = 0;
  let all = [];

  const d1 = checkD1(ROOT);
  if (d1.length) {
    totalViolations += d1.length;
    all = all.concat(d1);
  }
  const d2 = checkD2(ROOT);
  if (d2.length) {
    totalViolations += d2.length;
    all = all.concat(d2);
  }
  const d3 = checkD3(ROOT);
  if (d3.length) {
    totalViolations += d3.length;
    all = all.concat(d3);
  }
  const d4 = checkD4(ROOT);
  if (d4.length) {
    totalViolations += d4.length;
    all = all.concat(d4);
  }
  const d5 = checkD5(ROOT);
  if (d5.length) {
    totalViolations += d5.length;
    all = all.concat(d5);
  }
  const d6 = checkD6(ROOT);
  if (d6.length) {
    totalViolations += d6.length;
    all = all.concat(d6);
  }
  const d7 = checkD7(ROOT);
  if (d7.length) {
    totalViolations += d7.length;
    all = all.concat(d7);
  }
  const d8 = checkD8(ROOT);
  if (d8.length) {
    totalViolations += d8.length;
    all = all.concat(d8);
  }
  const d9 = checkD9(ROOT);
  if (d9.length) {
    totalViolations += d9.length;
    all = all.concat(d9);
  }
  const d10 = checkD10(ROOT);
  if (d10.length) {
    totalViolations += d10.length;
    all = all.concat(d10);
  }

  assert.deepEqual(
    all,
    [],
    `Найдено ${totalViolations} нарушений дрейфа документации:\n${all.join("\n")}`
  );
});

// D9: link integrity — no broken internal links in README.md, README.en.md, manual_docs/**/*.md
test('D9: link integrity (broken links)', () => {
  const repoRoot = TMP_DIR;
  const violations = [];

  // Collect all MD files
  const mdFiles = [];
  // README.md at root
  const readmePath = join(repoRoot, "README.md");
  if (existsSync(readmePath)) mdFiles.push(readmePath);
  // README.en.md at root
  const readmeEnPath = join(repoRoot, "README.en.md");
  if (existsSync(readmeEnPath)) mdFiles.push(readmeEnPath);
  // manual_docs/**/*.md
  function walkDir(dir) {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walkDir(p);
      else if (e.name.endsWith(".md")) mdFiles.push(p);
    }
  }
  const mdDir = join(repoRoot, "manual_docs");
  if (existsSync(mdDir)) walkDir(mdDir);

  // Parse each file for local markdown links
  const linkRx = /\[([^\]]*)\]\(([^)#\s]+)(?:#[^)\s]*)?\)/g;
  for (const f of mdFiles) {
    const text = readFileSync(f, "utf8");
    let m;
    while ((m = linkRx.exec(text))) {
      const link = m[2];
      // Skip external URLs, anchors only, headers only
      if (/^https?:/.test(link)) continue;
      if (/^#/.test(link)) continue;
      // Resolve relative to the file's directory
      const target = join(dirname(f), link);
      if (!existsSync(target)) {
        violations.push(`${basename(f)} → ${link}`);
      }
    }
  }

  if (violations.length > 0) {
    throw new Error(`${violations.length} broken links found: ${violations.join(", ")}`);
  }
});

after(() => {
  if (TMP_DIR) rmSync(TMP_DIR, { recursive: true, force: true });
});
