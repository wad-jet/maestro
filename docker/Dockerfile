# syntax=docker/dockerfile:1

# =============================================================================
# docker/Dockerfile — образ docker-serve для maestro.
# Спека: docs/superpowers/specs/2026-10-20-docker-serve-design.md.
#
# Stage 1 `maestro-base`: opencode CLI v2 (pin-версия) + maestro (wholesale,
# pinned SHA) + superpowers (baked, pinned SHA) + managed security baseline
# (/etc/opencode/opencode.json) + global skeleton (~/.config/opencode/opencode.json).
#
# Сборка (из корня authoring-репо maestro — build context = репозиторий):
#
#   docker build -f docker/Dockerfile \
#     --build-arg MAESTRO_SHA=$(git rev-parse HEAD) \
#     -t maestro-opencode:6.x .
#
# MAESTRO_SHA — ОБЯЗАТЕЛЬНЫЙ build-arg (fail-closed): пин коммита maestro для
# wholesale-деплоя скиллов (атомарность скиллов ↔ плагина, канон maestro-install).
# Пустой/невалидный SHA → сборка падает (RUN ниже).
#
# ВАЖНО: USER opencode здесь НЕ устанавливаем — entrypoint стартует от root
# (chown volumes) и дропается на uid 1000 через gosu (docker/entrypoint.sh).
# =============================================================================

FROM node:20-slim AS maestro-base
LABEL maintainer="maestro <maintainer@example.com>"

# Зависимости для entrypoint и установщика maestro:
# git/rsync/gosu/curl/jq — preflight entrypoint + режим A (safe clone) +
# healthcheck; python3 — JSON-операции maestro-install.sh (manifest,
# регистрация плагина, глобальный maestro.json); ca-certificates — системный
# CA-store (в node:20-slim отсутствует; без него git clone https падает:
# «server certificate verification failed»; npm не показателен — он носит
# собственный CA-bundle).
RUN apt-get update && apt-get install -y --no-install-recommends \
      git rsync gosu curl jq ca-certificates python3 \
    && rm -rf /var/lib/apt/lists/*

# OpenCode CLI v2 (pin-версия — baseline 2.0.32 из спеки; версия opencode НЕ
# обязана совпадать с версией maestro). V2-пакет в npm — @opencode/cli
# (пакета `opencode` в V2 нет); postinstall подбирает нативный бинарник
# под платформу.
RUN npm install -g @opencode/cli@2.0.32

# --- maestro: wholesale-зеркало из build context (authoring repo) ------------
# /opt/maestro — источник установщика и local-path плагина (plugins-записи
# в global skeleton: /opt/maestro/plugins/maestro-bootstrap, /opt/superpowers —
# directory-form, единственная форма для локальных путей в конфиге opencode v2:
# file-path записи отбрасываются с WARN «configured plugin path must be a
# directory»). Скиллы/команды/агенты деплоятся установщиком (ниже) в XDG-каталог
# serving-пользователя (uid 1000), а не остаются в /opt.
COPY maestro-install.sh /opt/maestro/maestro-install.sh
COPY skills/ /opt/maestro/skills/
COPY commands/ /opt/maestro/commands/
COPY agents/ /opt/maestro/agents/
COPY plugins/maestro-bootstrap/ /opt/maestro/plugins/maestro-bootstrap/

# --- maestro deploy (wholesale, pinned) ----------------------------------------
# Канон доставки: maestro-install.sh --global (git clone https-only shallow +
# wholesale copy + manifest). XDG_CONFIG_HOME указывает на HOME
# serving-пользователя (uid 1000): opencode serve после gosu-drop читает
# скиллы из ~/.config/opencode, а плагин резолвит глобальный maestro.json
# (и .maestro-состояние) там же. Установщик пишет свой opencode.json
# (git+https-регистрация плагина) — skeleton-копия ниже его перезаписывает.
#
# Отклонения от эскиза плана (интерфейс maestro-install.sh 6.x): флагов
# --deploy/--no-halt/--skip-config не существует — фактический интерфейс
# --global/--project + --pin <sha>; non-interactive — штатный путь установщика
# (fail-closed на конфликтах; в свежем образе конфликтов нет). `2>/dev/null
# || true` удалён: MAESTRO_SHA обязателен, деплой должен ронять сборку при
# ошибке (fail-closed, план: «required, NOT optional»).
ARG MAESTRO_SHA
RUN if [ -z "${MAESTRO_SHA:-}" ]; then \
      echo "ERROR: MAESTRO_SHA build-arg required (--build-arg MAESTRO_SHA=<commit-sha>)" >&2; \
      exit 1; \
    fi \
    && cd /opt/maestro \
    && XDG_CONFIG_HOME=/home/opencode/.config bash maestro-install.sh --global --pin "$MAESTRO_SHA"

# --- superpowers plugin (baked, pinned commit) --------------------------------
# НЕ git+https runtime-clone (supply-chain risk) — фиксируем коммит в образ.
# PROD: заменить SHA на актуальный:
#   git ls-remote https://github.com/obra/superpowers.git HEAD | awk '{print $1}'
# Shallow + fetch по SHA — тот же паттерн, что pin_checkout в maestro-install.sh
# (GitHub позволяет fetch произвольного reachable-sha). Неверный SHA → build fail.
ENV SUPERPOWERS_SHA=b739a8af570e10a95898f2bdf6cec97467fa6c12
RUN git clone --quiet --depth 1 https://github.com/obra/superpowers.git /opt/superpowers \
    && git -C /opt/superpowers fetch --quiet --depth 1 origin "$SUPERPOWERS_SHA" \
    && git -C /opt/superpowers checkout --quiet --detach "$SUPERPOWERS_SHA" \
    && rm -rf /opt/superpowers/.git

# --- entrypoint + healthcheck ---------------------------------------------------
COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh
COPY docker/healthcheck.sh /usr/local/bin/healthcheck.sh
RUN chmod +x /usr/local/bin/entrypoint.sh /usr/local/bin/healthcheck.sh

# --- managed security baseline ---------------------------------------------------
# /etc/opencode — системный слой конфига opencode v2 (linux): permissions/policies
# с высшим file precedence, не перекрывается committed opencode.json проекта.
COPY docker/etc-opencode.json /etc/opencode/opencode.json

# --- global skeleton (user-layer) -----------------------------------------------
# (1) /root/... — источник seed для entrypoint (seed_skeleton ищет
#     /root/.config/opencode/opencode.json; `~` в COPY Docker не раскрывает —
#     абсолютный путь = HOME root на момент сборки);
# (2) /home/opencode/... — эффективный конфиг serving-пользователя (uid 1000):
#     перезаписывает конфиг установщика (git+https-регистрация плагина),
#     остаются local-path записи из skeleton.
COPY docker/user-opencode.json /root/.config/opencode/opencode.json
COPY docker/user-opencode.json /home/opencode/.config/opencode/opencode.json

# --- non-root user (uid 1000) ------------------------------------------------------
# ВАЖНО: USER НЕ устанавливаем — root-entrypoint (chown volumes → gosu drop);
# образ с USER opencode падает на bind-mounted volume (root-owned каталоги
# недоступны uid 1000). /home/opencode отдаём пользователю целиком —
# runtime-writability (~/.local/state, gitconfig, plugin-состояние) и паритет
# с dev-машиной (глобальная установка maestro живёт в ~/.config пользователя);
# барьер для агента — нативные permissions (/etc/opencode), не владение файлами
# (SECURITY.md §5: «не OS-барьер»).
#
# uid 1000 в node:20-slim уже занят штатным пользователем `node` (gid 1000) —
# adduser с uid 1000 падает («UID already in use»). Переименовываем штатного
# пользователя: сохраняет uid/gid 1000, home уже создан выше (installer deploy
# + skeleton COPY писали в /home/opencode). entrypoint резолвит HOME через
# getent → /home/opencode.
RUN usermod -l opencode -d /home/opencode node \
    && groupmod -n opencode node \
    && mkdir -p /workspace /data /cache /maestro \
    && chown -R opencode:opencode /workspace /data /cache /maestro /home/opencode

WORKDIR /workspace
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]

# =============================================================================
# Stage 2 (ОПЦИОНАЛЬНО): per-project образ поверх maestro-base. Собирается
# ОТДЕЛЬНЫМ Dockerfile в репо целевого приложения (после публикации/тега
# базового образа):
#
#   FROM maestro-base:6.x AS myapp
#   # per-project: opencode.json, instructions — по необходимости
#   COPY opencode.json /workspace/opencode.json
#
# Предпочтительная альтернатива (спека): единый образ + per-project конфигурация
# через env (OPENCODE_CONFIG_CONTENT, OC_*_MODEL) — Stage 2 не требуется.
# (Стейдж сознательно закомментирован: `FROM maestro-base:6.x` — ссылка на
# образ-тег, а не на имя стейджа; активная строка ломает дефолтную сборку
# этого Dockerfile.)
# =============================================================================
