# maestro-bootstrap

Плагин для OpenCode: **глобальная observability** (не привязан к агенту).
Раньше инжектил bootstrap-директиву в сессии агента `maestro`; после ухода от
агента (2026-08-18) инжекция удалена — скилл `maestro` вызывается через команду
`@maestro` в любой primary-сессии. Плагин остаётся для логирования ключевых
событий и (в перспективе, Этап 2) санитайзинга task-промптов.

## Что делает

- Логирует вызовы `task`-тула (диспатч субагентов) — ядро observability.
- Логирует ошибки/повторы сессий (`session.error`, `session.status.retry`).
- Детектит пустой результат субагента (`tool.execute.after.empty_result`).
- (Этап 2) Санитайзинг промптов `task` — отдельная задача
  (см. `SECURITY-REVIEW-PLAN.md`).

Плагин **глобальный** — не фильтрует по агенту, работает во всех сессиях.

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

Детальное логирование `bash`/`skill`/`read` убрано (сокращение observability).

Настройки через переменные окружения:

| Переменная | Значение | По умолчанию |
|---|---|---|
| `MAESTRO_BOOTSTRAP_LOG_LEVEL` | `debug` \| `info` \| `warn` \| `error` | `info` |
| `MAESTRO_BOOTSTRAP_LOG_MASK` | список включённых уровней через запятую | выводится из `LOG_LEVEL` |
| `MAESTRO_BOOTSTRAP_LOG_DIR` | каталог для лог-файлов | `<project>/.maestro` |

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