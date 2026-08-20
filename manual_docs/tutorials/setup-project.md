# Настройка проекта для maestro

[Назад к оглавлению](../index.md)

Это обучающий материал: пошаговая подготовка проекта к использованию скилла
`maestro` перед запуском первых фич. Покрывает оба случая: **новый проект** и
**существующий проект, где maestro ранее не применялся**.

## 🎯 Что вы изучите

- Разницу между командами setup: `/maestro-init`, `/maestro-design` и `@maestro`.
- Как подготовить контекст и конфигурацию проекта.
- Как настроить модели агентов по тирам (и как их определяет `/maestro-init`).
- Как перейти к работе над фичами.

## 🧭 Три команды: порядок

| Команда | Что делает | Когда |
|---|---|---|
| `/maestro-init` | Setup: `project-context.md` (14 категорий), конфигурация (`maestro.json`, `opencode.json`, `.gitignore`), каталоги, проверки | Первый шаг — настроить проект |
| `/maestro-design` | Дизайн + spec, scaffold (каркас кода), roadmap | После init — спроектировать архитектуру |
| `@maestro` | Оркестрация фич/багфиксов (design → spec → plan → SDD → review) | Когда проект готов |

**Порядок:** `/maestro-init` → `/maestro-design` (для нового проекта) → `@maestro`.

---

## Вариант A — Новый проект

### Шаг 1: `/maestro-init`

Запустите `/maestro-init` в любой primary-сессии. Скилл `maestro-init` выполнит:

1. **Предусловие `AGENTS.md`** — если файла нет, предложит выполнить встроенный
   `/init` opencode (создаёт `AGENTS.md`).
2. **Сбор контекста** — интерактивный опрос по 14 категориям → создаёт
   `docs/project-context.md`. Обязательные секции: 1, 2, 3, 4, 9, 14.
3. **Конфигурация** — генерирует:
   - `maestro.json` — `trust` (design, sanitizer), `access_policy`,
     `sanitizer_whitelist`;
   - `opencode.json` — регистрация плагина `maestro-bootstrap` + модели агентов;
    - `.gitignore` — конкретные пути (`.maestro/sdd/`, `.maestro/last-run.md`,
      `.maestro/logs/`);
   - `regression/` — структуру реестра рисков.
4. **Каталоги** — `.maestro/`, `docs/superpowers/{specs,plans}/`.
5. **Проверки** — скилы superpowers (предложит установить через HITL), плагин
   `maestro-bootstrap` (не блокер).

> На шаге «Настройка моделей» `/maestro-init` спросит модели для агентов — см.
> раздел [Настройка моделей по тирам](#настройка-моделей-по-тирам) ниже.

### Шаг 2: `/maestro-design`

После init запустите `/maestro-design`. Скилл `maestro-design` выполнит:
- **(a) Дизайн + spec** — сабагент `design` (trusted) проанализирует контекст и
  напишет `docs/superpowers/specs/YYYY-MM-DD-<project>-design.md`. Опционально —
  Spec Review (`opus`).
- **(b) Scaffold** — создаст каркас кода (структура каталогов, роуты, DTO,
  конфиги) через `implementer-prompt.md` (TDD) с диспатчем `haiku`/`sonnet`.
- **(c) Roadmap** — создаст `docs/roadmap.md` (MVP + этапы развития).

### Шаг 3: `@maestro`

Теперь проект готов. Используйте `@maestro` для фич/багфиксов (см.
[Быстрый старт](../overview/quick-start.md) и
[Запуск первой фичи](run-first-feature.md)).

---

## Вариант B — Существующий проект (maestro ранее не применялся)

### Особенности

- `docs/project-context.md` может уже существовать → `/maestro-init` предложит
  перечитать его (а не опрашивать заново) или пересоздать.
- Конфигурации maestro может не быть → `/maestro-init` создаст её **идемпотентно**:
  diff-merge, **не перезаписывая** пользовательские правки.
- Модели агентов — подсказки берутся из **текущего** `opencode.json` и
  **git-истории** проекта (см. раздел про модели).

### Шаг 1: `/maestro-init`

Запустите `/maestro-init`. Поведение:

1. **`project-context.md`** — если существует, HITL: (a) перечитать и перейти к
   конфигурации / (b) пересоздать с нуля / (c) отмена.
2. **Конфигурация** — если `maestro.json` есть, покажет diff «желаемое vs
   текущее» по секциям (`trust`, `access_policy`, `sanitizer_whitelist`) и
   предложит: обновить / пропустить / отмена. **Пользовательские правки
   сохраняются** (merge).
3. **Модели агентов** — для каждого из 7 агентов предложение формируется из:
   1. текущий `opencode.json`;
   2. git-история проекта (если агент был настроен ранее);
   3. tier-подсказка (для новых/не настроенных).
4. **Каталоги и проверки** — как в новом проекте.

### Шаг 2: `/maestro-design`

`/maestro-design` проверяет, выполнялся ли `/maestro-init` (Признаки:
`docs/project-context.md`, `maestro.json`, `.maestro/last-run.md`). Если init не
выполнялся — предложит выполнить его сначала. Затем — дизайн + spec + scaffold +
roadmap, как в Варианте A.

### Шаг 3: `@maestro`

Проект готов. Используйте `@maestro`.

---

## Настройка моделей по тирам

### Оси Tier и Trust — ортогональны

- **Tier** — мощность модели (выбор провайдера).
- **Trust** — доверие (`maestro.json → trust`), доступ к секретам. **Trusted — это
  атрибут безопасности, а не мощность.**

### Агенты: tier и trust

| Агент | Tier (роль) | Trusted? |
|---|---|---|
| `design` | opus (spec formation, архитектура) | ✅ |
| `sanitizer` | своя модель (security review) | ✅ |
| `opus` | opus (spec review) | ❌ |
| `code-reviewer` | opus (code review) | ❌ |
| `haiku` | haiku (механические задачи) | ❌ |
| `sonnet` | sonnet (интеграционные задачи) | ❌ |
| `fable` | fable (примеры/метафоры) | ❌ |

> `design` и `sanitizer` — **оба trusted**, но **разные агенты с разными моделями**.

### Как `/maestro-init` определяет доступные модели (D2)

Список кандидатов для подсказок берётся из `provider.<name>.models` **по всем
уровням конфигурации** (merge):

| Уровень | Файл |
|---|---|
| global | `~/.config/opencode/opencode.json` |
| project | `<project>/opencode.json` |
| project `.opencode` | `<project>/.opencode/opencode.json` |

**Приоритет merge:** `.opencode` > project > global.

> Локальный конфиг может задать `provider` **без** `models` — тогда модели
> наследуются из global. `/maestro-init` читает все уровни, а не только локальный.
> Fallback (если `models` нигде нет): ручной ввод + `opencode models <provider>`.

### Как выбираются модели (M1) — 7 HITL-вопросов

Для **каждого из 7 агентов** `/maestro-init` задаёт отдельный вопрос:
«Модель для `<agent>`? (введите ID / `auto` / оставить текущую)».

- **7 отдельных вопросов** — чтобы `design` и `sanitizer` могли получить разные
  модели.
- **`auto`** — ключ `model` не пишется (наследуется дефолт сессии).
- **Плейсхолдеры запрещены** (`<...>` невалидны, сломают загрузку агента).

### Пример mapping tier → модель

В проекте `maestro` модели настроены так (пример):

| Агент | Tier | Модель (пример) | Темп. |
|---|---|---|---|
| `haiku` | haiku | `akash/Qwen/Qwen3.6-35B-A3B` | 0.0 |
| `sonnet` | sonnet | `akash/deepseek-ai/DeepSeek-V4-Flash` | 0.1 |
| `opus` | opus | `akash/zai-org/GLM-5.2` | 0.1 |
| `code-reviewer` | opus | `akash/deepseek-ai/DeepSeek-V4-Flash-0731` | 0.2 |
| `fable` | fable | `akash/deepseek-ai/DeepSeek-V4-Flash` | 0.7 |
| `design` | opus | (модель opus-tier) | — |
| `sanitizer` | своя | (безопасная/дефолтная) | — |

> Модели — **preference пользователя**. `/maestro-init` лишь предлагает кандидатов
> из доступных (D2) и tier-класса; конкретный выбор — за пользователем.

---

## Что дальше

- [Быстрый старт](../overview/quick-start.md) — минимальный путь к фиче.
- [Запуск первой фичи](run-first-feature.md) — полный цикл 0→18.
- [Выбор моделей](../reference/model-selection.md) — справочник tier/субагентов.

## 🔗 Связанные разделы

- [Выбор моделей](../reference/model-selection.md)
- [Команды](../reference/commands.md)
- [Агенты и модель доверия](../explanation/agents-and-trust.md)