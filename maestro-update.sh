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
  TARGET_VERSION="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["version"])' "$TMP_DIR/package.json" 2>/dev/null)" \
    || die "в $REPO_URL нет валидного package.json с version"
  MAESTRO_INIT_AGPACK="$(cat "$TMP_DIR/maestro-init/agpack.yml" 2>/dev/null || true)"
fi
info "целевая версия: $TARGET_VERSION"

# --- 3. Merge-add канонических записей в agpack.yml + agpack sync ------------

if [[ -n "$MAESTRO_INIT_AGPACK" ]]; then
  python3 - "$MAESTRO_INIT_AGPACK" <<'PY'
import json, sys
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
try:
    with open(p, "r", encoding="utf-8") as f:
        content = f.read().strip()
        if content:
            data = json.loads(content)
except (json.JSONDecodeError, OSError) as e:
    sys.stderr.write("maestro-update: не могу прочитать %s: %s\n" % (p, e))
    sys.exit(1)
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

CONFIG_FILE="${XDG_CONFIG_HOME:-$HOME/.config}/opencode/opencode.json"
[[ "$GLOBAL_MODE" -eq 0 ]] && CONFIG_FILE=".opencode/opencode.json"

python3 - "$CONFIG_FILE" "$PLUGIN_SPEC" "$PIN" <<'PY'
import json, os, sys
config_path, plugin_spec, pin = sys.argv[1], sys.argv[2], sys.argv[3] or ""
data = {}
if os.path.exists(config_path):
    try:
        with open(config_path, "r", encoding="utf-8") as f:
            c = f.read().strip()
            if c:
                data = json.loads(c)
    except (json.JSONDecodeError, OSError) as e:
        sys.stderr.write("maestro-update: не могу прочитать %s: %s\n" % (config_path, e))
        sys.exit(1)
plugins = data.get("plugin") or []
new_plugins = []
for p in plugins:
    if p == plugin_spec or p.startswith(plugin_spec + "#"):
        continue
    new_plugins.append(p)
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