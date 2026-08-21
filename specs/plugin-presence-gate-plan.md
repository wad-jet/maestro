# Жёсткий гейт «плагин maestro-bootstrap подключён» — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Жёсткий HITL-гейт на входе runtime-команд maestro: если плагин `maestro-bootstrap` не заявлен в конфиге ИЛИ не работает (нет свежего `plugin initialized` в логе), работа блокируется стопом без «продолжить» — только для проектов с `maestro.json`.

**Architecture:** В начало трёх runtime-скиллов (`maestro`, `maestro-design`, `maestro-feedback-report`) вставляется единый гейт. Гейт: (1) `maestro.json` есть? нет → skip; (2) да → проверить `opencode.json → plugin` содержит maestro-bootstrap И свежую запись `plugin initialized` в последнем лог-файле (timestamp ≤ 24ч); (3) если хотя бы одно не выполнено → жёсткий HITL stop без «продолжить». `@maestro-init` и `@regression` не трогаем.

**Tech Stack:** markdown (скиллы `SKILL.md`), русский язык HITL. Нет исполняемого кода; верификация — чтением файлов.

**Спека:** `specs/plugin-presence-gate.md`.

---

## Файловая структура

- `skills/maestro/SKILL.md` — вставить гейт в начало (перед шагом 0 / Overview).
- `skills/maestro-design/SKILL.md` — вставить гейт перед «Предусловие 0» (в секцию «Предусловия»).
- `skills/maestro-feedback-report/SKILL.md` — вставить гейт перед «Шаг 1».
- `manual_docs/reference/config.md` — упомянуть гейт (механизм/риск).
- `manual_docs/explanation/agents-and-trust.md` — описать гейт + ограничения.
- `manual_docs/overview/changelog.md` — запись.
- Не трогаем: `skills/maestro-init/SKILL.md`, `commands/*.md` (кроме синхронизации зеркал, см. ниже).

> **Примечание про зеркала (AGENTS.md sync rule):** скиллы живут в `skills/` (источник) и копируются в `.opencode/` runtime-копии. В этом authoring-репозитории `.opencode/` **отсутствует** (там лежат зеркала из приложение-репо). Проверить наличие `.opencode/skills/`; если есть — обновить параллельно. В данном репо его нет — только `skills/`.

---

### Task 1: Эталонный текст гейта (source of truth)

**Files:**
- Создаётся согласованный текст, используемый во всех трёх скиллах (для DRY — единый блок; вставляется в каждый файл как есть).

- [ ] **Step 1: Зафиксируй эталонный блок гейта**

Ниже — канонический текст. Он вставляется в каждый скилл (Task 2–4). Сохраняй этот текст без изменений во всех трёх местах.

````markdown
## Гейт 0 — Проверка плагина maestro-bootstrap (обязательный)

**Язык HITL:** русский.

1. **Маркер проекта.** Если в корне проекта есть `maestro.json` — это проект под
   управлением maestro, выполняется проверка плагина (шаги 2–3). Если `maestro.json`
   НЕТ — проект не под maestro, гейт пропускается, работаем как обычно.

2. **Плагин заявлен в конфиге.** Проверь `opencode.json` → `plugin`: там должна
   быть запись, указывающая на `maestro-bootstrap` (git-spec
   `maestro-bootstrap@git+https://github.com/wad-jet/maestro.git` или локальный путь
   `./plugins/maestro-bootstrap/index.js`). Нет → перейти к шагу 4 (стоп).

3. **Плагин реально работал.** Открой самый свежий файл
   `.maestro/logs/maestro-bootstrap-<дата>.log` (по имени-дате). Найди строку
   `plugin initialized`. Если есть И её ISO-`ts` не старше 24 часов от текущего
   момента — плагин работает, продолжить работу. Иначе → шаг 4 (стоп).

4. **Жёсткий STOP (без «продолжить»).** Останови работу и покажи HITL:

   > **Плагин `maestro-bootstrap` не подключён или не загружен.**
   > Защита `docs/confidential/**` НЕ действует: confidential-данные могут быть
   > доступны untrusted-агентам и primary-сессии. `access_policy` и sanitizer тоже
   > не работают (все — в плагине `maestro-bootstrap`).
   >
   > Продолжение работы запрещено. Единственный способ продолжить — подключить
   > плагин и перезапустить opencode:
   > ```
   > opencode plugin "maestro-bootstrap@git+https://github.com/wad-jet/maestro.git"
   > # или добавить spec в opencode.json
   > ```
   >
   > (a) Подключить плагин и перезапустить opencode — затем повторить команду
   > (c) Отмена / стоп

   Допустимы ТОЛЬКО исходы (a) и (c). Варианта «продолжить как есть» НЕТ.
   При (a): объяснить, что нужно перезапустить opencode и повторить команду,
   НЕ продолжать pipeline в текущей сессии. При (c): завершить работу.
````

- [ ] **Step 2: Commit (эталон сохранён как часть Task 2–4; отдельный коммит не нужен)**

Эталон не хранится отдельным файлом — он встраивается в три скилла. Коммит — после Task 4.

---

### Task 2: Вставить гейт в `skills/maestro/SKILL.md`

**Files:**
- Modify: `skills/maestro/SKILL.md`

- [ ] **Step 1: Вставь эталонный блок (Task 1) в начало скилла**

В `skills/maestro/SKILL.md` вставь блок «Гейт 0 — Проверка плагина maestro-bootstrap
(обязательный)» из Task 1 **сразу после frontmatter** (после строки 4 `---`), перед
заголовком `# Maestro` (строка 6). Вставь текст полностью, без изменений.

Итоговая структура начала файла:

```markdown
---
name: maestro
description: ...
---

## Гейт 0 — Проверка плагина maestro-bootstrap (обязательный)

<канонический текст из Task 1>

# Maestro

## Overview
...
```

- [ ] **Step 2: Верифицируй вставку**

Прочитай `skills/maestro/SKILL.md` первые 60 строк. Убедись: гейт расположен до
`# Maestro` и до любого исполняемого шага (шаг 0/1). Текст гейта совпадает с эталоном.

- [ ] **Step 3: Не коммить отдельно (общий коммит в Task 4)**

---

### Task 3: Вставить гейт в `skills/maestro-design/SKILL.md` и `skills/maestro-feedback-report/SKILL.md`

**Files:**
- Modify: `skills/maestro-design/SKILL.md`
- Modify: `skills/maestro-feedback-report/SKILL.md`

- [ ] **Step 1: Вставь гейт в `skills/maestro-design/SKILL.md`**

В `skills/maestro-design/SKILL.md` вставь эталонный блок (Task 1) **сразу после
frontmatter** (строка 4 `---`), перед заголовком `# Design — Проектирование и
scaffold` (строка 6). Тот же текст.

- [ ] **Step 2: Вставь гейт в `skills/maestro-feedback-report/SKILL.md`**

В `skills/maestro-feedback-report/SKILL.md` вставь эталонный блок (Task 1) **сразу
после frontmatter** (строка 4 `---`), перед заголовком `# Maestro Feedback Report`
(строка 6). Тот же текст.

- [ ] **Step 3: Верифицируй вставки**

Прочитай первые 12 строк обоих файлов. Гейт стоит до главного заголовка и до
любого исполняемого шага. Текст совпадает с эталоном и между файлами.

- [ ] **Step 4: Обнови зеркала `.opencode/` если существуют**

Проверь существование `.opencode/skills/maestro-design/SKILL.md` и
`.opencode/skills/maestro-feedback-report/SKILL.md` (и `.../maestro/SKILL.md`).
Если существуют — примени те же правки. Если `.opencode/` нет (как в этом
authoring-репо) — пропусти шаг (отметь как done без изменений).

- [ ] **Step 5: Commit**

```bash
git add skills/maestro/SKILL.md skills/maestro-design/SKILL.md skills/maestro-feedback-report/SKILL.md
git commit -m "feat(skills): hard gate — block runtime commands when maestro-bootstrap plugin missing/inactive"
```

---

### Task 4: Документация — `manual_docs/reference/config.md`

**Files:**
- Modify: `manual_docs/reference/config.md`

- [ ] **Step 1: Добавь подраздел о гейте**

В `manual_docs/reference/config.md`, в раздел о `opencode.json → plugin` (после
строки про перезапуск opencode, ~225) добавь:

````markdown
### Гейт «плагин подключён» для runtime-команд

В maestro-проекте (есть `maestro.json`) команды `@maestro`, `@maestro-design`,
`@maestro-feedback-report` при старте выполняют жёсткий гейт:

1. `opencode.json → plugin` должен содержать `maestro-bootstrap`;
2. самый свежий `.maestro/logs/maestro-bootstrap-<дата>.log` должен содержать
   запись `plugin initialized` с timestamp не старше 24 часов.

Если любое условие не выполнено — жёсткий STOP без «продолжить»: только
«(a) подключить плагин и перезапустить» / «(c) стоп». Причина: без плагина
защита `docs/confidential/**` и sanitize не действуют (fail-open), confidential-
данные доступны untrusted-агентам. `@maestro-init` и `@regression` не гейтятся.
````

- [ ] **Step 2: Commit**

```bash
git add manual_docs/reference/config.md
git commit -m "docs: document hard plugin-presence gate for runtime commands"
```

---

### Task 5: Документация — `manual_docs/explanation/agents-and-trust.md`

**Files:**
- Modify: `manual_docs/explanation/agents-and-trust.md`

- [ ] **Step 1: Добавь описание гейта и ограничений**

В `manual_docs/explanation/agents-and-trust.md`, в подсекции о confidential (после
блока «Зависимость от плагина»), добавь:

````markdown
### Жёсткий гейт «плагин работает»

Чтобы пользователь не работал с confidential-данными при отключённом плагине,
на входе `@maestro`, `@maestro-design`, `@maestro-feedback-report` (в maestro-
проекте с `maestro.json`) выполняется гейт: наличие `maestro-bootstrap` в
`opencode.json → plugin` И свежая запись `plugin initialized` в логе плагина.
При невыполнении — жёсткий стоп без «продолжить» (только подключить+перезапуск
или отмена).

**Ограничения гейта:**
- **Не OS-барьер.** Гейт — инструкция в `SKILL.md`, исполняемая оркестратором
  (LLM). Нативного opencode-механизма «нет плагина → запретить» не существует.
  Пользователь технически может обойти гейт (новый запрос, правка скилла) —
  это осознанное ограничение.
- **Косвенный сигнал.** `plugin initialized` в логе пишется при успешной
  инициализации плагина (установке хуков) — это надёжный признак работы, но не
  абсолютная гарантия.
- **Кросс-полуночная сессия.** В долгоживущем процессе через полночь запись
  `plugin initialized` может быть старше 24ч → возможен ложный стоп. Порог
  настраивается, но гейт по умолчанию использует 24ч.
````

- [ ] **Step 2: Commit**

```bash
git add manual_docs/explanation/agents-and-trust.md
git commit -m "docs: describe hard gate and its limitations for confidential protection"
```

---

### Task 6: Документация — changelog

**Files:**
- Modify: `manual_docs/overview/changelog.md`

- [ ] **Step 1: Добавь запись в `## [Unreleased] → ### Добавлено`**

```markdown
- **Жёсткий гейт «плагин maestro-bootstrap работает»**: `@maestro`,
  `@maestro-design`, `@maestro-feedback-report` в maestro-проекте (`maestro.json`
  есть) при старте проверяют наличие `maestro-bootstrap` в `opencode.json` →
  `plugin` И свежую запись `plugin initialized` в логе плагина; при невыполнении —
  жёсткий STOP без «продолжить» (защита `docs/confidential/**` не действует при
  отключённом плагине). `@maestro-init` и `@regression` не гейтятся.
```

- [ ] **Step 2: Commit**

```bash
git add manual_docs/overview/changelog.md
git commit -m "docs: changelog entry for hard plugin-presence gate"
```

---

### Task 7: Финальная верификация

**Files:** (нет изменений)

- [ ] **Step 1: Проверь согласованность текста гейта**

Run: `rg -n "Гейт 0 — Проверка плагина" skills/maestro/SKILL.md skills/maestro-design/SKILL.md skills/maestro-feedback-report/SKILL.md`
Expected: по одному совпадению в каждом файле. Сравни три блока — они идентичны.

- [ ] **Step 2: Проверь, что `@maestro-init` и `@regression` не гейтятся**

Run: `rg -n "Гейт 0 — Проверка плагина" skills/maestro-init/SKILL.md`
Expected: НЕТ совпадений (init не гейтится). То же для `commands/regression.md`
(если применимо — гейт в скилле, regression скилл не гейтим).

- [ ] **Step 3: Проверь отсутствие битых ссылок в manual_docs**

Убедись, что новые подразделы не ломают оглавление/ссылки (`config.md`,
`agents-and-trust.md`). Ожидается отсутствие битых ссылок.

- [ ] **Step 4: Confirm git status**

Run: `git status`
Expected: только запланированные файлы.

---

## Self-Review

**Spec coverage:**
- ✅ Маркер `maestro.json` → Task 1 (гейт шаг 1).
- ✅ Гибрид (конфиг `plugin` + свежий `plugin initialized`) → Task 1 (шаги 2–3).
- ✅ Жёсткий стоп без «продолжить» → Task 1 (шаг 4).
- ✅ Scope: `@maestro`/`@maestro-design`/`@maestro-feedback-report` — Task 2, Task 3.
- ✅ NO gate для `@maestro-init`/`@regression` — Task 7 Step 2 (не добавляются).
- ✅ Docs + changelog — Task 4, Task 5, Task 6.
- ✅ Ограничения (не OS-барьер, косвенный сигнал, кросс-полночь) — Task 5 (docs) + спекa.

**Placeholder scan:** нет TBD/TODO; эталон гейта — полный, канонический; все шаги
содержат точное место вставки и команды.

**Type/consistency:** канонический текст гейта един в трёх скиллах (Task 1),
места вставки указаны с точными строками/структурой. Порог свежести — 24ч —
согласован между спецификацией и Task 1 (шаг 3). Названия файлов совпадают
между файловой структурой, задачами и self-review.