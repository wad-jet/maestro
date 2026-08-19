---
name: init
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
и roadmap — в отдельной команде `/maestro-design` (скилл `design`). Это разделение
зафиксировано в `specs/maestro-init-tasks-plan.md`.

**Мы НЕ переопределяем встроенный `/init` opencode** (тот создаёт `AGENTS.md`).
`/maestro-init` — отдельная команда.

**Язык:** все HITL-вопросы, варианты и сообщения пользователю — только на русском.

## Артефакты, которые производит скилл

| Задача | Выход |
|---|---|
| 1. `/init` гейт | `AGENTS.md` (проверка/создание через встроенный `/init`) |
| 2. Контекст | `docs/project-context.md` (14 категорий, см. `init-context.md`) |
| 3. Конфиг | `maestro.json` (trust/access_policy/sanitizer_whitelist) + `opencode.json` (plugin + агенты M1) + `.gitignore` + `regression/` |
| 3а. Каталоги | `.maestro/`, `docs/superpowers/{specs,plans}/` |
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
- Фиксирует ответ в накапливаемый черновик.
- Обязательные секции: 1, 2, 3, 4, 9, 14. Остальные — по релевантности,
  либо помечаются `_pending_` (не блокируют).

Секция `14. Commands`: после опроса применить `stack-detection.md` для
автозаполнения команд по артефактам (если проект уже имеет манифесты), либо
задать явно/`auto`/`none` (см. §14 в `init-context.md`). Неоднозначность → HITL.

В конце — показать пользователю готовый черновик `docs/project-context.md`.

**HITL gate:** «Контекст корректен? (a) approve — (b) правки — (c) отмена».
При (b) — внести правки и повторить gate.

→ создаёт `docs/project-context.md`.

## Задача 3. Конфигурация maestro

На основе контекста (§3 стек, §5 домены, §12 безопасность) сгенерировать конфиги
идемпотентно (см. `specs/init-idempotency-plan.md` для деталей).

### 3а. Подготовка каталогов

Перед генерацией конфигов (идемпотентно, `mkdir -p` безопасен):
- `mkdir -p .maestro/` (для логов плагина и `last-run.md`)
- `mkdir -p docs/superpowers/specs docs/superpowers/plans` (для `/maestro-design`)

### maestro.json (консолидированный конфиг, коммитится в git)

Три секции:

**`trust`** — только trusted сабагенты (`true`):
```json
"trust": {
  "design": true,
  "sanitizer": true
}
```
- `design` и `sanitizer` — trusted по роли. Остальные — untrusted (default).
- Идемпотентность: merge сохраняет пользовательские trusted-агенты.

**`access_policy`** — из §3 + §5 + §12:
```json
"access_policy": {
  "version": 1,
  "default": "ask",
  "allow": ["src/**", "test/**", "packages/**", "*.{ts,js,py,go,rs}"],
  "ask": ["docs/**", "specs/**", "manual_docs/**", "*.{md,mdx}", "*.config.*"],
  "deny": ["*.env", "*.env.*", "*.{pem,key,cert,secret}"]
}
```
Эталон: `plugins/maestro-bootstrap/examples/maestro.example.json`.

**`sanitizer_whitelist`** — из §3 + §12:
```json
"sanitizer_whitelist": {
  "rules": { "env_secret": true, "data_field": true, "env_file": true, "db_credential": true, "ledger_entry": true, "private_key": true, "auth_header": true },
  "by_agent": { "code-reviewer": [] },
  "patterns": [],
  "extra_fields": [],
  "extra_uri_schemes": []
}
```

Идемпотентность: при существовании `maestro.json` — diff по секциям; merge
сохраняет пользовательские правки. Если файла нет — создаётся целиком.

### opencode.json — регистрация плагина + модели агентов

- Регистрация плагина: `"plugin": ["./plugins/maestro-bootstrap/index.js"]`.
  Если ключа `plugin` нет → добавить; если есть, но путь отсутствует → дописать;
  если уже есть → skip. **Никогда не перезаписывать существующий контент.**
- Модели агентов — по M1 (см. ниже). **Плейсхолдеры запрещены.**

### M1 — выбор моделей агентов (7 отдельных HITL-вопросов)

**Оси Tier и Trust ортогональны.** Trusted — атрибут безопасности, не мощность.

- **Tier (мощность, Ось A):** design→opus, opus→opus, code-reviewer→opus,
  haiku→haiku, sonnet→sonnet, fable→fable, sanitizer→своя.
- **Trust (доверие, Ось B):** design ✅ + sanitizer ✅ trusted; остальные untrusted.

`design` и `sanitizer` — **оба trusted**, но **разные агенты с разными моделями**.

Для каждого из 7 агентов:
1. Определить tier-класс (Ось A).
2. Сформировать предложение (приоритет): текущий `opencode.json` → git-история →
   tier-подсказка (design→opus-модель; sanitizer→своя/безопасная).
3. HITL: «Модель для `<agent>`? (введите ID / `auto` / оставить текущую)».
4. Записать `agent.<name>.model` только для выбранных; при `auto` — **не писать**.

**D2 — определение доступных моделей.** Список кандидатов для tier-подсказок
берётся из `provider.<name>.models` **по всем уровням конфигурации** (merge):
global (`~/.config/opencode/opencode.json`) → project (`opencode.json`) →
`.opencode/opencode.json`. Приоритет merge: `.opencode` > project > global.
Локальный конфиг может задать `provider` без `models` — тогда модели наследуются
из global. Fallback (если `models` нигде нет): HITL-ввод вручную + попытка
`opencode models <provider>`.

### .gitignore — конкретные пути (не весь `.maestro/`)

Добавить недостающие записи (не дублировать):
```
.maestro/sdd/
.maestro/last-run.md
.maestro/maestro-bootstrap-*.log
```
**НЕ** использовать `.maestro/` (весь каталог) — эфемерные файлы игнорируются
точечно; конфиги (`maestro.json`) коммитятся в git.

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
- `"plugin"` содержит `./plugins/maestro-bootstrap/index.js` (или аналог).
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