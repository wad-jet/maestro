# Docker Quick Start — hello world

> Запуск maestro в Docker за 5 минут — от нуля до первой задачи.

## Быстрый старт (hello world, 5 минут)

### Шаг 1: `.env.docker` — один провайдер на все агенты

Минимальный конфиг — одна модель для всех агентов, минимальный набор env-переменных:

```bash
echo 'OPENCODE_PASSWORD="dev-password"
REPO_URL="https://github.com/you/hello-maestro.git"
GIT_TOKEN="github_pat_xxxxxxxxxxxx"
OC_BUILD_MODEL="akash/Qwen3.6-35B-A3B"
OC_PLAN_MODEL="akash/Qwen3.6-35B-A3B"
OC_CUSTODIAN_MODEL="akash/Qwen3.6-35B-A3B"
OC_OPUS_MODEL="akash/Qwen3.6-35B-A3B"
OC_SONNET_MODEL="akash/Qwen3.6-35B-A3B"
OC_HAIKU_MODEL="akash/Qwen3.6-35B-A3B"
OC_FABLE_MODEL="akash/Qwen3.6-35B-A3B"
OC_REVIEWER_MODEL="akash/Qwen3.6-35B-A3B"' > .env.docker

chmod 600 .env.docker
```

> **Безопасность:** `.env.docker` содержит токены — `chmod 600`.

### Шаг 2: `docker run` — запуск контейнера

```bash
docker run -d \
  --name maestro-hello \
  --env-file .env.docker \
  -v oc-ws-hello:/workspace \
  -v oc-data-hello:/data \
  -v oc-cache-hello:/cache \
  -p ${PROJECT_PORT:-127.0.0.1:4096}:4096 \
  maestro-opencode:6.x
```

**Объёмы:**

| Volume | Тип | Назначение |
|---|---|---|
| `oc-ws-hello:/workspace` | named | клон репо (ценный, переживает рестарт) |
| `oc-data-hello:/data` | named | `opencode.db` + snapshots (ценный, backup) |
| `oc-cache-hello:/cache` | named | кэш моделей (расходный, пересоздаваемый) |

> **Параметризация порта:** `${PROJECT_PORT:-127.0.0.1:4096}` — для N проектов на одной машине.
> Для production: `-p 127.0.0.1:4096:4096` (только localhost) или SSH-туннель.

### Шаг 3: TUI-подключение

```bash
OPENCODE_PASSWORD=dev-password opencode --server http://127.0.0.1:4096
```

### Шаг 4: первая задача

```
> @maestro-init Добавить в README секцию «Contributing»
```

**Результат:** спека + план в `docs/superpowers/`, ветка в `origin`, логи в `~/maestro-state/hello/logs/`.

---

## Управление контейнером

### Проверка здоровья

```bash
# HTTP healthcheck (не интерполирует пароль — безопасно для docker inspect)
curl -sf -u "opencode:${OPENCODE_PASSWORD}" http://127.0.0.1:4096/api/info

# Использует встроенный скрипт в образе: /usr/local/bin/healthcheck.sh
# В docker-compose: test: ["CMD", "/usr/local/bin/healthcheck.sh"]
```

### Остановка и запуск

```bash
# Остановить (volumes сохраняются)
docker stop maestro-hello

# Запустить снова
docker start maestro-hello
```

### Полный сброс

```bash
# Удалить контейнер (volumes сохраняются)
docker rm maestro-hello

# Перезапустить
docker run -d \
  --name maestro-hello \
  --env-file .env.docker \
  -v oc-ws-hello:/workspace \
  -v oc-data-hello:/data \
  -v oc-cache-hello:/cache \
  -p ${PROJECT_PORT:-127.0.0.1:4096}:4096 \
  maestro-opencode:6.x
```

> **Важно:** `docker stop/start` НЕ пересоздаёт volumes — сессии и артефакты сохраняются.
> Для полного удаления данных: `docker rm -v maestro-hello`.

---

## Production-настройки

### docker-compose.yml

```yaml
services:
  opencode:
    image: maestro-opencode:6.x
    env_file: .env.docker
    volumes:
      - oc-ws:/workspace
      - oc-data:/data
      - oc-cache:/cache
    ports:
      - "${PROJECT_PORT:-127.0.0.1:4096}:4096"
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "/usr/local/bin/healthcheck.sh"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 120s

volumes:
  oc-ws:
    name: oc-ws-${PROJECT_NAME}
  oc-data:
    name: oc-data-${PROJECT_NAME}
  oc-cache:
    name: oc-cache-${PROJECT_NAME}
```

Запуск:

```bash
PROJECT_NAME=myapp docker compose up -d
```

> **Важно:** `~` не раскрывается в docker-compose — используйте `${HOME}`.
> `start_period: 120s` — полный клон может занять минуты.
> **`docker compose down -v`** — УДАЛЯЕТ named volumes. Используйте `docker compose down` (без `-v`) для остановки.

### Hardening (рекомендуемый набор)

```bash
docker run -d \
  --cap-drop=ALL \
  --security-opt no-new-privileges \
  --env-file .env.docker \
  -v oc-ws-hello:/workspace \
  -v oc-data-hello:/data \
  -v oc-cache-hello:/cache \
  -p 127.0.0.1:4096:4096 \
  maestro-opencode:6.x
```

| Флаг | Назначение |
|---|---|
| `--cap-drop=ALL` | Удаляет все Linux capabilities |
| `--security-opt no-new-privileges` | Запрещает escalation через setuid/setgid |
| `-p 127.0.0.1:4096:4096` | API только на localhost |

---

## Режимы

### Режим A: self-contained (по умолчанию)

Контейнер сам клонирует репо через `REPO_URL` + `GIT_TOKEN`.

```bash
docker run -d \
  --name maestro-<project> \
  --env-file .env.docker \
  -v oc-ws-<project>:/workspace \
  -v oc-data-<project>:/data \
  -v oc-cache-<project>:/cache \
  -v ~/maestro-state/<project>:/maestro \
  -v ~/maestro-confidential/<project>:/workspace/<repo>/.confidential:ro \
  -p ${PROJECT_PORT:-127.0.0.1:4096}:4096 \
  maestro-opencode:6.x
```

### Режим B: live-mount

Монтирует уже склонированное дерево хоста. `REPO_URL` **НЕ** задавать.

```bash
docker run -d \
  --name maestro-<project> \
  -v ~/dev/myapp:/workspace/myapp \
  -v oc-data-<project>:/data \
  -v oc-cache-<project>:/cache \
  -p ${PROJECT_PORT:-127.0.0.1:4096}:4096 \
  maestro-opencode:6.x
```

> **Serial-режим:** только один контейнер может иметь rw-доступ к дереву.

---

## Диагностика

| Проблема | Решение |
|---|---|
| Контейнер не стартует | `docker logs maestro-<project>` — entrypoint логирует этапы |
| `.confidential` пустой | Проверьте `~/maestro-confidential/<project>` на хосте |
| `git clone` падает | Проверьте `GIT_TOKEN` scope; убедитесь `REPO_URL` доступен |
| `opencode --server` не подключается | Проверьте `OPENCODE_PASSWORD`; healthcheck: `curl -u opencode:$PW http://127.0.0.1:4096/api/info` |
| Logs не видны | Проверьте `~/maestro-state/<project>/logs/`; daily JSONL, фильтруйте по sessionID через `jq` |

---

## Обновление

```bash
# 1. Остановить и удалить контейнер (volumes сохраняются)
docker stop maestro-hello && docker rm maestro-hello

# 2. Пересобрать образ
docker build -t maestro-opencode:6.x -f docker/Dockerfile .

# 3. Запустить с новым образом
docker run -d ... (те же флаги) maestro-opencode:6.x
```

> `docker start` НЕ обновляет образ — обновление = `rm` + `run`. Данные в named volumes переживают.
