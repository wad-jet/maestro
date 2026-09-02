# Rename commands maestro-init→maestro-new and maestro→maestro-init — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Переименовать команды maestro так, чтобы названия соответствовали сути: `/maestro-init`→`/maestro-new` (bootstrap проекта), `/maestro`→`/maestro-init` (вход в пайплайн), скилл `maestro-init`→`maestro-new`, скрипт `maestro-init.sh`→`maestro-install.sh`, с полным каскадным обновлением ссылок и безопасной миграцией целевых проектов.

**Architecture:** Свап двух команд + переименование скилла и скрипта. Скилл `maestro` (ядро pipeline) НЕ переименовывается — команда `/maestro-init` грузит его. Миграция целевых проектов: rename-aware `maestro-update.sh`/`maestro-install.sh` заменяют устаревшую agpack-запись `skills/maestro-init`→`skills/maestro-new` и удаляют stale-артефакты (agpack 0.3.1 не прунит). Версия 2.0.0 (breaking rename).

**Tech Stack:** bash (скрипты), python3 (инлайн-merge в скриптах), Markdown (skills/commands/docs), agpack 0.3.1, Node test runner (плагин).

**Spec:** `specs/rename-commands-maestro-new.md` (одобрена, review-подпись есть).

---

## File Structure

Изменяемые/создаваемые файлы (кроме исторических `specs/*`, changelog-истории, `TODO.md`):

**Переименования (git mv):**
- `commands/maestro-init.md` → `commands/maestro-new.md`
- `commands/maestro.md` → `commands/maestro-init.md`
- `skills/maestro-init/` → `skills/maestro-new/`
- `maestro-init.sh` → `maestro-install.sh`
- `maestro-init/` → `maestro-install/`

**Создаются:** `specs/rename-commands-maestro-new-plan.md` (этот план), `regression/entries/2026-09-01-rename-commands-maestro-new.md`.

**Изменяются (каскад):** см. Task-структуру ниже.

## Project Context Changes

Изменения контекста (из шага 8.5, применятся после одобрения плана):
- **§1 Название/self-hosted:** строка 11 «(`@maestro`, `/maestro-init`, `/maestro-design`» → «(`@maestro-init`, `/maestro-new`, `/maestro-design`».
- **§3 Стек:** строка 36 «`maestro-init.sh`» → «`maestro-install.sh`».
- **§4 Архитектура:** строка 41 «`maestro-init`» → «`maestro-new`» в списке скиллов; строка 45 «`@maestro`, `/maestro-init`» → «`@maestro-init`, `/maestro-new`».
Эти правки выполняются в Task 11 Step 2.

---

## Task 1: git mv — переименования путей (свап)

**Files:** (rename)
- `commands/maestro-init.md` → `commands/maestro-new.md`
- `commands/maestro.md` → `commands/maestro-init.md`
- `skills/maestro-init/` → `skills/maestro-new/`
- `maestro-init.sh` → `maestro-install.sh`
- `maestro-init/` → `maestro-install/`

- [ ] **Step 1: Выполнить свап переименований (порядок критичен — освобождает `commands/maestro-init.md` до шага 2).**

```bash
git mv commands/maestro-init.md commands/maestro-new.md
git mv commands/maestro.md commands/maestro-init.md
git mv skills/maestro-init skills/maestro-new
git mv maestro-init.sh maestro-install.sh
git mv maestro-init maestro-install
```

- [ ] **Step 2: Проверить результат**

```bash
ls commands/maestro-new.md commands/maestro-init.md skills/maestro-new/ maestro-install.sh maestro-install/
```
Expected: все 5 путей существуют; `commands/maestro-init.md` — бывший `maestro.md`.

---

## Task 2: commands/maestro-new.md (экс maestro-init.md) — контент

**Files:**
- Modify: `commands/maestro-new.md`

- [ ] **Step 1: Обновить frontmatter description (более не относится к setup под новым именем)**

Заменить description на точное описание bootstrap'а нового проекта (имя команды теперь `/maestro-new`):
```
description: Инициализация нового проекта: project-context.md (14 категорий), конфигурация maestro (maestro.json, .gitignore, plugin+models в .opencode/opencode.json или global), каталоги, проверка superpowers и плагина
```

- [ ] **Step 2: Заменить ссылку на скилл**

`Загрузи skill `maestro-init` (tool: skill) и следуй SKILL.md из `skills/maestro-init/`.` →
`Загрузи skill `maestro-new` (tool: skill) и следуй SKILL.md из `skills/maestro-new/`.` (убрать внешние backticks правильно: `skills/maestro-new/`)

- [ ] **Step 3: Заменить `/maestro-init` → `/maestro-new` во всём теле (строки 6–23), включая строку 6 «`/maestro-init` — setup-фаза…», строку 9 «…в отдельной команде `/maestro-design`» (без изменений — уже корректно), строку 16 «Задача 3…», строку 23 «…напомнить про `/maestro-design`».**

Конкретно заменить все вхождения подстроки `/maestro-init` на `/maestro-new`.

- [ ] **Step 4: Верифицировать**

```bash
rg -n 'maestro-init' commands/maestro-new.md
```
Expected: 0 совпадений (только `maestro-new`). Команда `/maestro-design` остаётся.

---

## Task 3: commands/maestro-init.md (экс maestro.md) — контент

**Files:**
- Modify: `commands/maestro-init.md`

- [ ] **Step 1: Заголовок `# @maestro` → `# @maestro-init`**

- [ ] **Step 2: Description остаётся про pipeline. Тело:**
  - Строка 7 «Загрузи skill `maestro` (tool: skill)…» — без изменений (скилл `maestro`).
  - Строки 16–17 «После утверждения плана…», «После SDD…», «Финальное ревью…» — без изменений.

- [ ] **Step 3: «Связанные команды»: `@maestro-init` — bootstrap нового проекта → `@maestro-new`**

```diff
 ## Связанные команды
 
 - `@regression` — реестр рисков регрессии
-- `@maestro-init` — bootstrap нового проекта
+- `@maestro-new` — bootstrap нового проекта
```

- [ ] **Step 4: Верифицировать — в файле не должно остаться `@maestro` как ссылки на пайплайн-вход, кроме нового имени в заголовке.**

```bash
rg -n '@maestro|/maestro' commands/maestro-init.md
```
Expected: только `# @maestro-init` и текст без ссылок на старый `/maestro`.

---

## Task 4: skills/maestro-new/SKILL.md + init-context.md

**Files:**
- Modify: `skills/maestro-new/SKILL.md`
- Modify: `skills/maestro-new/init-context.md`

- [ ] **Step 1: frontmatter `name: maestro-new` (было `name: maestro-init`)**

```diff
 ---
-name: maestro-init
+name: maestro-new
```

- [ ] **Step 2: В SKILL.md заменить ВСЕ `maestro-init` → `maestro-new`** (строки 10, 17, 22, 45, 127, 296). Включая «Команда `/maestro-new` запускает этот скилл…», «`/maestro-new` выполняет только setup-фазу…», «продолжить `/maestro-new`», «всего процесса `/maestro-new`».

- [ ] **Step 3: Удалить ссылки на исторические спеки (I-2, закрывает TODO.md:59):**
  - Строка 19: «зафиксировано в `specs/maestro-init-tasks-plan.md`.» → удалить эту фразу (или заменить на «(разделение setup и дизайна зафиксировано в спецификации пайплайна)» без ссылки на файл).
  - Строка 107: «идемпотентно (см. `specs/init-idempotency-plan.md` для деталей).» → убрать скобку со ссылкой на файл, оставить «идемпотентно.».

- [ ] **Step 4: В `init-context.md` заменить все `maestro-init` → `maestro-new`** (строки 1, 3, 8, 158, 160).

- [ ] **Step 5: Верифицировать**

```bash
rg -n 'maestro-init' skills/maestro-new/
```
Expected: 0. Также `rg -n 'specs/maestro-init-tasks-plan|init-idempotency' skills/maestro-new/` → 0.

---

## Task 5: skills/maestro/SKILL.md (каскад)

**Files:**
- Modify: `skills/maestro/SKILL.md`

- [ ] **Step 1: строка 80**: «Пользователь вызвал `@maestro` …» → «Пользователь вызвал `@maestro-init` …».

- [ ] **Step 2: строки 153–154**: `см. `skills/maestro-init/init-context.md`` → `см. `skills/maestro-new/init-context.md``; «рекомендуется команда `/maestro-init` (создаёт context + дизайн + scaffold + roadmap)» → «рекомендуется команда `/maestro-new` (создаёт context + конфиг; дизайн/scaffold/roadmap — `/maestro-design`)».

- [ ] **Step 3: строка 1550**: «создаётся `/maestro-init` для новых проектов» → «создаётся `/maestro-design` для новых проектов» (семантический фикс M-7: roadmap создаёт `/maestro-design`, не `/maestro-new`).

- [ ] **Step 4: Проверить, что других упоминаний команд-имён нет** (плагин/логи стр. 15/29/537/1209 — не трогать).

```bash
rg -n '@maestro\b|`/maestro`|maestro-init' skills/maestro/SKILL.md
```
Expected: только легитимные (скилл `maestro`, `/maestro-new`, `/maestro-design`, `/maestro-init` как новый вход, без старого `@maestro`-входа).

---

## Task 6: каскад в skills/

**Files:**
- Modify: `skills/maestro-design/SKILL.md`
- Modify: `skills/maestro-assistant/SKILL.md`
- Modify: `skills/maestro-feedback-report/SKILL.md`

- [ ] **Step 1: `skills/maestro-design/SKILL.md`**: заменить ВСЕ `maestro-init` → `maestro-new` (строки 3, 45, 48, 64, 67, 75, 85, 152, 153). **Удалить ссылку** на `specs/maestro-init-tasks-plan.md` (строка 50): фразу «`specs/maestro-init-tasks-plan.md`.» → убрать ссылку на файл (самодостаточность).

- [ ] **Step 2: `skills/maestro-assistant/SKILL.md`**:
  - Строка 3 (frontmatter description): «Also loaded by maestro-init (tasks 2/3/3a) and maestro (pipeline config questions)» → «Also loaded by maestro-new (tasks 2/3/3a) and maestro-init (pipeline config questions)» (I-6 — обе половины).
  - Строка 21: `/maestro-init` → `/maestro-new`.
  - Строки 22, 38, 159: `@maestro` → `@maestro-init` (вход в пайплайн).
  - Строка 82: «`maestro-update.sh` / `/maestro-init`» → «`maestro-update.sh` / `/maestro-new`».

- [ ] **Step 3: `skills/maestro-feedback-report/SKILL.md`**:
  - Строки 63, 115: списки `<@maestro, @maestro-init, @maestro-design>` → `<@maestro-init, @maestro-new, @maestro-design>`.
  - Строка 165: `skills/maestro-init/SKILL.md` → `skills/maestro-new/SKILL.md`.

- [ ] **Step 4: Верифицировать**

```bash
rg -n 'maestro-init|@maestro\b' skills/maestro-design/SKILL.md skills/maestro-assistant/SKILL.md skills/maestro-feedback-report/SKILL.md
```
Expected: `maestro-init`/`@maestro` остаются только в легитимных контекстах (пайплайн-вход `/maestro-init`), `maestro-init` в значении setup — 0.

---

## Task 7: каскад в commands/ и agents/

**Files:**
- Modify: `commands/maestro-design.md`
- Modify: `commands/maestro-assistant.md`
- Modify: `commands/test-agents.md`
- Modify: `agents/sanitizer.md`

- [ ] **Step 1: `commands/maestro-design.md`**: заменить все `maestro-init` → `maestro-new` (строки 2, 7, 8, 10, 13).

- [ ] **Step 2: `commands/maestro-assistant.md`**: строка 26 «`@maestro` (фича/багфикс/SDD)» → «`@maestro-init` (фича/багфикс/SDD)».

- [ ] **Step 3: `commands/test-agents.md`**: строка 45 «создаётся `/maestro-init`» → «создаётся `/maestro-new`».

- [ ] **Step 4: `agents/sanitizer.md`**: строка 127 «(`/maestro-init`)» → «(`/maestro-new`)».

- [ ] **Step 5: Верифицировать**

```bash
rg -n 'maestro-init|@maestro\b' commands/maestro-design.md commands/maestro-assistant.md commands/test-agents.md agents/sanitizer.md
```
Expected: только `maestro-new` в значении setup; `@maestro` — нет.

---

## Task 8: AGENTS.md

**Files:**
- Modify: `AGENTS.md`

- [ ] **Step 1: точные правки (I-6 + полный список):**
  - Строка 8: «entry is via the `@maestro` command (skill)» → «entry is via the `@maestro-init` command (skill)».
  - Строка 9: «`@maestro` is the entry point» → «`@maestro-init` is the entry point».
  - Строка 11: `skills/maestro-init/{SKILL.md,init-context.md}` → `skills/maestro-new/{SKILL.md,init-context.md}`; «`/maestro-init` skill for bootstrapping new projects» → «`/maestro-new` skill for bootstrapping new projects».
  - Строка 13: «loaded by init (tasks 2/3/3a) and maestro (pipeline config questions)» → «loaded by `/maestro-new` (tasks 2/3/3a) and `/maestro-init` (pipeline config questions)».
  - Строка 21: «(`/maestro-init`, `/maestro-design`, `@maestro`)» → «(`/maestro-new`, `/maestro-design`, `@maestro-init`)».

- [ ] **Step 2: Верифицировать**

```bash
rg -n 'maestro-init|@maestro\b|`/maestro`' AGENTS.md
```
Expected: `maestro-init`/`@maestro` только в новых значениях (пайплайн-вход), `maestro-init` в значении setup — 0.

---

## Task 9: скрипты maestro-install.sh и maestro-update.sh + agpack.yml

**Files:**
- Modify: `maestro-install.sh`
- Modify: `maestro-update.sh`
- Modify: `agpack.yml`
- Modify: `maestro-install/agpack.yml`

- [ ] **Step 1: `maestro-install.sh` (экс maestro-init.sh) — брендинг и контент:**
  - Все `[maestro-init]` в `say/info/warn/die` → `[maestro-install]` (строки 37–39, 106, 203–221 python-префиксы «maestro-init: …», 242).
  - Строка 31: `RAW_URL=".../main/maestro-init.sh"` → `.../main/maestro-install.sh`.
  - Строки 3, 43, 46 (usage/help): «maestro-init — подготовка проекта…», «bash maestro-init.sh [--global]» → `maestro-install`.
  - Heredoc-agpack.yml (строки 150–151): `path: skills/maestro-init` → `path: skills/maestro-new`.
  - Финальная инструкция (строки 250–253): «Выполните инициализацию проекта: `/maestro-init`» → `/maestro-new`; «Запуск фичи: `/maestro "ваша задача"`» → `/maestro-init "ваша задача"`.
  - Комментарий строка 24 «maestro-init/agpack.yml» → `maestro-install/agpack.yml`.

- [ ] **Step 2: `maestro-install.sh` — миграционный шаг (до `agpack sync`, строка ~174). Вставить санитизацию agpack.yml:**

```bash
# --- 3a. Миграция agpack.yml (rename skills/maestro-init -> skills/maestro-new) ---
if [ -f "agpack.yml" ]; then
  python3 - <<'PY'
import re
path = "agpack.yml"
with open(path, "r", encoding="utf-8") as f:
    text = f.read()
old = '      path: skills/maestro-init'
new = '      path: skills/maestro-new'
if old in text:
    text = text.replace(old, new)
    with open(path, "w", encoding="utf-8") as f:
        f.write(text)
    print("maestro-install: agpack.yml: skills/maestro-init -> skills/maestro-new")
PY
fi
```

- [ ] **Step 3: `maestro-install.sh` — очистка stale-артефактов (после `agpack sync`). Добавить после блока sync:**

```bash
# --- 4a. Очистка stale-артефактов (agpack не прунит) ---
rm -rf .opencode/commands/maestro.md .opencode/skills/maestro-init
```

- [ ] **Step 4: `maestro-update.sh`:**
  - Строки 72, 77: `maestro-init/agpack.yml` → `maestro-install/agpack.yml`.
  - Строка 89 (коммент), 186 (info): `maestro-init/agpack.yml` → `maestro-install/agpack.yml`.
  - Переменная `MAESTRO_INIT_AGPACK` (строки 72, 77, 83, 84) → `MAESTRO_INSTALL_AGPACK`.
  - Строка 233: «выполните /maestro-init» → «выполните /maestro-new».

- [ ] **Step 5: `maestro-update.sh` — rename-aware merge.** В python-блоке merge (после парсинга канона, перед вставкой) добавить безусловное удаление устаревшей записи `skills/maestro-init` из `existing` и физическое удаление строки. Конкретно: перед циклом вставки для секции `skills` удалить любую существующую строку `      path: skills/maestro-init` (и её `    - url:`), затем `existing.discard("skills/maestro-init")`. Точная реализация:

```python
# Rename-aware: безусловно удалить устаревшую запись skills/maestro-init (M-5/M-9)
def drop_old_init(lines):
    out = []
    i = 0
    while i < len(lines):
        if re.match(r"^\s{4}-\s*url:\s*\S+", lines[i]):
            j = i + 1
            is_old = False
            while j < len(lines) and (lines[j].strip().startswith("path:") or lines[j].strip() == "" or lines[j].strip().startswith("-")):
                if re.match(r"^\s{6}path:\s*skills/maestro-init\s*$", lines[j]):
                    is_old = True
                j += 1
            if is_old:
                i = j
                continue
        out.append(lines[i])
        i += 1
    return out
lines = drop_old_init(lines)
```

  И в `existing` после этого добавить `existing.discard("skills/maestro-init")`.

- [ ] **Step 6: `maestro-update.sh` — очистка stale-артефактов (после `agpack sync`, после строки 190):**

```bash
rm -rf .opencode/commands/maestro.md .opencode/skills/maestro-init
```

- [ ] **Step 7: `agpack.yml` (корень) и `maestro-install/agpack.yml` (канон):** `path: skills/maestro-init` → `path: skills/maestro-new`.

- [ ] **Step 8: Синтаксис**

```bash
bash -n maestro-install.sh maestro-update.sh
```
Expected: exit 0, без вывода.

- [ ] **Step 9: Верифицировать отсутствие старых упоминаний в скриптах**

```bash
rg -n 'maestro-init' maestro-install.sh maestro-update.sh agpack.yml maestro-install/agpack.yml
```
Expected: 0 (кроме исторических комментариев не должно быть; если остались легитимные — проверить).

---

## Task 10: плагин — комментарий core.js

**Files:**
- Modify: `plugins/maestro-bootstrap/core.js`

- [ ] **Step 1: строка 5**: «Скилл `maestro` вызывается через команду `@maestro` в любой» → «Скилл `maestro` вызывается через команду `@maestro-init` в любой».

- [ ] **Step 2: Тесты плагина**

```bash
node --test plugins/maestro-bootstrap/index.test.js
```
Expected: 176/176 pass (комментарий не влияет).

---

## Task 11: SECURITY.md, docs/project-context.md, plugin README

**Files:**
- Modify: `SECURITY.md`
- Modify: `docs/project-context.md`
- Modify: `plugins/maestro-bootstrap/README.md`

- [ ] **Step 1: `SECURITY.md` строка 44 (P5)**: «гейт на входе `/maestro`» → «гейт на входе `/maestro-init`».

- [ ] **Step 2: `docs/project-context.md`**:
  - Строка 11: «(`@maestro`, `/maestro-init`, `/maestro-design`» → «(`@maestro-init`, `/maestro-new`, `/maestro-design`».
  - Строка 36: «(скрипты `maestro-init.sh`, `maestro-sandbox.sh`)» → «(скрипты `maestro-install.sh`, `maestro-sandbox.sh`)».
  - Строка 41: «(`maestro`, `maestro-init`, `maestro-design`» → «(`maestro`, `maestro-new`, `maestro-design`».
  - Строка 45: «команды `@maestro`, `/maestro-init`, `/maestro-design`» → «команды `@maestro-init`, `/maestro-new`, `/maestro-design`».

- [ ] **Step 3: `plugins/maestro-bootstrap/README.md` строка 5**: «команду `/maestro` в любой primary-сессии» → «команду `/maestro-init` в любой primary-сессии».

---

## Task 12: README.md

**Files:**
- Modify: `README.md`

- [ ] **Step 1: заменить по всему README:**
  - `/maestro` (пайплайн-вход) → `/maestro-init` (строки 15–16, 28, 53, 65, 111–112, 186, 206, 208, 74).
  - `/maestro-init` (setup) → `/maestro-new` (строки 19, 108, 111–112, 118, 152, 206, 208).
  - `maestro-init.sh` → `maestro-install.sh` (строки 53, 59–60).
  - Флоу: «Новый проект: `/maestro-new` → `/maestro-design` → `/maestro-init`»; «Существующий: `/maestro-new` → `/maestro-init`».
  - Таблица команд: `/maestro-init` (пайплайн), `/maestro-new` (setup).
  - Секция структуры: `commands/ — @command конфиги (/maestro-init, /maestro-new, /regression, /test-agents)`; `skills/ — скиллы (maestro, maestro-new, maestro-design, manual-docs)`.

- [ ] **Step 2: М-3 UX-предупреждение** — добавить в README заметку о семантическом свапе (после таблицы команд):
  > **Внимание (v2.0.0):** команда `/maestro-init` теперь — вход в пайплайн фич (ранее был bootstrap). Bootstrap нового проекта — `/maestro-new`. Старая команда `/maestro` удалена.

- [ ] **Step 3: curl-URL скрипта** (строки 59–60): `raw.githubusercontent.com/.../main/maestro-init.sh` → `.../main/maestro-install.sh`.

---

## Task 13: manual_docs/ (обязательный синк)

**Files:**
- Modify: все файлы из паттерн-листа 4.5 (16 файлов)

- [ ] **Step 1: пройти все файлы и применить:**
  - `/maestro-init` (setup) → `/maestro-new`
  - `/maestro` (пайплайн-вход) → `/maestro-init`
  - `@maestro` (пайплайн-вход) → `@maestro-init`
  - `maestro-init.sh` → `maestro-install.sh`
  - `skills/maestro-init` → `skills/maestro-new`
  - path `commands/maestro.md` → `commands/maestro-init.md` (M-10, `customize-maestro.md:44`)
  - `skills/maestro-init/SKILL.md` → `skills/maestro-new/SKILL.md`

  Файлы: `reference/commands.md`, `tutorials/setup-project.md`, `tutorials/run-first-feature.md`, `how-to/install-maestro.md`, `how-to/update-maestro.md`, `how-to/keep-docs-up-to-date.md`, `how-to/customize-maestro.md`, `overview/quick-start.md`, `overview/what-is-maestro.md`, `explanation/pipeline-overview.md`, `explanation/agents-and-trust.md`, `explanation/project-context.md`, `reference/config.md`, `reference/model-selection.md`, `reference/hitl-gates.md`, `index.md`.

- [ ] **Step 2: `reference/commands.md`** — переименовать секции: `### /maestro` → `### /maestro-init` (пайплайн); `### /maestro-init` → `### /maestro-new` (setup, «Использует скилл maestro-new»).

- [ ] **Step 3: changelog** — НЕ переписывать исторические записи. Добавить новую секцию `## [2026-09-01]` (в начало, выше `[2026-08-30]`) с «Изменено» (свап имён, версия 2.0.0) и «Миграция» (пути 1–3, UX-предупреждение M-3, rollback `--pin` M-9).

- [ ] **Step 4: Верифицировать**

```bash
rg -n 'maestro-init' manual_docs/ | rg -v 'maestro-new' | rg 'setup|bootstrap|project|skill maestro-init' || echo "no stale setup-references"
```
Expected: `maestro-init` остаётся только в значении пайплайна и в исторических changelog-записях.

---

## Task 14: Версии и changelog

**Files:**
- Modify: `package.json`
- Modify: `maestro.json`
- Modify: `manual_docs/overview/changelog.md`

- [ ] **Step 1: `package.json`**: `"version": "2.0.0"`.

- [ ] **Step 2: `maestro.json`**: `expected_version` **убрать** — версия дистрибутива не хранится в конфиге проекта. `/maestro-version` показывает фактическую версию плагина из `.maestro/plugin-version`; плагин не зеркалирует `expected-version` и не предупреждает о рассинхроне.

- [ ] **Step 3: changelog-секция `[2026-09-01]`** (см. Task 13 Step 3) — финальная форма с версией 2.0.0.

---

## Task 15: сквозная верификация

- [ ] **Step 1: тесты плагина**

```bash
node --test plugins/maestro-bootstrap/index.test.js
```
Expected: 176/176 pass.

- [ ] **Step 2: синтаксис скриптов**

```bash
bash -n maestro-install.sh maestro-update.sh
```
Expected: exit 0.

- [ ] **Step 3: контрольный grep (критерий 4 + I-6).** Вне исторических (`specs/`, changelog-истории, `TODO.md`, `docs/superpowers/`):

```bash
rg -n 'maestro-init|@maestro\b|/maestro\b|maestro-init\.sh|skills/maestro-init' --glob '!specs/**' --glob '!TODO.md' \
  AGENTS.md README.md docs/ manual_docs/ skills/ commands/ agents/ plugins/ maestro-install.sh maestro-update.sh agpack.yml maestro-install/ 2>/dev/null
```
Expected: `maestro-init` — только как пайплайн-вход (команда/скилл-контекст `maestro`), `maestro-new` — setup; `@maestro` — 0; `maestro-init.sh` — 0.

- [ ] **Step 4: sandbox runtime-проверка (критерий 6).**

```bash
./maestro-sandbox.sh 2>&1 | tail -30
```
Запустить и по чеклисту `docs/testing/maestro-sandbox-checklist.md` убедиться, что `/maestro-new`, `/maestro-design`, `/maestro-init` резолвятся, скилл `maestro-new` в списке `skill` tool, `/maestro` отсутствует.

---

## Task 16: миграция — scratch-проверка (критерий 7)

**Files:** (scratch, вне репо — `/var/folders/.../T/opencode/`)

- [ ] **Step 1: подготовить scratch-целевой проект со старым agpack.yml** (запись `skills/maestro-init`), локальный git-репо-источник с `skills/maestro-new` (имитация нового main).

- [ ] **Step 2: прогнать новый `maestro-update.sh`** (в `--no-global`/scratch) → проверить, что `skills/maestro-init` в agpack.yml заменён на `skills/maestro-new`.

- [ ] **Step 3: реальный `agpack sync`** (не `--dry-run`) — без FetchError; проверить, что `.opencode/commands/maestro.md` и `.opencode/skills/maestro-init/` удалены (stale-очистка).

- [ ] **Step 4: rollback-сценарий (M-9):** `maestro-update.sh --pin <pre-rename-sha>` на scratch — ожидаем FetchError на `skills/maestro-new`; задокументированный ручной обход (путь 3) работает.

---

## Task 17: regression entry

**Files:**
- Create: `regression/entries/2026-09-01-rename-commands-maestro-new.md`

- [ ] **Step 1: создать entry** (см. шаг 12a пайплайна). Risk: HIGH (breaking rename команд, миграция agpack). Scenarios: ручной grep-контроль (критерий 4), sandbox runtime, scratch-миграция.

---

## Task 18: коммит design-доков (шаг 12a)

- [ ] **Step 1: после одобрения плана** — один коммит:
```bash
git add specs/rename-commands-maestro-new.md specs/rename-commands-maestro-new-plan.md regression/entries/2026-09-01-rename-commands-maestro-new.md
git commit -m "docs: design + plan for rename commands maestro-init/maestro"
```

---

## Task 19: код-коммиты (шаг 13, SDD)

После SDD — per-task code коммиты (Tasks 1–14), стиль репо (`refactor(commands): ...`, `docs(...): ...`, `chore(version): bump to 2.0.0`). Один сводный рефактор-коммит возможен по решению оркестратора.

---

## Self-Review (проверка плана против спеки)

- **Spec §4.1 маппинг** → Task 1 ✅
- **Spec §4.2 контент** → Tasks 2–4 ✅
- **Spec §4.3 скрипты/agpack** → Task 9 ✅
- **Spec §4.4 каскад** → Tasks 5–8, 10–11 ✅
- **Spec §4.5 manual_docs** → Task 13 ✅
- **Spec §4.6 версии** → Task 14 ✅
- **Spec §5 миграция** → Task 16 (scratch) + Task 9 (rename-aware) ✅
- **Spec §6 критерии** → Task 15 (верификация) + Task 16 ✅
- Плацехолдеров нет: все шаги содержат конкретные правки/команды. I-2/I-6/M-7..M-11 закрыты в Tasks 4/5/6/8/9/13.