---
title: Implementation plan — improvements batch (5.4.0)
date: 2026-10-05
author: maestro-auto
---

# Implementation Plan: improvements batch (Р1 + Р2 + P4-check)

## Файлы

- `package.json` — `scripts.test` + 3 test-файла
- `maestro-install/test-coverage.test.mjs` — **новый** guard-тест
- `skills/maestro/SKILL.md` — шаг 13 п. d (evidence-верификация) + таблица «Обработка сбоев»
- `skills/maestro/implementer-prompt.md` — §Status Reporting (контракт DONE)
- `skills/maestro-assistant/SKILL.md` — канон P4-check (секция моделей)
- `skills/maestro-setup/SKILL.md` — Задача 3 «Плагин + модели» (запуск P4-check после M1)
- `manual_docs/how-to/choose-models.md` — пометка про P4-предупреждение в setup
- `manual_docs/overview/changelog.md` — секция 5.4.0
- `manual_docs/explanation/pipeline-overview.md` — строчка про evidence-верификацию
- `regression/entries/2026-10-05-improvements-batch.md` — **новый** entry
- `docs/superpowers/specs/2026-10-05-improvements-batch-design.md` — spec (не меняется после утверждения)
- `docs/superpowers/plans/2026-10-05-improvements-batch-plan.md` — этот файл
- версия 5.3.1 → 5.4.0: `package.json`, `package-lock.json`, `docs/project-context.md`,
  `AGENTS.md` (версия + `~N строк`), `docs/roadmap.md`, `TODO.md`

## Задачи

### T1: Р1 — тест-регистрация + guard

**Файлы:** `package.json`, `maestro-install/test-coverage.test.mjs` (новый)

1. `scripts.test`: добавить `skills/maestro-feedback-report/timeline.test.mjs`,
   `skills/maestro-benchmark/diff.test.mjs`, `skills/maestro-benchmark/sandbox-smoke.test.mjs`
2. Guard-тест (паттерн `agpack-coverage.test.mjs`):
   - обход `*.test.mjs`/`*.test.js` из корня (исключая `node_modules`, `.opencode`, `.sandbox`,
     `.maestro`)
   - каждый путь обязан встречаться в `scripts.test` или `scripts["test:memory"]`
     (подстрока или glob-совпадение; `test:memory` использует glob
     `'plugins/maestro-bootstrap/memory/**/*.test.js'` — учитывать)
   - незарегистрированный → failing с перечислением путей
   - allowlist: пустой массив в шапке (расширяется осознанно)
   - регистрация guard'а в `scripts.test`
3. Проверка: `npm test` — все зелёные; время прогона приемлемое (если `sandbox-smoke`
   медленный/нестабильный — HITL: carve-out в allowlist)

**Коммит:** `test: register forgotten test files in npm test + coverage guard`

### T2: Р2 — evidence-верификация implementer

**Файлы:** `skills/maestro/SKILL.md`, `skills/maestro/implementer-prompt.md`

1. `SKILL.md` шаг 13 п. d — после пункта «Каждый task после DONE проходит task-reviewer
   (spec compliance + code quality). Пропуск task review — anti-pattern.» добавить:
   - **Evidence-based верификация implementer:** после `DONE`, **до** task review,
     оркестратор сверяет отчёт по фактам: (1) заявленные коммиты существуют (`git log`);
     (2) заявленные тесты реально зелёные (фактический запуск команды из отчёта);
     (3) изменения в пределах task-брифа (diff vs brief). Расхождение → отчёт не
     принимается как DONE (нарушение контракта отчёта) — re-dispatch/фикс; task review
     не раньше согласования фактов.
2. `SKILL.md` «Обработка сбоев» — строка:
   | **Implementer: ложный DONE (факты ≠ отчёту)** | Evidence-перепроверка (git log, запуск тестов, diff vs task-бриф); отчёт не принимается как DONE; task review не раньше расхождения |
3. `implementer-prompt.md` §Status Reporting — после блока контракта: `DONE` валиден
   только с фактическим выводом **последнего** прогона тестов в `TEST_OUTPUT` (не «по
   памяти») и с реально сделанными коммитами в `COMMITS` (проверяется `git log`).

**Коммит:** `docs(skill): evidence-based verification of implementer DONE reports`

### T3: P4-check в setup/assistant

**Файлы:** `skills/maestro-assistant/SKILL.md`, `skills/maestro-setup/SKILL.md`,
`manual_docs/how-to/choose-models.md`

1. `maestro-assistant/SKILL.md` — в канон моделей (рядом со ссылкой на
   `manual_docs/reference/config.md`, «Агенты: модели»): правило **P4-check** — после
   выбора/актуализации моделей: если `trust.custodian`/`trust.sanitizer` = true и модель
   trusted-агента совпадает с моделью любого untrusted-агента (haiku/sonnet/opus/fable/
   reviewer) → неблокирующее предупреждение в сводке (SECURITY.md P4: trusted →
   изолированная/локальная модель).
2. `maestro-setup/SKILL.md` Задача 3 «Плагин + модели» — после M1/temperature: «P4-check
   по канону maestro-assistant: совпадение моделей trusted/untrusted → предупреждение в
   сводке (не блокирует)».
3. `choose-models.md` — в P4-секцию: «/maestro-setup предупреждает о нарушении P4 при
   совпадении моделей trusted и untrusted агентов».

**Коммит:** `docs(skill): P4 model-hygiene check in maestro-setup/assistant`

### T4: docs sync

**Файлы:** `manual_docs/overview/changelog.md`, `manual_docs/explanation/pipeline-overview.md`

1. `changelog.md` — секция 5.4.0: 3 пункта (тест-регистрация + guard; evidence-
   верификация; P4-check).
2. `pipeline-overview.md` — в описание шага 13 (SDD): строчка про evidence-верификацию
   DONE перед task review.

**Коммит:** `docs: manual_docs sync for 5.4.0 improvements batch`

### T5: version bump + regression entry

**Файлы:** версия (package.json, package-lock.json, docs/project-context.md, AGENTS.md,
docs/roadmap.md, TODO.md), `regression/entries/2026-10-05-improvements-batch.md` (новый)

1. Regression entry (формат существующих): сценарии —
   - guard: незарегистрированный test-файл → `npm test` красный (запуск: `npm test`)
   - evidence-правило: `grep -c "Evidence-based верификация" skills/maestro/SKILL.md` ≥ 2
   - P4-check: `grep -c "P4-check" skills/maestro-setup/SKILL.md skills/maestro-assistant/SKILL.md` ≥ 1
   - версии синхронны: `npm test` (docs-drift D1) зелёный
2. Bump 5.3.1 → 5.4.0 во всех точках; `AGENTS.md` — `~N строк` пересчитать
   (`wc -l skills/maestro/SKILL.md`), версию в метке `(~N строк, 5.4.0)`.
3. `docs/roadmap.md` + `TODO.md` — отметка выполнения (merge-правило).

**Коммит:** `chore: bump 5.4.0 + regression entry`

## Порядок выполнения

1. T1 → task review (sonnet) + evidence-проверка оркестратора
2. T2 → task review + evidence-проверка
3. T3 → task review + evidence-проверка
4. T4 → task review + evidence-проверка
5. T5 → task review + evidence-проверка
6. Final review (reviewer) по дифу ветки
7. Гейт 17 (HITL STOP) → merge ff → ветка удаляется

## Валидация

- `npm test` (включая guard + 3 новых файла + docs-drift) — 0 fail
- `npm run test:memory` — smoke (не деградирует)
- grep-сценарии regression entry — проходят
