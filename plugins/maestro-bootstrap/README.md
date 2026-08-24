# maestro-bootstrap

Плагин для OpenCode: **глобальная observability + санитайзинг промптов +
file access control** (не привязан к агенту). Скилл `maestro` вызывается через
команду `/maestro` в любой primary-сессии; инжекция директивы в сессии агента
удалена (уход от агента, 2026-08-18).

## Что делает

- **Санитайзинг промптов `task`** (Уровень 1 Security Review): маскирует
  чувствительные данные (env-secrets, поля данных, `.env`, DB/SFTP credentials,
  ledger) ДО отправки промпта в сабагента. Авто, без HITL. **Trusted сабагенты
  (maestro.json → `trust`) — skip** (получают промпт как есть).
- **File access control** (Уровень 3): перехват `read` по правилам
  `maestro.json` → `access_policy`. `allow` → пропуск, `ask` → блокировка (HITL
  решает оркестратор), `deny` → жёсткий блок. **`bash`/`glob`/`grep` НЕ
  покрываются** — для них нативные permissions OpenCode.
- Логирует вызовы `task`-тула (диспатч субагентов) — observability.
- Логирует ошибки/повторы сессий (`session.error`, `session.status.retry`).
- Детектит пустой результат субагента (`tool.execute.after.empty_result`).

Плагин **глобальный** — не фильтрует по агенту, работает во всех сессиях.

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

## File access control (access-policy)

Секция `access_policy` в `maestro.json` (см. ниже).
Определяет, к каким файлам сабагенты могут обращаться без запроса через `read`:

```json
{
  "version": 1,
  "default": "ask",
  "allow": ["src/**", "test/**"],
  "ask": ["docs/**", "*.config.*"],
  "deny": ["*.env", "*.{pem,key,cert}"]
}
```

- `default` — действие для несовпавших путей: `allow` | `ask`.
- `allow` — без запроса; `ask` — требует HITL; `deny` — жёсткий блок.
  Приоритет: `deny` > `ask` > `allow` > `default`.
- Контролируется **только `read`**. `bash`/`glob`/`grep` НЕ покрываются
  (bash-пути ненадёжно извлекаются; glob/grep — паттерны) — используйте нативные
  permissions OpenCode (`bash: ask` и т.п.).
- Файл `maestro.json` (секция `access_policy`) формируется сабагентом
  `sanitizer` (по структуре проекта/стеку) или вручную. Полный JSON-канон и правила — в
  скилле `maestro-assistant` (`skills/maestro-assistant/SKILL.md`).
- Если файла нет — плагин НЕ блокирует (fail-open), полагаясь на нативные
  permissions OpenCode.
- Плагин **НЕ форсирует** `file_access` OpenCode (не задаёт `config.file_access`)
  — нативные permissions остаются в силе. Плагин управляет только `read` через
  `access_policy` (см. выше); `bash`/`glob`/`grep` — нативные permissions.
- Trusted сабагенты (maestro.json → `trust`) — file access control применяется для
  всех; trusted-skip полный требует верификации перехвата child-сессий (C2).

### Секция `confidential`

Закрывает конфиденциальные пути (дефолт `docs/confidential/**`) для `read`/
`write`/`edit` от всех, кроме trusted-субагентов. Primary и untrusted — жёсткий
deny; trusted читает по умолчанию (`trusted.read: allow`), пишет по явному
`trusted.write`/`trusted.edit: allow`. Строже `access_policy` и имеет приоритет.
Идентичность отправителя определяется через `client.session.get` +
`session.messages` (детект по `parentID` и имени агента). Подробнее —
`manual_docs/reference/config.md`.

`confidential.paths` принимает папки, отдельные файлы по полному имени и по
маске, включая корневую папку. Сегментная семантика: `**` = 0+ сегментов
(покрывает корень), `*`/`?` — в пределах одного сегмента (не через `/`), маска
без `/` (напр. `*.env`) закрывает только корневые файлы. В отличие от
`access_policy` (где `*` пересекает `/`), в `confidential` маска сегментная.

## Аудит-лог

Security-фактура по доступу пишется в **отдельный аудит-лог**
`.maestro/logs/maestro-audit-<date>.log` (JSONL, один файл на день):

- `confidential.access` — доступ к confidential-путям: `action: "allow"` (trusted-
  субагент читал/писал, уровень `info`) или `action: "deny"` (блокировка для
  untrusted/primary, уровень `warn`). Включает `agent` (имя trusted-агента) и
  `target` (только `basename`, SEC-5).
- `access_policy.blocked` — блокировка файла по `access_policy` (`ask`/`deny`),
  уровень `warn`.

Структура записи (JSON):

```json
{"ts":"<ISO>","level":"info|warn","msg":"confidential.access|access_policy.blocked","sessionID":"...","callID":"...","tool":"read|write|edit","action":"allow|deny","agent":"<trusted-агент>|null","target":"<basename>"}
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
    "design": true,
    "sanitizer": true
  },
  "access_policy": {
    "version": 1,
    "default": "ask",
    "allow": ["src/**", "test/**"],
    "ask": ["docs/**", "*.config.*"],
    "deny": ["*.env", "*.{pem,key,cert}"]
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
- **`access_policy`** — file access control (см. раздел выше).
- **`sanitizer_whitelist`** — правила sanitizer (см. раздел выше).

### Разрешение конфигов (resolution order)

`maestro.json` — **единственный** источник конфигурации. Все три секции
(`trust`, `access_policy`, `sanitizer_whitelist`) читаются из него одним
загрузчиком `loadMaestroConfig()`.

Порядок разрешения пути к файлу:

1. **Env override** — `MAESTRO_CONFIG` (путь к `maestro.json`).
2. **По умолчанию** — `<project>/maestro.json`.

Старые файлы `trust-config.json`, `.maestro/access-policy.json`,
`.maestro/sanitizer-whitelist.json` **не поддерживаются** (не читаются).

Если `maestro.json` отсутствует — плагин работает (fail-open): все агенты
untrusted, access-policy не enforced, дефолтные sanitizer-правила.

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
```

Формат строки (bootstrap-лог):

```json
{"ts":"<ISO>","level":"info|debug|warn|error","msg":"...", "sessionID":"...", "callID":"..."}
```

Что логируется:

- `plugin initialized` — загрузка плагина (info)
- `tool.execute.before` — вызов `task`-тула (info)
- `tool.execute.after` — завершение `task` + `durationMs` (info)
- `tool.execute.after.empty_result` — субагент вернул пустой результат (warn)
- `session.error` — ошибка/прерывание модели (warn)
- `session.status.retry` — перезапрос модели (warn)
- `sanitizer.redacted` — замаскировано N чувствительных элементов в промпте task (warn)

Security-события доступа (`confidential.access`, `access_policy.blocked`) в
bootstrap-лог **не пишутся** — они только в аудит-логе (см. раздел «Аудит-лог»).

Детальное логирование `bash`/`skill`/`read` убрано (сокращение observability).

Настройки через переменные окружения:

| Переменная | Значение | По умолчанию |
|---|---|---|
| `MAESTRO_BOOTSTRAP_LOG_LEVEL` | `debug` \| `info` \| `warn` \| `error` | `info` |
| `MAESTRO_BOOTSTRAP_LOG_MASK` | список включённых уровней через запятую | выводится из `LOG_LEVEL` |
| `MAESTRO_BOOTSTRAP_LOG_DIR` | каталог для лог-файлов (по умолчанию `<project>/.maestro/logs`) | `<project>/.maestro/logs` |
| `MAESTRO_AUDIT_LOG_DIR` | каталог для аудит-лога `maestro-audit-*.log` | `<project>/.maestro/logs` |
| `MAESTRO_CONFIG` | путь к maestro.json (консолидированный конфиг) | `<project>/maestro.json` |

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
    "./plugins/maestro-bootstrap/index.js"
  ]
}
```

В обоих случаях перезапустите opencode, чтобы плагин подхватился.

## Требования

- OpenCode с поддержкой hooks `tool.execute.before/after`, `event`.
- Плагин грузится как ESM — корневой `package.json` репозитория задаёт
  `"type": "module"` (плагин ставится из git через `main` → `plugins/maestro-bootstrap/index.js`).