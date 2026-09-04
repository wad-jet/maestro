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
| **Команда `/maestro-init`** | Точка входа в пайплайн — загружает скилл и стартует pipeline |
| **Субагенты** | `custodian`, `haiku`, `sonnet`, `opus`, `fable`, `code-reviewer`, `sanitizer` |
| **Плагин** | `maestro-bootstrap` — санитайзинг промптов, file access control, audit-логи |
| **Команды** | `/maestro-init`, `/maestro-new`, `/maestro-design`, `/regression`, `/test-agents` |

## Maestro vs superpowers напрямую

`maestro` — **оркестратор поверх скилов [superpowers](https://github.com/obra/superpowers)**: он связывает их в один
конвейер с HITL-гейтами, не заменяя сами скилы. Выбор между `maestro` и
использованием superpowers напрямую — это выбор между «всё включено» и «ручной
сборкой».

| Аспект | Maestro (`/maestro-init`) | Superpowers напрямую |
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

**Самый простой способ — скрипт `maestro-install.sh`** (новый или существующий проект,
где maestro ранее не применялся). Он устанавливает `agpack`, создаёт `agpack.yml`,
запускает `agpack sync`, подключает плагин `maestro-bootstrap` и загружает
`maestro-update.sh` (для будущих обновлений):

```bash
curl -fsSL https://raw.githubusercontent.com/wad-jet/maestro/main/maestro-install.sh -o maestro-install.sh
bash maestro-install.sh
```

> Предусловия: bash (macOS/Linux), python3 ≥ 3.11, git, curl или wget, сеть.
> Windows — запускайте через WSL или Git Bash. После скрипта — перезапустите
> OpenCode и выполните `/maestro-new` (см. шаг 3 ниже).

Установить `maestro` можно также через **agpack** (вручную) или **копированием**.
Подробная инструкция с `agpack.yml`, картой путей и подключением плагина —
[Первая установка maestro](manual_docs/how-to/install-maestro.md).

### 2. Подключите плагин

Плагин `maestro-bootstrap` (санитайзинг промптов, file access control, audit-логи)
подключается **до** запуска пайплайна. Он поставляется из git-репозитория `wad-jet/maestro`
(публикация в npm не используется). Подключение (из git или локально) — в
[Первая установка maestro](manual_docs/how-to/install-maestro.md).

> **Версия плагина.** Единственный источник версии — **корневой** `package.json`
> репозитория (сейчас `1.2.2`). `readPluginVersion()` резолвит его относительно
> `core.js` (`plugins/maestro-bootstrap/` → `../../package.json`, фиксированная
> глубина макета репо). Не копируйте папку плагина отдельно от репозитория —
> версия не определится (`/maestro-version` сообщит «не инициализирован»).

### 2.5. Как обновить maestro

Версия **и плагина, и скилов — единая** (корневой `package.json → version`).

- **Рекомендуемый способ — `maestro-update.sh`:** одна команда определяет целевую
  версию, запускает `agpack sync`, очищает кэш плагина; опционально `--pin <sha>`.
- **Скиллы/команды/агенты:** `agpack sync` (либо вручную из репозитория).
- **Плагин:** кэшируется в `~/.cache/opencode/packages/` и НЕ обновляется при
  перезапуске OpenCode — перезапуск сам по себе не подтянет новую версию. Кэш
  очищает `maestro-update.sh`; при ручном обновлении — очистить кэш вручную
  (`rm -rf ~/.cache/opencode/packages/maestro-bootstrap@git+https:...`) + перезапуск.
  Для фиксации коммита — fragment `#<commit-sha>`.
- **Контроль версии:** `/maestro-version` — показывает фактическую версию
  плагина (`.maestro/plugin-version`).

Подробно — [Обновление maestro](manual_docs/how-to/update-maestro.md).

### 3. Инициализируйте проект

В целевой сессии OpenCode:

| Команда | Для кого | Что делает |
|---|---|---|
| `/maestro-new` | Новый и существующий | Создаёт `project-context.md`, `maestro.json`, `.gitignore`, каталоги `.maestro/`, `regression/`; для существующего — детектит context и merge-ит конфиги |
| `/maestro-design` | Новый (опционально) | Дизайн + spec + scaffold + roadmap |

- **Новый проект:** `/maestro-new` → `/maestro-design` → `/maestro-init`
- **Существующий:** `/maestro-new` → `/maestro-init`

> **Внимание (v2.0.0):** команда `/maestro-init` теперь — **вход в пайплайн фич**
> (ранее была bootstrap). Bootstrap нового проекта — `/maestro-new`. Старая команда
> `/maestro` удалена. При переходе обновите `agpack.yml` целевого проекта
> (`skills/maestro-init` → `skills/maestro-new`) или перезапустите `maestro-install.sh`/
> `maestro-update.sh` — они сделают это автоматически.

Подробности — [Настройка проекта](manual_docs/tutorials/setup-project.md).

#### Настройка моделей агентов по тирам

M1-воркфлоу (`/maestro-new`) задаёт **7 отдельных HITL-вопросов** (по одному на
агента — гибкость выбора): `custodian` и `sanitizer` могут получить разные модели, но
**одна модель тоже допустима** (см. выше). Для каждого агента предложение
формируется из каскада:

```
.opencode/opencode.json (project) → global (~/.config/opencode/opencode.json) → tier-подсказка
```

**Оси Tier и Trust — ортогональны.** Tier — класс ответственности агента (тип
задачи, модальность, требование к рассуждению); «мощность» — лишь косвенное
следствие (по способности к рассуждению), не единственный критерий (`fable` —
модальность, `sanitizer` — доверие). Контекст задаёт конкретная модель, не тир.
Trust — доверие (`maestro.json → trust`), атрибут безопасности, не мощность.
Trusted по роли: `custodian` + `sanitizer` (обоим доступен `docs/confidential/**`),
но это **разные агенты** (модели могут быть разными, но одна модель тоже допустима
на усмотрение пользователя — например, одна локальная/изолированная для обоих).

| Агент | Tier (роль) | Trusted? |
|---|---|---|
| `custodian` | opus (Q/A-брокер по confidential) | ✅ |
| `sanitizer` | своя модель (security review) | ✅ |
| `opus` | opus (spec review) | ❌ |
| `code-reviewer` | opus (code review) | ❌ |
| `haiku` | haiku (механические задачи) | ❌ |
| `sonnet` | sonnet (интеграционные задачи) | ❌ |
| `fable` | fable (примеры/метафоры) | ❌ |

Кандидаты моделей для подсказок (D2) берутся из `provider.<name>.models` по всем
уровням конфигурации (merge), с приоритетом project > global.

**Рекомендуемый способ — централизованная глобальная настройка.** Настроить
`agent.{custodian,haiku,sonnet,opus,fable,code-reviewer,sanitizer}` (model +
`temperature`) один раз в `~/.config/opencode/opencode.json` — новые проекты
наследуют значения, `/maestro-new` предлагает «оставить из global» первым
вариантом. Project `.opencode/opencode.json` переопределяет global при нужде в
индивидуальном наборе. Корневой `opencode.json` не используется.

`temperature` задаётся дефолтом по tier, если у агента нет собственного значения
(существующее не перезаписывается). Полная таблица дефолтов и ролей — в
[Выборе моделей](manual_docs/reference/model-selection.md).

> **«Своя модель»** (`sanitizer`) — вне четырёх тиров: подбирается под
> security-задачу (точность, надёжность), не обязана быть мощной/лёгкой;
> `temperature 0.0` по умолчанию. Роль — доверие (trusted), не мощность.
> Определение — в [Выборе моделей](manual_docs/reference/model-selection.md).

#### Проверка конфигурации моделей

После настройки моделей убедитесь, что каждый сабагент реально диспатчится и
модель доступна — командой `/test-agents`:

- диспатч каждого из 7 сабагентов (`custodian`, `haiku`, `sonnet`, `opus`, `fable`,
  `code-reviewer`, `sanitizer`) тривиальной тестовой задачей «верни OK и своё имя»;
- сводная таблица `OK / FAIL` по каждому агенту с причиной при ошибке (недоступна
  модель, ошибка провайдера, таймаут);
- дополнительно проверяется confidential-инвариант: trusted-агент читает
  `docs/confidential/**`, а primary-сессия получает `deny`.

Проверка **не читает конфиги** — только реальную работу модели через `task`-диспатч.
Подробно — [Проверка сабагентов](manual_docs/reference/commands.md) и
[Настройка проекта](manual_docs/tutorials/setup-project.md).

### 4. Запустите pipeline

В любой сессии OpenCode:

```bash
/maestro-init "Реализуй экспорт в CSV с пагинацией"
```

Оркестратор проведёт через HITL-гейты: контекст → pre-flight → категория фичи → spec (если сложная) → план → реализация → ревью → merge.

### Быстрый маршрут для простых фич

Для небольших задач на 1-2 файла spec можно пропустить: категория **простая**
→ маршрут `0→6→7(b)→11→13→16→18`. Сжатая запись опускает шаги 14/15/15a для
краткости — **шаг 14 (обновление пользовательской документации) обязателен**
для всех категорий (для простых пропускаются только шаги 8-10).

## Docs

Полная документация по скиллу `maestro` — в [Diátaxis-справочнике](manual_docs/index.md).

## Структура

```
agents/          — конфиги субагентов (custodian, haiku, sonnet, opus, fable, code-reviewer, sanitizer)
commands/        — @command конфиги (/maestro-init, /maestro-new, /regression, /test-agents)
plugins/         — maestro-bootstrap (ESM-плагин: sanitize, access_policy, observability)
skills/          — скиллы (maestro, maestro-new, maestro-design, manual-docs — generic user-docs)
specs/           — дизайн-спеки и план-ы этого репо (never in root!)
manual_docs/     — пользовательская документация скилла (Diátaxis)
```

## Тесты плагина

```bash
node --test plugins/maestro-bootstrap/index.test.js
# или:
npm test
```

---

> **Russian — working language.** Все HITL-гейты, сообщения пользователю и
> документация на русском. New content follows this convention.
