---
description: Инициализация нового проекта: project-context.md (14 категорий), дизайн/архитектура, scaffold, roadmap
---
Загрузи skill `init` (tool: skill) и следуй SKILL.md из `skills/init/`.

`/maestro-init` — bootstrap нового проекта, НЕ системный `/init` opencode
(тот создаёт AGENTS.md и переопределять его мы не будем). Действия:
1. Если `AGENTS.md` нет — предложить пользователю сначала выполнить встроенный `/init`.
2. Предусловия: проверка `docs/project-context.md` + запрос git-решения (без автокоммитов).
3. Проверка скилов superpowers (runtime-пробник через `skill` tool; если не
   установлены — предложить установку через HITL).
4. Собрать контекст по 14 категориям -> `docs/project-context.md`.
5. (a) dispatch `design` (trusted) -> spec -> `docs/superpowers/specs/YYYY-MM-DD-<project>-design.md`.
6. (b) scaffold (прототип кода через implementer-prompt.md).
7. (c) `docs/roadmap.md` (MVP + этапы развития).

Все HITL-вопросы и сообщения пользователю — только на русском.