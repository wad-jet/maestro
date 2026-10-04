---
title: Implementation plan — maestro-setup scope refinement
date: 2026-10-04
author: maestro-auto
---

# Implementation Plan: maestro-setup scope refinement

## Файлы

- `skills/maestro-setup/SKILL.md` — сокращение с 545 до ~100 строк
- `skills/maestro-design/SKILL.md` — мягкое предусловие + новый шаг context
- `skills/maestro/SKILL.md` — шаг 0 не-блокирующий
- `docs/superpowers/specs/2026-10-04-maestro-setup-scope-refinement-design.md` — spec (не меняется)
- `docs/superpowers/plans/2026-10-04-maestro-setup-scope-refinement-plan.md` — этот файл
- `regression/entries/2026-10-04-maestro-setup-scope.md` — regression entry (создать)
- `docs/roadmap.md` — статус P1.4 → закрыт

## Задачи

### T1: maestro-setup/SKILL.md — редизайн (~100 строк)

**Файл:** `skills/maestro-setup/SKILL.md`

1. Убрать полный опрос project-context из SKILL.md
2. Оставить указатель на `init-context.md` для процедуры опроса
3. Задача 2 → опциональный финальный шаг (context optional)
4. Задача 3 (конфиг) → убрать JSON-примеры, оставить указатель на maestro-assistant
5. Явно указать дефолты для конфига (не требующие context)
6. Убрать placeholder-запись project-context.md
7. Сохранить: pre-flight, git- branching, суперпаверы чек, плагин чек, завершение
8. Добавить статус `context: deferred` в last-run.md при skip

### T2: maestro-design/SKILL.md — мягкое предусловие + context step

**Файл:** `skills/maestro-design/SKILL.md`

1. Предусловие 0: заменить жёсткий gate на warning (не блокировать)
2. Новый шаг "Project Context" — если project-context.md отсутствует, предложить опрос
3. При skip — НЕ создавать placeholder, отметить в last-run.md

### T3: maestro/SKILL.md — шаг 0 не-блокирующий

**Файл:** `skills/maestro/SKILL.md` (pipeline step 0)

1. "Если файла нет: HITL-диалог для создания" → warning + skip option
2. Определить поведение auto-режимов: auto-answer/auto-ai → auto-skip
3. Warning перечисляет что теряется: §14 (команды), §3 (версионирование), §9 (built-in критерии)

### T4: docs sync + regression

**Файлы:**
- `manual_docs/tutorials/setup-project.md` — обновить описание flow
- `manual_docs/reference/commands.md` — обновить описание /maestro-setup
- `docs/roadmap.md` — P1.4 → закрыт
- `regression/entries/2026-10-04-maestro-setup-scope.md` — новый entry

### T5: тесты

**Файлы:**
- regression entry
- targeted-тест: "указатели на init-context.md и maestro-assistant резолвятся"
- docs-drift.test.mjs — обновить fixtures если нужно

## Порядок выполнения

1. T1 (maestro-setup редизайн)
2. T2 (maestro-design расширение)
3. T3 (maestro SKILL.md шаг 0)
4. T4 (docs sync)
5. T5 (тесты)

## Оценка

M (средняя сложность) — 5 задач, 3+ файла, без новых зависимостей.
Не breaking: существующие проекты не ломаются (project-context остаётся рекомендуемым).
