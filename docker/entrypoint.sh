#!/bin/bash
# =============================================================================
# docker/entrypoint.sh — maestro docker-serve entrypoint (root → drop)
#
# Режимы запуска (авто-детект, spec §2.1/§5.4):
#   A (self-contained): REPO_URL задан → tmpfs credential-store (GIT_TOKEN →
#      /dev/shm), safe clone (полный, НЕ shallow, Task 5 — выполнено), serve
#   B (live-mount):     REPO_URL НЕ задан + git-дерево в /workspace[/<repo>]
#      → serve на смонтированном дереве
#
# Порядок:
#   1.  preflight (git/jq/gosu), XDG/log-dirs, HOME для serving-user
#   2.  mode detection (A / B / error + help)
#   3.  подготовка режима: A — tmpfs credential-store + unset GIT_TOKEN;
#       B — проверка .git + .confidential (warn при отсутствии)
#   4.  OPENCODE_CONFIG_CONTENT injection (СТРОГОЙ контракт: только
#       agents.*.model + providers + default_agent; НИКОГДА permissions,
#       policies, plugins, instructions — spec §2.8)
#   5.  provider allowlist → /etc/opencode/opencode.json (root-write, до drop)
#   6.  log retention: bootstrap 30d / audit 90d → tar.gz в /maestro/logs/archive,
#       файлы текущего дня НЕ трогаем (spec §7, пункт 11)
#   7.  seed глобального скелета (~/.config/opencode/opencode.json) при первом
#       запуске (пустой config-volume → baked skeleton)
#   8.  core.hooksPath → /var/empty (git-хуки репо не исполняются в контейнере)
#   9.  chown volumes → gosu <uid>:<gid> → opencode serve
#
# Окружение:
#   REPO_URL, GIT_TOKEN, GIT_BRANCH        — режим A
#   OC_*_MODEL (OC_BUILD_MODEL, …)         — модели агентов (provider/model)
#   OC_PROVIDERS_JSON                      — custom providers (JSON, top-level
#                                             keys = provider IDs)
#   OPENCODE_DEFAULT_AGENT                 — default_agent (default "build")
#   OPENCODE_PASSWORD                      — Basic auth сервера (читает opencode,
#                                             в JSON НЕ инъектируется)
#   XDG_DATA_HOME=/data, XDG_CACHE_HOME=/cache (export-имся здесь, spec §2.3)
#   MAESTRO_BOOTSTRAP_LOG_DIR/MAESTRO_AUDIT_LOG_DIR/MAESTRO_MEMORY_LOG_DIR
#                                          — все → /maestro/logs (spec §2.7)
#   RUN_UID / RUN_GID (default 1000:1000)  — целевой drop-пользователь.
#       ВАЖНО: встроенные $UID/$GID в bash — readonly (uid процесса), env-override
#       не действует, поэтому operator-переопределение — через RUN_UID/RUN_GID.
#   MAESTRO_LOG_RETENTION_DAYS (default 30) / MAESTRO_AUDIT_LOG_RETENTION_DAYS
#       (default 90) — retention в днях
# =============================================================================
set -euo pipefail

WORKSPACE=/workspace
MAESTRO_STATE=/maestro
LOG_DIR="${MAESTRO_LOGS_DIR:-/maestro/logs}"
LOG_ARCHIVE="$LOG_DIR/archive"
ETC_CONFIG=/etc/opencode/opencode.json
CRED=/dev/shm/git-credentials

DROP_UID="${RUN_UID:-1000}"
DROP_GID="${RUN_GID:-1000}"

log() { echo "[entrypoint] $*"; }
die() { echo "[entrypoint] ERROR: $*" >&2; exit 1; }

# --- preflight ----------------------------------------------------------------
for cmd in git jq gosu; do
  command -v "$cmd" >/dev/null 2>&1 || die "missing required command: $cmd (image build must install it)"
done

# HOME serving-пользователя (image: adduser --uid 1000 opencode).
# git config --global пишется в $HOME/.gitconfig — поэтому HOME фиксируем ДО
# любого git-вызова, чтобы конфиг достался non-root serving-процессу.
RUN_HOME="$(getent passwd "$DROP_UID" 2>/dev/null | cut -d: -f6 || true)"
RUN_HOME="${RUN_HOME:-/home/opencode}"

# XDG + лог-каталоги (spec §2.3, §2.7) — наследуются opencode через gosu
export XDG_DATA_HOME=/data
export XDG_CACHE_HOME=/cache
export MAESTRO_BOOTSTRAP_LOG_DIR="$LOG_DIR"
export MAESTRO_AUDIT_LOG_DIR="$LOG_DIR"
export MAESTRO_MEMORY_LOG_DIR="$LOG_DIR"
export HOME="$RUN_HOME"

# --- 1. mode detection ---------------------------------------------------------
# A: REPO_URL задан. B: REPO_URL пустой + git-дерево в /workspace (или ровно
# одно дерево в /workspace/<repo> — задокументированная раскладка режима B,
# spec §5.4: -v ~/dev/myapp:/workspace/myapp). Иначе — error + help.

detect_mode_b_root() {
  if [ -e "$WORKSPACE/.git" ]; then
    printf '%s\n' "$WORKSPACE"
    return 0
  fi
  local count=0 root="" d
  for d in "$WORKSPACE"/*/; do
    [ -e "${d}.git" ] || continue
    root="${d%/}"
    count=$((count + 1))
  done
  if [ "$count" -eq 1 ]; then
    printf '%s\n' "$root"
    return 0
  fi
  [ "$count" -eq 0 ] || die "mode B: multiple git repos under $WORKSPACE — one repo per container (serial mode)"
  return 1
}

MODE=""
PROJECT_ROOT=""
if [ -n "${REPO_URL:-}" ]; then
  MODE=A
  log "mode A (self-contained): REPO_URL=$REPO_URL"
elif PROJECT_ROOT="$(detect_mode_b_root)"; then
  MODE=B
  log "mode B (live-mount): project root $PROJECT_ROOT"
else
  cat >&2 <<'EOF'
[entrypoint] ERROR: launch mode not detected.
  mode A (self-contained): set REPO_URL (+ GIT_TOKEN for private repos)
  mode B (live-mount):     REPO_URL unset + git tree at /workspace or /workspace/<repo>
  see docker/README.md
EOF
  exit 1
fi

# --- 2. mode preparation --------------------------------------------------------

# Список OC_*_MODEL env-переменных (для config injection + provider allowlist)
oc_model_vars() {
  env | grep -E '^OC_[A-Z0-9_]+_MODEL=' | cut -d= -f1 || true
}

# Режим A: tmpfs credential-store (spec §2.9). Токен — в /dev/shm (600), умирает
# с контейнером; remote URL остаётся чистым; токен не в ps, не в image layers.
setup_mode_a() {
  if [ -n "${GIT_TOKEN:-}" ]; then
    # host credential-store: явный $HOST побеждает, иначе — из REPO_URL
    local cred_host="${HOST:-${REPO_URL#*://}}"
    cred_host="${cred_host%%/*}"
    [ -n "$cred_host" ] || die "mode A: cannot derive credential host from REPO_URL=$REPO_URL (set HOST explicitly)"
    printf 'https://oauth2:%s@%s\n' "$GIT_TOKEN" "$cred_host" > "$CRED"
    chmod 600 "$CRED"
    # serving-процесс (non-root) должен читать store — chown DO drop
    chown "${DROP_UID}:${DROP_GID}" "$CRED"
    git config --global credential.helper "store --file $CRED"
    log "credentials: tmpfs store ready ($CRED, host $cred_host)"
    # гигиена: токен выгружаем из env сразу после записи в store (spec §2.9)
    unset GIT_TOKEN
  else
    log "WARN: mode A without GIT_TOKEN — assuming public repo / tokenless auth"
  fi

  # --- safe clone flow (temp-clone + rsync, full clone — не shallow) ----------
  # Полный клон: --depth=1 ломает ancestry-фичи (merge-guard P9, branch-aware
  # memory v3, memory_reindex git-history).

  # Определяем имя репо из URL (strip .git, последний компонент пути)
  local url_without_git="${REPO_URL%.git}"
  local REPO_NAME="${url_without_git##*/}"
  [ -n "$REPO_NAME" ] || die "mode A: cannot derive repo name from REPO_URL=$REPO_URL"

  local TARGET_DIR="$WORKSPACE/$REPO_NAME"

  if [ -d "$TARGET_DIR/.git" ]; then
    # --- существующий workspace: update fallback ---------------------------
    log "mode A: workspace already exists at $TARGET_DIR — fetching + checkout"
    GIT_TERMINAL_PROMPT=0 git -C "$TARGET_DIR" fetch --all --prune ||
      die "mode A: fetch failed for $TARGET_DIR"
    local branch="${GIT_BRANCH:-main}"
    # fallback: если origin/branch не существует — пробуем master
    if ! git -C "$TARGET_DIR" show-ref --verify --quiet "refs/remotes/origin/$branch" 2>/dev/null; then
      branch="master"
    fi
    git -C "$TARGET_DIR" checkout -B "$branch" "origin/$branch" ||
      die "mode A: checkout failed for $branch in $TARGET_DIR"
    # -e .opencode — defense-in-depth для bind-mounted .opencode/ с хоста
    # (mode A с кастомным провайдером)
    git -C "$TARGET_DIR" clean -fd \
      -e .confidential \
      -e .opencode ||
      die "mode A: git clean failed in $TARGET_DIR"
    log "mode A: workspace updated (branch=$branch)"
  else
    # --- fresh clone: /tmp/clone → rsync → TARGET_DIR ---------------------
    log "mode A: cloning $REPO_URL → /tmp/clone (full clone, not shallow)"
    GIT_TERMINAL_PROMPT=0 git clone "$REPO_URL" /tmp/clone ||
      die "mode A: git clone failed for $REPO_URL"
    rsync -a /tmp/clone/ "$TARGET_DIR/" ||
      die "mode A: rsync failed from /tmp/clone to $TARGET_DIR"
    rm -rf /tmp/clone
    log "mode A: clone complete → $TARGET_DIR"
    # checkout branch если задан
    if [ -n "${GIT_BRANCH:-}" ]; then
      local branch="$GIT_BRANCH"
      if ! git -C "$TARGET_DIR" show-ref --verify --quiet "refs/remotes/origin/$branch" 2>/dev/null; then
        branch="master"
        log "WARN: origin/$GIT_BRANCH not found — falling back to master"
      fi
      git -C "$TARGET_DIR" checkout -B "$branch" "origin/$branch" ||
        die "mode A: initial checkout failed for $branch"
      log "mode A: checked out branch=$branch"
    fi
  fi

  PROJECT_ROOT="$TARGET_DIR"
}

# Режим B: live-mount — проверяем дерево, warn при отсутствии .confidential
setup_mode_b() {
  [ -e "$PROJECT_ROOT/.git" ] || die "mode B: $PROJECT_ROOT has no .git"
  if [ -e "$PROJECT_ROOT/.confidential" ]; then
    log "confidential: $PROJECT_ROOT/.confidential present"
  else
    log "WARN: confidential: $PROJECT_ROOT/.confidential missing — 'no confidential data' state (valid, spec §2.5)"
  fi
  link_maestro_logs "$PROJECT_ROOT"
}

# Симлинк .maestro/logs → /maestro/logs — обязателен для Гейта 0
# (скилл ждёт лог по каноническому пути, spec §2.7)
link_maestro_logs() {
  local root="$1"
  local link="$root/.maestro/logs"
  mkdir -p "$root/.maestro"
  if [ -L "$link" ]; then
    return 0
  fi
  if [ -e "$link" ]; then
    log "WARN: state: $link exists and is not a symlink — leaving as-is"
    return 0
  fi
  ln -s "$LOG_DIR" "$link"
  log "state: $link → $LOG_DIR (symlink for Gate 0)"
}

# --- 3. OPENCODE_CONFIG_CONTENT injection ---------------------------------------
# СТРОГИЙ контракт (spec §2.8): инъектируются ТОЛЬКО agents.*.model (из
# OC_*_MODEL) + providers (OC_PROVIDERS_JSON) + default_agent
# (OPENCODE_DEFAULT_AGENT, default "build"). Запрещено: permissions, policies,
# plugins, instructions — эти секции управляются managed-слоем (/etc/opencode/)
# и baked skeleton. Контракт гарантирован конструктивно: генератор строит JSON
# только из этих трёх ключей.
inject_opencode_config() {
  local agents='{}' var val agent
  while IFS= read -r var; do
    [ -n "$var" ] || continue
    val="${!var}"
    [ -n "$val" ] || continue
    agent="$(printf '%s' "$var" | sed -e 's/^OC_//' -e 's/_MODEL$//' | tr '[:upper:]' '[:lower:]')"
    [ -n "$agent" ] || continue
    agents="$(jq -c -n --argjson cur "$agents" --arg k "$agent" --arg m "$val" \
      '$cur + {($k): {model: $m}}')"
    log "config: agents.$agent.model = $val"
  done < <(oc_model_vars)

  local content='{}'
  if [ "$agents" != '{}' ]; then
    content="$(jq -c -n --argjson a "$agents" '{agents: $a}')"
  fi

  if [ -n "${OC_PROVIDERS_JSON:-}" ]; then
    if ! jq -e . >/dev/null 2>&1 <<<"$OC_PROVIDERS_JSON"; then
      die "OC_PROVIDERS_JSON is not valid JSON"
    fi
    content="$(jq -c -n --argjson c "$content" --argjson p "$OC_PROVIDERS_JSON" \
      '$c + {providers: $p}')"
    log "config: providers injected ($(jq -r 'keys | join(", ")' <<<"$OC_PROVIDERS_JSON"))"
  fi

  local default_agent="${OPENCODE_DEFAULT_AGENT:-build}"
  content="$(jq -c -n --argjson c "$content" --arg d "$default_agent" \
    '$c + {default_agent: $d}')"

  export OPENCODE_CONFIG_CONTENT="$content"
  log "config: OPENCODE_CONFIG_CONTENT ready (keys: $(jq -c 'keys' <<<"$content"))"
}

# --- 4. provider allowlist -------------------------------------------------------
# OC_*_MODEL + OC_PROVIDERS_JSON → provider IDs → allow-записи в
# /etc/opencode/opencode.json (policies). Базовый policy — deny provider:*
# (managed layer); allow-записи пишутся root-ом ДО drop. Идемпотентно:
# существующие provider.use-allow записи заменяются.
generate_provider_allowlist() {
  local ids=() var val id
  while IFS= read -r var; do
    [ -n "$var" ] || continue
    val="${!var}"
    case "$val" in
      */*) ids+=("${val%%/*}") ;;
    esac
  done < <(oc_model_vars)
  if [ -n "${OC_PROVIDERS_JSON:-}" ]; then
    while IFS= read -r id; do
      [ -n "$id" ] && ids+=("$id")
    done < <(jq -r 'keys[]' <<<"$OC_PROVIDERS_JSON")
  fi

  local unique=""
  if [ "${#ids[@]}" -gt 0 ]; then
    unique="$(printf '%s\n' "${ids[@]}" | sort -u || true)"
  fi
  if [ -z "$unique" ]; then
    log "providers: no provider IDs detected — provider.use stays deny-all"
    return 0
  fi

  [ -f "$ETC_CONFIG" ] || die "managed config $ETC_CONFIG not found (image build must COPY docker/etc-opencode.json)"

  local entries tmp
  entries="$(printf '%s\n' "$unique" | jq -R -s \
    'split("\n") | map(select(length > 0)) | map({action: "provider.use", resource: ., effect: "allow"})')"
  tmp="$(mktemp)"
  jq --argjson adds "$entries" '
    .policies = ((.policies // []) | map(select(.action != "provider.use" or .effect != "allow"))) + $adds
  ' "$ETC_CONFIG" > "$tmp"
  mv "$tmp" "$ETC_CONFIG"
  # mktemp-файл 600 root — восстанавливаем читаемость для serving-пользователя
  chmod 644 "$ETC_CONFIG"
  log "providers: allowlist → $ETC_CONFIG ($(printf '%s\n' "$unique" | tr '\n' ' ' | sed 's/ $//'))"
}

# --- 5. log retention --------------------------------------------------------------
# Старые логи → tar.gz в /maestro/logs/archive/, затем удаление оригиналов.
# Bootstrap/mem-логи: 30d; audit-лог: 90d. Файлы текущего дня — НЕ трогаем
# (ежедневный файл может писаться в этот момент).
prune_logs() {
  local pattern="$1" days="$2" label="$3"
  local today file base datepart
  today="$(date +%Y-%m-%d)"
  mkdir -p "$LOG_ARCHIVE"

  local candidates
  candidates="$(find "$LOG_DIR" -maxdepth 1 -type f -name "$pattern" -mtime +"$days" 2>/dev/null || true)"
  [ -n "$candidates" ] || return 0

  local to_archive=()
  while IFS= read -r file; do
    [ -n "$file" ] || continue
    base="${file##*/}"
    # дата из имени файла: <prefix>-YYYY-MM-DD.log
    datepart="${base%%.log}"
    datepart="${datepart##*-}"
    if [ "$datepart" = "$today" ]; then
      log "retention: skip current-day file $base"
      continue
    fi
    to_archive+=("$base")
  done <<<"$candidates"

  [ "${#to_archive[@]}" -gt 0 ] || return 0

  local archive="$LOG_ARCHIVE/maestro-logs-$label-$(date +%Y%m%d-%H%M%S).tar.gz"
  (cd "$LOG_DIR" && tar -czf "$archive" "${to_archive[@]}")
  local f
  for f in "${to_archive[@]}"; do
    rm -f "$LOG_DIR/$f"
  done
  log "retention: archived ${#to_archive[@]} file(s) $pattern (>${days}d) → $archive"
}

# --- 6. seed глобального скелета ------------------------------------------------------
# Первый запуск: config-dir пуст → копируем baked skeleton. Повторный запуск:
# существующий конфиг НЕ перезаписываем (operator может кастомизировать).
seed_skeleton() {
  local cfg_dir="${XDG_CONFIG_HOME:-$HOME/.config}/opencode"
  local target="$cfg_dir/opencode.json"
  if [ -f "$target" ]; then
    log "config: global $target present — seed skipped"
    return 0
  fi
  local src="" c
  for c in /root/.config/opencode/opencode.json /opt/maestro/user-opencode.json; do
    if [ -f "$c" ]; then
      src="$c"
      break
    fi
  done
  if [ -z "$src" ]; then
    log "WARN: config: baked skeleton not found — no global opencode.json seeded (operator must provide config)"
    return 0
  fi
  mkdir -p "$cfg_dir"
  cp "$src" "$target"
  chown -R "${DROP_UID}:${DROP_GID}" "$cfg_dir"
  log "config: seeded global skeleton $target (from $src)"
}

# --- 7. core.hooksPath disable --------------------------------------------------------
# Git-хуки клонируемого/смонтанного репо не исполняются в контейнере:
# глобальный core.hooksPath → пустой каталог (защита от произвольных хуков).
disable_git_hooks() {
  mkdir -p /var/empty
  git config --global core.hooksPath /var/empty
  # gitconfig записан в $HOME (= $RUN_HOME) — отдаём serving-пользователю
  if [ -f "$HOME/.gitconfig" ]; then
    chown "${DROP_UID}:${DROP_GID}" "$HOME/.gitconfig"
  fi
  log "git: hooks disabled (core.hooksPath=/var/empty)"
}

# --- 8. chown volumes + drop + serve ---------------------------------------------------
chown_volumes() {
  log "chown volumes → ${DROP_UID}:${DROP_GID} (/workspace /data /cache /maestro)"
  chown -R "${DROP_UID}:${DROP_GID}" /workspace /data /cache /maestro
}

# --- main -----------------------------------------------------------------------------
case "$MODE" in
  A) setup_mode_a ;;
  B) setup_mode_b ;;
esac

inject_opencode_config
generate_provider_allowlist
disable_git_hooks

prune_logs 'maestro-bootstrap-*.log' "${MAESTRO_LOG_RETENTION_DAYS:-30}" bootstrap
prune_logs 'maestro-memory-*.log'    "${MAESTRO_LOG_RETENTION_DAYS:-30}" memory
prune_logs 'maestro-audit-*.log'     "${MAESTRO_AUDIT_LOG_RETENTION_DAYS:-90}" audit

seed_skeleton
chown_volumes

cd "$PROJECT_ROOT"
log "serve: dropping to ${DROP_UID}:${DROP_GID} (cwd $PROJECT_ROOT) → opencode serve"
exec gosu "${DROP_UID}:${DROP_GID}" opencode serve
