---
name: maestro-init
description: Use when bootstrapping a NEW project with maestro — generates docs/project-context.md (14 categories), maestro config (maestro.json, opencode.json, .gitignore), regression/ structure, and verifies prerequisites (AGENTS.md, superpowers, plugin)
---

# Init — Bootstrap нового проекта

## Overview

Сквозная инициализация нового проекта для maestro. Команда `/maestro-init`
запускает этот скилл в любой primary-сессии. Цель — подготовить проект к работе
pipeline maestro: есть `docs/project-context.md` (источник контекста шага 0),
конфигурация maestro (`maestro.json` + `opencode.json` + `.gitignore`),
структура `regression/` и проверенные предусловия (AGENTS.md, superpowers, плагин).

**ВНИМАНИЕ:** `/maestro-init` выполняет **только setup-фазу**. Дизайн, scaffold
и roadmap — в отдельной команде `/maestro-design` (скилл `maestro-design`). Это разделение
зафиксировано в `specs/maestro-init-tasks-plan.md`.

**Мы НЕ переопределяем встроенный `/init` opencode** (тот создаёт `AGENTS.md`).
`/maestro-init` — отдельная команда.

**Язык:** все HITL-вопросы, варианты и сообщения пользователю — только на русском.

## Артефакты, которые производит скилл

| Задача | Выход |
|---|---|
| 1. `/init` гейт | `AGENTS.md` (проверка/создание через встроенный `/init`) |
| 2. Контекст | `docs/project-context.md` (14 категорий, см. `init-context.md`) |
| 3. Конфиг | `maestro.json` (trust/access_policy/confidential/sanitizer_whitelist) + `opencode.json` (plugin + агенты M1) + `.gitignore` + `regression/` |
| 3а. Каталоги | `.maestro/`, `docs/superpowers/{specs,plans}/`, `docs/confidential/` |
| 4. superpowers | проверка/установка (HITL) |
| 5. плагин | проверка подключения `maestro-bootstrap` (не блокер) |

> Дизайн/спека, scaffold, roadmap — НЕ здесь. Они в `/maestro-design`.

## Предусловия (pre-flight)

### 1. Проверка AGENTS.md (задача 1)

- Если `AGENTS.md` отсутствует → HITL:
  (a) выполнить встроенный `/init` (системный setup), затем вернуться
  (b) пропустить и продолжить `/maestro-init`
  (c) отмена

### 2. Проверка docs/project-context.md (задача 2)

- Файл существует → HITL:
  (a) перечитать/восстановить контекст из него и перейти к задачам 3–5
  (b) пересоздать/обновить с нуля (полный опрос)
  (c) отмена
- Файла нет → полный опрос (переход к «Задача 2. Сбор контекста»).

### 3. Git-состояние (HITL перед записью файлов)

Определить `git status` (clean/dirty) и текущую ветку. Запросить решение:

- (a) работать в текущем дереве **без** создания ветки (автокоммитов нет)
- (b) isolate в ветку по inline-конвенции maestro: `feature/<kebab-case>`
  (для нового проекта, напр. `feature/project-init`), без автокоммитов
- (c) отмена

Автокоммиты НЕ создаём ни в каком варианте — коммит пользователь делает сам.

## Задача 2. Сбор контекста по 14 категориям

Оркестратор читает `init-context.md` (схему 14 категорий) и проходит категории
поочерёдно. Для каждой категории:
- Задаёт один-два конкретных вопроса в интерактивном режиме.
- Модель сама определяет, предполагает ли вопрос готовые варианты ответа. Если
  да — задаёт вопрос через вопросный инструмент (radio — одиночный выбор,
  checkbox — множественный) с пунктом «свой вариант» (свободный ввод). Варианты,
  перечисленные в тексте категории (напр. «Тип проекта: сервис / приложение /
  библиотека / CLI / monorepo», «Стратегии: unit / integration / e2e»), предлагаются
  на выбор, а не остаются только текстом вопроса. Если готовых вариантов нет —
  открытый вопрос.
- Фиксирует ответ в накапливаемый черновик.
- Обязательные секции: 1, 2, 3, 4, 9, 14. Остальные — по релевантности,
  либо помечаются `_pending_` (не блокируют).

Секция `14. Commands`: после опроса применить `stack-detection.md` для
автозаполнения команд по артефактам (если проект уже имеет манифесты), либо
задать через вопросный инструмент — для каждой команды значение `auto` / `none` /
явная команда (radio) + «свой вариант» (ввод команды вручную); при определении
набора команд (какие из TEST/BUILD/E2E/LINT/… описать) — checkbox. Radio и checkbox
не смешивать: radio — выбор значения одной команды, checkbox — выбор нескольких
команд. Неоднозначность → HITL (см. §14 в `init-context.md`).

В конце — показать пользователю готовый черновик `docs/project-context.md`.

**HITL gate:** «Контекст корректен? (a) approve — (b) правки — (c) отмена».
При (b) — внести правки и повторить gate.

→ создаёт `docs/project-context.md`.

> **Делегирование правил наполнения:** правила актуализации/наполнения project-context
> (граница «схема vs наполнение», §14 Commands, обязательные секции) — в скилле
> `maestro-assistant` (канон). Схема 14 категорий остаётся в `init-context.md`; схему
> не менять, править только наполнение. При вопросах по наполнению/актуализации — загрузить
> `maestro-assistant`.

## Задача 3. Конфигурация maestro

На основе контекста (§3 стек, §5 домены, §12 безопасность) сгенерировать конфиги
идемпотентно (см. `specs/init-idempotency-plan.md` для деталей).

### 3а. Подготовка каталогов

> Правила структуры каталогов pipeline + `.gitignore` конкретных путей — в скилле
> `maestro-assistant` (канон). Идемпотентно (`mkdir -p` безопасен).

Перед генерацией конфигов (идемпотентно, `mkdir -p` безопасен):
- `mkdir -p .maestro/` (для логов плагина и `last-run.md`)
- `mkdir -p docs/superpowers/specs docs/superpowers/plans` (для `/maestro-design`)
- `mkdir -p docs/confidential` (защищённая папка, см. `confidential` в `maestro.json`)

### maestro.json (консолидированный конфиг, коммитится в git)

**Перед генерацией — probe скилла `maestro-assistant` (жёсткий gate, CRIT-2).**
Вызвать `skill` tool с bogus-именем и проверить наличие `maestro-assistant` в списке доступных.
- **Скилл есть** → загрузить `maestro-assistant` (`skill` tool) и следовать его **канону**
  `maestro.json` (четыре секции: `trust` / `access_policy` / `confidential` / `sanitizer_whitelist`;
  полный JSON-канон — в `skills/maestro-assistant/SKILL.md`).
- **Скилла нет** → HITL-сообщение «необходимо установить скилл `maestro-assistant` для
  продолжения» и **жёсткое прерывание задачи 3 и всего процесса `/maestro-init`** (не переходить
  к 4–5, без fallback-деградации). Идемпотентно: проверка выполняется только если задача 3
  реально генерирует/обновляет конфиг; при пропуске задачи (конфиг уже есть) — не проверяется.

Правила вывода секций (по канону assistant): `trust` — всегда `design: true`, `sanitizer: true`;
`access_policy.allow` из §3/§5, `deny` из §12; `confidential.paths` дефолт `["docs/confidential/**"]`;
`sanitizer_whitelist` из §3/§12. Идемпотентность: при существовании `maestro.json` — diff по
секциям; merge сохраняет пользовательские правки; если файла нет — создаётся целиком.

### opencode.json — регистрация плагина + модели агентов

- Регистрация плагина: `"plugin": ["maestro-bootstrap@git+https://github.com/wad-jet/maestro.git"]`.
  Если ключа `plugin` нет → добавить; если есть, но spec отсутствует → дописать;
  если уже есть → skip. **Никогда не перезаписывать существующий контент.**
  Для локального клона репозитория допустим путь `./plugins/maestro-bootstrap/index.js`.
- Модели агентов — по M1 (см. ниже). **Плейсхолдеры запрещены.**

### M1 — выбор моделей агентов (7 отдельных HITL-вопросов)

**Оси Tier и Trust ортогональны.** Trusted — атрибут безопасности, не мощность.

- **Tier (мощность, Ось A):** design→opus, opus→opus, code-reviewer→opus,
  haiku→haiku, sonnet→sonnet, fable→fable, sanitizer→своя.
- **Trust (доверие, Ось B):** design ✅ + sanitizer ✅ trusted; остальные untrusted.

`design` и `sanitizer` — **оба trusted**, но **разные агенты с разными моделями**.

Для каждого из 7 агентов:
1. Определить tier-класс (Ось A).
2. Сформировать предложение (приоритет): эффективное значение `agent.<name>.model`
   (merge-представление: project → global): project `opencode.json` (если задан
   в проекте) → global (`~/.config/opencode/opencode.json`, наследуемая) →
   git-история → tier-подсказка (design→opus-модель; sanitizer→своя/безопасная).
3. HITL через вопросный инструмент (radio): «Модель для `<agent>`?». Варианты:
   кандидаты моделей из D2 (доступные из `provider.<name>.models`) + `auto`
   (ключ `model` не пишется) + «оставить текущую (из проекта)»/«оставить текущую
   (из global)» (если агент уже настроен на соответствующем уровне) +
   «свой вариант» (ручной ввод ID модели).
4. Записать `agent.<name>.model` только для выбранных, если значение отличается
   от эффективного; при `auto` — **не писать**. Если выбрана «оставить текущую» —
   не писать в project (наследование работает автоматически через merge).

**Temperature задаётся дефолтом по tier** (если у агента ещё нет значения в
`opencode.json`), пользователь может поправить:

| Агент | Tier | temperature (дефолт) |
|---|---|---|
| `haiku` | haiku | 0.0 |
| `sonnet` | sonnet | 0.1 |
| `opus` | opus | 0.1 |
| `code-reviewer` | opus | 0.2 |
| `fable` | fable | 0.7 |
| `design` | opus | 0.1 |
| `sanitizer` | своя | 0.0 |

- Если `agent.<name>.temperature` уже задан — **не перезаписывать** (сохранить
  пользовательское значение).
- Записывать `agent.<name>.temperature` только вместе с `model` (не при `auto`).
- При записи новой модели в проект: наследовать `temperature` из global (если
  задана), иначе — дефолт по tier.

> **Централизованный вариант (рекомендуется).** Настроить `agent.{design,haiku,
> sonnet,opus,fable,code-reviewer,sanitizer}` (model + temperature) один раз в
> global-конфиге `~/.config/opencode/opencode.json` — новые проекты наследуют
> значения, М1 предлагает «оставить текущую (из global)» первым вариантом.
> Подробнее: `manual_docs/tutorials/setup-project.md`.

**D2 — определение доступных моделей.** Список кандидатов для tier-подсказок
берётся из `provider.<name>.models` **по всем уровням конфигурации** (merge):
global (`~/.config/opencode/opencode.json`) → project (`opencode.json`) →
`.opencode/opencode.json`. Приоритет merge: `.opencode` > project > global.
Локальный конфиг может задать `provider` без `models` — тогда модели наследуются
из global. Fallback (если `models` нигде нет): HITL-ввод вручную + попытка
`opencode models <provider>`.

### .gitignore — весь `.maestro/` (только эфемерное)

Добавить (идемпотентно, не дублировать):
```
.maestro/
```
`.maestro/` содержит только эфемерное (sdd/, last-run.md, logs/, feedback-reports/,
plugin-version) и игнорируется целиком. Конфиг проекта — единственный файл
`maestro.json` в корне (рядом с `opencode.json`). **Никакие конфиги не класть в
`.maestro/`** — иначе они потеряются из git (`.maestro/` в `.gitignore`).

### regression/ — структура каталогов

Создать (идемпотентно):
```
regression/entries/.gitkeep
regression/released/.gitkeep
regression/cancelled-features.md   (пустой файл с заголовком)
```
Не входит в HITL-гейт (структурная необходимость).

**HITL gate по конфигу:** «Конфигурация сформирована. (a) approve — (b) правки —
(c) отмена». Показать diff-merge для каждого файла перед записью.

## Задача 4. Проверка/установка скилов superpowers

Проверить, установлены ли скилы superpowers (7 REQUIRED SUB-SKILLS maestro).

**Пробник** (без загрузки содержимого скилов в контекст):
1. Вызвать `skill` tool с **bogus-именем** (например `__maestro_probe__`).
2. В тексте ошибки `not found` прочитать полный список доступных скилов.
3. Проверить наличие всех 7: `writing-plans`, `subagent-driven-development`,
   `test-driven-development`, `using-git-worktrees`, `requesting-code-review`,
   `finishing-a-development-branch`, `systematic-debugging`.

- **Все найдены** → `superpowers: ok`, к следующему шагу.
- **Есть недостающие** → HITL:
  (a) установить глобально (`-g`) — (b) установить в проект — (c) пропустить.
  ```
  opencode plugin -g superpowers@git+https://github.com/obra/superpowers.git   # (a)
  opencode plugin superpowers@git+https://github.com/obra/superpowers.git       # (b)
  ```
  При (c) — пометка в `last-run.md` «superpowers НЕ установлен — SDD-шаги не
  работать будут» (fail-open, не блокирует).

## Задача 5. Проверка плагина `maestro-bootstrap`

Проверить, что плагин `maestro-bootstrap` подключён в `opencode.json` и
загружается:
- `"plugin"` содержит git-spec `maestro-bootstrap@git+https://github.com/wad-jet/maestro.git`
  (или аналог, например локальный путь `./plugins/maestro-bootstrap/index.js`).
- Файл плагина существует.
- **Не блокер:** если плагин не подключён/не загружается — НЕ останавливать init.
  Отметить в своде и `last-run.md`. Пользователь чинит после.

## Завершение

- **HITL-свод:** список созданных/изменённых файлов + git-статус (незакоммичено).
  Напоминание: коммит выполняет пользователь.
- Записать свод в `.maestro/last-run.md` (перезаписывается, в `.gitignore`).
  Включить статус superpowers (`ok` / `installed (restart required)` /
  `НЕ установлен`) и статус плагина.
- Сообщить, что setup завершён; для дизайна/спеки/scaffold/roadmap запустить
  `/maestro-design`.

## Обработка сбоев

| Ситуация | Действие |
|---|---|
| AGENTS.md нет и пользователь выбрал (b) | Продолжить, в своде отметить отсутствие AGENTS.md |
| project-context.md существует, выбран (a) | Пропустить «Задачу 2», перейти к задачам 3–5 |
| Git: выбран (a) без ветки | Писать файлы в текущее дерево |
| superpowers: формат ошибки `skill` tool изменился | Fallback: загрузить один канонический скил `test-driven-development` |
| superpowers: команда установки упала (сеть, git) | HITL: повторить / показать команду для ручного запуска / пропустить |
| superpowers: отказ (c) | Продолжить, пометка в last-run.md + своде |
| stack-detection не находит команду | HITL: вручную / `none` / отмена |
| Плагин не загружается (задача 5) | Отметить в своде/last-run, не блокировать; пользователь чинит после |
| models нигде не заданы (D2 fallback) | HITL-ввод вручную + попытка `opencode models <provider>` |