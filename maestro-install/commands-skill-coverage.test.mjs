// Проверка что команды @maestro-memory* — тонкие лоадеры на скилл maestro-memory
// со своими references-файлами и что скилл зарегистрирован в agpack.yml.
// 0 LLM, 0 зависимостей.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const COMMANDS_DIR = join(ROOT, "commands");
const SKILL_DIR = join(ROOT, "skills", "maestro-memory");
const CANON = join(ROOT, "maestro-install", "agpack.yml");
const CANON_ROOT = join(ROOT, "agpack.yml");

// Маппинг: команда → reference-файл
const COMMANDS = [
  { name: "maestro-memory",   ref: "status.md",     skill: "maestro-memory" },
  { name: "maestro-memory-report", ref: "report.md", skill: "maestro-memory" },
  { name: "maestro-memory-prune",  ref: "prune.md",  skill: "maestro-memory" },
  { name: "maestro-memory-reindex", ref: "reindex.md", skill: "maestro-memory" },
  { name: "maestro-memory-backup", ref: "backup.md", skill: "maestro-memory" },
];

test("каждая команда maestro-memory* содержит ссылку на скилл maestro-memory", () => {
  for (const c of COMMANDS) {
    const cmdPath = join(COMMANDS_DIR, `${c.name}.md`);
    assert.ok(existsSync(cmdPath), `файл команды не найден: ${c.name}`);
    const content = readFileSync(cmdPath, "utf8");
    // Проверяем устойчивый паттерн: 'skill `maestro-memory`' или 'skill 'maestro-memory''
    const hasSkillRef =
      content.includes(`skill \`${c.skill}\``) ||
      content.includes(`skill '${c.skill}'`);
    assert.ok(
      hasSkillRef,
      `${c.name}.md не содержит «skill \`${c.skill}\`» (или одинарные кавычки)`
    );
  }
});

test("каждая команда maestro-memory* ссылается на СВОЙ references/*.md (файл существует)", () => {
  for (const c of COMMANDS) {
    const cmdPath = join(COMMANDS_DIR, `${c.name}.md`);
    const content = readFileSync(cmdPath, "utf8");
    const refPath = join(SKILL_DIR, "references", c.ref);
    assert.ok(
      content.includes(`references/${c.ref}`),
      `${c.name}.md не ссылается на references/${c.ref}`
    );
    assert.ok(
      existsSync(refPath),
      `references/${c.ref} не существует`
    );
  }
});

test("skills/maestro-memory зарегистрирован в обоих agpack.yml", () => {
  const pattern = /^\s*path:\s*skills\/maestro-memory\s*$/m;
  const canon = readFileSync(CANON, "utf8");
  const canonRoot = readFileSync(CANON_ROOT, "utf8");
  assert.ok(
    pattern.test(canon),
    "skills/maestro-memory не найден в maestro-install/agpack.yml"
  );
  assert.ok(
    pattern.test(canonRoot),
    "skills/maestro-memory не найден в root agpack.yml"
  );
});
