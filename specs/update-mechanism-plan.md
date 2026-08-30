# Доработка процесса обновления maestro — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Сделать обновление maestro одной операцией (`maestro-update.sh`) и сделать застрявший кэш плагина / рассинхрон версий видимым через `/maestro-version`.

**Architecture:** Три независимых механизма: (1) поле `expected_version` в `maestro.json`, зеркалируемое плагином в `.maestro/expected-version` (semver-метафайл, вынесен из `access_policy` через расширение `isPluginMetaFile`); (2) новый bash-скрипт `maestro-update.sh` (agpack + очистка кэша плагина + merge-add `agpack.yml` + запись `expected_version`); (3) `/maestro-version` сравнивает два метафайла и предупреждает о рассинхроне. `maestro.json` НЕ выносится из `access_policy` (ИБ).

**Tech Stack:** Node.js (ESM плагин, тесты на встроенном runner), bash 3.2+ (скрипт), markdown (доки).

**Spec:** `specs/update-mechanism-design.md`

---

## Задача 1: Расширить `isPluginMetaFile` и добавить зеркалирование `expected_version` в плагине

**Files:**
- Modify: `plugins/maestro-bootstrap/core.js`
- Test: `plugins/maestro-bootstrap/index.test.js`

**Контекст:** `isPluginMetaFile` (core.js:666-668) делает точное сравнение только с `.maestro/plugin-version`. `writePluginVersionFile` (844-852) пишет версию в `.maestro/plugin-version`. Init вызывает `loadMaestroConfig` (884) и `writePluginVersionFile` (898).

- [ ] **Step 1: Расширить `isPluginMetaFile` до набора из двух метафайлов**

В `plugins/maestro-bootstrap/core.js` замени функцию `isPluginMetaFile` (строки 666-668):

```js
export function isPluginMetaFile(root, target) {
  const t = normalizeTarget(root, target);
  return t === ".maestro/plugin-version" || t === ".maestro/expected-version";
}
```

Обнови docstring функции: упомянуть оба файла, что оба semver-only, case-sensitive, fail-closed.

- [ ] **Step 2: Добавить функцию записи `expected_version` метафайла**

Рядом с `writePluginVersionFile` (после строки 852) добавь:

```js
/**
 * Write the mirrored expected version to `<dir>/.maestro/expected-version`.
 * Плагин читает `maestro.json` нативно (loadMaestroConfig, fs без access-гейта)
 * и зеркалит `expected_version` в `.maestro/`-метафайл — он вынесен из
 * `access_policy` через isPluginMetaFile. `.maestro/expected-version` НЕ содержит
 * чувствительных данных (semver). Провал записи молча игнорируется (fail-soft).
 * Если expected_version отсутствует/не строка — метафайл удаляется (чтобы не
 * дать вечный ложный mismatch). @param {string} dir @param {string|undefined} expected
 */
export function writeExpectedVersionFile(dir, expected) {
  const target = path.join(dir, ".maestro/expected-version");
  try {
    fs.mkdirSync(path.join(dir, ".maestro"), { recursive: true });
    if (typeof expected === "string" && expected) {
      fs.writeFileSync(target, expected + "\n", "utf8");
    } else {
      fs.rmSync(target, { force: true });
    }
  } catch (err) {
    // fail-soft: не роняем сессию из-за второстепенного метафайла, НО логируем
    // причину (по прецеденту `audit write failed` / `init failed` в плагине),
    // чтобы не было тихой потери диагностики версии.
    console.error("[maestro-bootstrap] write expected-version failed:", err instanceof Error ? err.message : err);
  }
}
```

> **Опциональное улучшение (не блокирует):** существующие `writePluginVersionFile`
> (core.js:844-852) и `readPluginVersion` (827-835) используют пустой `catch {}` без
> логирования — тот же риск тихой потери диагностики. По желанию добавить в них
> `console.error` по этому же прецеденту (отдельный мелкий коммит).

- [ ] **Step 3: Вызвать зеркалирование в init**

В `MaestroBootstrapPlugin` (core.js), после `const config = loadMaestroConfig(...)` (строка 884) и рядом с `writePluginVersionFile(root, version)` (строка 898), добавь вызов:

```js
  writeExpectedVersionFile(root, config?.expected_version);
```

- [ ] **Step 4: Добавить проверку рассинхрона + stderr**

В `MaestroBootstrapPlugin`, после `writeExpectedVersionFile`, добавь проверку и предупреждение:

```js
  const expectedVersion = typeof config?.expected_version === "string" ? config.expected_version : undefined;
  if (version && expectedVersion && version !== expectedVersion) {
    const msg = `[maestro-bootstrap] ВНИМАНИЕ: плагин версии ${version}, ожидается ${expectedVersion} (maestro.json). Кэш плагина, вероятно, устарел — выполните maestro-update.sh и перезапустите opencode.`;
    log.warn("plugin.version_mismatch", { current: version, expected: expectedVersion });
    console.warn(msg);
  }
```

- [ ] **Step 5: Написать юнит-тесты**

В `plugins/maestro-bootstrap/index.test.js` добавь тесты. Найди describe-блок «maestro-bootstrap plugin version» (строка ~1501) и добавь туда новые `it`-блоки:

```js
  it("isPluginMetaFile covers expected-version too", () => {
    const dir = process.cwd();
    assert.equal(isPluginMetaFile(dir, ".maestro/plugin-version"), true);
    assert.equal(isPluginMetaFile(dir, ".maestro/expected-version"), true);
    assert.equal(isPluginMetaFile(dir, ".maestro/logs/x.log"), false);
  });

  it("writeExpectedVersionFile writes and removes mirror", () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), "fab-expected-"));
    writeExpectedVersionFile(d, "1.2.0");
    assert.equal(fs.readFileSync(path.join(d, ".maestro/expected-version"), "utf8"), "1.2.0\n");
    writeExpectedVersionFile(d, undefined);
    assert.equal(fs.existsSync(path.join(d, ".maestro/expected-version")), false);
    fs.rmSync(d, { recursive: true, force: true });
  });

  it("read of .maestro/expected-version is NOT blocked by restrictive access_policy", async () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), "fab-expected-acc-"));
    fs.writeFileSync(path.join(d, "maestro.json"), JSON.stringify({
      access_policy: { version: 1, default: "deny", allow: [], ask: [], deny: ["**"] },
    }));
    const hooks = await MaestroBootstrapPlugin({ directory: d });
    const out = { args: { filePath: ".maestro/expected-version" } };
    await hooks["tool.execute.before"]({ tool: "read", sessionID: "root", callID: "c1" }, out);
    assert.ok(true, "expected-version read must not be blocked");
    fs.rmSync(d, { recursive: true, force: true });
  });

  it("read of maestro.json IS still blocked by restrictive access_policy (ИБ)", async () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), "fab-json-acc-"));
    fs.writeFileSync(path.join(d, "maestro.json"), JSON.stringify({
      access_policy: { version: 1, default: "deny", allow: [], ask: [], deny: ["**"] },
    }));
    const hooks = await MaestroBootstrapPlugin({ directory: d });
    const out = { args: { filePath: "maestro.json" } };
    await assert.rejects(
      hooks["tool.execute.before"]({ tool: "read", sessionID: "root", callID: "c2" }, out),
      /access-policy/,
    );
    fs.rmSync(d, { recursive: true, force: true });
  });
```

Проверь, что импорты `isPluginMetaFile`, `writeExpectedVersionFile` уже есть в `index.test.js` (строка 6). Добавь `writeExpectedVersionFile` в импорт, если его нет.

- [ ] **Step 6: Запустить тесты плагина**

Run: `node --test plugins/maestro-bootstrap/index.test.js`
Expected: все тесты PASS (171 + новые).

- [ ] **Step 7: Commit**

```bash
git add plugins/maestro-bootstrap/core.js plugins/maestro-bootstrap/index.test.js
git commit -m "feat(plugin): mirror expected_version + warn on version mismatch"
```

---

## Задача 2: Обновить `/maestro-version` — показ расхождения

**Files:**
- Modify: `commands/maestro-version.md`

**Контекст:** Текущая команда читает только `.maestro/plugin-version`. Нужно читать оба метафайла.

- [ ] **Step 1: Переписать команду**

Замени содержимое `commands/maestro-version.md` на:

```markdown
---
description: Показать версию плагина maestro-bootstrap и расхождение с ожидаемой (из .maestro/plugin-version и .maestro/expected-version)
---

# /maestro-version

Покажи пользователю версию плагина `maestro-bootstrap` и, если она расходится с
ожидаемой, предупреди.

## Действия

1. Прочитай `.maestro/plugin-version` (фактическая версия) через `read`.
2. Прочитай `.maestro/expected-version` (ожидаемая версия) через `read`.
3. Если `.maestro/plugin-version` отсутствует или пуст — сообщи:
   "Плагин maestro-bootstrap не инициализирован или версия неизвестна."
   (файл пишется только при успешной инициализации плагина — признак сбоя init).
4. Если версии равны — сообщи:
   "Подключён плагин maestro-bootstrap версии `<версия>`."
5. Если `.maestro/expected-version` отсутствует — сообщи фактическую версию без
   предупреждения (поле `expected_version` не задано в maestro.json).
6. Если версии различаются — сообщи:
   "Подключён плагин maestro-bootstrap версии `<фактическая>`, ожидается
   `<ожидаемая>` (из maestro.json). Выполните `maestro-update.sh` (или `git pull`
   в авторском репо при ручной установке), затем перезапустите opencode. Если
   `maestro-update.sh` уже выполнен — просто перезапустите opencode."

Все сообщения пользователю — только на русском языке.
```

- [ ] **Step 2: Commit**

```bash
git add commands/maestro-version.md
git commit -m "docs(version): show expected_version mismatch in /maestro-version"
```

---

## Задача 3: Создать `maestro-update.sh`

**Files:**
- Create: `maestro-update.sh`

**Контекст:** По образцу `maestro-init.sh` (flavor, функции `say/info/warn/die`, preflight). URL авторского репо — `https://github.com/wad-jet/maestro.git` (см. `maestro-init.sh:28-30`).

- [ ] **Step 1: Создать скрипт**

Создай `maestro-update.sh` со следующим содержимым (полный код):

```bash
#!/usr/bin/env bash
#
# maestro-update.sh — обновление maestro в целевом проекте.
#
# Обновляет скилы/команды/агенты (agpack sync), очищает кэш плагина OpenCode,
# мержит актуальные записи в agpack.yml, пишет expected_version в maestro.json.
#
# Совместимость: bash 3.2+ (macOS); Windows — через WSL/Git Bash.
#
# Флаги:
#   --pin <sha>   зафиксировать версию плагина #<sha> в конфиге opencode
#                 (по умолчанию — без пина, «последняя версия ветки»)
#   --global      пинить в глобальном конфиге opencode
#   --help        краткая справка и выход
set -euo pipefail

REPO_URL="https://github.com/wad-jet/maestro"
PLUGIN_SPEC="maestro-bootstrap@git+https://github.com/wad-jet/maestro.git"
TMP_DIR="$(mktemp -d 2>/dev/null || mktemp -d -t maestro-update)"
trap 'rm -rf "$TMP_DIR"' EXIT

say()  { printf '%s\n' "$*"; }
info() { printf '\033[1;34m[maestro-update]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[maestro-update] ВНИМАНИЕ:\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31m[maestro-update] ОШИБКА:\033[0m %s\n' "$*" >&2; exit 1; }

usage() {
  cat <<'USAGE'
maestro-update — обновление maestro (скилы + плагин + expected_version).

Использование:
  bash maestro-update.sh [--pin <sha>] [--global] [--help]

Флаги:
  --pin <sha>   зафиксировать версию плагина #<sha> в конфиге opencode.
  --global      регистрировать/пинить в глобальном конфиге (~/.config/opencode/opencode.json).
  --help        показать справку и выйти.

Предусловия: bash (macOS/Linux), git, python3 >= 3.11, agpack.
USAGE
}

PIN=""
GLOBAL_MODE=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --help|-h)   usage; exit 0 ;;
    --global)    GLOBAL_MODE=1 ;;
    --pin)       PIN="${2:-}"; shift; [[ -n "$PIN" ]] || die "--pin требует аргумент <sha>" ;;
    *)           die "неизвестный флаг: $1 (см. --help)" ;;
  esac
  shift
done

# --- 1. Preflight -----------------------------------------------------------

command -v git >/dev/null 2>&1 || die "не найден 'git'."
command -v python3 >/dev/null 2>&1 || die "не найден 'python3'."
if ! command -v agpack >/dev/null 2>&1 && [ ! -x "$HOME/.local/bin/agpack" ]; then
  die "не найден 'agpack'. Установите: uv tool install agpack  (или pipx install agpack), затем повторите."
fi
AGPACK="$(command -v agpack 2>/dev/null || echo "$HOME/.local/bin/agpack")"

# --- 2. Определение целевой версии (сеть, read-only, до мутаций) ------------

info "получаю актуальную версию из $REPO_URL..."
if [[ -n "$PIN" ]]; then
  git init -q "$TMP_DIR" && git -C "$TMP_DIR" remote add origin "$REPO_URL.git"
  git -C "$TMP_DIR" fetch -q --depth 1 origin "$PIN" || die "не удалось получить коммит $PIN"
  TARGET_VERSION="$(git -C "$TMP_DIR" show "$PIN:package.json" | python3 -c 'import json,sys; print(json.load(sys.stdin)["version"])' 2>/dev/null)" \
    || die "в коммите $PIN нет валидного package.json с version"
  MAESTRO_INIT_AGPACK="$(git -C "$TMP_DIR" show "$PIN:maestro-init/agpack.yml" 2>/dev/null || true)"
else
  git clone -q --depth 1 "$REPO_URL.git" "$TMP_DIR" || die "не удалось клонировать $REPO_URL"
  TARGET_VERSION="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["version"])' "$TMP_DIR/package.json")"
  MAESTRO_INIT_AGPACK="$(cat "$TMP_DIR/maestro-init/agpack.yml" 2>/dev/null || true)"
fi
info "целевая версия: $TARGET_VERSION"

# --- 3. Merge-add канонических записей в agpack.yml + agpack sync ------------

if [[ -n "$MAESTRO_INIT_AGPACK" ]]; then
  python3 - "$MAESTRO_INIT_AGPACK" <<'PY'
import json, sys, yaml
# Merge-add отсутствующих записей из канона (url+path) в agpack.yml проекта.
# yaml может не быть в py3.11 stdlib — используем упрощённый merge по секциям.
canon_text = sys.argv[1]
try:
    import yaml as _y
    canon = _y.safe_load(canon_text)
    with open("agpack.yml") as f:
        proj = _y.safe_load(f) or {}
    changed = False
    for section in ("skills", "commands", "agents"):
        cs = canon.get("dependencies", {}).get(section) or []
        ps = proj.setdefault("dependencies", {}).setdefault(section, [])
        existing = {(d.get("url"), d.get("path")) for d in ps}
        for d in cs:
            key = (d.get("url"), d.get("path"))
            if key not in existing:
                ps.append(d); existing.add(key); changed = True
    if changed:
        with open("agpack.yml", "w") as f:
            _y.safe_dump(proj, f, sort_keys=False, allow_unicode=True)
        print("maestro-update: agpack.yml дополнен каноническими записями")
    else:
        print("maestro-update: agpack.yml актуален")
except ImportError:
    print("maestro-update: python-yaml не найден — пропускаю merge-add agpack.yml (только sync)")
PY
else
  info "maestro-init/agpack.yml не найден в источнике — пропускаю merge-add"
fi

info "запускаю 'agpack sync'..."
"$AGPACK" sync

# --- 4. Очистка кэша плагина OpenCode ---------------------------------------

CACHE_BASE="${XDG_CACHE_HOME:-$HOME/.cache}/opencode/packages"
CACHE_PREFIX="maestro-bootstrap@git+https:"
info "очищаю кэш плагина OpenCode: $CACHE_BASE/${CACHE_PREFIX}*"
MATCHED=0
if [[ -d "$CACHE_BASE" ]]; then
  for d in "$CACHE_BASE"/"$CACHE_PREFIX"*; do
    [[ -e "$d" ]] || continue
    rm -rf "$d"
    MATCHED=$((MATCHED+1))
  done
fi
if [[ "$MATCHED" -eq 0 ]]; then
  warn "кэш плагина не найден по префиксу (возможно, layout изменился) — перезапустите opencode вручную после обновления скилов"
else
  info "удалено записей кэша: $MATCHED"
fi

# --- 5. Запись expected_version в maestro.json --------------------------------

if [[ -f "maestro.json" ]]; then
  python3 - "$TARGET_VERSION" <<'PY'
import json, sys
p = "maestro.json"
target = sys.argv[1]
with open(p, "r", encoding="utf-8") as f:
    data = json.load(f)
data["expected_version"] = target
with open(p, "w", encoding="utf-8") as f:
    json.dump(data, f, ensure_ascii=False, indent=2)
    f.write("\n")
print("maestro-update: expected_version = %s записан в maestro.json" % target)
PY
else
  warn "maestro.json не найден — expected_version не записан (выполните /maestro-init)"
fi

# --- 6. Пин версии (опционально) ---------------------------------------------

CONFIG_FILE="$HOME/.config/opencode/opencode.json"
[[ "$GLOBAL_MODE" -eq 0 ]] && CONFIG_FILE=".opencode/opencode.json"

python3 - "$CONFIG_FILE" "$PLUGIN_SPEC" "$PIN" <<'PY'
import json, os, sys
config_path, plugin_spec, pin = sys.argv[1], sys.argv[2], sys.argv[3] or ""
data = {}
if os.path.exists(config_path):
    with open(config_path, "r", encoding="utf-8") as f:
        c = f.read().strip()
        if c:
            data = json.loads(c)
plugins = data.get("plugin") or []
new_plugins = []
for p in plugins:
    if p == plugin_spec or p.startswith(plugin_spec + "#"):
        continue  # убрать существующую запись (и пин)
if pin:
    new_plugins.append(plugin_spec + "#" + pin)
else:
    new_plugins.append(plugin_spec)
data["plugin"] = new_plugins
os.makedirs(os.path.dirname(config_path), exist_ok=True)
with open(config_path, "w", encoding="utf-8") as f:
    json.dump(data, f, ensure_ascii=False, indent=2)
    f.write("\n")
print("maestro-update: плагин %s%s зарегистрирован в %s" % (plugin_spec, "#"+pin if pin else "", config_path))
PY

# --- 7. Инструкция -----------------------------------------------------------

cat <<EOT

[maestro-update] Готово.
  - целевая версия: $TARGET_VERSION
  - expected_version записан в maestro.json (если он существует)
  - кэш плагина очищен
  - плагин: $PLUGIN_SPEC${PIN:+#$PIN}

Что дальше:
  1. Перезапустите opencode (обязательно — плагин загрузится заново).
  2. Проверьте версию: /maestro-version  (должна быть $TARGET_VERSION)

Русский — рабочий язык. Источник: $REPO_URL
EOT
```

> **Примечание по merge-add (python-yaml):** если в py3.11 нет `yaml`, скрипт делает только `agpack sync` и пишет предупреждение. Это допустимая деградация (не блокирует). Для полного merge-add можно `pip install pyyaml`, но это не обязательное требование.

- [ ] **Step 2: Сделать исполняемым**

```bash
chmod +x maestro-update.sh
```

- [ ] **Step 3: Commit**

```bash
git add maestro-update.sh
git commit -m "feat(update): add maestro-update.sh"
```

---

## Задача 4: Обновить канон конфигурации и скиллы

**Files:**
- Modify: `maestro.json` (канон в этом репо, для консистентности)
- Modify: `skills/maestro-assistant/SKILL.md` (канон `maestro.json`)
- Modify: `skills/maestro-init/SKILL.md` (запись `expected_version` при первичной установке)

**Контекст:** `skills/maestro-assistant/SKILL.md` содержит канон `maestro.json` (JSON-блок). `skills/maestro-init/SKILL.md` описывает задачи init (включая конфигурацию).

- [ ] **Step 1: Обновить канон в `maestro.json`**

Добавь `"expected_version": "1.2.0"` в корневой `maestro.json` (этот репо), после `trust`:

```json
{
  "trust": { "custodian": true, "sanitizer": true },
  "expected_version": "1.2.0",
  "access_policy": { ... },
  ...
}
```

- [ ] **Step 2: Обновить канон в `skills/maestro-assistant/SKILL.md`**

В JSON-каноне `maestro.json` (в скилле) добавь `"expected_version": "1.2.0"` после `trust`, и добавь строку в секцию «Секции (семантика)»:

> **`expected_version`** — ожидаемая версия дистрибутива maestro (пишется `maestro-update.sh` / `/maestro-init`). Опционально; плагин зеркалирует её в `.maestro/expected-version` и предупреждает при рассинхроне с фактической.

- [ ] **Step 3: Обновить `skills/maestro-init/SKILL.md`**

В задаче «3. Конфигурация maestro» (где генерируется `maestro.json`) добавь шаг: при создании/обновлении `maestro.json` записать `expected_version` = актуальную версию из HEAD авторского репо `wad-jet/maestro` (сеть, temp-клон по образцу `maestro-update.sh`; НЕ из кэша — иначе устаревший кэш «легализуется»).

- [ ] **Step 4: Commit**

```bash
git add maestro.json skills/maestro-assistant/SKILL.md skills/maestro-init/SKILL.md
git commit -m "docs(config): add expected_version to maestro.json canon + init"
```

---

## Задача 5: Обновить документацию

**Files:**
- Modify: `manual_docs/how-to/update-maestro.md`
- Modify: `manual_docs/how-to/install-maestro.md`
- Modify: `manual_docs/reference/commands.md`
- Modify: `manual_docs/reference/config.md`
- Modify: `README.md`
- Modify: `manual_docs/overview/changelog.md`
- Modify: `plugins/maestro-bootstrap/README.md`
- Modify: `SECURITY.md`
- Modify: `manual_docs/explanation/agents-and-trust.md`

**Контекст:** Док-синк по AGENTS.md (обязателен для изменений команд/конфига). Исправить ложное «перезапуск подтянет версию».

- [ ] **Step 1: Обновить `manual_docs/how-to/update-maestro.md`**

Исправь раздел «Шаг 2: Обновление плагина»: убрать ложное «OpenCode получает последнюю версию из ветки при старте сессии» → реальный процесс (плагин кэшируется, кэш не обновляется при рестарте). Добавь `maestro-update.sh` как основной способ (в начало). Отметь, что `maestro-init.sh` — только первичная установка. Добавь оговорку про merge-add-семантику (устаревшие записи в `agpack.yml` не удаляются) и конвенцию «новый компонент → запись в maestro-init/agpack.yml».

- [ ] **Step 2: Обновить `manual_docs/how-to/install-maestro.md`**

В «Вариант 0» и «Подключение плагина» добавь ссылку: обновление после установки — `maestro-update.sh` (см. `update-maestro.md`).

- [ ] **Step 3: Обновить `manual_docs/reference/commands.md`**

В описание `/maestro-version` добавь: показывает расхождение с `expected_version` (из `.maestro/expected-version`).

- [ ] **Step 4: Обновить `manual_docs/reference/config.md`**

В секцию про `maestro.json` добавь `expected_version` (семантика, кто пишет, зеркалирование в `.maestro/expected-version`).

- [ ] **Step 5: Обновить `README.md`**

В раздел «2.5. Как обновить maestro» добавь `maestro-update.sh` как основной способ; исправь «Плагин: перезапуск OpenCode подтянет последнюю версию из git» на реальный механизм (кэш + очистка).

- [ ] **Step 6: Обновить `manual_docs/overview/changelog.md`**

Добавь запись: `maestro-update.sh`, `expected_version`, предупреждение о рассинхроне версий.

- [ ] **Step 7: Обновить `plugins/maestro-bootstrap/README.md`**

Добавь: warn `plugin.version_mismatch` при рассинхроне; метафайл `.maestro/expected-version`.

- [ ] **Step 8: Обновить `SECURITY.md`**

Добавь требование: `maestro.json` (в т.ч. `sanitizer_whitelist.patterns`) НЕ выносится из-под `access_policy`; предупреждение о версии использует только `.maestro/`-метафайлы (semver-only), без ослабления доступа к конфигу.

- [ ] **Step 9: Обновить `manual_docs/explanation/agents-and-trust.md`**

Синк с SECURITY.md: отметить, что `maestro.json` остаётся за `access_policy`; расширение `isPluginMetaFile` касается только двух semver-метафайлов.

- [ ] **Step 10: Commit**

```bash
git add manual_docs/ README.md plugins/maestro-bootstrap/README.md SECURITY.md
git commit -m "docs(update): document maestro-update.sh + expected_version + cache mechanics"
```

---

## Задача 6: Проверка и регрессия

**Files:**
- Modify: (проверка, не создание)

- [ ] **Step 1: Запустить все тесты плагина**

Run: `node --test plugins/maestro-bootstrap/index.test.js`
Expected: все PASS (171 + новые).

- [ ] **Step 2: Проверить синтаксис bash-скрипта**

Run: `bash -n maestro-update.sh`
Expected: без ошибок (exit 0).

- [ ] **Step 3: Ручная проверка в песочнице (sandbox)**

Скопируй фикстуру в temp-каталог, создай минимальный `agpack.yml` и `maestro.json`, запусти `bash maestro-update.sh` (в режиме, не трогающем реальный кэш — или с фейковым `XDG_CACHE_HOME`). Проверь:
- скрипт не падает и идемпотентен на повторный запуск;
- `expected_version` записан в `maestro.json`;
- кэш по префиксу очищен;
- `agpack.yml` дополнен (если python-yaml доступен);
- `--pin <sha>` пишет `#<sha>`; без `--pin` снимает существующий `#<sha>`.

- [ ] **Step 4: Финал — проверить, что нет незакоммиченного кода**

Run: `git status`
Expected: чистое дерево (все задачи закоммичены).