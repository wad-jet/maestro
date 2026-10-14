#!/usr/bin/env bash
#
# maestro-update.sh — обновление maestro в целевом проекте.
#
# Обновляет скилы/команды/агенты (agpack sync), очищает кэш плагина OpenCode,
# мержит актуальные записи в agpack.yml.
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

SCRIPT_PATH="${BASH_SOURCE[0]}"
ORIG_ARGS=("$@")   # сохранить до парсинга флагов — для re-exec после самообновления

say()  { printf '%s\n' "$*"; }
info() { printf '\033[1;34m[maestro-update]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[maestro-update] ВНИМАНИЕ:\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31m[maestro-update] ОШИБКА:\033[0m %s\n' "$*" >&2; exit 1; }

usage() {
  cat <<'USAGE'
maestro-update — обновление maestro (скилы + плагин).

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
  MAESTRO_INSTALL_AGPACK="$(git -C "$TMP_DIR" show "$PIN:maestro-install/agpack.yml" 2>/dev/null || true)"
else
  git clone -q --depth 1 "$REPO_URL.git" "$TMP_DIR" || die "не удалось клонировать $REPO_URL"
  TARGET_VERSION="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["version"])' "$TMP_DIR/package.json" 2>/dev/null)" \
    || die "в $REPO_URL нет валидного package.json с version"
  MAESTRO_INSTALL_AGPACK="$(cat "$TMP_DIR/maestro-install/agpack.yml" 2>/dev/null || true)"
fi
info "целевая версия: $TARGET_VERSION"

# --- 2a. Самопроверка версии скрипта -----------------------------------------

if [ "${MAESTRO_UPDATE_SELF_UPDATED:-}" != "1" ]; then
  info "проверяю актуальность maestro-update.sh..."
  TARGET_SCRIPT="$TMP_DIR/update-target.sh"
  git_show_ok=1
  if [[ -n "$PIN" ]]; then
    git -C "$TMP_DIR" show "$PIN:maestro-update.sh" > "$TARGET_SCRIPT" 2>/dev/null || git_show_ok=0
  else
    git -C "$TMP_DIR" show "HEAD:maestro-update.sh" > "$TARGET_SCRIPT" 2>/dev/null || git_show_ok=0
  fi
  if [ "$git_show_ok" -eq 0 ] || [ ! -s "$TARGET_SCRIPT" ]; then
    rm -f "$TARGET_SCRIPT"
    info "maestro-update.sh отсутствует в целевой версии — самопроверка пропущена"
  else
    cmp_rc=0
    cmp -s "$SCRIPT_PATH" "$TARGET_SCRIPT" || cmp_rc=$?
    case "$cmp_rc" in
      0)
        info "maestro-update.sh актуален"
        ;;
      2)
        warn "нечитаемый файл для сравнения — самопроверка пропущена"
        ;;
      *)
        if [ ! -t 0 ]; then
          die "самобновление недоступно в неинтерактивном режиме; обновите вручную: $REPO_URL (maestro-update.sh) и повторите"
        fi
        say ""
        say "[maestro-update] maestro-update.sh отличается от целевой версии ($TARGET_VERSION)."
        say "  (a) Самообновить скрипт и перезапустить (рекомендую)"
        say "  (b) Продолжить текущим скриптом"
        say "  (c) Стоп"
        while :; do
          printf '[maestro-update] выбор (a/b/c): '
          read -r choice || die "ответ не получен — остановлено"
          case "$choice" in
            a|b|c) break ;;
            *) info "введите a, b или c" ;;
          esac
        done
        case "$choice" in
          a)
            SELF_TMP="$SCRIPT_PATH.tmp.$$"
            if ! cp "$TARGET_SCRIPT" "$SELF_TMP"; then
              rm -f "$SELF_TMP"
              die "не удалось записать новый maestro-update.sh ($SCRIPT_PATH не writable?)"
            fi
            if ! mv "$SELF_TMP" "$SCRIPT_PATH"; then
              rm -f "$SELF_TMP"
              die "не удалось заменить maestro-update.sh"
            fi
            rm -rf "$TMP_DIR"
            exec env MAESTRO_UPDATE_SELF_UPDATED=1 bash "$SCRIPT_PATH" ${ORIG_ARGS[@]+"${ORIG_ARGS[@]}"}
            ;;
          b)
            warn "продолжаю текущим maestro-update.sh (расхождение не устранено)"
            ;;
          c)
            warn "останавливаюсь (выбор пользователя)"
            exit 1
            ;;
        esac
        ;;
    esac
  fi
else
  info "самопроверка пропущена (скрипт только что самообновлён)"
fi

# --- 3. Merge-add канонических записей в agpack.yml + agpack sync ------------

if [[ -n "$MAESTRO_INSTALL_AGPACK" ]]; then
  python3 - "$MAESTRO_INSTALL_AGPACK" <<'PY'
import re
import sys

# Построчный текстовый merge-add: добавляет отсутствующие (url, path)-записи из
# канонического maestro-install/agpack.yml в соответствующие секции `dependencies.*`
# проекта. Сохраняет комментарии и существующие записи без изменений. Не требует
# pyyaml (чистый текст). При ошибке — только sync (деградация из плана).
canon_text = sys.argv[1]

def parse_section(text, section):
    """Извлечь (url, path)-пары из YAML-секции без парсера."""
    recs = []
    cur = None
    for line in text.splitlines():
        m = re.match(r"^\s{4}-\s*url:\s*(\S+)", line)
        if m:
            cur = {"url": m.group(1).strip("\"'"), "path": None}
            continue
        if cur is not None and re.match(r"^\s{6}path:\s*(\S+)", line):
            cur["path"] = re.match(r"^\s{6}path:\s*(\S+)", line).group(1).strip("\"'")
        if cur is not None and cur["path"] is not None:
            recs.append(cur)
            cur = None
    return recs

# Парсим канон по секциям.
canon_sections = {}
for sec in ("skills", "commands", "agents"):
    m = re.search(r"^\s{2}%s:" % sec, canon_text, re.M)
    if m:
        block = canon_text[m.end():]
        nxt = re.search(r"^\s{2}\w+:", block, re.M)
        block = block[:nxt.start()] if nxt else block
        canon_sections[sec] = parse_section(block, sec)

try:
    with open("agpack.yml", "r", encoding="utf-8") as f:
        lines = f.read().splitlines()
except OSError as e:
    sys.stderr.write("maestro-update: не могу прочитать agpack.yml: %s\n" % e)
    sys.exit(1)

def section_range(lines, section):
    """Найти диапазон строк секции `dependencies.<section>` (индексы вставки)."""
    in_deps = False
    for i, ln in enumerate(lines):
        if re.match(r"^dependencies:\s*$", ln):
            in_deps = True
            continue
        if in_deps and re.match(r"^\s{2}\w+:\s*$", ln):
            if ln.strip() == section + ":":
                j = i + 1
                while j < len(lines) and (lines[j].strip() == "" or lines[j].startswith("    ") or lines[j].startswith("#") or re.match(r"^\s{4}-", lines[j])):
                    j += 1
                return i, j
            elif ln.strip() not in ("skills:", "commands:", "agents:", "mcp:"):
                return None, None
    return None, None

changed = False
for sec, recs in canon_sections.items():
    start, end = section_range(lines, sec)
    existing = set()
    for ln in lines:
        m = re.match(r"^\s{6}path:\s*(\S+)", ln)
        if m:
            existing.add(m.group(1).strip("\"'"))
    if start is None:
        # Секции нет — вставить новую после `dependencies:`.
        dep_i = next((i for i, ln in enumerate(lines) if re.match(r"^dependencies:\s*$", ln)), None)
        if dep_i is None:
            continue
        # Собрать блок вставки корректно.
        add = ["  %s:" % sec]
        for r in recs:
            if r["path"] in existing:
                continue
            add.append("    - url: %s" % r["url"])
            add.append("      path: %s" % r["path"])
        if len(add) > 1:
            lines[dep_i + 1:dep_i + 1] = add
            changed = True
        continue
    add = []
    for r in recs:
        if r["path"] in existing:
            continue
        add.append("    - url: %s" % r["url"])
        add.append("      path: %s" % r["path"])
    if add:
        lines[start + 1:start + 1] = add
        changed = True

if changed:
    with open("agpack.yml", "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")
    print("maestro-update: agpack.yml дополнен/обновлён каноническими записями")
else:
    print("maestro-update: agpack.yml актуален")
PY
else
  info "maestro-install/agpack.yml не найден в источнике — пропускаю merge-add"
fi

info "запускаю 'agpack sync'..."
"$AGPACK" sync

# --- 4. Очистка кэша плагина OpenCode ---------------------------------------

CACHE_ROOT="${XDG_CACHE_HOME:-$HOME/.cache}/opencode"
info "очищаю кэш плагина OpenCode (V2: npm/git-maestro-*; legacy: packages/)..."
MATCHED=0
if [[ -d "$CACHE_ROOT" ]]; then
  # V2-layout: npm/git-<repo>-<hash>/<timestamp>/
  for d in "$CACHE_ROOT"/npm/git-maestro-*; do
    [[ -e "$d" ]] || continue
    rm -rf "$d"
    MATCHED=$((MATCHED+1))
  done
  # legacy V1-layout: packages/<spec>/
  for d in "$CACHE_ROOT"/packages/maestro-bootstrap@git+https://github.com/wad-jet/maestro*; do
    [[ -e "$d" ]] || continue
    rm -rf "$d"
    MATCHED=$((MATCHED+1))
  done
fi
if [[ "$MATCHED" -eq 0 ]]; then
  warn "кэш плагина не найден (возможно, чистая установка) — перезапустите opencode вручную после обновления скилов"
else
  info "удалено записей кэша: $MATCHED"
fi

# --- 4a. Перезапуск фоновой службы OpenCode (V2) ----------------------------
#
# В OpenCode V2 плагины принадлежат фоновой службе (`serve --service`),
# а не TUI-клиенту. Перезапуск клиента не перезагружает плагин.
# После очистки кэша в V2 служба должна быть перезапущена, чтобы подхватить
# свежий клон. Предлагаем перезапуск HITL — чтобы не прерывать работу
# пользователя без согласия.

opencode_cmd="$(command -v opencode 2>/dev/null || command -v opencode.exe 2>/dev/null || true)"
if [[ -n "$opencode_cmd" ]]; then
  if "$opencode_cmd" service status >/dev/null 2>&1; then
    warn "обнаружена запущенная служба opencode"
    info "после очистки кэша плагина (V2) службу нужно перезапустить,"
    info "иначе она продолжит использовать старую версию из памяти."
    say ""
    say "[maestro-update] Перезапустить фоновую службу opencode?"
    say "  Это прервёт активные сессии в ТУИ."
    say "  (a) Да, перезапустить"
    say "  (c) Нет, перезапущу вручную: '$opencode_cmd service restart'"
    while :; do
      printf '[maestro-update] выбор (a/c): '
      read -r svc_choice || svc_choice=""
      case "$svc_choice" in
        a)
          info "перезапускаю службу opencode..."
          "$opencode_cmd" service restart || warn "не удалось перезапустить службу (попробуйте вручную: '$opencode_cmd service restart')"
          info "снова проверю статус..."
          if "$opencode_cmd" service status >/dev/null 2>&1; then
            info "служба перезапущена успешно — плагин загрузится заново из свежего кэша"
          else
            warn "служба не ответила после перезапуска — возможно, opencode не установлен"
          fi
          break
          ;;
        c)
          info "перезапуск пропущен (перезапустите вручную: '$opencode_cmd service restart')"
          break
          ;;
        *)
          info "введите a или c"
          ;;
      esac
    done
  else
    info "служба opencode не запущена (кэш всё ещё нужен для первого запуска)"
  fi
else
  info "'opencode' не найден в PATH — перезапуск службы пропущен (сделайте вручную: opencode service restart)"
fi

# --- 5. Пин версии (опционально) ---------------------------------------------

GLOBAL_CONFIG="${XDG_CONFIG_HOME:-$HOME/.config}/opencode/opencode.json"
if [[ "$GLOBAL_MODE" -eq 1 ]]; then
  CONFIG_FILE="$GLOBAL_CONFIG"
elif [[ -f "$GLOBAL_CONFIG" ]] && grep -q "wad-jet/maestro\.git" "$GLOBAL_CONFIG"; then
  # любой spec-вариант (alias/plain/object) — обновляем там, где уже зарегистрирован
  CONFIG_FILE="$GLOBAL_CONFIG"
  info "плагин найден в глобальном конфиге: $CONFIG_FILE"
else
  CONFIG_FILE=".opencode/opencode.json"
fi

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

plugins = data.get("plugins") or []
if not isinstance(plugins, list):
    sys.stderr.write("maestro-update: ключ 'plugins' в %s — не массив; не трогаю.\n" % config_path)
    sys.exit(1)

# Спец-строка плагина из entry: string | dict{"package"} | V1-tuple [spec, opts]
def entry_spec(e):
    if isinstance(e, str):
        return e
    if isinstance(e, dict):
        p = e.get("package")
        return p if isinstance(p, str) else ""
    if isinstance(e, list) and e and isinstance(e[0], str):
        return e[0]
    return ""

# Наша регистрация в любой форме (alias/plain, с pin или без)
def is_ours(e):
    s = entry_spec(e)
    return (s.startswith(plugin_spec) or
            s.startswith("git+https://github.com/wad-jet/maestro.git"))

new_plugins = []
for p in plugins:
    if is_ours(p):
        continue
    new_plugins.append(p)

# Миграция V1→V2: legacy-ключ 'plugin' (singular) вместе с 'plugins' даёт
# двойную регистрацию ("Duplicate plugin ID" в OpenCode V2, toast при старте).
# Выжившие чужие записи переносим в 'plugins', ключ удаляем.
legacy = data.get("plugin")
if isinstance(legacy, str):
    legacy = [legacy]
if isinstance(legacy, list):
    for e in legacy:
        if not is_ours(e) and e not in new_plugins:
            new_plugins.append(e)
    del data["plugin"]
    print("maestro-update: V1→V2 миграция: ключ 'plugin' перенесён в 'plugins'")
elif legacy is not None:
    sys.stderr.write("maestro-update: ключ 'plugin' в %s — не массив/строка; миграция пропущена.\n" % config_path)

if pin:
    new_plugins.append(plugin_spec + "#" + pin)
else:
    new_plugins.append(plugin_spec)
data["plugins"] = new_plugins
os.makedirs(os.path.dirname(config_path), exist_ok=True)
with open(config_path, "w", encoding="utf-8") as f:
    json.dump(data, f, ensure_ascii=False, indent=2)
    f.write("\n")
print("maestro-update: плагин %s%s зарегистрирован в %s (ключ 'plugins', V2)" % (plugin_spec, "#"+pin if pin else "", config_path))
PY

# --- 6. Инструкция -----------------------------------------------------------

cat <<EOT

[maestro-update] Готово.
  - целевая версия: $TARGET_VERSION
  - кэш плагина очищен
  - плагин: $PLUGIN_SPEC${PIN:+#$PIN}

Что дальше:
  1. Перезапустите фоновую службу opencode (обязательно — в V2 плагины принадлежат службе, а не клиенту):
     $opencode_cmd service restart
     (если служба уже перезапущена выше — пропустите)
  2. Проверьте версию: /maestro-version  (покажет фактическую версию плагина)

Русский — рабочий язык. Источник: $REPO_URL
EOT