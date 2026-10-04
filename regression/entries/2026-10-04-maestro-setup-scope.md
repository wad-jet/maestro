---
title: "P1.4 — Уточнение scope `maestro-setup`"
date: 2026-10-04
type: spec-change
severity: medium
scope: skills/maestro-setup, skills/maestro-design, skills/maestro
fixed: true
---

# P1.4 — Уточнение scope `maestro-setup`

## Проблема

`maestro-setup/SKILL.md` содержал ~545 строк, включая: полный опрос 14 категорий
`project-context.md` (жёсткое предусловие), детальные JSON-примеры R1/R4, полную
процедуру конфигурации. Это делало команду "тяжёлой" и привязывало контекст к
bootstrap.

## Решение

- **Сжатие** `maestro-setup/SKILL.md` с 545 до ~100 строк
- **`project-context.md` → опциональный шаг** (создаётся в setup или позже в
  `maestro-design`)
- **Pipeline шаг 0 → не-блокирующий** (warning вместо HITL-диалога)
- **Auto-режимы → auto-skip** с informational warning
- **Конфигурация → defaults** (trust, sanitizer_whitelist, confidential) без
  `project-context.md`
- **CRIT-2 probe** скилла `maestro-assistant` перед генерацией конфигов

## Регресс-чек

- `maestro-setup/SKILL.md` < 150 строк
- `maestro-design/SKILL.md` предусловие 0 — soft warning
- `maestro/SKILL.md` шаг 0 — non-blocking
- `init-context.md` и `maestro-assistant` резолвятся из скилла
- Docs sync не сломался

## Изменённые файлы

- `skills/maestro-setup/SKILL.md` — редизайн (~100 строк)
- `skills/maestro-design/SKILL.md` — мягкое предусловие + context step
- `skills/maestro/SKILL.md` — шаг 0 не-блокирующий
- `docs/roadmap.md` — статус P1.4 → closed
- `manual_docs/tutorials/setup-project.md` — context optional
- `manual_docs/reference/commands.md` — описание команд
