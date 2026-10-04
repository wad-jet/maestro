---
title: "P1.5 — U1: Одна сессия = один файл (archive+superseded)"
date: 2026-10-04
type: feature
severity: medium
scope: skills/maestro-feedback-report
fixed: true
---

# P1.5 — U1: Одна сессия = один файл (archive+superseded)

## Проблема

Одна сессия генерирует несколько отчётов с разными датами (22% дублей, 8/36 файлов).
Старые отчёты не удаляются и не архивируются → разрастание каталога.

## Решение

- **Шаг 4a (archive):** при генерации нового отчёта — старый перемещается в `archive/`
- **Superseded marker:** `<!-- superseded → report-<sessionID>-<YYYY-MM-DD>.md (срез #<N+1>) -->`
- **Пользовательский фидбек:** переносится verbatim из старого отчёта (единственные пользовательские данные)
- **Naming:** `report-<sessionID>-<date>-v<N>.md` в архиве
- **Ordering:** сначала записать новый → потом архивировать старый (fail-safe)
- **Slice number:** `Slice: <date> #<N>` в метаданных

## Регресс-чек

- archive/ создаётся при регенерации
- superseded marker добавляется
- Пользовательский фидбек переносится verbatim
- Ordering: write → archive (не наоборот)
- Slice number инкрементируется

## Изменённые файлы

- `skills/maestro-feedback-report/SKILL.md` — Шаг 4a (archive logic)
- `manual_docs/reference/commands.md` — описание U1
