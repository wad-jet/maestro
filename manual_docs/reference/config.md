# Конфигурация

[Назад к оглавлению](../index.md)

## 🎯 Назначение

Полный справочник форматов `maestro.json`, `.opencode/opencode.json` (maestro-часть;
или глобальный конфиг) и переменных окружения, которые управляют поведением скилла
`maestro` и плагина `maestro-bootstrap`.

## 📄 maestro.json

Консолидированный конфиг в корне проекта. Коммитится
в git — он описывает security-политику и trust-модель проекта. Файл состоит из
трёх секций: `trust`, `confidential`, `sanitizer_whitelist`.

Путь к файлу resolves в таком порядке:
1. Переменная окружения `MAESTRO_CONFIG`
2. `<project>/maestro.json` (по умолчанию)

Если файл отсутствует — все сабагенты untrusted, access-policy не enforced,
дефолтные sanitizer-правила (fail-open).

Старые файлы `trust-config.json`, `.maestro/access-policy.json`,
`.maestro/sanitizer-whitelist.json` **не поддерживаются**.

> **Генерация/настройка конфига — через `/maestro-assistant`.** Полный JSON-канон
> `maestro.json` и правила вывода секций из контекста живут в скилле `maestro-assistant`
> (`skills/maestro-assistant/SKILL.md`) — единый источник, доступный `/maestro-setup`,
> `@maestro-init` и HITL-консультациям. Ниже — человеческие справочные таблицы по секциям.

### Версия плагина

Версия плагина `maestro-bootstrap` фиксируется плагином при инициализации в
`.maestro/plugin-version` (эфемерный метафайл, semver-only). Конфиг `maestro.json`
**не** хранит версию дистрибутива; `/maestro-version` показывает фактическую
версию загруженного плагина из `.maestro/plugin-version` (см. [Команды](commands.md)).

> **ИБ:** версия плагина — только `.maestro/plugin-version` (semver-only);
> конфиг `maestro.json` защищается **нативно** — deny `read`/`glob`/`grep` +
> edit-ask в `.opencode/opencode.json` (см. [`SECURITY.md`](../../../SECURITY.md)).

### Секция `trust`

Перечисляет **только trusted** сабагентов. Всё, чего нет — untrusted.

```json
{
  "trust": {
    "custodian": true,
    "sanitizer": true
  }
}
```

| Ключ | Тип | Описание |
|---|---|---|
| Имя сабагента | `true` | Единственное допустимое значение = trusted. Любое другое → untrusted |

**Имена сабагентов:** `custodian`, `sanitizer`, `haiku`, `sonnet`, `opus`,
`fable`, `code-reviewer`.

> `custodian` и `sanitizer` — trusted по умолчанию (по роли). Изменять не нужно,
> если не требуется доверять другим сабагентам.

### Секция `confidential`

Защита конфиденциальных путей: жёсткий deny чтения и записи для всех, кроме
**trusted-субагентов**.

**Инвариант (не конфигурируется):** любое обращение к `paths` через
`read`/`write`/`edit` от НЕ trusted (primary/root-сессия, untrusted-субагент) →
жёсткий `deny` по всем трём инструментам.

**Конфигурируется только** политика для **trusted** по каждому инструменту
(`allow` | `deny`). Дефолт: `read: allow`, `write: deny`, `edit: deny` (читать
можно, менять — нельзя).

```json
{
  "confidential": {
    "version": 1,
    "paths": ["docs/confidential/**"],
    "trusted": {
      "read": "allow",
      "write": "deny",
      "edit": "deny"
    }
  }
}
```

| Ключ | Тип | Обязательно | Описание |
|---|---|---|---|
| `version` | `number` | нет | Версия схемы (сейчас всегда `1`) |
| `paths` | `string[]` | нет | Glob-шаблоны confidential-путей. По умолчанию `["docs/confidential/**"]`. Поддерживают папки, отдельные файлы по полному имени и по маске, включая корневую папку проекта |
| `trusted.read` | `"allow"` \| `"deny"` | нет | Чтение trusted-субагентом (дефолт `allow`) |
| `trusted.write` | `"allow"` \| `"deny"` | нет | Запись trusted-субагентом (дефолт `deny`) |
| `trusted.edit` | `"allow"` \| `"deny"` | нет | Редактирование trusted-субагентом (дефолт `deny`) |

**Семантика масок `paths` (сегментный матчинг):**

- Паттерн матчится против проект-относительного пути, case-insensitive.
- `**` матчит 0+ сегментов, включая корень: `**/*.pem` закрывает и `app.pem`
  (в корне), и `certs/app.pem`, и `certs/nested/app.pem`.
- `*` / `?` матчат в пределах одного сегмента (не пересекают `/`).
- Паттерн без `/` и без `**` (напр. `*.env`, `maestro.json`) закрывает **только
  файлы в корневой папке** проекта; вложенный `config/prod.env` таким паттерном
  не закрывается (для него нужен `config/*.env` или `**/*.env`).
- `{a,b}` — чередование внутри сегмента (`*.{env,local}`).
- Паттерн с `/**` на конце (напр. `docs/confidential/**`) закрывает саму
  директорию, поддиректории и файлы внутри.

> **⚠️ Контроль маски применяется только к `read`/`write`/`edit`.**
> `bash`/`glob`/`grep` не перехватываются — confidential-файл, прочитанный
> через `bash` (`cat prod.env`), плагин не заблокирует (fail-open). Для таких
> инструментов используйте нативные permissions OpenCode (2-й эшелон).

**⚠️ Отличие от общего glob-матчинга:** в общем матчинге `*` пересекает `/`
(напр. `*.env` матчит и `config/prod.env`). В `confidential` маска без `/`
закрывает только корневые файлы. Для рекурсивной защиты секретов используйте
`**/*.env`.

**Built-in confidential (OQ-3).** Помимо `confidential.paths`, плагин применяет
**built-in набор по умолчанию** — `.env`, `.env.*`, `*.pem`, `*.key`, `*.crt`,
`*.p12`, `*.pfx` — deny для `read`/`write`/`edit` для primary и non-trusted,
независимо от наличия/содержимого секции `confidential`. Маски без `/` закрывают
только корневые файлы. `confidential.paths` **расширяет**, а не заменяет built-in.

> **Добавление пути к confidential** — пошаговая процедура (двойное зеркалирование
> I3, адресный diff, HITL-гейт, OP-1): см. [Управление конфиденциальными путями](../how-to/manage-confidential-paths.md).

**Кто считается trusted-субагентом:** вызов `read`/`write`/`edit` к
confidential-пути, выполненный внутри дочерней сессии субагента, чьё имя есть в
секции `trust` (`maestro.json`). Primary-сессия (нет родительской сессии) всегда
deny. Trust не наследуется вложенными субагентами — каждый субагент оценивается
по своему имени.

> **⚠️ Риск: данные confidential открыты при отключённом плагине.** Защита
> `confidential` реализована **внутри плагина `maestro-bootstrap`** (перехват
> `tool.execute.before`) и **не является файловой защитой на уровне ОС**
> (не chmod/ACL, не шифрование). Это полноценный **fail-open**: если плагин не
> подключён в конфиге (`.opencode/opencode.json`/global, `plugin` без
> `maestro-bootstrap`), не загрузился,
> деактивирован или opencode запущен без него — `read`/`write`/`edit` в
> `docs/confidential/**` выполняются **как обычные** (без каких-либо ограничений).
> То же касается sanitizer (в плагине): отключение
> плагина снимает маскирование промптов. **Не полагайтесь на confidential как на
> единственный барьер** — при отключённом плагине данные доступны любому
> (primary и untrusted). Для гарантированного барьера на уровне ОС ограничьте
> права каталога средствами ОС/репозитория (read-only для не-нужного,
> git-криптография и т.п.). `/maestro-setup` задача 5 лишь проверяет подключение
> плагина и **не блокирует** init при его отсутствии — плагин может быть не
> поднят, а confidential-данные уже созданы.

#### Логи плагина: формат и структура записей

Плагин `maestro-bootstrap` пишет JSONL-логи в `.maestro/logs/` (весь `.maestro/` в gitignore,
разбивка по дням) — **два** лога с разным назначением:

- `maestro-bootstrap-<дата>.log` — **observability**: task-диспатчи, ошибки/повторы
  сессий, sanitizer. Подчиняется `MAESTRO_BOOTSTRAP_LOG_MASK`/`LOG_LEVEL`.
- `maestro-audit-<дата>.log` — **security-фактура**: доступ к confidential
  (`allow`/`deny`). Пишется **всегда**, не зависит
  от bootstrap-маски/порога.

**Security-события живут ТОЛЬКО в аудит-логе** — bootstrap-лог их не дублирует.

Общий JSONL-формат строки:

```json
{"ts":"<ISO>","level":"debug|info|warn|error","msg":"<событие>","sessionID":"...","callID":"...","tool":"...","...прочие поля по событию"}
```

Общие поля: `ts` (ISO-время), `level`, `msg` (тип события), `sessionID`,
`callID`, `tool`. Дополнительные поля — по типу события.

**События bootstrap-лога:**

| `msg` | Уровень | Доп. поля |
|---|---|---|
| `plugin initialized` | info | `version`, `logDir`, `level`, `mask` |
| `tool.execute.before` | info | `tool` (=task) |
| `tool.execute.after` | info | `tool`, `durationMs`, `title` (санитизирован, SEC-4) |
| `tool.execute.after.empty_result` | warn | `tool` |
| `session.error` | warn | `errorType`, `errorMessage` |
| `session.status.retry` | warn | `attempt`, `message` |
| `sanitizer.redacted` | warn | `tool`, `agent`, `redacted` |
| `sanitizer.all_rules_disabled` | warn | `tool`, `agent` |
| `sanitizer.unsafe_patterns` | warn | `count` |

**События аудит-лога** (формат строки ниже):

| `msg` | Уровень | Доп. поля |
|---|---|---|
| `confidential.access` | info (allow) / warn (deny) | `tool`, `action`, `agent`, `target` |

Структура записи аудит-лога (JSON):

```json
{"ts":"<ISO>","level":"info|warn","msg":"confidential.access","sessionID":"...","callID":"...","tool":"read|write|edit","action":"allow|deny","agent":"<trusted-агент>|null","target":"<basename>"}
```

| Поле | Тип | Описание |
|---|---|---|
| `level` | `info` \| `warn` | `info` — allow, `warn` — deny/block |
| `msg` | `confidential.access` | Тип события |
| `tool` | `read` \| `write` \| `edit` | Инструмент |
| `action` | `allow` \| `deny` | Исход проверки |
| `agent` | `string` \| `null` | Имя trusted-субагента (из `trust`), если определено; `null` для root/primary |
| `target` | `string` | `basename` файла (без пути, SEC-5) |

События аудит-лога:

- `confidential.access` — доступ к confidential-пути. `action: "allow"` — trusted-
  субагент читал/писал (уровень `info`); `action: "deny"` — заблокировано для
  untrusted/primary или trusted с `trusted.<tool>: deny` (уровень `warn`).

Каталоги логов задаются env: bootstrap — `MAESTRO_BOOTSTRAP_LOG_DIR`, аудит —
`MAESTRO_AUDIT_LOG_DIR` (по умолчанию оба `<project>/.maestro/logs`). Сбой записи
аудита логируется в `console.error` (не ломая сессию).

### Секция `sanitizer_whitelist`

Правила санитайзера для маскирования чувствительных данных в промптах перед
отправкой untrusted сабагентам (Уровень 1 Security Review).

```json
{
  "sanitizer_whitelist": {
    "rules": {
      "env_secret": true,
      "data_field": true,
      "env_file": true,
      "db_credential": true,
      "ledger_entry": true,
      "private_key": true,
      "auth_header": true
    },
    "by_agent": {
      "code-reviewer": []
    },
    "patterns": [],
    "extra_fields": [],
    "extra_uri_schemes": []
  }
}
```

#### `rules`

Объект с категориальными правилам детекта:

| Правило | Тип данных | Описание |
|---|---|---|
| `env_secret` | `SECRET`, `KEY`, `TOKEN`, `PASSWORD`, `CREDENTIAL`, `PASS`, `AUTH`, `DSN`, `CERT`, `SALT`, `SIGNATURE`, `NONCE` | Переменные окружения и colon-значения вида `KEY: value` или `KEY=value` |
| `data_field` | Финансовые (`amount`, `salary`, `iban`, `cvv`, `vat`, `balance`…), PII (`phone`, `email`, `inn`, `snils`, `passport`…), credentials (`client_secret`, `api_key`, `password`…) | Чувствительные поля в JSON/fixtures/примерах данных |
| `env_file` | — | Упоминания файлов `.env`, `.env.*` |
| `db_credential` | `postgres://`, `mysql://`, `sftp://`, `ssh://`, `ldap://`, `clickhouse://`, `mongodb://` и др. с встроенными credentials; строки с `password=...` | Connection strings и URI-схемы |
| `ledger_entry` | — | Проводки (покрываются rule `data_field`, оставлен как маркер — no-op) |
| `private_key` | `-----BEGIN ... PRIVATE KEY-----` | PEM-блоки приватных ключей |
| `auth_header` | `Authorization: Bearer ...`, `X-API-Key: ...` | Auth-заголовки и standalone JWT tokens |

#### `by_agent`

Отключение категорий для конкретных сабагентов. Полезно, если сабагенту
не нужен доступ к определённым типам данных:

```json
"by_agent": {
  "code-reviewer": ["data_field", "ledger_entry"]
}
```

#### `patterns`

Конкретные значения (литералы), которые НЕ считаются sensitive — whitelist для
ложных срабатываний. Подстроки, совпадающие с значениями, исключаются из
маскирования:

```json
"patterns": ["test-token-12345", "test-key"]
```

> ⚠️ Значения в `patterns` проверяются на безопасность (SEC-6). Если значение
> само выглядит как секрет (GitHub token, AWS key, JWT, SSH private key) — плагин
> запишет `warn`-событие, но не заблокируется.

#### `extra_fields`

Дополнительные чувствительные поля данных, добавляемые к дефолтному списку:

```json
"extra_fields": ["ssn", "tax_id", "my_custom_secret_field"]
```

#### `extra_uri_schemes`

Дополнительные URI-схемы для credentials-детекта (кроме дефолтных `postgres`,
`mysql`, `mongodb`, `redis`, `amqp`, `http`, `https`, `ssh`, `ftp`, `ftps`,
`ldap`, `ldaps`, `grpc`, `clickhouse`, `mssql`, `cassandra`, `sftp`):

```json
"extra_uri_schemes": ["kafka", "custom-proto", "zookeeper"]
```

### Секция `memory` (опциональный memory layer)

Векторная память сессий плагина `maestro-bootstrap`: авто-саммаризация,
`memory_search`, авто-вспоминание. **Опциональный модуль** — не входит в
стандартную установку; включается явно. **Default:** секции нет **или**
`enabled: false` → память полностью выключена (хуки не регистрируются,
зависимости не загружаются, LLM-вызовов нет).

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
    "delete_on_session_delete": false,
    "summarize_timeout_ms": 120000,
    "report": { "include_text": false },
    "embedding": {
      "provider": "local",
      "model": null,
      "base_url": "https://api.openai.com/v1",
      "api_key_env": null,
      "dim": null
    },
    "probe_cooldown_min": 30,
    "artifact_globs": ["docs/superpowers/specs/**", "docs/superpowers/plans/**"],
    "history_globs": null,
    "storage": {
      "type": "sqlite",
      "qdrant": { "url": "https://qdrant.internal:6333", "api_key_env": "MAESTRO_MEMORY_QDRANT_KEY", "collection": "maestro_memory" },
      "pgvector": { "connection_string_env": "MAESTRO_MEMORY_PG_DSN", "table": "maestro_memory" }
    }
  }
}
```

| Ключ | Тип | Дефолт | Описание |
|---|---|---|---|
| `enabled` | `boolean` | `false` | Включает память. Нет секции / `false` → полностью off |
| `auto_recall` | `boolean` | `true` | Авто-вспоминание: первое сообщение top-level primary сессии → блок контекста в system prompt |
| `embedding_model` | `string` | `Xenova/paraphrase-multilingual-MiniLM-L12-v2` | **Legacy-алиас** для `embedding.model` (только при `provider: local`). Модель эмбеддингов (transformers.js, dim 384, RU+EN, q8 ~120 МБ, кэш локально). Для `openai` `model` берётся строго из `embedding.model` |
| `embedding.provider` | `string` | `local` | Провайдер эмбеддингов: `local` (default) \| `openai` (внешний OpenAI-совместимый `/embeddings` API, осознанный opt-in) |
| `embedding.model` | `string` \| `null` | `null` | local: имя ONNX-модели (fallback на `embedding_model`); openai: id модели API (**обязателен** для `openai`) |
| `embedding.base_url` | `string` | `https://api.openai.com/v1` | Базовый URL OpenAI-совместимого API; trailing-slash нормализуется |
| `embedding.api_key_env` | `string` \| `null` | `null` | **Имя env-переменной** с API-ключом (никогда plaintext); **обязателен** для `openai` |
| `embedding.dim` | `number` \| `null` | `null` | Размерность векторов; **обязателен** для `openai` (нативная dim модели, без Matryoshka-усечения); для `local` игнорируется (остаётся 384) |
| `probe_cooldown_min` | `number` | `30` | Интервал в минутах между live-probe модели на старте (кэш результата в `state.json`); число > 0 |
| `artifact_globs` | `string[]` | `["docs/superpowers/specs/**", "docs/superpowers/plans/**"]` | Allowlist-глобы артефактов (спеки/планы, v5.2): repo-relative пути из `write`/`edit` сессии, матчащие глобы, попадают в поле записи `artifacts[]`. `[]` — явный off. ≤16 непустых строк; невалиден → память disabled (`artifact_globs_invalid`). Полный справочник — в [Память maestro (reference)](memory.md) |
| `history_globs` | `string[]` \| `null` | `null` (inherit `artifact_globs`) | Allowlist-глобы для git-history backfill (`memory_reindex`, v3.5.0): repo-relative пути спек в git-истории — кандидаты на синтез записей. `null`/absent → **inherit** `artifact_globs` (резолв на use-site); `[]` — явный off. Валидный массив: ≤16 непустых строк (trim + unique). Невалидное → **soft fallback** на `artifact_globs` + warn `memory:config_fallback` — память НЕ отключается. Полный справочник — в [Память maestro (reference)](memory.md) |
| Модель саммаризации | — | — | Без ключа в `maestro.json` (4.0.0, zero-key): резолв из opencode-конфига, см. [Память maestro (reference)](memory.md) → «Резолв модели саммаризации» |
| `identity` | `string` \| `null` | `null` | Явный override identity (напр. сервисный аккаунт) |
| `identity_env` | `string` \| `null` | `null` | Имя env-переменной с identity (per-machine, не в общем `maestro.json`) |
| `namespace` | `string` | — | **Обязателен** (v5.1). Ключ изоляции памяти; формат `microservices.sales.pay` (1–3 сегмента, lowercase, разделитель `.`); нормализация trim+lowercase. Отсутствует/невалиден → память disabled (`namespace_missing`/`namespace_invalid`) |
| `related` | `string[]` | `[]` | Кросс-доменные связи: массив namespace-префиксов (≤16), merged-only точечная связь с записями другого домена. Невалиден (не массив / >16 / не namespace-префикс) → память disabled (`related_invalid`) |
| `domain_recall` | `boolean` | `true` | Авто-related по домену (родитель + братья namespace, merged-only) в recall. `false` — off-switch. Невалиден (не boolean) → память disabled (`domain_recall_invalid`) |
| `module_dir` | `string` \| `null` | `null` | Каталог кода модуля; `null` → `<data-dir>/maestro/memory/module` |
| `idle_debounce_min` | `number` | `10` | Debounce индексации после `session.idle` (минуты) |
| `min_new_messages` | `number` | `3` | Мин. новых сообщений с последнего саммари для повторной индексации |
| `backfill_window_days` | `number` | `30` | Окно backfill при первом включении |
| `backfill_max_per_start` | `number` | `5` | Cap саммаризаций за один старт плагина |
| `retry_interval_min` | `number` | `60` | Интервал ретрая упавшей сессии (минуты) |
| `top_k` | `number` | `3` | Число результатов поиска / авто-вспоминания |
| `min_score` | `number` | `0.35` | Порог косинусной близости |
| `similarity_threshold` | `number` | `0.7` | Порог косинусной близости для кластеров тем и графа похожести (`memory_stats_detail` / отчёт); диапазон `[0, 1]` |
| `retention_days` | `number` \| `null` | `null` | TTL записей: prune при старте (записи старше N дней по `time_last`). `null` — выключено |
| `summarize_timeout_ms` | `number` | `120000` | Таймаут цепочки «саммаризация → эмбеддинг → запись» |
| `report.include_text` | `boolean` | `false` | Разрешает вставку замаскированных заголовков/summary в HTML-отчёт `@maestro-memory-report`; `false` — только агрегаты (SEC-4b) |
| `report.preview` | `boolean` | `true` | Авто-запуск локального preview-сервера командой `@maestro-memory-report` (bind `127.0.0.1`, свободный порт, TTL 60 мин, state-файл `.maestro/preview-server.json`); `false` — только генерация HTML |
| `branch_context` | `boolean` | `true` | Branch-scoped recall (default-on): членство записей по git-истории (тиры general/experience); `false` → flat project recall (дефолтный scope = `project`) |
| `delete_on_session_delete` | `boolean` | `false` | Удалять запись при `session.deleted` (v1-приватность; рекомендуется только для sqlite — на централизованных бэкендах удаляет командное знание) |
| `mainline` | `string` \| `null` | `null` | Основная ветка для промоции; `null` → авто-детект из git (remote HEAD → `init.defaultBranch` → резерв `main`/`master`/`develop`); явный override авторитетен (несуществующее имя → `mainline_unresolved`) |
| `storage.type` | `string` | `sqlite` | Бэкенд: `sqlite` \| `qdrant` \| `pgvector` |
| `storage.qdrant.url` | `string` | — | URL Qdrant (обязателен для `type: qdrant`) |
| `storage.qdrant.api_key_env` | `string` | — | Имя env-переменной с API-ключом (никогда plaintext) |
| `storage.qdrant.collection` | `string` | `maestro_memory` | Коллекция Qdrant |
| `storage.pgvector.connection_string_env` | `string` | — | Имя env-переменной с DSN Postgres (обязателен для `type: pgvector`) |
| `storage.pgvector.table` | `string` | `maestro_memory` | Таблица pgvector |
| `storage.pgvector.text_search_config` | `string` | `russian` | Postgres text-search конфигурация для гибридного поиска (только при `type: pgvector`). Валидация: `/^[a-z][a-z0-9_]*$/`, ≤63 символа; default `russian` — стеммер; на кастомных PG без `russian`-конфига — fail-loud |

**Валидация:** некорректный `storage.type` / отсутствие URL / нерезолвнутая
identity для централизованного бэкенда / некорректный `retention_days` /
`similarity_threshold` вне `[0, 1]` / некорректный `branch_context` (не boolean) /
некорректный `mainline` (не `null` и не строка `/^[a-zA-Z0-9_\/.-]+$/`, длина
≤ 100) / некорректный блок `embedding` (не объект; `provider`/`model`/
`base_url`/`api_key_env` — не строки; `dim` — не целое > 0; для `openai`
отсутствуют `model`/`api_key_env`/`dim`) / некорректный `probe_cooldown_min`
(не число > 0) → память off + лог (`disabled_reason`: `storage_type_invalid`,
`centralized_identity_missing`, `qdrant_config_invalid`,
`pgvector_config_invalid`, `pgvector_text_search_config_invalid`,
`retention_days_invalid`, `similarity_threshold_invalid`,
`branch_context_invalid`, `mainline_invalid`, `embedding_invalid`,
`probe_cooldown_min_invalid`, `artifact_globs_invalid`,
`delete_on_session_delete_invalid`,
`namespace_missing`, `namespace_invalid`, `related_invalid`,
`domain_recall_invalid`), сессии
работают (fail-soft).
**Исключение — `history_globs`:** некорректное значение (не массив / не-строки /
>16) → **soft fallback** на `artifact_globs` + warn `memory:config_fallback` —
память НЕ отключается, нового `disabled_reason` нет (RI-8).
Приоритет disabled-причин: `namespace_missing`/`namespace_invalid` — первичны
(без валидного namespace память не включается независимо от остального
конфига); `related_invalid`/`domain_recall_invalid` — вторичны (проверяются
после валидного namespace).
Централизованные бэкенды требуют identity (`identity` → `identity_env` → git
`user.name`). Для `embedding.provider: openai` отсутствие
`process.env[embedding.api_key_env]` → память off
(`embedding_api_key_env_missing`); стартовый probe hard-fail (ключ/модель/
размерность) → память off (`embedder_probe_hard_fail`).

#### Permission-правило для write/boundary-tools (обязательное)

`memory_forget` / `memory_export` / `memory_import` / `memory_migrate` /
`memory_prune` / `memory_reindex` — операции, пересекающие границу (удаление,
запись файла, запись в память, пере-keying, бэкфилл/синтез записей). OpenCode
по умолчанию разрешает новые тулы, поэтому в
merge-config (`.opencode/opencode.json`
или global `~/.config/opencode/opencode.json`) **обязательно** правило:

```json
{
  "permission": {
    "memory_forget": "ask",
    "memory_export": "ask",
    "memory_import": "ask",
    "memory_migrate": "ask",
    "memory_prune": "ask",
    "memory_reindex": "ask"
  }
}
```

Включение памяти v2 без этого правила — документированный обязательный шаг
(канон — в скилле `maestro-assistant`). Правило для будущих write/boundary-tools:
**новые write/boundary-tools → permission `ask`**.

> Полный справочник (бэкенды, изоляция key/namespace/identity, `memory_search`,
> индексация, расположение данных, ESM-контракт) — в
> [Память maestro (reference)](memory.md). Включение — в
> [Как включить память](../how-to/enable-memory.md).

## 📄 opencode.json (`.opencode/opencode.json` или global)

Корневой `opencode.json` в проекте **не используется**. Плагин и модели агентов
живут в merge-конфиге OpenCode: `.opencode/opencode.json` (project) или глобальный
`~/.config/opencode/opencode.json`.

### Плагин

Плагин `maestro-bootstrap` поставляется из git-репозитория `wad-jet/maestro`
(публикация в npm не используется). Подключается до запуска пайплайна.

**Из git (рекомендуется)** — в `~/.config/opencode/opencode.json` (реком.) или
`.opencode/opencode.json`:

```json
{
  "plugin": [
    "maestro-bootstrap@git+https://github.com/wad-jet/maestro.git"
  ]
}
```

При необходимости зафиксировать конкретный коммит — через fragment `#<commit-sha>`
в конце spec.

**Локально (из исходников):**

```json
{
  "plugin": [
    "../plugins/maestro-bootstrap/index.js"
  ]
}
```

> **Подводный камень (silent fail).** Относительный путь плагина резолвится
> **от каталога конфига** (`.opencode/` для проектного или
> `~/.config/opencode/` для глобального), а не от корня проекта. Поэтому `./plugins/...`
> превращается в `.opencode/plugins/...` (нет такого пути) — плагин молча не
> загружается, без ошибок в консоли. Корректный относительный путь — `../plugins/...`
> (подъём к корню), но он работает только для **проектного** `.opencode/opencode.json`
> (от `~/.config/opencode/` он укажет на `~/.config/plugins/...`). Надёжная
> альтернатива — абсолютный `file:///…/plugins/maestro-bootstrap/index.js`
> (машино-зависимый, работает из любого конфига). **Диагностика:** если плагин не
> загружен — в `.maestro/logs/` отсутствует свежий `maestro-bootstrap-<дата>.log`
> с записью `plugin initialized` (это признак незагруженного плагина, а не «нет логов»).

Если ключа `plugin` нет — добавить; если есть массив, но пути нет —
дописать. Если путь уже есть — пропустить. **Никогда не перезаписывать**
существующее содержимое конфига.

Перезапуск opencode обязателен после добавления плагина.

### Гейт «плагин работает» для runtime-команд

В maestro-проекте (есть `maestro.json`) команды `@maestro-init`, `@maestro-design`,
`@maestro-feedback-report` при старте выполняют жёсткий гейт:

1. самый свежий `.maestro/logs/maestro-bootstrap-<дата>.log` должен содержать
   запись `plugin initialized` с timestamp не старше 24 часов.

Если условие не выполнено — жёсткий STOP без «продолжить»: только
«(a) подключить плагин и перезапустить» / «(c) стоп». Причина: без плагина
защита `docs/confidential/**` и sanitize не действуют (fail-open), confidential-
данные доступны untrusted-агентам. `@maestro-setup` и `@regression` не гейтятся.

### Агенты: модели

Каждый сабагент имеет модель в `.opencode/opencode.json` (или global):

```json
{
  "agent": {
    "custodian": {
      "model": "opus",
      "permission": {
        "read": { "*": "allow", "docs/confidential/*": "allow" },
        "glob": { "*": "allow", "docs/confidential/*": "allow" },
        "grep": { "*": "allow", "docs/confidential/*": "allow" },
        "edit": "deny",
        "bash": "deny",
        "task": "deny",
        "hidden": true
      }
    },
    "sanitizer": {
      "model": "opus",
      "permission": {
        "read": { "*": "allow", "docs/confidential/*": "allow" },
        "glob": { "*": "allow", "docs/confidential/*": "allow" },
        "grep": { "*": "allow", "docs/confidential/*": "allow" },
        "edit": "deny",
        "bash": "deny",
        "task": "deny",
        "hidden": true
      }
    },
    "haiku": {
      "model": "haiku",
      "permission": {
        "edit": "allow",
        "bash": "allow",
        "task": "deny",
        "hidden": true
      }
    },
    "sonnet": {
      "model": "sonnet",
      "permission": {
        "edit": "allow",
        "bash": "allow",
        "task": "deny",
        "hidden": true
      }
    },
    "opus": {
      "model": "opus",
      "permission": {
        "edit": "deny",
        "bash": "deny",
        "task": "deny",
        "hidden": true
      }
    },
    "fable": {
      "model": "fable",
      "permission": {
        "edit": "deny",
        "bash": "deny",
        "task": "deny",
        "hidden": true
      }
    },
    "code-reviewer": {
      "model": "opus",
      "permission": {
        "edit": "deny",
        "bash": "allow",
        "task": "deny",
        "hidden": false
      }
    }
  }
}
```

| Ключ сабагента | Рекомендуемая модель | `read`/`glob`/`grep` (confidential) | `edit` | `bash` | `hidden` | Роль |
|---|---|---|---|---|---|---|
| `custodian` | opus | **allow** | deny | deny | true | Q/A-брокер по confidential (trusted), не пишет spec |
| `sanitizer` | opus (или безопасная) | **allow** | deny | deny | true | Security review (trusted) |
| `haiku` | haiku | (default) | allow | allow | true | Механические задачи SDD |
| `sonnet` | sonnet | (default) | allow | allow | true | Интеграционные задачи SDD, task-reviewer |
| `opus` | opus | (default) | deny | deny | true | Spec review, архитектура |
| `fable` | fable | (default) | deny | deny | true | Пример, метафоры, объяснения |
| `code-reviewer` | opus | (default) | deny | allow | false | Финальное ревью ветки |

> **Нативный permission-бастион (R1+R4).** Помимо плагина, init пишет нативный
> deny-baseline для confidential (`read`/`edit`) и 2-й эшелон для `bash`/`glob`/
> `grep` в merge-config. Канон и семантика (`*` пересекает `/`, last-match-wins) —
> в скилле `maestro-assistant`. Подробнее про риски обхода плагина через
> `bash`/`glob`/`grep` — см. [Агенты и модель доверия](../explanation/agents-and-trust.md).

> **`doom_loop` guard (R8).** OpenCode автоматически переспрашивает при
> повторении **одинакового** вызова тула 3 раза подряд (по умолчанию `ask`) —
> защита от «застревания» агента. Не конфликтует с pipeline maestro
> (retry-циклы здесь — осознанные, разные вызовы); при неожиданных повторах —
> индикатор возможного зацикливания, стоит проверить шаг pipeline.

> **`@`-invocation caveat (R8).** Пользователь может вызвать **любой** сабагент
> напрямую через `@`-меншн, даже если у агента `task: deny` (включая `@custodian`
> с доступом к `docs/confidential/**`). Это приемлемо по дизайну: **человек =
> источник доверия**. Но следует осознавать: `@custodian` вручную работает в
> контексте с confidential-данными, и его вывод видит primary. Рекомендация:
> не вызывать `@custodian`/`@sanitizer` вручную мимо pipeline без необходимости.

#### Доступные модели (D2)

Кандидаты для `model` определяются так:

1. **Основной источник — `opencode models <provider>`** (запрос к рантайму opencode,
   не чтение глобального файла), для каждого известного провайдера (`provider.*`),
   списки объединяются.
2. **Fallback** — `provider.<name>.models` в merge-конфиге:
   - `~/.config/opencode/opencode.json` (global)
   - `.opencode/opencode.json` (project)

   Приоритет merge: project > global.
3. **Ручной ввод** — если кандидатов нет (нет провайдеров/моделей): HITL-ввод ID
   вручную + попытка `opencode models <provider>`.

> **Агенты (`agent.*`)** также наследуются из global через merge — `model` и
> `temperature` агентов, настроенные глобально, применяются ко всем проектам;
> project `.opencode/opencode.json` переопределяет global при необходимости.

#### Pлейсхолдеры запрещены

Модель должна быть конкретным ID. Значения вроде `"{{MODEL}}"`, `"<model>"` или
любые другие плейсхолдеры недопустимы.

## 🌍 Переменные окружения

### `MAESTRO_CONFIG`

Пользовательский путь к `maestro.json`. Переопределяет дефолтное расположение
`<project>/maestro.json`:

```bash
export MAESTRO_CONFIG="/custom/path/to/maestro.json"
```

### `MAESTRO_BOOTSTRAP_LOG_LEVEL`

Порог детализации логирования плагина. Пишутся уровни `>=` заданного:

| Значение | Что логируется |
|---|---|
| `debug` | Всё: debug, info, warn, error |
| `info` | info, warn, error (по умолчанию) |
| `warn` | warn, error |
| `error` | Только error |

### `MAESTRO_BOOTSTRAP_LOG_MASK`

Явный список включённых уровней через запятую. Не зависит от `LOG_LEVEL` —
запись пишется при **пересечении** двух условий: уровень входит в маску И не
ниже порога `LOG_LEVEL`.

```bash
# Отключить только info, оставить остальные:
MAESTRO_BOOTSTRAP_LOG_MASK=debug,warn,error

# Отключить логирование полностью:
MAESTRO_BOOTSTRAP_LOG_MASK=off
```

Если не задана — выводится из `LOG_LEVEL`: маска = все уровни `>= LOG_LEVEL`.

### `MAESTRO_BOOTSTRAP_LOG_DIR`

Каталог для JSONL-логов:

```bash
MAESTRO_BOOTSTRAP_LOG_DIR="/var/log/maestro"
```

По умолчанию: `<project>/.maestro/logs`. Логи разбиваются по дням:
`.maestro/logs/maestro-bootstrap-2026-08-01.log`.

### `MAESTRO_MEMORY_LOG_LEVEL`

Порог детализации **аудит-лога memory layer** (`.maestro/logs/maestro-memory-<дата>.log`).
Пишутся уровни `>=` заданного; default `info`:

| Значение | Что логируется |
|---|---|
| `debug` | Всё: debug, info, warn, error (включая перф-события) |
| `info` | info, warn, error (по умолчанию) |
| `warn` | warn, error |
| `error` | Только error |

### `MAESTRO_MEMORY_LOG_MASK`

Явный список включённых уровней через запятую (как у bootstrap-лога): запись
пишется при **пересечении** двух условий — уровень входит в маску И не ниже
порога `MAESTRO_MEMORY_LOG_LEVEL`. Если не задана — выводится из порога.

### `MAESTRO_MEMORY_LOG_DIR`

Каталог для аудит-лога memory layer:

```bash
MAESTRO_MEMORY_LOG_DIR="/var/log/maestro"
```

По умолчанию — каталог bootstrap-лога (`<project>/.maestro/logs`). Логи
разбиваются по дням: `.maestro/logs/maestro-memory-2026-09-08.log`.

## 📁 Файлы, создаваемые / используемые pipeline

| Путь | Назначение | В git? |
|---|---|---|
| `maestro.json` | Консолидированный конфиг (trust, confidential, sanitizer_whitelist) | Да |
| `.opencode/opencode.json` | Плагин (альтернативно) + модели сабагентов | Нет (в `.gitignore`) |
| `.opencode/` (скиллы/агенты/команды) | Доставляемая конфигурация средств (вручную/agpack) | Нет (в `.gitignore`) |
| `docs/project-context.md` | Проектовый контекст шага 0 (14 категорий) | Да |
| `docs/superpowers/specs/*.md` | Spec-файлы | Да |
| `docs/superpowers/plans/*.md` | План реализации | Да |
| `docs/roadmap.md` | Roadmap проекта | Да |
| `regression/entries/*.md` | Активные entries регрессии | Да |
| `regression/released/*.md` | Архив завершённых entries | Да |
| `regression/cancelled-features.md` | Решения об отменах | Да |
| `.maestro/**` | SDD progress, last-run.md, logs/, feedback-reports/, plugin-version (эфемерное) | Нет |

## 🔗 Связанные разделы

- [Требования и оценка ИБ (SECURITY.md)](../../../SECURITY.md) — модель доверия,
  секции `confidential`/`trust`
- [Кастомизация скилла](../how-to/customize-maestro.md)
- [Агенты и модель доверия](../explanation/agents-and-trust.md)
- [Плагин maestro-bootstrap](../reference/commands.md) (установка из `@maestro-setup`)
- Техническая деталь: `plugins/maestro-bootstrap/core.js` (loadMaestroConfig,
  resolveFileAccess, resolveSanitizeOptions)
