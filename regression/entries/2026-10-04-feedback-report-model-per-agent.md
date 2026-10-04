---
title: "P1.6 — U9: Модель агента в таблицах feedback-report"
date: 2026-10-04
type: feature
severity: medium
scope: skills/maestro-feedback-report
fixed: true
---

# P1.6 — U9: Модель агента в таблицах feedback-report

## Проблема

В отчёте не видно, на каких моделях работают агенты. Пользователь не видит:
- Если 4 агента используют одну и ту же модель — они платят за 4 модели
- Если untrusted-агент использует ту же модель что и trusted — гигиена P4

## Решение

- **timeline.mjs:** normalize `info.model` → `models[]` per agent
- **history.jsonl:** расширить запись (`sessionModel`, `agentsModels[]`)
- **SKILL.md:** добавить колонку "Модель" в таблицы агентов
- **Warnings:** наследование модели сессии, одна модель для N агентов, P4-гигиена
- `--no-children`: модели "—"

## Регресс-чек

- models[] заполняется для каждого агента
- history.jsonl содержит sessionModel и agentsModels
- Таблица "Агенты" имеет столбец "Модель"
- Таблица "Токены по агентам" имеет столбец "Модель"
- Session модель в строке "Сессия"
- Warnings: наследование, shared model, P4-gigiena
- `--no-children`: "—" для модели
- 285/285 тестов проходят

## Изменённые файлы

- `skills/maestro-feedback-report/timeline.mjs` — normalizeModel(), models[]
- `skills/maestro-feedback-report/SKILL.md` — колонки Модель, warnings
- `skills/maestro-feedback-report/timeline.test.mjs` — тест sessionModel, agentsModels
