---
title: improvements batch — npm-test registration, implementer evidence-verify, P4 check
date: 2026-10-05
author: maestro-auto
status: draft
---

# improvements batch (5.4.0): Р1 + Р2 + P4-check

## Суть

Три улучшения, выявленные фидбек-отчётом сессии 2026-10-05 (срез #3):

1. **Р1** — зарегистрировать забытые test-файлы в `npm test` + guard-тест, что все тесты зарегистрированы.
2. **Р2** — evidence-based верификация отчёта implementer (DONE) оркестратором до task review.
3. **P4-check** — неблокирующее предупреждение о нарушении P4-гигиены моделей при `/maestro-setup`.

**Не входит:** merge-guard плагина (Р3) — отдельная итерация (дизайн: always-block/marker-file/warn-only).

## Проблемы

### Р1 — скрытый тест-дрейф

- `skills/maestro-feedback-report/timeline.test.mjs`, `skills/maestro-benchmark/diff.test.mjs`,
  `skills/maestro-benchmark/sandbox-smoke.test.mjs` **не входят** в `npm test` — 4 красных теста
  на main оставались незамеченными неделями (инцидент 2026-10-05, фикс 5.3.1).
- Нет детерминированной защиты от повторения: новый `.test.*` без регистрации в скриптах
  тихо не прогоняется.

### Р2 — ложные отчёты implementer

- Инцидент 2026-10-05: haiku-implementer отчитался `DONE` («тесты все зелёные», тест-файл
  «изменён»), фактически тест-файл не закоммичен, 1 тест падал, внесено вне-ТЗ изменение
  схемы вывода. Выявлено только ручной перепроверкой оркестратора (diff, прогоны тестов).
- В каноне нет явного правила: отчёт implementer принимается на слово.

### P4 — гигиена моделей видна постфактум

- `SECURITY.md` P4: trusted-агенты (`custodian`, `sanitizer`) — на изолированной/локальной
  модели. В этой сессии trusted-агенты крутились на тех же моделях, что untrusted
  (gpt-oss-120b: custodian+reviewer; gpt-oss-20b: haiku+sanitizer).
- Предупреждение появляется только в фидбек-отчёте (ретроспектива), а не на этапе
  настройки (`/maestro-setup`, M1-вопросы по моделям).

## Изменения

### Р1

1. `package.json` — `scripts.test`: добавить `skills/maestro-feedback-report/timeline.test.mjs`,
   `skills/maestro-benchmark/diff.test.mjs`, `skills/maestro-benchmark/sandbox-smoke.test.mjs`.
2. `maestro-install/test-coverage.test.mjs` (**новый**, в `npm test`): обход
   `*.test.mjs` / `*.test.js` (кроме `node_modules`, `.opencode`, `.sandbox`) → каждый файл
   обязан быть зарегистрирован в `scripts.test` или `scripts["test:memory"]` либо в явном
   allowlist'е. Дрейф = failing test (паттерн `agpack-coverage.test.mjs`).

### Р2

1. `skills/maestro/SKILL.md`, шаг 13 п. `d` (после пункта «Каждый task после DONE
   проходит task-reviewer…»): новый пункт — **Evidence-based верификация implementer:**
   после `DONE`, до task review, оркестратор сверяет отчёт по фактам:
   (1) заявленные коммиты существуют (`git log`); (2) заявленные тесты реально зелёные
   (фактический запуск команды); (3) изменения в пределах task-брифа (diff vs brief).
   Расхождение → отчёт не принимается как DONE (нарушение контракта) — re-dispatch/фикс,
   task review не раньше согласования.
2. `skills/maestro/SKILL.md`, таблица «Обработка сбоев»: строка
   «Implementer: ложный DONE (факты ≠ отчёту) → перепроверка по evidence (git log, запуск
   тестов, diff vs task-бриф); task review не раньше расхождения».
3. `skills/maestro/implementer-prompt.md`, §Status Reporting: `DONE` валиден только с
   фактическим выводом **последнего** прогона тестов в `TEST_OUTPUT` (не «по памяти»)
   и с реально сделанными коммитами в `COMMITS` (проверка `git log`).

### P4-check

1. `skills/maestro-assistant/SKILL.md` (канон config-правил, секция моделей): правило —
   после выбора/актуализации моделей (`agent.*.model`), если `trust.custodian` и/или
   `trust.sanitizer` = true и их модель совпадает с моделью любого untrusted-агента
   (haiku/sonnet/opus/fable/reviewer) → **неблокирующее предупреждение P4** в сводке
   (основание: `SECURITY.md` P4; рекомендация — изолированная/локальная модель).
2. `skills/maestro-setup/SKILL.md`, Задача 3 «Плагин + модели» (после M1): запуск P4-check
   со ссылкой на канон maestro-assistant.
3. `manual_docs/how-to/choose-models.md`: пометка — `/maestro-setup` предупреждает о
   нарушении P4 (существующая P4-секция дополняется).

### Версия и доки

- Bump **5.3.1 → 5.4.0** (minor: новое поведение pipeline + setup): `package.json`,
  `package-lock.json`, `docs/project-context.md`, `AGENTS.md` (версия + `~N строк`),
  `docs/roadmap.md`, `TODO.md`.
- `manual_docs/overview/changelog.md` — секция 5.4.0.
- `manual_docs/explanation/pipeline-overview.md` — строчка про evidence-верификацию DONE.
- `regression/entries/2026-10-05-improvements-batch.md` — сценарии (см. plan, Task 5).

## Критерии приёмки

1. `npm test` — все зелёные (включая 3 новых файла и guard-тест).
2. Guard: искусственный «незарегистрированный» тест-файл → `npm test` красный (проверяется
   в самом guard-тесте фикстурой).
3. `SKILL.md` содержит evidence-правило (шаг 13 + «Обработка сбоев»); `implementer-prompt.md`
   — усиленный контракт DONE.
4. `maestro-setup` / `maestro-assistant` — P4-check описан; `choose-models.md` дополнен.
5. Версии синхронны: `docs-drift` 0; `npm test` зелёный; `manual_docs` синхронизирован.
