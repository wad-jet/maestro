# План: задачи команды `maestro-init` и порядок их выполнения

> Статус: **зафиксирован (design), реализация не начата**.
> Дата: 2026-08-19. Репо: `maestro-agent` (authoring).
> Связь: уточняет/дополняет `specs/init-idempotency-plan.md` (конфиг-генерация);
> базируется на реальном фидбеке `maestro-init-feedback.md` (пропуск `maestro.json`).

## Контекст

Запуск `/maestro-init` на отдельном проекте выявил пропуск настройки конфигурации
(`maestro.json` не создавался до дизайна). Обратная связь зафиксирована в
`maestro-init-feedback.md`. `init-idempotency-plan.md` уже спроектировал «Шаг 1.5
Конфигурация maestro», но реализация не начата.

Данный план **фиксирует согласованный с пользователем набор задач команды
`maestro-init`**, **порядок их выполнения** и **разделение на две команды**
(`/maestro-init` + новый `/maestro-design`) — как единое видение перед реализацией.

## Разделение команд

- **`/maestro-init`** — только setup-фаза (задачи 1–5 ниже): гейт, контекст,
  конфиг, каталоги, проверки.
- **`/maestro-design`** — отдельная команда: выносит из init шаги (a) дизайн+spec,
  (b) scaffold, (c) roadmap. Новый скилл `maestro-design` + команда `maestro-design`.

## Задачи `/maestro-init` (setup-фаза)

| # | Задача | Тип | Блокер? | Зависит от |
|---|--------|-----|---------|-----------|
| **1** | Проверка/запуск `/init` (AGENTS.md) | pre-flight гейт | да | — |
| **2** | Подготовка/актуализация `project-context.md` (14 категорий) | основной | да | #1 |
| **3** | Подготовка конфига: `maestro.json` + `opencode.json` (plugin + агенты M1) + `.gitignore` | основной | да | #2 |
| **3а** | Подготовка каталогов pipeline: `.maestro/`, `docs/superpowers/{specs,plans}/` | основной | да (в составе #3) | #2 |
| **4** | Проверка/установка скилов superpowers (HITL: global/project/skip) | проверка | нет | — |
| **5** | Проверка плагина `maestro-bootstrap` | проверка | **нет** (не блокер) | #3 |

## Порядок выполнения (логика)

Порядок скорректирован относительно исходного списка пользователя по его же
решению «контекст → конфиг»:

1. **Задача 1 (AGENTS.md)** — первое место как pre-flight гейт. Это встроенный
   `/init` opencode (создаёт `AGENTS.md`), НЕ переопределяется. Если `AGENTS.md`
   нет — HITL: запустить `/init` / пропустить / отмена.
2. **Задача 2 (project-context.md)** — сбор/актуализация контекста по 14
   категориям. Нужен для вывода параметров конфига.
3. **Задача 3 (конфиг)** — генерация `maestro.json` (trust/access_policy/
   sanitizer_whitelist) ИЗ контекста (§3 стек, §5 домены, §12 безопасность),
   регистрация плагина в `opencode.json`, выбор моделей агентов (M1, см. ниже),
   `.gitignore` (конкретные пути), структура `regression/`. Идемпотентно.
4. **Задача 3а (каталоги)** — `mkdir -p .maestro/`,
   `docs/superpowers/{specs,plans}/` (необходимы для логов и шага (a) design).
5. **Задача 4 (superpowers)** — проверка скилов; при отсутствии — HITL-предложение
   установить (global/project/skip); при skip — пометка в `last-run.md`.
6. **Задача 5 (плагин)** — проверка подключения `maestro-bootstrap`. **Не блокер:**
   если не загружается — не останавливать init, отметить в своде.

## Модель: Tier (мощность) vs Trust (доверие) — ортогональные оси

При выборе моделей важно различать две независимые оси. **Trusted — это атрибут
безопасности, а не мощность модели.**

### Ось A — Tier (мощность модели, выбор провайдера)

| Агент | Tier (роль) |
|-------|-------------|
| `design` | opus (spec formation, архитектура) |
| `opus` | opus (spec review) |
| `code-reviewer` | opus (code review) |
| `haiku` | haiku (механические задачи) |
| `sonnet` | sonnet (интеграционные задачи) |
| `fable` | fable (примеры/метафоры) |
| `sanitizer` | **своя отдельная модель** (security review — не обязана быть opus) |

### Ось B — Trust (доверие, `maestro.json` → `trust`)

| Агент | Trusted? |
|-------|----------|
| **`design`** | ✅ trusted |
| **`sanitizer`** | ✅ trusted |
| opus, haiku, sonnet, fable, code-reviewer | ❌ untrusted (default) |

**Ключевое:** `design` и `sanitizer` — **оба trusted**, но это **разные агенты с
разными моделями**:
- `design` — trusted + **opus-tier** (мощная, для spec/архитектуры).
- `sanitizer` — trusted + **своя модель** (security review; может быть лёгкой/
  специфичной, не обязательно opus).

`maestro.json` → `trust`: `design: true`, `sanitizer: true`.

## M1 — выбор моделей агентов в `/maestro-init`

**7 отдельных HITL-вопросов** (по одному на каждого из 7 агентов) — чтобы
гарантировать, что `design` и `sanitizer` получат разные модели.

1. tier-класс per агент (см. «Ось A»).
2. Предложение per агент (приоритет):
   1. текущий `opencode.json` (не перезаписывать молча);
   2. git-история проекта (fallback-подсказка);
   3. tier-подсказка: `design`→opus-модель; `sanitizer`→своя/безопасная.
3. HITL per агент: «Модель для `<agent>`? (введите ID / `auto` — наследовать
   дефолт сессии / оставить текущую)».
4. Записать `agent.<name>.model` только для выбранных; при `auto` — **не писать**;
   плейсхолдеры (`<...>`) запрещены (невалидный ID сломает загрузку агента, I2).
5. Повторный init (идемпотентность): уже настроенные агенты — skip (не
   перезаписывать), спрашиваются только недостающие.

## Задачи `/maestro-design` (отдельный проход)

| Шаг | Выход | Модель |
|-----|-------|--------|
| (a) | spec (dispatch `design`, trusted) → `docs/superpowers/specs/YYYY-MM-DD-<project>-design.md`; опц. spec-review (`opus`) | **наследует** из opencode.json (не переспрашивает) |
| (b) | scaffold (implementer-prompt, TDD RED→GREEN→REFACTOR, dispatch `haiku`/`sonnet` по tier) | **наследует** |
| (c) | `docs/roadmap.md` (MVP + этапы развития) | — |

**`/maestro-design` наследует** настроенные в `opencode.json` агенты и **НЕ
переспрашивает модели**.

## Расхождения с исходным списком пользователя

- Пользователь ставил: конфиг(1) → контекст(2) → superpowers(3) → плагин(4) →
  AGENTS(5).
- Скорректировано:
  - **AGENTS.md → на первое место** (pre-flight гейт).
  - **Контекст → перед конфигом** (решение «контекст → конфиг»).
  - **Дизайн/scaffold/roadmap вынесены из init** в `/maestro-design`.

## Скоуп реализации (файлы)

### Ядро (`maestro-agent/`)
| # | Файл | Действие |
|---|------|----------|
| 1 | `skills/maestro-init/SKILL.md` | Убрать (a)/(b)/(c); добавить задачи 3а/4/5 + M1 + trust/tier; обновить «Артефакты»/«Завершение»/«Сбои» |
| 2 | `skills/maestro-init/init-context.md` | Раздел «Вывод конфигурации из контекста» (правила вывода секций из §3/§5/§12) |
| 3 | `skills/maestro-design/SKILL.md` | **новый** — дизайн+spec+scaffold+roadmap (a+b+c) |
| 4 | `commands/maestro-init.md` | Отразить setup-задачи (1–5, 3а) |
| 5 | `commands/maestro-design.md` | **новый** |

### Доки (`maestro-agent/`)
| # | Файл | Действие |
|---|------|----------|
| 6 | `specs/maestro-init-tasks-plan.md` | (этот файл) — зафиксировать решения |
| 7 | `AGENTS.md` | Fix C2/M3: `.gitignore` — конкретные пути |
| 8 | `plugins/maestro-bootstrap/README.md` | Fix C2/M3: «каталог gitignored» → конкретные пути |

### manual_docs (`maestro-agent/`)
| # | Файл | Действие |
|---|------|----------|
| 9 | `reference/commands.md` | `/maestro-init` (убр. design) + добавить `/maestro-design` |
| 10 | `reference/model-selection.md` | Логика M1 + trust/tier оси |
| 11 | `overview/quick-start.md` | Bootstrap flow (init → design) |
| 12 | `overview/what-is-maestro.md` | Упомянуть flow init → design |
| 13 | `overview/changelog.md` | Entry: разделение init/design |
| 14 | `explanation/agents-and-trust.md` | `maestro.json` генерируется `/maestro-init` |
| 15 | `how-to/customize-maestro.md` | Список артефактов (конфиги, regression/) |
| 16 | `index.md` | Проверить ссылки |

### Применение
| # | Файл | Действие |
|---|------|----------|
| 17 | `.opencode/` зеркала | Синхронизация skills/maestro-init, skills/maestro-design, commands |
| 18 | `maestro`-проект | Применить: `maestro.json`, `.gitignore` (конкретные пути), `regression/cancelled-features.md` |

## Проверка

- `node --test plugins/maestro-bootstrap/index.test.js` — 63/63 (плагин fail-open
  совместим, не меняется).
- Верификация = ревью когерентности доков (исполняемого теста для скилла `maestro-init`
  нет — см. M2 в `init-idempotency-plan.md`).
- Ручной прогон `/maestro-init` на чистом тестовом проекте в `/tmp`.

## Порядок исполнения

1. **Группа A — Ядро:** init-skill, design-skill, init-context, commands. Проверка
   когерентности.
2. **Группа B — Доки:** specs-план, AGENTS.md, plugins/README.md, manual_docs.
3. **Группа C — Применение:** `.opencode/` зеркала + `maestro`-проект.
4. **Группа D — Проверка:** `node --test` (63/63) + ручной прогон в `/tmp`.

## Определение доступных моделей для конфигурации по tiers

**Решение: D2 (из `provider.models`) с учётом ВСЕХ уровней конфигурации.**

`/maestro-init` должен читать `provider.<name>.models` **по всем уровням конфигурации
opencode** (merge), а не только из локального `opencode.json`:

| Уровень | Файл | Роль |
|---------|------|------|
| global | `~/.config/opencode/opencode.json` | базовый (может содержать `provider.models`) |
| project | `<project>/opencode.json` | переопределяет global |
| project `.opencode` | `<project>/.opencode/opencode.json` | переопределяет project |

**Приоритет merge:** `.opencode` > project > global (более специфичный выигрывает).

**Почему важно:** opencode **мержит** уровни, а не заменяет. Локальный конфиг
может задать `provider.akash` **без** `models` — тогда модели наследуются из global.
Пример (проект `maestro`): global имеет `provider.akash.models` (4 модели),
локальный `opencode.json` задаёт `provider.akash` без `models` → доступные модели
приходят из global. Если init читает только локальный конфиг — список моделей
будет пуст.

**Алгоритм D2 (все уровни):**
1. Собрать provider-конфиги по всем уровням (global → project → `.opencode`), merge
   по ключу `provider.<name>` (специфичный уровень выигрывает).
2. Для каждого провайдера собрать `models` (объединение ключей `models` по уровням,
   с переопределением на более специфичном уровне).
3. Полученный список ID моделей — кандидаты для tier-подсказок в M1.
4. Fallback (если `models` нигде не задан): HITL-ввод вручную + попытка
   `opencode models <provider>`.

## Open questions

- Скоуп первого прохода: только ядро (A), или + доки (B), или + применение (C).

## Документация setup-гайда (manual_docs)

**Решение (2026-08-19):** создан пошаговый гайд настройки проекта —
`manual_docs/tutorials/setup-project.md`. Покрывает оба варианта (новый проект и
существующий без maestro), механику настройки моделей по тирам (M1/D2) с
примерами. Обновлены: `run-first-feature.md`, `quick-start.md`, `index.md`,
`model-selection.md`, `keep-docs-up-to-date.md` (строка в чек-лист),
`changelog.md` (entry).

**Обоснование:** в manual_docs не было инструкции по setup-фазе (`/maestro-init`/
`/maestro-design`); quick-start и run-first-feature начинали сразу с `@maestro`.