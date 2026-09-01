---
name: maestro-design
description: Use to produce design, spec, scaffold and roadmap for a project after /maestro-new setup — generates spec via primary brainstorm + custodian Q/A, code scaffold via TDD, and docs/roadmap.md
---

## Гейт 0 — Проверка плагина maestro-bootstrap (обязательный)

**Язык HITL:** русский.

1. **Маркер проекта.** Если в корне проекта есть `maestro.json` — это проект под
   управлением maestro, выполняется проверка плагина (шаг 2). Если `maestro.json`
   НЕТ — проект не под maestro, гейт пропускается, работаем как обычно.

2. **Плагин реально работал.** Открой самый свежий файл
   `.maestro/logs/maestro-bootstrap-<дата>.log` (по имени-дате). Найди строку
   `plugin initialized`. Если есть И её ISO-`ts` не старше 24 часов от текущего
   момента — плагин работает, продолжить работу. Иначе → шаг 3 (стоп).

3. **Жёсткий STOP (без «продолжить»).** Останови работу и покажи HITL:

   > **Плагин `maestro-bootstrap` не подключён или не загружен.**
   > Защита `docs/confidential/**` НЕ действует: confidential-данные могут быть
   > доступны untrusted-агентам и primary-сессии. `access_policy` и sanitizer тоже
   > не работают (все — в плагине `maestro-bootstrap`).
   >
   > Продолжение работы запрещено. Единственный способ продолжить — подключить
   > плагин и перезапустить opencode:
   > ```
   > opencode plugin "maestro-bootstrap@git+https://github.com/wad-jet/maestro.git"
   > # spec добавить в global ~/.config/opencode/opencode.json (реком.) или .opencode/opencode.json
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
(scaffold) и roadmap для проекта, у которого уже есть setup (`/maestro-new`):
`docs/project-context.md` и конфигурация maestro.

**Разделение:** `/maestro-new` — только setup (контекст + конфиг + проверки).
Дизайн, scaffold и roadmap — здесь, в `/maestro-design`.

**Язык:** все HITL-вопросы, варианты и сообщения пользователю — только на русском.

## Артефакты, которые производит скилл

| Шаг | Выход |
|---|---|
| (a) | `docs/superpowers/specs/YYYY-MM-DD-<project>-design.md` (дизайн+spec) |
| (b) | каркас кода (scaffold) в дереве проекта |
| (c) | `docs/roadmap.md` (MVP + этапы развития) |

## Предусловия

### Предусловие 0. Проверка, что выполнен `/maestro-new`

Если проект **новый** или в нём **ранее не применялся** скилл `maestro`, сначала
проверить, выполнялась ли команда `/maestro-new`. Признаки того, что init **был**
выполнен:

- `docs/project-context.md` существует;
- `maestro.json` существует (конфигурация maestro);
- `.maestro/last-run.md` существует (свод setup).

**Если хотя бы один признак отсутствует** (проект не проходил init) → HITL:
- (a) выполнить `/maestro-new` (setup: контекст + конфиг + проверки) **перед**
  `/maestro-design`;
- (b) пропустить и продолжить `/maestro-design` (дизайн без полного setup);
- (c) отмена.

> **Рекомендация — (a).** `/maestro-design` зависит от `docs/project-context.md`
> и конфигурации maestro. Без init дизайн может строиться на неполном контексте.

### Другие предусловия

- `/maestro-new` выполнен: есть `docs/project-context.md` (источник контекста).
- **Модели агентов наследуются** из `.opencode/opencode.json` или global
  (настроены на init или вручную).
  `/maestro-design` **НЕ переспрашивает модели.**

## Шаг (a). План и дизайн проекта (архитектура)

Переиспользует brainstorming→spec флоу maestro (НЕ изобретает новый формат):

1. **Brainstorm ведёт primary** (superpowers:brainstorming, interactive/диалоговый
   скилл): грузит `superpowers:brainstorming` через `skill`-инструмент и ведёт
   диалог с пользователем по канону (классификация пути → вопросы → подходы →
   дизайн → approval). Для нового проекта по умолчанию уровень «архитектурный».
   Primary анализирует project context (14 категорий из `docs/project-context.md`).
2. **Custodian (trusted) — Q/A-брокер по confidential.** Если дизайн требует
   confidential-контекста, primary диспатчит `custodian` через `task` tool
   (`subagent_type=custodian`, модель из `agent.custodian.model`, opus-tier) с
   промптом `custodian-prompt.md`. `custodian` отвечает агрегатами
   (тип/ограничение/чувствительность/связь) БЕЗ raw-значений, НЕ пишет spec.
3. **Spec пишет primary** по результатам brainstorm + Q/A custodian →
   `docs/superpowers/specs/YYYY-MM-DD-<project>-design.md`. Primary помечает
   confidential-фрагменты бинарным маркером `из confidential`.
4. **Опциональный Spec Review** (`spec-review-prompt.md`, диспатч `opus`
   через `task` tool), по HITL. Provisional — пользователь решает, нужен ли.

**HITL gate:** «Дизайн утверждён? (a) approve — (b) revise — (c) отмена».

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
| project-context.md отсутствует (init не выполнялся) | HITL: (a) выполнить `/maestro-new` / (b) продолжить без / (c) отмена (Предусловие 0) |
| init выполнен, но project-context.md всё равно нет | Сообщить: запустите `/maestro-new` сначала |
| spec: revise | Вернуться к дизайн-диалогу (повторить brainstorm primary + custodian Q/A при необходимости), повторить |
| scaffold: BUILD/TEST упал | HITL: fix-loop / skip с подтверждением |
| Модели агентов не настроены | Предупредить; предложить настроить `agent.*` в `.opencode/opencode.json` или global |