---
title: feedback-report cost — стоимость сессии в «Итоговой статистике»
date: 2026-10-05
author: maestro-auto
status: draft
---

# feedback-report: стоимость сессии (5.5.0)

## Суть

Фидбек-отчёт maestro показывает токены, но не деньги: `cost: — (провайдер без
прайсинга)`. Провайдер (AkashML) отдаёт цены детерминированно — `GET
https://api.akashml.com/v1/models` возвращает `pricing` (per token: `input`,
`output`, `input_cache_read`, `request`) — «always authoritative» по
pricing-гайду. Фича: расчёт стоимости сессии (primary + child-агенты) и
колонка **Стоимость** в таблице «Итоговая статистика» отчёта.

## Формула (akashml.com/docs/guides/pricing)

```
cost = input_tokens × input
     + cached_tokens × input_cache_read   (отсутствует поле → полный input-rate)
     + output_tokens × output
     + request
```

- Нет cache-write fee; кеш только удешевляет.
- **Reasoning-токены:** гайд не упоминает; считаются **по output-ставке**
  (практика OpenAI/Anthropic). Допущение фиксируется в отчёте.
- Учёт opencode: `input` — некэшированные, `cacheRead` — отдельный бакет
  (поэтому `input − cacheRead` не вычитается).
- **API отдаёт list-цены**; промо-скидки из доков (10% для Qwen3.8-27B/GLM-5.3
  на момент 2026-10-05) в API не отражены → стоимость может завышаться на
  величину активного промо. Замечание — в отчёт.

## Изменения

### 1. `skills/maestro-feedback-report/update-pricing.mjs` (новый)

- ESM, без зависимостей. `GET /v1/models` (Bearer-ключ — из auth-хранилища
  opencode `~/.local/share/opencode/auth.json`, записи `akash`/`akash-ml`;
  ключ НЕ пишется никуда, в логах только маска `xxxx…(len=N)`).
- Запись `pricing.json` рядом со скриптом:
  `{ "source": "https://api.akashml.com/v1/models", "fetchedAt": "<ISO>",
     "models": { "<modelId>": { "input": <num>, "output": <num>,
     "input_cache_read": <num>?, "request": <num> } } }` — per-token числа
  как в API (только текстовые модели с `pricing.input/output > 0`).
- **Fail-soft:** нет ключа / сеть / HTTP ≠ 200 → warn-сообщение, exit 0,
  старый `pricing.json` не трогается. CLI: `--out <path>` (default — рядом),
  `--check` (только показать свежесть, ничего не писать).

### 2. `skills/maestro-feedback-report/timeline.mjs` — блок `metrics.cost`

- Читает `pricing.json` (relative к скрипту). **Без сети** — детерминизм.
- Расчёт: primary (input/cacheRead/output+reasoning по сессионной модели) +
  по каждому агенту (input/output, модель из `models[]`; reasoning/cache у
  child не агрегируются — пометка в note).
- Вывод: `metrics.cost = { available: bool, totalUsd, primaryUsd,
  byAgent: { <agent>: { model, usd } }, pricing: { source, fetchedAt },
  note }` (`note` — допущения: reasoning→output; list-цены vs промо;
  «—» при `available: false`).
- Нет `pricing.json` / модель не найдена → `available: false` (или partial +
  note), отчёт рендерится как сейчас (`cost: —`).

### 3. Шаблон отчёта `skills/maestro-feedback-report/SKILL.md`

- «Итоговая статистика»: строка primary — `cost: $X.XX` (или «—»);
  таблица «Токены по агентам» — колонка **Стоимость** (`$X.XXXX`); строка
  **Итого (primary + агенты): $X.XX**.
- Источник цен: `pricing.json` (source + fetchedAt) — в строку источника
  метрик.
- Новый шаг генерации: «если `pricing.json` отсутствует или старше 30 дней →
  прогнать `update-pricing.mjs` (fail-soft, отчёт не блокируется)».
- Примечание под таблицей: формула + допущения (reasoning→output,
  list-цены vs промо).

### 4. Тесты (`timeline.test.mjs`)

- Стоимость: модель с cache-rate (кеш дешевле), модель без cache-rate
  (кеш = input-rate), reasoning по output-ставке, primary + агенты = total,
  модель отсутствует в pricing → partial/available:false, `pricing.json`
  отсутствует → `available: false`, детерминизм (два прогона — одно число).
- `update-pricing.mjs`: чистая функция парсинга API-ответа (синтетика) —
  отбор текстовых моделей, числа из строк, absence `input_cache_read`.

### 5. Docs + версия

- `manual_docs/overview/changelog.md` — секция 5.5.0.
- Bump **5.4.0 → 5.5.0**: `package.json`, `package-lock.json`,
  `docs/project-context.md`, `AGENTS.md` (версия), `docs/roadmap.md`, `TODO.md`.
- `regression/entries/2026-10-05-feedback-report-cost.md`.

## Критерии приёмки

1. `npm test` + `node --test timeline.test.mjs` — все зелёные (новые
   cost-тесты включены).
2. `node update-pricing.mjs` — создаёт `pricing.json` из живого API (fail-soft
   при отсутствии ключа/сети проверено синтетикой).
3. Прогон `timeline.mjs` по текущей сессии: `metrics.cost.available: true`,
   total ≈ расчёт вручную (primary ~$2.63, итог ~$2.78 при list-ценах).
4. Шаблон отчёта содержит колонку Стоимость + итог + примечание про формулу.
5. Версии синхронны (docs-drift 0).
