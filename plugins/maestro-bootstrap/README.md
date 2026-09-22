# maestro-bootstrap

Плагин для OpenCode: **глобальная observability + санитайзинг промптов**
(не привязан к агенту). Скилл `maestro` вызывается через
команду `/maestro-init` в любой primary-сессии; инжекция директивы в сессии агента
удалена (уход от агента, 2026-08-18).

## Что делает

- **Санитайзинг промптов `task`** (Уровень 1 Security Review): маскирует
  чувствительные данные (env-secrets, поля данных, `.env`, DB/SFTP credentials,
  ledger) ДО отправки промпта в сабагента. Авто, без HITL. **Trusted сабагенты
  (maestro.json → `trust`) — skip** (получают промпт как есть).
- Логирует вызовы `task`-тула (диспатч субагентов) — observability.
- Логирует ошибки/повторы сессий (`session.error`, `session.status.retry`).
- Детектит пустой результат субагента (`tool.execute.after.empty_result`).
- **Версия плагина**: пишет `.maestro/plugin-version` (фактическая версия
  загруженного плагина, semver-only). Конфиг `maestro.json` версию не хранит;
  `/maestro-version` показывает её без сравнения с ожидаемой. Та же версия
  дублируется в init-строке bootstrap-лога (`plugin initialized`, поле `version`);
  Гейт 0 (SKILL.md) сравнивает её с версией из кэша плагина — warn при
  рассинхроне (не STOP).

Плагин **глобальный** — не фильтрует по агенту, работает во всех сессиях.

Хуки `chat.message` / `experimental.chat.system.transform` регистрируются всегда
(communication-модуль; до 4.6.0 — только при `memory.enabled` + `auto_recall`).
`experimental.chat.messages.transform` никогда не присваивается (инвариант).

## Санитайзинг промптов (sanitize)

Правила детекта — Context Sanitizer (см. `skills/maestro/SKILL.md`):

1. **Secrets из окружения** — имена (case-insensitive: `API_KEY`, `apiKey`,
   `api_key`) с keywords `SECRET`, `KEY`, `TOKEN`, `PASSWORD`, `CREDENTIAL`,
   `PASS`, `AUTH`, `DSN`, `CERT`, `SALT`, `SIGNATURE`, `NONCE` и их значения →
   `<redacted>`. Покрывает однословные (`TOKEN=`, `KEY=`, `SECRET=`) и
   colon-стиль (`password: x`, `API_KEY: x`) (SEC-1/SEC-1b).
2. **Чувствительные поля данных** — расширенный список (финансовые: `amount`,
   `salary`, `iban`, `card_number`, `cvv`, `vat`, `total_amount` и т.д.; PII:
   `phone`, `email`, `inn`, `snils`, `passport` и т.д.; credentials:
   `client_secret`, `api_key`, `secret_key`, `password`, `secret` и т.д.) →
   `<redacted>`. Детект регистронезависим; `\w*`-суффиксы (`amountValue`,
   `amount_value`) и camelCase-варианты snake-полей (`cardNumber`) покрываются
   автоматически. Ловит JSON-ключи `"password": "x"` (SEC-1b).
3. **Файлы .env / .env.\*** → `<redacted>`.
4. **SFTP/DB credentials** — URI-схемы (`postgres://`, `mysql://`, `ssh://`,
   `ldap://`, `clickhouse://`, `http://`, `https://` и др., регистронезависимо) с
   встроенными credentials (в т.ч. анонимный user `postgres://:pass@host`, SEC-1b),
   а также connection-string params `password=...`, `pwd=...` → `<redacted>`.
5. **Private keys** — PEM-блоки `-----BEGIN ... PRIVATE KEY-----`
   (регистронезависимо) → `<redacted>`.
6. **Auth headers** — `Authorization: Bearer ...`, `X-API-Key: ...` →
   `<redacted>`; также standalone JWT (`header.payload.signature`) вне заголовка
   (SEC-1b).
7. **Raw ledger entries** — покрываются rule `data_field` (те же поля).

Whitelist — секция `sanitizer_whitelist` в `maestro.json` (см. ниже).

```json
{
  "rules": { "env_secret": true, "data_field": true, "env_file": true, "db_credential": true, "ledger_entry": true, "private_key": true, "auth_header": true },
  "by_agent": { "code-reviewer": [] },
  "patterns": [],
  "extra_fields": ["my_custom_field"],
  "extra_uri_schemes": ["custom-proto"]
}
```

- `rules` — включение/выключение категорий детекта.
- `by_agent` — отключение категорий для конкретных сабагентов.
- `patterns` — конкретные значения, которые НЕ считаются sensitive (whitelist).
- `extra_fields` — дополнительные чувствительные поля данных (проект-специфичные),
  добавляются к дефолтному списку.
- `extra_uri_schemes` — дополнительные URI-схемы для credentials-детекта.

### Секция `confidential`

Закрывает конфиденциальные пути (дефолт `docs/confidential/**`) для `read`/
`write`/`edit` от всех, кроме trusted-субагентов. Primary и untrusted — жёсткий
deny; trusted читает по умолчанию (`trusted.read: allow`), пишет по явному
`trusted.write`/`trusted.edit: allow`.
Идентичность отправителя определяется через `client.session.get` +
`session.messages` (детект по `parentID` и имени агента). Подробнее —
`manual_docs/reference/config.md`.

`confidential.paths` принимает папки, отдельные файлы по полному имени и по
маске, включая корневую папку. Сегментная семантика: `**` = 0+ сегментов
(покрывает корень), `*`/`?` — в пределах одного сегмента (не через `/`), маска
без `/` (напр. `*.env`) закрывает только корневые файлы. В отличие от общего
glob-матчинга (где `*` пересекает `/`), в `confidential` маска сегментная.

### Built-in confidential (OQ-3, `BUILTIN_CONFIDENTIAL_PATTERNS`)

Помимо `confidential.paths`, плагин применяет **built-in набор** по умолчанию,
независимо от наличия/содержимого секции `confidential` в `maestro.json`:
`.env`, `.env.*`, `*.pem`, `*.key`, `*.crt`, `*.p12`, `*.pfx`. Это служебные
файлы секретов (`.env`) и приватные ключи — для `read`/`write`/`edit` они
**всегда deny** для primary и non-trusted (тот же confidential-контур). Маски
без `/` закрывают только корневые файлы.

`confidential.paths` **расширяет**, а не заменяет built-in набор: пользовательские
пути добавляются к `.env`/ключам, не отменяя их.

## Аудит-лог

Security-фактура по доступу пишется в **отдельный аудит-лог**
`.maestro/logs/maestro-audit-<date>.log` (JSONL, один файл на день):

- `confidential.access` — доступ к confidential-путям: `action: "allow"` (trusted-
  субагент читал/писал, уровень `info`) или `action: "deny"` (блокировка для
  untrusted/primary, уровень `warn`). Включает `agent` (имя trusted-агента) и
  `target` (только `basename`, SEC-5).
Структура записи (JSON):

```json
{"ts":"<ISO>","level":"info|warn","msg":"confidential.access","sessionID":"...","callID":"...","tool":"read|write|edit","action":"allow|deny","agent":"<trusted-агент>|null","target":"<basename>"}
```

**Security-события живут ТОЛЬКО в аудит-логе** — bootstrap-лог их не дублирует
(bootstrap-лог — observability: `sanitizer.redacted`, task, session.error и т.п.).

**Аудит-лог пишется всегда** и **не зависит** от `MAESTRO_BOOTSTRAP_LOG_MASK`/
`MAESTRO_BOOTSTRAP_LOG_LEVEL`. Каталог задаётся `MAESTRO_AUDIT_LOG_DIR`
(по умолчанию `<project>/.maestro/logs`). Сбой записи аудита логируется в
`console.error` (не ломая сессию).

Канон конфига `maestro.json` и правила вывода секций — в скилле `maestro-assistant`
(`skills/maestro-assistant/SKILL.md`).

## Конфигурация: maestro.json

Единый файл конфигурации в корне проекта (`maestro.json`). Коммитится в git
(project policy). Содержит три секции:

```json
{
  "trust": {
    "custodian": true,
    "sanitizer": true
  },
  "sanitizer_whitelist": {
    "rules": { "env_secret": true, "data_field": true, ... },
    "by_agent": { "code-reviewer": [] },
    "patterns": [],
    "extra_fields": [],
    "extra_uri_schemes": []
  }
}
```

- **`trust`** — trusted-агенты (`true` = trusted). Остальные — untrusted.
- **`sanitizer_whitelist`** — правила sanitizer (см. раздел выше).
- **`communication`** — режим «простой язык» для HITL-диалога: `"plain"`
  (дефолт, ключ можно не указывать) | `"professional"` (упрощение выключено).
  Невалидное значение → soft fallback в `plain` + warn `communication:config_fallback`
  в лог плагина. Хуки: `chat.message` (детект `--plain` в `@maestro-init`) и
  `experimental.chat.system.transform` (инъекция короткой директивы только в
  top-level primary-сессии; guard: parentID + title-префикс `[maestro-memory]`).
  Лог-события: `communication:flag_plain` (info), `communication:config_fallback`
  (warn), `communication:directive_injected` (debug).

### Разрешение конфигов (resolution order)

`maestro.json` — **единственный** источник конфигурации. Все секции
(`trust`, `confidential`, `sanitizer_whitelist`) читаются из него одним
загрузчиком `loadMaestroConfig()`.

Порядок разрешения пути к файлу:

1. **Env override** — `MAESTRO_CONFIG` (путь к `maestro.json`).
2. **По умолчанию** — `<project>/maestro.json`.

Старые файлы `trust-config.json`, `.maestro/sanitizer-whitelist.json` **не поддерживаются** (не читаются).

Если `maestro.json` отсутствует — плагин работает (fail-open): все агенты
untrusted, дефолтные sanitizer-правила.

## Memory layer (опционально)

Векторная память сессий: авто-саммаризация завершённых сессий, семантический
поиск (`memory_search`) и авто-вспоминание релевантного контекста в новых
сессиях. **Опциональный модуль** — не входит в стандартную установку; включается
секцией `memory` в `maestro.json` (`enabled: true`). Нет секции / `false` →
полностью off: хуки не регистрируются, зависимости не загружаются, LLM-вызовов
нет (zero-dep default сохраняется — импорт `memory/index.js` происходит только
при `enabled: true`).

```json
{
  "memory": {
    "enabled": true,
    "auto_recall": true,
    "embedding_model": "Xenova/paraphrase-multilingual-MiniLM-L12-v2",
    "identity": null,
    "identity_env": null,
    "namespace": "microservices.sales.pay",
    "module_dir": null,
    "idle_debounce_min": 10,
    "min_new_messages": 3,
    "backfill_window_days": 30,
    "backfill_max_per_start": 5,
    "retry_interval_min": 60,
    "top_k": 3,
    "min_score": 0.35,
    "similarity_threshold": 0.7,
    "retention_days": null,
    "summarize_timeout_ms": 120000,
    "report": { "include_text": false, "preview": true },
    "branch_context": true,
    "mainline": null,
    "embedding": {
      "provider": "local",
      "model": null,
      "base_url": "https://api.openai.com/v1",
      "api_key_env": null,
      "dim": null
    },
    "probe_cooldown_min": 30,
    "storage": {
      "type": "sqlite",
      "qdrant": { "url": "https://qdrant.internal:6333", "api_key_env": "MAESTRO_MEMORY_QDRANT_KEY", "collection": "maestro_memory" },
      "pgvector": { "connection_string_env": "MAESTRO_MEMORY_PG_DSN", "table": "maestro_memory" }
    }
  }
}
```

- **Бэкенды:** `sqlite` (default, локальный, per-key
  `<data-dir>/maestro/memory/<hash>/memory.db`) | `qdrant` (централизованный,
  `url` + `api_key_env`) | `pgvector` (`connection_string_env`). Централизованные
  требуют резолвнутую identity (`identity` → `identity_env` → git `user.name`).
  Решение «локально vs удалённо» — только `storage.type`.
- **Branch-aware (v3):** идентичность записи (критерий матчинга/промоции) — по
  коммиту (`head`); ключ хранения — `session_id`; имя ветки — только display;
  recall по умолчанию commit-scoped (`scope: "branch"`), тиры
  general/experience/не в контексте/unattributed; промоция на init по
  `is-ancestor(head, mainline)` (key-scoped); mainline авто-детект
  (`memory.mainline` override → remote HEAD → `init.defaultBranch` → резерв
  `main`/`master`/`develop`); `branch_context: false` → flat project recall.
- **Branch-governed lifecycle (v5):** жизненный цикл записей — по git-якорю
  (head/ветка), а не opencode-сессии. `session.deleted` **сохраняет** запись по
  умолчанию (флаг `delete_on_session_delete`, default `false`; рекомендуется
  только для sqlite — на централизованных бэкендах удаляет командное знание).
  Write-gate по `head`: сессии без git-якоря не суммаризируются (non-git проекты
  не получают память; warn при init; существующие записи читаемы). Новое поле
  записи `host` (hostname — «где лежит полный контекст»). HITL-команда
  `/maestro-memory-prune` (листинг категорий надёжности git-якоря →
  подтверждение → удаление; host-guard на централизованных бэкендах).
- **Namespace-identity (v5.1):** `memory.namespace` **обязателен** (формат
  `microservices.sales.pay`, 1–3 сегмента, lowercase; нормализация trim+lowercase;
  отсутствует → disabled `namespace_missing`). Домены: авто-related родитель +
  братья namespace (merged-only; off-switch `memory.domain_recall: false`).
  `related` — кросс-доменные namespace-префиксы (merged-only, ≤16, 1:1 leaf
  предпочтение). `memory_migrate` — пере-keying (from: auto|namespace|hash,
  max-version-wins на sqlite, `delete_source`). Поля записей
  `origin_remote`/`prefixes`. Адресация — namespace-only (URL/hash убраны).
- **`retention_days`:** `null` (default) — выключено; число — TTL записей
  (prune при старте, лог количества удалённых).
- **`similarity_threshold`:** порог cosine для кластеров/графа в
  `memory_stats_detail` (default `0.7`).
- **`embedding` (внешний embedder, opt-in):** `provider: "openai"` — внешний
  OpenAI-совместимый `/embeddings` API (`model`/`base_url`/`api_key_env`/`dim`
  обязательны для `openai`; `dim` — нативная размерность, без Matryoshka;
  ключ — только через `api_key_env`). `embedding_model` — legacy-алиас для
  `embedding.model` (только при `provider: local`). `probe_cooldown_min`
  (default `30`) — интервал между live-probe на старте; hard-fail → память off,
  soft-fail → fail-soft; on-demand — `memory_probe`.
- **`report.include_text`:** `false` (default) — HTML-отчёт только агрегаты
  (SEC-4b); `true` — осознанный opt-in на маскированные тексты.
- **`report.preview`:** `true` (default) — `@maestro-memory-report` сам запускает
  локальный preview-сервер (bind `127.0.0.1`, TTL 60 мин); `false` — только HTML-файл.
- **Хуки:** `tool` (`memory_search`, `memory_forget`, `memory_export`,
  `memory_import`, `memory_recall_preview`, `memory_stats_detail`,
  `memory_prune`), `chat.message`,
  `experimental.chat.system.transform`, `event` (`session.idle`/`session.deleted`),
  расширенный `dispose`. Инвариант: `experimental.chat.messages.transform` НЕ
  присваивается. **Адаптер вынесен в core.js — `createBootstrapAdapter(factory)`**
  (named export; мемо успешного init + retry после сбоя + fail-soft каркас +
  spread всех хуков). `index.js` — тонкий, только default export. Адаптер обязан
  пробрасывать ВСЕ хуки, которые собирает `MaestroBootstrapPlugin` (core.js) —
  не только `config`/`event`/`start`/`dispose`, но и `tool`,
  `tool.execute.before`/`after`, `chat.message`, `experimental.*`. Иначе
  memory-инструменты и защитные хуки недоступны в сессиях.
- **Гибридный поиск (все бэкенды, v3a):** векторный KNN + лексические совпадения
  (title+summary+decisions), слияние RRF (k=60); sqlite — FTS5, pgvector —
  `tsvector`+`ts_rank`, qdrant — payload full-text (filter-leg); backfill при init,
  sync при всех путях записи/удаления; ошибка лексической ветки → fallback
  vector-only + лог.
- **Фильтры `memory_search`:** `date_from`/`date_to` (time_last), `author`,
  `project` (кросс-проектный opt-in, **все бэкенды**; sqlite — read-only соседняя
  БД с fail-soft, qdrant/pg — key-filter).
- **Permission (обязательное правило):** `memory_forget`/`memory_export`/
  `memory_import`/`memory_prune`/`memory_migrate` — write/boundary-tools; в
  merge-config пишется
  `permission: { memory_forget: "ask", memory_export: "ask", memory_import: "ask",
  memory_prune: "ask", memory_migrate: "ask" }`.
- **Self-provisioning:** при `enabled: true` плагин создаёт `module_dir`
  (`<data-dir>/maestro/memory/module/`), пишет `package.json` (single-writer,
  `"type": "module"`) и копирует исходники модуля; пользователь выполняет
  `npm install` в `module_dir`. Код обновляется в lockstep с плагином;
  `node_modules` и данные переживают `maestro-update.sh`.
- **Данные:** `<data-dir>/maestro/memory/` — per-key БД, `state.json`
  (retry/skip/first-run), кэш модели эмбеддингов, экспорт `memory_export`
  (`export-<key16hex>-<ts>.jsonl`). Вне git.
- **Установка:** `maestro-install.sh` — опциональный шаг (y/N) ставит маркер
  `<data-dir>/maestro/memory/enabled.flag` + preflight npm/bun (зависимости
  ставит плагин, не install.sh).

Полный справочник — `manual_docs/reference/memory.md`; включение —
`manual_docs/how-to/enable-memory.md`.

## Логирование

Плагин пишет JSONL-лог в `.maestro/logs/` (каталог создаётся автоматически).
Весь `.maestro/` добавляется в `.gitignore` (только эфемерное: sdd/, last-run.md,
logs/, feedback-reports/, plugin-version); конфиг проекта — `maestro.json` в корне.
Логи **разбиваются по дням** — один файл на дату:

```
.maestro/logs/maestro-bootstrap-2026-08-01.log   # observability
.maestro/logs/maestro-bootstrap-2026-08-02.log
.maestro/logs/maestro-audit-2026-08-01.log       # security-фактура
.maestro/logs/maestro-audit-2026-08-02.log
.maestro/logs/maestro-memory-2026-09-08.log      # аудит-лог memory layer (при memory.enabled)
```

Формат строки (bootstrap-лог):

```json
{"ts":"<ISO>","level":"info|debug|warn|error","msg":"...", "sessionID":"...", "callID":"..."}
```

Что логируется:

- `plugin initialized` — загрузка плагина (info; поле `version` — фактическая
  версия, та же, что в `.maestro/plugin-version`; Гейт 0 сравнивает её с версией
  из кэша плагина — warn при рассинхроне)
- `tool.execute.before` — вызов `task`-тула (info)
- `tool.execute.after` — завершение `task` + `durationMs` (info)
- `tool.execute.after.empty_result` — субагент вернул пустой результат (warn)
- `session.error` — ошибка/прерывание модели (warn)
- `session.status.retry` — перезапрос модели (warn)
- `sanitizer.redacted` — замаскировано N чувствительных элементов в промпте task (warn)
- `communication:flag_plain` — детект `--plain`-флага в `@maestro-init` (info)
- `communication:config_fallback` — невалидное значение `communication`, fallback в `plain` (warn)
- `communication:directive_injected` — директива простого языка инжектирована в system (debug)

Memory layer (при `memory.enabled: true`):

- `memory: disabled` — память выключена (info, с `reason`: `storage_type_invalid`,
  `centralized_identity_missing`, `qdrant_config_invalid`, `pgvector_config_invalid`,
  `pgvector_text_search_config_invalid`, `branch_context_invalid`, `mainline_invalid`,
  `retention_days_invalid`, `similarity_threshold_invalid`, `embedding_invalid`,
  `probe_cooldown_min_invalid`, `embedding_api_key_env_missing`,
  `embedder_probe_hard_fail`)
- `memory:mainline_unresolved` — branch-context flat (нет резолвнутого mainline) (warn)
- `memory: init failed` — ошибка инициализации (error; сессии работают)
- `memory:index_error` — ошибка индексации сессии (error, с `sessionID` + `error_class` enum)
- `memory:retention_pruned` — retention удалил записи при старте (info, с `count` + `older_than_days`)

> **Смешанный список:** `memory: disabled` и `memory: init failed` — carve-out,
> пишутся в **bootstrap-лог** (видимость HITL-гейта «плагин работает»); остальные
> события memory-модуля — в отдельный аудит-лог (ниже). «`memory: transformers
> not installed — run npm install in <module_dir>`» — это **текст брошенного
> `Error.message`** (init/embed), а не строка лога; в аудит-лог попадает только
> `error_class` enum.

Операции memory-модуля (lifecycle/root-cause/производительность) пишутся в
**отдельный аудит-лог** `.maestro/logs/maestro-memory-<дата>.log` (JSONL;
aggregates-only field whitelist, SEC-4b+). Уровень/маска/каталог —
`MAESTRO_MEMORY_LOG_LEVEL` (default `info`)/`MAESTRO_MEMORY_LOG_MASK`/
`MAESTRO_MEMORY_LOG_DIR`. Полный список событий — `manual_docs/reference/memory.md`.

Security-события доступа (`confidential.access`) в
bootstrap-лог **не пишутся** — они только в аудит-логе (см. раздел «Аудит-лог»).

Детальное логирование `bash`/`skill`/`read` убрано (сокращение observability).

Настройки через переменные окружения:

| Переменная | Значение | По умолчанию |
|---|---|---|
| `MAESTRO_BOOTSTRAP_LOG_LEVEL` | `debug` \| `info` \| `warn` \| `error` | `info` |
| `MAESTRO_BOOTSTRAP_LOG_MASK` | список включённых уровней через запятую | выводится из `LOG_LEVEL` |
| `MAESTRO_BOOTSTRAP_LOG_DIR` | каталог для лог-файлов (по умолчанию `<project>/.maestro/logs`) | `<project>/.maestro/logs` |
| `MAESTRO_AUDIT_LOG_DIR` | каталог для аудит-лога `maestro-audit-*.log` | `<project>/.maestro/logs` |
| `MAESTRO_MEMORY_LOG_LEVEL` | порог детализации аудит-лога memory layer (`maestro-memory-*.log`) | `info` |
| `MAESTRO_MEMORY_LOG_MASK` | список включённых уровней через запятую (memory-лог) | выводится из `LOG_LEVEL` |
| `MAESTRO_MEMORY_LOG_DIR` | каталог для аудит-лога memory layer | каталог bootstrap-лога |
| `MAESTRO_CONFIG` | путь к maestro.json (консолидированный конфиг) | `<project>/maestro.json` |
| `MAESTRO_MEMORY_IDENTITY` | identity для подписи записей памяти (через `memory.identity_env`) | — |
| `MAESTRO_MEMORY_QDRANT_KEY` | API-ключ Qdrant (через `memory.storage.qdrant.api_key_env`) | — |
| `MAESTRO_MEMORY_PG_DSN` | DSN Postgres для pgvector (через `memory.storage.pgvector.connection_string_env`) | — |

`MAESTRO_BOOTSTRAP_LOG_LEVEL` — порог детализации (пишутся уровни `>=`
заданного). `MAESTRO_BOOTSTRAP_LOG_MASK` — явный список включённых уровней;
позволяет включать/выключать каждый тип **независимо**. Запись пишется при
**пересечении** двух условий: уровень входит в маску **и** не ниже порога.
Эти настройки применяются **только** к bootstrap-логу. **Аудит-лог от них не
зависит** — он пишется всегда.

Если `MAESTRO_BOOTSTRAP_LOG_MASK` не задан — он выводится из порога: маска =
все уровни `>= MAESTRO_BOOTSTRAP_LOG_LEVEL`. Поэтому поведение порога
полностью сохраняется (обратная совместимость): `MAESTRO_BOOTSTRAP_LOG_LEVEL=debug`
даёт debug-логи, `=info` — info и выше.

Примеры:

- Выключить только `info`, оставив остальные:
  `MAESTRO_BOOTSTRAP_LOG_MASK=debug,warn,error`
- Выключить логирование полностью (в маске ни одного валидного уровня):
  `MAESTRO_BOOTSTRAP_LOG_MASK=off` (или пустое значение).

Пример чтения свежего лога:

```bash
tail -f .maestro/logs/maestro-bootstrap-$(date +%F).log | jq -r ...'
```

## Тесты

Тесты плагина запускаются встроенным runner-ом Node из **корня репозитория**
(единственный `package.json` — корневой):

```bash
node --test plugins/maestro-bootstrap/index.test.js
```

или:

```bash
npm test
```

## Установка

### Из git-репозитория (рекомендуется)

Плагин поставляется из git-репозитория `wad-jet/maestro` (публикация в npm не используется).
Добавьте spec в `~/.config/opencode/opencode.json` (рекомендуется) или
`.opencode/opencode.json` (корневой `opencode.json` не используется):

```json
{
  "plugin": [
    "maestro-bootstrap@git+https://github.com/wad-jet/maestro.git"
  ]
}
```

OpenCode установит плагин автоматически (Bun) при старте, клонируя репозиторий и
загружая entry из корневого `package.json` (`main` → `plugins/maestro-bootstrap/index.js`).

При необходимости можно зафиксировать конкретный коммит через fragment:

```json
{
  "plugin": [
    "maestro-bootstrap@git+https://github.com/wad-jet/maestro.git#<commit-sha>"
  ]
}
```

### Локально (из исходников)

Если плагин лежит в репозитории (например, клонирован), можно указать локальный путь:

```json
{
  "plugin": [
    "../plugins/maestro-bootstrap/index.js"
  ]
}
```

> **Silent fail.** Относительный путь плагина резолвится **от каталога конфига**
> (`.opencode/` для проектного, `~/.config/opencode/` для глобального), не от корня:
> `./plugins/...` → `.opencode/plugins/...` (нет такого пути) — плагин молча
> не загрузится. Используйте `../plugins/...` (для проектного конфига) или
> абсолютный `file:///…`. Признак незагруженного плагина — отсутствие свежего
> `.maestro/logs/maestro-bootstrap-<дата>.log` с записью `plugin initialized`.

В обоих случаях перезапустите opencode, чтобы плагин подхватился.

## Требования

- OpenCode с поддержкой hooks `tool.execute.before/after`, `event`.
- Плагин грузится как ESM — корневой `package.json` репозитория задаёт
  `"type": "module"` (плагин ставится из git через `main` → `plugins/maestro-bootstrap/index.js`).