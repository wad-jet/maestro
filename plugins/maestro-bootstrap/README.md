# maestro-bootstrap

Плагин для OpenCode, который гарантирует, что сессии агента `maestro`
начинаются с директивы загрузить скил `maestro` и следовать pipeline из
SKILL.md. Решает проблему «модель не загружает скил»: инжекция происходит на
уровне opencode (hook `experimental.chat.messages.transform`), а не через
рекомендацию в system prompt.

## Что делает

- Инжектит bootstrap-директиву в **первое user-сообщение** каждой сессии,
  где активный агент — `maestro`.
- Другие сессии (другие агенты, обычный chat) не затронуты.
- Защита от повторной инжекции через маркер `FMAESTRO_BOOTSTRAP_V1`.
- Тихая деградация: любая ошибка логируется и не ломает сессию.
- Логирование решений в файл (см. раздел «Логирование»).

## Логирование

Плагин пишет JSONL-лог каждого решения в `.maestro/` (каталог
gitignored, создаётся автоматически). Логи **разбиваются по дням** — один файл
на дату, что упрощает будущую ротацию:

```
.maestro/maestro-bootstrap-2026-08-01.log
.maestro/maestro-bootstrap-2026-08-02.log
```

Формат строки:

```json
{"ts":"<ISO>","level":"info|debug|warn|error","msg":"...", "sessionID":"...", "agent":"..."}
```

Что логируется:

- `plugin initialized` — загрузка плагина (info)
- `transform: bootstrap injected` — инжекция выполнена (info)
- `transform: marker already present, skip` — анти-дубль сработал (debug)
- `transform: agent mismatch, skip` — агент не `maestro` (debug)
- `transform: no user message / no messages, skip` — нечего обрабатывать (debug)
- `transform: error` — исключение в хуке (error)

Настройки через переменные окружения:

| Переменная | Значение | По умолчанию |
|---|---|---|
| `MAESTRO_BOOTSTRAP_LOG_LEVEL` | `debug` \| `info` \| `warn` \| `error` | `debug` |
| `MAESTRO_BOOTSTRAP_LOG_DIR` | каталог для лог-файлов | `<project>/.maestro` |

Пример чтения свежего лога:

```bash
tail -f .maestro/maestro-bootstrap-$(date +%F).log | jq -r '.ts + " " + .level + " " + .msg'
```

### Логирование туловых операций

Плагин логирует ключевые этапы работы агента `maestro` (загрузка скиллов,
диспатч субагентов, запуск тестов/сборки/линта, коммиты) через хуки
`chat.params` + `tool.execute.before/after`. Логируются **только сессии
агента `maestro`** — сессии других агентов не затронуты.

Что логируется:

- `tool.execute.before` — вызов тула (info для `skill`/`task`/`bash`, debug для прочих)
- `tool.execute.after` — завершение тула + `durationMs` + `title` результата
- `chat.params` — фиксация маппинга сессия → агент (внутренний, не пишется в лог)

Пример строк:

```json
{"ts":"...","level":"info","msg":"tool.execute.before","sessionID":"...","callID":"...","tool":"bash","command":"npm run test:unit"}
{"ts":"...","level":"info","msg":"tool.execute.after","sessionID":"...","callID":"...","tool":"bash","durationMs":31250,"command":"npm run test:unit","title":"Test Suites: 45 passed"}
```

### Логирование проблем субагентов и модели

Плагин фиксирует сбои в работе субагентов и прерывания модели (только для
сессий агента `maestro`) через хук `event` и детект пустого результата:

- `session.error` — ошибка/прерывание модели (warn): `errorType` (например
  `message_aborted` — прерывание, `api_error`, `provider_auth`,
  `message_output_length`) + `errorMessage`
- `session.status.retry` — перезапрос модели (warn): `attempt` + `message`
- `tool.execute.after.empty_result` — субагент вернул пустой результат
  (warn): `tool` = `task` без `title`/`output`/`metadata`

Пример строк:

```json
{"ts":"...","level":"warn","msg":"session.error","sessionID":"...","errorType":"message_aborted","errorMessage":"Aborted by user"}
{"ts":"...","level":"warn","msg":"session.status.retry","sessionID":"...","attempt":2,"message":"rate limit"}
{"ts":"...","level":"warn","msg":"tool.execute.after.empty_result","sessionID":"...","callID":"...","tool":"task"}
```

Тесты плагина запускаются встроенным runner-ом Node:

```bash
node --test plugins/maestro-bootstrap/index.test.js
```

или из каталога плагина:

```bash
npm test
```

## Установка

Плагин уже зарегистрирован в `opencode.json` (корень репо):

```json
"plugin": [
  "./plugins/maestro-bootstrap/index.js"
]
```

Перезапустите opencode, чтобы плагин подхватился.

## Как проверить

1. Запустите `opencode` и выберите агента `maestro` (или вызовите
   `@maestro`).
2. Отправьте любое сообщение.
3. Проверка: в контексте первого user-сообщения присутствует маркер
   `FMAESTRO_BOOTSTRAP_V1` и текст директивы.

Отрицательные проверки:

- В сессии с другим агентом маркера нет.
- В обычной сессии (агент не задан) маркера нет.

## Требования

- OpenCode с поддержкой hook `experimental.chat.messages.transform`.
- Файл подключается как ESM (`"type": "module"` в `package.json`).
