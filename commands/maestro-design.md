---
description: Дизайн и scaffold проекта после /maestro-init: spec (design агент), каркас кода (TDD), roadmap
---
Загрузи skill `design` (tool: skill) и следуй SKILL.md из `skills/design/`.

`/maestro-design` — дизайн/архитектура, scaffold и roadmap для проекта, у которого
уже есть setup (`/maestro-init`). НЕ выполняет setup (контекст/конфиг) — они в
`/maestro-init`. Модели агентов НЕ переспрашивает — наследует из `opencode.json`.
Действия:
1. Проверка выполнения `/maestro-init`: если проект новый или скилл `maestro`
   ранее не применялся — проверить признаки init (`docs/project-context.md`,
   `maestro.json`, `.maestro/last-run.md`). Если init не выполнялся — предложить
   выполнить `/maestro-init` перед `/maestro-design` (HITL).
2. (a) Диспатч `design` (trusted) -> spec -> `docs/superpowers/specs/YYYY-MM-DD-<project>-design.md`.
   Опциональный spec-review (`opus`) по HITL.
3. (b) Scaffold: каркас кода через `implementer-prompt.md` (TDD RED→GREEN→REFACTOR),
   диспатч `haiku`/`sonnet` по tier.
4. (c) `docs/roadmap.md` (MVP + этапы развития).

Все HITL-вопросы и сообщения пользователю — только на русском.