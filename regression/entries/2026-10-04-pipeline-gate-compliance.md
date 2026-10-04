---
title: "P0.16 — Pipeline compliance: gate 17 HITL enforcement + version bump condition"
date: 2026-10-04
type: feature
severity: high
scope: skills/maestro/SKILL.md,skills/maestro/auto-ai-decision-prompt.md
fixed: true
---

# P0.16 — Pipeline compliance: gate 17 HITL + version bump condition

## Проблема

1. Простая фича (SDD path) в каноне не содержала явного указания что шаги 14–18.5 выполняются для всех категорий — оркестратор мог пропустить финальные шаги
2. Anti-patterns не запрещали явно merge/push в main без ветки и гейта 17
3. Шаг 18 (bump версии) не связывал явно условие с `project-context.md` §3 «Версионирование: да»
4. `auto-ai-decision-prompt.md` не содержал hard-rule для merge/push решений — auto-ai мог бы принимать их автономно
5. Нет детерминированного тест-гарда для проверки этих маркеров в каноне

## Решение

### T1: SKILL.md — явная пометка «после SDD шаги 14–18.5»
- В таблице Feature Classification строка «Простая фича» добавлена: `→ SDD (шаг 13) → **после SDD — шаги 14–18.5 для всех категорий**`

### T2: SKILL.md — Anti-patterns +2 строки
- «Merge/push в main без ветки и гейта 17 = нарушение ⚑1»
- «Завершать feature до шага 18.5, гейт 17 не пройден — запрещено»

### T3: SKILL.md шаг 18 — условие bump
- Добавлено условие: `если project context §3: Версионирование: да`

### T4: auto-ai-decision-prompt.md — hard-rule merge/push (⚑1)
- Правило 3: решения о merge/push всегда HITL_REQUIRED, никогда auto-accept

### T5: Test-гард (0 LLM)
- `checkD5()` в `docs-drift.test.mjs`: проверяет 4 маркера в SKILL.md и auto-ai-prompt
- Negative test: отсутствие любого маркера → fail

## Регресс-чек

- `npm test` (285/285) проходит
- `checkD5()` на реальном репо возвращает [] (все маркеры на месте)
- `checkD5()` на fixture без маркеров возвращает violations
- Gate 17 содержит «Всегда HITL (⚑1)»
- Step 18 содержит «Версионирование: да»
- Строка простой фичи содержит «14–18.5»
- auto-ai-decision-prompt.md содержит ⚑1 hard-rule для merge/push

## Изменённые файлы

- `skills/maestro/SKILL.md` — таблица категорий, Anti-patterns, шаг 18
- `skills/maestro/auto-ai-decision-prompt.md` — hard-rule merge/push (⚑1)
- `maestro-install/docs-drift.test.mjs` — checkD5 + fixtures
