---
title: Implementation plan — feedback-report cost (5.5.0, v3)
date: 2026-10-05
author: maestro-auto
status: approved
---

# Implementation Plan: feedback-report cost (v3 — нативный cost opencode)

## Суть

Cost считает **opencode нативно** (config `provider.*.models.*.cost`, $/1M).
В репо — только агрегация (`timeline.mjs`) и шаблон отчёта. Нет сети, ключей,
pricing.json, скриптов обновления. Конфиг-акция (cost-блоки в
`~/.config/opencode/opencode.json`) выполнена до старта (v3, approved).

## Формат данных (подтверждён)

- Экспорт сессии (`opencode export <id>`): top-level `info.cost` (число, USD)
  + `messages[].info.cost`. Primary-код уже суммирует per-message (L325).
- Child-экспорт той же формы → `data.info.cost` (агрегат) — fixture L211 теста.

## Файлы

- `skills/maestro-feedback-report/timeline.mjs` — `metrics.cost`
- `skills/maestro-feedback-report/timeline.test.mjs` — cost-тесты
- `skills/maestro-feedback-report/SKILL.md` — шаблон (колонка Стоимость, итог)
- `manual_docs/overview/changelog.md` — секция 5.5.0
- `manual_docs/how-to/enable-cost-tracking.md` — **новый**
- версия 5.4.0 → 5.5.0: `package.json`, `package-lock.json`,
  `docs/project-context.md`, `AGENTS.md`, `docs/roadmap.md`, `TODO.md`
- `regression/entries/2026-10-05-feedback-report-cost.md` — **новый**

## Задачи

### T1: timeline.mjs — metrics.cost + тесты

**Файлы:** `timeline.mjs`, `timeline.test.mjs`

1. Agent-buckets (L388): добавить `cost: 0, costSeen: false`.
2. Child-обработка (L407-414):
   `const cc = data && data.info && data.info.cost;
    if (typeof cc === "number" && isFinite(cc) && cc > 0) { b.cost += cc; b.costSeen = true; }`
3. После L429 (`metrics.tokensByAgent = agentBuckets`):
   ```js
   const byAgentCost = {};
   let agentCostSum = 0;
   for (const [agent, b] of Object.entries(agentBuckets)) {
     if (b.costSeen) { byAgentCost[agent] = round6(b.cost); agentCostSum += b.cost; }
   }
   const primaryCost = costSeen ? costSum : null;
   metrics.cost = {
     available: primaryCost !== null || agentCostSum > 0,
     primaryUsd: primaryCost === null ? null : round6(primaryCost),
     byAgent: byAgentCost,
     totalUsd: (primaryCost === null && agentCostSum === 0) ? null
       : round6((primaryCost || 0) + agentCostSum),
     note: "cost, рассчитанный opencode по provider.*.models.*.cost в конфиге opencode ($/1M токенов)",
   };
   ```
   (`round6 = (x) => Math.round(x * 1e6) / 1e6` — helper рядом с metrics.)
4. `metrics.tokens.cost` (L355) не трогать (provider-совместимость).
5. Тесты (fixture-режим, как существующие):
   - child с `info.cost` → bucket `costSeen`, `metrics.cost.byAgent` populated,
     `totalUsd = primary + agents`
   - child без `info.cost` → bucket cost 0/not seen, не ломает
   - сессия без cost везде → `available: false`, `totalUsd: null`
   - детерминизм: два прогона fixture — равные JSON
   - round6: 0.0000004999 → 0.0000005

**Коммит:** `feat(feedback-report): metrics.cost — агрегация нативного cost opencode`

### T2: Шаблон отчёта (SKILL.md)

**Файл:** `skills/maestro-feedback-report/SKILL.md`

1. L163 (описание поля `cost`) — уточнить: источник — нативный cost opencode.
2. L292 (строка primary): `cost: <$X | — (цены моделей не объявлены в конфиге opencode)>`,
   формат `$X.XX` (2 знака), данные — `metrics.cost`.
3. L293+ (таблица «Токены по агентам»): колонка **Стоимость** (`$X.XXXX`) +
   строка **Итого (primary + агенты): $X.XX** (`metrics.cost.totalUsd`).
4. Примечание под таблицей: источник цен — `provider.<id>.models.<name>.cost`
   в конфиге opencode (формат models.dev, $/1M); без объявления → «—»;
   см. how-to `enable-cost-tracking`.
5. Строка источника метрик: «cost: нативный opencode (config)».

**Коммит:** `docs(feedback-report): cost column in report template`

### T3: docs sync + bump 5.5.0 + regression

**Файлы:** changelog, how-to, версия, roadmap, TODO.md, regression entry

1. `manual_docs/how-to/enable-cost-tracking.md` (новый): как объявить `cost`
   (формат, $/1M, пример для openai-совместимого провайдера, перезапуск
   opencode, где взять цены, эффект на TUI и отчёт maestro).
2. `changelog.md` — секция 5.5.0 (feat + how-to).
3. Bump 5.4.0 → 5.5.0 (package.json, package-lock.json, project-context,
   AGENTS.md, roadmap «Текущая версия» + закрытый пункт).
4. `regression/entries/2026-10-05-feedback-report-cost.md`: сценарии —
   `node --test timeline.test.mjs` зелёный; `npm test` (docs-drift 0);
   `grep -c "Стоимость" skills/maestro-feedback-report/SKILL.md` ≥ 2;
   ручной чек на новом сеансе (после перезапуска) — `metrics.cost.available: true`.

**Коммит:** `chore: bump 5.5.0 + regression entry + how-to enable-cost-tracking`

## Порядок

1. T1 → task review (sonnet) + evidence-проверка оркестратором
2. T2 → task review + evidence-проверка
3. T3 → evidence-проверка (docs)
4. Final review (reviewer) по дифу ветки
5. Гейт 17 (HITL STOP) → merge ff → ветка удаляется

## Валидация (конец)

- `npm test` — 0 fail (включая docs-drift)
- `node --test skills/maestro-feedback-report/timeline.test.mjs` — 0 fail
- Регенерация отчёта (срез #5) — в новом сеансе (после перезапуска opencode):
  `metrics.cost.available: true`, колонка Стоимость заполнена
