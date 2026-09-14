---
version: 1
feature: memory-summarizer-resolve
added: 2026-09-14
status: active
risk: medium
scenarios:
  - path: plugins/maestro-bootstrap/memory/resolve-model.js
    run: node --test plugins/maestro-bootstrap/memory/resolve-model.test.js
    workdir: .
  - path: plugins/maestro-bootstrap/memory/config.js
    run: node --test plugins/maestro-bootstrap/memory/config.test.js
    workdir: .
  - path: plugins/maestro-bootstrap/memory/indexer.js
    run: node --test plugins/maestro-bootstrap/memory/indexer.test.js
    workdir: .
  - path: plugins/maestro-bootstrap/memory/index.js
    run: node --test plugins/maestro-bootstrap/memory/index.test.js
    workdir: .
  - path: plugins/maestro-bootstrap
    run: npm test
    workdir: .
---

# Регрессия: memory-summarizer-resolve

BREAKING-фича (4.0.0): zero-key резолв модели саммаризации из
opencode-конфига (`small_model → model → agent.maestro/build`), удаление
ключа `memory.summarizer_model`, fail-closed guard на git-пути
`memory_reindex`.

Ключевые риски:
- degenerate/невалидные model-ссылки не доходят до `session.prompt` (I6);
- git-батч не стартует без резолвленной модели (I1', 0 LLM);
- `summarize.js` побайтово не изменён — промпт и `model` (не `agent`)
  в `session.prompt` (I2');
- legacy-ключ инертен (I5): нет warn/детекта/override;
- SEC-4b: только enum'ы (`reason`, `model_source`) и effective-модель.
