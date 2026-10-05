---
name: maestro-setup
description: Initialize maestro for a new or existing project — quick setup (AGENTS check, maestro.json, permissions, models, checks); optional project-context survey
---

# Init — Setup для нового или уже существующего проекта

## Overview

Быстрая инициализация maestro: проверка предусловий, конфигурация (`maestro.json` + permissions + модели), структура `regression/`, проверка superpowers и плагина. Проект-контекст (`docs/project-context.md`) — опциональный финальный шаг.

> Дизайн/спека, scaffold, roadmap — в `/maestro-design`.

**Язык:** все HITL-вопросы, варианты и сообщения пользователю — только на русском.

## Артефакты

| Задача | Выход |
|---|---|
| 1. `/init` гейт | `AGENTS.md` (проверка/создание через `/init`) |
| 2. Контекст | `docs/project-context.md` (опционально, 14 категорий из `init-context.md`) |
| 3. Конфиг | `maestro.json` + permissions (`agents.*.permission`) + плагин/модели + `.gitignore` + `regression/` |
| 4. superpowers | проверка (7 REQUIRED SUB-SKILLS) |
| 5. плагин | проверка `maestro-bootstrap` (не блокер) |

## Предусловия

### 1. Проверка AGENTS.md

- Отсутствует → HITL: (a) выполнить `/init` — (b) пропустить — (c) отмена

### 2. Git-состояние

Определить `git status` и ветку. Запросить:
- (a) работать в текущем дереве (без ветки)
- (b) создать ветку `feature/<kebab-case>` (напр. `feature/project-init`)
- (c) отмена
Автокоммитов нет.

## Задача 2. Project Context (опционально)

Перед завершением — проверить `docs/project-context.md`:
- Существует → пропустить
- Отсутствует → HITL: (a) опросить context (14 категорий из `init-context.md`) — (b) пропустить (завершить без context)
- При (a): загрузить `init-context.md`, опросить обязательные секции (1,2,3,4,9,14), создать файл
- При (b): записать статус `context: deferred` в `.maestro/last-run.md`
- **ВАЖНО:** НЕ создавать placeholder-файл. Существование файла — единственный маркер готовности контекста.

> Детали процедуры опроса и гигиены — в `skills/maestro-setup/init-context.md` и `maestro-assistant/SKILL.md` (§7 "Опрос project-context").

## Задача 3. Конфигурация maestro

Перед генерацией — **probe скилла `maestro-assistant` (CRIT-2).** Вызвать `skill` с bogus-именем, проверить наличие.
- **Есть** → следовать канону maestro-assistant для генерации конфигов
- **Нет** → HITL: "необходимо установить `maestro-assistant`" → **жесткое прерывание** (не продолжать)

### maestro.json (коммитится в git)

**Дефолты (не требуют project-context):**
```json
{
  "trust": { "custodian": true, "sanitizer": true },
  "confidential": { "paths": ["docs/confidential/**"] },
  "sanitizer_whitelist": {},
  "communication": "plain"
}
```

- `sanitizer_whitelist: {}` = плагин применяет `DEFAULT_RULES` (все 7 правил маскирования ON, fail-closed по построению)
- Существующий файл → diff-merge (сохраняет пользовательские правки)
- Вопрос `communication`: (a) plain — (b) professional

### Нативные permissions (`agent.<name>.permission` в `.opencode/opencode.json`)

Идемпотентно добавить deny-baseline для `docs/confidential/*` и built-in секретов (`.env`, `*.pem`, `*.key`), per-agent allow для `custodian`/`sanitizer` (чтобы trusted-агенты читали confidential поверх глобального deny).

### Плагин + модели

- Плагин `maestro-bootstrap` — рекомендуется глобально в `~/.config/opencode/opencode.json`
- **M1 — 7 HITL-вопросов по моделям** (radio): для каждого из haiku/sonnet/opus/reviewer/fable/custodian/sanitizer предложить tier-кандидата + оставить текущую/свой вариант
- **Temperature** по дефолту: haiku 0.0, sonnet 0.1, opus 0.1, reviewer 0.2, fable 0.7, custodian 0.1, sanitizer 0.0

- **P4-check (гигиена моделей):** по канону maestro-assistant — если
  `trust.custodian`/`trust.sanitizer` включены и модель trusted-агента
  совпадает с моделью untrusted-агента → неблокирующее предупреждение в
  сводке (SECURITY.md P4: trusted → изолированная/локальная модель)

### .gitignore

Добавить `.maestro/` и `.opencode/` (не дублировать).

### regression/

Создать (идемпотентно): `regression/entries/.gitkeep`, `regression/released/.gitkeep`, `regression/cancelled-features.md`.

## Задача 4. Проверка superpowers

Богус-проб `skill` → прочитать доступные скиллы. Проверить 7 REQUIRED: `writing-plans`, `subagent-driven-development`, `test-driven-development`, `using-git-worktrees`, `requesting-code-review`, `finishing-a-development-branch`, `systematic-debugging`.
- Все → ok
- Некоторые → HITL: (a) установить — (b) пропустить (fail-open, пометка в last-run.md)

## Задача 5. Проверка плагина `maestro-bootstrap`

Проверить `plugin` в merge-конфиге → `maestro-bootstrap@git+https://github.com/wad-jet/maestro.git`.
- **Не блокер:** если не подключён — отметить в своде/last-run, не останавливать

## Завершение

- HITL-свод: список файлов + git-статус
- Записать в `.maestro/last-run.md`: статус superpowers + плагин + context (`ready` / `deferred`)
- Напоминание: коммит — пользователь
- Для дизайна/спеки → `/maestro-design`

## Обработка сбоев

| Ситуация | Действие |
|---|---|
| AGENTS.md нет, выбрано (b) | Продолжить, в своде отметить |
| project-context уже есть | Пропустить задачу 2 |
| Git: без ветки | Писать файлы в текущее дерево |
| superpowers: формат ошибки `skill` изменился | Fallback: загрузить `test-driven-development` |
| superpowers: установка упала | HITL: повторить/показать команду/пропустить |
| Плагин не загружается (задача 5) | Отметить в своде, не блокировать |
| models нигде не заданы | HITL-ввод вручную |
