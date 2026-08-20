# maestro

Система оркестрации сквозной реализации фич и багфиксов в целевом приложении
через OpenCode. Pipeline от дизайна до мержа: ** brainstorm → spec → plan → SDD → review → docs ** —
с HITL-гейтами на ключевых точках.

> Это **authoring-репозиторий** (источник скиллов, агентов, команд). Нет приложения — скопируйте
> `.opencode/`, `skills/`, `commands/` и плагин в целевой проект (см.
> [Документация](manual_docs/index.md)).

## Что это

| Компонент | Описание |
|---|---|
| **Скилл `maestro`** | Спецификация pipeline (фичи / багфиксы / баг-дебаг) — `skills/maestro/SKILL.md` |
| **Команда `/maestro`** | Точка входа — загружает скилл и стартует pipeline |
| **Субагенты** | `design`, `haiku`, `sonnet`, `opus`, `fable`, `code-reviewer`, `sanitizer` |
| **Плагин** | `maestro-bootstrap` — санитайзинг промптов, file access control, audit-логи |
| **Команды** | `/maestro`, `/maestro-init`, `/maestro-design`, `/regression`, `/test-*` |

## Maestro vs superpowers напрямую

`maestro` — **оркестратор поверх скилов [superpowers](https://github.com/obra/superpowers)**: он связывает их в один
конвейер с HITL-гейтами, не заменяя сами скилы. Выбор между `maestro` и
использованием superpowers напрямую — это выбор между «всё включено» и «ручной
сборкой».

| Аспект | Maestro (`/maestro`) | Superpowers напрямую |
|---|---|---|
| **Scope** | Полный цикл фичи: design → spec → plan → SDD → review → docs | Отдельный этап (план, реализация, ревью и т.д.) |
| **Оркестрация** | Автоматическая: orchestrator сам диспатчит субагентов по маршруту | Ручная: вы решаете, какой скил и когда вызвать |
| **HITL-гейты** | Встроены на ключевых точках (категория, spec, plan, pre-PR) | Нет — каждый скил работает по своей схеме |
| **Spec / Spec Review** | Автоматически для сложных/архитектурных фич | Вызываете вручную (`brainstorming`, `writing-plans`) |
| **Безопасность** | Встроенный sanitizer + file access control | Нет (полагаетесь на permissions OpenCode) |
| **Регрессия** | Реестр рисков + `/regression` | Нет |
| **Когда использовать** | Сквозная фича/багфикс от начала до конца | Один конкретный шаг, ручной контроль каждого шага |

**Пример superpowers напрямую** — реализовать план без остального pipeline:

```
/brainstorming  →  /writing-plans  →  subagent-driven-development  →  /requesting-code-review
```

Внутри `maestro` используются те же скилы: `writing-plans`,
`subagent-driven-development`, `test-driven-development`, `using-git-worktrees`,
`requesting-code-review`, `finishing-a-development-branch`, `systematic-debugging` —
но оркестратор связывает их в один управляемый процесс.

## Быстрый старт

### 1. Настройте проект

Установить `maestro` в целевой проект можно двумя способами: через **agpack**
(рекомендуется) или **вручную**.

#### Вариант A — через [agpack](https://github.com/PhilippTh/agpack)

`agpack` — пакетный менеджер для AI-кодинг-тулов: объявил зависимости в
`agpack.yml`, запустил `agpack sync` — и скилы/команды/агенты разворачиваются
сами в `.opencode/` целевого проекта.

```bash
pipx install agpack            # или: uv tool install agpack
agpack init                    # создаёт agpack.yml
```

Минимальный `agpack.yml` для `maestro`:

```yaml
targets:
  - opencode

dependencies:
  skills:
    - url: https://github.com/wad-jet/maestro
      path: skills/maestro
    - url: https://github.com/wad-jet/maestro
      path: skills/maestro-init
    - url: https://github.com/wad-jet/maestro
      path: skills/maestro-design
    - url: https://github.com/wad-jet/maestro
      path: skills/manual-docs
    - url: https://github.com/obra/superpowers
      path: skills
  commands:
    - url: https://github.com/wad-jet/maestro
      path: commands
  agents:
    - url: https://github.com/wad-jet/maestro
      path: agents
```

Затем:

```bash
agpack sync                    # разворачивает skills/commands/agents в .opencode/
```

> **Примечание:** плагин `maestro-bootstrap` (санitize, file access control) и
> конфиги (`maestro.json`, `opencode.json`, `.gitignore`, `regression/`) agpack
> не покрывает — их создаёт `/maestro-init`.

#### Вариант B — вручную

Скопируйте `.opencode/`, `skills/`, `commands/` и плагин в **целевой проект**.

> В обоих вариантах подробности — [Настройка проекта](manual_docs/tutorials/setup-project.md).

Затем:

| Шаг | Что сделать |
|---|---|
| `/maestro-init` | Создаёт `project-context.md`, `maestro.json`, `.gitignore`, каталоги `.maestro/`, `regression/` |
| `/maestro-design` | Дизайн + spec + scaffold + roadmap (для новых проектов) |

**Варианты:**

- **Новый проект:** `/maestro-init` → `/maestro-design` → `/maestro`
- **Существующий:** `/maestro-init` сам детектирует context и merge-ит конфиги

### 2. Запустите pipeline

В любой сессии OpenCode:

```bash
/maestro "Реализуй экспорт в CSV с пагинацией"
```

Оркестратор проведёт через HITL-гейты: контекст → pre-flight → категория фичи → spec (если сложная) → план → реализация → ревью → merge.

### Быстрый маршрут для простых фич

Для небольших задач на 1-2 файла spec можно пропустить: категория **простая**
→ маршрут `0→6→7(b)→11→13→16→18`.

## Подключение плагина

В `opencode.json` целевого проекта:

```jsonc
// .opencode/opencode.json или opencode.json
{
  "plugin": [
    "./plugins/maestro-bootstrap/index.js"
  ]
}
```

Перезапустите OpenCode. Плагин создаст `.maestro/` с JSONL-логами.

## Docs

Полная документация по скиллу `maestro` — в [Diátaxis-справочнике](manual_docs/index.md).

## Структура

```
agents/          — конфиги субагентов (design, haiku, sonnet, opus, fable, code-reviewer, sanitizer)
commands/        — @command конфиги (/maestro, /maestro-init, /regression, /test-*)
plugins/         — maestro-bootstrap (ESM-плагин: sanitize, access_policy, observability)
skills/          — скиллы (maestro, maestro-init, maestro-design, manual-docs)
specs/           — дизайн-спеки и план-ы этого репо (never in root!)
manual_docs/     — пользовательская документация скилла (Diátaxis)
```

## Синхронизация

`skills/`, `agents/`, `commands/` здесь — **источник истины**. Runtime-копии
живут в целевом приложении:

```
authors/repo              →  target/app
skills/maestro/SKILL.md   →  .opencode/skills/maestro/SKILL.md
agents/haiku.md           →  .opencode/agents/haiku.md
commands/maestro.md       →  .opencode/commands/maestro.md
```

Изменили источник → обновите копию.

## Тесты плагина

```bash
node --test plugins/maestro-bootstrap/index.test.js
# или из каталога:
cd plugins/maestro-bootstrap && npm test
```

---

> **Russian — working language.** Все HITL-гейты, сообщения пользователю и
> документация на русском. New content follows this convention.
