---
description: Инициализация maestro для нового или уже существующего проекта: project-context.md (14 категорий), конфигурация maestro (maestro.json, .gitignore, plugin+models в .opencode/opencode.json или global), каталоги, проверка superpowers и плагина
---
Загрузи skill `maestro-setup` (tool: skill) и следуй SKILL.md из `skills/maestro-setup/`.

`/maestro-setup` — setup-фаза инициализации maestro для нового или уже
существующего проекта, НЕ системный `/init` opencode (тот создаёт AGENTS.md).
НЕ выполняет дизайн/скаффолд/роадмап — они в отдельной команде `/maestro-design`. Действия:
1. Предусловие: если `AGENTS.md` нет — предложить выполнить встроенный `/init`.
2. Проверка `docs/project-context.md` + запрос git-решения (без автокоммитов).
3. Собрать контекст по 14 категориям -> `docs/project-context.md`.
4. Конфигурация: `maestro.json` (trust/confidential/sanitizer_whitelist) + нативные
   permissions (`.opencode/opencode.json`),
   плагин + модели агентов по M1 (`.opencode/opencode.json` или global), `.gitignore`
   (весь `.maestro/` и `.opencode/`),
   `regression/` структура. Каталоги: `.maestro/`,
   `docs/superpowers/{specs,plans}/`. **Задача 3 требует скилл `maestro-assistant`
   (жёсткий gate): если его нет — установить и продолжить, иначе прерывание.**
   Правила/канон конфига — из `skills/maestro-assistant/SKILL.md`. Чтение текущего
   `maestro.json` (diff секций) — через bash (`cat`/`sed`), не через read-тул
   (нативный deny по `maestro.json`).
5. Проверка скилов superpowers (пробник через `skill` tool; при отсутствии —
   предложить установку через HITL).
6. Проверка плагина `maestro-bootstrap` (не блокер).

После завершения setup — напомнить про `/maestro-design` для дизайна/скаффолда/роадмапа.

Все HITL-вопросы и сообщения пользователю — только на русском.