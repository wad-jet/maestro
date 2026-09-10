---
version: 1
feature: memory-namespace-related
added: 2026-09-10
status: active
risk: high
scenarios:
  - path: plugins/maestro-bootstrap/memory/config.js
    run: node --test plugins/maestro-bootstrap/memory/config.test.js
    workdir: .
  - path: plugins/maestro-bootstrap/memory/index.js
    run: node --test plugins/maestro-bootstrap/memory/index.test.js
    workdir: .
  - path: plugins/maestro-bootstrap/memory/storage/sqlite.js
    run: node --test plugins/maestro-bootstrap/memory/storage.test.js
    workdir: .
---

# Регрессия: memory-namespace-related

Breaking: обязательный namespace (без него — disabled `namespace_missing`); удаление
URL/hash-форм адресации. Верифицировать:

## Manual-сценарии
- enabled без namespace → disabled `namespace_missing` + logError + заметка в /maestro-init.
- `MyApp` → ключ `myapp` (нормализация trim+lowercase до валидации).
- Домен: сервис в `microservices.sales.*` видит merged-знания братьев; `domain_recall:false` — нет (related остаются).
- `related: ["microservices.sales.orders"]` — merged-only из API; `related: ["microservices.sales"]` — поддерево (родитель+братья).
- `memory_migrate from:auto` переносит легаси hash-бакет; max-version-wins; `from:auto` без remote → подсказка `from:<hash>`.
- prune: «чужой проект» (по `origin_project_hash`) помечен + исключён из batch-удаления.
- Коллизия: новый чужой origin → warn-once (persist seen-set); стабильный состав → info.
- init-warn `key_changed` при смене namespace (persist lastKey в per-project файле).