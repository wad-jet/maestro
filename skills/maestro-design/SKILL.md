---
name: maestro-design
description: Use to produce design, spec, scaffold and roadmap for a project after /maestro-init setup — generates spec via design agent, code scaffold via TDD, and docs/roadmap.md
---

## Гейт 0 — Проверка плагина maestro-bootstrap (обязательный)

**Язык HITL:** русский.

1. **Маркер проекта.** Если в корне проекта есть `maestro.json` — это проект под
   управлением maestro, выполняется проверка плагина (шаги 2–3). Если `maestro.json`
   НЕТ — проект не под maestro, гейт пропускается, работаем как обычно.

2. **Плагин заявлен в конфиге.** Проверь `opencode.json` → `plugin`: там должна
   быть запись, указывающая на `maestro-bootstrap` (путь `./plugins/maestro-bootstrap/index.js`
   или npm-имя `maestro-bootstrap`). Нет → перейти к шагу 4 (стоп).

3. **Плагин реально работал.** Открой самый свежий файл
   `.maestro/logs/maestro-bootstrap-<дата>.log` (по имени-дате). Найди строку
   `plugin initialized`. Если есть И её ISO-`ts` не старше 24 часов от текущего
   момента — плагин работает, продолжить работу. Иначе → шаг 4 (стоп).

4. **Жёсткий STOP (без «продолжить»).** Останови работу и покажи HITL:

   > **Плагин `maestro-bootstrap` не подключён или не загружен.**
   > Защита `docs/confidential/**` НЕ действует: confidential-данные могут быть
   > доступны untrusted-агентам и primary-сессии. `access_policy` и sanitizer тоже
   > не работают (все — в плагине `maestro-bootstrap`).
   >
   > Продолжение работы запрещено. Единственный способ продолжить — подключить
   > плагин и перезапустить opencode:
   > ```
   > opencode plugin maestro-bootstrap   # или добавить путь в opencode.json
   > ```
   >
   > (a) Подключить плагин и перезапустить opencode — затем повторить команду
   > (c) Отмена / стоп

   Допустимы ТОЛЬКО исходы (a) и (c). Варианта «продолжить как есть» НЕТ.
   При (a): объяснить, что нужно перезапустить opencode и повторить команду,
   НЕ продолжать pipeline в текущей сессии. При (c): завершить работу.

# Design — Проектирование и scaffold

## Overview

Команда `/maestro-design` выполняет дизайн/архитектуру, создание каркаса кода
(scaffold) и roadmap для проекта, у которого уже есть setup (`/maestro-init`):
`docs/project-context.md` и конфигурация maestro.

**Разделение:** `/maestro-init` — только setup (контекст + конфиг + проверки).
Дизайн, scaffold и roadmap — здесь, в `/maestro-design`. Зафиксировано в
`specs/maestro-init-tasks-plan.md`.

**Язык:** все HITL-вопросы, варианты и сообщения пользователю — только на русском.

## Артефакты, которые производит скилл

| Шаг | Выход |
|---|---|
| (a) | `docs/superpowers/specs/YYYY-MM-DD-<project>-design.md` (дизайн+spec) |
| (b) | каркас кода (scaffold) в дереве проекта |
| (c) | `docs/roadmap.md` (MVP + этапы развития) |

## Предусловия

### Предусловие 0. Проверка, что выполнен `/maestro-init`

Если проект **новый** или в нём **ранее не применялся** скилл `maestro`, сначала
проверить, выполнялась ли команда `/maestro-init`. Признаки того, что init **был**
выполнен:

- `docs/project-context.md` существует;
- `maestro.json` существует (конфигурация maestro);
- `.maestro/last-run.md` существует (свод setup).

**Если хотя бы один признак отсутствует** (проект не проходил init) → HITL:
- (a) выполнить `/maestro-init` (setup: контекст + конфиг + проверки) **перед**
  `/maestro-design`;
- (b) пропустить и продолжить `/maestro-design` (дизайн без полного setup);
- (c) отмена.

> **Рекомендация — (a).** `/maestro-design` зависит от `docs/project-context.md`
> и конфигурации maestro. Без init дизайн может строиться на неполном контексте.

### Другие предусловия

- `/maestro-init` выполнен: есть `docs/project-context.md` (источник контекста).
- **Модели агентов наследуются** из `opencode.json` (настроены на init или вручную).
  `/maestro-design` **НЕ переспрашивает модели.**

## Шаг (a). План и дизайн проекта (архитектура)

Переиспользует brainstorming→spec флоу maestro (НЕ изобретает новый формат):

1. **Диспатч `design`** (trusted сабагент maestro, `task` tool c
   `subagent_type=design`) с промптом `design-prompt.md`. Для нового проекта
   по умолчанию уровень «архитектурный» (новая кодовая база целиком). `design`
   анализирует project context (14 категорий из `docs/project-context.md`) и ведёт
   дизайн-работу: цели, ограничения, компоненты, потоки, решения. Brainstorming
   workflow embedded в `design-prompt.md`.
2. Вывод — `docs/superpowers/specs/YYYY-MM-DD-<project>-design.md`
   (формат spec из maestro), пишется сабагентом `design` напрямую.
3. **Опциональный Spec Review** (`spec-review-prompt.md`, диспатч `opus`
   через `task` tool), по HITL. Provisional — пользователь решает, нужен ли.

**HITL gate:** «Дизайн утверждён? (a) approve — (b) revise (к design) — (c) отмена».

Дизайн-решения переносятся в `docs/project-context.md` §4 (архитектура) и §5
(модули), если они уточнились.

## Шаг (b). Макетирование — scaffold

На основе §3 (стек) и spec из шага (a) создаётся реальный каркас кода:

- Структура каталогов, роуты, DTO/модели, конфиги.
- Минимальные тесты через `implementer-prompt.md` (TDD: RED→GREEN→REFACTOR).
- Диспатч by tier (§3 стек → `haiku`/`sonnet` через `task` tool).

Цель — минимально работающий skeleton интерфейса, пригодный для итераций.
Проверка: если в §14 определены BUILD/TEST — выполнить.

**HITL gate:** «Scaffold готов. (a) продолжить к roadmap — (b) доработать — (c) отмена».

## Шаг (c). Roadmap

Создаёт `docs/roadmap.md`:
- **MVP** — минимальный набор на основе scaffold + spec (что запускаем первым).
- **Этапы развития** — фазы 1/2/3: темы, приоритеты (P0/P1/P2), цель каждой фазы.
- **Definition of done** по каждой фазе.
- Ссылки на пользовательскую документацию (`manual_docs/`), если применимо.

**HITL gate** per фаза: «Фаза N сформулирована верно? (a) ok — (b) правки — (c) отмена».

→ создаёт `docs/roadmap.md`.

## Завершение

- **HITL-свод:** список созданных/изменённых файлов + git-статус (незакоммичено).
  Напоминание: коммит выполняет пользователь.
- Записать свод в `.maestro/last-run.md` (перезаписывается, в `.gitignore`).
- Сообщить, что pipeline maestro теперь может обрабатывать спеку
  (`docs/project-context.md` + spec готовы).

## Обработка сбоев

| Ситуация | Действие |
|---|---|
| project-context.md отсутствует (init не выполнялся) | HITL: (a) выполнить `/maestro-init` / (b) продолжить без / (c) отмена (Предусловие 0) |
| init выполнен, но project-context.md всё равно нет | Сообщить: запустите `/maestro-init` сначала |
| design: revise | Вернуться к дизайн-диалогу (re-dispatch `design`), повторить |
| scaffold: BUILD/TEST упал | HITL: fix-loop / skip с подтверждением |
| Модели агентов не настроены | Предупредить; предложить настроить `agent.*` в opencode.json |