# Подбор моделей для агентов maestro — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Создать how-to-раздел `manual_docs/how-to/choose-models.md` по подбору LLM-моделей для ролей агентов maestro (критерии: скорость/качество/стоимость/контекст/стабильность; локальные vs внешние по trust-оси), зарегистрировать его в `index.md`, `changelog.md` и `keep-docs-up-to-date.md`.

**Architecture:** Docs-only фича в Diátaxis-стиле (как существующие `how-to/*.md`): новый файл с эмодзи-секциями, `[Назад к оглавлению]`, русский язык. Не дублирует `reference/model-selection.md` (ссылается на него как на единственный источник tier-таблиц и temperature-дефолтов). Согласовано с SECURITY.md P4 (trusted → локальная модель).

**Tech Stack:** Markdown, `manual_docs/`.

---

### Task 1: Создать how-to `manual_docs/how-to/choose-models.md`

**Files:**
- Create: `manual_docs/how-to/choose-models.md`

- [ ] **Step 1: Создать файл с полным содержимым**

Создать файл со структурой по spec §«Архитектура документа» (секции 1–6). Полное содержимое — ниже в Task 2 (применяется целиком). В этом шаге файл создаётся с финальным содержимым.

- [ ] **Step 2: Проверить навигацию и ссылки**

Run: проверить, что `[Назад к оглавлению](../index.md)` и все относительные ссылки (`../reference/model-selection.md`, `../tutorials/setup-project.md`, `../explanation/agents-and-trust.md`, `../../SECURITY.md`) ведут на существующие файлы.
Expected: все пути резолвятся.

- [ ] **Step 3: Commit**

```bash
git add manual_docs/how-to/choose-models.md
git commit -m "docs: add how-to for choosing LLM models for agent roles"
```

---

### Task 2: Полное содержимое `manual_docs/how-to/choose-models.md`

**Files:**
- Create: `manual_docs/how-to/choose-models.md` (содержимое из Task 1)

- [ ] **Step 1: Записать файл целиком**

```markdown
# Подбор моделей для агентов

[Назад к оглавлению](../index.md)

## 🎯 Назначение

Как подбирать конкретную модель под роль агента `maestro`: по каким критериям
думать и когда предпочитать локальные модели, а когда внешние. Это how-to —
методика выбора. Справочник «какой tier/сабагент для какого шага» и механика
конфигурации — в [Выборе моделей](../reference/model-selection.md), не дублируем
его здесь.

## 📖 Критерии

Таблица осей, на которые смотреть при выборе. Здесь и далее «opus» читается как
**tier** (мощность), охватывающий агентов `opus`, `custodian`, `code-reviewer`;
конкретный сабагент для шага — см. `reference/model-selection.md`.

| Ось | Что это | Кому критична |
|---|---|---|
| **Скорость** | Латентность / токенов в секунду; число циклов фиксов | `haiku` (механические task-и, частые циклы), `sonnet` (multi-file) |
| **Качество и глубина анализа** | Способность к архитектурным рассуждениям, нахождению ошибок | `opus`, `custodian` (Q/A по confidential), `code-reviewer` (финальное ревью) |
| **Точность классификации** | Надёжность распознавания/маркировки чувствительных данных | `sanitizer` (детерминированная задача: точность, не мощность рассуждений) |
| **Стоимость (токены)** | Цена за вход/выход; экономика mass-задач vs точечных | `haiku`/`sonnet` (масса task-ов), дорогой opus-tier — точечно (spec/revise/финальное ревью) |
| **Контекстное окно** | Устойчивость к большим диффам/спекам | `code-reviewer` (финальное ревью ветки), `sonnet` (multi-file), `opus` (spec review) |
| **Стабильность вывода** | Предсказуемость формата, отсутствие «галлюцинаций» в структуре | `haiku`/`sanitizer` (temperature 0.0); агенты со стабильным форматом — при temperature ≤ 0.2 (`sonnet`/`opus`/`custodian`/`code-reviewer`); `fable` — исключение (0.7) |

Ключевая идея: **выбор — это баланс осей под роль**, а не «самая мощная
модель». Для механических задач избыточная мощность → лишняя цена и задержки.

## 📖 Локальные или внешние

Правило по trust-оси (не мощность):

- **Локальные/изолированные** — для **trusted**-агентов (`custodian`, `sanitizer`):
  confidential-данные не покидают контур (см. `SECURITY.md` P4 и
  `reference/model-selection.md`). Одна локальная модель может обслуживать обоих.
  Минусы: зависит от качества/скорости локального железа, требует настройки.
- **Внешние** — для **untrusted**-агентов (`haiku`, `sonnet`, `opus`,
  `code-reviewer`, `fable`): не работают с confidential-данными, допустимо
  облако; шире выбор мощности. Локальные тоже допустимы, если хватает качества/
  скорости.
- Это **предпочтение, не жёсткое требование** — выбор за пользователем
  (соответствует reference и SECURITY P4: «trusted → изолированная модель»).

## 📖 Чек-лист подбора

Пошагово:

1. Определить tier/роль по `reference/model-selection.md` (шаг → tier → сабагент).
2. **Задать модель явно** — не оставлять `auto`/наследование: без явного `model`
   сабагент наследует модель сессии (часто самую дорогую), что разрушает
   экономику tier-выбора. `auto` — только осознанное решение.
3. Выбрать ось-приоритет для роли (скорость/качество/цена — из таблицы критериев).
4. Определить локальная или внешняя (trust-ось: trusted → локальная).
5. Проверить доступность кандидатов (D2: `opencode models <provider>`, fallback —
   `provider.<name>.models` в merge-конфиге).
6. Задать `temperature` — дефолты брать из таблицы `reference/model-selection.md`
   (единственный источник; не пересказывать, чтобы не рассинхронизировать при
   правках дефолтов).
7. Проверить реальным диспатчем (`/test-agents` — каждая модель диспатчится и
   доступна).

## 📖 Примерные ориентиры

Иллюстративная таблица «роль → приоритетные критерии → пример класса модели»
(без жёсткой привязки к конкретным поставщик-специфичным ID, чтобы не устаревала;
**это ориентир, не контракт**):

| Роль | Приоритет | Класс модели |
|---|---|---|
| `haiku` | скорость + цена | лёгкая/быстрая |
| `sonnet` | баланс (multi-file) | средняя/сбалансированная |
| `opus` / `code-reviewer` | качество анализа | мощная (архитектурные рассуждения) |
| `custodian` | качество анализа | мощная, желательно локальная (trusted) |
| `sanitizer` | точность классификации | точная/надёжная, желательно локальная (trusted) |
| `fable` | креативность | креативная (высокий temperature — параметр конфига) |

## 🔗 Связанные разделы

- [Выбор моделей](../reference/model-selection.md) — tier, субагенты, механика конфигурации.
- [Настройка проекта для maestro](../tutorials/setup-project.md) — пошаговая настройка проекта и моделей.
- [Агенты и модель доверия](../explanation/agents-and-trust.md) — trust, sanitizer, роли.
- [SECURITY.md](../../SECURITY.md) — модель доверия, P4 (trusted → изолированная модель).
```

- [ ] **Step 2: Проверить консистентность с reference**

Run: сверить упомянутые в таблице temperature-дефолты (0.0/≤0.2/0.7) с таблицей `reference/model-selection.md`; сверить trusted/untrusted-списки.
Expected: совпадение; нет дословного пересказа таблицы дефолтов (только ссылка).

- [ ] **Step 3: Commit**

```bash
git add manual_docs/how-to/choose-models.md
git commit -m "docs: write full content of model-selection how-to"
```

---

### Task 3: Зарегистрировать how-to в `manual_docs/index.md`

**Files:**
- Modify: `manual_docs/index.md` (секция **How-to**, после `how-to/update-maestro.md`)

- [ ] **Step 1: Добавить пункт в секцию How-to**

В секцию **How-to** (список после `[Обновление maestro](how-to/update-maestro.md)`) добавить строку:

```markdown
- [Подбор моделей для агентов](how-to/choose-models.md) — критерии (скорость/качество/стоимость), локальные vs внешние
```

- [ ] **Step 2: Проверить навигацию**

Run: открыть `index.md` → кликнуть пункт → файл открывается.
Expected: навигация работает.

- [ ] **Step 3: Commit**

```bash
git add manual_docs/index.md
git commit -m "docs: register model-selection how-to in index"
```

---

### Task 4: Запись в `manual_docs/overview/changelog.md`

**Files:**
- Modify: `manual_docs/overview/changelog.md`

- [ ] **Step 1: Добавить запись в `[Unreleased]` → «Добавлено»**

В секцию `[Unreleased]` → «Добавлено» добавить пункт:

```markdown
- how-to по подбору моделей для агентов (`manual_docs/how-to/choose-models.md`).
```

- [ ] **Step 2: Проверить формат**

Run: сверить с соседними записями в changelog.
Expected: пункт в нужной секции, формат совпадает.

- [ ] **Step 3: Commit**

```bash
git add manual_docs/overview/changelog.md
git commit -m "docs: changelog entry for model-selection how-to"
```

---

### Task 5: Обновить `manual_docs/how-to/keep-docs-up-to-date.md`

**Files:**
- Modify: `manual_docs/how-to/keep-docs-up-to-date.md` (чек-лист, строки 32 и 36)

- [ ] **Step 1: Добавить how-to в sync-чек-лист**

В чек-листе «Что изменилось в скилле → что обновить в `manual_docs/`»:

- Строка 32 («Модели / tier / субагенты»): добавить `how-to/choose-models.md`
  к списку обновляемых файлов (`reference/model-selection.md`, `explanation/agents-and-trust.md`, `how-to/choose-models.md`).
- Строка 36 («Trust / санитайзер»): добавить `how-to/choose-models.md`
  (раздел §3 «Локальные или внешние» несёт trust-семантику).

- [ ] **Step 2: Проверить строки**

Run: сверить, что строки 32 и 36 — именно эти строки таблицы.
Expected: правки применены к правильным строкам.

- [ ] **Step 3: Commit**

```bash
git add manual_docs/how-to/keep-docs-up-to-date.md
git commit -m "docs: add model-selection how-to to docs sync checklist"
```

---

### Task 6: Финальная проверка

**Files:**
- (нет изменений)

- [ ] **Step 1: Полная сверка**

Run:
```bash
git status
git log --oneline -8
```
Проверить: создан `manual_docs/how-to/choose-models.md`; обновлены `index.md`, `changelog.md`, `keep-docs-up-to-date.md`; все коммиты на месте.

- [ ] **Step 2: Сверка ссылок и консистентность**

Run: проверить все 4 ссылки в новом файле существуют; содержимое таблиц (temperature, trusted/untrusted) согласовано с `reference/model-selection.md`; нет дублирования tier-таблиц.
Expected: все ссылки валидны, консистентность с reference, дублирование отсутствует.