# Выбор моделей

[Назад к оглавлению](../index.md)

## 🎯 Назначение

Справочник tier-моделей и их ролей в pipeline скилла `maestro`. Модели
настраиваются пользователем в `opencode.json`; выбор делает оркестратор по
tier-правилам.

## 📖 Tier → тип задачи

| Tier | Когда использовать | OpenCode сабагент |
|---|---|---|
| **Haiku** (быстрая/дешёвая) | Механические task-и: 1-2 файла, полный spec, трансляция+тесты | `haiku` |
| **Sonnet** (средняя/сбалансированная) | Интеграционные task-и: multi-file, pattern matching, debugging | `sonnet` |
| **Opus** (наиболее мощная) | Архитектура, spec formation, design judgment, final whole-branch review | `design` (spec formation), `opus` (spec review), `code-reviewer` (code review) |
| **Fable** (креативная) | Примеры, метафоры, аналогии, пояснения в стиле историй | `fable` |

## 📖 Шаг → Tier

| Шаг | Tier | OpenCode сабагент |
|---|---|---|
| `spec_formation` (шаг 8) | opus | `design` (trusted) |
| `spec_review` (шаг 9) | opus | `opus` |
| `task_reviewer` (шаг 13, per-task) | sonnet | `sonnet` |
| `code_review` (шаг 16) | opus | `code-reviewer` |
| `implementer_mechanical` (шаг 13, 1-2 файла) | haiku | `haiku` |
| `implementer_integration` (шаг 13, multi-file) | sonnet | `sonnet` |
| `explain` (по запросу, примеры/метафоры) | fable | `fable` |
| `security_review` (шаг 8.6, перед untrusted-диспатчем) | trusted | `sanitizer` |

**Fix-loop эскалация (rounds 4-5):** минимум на tier выше предыдущей попытки.

> ⚠️ Без явного выбора tier сабагент наследует модель сессии (часто самую
> дорогую) — это разрушает экономику tier-выбора. Всегда диспатчить сабагента
> нужного tier'а.

## 📖 Субагенты и их роли

| Сабагент | Файл | Редактирование | Роль |
|---|---|---|---|
| `design` | `agents/design.md` | edit (spec), без bash | Spec formation: brainstorming, дизайн-решения, написание spec (trusted) |
| `haiku` | `agents/haiku.md` | edit+bash | Механические задачи, юнит-тесты, bash (git, grep, запуск тестов/сборки) |
| `sonnet` | `agents/sonnet.md` | edit+bash | Интеграционные, multi-file, отладка |
| `opus` | `agents/opus.md` | read-only | Spec Review, security audit, архитектура |
| `fable` | `agents/fable.md` | read-only | Примеры, метафоры, пояснения |
| `code-reviewer` | `agents/code-reviewer.md` | bash+read (без edit) | Финальное ревью ветки |
| `sanitizer` | `agents/sanitizer.md` | read-only | Security review — поиск и пометка чувствительных данных |

Все субагенты, кроме `code-reviewer`, объявлены `hidden: true`
(вызываются только программно через `task` tool). `task: deny` — субагенты не
диспатчат вложенные под-агенты (один уровень вложенности).

## 💡 Как диспатч работает в OpenCode

Модель жёстко привязана к именованному сабагенту в `opencode.json`
(`agent.{design,haiku,sonnet,opus}.model`). `task` tool не принимает параметр `model` —
оркестратор выбирает **сабагента** по таблице «Шаг → Tier».

```
SDD-шаблон:  Subagent (general-purpose): model: haiku
OpenCode:    task(subagent_type="haiku", prompt="...")
```

## 💡 Настройка моделей через `/maestro-init`

`/maestro-init` настраивает модели агентов в `opencode.json` (M1):

- **Tier (мощность) и Trust (доверие) — ортогональные оси.** Trusted — атрибут
  безопасности, не мощность.
- **Tier:** design→opus, opus→opus, code-reviewer→opus, haiku→haiku, sonnet→sonnet,
  fable→fable, **sanitizer→своя**.
- **Trust:** `design` и `sanitizer` — trusted (в `maestro.json`); остальные —
  untrusted. `design` и `sanitizer` — **разные агенты с разными моделями**.

Выбор моделей — **7 отдельных HITL-вопросов** (по одному на агента). Каждый
задаётся через вопросный инструмент (radio) с вариантами: кандидаты моделей
(из D2) + `auto` + «оставить текущую» + «свой вариант» (ручной ввод ID).
Предложение формируется из: текущий `opencode.json` → git-история →
tier-подсказка.
Доступные модели определяются (D2) из `provider.<name>.models` **по всем уровням
конфигурации** (global → project → `.opencode`), с merge-приоритетом
`.opencode` > project > global.

**Temperature** задаётся дефолтом по tier (если у агента нет своего значения),
существующее значение не перезаписывается; записывается вместе с `model`
(не при `auto`):

| Агент | Tier | temperature (дефолт) |
|---|---|---|
| `haiku` | haiku | 0.0 |
| `sonnet` | sonnet | 0.1 |
| `opus` | opus | 0.1 |
| `code-reviewer` | opus | 0.2 |
| `fable` | fable | 0.7 |
| `design` | opus | 0.1 |
| `sanitizer` | своя | 0.0 |

> Подробная пошаговая настройка проекта и моделей — в
> [Настройке проекта для maestro](../tutorials/setup-project.md).
>
> **Централизованная настройка (рекомендуется).** Настроить `agent.*`
> (model + temperature) один раз в global-конфиге
> `~/.config/opencode/opencode.json`. Проекты наследуют значения; `/maestro-init`
> предлагает «оставить из global» первым вариантом. Project `opencode.json`
> переопределяет global, если нужен индивидуальный набор.

## 🔗 Связанные разделы

- [Классификация фич](feature-classification.md)
- [Настройка проекта для maestro](../tutorials/setup-project.md)
- [Агенты и модель доверия](../explanation/agents-and-trust.md)