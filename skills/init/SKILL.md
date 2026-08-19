---
name: init
description: Use when bootstrapping a NEW project with maestro — generates docs/project-context.md (14 categories), architecture design via brainstorming→spec, scaffold (prototype), and docs/roadmap.md
---

# Init — Bootstrap нового проекта

## Overview

Сквозная инициализация нового проекта для maestro. Команда `/maestro-init`
запускает этот скилл в любой primary-сессии. Цель — довести пустой/новый проект до
состояния, в котором обычный pipeline maestro может работать: есть
`docs/project-context.md` (источник контекста шага 0), дизайн/архитектура,
рабочий каркас кода и `docs/roadmap.md`.

**Мы НЕ переопределяем встроенный `/init` opencode** (тот создаёт `AGENTS.md`).
`/maestro-init` — отдельная команда. Если `AGENTS.md` ещё нет — предложить
пользователю сначала выполнить встроенный `/init`.

**Язык:** все HITL-вопросы, варианты и сообщения пользователю — только на русском.

## Артефакты, которые производит скилл

| Шаг | Выход |
|---|---|
| Context | `docs/project-context.md` (14 категорий, см. `init-context.md`) |
| (a) | `docs/superpowers/specs/YYYY-MM-DD-<project>-design.md` (brainstorming→spec) |
| (b) | каркас кода (scaffold) в дереве проекта |
| (c) | `docs/roadmap.md` (MVP + этапы развития) |

## Предусловия (pre-flight)

### 1. Проверка AGENTS.md

- Если `AGENTS.md` отсутствует → HITL:
  (a) выполнить встроенный `/init` (системный setup), затем вернуться
  (b) пропустить и продолжить `/maestro-init`
  (c) отмена

### 2. Проверка docs/project-context.md

- Файл существует → HITL:
  (a) перечитать/восстановить контекст из него и перейти сразу к шагам (a)+(c)
  (b) пересоздать/обновить с нуля (полный опрос)
  (c) отмена
- Файла нет → полный опрос (переход к «Шаг 1. Сбор контекста»).

### 3. Git-состояние (HITL перед записью файлов)

Определить `git status` (clean/dirty) и текущую ветку. Запросить решение:

- (a) работать в текущем дереве **без** создания ветки (автокоммитов нет)
- (b) isolate в ветку по inline-конвенции maestro: `feature/<kebab-case>`
  (для нового проекта, напр. `feature/project-init`), без автокоммитов
- (c) отмена

Автокоммиты НЕ создаём ни в каком варианте — коммит пользователь делает сам.

### 4. Проверка скилов superpowers

Проверить, установлены ли скилы superpowers
(`https://github.com/obra/superpowers`, папка `skills`) — от них зависят
SDD-шаги pipeline maestro (план, исполнение, TDD, ревью). Сам init НЕ требует
superpowers runtime (промпты `design`/`implementer` — self-contained), но
предупреждение на этом этапе экономит время после bootstrap.

**Пробник** (без загрузки содержимого скилов в контекст):

1. Вызвать `skill` tool с **bogus-именем** (например `__maestro_probe__`).
2. В тексте ошибки `not found` прочитать полный список доступных скилов
   (`Available skills: ...`).
3. Проверить наличие **всех 7 REQUIRED SUB-SKILLS** maestro
   (`skills/maestro/SKILL.md`):
   `writing-plans`, `subagent-driven-development`, `test-driven-development`,
   `using-git-worktrees`, `requesting-code-review`,
   `finishing-a-development-branch`, `systematic-debugging`.

- **Все найдены** → `superpowers: ok`, перейти к следующему шагу.
- **Есть недостающие** → HITL:

  Показать список недостающих, команду установки и вопрос:
  «(a) установить глобально (`-g`) — (b) установить в проект — (c) пропустить».
  Рекомендация — (a): скил доступен во всех проектах. Примечание: `-g`
  модифицирует `~/.config/opencode/opencode.json` (глобальный конфиг).

  ```
  opencode plugin -g superpowers@git+https://github.com/obra/superpowers.git   # (a)
  opencode plugin superpowers@git+https://github.com/obra/superpowers.git       # (b)
  ```

  - **(a)/(b)** — оркестратор выполняет команду сам через `bash` (команда
    показывается и подтверждается HITL), затем **повторный пробник**:
    - Успех → `superpowers: ok`.
    - Всё ещё не находит (C1: сессия кэширует список скилов при старте;
      `opencode plugin` обновляет файлы/конфиг, но работающая сессия может не
      подхватить изменения без перезапуска) → сообщить: «Установка выполнена.
      **Перезапустите opencode** для активации скилов, затем повторно запустите
      `/maestro-init`.» Пометка `superpowers: installed (restart required)`.
  - **(c) пропустить** — init продолжается; в `.maestro/last-run.md` и своде —
    пометка «superpowers НЕ установлен — SDD-шаги pipeline maestro (план,
    исполнение, TDD, ревью) работать не будут» (fail-open, не блокирует init).

## Шаг 1. Сбор контекста по 14 категориям

Оркестратор читает `init-context.md` (схему 14 категорий) и проходит категории
поочерёдно. Для каждой категории:
- Задаёт один-два конкретных вопроса в интерактивном режиме.
- Фиксирует ответ в накапливаемый черновик.
- Обязательные секции: 1, 2, 3, 4, 9, 14. Остальные — по релевантности,
  либо помечаются `_pending_` (не блокируют).

Секция `14. Commands`: после опроса применить `stack-detection.md` для
автозаполнения команд по артефактам (если проект уже имеет манифесты), либо
задать явно/`auto`/`none` (см. §14 в `init-context.md`). Неоднозначность →
HITL (как в `stack-detection.md`).

В конце — показать пользователю готовый черновик `docs/project-context.md`.

**HITL gate:** «Контекст корректен? (a) approve — (b) правки — (c) отмена».
При (b) — внести правки и повторить gate.

→ создаёт `docs/project-context.md`.

## Шаг (a). План и дизайн проекта (архитектура)

Переиспользует brainstorming→spec флоу maestro (НЕ изобретает новый формат):

1. **Диспатч `design`** (trusted сабагент maestro, `task` tool c
   `subagent_type=design`) с промптом `design-prompt.md`. Для нового проекта
   по умолчанию уровень «архитектурный» (новая кодовая база целиком). `design`
   анализирует project context (14 категорий, созданный на шаге 0) и ведёт
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
  Включить статус superpowers (`ok` / `installed (restart required)` /
  `НЕ установлен`).
- Сообщить, что pipeline maestro теперь может работать (шаг 0 будет читать
  `docs/project-context.md`).

## Обработка сбоев

| Ситуация | Действие |
|---|---|
| AGENTS.md нет и пользователь выбрал (b) | Продолжить, в своде отметить отсутствие AGENTS.md |
| project-context.md существует, выбран (a) | Пропустить «Шаг 1», перейти к (a)+(c) |
| Git: выбран (a) без ветки | Писать файлы в текущее дерево |
| superpowers: формат ошибки `skill` tool изменился (нет `Available skills:`) | Fallback: загрузить один канонический скил `test-driven-development` |
| superpowers: команда установки упала (сеть, git) | HITL: повторить / показать команду для ручного запуска / пропустить |
| superpowers: пробник после установки не находит (C1) | Сообщить «перезапустите opencode», пометка `installed (restart required)`, продолжить |
| superpowers: отказ (c) | Продолжить, пометка в last-run.md + своде |
| stack-detection не находит команду | HITL: вручную / `none` / отмена (молчаливый skip недопустим) |
| design: revise | Вернуться к дизайн-диалогу (re-dispatch `design`), повторить |