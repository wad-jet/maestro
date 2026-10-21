# Design: Dockerized `opencode serve` for maestro

> **Дата:** 2026-10-20
> **Автор:** orchestrator (из сессии обсуждения)
> **Статус:** draft → v25 (MCP deny, provider-allowlist mandatory via source-verified, formatter denial, egress-filter, config-substitution documented, MCP how-to spec)
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
| **TUI** | `OPENCODE_PASSWORD=xxx opencode --server http://127.0.0.1:4096` | Основной канал (HITL, gates). `attach` не существует в opencode v2 — используем `--server` flag
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
# GIT_TERMINAL_PROMPT=0 — блокирует интерактивный ввод при clone/fetch (CI/remote-safe)
GIT_TERMINAL_PROMPT=0 git clone "$REPO_URL" /tmp/clone

# 2. Full rsync, исключая mount-point пути (rsync не трогает .confidential/ т.к. его нет в источнике)
rsync -a /tmp/clone/ /workspace/<repo>/

# 3. Уборка
rm -rf /tmp/clone
```

**Почему полный клон, не shallow:** `--depth=1` ломает ancestry-фичи maestro: merge-guard P9 (`git merge-base --is-ancestor`), branch-aware memory v3 (`is-ancestor(head, mainline)`), `memory_reindex` git-history. На shallow-клоне эти проверки всегда fail. Полный клон — единственная безопасная стратегия.

**Fallback (update existing clone):** если `/workspace/<repo>` уже существует (из previous run), entrypoint пропускает clone и выполняет:
```bash
# GIT_TERMINAL_PROMPT=0 — не спрашивать пароль при fetch
GIT_TERMINAL_PROMPT=0 git -C /workspace/<repo> fetch --all --prune
git -C /workspace/<repo> checkout -B main origin/main  # или нужная ветка
git -C /workspace/<repo> clean -fd -e .confidential -e .opencode  # remove untracked leftovers; -e .opencode — mount-точка bind-mount
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

Конфигурация образа — **два файла** на разных слоях приоритета OpenCode.

#### 2.8.1. `/etc/opencode/opencode.json` — security baseline (managed, highest file precedence)

System-слой (Linux: `/etc/opencode/`) перекрывает **любой** файл из репо или пользователя. Это **единственное** место, где живут security-правила — ни один клонируемый/committed файл не может их ослабить.

```jsonc
{
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
    // maestro_config — fail-closed deny глобально
    { "action": "maestro_config", "resource": "*", "effect": "deny" }
  ],
  // managed policies: hard-restrict integrations (code-exec surfaces).
  // Plugin = произвольный код в процессе opencode-сервера, не sandboxed (доки).
  // MCP = stdio command = произвольный процесс в контейнере (тот же класс, что plugin).
  // Provider = npm-пакет, загружаемый в процесс (RCE). См. §3 для деталей.
  // Allowlist: только базовые плагины maestro-дистрибутива.
  // Repo-конфиг НЕ может переопределить (system policies wins, reverse precedence).
  // Provider-allowlist: генерируется entrypoint'ом из OC_*_MODEL + OC_PROVIDERS_JSON.
  // Provider-*definitions* (baseURL, settings): объявлены в /etc/opencode (managed,
  //   repo не может перекроить ID через тот же ключ). OC_PROVIDERS_JSON (env-layer)
  //   — высший приоритет, repo не перекроет.
  // tool.use: hard-floor поверх permissions (system wins).
  "policies": [
    // --- integrations: code-exec поверхности ---
    { "action": "integration.use", "resource": "plugin:*", "effect": "deny" },
    { "action": "integration.use", "resource": "plugin:/opt/maestro/plugins/maestro-bootstrap/index.js", "effect": "allow" },
    { "action": "integration.use", "resource": "plugin:/opt/superpowers", "effect": "allow" },
    // C1: MCP — stdio command = code exec; maestro-пайплайн MCP не требует.
    //   Operator-sanctioned: allow mcp:<name> + объявление сервера в /etc/opencode
    //   (system-слой выигрывает merge-repo для same-name server, закрывая name-hijack).
    { "action": "integration.use", "resource": "mcp:*", "effect": "deny" },
    // (оператору, при необходимости: allow для конкретного mcp:<name> ПОСЛЕ deny)
    // --- providers: обязательный allowlist (C2+C4, подтверждено исходником:
    //   provider.use:deny удаляет провайдера из каталога до npm.load) ---
    { "action": "provider.use", "resource": "*", "effect": "deny" },
    // allow entries генерируются entrypoint'ом из OC_*_MODEL + OC_PROVIDERS_JSON.
    // Примеры (меняются при смене провайдеров):
    // { "action": "provider.use", "resource": "akash", "effect": "allow" },
    // { "action": "provider.use", "resource": "openai", "effect": "allow" },
    // --- tools: hard-floor поверх permissions (система wins) ---
    // C8: webfetch/websearch — exfil-канал (контекст с confidential-производными) + SSRF.
    //   Deny на system-слое перекрывает любые per-agent allow и saved approvals.
    //   Maestro-скиллы могут нуждаться в веб (проверка доков) — verифицировать,
    //   после живого @maestro-init: если ломает → разрешить per-agent allow.
    { "action": "tool.use", "resource": "webfetch:*", "effect": "deny" },
    { "action": "tool.use", "resource": "websearch:*", "effect": "deny" }
  ]
}
```

**Правило:** `/etc/opencode/` содержит **только** `permissions`, `policies` и (при необходимости) **объявления провайдеров** + **объявления MCP-серверов**. Никаких `agents`, `instructions` — это зона безопасности. Provider-*определения* живут здесь, а не в skeleton: project-слой репо перекроет global skeleton, поэтому репо не может подменить baseURL санкционированного провайдера тем же ID. Для operator-кастомизации (добавить/изменить правила) — см. §2.8.2.

#### 2.8.2. `~/.config/opencode/opencode.json` — global skeleton (user-layer)

Глобальный скелет образа — базовые настройки, **без** `permissions` (они в `/etc/opencode/`). Перекрывается committed проектом и `OPENCODE_CONFIG_CONTENT`.

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["/opt/maestro/plugins/maestro-bootstrap/index.js", "/opt/superpowers"],
  "update": "disable",
  "default_agent": "build",
  "subagent_depth": 1,
  "worktree": { "directory": "./.worktrees" },
  // «instructions» — НЕ здесь (per-project: docs/project-context.md, SECURITY.md)
  // из committed opencode.json в корне репо
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
    "opus":    { "model": "{env:OC_OPUS_MODEL}" },
    "sonnet":  { "model": "{env:OC_SONNET_MODEL}" },
    "haiku":   { "model": "{env:OC_HAIKU_MODEL}" },
    "fable":   { "model": "{env:OC_FABLE_MODEL}" },
    "reviewer":{ "model": "{env:OC_REVIEWER_MODEL}" }
  }
}
```

**Передоставка кастомных провайдеров (опционально):** для operator-кастомизации без пересборки — смонтировать конфиг на `/etc/opencode/` (managed-слой) или в директорию `.opencode/` проекта.

**Важно:** provider-*определения* (baseURL, settings, apiKey через `{env:}`) должны жить **только в managed-слое** (`/etc/opencode/`) или env-слое (`OPENCODE_CONFIG_CONTENT`). skeleton (`~/.config/opencode/`) — project-слой репо перекроет same-ID provider своим baseURL (C2/C4). Для operator-кастомизации:
- bind-mount: `-v ~/maestro-config/<project>/.opencode/opencode.json:/workspace/<repo>/.opencode/opencode.json` (покрывает committed, но не `/etc/opencode/`)
- named volume на `/etc/opencode/` (покрывает ВСЁ — оператор полностью контролирует; требует seeding entrypoint'ом при первом запуске)
- MCP-серверы — объявление + allow в managed-слое (имя = защита от name-hijack)

**Пер-project:** committed `opencode.json` в корне репо — `provider`-секции (`{env:VAR}`/`{file:}`), `instructions`, project-специфика. **Per-project maestro.json:** root (committed) — trust/confidential/sanitizer_whitelist; layer 2 `.maestro/maestro.json` — memory-опции. **Dual mode (6.4.0):** если `maestro.json` содержит секцию `confidential` — legacy-режим (plugin enforcement); секции нет — new-режим (native permissions as barrier). Docker skeleton не содержит секции `confidential` → new-режим по умолчанию.

**Важно:** `OPENCODE_CONFIG_CONTENT` инъектирует строго `agents.*.model` + `default_agent` + `providers` — не `permissions`, не `policies`, не `plugins`, не `instructions`. Это защитный контракт: репо-конфиг не может перенаправить модели на кастомный endpoint (anti-redirect control). Provider-определения из `OC_PROVIDERS_JSON` — высший приоритет, repo не перекроет.

**`OPENCODE_CONFIG_CONTENT` contract:** entrypoint резолвит из env-переменных и генерирует частичный JSON, который opencode merge-ит с committed `opencode.json`:
- `OC_BUILD_MODEL` → `agents.build.model`
- `OC_PLAN_MODEL` → `agents.plan.model`
- `OC_CUSTODIAN_MODEL` → `agents.custodian.model`
- `OC_SANITIZER_MODEL` → `agents.sanitizer.model`
- `OC_OPUS_MODEL` → `agents.opus.model`
- `OC_SONNET_MODEL` → `agents.sonnet.model`
- `OC_HAIKU_MODEL` → `agents.haiku.model`
- `OC_FABLE_MODEL` → `agents.fable.model`
- `OC_REVIEWER_MODEL` → `agents.reviewer.model`
- `OC_PROVIDERS_JSON` → `providers` (см. ниже)
- `OPENCODE_DEFAULT_AGENT` → `default_agent` (по умолчанию `"build"`; защищает от подмены default_agent из репо-конфига)
- `OPENCODE_PASSWORD` → используется для Basic auth сервера (не инъектируется в JSON)

**`OC_PROVIDERS_JSON`** — JSON-строка с секцией `providers` (custom provider). **Пример:**
```bash
OC_PROVIDERS_JSON='{"myprov":{"npm":"@ai-sdk/openai-compatible","options":{"baseURL":"https://api.myprov.com/v1"},"models":{"my-model":{}}}}'
```

**Защитный контракт:** `OPENCODE_CONFIG_CONTENT` содержит **строго** `agents.*.model` и `providers`. **Запрещено** содержать `permissions`, `policies`, `plugins`, `instructions` — эти секции управляются на уровне managed-слоя (`/etc/opencode/`) или baked skeleton. Это предотвращает обход security-базовой линии через env-переменные.

**Политика загрузки плагина:** даже если плагин декларирован через любой конфигурационный слой (committed, bind-mount, `OPENCODE_CONFIG_CONTENT`), загрузится **только** тот, что есть в allowlist managed policies (`/etc/opencode/`). Policy-слой не обойти из config-слоя — defense-in-depth.

**Приоритет:** `OPENCODE_CONFIG_CONTENT` имеет **высший** приоритет (загружается после project-слоя). Контракт гарантирует безопасность: env-инъекция содержит **строго** `agents.*.model` и `providers` (без `permissions`, `instructions` и других полей) — это предотвращает случайную перезапись security-конфига committed файла. При расширении контента за пределами `model` и `providers` — это осознанное действие с пониманием последствий (но `permissions`/`policies`/`plugins` всё равно заблокированы managed policy-слоем).

**Приоритет:** `OPENCODE_CONFIG_CONTENT` имеет **высший** приоритет (загружается после project-слоя). Контракт гарантирует безопасность: env-инъекция содержит **строго** `agents.*.model` (без `permissions`, `instructions` и других полей) — это предотвращает случайную перезапись security-конфига committed файла. При расширении контента за пределы `model` (например, добавление `permissions`) — это осознанное действие с пониманием последствий.

**Важно:** `OPENCODE_CONFIG_CONTENT` действует **только в serve-режиме** (инжекционируется через config-лоадер serve; в CLI-командах `opencode run`/`opencode debug` и т.д. игнорируется). Для non-serve-режима модели резоллятся через `{env:VAR}` в committed `opencode.json`.

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

### 2.12. Dockerfile specification (базовый образ)

**Рекомендация:** многоступенчатая сборка.

#### Stage 1: `maestro-base` (публичный/канонический)

```dockerfile
FROM node:20-slim AS maestro-base
LABEL maintainer="maestro <maintainer@example.com>"

# Зависимости для entrypoint (git, rsync, gosu, curl, jq)
# su-exec — Alpine-пакет; в Debian/Ubuntu нужен gosu
RUN apt-get update && apt-get install -y --no-install-recommends \
      git rsync gosu curl jq \
    && rm -rf /var/lib/apt/lists/*

# OpenCode CLI (pin версии)
# ВАЖНО: pin-версия opencode НЕ обязана совпадать с maestro version — версии независимы
# update — отдельный процесс (см. §5.8)
RUN npm install -g opencode@<pin-version>

# maestro skill files: wholesale copy из authoring repo (skills/, commands/, agents/, plugins/)
# Это обязательный шаг: пайплайн maestro в контейнере невозможен без скиллов;
# Гейт 0 и P5 (sanitize, merge-guard) требуют плагина.
# Канонический способ: клон maestro-repo в сборке → maestro-install.sh (wholesale)
# Альтернатива: явный COPY с version-pin (синхронизация скиллов ↔ плагина, --pin <sha> канон)
COPY maestro-install.sh /opt/maestro/maestro-install.sh
COPY skills/ /opt/maestro/skills/
COPY commands/ /opt/maestro/commands/
COPY agents/ /opt/maestro/agents/
COPY plugins/maestro-bootstrap/ /opt/maestro/plugins/maestro-bootstrap/
ARG MAESTRO_SHA  # set during build: --build-arg MAESTRO_SHA=<commit-sha>
RUN /bin/bash -c 'if [ -z "$MAESTRO_SHA" ] || [ ! -d /opt/maestro/.git ]; then echo "ERROR: MAESTRO_SHA required"; exit 1; fi && cd /opt/maestro && bash maestro-install.sh --deploy --pin "$MAESTRO_SHA" --no-halt --skip-config 2>/dev/null || true'

# Superpowers plugin: bake в образ (не git+https runtime clone — supply-chain risk)
# По AGENTS.md: pin <sha> → атомарность скиллов ↔ плагин.
# Clone https-only (AGENTS.md), pinned commit, shallow.
# PROD: задавать SUPERPOWERS_SHA явно (конкретный SHA); DEV: можно HEAD, но это НЕ pinned.
ENV SUPERPOWERS_SHA=<pinned-sha>  # PROD: заменить на конкретный SHA (git ls-remote)
RUN git clone --depth 1 --no-single-branch "https://github.com/obra/superpowers.git#/opt/superpowers" && cd /opt/superpowers && git checkout $SUPERPOWERS_SHA

COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh
COPY docker/healthcheck.sh /usr/local/bin/healthcheck.sh
RUN chmod +x /usr/local/bin/entrypoint.sh /usr/local/bin/healthcheck.sh

# OpenCode config-файлы на двух уровнях приоритета:
# 1. /etc/opencode/opencode.json — permissions (managed, highest file precedence)
#    не может быть ослаблен committed opencode.json в клонируемом репо
# 2. ~/.config/opencode/opencode.json — global skeleton (plugins, agents)
COPY docker/etc-opencode.json /etc/opencode/opencode.json
COPY docker/user-opencode.json ~/.config/opencode/opencode.json

# Non-root USER (root-entrypoint делает chown → drop)
RUN adduser --disabled-password --gecos '' --uid 1000 opencode \
    && mkdir -p /workspace /data /cache /maestro \
    && chown -R opencode:opencode /workspace /data /cache /maestro

# ВАЖНО: НЕ устанавливаем USER opencode здесь — entrypoint запускается от root
# для chown volumes → gosu drop.
# Если образ уже собран с USER opencode — первый запуск с bind-mounted volume упадёт
# (root-owned auto-created каталоги не доступны uid 1000).
WORKDIR /workspace

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
```

#### Stage 2: per-project образ (опционально)

```dockerfile
FROM maestro-base:6.x AS myapp
# Копирование per-project файлов (provider-конфиг, instructions, и т.д.)
COPY opencode.json /workspace/opencode.json
# Опционально: pinned skills/commands/agents (если не mount-ятся через env)
# COPY .maestro/ /workspace/.maestro/
```

**Альтернатива — единый образ, per-project конфигурация через env (preferred):**
- Образ содержит только entrypoint + opencode CLI.
- Вся конфигурация (provider-конфиг, instructions, permissions) доставляется через:
  - Committed `opencode.json` в репо (per-project)
  - ENV-переменные для models (`OC_BUILD_MODEL`, `OC_CUSTODIAN_MODEL` и т.д.)
  - `OPENCODE_CONFIG_CONTENT` — runtime инъекция (см. §2.8)
- Это **избегает** необходимости пересборки образа при смене конфига.

#### Версионирование
- **Внутренняя стадия сборки:** `maestro-base` (не публикуется, используется как `FROM` для stage 2).
- **Публикуемый образ:** `maestro-opencode:6.x` — latest на major версии.
- `maestro-opencode:6.4.0` — pinned version (рекомендуется для production).
- Pin-версия opencode CLI — фиксируется в Dockerfile, не обновляется runtime.

### 2.13. Per-agent access matrix (проверено opus-анализом)

Вся матрица — результат глубокого анализа opus сабагента по фактическому бинарнику v2.0.32, dogfooding `.opencode/opencode.json`, `agents/*.md` и SECURITY.md.

| Агент | Trust | confidential r/g/g | edit | bash | maestro_config | Модель (dogfooding; tier) |
|---|---|---|---|---|---|---|
| **primary/оркестратор** (build/plan) | fail-closed untrusted | deny (global baseline) | allow | allow | **ask** (санкционированный канал, P6) | `{env:OC_BUILD_MODEL}` |
| **custodian** | **trusted** (`role-set {custodian, sanitizer}`) | **allow** (per-agent override, R2) | deny | deny | deny | `{env:OC_CUSTODIAN_MODEL}` — P4: изолированный провайдер (рекомендуемо) |
| **sanitizer** | **trusted** (`role-set {custodian, sanitizer}`) | **allow** (per-agent override, P1/R2) | deny | deny | deny | `{env:OC_SANITIZER_MODEL}` |
| **opus** | untrusted | deny | deny | deny | deny | `{env:OC_OPUS_MODEL}` |
| **sonnet** | untrusted | deny | allow | allow | deny | `{env:OC_SONNET_MODEL}` |
| **haiku** | untrusted | deny | allow | allow | deny | `{env:OC_HAIKU_MODEL}` |
| **fable** | untrusted | deny | deny | deny | deny | `{env:OC_FABLE_MODEL}` |
| **reviewer** | untrusted; `hidden: false` | deny | deny | allow (git diff/log) | deny | `{env:OC_REVIEWER_MODEL}` |
| **нерезолвнутый** | **fail-closed untrusted** | deny (наследует глоб.) | — | — | **deny** (глобальный deny, плагинный guard) | нет `agent.*.model` → не диспатчится |

**Maestro_config:** global `deny` — fail-closed по умолчанию; `ask` только для primary (build, plan) — санкционированный канал P6. **Sanitizer:** минимальный per-agent набор (3 правила: edit/shell/subagent deny). Confidential deny — наследует от global baseline (read/glob/grep). custodian — полный per-agent allow для confidential (единственный агент, которому нужен read confidential). Незнакомые сабагент-имена наследуют global `deny` (fail-closed, P6 — двухслойная защита: глобальный deny + plugin guard).

**Memory-инструменты (docker, SEC-4b read-only allow):** `memory_search`, `memory_stats_detail`, `memory_recall_preview`, `memory_probe` — `allow` (aggregates-only/read-only, безопасно). `memory_backup: ask` (HITL-гейт). Boundary-ops: `deny` (вне контейнера). Когда memory enabled (MVP disabled; §2.11) — follow-up. Сабагенты в пайплайне их не используют.

### 2.14. Policies (stable API, P4-hygiene)

Формат: `policies: [{effect: allow/deny, action: "provider.use", resource: <providerID>}]`. Enforced в ядре — провайдер, запрещённый политикой, недоступен для model selection или model use. В доках API стабильный (не `experimental.policies` — V1 legacy `experimental.policies` merge-ится в `policies`, но канон — `policies`).

**Применение в Docker-дизайне:**

- **Plugin-allowlist — обязательный:** `/etc/opencode/opencode.json` содержит `deny plugin:*` + allow для базовых плагинов. Закрывает атаку: клонируемый репо не может инжектить код в процесс сервера (plugin = код в процессе, не sandboxed).
- **MCP-allowlist — обязательный:** `deny mcp:*` — stdio command = код в контейнере. Санкционированные серверы объявляются в /etc/opencode + allow mcp:<name>.
- **Provider-allowlist — обязателен (изменил статус с P1-hardening):** deny-all + allow-list генерируется entrypoint'ом из OC_*_MODEL + OC_PROVIDERS_JSON. Подтверждено исходником opencode v2: `provider.use: deny` удаляет провайдера из каталога до npm.load — полная защита от установки пакетов И подмены маршрутизации.
- **Anti-redirect моделей + default_agent:** entrypoint инъектирует все `agents.*.model` через `OPENCODE_CONFIG_CONTENT` (serve-only, высший приоритет) + `default_agent` (по умолчанию `"build"`). Защита от двух векторов: (a) репо не может перенаправить модель на кастомный endpoint; (b) репо не может подменить default_agent на своего кастомного агента.
- **tool.use deny:** webfetch/websearch запрещены на system-слое — hard-floor поверх permissions. Перекрывает любые per-agent allow.
- **Не покрывает per-agent изоляцию** P4 (нет agent-scoping в policies). Изоляция trusted-агентов на уровне модели остаётся на конфиг-уровне (`agent.*.model`).
- **Placement:** `/etc/opencode/` (system-слой) — repo не переопределит. Для operator-кастомизации — bind-mount volume на `/etc/opencode/`.

---

## 3. Security considerations

### 2.15. Operator customization (без коммита в репо)

Для empty repo или при невозможности/нежелании коммитить `opencode.json`:

#### Custom provider

| Способ | Механика | Где |
|---|---|---|
| **Env (рекомендуется)** | `OC_PROVIDERS_JSON` → entrypoint injects в `OPENCODE_CONFIG_CONTENT` | `.env.docker`, CI env |
| **Bind-mount `.opencode/`** | `-v ~/cfg/.opencode:/workspace/<repo>/.opencode:ro` | Host-директория, gitignored |
| **Config volume + XDG** | `-v oc-conf:/oc-config -e XDG_CONFIG_HOME=/oc-config` | Named volume, seed from baked skeleton |

Для **режима B** (live-mount) — просто создать `~/dev/myapp/.opencode/opencode.json` на хосте, gitignore, и подмонтировать volume.

#### Custom plugin

Плагин = код в процессе сервера. **Любая декларация проходит через managed policy allowlist.**

| Способ | Действия оператора |
|---|---|
| **Rebuild (канон)** | Добавить `git clone` в Dockerfile + allowlist в `/etc/opencode` policies |
| **Volume override** | `-v ~/policies:/etc/opencode:ro` (policy-файл с allow) + `-v ~/plugins:/opt/plugins:ro` (код плагина) |
| **docker exec (test)** | Правка `/etc/opencode/opencode.json` + рестарт контейнера. Не переживает `docker rm` |

#### Operator customization summary

- **Провайдер:** любой слой. Ключи через `{env:}` (никогда plaintext). `OC_PROVIDERS_JSON` = быстрый способ без rebuild.
- **Плагин:** декларирование из любого слоя + **обязательный** allowlist в `/etc/opencode`. Расширение allowlist = осознанное действие оператора (как добавление sudo).
- **Permissions/policies:** только managed-слой. Config-слои не могут ослабить security baseline.

| Requirement | Реализация |
|---|---|
| **P1: Confidential deny** | **Нативные permissions OpenCode — основной барьер (6.4.0):** deny `read`/`edit`/`glob`/`grep` + per-agent allow для role-set (`custodian`/`sanitizer`). **Размещение:** permissions baseline в `/etc/opencode/opencode.json` (managed layer, highest file precedence — клонируемый репо не может ослабить). Плагин — shadow-audit (observability), не enforcement (new-режим). Legacy-режим (dual mode D5): пока секция `confidential` есть в `maestro.json` — legacy-enforcement плагином. |
| **P1: Trust model (6.4.0)** | Trusted = **role-set** `{custodian, sanitizer}` (hardcoded в плагине). Секция `trust` **удалена** из схемы `maestro.json` (6.4.0, B): любой ключ `trust.*` → warn `trust:deprecated_key` + игнор. Доверие по роли, не по конфигу. |
| **P2: Модели = атрибут имени** | `agent.*.model` в конфиге; runtime-проверка не требуется (P2) |
| **P3: Fail-closed** | нет подмены subagent_type/модели для trusted-агентов |
| **P4: Trusted agents** | изолированные модели (`{env:OC_CUSTODIAN_MODEL}`); @test-agents перед пайплайном |
| **P4-hygiene** | experimental.policies (optional): deny-all + allow-list провайдеров, global-beats-project |
| **P5: Plugin gate** | плагин обязателен для: Ур.1-sanitize (fail-closed), merge/commit-guard (P9), observability, memory. Файловая защита restricted-данных — нативные permissions (не зависит от плагина). |
| **P6: maestro_config sanctioned channel** | native permissions deny read/glob/grep/edit для maestro.json; global `deny` + ask только для primary (build, plan) — fail-closed по умолчанию; плагинный guard (по сессии) |
| **P9: merge-guard** | маркер в `<root>/.maestro/gates/` |
| **Plugin allowlist** | managed policies (`/etc/opencode`): deny `plugin:*` + allow для maestro-bootstrap и superpowers. Плагин = код в процессе сервера (не sandboxed), репо не может инжектить код |
| **Token hygiene** | tmpfs 600, не в image, не в .git/config |
| **Credential hygiene** | {env:} в env_file (0600), не в YAML/образе |
| **Confidential two paths** | `docs/confidential/**` — model-boundary, git-ok; `.confidential/**` — machine-boundary, gitignored, ro-bind в mode A |
| **Confidential gitignore-guard** | entrypoint check + optional bash-guard (по аналогии merge-guard) — задача в план |
| **Confidential shell-bypass (residual)** | untrusted-агенты с bash-allow (sonnet/haiku/reviewer) могут `cat .confidential/**` — permission-deny покрывает read/glob/grep/edit, но **не shell** (best-effort, как в host-dogfooding SEC-5). Митигация: non-root USER (через root-entrypoint drop) + `--cap-drop=ALL` ограничивают blast radius; полная защита — bash-эвристики. Не устраняется в MVP — принятый residual. |
| **Container hardening** | `--cap-drop=ALL`, `--security-opt no-new-privileges`, non-root USER (root-entrypoint→drop), `-p 127.0.0.1:4096:4096` (по умолчанию, не 0.0.0.0), healthcheck-скрипт (пароль не в `docker inspect`) — см. §5.9 |
| **Config-substitution residual (C3)** | `{env:}`/`{file:}`-подстановка в committed opencode.json репо: потенциально читает env-секреты и файлы процесса в обход read-permissions. Scope подстановки требует верификации на v2.0.32. Митигации (частичные): (a) API-ключи → credential-store, не env; (b) GIT_TOKEN → unset до старта сервера + fine-grained PAT; (c) OPENCODE_PASSWORD must stay in env — residual: если подстановка подтвердится, репо может вынести пароль через instructions URL. Пароль охраняет localhost API — принятый residual с документированным blast radius. |
| **Bash-env-access residual (I5, I6)** | Агенты с bash-allow (sonnet/haiku/reviewer) видят весь env процесса (команда `env`) и `/dev/shm/git-credentials`. Это обход read-permissions. Mitigations: (a) минимизировать секреты в env (credential-store вместо env); (b) fine-grained PAT для GIT_TOKEN (scope на одну репу, expiry 30 дней); (c) `unset GIT_TOKEN` до старта сервера (задача 12). Остаток: OPENCODE_PASSWORD в env (неизбежно) — blast radius ограничен localhost API. |
| **Formatter command (new)** | В opencode v2: `formatter.command` = произвольная shell-команда, исполняемая при форматировании файлов. Repo-контролируемая строка → potential code-exec при любом редактировании. Статус: требует верификации гейтинга (permissions? tool.use?). Если не гейтится — deny через permissions/allowlist; см. task 24. |
| **Container = sandbox boundary (I9)** | npm postinstall, make-задачи, репо-скрипты исполняются в контейнере как uid 1000 с cap-drop. Это осознанный design: контейнер = boundary для code-exec из репо. Полной изоляции нет — agent bash может вызвать любую команду (включая `npm install` на уже установленные пакеты). Митигация: egress-фильтр к registry.npmjs.org (task 25), deny plugin/MCP/provider (закрыто), pids_limit (task 25). |
| **Docker exec opencode run (M2)** | Команда `docker exec ... opencode run` обходит serve-only контракт `OPENCODE_CONFIG_CONTENT` (env-инъекция не действует в CLI-режиме). Зафиксировать в manual_docs как ограничение: в контейнере используйте только serve-режим, для отладки — `opencode debug` только если репо-конфиг доверен. |
| **Sensitive data** | opencode.db = raw-транскрипты (конфиденциальный класс); backup осознанно |
| **Memory masking** | generic-маскирование (технические секреты) до/после саммаризации; business-confidential НЕ маскируется (SEC-5, принятый риск, 6.4.0 D3) |

---

## 4. Open questions

1. **Prune opencode.db:** API-режим удаления старых сессий для долгоживущего сервера?
2. **Healthcheck endpoint:** `/api/info` (v2.0.32) подтверждён живьём. **Fallback:** TCP connect на port 4096 через bash `/dev/tcp` (в образе node:20-slim bash присутствует, скрипт healthcheck.sh использует `exec 3<>/dev/tcp/127.0.0.1/4096`).
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
2. **Token для git** (`GH_PAT`) — **fine-grained personal access token** с scope `contents: write` на целевую репо (и только на неё). **Обязательно**: expiry 30 дней, без org-admin scope. Для режима live-mount без git — не требуется.
3. **Model env-переменные** — `OC_BUILD_MODEL`, `OC_PLAN_MODEL`, `OC_CUSTODIAN_MODEL`, `OC_OPUS_MODEL`, `OC_SONNET_MODEL`, `OC_HAIKU_MODEL`, `OC_FABLE_MODEL`, `OC_REVIEWER_MODEL`.
4. **API-ключи провайдеров** — предпочтительно через `opencode auth import` (credential store), а не env-переменные. Если env — см. residual в §3 (config-substitution).
5. **Password** — `OPENCODE_PASSWORD` (для Basic auth сервера).
6. **Каталоги хоста:**
   ```bash
   # maestro-state: логи + memory backups (host-visible, Гейт 0)
   mkdir -p ~/maestro-state/<project> && chmod 700 ~/maestro-state/<project>
   # maestro-confidential: confidential данные (режим A)
   mkdir -p ~/maestro-confidential/<project> && chmod 700 ~/maestro-confidential/<project>
   ```

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
OPENCODE_PASSWORD=${OPENCODE_PASSWORD} opencode --server http://127.0.0.1:4096

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
PROJECT_NAME=myapp REPO_NAME=myapp docker compose up -d
```

**Важно:** `~` не раскрывается в docker-compose — используйте `${HOME}`. `version: "3.9"` — опционален (compose v2+ игнорирует). Healthcheck использует скрипт в образе (`/usr/local/bin/healthcheck.sh`), не интерполирует пароль → безопасен для `docker inspect`. `start_period: 120s` — полный clone может занять минуты. `PROJECT_PORT` — параметризация для N проектов.

### 5.6. Диагностика

| Проблема | Решение |
|---|---|
| Контейнер не стартует | `docker logs maestro-<project>` — entrypoint логирует этапы (clone, setup, serve) |
| `.confidential` пустой | Проверьте `~/maestro-confidential/<project>` на хосте; entrypoint логирует «empty mount point» |
| `git clone` падает | Проверьте `GH_PAT` scope; убедитесь что `REPO_URL` доступен с сервера (для режима A) |
| `opencode --server` не подключается | Проверьте `OPENCODE_PASSWORD` в окружении клиента; healthcheck: `curl -u opencode:$PW http://127.0.0.1:4096/api/info` |
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

**Non-root user (root-entrypoint → drop):** Dockerfile `USER root` (по умолчанию) → entrypoint chowns volumes → `gosu <UID>:<GID> opencode serve`. Non-root процесс запускает только opencode, не entrypoint.

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
| `--user UID:GID` | **Не используется.** Non-root через root-entrypoint (root chowns volumes → `gosu <UID>:<GID> opencode serve`). Можно указать как override для NFS-сценариев, где root-entrypoint не может chown. |
| `-p 127.0.0.1:4096:4096` | API торчит только на localhost — для удалённого доступа: SSH-туннель или TLS-прокси |

**Healthcheck-скрипт** (в образе, не интерполяция пароля):
```bash
#!/bin/sh
# /usr/local/bin/healthcheck.sh
# Читает пароль из env (не из compose interpolate → безопасен для docker inspect)
# Primary: HTTP check на /api/info; Fallback: TCP connect на port 4096
# (TCP fallback нужен когда /api/info endpoint изменился/недоступен в данной версии opencode)
if curl -sf -u "opencode:${OPENCODE_PASSWORD}" http://127.0.0.1:4096/api/info >/dev/null 2>&1; then
  exit 0
fi
# Fallback: TCP connect (bash из node:20-slim имеет /dev/tcp)
exec 3<>/dev/tcp/127.0.0.1/4096 2>/dev/null
exit $?
```
В compose: `test: ["CMD", "/usr/local/bin/healthcheck.sh"]`. В 5.3 healthcheck — `curl -sf -u "opencode:${OPENCODE_PASSWORD}"` — интерполирует в шелле клиента, безопасен (не в compose).

**Port-параметризация** (N проектов на одной машине):
```bash
-p ${PROJECT_PORT:-127.0.0.1:4096}:4096
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

### 5.10. Hello world (быстрый старт, 5 минут)

**Цель:** от нуля до первой задачи maestro за 5 минут. Один контейнер, одна модель, тривиальная задача.

```bash
# 1. .env.docker — один провайдер на все агенты (минимум для старта)
echo 'OPENCODE_PASSWORD="dev-password"
REPO_URL="https://github.com/you/hello-maestro.git"
GIT_TOKEN="github_pat_..."
OC_BUILD_MODEL="akash/zai-org/GLM-5.3"
OC_CUSTODIAN_MODEL="akash/zai-org/GLM-5.3"' > .env.docker
chmod 600 .env.docker

# 2. Запуск (все переменные — из .env.docker)
docker run -d --name maestro-hello   --env-file .env.docker   -v oc-ws-hello:/workspace   -v oc-data-hello:/data   -v oc-cache-hello:/cache   -p 127.0.0.1:4096:4096   maestro-opencode:6.x

# 3. Подключение TUI
OPENCODE_PASSWORD=dev-password opencode --server http://127.0.0.1:4096

# 4. Первая задача
> @maestro-init Добавить в README секцию «Contributing»
```

**Результат:** спека + план в `docs/superpowers/`, ветка в origin, логи в `~/maestro-state/hello/logs/`.

### 5.11. Полный цикл разработки фичи

Пример: фича «экспорт отчётов в PDF». Пайплайн maestro исполняется **внутри контейнера**; все HITL-ответы приходят через TUI-клиент.

#### Этап 0 — подготовка (однократно)

```bash
# .env.docker — разные модели для разных агентов
OPENCODE_PASSWORD="strong-pass"
REPO_URL="https://github.com/org/myapp.git"
GIT_TOKEN="github_pat_..."       # fine-grained, contents:write
OC_BUILD_MODEL="akash/zai-org/GLM-5.3"
OC_PLAN_MODEL="akash/zai-org/GLM-5.3"
OC_CUSTODIAN_MODEL="local/llama-3.1-8b"     # P4: изолированная модель для confidential Q/A
OC_SANITIZER_MODEL="akash/zai-org/GLM-5.3"
OC_OPUS_MODEL="anthropic/claude-sonnet-4"   # для ревью
OC_SONNET_MODEL="openai/gpt-4o-mini"        # для реализации
OC_HAIKU_MODEL="openai/gpt-4o-mini"
OC_FABLE_MODEL="akash/zai-org/GLM-5.3"
OC_REVIEWER_MODEL="openai/gpt-4o"
```

**Почему разные модели:** custodian Q/A идёт на локальной модели (P4 — confidential данные не покидают машину), opus/sonnet — на облачных (качество ревью и реализации). Ключи провайдеров — через `{env:}` в конфиге (не в env).

#### Этап 1 — подключение и запуск пайплайна

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
- **Рестарт контейнера** (`docker stop/start`): сессии и артефакты живут в `opencode.db` (/data) и `/workspace` — пайплайн продолжает с места остановки (сессии персистентны)
- **git push** использует tmpfs credential-store (токен в env уже невидим — unset после старта)
- **Логи Гейта 0** — host-visible (`~/maestro-state/<project>/logs/`), читается без `docker exec`

#### Этап 3 — результат

- Ветка `feature/pdf-export` запушена в origin
- Спека/план — в `docs/superpowers/` репо (committed)
- Логи пайплайна — JSONL в `~/maestro-state/<project>/logs/`
- `opencode.db` — персистентная БД (named volume, переживает `docker stop`)

### 5.12. Сценарии от простого к сложному

| # | Сценарий | Что добавляется к базовому | Где доки |
|---|---|---|---|
| 0 | **Hello world** | Одна модель, тривиальная задача | §5.10, `docker/README.md` |
| 1 | **Багфикс** | Полный пайплайн, один провайдер | §5.11 walkthrough |
| 2 | **Смешанные провайдеры** | `OC_CUSTODIAN_MODEL` → локальная (P4), opus/haiku → облачные | .env.docker пример в §5.11 |
| 3 | **Кастомный провайдер** | `OC_PROVIDERS_JSON` (корпоративный endpoint) + ключи через credential-store | §2.8.1, §2.15 |
| 4 | **Confidential-данные** | bind-mount `.confidential/`, custodian Q/A по секретам, dual-mode maestro.json | §2.5 |
| 5 | **Фича с MCP** | Оператор добавляет `allow mcp:<name>` + объявление сервера в `/etc/opencode` | `manual_docs/how-to/docker-mcp.md` |
| 6 | **Параллельная разработка** | Несколько контейнеров / worktrees | §5.13–5.14 |

**Сценарий 2 (смешанные провайдеры)** — самое частое реальное использование:
```bash
# Custodian на локальной модели (confidential-данные не покидают машину)
OC_CUSTODIAN_MODEL="local/llama-3.1-8b"
# Sanitizer на akash (техническая изоляция от основного аккаунта)
OC_SANITIZER_MODEL="akash/zai-org/GLM-5.3"
# Opus на anthropic (качество ревью)
OC_OPUS_MODEL="anthropic/claude-sonnet-4"
# Остальные — openai (стоимость/скорость)
OC_SONNET_MODEL="openai/gpt-4o-mini"
OC_HAIKU_MODEL="openai/gpt-4o-mini"
```

**Сценарий 3 (кастомный провайдер без коммита)** — корпоративный endpoint:
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

### 5.13. Параллельная разработка: разные репо

**Паттерн A: один контейнер на репо** (простой, полная изоляция)

Каждый проект — свой контейнер, свои volumes, свой порт.

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

`PROJECT_PORT` параметризован (§5.3) — для N проектов: каждый проект = отдельный порт.

**Ressource sharing:** модельный кэш — shared read-only volume (открытый вопрос §4.4). Для MVP каждый контейнер подгружает модели локально.

### 5.14. Параллельная разработка: одно репо (worktrees)

**Pаттерн B1: worktrees в ОДНОМ контейнере** (рекомендуется для MVP)

OpenCode нативно поддерживает worktrees (`worktree.directory: ./.worktrees` — уже в skeleton). Два сценария:

#### B1a: Одна TUI-сессия, несколько параллельных задач
```bash
# Сессия 1: @maestro-init → фича «тёмная тема» → создаёт ветку feat/dark
# Сессия 2: @maestro-init → багфикс «экспорт» → создаёт ветву feat/export
# Обе сессии — в одной TUI-сессии (переключение сессий)
```
Каждая сессия работает в своём worktree `.worktrees/<branch>/` — файлы не конфликтуют. Merge — последовательно через гейт 17.

Плюсы: один контейнер, одна модельная память, переключение сессий в TUI.
Минусы (зафиксировать): **confidential-асимметрия** (§2.5: `.confidential/` только в базовом дереве, не в worktree), один API-порт — HITL двух сессий в одном клиенте.

#### B1b: Несколько TUI-сессий к одному серверу
OpenCode поддерживает несколько клиентов к одному серверу (TUI + Web + API одновременно). Несколько разработчиков могут параллельно работать с одним контейнером — каждая сессия в своём worktree.

**Паттерн B2: контейнер на фичу** (полная изоляция, тяжёлый)

```bash
# Оба контейнера — Mode A, независимые клоны одного репо
docker run -d --name maestro-featx   -e GIT_BRANCH=feat/dark-theme   --env-file .env   ... -p 127.0.0.1:4097:4096 ... maestro-opencode:6.x

docker run -d --name maestro-featv   -e GIT_BRANCH=feat/pdf-export   --env-file .env   ... -p 127.0.0.1:4098:4096 ... maestro-opencode:6.x
```

**Env `GIT_BRANCH`** — entrypoint после клонирования делает `git checkout <branch>`. Два контейнера push'ят в один origin в разные ветки; merge — последовательно через независимый гейт 17 каждого.

Плюсы: полная изоляция (separate opencode.db, HITL-потоки), каждый контейнер — отдельный порт.
Минусы: N контейнеров = N * модельный кэш; heavier.

#### B3: host worktrees + live-mount

```bash
# на хосте (Mac/CI)
git -C ~/dev/myapp worktree add .worktrees/feat-x -b feat/x

# контейнер монтирует worktree
docker run -d -v ~/dev/myapp/.worktrees/feat-x:/workspace/myapp   -p 127.0.0.1:4097:4096 ... maestro-opencode:6.x
```

Хост-дерево остаётся в IDE, контейнер видит только worktree. Нюанс: `.confidential/` в базовом дереве — нужен отдельный bind-mount (та же асимметрия, что §2.5).

#### Сводная таблица выбора

| Паттерн | Изоляция | HITL-потоки | Ресурсы | Когда |
|---|---|---|---|---|
| A (репо → контейнер) | полная | раздельные (порты) | N контейнеров | разные проекты |
| B1a (worktrees, 1 контейнер) | сессии | общий TUI | 1 контейнер | один разработчик, связанные фичи |
| B1b (неск. TUI, 1 контейнер) | сессии | несколько клиентов | 1 контейнер | команда на одном проекте |
| B2 (клон → контейнер) | полная | раздельные | N контейнеров | параллельные разработчики / тяжёлые фичи |
| B3 (host worktrees) | контейнер/фича | раздельные | N контейнеров | Mac + IDE-центричная работа |

---

## 6. Implementation tasks (из review)

Эти задачи должны быть включены в plan-документ. Разбиты по приоритету:
- **P0 (MVP):** 1–8, 13 — без этих задач docker-режим не работает
- **P1 (hardening):** 9, 9b, 10–12 — безопасность, стабильность, доставка плагина, managed permissions
- **P2 (follow-up):** 14–31 — документация, тесты, улучшение DX

**Приоритеты в планах:** P0-задачи должны быть реализованы до merge. P1-задачи — в течение первого спринта после merge. P2-задачи — по мере возможности.

1. **[Плагин, P0]** `confidential.tracked_in_git` — check при bootstrap init (`git ls-files .confidential/`, одноразовый console.warn + инструкция `git rm -r --cached`).
2. **[maestro-setup, P0]** Двойной дефолт в `confidential.paths`: `docs/confidential/**` + `.confidential/**`.
3. **[maestro-setup, P0]** Добавление `.confidential/` в `.gitignore` (если ещё нет).
4. **[Entry-point, P0]** Gitignore-guard для `.confidential/` — проверка `git ls-files .confidential/` + `git check-ignore .confidential/` при clone → warn/error если есть tracked файлы.
5. **[Plugin, P1]** Document worktree confidential asymmetry (П-2) — warning в logs при работе из worktree с отсутствующим `.confidential/`.
6. **[Docs, P2]** `manual_docs/how-to/docker-serve.md` — расширенная версия секции 5 How to, с примерами для Mac/Linux/VM.
7. **[Docs, P2]** Update `reference/config.md` и `reference/memory.md` (изменения `/maestro-setup` и memory `cache_dir`).
8. **[Tests, P2]** Smoke-тесты docker-режима A и B через `maestro-sandbox.sh --docker` + `npm test` coverage для новых функций плагина.
9. **[Dockerfile, P1]** Root-entrypoint (USER root, НЕ opencode) → chown volumes → `gosu <UID>:<GID> opencode serve`. Добавить `gosu` в base image (apt: `gosu`; `su-exec` — только для Alpine, здесь Debian).
9b. **[Dockerfile, P1]** Wholesale delivery maestro skills/commands/agents/plugins в образ (clone maestro-repo → `maestro-install.sh --deploy --skip-config`; или явный COPY с `--pin <sha>`). Без этого пайплайн в контейнере невозможен — Гейт 0 и P5 не работают. Также создать `docker/user-opencode.json` — global skeleton для `~/.config/opencode/` (содержит `plugins`, `agents`, `autoupdate`, `worktree` — но **НЕ** `permissions`).
10. **[Entrypoint, P1]** `healthcheck.sh` скрипт (чтение OPENCODE_PASSWORD из env, не compose interpolation, с primary HTTP check + fallback TCP connect) — добавить в образ.
11. **[Entrypoint, P1]** Log retention: archive old logs → tar.gz в `/maestro/logs/archive/`, cleanup файлов старше N дней (default 30), но **не** текущего дня. Audit log (`maestro-audit-<date>.log`) — отдельный, более долгий retention (default 90).
12. **[Entrypoint, P1]** `unset GIT_TOKEN` после записи в tmpfs credential-store (убрать из env процесса).
13. **[Compose, P0]** `start_period: 120s` (полный клон может занять минуты на больших репо).
14. **[How-to, P2]** Сценарий удалённого доступа (SSH-туннель / TLS-прокси) — раздел в How-to.
15. **[How-to, P2]** Сценарий первого запуска (сборка образа) — добавить в 5.1 prerequisites.
16. **[How-to, P2]** Warning: `compose down -v` удаляет volumes (в 5.5).
17. **[Dockerfile, P1]** Создать `docker/etc-opencode.json` — security baseline для `/etc/opencode/` (managed layer). Содержит `permissions` + `policies` (plugin allowlist: deny plugin:* + allow для maestro-bootstrap и superpowers). Никаких `agents`, `providers`, `instructions` — это зона безопасности. Добавить COPY в Dockerfile stage 1.
18. **[Dockerfile, P1]** Добавить managed policies в `/etc/opencode/opencode.json`: `deny plugin:*` + allow `maestro-bootstrap` (абсолютный путь `/opt/maestro/plugins/...`) + allow `superpowers` (абсолютный путь `/opt/superpowers`). Plugin-allowlist — обязательный security-фикс (плагин = код в процессе сервера, не sandboxed).
19. **[Dockerfile, P1]** Bake superpowers plugin в образ (clone https-only, pinned commit, env `SUPERPOWERS_SHA`). Добавить `plugin:/opt/superpowers` в global skeleton `plugins` array.
20. **[Tests, P1]** Verification: (a) `plugin:<path>` матчинг для абсолютных путей; (b) core-плагины (Console, policy) не ломаются от `deny plugin:*`; (c) OPENCODE_CONFIG_CONTENT anti-redirect: репо-конфиг не может перенаправить `agents.*.model` на кастомный endpoint.
21. **[Entrypoint, P1]** Расширить контракт `OPENCODE_CONFIG_CONTENT`: добавить поддержку `OC_PROVIDERS_JSON` (ввод — JSON-строка env, вывод — `providers` секция вInjected JSON). Запретная зона: `permissions`, `policies`, `plugins`, `instructions` — эти поля НЕ инъектируются.
22. **[Entrypoint, P1]** Добавить `-e .opencode` в `git clean` fallback (секция 2.2a) — protect bind-mount точку от удаления. Добавить инструкцию в §5.1 prereqs: создание `~/maestro-config/<project>/.opencode/` для bind-mount provider-конфига.
23. **[Tests, P1]** Verification: (a) `XDG_CONFIG_HOME` уважается opencode server на Linux; (b) `plugin:<absolute path>` матчинг в policy deny (после добавления кастомного плагина в allowlist); (c) seed-логика: config-volume пуста при первом запуске → entrypoint копирует baked skeleton; (d) `git clean -fd -e .opencode` не удаляет mount-точку.
24. **[Dockerfile, P1]** Добавить `git config --global core.hooksPath /var/empty` в entrypoint (создать пустой каталог в образе) — закрывает git hooks code-exec вектор. Добавить `--pids-limit` в compose (fork-bomb защита).
25. **[Dockerfile, P1]** Пин SUPERPOWERS_SHA на конкретный SHA (константа, не HEAD). Починить maestro-install pin (MAESTRO_SHA build-arg + assert, падать без валидного пина). Исправить `"autoupdate": false` → `"update": "disable"` (verифицировать формат v2.0.32). Добавить `experimental.subagent_depth` → `subagent_depth` (verифицировать).
26. **[Entryoint, P1]** Генерация provider-allowlist: парсинг OC_*_MODEL + OC_PROVIDERS_JSON → set of provider IDs → write allow entries to /etc/opencode/opencode.json (до drop-privileges, root-write). Inject `OPENCODE_DEFAULT_AGENT` (default: `"build"`) into OPENCODE_CONFIG_CONTENT.
27. **[manual_docs, P2]** Создать `manual_docs/how-to/docker-mcp.md` — how-to подключения MCP-сервера: (a) когда нужен/не нужен; (b) declaration + allow в managed-слое; (c) name-hijack защита; (d) HTTP/SSE vs stdio; (e) debug-чек-лист.
28. **[manual_docs, P2]** Добавить раздел residual-документации для docker-serve: (a) config-substitution scope и операторские требования; (b) bash-env-access и PAT-требование; (c) container-sandbox principle; (d) `docker exec opencode run` обход serve-only контракта.
29. **[manual_docs, P2]** Создать `docker/README.md` — hello world quick start (4 шага: env → docker run → connect → @maestro-init).
30. **[Spec, P2]** Добавить §5.10–5.14 в спеку: hello world, dev cycle walkthrough, scenarios ladder, parallel development (different repos + worktrees), GIT_BRANCH env.
31. **[Entryoint, P2]** Поддержка `GIT_BRANCH` env: после клонирования — `git checkout <branch>`; документировать в §2.2 и §5.14.
