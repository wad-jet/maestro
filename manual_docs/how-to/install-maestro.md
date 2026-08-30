# Первая установка maestro

[Назад к оглавлению](../index.md)

## 🎯 Назначение

Как впервые установить `maestro` (скиллы/команды/агенты + плагин `maestro-bootstrap`)
в целевой проект. Это первый шаг; дальнейшая настройка проекта (контекст, конфиг,
модели) — в [Настройке проекта](../tutorials/setup-project.md).

> Разграничение: **этот документ** — про развёртывание скиллов/команд/агентов и
> плагина; [Настройка проекта](../tutorials/setup-project.md) — про настройку
> проекта под maestro (project-context, `maestro.json`, модели агентов).

## 🔀 Способы установки

Установить `maestro` в целевой проект можно тремя способами: через **скрипт**
`maestro-init.sh` (проще всего), через **agpack** (рекомендуется) или **вручную**.

### Вариант 0 — скрипт `maestro-init.sh` (проще всего)

Скрипт автоматизирует установку для нового или существующего проекта, где maestro
ранее не применялся: устанавливает `agpack`, создаёт `agpack.yml`, запускает
`agpack sync` (разворачивает skills/commands/agents в `.opencode/`), подключает
плагин `maestro-bootstrap` и выдаёт инструкцию для `/maestro-init`.

```bash
curl -fsSL https://raw.githubusercontent.com/wad-jet/maestro/main/maestro-init.sh -o maestro-init.sh
bash maestro-init.sh          # опции: --global (плагин в global-конфиг), --help
```

> Предусловия: bash (macOS/Linux), python3 ≥ 3.11, git. Windows — через WSL или Git Bash
> (глобальный opencode-путь может отличаться). Содержимое `agpack.yml` встроено в
> скрипт; коммиченный `maestro-init/agpack.yml` — справочная копия для доков.
> Детали — в разделе «Быстрый старт» README репозитория.

После скрипта — перезапустите OpenCode и выполните [Настройку проекта](../tutorials/setup-project.md)
(`/maestro-init`).

> **Обновление** после установки — скрипт `maestro-update.sh` (см.
> [Обновление maestro](update-maestro.md)). `maestro-init.sh` — только первичная
> установка.

### Вариант A — через agpack

[`agpack`](https://github.com/PhilippTh/agpack) — пакетный менеджер для AI-кодинг-
тулов: объявляешь зависимости в `agpack.yml`, запускаешь `agpack sync` — и
скиллы/команды/агенты разворачиваются в `.opencode/` целевого проекта.

```bash
pipx install agpack            # или: uv tool install agpack
agpack init                    # создаёт agpack.yml
```

> **macOS (pipx):** после установки `agpack` может не находиться в новых
> консольных сессиях — pipx кладёт бинари в `~/.local/bin`, который не всегда
> в `PATH`. Исправьте:
> ```bash
> pipx ensurepath    # добавляет ~/.local/bin в PATH (перезапустите консоль)
> # или временно:  export PATH="$HOME/.local/bin:$PATH"
> ```

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
      path: skills/maestro-assistant
    - url: https://github.com/wad-jet/maestro
      path: skills/maestro-feedback-report
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

> **Примечание:** agpack не покрывает плагин `maestro-bootstrap` (ставится из git —
> см. ниже) и конфиги (`maestro.json`, `.gitignore`, `regression/`; модели/плагин —
> в `.opencode/opencode.json` или global) — их создаёт `/maestro-init`.

### Вариант B — вручную (копированием)

Скопируйте файлы из авторского репозитория `maestro-agent` в целевой проект.
Карта путей (источник → целевой проект):

```
authors/repo              →  target/app
skills/maestro/SKILL.md   →  .opencode/skills/maestro/SKILL.md
skills/maestro-init/      →  .opencode/skills/maestro-init/
skills/maestro-design/    →  .opencode/skills/maestro-design/
skills/manual-docs/       →  .opencode/skills/manual-docs/
agents/*.md               →  .opencode/agents/*.md
commands/*.md             →  .opencode/commands/*.md
```

> Изменили источник → обновите копию (тот же перенос).

## Подключение плагина

Плагин `maestro-bootstrap` поставляется из git-репозитория `wad-jet/maestro`
(публикация в npm не используется) и подключается до запуска пайплайна.

**Из git (рекомендуется)** — в `~/.config/opencode/opencode.json` (реком.) или
`.opencode/opencode.json`:

```json
{
  "plugin": [
    "maestro-bootstrap@git+https://github.com/wad-jet/maestro.git"
  ]
}
```

**Локально (из исходников):**

```json
{
  "plugin": [
    "./plugins/maestro-bootstrap/index.js"
  ]
}
```

После подключения — перезапустите OpenCode, чтобы плагин подхватился.

> **Обновление** подключённого плагина — через `maestro-update.sh` (очистка кэша
> плагина и перезапуск), см. [Обновление maestro](update-maestro.md).

## После установки

Выполните [Настройку проекта](../tutorials/setup-project.md) (`/maestro-init`):
project-context, `maestro.json`, модели агентов, `.gitignore`, каталоги.

Обновление maestro (повторная доставка) — [Обновление maestro](update-maestro.md).

## 🔗 Связанные разделы

- [Обновление maestro](update-maestro.md)
- [Настройка проекта для maestro](../tutorials/setup-project.md)
- [Кастомизация скилла](customize-maestro.md)