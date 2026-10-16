#!/usr/bin/env bash
#
# maestro-update.sh — обновление maestro: skills/commands/agents + плагин.
#
# Доставка (без agpack): git clone (https-only, shallow) + wholesale copy
#   + manifest (схема D2) + атомарные операции (per-item swap, tmp + mv).
#
# Последовательность (spec §3.4; гарантии надёжности — §3.1, как в Task 3):
#   1. Preflight (git, python3 — любой версии, только для JSON-операций).
#   2. Permission check: read-only target → abort (подсказка XDG_CONFIG_HOME).
#   3. Clone maestro + superpowers — ДО любых destructive-действий (clone-first).
#   4. Self-check (V21): свой скрипт vs версия из того же коммита (SHA_M) —
#      warning + HITL-инструкция (curl raw-url); НЕ блокирует (в т.ч. --dry-run).
#   5. No-op: sha_m/sha_s в manifest == sha clone → «актуальная версия (sha …)»,
#      exit 0, без изменений (и без lock).
#   6. --dry-run: план (shas, статус, stale, действия) — 0 мутаций, без lock.
#   7. (live) lock (mkdir-based, stale 30 мин — V18) → --prune HITL:
#      JSON-листинг stale → y/N; non-interactive (stdin не tty) → fail-closed die.
#   8. Staging .deploy-staging/ → per-item swap skills/ (rm + mv) и
#      directory-level swap commands/, agents/. Чужие объекты без маркера
#      .maestro-deployed НЕ трогаются; именование-конфликт → guard (die).
#   9. Атомарный manifest (tmp + mv): {"version","sha_m","sha_s","deployed":[...]}.
#  10. (global) глобальный maestro.json создаётся при отсутствии (privacy-safe).
#  11. Очистка кэша плагина: $HOME/.cache/opencode/npm/git-maestro-* + legacy packages/.
#  12. Плагин re-reg (idempotent, de-dup is_ours; --pin → spec#sha).
#  13. (global) дубликат плагина в проектном .opencode/opencode.json (cwd) →
#      warning + инструкция (v1: без auto-removal, spec §3.3).
#  14. HITL-рестарт службы opencode «прервёт все проекты» (global) /
#      «перезапустите opencode» (project).
#
# Режимы:
#   --project (default) — проектное: .opencode/ + .maestro/manifest.json
#   --global            — машинное: $XDG_CONFIG_HOME/opencode/ + состояние .maestro/
#
# Опции: --pin <sha>, --prune, --dry-run, --help.
# Exit codes: 0 — ok, 1 — ошибка, 2 — usage error.
#
# Задокументированное поведение:
#   - No-op: manifest == sha clone → exit 0, без изменений (даже с --prune).
#   - Prune: stale = объект в target с маркером .maestro-deployed, которого больше
#     нет в целевом clone (disk-based: покрывает и manifest, и вне-manifest).
#     Без --prune stale не трогаются (только info-hint).
#     JSON-формат: [{"path":"skills/x","reason":"removed_from_repo|renamed_to_y"}].
#     Rename-эвристика: y (новый объект, отсутствовал в старом manifest) имеет
#     префикс-связь с x (x — префикс y или наоборот); несколько кандидатов —
#     кратчайший; иначе removed_from_repo.
#   - Self-check: warning-only (HITL-инструкция curl); не блокирует, не
#     самозаменяет (silent self-update запрещён).
#   - Кэш OpenCode V2 — фиксированный путь $HOME/.cache/opencode
#     (XDG_CACHE_HOME для opencode-кэша не используется); legacy V1 — packages/.
#   - User-object guard: объект из clone с именным совпадением с чужим объектом
#     в target (без маркера) → die fail-closed (тихая перезапись запрещена).
#
# Совместимость: bash 3.2+ (macOS) — без associative arrays, без mapfile,
# без flock (mkdir-based lock, V18). Глобальные пути — через XDG_CONFIG_HOME.
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
# Кэш OpenCode V2 (npm/git-<repo>-<hash>) — фиксированный путь; XDG_CACHE_HOME
# для opencode-кэша не используется (legacy V1-layout — packages/).
CACHE_ROOT="$HOME/.cache/opencode"
TAB=$'\t'

# --- Состояние аргументов (parse_args) ---------------------------------------

MODE=project
DRY_RUN=0
PRUNE=0
PIN_SHA=""

# --- Пути (заполняет main) ----------------------------------------------------

PROJECT_DIR=""
TARGET=""
STATE_DIR=""
CONFIG_FILE=""
LOCK=""
TMP_ROOT=""
STAGING=""
OWN_LOCK=0
SHA_M=""
SHA_S=""
STALE_JSON="[]"
SELF_PATH="${BASH_SOURCE[0]:-$0}"

# --- Логирование --------------------------------------------------------------

say()  { printf '%s\n' "$*"; }
info() { printf '\033[1;34m[maestro-update]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[maestro-update] ВНИМАНИЕ:\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31m[maestro-update] ОШИБКА:\033[0m %s\n' "$*" >&2; exit 1; }

usage_err() {
  printf '\033[1;31m[maestro-update] ОШИБКА АРГУМЕНТОВ:\033[0m %s\n' "$*" >&2
  usage >&2
  exit 2
}

usage() {
  cat <<'USAGE'
maestro-update — обновление maestro (skills/commands/agents + плагин).

Доставка: git clone (https-only) + wholesale copy + manifest (без agpack).

Использование:
  bash maestro-update.sh [опции]

Режимы:
  --project     проектное обновление (default): .opencode/ + .maestro/manifest.json
  --global      машинное обновление: $XDG_CONFIG_HOME/opencode/ + состояние .maestro/

Опции:
  --pin <sha>         зафиксировать maestro и superpowers на коммите;
                      плагин регистрируется как spec#sha (без --pin — без пина)
  --prune             HITL-удаление stale-компонентов (JSON-листинг, y/N);
                      без флага stale не трогаются; non-interactive — fail-closed
  --dry-run           показать план без изменений (0 мутаций)
  --help              эта справка

Exit codes: 0 — ok, 1 — ошибка, 2 — usage error.

Поведение:
  - No-op: manifest == sha clone → «актуальная версия (sha …)», exit 0.
  - Self-check: свой скрипт vs версия из целевого коммита → warning (не блокирует).
  - Stale: наш маркер .maestro-deployed, объект больше не в репо → только с --prune.
  - Кэш плагина: $HOME/.cache/opencode/npm/git-maestro-* + legacy packages/.

Предусловия: bash, git, python3 (любой версии), сеть (github.com, https-only).

Примеры:
  bash maestro-update.sh --global
  bash maestro-update.sh --global --pin <sha>
  bash maestro-update.sh --global --prune
  bash maestro-update.sh --project --dry-run
USAGE
}

parse_args() {
  while [ $# -gt 0 ]; do
    case "$1" in
      --help|-h) usage; exit 0 ;;
      --project)   MODE=project ;;
      --global)    MODE=global ;;
      --dry-run)   DRY_RUN=1 ;;
      --prune)     PRUNE=1 ;;
      --pin)
        [ $# -ge 2 ] || usage_err "--pin требует <sha>"
        case "$2" in --*) usage_err "--pin требует <sha>" ;; esac
        PIN_SHA="$2"; shift ;;
      --*) usage_err "неизвестный флаг: $1 (см. --help)" ;;
      *)  usage_err "неожиданный аргумент: $1 (см. --help)" ;;
    esac
    shift
  done
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

# confirm_y <prompt> — y/N; EOF → n. Prompt — на stderr (stdout захвачен
# под ответ при вызове в command substitution). Выводит y|n.
confirm_y() {
  local prompt="$1" ans
  printf '%s' "$prompt" >&2
  if ! IFS= read -r ans; then ans="n"; fi
  case "$ans" in
    [yY]|[yY][eE][sS]*) printf 'y' ;;
    *) printf 'n' ;;
  esac
}

# resolve_global_dir — $XDG_CONFIG_HOME/opencode (fallback $HOME/.config).
resolve_global_dir() {
  local cfg="${XDG_CONFIG_HOME:-$HOME/.config}"
  printf '%s' "$cfg/opencode"
}

# --- Lock (mkdir-based, macOS-совместимо, V18; общий с install — serialize) ---

# cleanup — trap EXIT/INT/TERM: убрать lock (если наш), tmp clone, staging.
cleanup() {
  if [ -n "${LOCK:-}" ] && [ "${OWN_LOCK:-0}" = 1 ]; then rm -rf "$LOCK"; fi
  if [ -n "${TMP_ROOT:-}" ]; then rm -rf "$TMP_ROOT"; fi
  if [ -n "${STAGING:-}" ]; then rm -rf "$STAGING"; fi
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
      die "уже идёт установка/обновление (lock: $LOCK). Дождитесь завершения; stale lock (старше 30 минут) забирается автоматически."
    fi
  fi
  OWN_LOCK=1
  printf 'pid=%s mode=%s kind=update start=%s\n' "$$" "$MODE" "$(date '+%Y-%m-%d %H:%M:%S')" > "$LOCK/info"
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

# Self-check (V21): свой скрипт vs копия из того же коммита целевой версии
# (корень cloned-репо). Расхождение → warning + HITL-инструкция (curl raw-url);
# НЕ блокирует (в т.ч. --dry-run) — silent self-update запрещён (spec §7).
self_check() {
  local cloned="$TMP_ROOT/maestro/maestro-update.sh"
  [ -f "$cloned" ] || return 0
  if ! diff -q -- "$SELF_PATH" "$cloned" >/dev/null 2>&1; then
    warn "self-check: запущенный maestro-update.sh устарел — отличается от версии в коммите $SHA_M."
    say "  HITL-самообновление (обновление НЕ автоматическое). Обновите скрипт и перезапустите:"
    say "    curl -fsSL $MAESTRO_RAW/$SHA_M/maestro-update.sh -o maestro-update.sh"
  fi
  return 0
}

# --- Manifest (схема D2) --------------------------------------------------------

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

# write_manifest — атомарно (tmp + mv): {"version","sha_m","sha_s","deployed"}.
# deployed — только наши объекты (с маркером .maestro-deployed).
write_manifest() {
  local DEPLOYED=() d name T
  for d in "$TARGET/skills"/*/; do
    [ -d "$d" ] || continue
    name=$(basename "$d")
    [ -f "$d$DEPLOYED_MARKER" ] || continue
    DEPLOYED+=("skills/$name")
  done
  for T in commands agents; do
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

# --- Stale-detection + prune (spec §3.4 p.6, V6/V8) -----------------------------

# compute_stale — disk-based: объект в target с маркером, которого нет в целевом
# clone. Заполняет STALE_JSON (JSON-massive; "[]" — пусто).
compute_stale() {
  STALE_JSON=$(python3 - "$TARGET" "$STATE_DIR/manifest.json" "$TMP_ROOT/maestro" "$TMP_ROOT/superpowers" <<'PY'
import json, os, sys

target, manifest, maestro_root, sp_root = sys.argv[1:5]
MARKER = ".maestro-deployed"

def names_in(root, sub):
    d = os.path.join(root, sub)
    if not os.path.isdir(d):
        return set()
    return {n for n in os.listdir(d) if os.path.isdir(os.path.join(d, n))}

new_skills = names_in(maestro_root, "skills") | names_in(sp_root, "skills")
new_dirs = {t: os.path.isdir(os.path.join(maestro_root, t)) for t in ("commands", "agents")}

old_deployed, old_skills = set(), set()
if os.path.isfile(manifest):
    try:
        with open(manifest, encoding="utf-8") as f:
            dep = json.load(f).get("deployed") or []
        old_deployed = {e for e in dep if isinstance(e, str)}
        old_skills = {e.split("/", 1)[1] for e in old_deployed if e.startswith("skills/")}
    except Exception:
        pass

new_only = new_skills - old_skills

def reason_for(name):
    # rename-эвристика: новый объект (не в старом manifest) с префикс-связью.
    cands = [b for b in new_only if b.startswith(name) or name.startswith(b)]
    if cands:
        return "renamed_to_" + min(cands, key=len)
    return "removed_from_repo"

stale = []
sd = os.path.join(target, "skills")
if os.path.isdir(sd):
    for n in sorted(os.listdir(sd)):
        p = os.path.join(sd, n)
        if not os.path.isdir(p):
            continue
        if not os.path.isfile(os.path.join(p, MARKER)):
            continue            # чужой объект — prune его не касается
        if n in new_skills:
            continue            # будет передеплоен
        stale.append({"path": "skills/" + n, "reason": reason_for(n)})
for t in ("commands", "agents"):
    p = os.path.join(target, t)
    if os.path.isdir(p) and os.path.isfile(os.path.join(p, MARKER)) and not new_dirs[t]:
        stale.append({"path": t, "reason": "removed_from_repo"})

print(json.dumps(stale, ensure_ascii=False, indent=2))
PY
  )
  return 0
}

stale_count() {
  if [ "$STALE_JSON" = "[]" ]; then
    printf '0'
  else
    printf '%s' "$STALE_JSON" | python3 -c 'import json,sys; print(len(json.load(sys.stdin)))'
  fi
}

# prune_flow — (live, под lock, до swap). Без --prune — только info-hint.
# --prune + stale: JSON-листинг → tty: y/N → rm; non-tty: fail-closed die.
prune_flow() {
  local n ans
  n=$(stale_count)
  if [ "$n" = 0 ]; then
    if [ "$PRUNE" = 1 ]; then
      info "--prune: stale-компонентов нет."
    fi
    return 0
  fi
  if [ "$PRUNE" = 0 ]; then
    info "stale-компонентов: $n (без --prune не трогаются; HITL-удаление: --prune)."
    return 0
  fi
  say ""
  say "Stale-компоненты (наш маркер, в целевой версии их больше нет):"
  printf '%s\n' "$STALE_JSON"
  say ""
  if [ ! -t 0 ]; then
    die "non-interactive: HITL-подтверждение --prune невозможно (fail-closed). Листинг выше; запустите интерактивно (tty) с --prune."
  fi
  ans=$(confirm_y "Удалить $n stale-компонентов? (y/N) ")
  if [ "$ans" != y ]; then
    warn "--prune отклонён — stale-компоненты сохранены."
    return 0
  fi
  python3 -c '
import json, os, shutil, sys
target = sys.argv[1]
for it in json.loads(sys.argv[2]):
    p = os.path.join(target, it["path"])
    if os.path.isdir(p) and not os.path.islink(p):
        shutil.rmtree(p)
    elif os.path.lexists(p):
        os.remove(p)
    print("maestro-update: удалено: %s (%s)" % (it["path"], it["reason"]))
' "$TARGET" "$STALE_JSON"
  return 0
}

# --- Staging + swap (spec §3.1 «Надёжность») -----------------------------------

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

# stage_and_swap — per-item для skills/ (stale и чужие объекты на месте),
# directory-level для commands/, agents/. Guard: чужой объект (без маркера)
# с именным совпадением с объектом из clone → die (fail-closed).
stage_and_swap() {
  STAGING="$TARGET/.deploy-staging"
  mkdir -p "$STAGING/skills"
  local T d name
  for T in commands agents; do
    if [ -d "$TMP_ROOT/maestro/$T" ]; then
      mkdir -p "$STAGING/$T"
    fi
  done

  # wholesale: ВСЁ содержимое из обоих репо. При одноимённости
  # maestro↔superpowers побеждает superpowers (копируется позже) — имена
  # скиллов в репо не пересекаются; поведение зафиксировано комментарием.
  copy_wholesale "$TMP_ROOT/maestro/skills" "$STAGING/skills"
  copy_wholesale "$TMP_ROOT/superpowers/skills" "$STAGING/skills"
  for T in commands agents; do
    copy_wholesale "$TMP_ROOT/maestro/$T" "$STAGING/$T"
  done

  # Маркеры .maestro-deployed (empty file): каждый задеплоенный каталог.
  for d in "$STAGING/skills"/*/; do
    [ -d "$d" ] || continue
    : > "$d$DEPLOYED_MARKER"
  done
  for T in commands agents; do
    if [ -d "$STAGING/$T" ]; then
      : > "$STAGING/$T/$DEPLOYED_MARKER"
    fi
  done

  # skills/ — per-item swap (stale/чужие объекты без маркера остаются на месте).
  if [ -n "$(ls -A "$STAGING/skills" 2>/dev/null)" ]; then
    mkdir -p "$TARGET/skills"
    for d in "$STAGING/skills"/*/; do
      [ -d "$d" ] || continue
      name=$(basename "$d")
      if [ -e "$TARGET/skills/$name" ]; then
        if [ ! -d "$TARGET/skills/$name" ] || [ ! -f "$TARGET/skills/$name/$DEPLOYED_MARKER" ]; then
          die "skills/$name — пользовательский объект без маркера $DEPLOYED_MARKER; автоматическая перезапись запрещена. Удалите/переименуйте вручную и повторите (fail-closed)."
        fi
      fi
      rm -rf "$TARGET/skills/$name"
      mv "$d" "$TARGET/skills/$name"
    done
  fi

  # commands/, agents/ — directory-level swap (каталог целиком наш — маркер).
  for T in commands agents; do
    if [ -d "$STAGING/$T" ]; then
      if [ -e "$TARGET/$T" ]; then
        if [ ! -d "$TARGET/$T" ] || [ ! -f "$TARGET/$T/$DEPLOYED_MARKER" ]; then
          die "$T/ — пользовательский объект без маркера $DEPLOYED_MARKER; автоматическая перезапись запрещена. Удалите/переименуйте вручную и повторите (fail-closed)."
        fi
      fi
      rm -rf "$TARGET/$T"
      mv "$STAGING/$T" "$TARGET/$T"
    fi
  done

  rm -rf "$STAGING"
  STAGING=""
  return 0
}

# --- Кэш плагина OpenCode (spec §3.4 p.9) --------------------------------------

cache_clean() {
  local n=0 d
  info "очищаю кэш плагина OpenCode ($CACHE_ROOT; V2: npm/git-maestro-*, legacy: packages/)..."
  if [ -d "$CACHE_ROOT" ]; then
    # V2-layout: npm/git-<repo>-<hash>/<timestamp>/
    for d in "$CACHE_ROOT"/npm/git-maestro-*; do
      [ -e "$d" ] || continue
      rm -rf "$d"
      n=$((n+1))
    done
    # legacy V1-layout: packages/<spec>/
    for d in "$CACHE_ROOT"/packages/maestro-bootstrap@git+https://github.com/wad-jet/maestro*; do
      [ -e "$d" ] || continue
      rm -rf "$d"
      n=$((n+1))
    done
  fi
  if [ "$n" = 0 ]; then
    warn "записей кэша не найдено (возможно, плагин ещё не запускался) — перезапустите opencode после обновления."
  else
    info "удалено записей кэша: $n"
  fi
  return 0
}

# --- Плагин: re-reg (idempotent, de-dup: filter is_ours + append) --------------

# register_plugin <spec> — ровно одна каноническая запись; чужие не трогаем.
register_plugin() {
  local spec="$1"
  python3 - "$CONFIG_FILE" "$spec" <<'PY'
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
                sys.stderr.write("maestro-update: %s — некорректный JSON: %s\n" % (config_path, e))
                sys.exit(1)
    if not isinstance(data, dict):
        sys.stderr.write("maestro-update: %s — корень не объект; не трогаю.\n" % config_path)
        sys.exit(1)

plugins = data.get("plugins")
if plugins is None:
    plugins = []
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
    return (s.startswith("maestro-bootstrap@git+https://github.com/wad-jet/maestro.git") or
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
    print("maestro-update: V1→V2 миграция: ключ 'plugin' перенесён в 'plugins'")
elif legacy is not None:
    sys.stderr.write("maestro-update: ключ 'plugin' в %s — не массив/строка; миграция пропущена.\n" % config_path)

# Наша регистрация — ровно одна, в переданной форме (с пином при --pin).
# Чужие записи не трогаем. Атомарная запись: tmp + os.replace.
plugins = [e for e in plugins if not is_ours(e)]
plugins.append(plugin_spec)
data["plugins"] = plugins

fd, tmp = tempfile.mkstemp(dir=d, prefix=".opencode.json.")
with os.fdopen(fd, "w", encoding="utf-8") as f:
    json.dump(data, f, ensure_ascii=False, indent=2)
    f.write("\n")
os.replace(tmp, config_path)
print("maestro-update: плагин зарегистрирован: %s → %s" % (plugin_spec, config_path))
PY
}

# --- Глобальный maestro.json (при отсутствии; privacy-safe default) ------------

ensure_global_maestro_json() {
  local f="$STATE_DIR/maestro.json"
  if [ -f "$f" ]; then
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

# --- Дубликат плагина (Review Focus #5, spec §3.3: v1 — warning + инструкция) ---

# check_project_duplicate — (global) в cwd-проекте .opencode/opencode.json с
# is_ours-записью → duplicate plugin ID; v1: без auto-removal.
check_project_duplicate() {
  [ "$MODE" = global ] || return 0
  local f="$PROJECT_DIR/.opencode/opencode.json"
  [ -f "$f" ] || return 0
  local dup
  dup=$(python3 - "$f" <<'PY' 2>/dev/null
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
  if [ "$dup" = "dup" ]; then
    warn "проектный .opencode/opencode.json ($f) содержит maestro-bootstrap — с глобальной установкой это дубликат (toast 'Duplicate plugin ID')."
    say "  Удалите вручную: в $f уберите запись '$PLUGIN_SPEC'"
    say "  (или любую запись git+https://github.com/wad-jet/maestro.git) из массива 'plugins'."
    say "  (v1: авто-удаление недоступно)"
  fi
  return 0
}

# --- HITL-рестарт службы opencode (global: «прервёт все проекты») ----------------

restart_hitl() {
  [ "$MODE" = global ] || return 0
  local opencode_cmd="" ans
  opencode_cmd=$(command -v opencode 2>/dev/null) || opencode_cmd=""
  if [ -z "$opencode_cmd" ]; then
    warn "'opencode' не найден в PATH — перезапустите службу вручную: opencode service restart (прервёт все проекты)."
    return 0
  fi
  if ! "$opencode_cmd" service status >/dev/null 2>&1; then
    info "служба opencode не запущена — свежий плагин подхватится при следующем старте."
    return 0
  fi
  warn "обнаружена запущенная служба opencode: глобальный плагин обновлён — рестарт прервёт ВСЕ ПРОЕКТЫ (активные сессии)."
  if [ -t 0 ]; then
    while :; do
      printf '%s' "[maestro-update] Перезапустить службу opencode? (a) да, сейчас | (c) нет, вручную: '$opencode_cmd service restart' [c]: "
      if ! IFS= read -r ans; then ans="c"; fi
      case "$ans" in
        a|A)
          if "$opencode_cmd" service restart; then
            info "служба opencode перезапущена — свежий плагин активен во всех проектах."
          else
            warn "не удалось перезапустить службу — выполните вручную: '$opencode_cmd service restart'."
          fi
          break ;;
        c|C)
          info "перезапуск отложен — выполните вручную: '$opencode_cmd service restart' (прервёт все проекты)."
          break ;;
        *)
          info "введите a или c" ;;
      esac
    done
  else
    warn "non-interactive: перезапуск службы пропущен — выполните вручную: '$opencode_cmd service restart' (прервёт все проекты)."
  fi
  return 0
}

# --- Выводы ---------------------------------------------------------------------

print_dry_plan() {
  local old_m old_s n
  old_m=$(old_sha "$STATE_DIR/manifest.json" sha_m)
  old_s=$(old_sha "$STATE_DIR/manifest.json" sha_s)
  n=$(stale_count)
  say ""
  say "=== DRY RUN — план, 0 изменений ==="
  say "Режим:        $MODE"
  say "maestro:     $old_m → $SHA_M"
  say "superpowers: $old_s → $SHA_S"
  say "Компоненты:   skills=$(count_items "$TMP_ROOT/maestro/skills/"* "$TMP_ROOT/superpowers/skills/"*), commands=$(count_items "$TMP_ROOT/maestro/commands/"*), agents=$(count_items "$TMP_ROOT/maestro/agents/"*)"
  if [ "$old_m" = "$SHA_M" ] && [ "$old_s" = "$SHA_S" ]; then
    say "Статус:      актуально (обновления не требуются)"
  else
    say "Статус:      обновление"
  fi
  if [ "$n" != 0 ]; then
    if [ "$PRUNE" = 1 ]; then
      say "Stale:       $n (HITL-удаление с --prune)"
      printf '%s\n' "$STALE_JSON"
      say "  (dry-run: удаление не будет выполнено; live non-tty — fail-closed)"
    else
      say "Stale:       $n (без --prune не трогаются; HITL-удаление: --prune)"
    fi
  else
    say "Stale:       0"
  fi
  say "Действия (live):"
  say "  1. per-item swap skills/ + directory-level swap commands/, agents/ (guard: чужие объекты без маркера)"
  say "  2. manifest → $STATE_DIR/manifest.json"
  say "  3. cache clean: $CACHE_ROOT/npm/git-maestro-* (+ legacy packages/)"
  say "  4. plugin re-reg (idempotent) → $CONFIG_FILE"
  if [ "$MODE" = global ]; then
    say "  5. HITL-рестарт службы opencode (прервёт все проекты)"
  else
    say "  5. инструкция: перезапустите opencode"
  fi
  say ""
  return 0
}

print_summary() {
  local spec_disp="$PLUGIN_SPEC"
  if [ -n "$PIN_SHA" ]; then
    spec_disp="$PLUGIN_SPEC#$PIN_SHA"
  fi
  say ""
  if [ "$MODE" = global ]; then
    say "[maestro-update] Глобальное обновление завершено."
    say "  - Развёрнуто:   $TARGET/{skills,commands,agents}"
    say "  - Manifest:     $STATE_DIR/manifest.json (maestro=$SHA_M, superpowers=$SHA_S)"
    say "  - Плагин:       $spec_disp → $CONFIG_FILE"
  else
    say "[maestro-update] Проектное обновление завершено."
    say "  - Развёрнуто:   $TARGET/{skills,commands,agents}"
    say "  - Manifest:     $STATE_DIR/manifest.json (maestro=$SHA_M, superpowers=$SHA_S)"
    say "  - Плагин:       $spec_disp → $CONFIG_FILE"
  fi
  say ""
  say "Что дальше:"
  if [ "$MODE" = global ]; then
    say "  1. Перезапустите службу opencode, если ещё не перезапущена (прервёт все проекты)."
  else
    say "  1. Перезапустите opencode (плагин проекта обновлён)."
  fi
  say "  2. Проверьте версию: /maestro-version."
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

  # Permission check (spec §3.4 p.2): read-only target → abort до сети.
  if [ -d "$TARGET" ] && [ ! -w "$TARGET" ]; then
    die "каталог $TARGET не доступен на запись (EACCES). Для --global проверьте XDG_CONFIG_HOME и права."
  fi

  # tmp-каталог для clone + trap cleanup.
  TMP_ROOT=$(mktemp -d)
  trap cleanup EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM

  # --- Read-only фаза (clone + расчёты; 0 мутаций в target) ---

  clone_repos
  SHA_M=$(git -C "$TMP_ROOT/maestro" rev-parse HEAD)
  SHA_S=$(git -C "$TMP_ROOT/superpowers" rev-parse HEAD)
  self_check
  compute_stale

  # No-op: manifest == sha clone → без изменений (и без lock).
  local old_m old_s
  old_m=$(old_sha "$STATE_DIR/manifest.json" sha_m)
  old_s=$(old_sha "$STATE_DIR/manifest.json" sha_s)
  if [ "$old_m" = "$SHA_M" ] && [ "$old_s" = "$SHA_S" ]; then
    info "актуальная версия (maestro $SHA_M; superpowers $SHA_S) — обновлений не требуется."
    exit 0
  fi

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
  prune_flow
  stage_and_swap
  write_manifest
  if [ "$MODE" = global ]; then
    ensure_global_maestro_json
  fi
  cache_clean
  local spec
  if [ -n "$PIN_SHA" ]; then
    spec="$PLUGIN_SPEC#$PIN_SHA"
  else
    spec="$PLUGIN_SPEC"
  fi
  register_plugin "$spec"
  check_project_duplicate
  restart_hitl
  print_summary
  exit 0
}

main "$@"
