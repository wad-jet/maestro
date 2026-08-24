---
description: Инициализация нового проекта: project-context.md (14 категорий), конфигурация maestro (maestro.json, opencode.json, .gitignore), каталоги, проверка superpowers и плагина
---
Загрузи skill `maestro-init` (tool: skill) и следуй SKILL.md из `skills/maestro-init/`.

`/maestro-init` — setup-фаза bootstrap нового проекта, НЕ системный `/init`
opencode (тот создаёт AGENTS.md). НЕ выполняет дизайн/скаффолд/роадмап — они
в отдельной команде `/maestro-design`. Действия:
1. Предусловие: если `AGENTS.md` нет — предложить выполнить встроенный `/init`.
2. Проверка `docs/project-context.md` + запрос git-решения (без автокоммитов).
3. Собрать контекст по 14 категориям -> `docs/project-context.md`.
4. Конфигурация: `maestro.json` (trust/access_policy/confidential/sanitizer_whitelist),
   `opencode.json` (plugin + модели агентов по M1), `.gitignore` (конкретные
   пути), `regression/` структура. Каталоги: `.maestro/`,
   `docs/superpowers/{specs,plans}/`. **Задача 3 требует скилл `maestro-assistant`
   (жёсткий gate): если его нет — установить и продолжить, иначе прерывание.**
   Правила/канон конфига — из `skills/maestro-assistant/SKILL.md`.
5. Проверка скилов superpowers (пробник через `skill` tool; при отсутствии —
   предложить установку через HITL).
6. Проверка плагина `maestro-bootstrap` (не блокер).

После завершения setup — напомнить про `/maestro-design` для дизайна/скаффолда/роадмапа.

Все HITL-вопросы и сообщения пользователю — только на русском.