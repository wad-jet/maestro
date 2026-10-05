---
title: Implementation plan — feedback-report cost (5.5.0)
date: 2026-10-05
author: maestro-auto
---

# Implementation Plan: feedback-report cost

## Файлы

- `skills/maestro-feedback-report/update-pricing.mjs` — **новый** (refresh pricing.json)
- `skills/maestro-feedback-report/pricing.json` — **новый** (коммитится; первичный снапшот из живого API)
- `skills/maestro-feedback-report/timeline.mjs` — блок `metrics.cost`
- `skills/maestro-feedback-report/timeline.test.mjs` — cost-тесты
- `skills/maestro-feedback-report/SKILL.md` — шаблон (колонка Стоимость, итог, шаг refresh, примечание)
- `manual_docs/overview/changelog.md` — секция 5.5.0
- версия 5.4.0 → 5.5.0: `package.json`, `package-lock.json`, `docs/project-context.md`,
  `AGENTS.md`, `docs/roadmap.md`, `TODO.md`
- `regression/entries/2026-10-05-feedback-report-cost.md` — **новый** entry
- spec/plan (этот файл) — не меняются после утверждения

## Задачи

### T1: update-pricing.mjs + pricing.json (первичный снапшот)

**Файлы:** `skills/maestro-feedback-report/update-pricing.mjs`, `skills/maestro-feedback-report/pricing.json`

1. Скрипт (ESM, без зависимостей):
   - ключ: `~/.local/share/opencode/auth.json` → запись `akash` (или `akash-ml`),
     поле `apiKey`; лог — только маска `aksh…(len=37)`
   - `GET https://api.akashml.com/v1/models` (Bearer), таймаут 30 c
   - чистая экспортная функция `parseModelsApi(responseJson)` →
     `{ "<id>": { input, output, input_cache_read?, request } }`:
     только модели с `pricing` и `Number(pricing.input) > 0 ||
     Number(pricing.output) > 0`; числа из строк; `input_cache_read` — только
     если поле present; `request` — Number (default 0)
   - запись: `{ source, fetchedAt: new Date().toISOString(), models }`,
     `--out <path>` (default: рядом со скриптом)
   - **fail-soft:** нет auth-файла/ключа, сетевая ошибка, HTTP ≠ 200, JSON-сбой →
     warn + exit 0, существующий pricing.json не трогаем
   - `--check`: показать source/fetchedAt/число моделей + «stale» если > 30 дней
2. Запустить скрипт → первичный `pricing.json` (живой API).
3. Тесты парсинга — в timeline.test.mjs (синтетика): отбор моделей, числа из
   строк, absence input_cache_read, request default.

**Коммит:** `feat(feedback-report): update-pricing.mjs + pricing.json snapshot`

### T2: timeline.mjs — metrics.cost

**Файл:** `skills/maestro-feedback-report/timeline.mjs`

1. Чтение `pricing.json` (relative к скрипту; `existsSync` → нет =
   `available: false`).
2. Экспортная чистая функция `computeCost({ primary, agents, pricing })` →
   `{ available, totalUsd, primaryUsd, byAgent, note }`:
   - формула: `in×input + cache×(input_cache_read ?? input) + (out+reasoning)×output + request`
     (request — 0 для всех текущих моделей, но формула учитывает)
   - primary: модель = `sessionModel` (из `normalizeModel(info.model)`);
     токены = mInput/mCacheRead/mOutput+mReasoning
   - агенты: по `metrics.tokensByAgent` (buckets уже имеют input/output/reasoning/
     cacheRead/models); модель — первая из `models[]` (несколько моделей в
     child → средняя цена некорректна: считать по первой, в note — пометка)
   - модель не найдена в pricing → `available: false` + note «модель X не в
     pricing.json» (или partial: посчитать найденные, total = null + note)
   - round: 6 знаков (USD); детерминизм — без Date/random
3. `metrics.cost = computeCost(...)` (provider-`cost` в `metrics.tokens.cost`
   не трогать).
4. Тесты: cache-rate vs no-cache-rate, reasoning→output, total = primary +
   agents, модель не найдена, pricing.json отсутствует, детерминизм.

**Коммит:** `feat(feedback-report): metrics.cost — расчёт стоимости по pricing.json`

### T3: Шаблон отчёта (SKILL.md)

**Файл:** `skills/maestro-feedback-report/SKILL.md`

1. L292 (строка primary): `cost: <$X | —>` → добавить
   `· стоимость: $X.XX (pricing.json, <fetchedAt>)` / `· стоимость: — (нет pricing.json)`.
2. L293+ (таблица «Токены по агентам»): колонка **Стоимость** + строка
   **Итого (primary + агенты): $X.XX**.
3. Примечание под таблицей: формула + допущения (reasoning по output-ставке;
   API — list-цены, промо-скидки доков не учитываются; cache без ставки =
   полный input-rate).
4. Генерация: новый шаг — «если `pricing.json` отсутствует или `fetchedAt`
   старше 30 дней → `node update-pricing.mjs` (fail-soft, отчёт не
   блокируется); после — перезапустить timeline.mjs».
5. Строка источника метрик — добавить `pricing: <source> (fetchedAt)`.

**Коммит:** `docs(feedback-report): cost column in report template + pricing refresh step`

### T4: docs sync + bump + regression

**Файлы:** changelog, версия, roadmap, TODO.md, regression entry

1. `changelog.md` — секция 5.5.0.
2. Bump 5.4.0 → 5.5.0 (package.json, package-lock.json, project-context,
   AGENTS.md, roadmap «Текущая версия», новый закрытый пункт + открытый? нет —
   фича закрыта в этом релизе).
3. `regression/entries/2026-10-05-feedback-report-cost.md`: сценарии —
   `node --test timeline.test.mjs` зелёный; `node update-pricing.mjs --check`
   работает; прогон по сессии → `metrics.cost.available: true`;
   `grep -c "Стоимость" skills/maestro-feedback-report/SKILL.md` ≥ 2.

**Коммит:** `chore: bump 5.5.0 + regression entry (feedback-report cost)`

## Порядок выполнения

1. T1 → task review (sonnet) + evidence-проверка
2. T2 → task review + evidence-проверка
3. T3 → task review + evidence-проверка
4. T4 → evidence-проверка (docs)
5. Final review (reviewer) по дифу ветки
6. Гейт 17 (HITL STOP) → merge ff → ветка удаляется
7. Регенерация отчёта (срез #5) со стоимостью

## Валидация

- `npm test` (включая docs-drift) — 0 fail
- `node --test skills/maestro-feedback-report/timeline.test.mjs` — 0 fail
- `node update-pricing.mjs --check` — свежий снапшот
- Прогон timeline.mjs по текущей сессии: `metrics.cost` populated, total ≈ $2.78 (list-цены)
