# Regression — plugin-adapter-hooks

- **version:** 1
- **feature:** адаптер maestro-bootstrap пробрасывает хуки core в opencode (tool/tool.execute/chat.message)
- **added:** 2026-09-09
- **status:** active
- **last_full_pass:** —
- **risk:** HIGH
- **category:** plugin adapter (ИБ-хуки: sanitizer / access_policy / confidential / memory tools)
- **scenarios:**
  - **adapter forwards core hooks** (`plugins/maestro-bootstrap/index.js` — default export возвращает `{..._mbHooks, config, startup}`, не только `{config,event,startup,dispose}`):
    - run: `node --test plugins/maestro-bootstrap/index.test.js`
    - workdir: `/Users/odemidov/Documents/dev/github/maestro-agent`
  - **memory plugin tests** (memory tools + memory_stats_detail не регрессируют):
    - run: `npm run test:memory`
    - workdir: `/Users/odemidov/Documents/dev/github/maestro-agent`
  - **[Manual] ИБ-хуки в реальной сессии:** после релиза перезапустить opencode (инвалидировать `~/.cache/opencode/packages/maestro-bootstrap@git+https:`), `.maestro/plugin-version` = 3.0.3; при task-диспатче в `.maestro/logs/maestro-bootstrap-<дата>.log` появляются `tool.execute.before/after`; санитайзер/access_policy/confidential снова активны.
  - **[Manual] memory tools в toolset:** в новой сессии `memory_stats_detail` доступен; `@maestro-memory-report` создаёт HTML-отчёт; `@maestro-memory` показывает статус.
