---
title: Feedback-report metrics fix (U2+U3) + machine-readable layer + review table (U6+U8)
date: 2026-10-04
author: maestro-auto
status: draft
---

# Feedback-report: починить метрики и машиночитаемый слой

## Суть

Починить feedback-report: разделить «активное время» на machine-active / HITL-wait / user-idle, добавить self-validation агрегатов, единый humanizer, рендер метрик из history.jsonl, таблица ревью-вердиктов вместо нарратива.

## Проблемы

**U2 — разделение активного времени:**
- `timeline.mjs:320`: `activeMs = sessionDurationMs - idleWaitMs` — всё в одну кучу
- 99.4% «активно» при 18ч, внутри 8ч HITL-вопросов
- Нужно разделить: `machineActiveMs = toolTimeMs + inferenceMs`, `hitlWaitMs = idleWaitMs`, `userIdleMs` (отдельно)

**U3 — калибровка effort:**
- Микс единиц «179 сек / 62.4 мин / 518 мс» — нет единого humanizer
- Нет self-validation: `toolTimeMs + inferenceMs` != `activeMs`, но отчёт не проверяет
- Нужно: единый humanizer + блок self-validation с delta

**U6 — машиночитаемый слой:**
- `history.jsonl` уже пишется (timeline.mjs:424-450), но отчёт рендерит из stdout timeline.mjs
- Нужно: рендерить метрики из history.jsonl (upsert по sessionID), единый источник

**U8 — таблица ревью-вердиктов:**
- `reviewDispatches` = механический regex-хэвистика (завышен: 62 vs ~20)
- «Циклы ревью» = `reviewDispatches` + LLM нарратив из диалога
- Нужно: структурированный `reviewCycles[]` + таблица в отчёте

## Изменения

### timeline.mjs

1. **Метрики: разделение active time**
   - Добавить `machineActiveMs` = `toolTimeMs + inferenceMs` (фактическая машинная работа)
   - Переименовать/добавить в metrics: `hitlWaitMs` = `idleWaitMs` (ожидание пользователя)
   - `activeMs` = `machineActiveMs + hitlWaitMs` (wall - user idle)

2. **Self-validation**
   - Добавить `validation`: `{ totalMs, sum: machineActiveMs + hitlWaitMs, delta }`
   - Если delta != 0 — warn в stderr

3. **Humanizer**
   - Функция `formatMs(ms)` → строка: `X ч M мин` (округление вниз)
   - Для < 60 сек: `X сек`
   - Использовать везде вместо ручных вычислений

4. **Review cycles**
   - Пройти по task-диспатчам, собрать `reviewCycles: [{ round, title, status }]`
   - `round` = номер по порядку диспатчей с «review» в title
   - `title` = shortened (первые 80 символов)
   - `status` = «review» (из title) или определить из контекста
   - Добавить `actualReviewCount` вместо `reviewDispatches`

5. **history.jsonl**
   - Уже пишется, но добавить поля: `machineActiveMs`, `hitlWaitMs`, `reviewCyclesCount`
   - Ensure consistent format

### SKILL.md (feedback-report)

1. **Секция «Метрики пайплайна и Effort»** — обновить:
   - Таблица: machine-active / HITL-wait / user-idle с процентами
   - Блок self-validation: delta между activeMs и sum
   - humanizer: всегда «X ч M мин»

2. **Таблица ревью-вердиктов**
   - Новая таблица: раунд → title → статус
   - Вместо: «механический ориентир — reviewDispatches; по ходу диалога...»

3. **Рендер из history.jsonl**
   - Если history.jsonl существует → читать из неё
   - Иначе fallback → stdout timeline.mjs

## Безопасность

- SEC-4b: все агрегаты, без raw-значений
- machineActiveMs/hitlWaitMs — агрегаты, не чувствительны
- reviewCycles — только shortened titles, без содержимого

## Тесты

- `timeline.test.mjs`:
  - `formatMs` — проверка округления
  - `machineActiveMs` = `toolTimeMs + inferenceMs`
  - `hitlWaitMs` = `idleWaitMs`
  - `validation.delta == 0` (при корректных данных)
  - `reviewCycles` — подсчёт task-диспатчей с «review»
  - history.jsonl — upsert по sessionID, добавленные поля

## Зависимости

- Не breaking: добавлены поля, существующие потребители не сломаются
- history.jsonl schema — backward-compatible
