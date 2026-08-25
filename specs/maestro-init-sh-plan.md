# План: `maestro-init.sh` + быстрый старт в README

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Скрипт `maestro-init.sh` для подготовки базы разработки через maestro в пустом каталоге (новый проект) или в каталоге существующего проекта, где maestro ранее не применялся. Скрипт автоматизирует ручной процесс из `manual_docs/how-to/install-maestro.md`: установка/настройка `agpack`, создание `agpack.yml`, `agpack sync`, подключение плагина `maestro-bootstrap`, выдача инструкции для `/maestro-init`. В README «Быстрый старт» добавить способ старта через скрипт как простую альтернативу + ссылку на скачивание.

**Architecture:** Скрипт — исполняемый bash в корне авторского репо, **самодостаточный** (содержимое `agpack.yml` встроено heredoc-ом, работает при скачивании одного `maestro-init.sh`). Коммиченный `maestro-init/agpack.yml` — справочная копия для доков (не рантайм-источник), сверяется с heredoc-ом при тестах. Скрипт идемпотентен: не перезаписывает существующий `agpack.yml`, мержит плагин в конфиг opencode, не трогая пользовательские правки. Регистрация плагина — по умолчанию в `.opencode/opencode.json` (проект, кроссплатформенно-безопасно), флаг `--global` — в глобальный конфиг opencode (путь ОС-зависим). Синтаксис — подмножество **bash 3.2** (macOS GNU bash 3.2.57).

**Tech Stack:** Bash (`set -euo pipefail`, bash-3.2-совместимое подмножество); `agpack` (pipx/uv, требует Python ≥ 3.11); JSON-мерж через `python3` (уже в зависимостях preflight). Проверка — `bash -n`, сверка heredoc ↔ шаблон, ручной прогон в `/tmp`, `node --test` (контроль, что плагин не задет).

**Согласованные решения (review):**
- `agpack.yml` содержимое — **встроено heredoc-ом в скрипт** (вариант A, ревью C1). Коммиченный `maestro-init/agpack.yml` — справочная копия для доков; скрипт его НЕ читает при одиночном скачивании. Сверка heredoc ↔ шаблон — отдельный шаг проверки.
- Регистрация плагина — **без интерактивного промпта**: по умолчанию `.opencode/opencode.json`, флаг `--global` — глобальный конфиг. `--help` — справка и выход.
- Идемпотентность — **не перезаписывать** существующий `agpack.yml` / существующее содержимое конфига opencode (мержить).
- raw-URL и ссылки — ветка репо **`main`** (не `master`; проверено: дефолтная ветка ремоута `main`).
- Кроссплатформенность — скрипт для bash-на-macOS/Linux; Windows — через WSL/Git Bash, с оговоркой в доке.

---

## File Structure

| Файл | Ответственность |
|---|---|
| `maestro-init.sh` (новый, корень) | Исполняемый bash-скрипт |
| `maestro-init/agpack.yml` (новый) | Справочный шаблон agpack-манифеста для доков (содержимое = heredoc-у в скрипте) |
| `specs/maestro-init-sh-plan.md` (этот файл) | План |
| `README.md` | Раздел «Быстрый старт»: скрипт как простой альтернативный способ + ссылка на скачивание |
| `manual_docs/how-to/install-maestro.md` | Синхронизация доков с новым способом (AGENTS.md-правило) |
| `manual_docs/overview/changelog.md` | Новая запись |

**НЕ менять** (исторические/ретроспективные): `specs/*-plan.md` прошлых задач, `manual_docs/overview/changelog.md` существующие записи (только дописать новую).

---

## Task 1: `maestro-init/agpack.yml` — справочный шаблон манифеста

**Files:**
- Create: `maestro-init/agpack.yml`

> **Роль файла:** справочная копия для доков (источник правды содержимого). Скрипт его НЕ читает — содержимое встроено heredoc-ом в `maestro-init.sh` (вариант A, ревью C1). Сверка heredoc ↔ этот файл — в Task 6.

- [ ] **Step 1: Создать каталог и шаблон**

Создать `maestro-init/agpack.yml` с содержимым (минимальный манифест maestro из `manual_docs/how-to/install-maestro.md:41-63`; **должен совпадать с heredoc-ом в `maestro-init.sh`**, Task 2):

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

- [ ] **Step 2: Commit**

```bash
git add maestro-init/agpack.yml
git commit -m "feat(init): шаблон agpack.yml для maestro-init.sh"
```

---

## Task 2: `maestro-init.sh` — скрипт

**Files:**
- Create: `maestro-init.sh`

- [ ] **Step 1: Создать скрипт**

Создать исполняемый `maestro-init.sh` (bash, `set -euo pipefail`, язык вывода — русский). **Жёсткие требования (из ревью):**

- **bash-3.2-совместимое подмножество** (macOS GNU bash 3.2.57): НЕ использовать `mapfile`/`readarray`, `declare -A`, `${var,,}`/`${var^^}`, `${var@Q}`, рекурсивные `**`-глобы. Многострочные строки — через `cat`/`printf`, не `read -r` в цикле по `<<<`.
- **Все проверки наличия — только через `if ! command -v ...; then`**, не голые команды под `set -e`. Обезопасить `set -u`: задавать дефолты для `XDG_CONFIG_HOME`, `HOME` и т.п. (`: "${XDG_CONFIG_HOME:=$HOME/.config}"`).
- **Preflight версии python**: проверять `python3 --version` **≥ 3.11** (требование agpack), не только наличие.
- **JSON-мерж плагина — через `python3`-сниппет** (python3 уже в зависимостях), не bash-текстом/sed.
- **Детект ОС** для глобального opencode-пути (`uname`/`$OSTYPE`); проектный `.opencode/opencode.json` — кроссплатформенно-безопасен и является дефолтом.

Логика по шагам:

1. **Preflight** — проверить `git` и `python3` (версия ≥ 3.11) в PATH; при отсутствии — понятная ошибка с инструкцией. Проверить `dirname "$0"` на наличие `maestro-init/agpack.yml` только для справки (скрипт самодостаточен, шаблон не обязателен).
2. **Обнаружение/установка `agpack`**:
   - `command -v agpack` → ок.
   - иначе `~/.local/bin/agpack` (macOS/Linux pipx-путь) → использовать.
   - иначе установить: предпочесть `uv tool install agpack` (если есть `uv`), fallback `pipx install agpack` (если есть `pipx`), иначе — инструкция. Для macOS pipx — хинт `pipx ensurepath` / `export PATH="$HOME/.local/bin:$PATH"`; для Ubuntu — хинт `sudo apt install python3-venv python3-pip` (pipx требует venv). Допущение: pipx/uv кладут бинари в `~/.local/bin`.
3. **Создание `agpack.yml`** (идемпотентно) — если файла нет, **записать heredoc-ом содержимое из встроенного шаблона** (вариант A); существующий НЕ перезаписывать. Скрипт НЕ зависит от `maestro-init/agpack.yml` на диске.
4. **`agpack sync`** — запуск в каталоге проекта.
5. **Регистрация плагина** (идемпотентно, без промпта):
   - по умолчанию `.opencode/opencode.json` (проект); флаг `--global` — глобальный конфиг opencode (путь: macOS/Linux `$HOME/.config/opencode/opencode.json`; Windows/Git Bash — оговорка в доке, Task 4).
   - через `python3`-сниппет добавить spec `"plugin": ["maestro-bootstrap@git+https://github.com/wad-jet/maestro.git"]`, мержить `plugin`-массив (append, если spec ещё нет), никогда не перезаписывать существующее содержимое (правило `skills/maestro-init/SKILL.md:141-146`).
   - JSON валидный, `indent=2`. Корневой `opencode.json` НЕ создавать.
6. **Инструкция** — вывести команды запуска: `opencode` в проекте → `/maestro-init`; для нового — `/maestro-design`, затем `/maestro`. Сообщить о перезапуске OpenCode для подхвата плагина.

**Флаги:** `--global` (плагин в global-конфиг), `--help`. При `--help` — краткая справка и выход. Интерактивных промптов нет (детерминированный quick-start).

- [ ] **Step 2: Сделать исполняемым**

```bash
chmod +x maestro-init.sh
```

- [ ] **Step 3: Commit**

```bash
git add maestro-init.sh
git commit -m "feat(init): maestro-init.sh — bootstrap проекта для maestro через agpack"
```

---

## Task 3: `README.md` — быстрый старт

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Прочитать текущий блок «Быстрый старт»**

Run: `sed -n '49,62p' README.md`
Expected: шаг «1. Настройте проект» — установка через agpack (рекомендуется) или вручную, ссылка на `install-maestro.md`.

- [ ] **Step 2: Добавить способ через скрипт**

В шаге «1. Настройте проект» добавить третий способ (простейший) — «Скрипт `maestro-init.sh`» (для нового и существующего проекта), с готовыми командами и веткой **`main`** (ревью C2):

```bash
curl -fsSL https://raw.githubusercontent.com/wad-jet/maestro/main/maestro-init.sh -o maestro-init.sh
bash maestro-init.sh
```

Затем `opencode` → `/maestro-init`. Указать пре-требования: bash (macOS/Linux), python3 ≥ 3.11, git. Windows-оговорка: запуск через WSL/Git Bash; глобальный конфиг opencode может отличаться. Подробности — `manual_docs/how-to/install-maestro.md`.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs(readme): быстрый старт через maestro-init.sh"
```

---

## Task 4: `manual_docs/how-to/install-maestro.md` — синхронизация

**Files:**
- Modify: `manual_docs/how-to/install-maestro.md`

- [ ] **Step 1: Прочитать текущий блок установки**

Run: `sed -n '15,90p' manual_docs/how-to/install-maestro.md`
Expected: «Два способа установки» — Вариант A (agpack) / Вариант B (вручную).

- [ ] **Step 2: Добавить «Способ C — скрипт `maestro-init.sh`»**

Добавить краткий блок: ссылка на `maestro-init.sh` (raw-URL, ветка **`main`**), команда запуска, что делает (установка agpack, создание `agpack.yml`, `agpack sync`, регистрация плагина, инструкция `/maestro-init`), и что детали — в README «Быстрый старт». Указать: содержимое `agpack.yml` встроено в скрипт; коммиченный `maestro-init/agpack.yml` — справочная копия. Windows-оговорка (WSL/Git Bash; глобальный opencode-путь может отличаться). Выровнять inline-`agpack.yml`-фрагмент на шаблон как источник правды.

- [ ] **Step 3: Commit**

```bash
git add manual_docs/how-to/install-maestro.md
git commit -m "docs(install): способ установки через maestro-init.sh"
```

---

## Task 5: `manual_docs/overview/changelog.md` — новая запись

**Files:**
- Modify: `manual_docs/overview/changelog.md`

- [ ] **Step 1: Дописать новую запись (без переписывания истории)**

Дописать в конец changelog запись о добавлении `maestro-init.sh` (скрипт bootstrap проекта + `maestro-init/agpack.yml` шаблон + быстрый старт в README).

- [ ] **Step 2: Commit**

```bash
git add manual_docs/overview/changelog.md
git commit -m "docs: changelog — maestro-init.sh"
```

---

## Task 6: Проверка когерентности

**Files:** (ничего не меняется)

- [ ] **Step 1: Синтаксис скрипта**

Run: `bash -n maestro-init.sh`
Expected: без ошибок (exit 0).

- [ ] **Step 2: Сверка heredoc ↔ шаблон ↔ дока**

Убедиться, что содержимое `agpack.yml`, встроенное heredoc-ом в `maestro-init.sh`, совпадает с коммиченным `maestro-init/agpack.yml` и inline-фрагментом в `manual_docs/how-to/install-maestro.md` (diff). При расхождении — синхронизировать (источник правды содержимого — heredoc в скрипте; шаблон и дока отражают его).

- [ ] **Step 3: Ручной прогон в пустом каталоге**

Run (в `/tmp`-каталоге, безопасно):
```bash
mkdir -p /tmp/maestro-init-smoke && cd /tmp/maestro-init-smoke
bash /path/to/maestro-init.sh --help
```
Expected: справка, выход без side-эффектов. Дополнительно:
- проверить preflight (версия python ≥ 3.11; если `agpack` не установлен — скрипт даёт инструкцию/устанавливает);
- **прогон с одиночным скачиванием скрипта** (без каталога `maestro-init/`) — убедиться, что heredoc генерирует `agpack.yml` (вариант A, ревью C1);
- проверить, что `plugin` мержится в `.opencode/opencode.json` без потери существующего содержимого.

- [ ] **Step 4: Плагин не задет (контроль)**

Run: `node --test plugins/maestro-bootstrap/index.test.js`
Expected: PASS (код плагина не менялся; контроль регрессии).

- [ ] **Step 5: Финал**

```bash
git log --oneline -8
```
Expected: серия коммитов `feat(init): ...` + `docs: ...`.

---

## Self-Review

**Spec coverage (запрос пользователя):**
- «maestro-init.sh для подготовки базы… в пустом каталоге или в существующем проекте» → Task 2 (скрипт: preflight, agpack-установка, `agpack.yml`, sync, plugin, инструкция).
- «Скрипт создает agpack.yml, запускает agpack sync (проверяет наличие и устанавливает/настраивает с нюансами по OS)» → Task 2 (шаги 2–4).
- «Подключает плагин maestro-bootstrap@git+https://github.com/wad-jet/maestro.git» → Task 2 (шаг 5).
- «Дает краткую инструкцию по запуску инициализации в opencode» → Task 2 (шаг 6).
- «В README в быстрый старт указать способ старта с помощью скрипта + возможность скачать (ссылка)» → Task 3.
- Правило AGENTS.md: изменения skills/commands/AGENTS.md отражаются в manual_docs. Скрипт — новый артефакт, не скилл/команда/агент; `install-maestro.md` синхронизируем (Task 4) по духу правила, т.к. документирует установку.
- Правило AGENTS.md: все фичи/багфиксы — spec/plan в `specs/` → этот план создан в `specs/maestro-init-sh-plan.md`.

**Placeholder scan:** нет плейсхолдеров. Open questions зафиксированы ниже (снятые отмечены).

**Ревью (внесено):**
- **C1 — шаблон vs одиночный скрипт:** решено — вариант **A** (heredoc в скрипте, самодостаточен); `maestro-init/agpack.yml` — справочная копия для доков, сверяется в Task 6.
- **C2 — ветка raw-URL:** дефолтная ветка репо **`main`** (проверено по ремоуту), не `master`. Исправлено в Task 3/4.
- **C3 — bash 3.2:** macOS поставляет GNU bash 3.2.57; Task 2 требует bash-3.2-совместимое подмножество.
- **W1 — Windows:** скрипт для bash-на-macOS/Linux; Windows — WSL/Git Bash, оговорка в доке (Task 3/4); глобальный opencode-путь ОС-зависим, детект в Task 2.
- **W2 — Python ≥ 3.11:** preflight проверяет версию (требование agpack); Ubuntu — хинт `python3-venv`.
- **W3 — `~/.local/bin`:** допущение pipx/uv, зафиксировано в Task 2.
- **W4 — `set -euo pipefail` + `command -v`:** все проверки только через `if ! command ...`; дефолты для `XDG_CONFIG_HOME`/`HOME`.
- **D1 — JSON через python3:** мерж `plugin` — python3-сниппет, не bash-текст.
- **D2 — без промпта:** дефолт проект + `--global` + `--help`, детерминированный quick-start.
- **D3 — сверка синхронности:** Task 6 Step 2 (heredoc ↔ шаблон ↔ дока).
- **D4 — README download-команды:** Task 3 (curl + bash).

**Open questions / риски:**
- **Установка agpack**: если ни `uv`, ни `pipx` нет — скрипт только выдаёт инструкцию (сетевой доступ к PyPI нужен). Если python < 3.11 — preflight останавливает с инструкцией.
- **Глобальный opencode-путь на Windows**: точное расположение (`%USERPROFILE%\.config\opencode` vs `%APPDATA%\opencode`) НЕ верифицировано — в Task 2 детект ОС, нативный Windows документирован как WSL/Git Bash; проверить при необходимости.
- **bash 3.2-совместимость**: обязательно перепроверить `bash -n` на реальной macOS (bash 3.2.57), т.к. окружение разработки может быть на более новом bash.

**Type consistency:** номера строк README/install-maestro.md актуальны на момент написания; исполнитель сверяет `sed -n`/`rg` перед Edit (номера могут сместиться после коммитов).