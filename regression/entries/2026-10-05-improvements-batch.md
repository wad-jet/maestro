---
title: "Improvements batch (5.4.0) — test-coverage guard, evidence-верификация, P4-check"
date: 2026-10-05
type: feature
severity: medium
scope: maestro-install, skills/maestro, skills/maestro-setup, skills/maestro-assistant, manual_docs
fixed: true
---

# Improvements batch (5.4.0)

## Проблема

1. **Скрытый тест-дрейф:** `timeline.test.mjs`, `maestro-benchmark/diff.test.mjs`,
   `sandbox-smoke.test.mjs` не входили в `npm test` — 4 красных теста на main
   остались незамеченными (инцидент 2026-10-05).
2. **Ложные отчёты implementer:** haiku отчитался `DONE` («тесты зелёные»),
   фактически — тест-файл не закоммичен, 1 тест падал. В каноне не было явного
   правила факт-проверки отчёта.
3. **P4-гигиена видна постфактум:** trusted-агенты на моделях untrusted
   выявлялись только в ретроспективе (feedback-report), а не на настройке.

## Решение

- **Тест-coverage guard:** `maestro-install/test-coverage.test.mjs` (в `npm test`) —
  каждый `*.test.mjs`/`*.test.js` в дереве (кроме `node_modules`/`.opencode`/
  `.sandbox`/`.maestro`/`.git`) обязан быть зарегистрирован в `scripts.test` /
  `scripts["test:memory"]` (точные пути или glob) либо в ALLOWLIST.
  glob→regex — мини-компилятор слева направо (цепочка `.replace` ломает
  вставленные quantifier-`*` — инцидент в рамках задачи).
- **Evidence-based верификация implementer:** SKILL.md шаг 13 (после `DONE`, до
  task review — сверка по фактам: `git log`, фактический запуск тестов,
  diff vs task-бриф; расхождение → отчёт не принимается как DONE) + строка
  «Обработка сбоев» + `implementer-prompt.md` (DONE валиден только с
  фактическим TEST_OUTPUT последним прогоном и реальными COMMITS).
- **P4-check:** maestro-assistant (канон, «Правила вывода») + maestro-setup
  (задача 3, после M1/Temperature) — совпадение модели trusted-агента с
  моделью untrusted → неблокирующее предупреждение в сводке (SECURITY.md P4).
  `choose-models.md` — пометка.

## Регресс-чек

- `npm test` зелёный (включая guard + 3 ранее незарегистрированных файла)
- Guard ловит незарегистрированный тест: добавить временный `x.test.mjs`
  без регистрации → `npm test` красный (проверить и удалить)
- Evidence-правило в каноне: `grep -c "Evidence-based верификация" skills/maestro/SKILL.md` ≥ 1
  и строка «ложный DONE» в «Обработке сбоев»
- `implementer-prompt.md`: `grep -c "evidence-based" skills/maestro/implementer-prompt.md` ≥ 1
- P4-check: `grep -c "P4-check" skills/maestro-setup/SKILL.md skills/maestro-assistant/SKILL.md manual_docs/how-to/choose-models.md` ≥ 1 в каждом
- Версии синхронны: docs-drift D1 зелёный (package.json ↔ AGENTS.md ↔ project-context ↔ roadmap)

## Изменённые файлы

- `maestro-install/test-coverage.test.mjs` — новый guard
- `package.json` — `scripts.test` + 3 файла + guard; version 5.4.0
- `skills/maestro/SKILL.md` — шаг 13 (evidence-верификация) + «Обработка сбоев»
- `skills/maestro/implementer-prompt.md` — DONE-контракт (факты)
- `skills/maestro-assistant/SKILL.md` — канон P4-check
- `skills/maestro-setup/SKILL.md` — P4-check в задаче 3
- `manual_docs/how-to/choose-models.md` — пометка P4-check
- `manual_docs/overview/changelog.md` — секция 5.4.0
- `manual_docs/explanation/pipeline-overview.md` — шаг 13 (evidence-верификация)
- версия: `package-lock.json`, `docs/project-context.md`, `AGENTS.md`, `docs/roadmap.md`, `TODO.md`
