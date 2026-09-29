// Guard реорганизации SKILL.md → references/: указатели, сироты, шапки,
// лимит длины, внутренние ссылки. 0 LLM, 0 зависимостей.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const dir = dirname(fileURLToPath(import.meta.url)); // skills/maestro/
const skill = readFileSync(join(dir, "SKILL.md"), "utf8");
const refNames = readdirSync(join(dir, "references")).filter((f) => f.endsWith(".md"));
const refs = Object.fromEntries(refNames.map((f) => [f, readFileSync(join(dir, "references", f), "utf8")]));

test("указатели SKILL.md → references/*.md разрешаются", () => {
  const mentioned = [...skill.matchAll(/references\/([\w-]+\.md)/g)].map((m) => m[1]);
  assert.ok(
    mentioned.length >= 10,
    `указателей: ${mentioned.length} (ожидаем >= 10)`
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

test("шапки глав: заголовок и «Канон:»", () => {
  for (const [n, b] of Object.entries(refs)) {
    assert.match(b, /^# .*\(глава\)/m, `${n}: заголовок`);
    assert.ok(b.includes("Канон:"), `${n}: «Канон:»`);
  }
});

test("скелет ≤ 1300 строк", () => {
  const n = skill.split("\n").length;
  assert.ok(n <= 1300, `SKILL.md: ${n} строк`);
});

test("внутренние ссылки глав разрешаются", () => {
  for (const [n, b] of Object.entries(refs)) {
    for (const m of b.matchAll(/references\/([\w-]+\.md)/g))
      assert.ok(
        refNames.includes(m[1]),
        `${n} → ${m[1]}: нет файла`
      );
  }
});
