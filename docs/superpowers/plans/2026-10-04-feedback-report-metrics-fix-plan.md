---
title: Implementation plan — Feedback-report metrics fix (U2+U3) + machine-readable layer + review table (U6+U8)
date: 2026-10-04
author: maestro-auto
---

# Implementation Plan: Feedback-report metrics fix

## Файлы

- `skills/maestro-feedback-report/timeline.mjs` — основная логика
- `skills/maestro-feedback-report/SKILL.md` — шаблон отчёта
- `skills/maestro-feedback-report/timeline.test.mjs` — тесты

## Задачи

### T1: timeline.mjs — humanizer + разделение метрик

**Файл:** `skills/maestro-feedback-report/timeline.mjs`

1. Добавить функцию `formatMs(ms)` — унифицированный humanizer:
   - `< 60_000` → `X сек`
   - `< 3_600_000` → `X мин Y сек`  
   - `>= 3_600_000` → `X ч Y мин`
   - `null` → `—`

2. Добавить в metrics-блок:
   - `machineActiveMs` = `toolTimeMs + inferenceMs`
   - `hitlWaitMs` = `idleWaitMs`
   - `userIdleMs` = `sessionDurationMs - (toolTimeMs + inferenceMs + idleWaitMs)` (если >= 0)

3. Добавить `validation`:
   ```js
   validation: {
     totalMs: sessionDurationMs,
     sum: machineActiveMs + hitlWaitMs,
     delta: Math.abs(sessionDurationMs - (machineActiveMs + hitlWaitMs))
   }
   ```

4. Заменить все `.toolTimeMs` / `.inferenceMs` / `.idleWaitMs` на humanizer в stdout (если используем stdout как источник метрик)

### T2: timeline.mjs — reviewCycles

**Файл:** `skills/maestro-feedback-report/timeline.mjs`

1. В цикле по messages, для task-диспатчей с «review»/«ревью» в title:
   ```js
   const REVIEW_RE = /\breview\b|ревью/i;
   // уже есть, но расширить:
   // добавить titleShort = st.title.slice(0, 80)
   ```

2. Собрать `reviewCycles: [{ round, titleShort }]`

3. Добавить в metrics: `reviewCyclesCount` = `reviewCycles.length`

### T3: timeline.mjs — history.jsonl update

**Файл:** `skills/maestro-feedback-report/timeline.mjs`

1. При записи в history.jsonl добавить новые поля:
   - `machineActiveMs`
   - `hitlWaitMs`
   - `reviewCyclesCount`

### T4: SKILL.md — обновить шаблон отчёта

**Файл:** `skills/maestro-feedback-report/SKILL.md`

1. Секция «Метрики пайплайна и Effort» → обновить структуру:
   - Новая таблица/блок: machine-active / HITL-wait / user-idle с процентами
   - Блок self-validation
   - Humanizer: всегда «X ч Y мин»

2. Новая секция «Циклы ревью»:
   - Таблица: раунд → title (shortened) → статус
   - Если reviewCyclesCount > 0 → таблица, иначе «Нет данных по ревью»

3. Обновить источник метрик:
   - «Источник: `metrics`-блок `timeline.mjs` (0 LLM) + bootstrap-лог»
   - Добавить: «или из `.maestro/metrics/history.jsonl` (upsert по sessionID, единый источник)»

### T5: timeline.test.mjs — тесты

**Файл:** `skills/maestro-feedback-report/timeline.test.mjs`

1. Тест `formatMs`:
   - 0 → `0 сек`
   - 50_000 → `50 сек`
   - 90_000 → `1 мин 30 сек`
   - 7_200_000 → `2 ч 0 мин`
   - null → `—`

2. Тест `machineActiveMs` = `toolTimeMs + inferenceMs`

3. Тест `hitlWaitMs` = `idleWaitMs`

4. Тест `validation.delta == 0` при корректных данных

5. Тест `reviewCycles` — подсчёт task-диспатчей с «review»

6. Тест history.jsonl — upsert по sessionID, новые поля

### T6: docs sync

**Файлы:**
- `manual_docs/reference/config.md` — если меняются ключи метрик
- `manual_docs/how-to/feedback-report.md` — обновление описания отчёта
- `docs/roadmap.md` — обновить статус P0.2/P0.3
- `TODO.md` — обновить статус
- `manual_docs/overview/changelog.md` — добавить entry

## Порядок выполнения

1. T1 (humanizer + метрики)
2. T2 (reviewCycles)
3. T3 (history.jsonl)
4. T4 (SKILL.md template)
5. T5 (тесты)
6. T6 (docs sync)

Коммиты: per-task, формат `feat: ...`

## Оценка

M (средняя сложность) — 6 задач, все в 2-3 файлах, без новых зависимостей.
