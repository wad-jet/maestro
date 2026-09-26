---
description: Benchmark maestro: фиксированное задание в песочнице, отчёт прогона в .maestro/benchmark-reports/, сверка с прошлыми результатами
---

# @maestro-benchmark

Загрузи skill `maestro-benchmark` (tool: skill) и следуй фазам из SKILL.md.

## Фазы

`@maestro-benchmark <run|report|diff>`:

- **run** — подготовка песочницы (свежесть: state + agent_hash + источники +
  фикстура; stale → авто `--reset --benchmark`), показ канон задания и
  инструкции прогона (`@maestro-init --auto-answer "<задание>"` в `.sandbox/`).
- **report [session-id]** — сбор данных прогона (timeline.mjs, логи,
  артефакты, leak-скан), LLM-анализ конформности, отчёт
  `.maestro/benchmark-reports/benchmark-<ts>-v<ver>.{md,json}`, автосверка с
  прошлым прогоном, сброс песочницы.
- **diff [old.json]** — явная сверка последнего отчёта с выбранным прошлым
  (`diff.mjs`, 0 LLM); таблица дельф в чат.

**Язык:** все HITL-вопросы, варианты и сообщения — только на русском.
