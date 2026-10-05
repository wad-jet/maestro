---
title: "Implementer report reliability (5.5.1) - self-check перед отчётом + scope haiku без structural markdown"
date: 2026-10-05
type: feature
severity: medium
scope: skills/maestro, manual_docs
fixed: true
---

# Implementer report reliability (5.5.1)

## Суть

Надёжность отчётов implementer (итерация 5.5.1) — два правила:

1. **Self-check-контракт** (`skills/maestro/implementer-prompt.md`): перед
   формированием отчёта implementer обязан выполнить самопроверку — фактический
   SHA коммита, фактический вывод тестов (запуск, а не по памяти), чистое
   рабочее дерево, структурная проверка внесённых изменений. Любой
   пропущенный/неподтверждённый пункт → статус `DONE_WITH_CONCERNS`, не DONE.
2. **Scope haiku** (`skills/maestro/references/model-selection.md` + SKILL.md
   шаг 13 + `manual_docs/reference/model-selection.md`): haiku — без
   структурных markdown-правок (таблицы/списки/мульти-вставки); doc/шаблон-
   правки и multi-file → sonnet.

Обоснование — факт 2026-10-05: батч 5.4.0 (haiku) — 3/3 дефектных отчёта
(сфабрикованный SHA, пустой отчёт, сломанные markdown-вставки) vs батч 5.5.0
(sonnet) — 3/3 полных отчёта.

## Сценарии воспроизведения/проверки

- a) `npm test` → 0 fail (включая docs-drift: версия 5.5.1 в AGENTS.md ↔
  package.json, метка ~N строк ↔ факт SKILL.md, changelog ↔ roadmap)
- b) `grep -c "Self-check перед отчётом" skills/maestro/implementer-prompt.md` → 1
- c) `grep -c "structural markdown\|без структурных markdown" skills/maestro/references/model-selection.md` → ≥ 2
- d) версии 5.5.1 синхронны: `grep "5.5.1" package.json docs/project-context.md AGENTS.md docs/roadmap.md` → совпадения во всех 4 файлах

## Изменённые файлы

- `skills/maestro/implementer-prompt.md` — self-check-контракт перед отчётом
  (`6a69668`)
- `skills/maestro/references/model-selection.md` — scope haiku: без
  structural markdown (doc/шаблон-правки и multi-file → sonnet) + обоснование
  по факту батчей (`6a69668`)
- `skills/maestro/SKILL.md` — шаг 13: строка о выборе implementer-модели
  (канон model-selection, scope haiku)
- `manual_docs/reference/model-selection.md` — tier-таблица: scope haiku
  (без structural markdown, doc-правки → sonnet)
- `manual_docs/overview/changelog.md` — секция 5.5.1
- `regression/entries/2026-10-05-implementer-report-reliability.md` — этот entry
- версия 5.5.1: `package.json`, `package-lock.json`, `docs/project-context.md`,
  `AGENTS.md` (версия + ~1205 строк), `docs/roadmap.md` (Текущая версия +
  закрытый пункт #31)

## Версия

5.5.1 (коммиты `6bcec21`, `6a69668` + docs/bump-коммит с этим entry)
