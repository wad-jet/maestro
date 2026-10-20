# Design: Dockerized `opencode serve` for maestro

> **Дата:** 2026-10-20
> **Автор:** orchestrator (из сессии обсуждения)
> **Статус:** draft — v18 (6.4.0 sync: trust→role-set, native permissions barrier, dual mode documented, P1/P5 updated, memory masking generic-only)
> **Категория:** сложная фича (cross-layer, 3+ файлов, новый модуль)

---

## 1. Intent

Изолированный, воспроизводимый runtime для `opencode serve` — контейнер, который:

- Живёт **вне локальной машины** (стабильная конфигурация для Mac/Linux/VM/CI)
- Запускается с **чистым состоянием** (без зависимости от хоста, кроме секрентов)
- Поддерживает **несколько клиентов** (TUI, Web, HTTP API)
- Позволяет **перенос на серверы/VM** без подготовки хоста
- **Warming:** не требуется (MVP — API models; local models — future, если primary)

**Non-goals:**
- Замена локальной разработки (контейнер — runtime для пайплайна, не IDE)
- Multi-tenant isolation (контейнер не adversarial-песочница)
- Несколько проектов в одном контейнере (один контейнер = один проект)

---

## 2. Architecture

### 2.1. Клиенты

Все три подключаются к **одному серверу** на порту 4096:

| Клиент | Команда | Роль |
|---|---|---|
| **TUI** | `opencode attach http://127.0.0.1:4096` | Основной канал (HITL, gates) |
| **Web UI** | `opencode pair` → URL/QR | Альтернативный, без CLI |
| **HTTP API** | `@opencode/client` / curl | Для HITL-кода, automation |

### 2.2. Режимы источника кода

Два режима, entrypoint авто-детект. **Общие volume (не зависят от режима):**
- `-v oc-ws-<project>:/workspace` — рабочая область (клон или mount)
- `-v oc-data-<project>:/data` — opencode.db + credentials (ценные данные, см. §2.3)
- `-v oc-cache-<project>:/cache` — model/plugin кэш (расходный, см. §2.3)
- `-v ~/maestro-state/<project>:/maestro` — логи + memory backups (host-visible, см. §2.7)
- `-p 4096:4096` — HTTP API порт

**A. Self-contained (основной)**
```bash
docker run \
  -e REPO_URL=https://github.com/org/repo.git \
  -e GIT_TOKEN=$GH_PAT \
  -v oc-ws-<project>:/workspace \
  -v oc-data-<project>:/data \
  -v oc-cache-<project>:/cache \
  -v ~/maestro-state/<project>:/maestro \
  -v ~/maestro-confidential/<project>:/workspace/<repo>/.confidential:ro \
  -p 4096:4096 \
  maestro-opencode:6.x
```
- Контейнер сам клонирует репо (через tmpfs credential-store).
- Base-клон = чистый mainline.
- **Минус:** `.confidential/` требует доп. bind-mount с хоста (см. §2.5).
- Идеален для серверов/VM.
- **CI-ограничение:** пайплайн maestro HITL-центричен, P8 запрещает auto-режимы на security-гейтах (8.6, 10, 17). CI-сценарий ограничен не-гейтовыми флоу (review, docs, smoke-тесты). Полный пайплайн в CI требует HITL-координации.

**B. Live-mount (вспомогательный)**
```bash
docker run \
  -v ~/dev/myapp:/workspace/myapp \
  -v oc-data-<project>:/data \
  -v oc-cache-<project>:/cache \
  -v ~/maestro-state/<project>:/maestro \
  -p 4096:4096 \
  maestro-opencode:6.x
```
- Дерево уже на хосте (`.confidential/` уже в дереве — отдельный mount не нужен).
- Serial-режим (один писатель).
- Идеален для отладки, офлайн, "посмотри WIP в реальном времени".

**Детект режима:** приоритет env-переменных — если задан `REPO_URL` → режим A; иначе проверка наличия `.git` в `/workspace/` — если есть, режим B. Это гарантирует **идемпотентность**: при наличии именованного volume (persisting между запусками) `.git` сохраняется, и без env-check контейнер misdetect'ил бы A как B.

**Поведение при существующем workspace:** если volume содержит частично склонированное дерево (неполный checkout, обрыв сети) — entrypoint выполняет `git -C /workspace/<repo> reset --hard HEAD` (дискардит незакоммиченные изменения, восстанавливая консистентность) и не перезаписывает существующие файлы.

### 2.3. Volume-раскладка

Данные разделяются на **три класса** по жизненному циклу (6 volume в таблице):

| Volume | Тип | Путь (контейнер) | Содержимое | Policy |
|---|---|---|---|---|
| **workspace** | bind (B) / named (A: `oc-ws-<project>`) | `/workspace` | клон репо, worktrees | **ценный**: git-дерево, worktrees |
| **state** | named `oc-data-<project>` | `XDG_DATA_HOME=/data` | opencode.db, snapshots, memory DB+cache | **ценный**: backup, retention entrypoint |
| **cache** | named `oc-cache-<project>` | `XDG_CACHE_HOME=/cache` | models.json, npm/plugin caches | **расходный**: пересоздаваемый |
| **host-visible** | bind `~/maestro-state/<project>` | `/maestro` | daily JSONL (3 лога), memory backups | **host-visible**: для Гейта 0 и бэкапов |
| **confidential** | bind (A: `~/maestro-confidential/<project>` → `<repo>/.confidential:ro`) | `<repo>/.confidential` | **ro**: конфиденциальные данные (machine-boundary) | новый в режиме A; в режиме B — в дереве |
| **secrets** | tmpfs `/dev/shm` | — | git-credentials (600) | **не переживает рестарт** |

**Почему не один volume:** opencode.db (6+ ГБ за 6 мес, raw-транскрипты), кэш модели (сотни МБ, ре-скачиваемый), snapshots (монотонный рост), confidential (ro, на хосте), state (ценный) — разные ценности и политики.

### 2.2a. Режим A: безопасный клон (исправление К-2)

При монтировании `/workspace` как named volume + bind-mount `.confidential` в поддиректорию, `git clone /workspace/<repo>` может столкнуться с конфликтом mount-point: если на хосте `.confidential` содержит файлы, bind-точка непуста — git не может перезаписать mount (readonly) и падает.

**Решение — temp-clone + rsync:**
```bash
# 1. Полный clone в temp (вне workspace — RW слой контейнера)
git clone "$REPO_URL" /tmp/clone

# 2. Full rsync, исключая mount-point пути (rsync не трогает .confidential/ т.к. его нет в источнике)
rsync -a /tmp/clone/ /workspace/<repo>/

# 3. Уборка
rm -rf /tmp/clone
```

**Почему полный клон, не shallow:** `--depth=1` ломает ancestry-фичи maestro: merge-guard P9 (`git merge-base --is-ancestor`), branch-aware memory v3 (`is-ancestor(head, mainline)`), `memory_reindex` git-history. На shallow-клоне эти проверки всегда fail. Полный клон — единственная безопасная стратегия.

**Fallback (update existing clone):** если `/workspace/<repo>` уже существует (из previous run), entrypoint пропускает clone и выполняет:
```bash
git -C /workspace/<repo> fetch --all --prune
git -C /workspace/<repo> checkout -B main origin/main  # или нужная ветка
git -C /workspace/<repo> clean -fd -e .confidential  # remove untracked leftovers
```

### 2.4. Worktree-политика

- **Base-дерево** = чистый mainline, «управленческий» (fetch + checkout).
- **Worktrees** = всегда для кодо-меняющих сессий, **внутри дерева репо** (`.worktrees/<branch>`).
- Один активный писатель на worktree. После merge — `git worktree remove` + `prune`.
- Конфиг: `"worktree": {"directory": "./.worktrees"}` в `opencode.json` (dogfooding precedent).
- **Асимметрия confidential (П-2):** `.confidential/` gitignored → worktree не содержит его; `docs/confidential/` committed → worktree видит. Worktree-сессии не получат доступ к `.confidential/` (machine-boundary). Решение: для worktree-сессий, требующих confidential-доступа — использовать base-worktree (mainline) или mount `.confidential/` в worktree-дерево отдельно. Документировать как ограничение.

### 2.5. Конфиденциальные данные: два канонических пути

**Общее:** оба пути имеют одинаковые trust-политики: deny primary/untrusted, read — только trusted (custodian/sanitizer). sanitizer маскирует содержимое в транскриптах и памяти (`[confidential]`). SEC-5 (полные пути не попадают в память) — применяется к обоим.

#### `docs/confidential/**` (существующая, canonical 1)

- **Граница защиты: модель.** Данные могут жить в git (командное шаринг) — коммитить допустимо. Защита — от утечки во внешние модели в обход custodian.
- **Git:** коммитить можно и нужно (это совместный артефакт).
- **Путь:** относительно project root. Задаётся в `confidential.paths` (`maestro.json`).

#### `.confidential/` (новая, canonical 2)

- **Граница защиты: машина.** Данные не покидают локальную машину — отсюда и gitignore с рождения.
- **Git:** **обязательный gitignore**. Более очевидное имя и расположение (root, рядом с `maestro.json`).
- **Путь:** `.confidential/**` (относительно project root).
- **Gitignore-guard (П-1, реализация в плане):** prevent `.confidential/` from being committed — entrypoint check at clone time (like merge-guard). `git add .confidential/` → warn/error.
- **Докер:**
  - **Режим A (self-contained):** монтируется как read-only bind: `~/maestro-confidential/<project>` → `<repo>/.confidential:ro`. Host-каталог: `mkdir -p ~/maestro-confidential/<project> && chmod 700` (пред-создание обязательно — если отсутствует, docker auto-creates root-owned 755; non-root контейнер read может, но host-пользователь не может писать без `sudo`). Если источник отсутствует → состояние «нет confidential-данных» — **валидно, entrypoint логирует**.
  - **Режим B (live-mount):** уже в дереве хоста (gitignored) — монтирование не требуется. Residual: rw-эскалация (repo-монт RW) — документирована как принятый риск для serial-отладочного режима B.
- **Git-tracking warning (fail-loud):** если `.confidential/` закоммичен — одноразовый warning при init плагина (`confidential.tracked_in_git`, с инструкцией `git rm -r --cached`). Hard-stop не ставлю: данные уже покинули машину; предупреждение + инструкция достаточны.
- **Hardlink-residual (integrity):** если host-ФС поддерживает hardlinks, злонамеренный процесс может `ln` из RW-области в ro-bind (бypass). Mitigated: `protected_hardlinks=1` (sysctl default) + non-root USER. Integrity-rиск (не конфиденциальность), низкий — doc-note.

**Implementation tasks (Н-2):**
- `confidential.tracked_in_git` — задача для плагина: `git ls-files` check при bootstrap init → console.warn.
- `/maestro-setup` двойной дефолт в `confidential.paths` — задача для maestro-setup skill (сейчас только `docs/confidential/**`).
- Gitignore-guard для `.confidential/` (по аналогии с merge-guard) — отдельная задача в план.

#### Canon setup

`/maestro-setup` **будет записывать** **оба** дефолта в `confidential.paths` (`docs/confidential/**` + `.confidential/**`) и добавлять `.confidential/` в `.gitignore` (но НЕ `docs/confidential/`). Плагин остаётся generic — `confidential.paths` — всё работает автоматически.

### 2.6. Credentials и аутентификация

**Правило: auth.json НЕ монтируется.** В V2 credstore — таблица `credential` в `opencode.db`; `auth.json` — legacy V1, одноразовый импорт при миграции.

| Сценарий | Механизм | Где |
|---|---|---|
| API-key (первичные) | **{env:VAR}** | `provider.*.options.apiKey: "{env:PROVIDER_KEY}"` |
| Кастомные (akash и др.) | **{env:VAR}** | Тот же `{env:AKASH_API_KEY}` |
| OAuth/подписки | **credential API** | `auth import` → `/data` volume |
| Гигиеничный режим | **{file:path}** | `{file:/run/secrets/key.key}` — mount 0600 |

**Приоритет credstore > env** (сохранённый credential перекрывает env).

### 2.7. State `.maestro/` и логи

- Logs → env-переменные: `MAESTRO_BOOTSTRAP_LOG_DIR`, `MAESTRO_AUDIT_LOG_DIR`, `MAESTRO_MEMORY_LOG_DIR` → `/maestro/logs`.
- Daily JSONL, sessionID в каждой строке — фильтрация `jq`.
- **Симлинк `.maestro/logs → /maestro/logs`** — обязателен для Гейта 0 (скилл ждёт лог по каноническому пути). **Важно:** `.maestro/` весь каталог — gitignored (канон maestro, AGENTS.md). Если `.gitignore` отсутствует (старое репо) — simlink создаёт untracked-запись → добавление `.gitignore` задача для `/maestro-setup`.
- Gates и `plugin-version` остаются в дереве репо (эфемерные).
- Memory backups → `memory.backup.path: "/maestro/memory/backup"`.

### 2.8. Конфигурация

**Образ — глобальный скелет `~/.config/opencode/opencode.json`:**

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["/opt/maestro/plugins/maestro-bootstrap/index.js"],
  "autoupdate": false,
  "default_agent": "build",
  "subagent_depth": 1,
  "worktree": { "directory": "./.worktrees" },
  // «instructions» — НЕ здесь (per-project: docs/project-context.md, SECURITY.md)
  // из committed opencode.json в корне репо
  "permissions": [
    // read-baseline
    { "action": "read",  "resource": "*", "effect": "allow" },
    { "action": "read",  "resource": "docs/confidential/*", "effect": "deny" },
    { "action": "read",  "resource": ".confidential/**", "effect": "deny" },
    { "action": "read",  "resource": "maestro.json", "effect": "deny" },
    { "action": "read",  "resource": ".maestro/**", "effect": "deny" },
    { "action": "read",  "resource": ".maestro/plugin-version", "effect": "allow" },
    { "action": "read",  "resource": "*.env", "effect": "deny" },
    { "action": "read",  "resource": "*.env.*", "effect": "deny" },
    { "action": "read",  "resource": "*.env.example", "effect": "allow" },
    { "action": "read",  "resource": "*.pem", "effect": "deny" },
    { "action": "read",  "resource": "*.key", "effect": "deny" },
    { "action": "read",  "resource": "*.crt", "effect": "deny" },
    { "action": "read",  "resource": "*.p12", "effect": "deny" },
    { "action": "read",  "resource": "*.pfx", "effect": "deny" },
    // edit-baseline
    { "action": "edit",  "resource": "*", "effect": "allow" },
    { "action": "edit",  "resource": "docs/confidential/*", "effect": "deny" },
    { "action": "edit",  "resource": ".confidential/**", "effect": "deny" },
    { "action": "edit",  "resource": "maestro.json", "effect": "deny" },
    { "action": "edit",  "resource": "*.env", "effect": "deny" },
    // env/pem/key/crt/p12/pfx — как read
    // glob-baseline
    { "action": "glob",  "resource": "docs/confidential/*", "effect": "deny" },
    { "action": "glob",  "resource": ".confidential/**", "effect": "deny" },
    { "action": "glob",  "resource": "maestro.json", "effect": "deny" },
    { "action": "glob",  "resource": ".maestro/**", "effect": "deny" },
    // grep-baseline
    { "action": "grep",  "resource": "docs/confidential/*", "effect": "deny" },
    { "action": "grep",  "resource": ".confidential/**", "effect": "deny" },
    { "action": "grep",  "resource": "maestro.json", "effect": "deny" },
    { "action": "grep",  "resource": ".maestro/**", "effect": "deny" },
    // memory — read:allow, backup:ask (HITL), boundary/denied
    // when memory is enabled (MVP disabled; see §2.11)
    // SEC-4b: stats_detail/recall_preview — aggregates-only, безопасно
    { "action": "memory_search",       "resource": "*", "effect": "allow" },
    { "action": "memory_stats_detail", "resource": "*", "effect": "allow" },
    { "action": "memory_recall_preview", "resource": "*", "effect": "allow" },
    { "action": "memory_probe",        "resource": "*", "effect": "allow" },
    { "action": "memory_backup",       "resource": "*", "effect": "ask" },
    { "action": "memory_export",       "resource": "*", "effect": "deny" },
    { "action": "memory_forget",       "resource": "*", "effect": "deny" },
    { "action": "memory_import",       "resource": "*", "effect": "deny" },
    { "action": "memory_migrate",      "resource": "*", "effect": "deny" },
    { "action": "memory_prune",        "resource": "*", "effect": "deny" },
    { "action": "memory_reindex",      "resource": "*", "effect": "deny" },
    // maestro_config — fail-closed deny глобально, ask только для primary (build/plan)
    { "action": "maestro_config", "resource": "*", "effect": "deny" }
  ],
  "agents": {
    "build": {
      "model": "{env:OC_BUILD_MODEL}",
      "permissions": [{ "action": "maestro_config", "resource": "*", "effect": "ask" }]
    },
    "plan":  {
      "model": "{env:OC_PLAN_MODEL}",
      "permissions": [{ "action": "maestro_config", "resource": "*", "effect": "ask" }]
    },
    "custodian": {
      "model": "{env:OC_CUSTODIAN_MODEL}",
      "permissions": [
        { "action": "read",  "resource": "*", "effect": "allow" },
        { "action": "read",  "resource": "docs/confidential/*", "effect": "allow" },
        { "action": "read",  "resource": ".confidential/**", "effect": "allow" },
        { "action": "glob",  "resource": "docs/confidential/*", "effect": "allow" },
        { "action": "glob",  "resource": ".confidential/**", "effect": "allow" },
        { "action": "grep",  "resource": "docs/confidential/*", "effect": "allow" },
        { "action": "grep",  "resource": ".confidential/**", "effect": "allow" },
        { "action": "edit",  "resource": "*", "effect": "deny" },
        { "action": "shell", "resource": "*", "effect": "deny" },
        { "action": "subagent", "resource": "*", "effect": "deny" },
        { "action": "maestro_config", "resource": "*", "effect": "deny" }
      ]
    },
    "sanitizer": {
      "model": "{env:OC_SANITIZER_MODEL}",
      "permissions": [
        { "action": "edit",  "resource": "*", "effect": "deny" },
        { "action": "shell", "resource": "*", "effect": "deny" },
        { "action": "subagent", "resource": "*", "effect": "deny" }
      ]
    },
    "opus":    { "model": "{env:OC_OPUS_MODEL}" },
    "sonnet":  { "model": "{env:OC_SONNET_MODEL}" },
    "haiku":   { "model": "{env:OC_HAIKU_MODEL}" },
    "fable":   { "model": "{env:OC_FABLE_MODEL}" },
    "reviewer":{ "model": "{env:OC_REVIEWER_MODEL}" }
  }
}
```

**Per-project:** committed `opencode.json` в корне репо — `provider`-секции (`{env:VAR}`/`{file:}`), `instructions`, project-специфика. Runtime-инъекция per-project блока — `OPENCODE_CONFIG_CONTENT` из entrypoint (шаблон + env). **Per-project maestro.json:** root (committed) — trust/confidential/sanitizer_whitelist; layer 2 `.maestro/maestro.json` — memory-опции. **Dual mode (6.4.0):** если `maestro.json` содержит секцию `confidential` — legacy-режим (plugin enforcement); секции нет — new-режим (native permissions as barrier). Docker skeleton не содержит секции `confidential` → new-режим по умолчанию.

### 2.9. Git-токен: tmpfs credential-store

```bash
CRED=/dev/shm/git-credentials
printf 'https://oauth2:%s@%s\n' "$GIT_TOKEN" "$HOST" > "$CRED"; chmod 600 "$CRED"
git config --global credential.helper "store --file $CRED"
```

**Преимущества:**
- Стандартный механизм, работает со всеми git-командами агентов
- Файл 600 на tmpfs, умирает с контейнером
- Remote URL остаётся чистым (токен не в `.git/config`)
- Токен не в `ps`, не в image layers

### 2.10. Healthcheck и auth

- **Password:** `OPENCODE_PASSWORD` (первичный, `OPENCODE_SERVER_PASSWORD` — фолбэк). При заданном env — пароль **не печатается** в stdout.
- **Auth:** Basic, username `opencode`, password из env.
- **Healthcheck:** `curl -sf -u "opencode:$PW" http://127.0.0.1:4096/api/info` (503 до readiness, 200 после).
- `/openapi.json` доступен для контрактной верификации.

### 2.11. Memory layer (MVP: deferred)

- По умолчанию: `memory.enabled: false` (privacy-safe default канона).
- Включение → follow-up фича:
  - `memory.data_dir` (config/env-override) — отдельный volume memory-данных.
  - Отдельный `memory.cache_dir` — кэш модели не на «ценном» volume с БД.
  - RO-shared volume для кэша модели между контейнерами.
- **Важно:** `memory.data_dir` и `memory.cache_dir` — **фиктивные ключи** (в коде плагина отсутствуют). Реализация требует:
  - правки `plugins/maestro-bootstrap/memory/index.js` (резолв `data_dir` из config/env)
  - обновления `manual_docs/reference/memory.md`
  - тестов coverage в `index.test.js`
- По умолчанию opencode резолвит data-dir через `XDG_DATA_HOME` (на `/data`) — это работает. `memory/index.js` **читает** `XDG_DATA_HOME` → memory.db корректно попадает в `/data/maestro/memory/<key>/`. Захардкожен только `cache_dir` эмбеддера (`embeddings.js:41`) — кэш модели не на `/cache`. Следующий шаг — явный `cache_dir` override (требуется правка `memory/embeddings.js`).

### 2.12. Тулкит целевого проекта

**Рекомендация:** `FROM maestro-base:<tag>` + тонкий per-проект слой.
Универсальный образ раздувается; runtime-установка ломает детерминизм.

### 2.13. Per-agent access matrix (проверено opus-анализом)

Вся матрица — результат глубокого анализа opus сабагента по фактическому бинарнику v2.0.32, dogfooding `.opencode/opencode.json`, `agents/*.md` и SECURITY.md.

| Агент | Trust | confidential r/g/g | edit | bash | maestro_config | Модель (dogfooding; tier) |
|---|---|---|---|---|---|---|
| **primary/оркестратор** (build/plan) | fail-closed untrusted | deny (global baseline) | allow | allow | **ask** (санкционированный канал, P6) | `{env:OC_BUILD_MODEL}` |
| **custodian** | **trusted** (`trust.custodian`) | **allow** (per-agent override, Этап A/R2) | deny | deny | deny | `{env:OC_CUSTODIAN_MODEL}` — P4: изолированный провайдер (рекомендуемо) |
| **sanitizer** | **trusted** (`trust.sanitizer`) | deny (наследует global) | deny | deny | deny | `{env:OC_SANITIZER_MODEL}` |
| **opus** | untrusted | deny | deny | deny | deny | `{env:OC_OPUS_MODEL}` |
| **sonnet** | untrusted | deny | allow | allow | deny | `{env:OC_SONNET_MODEL}` |
| **haiku** | untrusted | deny | allow | allow | deny | `{env:OC_HAIKU_MODEL}` |
| **fable** | untrusted | deny | deny | deny | deny | `{env:OC_FABLE_MODEL}` |
| **reviewer** | untrusted; `hidden: false` | deny | deny | allow (git diff/log) | deny | `{env:OC_REVIEWER_MODEL}` |
| **нерезолвнутый** | **fail-closed untrusted** | deny (наследует глоб.) | — | — | **deny** (глобальный deny, плагинный guard) | нет `agent.*.model` → не диспатчится |

**Maestro_config:** global `deny` — fail-closed по умолчанию; `ask` только для primary (build, plan) — санкционированный канал P6. **Sanitizer:** минимальный per-agent набор (3 правила: edit/shell/subagent deny). Confidential deny — наследует от global baseline (read/glob/grep). custodian — полный per-agent allow для confidential (единственный агент, которому нужен read confidential). Незнакомые сабагент-имена наследуют global `deny` (fail-closed, P6 — двухслойная защита: глобальный deny + plugin guard).

**Memory-инструменты (docker, SEC-4b read-only allow):** `memory_search`, `memory_stats_detail`, `memory_recall_preview`, `memory_probe` — `allow` (aggregates-only/read-only, безопасно). `memory_backup: ask` (HITL-гейт). Boundary-ops: `deny` (вне контейнера). Когда memory enabled (MVP disabled; §2.11) — follow-up. Сабагенты в пайплайне их не используют.

### 2.14. Experimental policies (optional layer, P4-hygiene)

Формат: `experimental.policies: [{effect: allow/deny, action: "provider.use", resource: <providerID>}]`. Enforced в ядре — провайдер, запрещённый политикой, недоступен для model selection или model use.

**В Docker-дизайне — опционально (не обязательный слой):**
- **Не покрывает per-agent изоляцию** P4 (нет agent-scoping в policies). Изоляция trusted-агентов на уровне модели остаётся на конфиг-уровне (`agent.*.model`).
- **Покрывает** blast-radius: deny-all + allow-list провайдеров контейнера — случайный env-ключ, credential-import или OAuth-логин не расширит множество провайдеров.
- **Global beats project** — единственный слой (кроме managed `/etc/opencode/`), который project-оверлей не может переопределить.
- **Включение:** рекомендуется при remote-провайдерах в контейнере — deny `*` + allow санкционированного списка; placement: только в глобальном скелете образа.
- **Формулировка для spec:** "опционально; включаем при remote-провайдерах; API experimental — pin-проверка при смене версии".

---

## 3. Security considerations

| Requirement | Реализация |
|---|---|
| **P1: Confidential deny** | **Нативные permissions OpenCode — основной барьер** (6.4.0): deny `read`/`edit`/`glob`/`grep` + per-agent allow для role-set (`custodian`/`sanitizer`). Плагин — shadow-audit (observability), не enforcement (new-режим). Legacy-режим (dual mode D5): пока секция `confidential` есть в `maestro.json` — legacy-enforcement плагином. |
| **P1: Trust model (6.4.0)** | Trusted = **role-set** `{custodian, sanitizer}` (hardcoded в плагине). Секция `trust` **удалена** из схемы `maestro.json` (6.4.0, B): любой ключ `trust.*` → warn `trust:deprecated_key` + игнор. Доверие по роли, не по конфигу. |
| **P2: Модели = атрибут имени** | `agent.*.model` в конфиге; runtime-проверка не требуется (P2) |
| **P3: Fail-closed** | нет подмены subagent_type/модели для trusted-агентов |
| **P4: Trusted agents** | изолированные модели (`{env:OC_CUSTODIAN_MODEL}`); @test-agents перед пайплайном |
| **P4-hygiene** | experimental.policies (optional): deny-all + allow-list провайдеров, global-beats-project |
| **P5: Plugin gate** | плагин обязателен для: Ур.1-sanitize (fail-closed), merge/commit-guard (P9), observability, memory. Файловая защита restricted-данных — нативные permissions (не зависит от плагина). |
| **P6: maestro_config sanctioned channel** | native permissions deny read/glob/grep/edit для maestro.json; global `deny` + ask только для primary (build, plan) — fail-closed по умолчанию; плагинный guard (по сессии) |
| **P9: merge-guard** | маркер в `<root>/.maestro/gates/` |
| **Token hygiene** | tmpfs 600, не в image, не в .git/config |
| **Credential hygiene** | {env:} в env_file (0600), не в YAML/образе |
| **Confidential two paths** | `docs/confidential/**` — model-boundary, git-ok; `.confidential/**` — machine-boundary, gitignored, ro-bind в mode A |
| **Confidential gitignore-guard** | entrypoint check + optional bash-guard (по аналогии merge-guard) — задача в план |
| **Confidential shell-bypass (residual)** | untrusted-агенты с bash-allow (sonnet/haiku/reviewer) могут `cat .confidential/**` — permission-deny покрывает read/glob/grep/edit, но **не shell** (best-effort, как в host-dogfooding SEC-5). Митигация: non-root USER (через root-entrypoint drop) + `--cap-drop=ALL` ограничивают blast radius; полная защита — bash-эвристики. Не устраняется в MVP — принятый residual. |
| **Container hardening** | `--cap-drop=ALL`, `--security-opt no-new-privileges`, non-root USER (root-entrypoint→drop), `-p 127.0.0.1:4096:4096` (по умолчанию, не 0.0.0.0), healthcheck-скрипт (пароль не в `docker inspect`) — см. §5.9 |
| **Sensitive data** | opencode.db = raw-транскрипты (конфиденциальный класс); backup осознанно |
| **Memory masking** | generic-маскирование (технические секреты) до/после саммаризации; business-confidential НЕ маскируется (SEC-5, принятый риск, 6.4.0 D3) |

---

## 4. Open questions

1. **Prune opencode.db:** API-режим удаления старых сессий для долгоживущего сервера?
2. **Healthcheck endpoint:** `/api/info` (v2.0.32) vs `/global/health` (docs) — зависит от пинна opencode версии.
3. **Pre-bake memory module_dir:** стоит ли запекать в образ (−76 МБ из /data, + сложность stamp-синхронизации)?
4. **Shared read-only model cache:** RO-volume для кэша модели между контейнерами (требует проверки transformers).
5. **Per-agent policies:** если в будущем появится agent-scoped `provider.use` — включим policies для P4 enforcement.
6. **Worktree confidential access:** как дать confidential-доступ worktree-сессиям без mount-асимметрии? Варианты: (a) base-worktree = mainline, (b) отдельный mount `.confidential/` в worktree-директорию.
7. **Ask-routing в serve-режиме:** как доставляются `ask`-permission-запросы (HITL-гейты пайплайна, `maestro_config`) клиентам `opencode serve` (TUI, Web, API)? TUI-attach предположительно поддерживает, Web/API — unverified. Если клиент не поддерживает → HITL-гейт ломается (permission-запрос висит/deny).
8. **Partial clone для >10 ГБ:** `--filter=blob:none` (partial clone, полный граф коммитов) — альтернатива для гигантских репо. Full clone = единственная безопасная стратегия для ancestry, но может быть медленным. Open question для план-этапа.
9. **`--read-only` feasibility (opt-in):** контейнер с `--read-only` + tmpfs `/tmp` и `$HOME` — опциональная митигация. Требует оценки: opencode требует write в `/tmp` и `$HOME` для git config.

---

## 5. How to: запуск maestro в Docker

### 5.1. Предварительные требования

1. **Docker** с поддержкой named volumes и bind mounts (Docker Desktop / Docker Engine ≥ 24).
2. **Token для git** (`GH_PAT`) — personal access token с `repo` scope.
3. **Model env-переменные** — `OC_BUILD_MODEL`, `OC_PLAN_MODEL`, `OC_CUSTODIAN_MODEL`, `OC_OPUS_MODEL`, `OC_SONNET_MODEL`, `OC_HAIKU_MODEL`, `OC_FABLE_MODEL`, `OC_REVIEWER_MODEL`.
4. **Password** — `OPENCODE_PASSWORD` (для Basic auth сервера).

### 5.2. Environment файл

Создайте `.env.docker` в рабочей директории:

> **Безопасность:** `chmod 600 .env.docker` — файл содержит секренты.

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
OC_OPUS_MODEL="openai/gpt-4o"
OC_SONNET_MODEL="anthropic/claude-sonnet-4-20250514"
OC_HAIKU_MODEL="openai/gpt-4o-mini"
OC_FABLE_MODEL="local/falcon-3b"
OC_REVIEWER_MODEL="openai/gpt-4o"

# Конфиденциальные API-ключи (через {env:VAR} в конфиге)
OPENAI_API_KEY="sk-..."       # для provider openai
AKASH_API_KEY="..."            # для provider akash
```

### 5.3. Режим A: self-contained

```bash
# Запуск (все переменные — из .env.docker; не дублировать через -e,
# т.к. -e имеет больший приоритет и при unset-переменной подставит пустую строку)
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

# Подключение TUI
opencode attach http://127.0.0.1:4096

# Проверка health (CLI client — безопасно, не в docker-compose)
curl -sf -u "opencode:${OPENCODE_PASSWORD}" http://127.0.0.1:4096/api/info

# Production healthcheck (docker inspect-safe): скрипт /usr/local/bin/healthcheck.sh в образе
# В docker-compose.yml: test: ["CMD", "/usr/local/bin/healthcheck.sh"]

# Остановка (контейнер сохраняется для восстановления)
docker stop maestro-<project>

# Восстановление (named volumes переживают stop; для полного reset — docker rm + docker run)
docker start maestro-<project>

# Полный reset (удаляет контейнер, volumes сохраняются)
docker rm maestro-<project>
docker run -d ... (те же флаги) maestro-opencode:6.x
```

### 5.4. Режим B: live-mount

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
- `REPO_URL` НЕ задавать (иначе entrypoint детектирует как режим A).
- Дерево хоста должно содержать `.confidential/` (gitignored, но физически существующий).
- Serial-режим: только один контейнер может иметь rw-доступ к дереву.
- Порт: `127.0.0.1` по умолчанию; для удалённого — SSH-туннель или `PROJECT_PORT:4096` без IP-бинда.

### 5.5. docker-compose.yml

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
      - "${PROJECT_PORT:-4096}:4096"
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
PROJECT_NAME=myapp REPO_NAME=myapp docker compose up -d
```

**Важно:** `~` не раскрывается в docker-compose — используйте `${HOME}`. `version: "3.9"` — опционален (compose v2+ игнорирует). Healthcheck использует скрипт в образе (`/usr/local/bin/healthcheck.sh`), не интерполирует пароль → безопасен для `docker inspect`. `start_period: 120s` — полный clone может занять минуты. `PROJECT_PORT` — параметризация для N проектов.

### 5.6. Диагностика

| Проблема | Решение |
|---|---|
| Контейнер не стартует | `docker logs maestro-<project>` — entrypoint логирует этапы (clone, setup, serve) |
| `.confidential` пустой | Проверьте `~/maestro-confidential/<project>` на хосте; entrypoint логирует «empty mount point» |
| `git clone` падает | Проверьте `GH_PAT` scope; убедитесь что `REPO_URL` доступен с сервера (для режима A) |
| `opencode attach` не подключается | Проверьте `OPENCODE_PASSWORD`; healthcheck: `curl -u opencode:$PW http://127.0.0.1:4096/api/info` |
| Logs не видны | Проверьте `~/maestro-state/<project>/logs/`; daily JSONL format, фильтруйте по sessionID через `jq` |

### 5.7. Backup и восстановление

```bash
# Backup opencode.db + memory (cold — остановить контейнер)
docker stop maestro-<project>
docker cp maestro-<project>:/data/opencode.db /backup/opencode.db-$(date +%Y%m%d)
docker cp maestro-<project>:/data/maestro/memory/ /backup/memory-$(date +%Y%m%d)/
docker start maestro-<project>

# Backup state (hot — контейнер может работать)
cp -r ~/maestro-state/<project> /backup/maestro-state-$(date +%Y%m%d)
```

**Важно:**
- Путь memory.db: `/data/maestro/memory/<key-hash>/memory.db` (per-key layout, не плоский)
- Горячий `docker cp` SQLite-файла на работающем сервере рискует неконсистентной копией (WAL). Для production — cold backup (stop перед copy) или `docker exec ... sqlite3 /data/opencode.db ".backup '/tmp/backup.db'"`
- Чище: volume-level tar — `docker run --rm -v oc-data-<project>:/data -v ~/backup:/backup alpine tar czf /backup/data-$(date +%Y%m%d).tar.gz /data`

```bash
# Restore
docker stop maestro-<project>
docker cp /backup/opencode.db-YYYYMMDD maestro-<project>:/data/opencode.db
# memory: docker cp /backup/memory-YYYYMMDD/. maestro-<project>:/data/maestro/memory/
docker start maestro-<project>
```

### 5.8. Обновление версии

```bash
# 1. Остановить и удалить контейнер (volumes сохраняются)
docker stop maestro-<project> && docker rm maestro-<project>

# 2. Пересобрать образ (из репозитория maestro, Dockerfile + entrypoint — задача плана)
docker build -t maestro-opencode:6.x -f <path-to-Dockerfile> .

# 3. Запустить с новым образом (volumes сохраняются — workspace, data, cache)
docker run -d ... (те же флаги, что в 5.3) maestro-opencode:6.x
```

**Важно:** `docker start` НЕ обновляет образ — контейнер навсегда привязан к image-слоям, с которыми создан. Обновление = `rm` + `run`. Данные в named volumes (`oc-ws`, `oc-data`, `oc-cache`) переживают.

### 5.9. Hardening (рекомендуемый набор)

**Non-root user (root-entrypoint → drop):** Dockerfile `USER root` → entrypoint chowns volumes → `su-exec <UID>:<GID> opencode serve`. Non-root процесс запускает только opencode, не entrypoint.

```bash
# docker run (добавить к 5.3)
docker run -d \
  --cap-drop=ALL \
  --security-opt no-new-privileges \
  --user "${UID}:${GID}" \
  -p 127.0.0.1:4096:4096 \
  ...
```

| Флаг | Назначение |
|---|---|
| `--cap-drop=ALL` | Удаляет все Linux capabilities — агент не может привилегированные операции |
| `--security-opt no-new-privileges` | Запрещает escalation через setuid/setgid бинарники |
| `--user UID:GID` | Не используется. Non-root через root-entrypoint (см. выше) |
| `-p 127.0.0.1:4096:4096` | API торчит только на localhost — для удалённого доступа: SSH-туннель или TLS-прокси |

**Healthcheck-скрипт** (в образе, не интерполяция пароля):
```bash
#!/bin/sh
# /usr/local/bin/healthcheck.sh
# Читает пароль из env (не из compose interpolate → безопасен для docker inspect)
curl -sf -u "opencode:${OPENCODE_PASSWORD}" http://127.0.0.1:4096/api/info >/dev/null 2>&1
```
В compose: `test: ["CMD", "/usr/local/bin/healthcheck.sh"]`. В 5.3 healthcheck — `curl -sf -u "opencode:${OPENCODE_PASSWORD}"` — интерполирует в шелле клиента, безопасен (не в compose).

**Port-параметризация** (N проектов на одной машине):
```bash
-p ${PROJECT_PORT:-4096}:4096
```

**Resource limits** (compose):
```yaml
deploy:
  resources:
    limits:
      memory: 4G
      cpus: "4"
```

**`compose down -v` предупреждение:**
> `docker compose down -v` УДАЛЯЕТ named volumes (oc-ws, oc-data, oc-cache). Используйте `docker compose down` (без -v) для остановки.

---

## 6. Implementation tasks (из review)

Эти задачи должны быть включены в plan-документ:

1. **[Плагин]** `confidential.tracked_in_git` — check при bootstrap init (`git ls-files .confidential/`, одноразовый console.warn + инструкция `git rm -r --cached`).
2. **[maestro-setup]** Двойной дефолт в `confidential.paths`: `docs/confidential/**` + `.confidential/**`.
3. **[маэстро-setup]** Добавление `.confidential/` в `.gitignore` (если ещё нет).
4. **[Entry-point]** Gitignore-guard для `.confidential/` — проверка `git ls-files .confidential/` + `git check-ignore .confidential/` при clone → warn/error если есть tracked файлы.
5. **[Plugin]** Document worktree confidential asymmetry (П-2) — warning в logs при работе из worktree с отсутствующим `.confidential/`.
6. **[Docs]** `manual_docs/how-to/docker-serve.md` — расширенная версия секции 5 How to, с примерами для Mac/Linux/VM.
7. **[Docs]** Update `reference/config.md` и `reference/memory.md` (изменения `/maestro-setup` и memory `cache_dir`).
8. **[Tests]** Smoke-тесты docker-режима A и B через `maestro-sandbox.sh --docker`.
9. **[Dockerfile]** Root-entrypoint (USER root) → chown volumes → `su-exec <UID>:<GID> opencode serve` (task: image spec). Добавить `su-exec` или `gosu` в base image.
10. **[Entrypoint]** `healthcheck.sh` скрипт (чтение OPENCODE_PASSWORD из env, не compose interpolation) — добавить в образ.
10. **[Entrypoint]** Log retention: очистка `/maestro/logs/*.jsonl` старше N дней (default 30).
11. **[Entrypoint]** `unset GIT_TOKEN` после записи в tmpfs credential-store (убрать из env процесса).
12. **[Compose]** `start_period: 120s` (полный клон может занять минуты на больших репо).
13. **[How-to]** Сценарий удалённого доступа (SSH-туннель / TLS-прокси) — раздел в How-to.
14. **[How-to]** Сценарий первого запуска (сборка образа) — добавить в 5.1 prerequisites.
15. **[How-to]** Warning: `compose down -v` удаляет volumes (в 5.5).
