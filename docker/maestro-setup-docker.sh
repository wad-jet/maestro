#!/usr/bin/env bash
# =============================================================================
# docker/maestro-setup-docker.sh — бутстрап docker-serve для maestro.
#
# Полная команда с нуля: подготовка хоста, сборка образа, запуск контейнера.
# Заменяет ручную комбинацию шагов: клон → папки → env.docker → build → up.
#
# Использование:
#   curl ... | bash -s --              # полный бутстрап (само-клон)
#   ./maestro-setup-docker.sh [cmd]    # из клона репо
#
# Команды (по умолчанию = setup):
#   (default) setup   — полный бутстрап с нуля (preflight, клон/env, build, up)
#   up                — запуск (авто-build если образа нет)
#   down              — остановить и удалить контейнер
#   logs              — показать логи контейнера (-f tail)
#   health            — проверка healthcheck
#   ps                — список запущенных контейнеров maestro
#   build             — собрать образ maestro-opencode:<version>
#   help              — справка
#
# Флаги setup:
#   --project NAME          — имя проекта (дефолт: auto из REPO_URL)
#   --repo-url URL          — URL репозитория (обязателен, режим A)
#   --git-token TOKEN       — git token (скрытый ввод, пустой = public)
#   --password PASSWORD     — пароль сервера (дефолт: random)
#   --model MODEL           — модель для всех агентов
#   --non-interactive       — без вопросов (все флаги обязательны)
#   --dry-run               — не запускать, только показать план
#
# Настройки по умолчанию:
#   PROJECT_NAME=default    (через env или --project)
#   PROJECT_PORT=4096       (порт хоста)
#   IMAGE_TAG=6.x           (тег образа)
#   MAESTRO_STATE=~/maestro-state/<project>
#   MAESTRO_CONF=~/maestro-confidential/<project>
#
# Зависимости для self-clone: bash, git, curl (должны быть на хосте).
# Зависимости образа: git/rsync/gosu/curl/jq/python3/ca-certificates (в Dockerfile).
# =============================================================================
set -euo pipefail

# --- defaults -------------------------------------------------------------------
PROJECT_NAME="${PROJECT_NAME:-default}"
PROJECT_PORT="${PROJECT_PORT:-4096}"
IMAGE_TAG="${IMAGE_TAG:-6.x}"
OPENCODE_PASSWORD="${OPENCODE_PASSWORD:-}"   # empty = random on first run
MAESTRO_STATE="${MAESTRO_STATE:-}"
MAESTRO_CONF="${MAESTRO_CONF:-}"
GIT_BRANCH="${GIT_BRANCH:-main}"
DOCKER_MODE="${DOCKER_MODE:-A}"             # A=self-contained, B=live-mount
REPO_URL="${REPO_URL:-}"
GIT_TOKEN="${GIT_TOKEN:-}"
MODEL="${MODEL:-}"
NON_INTERACTIVE="${NON_INTERACTIVE:-0}"
DRY_RUN="${DRY_RUN:-0}"

CONTAINER_NAME="maestro-${PROJECT_NAME}"
IMAGE_NAME="maestro-opencode:${IMAGE_TAG}"

# --- helpers --------------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
log()  { echo "[setup] $*"; }
warn() { echo "[setup] WARN: $*" >&2; }
die()  { echo "[setup] ERROR: $*" >&2; exit 1; }

# --- self-locate / self-clone ---------------------------------------------------
# Определяем REPO_ROOT (маэстро authoring clone, build-context для образа).
# Если запущен из клона → используем его.
# Если запущен через curl (pipe) → клонируем в ~/dev/maestro и re-invoc.

detect_self_clone() {
  # Проверяем, что SCRIPT_DIR/../ — это клон wad-jet/maestro
  local candidate="$(cd "$SCRIPT_DIR/.." 2>/dev/null && pwd)"
  if [ -f "$candidate/maestro-install.sh" ] && [ -d "$candidate/skills" ] && [ -d "$candidate/docker" ]; then
    REPO_ROOT="$candidate"
    log "self-locate: находимся в клоне maestro ($REPO_ROOT)"
    return 0
  fi
  return 1
}

self_clone() {
  local target="${MAESTRO_SRC:-$HOME/dev/maestro}"
  mkdir -p "$(dirname "$target")"
  log "self-clone: клонируем maestro → $target (https-only, shallow) ..."

  # Клон-первый: до любых действий (канон maestro-install.sh)
  if [ -d "$target/.git" ]; then
    log "self-clone: уже есть $target, обновляем ..."
    (cd "$target" && git fetch --quiet origin) || warn "fetch failed, continuing with existing"
  else
    git clone --quiet --depth 1 https://github.com/wad-jet/maestro.git "$target"
  fi

  # Re-invoke из клона (self-clone)
  log "self-clone: re-invoke из клона ..."
  local self_name
  self_name="$(basename "$BASH_SOURCE")"
  exec bash "$target/docker/$self_name" "$@"
}

# --- preflight ------------------------------------------------------------------
preflight() {
  local missing=()
  command -v docker >/dev/null 2>&1 || missing+=("docker")
  command -v git    >/dev/null 2>&1 || missing+=("git")
  command -v curl   >/dev/null 2>&1 || missing+=("curl")
  command -v jq     >/dev/null 2>&1 || missing+=("jq")

  if [ ${#missing[@]} -gt 0 ]; then
    die "Не установлены необходимые утилиты: ${missing[*]}"
  fi

  # Проверка демона docker (не просто бинарника, но и running daemon)
  if ! docker info >/dev/null 2>&1; then
    die "Docker daemon не запущен. Запустите Docker Desktop или dockerd."
  fi

  # opencode CLI — warn, не блокирует
  if ! command -v opencode >/dev/null 2>&1; then
    warn "opencode CLI не установлен (не требуется для запуска, но нужен для TUI-подключения)"
    warn "Установка: curl -fsSL https://opencode.ai/install | bash"
  fi

  # openssl (для генерации случайного пароля)
  if ! command -v openssl >/dev/null 2>&1; then
    warn "openssl не найден — случайный пароль будет сгенерирован через /dev/urandom"
  fi
}

# --- random password ------------------------------------------------------------
generate_password() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -base64 12
  else
    head -c 9 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 12
  fi
}

# --- wizard ---------------------------------------------------------------------
wizard_env() {
  local env_file="$SCRIPT_DIR/.env.docker"

  # Если .env.docker уже есть — используем как есть
  if [ -f "$env_file" ]; then
    log "config: .env.docker уже существует — используем как есть"
    return 0
  fi

  # Если неинтерактивный — die с подсказкой
  if [ "$NON_INTERACTIVE" = "1" ]; then
    die ".env.docker не найден. В non-interactive режиме создайте файл вручную:\n\
  $0 setup --repo-url <url> --password <pass> --model <provider/model>\n\
Или запустите без --non-interactive для интерактивного wizard."
  fi

  echo ""
  echo "  ============================================="
  echo "  Maestro Docker Setup — быстрый wizard"
  echo "  ============================================="
  echo ""

  # PROJECT_NAME
  if [ -n "$PROJECT_NAME" ] && [ "$PROJECT_NAME" != "default" ]; then
    log "project: задаётся флагом — $PROJECT_NAME"
  fi

  # REPO_URL (обязателен для режима A)
  if [ -z "$REPO_URL" ]; then
    echo -n "  URL репозитория проекта (https://github.com/...): "
    read -r REPO_URL
    [ -n "$REPO_URL" ] || die "REPO_URL обязателен"
  else
    log "project: REPO_URL из флага — $REPO_URL"
  fi

  # GIT_TOKEN
  if [ -z "$GIT_TOKEN" ]; then
    echo -n "  Git token (GitHub PAT) — [enter = public repo]: "
    read -r -s GIT_TOKEN
    echo ""
  else
    log "project: GIT_TOKEN из флага"
  fi

  # OPENCODE_PASSWORD
  if [ -z "$OPENCODE_PASSWORD" ]; then
    OPENCODE_PASSWORD="$(generate_password)"
    echo "  Генерация пароля сервера: $OPENCODE_PASSWORD"
    log "project: password сгенерирован random"
  else
    log "project: OPENCODE_PASSWORD из флага"
  fi

  # MODEL
  if [ -z "$MODEL" ]; then
    echo -n "  Модель для всех агентов (provider/model, дефолт: akash/Qwen3.6-35B-A3B): "
    read -r MODEL
    MODEL="${MODEL:-akash/Qwen3.6-35B-A3B}"
  else
    log "project: MODEL из флага — $MODEL"
  fi

  # Генерируем .env.docker
  log "config: генерируем .env.docker ..."
  cat > "$env_file" <<EOF
OPENCODE_PASSWORD="${OPENCODE_PASSWORD}"
REPO_URL="${REPO_URL}"
GIT_TOKEN="${GIT_TOKEN}"
OC_BUILD_MODEL="${MODEL}"
OC_CUSTODIAN_MODEL="${MODEL}"
OC_SANITIZER_MODEL="${MODEL}"
EOF
  chmod 600 "$env_file"
  log "config: .env.docker создан ($env_file, chmod 600)"
}

# --- create dirs ----------------------------------------------------------------
ensure_dirs() {
  local state_dir="${MAESTRO_STATE:-$HOME/maestro-state/${PROJECT_NAME}}"
  local conf_dir="${MAESTRO_CONF:-$HOME/maestro-confidential/${PROJECT_NAME}}"

  for d in "$state_dir" "$conf_dir"; do
    if [ ! -d "$d" ]; then
      mkdir -p "$d"
      chmod 700 "$d"
      log "dirs: created $d (chmod 700)"
    fi
  done
}

# --- build ----------------------------------------------------------------------
cmd_build() {
  log "Сборка образа $IMAGE_NAME ..."

  local maestro_sha
  if [ -n "${REPO_ROOT:-}" ] && [ -d "$REPO_ROOT" ]; then
    maestro_sha="$(cd "$REPO_ROOT" && git rev-parse HEAD)" ||
      die "Не удалось определить HEAD в $REPO_ROOT"
  else
    maestro_sha="$(cd "$SCRIPT_DIR/.." && git rev-parse HEAD 2>/dev/null)" ||
      die "Не удалось определить HEAD в $SCRIPT_DIR/.."
  fi

  docker build \
    -f "$SCRIPT_DIR/Dockerfile" \
    --build-arg MAESTRO_SHA="$maestro_sha" \
    -t "$IMAGE_NAME" \
    "$SCRIPT_DIR/.."

  log "Образ собран: $IMAGE_NAME ($maestro_sha)"
}

# --- up -------------------------------------------------------------------------
cmd_up() {
  # Авто-build: если образа нет
  if ! docker image inspect "$IMAGE_NAME" >/dev/null 2>&1; then
    warn "Образ $IMAGE_NAME не найден — авто-сборка ..."
    cmd_build
  fi

  # Остановить существующий (не удалять — volumes сохраняются)
  if docker ps -a --format '{{.Names}}' 2>/dev/null | grep -qx "$CONTAINER_NAME"; then
    log "Остановка существующего контейнера $CONTAINER_NAME ..."
    docker stop "$CONTAINER_NAME" 2>/dev/null || true
    docker rm   "$CONTAINER_NAME" 2>/dev/null || true
  fi

  # Определяем имя репо
  local repo_name
  if [ -n "$REPO_URL" ]; then
    repo_name="${REPO_URL%.git}"
    repo_name="${repo_name##*/}"
  else
    repo_name="$(cd "$SCRIPT_DIR/../.." 2>/dev/null && git remote get-url origin 2>/dev/null | sed -E 's|.*/([^/]+\.git)$|\1|' | sed 's/\.git$//' || echo unknown-repo)"
    [ -n "$repo_name" ] || repo_name="unknown-repo"
  fi

  # Командная строка
  local cmd=(docker run -d)
  cmd+=(--name "$CONTAINER_NAME")
  cmd+=(-p "127.0.0.1:${PROJECT_PORT}:4096")
  cmd+=(--env-file "$SCRIPT_DIR/.env.docker")

  if [ "$DOCKER_MODE" = "A" ]; then
    [ -n "$REPO_URL" ] || die "Для режима A требуется REPO_URL"
    cmd+=(
      -v "oc-ws-${PROJECT_NAME}:/workspace"
      -v "oc-data-${PROJECT_NAME}:/data"
      -v "oc-cache-${PROJECT_NAME}:/cache"
      -v "${MAESTRO_STATE:-$HOME/maestro-state/${PROJECT_NAME}}:/maestro"
    )
    # .confidential
    local conf_dir="${MAESTRO_CONF:-$HOME/maestro-confidential/${PROJECT_NAME}}"
    if [ -d "$conf_dir" ]; then
      cmd+=(-v "${conf_dir}:/workspace/${repo_name}/.confidential:ro")
    fi
  else
    # Mode B: live-mount
    local mount_src
    mount_src="$(cd "$SCRIPT_DIR/../.." 2>/dev/null && pwd)"
    cmd+=(
      -v "${mount_src}:/workspace/${repo_name}"
      -v "oc-data-${PROJECT_NAME}:/data"
      -v "oc-cache-${PROJECT_NAME}:/cache"
      -v "${MAESTRO_STATE:-$HOME/maestro-state/${PROJECT_NAME}}:/maestro"
    )
  fi

  cmd+=("$IMAGE_NAME")
  docker "${cmd[@]}"

  log "Контейнер запущен: $CONTAINER_NAME"
  log "Port: http://127.0.0.1:${PROJECT_PORT}"
}

# --- down -----------------------------------------------------------------------
cmd_down() {
  if ! docker ps -a --format '{{.Names}}' 2>/dev/null | grep -qx "$CONTAINER_NAME"; then
    warn "Контейнер $CONTAINER_NAME не найден."
    return 0
  fi
  log "Остановка и удаление контейнера $CONTAINER_NAME ..."
  docker stop "$CONTAINER_NAME" 2>/dev/null || true
  docker rm   "$CONTAINER_NAME" 2>/dev/null || true
  log "Контейнер удалён."
}

# --- logs -----------------------------------------------------------------------
cmd_logs() {
  if ! docker ps --format '{{.Names}}' 2>/dev/null | grep -qx "$CONTAINER_NAME"; then
    die "Контейнер $CONTAINER_NAME не запущен."
  fi
  docker logs -f "$CONTAINER_NAME" 2>/dev/null ||
    docker logs "$CONTAINER_NAME" 2>/dev/null ||
    die "Не удалось получить логи."
}

# --- health ---------------------------------------------------------------------
cmd_health() {
  if ! docker ps --format '{{.Names}}' 2>/dev/null | grep -qx "$CONTAINER_NAME"; then
    die "Контейнер $CONTAINER_NAME не запущен."
  fi
  log "Проверка healthcheck ..."
  docker exec "$CONTAINER_NAME" /usr/local/bin/healthcheck.sh &&
    log "OK: healthcheck прошёл" ||
    warn "Healthcheck FAILED — проверьте логи: docker logs $CONTAINER_NAME"
}

# --- ps -------------------------------------------------------------------------
cmd_ps() {
  docker ps -a --filter "name=^maestro-" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}" 2>/dev/null ||
    echo "(no maestro containers found)"
}

# --- help -----------------------------------------------------------------------
cmd_help() {
  cat <<'EOF'
docker/maestro-setup-docker.sh — бутстрап docker-serve для maestro

Использование:
  ./docker/maestro-setup-docker.sh [command] [flags]

Команды (по умолчанию = setup):
  setup   — полный бутстрап с нуля: preflight → self-clone → wizard → build → up
  up      — запуск (авто-build если образа нет)
  down    — остановить и удалить контейнер
  logs    — логи контейнера (-f tail)
  health  — проверка healthcheck
  ps      — список запущенных контейнеров maestro
  build   — собрать образ
  help    — эта справка

Флаги setup:
  --project NAME          — имя проекта
  --repo-url URL          — URL репозитория (обязателен для режима A)
  --git-token TOKEN       — git token (скрытый ввод, пустой = public)
  --password PASSWORD     — пароль сервера (дефолт: random)
  --model MODEL           — модель для всех агентов (provider/model)
  --non-interactive       — без вопросов (все флаги обязательны)
  --dry-run               — не запускать, только показать план

Переменные окружения:
  PROJECT_NAME    — имя проекта         (дефолт: "default")
  PROJECT_PORT    — порт хоста          (дефолт: 4096)
  IMAGE_TAG       — тег образа          (дефолт: "6.x")
  MAESTRO_STATE   — хост-путь /maestro  (дефолт: ~/maestro-state/<project>)
  MAESTRO_CONF    — хост-путь .confidential (дефолт: ~/maestro-confidential/<project>)
  MODEL           — модель для всех     (дефолт: akash/Qwen3.6-35B-A3B)

Примеры:
  # Полная интерактивная команда с нуля (curl):
  curl -fsSL https://raw.githubusercontent.com/wad-jet/maestro/main/docker/maestro-setup-docker.sh \
    | bash -s --

  # Полная неинтерактивная (CI):
  ./docker/maestro-setup-docker.sh setup \
    --project myapp --repo-url https://github.com/you/myapp.git \
    --git-token "$PAT" --password "mypass" --model "akash/Qwen3.6-35B-A3B" \
    --non-interactive

  # Рутина:
  ./docker/maestro-setup-docker.sh logs -f
  ./docker/maestro-setup-docker.sh down
  ./docker/maestro-setup-docker.sh up

См. docker/README.md и manual_docs/how-to/docker-serve.md — полная документация.
EOF
}

# --- setup command ----------------------------------------------------------------
cmd_setup() {
  echo ""
  echo "  ╔═══════════════════════════════════════════════╗"
  echo "  ║         Maestro Docker Setup                  ║"
  echo "  ║  Подготовка хоста, сборка, запуск             ║"
  echo "  ╚═══════════════════════════════════════════════╝"
  echo ""

  # --- 1. Preflight ---
  log "Шаг 1/5: preflight ..."
  preflight

  # --- 2. Self-locate / self-clone ---
  log "Шаг 2/5: self-locate / self-clone ..."
  if ! detect_self_clone; then
    log "self-locate не удалось — запускаю self-clone ..."
    self_clone
    # Этот код недостижим из-за exec в self_clone
    die "self_clone exited unexpectedly"
  fi

  # --- 3. Wizard .env.docker ---
  log "Шаг 3/5: генерация .env.docker ..."
  wizard_env

  # --- 4. Рабочие папки ---
  log "Шаг 4/5: рабочие папки ..."
  ensure_dirs

  # --- 5. Build + up ---
  log "Шаг 5/5: build + up ..."
  if [ "$DRY_RUN" = "1" ]; then
    echo ""
    echo "  === DRY RUN PLAN ==="
    echo "  1. Preflight: docker, git, curl ✓"
    echo "  2. Clone:    $REPO_ROOT"
    echo "  3. Env:      $SCRIPT_DIR/.env.docker"
    echo "  4. Dirs:     ~/maestro-state/$PROJECT_NAME"
    echo "  5. Build:    docker build -t $IMAGE_NAME"
    echo "  6. Up:       docker run --name $CONTAINER_NAME ..."
    echo ""
    echo "  ДRY RUN завершён. Для запуска уберите --dry-run."
    return 0
  fi

  cmd_build
  cmd_up

  # --- 6. Healthcheck-wait ---
  log "Ожидание готовности (healthcheck) ..."
  local retries=40 delay=3
  for ((i=1; i<=retries; i++)); do
    if curl -sf -u "opencode:${OPENCODE_PASSWORD:-dev-password}" \
        "http://127.0.0.1:${PROJECT_PORT}/api/info" >/dev/null 2>&1; then
      log "Готово! (попыток: $i)"
      break
    fi
    if [ "$i" -eq "$retries" ]; then
      warn "Не удалось пройти healthcheck за $((retries * delay))с."
      warn "Контейнер может быть в процессе инициализации."
      warn "Проверьте: docker logs $CONTAINER_NAME"
    fi
    sleep "$delay"
  done

  # --- 7. Connect hint ---
  echo ""
  echo "  ╔═══════════════════════════════════════════════╗"
  echo "  ║  Maestro готов!                               ║"
  echo "  ╚═══════════════════════════════════════════════╝"
  echo ""
  echo "  Подключение:"
  echo "    OPENCODE_PASSWORD='${OPENCODE_PASSWORD:-dev-password}' \\"
  echo "      opencode --server http://127.0.0.1:${PROJECT_PORT}"
  echo ""
  echo "  В первой сессии выполните:"
  echo "    /maestro-setup              → инициализация проекта"
  echo "    /maestro-init \"Задача\"      → пайплайн"
  echo ""
  echo "  Управление:"
  echo "    ./docker/maestro-setup-docker.sh logs   — логи"
  echo "    ./docker/maestro-setup-docker.sh down   — стоп"
  echo ""
}

# --- parse flags ----------------------------------------------------------------
parse_flags() {
  while [ $# -gt 0 ]; do
    case "$1" in
      --project)     PROJECT_NAME="$2"; shift 2 ;;
      --repo-url)    REPO_URL="$2"; shift 2 ;;
      --git-token)   GIT_TOKEN="$2"; shift 2 ;;
      --password)    OPENCODE_PASSWORD="$2"; shift 2 ;;
      --model)       MODEL="$2"; shift 2 ;;
      --non-interactive) NON_INTERACTIVE="1"; shift ;;
      --dry-run)     DRY_RUN="1"; shift ;;
      --help|-h)     cmd_help; return 0 ;;
      *) shift ;;   # пропускаем unknown args (для pipe: bash -s -- skip --)
    esac
  done
}

# --- parse command (first non-flag arg) -----------------------------------------
# Аргументы могут быть: command [flags] или [flags] (command по умолчанию = setup)
parse_args() {
  local cmd=""
  for arg in "$@"; do
    case "$arg" in
      --*|"--") break ;;     # флаг — стоп, команда не найдена
      *)
        if [ -z "$cmd" ]; then
          cmd="$arg"
        fi
        ;;
    esac
  done

  if [ -z "$cmd" ]; then
    cmd="setup"
  fi
  echo "$cmd"
}

# --- main ------------------------------------------------------------------------
main() {
  # --- 1. Parse flags from args ---
  # Extract all --flags from args, store remaining non-flag args
  local flags_args=() remaining_args=()
  for arg in "$@"; do
    case "$arg" in
      --*) flags_args+=("$arg") ;;
      *) remaining_args+=("$arg") ;;
    esac
  done

  # --- 2. Parse --flags ---
  if [ ${#flags_args[@]} -gt 0 ]; then
    parse_flags "${flags_args[@]}"
  fi

  # --- 3. Parse command ---
  local cmd
  cmd="$(parse_args "${remaining_args[@]}")"

  # --- 4. Dispatch ---
  case "$cmd" in
    setup)
      cmd_setup
      ;;
    up)
      cmd_up
      ;;
    down)
      cmd_down
      ;;
    logs)
      cmd_logs
      ;;
    health)
      cmd_health
      ;;
    ps)
      cmd_ps
      ;;
    build)
      cmd_build
      ;;
    help|--help|-h)
      cmd_help
      ;;
    *)
      die "Неизвестная команда: $cmd. Используйте: $(basename "$0") help"
      ;;
  esac
}

main "$@"
