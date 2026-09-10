---
version: 1
feature: memory-branch-lifecycle
added: 2026-09-10
status: active
risk: high
scenarios:
  - path: plugins/maestro-bootstrap/memory/indexer.js
    run: node --test plugins/maestro-bootstrap/memory/indexer.test.js plugins/maestro-bootstrap/memory/index.test.js
    workdir: .
  - path: plugins/maestro-bootstrap/memory/index.js
    run: node --test plugins/maestro-bootstrap/memory/index.test.js
    workdir: .
  - path: plugins/maestro-bootstrap/memory/config.js
    run: node --test plugins/maestro-bootstrap/memory/config.test.js
    workdir: .
---

# Регрессия: memory-branch-lifecycle

Breaking change: `session.deleted` больше не удаляет запись памяти по умолчанию
(жизненный цикл — по git-якорю). Верифицировать:

## Manual-сценарии
- TUI-удаление сессии → запись выживает (флаг `delete_on_session_delete: false`).
- Флаг `true` (sqlite) → запись удаляется.
- Non-git проект → записи не создаются (write-gate по head), warn при init.
- `/maestro-memory-prune`: `list` → категории dead/unknown (кандидаты), local-only с host,
  squash/rebase-предупреждение; `delete` по явным session_ids/heads.
- Foreign-host записи на централизованных бэкендах исключены из batch-all.