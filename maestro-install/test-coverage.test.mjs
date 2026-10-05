// Детерминированная проверка регистрации тестов (0 LLM, 0 зависимостей).
// Каждый *.test.mjs / *.test.js в дереве обязан быть зарегистрирован в
// scripts.test или scripts["test:memory"] package.json — иначе тесты тихо
// не прогоняются (инцидент 2026-10-05: timeline.test.mjs не входил в
// npm test, 4 красных теста на main остались незамеченными).
import { readdir, readFile } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import assert from "node:assert/strict";
import { test } from "node:test";

const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
// Токены-файлы: точные пути *.test.{mjs,js} и glob-токены (содержат * или ?).
// Раннер-префиксы (node, --test, кавычки) отбрасываем.
const scriptTokens = [];
for (const key of ["test", "test:memory"]) {
  const script = pkg.scripts?.[key];
  if (typeof script !== "string") continue;
  for (let t of script.trim().split(/\s+/)) {
    t = t.replace(/^['"]|['"]$/g, "");
    if (/\.test\.(mjs|js)$/.test(t) || /[*?]/.test(t)) scriptTokens.push(t);
  }
}
const ALLOWLIST = []; // осознанные исключения (путь, причина)

// Мини-компилятор glob→regex слева направо.
// Цепочка .replace ломает вставленные regex-конструкции (quantifier-«*»
// последующей замены) — инцидент 2026-10-05, правка оркестратором.
function globToRegex(pattern) {
  let out = "";
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === "*") {
      if (pattern[i + 1] === "*") {
        if (pattern[i + 2] === "/") { out += "(?:[^/]+/)*"; i += 2; }
        else { out += ".*"; i += 1; }
      } else {
        out += "[^/]*";
      }
    } else if (ch === "?") {
      out += "[^/]";
    } else if (/[.+^${}()|[\]\\]/.test(ch)) {
      out += "\\" + ch;
    } else {
      out += ch;
    }
  }
  return new RegExp(`^${out}$`);
}

// Зарегистрирован ли repo-relative путь (posix) одним из токенов
// (точное совпадение или glob, включая «?» без «*»).
export function isRegistered(relPath, tokenList) {
  for (const token of tokenList) {
    if (/[*?]/.test(token)) {
      if (globToRegex(token).test(relPath)) return true;
    } else if (relPath === token) {
      return true;
    }
  }
  return false;
}

// Рекурсивный сбор *.test.mjs / *.test.js от корня репо.
async function collectTestFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.isDirectory()) {
      const name = entry.name;
      if (["node_modules", ".opencode", ".sandbox", ".maestro", ".git"].includes(name)) continue;
      files.push(...await collectTestFiles(path.join(dir, name)));
    } else if (entry.isFile()) {
      const n = entry.name;
      if (n.endsWith(".test.mjs") || n.endsWith(".test.js")) {
        files.push(path.join(dir, n));
      }
    }
  }
  return files;
}

const repoRootPath = fileURLToPath(new URL("..", import.meta.url));

test("все .test.* в дереве зарегистрированы в npm-скриптах", async () => {
  const files = await collectTestFiles(repoRootPath);
  const rels = files.map(f => path.relative(repoRootPath, f).replace(/\\/g, "/"));
  const unregistered = rels.filter(rel =>
    !ALLOWLIST.includes(rel) && !isRegistered(rel, scriptTokens)
  );
  assert.strictEqual(unregistered.length, 0, `Незарегистрированные тесты: ${JSON.stringify(unregistered)}`);
});

test("матчер: glob-токены (**/ , * ) и точные пути", () => {
  const tokens = [
    "path/to/file.test.mjs", // точный путь
    "sub/**/*.test.js",      // вложенность 0+
    "**/top.test.js"         // «**» в начале
  ];
  const cases = {
    "path/to/file.test.mjs": true,
    "other/file.test.mjs": false,
    "sub/bar.test.js": true,            // **/ = 0 сегментов
    "sub/foo/bar.test.js": true,
    "sub/foo/deep/bar.test.js": true,   // **/ = N сегментов
    "sub/foo/other.js": false,          // суффикс не тот
    "top.test.js": true,                // **/ = 0 сегментов в начале
    "x/y/top.test.js": true
  };
  for (const [rel, expected] of Object.entries(cases)) {
    assert.strictEqual(isRegistered(rel, tokens), expected, `isRegistered('${rel}') = ${expected}`);
  }
});

test("матчер: «?» без «*» — glob-ветка, ровно один символ", () => {
  const tokens = ["sub/?/bar.test.js", "deep/**/*.test.mjs"];
  const cases = {
    "sub/x/bar.test.js": true,          // «?» = ровно один символ
    "sub/xx/bar.test.js": false,        // «?» не два
    "sub/bar/test.js": false,           // «?/bar.test.js» ≠ «bar/test.js»
    "deep/a/b.test.mjs": true,          // «**/» + точный суффикс
    "deep/a/x/y/b.test.mjs": true
  };
  for (const [rel, expected] of Object.entries(cases)) {
    assert.strictEqual(isRegistered(rel, tokens), expected, `isRegistered('${rel}') = ${expected}`);
  }
});

test("матчер: точный токен без glob-меты — только точное совпадение", () => {
  assert.strictEqual(isRegistered("exact/file.test.js", ["exact/file.test.js"]), true);
  assert.strictEqual(isRegistered("exact/file.test.js/extra", ["exact/file.test.js"]), false);
  assert.strictEqual(isRegistered("exact/file.test.js", ["exact/other.test.js"]), false);
});
