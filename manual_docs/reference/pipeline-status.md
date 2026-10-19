# Pipeline Status Indication

[Назад к оглавлению](../index.md)

## Overview

When the maestro pipeline is active, a status block is injected into the agent's
system prompt showing the current pipeline step. Users can also query status
at any time via the `maestro_pipeline_status` tool.

## System Prompt Block

Format: `## maestro pipeline: active (step X/Y, Description)`

При `active: true` — блок показывает: «пайплайн активен, шаг X/Y, Описание».
Пример: `## maestro pipeline: active (step 7/18.5, Feature Classification)`.

When idle: `## maestro pipeline: idle`

## Tool: maestro_pipeline_status

### Parameters

| Parameter | Type | Required | Description |
|---|---|---|---|
| `action` | string | yes | `set`, `clear`, or `get` |
| `step` | integer | set | Current step number |
| `totalSteps` | integer/string | set | Total steps (supports `"18.5"` format for pipeline steps 0–18.5) |
| `description` | string | set | Step description |

### Examples

Set: `maestro_pipeline_status(action: "set", step: 7, totalSteps: "18.5", description: "Feature Classification")`

Get: `maestro_pipeline_status(action: "get")`

Clear: `maestro_pipeline_status(action: "clear")`

### Access Control

- `set`/`clear`: only from top-level primary sessions.
- `get`: available from any session.

## Progression warning (6.2.0)

`set` с forward-прыжком через канонические шаги возвращает non-blocking-ответ:

`{"ok": true, "warning": "step_jump", "skipped": ["7", "8", …]}`

- `skipped` — полный канонический список шагов между предыдущим
  (`lastStep`) и новым; каноническая последовательность: `-1, 0, 1, 1.5, 2,
  3, 4, 5, 6, 7, 7b, 7d, 8, 8.5, 8.6, 9, 10, 10b, 11, 12, 12a, 13, 13f, 14,
  15, 15a, 16, 17, 18, 18.5`. Substeps (`7b`/`7d`/`10b`/`12a`) — отдельные
  элементы канонической последовательности; сравнение — в полной нотации:
  warning только при ≥1 промежуточном шаге в полном списке (соседство по
  полному списку — без warning: `7d` → `8`, `10b` → `11`, `12a` → `13`;
  `7` → `8` — warning, `skipped: ["7b","7d"]`).
- Backward-переход, повтор того же шага и `clear` — без warning; первый
  `set` после `clear` — без warning (новый прогон).
- Неизвестный (не канонический) шаг — без warning + запись в лог;
  статус-трекер (`lastStep`) при этом **не обновляется**.
- **Обязанность оркестратора:** на `warning: "step_jump"` ОБЯЗАТЕЛЬНА одна
  строка в чат — обоснование skip-path по канону (напр. «шаги 8–12 не
  выполняются: простая фича, маршрут через гейт 7b») или откат к
  пропущенному шагу.
- Известное ограничение: трекер прогрессии — глобальный (per-process, не
  per-session): при параллельных сессиях maestro warning может сработать из-за
  `set`-вызовов другой сессии.
