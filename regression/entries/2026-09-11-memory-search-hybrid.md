---
version: 1
feature: memory-search-hybrid
added: 2026-09-11
status: active
risk: medium
scenarios:
  - path: plugins/maestro-bootstrap/memory/storage/sqlite.js
    run: node --test plugins/maestro-bootstrap/memory/storage/sqlite.test.js
    workdir: .
  - path: plugins/maestro-bootstrap/memory/recall.js
    run: node --test plugins/maestro-bootstrap/memory/recall.test.js
    workdir: .
  - path: plugins/maestro-bootstrap/memory/index.js
    run: node --test plugins/maestro-bootstrap/memory/index.test.js
    workdir: .
  - path: plugins/maestro-bootstrap/memory
    run: npm run test:memory
    workdir: .
---

# Регрессия: memory-search-hybrid

Изменения в гибридном поиске memory layer: FTS OR-матчинг (sqlite), гибридный
auto-recall (FTS-нога с masked-запросом без плейсхолдеров), единый пост-фильтр
`min_score` после RRF-фьюжн, guard пустых фильтров, шапка результата. Верифицировать:

## Manual-сценарии
- `memory_search("отчёт память", scope: project)` — запись «Preview-сервер для
  @maestro-memory-report» присутствует в выдаче (ранее — recall gap из-за
  неявного AND в FTS).
- `memory_search` с пустым `author` и `date_to=0` — не возвращает «Ничего не
  найдено» (фильтры игнорируются).
- Вывод `memory_search`/`memory_recall_preview` — вторая строка
  `Найдено: N (порог min_score X, scope Y)`; пустой результат несёт порог/scope.
- При `min_score > 0.5` FTS-only хиты (display 0.5) не появляются в выдаче
  (единый пост-фильтр после RRF).
- Auto-recall на первом сообщении сессии может инжектить FTS-only хит
  (блок `## Контекст из памяти maestro`); полностью замаскированный запрос —
  short-circuit (блока нет).