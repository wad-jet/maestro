---
description: Дизайн и scaffold проекта после /maestro-setup: spec (primary brainstorm + custodian Q/A), каркас кода (TDD), roadmap
---
Загрузи skill `maestro-design` (tool: skill) и следуй SKILL.md из `skills/maestro-design/`.

`/maestro-design` — дизайн/архитектура, scaffold и roadmap для проекта, у которого
уже есть setup (`/maestro-setup`). НЕ выполняет setup (контекст/конфиг) — они в
`/maestro-setup`. Модели агентов НЕ переспрашивает — наследует из `.opencode/opencode.json` или global.
Действия:
1. Проверка выполнения `/maestro-setup`: если проект новый или скилл `maestro`
   ранее не применялся — проверить признаки init (`docs/project-context.md`,
   `maestro.json`, `.maestro/last-run.md`): existence-check — `test -f`
   (existence-only); содержимое `docs/project-context.md` — `read`; параметры
   `maestro.json` — плагин-тулом `maestro_config` (`read`-тул нативно denied
   по `maestro.json`/`.maestro/**`, bash-чтение запрещено).
   Если init не выполнялся — предложить выполнить `/maestro-setup` перед
   `/maestro-design` (HITL).
2. (a) Brainstorm primary (superpowers:brainstorming) + custodian Q/A (trusted) -> spec пишет primary -> `docs/superpowers/specs/YYYY-MM-DD-<project>-design.md`.
   Опциональный spec-review (`opus`) по HITL.
3. (b) Scaffold: каркас кода через `implementer-prompt.md` (TDD RED→GREEN→REFACTOR),
   диспатч `haiku`/`sonnet` по tier.
4. (c) `docs/roadmap.md` (MVP + этапы развития).

Все HITL-вопросы и сообщения пользователю — только на русском.