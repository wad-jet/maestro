---
title: Implementation plan — implementer report reliability (5.5.1)
date: 2026-10-05
author: maestro-auto
---

# Implementation Plan: implementer report reliability

## Файлы

- `skills/maestro/implementer-prompt.md` — self-check блок
- `skills/maestro/references/model-selection.md` — scope haiku
- `skills/maestro/SKILL.md` — строка/указатель в шаге 13 (при изменении —
  обновить line-count в AGENTS.md)
- `manual_docs/overview/changelog.md` — секция 5.5.1
- `manual_docs/reference/model-selection.md` — scope haiku (если отражает таблицу)
- версия 5.5.0 → 5.5.1: package.json, package-lock.json, docs/project-context.md,
  AGENTS.md, docs/roadmap.md, TODO.md
- `regression/entries/2026-10-05-implementer-report-reliability.md` — новый

## Задачи

### T1: implementer-prompt.md + model-selection.md

1. `implementer-prompt.md` — блок «Self-check перед отчётом (обязателен)»
   (5 пунктов по спеке), вставить рядом с контрактом отчёта (L80-88),
   согласованно с существующим evidence-правилом; английский/русский — как в
   файле (мешаный: headings — как есть).
2. `references/model-selection.md` — L24 (tier-таблица) и L38 (маппинг):
   scope haiku «без структурных markdown-правок (таблицы/списки/мульти-вставки)»;
   строка обоснования (факт 5.4.0 vs 5.5.0).

**Коммит:** `docs(skill): implementer self-check contract + haiku scope (5.5.1)`

### T2: SKILL.md шаг 13 + docs sync + bump 5.5.1

1. `SKILL.md` шаг 13 — указатель/строка на scope-правило (минимально;
   при изменении line-count — обновить AGENTS.md `(~1204 строк, 5.5.x)`).
2. `manual_docs/reference/model-selection.md` — scope haiku (проверить,
   отражает ли tier-таблицу; если да — синхронизировать).
3. `changelog.md` — секция 5.5.1.
4. Bump 5.5.1 (package.json, package-lock.json, project-context, AGENTS.md,
   roadmap + закрытый пункт).
5. `regression/entries/2026-10-05-implementer-report-reliability.md`:
   сценарии — `npm test` 0 fail; grep «Self-check» implementer-prompt.md ≥ 1;
   grep «markdown» в scope-строке model-selection.md; версии 5.5.1.

**Коммит:** `chore: bump 5.5.1 + docs sync + regression entry`

## Порядок

1. T1 → task review (sonnet) + evidence-проверка
2. T2 → evidence-проверка (docs, npm test)
3. Final review (reviewer) по дифу ветки
4. Гейт 17 (HITL STOP) → merge ff → ветка удаляется

## Валидация

- `npm test` — 0 fail (docs-drift)
- Ручной чек: текст self-check в implementer-prompt.md; scope haiku в
  model-selection.md и manual_docs-зеркале
