---
title: "Feedback report cost (5.5.0) - стоимость сессии на нативном cost opencode"
date: 2026-10-05
type: feature
severity: low
scope: skills/maestro-feedback-report, manual_docs
fixed: true
---

# Feedback report cost (5.5.0)

## Суть

Feedback-отчёт (`@maestro-feedback-report`) показывает стоимость сессии:
колонка «Стоимость» в таблице агентов «Итоговой статистики», `cost: $X.XX` в
строке primary, строка «Итого (primary + агенты)».

Механизм - **нативный cost opencode**: цены объявляются в конфиге opencode
(`provider.<id>.models.<name>.cost`, `{input, output, cache_read?, cache_write?}`,
$/1M токенов, формат models.dev), opencode считает cost per-message/сессию,
`timeline.mjs` агрегирует `metrics.cost` (`available` / `primaryUsd` /
`byAgent` / `totalUsd` / `note`). В репо/плагине нет сети, ключей и
прайс-карт. Модель без блока `cost` - «дефис» (`available: false`, если cost
нет ни у primary, ни у агентов).

## Сценарии воспроизведения/проверки

- a) `node --test skills/maestro-feedback-report/timeline.test.mjs` → 48/48
- b) `npm test` → 0 fail (включая docs-drift)
- c) `grep -c "Стоимость" skills/maestro-feedback-report/SKILL.md` → ≥ 2
- d) ручной: новый сеанс opencode (после применения cost-блоков в конфиге
  `~/.config/opencode/opencode.json` или проектного и перезапуска) →
  `timeline.mjs` → `metrics.cost.available: true`, отчёт с заполненной
  колонкой «Стоимость» (как включить - `manual_docs/how-to/enable-cost-tracking.md`)

## Изменённые файлы

- `skills/maestro-feedback-report/timeline.mjs` - `metrics.cost` (агрегация
  `info.cost` primary + `data.info.cost` child-экспорта; `87a2712`)
- `skills/maestro-feedback-report/timeline.test.mjs` - 6 новых тестов (48 всего)
- `skills/maestro-feedback-report/SKILL.md` - шаблон отчёта: колонка
  «Стоимость», «Итого (primary + агенты)», источник цен (`9461574`)
- `manual_docs/how-to/enable-cost-tracking.md` - новый (формат цен, где взять
  цены, перезапуск, эффект)
- `manual_docs/overview/changelog.md` - секция 5.5.0
- `manual_docs/index.md` - запись в оглавлении
- версия 5.5.0: `package.json`, `package-lock.json`, `docs/project-context.md`,
  `AGENTS.md`, `docs/roadmap.md` (закрытый пункт #30)

## Версия

5.5.0 (коммиты `87a2712`, `9461574` + docs/bump-коммит с этим entry)
