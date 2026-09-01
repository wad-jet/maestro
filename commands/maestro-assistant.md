---
description: Консультации и настройка maestro-конфигурации/структуры/контекста в течение жизни проекта
---

Загрузи skill `maestro-assistant` (tool: skill) и следуй SKILL.md из `skills/maestro-assistant/`.

`/maestro-assistant <запрос>` — консультации и настройка maestro в любой primary-сессии.

## Что обрабатывает

- `maestro.json` (trust / access_policy / confidential / sanitizer_whitelist)
- `.opencode/opencode.json` / global (плагин, модели/температура агентов) — как консультация
- `project-context.md` (14 категорий, актуализация наполнения)
- Структура каталогов pipeline + `.gitignore` (весь `.maestro/` и `.opencode/`)
- Консультации по правилам/процессам работы maestro

## Ключевые правила

- Все HITL-вопросы, варианты и сообщения пользователю — только на русском.
- Идемпотентно, с HITL-гейтом (approve/правки/отмена) и показом diff-merge перед записью.
- Правка `confidential.paths` — жёсткий контроль (снятие с защиты — блок по умолчанию;
  merge — консервативное дополнение; адресный diff).
- После правки `maestro.json` — сообщить, что изменения вступят в силу после перезапуска opencode.
- Доступ к `docs/confidential/**` — закрыт (primary deny).
- Если запрос требует изменения кода/spec/плана или запуска pipeline — редирект:
  `@maestro-init` (фича/багфикс/SDD), `/maestro-design` (дизайн/scaffold/roadmap), `@regression` (регрессия).