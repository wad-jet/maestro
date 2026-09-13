---
version: 1
feature: memory-reindex-backfill
added: 2026-09-12
status: active
risk: medium
scenarios:
  - path: plugins/maestro-bootstrap/memory/config.js
    run: node --test plugins/maestro-bootstrap/memory/config.test.js
    workdir: .
  - path: plugins/maestro-bootstrap/memory/backfill.js
    run: node --test plugins/maestro-bootstrap/memory/backfill.test.js
    workdir: .
  - path: plugins/maestro-bootstrap/memory/summarize.js
    run: node --test plugins/maestro-bootstrap/memory/summarize.test.js
    workdir: .
  - path: plugins/maestro-bootstrap/memory/index.js
    run: node --test plugins/maestro-bootstrap/memory/index.test.js
    workdir: .
  - path: plugins/maestro-bootstrap/memory
    run: npm run test:memory
    workdir: .
  - path: plugins/maestro-bootstrap
    run: npm test
    workdir: .
---

# Регрессия: memory-reindex-backfill

Новая фича (v3.5.0): HITL-инструмент `memory_reindex` + команда
`@maestro-memory-reindex` — бэкфилл `artifacts[]` по старым записям (light-путь,
0 LLM) и синтез записей памяти из git-истории по спекам/коммитам
(LLM-summarize, маркер `author: "git-backfill"`, RI-1..RI-9).

Ключевые риски:
- light-путь не должен менять identity-поля (RI-3/RI-4) и писать в state;
- git-синтез: идемпотентность (RI-7), re-mask LLM-вывода до embed (RI-6),
  fail-closed `skip_confidential` (resolved-набор);
- `summarizeSession` без `instructions` — промпт побайтово неизменён.

Спека: docs/superpowers/specs/2026-09-12-memory-reindex-backfill-design.md
План: docs/superpowers/plans/2026-09-12-memory-reindex-backfill-plan.md
