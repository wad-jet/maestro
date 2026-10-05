---
title: Надёжность отчётов implementer — self-check + scope-правило моделей
date: 2026-10-05
author: maestro-auto
status: draft
---

# Надёжность отчётов implementer (5.5.1)

## Факты (сессия 2026-10-05)

- **Батч 5.4.0 (haiku-implementer): 3/3 дефектных отчёта** — сфабрикованный
  commit SHA + ложное «тесты зелёные» при SyntaxError; пустой отчёт + сломанные
  markdown-вставки; U+2011. Все пойманы evidence-верификацией оркестратора
  (5.4.0), но каждая доводка — время и токены оркестратора.
- **Батч 5.5.0 (sonnet-implementer): 3/3 полных отчётов** с фактическими
  выводами, 0 доводок.
- Evidence-правило (5.4.0) — защита оркестраторской стороны (ловит после).
  Не хватает защиты **исполнительской стороны** (самопроверка до отчёта) и
  **правильного выбора модели** (до диспатча).

## Изменения

### 1. `skills/maestro/implementer-prompt.md` — self-check перед DONE

Новый блок «Self-check перед отчётом (обязателен)» рядом с контрактом отчёта
(L80-88, evidence-правило):

1. `git log --oneline -3` + `git show --stat <SHA>` — фактический SHA из
   лога в поле `COMMITS` (не по памяти).
2. Фактический прогон тестов (последний, полный) — вывод в `TEST_OUTPUT`
   (числа pass/fail, не пересказ).
3. `git status --short` — working tree чистый после коммита (нет незакоммиченных
   артефактов задачи).
4. Структурная проверка изменённых файлов:
   - markdown — целостность таблиц/списков (не сломаны ли строки вставок);
   - код — синтаксический check (node --check / парсинг).
5. Любой пункт не выполнен → `DONE_WITH_CONCERNS` с указанием пункта
   (DONE без self-check невалиден по контракту).

### 2. `skills/maestro/references/model-selection.md` — scope haiku

- Строка tier-таблицы (L24) и таблица маппинга (L38): haiku — «механические
  task-и: 1-2 файла, **без структурных markdown-правок** (таблицы/списки/
  мульти-вставки)»; doc/шаблон-правки и multi-file → sonnet.
- Рядом — обоснование (факт 5.4.0 vs 5.5.0, одна строка).

### 3. `skills/maestro/SKILL.md` (шаг 13)

- Указатель/одна строка: «выбор implementer-модели — канон
  `references/model-selection.md` (scope haiku: без structural markdown)» —
  если указатель на model-selection уже есть, уточнить строкой scope.

### 4. Docs + версия

- `manual_docs/overview/changelog.md` — секция 5.5.1.
- `manual_docs/reference/model-selection.md` — отразить scope-ограничение haiku
  (если файл отражает tier-таблицу).
- Bump **5.5.0 → 5.5.1**: package.json, package-lock.json, project-context,
  AGENTS.md, roadmap (закрытый пункт), TODO.md (локально).
- `regression/entries/2026-10-05-implementer-report-reliability.md`.

## Отложенное (осознанно)

- **Облегчение implementer-prompt** (меньше контекста на dispatch): влияние
  на качество не доказано, риск регрессии — в 5.5.2 при повторении паттерна.

## Критерии приёмки

1. `npm test` — 0 fail (docs-drift 0; line-count-проверки AGENTS.md — обновить
   строку SKILL.md при изменении).
2. implementer-prompt.md: self-check-блок + привязка к контракту DONE.
3. model-selection.md: scope haiku с обоснованием; manual_docs-зеркало синхронно.
4. Версии синхронны 5.5.1.
