---
version: 1
feature: memory-artifact-links
added: 2026-09-12
status: active
risk: medium
scenarios:
  - path: plugins/maestro-bootstrap/memory/config.js
    run: node --test plugins/maestro-bootstrap/memory/config.test.js
    workdir: .
  - path: plugins/maestro-bootstrap/memory/artifacts.js
    run: node --test plugins/maestro-bootstrap/memory/artifacts.test.js
    workdir: .
  - path: plugins/maestro-bootstrap/memory/indexer.js
    run: node --test plugins/maestro-bootstrap/memory/indexer.test.js
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

# Регрессия: memory-artifact-links

Новая фича (v5.2): поле записи `artifacts[]` — repo-relative пути спек/планов,
извлечённые детерминированно из tool-частей (`write`/`edit`, status `completed`)
top-level сессии; allowlist `memory.artifact_globs` (default маэстро-набор);
рендер в recall-блоке / `memory_search` / `memory_recall_preview`. Верифицировать:

## Manual-сценарии
- `artifact_globs` default — `["docs/superpowers/specs/**", "docs/superpowers/plans/**"]`
  (идентичен в `DEFAULTS` config.js, каноне `maestro-assistant`, `manual_docs/reference/memory.md`).
- `artifact_globs: []` — явный off (артефакты не извлекаются); невалидный
  (не-массив / не-строка / пустая строка / >16) → память off `artifact_globs_invalid`.
- Сессия, писавшая `docs/superpowers/specs/*.md` (write/edit completed) → запись
  несёт `artifacts[]`; recall-блок показывает ` | Артефакты: …`; `memory_search`/
  `memory_recall_preview` — строка артефактов.
- Пустые `decisions` → ` | Артефакты: …` сразу после summary (без сегмента «Решения»).
- Файл артефакта удалён → в recall-блоке строки нет (existsSync-фильтр); в
  `memory_search`/`memory_recall_preview` — есть (без fs-фильтра).
- Чужой origin (кросс-доменный recall) → артефактов нет (origin-фильтр), даже
  если путь существует в текущем репо.
- Широкий glob `docs/**` + отсутствие секции `confidential` → пути
  `docs/confidential/**` и built-in (`*.env`) НЕ извлекаются (resolved-набор).
- Export → import round-trip сохраняет `artifacts` (и старые записи без поля →
  `[]`); import: невалидный `artifacts` (не-массив, элемент >512 символов /
  control chars, >8 элементов, путь с ведущим `/`, `..`-сегментом, backslash,
  drive-letter) → reject всей записи.
- Re-summarize: `artifacts = extract(...) ∪ existing.artifacts` (cap 8) — union
  не теряет пути после compaction.
- Remote-less репо / смена remote-URL → артефакты молча скрыты (graceful, B2).
