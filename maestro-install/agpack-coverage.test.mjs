// Детерминированная проверка реестра доставки (0 LLM, 0 зависимостей).
// Каждый каталог skills/ должен быть зарегистрирован в каноне доставки
// maestro-install/agpack.yml (path: skills/<name>) — иначе скилл не
// доставляется в целевые приложения (команда без скилла, см. инцидент
// 4.13.0 → 4.13.1: maestro-benchmark отсутствовал в каноне).
// Исключения (authoring-only скиллы, не входящие в дистрибутив) — явный
// список ниже; пустой список — ожидаемое состояние.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CANON = join(ROOT, "maestro-install", "agpack.yml");
// Authoring-only скиллы, НЕ входящие в дистрибутив (осознанно):
const DELIVERY_EXEMPT = new Set([]);

test("канон maestro-install/agpack.yml существует и парсится", () => {
  assert.ok(existsSync(CANON), "maestro-install/agpack.yml не найден");
  assert.doesNotThrow(() => readFileSync(CANON, "utf8"));
});

test("каждый каталог skills/ зарегистрирован в каноне доставки", () => {
  const canon = readFileSync(CANON, "utf8");
  const skillsDir = join(ROOT, "skills");
  const skills = readdirSync(skillsDir).filter(
    (name) => statSync(join(skillsDir, name)).isDirectory()
  );
  assert.ok(skills.length > 0, "skills/ пуст — тест не имеет смысла");
  const missing = skills.filter(
    (name) =>
      !DELIVERY_EXEMPT.has(name) &&
      !new RegExp(`^\\s*path:\\s*skills/${name}\\s*$`, "m").test(canon)
  );
  assert.deepEqual(
    missing,
    [],
    `Скиллы не зарегистрированы в maestro-install/agpack.yml (доставка сломана): ${missing.join(", ")}.
Добавь записи в skills-секцию канона (и корневой agpack.yml для dogfooding).`
  );
});

test("в каноне нет записей на несуществующие каталоги skills/", () => {
  const canon = readFileSync(CANON, "utf8");
  const skillsDir = join(ROOT, "skills");
  const registered = [...canon.matchAll(/^\s*path:\s*skills\/(\S+)\s*$/gm)]
    .map((m) => m[1])
    .filter((p) => !p.includes("/"));
  const stale = registered.filter((name) => !existsSync(join(skillsDir, name)));
  assert.deepEqual(
    stale,
    [],
    `В каноне остались записи на несуществующие скиллы (stale после rename/удаления): ${stale.join(", ")}`
  );
});
