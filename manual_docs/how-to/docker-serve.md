# Docker: запуск maestro в контейнере

> Полное руководство по запуску maestro в Docker — от быстрого старта до production-настроек.
> Расширяет [spec §5](../../docs/superpowers/specs/2026-10-20-docker-serve-design.md#5-how-to-запуск-maestro-в-docker).
> Быстрый hello world — в [docker/README.md](../../docker/README.md).

---

## 1. Предварительные требования

1. **Docker** с поддержкой named volumes и bind mounts (Docker Desktop / Docker Engine ≥ 24).
2. **Token для git** (`GH_PAT` или `GIT_TOKEN`) — **fine-grained personal access token** с scope `contents: write` на целевую репо (и только на неё). **Обязательно**: expiry 30 дней, без org-admin scope. Для режима live-mount без git — не требуется.
3. **Model env-переменные** — `OC_BUILD_MODEL`, `OC_PLAN_MODEL`, `OC_CUSTODIAN_MODEL`, `OC_SANITIZER_MODEL`, `OC_OPUS_MODEL`, `OC_SONNET_MODEL`, `OC_HAIKU_MODEL`, `OC_FABLE_MODEL`, `OC_REVIEWER_MODEL`.
4. **API-ключи провайдеров** — предпочтительно через `opencode auth import` (credential store), а не env-переменные. Если env — см. residual-ограничения в [spec §3](../../docs/superpowers/specs/2026-10-20-docker-serve-design.md#3-security-considerations) (config-substitution, bash-env-access).
5. **Password** — `OPENCODE_PASSWORD` (для Basic auth сервера).
6. **Каталоги хоста:**

```bash
# maestro-state: логи + memory backups (host-visible, Гейт 0)
mkdir -p ~/maestro-state/<project> && chmod 700 ~/maestro-state/<project>

# maestro-confidential: confidential данные (режим A)
mkdir -p ~/maestro-confidential/<project> && chmod 700 ~/maestro-confidential/<project>
```

> **Минимальный набор для старта:** достаточно `OPENCODE_PASSWORD`, `REPO_URL`, `GIT_TOKEN` и одной модели для всех агентов (все `OC_*_MODEL` указывают на одного провайдера).

---

## 2. Environment файл

Создайте `.env.docker` в рабочей директории:

```bash
# OpenCode сервер
OPENCODE_PASSWORD="your-strong-password"

# Git-доступ
REPO_URL="https://github.com/org/repo.git"
GH_PAT="ghp_xxxxxxxxxxxx"

# Model assignments (по одному на агента)
OC_BUILD_MODEL="akash/Qwen3.6-35B-A3B"
OC_PLAN_MODEL="akash/Qwen3.6-35B-A3B"
OC_CUSTODIAN_MODEL="local/llama-3.1-8b"
OC_SANITIZER_MODEL="akash/zai-org/GLM-5.3"
OC_OPUS_MODEL="openai/gpt-4o"
OC_SONNET_MODEL="anthropic/claude-sonnet-4-20250514"
OC_HAIKU_MODEL="openai/gpt-4o-mini"
OC_FABLE_MODEL="local/falcon-3b"
OC_REVIEWER_MODEL="openai/gpt-4o"

# Конфиденциальные API-ключи (через {env:VAR} в конфиге)
OPENAI_API_KEY="sk-..."       # для provider openai
AKASH_API_KEY="..."            # для provider akash
```

> **Безопасность:** `chmod 600 .env.docker` — файл содержит секреты.

### Provider-переменные (опционально)

Для кастомного провайдера:

```bash
OC_PROVIDERS_JSON='{"myprov":{"npm":"@ai-sdk/openai-compatible","options":{"baseURL":"https://api.myprov.com/v1","apiKey":"{env:INTERNAL_API_KEY}"},"models":{"my-model":{}}}}'
```

Провайдер ID `myprov` автоматически попадает в allowlist из `OC_PROVIDERS_JSON` (entrypoint генерирует allow для всех provider-ID, видимых в env).

## 2.5 Настройка аккаунтов провайдеров

Модели задаются через `OC_*_MODEL` (провайдер/id, например `akash/Qwen3.6-35B-A3B`), но **сам провайдер нужно зарегистрировать** через `opencode auth import`.

### Встроенные провайдеры (akash, openai, anthropic)

Входят с `@opencode/cli` (установлен в образе). Аккаунт настраивается **внутри контейнера**:

```bash
# 1. Подключиться к контейнеру
docker exec -it maestro-<project> sh

# 2. Зарегистрировать аккаунт (внутри контейнера)
opencode auth import akash sk-xxxxxxxxxxxxxxxx

# 3. Выйти
exit
```

> **Важно:** `opencode auth import` выполняется внутри контейнера, а не на хосте. Данные аккаунта живут в `/data/` (named volume `oc-data-<project>`), переживают рестарты.

> **Безопасность:** API-ключи предпочтительно хранить в `opencode auth import` (credential store), а не в `.env.docker` через `{env:VAR}`.

### Кастомные провайдеры

Для провайдеров, которых нет в built-in (например, корпоративный OpenAI-compatible):

```bash
# Добавить в .env.docker
OC_PROVIDERS_JSON='{"myprov":{"npm":"@ai-sdk/openai-compatible","options":{"baseURL":"https://api.company.com/v1","apiKey":"{env:INTERNAL_KEY}"},"models":{"my-model":{}}}}'
```

Provider ID `myprov` автоматически попадает в allowlist: entrypoint парсит `OC_PROVIDERS_JSON` и генерирует `provider.use` allow для всех видимых ID (встроенный механизм, не требует ручной правки конфигурации).

> **Ограничение:** `{env:VAR}` в `OC_PROVIDERS_JSON` поддерживает только `OC_*_MODEL` и `OPENCODE_*` (review spec §2.8). Для остальных секретов используйте `opencode auth import` после старта контейнера.

---

## 3. Режим A: self-contained

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

### Volume-раскладка

| Volume | Тип | Назначение |
|---|---|---|
| `oc-ws-<project>:/workspace` | named | клон репо (ценный, переживает рестарт) |
| `oc-data-<project>:/data` | named | `opencode.db` + snapshots + memory DB (ценный, backup) |
| `oc-cache-<project>:/cache` | named | кэш моделей (расходный, пересоздаваемый) |
| `~/maestro-state/<project>:/maestro` | bind | daily JSONL логи, memory backups (host-visible) |
| `~/maestro-confidential/<project>:ro` | bind | confidential данные (ro, machine-boundary) |
| `/dev/shm` (tmpfs) | tmpfs | git-credentials (600, не переживает рестарт) |

> **Почему не один volume:** `opencode.db` (6+ ГБ за 6 мес, raw-транскрипты), кэш модели (сотни МБ, ре-скачиваемый), snapshots (монотонный рост), confidential (ro, на хосте) — разные ценности и политики.

### Важные нюансы режима A

- `-e` **не дублировать** поверх `--env-file`: `-e` имеет больший приоритет и при `unset`-переменной подставит пустую строку, перекрывая значение из файла.
- `.confidential/` требует доп. bind-mount с хоста — см. [spec §2.5](../../docs/superpowers/specs/2026-10-20-docker-serve-design.md#25-режим-a-безопасный-клон).
- Token хранится в tmpfs — не виден в `ps`, не в image layers, умирает с контейнером.

---

## 4. Режим B: live-mount

Монтирует уже склонированное дерево хоста. Подходит для отладки и «посмотри WIP в реальном времени».

```bash
docker run -d \
  --name maestro-<project> \
  -v ~/dev/myapp:/workspace/myapp \
  -v oc-data-<project>:/data \
  -v oc-cache-<project>:/cache \
  -v ~/maestro-state/<project>:/maestro \
  -p ${PROJECT_PORT:-127.0.0.1:4096}:4096 \
  maestro-opencode:6.x
```

**Важно для режима B:**

- `REPO_URL` **НЕ задавать** (иначе entrypoint детектирует как режим A).
- Дерево хоста должно содержать `.confidential/` (gitignored, но физически существующий).
- **Serial-режим:** только один контейнер может иметь rw-доступ к дереву.
- Порт: `127.0.0.1` по умолчанию; для удалённого — SSH-туннель или `PROJECT_PORT:4096` без IP-бинда.

---

## 5. docker-compose

### Базовый docker-compose.yml

```yaml
services:
  opencode:
    image: maestro-opencode:6.x
    env_file: .env.docker
    # НЕ добавлять environment: — перекроет env_file пустыми строками при unset
    volumes:
      - oc-ws:/workspace
      - oc-data:/data
      - oc-cache:/cache
      - ${MAESTRO_STATE_DIR:-${HOME}/maestro-state}/${PROJECT_NAME}:/maestro
      - ${MAESTRO_CONF_DIR:-${HOME}/maestro-confidential}/${PROJECT_NAME}:/workspace/${REPO_NAME}/.confidential:ro
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

**Запуск:**

```bash
PROJECT_NAME=myapp REPO_NAME=myapp docker compose up -d
```

### Важные параметры docker-compose

- `~` **не раскрывается** в docker-compose — используйте `${HOME}`.
- `version: "3.9"` — опционален (compose v2+ игнорирует).
- `start_period: 120s` — полный clone может занять минуты на больших репо.
- `PROJECT_PORT` — параметризация для N проектов.
- Healthcheck использует скрипт в образе (`/usr/local/bin/healthcheck.sh`), не интерполирует пароль → безопасен для `docker inspect`.

> **⚠️ `docker compose down -v`** — **УДАЛЯЕТ named volumes** (oc-ws, oc-data, oc-cache). Используйте `docker compose down` (без `-v`) для остановки.

### Resource limits (опционально)

```yaml
    deploy:
      resources:
        limits:
          memory: 4G
          cpus: "4"
```

---

## 6. Подключение клиентов

### TUI

```bash
OPENCODE_PASSWORD="your-password" opencode --server http://127.0.0.1:4096
```

### Web UI

```bash
opencode pair   # → URL/QR для подключения
```

### HTTP API

```bash
# Информация о сервере (безопасно, не интерполирует пароль)
curl -sf -u "opencode:${OPENCODE_PASSWORD}" http://127.0.0.1:4096/api/info

# OpenAPI spec (контрактная верификация)
curl -sf http://127.0.0.1:4096/openapi.json
```

> **Несколько клиентов:** OpenCode поддерживает несколько клиентов к одному серверу одновременно (TUI + Web + API).

---

## 7. Health check

### Извне контейнера (CLI — безопасно)

```bash
# HTTP check (не интерполирует пароль — безопасно для docker inspect)
curl -sf -u "opencode:${OPENCODE_PASSWORD}" http://127.0.0.1:4096/api/info
```

### Встроенный healthcheck-скрипт

В образе встроен `/usr/local/bin/healthcheck.sh`:

```bash
#!/bin/sh
# Primary: HTTP check на /api/info
if curl -sf -u "opencode:${OPENCODE_PASSWORD}" http://127.0.0.1:4096/api/info >/dev/null 2>&1; then
  exit 0
fi
# Fallback: TCP connect (если /api/info недоступен в данной версии)
exec 3<>/dev/tcp/127.0.0.1/4096 2>/dev/null
exit $?
```

Пароль читается из env-переменной (не из compose interpolate → безопасно для `docker inspect`). TCP fallback нужен, когда `/api/info` endpoint изменился в данной версии opencode.

---

## 8. Остановка, запуск, сброс

```bash
# Остановка (контейнер сохраняется для восстановления)
docker stop maestro-<project>

# Восстановление (named volumes переживают stop)
docker start maestro-<project>

# Полный reset (удаляет контейнер, volumes сохраняются)
docker rm maestro-<project>

# Перезапуск с теми же volume-флагами
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

> **Важно:** `docker start` **НЕ** обновляет образ — контейнер навсегда привязан к image-слоям, с которыми создан. Обновление = `rm` + `run`. Данные в named volumes (`oc-ws`, `oc-data`, `oc-cache`) переживают.

---

## 9. Backup и восстановление

### Cold backup (рекомендуется для SQLite)

```bash
# Остановить контейнер
docker stop maestro-<project>

# Backup opencode.db и memory
docker cp maestro-<project>:/data/opencode.db /backup/opencode.db-$(date +%Y%m%d)
docker cp maestro-<project>:/data/maestro/memory/ /backup/memory-$(date +%Y%m%d)/

# Запустить обратно
docker start maestro-<project>
```

### Hot backup (state — контейнер может работать)

```bash
cp -r ~/maestro-state/<project> /backup/maestro-state-$(date +%Y%m%d)
```

### Volume-level backup (чище)

```bash
docker run --rm \
  -v oc-ws-<project>:/ws \
  -v oc-data-<project>:/data \
  -v ~/backup:/backup \
  alpine tar czf /backup/data-$(date +%Y%m%d).tar.gz /data
```

### Restore

```bash
# Cold: остановить, скопировать, запустить
docker stop maestro-<project>
docker cp /backup/opencode.db-YYYYMMDD maestro-<project>:/data/opencode.db
docker cp /backup/memory-YYYYMMDD/. maestro-<project>:/data/maestro/memory/
docker start maestro-<project>
```

> **Важно:** горячий `docker cp` SQLite-файла на работающем сервере рискует неконсистентной копией (WAL). Для production — cold backup (стоп перед копированием) или:
>
> ```bash
> docker exec maestro-<project> sqlite3 /data/opencode.db ".backup '/tmp/backup.db'"
> ```
>
> Путь memory.db: `/data/maestro/memory/<key-hash>/memory.db` (per-key layout, не плоский).

---

## 10. Обновление версии

```bash
# 1. Остановить и удалить контейнер (volumes сохраняются)
docker stop maestro-<project> && docker rm maestro-<project>

# 2. Пересобрать образ
docker build -t maestro-opencode:6.x -f docker/Dockerfile .

# 3. Запустить с новым образом (те же флаги, что в §3)
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

> **Почему не `docker start`:** `docker start` не обновляет образ — контейнер привязан к image-слоям. Обновление = `rm` + `run`. Данные в named volumes (`oc-ws`, `oc-data`, `oc-cache`) переживают.

---

## 11. Hardening (рекомендуемый набор)

### Non-root user + capabilities

```bash
docker run -d \
  --cap-drop=ALL \
  --security-opt no-new-privileges \
  --user "${UID}:${GID}" \
  --env-file .env.docker \
  -v oc-ws-<project>:/workspace \
  -v oc-data-<project>:/data \
  -v oc-cache-<project>:/cache \
  -v ~/maestro-state/<project>:/maestro \
  -p 127.0.0.1:4096:4096 \
  maestro-opencode:6.x
```

| Флаг | Назначение |
|---|---|
| `--cap-drop=ALL` | Удаляет все Linux capabilities — агент не может выполнять привилегированные операции |
| `--security-opt no-new-privileges` | Запрещает escalation через setuid/setgid бинарники |
| `--user UID:GID` | **Опциональный fallback для NFS:** по умолчанию non-root через root-entrypoint (root chowns volumes → `gosu <UID>:<GID> opencode serve`). Используется только когда NFS-сервер блокирует chown |
| `-p 127.0.0.1:4096:4096` | API торчит только на localhost — для удалённого доступа: SSH-туннель или TLS-прокси |

### Порт-параметризация (N проектов на одной машине)

```bash
-p ${PROJECT_PORT:-127.0.0.1:4096}:4096
```

Каждый проект — отдельный порт, не конфликтуют.

> **P1 — git hooks code-exec вектор:** в образе создан пустой каталог, entrypoint выполняет `git config --global core.hooksPath /var/empty` — отключает git hooks (любой исполняемый код из git-хуков). Также добавлен `--pids-limit` в compose для fork-bomb защиты.

---

## 12. Отладка и диагностика

### Логи контейнера

```bash
# Entrypoint логирует этапы (clone, setup, serve)
docker logs maestro-<project>

# Тailing
docker logs -f maestro-<project>

# Последние N строк
docker logs --tail 100 maestro-<project>
```

### Host-visible логи (Гейт 0)

```bash
# Логи пайплайна — JSONL, один файл на день
ls ~/maestro-state/<project>/logs/

# Фильтрация по sessionID
cat ~/maestro-state/<project>/logs/maestro-bootstrap-$(date +%Y-%m-%d).log | jq '.sessionID'
```

### Решение распространённых проблем

| Проблема | Решение |
|---|---|
| Контейнер не стартует | `docker logs maestro-<project>` — entrypoint логирует этапы (clone, setup, serve) |
| `.confidential` пустой | Проверьте `~/maestro-confidential/<project>` на хосте; entrypoint логирует «empty mount point» |
| `git clone` падает | Проверьте `GH_PAT` scope; убедитесь, что `REPO_URL` доступен с сервера (для режима A). Токен — fine-grained, `contents: write`, expiry 30 дней |
| `opencode --server` не подключается | Проверьте `OPENCODE_PASSWORD` в окружении клиента; healthcheck: `curl -u opencode:$PW http://127.0.0.1:4096/api/info` |
| Logs не видны | Проверьте `~/maestro-state/<project>/logs/`; daily JSONL format, фильтруйте по sessionID через `jq` |
| Порт занят | Используйте `PROJECT_PORT` для параметризации: `-p ${PROJECT_PORT:-127.0.0.1:4096}:4096` |
| Конфиденциальные данные | В режиме A: проверьте bind-mount. В режиме B: `.confidential/` уже в дереве хоста |

---

## 13. Сценарии от простого к сложному

### Сценарий 0: Hello world (5 минут)

Один контейнер, одна модель, тривиальная задача. [Детали](../../docker/README.md#быстрый-старт-hello-world-5-минут).

```bash
# 1. Минимальный .env.docker
echo 'OPENCODE_PASSWORD="dev-password"
REPO_URL="https://github.com/you/hello-maestro.git"
GIT_TOKEN="github_pat_..."
OC_BUILD_MODEL="akash/zai-org/GLM-5.3"
OC_CUSTODIAN_MODEL="akash/zai-org/GLM-5.3"' > .env.docker
chmod 600 .env.docker

# 2. Запуск
docker run -d --name maestro-hello \
  --env-file .env.docker \
  -v oc-ws-hello:/workspace \
  -v oc-data-hello:/data \
  -v oc-cache-hello:/cache \
  -p 127.0.0.1:4096:4096 \
  maestro-opencode:6.x

# 3. Подключение
OPENCODE_PASSWORD=dev-password opencode --server http://127.0.0.1:4096

# 4. Первая задача
> @maestro-init Добавить в README секцию «Contributing»
```

**Результат:** спека + план в `docs/superpowers/`, ветка в origin, логи в `~/maestro-state/hello/logs/`.

### Сценарий 1: Полный цикл разработки фичи

Пример: фича «экспорт отчётов в PDF». Пайплайн maestro исполняется **внутри контейнера**; все HITL-ответы приходят через TUI-клиент.

#### Этап 0 — подготовка

```bash
# Разные модели для разных агентов
OPENCODE_PASSWORD="strong-pass"
REPO_URL="https://github.com/org/myapp.git"
GIT_TOKEN="github_pat_..."
OC_BUILD_MODEL="akash/zai-org/GLM-5.3"
OC_PLAN_MODEL="akash/zai-org/GLM-5.3"
OC_CUSTODIAN_MODEL="local/llama-3.1-8b"     # P4: изолированная модель для confidential Q/A
OC_SANITIZER_MODEL="akash/zai-org/GLM-5.3"
OC_OPUS_MODEL="anthropic/claude-sonnet-4"   # ревью
OC_SONNET_MODEL="openai/gpt-4o-mini"        # реализация
OC_HAIKU_MODEL="openai/gpt-4o-mini"
OC_FABLE_MODEL="akash/zai-org/GLM-5.3"
OC_REVIEWER_MODEL="openai/gpt-4o"
```

**Почему разные модели:** custodian Q/A идёт на локальной модели (P4 — confidential данные не покидают машину), opus/sonnet — на облачных (качество ревью и реализации).

#### Этап 1 — подключение и запуск

```bash
OPENCODE_PASSWORD=strong-pass opencode --server http://127.0.0.1:4096
```

```
> @maestro-init Экспорт отчётов в PDF — добавить фичу в настройки
```

#### Этап 2 — пайплайн (что видит пользователь в TUI)

| Шаг | Что происходит | Участие человека |
|---|---|---|
| Гейт 0 | Плагин-проверка (sanitize, merge-guard) | нет |
| Шаги 1–5 | Классификация (фича), brainstorm, стек-детект | нет |
| Custodian Q/A | Вопросы по confidential-контексту (если есть) | 2–3 ответа |
| Шаг 8.6 | Sanitize спеки | нет |
| **Гейт 10** | Spec-review: вердикты + спека на утверждение | «принимаю» / «правки» |
| Шаги 11–13 | План, TDD-задачи | нет |
| Шаг 14 | Реализация: implementer пишет в `/workspace/myapp` | нет |
| Шаг 16 | Ревью (reviewer + sonnet, по типу артефакта) | нет |
| **Гейт 17** | Merge-аппрув | «аппрув» → `.maestro/gates/` → git push |
| Шаг 18.5 | Feedback report | нет |

**Docker-специфика:**
- **HITL-гейты** приходят в TUI (или Web UI / API). Каждый гейт — промпт «подтвердить / отказаться / запросить правки»
- **Рестарт контейнера** (`docker stop/start`): сессии и артефакты живут в `opencode.db` (/data) и `/workspace` — пайплайн продолжает с места остановки
- **git push** использует tmpfs credential-store (токен в env уже невидим — `unset` после старта)
- **Логи Гейта 0** — host-visible (`~/maestro-state/<project>/logs/`), читается без `docker exec`

#### Этап 3 — результат

- Ветка `feature/pdf-export` запушена в origin
- Спека/план — в `docs/superpowers/` репо (committed)
- Логи пайплайна — JSONL в `~/maestro-state/<project>/logs/`
- `opencode.db` — персистентная БД (named volume, переживает `docker stop`)

### Сценарий 2: Смешанные провайдеры

Самое частое реальное использование:

```bash
# Custodian на локальной модели (confidential не покидает машину)
OC_CUSTODIAN_MODEL="local/llama-3.1-8b"
# Sanitizer на akash (техническая изоляция)
OC_SANITIZER_MODEL="akash/zai-org/GLM-5.3"
# Opus на anthropic (качество ревью)
OC_OPUS_MODEL="anthropic/claude-sonnet-4"
# Остальные — openai (стоимость/скорость)
OC_SONNET_MODEL="openai/gpt-4o-mini"
OC_HAIKU_MODEL="openai/gpt-4o-mini"
```

### Сценарий 3: Кастомный провайдер

Корпоративный endpoint без коммита в репо:

```bash
OC_PROVIDERS_JSON='{
  "myprov": {
    "npm": "@ai-sdk/openai-compatible",
    "options": {
      "baseURL": "https://api.internal.company.com/v1",
      "apiKey": "{env:INTERNAL_API_KEY}"
    },
    "models": { "my-model": { "name": "My Model" } }
  }
}'
```

Ключ из env-файла (не в конфигах, не в образе). Provider ID `myprov` автоматически попадает в allowlist из `OC_PROVIDERS_JSON` (entrypoint генерирует allow для всех provider-ID, видимых в env).

### Сценарий 4: Confidential-данные

- Bind-mount `.confidential/` (режим A): `-v ~/maestro-confidential/<project>:/workspace/<repo>/.confidential:ro`
- Custodian Q/A по секретам
- Dual-mode `maestro.json` (если есть секция `confidential` — legacy-режим; без неё — new-режим с нативными permissions как барьером)

### Сценарий 5: MCP-серверы

Добавление MCP-сервера через объявление в managed-слое (`/etc/opencode/`) + allow `mcp:<name>`. Подробнее — [docker-mcp.md](./docker-mcp.md) (when available).

### Сценарий 6: Параллельная разработка

#### Паттерн A: один контейнер на репо

Каждый проект — свой контейнер, свои volumes, свой порт:

```yaml
# docker-compose.multi.yml
services:
  maestro-frontend:
    image: maestro-opencode:6.x
    env_file: .env.frontend
    volumes: [oc-ws-fe:/workspace, oc-data-fe:/data, oc-cache-fe:/cache]
    ports: ["127.0.0.1:4096:4096"]
  maestro-backend:
    image: maestro-opencode:6.x
    env_file: .env.backend
    volumes: [oc-ws-be:/workspace, oc-data-be:/data, oc-cache-be:/cache]
    ports: ["127.0.0.1:4097:4096"]
```

Подключение:
```bash
# frontend — на порт 4096
OPENCODE_PASSWORD=... opencode --server http://127.0.0.1:4096
# backend — на порт 4097
OPENCODE_PASSWORD=... opencode --server http://127.0.0.1:4097
```

#### Паттерн B1: worktrees в ОДНОМ контейнере (MVP)

OpenCode нативно поддерживает worktrees (`worktree.directory: ./.worktrees`).

- **B1a:** одна TUI-сессия, несколько параллельных задач (переключение сессий)
- **B1b:** несколько TUI-сессий к одному серверу (команда на одном проекте)

Каждая сессия работает в своём worktree `.worktrees/<branch>/` — файлы не конфликтуют. Merge — последовательно через гейт 17.

**Confidential-асимметрия:** `.confidential/` только в базовом дереве, не в worktree (см. [spec §2.5](../../docs/superpowers/specs/2026-10-20-docker-serve-design.md#25-режим-a-безопасный-клон)).

#### Паттерн B2: контейнер на фичу

```bash
docker run -d --name maestro-featx \
  -e GIT_BRANCH=feat/dark-theme \
  --env-file .env \
  ... -p 127.0.0.1:4097:4096 \
  maestro-opencode:6.x

docker run -d --name maestro-featv \
  -e GIT_BRANCH=feat/pdf-export \
  --env-file .env \
  ... -p 127.0.0.1:4098:4096 \
  maestro-opencode:6.x
```

`GIT_BRANCH` — entrypoint после клонирования делает `git checkout <branch>`. Два контейнера push'ят в один origin в разные ветки.

#### Паттерн B3: host worktrees + live-mount

```bash
# на хосте
git -C ~/dev/myapp worktree add .worktrees/feat-x -b feat/x

# контейнер монтирует worktree
docker run -d \
  -v ~/dev/myapp/.worktrees/feat-x:/workspace/myapp \
  -p 127.0.0.1:4097:4096 \
  maestro-opencode:6.x
```

#### Сводная таблица

| Паттерн | Изоляция | HITL-потоки | Ресурсы | Когда |
|---|---|---|---|---|
| A (репо → контейнер) | полная | раздельные (порты) | N контейнеров | разные проекты |
| B1a (worktrees, 1 контейнер) | сессии | общий TUI | 1 контейнер | один разработчик, связанные фичи |
| B1b (неск. TUI, 1 контейнер) | сессии | несколько клиентов | 1 контейнер | команда на одном проекте |
| B2 (клон → контейнер) | полная | раздельные | N контейнеров | параллельные разработчики / тяжёлые фичи |
| B3 (host worktrees) | контейнер/фича | раздельные | N контейнеров | Mac + IDE-центричная работа |

---

## Сводка по ссылкам

| Раздел | Ссылка |
|---|---|
| [spec §2.2](../../docs/superpowers/specs/2026-10-20-docker-serve-design.md#22-режимы-источника-кода) | Режимы A (self-contained) и B (live-mount) |
| [spec §2.3](../../docs/superpowers/specs/2026-10-20-docker-serve-design.md#23-volume-раскладка) | Volume-раскладка |
| [spec §2.5](../../docs/superpowers/specs/2026-10-20-docker-serve-design.md#25-режим-a-безопасный-клон) | Безопасный клон режима A |
| [spec §2.7](../../docs/superpowers/specs/2026-10-20-docker-serve-design.md#27-config-слои) | Config-слои (managed/skeleton/user) |
| [spec §2.8](../../docs/superpowers/specs/2026-10-20-docker-serve-design.md#28-config-слои) | Config-подстановка (`OPENCODE_CONFIG_CONTENT`, `OC_PROVIDERS_JSON`) |
| [spec §2.8.1](../../docs/superpowers/specs/2026-10-20-docker-serve-design.md#281-etcopencodeopencodejson--managed-layer) | Managed layer `/etc/opencode/` |
| [spec §2.8.2](../../docs/superpowers/specs/2026-10-20-docker-serve-design.md#282-config-opencodejson--global-skeleton-user-layer) | Global skeleton `~/.config/opencode/` |
| [spec §2.9](../../docs/superpowers/specs/2026-10-20-docker-serve-design.md#29-git-токен-tmpfs-credential-store) | tmpfs credential-store |
| [spec §2.12](../../docs/superpowers/specs/2026-10-20-docker-serve-design.md#212-dockerfile-specification-базовый-образ) | Dockerfile specification |
| [spec §2.13](../../docs/superpowers/specs/2026-10-20-docker-serve-design.md#213-per-agent-access-matrix) | Per-agent access matrix |
| [spec §2.14](../../docs/superpowers/specs/2026-10-20-docker-serve-design.md#214-policies-stable-api-p4-hygiene) | Policies (plugin/provider allowlist) |
| [spec §3.1](../../docs/superpowers/specs/2026-10-20-docker-serve-design.md#31-operator-customization-без-коммита-в-репо) | Operator customization |
| [spec §5.3](../../docs/superpowers/specs/2026-10-20-docker-serve-design.md#53-режим-a-self-contained) | Режим A commands |
| [spec §5.4](../../docs/superpowers/specs/2026-10-20-docker-serve-design.md#54-режим-b-live-mount) | Режим B commands |
| [spec §5.5](../../docs/superpowers/specs/2026-10-20-docker-serve-design.md#55-docker-composeyml) | docker-compose.yml |
| [spec §5.9](../../docs/superpowers/specs/2026-10-20-docker-serve-design.md#59-hardening-рекомендуемый-набор) | Hardening |
| [spec §5.10](../../docs/superpowers/specs/2026-10-20-docker-serve-design.md#510-hello-world-быстрый-старт-5-минут) | Hello world |
| [spec §5.11](../../docs/superpowers/specs/2026-10-20-docker-serve-design.md#511-полный-цикл-разработки-фичи) | Полный цикл фичи |
| [spec §5.12](../../docs/superpowers/specs/2026-10-20-docker-serve-design.md#512-сценарии-от-простого-к-сложному) | Scenarios ladder |
| [spec §5.13](../../docs/superpowers/specs/2026-10-20-docker-serve-design.md#513-параллельная-разработка-разные-репо) | Параллельная: разные репо |
| [spec §5.14](../../docs/superpowers/specs/2026-10-20-docker-serve-design.md#514-параллельная-разработка-одно-репо-worktrees) | Параллельная: worktrees |
