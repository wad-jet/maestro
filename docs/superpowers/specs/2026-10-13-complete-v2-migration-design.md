# Spec: Complete V2 Migration of maestro-bootstrap Plugin

## Задача

Плагин `maestro-bootstrap` v5.6.3 заявлен как V2-совместимый, но в V2-рантайме **не выполняет ни одной функции**: все тулы падают (execute возвращает голую строку), security-защиты — no-op (чтение `event.output.args` вместо `event.input`), session-вызовы — V1-формат, tool-имена — V1 (`bash`/`task` вместо `shell`/`subagent`).

## Исходные данные

- V1-формат клиентских вызовов (17+ call-sites): `{ path: { id } }` вместо `{ sessionID }`, `session.messages` / `session.delete` / `session.list` — не существуют в V2 SessionContext
- Tool-хуки читают `event.output.args` — в V2 это **`event.input`**
- Tool-имена в коде: `bash`/`task` — в V2: `shell`/`subagent`
- `filePathOf` ждёт `args.filePath` — в V2: `path`
- Execute возвращает голую строку — в V2: `{ content: [...] }` (confirmed live: `"output" in a` throws TypeError)
- System-инжекты голыми строками — в V2: `{ type: "text", text }`
- Тесты кодируют V1-контракт — маскируют все регрессии
- Дубликат регистрации плагина: V1 `plugin` + V2 `plugins` → V2-запись FAILS "Duplicate plugin ID"
- Delivery/installers документируют V1-формат

## Требования (из opus REJECT verdict)

### T1. Execute → structured content
Все tool execute handlers должны возвращать `{ content: [{type:"text",text}] }`, не голую строку.
Файлы: `core.js` (makeMaestroConfigTool), `memory/index.js` (all memory tools).

### T2. Tool hooks → V2 event format
- `execute.before`: читать `event.input` (не `event.output.args`)
- `execute.after`: читать `event.status`/`event.result`/`event.error` (не `event.output`)
- Tool-имена: `tool === "shell"` / `tool === "subagent"` (не `bash`/`task`)
- `filePathOf`: `args.path` (не `args.filePath`)

### T3. Session API → V2 contract
- `session.get({ sessionID })` (не `{ path: { id } }`)
- `session.context({ sessionID })` (не `session.messages({ path: { id } })`)
- `session.remove({ sessionID })` (не `session.delete({ path: { id } })`)
- `session.create({ title })` (не `{ body: { title } }`)
- `session.prompt({ sessionID, text })` (не `{ path, body }`)
- `session.list` — не существует. Решение: заменить на no-op + log warn

### T4. System injection → structured
- `event.system.push({ type: "text", text })` (не голую строку)
- Все места: communication.js, memory/index.js

### T5. Tests → V2 contract
- Mock-клиент: `session.get({ sessionID })`, `session.context({ sessionID })`, etc.
- Tool hooks mock: `event.input` вместо `event.output`
- Ассерты на V2-форму аргументов и возврата
- Удалить V1-мок-обёртки или изолировать с маркером удаления

### T6. Dogfood config: убрать дубликат `plugin`
Удалить V1-ключ `plugin` из `.opencode/opencode.json`, оставить только `plugins`.

### T7. Live smoke до релиза
- `maestro_config` возвращает config (не denied)
- `memory_search` работает (не error)
- `memory_probe` работает
- Confidential deny/allow для trusted-сабагентов
- Merge-guard deny без маркера

### T8. Delivery/docs → V2 format
- `maestro-install.sh`: `plugins`-формат + `package`-object
- `maestro-update.sh`: аналогично
- `skills/maestro-setup/SKILL.md` задача 5: проверка `plugins`
- `manual_docs/how-to/install-maestro.md`: V2 format
- `manual_docs/how-to/update-maestro.md`: V2 format
- `manual_docs/reference/config.md`: V2 format
- `README.md`: plugin section V2

### T9. Agent frontmatter (nice-to-have)
Миграция `permission:` с `bash`/`task` → `permissions:` с `shell`/`subagent` (V2 format).

## Файлы для изменений

### Критичные (security + functionality)
- `plugins/maestro-bootstrap/core.js` — session API, tool hooks, filePathOf, execute returns
- `plugins/maestro-bootstrap/communication.js` — session API, system injection
- `plugins/maestro-bootstrap/feedback-report.js` — session API
- `plugins/maestro-bootstrap/memory/index.js` — session API, tool results, system injection
- `plugins/maestro-bootstrap/memory/indexer.js` — session API
- `plugins/maestro-bootstrap/memory/backfill.js` — session API
- `plugins/maestro-bootstrap/memory/summarize.js` — session API

### Тесты
- `plugins/maestro-bootstrap/memory/index.test.js` — mocks → V2
- `plugins/maestro-bootstrap/index.test.js` — mocks → V2
- `plugins/maestro-bootstrap/merge-guard.test.js` — event format → V2

### Конфиг / доставка
- `.opencode/opencode.json` — убрать V1 `plugin`
- `maestro-install.sh` — V2 format
- `maestro-update.sh` — V2 format
- `skills/maestro-setup/SKILL.md` — V2 format
- `manual_docs/` — V2 format
- `README.md` — V2 format

### Опционально
- `agents/*.md` — V2 frontmatter
- `.opencode/package.json` — убрать V1-зависимость

## Критерии приёмки
- Все unit-тесты `node --test plugins/maestro-bootstrap/index.test.js` проходят
- Live-вызовы в V2-рантайме: `maestro_config` возвращает config, `memory_search` работает, `memory_probe` работает
- Security: merge-guard deny без маркера (не молча allow), confidential deny для untrusted
- Нет V1 API вызовов в коде (grep на `path:.*id` и `event.output` = 0)
- Changelog обновлён, версия bumped (patch → 5.6.4)
