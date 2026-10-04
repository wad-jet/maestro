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
import { join, dirname } from "node:path";
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

// Fixtures
// ============================================================

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

  assert.deepEqual(
    all,
    [],
    `Найдено ${totalViolations} нарушений дрейфа документации:\n${all.join("\n")}`
  );
});

after(() => {
  if (TMP_DIR) rmSync(TMP_DIR, { recursive: true, force: true });
});
