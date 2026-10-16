#!/usr/bin/env bash
#
# maestro-install.sh — установка maestro: skills/commands/agents + плагин.
#
# Доставка (без agpack): git clone (https-only, shallow) + wholesale copy
#   + manifest (схема D2) + атомарные операции (staging + mv, tmp + mv).
#
# Последовательность (install/update):
#   1. Preflight (git, python3 — любой версии, только для JSON).
#   2. Clone maestro + superpowers — ДО любых destructive-действий (clone-first).
#   3. Collision detection: пользовательские объекты без маркера .maestro-deployed
#      → HITL (overwrite / rename '-user' / skip); non-interactive — fail-closed.
#   4. Staging .deploy-staging/ → атомарный swap по каталогам (rm -rf + mv).
#   5. Атомарный manifest (tmp + mv): {"version","sha_m","sha_s","deployed":[...]}.
#   6. Регистрация плагина (de-dup: filter is_ours + append, атомарная запись).
#   7. (global) глобальный maestro.json создаётся при отсутствии
#      (memory: enabled=false — privacy-safe default).
#
# Режимы:
#   --project (default) — проектная: .opencode/ + .maestro/manifest.json
#   --global            — машинная: $XDG_CONFIG_HOME/opencode/ + состояние .maestro/
#
# Опции: --pin <sha>, --dry-run, --migrate, --deinstall [--preserve <csv>], --help.
# Exit codes: 0 — ok, 1 — ошибка, 2 — usage error.
#
# Задокументированное поведение:
#   - --pin <sha>: maestro и superpowers на одном sha; для superpowers, если sha
#     там отсутствует (он не содержит коммитов maestro), — main + warning.
#   - auto-derive namespace (--migrate): алгоритм spec §3.2.3; self-hosted
#     single-component — `domain.unknown.repo`, где domain без TLD (последний
#     сегмент отбрасывается: gitlab.internal → gitlab), чтобы результат
#     соответствовал NAMESPACE_RE memory-модуля (не более 3 сегментов).
#   - Non-interactive (stdin не tty): collision (пользовательские объекты) —
#     abort (fail-closed); --deinstall — принимается 'y' из stdin; удаление
#     agpack-файлов при --migrate — пропускается с warning (не деструктивно).
#
# Совместимость: bash 3.2+ (macOS) — без associative arrays, без mapfile,
# без flock (mkdir-based lock, V18). Все глобальные пути — через XDG_CONFIG_HOME.
set -euo pipefail

# --- Константы ---------------------------------------------------------------

VERSION="6.0.0"
PLUGIN_SPEC="maestro-bootstrap@git+https://github.com/wad-jet/maestro.git"
MAESTRO_URL="https://github.com/wad-jet/maestro"
SUPERPOWERS_URL="https://github.com/obra/superpowers"
MAESTRO_RAW="https://raw.githubusercontent.com/wad-jet/maestro"
DEPLOYED_MARKER=".maestro-deployed"
STALE_LOCK_SECS=1800
EMBEDDING_MODEL="Xenova/paraphrase-multilingual-MiniLM-L12-v2"
TAB=$'\t'

# --- Состояние аргументов (parse_args) ---------------------------------------

MODE=project
DRY_RUN=0
MIGRATE=0
DEINSTALL=0
PIN_SHA=""
PRESERVE_CSV=""

# --- Пути (заполняет main) ----------------------------------------------------

PROJECT_DIR=""
TARGET=""
STATE_DIR=""
CONFIG_FILE=""
LOCK=""
TMP_ROOT=""
STAGING=""
KEEP=""
OWN_LOCK=0
SHA_M=""
SHA_S=""
SELF_PATH="${BASH_SOURCE[0]:-$0}"

# --- Состояние collision ------------------------------------------------------

COLL_SKILLS=()      # "name<TAB>kind" (kind: colliding|orphan)
SKILL_DECISIONS=()  # параллельно COLL_SKILLS: o|r|s (colliding) / r|d (orphan)
SKILL_SKIPS=()      # colliding-имена, которые держим (убираются из staging)
COLL_DIRS=()        # "commands"|"agents" — пользовательский каталог без маркера
DIR_DECISIONS=()    # параллельно COLL_DIRS: o|r|s
DIR_SKIPS=()        # каталоги, которые держим (не деплоим)

# --- Логирование --------------------------------------------------------------

say()  { printf '%s\n' "$*"; }
info() { printf '\033[1;34m[maestro-install]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[maestro-install] ВНИМАНИЕ:\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31m[maestro-install] ОШИБКА:\033[0m %s\n' "$*" >&2; exit 1; }

usage_err() {
  printf '\033[1;31m[maestro-install] ОШИБКА АРГУМЕНТОВ:\033[0m %s\n' "$*" >&2
  usage >&2
  exit 2
}

usage() {
  cat <<'USAGE'
maestro-install — установка maestro (skills/commands/agents + плагин).

Доставка: git clone + wholesale copy + manifest (без agpack).

Использование:
  bash maestro-install.sh [опции]

Режимы:
  --project     проектная установка (default): .opencode/ + .maestro/manifest.json
  --global      машинная установка: $XDG_CONFIG_HOME/opencode/ + состояние .maestro/

Опции:
  --pin <sha>         зафиксировать maestro и superpowers на указанном коммите
                      (для superpowers, если sha там отсутствует — main + warning)
  --dry-run           показать план без каких-либо изменений (0 мутаций)
  --migrate           миграция с legacy-установки (agpack): установка +
                      .maestro/maestro.json (memory: namespace auto-derive) +
                      удаление agpack-файлов (HITL)
  --deinstall         деинсталляция (HITL-подтверждение; удаляются только
                      наши объекты — с маркером .maestro-deployed)
  --preserve <a,b>    для --deinstall: файлы состояния, которые сохраняются
  --help              эта справка

Exit codes: 0 — ok, 1 — ошибка, 2 — usage error.

Предусловия: bash, git, python3 (любой версии), сеть (github.com, https-only).
Non-interactive (stdin не tty): collision — abort; --deinstall — 'y' из stdin.

Примеры:
  bash maestro-install.sh --global                       # машинная установка
  bash maestro-install.sh --global --migrate             # миграция с agpack
  bash maestro-install.sh --global --deinstall --preserve maestro.json
  bash maestro-install.sh --project --dry-run            # план без изменений
USAGE
}

parse_args() {
  while [ $# -gt 0 ]; do
    case "$1" in
      --help|-h) usage; exit 0 ;;
      --project)   MODE=project ;;
      --global)    MODE=global ;;
      --dry-run)   DRY_RUN=1 ;;
      --migrate)   MIGRATE=1 ;;
      --deinstall) DEINSTALL=1 ;;
      --pin)
        [ $# -ge 2 ] || usage_err "--pin требует <sha>"
        case "$2" in --*) usage_err "--pin требует <sha>" ;; esac
        PIN_SHA="$2"; shift ;;
      --preserve)
        [ $# -ge 2 ] || usage_err "--preserve требует <csv> (например: maestro.json,notes.txt)"
        case "$2" in --*) usage_err "--preserve требует <csv>" ;; esac
        PRESERVE_CSV=$(printf '%s' "$2" | tr -d '[:space:]')
        shift ;;
      --*) usage_err "неизвестный флаг: $1 (см. --help)" ;;
      *)  usage_err "неожиданный аргумент: $1 (см. --help)" ;;
    esac
    shift
  done
  if [ "$DEINSTALL" = 0 ] && [ -n "$PRESERVE_CSV" ]; then
    usage_err "--preserve допустим только с --deinstall"
  fi
  if [ "$DEINSTALL" = 1 ] && [ "$MIGRATE" = 1 ]; then
    usage_err "--deinstall несовместим с --migrate"
  fi
  if [ "$DEINSTALL" = 1 ] && [ "$DRY_RUN" = 1 ]; then
    usage_err "--deinstall несовместим с --dry-run"
  fi
  if [ -n "$PIN_SHA" ]; then
    printf '%s' "$PIN_SHA" | grep -Eq '^[0-9a-fA-F]{7,40}$' \
      || usage_err "--pin: <sha> — 7–40 hex-символов"
  fi
}

# --- Общие helpers ------------------------------------------------------------

# V22: clone только https:// (http — abort).
require_https() {
  case "$1" in
    https://*) : ;;
    *) die "URL clone должен начинаться с https:// (получено: $1). http запрещён (V22)." ;;
  esac
}

# mtime (epoch) каталога/файла: BSD stat (macOS) → GNU stat (Linux).
dir_mtime() {
  stat -f %m "$1" 2>/dev/null && return 0
  stat -c %Y "$1" 2>/dev/null && return 0
  return 1
}

# count_items <путь/с glob>... — число существующих объектов (0 при пустом glob).
count_items() {
  local n=0 e
  for e in "$@"; do
    if [ -e "$e" ]; then n=$((n+1)); fi
  done
  printf '%s' "$n"
}

# ask_choice <prompt> <valid-chars> <default> — интерактивный выбор (только tty).
# Prompt — на stderr (stdout захвачен под ответ). Ответ — первый символ или слово.
ask_choice() {
  local prompt="$1" valid="$2" def="$3" ans a1
  while :; do
    printf '%s' "$prompt" >&2
    if ! IFS= read -r ans; then ans="$def"; fi
    ans="${ans:-$def}"
    a1="${ans:0:1}"
    case "$valid" in
      *"$ans"*) printf '%s' "$ans"; return 0 ;;
      *"$a1"*)  printf '%s' "$a1"; return 0 ;;
    esac
    if [ "$ans" = "$def" ]; then printf '%s' "$def"; return 0; fi
    printf '\n  (допустимые ответы: %s)\n' "$valid" >&2
  done
}

# confirm_y <prompt> — y/N; EOF → n. Выводит y|n.
confirm_y() {
  local prompt="$1" ans
  printf '%s' "$prompt"
  if ! IFS= read -r ans; then ans="n"; fi
  case "$ans" in
    [yY]|[yY][eE][sS]*) printf 'y' ;;
    *) printf 'n' ;;
  esac
}

# preserved <name> — имя из whitelist --preserve (CSV без пробелов).
preserved() {
  [ -n "$PRESERVE_CSV" ] || return 1
  case ",$PRESERVE_CSV," in
    *",$1,"*) return 0 ;;
  esac
  return 1
}

# resolve_global_dir — $XDG_CONFIG_HOME/opencode (fallback $HOME/.config).
resolve_global_dir() {
  local cfg="${XDG_CONFIG_HOME:-$HOME/.config}"
  printf '%s' "$cfg/opencode"
}

# --- Lock (mkdir-based, macOS-совместимо, V18) ---------------------------------

# cleanup — trap EXIT/INT/TERM: убрать lock (если наш), tmp clone, staging, keep.
cleanup() {
  if [ -n "${LOCK:-}" ] && [ "${OWN_LOCK:-0}" = 1 ]; then rm -rf "$LOCK"; fi
  if [ -n "${TMP_ROOT:-}" ]; then rm -rf "$TMP_ROOT"; fi
  if [ -n "${STAGING:-}" ]; then rm -rf "$STAGING"; fi
  if [ -n "${KEEP:-}" ]; then rm -rf "$KEEP"; fi
  # пустой state-dir после deinstall — убираем (rmdir не тронет непустой)
  if [ -n "${STATE_DIR:-}" ] && [ -d "$STATE_DIR" ]; then
    rmdir "$STATE_DIR" 2>/dev/null || true
  fi
  return 0
}

# test_pause <point> — тестовый хук для верификации прерывания (spec §5, V9):
# MAESTRO_INSTALL_TEST_PAUSE=<point> останавливает скрипт в указанной точке
# (staging — после cp до swap; pre-manifest — после swap до записи manifest),
# чтобы kill'ом проверить консистентность состояния.
test_pause() {
  local point="$1"
  if [ -n "${MAESTRO_INSTALL_TEST_PAUSE:-}" ] && [ "${MAESTRO_INSTALL_TEST_PAUSE}" = "$point" ]; then
    info "test pause: $point (MAESTRO_INSTALL_TEST_PAUSE)"
    # sleep в фоне + wait: bash исполняет trap (TERM/INT) сразу, а не после 300 c
    sleep 300 &
    wait $! 2>/dev/null || true
  fi
  return 0
}

acquire_lock() {
  if ! mkdir "$LOCK" 2>/dev/null; then
    local mt now
    mt=$(dir_mtime "$LOCK") || mt=""
    now=$(date +%s)
    if [ -n "$mt" ] && [ $((now - mt)) -gt "$STALE_LOCK_SECS" ]; then
      warn "stale lock (старше 30 минут): $LOCK — забираю (takeover)."
      rm -rf "$LOCK"
    fi
    if ! mkdir "$LOCK" 2>/dev/null; then
      die "уже идёт установка (lock: $LOCK). Дождитесь завершения; stale lock (старше 30 минут) забирается автоматически."
    fi
  fi
  OWN_LOCK=1
  printf 'pid=%s mode=%s start=%s\n' "$$" "$MODE" "$(date '+%Y-%m-%d %H:%M:%S')" > "$LOCK/info"
  return 0
}

# --- Clone (clone-first, до любых destructive-действий) ------------------------

pin_checkout() {
  # pin_checkout <dir> <url> <required:0|1> — checkout PIN_SHA; для superpowers
  # (required=0), если sha отсутствует, остаёмся на main + warning.
  local dir="$1" url="$2" required="$3"
  if git -C "$dir" rev-parse --verify --quiet "${PIN_SHA}^{commit}" >/dev/null 2>&1; then
    git -C "$dir" checkout --quiet "$PIN_SHA"
    return 0
  fi
  # shallow-clone: sha добираем отдельным fetch'ем (GitHub позволяет fetch
  # произвольного reachable-sha); при неудаче — поведение по required.
  if git -C "$dir" fetch --quiet --depth 1 origin "$PIN_SHA" 2>/dev/null \
     && git -C "$dir" checkout --quiet "$PIN_SHA"; then
    return 0
  fi
  if [ "$required" = 1 ]; then
    die "--pin: sha $PIN_SHA не найден в $url."
  fi
  warn "--pin: sha $PIN_SHA не найден в $url — использую main (superpowers не содержит коммитов maestro)."
  return 0
}

clone_repos() {
  require_https "$MAESTRO_URL"
  require_https "$SUPERPOWERS_URL"
  local err
  info "clone: $MAESTRO_URL (shallow, https-only)..."
  if ! err=$(git clone --quiet --depth 1 "$MAESTRO_URL" "$TMP_ROOT/maestro" 2>&1); then
    die "не удалось склонировать $MAESTRO_URL: $err (сеть? доступ?)"
  fi
  info "clone: $SUPERPOWERS_URL (shallow, https-only)..."
  if ! err=$(git clone --quiet --depth 1 "$SUPERPOWERS_URL" "$TMP_ROOT/superpowers" 2>&1); then
    die "не удалось склонировать $SUPERPOWERS_URL: $err (сеть? доступ?)"
  fi
  if [ -n "$PIN_SHA" ]; then
    info "pin: $PIN_SHA"
    pin_checkout "$TMP_ROOT/maestro" "$MAESTRO_URL" 1
    pin_checkout "$TMP_ROOT/superpowers" "$SUPERPOWERS_URL" 0
  fi
  return 0
}

# Self-check (global, spec §3.4 p.3): свой скрипт vs копия из того же коммита.
# Расхождение → warning + инструкция (HITL-самообновление; НЕ блокируем).
self_check() {
  [ "$MODE" = global ] || return 0
  local cloned="$TMP_ROOT/maestro/maestro-install.sh"
  [ -f "$cloned" ] || return 0
  if ! diff -q -- "$SELF_PATH" "$cloned" >/dev/null 2>&1; then
    warn "self-check: запущенный maestro-install.sh отличается от версии в коммите $SHA_M."
    say "  HITL-самообновление (обновление НЕ автоматическое). Обновите скрипт:"
    say "    curl -fsSL $MAESTRO_RAW/$SHA_M/maestro-install.sh -o maestro-install.sh"
  fi
  return 0
}

# --- Collision detection (spec §3.1, Review Focus #1) --------------------------

# in_clone_skills <name> — есть ли объект с таким именем в источниках (maestro ∪ superpowers).
in_clone_skills() {
  [ -e "$TMP_ROOT/maestro/skills/$1" ] || [ -e "$TMP_ROOT/superpowers/skills/$1" ]
}

# detect_collisions — сбор пользовательских объектов в целевых каталогах.
# skills: per-item (каталог с маркером внутри = наш).
# commands/agents: directory-level (маркер в самом каталоге = наш).
detect_collisions() {
  local e name kind T
  if [ -d "$TARGET/skills" ]; then
    for e in "$TARGET/skills"/*; do
      [ -e "$e" ] || continue
      name=$(basename "$e")
      if [ -d "$e" ] && [ -f "$e/$DEPLOYED_MARKER" ]; then continue; fi
      if in_clone_skills "$name"; then kind=colliding; else kind=orphan; fi
      COLL_SKILLS+=("$name$TAB$kind")
    done
  fi
  for T in commands agents; do
    if [ -d "$TARGET/$T" ] && [ ! -f "$TARGET/$T/$DEPLOYED_MARKER" ] \
       && [ -n "$(ls -A "$TARGET/$T" 2>/dev/null)" ]; then
      COLL_DIRS+=("$T")
    fi
  done
  return 0
}

# resolve_collisions — dry-run: только листинг; live tty: HITL-выбор;
# live non-tty: fail-closed (die). Заполняет *_DECISIONS.
resolve_collisions() {
  local n=$(( ${#COLL_SKILLS[@]} + ${#COLL_DIRS[@]} ))
  [ "$n" -gt 0 ] || return 0
  local entry name kind T ans
  warn "найдены пользовательские объекты без маркера $DEPLOYED_MARKER (были бы затёрты/удалены):"
  for entry in ${COLL_SKILLS[@]+"${COLL_SKILLS[@]}"}; do
    name="${entry%%"$TAB"*}"
    kind="${entry#*"$TAB"}"
    if [ "$kind" = colliding ]; then
      say "  - skills/$name (конфликт с maestro-объектом)"
    else
      say "  - skills/$name (удалится при полном перезаписывании skills/)"
    fi
  done
  for T in ${COLL_DIRS[@]+"${COLL_DIRS[@]}"}; do
    say "  - $T/ (пользовательский каталог)"
  done

  if [ "$DRY_RUN" = 1 ]; then
    say "  (dry-run: ничего не будет сделано)"
    return 0
  fi

  if [ ! -t 0 ]; then
    die "non-interactive: подтверждённый overwrite невозможен (fail-closed). См. список выше; запустите интерактивно (tty)."
  fi

  SKILL_DECISIONS=()
  DIR_DECISIONS=()
  for entry in ${COLL_SKILLS[@]+"${COLL_SKILLS[@]}"}; do
    name="${entry%%"$TAB"*}"
    kind="${entry#*"$TAB"}"
    if [ "$kind" = colliding ]; then
      ans=$(ask_choice "skills/$name: (o) overwrite — удалить пользовательский, поставить maestro | (r) rename — пользовательский станет 'skills/$name-user' | (s) skip — оставить только пользовательский [r]: " "ors" "r")
    else
      ans=$(ask_choice "skills/$name: (r) сохранить как 'skills/$name-user' | (d) удалить [r]: " "rd" "r")
    fi
    SKILL_DECISIONS+=("$ans")
  done
  for T in ${COLL_DIRS[@]+"${COLL_DIRS[@]}"}; do
    ans=$(ask_choice "$T/: (o) overwrite — удалить пользовательский каталог | (r) rename в '$T-user' | (s) skip — оставить только пользовательский каталог [r]: " "ors" "r")
    DIR_DECISIONS+=("$ans")
  done
  return 0
}

# apply_collisions — перенос сохраняемых пользовательских объектов в KEEP
# (layout: KEEP/items/<T>/<name> → восстановится в TARGET/<T>/<name>;
#          KEEP/sibs/<name> → восстановится в TARGET/<name>) — ДО swap.
apply_collisions() {
  local i entry name kind dec T
  if [ "${#COLL_SKILLS[@]}" -gt 0 ]; then
    for i in "${!COLL_SKILLS[@]}"; do
      entry="${COLL_SKILLS[$i]}"
      dec="${SKILL_DECISIONS[$i]}"
      name="${entry%%"$TAB"*}"
      kind="${entry#*"$TAB"}"
      case "$dec" in
        o) : ;;  # overwrite: объект сотрётся при swap
        d) : ;;  # orphan: объект сотрётся при swap
        r)
          if [ -e "$TARGET/skills/$name-user" ]; then
            die "rename невозможен: skills/$name-user уже существует."
          fi
          mkdir -p "$KEEP/items/skills"
          mv "$TARGET/skills/$name" "$KEEP/items/skills/$name-user"
          ;;
        s)
          mkdir -p "$KEEP/items/skills"
          mv "$TARGET/skills/$name" "$KEEP/items/skills/$name"
          SKILL_SKIPS+=("$name")
          ;;
        *) die "внутренняя ошибка: некорректное решение collision: $dec" ;;
      esac
    done
  fi
  if [ "${#COLL_DIRS[@]}" -gt 0 ]; then
    for i in "${!COLL_DIRS[@]}"; do
      T="${COLL_DIRS[$i]}"
      dec="${DIR_DECISIONS[$i]}"
      case "$dec" in
        o) : ;;  # overwrite: каталог сотрётся при swap
        r)
          if [ -e "$TARGET/$T-user" ]; then
            die "rename невозможен: $T-user уже существует."
          fi
          mkdir -p "$KEEP/sibs"
          mv "$TARGET/$T" "$KEEP/sibs/$T-user"
          ;;
        s)
          mkdir -p "$KEEP/sibs"
          mv "$TARGET/$T" "$KEEP/sibs/$T"
          DIR_SKIPS+=("$T")
          ;;
        *) die "внутренняя ошибка: некорректное решение collision: $dec" ;;
      esac
    done
  fi
  return 0
}

# --- Staging + атомарный swap (spec §3.1 «Надёжность») --------------------------

# copy_wholesale <src> <dst> — всё видимое содержимое src → dst (нет whitelist).
copy_wholesale() {
  local src="$1" dst="$2" e
  [ -d "$src" ] || return 0
  for e in "$src"/*; do
    [ -e "$e" ] || continue
    cp -R "$e" "$dst/"
  done
  return 0
}

is_dir_skip() {
  local T="$1" x
  for x in ${DIR_SKIPS[@]+"${DIR_SKIPS[@]}"}; do
    if [ "$x" = "$T" ]; then return 0; fi
  done
  return 1
}

# restore_kept — возврат пользовательских объектов из KEEP после swap.
restore_kept() {
  [ -n "$KEEP" ] && [ -d "$KEEP" ] || return 0
  local T e
  for T in skills commands agents; do
    if [ -d "$KEEP/items/$T" ]; then
      for e in "$KEEP/items/$T"/*; do
        [ -e "$e" ] || continue
        mv "$e" "$TARGET/$T/"
      done
      rm -rf "$KEEP/items/$T"
    fi
  done
  if [ -d "$KEEP/sibs" ]; then
    for e in "$KEEP/sibs"/*; do
      [ -e "$e" ] || continue
      mv "$e" "$TARGET/"
    done
    rm -rf "$KEEP/sibs"
  fi
  rm -rf "$KEEP"
  KEEP=""
  return 0
}

stage_and_swap() {
  STAGING="$TARGET/.deploy-staging"
  mkdir -p "$STAGING/skills" "$STAGING/commands" "$STAGING/agents"

  # wholesale: ВСЁ содержимое skills/commands/agents из обоих репо.
  # При одноимённости maestro↔superpowers побеждает superpowers (copied позже) —
  # имя скиллов в репо не пересекается; поведение зафиксировано комментарием.
  copy_wholesale "$TMP_ROOT/maestro/skills" "$STAGING/skills"
  copy_wholesale "$TMP_ROOT/maestro/commands" "$STAGING/commands"
  copy_wholesale "$TMP_ROOT/maestro/agents" "$STAGING/agents"
  copy_wholesale "$TMP_ROOT/superpowers/skills" "$STAGING/skills"

  # skip-решения: colliding-объекты, которые держим, из staging убираем.
  local name
  for name in ${SKILL_SKIPS[@]+"${SKILL_SKIPS[@]}"}; do
    rm -rf "$STAGING/skills/$name"
  done

  # Маркеры .maestro-deployed (empty file): каждый задеплоенный каталог.
  local d T
  for d in "$STAGING/skills"/*/; do
    [ -d "$d" ] || continue
    : > "$d$DEPLOYED_MARKER"
  done
  : > "$STAGING/commands/$DEPLOYED_MARKER"
  : > "$STAGING/agents/$DEPLOYED_MARKER"

  test_pause staging

  # Атомарный swap по каталогам (same-fs rename). dir-skip — каталог не трогаем.
  for T in skills commands agents; do
    if is_dir_skip "$T"; then continue; fi
    rm -rf "$TARGET/$T"
    if [ -d "$STAGING/$T" ] && [ -n "$(ls -A "$STAGING/$T" 2>/dev/null)" ]; then
      mv "$STAGING/$T" "$TARGET/$T"
    fi
  done

  restore_kept
  rm -rf "$STAGING"
  STAGING=""
  return 0
}

# --- Manifest (схема D2, атомарно: tmp + mv) ----------------------------------

# old_sha <manifest> <key> — старый sha (sha_m|sha_s) или «нет».
old_sha() {
  local mf="$1" key="$2" v
  [ -f "$mf" ] || { printf 'нет'; return 0; }
  v=$(python3 -c '
import json, sys
try:
    with open(sys.argv[1], encoding="utf-8") as f:
        d = json.load(f)
    v = d.get(sys.argv[2], "")
    sys.stdout.write(v if isinstance(v, str) else "")
except Exception:
    pass
' "$mf" "$key" 2>/dev/null) || v=""
  if [ -n "$v" ]; then printf '%s' "$v"; else printf 'нет'; fi
}

write_manifest() {
  local DEPLOYED=() d name T
  for d in "$TARGET/skills"/*/; do
    [ -d "$d" ] || continue
    name=$(basename "$d")
    [ -f "$d$DEPLOYED_MARKER" ] || continue   # только наши (с маркером)
    DEPLOYED+=("skills/$name")
  done
  for T in commands agents; do
    if is_dir_skip "$T"; then continue; fi
    if [ -f "$TARGET/$T/$DEPLOYED_MARKER" ]; then DEPLOYED+=("$T"); fi
  done
  python3 - "$STATE_DIR/manifest.json.tmp" "$VERSION" "$SHA_M" "$SHA_S" \
    ${DEPLOYED[@]+"${DEPLOYED[@]}"} <<'PY'
import json, sys
path, version, sha_m, sha_s = sys.argv[1:5]
with open(path, "w", encoding="utf-8") as f:
    json.dump(
        {"version": version, "sha_m": sha_m, "sha_s": sha_s, "deployed": sys.argv[5:]},
        f, ensure_ascii=False, indent=2,
    )
    f.write("\n")
PY
  mv "$STATE_DIR/manifest.json.tmp" "$STATE_DIR/manifest.json"
  return 0
}

# --- Плагин: регистрация/снятие (de-dup: filter is_ours + append, idempotent) --

register_plugin() {
  python3 - "$CONFIG_FILE" "$PLUGIN_SPEC" <<'PY'
import json, os, sys, tempfile

config_path, plugin_spec = sys.argv[1], sys.argv[2]
d = os.path.dirname(config_path) or "."
os.makedirs(d, exist_ok=True)

data = {}
if os.path.exists(config_path):
    with open(config_path, "r", encoding="utf-8") as f:
        content = f.read().strip()
        if content:
            try:
                data = json.loads(content)
            except ValueError as e:
                sys.stderr.write("maestro-install: %s — некорректный JSON: %s\n" % (config_path, e))
                sys.exit(1)
    if not isinstance(data, dict):
        sys.stderr.write("maestro-install: %s — корень не объект; не трогаю.\n" % config_path)
        sys.exit(1)

plugins = data.get("plugins")
if plugins is None:
    plugins = []
if not isinstance(plugins, list):
    sys.stderr.write("maestro-install: ключ 'plugins' в %s — не массив; не трогаю.\n" % config_path)
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

# Миграция V1→V2: legacy-ключ 'plugin' (singular) вместе с 'plugins' даёт
# двойную регистрацию ("Duplicate plugin ID" в OpenCode V2, toast при старте).
# Выжившие чужие записи переносим в 'plugins', ключ удаляем.
legacy = data.get("plugin")
if isinstance(legacy, str):
    legacy = [legacy]
if isinstance(legacy, list):
    for e in legacy:
        if not is_ours(e) and e not in plugins:
            plugins.append(e)
    del data["plugin"]
    print("maestro-install: V1→V2 миграция: ключ 'plugin' перенесён в 'plugins'")
elif legacy is not None:
    sys.stderr.write("maestro-install: ключ 'plugin' в %s — не массив/строка; миграция пропущена.\n" % config_path)

# Наша регистрация — ровно одна, в канонической форме (V2-ключ 'plugins').
# Чужие записи не трогаем. Атомарная запись: tmp + os.replace.
plugins = [e for e in plugins if not is_ours(e)]
plugins.append(plugin_spec)
data["plugins"] = plugins

fd, tmp = tempfile.mkstemp(dir=d, prefix=".opencode.json.")
with os.fdopen(fd, "w", encoding="utf-8") as f:
    json.dump(data, f, ensure_ascii=False, indent=2)
    f.write("\n")
os.replace(tmp, config_path)
print("maestro-install: плагин зарегистрирован: %s → %s" % (plugin_spec, config_path))
PY
}

unregister_plugin() {
  python3 - "$CONFIG_FILE" <<'PY'
import json, os, sys, tempfile

config_path = sys.argv[1]
plugin_spec = "maestro-bootstrap@git+https://github.com/wad-jet/maestro.git"
if not os.path.exists(config_path):
    print("maestro-install: конфига %s нет — снимать нечего." % config_path)
    sys.exit(0)
try:
    with open(config_path, "r", encoding="utf-8") as f:
        content = f.read().strip()
    data = json.loads(content) if content else {}
except ValueError as e:
    sys.stderr.write("maestro-install: %s — некорректный JSON: %s\n" % (config_path, e))
    sys.exit(1)
if not isinstance(data, dict):
    sys.exit(0)
plugins = data.get("plugins")
if not isinstance(plugins, list):
    print("maestro-install: 'plugins' не массив — не трогаю.")
    sys.exit(0)

def entry_spec(e):
    if isinstance(e, str):
        return e
    if isinstance(e, dict):
        p = e.get("package")
        return p if isinstance(p, str) else ""
    if isinstance(e, list) and e and isinstance(e[0], str):
        return e[0]
    return ""

def is_ours(e):
    s = entry_spec(e)
    return (s.startswith(plugin_spec) or
            s.startswith("git+https://github.com/wad-jet/maestro.git"))

new = [e for e in plugins if not is_ours(e)]
if len(new) == len(plugins):
    print("maestro-install: наша запись не найдена в %s — не трогаю." % config_path)
    sys.exit(0)
if new:
    data["plugins"] = new
else:
    data.pop("plugins", None)  # пустой список не оставляем
d = os.path.dirname(config_path) or "."
fd, tmp = tempfile.mkstemp(dir=d, prefix=".opencode.json.")
with os.fdopen(fd, "w", encoding="utf-8") as f:
    json.dump(data, f, ensure_ascii=False, indent=2)
    f.write("\n")
os.replace(tmp, config_path)
print("maestro-install: запись плагина удалена из %s." % config_path)
PY
}

# --- Глобальный maestro.json (spec §3.2.2) ------------------------------------

ensure_global_maestro_json() {
  local f="$STATE_DIR/maestro.json"
  if [ -f "$f" ]; then
    info "глобальный maestro.json существует — не перезаписываю: $f"
    return 0
  fi
  python3 - "$f" "$EMBEDDING_MODEL" <<'PY'
import json, os, sys, tempfile
path, model = sys.argv[1], sys.argv[2]
data = {"memory": {"enabled": False, "embedding": {"model": model}}}
d = os.path.dirname(path) or "."
fd, tmp = tempfile.mkstemp(dir=d, prefix=".maestro.json.")
with os.fdopen(fd, "w", encoding="utf-8") as f:
    json.dump(data, f, ensure_ascii=False, indent=2)
    f.write("\n")
os.replace(tmp, path)
PY
  info "создан глобальный maestro.json (default: memory отключена): $f"
  return 0
}

# --- Auto-derive namespace (spec §3.2.3, bash-эквивалент для --migrate) --------
#
# Правила:
#   Вариант A: git remote origin → domain.owner.repo (domain без TLD).
#   Self-hosted single-component (path из одного сегмента): domain.unknown.repo.
#   Monorepo (project dir ≠ git root): owner.repo.segment (домен выбрасывается;
#     segment — последний компонент относительного пути от git root).
#   Fallback C (нет git/remote/парсинга): parent_dir.project_dir.local.
#   Normalization: пустой компонент → "unknown"; сегменты санитизируются
#     (lowercase, [a-z0-9-], truncate до 31); валидация — зеркало NAMESPACE_RE
#     из plugins/maestro-bootstrap/memory/config.js (1–3 сегмента, [a-z0-9-],
#     без подряд идущих/краевых точек); невалидно → workspace.unknown.unknown.
#   Отличие от примера спеки: self-hosted `git@gitlab.internal:project.git` →
#     `gitlab.unknown.project` (domain без TLD — uniform-правило; пример спеки
#     `gitlab.internal.unknown.project` содержит 4 сегмента и отклоняется
#     NAMESPACE_RE memory-модуля).

# parse_remote_url <url> — host/path; sets R_HOST, R_PATH; 1 при не-парсинге.
# Поддержка: https://, ssh://user@host, scp-like git@host:path (GitLab/Bitbucket
# аналогично — все сводятся к host/path).
parse_remote_url() {
  local u="$1" rest
  R_HOST="" R_PATH=""
  case "$u" in
    *://*)
      rest="${u#*://}"
      R_HOST="${rest%%/*}"
      R_HOST="${R_HOST#*@}"     # user@ (ssh://git@host)
      R_HOST="${R_HOST%%:*}"    # порт
      case "$rest" in
        */*) R_PATH="${rest#*/}" ;;
      esac
      ;;
    *@*:*)
      R_HOST="${u#*@}"
      R_HOST="${R_HOST%%:*}"
      R_PATH="${u#*:}"
      ;;
    *)
      return 1
      ;;
  esac
  R_PATH="${R_PATH%.git}"
  [ -n "$R_HOST" ] && [ -n "$R_PATH" ] || return 1
  return 0
}

# sanitize_segment <raw> — lowercase, trim, [^a-z0-9-] → '-', крайние '-' срез,
# truncate до 31 (лимит сегмента NAMESPACE_RE). Может вернуть пусто.
sanitize_segment() {
  local s
  s=$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]' \
    | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')
  s=$(printf '%s' "$s" | sed -e 's/[^a-z0-9-]\{1,\}/-/g' -e 's/^-//' -e 's/-$//')
  s="${s:0:31}"
  printf '%s' "$s"
}

# validate_namespace <ns> — зеркало NAMESPACE_RE (1–3 сегмента ≤31 симв, [a-z0-9-],
# начало/конец сегмента — [a-z0-9]; общий лимит 100 символов).
validate_namespace() {
  local ns="$1"
  [ "${#ns}" -le 100 ] || return 1
  printf '%s' "$ns" | grep -Eq '^[a-z0-9]([a-z0-9-]{0,30}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,30}[a-z0-9])?){0,2}$'
}

# derive_namespace <project-dir> — выводит namespace.
derive_namespace() {
  local proj="$1"
  local abs projbase parentbase
  # pwd -P: физический путь (macOS /tmp → /private/tmp), совпадает с
  # `git rev-parse --show-toplevel` — иначе ложный monorepo-ветка (abs != gitroot).
  abs=$(cd "$proj" 2>/dev/null && pwd -P) || abs="$proj"
  projbase=$(basename "$abs")
  parentbase=$(basename "$(dirname "$abs")")

  local gitroot="" remote=""
  if command -v git >/dev/null 2>&1; then
    gitroot=$(git -C "$proj" rev-parse --show-toplevel 2>/dev/null) || gitroot=""
    if [ -n "$gitroot" ]; then
      remote=$(git -C "$proj" remote get-url origin 2>/dev/null) || remote=""
    fi
  fi

  local c1="" c2="" c3=""
  if [ -n "$remote" ] && parse_remote_url "$remote"; then
    local segs owner repo host_free cnt
    segs=$(printf '%s' "$R_PATH" | tr '/' '\n' | sed -e '/^[[:space:]]*$/d')
    if [ -n "$segs" ]; then
      owner=$(printf '%s\n' "$segs" | sed -n '1p')
      repo=$(printf '%s\n' "$segs" | sed -n '$p')
      host_free="${R_HOST%.*}"                 # domain без TLD
      [ -n "$host_free" ] || host_free="$R_HOST"
      cnt=$(printf '%s' "$segs" | grep -c '')
      if [ -n "$gitroot" ] && [ "$abs" != "$gitroot" ]; then
        # Monorepo: project dir ≠ git root → owner.repo.segment
        local rel="${abs#"$gitroot"/}"
        c1="$owner"; c2="$repo"; c3="${rel##*/}"
      elif [ "$cnt" -ge 2 ]; then
        c1="$host_free"; c2="$owner"; c3="$repo"
      elif [ "$cnt" -eq 1 ]; then
        # Self-hosted single-component: domain.unknown.repo
        c1="$host_free"; c2="unknown"; c3="$repo"
      fi
    fi
  fi

  if [ -z "$c1$c2$c3" ]; then
    # Fallback C: parent_dir.project_dir.local
    c1="$parentbase"; c2="$projbase"; c3="local"
  fi

  local s1 s2 s3 ns
  s1=$(sanitize_segment "$c1")
  s2=$(sanitize_segment "$c2")
  s3=$(sanitize_segment "$c3")
  if [ -z "$s1$s2$s3" ]; then
    printf 'workspace.unknown.unknown'
    return 0
  fi
  [ -n "$s1" ] || s1="unknown"
  [ -n "$s2" ] || s2="unknown"
  [ -n "$s3" ] || s3="unknown"
  ns="$s1.$s2.$s3"
  if validate_namespace "$ns"; then
    printf '%s' "$ns"
  else
    printf 'workspace.unknown.unknown'
  fi
}

# --- Миграция (spec §3.5) -------------------------------------------------------

migrate_post() {
  local mf="$PROJECT_DIR/.maestro/maestro.json"
  local ns
  ns=$(derive_namespace "$PROJECT_DIR")
  info "auto-derive namespace: $ns (spec §3.2.3)"
  python3 - "$mf" "$ns" <<'PY'
import json, os, sys, tempfile

path, ns = sys.argv[1], sys.argv[2]
d = os.path.dirname(path)
if d:
    os.makedirs(d, exist_ok=True)

data = {}
if os.path.exists(path):
    with open(path, "r", encoding="utf-8") as f:
        content = f.read().strip()
        if content:
            try:
                data = json.loads(content)
            except ValueError as e:
                sys.stderr.write(
                    "maestro-install: %s — некорректный JSON: %s. "
                    "Исправьте файл и повторите.\n" % (path, e))
                sys.exit(1)
    if not isinstance(data, dict):
        sys.stderr.write("maestro-install: %s — корень не объект.\n" % path)
        sys.exit(1)

mem = data.get("memory")
if not isinstance(mem, dict):
    mem = {}
if mem.get("namespace"):
    # Явный namespace уже задан (например /maestro-setup) — не перезаписываем.
    print("maestro-install: namespace уже задан в %s — не перезаписываю." % path)
    sys.exit(0)

mem["namespace"] = ns
mem["enabled"] = True
data["memory"] = mem
fd, tmp = tempfile.mkstemp(dir=d or ".", prefix=".maestro.json.")
with os.fdopen(fd, "w", encoding="utf-8") as f:
    json.dump(data, f, ensure_ascii=False, indent=2)
    f.write("\n")
os.replace(tmp, path)
print("maestro-install: %s — memory включена, namespace=%s" % (path, ns))
PY

  # Удаление agpack.yml/.agpack.lock.yml (HITL; read-only → warn + continue).
  local list="" f ans
  for f in "agpack.yml" ".agpack.lock.yml"; do
    if [ -e "$PROJECT_DIR/$f" ]; then list="$list $f"; fi
  done
  if [ -n "$list" ]; then
    if [ -t 0 ]; then
      ans=$(confirm_y "maestro-install: удалить legacy-файлы:$list ? (y/N) ")
      if [ "$ans" = y ]; then
        for f in $list; do
          if ! rm -f "$PROJECT_DIR/$f" 2>/dev/null; then
            warn "не удалось удалить $f (read-only?) — выполните chmod +w и удалите вручную. Продолжаю."
          else
            info "удалено: $f"
          fi
        done
      else
        info "legacy-файлы не удалены (можно удалить вручную)."
      fi
    else
      warn "non-interactive: legacy-файлы НЕ удалены:$list — удалите вручную (read-only: сначала chmod +w)."
    fi
  fi

  # Дубликат плагина: global-режим + запись is_ours в проектном .opencode/opencode.json
  # → duplicate plugin ID. v1: только warning + инструкция (без auto-removal).
  if [ "$MODE" = global ] && [ -f "$PROJECT_DIR/.opencode/opencode.json" ]; then
    local dup
    dup=$(python3 - "$PROJECT_DIR/.opencode/opencode.json" <<'PY' 2>/dev/null
import json, sys

def entry_spec(e):
    if isinstance(e, str):
        return e
    if isinstance(e, dict):
        p = e.get("package")
        return p if isinstance(p, str) else ""
    if isinstance(e, list) and e and isinstance(e[0], str):
        return e[0]
    return ""

def is_ours(e):
    s = entry_spec(e)
    return (s.startswith("maestro-bootstrap@git+https://github.com/wad-jet/maestro.git") or
            s.startswith("git+https://github.com/wad-jet/maestro.git"))

try:
    with open(sys.argv[1], encoding="utf-8") as f:
        d = json.load(f)
    pl = d.get("plugins")
    if isinstance(pl, list) and any(is_ours(e) for e in pl):
        print("dup")
except Exception:
    pass
PY
    ) || dup=""
    if [ "$dup" = dup ]; then
      warn "проектный .opencode/opencode.json содержит maestro-bootstrap — с глобальной установкой это дубликат (toast 'Duplicate plugin ID')."
      say "  Удалите вручную: в $PROJECT_DIR/.opencode/opencode.json уберите запись"
      say "  'maestro-bootstrap@git+https://github.com/wad-jet/maestro.git' из массива 'plugins'."
    fi
  fi
  return 0
}

# --- Деинсталляция (spec §3.8) ---------------------------------------------------

deinstall_flow() {
  local state="$STATE_DIR" target="$TARGET"
  local f base T ans to_rm=""

  say ""
  say "Будет удалено (только объекты с маркером $DEPLOYED_MARKER + наше состояние):"

  # 1. Состояние (.maestro/), кроме --preserve и активного lock.
  if [ -d "$state" ]; then
    for f in "$state"/* "$state"/.[!.]* "$state"/..?*; do
      [ -e "$f" ] || continue
      base=$(basename "$f")
      [ "$base" = ".install.lock" ] && continue
      preserved "$base" && continue
      to_rm="$to_rm
  - $f"
    done
  fi
  [ -d "$state" ] || say "  - (каталога состояния $state нет)"

  # 2. Развёрнутые объекты: skills per-item; commands/agents — каталог целиком.
  if [ -d "$target/skills" ]; then
    for f in "$target/skills"/*/; do
      [ -d "$f" ] || continue
      [ -f "$f$DEPLOYED_MARKER" ] || continue
      to_rm="$to_rm
  - $f"
    done
  fi
  for T in commands agents; do
    if [ -d "$target/$T" ] && [ -f "$target/$T/$DEPLOYED_MARKER" ]; then
      to_rm="$to_rm
  - $target/$T/ (каталог целиком)"
    fi
  done

  # 3. Плагин.
  to_rm="$to_rm
  - запись плагина в $CONFIG_FILE (если есть)"
  say "$to_rm"
  say ""

  # HITL-подтверждение: tty — интерактивно; non-tty — 'y' из stdin (echo y | …).
  if [ -t 0 ]; then
    ans=$(confirm_y "Подтвердить деинсталляцию? (y/N) ")
  else
    if ! IFS= read -r ans; then ans="n"; fi
  fi
  case "$ans" in
    [yY]|[yY][eE][sS]*) : ;;
    *) die "не подтверждено — ничего не удалено." ;;
  esac

  # 4. Выполнение.
  if [ -d "$state" ]; then
    for f in "$state"/* "$state"/.[!.]* "$state"/..?*; do
      [ -e "$f" ] || continue
      base=$(basename "$f")
      [ "$base" = ".install.lock" ] && continue
      preserved "$base" && continue
      rm -rf "$f"
      info "удалено: $f"
    done
  fi
  if [ -d "$target/skills" ]; then
    for f in "$target/skills"/*/; do
      [ -d "$f" ] || continue
      [ -f "$f$DEPLOYED_MARKER" ] || continue
      rm -rf "$f"
      info "удалено: ${f%/}"
    done
  fi
  for T in commands agents; do
    if [ -d "$target/$T" ] && [ -f "$target/$T/$DEPLOYED_MARKER" ]; then
      rm -rf "$target/$T"
      info "удалено: $target/$T/"
    fi
  done
  # skills/ — best-effort: rmdir тронет только пустой (пользовские sibling-каталоги останутся)
  rmdir "$target/skills" 2>/dev/null || true
  rm -rf "$target/.deploy-staging" 2>/dev/null || true
  unregister_plugin
  info "деинсталляция завершена. Перезапустите OpenCode."
  return 0
}

# --- Выводы ---------------------------------------------------------------------

print_dry_plan() {
  local old_m old_s n entry name kind T
  old_m=$(old_sha "$STATE_DIR/manifest.json" sha_m)
  old_s=$(old_sha "$STATE_DIR/manifest.json" sha_s)
  n=$(( ${#COLL_SKILLS[@]} + ${#COLL_DIRS[@]} ))
  say ""
  say "=== DRY RUN — план, 0 изменений ==="
  say "Режим:        $MODE"
  say "maestro:     $old_m → $SHA_M"
  say "superpowers: $old_s → $SHA_S"
  say "Компоненты:   skills=$(count_items "$TMP_ROOT/maestro/skills/"* "$TMP_ROOT/superpowers/skills/"*), commands=$(count_items "$TMP_ROOT/maestro/commands/"*), agents=$(count_items "$TMP_ROOT/maestro/agents/"*)"
  if [ "$n" -eq 0 ]; then
    say "Конфликты:   0"
  else
    say "Конфликты:   $n"
    for entry in ${COLL_SKILLS[@]+"${COLL_SKILLS[@]}"}; do
      name="${entry%%"$TAB"*}"
      kind="${entry#*"$TAB"}"
      if [ "$kind" = colliding ]; then
        say "  - skills/$name — пользовательский объект, конфликт с maestro"
      else
        say "  - skills/$name — пользовательский объект, будет удалён при перезаписи"
      fi
    done
    for T in ${COLL_DIRS[@]+"${COLL_DIRS[@]}"}; do
      say "  - $T/ — пользовательский каталог, будет перезаписан"
    done
    say "  (live-запуск: HITL overwrite/rename/skip; non-interactive — abort)"
  fi
  if [ "$MIGRATE" = 1 ]; then
    say "Миграция:    .maestro/maestro.json — memory.enabled=true, namespace=$(derive_namespace "$PROJECT_DIR") (auto-derive)"
    for T in "agpack.yml" ".agpack.lock.yml"; do
      if [ -e "$PROJECT_DIR/$T" ]; then
        say "  - удаление: $PROJECT_DIR/$T (HITL)"
      fi
    done
  fi
  if [ "$old_m" = "$SHA_M" ] && [ "$old_s" = "$SHA_S" ]; then
    say "Статус:      актуально (обновления не требуются)"
  else
    say "Статус:      установка/обновление"
  fi
  say ""
  return 0
}

print_summary() {
  say ""
  if [ "$MODE" = global ]; then
    say "[maestro-install] Глобальная установка завершена."
    say "  - Развёрнуто: $TARGET/{skills,commands,agents}"
    say "  - Manifest:   $STATE_DIR/manifest.json (maestro=$SHA_M, superpowers=$SHA_S)"
    say "  - Конфиг:     $STATE_DIR/maestro.json (memory по умолчанию отключена)"
    say "  - Плагин:     $PLUGIN_SPEC → $CONFIG_FILE"
  else
    say "[maestro-install] Проектная установка завершена."
    say "  - Развёрнуто: $TARGET/{skills,commands,agents}"
    say "  - Manifest:   $STATE_DIR/manifest.json (maestro=$SHA_M, superpowers=$SHA_S)"
    say "  - Плагин:     $PLUGIN_SPEC → $CONFIG_FILE"
  fi
  say ""
  say "Что дальше:"
  say "  1. Перезапустите OpenCode (чтобы плагин подхватился)."
  say "  2. В каждом проекте: /maestro-setup (конфиг per-project, memory: namespace auto-derive)."
  say "  3. Запуск фичи: /maestro-init \"ваша задача\"."
  if [ "$MODE" = global ]; then
    say "  Обновление: bash maestro-update.sh --global"
  fi
  return 0
}

# --- Main -------------------------------------------------------------------------

main() {
  parse_args "$@"

  # Preflight (delivery не требует python ≥3.11; python3 — только JSON, любой).
  command -v git >/dev/null 2>&1 \
    || die "не найден 'git'. Установите git и повторите."
  command -v python3 >/dev/null 2>&1 \
    || die "не найден 'python3' (любой версии — нужен только для JSON-операций)."

  PROJECT_DIR=$(pwd)
  if [ "$MODE" = global ]; then
    local global_dir
    global_dir=$(resolve_global_dir)
    TARGET="$global_dir"
    STATE_DIR="$global_dir/.maestro"
    CONFIG_FILE="$global_dir/opencode.json"
  else
    TARGET="$PROJECT_DIR/.opencode"
    STATE_DIR="$PROJECT_DIR/.maestro"
    CONFIG_FILE="$PROJECT_DIR/.opencode/opencode.json"
  fi
  LOCK="$STATE_DIR/.install.lock"

  # tmp-каталог для clone + trap cleanup.
  TMP_ROOT=$(mktemp -d)
  trap cleanup EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM

  # --- Деинсталляция: отдельный поток (без clone, с lock) ---
  if [ "$DEINSTALL" = 1 ]; then
    mkdir -p "$STATE_DIR" 2>/dev/null \
      || die "не удалось создать каталог состояния $STATE_DIR (права?)."
    acquire_lock
    deinstall_flow
    exit 0
  fi

  # --- Read-only фаза (clone + план; 0 мутаций в target) ---

  if [ "$MIGRATE" = 1 ]; then
    if [ -e "$PROJECT_DIR/agpack.yml" ] || [ -e "$PROJECT_DIR/.agpack.lock.yml" ]; then
      warn "миграция: обнаружены legacy-файлы (agpack.yml / .agpack.lock.yml) — после установки будет предложено удаление."
    else
      warn "миграция: agpack.yml не найден в проекте — выполняю обычную установку."
    fi
  fi

  clone_repos
  SHA_M=$(git -C "$TMP_ROOT/maestro" rev-parse HEAD)
  SHA_S=$(git -C "$TMP_ROOT/superpowers" rev-parse HEAD)
  self_check
  detect_collisions

  if [ "$DRY_RUN" = 1 ]; then
    print_dry_plan
    exit 0
  fi

  # --- Mutation фаза ---

  if [ ! -d "$TARGET" ]; then
    mkdir -p "$TARGET" 2>/dev/null \
      || die "не удалось создать каталог $TARGET (права? Для --global проверьте XDG_CONFIG_HOME)."
  fi
  if [ ! -w "$TARGET" ]; then
    die "каталог $TARGET не доступен на запись. Для --global проверьте XDG_CONFIG_HOME и права."
  fi
  mkdir -p "$STATE_DIR" 2>/dev/null \
    || die "не удалось создать каталог состояния $STATE_DIR (права?)."

  acquire_lock
  KEEP="$TARGET/.deploy-keep"

  resolve_collisions
  apply_collisions
  stage_and_swap
  test_pause pre-manifest
  write_manifest
  register_plugin
  if [ "$MODE" = global ]; then
    ensure_global_maestro_json
  fi
  if [ "$MIGRATE" = 1 ]; then
    migrate_post
  fi
  print_summary
  exit 0
}

main "$@"
