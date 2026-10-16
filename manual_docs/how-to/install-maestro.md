# Первая установка maestro

[Назад к оглавлению](../index.md)

## 🎯 Назначение

Как впервые установить `maestro` (скиллы/команды/агенты + плагин
`maestro-bootstrap`) — в **глобальном** режиме (рекомендуется, на всю
машину) или в **проектном** режиме (локально, в `.opencode/`). Дальнейшая
настройка проекта (контекст, конфиг, модели) — в [Настройке проекта](../tutorials/setup-project.md).

> Разграничение: **этот документ** — про развёртывание скиллов/команд/агентов
> и плагина; [Настройка проекта](../tutorials/setup-project.md) — про настройку
> проекта под maestro (project-context, `maestro.json`, модели агентов).

## 🔀 Режимы установки

Оба режима — один и тот же скрипт `maestro-install.sh` с единым механизмом
доставки: `git clone` (https-only, shallow) + **wholesale copy** всего
`skills/`, `commands/`, `agents/` (включая superpowers-скиллы) + manifest +
JSON-регистрация плагина (python3 — любой версии, только для JSON-операций).
Списков/whitelist компонентов нет: новый компонент = авто-deploy при
следующей установке/обновлении.

| Режим | Целевые каталоги | Регистрация плагина | Состояние (manifest) |
|---|---|---|---|
| `--global` (рекомендуется) | `~/.config/opencode/{skills,commands,agents}/` | глобальный `~/.config/opencode/opencode.json` | `~/.config/opencode/.maestro/manifest.json` |
| `--project` (default) | `<project>/.opencode/{skills,commands,agents}/` | `<project>/.opencode/opencode.json` | `<project>/.maestro/manifest.json` |

> Пути резолвятся через `XDG_CONFIG_HOME`: если задан —
> `$XDG_CONFIG_HOME/opencode/...`, иначе `~/.config/opencode/...`.

### Вариант A — глобальная установка (рекомендуется)

Одна команда раскатывает скиллы/команды/агенты и плагин на всю машину. Скиллы
доступны во всех проектах без `.opencode/` зеркала. В git проекта не попадает
ни одного maestro-файла (исключение — опциональный `maestro.json` в корне
проекта — см. [Конфигурация](../reference/config.md)).

```bash
curl -fsSL https://raw.githubusercontent.com/wad-jet/maestro/main/maestro-install.sh -o maestro-install.sh
bash maestro-install.sh --global    # опции: --pin <sha>, --dry-run, --migrate, --help
```

> Предусловия: bash (macOS/Linux), git, curl/wget, python3 (любой версии —
> только для JSON-регистрации плагина), сеть.
> Windows — через WSL или Git Bash (глобальный opencode-путь может отличаться).

Что делает скрипт:

1. **Clone-first:** клонирует maestro + superpowers (shallow, https-only)
   **до** любых изменений — если clone не удался, система в оригинальном
   состоянии (fail-fast).
2. **Блокировка:** mkdir-based lock; конкурентные запуски блокируются
   (stale-lock старше 30 мин — warning).
3. **Collision detection:** пользовательские скиллы/команды/агенты без
   маркера `.maestro-deployed` → HITL (overwrite / rename `-user-` / skip);
   non-interactive (stdin не tty) — abort (fail-closed).
4. **Wholesale copy** (атомарно: staging + mv): всё содержимое `skills/`,
   `commands/`, `agents/` (maestro + superpowers) в глобальные каталоги.
5. **Manifest** `~/.config/opencode/.maestro/manifest.json` (атомарная
   запись) — фиксирует, что развёрнуто (sha коммитов, список путей).
6. **Регистрация плагина** в глобальном `~/.config/opencode/opencode.json`
   (idempotent, de-dup: чужие записи в `plugins` не трогаются).
7. Создаёт глобальный `maestro.json`
   (`~/.config/opencode/.maestro/maestro.json`) при отсутствии — default
   `memory.enabled: false` (privacy-safe: память не включается
   автоматически во всех проектах).

После скрипта — **перезапустите OpenCode** и выполните
[Настройку проекта](../tutorials/setup-project.md) (`/maestro-setup`): в
глобальном режиме создаёт `.maestro/maestro.json` с auto-derive namespace
памяти из git remote (память включается per-project), модели, `.gitignore`.

> **Обновление** после установки — `maestro-update.sh --global` (см.
> [Обновление maestro](update-maestro.md)). `maestro-install.sh` — только
> первичная установка.

### Вариант B — проектная установка (default)

Развёртывание в один проект — для тех, кто держит скиллы/команды/агенты
локально (`.opencode/`-зеркало, gitignored):

```bash
bash maestro-install.sh --project      # то же, что `bash maestro-install.sh` (--project — default)
bash maestro-install.sh --project --dry-run   # план без изменений (0 мутаций)
```

- Целевые каталоги: `<project>/.opencode/{skills,commands,agents}/`;
  manifest — `<project>/.maestro/manifest.json`;
  регистрация плагина — `<project>/.opencode/opencode.json`.
- Механизм доставки — тот же wholesale copy, что и в глобальном режиме.

После установки — то же: перезапуск OpenCode + `/maestro-setup`.

### Миграция с legacy-установки (`--migrate`)

`bash maestro-install.sh --global --migrate` (или `--project --migrate`) —
миграция установки дореформенной (предыдущей) схемы: разворачивает штатным
механизмом, записывает `.maestro/maestro.json` с `memory.enabled: true` +
auto-derive namespace из git remote, удаляет legacy-файлы проекта (HITL).
Read-only legacy-файлы — warning + пропуск (не деструктивно).

### Вариант C — вручную (копированием)

Скопируйте файлы из авторского репозитория `maestro-agent` в целевой проект.
Карта путей (источник → целевой проект):

```
skills/**        → .opencode/skills/**       (глобально: ~/.config/opencode/skills/**)
agents/*.md      → .opencode/agents/*.md
commands/*.md    → .opencode/commands/*.md
```

> Изменили источник → обновите копию (тот же перенос). При ручной установке
> плагин нужно подключить вручную (см. ниже).

## Подключение плагина

Плагин `maestro-bootstrap` поставляется из git-репозитория `wad-jet/maestro`
(публикация в npm не используется). Оба режима установки **подключают его
автоматически** (idempotent, de-dup: только «наши» записи в `plugins`
заменяются, чужие не трогаются).

**Из git (рекомендуется)** — `--global`: `~/.config/opencode/opencode.json`;
`--project`: `.opencode/opencode.json`:

```json
{
  "plugins": [
    "maestro-bootstrap@git+https://github.com/wad-jet/maestro.git"
  ]
}
```

**Локально (из исходников):**

```json
{
  "plugins": [
    "../plugins/maestro-bootstrap/index.js"
  ]
}
```

> **Подводный камень (silent fail).** Относительный путь плагина резолвится
> **от каталога конфига** (`.opencode/` для проектного или `~/.config/opencode/`
> для глобального), а не от корня проекта: `./plugins/...` станет
> `.opencode/plugins/...` (нет такого пути) — плагин молча не загрузится.
> Используйте `../plugins/...` (подъём к корню; работает для проектного
> `.opencode/opencode.json`) или абсолютный `file:///…`. Если плагин не загружен —
> в `.maestro/logs/` нет свежего `maestro-bootstrap-<дата>.log` с записью
> `plugin initialized`.

После подключения — перезапустите OpenCode, чтобы плагин подхватился.

> **Обновление** подключённого плагина — через `maestro-update.sh` (очистка кэша
> плагина и перезапуск), см. [Обновление maestro](update-maestro.md).

## После установки

1. **Перезапустите OpenCode** (чтобы плагин подхватился).
2. Выполните [Настройку проекта](../tutorials/setup-project.md)
   (`/maestro-setup`) в каждом проекте: конфиг, модели, `.gitignore`, каталоги.
   В глобальном режиме — `.maestro/maestro.json` с auto-derive namespace
   памяти (см. [Как включить память](enable-memory.md)).
3. Запуск фичи: `/maestro-init "ваша задача"`.

Обновление maestro (повторная доставка) — [Обновление maestro](update-maestro.md).

## 🔗 Связанные разделы

- [Обновление maestro](update-maestro.md)
- [Настройка проекта для maestro](../tutorials/setup-project.md)
- [Кастомизация скилла](customize-maestro.md)
- [Конфигурация](../reference/config.md) — 4 слоя `maestro.json`
