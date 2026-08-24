# `.maestro/` в `.gitignore` целиком — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Перевести все доки/skills/commands/plugin-README с точечного `.gitignore`-списка эфемерных путей в `.maestro/` на игнорирование всего каталога `.maestro/`.

**Architecture:** В `.maestro/` только эфемерное (sdd/, last-run, logs/, feedback-reports/, plugin-version); конфиг проекта — единственный `maestro.json` в корне. Меняем точечный `.gitignore`-список на игнорирование всего каталога `.maestro/` и вводим явное правило «конфиги только в `maestro.json` в корне, никогда в `.maestro/`».

**Tech Stack:** Markdown-документация (skills/commands/manual_docs/AGENTS.md/plugin README); без изменений кода. Проверка — `rg` + `node --test` (контроль, что плагин не задет).

---

## File Structure

Изменяются только Markdown-файлы. Кода не касаемся.

| Файл | Ответственность |
|---|---|
| `skills/maestro-init/SKILL.md:201-213` | Главный источник: блок генерации `.gitignore` |
| `skills/maestro-assistant/SKILL.md:143-145` | Правило структуры каталогов + `.gitignore` |
| `skills/maestro/SKILL.md:172-173, 413, 1356-1357, 1422` | Упоминания «только эфемерное» / `.gitkeep` / SDD |
| `skills/maestro-design/SKILL.md:143` | `last-run.md` «в .gitignore» |
| `skills/maestro-feedback-report/SKILL.md:170` | `feedback-reports/` «в .gitignore» |
| `commands/maestro-init.md:13` | «конкретные пути» |
| `commands/maestro-assistant.md:14` | «конкретные пути» |
| `AGENTS.md:23` | Rename-note: `.gitignore` entry |
| `plugins/maestro-bootstrap/README.md:199-202` | «конкретные пути, а не весь .maestro/» |
| `manual_docs/reference/config.md:194, 561-565` | Таблица коммитимости |
| `manual_docs/tutorials/setup-project.md:42-43` | «конкретные пути» |
| `manual_docs/how-to/use-regression-registry.md:21` | «в .gitignore» |
| `manual_docs/reference/commands.md:38` | «каталоги pipeline» |
| `TODO.md:20` | Закрыть пункт |

**НЕ менять** (ретроспективные/исторические): `specs/*-plan.md`, `manual_docs/overview/changelog.md` — документируют прошлое решение; историю не переписываем.

---

## Task 1: `skills/maestro-init/SKILL.md` — главный источник `.gitignore`

**Files:**
- Modify: `skills/maestro-init/SKILL.md:201-213`

- [ ] **Step 1: Прочитать текущий блок**

Run: `sed -n '201,213p' skills/maestro-init/SKILL.md`
Expected: блок `### .gitignore — конкретные пути (не весь `.maestro/`)` со списком 5 путей и предупреждением «НЕ использовать `.maestro/`».

- [ ] **Step 2: Заменить блок на «весь `.maestro/`»**

Заменить (Edit tool) весь блок строк 201-213 на:

```md
### .gitignore — весь `.maestro/` (только эфемерное)

Добавить (идемпотентно, не дублировать):
```
.maestro/
```
`.maestro/` содержит только эфемерное (sdd/, last-run.md, logs/, feedback-reports/,
plugin-version) и игнорируется целиком. Конфиг проекта — единственный файл
`maestro.json` в корне (рядом с `opencode.json`). **Никакие конфиги не класть в
`.maestro/`** — иначе они потеряются из git (`.maestro/` в `.gitignore`).
```

- [ ] **Step 3: Commit**

```bash
git add skills/maestro-init/SKILL.md
git commit -m "docs(init): gitignore весь .maestro/ вместо конкретных путей"
```

---

## Task 2: `skills/maestro-assistant/SKILL.md`

**Files:**
- Modify: `skills/maestro-assistant/SKILL.md:143-145`

- [ ] **Step 1: Заменить правило `.gitignore`**

Заменить (Edit tool) строки 143-145:

```md
Проверить/создать (идемпотентно): `.maestro/`, `docs/superpowers/{specs,plans}/`,
`docs/confidential/`, `regression/{entries,released}/`. `.gitignore` — `.maestro/`
целиком (только эфемерное); конфиг проекта — только `maestro.json` в корне,
не в `.maestro/`.
```

- [ ] **Step 2: Commit**

```bash
git add skills/maestro-assistant/SKILL.md
git commit -m "docs(assistant): .gitignore весь .maestro/"
```

---

## Task 3: `skills/maestro/SKILL.md`

**Files:**
- Modify: `skills/maestro/SKILL.md:172-173, 413, 1356-1357, 1422`

- [ ] **Step 1: Строки 172-173 — «только эфемерное»**

Заменить (Edit tool):
```
- `.maestro/` в `.gitignore` — только эфемерное (sdd/, last-run,
  maestro-bootstrap-*.log); реестр в git
```
на:
```
- `.maestro/` целиком в `.gitignore` (только эфемерное: sdd/, last-run,
  logs/, feedback-reports/, plugin-version); реестр в git
```

- [ ] **Step 2: Строка 413 — убрать `.gitkeep`**

Заменить (Edit tool):
```
      a. **Pre-clean:** удалить `.maestro/sdd/*.md` (кроме `.gitkeep`).
```
на:
```
      a. **Pre-clean:** очистить `.maestro/sdd/` от файлов прошлых фич.
```

- [ ] **Step 3: Строки 1356-1357, 1422 — выровнять**

Заменить (Edit tool):
- строка 1356-1357: `Per-worktree остаются `.maestro/sdd/`, `.maestro/logs/`, `.maestro/last-run.md` (в `.gitignore`)` → `Per-worktree остаётся `.maestro/` (в `.gitignore` целиком)`.
- строка 1422: `SDD progress: `.maestro/sdd/progress.md` (в gitignore)` → `SDD progress: `.maestro/sdd/progress.md` (в `.gitignore`, весь `.maestro/`)`.

- [ ] **Step 4: Commit**

```bash
git add skills/maestro/SKILL.md
git commit -m "docs(maestro): .gitignore весь .maestro/, убрать .gitkeep"
```

---

## Task 4: `skills/maestro-design/SKILL.md` и `skills/maestro-feedback-report/SKILL.md`

**Files:**
- Modify: `skills/maestro-design/SKILL.md:143`
- Modify: `skills/maestro-feedback-report/SKILL.md:170`

- [ ] **Step 1: Проверить формулировки (без перечисления путей)**

Run: `rg -n "в .gitignore" skills/maestro-design/SKILL.md skills/maestro-feedback-report/SKILL.md`
Expected: `design:143` — «записывается, в .gitignore»; `feedback-report:170` — «эфемерное (в .gitignore, see skills/maestro-init/SKILL.md)». Оба упоминания не перечисляют конкретные пути → остаются верными, правка не требуется.

- [ ] **Step 2: (опционально) Уточнить в feedback-report**

Если хотите явную ссылку на «весь .maestro/» — заменить `(в .gitignore, see skills/maestro-init/SKILL.md)` на `(в `.gitignore` целиком, see skills/maestro-init/SKILL.md)`.

- [ ] **Step 3: Commit (если была правка)**

```bash
git add skills/maestro-design/SKILL.md skills/maestro-feedback-report/SKILL.md
git commit -m "docs: уточнить .gitignore для эфемерного в .maestro/"
```

---

## Task 5: Команды `commands/maestro-init.md` и `commands/maestro-assistant.md`

**Files:**
- Modify: `commands/maestro-init.md:13`
- Modify: `commands/maestro-assistant.md:14`

- [ ] **Step 1: `commands/maestro-init.md:13`**

Заменить (Edit tool): `.gitignore` (конкретные` → ``.gitignore` (весь `.maestro/`)`.

- [ ] **Step 2: `commands/maestro-assistant.md:14`**

Заменить (Edit tool): `Структура каталогов pipeline + `.gitignore` конкретных путей` → `Структура каталогов pipeline + `.gitignore` (весь `.maestro/`)`.

- [ ] **Step 3: Commit**

```bash
git add commands/maestro-init.md commands/maestro-assistant.md
git commit -m "docs(commands): .gitignore весь .maestro/"
```

---

## Task 6: `AGENTS.md`

**Files:**
- Modify: `AGENTS.md:23`

- [ ] **Step 1: Заменить rename-note по `.gitignore`**

Заменить (Edit tool) фрагмент:
```
and `.gitignore` entry `.feature-agent/` → **specific paths** (`.maestro/sdd/`, `.maestro/last-run.md`, `.maestro/logs/maestro-bootstrap-*.log` — НЕ весь `.maestro/`, см. `skills/maestro/SKILL.md`).
```
на:
```
and `.gitignore` entry `.feature-agent/` → **`.maestro/`** (весь каталог — только эфемерное; конфиг `maestro.json` в корне, см. `skills/maestro/SKILL.md`).
```

- [ ] **Step 2: Commit**

```bash
git add AGENTS.md
git commit -m "docs(agents): .gitignore весь .maestro/ в rename-note"
```

---

## Task 7: `plugins/maestro-bootstrap/README.md`

**Files:**
- Modify: `plugins/maestro-bootstrap/README.md:199-202`

- [ ] **Step 1: Заменить блок «Логирование»**

Заменить (Edit tool):
```
Плагин пишет JSONL-лог в `.maestro/logs/` (каталог создаётся автоматически). В
`.gitignore` добавляются **конкретные пути**, а не весь `.maestro/`:
`.maestro/sdd/`, `.maestro/last-run.md`, `.maestro/logs/`,
`.maestro/feedback-reports/`.
```
на:
```
Плагин пишет JSONL-лог в `.maestro/logs/` (каталог создаётся автоматически).
Весь `.maestro/` добавляется в `.gitignore` (только эфемерное: sdd/, last-run.md,
logs/, feedback-reports/, plugin-version); конфиг проекта — `maestro.json` в корне.
```

- [ ] **Step 2: Commit**

```bash
git add plugins/maestro-bootstrap/README.md
git commit -m "docs(plugin): .gitignore весь .maestro/"
```

---

## Task 8: `manual_docs/`

**Files:**
- Modify: `manual_docs/reference/config.md:194, 561-565`
- Modify: `manual_docs/tutorials/setup-project.md:42-43`
- Modify: `manual_docs/how-to/use-regression-registry.md:21`
- Modify: `manual_docs/reference/commands.md:38`

- [ ] **Step 1: `manual_docs/reference/config.md:561-565` — сгруппировать**

Заменить (Edit tool) таблицу (5 строк `.maestro/*` «Нет») на одну:
```md
| `.maestro/**` | SDD progress, last-run.md, logs/, feedback-reports/, plugin-version (эфемерное) | Нет |
```

- [ ] **Step 2: `manual_docs/reference/config.md:194`**

Заменить (Edit tool): `пишет JSONL-логи в `.maestro/logs/` (gitignored,` → `пишет JSONL-логи в `.maestro/logs/` (весь `.maestro/` в gitignore,`.

- [ ] **Step 3: `manual_docs/tutorials/setup-project.md:42-43`**

Заменить (Edit tool):
```
   - `.gitignore` — конкретные пути (`.maestro/sdd/`, `.maestro/last-run.md`,
      `.maestro/logs/`, `.maestro/plugin-version`);
```
на:
```
   - `.gitignore` — весь `.maestro/` (эфемерное);
```

- [ ] **Step 4: `manual_docs/how-to/use-regression-registry.md:21`**

Фактическая текущая строка (сверено 2026-08-24):
```
файлы в `.maestro/` (sdd/, maestro-bootstrap-*.log, last-run) — они в `.gitignore`.
```
Заменить (Edit tool) на:
```
файлы в `.maestro/` (эфемерное) — весь каталог в `.gitignore`.
```

- [ ] **Step 5: `manual_docs/reference/commands.md:38`**

Фактическая текущая строка (сверено 2026-08-24):
```
`.gitignore`), каталоги pipeline (`.maestro/`, `docs/superpowers/{specs,plans}/`),
```
Заменить (Edit tool) на:
```
`.gitignore`), каталоги pipeline (`.maestro/` — весь в `.gitignore`,
`docs/superpowers/{specs,plans}/`),
```

- [ ] **Step 6: `manual_docs/overview/changelog.md` — новая запись**

Историческую запись о C2 (`changelog.md:48-49`) **не переписывать**. Дописать **новую** запись о смене решения (весь `.maestro/` в `.gitignore`):

```md
- **Смена `.gitignore` для `.maestro/`**: вместо конкретных путей (sdd/, last-run,
  logs/, feedback-reports/, plugin-version) — весь каталог `.maestro/` в `.gitignore`.
  Конфиг проекта — `maestro.json` в корне.
```

- [ ] **Step 7: Commit**

```bash
git add manual_docs/
git commit -m "docs: .gitignore весь .maestro/ в manual_docs + changelog"
```

---

## Task 9: `TODO.md` — закрыть пункт

**Files:**
- Modify: `TODO.md:20`

- [ ] **Step 1: Отметить решённым**

Заменить (Edit tool):
```
- [ ] По идее весь .maestro/ должен попаддать в .gitignore, так ли это?
```
на:
```
- [x] По идее весь .maestro/ должен попаддать в .gitignore, так ли это? → **Да.** В `.maestro/` только эфемерное; конфиг `maestro.json` в корне. Изменено: `specs/gitignore-maestro-plan.md`.
```

- [ ] **Step 2: Commit**

```bash
git add TODO.md
git commit -m "docs: отметить решённым вопрос про .maestro/ в .gitignore"
```

---

## Task 10: Проверка когерентности

**Files:** (ничего не меняется)

- [ ] **Step 1: Не осталось активных упоминаний «конкретные пути / НЕ весь .maestro/»**

Run:
```bash
rg -n "конкретные пути|НЕ весь|не весь|НЕ использовать.*maestro" skills/ commands/ AGENTS.md plugins/maestro-bootstrap/README.md manual_docs/ TODO.md
```
Expected: только исторические вхождения в `manual_docs/overview/changelog.md` (не меняем) и в новых формулировках про «только эфемерное» — без «НЕ весь .maestro/».

- [ ] **Step 2: Старый список путей исчез из активных доков**

Run:
```bash
rg -n "\.maestro/sdd/|\.maestro/last-run\.md|\.maestro/feedback-reports/|\.maestro/plugin-version" skills/ commands/ AGENTS.md plugins/maestro-bootstrap/README.md
```
Expected: **разрешённые** вхождения — это ссылки на **пути файлов** в `.maestro/`
в прозе/командах (НЕ правила `.gitignore`). Полный список таких легитимных файлов
(не править!):
- `skills/maestro-feedback-report/SKILL.md` (`.maestro/feedback-reports/`, `.maestro/logs/`)
- `commands/maestro-feedback-report.md` (`.maestro/feedback-reports/`)
- `commands/regression.md` (`.maestro/last-run.md`)
- `commands/maestro-design.md` (`.maestro/last-run.md`)
- `commands/maestro-version.md` (`.maestro/plugin-version`)
- `README.md` (`.maestro/plugin-version`)
- `manual_docs/how-to/update-maestro.md` (`.maestro/plugin-version`)

Запрещены (должны отсутствовать): правила `.gitignore` с перечислением конкретных
путей и фразы «конкретные пути» / «НЕ весь .maestro/». После Task 3/7 в пояснениях
допускается «эфемерное содержимое: sdd/, last-run.md, logs/, ...» — это не правило.

- [ ] **Step 3: Плагин не задет (контроль)**

Run: `node --test plugins/maestro-bootstrap/index.test.js`
Expected: PASS (код плагина не менялся; контроль регрессии).

- [ ] **Step 4: Финал**

```bash
git log --oneline -15
```
Expected: серия коммитов `docs: .gitignore весь .maestro/` (+1 для TODO.md).

---

## Self-Review

**Spec coverage (запрос пользователя):**
- «отметить в скилах, где затрагивается инициализация и создание .gitignore, что нужно внести папку .maestro/» → Task 1 (maestro-init), Task 2 (assistant), Task 3 (maestro).
- «сделать упоминание в документации» → Task 5 (commands), Task 6 (AGENTS.md), Task 7 (plugin README), Task 8 (manual_docs).
- «провести углублённый полный анализ» → раздел анализа в теле плана (обоснование перехода на весь `.maestro/`).
- Правило AGENTS.md: изменения skills/commands/AGENTS.md отражаются в manual_docs → Task 8 покрывает.

**Placeholder scan:** нет плейсхолдеров; все замены содержат точный целевой текст. Точные текущие строки для `use-regression-registry.md:21` и `reference/commands.md:38` зафиксированы в Task 8 (сверено 2026-08-24) — исполнитель сверяет перед Edit, но не гадает.

**Review fixes applied (2026-08-24):** R1 (Task 10 Step 2 — полный expected-output с перечнем легитимных ссылок на пути, чтобы не «чинить» их); M1 (Task 8 Step 6-7 — новая запись в changelog.md без переписывания истории); M2 (Task 8 Step 4-5 — точные целевые строки). Дополнительно из текста плана убраны упоминания неактуальных конфигов и ссылки на «обратный C2».

**Type consistency:** пути файлов и номера строк выверены по grep-выводам на момент написания; исполнитель обязан сверить `sed -n`/`rg` перед каждой Edit, т.к. номера строк могут сместиться после коммитов (рекомендуется Edit по уникальному тексту, а не по номеру строки).

**Известный момент:** `skills/maestro/SKILL.md:413` — убрали `.gitkeep` (весь `.maestro/` игнорируется, каталог создаётся плагином автоматически; `.gitkeep` больше не имеет смысла). Если потребуется трекать структуру `.maestro/sdd/` через `.gitkeep` — добавить в `.gitignore` отрицание `!.maestro/sdd/.gitkeep`; по умолчанию НЕ добавляем.