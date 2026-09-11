---
version: 3
feature: memory-report-commit-nodes
added: 2026-09-11
status: active
risk: medium
scenarios:
  - path: plugins/maestro-bootstrap/memory/index.js
    run: node --test plugins/maestro-bootstrap/memory/index.test.js
    workdir: .
  - path: plugins/maestro-bootstrap/memory/index.test.js
    run: npm run test:memory
    workdir: .
---

# Регрессия: memory-report-commit-nodes

Формат вывода `memory_stats_detail` расширен (additive): секции `Узлы графа (M):`
и `Граф (рёбер: N):` теперь по commit-узлам (центроиды), счётчик рёбер — число
commit-рёбер. Верифицировать:

## Manual-сценарии
- `@maestro-memory` продолжает показывать «Кластеры / граф: <кол-во кластеров>,
  <кол-во связей>» (счётчики из заголовков `Кластеры:` / `Граф (рёбер: N):`).
- `@maestro-memory-report` рендерит commit-граф: узлы `h:<12 hex>`/`s:<prefix>`,
  ветки (merged-узлы → имя mainline; невлитые → своя рабочая ветка; удалённые
  feature-ветки не показываются), бейджи ×N, цвета тиров, легенда + таблица узлов;
  секции 3.1–3.4 не изменились.
- `memory_stats_detail`: записи одного `head` — один узел (sessions=N); head=''
  — unattributed-узлы по сессии; узел без эмбеддингов — изолированный (без рёбер).
  Строка узла: `first=`/`last=` (даты) и `clusters=` (cluster-id) между `tier=`
  и `session_ids=`; темы кластеров сопоставляются по `cluster-N` из секции «Кластеры:».
- При `include_text: false` в HTML нет titles/summary/decisions (только агрегаты).
- `@maestro-memory-report` поднимает preview-сервер (127.0.0.1, state
  `.maestro/preview-server.json`); остановка `--stop <state-файл>`;
  `memory.report.preview: false` — без сервера, только HTML.