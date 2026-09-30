// Guard реорганизации скилла maestro-memory: указатели, сироты, лимит длины.
// 0 LLM, 0 зависимостей.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const dir = dirname(fileURLToPath(import.meta.url)); // skills/maestro-memory/
const skill = readFileSync(join(dir, "SKILL.md"), "utf8");
const refNames = readdirSync(join(dir, "references")).filter((f) => f.endsWith(".md"));
const refs = Object.fromEntries(refNames.map((f) => [f, readFileSync(join(dir, "references", f), "utf8")]));

test("указатели SKILL.md → references/*.md разрешаются", () => {
  const mentioned = [...skill.matchAll(/references\/([\w-]+\.md)/g)].map((m) => m[1]);
  assert.ok(
    mentioned.length >= 5,
    `указателей: ${mentioned.length} (ожидаем >= 5)`
  );
  for (const n of new Set(mentioned))
    assert.ok(existsSync(join(dir, "references", n)), `нет файла: ${n}`);
});

test("нет сирот: каждый references/*.md упомянут в SKILL.md", () => {
  for (const n of refNames)
    assert.ok(
      skill.includes(`references/${n}`),
      `сирота: ${n}`
    );
});

test("ядро ≤ 120 строк", () => {
  const n = skill.split("\n").length;
  assert.ok(n <= 120, `SKILL.md: ${n} строк`);
});
