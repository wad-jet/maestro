# Конфигурация

[Назад к оглавлению](../index.md)

## 🎯 Назначение

Полный справочник форматов `maestro.json`, `opencode.json` (maestro-часть) и
переменных окружения, которые управляют поведением скилла `maestro` и плагина
`maestro-bootstrap`.

## 📄 maestro.json

Консолидированный конфиг в корне проекта (рядом с `opencode.json`). Коммитится
в git — он описывает security-политику и trust-модель проекта. Файл состоит из
четырёх секций: `trust`, `access_policy`, `confidential`, `sanitizer_whitelist`.

Путь к файлу resolves в таком порядке:
1. Переменная окружения `MAESTRO_CONFIG`
2. `<project>/maestro.json` (по умолчанию)

Если файл отсутствует — все сабагенты untrusted, access-policy не enforced,
дефолтные sanitizer-правила (fail-open).

Старые файлы `trust-config.json`, `.maestro/access-policy.json`,
`.maestro/sanitizer-whitelist.json` **не поддерживаются**.

### Секция `trust`

Перечисляет **только trusted** сабагентов. Всё, чего нет — untrusted.

```json
{
  "trust": {
    "design": true,
    "sanitizer": true
  }
}
```

| Ключ | Тип | Описание |
|---|---|---|
| Имя сабагента | `true` | Единственное допустимое значение = trusted. Любое другое → untrusted |

**Имена сабагентов:** `design`, `sanitizer`, `haiku`, `sonnet`, `opus`,
`fable`, `code-reviewer`.

> `design` и `sanitizer` — trusted по умолчанию (по роли). Изменять не нужно,
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
| `paths` | `string[]` | нет | Glob-шаблоны confidential-путей. По умолчанию `["docs/confidential/**"]` |
| `trusted.read` | `"allow"` \| `"deny"` | нет | Чтение trusted-субагентом (дефолт `allow`) |
| `trusted.write` | `"allow"` \| `"deny"` | нет | Запись trusted-субагентом (дефолт `deny`) |
| `trusted.edit` | `"allow"` \| `"deny"` | нет | Редактирование trusted-субагентом (дефолт `deny`) |

**Кто считается trusted-субагентом:** вызов `read`/`write`/`edit` к
confidential-пути, выполненный внутри дочерней сессии субагента, чьё имя есть в
секции `trust` (`maestro.json`). Primary-сессия (нет родительской сессии) всегда
deny. Trust не наследуется вложенными субагентами — каждый субагент оценивается
по своему имени.

> **⚠️ Риск: данные confidential открыты при отключённом плагине.** Защита
> `confidential` реализована **внутри плагина `maestro-bootstrap`** (перехват
> `tool.execute.before`) и **не является файловой защитой на уровне ОС**
> (не chmod/ACL, не шифрование). Это полноценный **fail-open**: если плагин не
> подключён в `opencode.json` (`plugin` без `maestro-bootstrap`), не загрузился,
> деактивирован или opencode запущен без него — `read`/`write`/`edit` в
> `docs/confidential/**` выполняются **как обычные** (без каких-либо ограничений).
> То же касается `access_policy` и sanitizer (все — в плагине): отключение
> плагина снимает ВСЮ file-политику. **Не полагайтесь на confidential как на
> единственный барьер** — при отключённом плагине данные доступны любому
> (primary и untrusted). Для гарантированного барьера на уровне ОС ограничьте
> права каталога средствами ОС/репозитория (read-only для не-нужного,
> git-криптография и т.п.). `/maestro-init` задача 5 лишь проверяет подключение
> плагина и **не блокирует** init при его отсутствии — плагин может быть не
> поднят, а confidential-данные уже созданы.

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

## 📄 opencode.json

### Плагин

Плагин `maestro-bootstrap` опубликован в npm. Подключается до запуска пайплайна.

**Из npm (рекомендуется):**

```json
{
  "plugin": [
    "maestro-bootstrap"
  ]
}
```

или через CLI:

```bash
opencode plugin maestro-bootstrap
```

**Локально (из исходников):**

```json
{
  "plugin": [
    "./plugins/maestro-bootstrap/index.js"
  ]
}
```

Если ключа `plugin` нет — добавить; если есть массив, но пути нет —
дописать. Если путь уже есть — пропустить. **Никогда не перезаписывать**
существующее содержимое `opencode.json`.

Перезапуск opencode обязателен после добавления плагина.

### Гейт «плагин подключён» для runtime-команд

В maestro-проекте (есть `maestro.json`) команды `@maestro`, `@maestro-design`,
`@maestro-feedback-report` при старте выполняют жёсткий гейт:

1. `opencode.json → plugin` должен содержать `maestro-bootstrap`;
2. самый свежий `.maestro/logs/maestro-bootstrap-<дата>.log` должен содержать
   запись `plugin initialized` с timestamp не старше 24 часов.

Если любое условие не выполнено — жёсткий STOP без «продолжить»: только
«(a) подключить плагин и перезапустить» / «(c) стоп». Причина: без плагина
защита `docs/confidential/**` и sanitize не действуют (fail-open), confidential-
данные доступны untrusted-агентам. `@maestro-init` и `@regression` не гейтятся.

### Агенты: модели

Каждый сабагент имеет модель в `opencode.json`:

```json
{
  "agent": {
    "design": {
      "model": "opus",
      "permission": {
        "edit": "allow",
        "bash": "deny",
        "task": "deny"
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
| `design` | opus | allow | deny | true | Spec formation (trusted) |
| `sanitizer` | opus (или безопасная) | deny | deny | true | Security review (trusted) |
| `haiku` | haiku | allow | allow | true | Механические задачи SDD |
| `sonnet` | sonnet | allow | allow | true | Интеграционные задачи SDD, task-reviewer |
| `opus` | opus | deny | deny | true | Spec review, архитектура |
| `fable` | fable | deny | deny | true | Пример, метафоры, объяснения |
| `code-reviewer` | opus | deny | allow | false | Финальное ревью ветки |

#### Доступные модели (D2)

Кандидаты для `model` определяются из `provider.<name>.models` **по всем уровням**:

1. `.opencode/opencode.json` (приоритет выше)
2. `opencode.json` (project)
3. `~/.config/opencode/opencode.json` (global)

Приоритет merge: `.opencode` > project > global. Если `models` не задан ни
на одном уровне — HITL-ввод вручную + попытка `opencode models <provider>`.

> **Агенты (`agent.*`)** также наследуются из global через merge — `model` и
> `temperature` агентов, настроенные глобально, применяются ко всем проектам;
> project `opencode.json` переопределяет global при необходимости.

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
| `opencode.json` | Регистрация плагина + модели сабагентов | Да |
| `docs/project-context.md` | Проектовый контекст шага 0 (14 категорий) | Да |
| `docs/superpowers/specs/*.md` | Spec-файлы | Да |
| `docs/superpowers/plans/*.md` | План реализации | Да |
| `docs/roadmap.md` | Roadmap проекта | Да |
| `regression/entries/*.md` | Активные entries регрессии | Да |
| `regression/released/*.md` | Архив завершённых entries | Да |
| `regression/cancelled-features.md` | Решения об отменах | Да |
| `.maestro/sdd/*.md` | SDD progress (текучие) | Нет |
| `.maestro/last-run.md` | Свод запуска | Нет |
| `.maestro/logs/maestro-bootstrap-*.log` | Логи плагина | Нет |
| `.maestro/feedback-reports/*.md` | Отчёты фидбэка | Нет |
| `.maestro/plugin-version` | Версия загруженного плагина | Нет |

## 🔗 Связанные разделы

- [Кастомизация скилла](../how-to/customize-maestro.md)
- [Агенты и модель доверия](../explanation/agents-and-trust.md)
- [Плагин maestro-bootstrap](../reference/commands.md) (установка из `@maestro-init`)
- Техническая деталь: `plugins/maestro-bootstrap/core.js` (loadMaestroConfig,
  resolveFileAccess, resolveSanitizeOptions)
