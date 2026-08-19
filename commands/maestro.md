---
description: Вход в pipeline maestro — сквозная реализация фич/багфиксов (design → spec → plan → SDD → review → docs)
---

# @maestro

Загрузи skill `maestro` (tool: skill) и следуй pipeline из SKILL.md.
Координируй субагентов (design, haiku, sonnet, opus, fable, code-reviewer, sanitizer)
на каждом этапе.

Работает в любой primary-сессии — привязки к конкретному агенту нет.

## Ключевые правила

- Следуй HITL gates строго
- Все HITL gates, вопросы и сообщения пользователю — ТОЛЬКО на русском языке
- После утверждения плана (шаг 12) — один коммит `docs: design + plan for <feature-name>`
- После SDD (шаг 13) — per-task code коммиты
- Финальное ревью (шаг 16) — диспатч code-reviewer

## Связанные команды

- `@regression` — реестр рисков регрессии
- `@maestro-init` — bootstrap нового проекта