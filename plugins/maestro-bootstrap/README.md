# maestro-bootstrap

Плагин для OpenCode: **глобальная observability + санитайзинг промптов +
file access control** (не привязан к агенту). Скилл `maestro` вызывается через
команду `@maestro` в любой primary-сессии; инжекция директивы в сессии агента
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
   `<redacted>`.
2. **Чувствительные поля данных** — расширенный список (финансовые: `amount`,
   `salary`, `iban`, `card_number`, `cvv`, `vat`, `total_amount` и т.д.; PII:
   `phone`, `email`, `inn`, `snils`, `passport` и т.д.) → `<redacted>`.
   Детект регистронезависим; `\w*`-суффиксы (`amountValue`, `amount_value`) и
   camelCase-варианты snake-полей (`cardNumber`) покрываются автоматически.
3. **Файлы .env / .env.\*** → `<redacted>`.
4. **SFTP/DB credentials** — URI-схемы (`postgres://`, `mysql://`, `ssh://`,
   `ldap://`, `clickhouse://` и др., регистронезависимо) с встроенными
   credentials, а также connection-string params `password=...`, `pwd=...` →
   `<redacted>`.
5. **Private keys** — PEM-блоки `-----BEGIN ... PRIVATE KEY-----`
   (регистронезависимо) → `<redacted>`.
6. **Auth headers** — `Authorization: Bearer ...`, `X-API-Key: ...` → `<redacted>`.
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
  `sanitizer` (по структуре проекта/стеку) или вручную. Пример — `examples/maestro.example.json`.
- Если файла нет — плагин НЕ блокирует (fail-open), полагаясь на нативные
  permissions OpenCode.
- Trusted сабагенты (maestro.json → `trust`) — file access control применяется для
  всех; trusted-skip полный требует верификации перехвата child-сессий (C2).

## Аудит-лог

События sanitizer пишутся в `.maestro/maestro-bootstrap-<date>.log` с маркерами
`sanitizer.redacted` (что замаскировано, без содержимого) и `access_policy.blocked`
(файл-доступ), наряду с observability-событиями.

Пример конфига: `examples/maestro.example.json`.

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

Плагин пишет JSONL-лог в `.maestro/` (каталог gitignored, создаётся
автоматически). Логи **разбиваются по дням** — один файл на дату, что упрощает
будущую ротацию:

```
.maestro/maestro-bootstrap-2026-08-01.log
.maestro/maestro-bootstrap-2026-08-02.log
```

Формат строки:

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
- `access_policy.blocked` — доступ к ask/deny-файлу заблокирован (warn)

Детальное логирование `bash`/`skill`/`read` убрано (сокращение observability).

Настройки через переменные окружения:

| Переменная | Значение | По умолчанию |
|---|---|---|
| `MAESTRO_BOOTSTRAP_LOG_LEVEL` | `debug` \| `info` \| `warn` \| `error` | `info` |
| `MAESTRO_BOOTSTRAP_LOG_MASK` | список включённых уровней через запятую | выводится из `LOG_LEVEL` |
| `MAESTRO_BOOTSTRAP_LOG_DIR` | каталог для лог-файлов | `<project>/.maestro` |
| `MAESTRO_CONFIG` | путь к maestro.json (консолидированный конфиг) | `<project>/maestro.json` |

`MAESTRO_BOOTSTRAP_LOG_LEVEL` — порог детализации (пишутся уровни `>=`
заданного). `MAESTRO_BOOTSTRAP_LOG_MASK` — явный список включённых уровней;
позволяет включать/выключать каждый тип **независимо**. Запись пишется при
**пересечении** двух условий: уровень входит в маску **и** не ниже порога.

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
tail -f .maestro/maestro-bootstrap-$(date +%F).log | jq -r '.ts + " " + .level + " " + .msg'
```

## Тесты

Тесты плагина запускаются встроенным runner-ом Node:

```bash
node --test plugins/maestro-bootstrap/index.test.js
```

или из каталога плагина:

```bash
npm test
```

## Установка

Плагин зарегистрирован в `opencode.json` (корень репо):

```json
"plugin": [
  "./plugins/maestro-bootstrap/index.js"
]
```

Перезапустите opencode, чтобы плагин подхватился.

## Требования

- OpenCode с поддержкой hooks `tool.execute.before/after`, `event`.
- Файл подключается как ESM (`"type": "module"` в `package.json`).