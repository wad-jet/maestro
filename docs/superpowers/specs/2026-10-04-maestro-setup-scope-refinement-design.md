---
title: maestro-setup scope refinement — core-setup + deferred context
date: 2026-10-04
author: maestro-auto
status: draft
---

# maestro-setup: уточнение scope — core-setup + deferred context

## Суть

Сжать `maestro-setup` до быстрого старта (AGENTS + maestro.json + permissions + models + checks). Переместить project-context.md опрос в `maestro-design` как опциональный финальный шаг `maestro-setup` + встроенный шаг в `maestro-design`.

## Проблемы

- `maestro-setup/SKILL.md` = 545 строк, ~90% — project-context опрос + детали конфига
- Пользователь, которому нужен быстрый старт, проходит полный 14-категорий опрос
- `maestro-design` уже предполагает, что project-context.md существует, но нет fallback для нового проекта
- pipeline maestro (SKILL.md) на шаге 0 блокируется без project-context.md

## Изменения

### maestro-setup/SKILL.md (сокращение ~80%)

1. **Задача 2 (project-context) → опциональный финальный шаг**
   - После задач 1, 3-5, перед завершением:
     - Если project-context.md существует → пропустить
     - Если нет → HITL: `(a) опросить context — (b) пропустить (finalize setup)`
     - При (a) → краткий опрос по init-context.md (только обязательные секции 1,2,3,4,9,14)
     - При (b) → завершить setup без context.md; статус `context: deferred` записать в `.maestro/last-run.md`
   - **ВАЖНО:** НЕ записывать placeholder-файл. Существование project-context.md — единственный маркер готовности контекста для шага 0 pipeline.

2. **Убрать дублирующие детали из Task 3 (конфиг)**
   - Ссылка на `maestro-assistant` для полного канона (trust/confidential/sanitizer_whitelist)
   - Убрать подробные JSON-примеры R1/R4 — оставить: "сгенерировать по канону maestro-assistant"
   - **Входы конфига (C1):** `confidential.paths` = дефолт `["docs/confidential/**"]`;
     `sanitizer_whitelist` = дефолт `{}`; `trust` = `{ custodian: true, sanitizer: true }`.
     Эти дефолты fail-closed и не требуют project-context. Актуализация whitelist/paths —
     позже (через maestro-assistant или ручной конфиг).
   - Указать указатель на init-context.md для процедуры опроса (не копировать процедуру)
   - temperature table — оставить (короткая, полезная)
   - D2 models — оставить (существенная часть setup)

3. **Упростить структуру**
   - Pre-flight (AGENTS, git): 10 строк
   - Task 2 (context optional): 15 строк
   - Task 3 (config): 40 строк
   - Task 4 (superpowers): 15 строк
   - Task 5 (plugin): 5 строк
   - Завершение + сбои: 10 строк
   - Итого: ~100 строк (сокращение с 545 на ~80%)

### maestro-design/SKILL.md (расширение)

1. **Предусловие 0: мягкая проверка**
   - Если project-context.md, maestro.json, last-run.md отсутствуют → warning, НЕ блокировать
   - Заменить жёсткий gate на "setup не выполнен → продолжить, но с ограниченным контекстом"

2. **Новый шаг: Project Context (опциональный)**
   - Если project-context.md отсутствует → HITL: `(a) опросить context — (b) продолжить без context`
   - При (a) → загрузить `init-context.md` и провести опрос 14 категорий (полный)
   - При (b) → НЕ создавать файл; отметить в `.maestro/last-run.md`

### maestro/SKILL.md (pipeline, шаг 0)

1. **Убрать блокировку без project-context.md**
   - "Если файл есть: HITL-подтверждение актуальности"
   - "Если файла нет: HITL-диалог для создания" → заменить на:
     - "Если файла нет: warning + предложить пропустить (создастся позже через /maestro-design или skip)"
     - pipeline продолжается; fallback-данные берутся из user story
   - **Auto-режимы (I4):**
     - auto-answer: auto-skip (warning в чат)
     - auto-ai: auto-skip с анализом — если user story достаточно детальна, пропуск без warning

## Безопасность

- SEC-4b: изменения косметические/структурные, без новых данных
- confidential.paths по умолчанию = `["docs/confidential/**"]` — fail-closed, не требует context
- sanitizer_whitelist по умолчанию = `{}` — fail-closed (все данные маскируются)
- Риск: если project-context.md отсутствует, pipeline может работать с неполным контекстом
  - mitigation: warning на шаге 0; project-context можно добавить позже через /maestro-design
  - auto-answer/auto-ai: auto-skip с предупреждением в чат

## Тесты

- regression entry: новый entry для scope refinement
- targeted-тест: «указатели на init-context.md и maestro-assistant резолвятся»
- docs-drift.test.mjs: обновить если меняются файлы в доках

## Docs sync (поверхность изменений)

Обязательный синк по правилу AGENTS.md (changes to skills → manual_docs):

**Спека:**
- `skills/maestro-setup/SKILL.md` — frontmatter description (убрать "14 categories", добавить "optional context")
- `skills/maestro-design/SKILL.md` — frontmatter (убрать "after /maestro-setup" → "after or without /maestro-setup")
- `skills/maestro/SKILL.md` — pipeline step 0 description
- `commands/maestro-setup.md` — шаги (убрать обязательный опрос, добавить skip option)
- `commands/maestro-design.md` — предусловие 0 (жесткий → мягкий)

**manual_docs/:**
- `tutorials/setup-project.md` — обновить описание flow (project-context optional)
- `reference/commands.md` — описание /maestro-setup и /maestro-design
- `explanation/project-context.md` — "проходит 14 категорий" → "опционально"
- `overview/quick-start.md` — новый flow: setup → design (context optional)
- `tutorials/run-first-feature.md` — шаг 0 (warning вместо HITL-диалога)
- `explanation/pipeline-overview.md` — шаг 0 (soft-degradation)

**AGENTS.md:**
- frontmaster `description` maestro-setup скилла (если есть)

## Ретеншн-чеклист Task 3 (не теряем при сжатии)

При сжатии Task 3 (545→~100 строк) явно сохраняем:
- **CRIT-2 probe:** проверка доступности скилла `maestro-assistant` перед генерацией конфига (жёсткий gate, hard abort при отсутствии)
- **Memory-enablement:** процедура включения memory layer (enabled.flag + HITL-опрос + permissions + onboarding)
- **M1 модели:** процедура выбора 7 моделей агентов (D2 D2 D2 models + temperature)
- **Удаляется:** подробные JSON-примеры R1/R4, полная процедура опроса project-context, R5 policies (по желанию)
- **Обработка сбоев maestro-design:** строка "init выполнен, но project-context.md нет → запустите /maestro-setup" заменяется на "project-context не найден → пропустить (опрос в /maestro-design)"

## Тесты

- `docs-drift.test.mjs`: обновить, если меняются файлы в доках
- regression entry: новый entry для scope refinement

## Зависимости

- Не breaking: project-context.md остаётся рекомендуемым, но не обязательным
- `maestro-assistant` SKILL.md — без изменений (источник канона конфига)
- `init-context.md` — без изменений (источник схемы context)
