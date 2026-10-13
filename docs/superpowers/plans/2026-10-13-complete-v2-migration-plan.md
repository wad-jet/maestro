# Plan: Complete V2 Migration of maestro-bootstrap Plugin

## Цели
Починить V2-совместимость плагина: security-функции (merge-guard, sanitizer, confidential control), memory-пайплайн, все тулы.

## Задачи SDD

### Задача 1: core.js — session API, tool hooks, filePathOf, execute returns
**Модуль**: `plugins/maestro-bootstrap/core.js`
- `resolveIsTrustedSubagent`: `{ path: { id } }` → `{ sessionID }`, `messages` → `context`
- `makeMaestroConfigTool.guard`: same session API fix
- `execute.before`: `event.output.args` → `event.input`, `"bash"` → `"shell"`, `"task"` → `"subagent"`
- `filePathOf`: `args.filePath` → `args.path`
- `execute.after`: `event.output` → `event.status`/`event.result`/`event.error`
- `makeMaestroConfigTool` execute: return `{ content: [...] }` instead of bare string

### Задача 2: communication.js + feedback-report.js — session API, system injection
- `isEligible`: `{ path: { id } }` → `{ sessionID }`
- System-инжекты → `{ type: "text", text }`

### Задача 3: memory/index.js — session API, tool results, system injection
- Все `session.get/messages/delete/list` → V2
- `session.list` → no-op + warn (не существует в V2)
- Execute returns → `{ content: [...] }`
- System-инжекты → `{ type: "text", text }`

### Задача 4: memory/indexer.js, backfill.js, summarize.js — session API
- `session.get/messages/delete/create/prompt` → V2

### Задача 5: тесты — mocks → V2 contract
- `memory/index.test.js`: session API mocks, tool hook mocks
- `index.test.js`: session API mocks, tool hook mocks
- `merge-guard.test.js`: event format → V2

### Задача 6: dogfood config + delivery/docs
- `.opencode/opencode.json`: убрать V1 `plugin`
- `maestro-install.sh`/`maestro-update.sh`: V2 format
- `maestro-setup/SKILL.md`: V2 format
- `manual_docs/`: V2 format
- `README.md`: V2 format
- `agents/*.md`: V2 frontmatter

## Коммиты
- `fix(plugin): complete V2 migration — session API, tool hooks, structured content`
- `test(plugin): rewrite mocks to V2 contract`
- `docs: update delivery for V2 plugin format`
- `chore(release): bump to 5.6.4 — V2 migration complete`

## Оценка
~6 задач. При параллельном выполнении (sonnet + haiku) — 1-2 итерации.
