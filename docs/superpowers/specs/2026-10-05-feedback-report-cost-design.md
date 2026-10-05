---
title: feedback-report cost — стоимость сессии в «Итоговой статистике»
date: 2026-10-05
author: maestro-auto
status: approved (v3, правка по решению пользователя 2026-10-05)
---

# feedback-report: стоимость сессии (5.5.0)

## Суть (v3 — нативный cost opencode)

Фидбек-отчёт maestro показывает токены, но не деньги. Решение — **нативный
механизм opencode**: конфиг opencode поддерживает `cost` у модели
(`provider.<id>.models.<name>.cost {input, output, cache_read, cache_write}`,
$/1M токенов — формат models.dev, поле подтверждено в схеме конфига
`opencode.ai/config.json`). Opencode сам считает стоимость каждого сообщения
и сохраняет её в данные сессии (поле `cost`) — `timeline.mjs` уже суммирует
`msgInfo.cost` (строка ~325), просто у провайдера `akash` цены не были
объявлены → `null` → «провайдер без прайсинга».

**В репо: нет сети, нет ключей, нет pricing.json, нет скрипта обновления.**
Плагин/скрипты не получают доступ к `auth.json` — требование пользователя
(обсуждение v1→v3: прямой доступ к ключу исключён полностью).

## Изменения

### 0. Разовое действие на машине пользователя (выполнено, вне репо)

`~/.config/opencode/opencode.json` → cost-блоки для моделей `akash` (значения
из `GET /v1/models` ×1e6, $/1M; 2026-10-05):
- `Qwen/Qwen3.8-27B`: in 0.225 / out 1.98 / cache 0.05
- `Qwen/Qwen3.6-35B-A3B`: in 0.1 / out 0.9 / cache 0.05
- `openai/gpt-oss-120b`: in 0.037 / out 0.187 / cache 0.037
- `openai/gpt-oss-20b`: in 0.02 / out 0.1 (без cache)
- `zai-org/GLM-5.3`: in 0.117 / out 3.96 / cache 0.26
- `GLM-5.2`, `DeepSeek-V4-Flash-0731` — не в текущем списке `/v1/models`,
  cost не объявлен (отчёт покажет «—»)

Вступает после перезапуска opencode. При изменении прайса akash — руками
обновить конфиг (редко).

### 1. `skills/maestro-feedback-report/timeline.mjs` — `metrics.cost`

- Primary: уже суммирует `msgInfo.cost` (`costSeen`/`costSum`) — вынести в
  `metrics.cost = { available, totalUsd, primaryUsd, byAgent, note }`.
- Агентские buckets (`metrics.tokensByAgent`) — добавить суммирование `cost`
  из child-экспорта (defensive: `typeof === "number"`).
- `available: true` только если хотя бы primary OR агенты имели cost;
  `totalUsd = primaryUsd + Σ byAgent`; `note` — источник («cost, рассчитанный
  opencode по config-прайсингу модели»), при `available: false` — «цены моделей
  не объявлены в конфиге opencode (provider.models.*.cost)».
- Детерминизм: без Date/random; round 6 знаков.

### 2. Шаблон отчёта `skills/maestro-feedback-report/SKILL.md`

- L292 (строка primary): `cost: <$X | —>` — из `metrics.cost` (не provider-
  `cost`), формат `$X.XX`.
- Таблица «Токены по агентам» (L293+): колонка **Стоимость** + строка
  **Итого (primary + агенты): $X.XX**.
- Примечание: источник цен — `cost` в конфиге opencode (models.dev-формат,
  $/1M); нет цен → «—».
- Строка источника метрик: пометка «cost: нативный opencode (config)».

### 3. Тесты (`timeline.test.mjs`)

- cost суммируется: primary + агенты = total; без cost → `available: false`;
  детерминизм; round; child-экспорт без cost не ломает buckets.

### 4. Docs + версия

- `manual_docs/overview/changelog.md` — секция 5.5.0.
- `manual_docs/how-to/enable-cost-tracking.md` (новый) — как объявить `cost`
  в конфиге opencode (формат, $/1M, перезапуск, источники цен).
- Bump **5.4.0 → 5.5.0**: `package.json`, `package-lock.json`,
  `docs/project-context.md`, `AGENTS.md`, `docs/roadmap.md`, `TODO.md`.
- `regression/entries/2026-10-05-feedback-report-cost.md`.

## Критерии приёмки

1. `npm test` + `node --test timeline.test.mjs` — все зелёные.
2. `metrics.cost` корректен на синтетике (с cost / без cost).
3. Новый сеанс opencode (после перезапуска) несёт `msgInfo.cost` — проверяется
   при регенерации отчёта (срез #5).
4. Шаблон отчёта: колонка Стоимость + итог + примечание.
5. Версии синхронны (docs-drift 0).

## История правок

- v1: update-pricing.mjs читает auth-хранилище — отклонено (доступ к ключу).
- v2: keyless-скрипт + curl-запрос агентом (ключ — shell-интерполяция) —
  отклонено: есть нативный механизм opencode.
- **v3 (утверждено): нативный cost opencode; в репо — только агрегация и
  шаблон отчёта.**
