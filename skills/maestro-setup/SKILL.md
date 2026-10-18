---
name: maestro-setup
description: Initialize maestro for a new or existing project — quick setup (AGENTS check, maestro.json, permissions, models, checks); optional project-context survey
---

# Init — Setup для нового или уже существующего проекта

## Overview

Быстрая инициализация maestro: проверка предусловий, конфигурация (`maestro.json` + permissions + модели), структура `regression/`, проверка superpowers и плагина. Проект-контекст (`docs/project-context.md`) — опциональный финальный шаг.

> Дизайн/спека, scaffold, roadmap — в `/maestro-design`.

**Два режима** (определяются в начале, см. «Задача 3»):
- **project** (маestro установлен проект-локально): root `maestro.json` (коммитится в git) + зеркало `.opencode/`.
- **global** (маestro установлен через `maestro-install.sh --global`): `.maestro/maestro.json` с `memory.namespace` (auto-derive, spec §3.2.3); без `.opencode/`-зеркала и без root `maestro.json` по умолчанию.

**Язык:** все HITL-вопросы, варианты и сообщения пользователю — только на русском.

## Артефакты

| Задача | Выход |
|---|---|
| 1. `/init` гейт | `AGENTS.md` (проверка/создание через `/init`) |
| 2. Контекст | `docs/project-context.md` (опционально, 14 категорий из `init-context.md`) |
| 3. Конфиг | project: root `maestro.json` + permissions (`agents.*.permission`) + плагин/модели + `.gitignore` + `regression/`; global: `.maestro/maestro.json` (`memory.enabled: true` + auto-derive namespace) + `.gitignore` (`.maestro/`) |
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

### Определение режима: project / global

**Определение:**
- **global** — существует состояние глобальной установки: `~/.config/opencode/.maestro/manifest.json` (если `XDG_CONFIG_HOME` задан — `$XDG_CONFIG_HOME/opencode/.maestro/manifest.json`).
- **project** — глобальной установки нет (режим по умолчанию).
- Явный запрос пользователя имеет приоритет над определением (HITL: пользователь просит project-режим или root-файл).

**Отличия режимов:**

| | project | global |
|---|---|---|
| Конфиг | root `maestro.json` (коммитится в git) | `.maestro/maestro.json` (не в git) |
| Зеркало `.opencode/` | создаётся | **НЕ создаётся** (скиллы глобальные) |
| `agpack.yml` | не создаётся (agpack удалён) | не создаётся (agpack удалён) |
| Модели | проектный `.opencode/opencode.json` | глобальный `~/.config/opencode/opencode.json` (per-project override — осознанный след) |
| Нативные permissions / `regression/` | создаются (процедуры ниже) | не входят в global-флоу (spec §3.6) |

### Режим project

#### maestro.json (коммитится в git)

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
- **Warn (6.1.0):** перед записью root конфига проверить существование `<root>/.maestro/maestro.json`; если существует — вывести предупреждение (не блокирует, далее по setup как есть): «⚠ .maestro/maestro.json существует — имеет приоритет над root (с 6.1.0): non-memory ключи (включая trust/confidential/sanitizer_whitelist) и memory.namespace берутся из него. Если в .maestro/ нет memory.namespace, а в root есть — память будет выключена (reason: namespace_missing).»
- Вопрос `communication`: (a) plain — (b) professional

#### Нативные permissions (`agent.<name>.permission` в `.opencode/opencode.json`)

Идемпотентно добавить deny-baseline для `docs/confidential/*` и built-in секретов (`.env`, `*.pem`, `*.key`), per-agent allow для `custodian`/`sanitizer` (чтобы trusted-агенты читали confidential поверх глобального deny).

#### Плагин + модели

- Плагин `maestro-bootstrap` — рекомендуется глобально в `~/.config/opencode/opencode.json`
- **M1 — 7 HITL-вопросов по моделям** (radio): для каждого из haiku/sonnet/opus/reviewer/fable/custodian/sanitizer предложить tier-кандидата + оставить текущую/свой вариант
- **Temperature** по дефолту: haiku 0.0, sonnet 0.1, opus 0.1, reviewer 0.2, fable 0.7, custodian 0.1, sanitizer 0.0

- **P4-check (гигиена моделей):** по канону maestro-assistant — если
  `trust.custodian`/`trust.sanitizer` включены и модель trusted-агента
  совпадает с моделью untrusted-агента → неблокирующее предупреждение в
  сводке (SECURITY.md P4: trusted → изолированная/локальная модель)

#### .gitignore

Добавить `.maestro/` и `.opencode/` (не дублировать).

#### regression/

Создать (идемпотентно): `regression/entries/.gitkeep`, `regression/released/.gitkeep`, `regression/cancelled-features.md`.

### Режим global (spec §3.6)

Глобальная установка существует — флоу состоит ровно из 6 пунктов:

1. Создаёт `.maestro/` (если нет) + `.gitignore` entry `.maestro/` (если нет).
2. Создаёт `.maestro/maestro.json` с `memory: { enabled: true, namespace: <auto-derive> }`. Auto-derive: Вариант A из git remote (domain.owner.repo), fallback C (parent_dir.project_dir.local), pad/truncate до 3 сегментов. Если namespace уже задан явно в любом проектном слое (`.maestro/maestro.json` или root) — не перезаписывает.
3. Опционально: создаёт root `maestro.json` — только если пользователь просит «зафиксировать в репозитории». В глобальном режиме по умолчанию — root-файл не создаётся.
4. Не создаёт `.opencode/` зеркало (скиллы глобальные).
5. Не создаёт `agpack.yml` (agpack удалён полностью).
6. Модели агентов (`agent.custodian.model` и т.д.) — задаются глобально в `~/.config/opencode/opencode.json`; per-project override — осознанный след (файл в проекте).

**M1 (7 HITL-вопросов по моделям)** — как в подпункте «Плагин + модели», но целевой файл — глобальный `~/.config/opencode/opencode.json` (п. 6).

**Правило приоритета:** явное значение в конфиге (любой слой) > auto-derive.

#### Auto-derive namespace (канон, spec §3.2.3)

**Когда применяется:** при создании `.maestro/maestro.json` (п. 2), если namespace не задан явно ни в одном слое конфига. **Приоритет:** явное значение в конфиге > auto-derive.

**Где живёт (архитектурное решение):** auto-derive реализуется в `/maestro-setup` (этот скилл), не в плагине: при первом запуске namespace вычисляется из git remote и **записывается в `.maestro/maestro.json`**. Namespace стабилен при смене git remote (форк, переименование). Пересчёт — `/maestro-setup --derive-namespace`. Runtime auto-derive (в памяти плагина) не используется.

**Правило (1–3 сегмента через точку):**

1. **Git-remote based (вариант A):** если есть `git remote get-url origin`:
   - Parse URL (поддержка SSH, HTTPS, ssh://, GitLab, Bitbucket — все сводятся к `https://` URL):
     - `git@github.com:org/repo.git` → domain=`github.com`, owner=`org`, repo=`repo`
     - `https://github.com/org/repo.git` → domain=`github.com`, owner=`org`, repo=`repo`
     - `ssh://git@github.com/org/repo.git` → domain=`github.com`, owner=`org`, repo=`repo`
     - `https://gitlab.com/group/subgroup/repo.git` → domain=`gitlab.com`, owner=`group`, repo=`repo` (nested group: owner = первая группа в path, lost subgroups ignored → handled by monorepo fallback)
   - Сегменты: `domain_without_tld` (`github.com` → `github` — отбрасывается последний лейбл домена) → `owner` → `repo`
   - lowercased, normalize (`trim`, `lowercase`, squeeze `.`)
   - Пример: `git@github.com:wad-jet/shop-frontend.git` → `github.wad-jet.shop-frontend`
2. **Monorepo fallback:** если project dir ≠ git root (проект в подкаталоге репо) — **домен выбрасывается**, схема `owner.repo.segment`:
   - `/workspace/backend` из `github:org/repo` → `org.repo.backend`
   - `/workspace/frontend` из `github:org/repo` → `org.repo.frontend`
   - segment = последний компонент пути относительно git root
   - **Триггер:** `dirname(project_dir, git_root)` не пустой
   - Формат остаётся в 3 сегментах (соответствует memory-модулю: 1–3 сегмента)
3. **Fallback (вариант C):** если git remote нет или не git URL:
   - `parent_dir.project_dir.local` (где local = fallback маркер)
   - Пример: `~/workspace/my-app/` → `workspace.my-app.local`
4. **Normalisation:**
   - `<3 сегментов` → pad: `"workspace"`, `"unknown"`
   - `>3 сегментов` → truncate до первых 3 (приоритет: domain.owner.repo)
   - Пустой → `"workspace.unknown.unknown"`
5. **Validation (auto-derive output):**
   - Только lowercase alphanumeric, dots, hyphens
   - No consecutive dots, no leading/trailing dots
   - No empty segments
   - Если невалиден → fallback на `"workspace.unknown.unknown"`
6. **Edge cases:**
   - **Self-hosted single-component** (например `git@gitlab.internal:project.git`): domain=`gitlab.internal` → `gitlab` (тот же принцип, что `github.com` → `github`: отбрасывается последний лейбл домена), owner=`unknown` (нет owner в URL), repo=`project` → `gitlab.unknown.project` (3 сегмента; `gitlab.internal.unknown.project` было бы 4 — невалидно по формату 1–3 сегмента)
   - **Non-standard SSH** (`git@github.com:owner/repo.git` with no `.git`): strip trailing path segments identically
   - **Empty remote URL**: fallback to C (path-based)

## Задача 4. Проверка superpowers

Богус-проб `skill` → прочитать доступные скиллы. Проверить 7 REQUIRED: `writing-plans`, `subagent-driven-development`, `test-driven-development`, `using-git-worktrees`, `requesting-code-review`, `finishing-a-development-branch`, `systematic-debugging`.
- Все → ok
- Некоторые → HITL: (a) установить — (b) пропустить (fail-open, пометка в last-run.md)

## Задача 5. Проверка плагина `maestro-bootstrap`

Проверить регистрацию в merge-конфиге — ключ `plugins` (V2-канон) или legacy `plugin` (V1) → `maestro-bootstrap@git+https://github.com/wad-jet/maestro.git`. Оба ключа одновременно — ошибка (двойная регистрация, «Duplicate plugin ID»).
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
