# Конфигурация

[Назад к оглавлению](../index.md)

## 🎯 Назначение

Полный справочник форматов `maestro.json`, `.opencode/opencode.json` (maestro-часть;
или глобальный конфиг) и переменных окружения, которые управляют поведением скилла
`maestro` и плагина `maestro-bootstrap`.

## 📄 maestro.json

Консолидированный конфиг в корне проекта. Коммитится
в git — он описывает security-политику и trust-модель проекта. Файл состоит из
четырёх секций: `trust`, `access_policy`, `confidential`, `sanitizer_whitelist`.

Путь к файлу resolves в таком порядке:
1. Переменная окружения `MAESTRO_CONFIG`
2. `<project>/maestro.json` (по умолчанию)

Если файл отсутствует — все сабагенты untrusted, access-policy не enforced,
дефолтные sanitizer-правила (fail-open).

Старые файлы `trust-config.json`, `.maestro/access-policy.json`,
`.maestro/sanitizer-whitelist.json` **не поддерживаются**.

> **Генерация/настройка конфига — через `/maestro-assistant`.** Полный JSON-канон
> `maestro.json` и правила вывода секций из контекста живут в скилле `maestro-assistant`
> (`skills/maestro-assistant/SKILL.md`) — единый источник, доступный `/maestro-new`,
> `@maestro-init` и HITL-консультациям. Ниже — человеческие справочные таблицы по секциям.

### Версия плагина

Версия плагина `maestro-bootstrap` фиксируется плагином при инициализации в
`.maestro/plugin-version` (эфемерный метафайл, semver-only). Конфиг `maestro.json`
**не** хранит версию дистрибутива; `/maestro-version` показывает фактическую
версию загруженного плагина из `.maestro/plugin-version` (см. [Команды](commands.md)).

> **ИБ:** версия плагина — только `.maestro/plugin-version` (semver-only), вне
> `access_policy`; конфиг `maestro.json` остаётся под контролем доступа
> (см. [`SECURITY.md`](../../../SECURITY.md)).

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

### Секция `access_policy`

File access control: определяет, к каким файлам untrusted сабагенты могут
обращаться через `read` без HITL. Применяется **только к `read`**: `bash`/
`glob`/`grep` НЕ покрываются (используйте нативные permissions OpenCode).

```json
{
  "access_policy": {
    "version": 1,
    "default": "ask",
    "allow": [
      "src/**",
      "packages/**",
      "test/**",
      "tests/**",
      "*.{ts,js,tsx,jsx,py,go,rs,java}"
    ],
    "ask": [
      "docs/**",
      "specs/**",
      "manual_docs/**",
      "*.{md,mdx}",
      "*.config.*",
      "*.conf.*",
      "*.{yaml,yml,toml,ini}"
    ],
    "deny": [
      "*.env",
      "*.env.*",
      "*.{pem,key,cert,secret}"
    ]
  }
}
```

| Ключ | Тип | Обязательно | Описание |
|---|---|---|---|
| `version` | `number` | нет | Версия схемы политик (сейчас всегда `1`) |
| `default` | `"allow"` \| `"ask"` | да | Действие по умолчанию, если ни один паттерн не совпал. **Рекомендуется `"ask"`** |
| `allow` | `string[]` | нет | Glob-шаблоны — доступ без HITL |
| `ask` | `string[]` | нет | Glob-шаблоны — запрос HITL у оркестратора |
| `deny` | `string[]` | нет | Glob-шаблоны — жёсткий блок |

### Разрешение конфликтов

Приоритет: `deny` > `ask` > `allow` > `default` (наиболее строгое побеждает).

Формат шаблонов — упрощённые glob: `*` (любые символы), `?` (один символ),
`{a,b,c}` (альтернативы). Без рекурсивного `**` в нативном понимании —
`**` транслируется в `.*`.

> Приоритет работает на уровне паттернов, не файлов. Если файл совпадает с
> паттернами в `allow` и `deny`, — `deny` побеждает.

### Секция `confidential`

Защита конфиденциальных путей: жёсткий deny чтения и записи для всех, кроме
**trusted-субагентов**. Строже `access_policy` — если путь попал в `paths`,
применяется правило `confidential`, `access_policy` для него игнорируется.

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

**⚠️ Отличие от `access_policy`:** маски в `access_policy` используют общий
матчер, где `*` пересекает `/` (напр. `*.env` в `deny` матчит и `config/prod.env`).
В `confidential` маска без `/` закрывает только корневые файлы. Одна и та же
маска `*.env` в двух секциях ведёт себя по-разному — это намеренно. Для
рекурсивной защиты секретов используйте `**/*.env`.

**Built-in confidential (OQ-3).** Помимо `confidential.paths`, плагин применяет
**built-in набор по умолчанию** — `.env`, `.env.*`, `*.pem`, `*.key`, `*.crt`,
`*.p12`, `*.pfx` — deny для `read`/`write`/`edit` для primary и non-trusted,
независимо от наличия/содержимого секции `confidential`. Маски без `/` закрывают
только корневые файлы. `confidential.paths` **расширяет**, а не заменяет built-in.

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
> То же касается `access_policy` и sanitizer (все — в плагине): отключение
> плагина снимает ВСЮ file-политику. **Не полагайтесь на confidential как на
> единственный барьер** — при отключённом плагине данные доступны любому
> (primary и untrusted). Для гарантированного барьера на уровне ОС ограничьте
> права каталога средствами ОС/репозитория (read-only для не-нужного,
> git-криптография и т.п.). `/maestro-new` задача 5 лишь проверяет подключение
> плагина и **не блокирует** init при его отсутствии — плагин может быть не
> поднят, а confidential-данные уже созданы.

#### Логи плагина: формат и структура записей

Плагин `maestro-bootstrap` пишет JSONL-логи в `.maestro/logs/` (весь `.maestro/` в gitignore,
разбивка по дням) — **два** лога с разным назначением:

- `maestro-bootstrap-<дата>.log` — **observability**: task-диспатчи, ошибки/повторы
  сессий, sanitizer. Подчиняется `MAESTRO_BOOTSTRAP_LOG_MASK`/`LOG_LEVEL`.
- `maestro-audit-<дата>.log` — **security-фактура**: доступ к confidential
  (`allow`/`deny`) и блокировки `access_policy`. Пишется **всегда**, не зависит
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
| `access_policy.blocked` | warn | `tool`, `action`, `target` |

Структура записи аудит-лога (JSON):

```json
{"ts":"<ISO>","level":"info|warn","msg":"confidential.access|access_policy.blocked","sessionID":"...","callID":"...","tool":"read|write|edit","action":"allow|deny","agent":"<trusted-агент>|null","target":"<basename>"}
```

| Поле | Тип | Описание |
|---|---|---|
| `level` | `info` \| `warn` | `info` — allow, `warn` — deny/block |
| `msg` | `confidential.access` \| `access_policy.blocked` | Тип события |
| `tool` | `read` \| `write` \| `edit` | Инструмент (для `access_policy.blocked` — всегда `read`) |
| `action` | `allow` \| `deny` | Исход проверки |
| `agent` | `string` \| `null` | Имя trusted-субагента (из `trust`), если определено; `null` для root/primary |
| `target` | `string` | `basename` файла (без пути, SEC-5) |

События аудит-лога:

- `confidential.access` — доступ к confidential-пути. `action: "allow"` — trusted-
  субагент читал/писал (уровень `info`); `action: "deny"` — заблокировано для
  untrusted/primary или trusted с `trusted.<tool>: deny` (уровень `warn`).
- `access_policy.blocked` — блокировка файла по `access_policy` (`ask`/`deny`),
  уровень `warn`.

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
данные доступны untrusted-агентам. `@maestro-new` и `@regression` не гейтятся.

### Агенты: модели

Каждый сабагент имеет модель в `.opencode/opencode.json` (или global):

```json
{
  "agent": {
    "custodian": {
      "model": "opus",
      "permission": {
        "edit": "deny",
        "bash": "deny",
        "task": "deny",
        "hidden": true
      }
    },
    "sanitizer": {
      "model": "opus",
      "permission": {
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

| Ключ сабагента | Рекомендуемая модель | `edit` | `bash` | `hidden` | Роль |
|---|---|---|---|---|---|
| `custodian` | opus | deny | deny | true | Q/A-брокер по confidential (trusted), не пишет spec |
| `sanitizer` | opus (или безопасная) | deny | deny | true | Security review (trusted) |
| `haiku` | haiku | allow | allow | true | Механические задачи SDD |
| `sonnet` | sonnet | allow | allow | true | Интеграционные задачи SDD, task-reviewer |
| `opus` | opus | deny | deny | true | Spec review, архитектура |
| `fable` | fable | deny | deny | true | Пример, метафоры, объяснения |
| `code-reviewer` | opus | deny | allow | false | Финальное ревью ветки |

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

## 📁 Файлы, создаваемые / используемые pipeline

| Путь | Назначение | В git? |
|---|---|---|
| `maestro.json` | Консолидированный конфиг (trust, access_policy, confidential, sanitizer_whitelist) | Да |
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
  секции `confidential`/`trust`/`access_policy`
- [Кастомизация скилла](../how-to/customize-maestro.md)
- [Агенты и модель доверия](../explanation/agents-and-trust.md)
- [Плагин maestro-bootstrap](../reference/commands.md) (установка из `@maestro-new`)
- Техническая деталь: `plugins/maestro-bootstrap/core.js` (loadMaestroConfig,
  resolveFileAccess, resolveSanitizeOptions)
