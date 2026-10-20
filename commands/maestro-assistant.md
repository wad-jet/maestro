---
description: Консультации и настройка maestro-конфигурации/структуры/контекста в течение жизни проекта
---

Загрузи skill `maestro-assistant` (tool: skill) и следуй SKILL.md из `skills/maestro-assistant/`.

`/maestro-assistant <запрос>` — консультации и настройка maestro в любой primary-сессии.

## Что обрабатывает

- `maestro.json` (секции схемы, напр. `sanitizer_whitelist`, `memory`) — чтение
  параметров — плагин-тулом `maestro_config` (native `ask`); `read`/`glob`/`grep`
  нативно denied, bash-чтение запрещено (канон — в скилле `maestro-assistant`)
- `.opencode/opencode.json` / global (плагин, модели/температура агентов) — как консультация
- `project-context.md` (14 категорий, актуализация наполнения)
- Структура каталогов pipeline + `.gitignore` (весь `.maestro/` и `.opencode/`)
- Консультации по правилам/процессам работы maestro

## Ключевые правила

- Все HITL-вопросы, варианты и сообщения пользователю — только на русском.
- Идемпотентно, с HITL-гейтом (approve/правки/отмена) и показом diff-merge перед записью.
- Restricted-пути (нативные deny + строка §12) — жёсткий контроль: снятие с
  защиты — адресный diff + отдельное HITL; merge — консервативное дополнение
  (воркфлоу «Настройка restricted-путей» — `maestro-assistant`).
- После правки `maestro.json` — сообщить, что изменения вступят в силу после перезапуска opencode.
- Доступ к restricted-путям (напр. `docs/confidential/**`, §12) — закрыт:
  нативный deny для primary; role-set (`custodian`/`sanitizer`) — per-agent allow
  (legacy-режим — плагинный enforcement, пока секция `confidential` есть).
- Если запрос требует изменения кода/spec/плана или запуска pipeline — редирект:
  `@maestro-init` (фича/багфикс/SDD), `/maestro-design` (дизайн/scaffold/roadmap), `@regression` (регрессия).