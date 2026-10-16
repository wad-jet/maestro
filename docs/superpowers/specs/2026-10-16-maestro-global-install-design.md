# Spec: глобальная установка maestro (скиллы/команды/агенты/плагин + трёхслойный конфиг)

**Дата:** 2026-10-16
**Ветка:** `feature/maestro-global-install`
**Версия:** 4.19.0 → 5.0.0 (**major**: отказ от agpack, wholesale-delivery + трёхслойный конфиг)
**Основание:** пользователь: «вариант глобальной установки и обновления» + уточнения приоритетов трёхслойного конфига (root > .maestro/ > global), размещении maestro.json в `.maestro/` вне git, необходимости не оставлять maestro-файлов в git репозиториях. Полный отказ от agpack.
**auto-ai:** дизайн-вопросы решены decision-диспатчем `opus` (2026-10-15, task `ses_ebffe6558ffe3ztWmwxN8FrAZX`); все решения — high confidence; журнал авто-решений показан на гейте 10.

## 1. Контекст и проблема

### 1.1 Текущее состояние

Сейчас `maestro-install.sh` и `maestro-update.sh` работают **проект-локально через agpack**:
- Скачивают канон `maestro-install/agpack.yml` → создают проектный `agpack.yml`.
- Запускают `agpack sync` → разворачивают скиллы/команды/агенты в проектный `.opencode/`.
- Регистрируют плагин в `.opencode/opencode.json` проекта (флаг `--global` ставит плагин в глобальный конфиг, но скиллы/команды/агенты **всегда** проект-локальны).
- Создают `maestro.json` в корне проекта (через `/maestro-setup`).
- Скачивают `maestro-update.sh` в проект.

Значит: **каждый проект несёт свой `agpack.yml` + зеркало `.opencode/` + `maestro-update.sh`**. Обновлять maestro можно только запустив апдейт-скрипт в каждом проекте отдельно.

### 1.2 Боль

- **N installов на машину:** для N проектов — N запусков `maestro-install.sh`, N апдейтов.
- **Drift:** каждый проект может отстать в версиях скиллов; апдейт забывает очистить кэш плагина в каком-то проекте.
- **Gлобальный плагин ≠ глобальные скиллы:** плагин грузится для всех проектов, но скиллы доступны только в тех, где `.opencode/` есть.
- **Maestro-артефакты в git:** `maestro.json`, `docs/project-context.md`, `regression/`, `docs/superpowers/{specs,plans}` коммитятся как часть проекта. Пользователь хочет «в git проекта не должно быть файлов, связанных с maestro».
- **agpack — лишняя зависимость:** требует python3 ≥ 3.11, uv/pipx, внешнюю установку агpack. Канон `agpack.yml` — это многословное перечисление того, что и так лежит в репозитории целиком.
- **agpack не чистит при переименованиях:** Q8 спеки (docs-drift баг) — lockfile не обеспечивает авто-очистку, несмотря на обещание в документации.
- **agpack.yml коллизионен в глобальном каталоге:** если пользователь держит свой agpack там — скрипт затирает.

### 1.3 Цель

Создать **истинную глобальную установку** maestro, при которой:
- Скиллы/команды/агенты доступны во всех проектах без проектных зеркал.
- Плагин `maestro-bootstrap` регистрируется один раз в глобальном конфиге.
- Обновление — одна команда, обновляет скиллы + плагин на всю машину.
- В git репозиториях проектов не остаётся файлов, связанных с maestro (исключение — опциональный зафиксированный `maestro.json` в корне).
- Полный отказ от agpack: delivery через `git clone` + `cp -R` + manifest (wholesale-copy).
- Версия 5.0.0 — breaking: упрощение за счёт удаления agpack из обоих путей (global и project).

### 1.4 Границы

**В скоуп:**
- Глобальная установка скиллов/команд/агентов через bash + git clone + wholesale copy + manifest.
- Глобальная регистрация плагина в `~/.config/opencode/opencode.json`.
- Трёхслойная конфигурация с приоритетами, определёнными пользователем.
- Проектная установка — тот же bash + git clone + wholesale copy + manifest (agpack удаляется).
- Обновление — `maestro-install.sh --global` / `maestro-install.sh` (project).
- Миграция существующих проектных установок (agpack → manifest).
- Обновление доков и тестов.

**Не в скоуп (anti-goals):**
- Использование системного каталога (`/etc/opencode` / `/Library/Application Support/opencode`) — требует sudo, на всю машину.
- Использование `skills`-массива в `opencode.json` для доставки (приоритет выше проектного — ломает mixed-mode).
- Автообновления без HITL (без подтверждения пользователя).
- Изменение `/maestro-setup` глубже необходимого (только поддержка нового резолва).

## 2. Дизайн-решения

| # | Вопрос | Решение | Обоснование |
|---|---|---|---|
| Q1 | Механизм доставки глобальных скиллов | **Bash + git clone + wholesale copy + manifest**. Полный отказ от agpack. | agpack.yml-канон — это многословное перечисление содержимого репо; wholesale copy (skills/ commands/ agents/ wholesale) заменяет declarative deps. Новый скилл = автоматический deploy. Минус зависимости (python ≥ 3.11, uv/pipx, agpack), минус B'-гимнастика (project_root, relative_to, target_definitions). |
| Q2 | Расположение состояния глобальной установки | `~/.config/opencode/.maestro/` — собственный каталог maestro. | Отдельный каталог для manifest + global maestro.json. Чистая деинсталляция `rm -rf`. Никаких коллизий имён с пользователем. Препятствие (agpack project_root) устранено с уходом agpack. |
| Q3 | Порядок приоритетов конфига | 1. `root/maestro.json` (в git, команда) — **высший** 2. `.maestro/maestro.json` (не в git, личное) 3. `global` (`~/.config/opencode/.maestro/maestro.json`) — низший 4. `MAESTRO_CONFIG` env — replace всего (debug) | Пользователь: «root = зафиксированное в репозитории — самое приоритетное». Улучшает предсказуемость для команд: «что в git — то и действует». |
| Q4 | Семантика мержа слоёв | **v2: рекурсивный мерж объектов, скаляры и массивы — replace целиком**. Для v1 — см. 3.2.1 | Объекты (memory, sanitizer_whitelist, confidential) — рекурсивно (наследуются недостающие поля). Скаляры (communication, feedback_report) — верхний слой побеждает. Массивы (confidential.paths) — replace, не конкат (конкат не позволяет удалить унаследованный путь). |
| Q5 | Можно ли «удалить» унаследованный ключ? | **Нельзя.** Переопределить — можно (явное `false`/`null`). | Для trust/whitelist безопасность: нижний слой не может быть «вырезан» верхним. Это ограничение: проект может задать новое значение, но не «отменить наследование». |
| Q6 | memory.namespace при слоёном конфиге | namespace может быть в любом слое; эффективное — из самого приоритетного. **Глобальный НЕ должен задавать namespace** (один бакет на все проекты — риск cross-project bleed). | namespace = ключ идентичности памяти проекта. Смена namespace = смена бакета (данные не переносятся; есть `memory_migrate`). |
| Q7 | Плагин в не-maestro проектах | Плагин грузится глобально, но в проекте без `maestro.json` (или без резолвнутого конфига) — **детерминированно тихий** (`loadMaestroConfig` → `{}`; memory off, хуки не регистрируются). | Гейт 0 скилла maestro пропускается без конфига. Плагин не мешает. |
| Q8 | Стали/уборка при переименованиях | `--prune` с HITL-листингом удаляемого в апдейте | Manifest хранит список развернутых путей; diff manifest ↔ новый clone показывает stale. |
| Q9 | Рестарт службы при апдейте | Разделить: скиллы/команды — без рестарта (hot-reload верифицирован для команд). Рестарт — только для плагина, HITL с предупреждением «прервёт все проекты». | Рестарт службы прерывает сессии **во всех** проектах. Уменьшаем blast radius. |
| Q10 | Версионная согласованность скиллов↔плагин | `--pin <sha>`: фиксирует плагин на коммит `#<sha>`; clone мастера из того же коммита. | Версионный дрейф скиллов и плагина — источник тонких багов. Один sha = атомарность. |

## 3. Дизайн

### 3.1 Глобальная установка: bash + git clone + wholesale copy + manifest

**Файл состояния:** `~/.config/opencode/.maestro/manifest.json` (создаётся установщиком).

**Принцип:** клонируем репозитории → копируем содержимое wholesale → записываем manifest.

```bash
# Установка (global)
# 1. Блокировка (избегание race conditions)
LOCKFILE="$MAESTRO_STATE/.install.lock"
exec 200>"$LOCKFILE"
flock -n 200 || die "Установка уже запущена (lock-файл $LOCKFILE)"
trap 'rm -f "$LOCKFILE"' EXIT

# 2. Clone (до destructive действий)
git clone --depth 1 maestro "$TMP/m"
git clone --depth 1 superpowers "$TMP/s"

# 3. Collision detection (safe copy)
# Проверка: если пользовательский skill с тем же именем уже существует
for d in "$TMP/m/skills/"*; do
  name=$(basename "$d")
  if [ -d "$TARGET/skills/$name" ] && ! ls "$TARGET/skills/$name"/.maestro-deployed 2>/dev/null; then
    warn "найдён пользовательский skill '$name' — заменит мастер-версию"
  fi
done

# 4. Copy (atomic — через temp-dir)
mkdir -p "$TARGET/.deploy-staging"
cp -R "$TMP/m/skills/"* "$TARGET/.deploy-staging/skills/"
cp -R "$TMP/m/commands/"* "$TARGET/.deploy-staging/commands/"
cp -R "$TMP/m/agents/"*   "$TARGET/.deploy-staging/agents/"
cp -R "$TMP/s/skills/"*   "$TARGET/.deploy-staging/skills/"
# Move staging → target (atomic rename)
for dir in skills commands agents; do
  rm -rf "$TARGET/$dir"
  mv "$TARGET/.deploy-staging/$dir" "$TARGET/$dir"
done
rmdir "$TARGET/.deploy-staging"

# 5. Write manifest atomically
echo "$NEW_SHA_M $NEW_SHA_S" > "$STATE_DIR/manifest.json.tmp"
mv "$STATE_DIR/manifest.json.tmp" "$STATE_DIR/manifest.json"
```

**Надёжность (reliability guarantees):**
- **Блокировка:** lock-файл `~/.config/opencode/.maestro/.install.lock` + `flock`. Конкурентные запуски блокируются; если lock stale (>30 мин) — игнорируется с warning.
- **Clone-first:** clone выполняется **до** любых destructive действий (удаление файлов, de-dup плагина). Если clone падает — система в оригинальном состоянии.
- **Атомарная запись manifest:** временный файл + `mv` (atomic на same-filesystem).
- **Staging для copy:** все файлы копируются в `.deploy-staging/`, затем `mv` в target. Частичный install невозможен.
- **Collision detection:** перед копированием сканируются целевые каталоги — если найден не наш skill (нет маркера `.maestro-deployed`) — HITL warning. Пользователь подтверждает overwrite/rename/skip.
- **Trap cleanup:** при прерывании (`trap EXIT`) — удаление temp-файлов и staging-каталога.

**Установка (единый скрипт):**
```bash
# Глобальная установка
bash maestro-install.sh --global    # clone + staging-cp + manifest + plugin reg + global maestro.json
bash maestro-install.sh --global --pin <sha>  # с пиннингом
bash maestro-install.sh --global --dry-run      # без изменений, показывает план
bash maestro-install.sh --help      # справка

# Флаг --project (default, явный): проектная установка (аналогично, в .opencode/)
bash maestro-install.sh --project
bash maestro-install.sh --project --dry-run
```

Скрипт `maestro-install.sh` (один скрипт, два режима):
1. Preflight (git, bash, curl/wget — **python ≥ 3.11 не нужен** для delivery, только для JSON-reg плагина — любой python3).
2. **--dry-run:** клонирует и показывает diff между текущим и новым состоянием. Без изменений на диск.
3. Блокировка `flock`.
4. Clone maestro + superpowers из репо (shallow). Fail-fast: если clone не удался — abort, никаких изменений.
5. **--project** (default): staging-cp → `.opencode/{skills,commands,agents}/` + manifest + plugin reg в `.opencode/opencode.json`.
6. **--global:** staging-cp → `~/.config/opencode/{skills,commands,agents}/` + manifest в `~/.config/opencode/.maestro/manifest.json` + plugin reg в глобальный `opencode.json` + создаёт глобальный `maestro.json`.
7. Выводит итоговую инструкцию.

**Проверка коллизии:** если `.maestro/` уже существует и не наш (manifest с другим sha) — warning; если в целевом каталоге есть user's own skills (нет маркера `.maestro-deployed`) — collision detection → HITL warning с вариантами (overwrite/rename/skip).

**Создание opencode.json:** если глобальный `opencode.json` отсутствует — создаётся с `{"plugins": []}` перед de-dup. Создание атомарное (write to tmp + mv).

### 3.2 Трёхслойный конфиг

#### 3.2.1 Резолв

Цепочка, от высшего к низшему приоритету:

```
1. MAESTRO_CONFIG (env)       — полный override (replace всего, debug)
2. <project>/maestro.json     — командная фиксация (в git)
3. <project>/.maestro/maestro.json — локальные дополнения (не в git)
4. ~/.config/opencode/.maestro/maestro.json — глобальные дефолты
5. {} (нет конфига → проект не под maestro)
```

Первая найденная точка выигрывает — один активный файл за сессию. (Если все три слоя присутствуют — используется layer 2; 3 и 4 игнорируются. См. Q4: это replace-семантика, не мерж на уровне файлов.)

**Определение активного файла:**
```js
// pseudo-code для резолва в loadMaestroConfig
function resolveConfigFile(root) {
  if (process.env.MAESTRO_CONFIG) return process.env.MAESTRO_CONFIG;  // debug override
  const rootConfig = path.join(root, "maestro.json");
  if (fs.existsSync(rootConfig)) return rootConfig;  // root выигрывает
  const localConfig = path.join(root, ".maestro", "maestro.json");
  if (fs.existsSync(localConfig)) return localConfig;  // local fallback
  const globalConfig = path.join(resolveGlobalDir(), "maestro.json");
  if (fs.existsSync(globalConfig)) return globalConfig;  // global fallback
  return null;  // нет конфига
}
```

**Механика мержа слоёв (v1 — hybrid):**

v1 использует **частичный мерж**:
- **Non-memory ключи** (`communication`, `feedback_report`, `trust`, `sanitizer_whitelist`, `confidential.paths`): **replace (один активный файл)**. Если root/maestro.json активен — он победил. Если нет — .maestro/, если нет — global. Если нет вообще — пустой конфиг.
- **Memory ключи** (`memory.*`): **soft-merge cross-layer**. Global слой задаёт `memory.enabled` и `memory.embedding.*` (базовые значения). Project слой (root/.maestro/) задаёт `memory.namespace`. Если project config не упоминает `memory` — global memory settings применяются. Если project config устанавливает `memory.enabled: false` — memory отключается (override global).

**MAESTRO_CONFIG env override:** если `MAESTRO_CONFIG` установлен, его путь используется **без проверки других файлов** — полный replace всего. Не искать root/.maestro/ или global. Используется только для отладки.

**Порядок приоритетов (не-env):** `MAESTRO_CONFIG` > root > .maestro/ > global (env всегда переопределяет). Для non-env: первый существующий файл по порядку root → .maestro/ → global выигрывает.

```
Effective config = {
  // Replace: из самого приоритетного активного файла
  "communication":      root?.communication || .maestro?.communication || global?.communication || undefined,
  "feedback_report":    root?.feedback_report || .maestro?.feedback_report || global?.feedback_report || "manual",
  "trust":              root?.trust || .maestro?.trust || {},  // per-project only

  // Soft-merge memory: global.base + project.namespace
  "memory": {
    "enabled":          project?.memory?.enabled ?? global?.memory?.enabled ?? false,
    "embedding":        { "model": global?.memory?.embedding?.model ?? "Xenova/paraphrase-multilingual-MiniLM-L12-v2" },
    "namespace":        project?.memory?.namespace ?? null
  }
}
```

**Важно:**
- `communication` — **не** в global дефолте (v1). Проект создаёт root/maestro.json только если хочет override.
- `feedback_report` — global дефолт: `"manual"` (не auto). Проекты могут опционально включить `"auto"`.
- `trust`, `sanitizer_whitelist`, `confidential.paths` — **пер-проект только**, не наследуются из global.
- **Parse error fallback:** если root/maestro.json существует но содержит невалидный JSON → warning в лог, fallback к .maestro/, затем к global. Если все слои сломаны — empty config `{}` с warning.

> **Решение:** v1 — hybrid. Non-memory keys = replace (один файл). Memory keys = soft-merge (global.base + project.namespace). Полный layer merge → v2.

#### 3.2.2 Глобальный дефолт: `~/.config/opencode/.maestro/maestro.json`

Создаётся **`maestro-install.sh --global`** при первом запуске. Содержит:
```json
{
  "memory": {
    "enabled": false,
    "embedding": { "model": "Xenova/paraphrase-multilingual-MiniLM-L12-v2" }
  }
}
```

> **Решение (I1 из opus-ревью):** global по умолчанию `enabled: false` — privacy-safe: память не включается автоматически во всех проектах. Пользователь включает через `/maestro-setup` per-project. Если пользователь хочет глобальное включение — редактирует глобальный конфиг вручную (или скрипт `--memory-enable` future).

**Не содержит:**
- `namespace` (см. Q6 — один глобальный namespace = один бакет на все проекты = cross-project bleed)
- `communication` (пер-проектное решение, не глобальный дефолт)
- `feedback_report` (пер-проектное решение, глобальный дефолт `"manual"`)
- `trust`, `sanitizer_whitelist` (per-project только)
- `confidential.paths` (masquer должен добавлять active config path, см. 4.2)

#### 3.2.3 Локальный: `<project>/.maestro/maestro.json`

Создаётся `/maestro-setup` при глобальной установке. Содержит:
```json
{
  "memory": {
    "enabled": true,
    "namespace": "app.shop"
  }
}
```

Namespace auto-derive: если `.maestro/maestro.json` отсутствует, но проект в git — namespace генерируется автоматически. **Приоритет:** явное значение в конфиге > auto-derive.

**Где живёт auto-derive (архитектурное решение):** auto-derive реализуется в `/maestro-setup` (skill). При первом запуске `/maestro-setup` вычисляет namespace из git remote и **записывает его в `.maestro/maestro.json`**. Namespace сохраняется стабильно при смене git remote (пользователь может пересчитать через `/maestro-setup --derive-namespace`). Если namespace уже задан явно — не перезаписывает. Runtime auto-derive (в памяти плагина) не используется — namespace стабилен, не меняется при форке/переименовании remote.

> Это решает противоречие G1 vs O2: G1 «global только → memory disabled (enabled=false global, проект не включил memory)» корректен, т.к. `/maestro-setup` — единственный источник namespace. При ручном глобальном `enabled: true` без проектного конфига — `namespace_missing`, /maestro-setup исправляет.

**Правило авто-derive (3 сегмента через точку):**

1. **Git-remote based (вариант A):** если есть `git remote get-url origin`:
   - Parse URL (поддержка SSH, HTTPS, ssh://, GitLab, Bitbucket — все через `https://` URL):
     - `git@github.com:org/repo.git` → domain=`github.com`, owner=`org`, repo=`repo`
     - `https://github.com/org/repo.git` → domain=`github.com`, owner=`org`, repo=`repo`
     - `ssh://git@github.com/org/repo.git` → domain=`github.com`, owner=`org`, repo=`repo`
     - `https://gitlab.com/group/subgroup/repo.git` → domain=`gitlab.com`, owner=`group`, repo=`repo` (nested group: owner = первая группа в path, lost subgroups ignored → handled by monorepo fallback)
   - Сегменты: `domain_without_tld` (github.com → github) → `owner` → `repo`
   - lowercased, normalize (`trim`, `lowercase`, squeeze `.`)
   - Пример: `git@github.com:wad-jet/shop-frontend.git` → `github.wad-jet.shop-frontend`

2. **Monorepo fallback:** если project dir ≠ git root (проект в подкаталоге репо) — **домен выбрасывается**, схема `owner.repo.segment`:
   - `/workspace/backend` из `github:org/repo` → `org.repo.backend`
   - `/workspace/frontend` из `github:org/repo` → `org.repo.frontend`
   - Relative path = dirname относительно git root (или basename проекта если в корне репо)
   - **Триггер:** `dirname(project_dir, git_root)` не пустой
   - Формат остаётся в 3 сегментах (соответствует memory-модулю: 1–3 сегмента)

3. **Fallback (вариант C):** если git remote нет или не git URL:
   - `parent_dir.project_dir.local` (где local = fallback маркер)
   - Пример: `~/workspace/my-app/` → `workspace.my-app.local`

4. **Normalisation:**
   - `<3 сегментов` → pad: `"workspace"`, `"unknown"`
   - `>3 сегментов` → truncate до первых 3 (приоритет: domain.owner.repo)
   - Пустой → `"workspace.unknown.unknown"`

5. **Validation (auto-derive output):**
   - Только lowercase alphanumeric, dots, hyphens
   - No consecutive dots, no leading/trailing dots
   - No empty segments
   - Если невалиден → fallback на `"workspace.unknown.unknown"`

6. **Edge cases:**
   - **Self-hosted single-component** (например `git@gitlab.internal:project.git`): domain=`gitlab.internal` → первый лейбл `gitlab` (тот же принцип, что `github.com` → `github`: отбрасывается последний лейбл), owner=`unknown` (нет owner в URL), repo=`project` → `gitlab.unknown.project` (3 сегмента; `gitlab.internal.unknown.project` было бы 4 — невалидно по формату 1–3 сегмента)
   - **Non-standard SSH** (`git@github.com:owner/repo.git` with no `.git`): strip trailing path segments identically
   - **Empty remote URL**: fallback to C (path-based)

#### 3.2.4 Root: `<project>/maestro.json` (в git)

Создаётся `/maestro-setup` для проектов, где команда хочет зафиксировать настройки в репозитории. Содержит полное определение конфига (или минимальное — для проекта, где нет глобального конфига). При наличии глобального конфига — root может быть минимальным (только уникальные для проекта ключи), т.к. v1 использует replace-семантику.

### 3.3 Плагин: глобальная регистрация

**Файл:** `~/.config/opencode/opencode.json`.

```json
{
  "plugins": [
    "maestro-bootstrap@git+https://github.com/wad-jet/maestro.git"
  ]
}
```

Глобальная регистрация плагина означает:
- Плагин грузится для **каждого** проекта при запуске opencode.
- В проекте без конфига → `loadMaestroConfig` → `{}` → плагин тихий (memory off, хуки не регистрируются).
- `.maestro/plugin-version` и `.maestro/logs/` пишутся в root проекта (уже так: `core.js:534-540,678`).
- Аудит-лог — per-project (`.maestro/logs/maestro-bootstrap-<date>.log`).

**Дедуп регистрации (R1):** при глобальной установке/апдейте плагин регистрируется в `~/.config/opencode/opencode.json`. Если в проекте есть локальная регистрация (`plugins: ["maestro-bootstrap@..."]` в `.opencode/opencode.json`), она создаст **duplicate plugin ID** (OpenCode V2: "Duplicate plugin ID" toast).

**Детали de-dup (idempotent, без потери чужих записей):**
1. `maestro-install.sh --global`: удаляет все `is_ours()` записи из **глобального** `opencode.json` → добавляет одну каноническую.
2. `maestro-update.sh --global`: аналогично — чистит глобальный конфиг.
3. **Проектный конфликт (миграция):** если в проекте есть `.opencode/opencode.json` с `is_ours()` записью — плагин грузится дважды (global + project). Митигация: при запуске `/maestro-setup` (глобальный режим) — check: если в `.opencode/opencode.json` есть `is_ours()` → warning + auto-remove (HITL). В v1 — только warning + инструкция. В v2 — auto-removal.

### 3.4 Глобальное обновление: `maestro-update.sh --global`

**Файл:** `maestro-update.sh` — один скрипт, два режима (`--project` default, `--global`).

```bash
# Проектное обновление (по умолчанию)
bash maestro-update.sh             # self-check → clone → staging-cp → manifest → prune HITL → cache clean → pin

# Глобальное обновление
bash maestro-update.sh --global    # self-check + clone → staging-cp → manifest → prune HITL → cache clean → global plugin re-register
bash maestro-update.sh --global --pin <sha>   # с пиннингом версии
bash maestro-update.sh --global --prune         # HITL-листинг stale-компонентов для удаления
bash maestro-update.sh --global --dry-run       # preview без изменений
```

**Различия режимов внутри одного скрипта:**

| Действие | --project | --global |
|---|---|---|
| Self-update check | ✅ (HITL, скачивается из того же коммита) | ✅ (скачивается из того же коммита для проверки) |
| Clone-first | ✅ (перед любыми destructive) | ✅ (перед любыми destructive) |
| Deployment target | `.opencode/` (default) | `~/.config/opencode/` |
| Update механизм | clone → staging-cp → manifest diff → mv | clone → staging-cp → manifest diff → mv |
| `--prune` HITL | ❌ | ✅ JSON-list → prompt |
| Plugin cache clean | ✅ | ✅ |
| Plugin registration | в project/global opencode.json | в global opencode.json |
| Service restart | "перезапустите вручную" | **HITL: "прервёт все проекты"** |
| `--pin` | ✅ | ✅ |
| `--dry-run` | ✅ | ✅ |
| `--prune` | ✅ | ✅ | JSON-list format для HITL |
| `--deinstall` | ✅ | ✅ | Опция: `--preserve <file,...>` whitelist |

**Последовательность `--global` (с гарантиями надёжности):**
1. Preflight (git, bash, curl/wget — **agpack не нужен**).
2. **Permission check:** проверка `EACCES` для целевого каталога; если read-only → abort с подсказкой об `XDG_CONFIG_HOME`.
3. Self-check (global): скачивается `maestro-update.sh` из того же коммита целевой версии, сравнивается с текущим. Расхождение → HITL самообновление.
4. Clone maestro + superpowers из репо. Fail-fast: если clone не удался — abort, никаких изменений.
5. Staging copy: `cp -R` в `.deploy-staging/`.
6. Manifest diff: старый manifest ↔ новый sha → `--prune` HITL listing (JSON format: `[{path, reason}, ...]`).
7. Atomic move: `mv .deploy-staging/* target/`.
8. Обновление manifest (temp + mv).
9. Очистка кэша плагина `~/.cache/opencode/npm/git-maestro-*` + legacy `packages/`.
10. Плагин ре-регистрируется в `~/.config/opencode/opencode.json` (idempotent).
11. HITL-рестарт службы opencode с текстом «прервёт все проекты».
12. Вывод: целевая версия, статус, smoke-чеклист.

**`--pin <sha>`:** фиксирует плагин на коммит `#<sha>`. Атомарность: clone мастера из того же коммита (тот sha = плагин и скиллы).

**`--prune` format:** JSON-list: `[{"path": "skills/maestro-old", "reason": "removed_from_repo"}, {"path": "commands/cmd-renamed", "reason": "renamed_to_cmd-new"}]`. Prompt: "Удалить X stale компонентов? (y/N)".

**XDG fallback:** `resolveGlobalDir()` проверяет `$XDG_CONFIG_HOME`; если путь не существует или read-only → fallback на `$HOME/.config` + warning.

### 3.5 Миграция: agpack → manifest

**Автоматическая миграция (`--migrate` в install/update):**

1. `maestro-install.sh --global --migrate` (или `--project --migrate`).
2. Detects: agpack.yml в проекте → warning.
3. Clones maestro/superpowers → staging-cp → write manifest.
4. Записывает `.maestro/maestro.json` с `memory: { enabled: true, namespace: <auto-derive из git remote> }`.
5. Регистрирует плагин глобально (для global mode).
6. Удаляет agpack.yml и .agpack.lock.yml в проекте (HITL). Если read-only → warn + suggest `chmod` + continue.
7. Удаляет дубликат плагина из проектного opencode.json (HITL).
8. Перезапуск службы opencode.

**Ручной чек-лист (fallback):**
1. Запустить `maestro-install.sh --global` — развёртывает global скиллы/команды/агенты + плагин.
2. В каждом проекте: удалить `agpack.yml` + `.agpack.lock.yml` (если read-only — `chmod +w` или вручную).
3. В каждом проекте: проверить, нет ли `maestro-bootstrap` в `.opencode/opencode.json` plugins — если есть, удалить дубликат.
4. В каждом проекте: проверить, нет ли `.opencode/skills/maestro*`, `.opencode/commands/`, `.opencode/agents/` — если есть, удалить.
5. `/maestro-setup` — создаёт `.maestro/maestro.json` с auto-derive namespace из git remote.
6. Перезапуск службы opencode → проверить версию (`/maestro-version`).

### 3.6 Взаимодействие с `/maestro-setup`

В глобальном режиме `/maestro-setup`:
1. Создаёт `.maestro/` (если нет) + `.gitignore` entry `.maestro/` (если нет).
2. Создаёт `.maestro/maestro.json` с `memory: { enabled: true, namespace: <auto-derive> }`. Auto-derive: Вариант A из git remote (domain.owner.repo), fallback C (parent_dir.project_dir.local), pad/truncate до 3 сегментов. Если namespace уже задан в root/maestro.json — не перезаписывает.
3. Опционально: создаёт root `maestro.json` — только если пользователь просит «зафиксировать в репозитории». В глобальном режиме по умолчанию — root-файл не создаётся.
4. Не создаёт `.opencode/` зеркало (скиллы глобальные).
5. Не создаёт `agpack.yml` (agpack удалён полностью).
6. Модели агентов (`agent.custodian.model` и т.д.) — задаются глобально в `~/.config/opencode/opencode.json`; per-project override — осознанный след (файл в проекте).

### 3.7 Взаимодействие с `/maestro-init` (Gate 0)

**Изменение:** «проект под maestro» теперь = «резолвер нашёл конфиг в любом из слоёв» (любой: root, `.maestro/`, global, MAESTRO_CONFIG).

**Если конфига нет:** Гейт 0 пропускается → работаем как обычно (fail-closed для confidential). Пайплайн не запускается как maestro-пайплайн — пользователь видит message: «`maestro.json` отсутствует; запустите `/maestro-setup` для настройки».

**Если есть только глобальный (без root/.maestro/):** maestro.json есть → Гейт 0 проходит. Но без namespace → memory disabled с причиной `namespace_missing`.

### 3.8 Деинсталляция глобальной установки

**Цель:** полное удаление глобальной установки, восстановление до состояния «было до установки».

```bash
# 1. Удалить состояние maestro
rm -rf ~/.config/opencode/.maestro/

# 2. Удалить скиллы/команды/агенты (только maestro-каталоги)
rm -rf ~/.config/opencode/skills/maestro* ~/.config/opencode/skills/superpowers
rm -rf ~/.config/opencode/commands ~/.config/opencode/agents

# 3. Удалить плагин из global opencode.json
# В секции "plugins" массива — удалить запись maestro-bootstrap@git+...
# Пример: npx -y json -I -f ~/.config/opencode/opencode.json \
#   -e '.plugins = this.plugins.filter(p => !p.includes("wad-jet/maestro"))'

# 4. Перезапустить opencode
opencode service restart
```

> **Примечание 1:** если пользователь держит свои скиллы в `~/.config/opencode/skills/` — они затронуты п.2 (glob `maestro*` и `superpowers`). Перед деинсталляцией сделать backup `~/.config/opencode/skills/` и восстановить после.
>
> **Примечание 2:** деинсталляция требует HITL-подтверждения списка удаляемых директорий. Опция `--preserve` позволяет добавить whitelist директорий (например, `--preserve my-custom-skill`), которые будут пропущены.
>
> **Примечание 3:** агpack удалён полностью — `agpack.yml`, `.agpack.lock.yml`, `uv tool uninstall agpack` — не требуются.
>
> **Примечание 4:** проектные скрипты `maestro-install.sh` / `maestro-update.sh` не удаляются — они в git проекта или в рабочей директории.

## 4. Безопасность (SECURITY.md)

### 4.1 Trust boundary

Глобальный каталог `~/.config/opencode/.maestro/` и каталог `~/.config/opencode/` — **точки доверия для всех проектов машины**. Компрометация (скрипт, подмена файла, баг в репо) влияет на все проекты.

**Митигация:**
- Никаких auto-updates без HITL (self-check-гейт a/b/c уже есть).
- Опция `--pin` по умолчанию для paranoid-режима.
- Документировать как trust boundary в SECURITY.md: `SECURITY.md` получает раздел 4.8+ (Global Installation Trust).
- `maestro.json` в глобальном режиме — в `.maestro/` или global, **не в репозитории проекта**.

### 4.2 Confidential/masker (дополнительное требование)

Сегодня builtin-паттерны (`core.js:302`): `.env`, `.env.*`, `*.pem`, `*.key`, `*.crt`, `*.p12`, `*.pfx`. `maestro.json` и `.maestro/**` каждый проект дописывает в `confidential.paths` сам.

**При глобальной установке:**
- Активный конфиг-файл (любой из слоёв) должен **автоматически** попадать в confidential-маскировку плагина.
- Глобальный конфиг (`~/.config/opencode/.maestro/maestro.json`) лежит вне проекта → не покрывается repo-relative glob'ами. Нужен fallback: если активный конфиг вне проекта — добавить его абсолютный путь в masker.
- `.maestro/` (внутри проекта) может покрываться `**/.maestro/**` паттерном — нужно добавить в builtin или через секцию `confidential.paths` в глобальном конфиге.

**Решение для спеки:** `core.js` при инициализации плагина резолвит активный конфиг через `resolveConfigFile(root)` и добавляет его путь в sanitizer-проверку. Для глобального конфига (вне проекта) — проверяет `isMaestroConfigPath(path, activeConfigPath)`, где `activeConfigPath` — путь к резолвнутому конфигу (любой слой). Это отдельная проверка пути, не через glob: `isMaestroConfigPath` сравнивает `path` с `activeConfigPath` (полное совпадение) и с директорией `.maestro/` (префикс).

### 4.3 Shell-блоки команд

Глобальные команды (`.config/opencode/commands/`) — доверенные шаблоны с shell-блоками, исполняемые вне permission-флоу агента. Распространение глобальных команд увеличивает blast radius shell-блоков на всю машину.

**Митигация:** в спеке — документировать это ограничение; в будущих версиях — опциональный guard на shell-блоки в глобальных командах (не для v1).

### 4.4 SEC-требования (итог)

| Требование | Статус |
|---|---|
| P1–P3: шифрование, доступ к данным | Не меняются (memory уже глобальная, XDG data) |
| P4: audit-логи, `.maestro/logs/` | Не меняются (per-project) |
| P5: `maestro-bootstrap` обязателен | ✅ Глобально зарегистрирован |
| P6: `maestro.json` защищён | Расширяется: активный конфиг + `.maestro/**` в masker |
| P9: merge-guard | Не меняется (требует `maestro.json`, резолв поддержан) |

## 5. Верификационный чек-лист (до реализации)

**Порядок обязателен: V1 — блокер всего дизайна. Если V1 не проходит — план останавливается, не продолжается дальше.**

| # | Чек | Где проверять |
|---|---|---|
| V1 | ⚑ **БЛОКЕР**: OpenCode V2 загружает `~/.config/opencode/commands/` и `agents/` (не только skills) | Запуск `opencode --standalone` с файлами в этих каталогах |
| V2 | Hot-reload: скиллы/агенты перезагружаются без рестарта службы | Изменение файла в `~/.config/opencode/skills/` во время сессии |
| V3 | `opencode plugin update` поддерживает `alias@git+https://...` формат | `opencode plugin check --global` с maestro-плагом |
| V4 | XDG_CONFIG_HOME у OpenCode: глобальный каталог = `$XDG_CONFIG_HOME/opencode` или `~/.config/opencode` | Запуск с `XDG_CONFIG_HOME=/custom opencode` |
| V5 | Агенты: порядок мержа file-агентов vs JSON-агентов (global vs project) | Два агента с одинаковым ID в global и project |
| V6 | Живой прогон: clone → cp → manifest → prune → cleanup | `bash maestro-update.sh --global --prune` |
| V7 | Гибридная семантика конфига: non-memory replace (один файл) + memory soft-merge (global+project) + parse-error fallback | Тест `resolveConfigFile` + `loadMaestroConfig` с тремя файлами на диске |
| V8 | Блокировка: concurrent installs serialized, stale lock cleanup | Запуск двух инсталляций; вторая блокируется, stale lock (30 мин) — warning |
| V9 | Атомарная запись manifest: temp file + mv; partial install не ломает state | Убить скрипт после cp, но до manifest write; повторный запуск восстанавливает |
| V10 | Collision detection: user skill not overwritten silently | Создать `~/.config/opencode/skills/my-skill/` без `.maestro-deployed`; install должен warn + HITL |
| V11 | XDG fallback: XDG_CONFIG_HOME non-writable → fallback + warning | Set XDG to readonly dir; installer falls back to $HOME/.config |
| V12 | --dry-run: показывает план без изменений | `bash maestro-install.sh --global --dry-run` — clone + diff, 0 мутаций на диск |
| V13 | Parse error fallback: broken root → .maestro/ → global | Создать root/maestro.json с `{invalid`; verify fallback to lower layers |
| V14 | Memory soft-merge: global.enabled + project.namespace | Global: `memory.enabled: true, memory.embedding.model: "..."`; Project: `memory.namespace: "..."` → effective: both keys present |
| V15 | SSH/HTTPS URL parsing: git@github.com: vs https://github.com/ | Test: `git@github.com:a/b.git` → `github.a.b`; `https://gitlab.com/g/s/r.git` → `gitlab.g.r` (nested group: owner = первая группа в path, repo = ПОСЛЕДНИЙ сегмент, по канону §3.2.3) |
| V16 | Monorepo namespace: same repo, different projects | Two projects in same repo get different namespaces via relative path segment |
| V17 | Invalid namespace auto-derive → fallback | Parse produces dots/consecutive → falls back to `workspace.unknown.unknown` |
| V18 | **macOS flock fallback:** `mkdir`-lock вместо `flock`; stale lock (30 мин) — warning | Запуск двух инсталляций на macOS; вторая блокируется |
| V19 | **Deinstall —preserve whitelist:** удаляет .maestro/* кроме whitelist | `bash maestro-install.sh --deinstall --preserve maestro.json` — конфиг сохранён, остальное удалено |
| V20 | **Migration read-only agpack:** chmod -w agpack.yml → warn + continue + cleanup | Создать agpack.yml read-only; запустить `--migrate` — warn HITL, continue |
| V21 | **Self-check global:** скачивает update script из того же коммита, сравнивает хеш | Двухкоммитное состояние; self-check detect расхождение → HITL auto-update |
| V22 | **https-only clone:** URL начинается с https://, http rejected | Попытка clone с http:// URL — abort |
| V23 | **Global enabled: true + no project config:** soft-merge даёт enabled=true, namespace=null → `namespace_missing`; /maestro-setup → namespace auto-derive → memory works | Вручную включить global `enabled: true`; запустить без .maestro/ → reason=`namespace_missing`; затем /maestro-setup → memory работает |
**Важные имплемент-детали (не для UX, но критичны для кода):**
- **XDG_CONFIG_HOME:** все пути к глобальному каталогу должны резолвиться через единую функцию `resolveGlobalDir() = process.env.XDG_CONFIG_HOME || path.join(homedir(), ".config")`. Нигде не хардкодить `~/.config/`.
- **resolveConfigFile(root, globalDir?):** принимает `root` (project dir) и опционально `globalDir`. Если `globalDir` не передан — использует `resolveGlobalDir()`.
- **Plugin de-dup:** `is_ours(e)` проверяет, что entry начинается с `PLUGIN_SPEC` или `git+https://github.com/wad-jet/maestro.git`. Де-дуп — filter + append в обеих конфигурациях (global + project).
- **Wholesale copy:** копируем ВСЁ содержимое `skills/`, `commands/`, `agents/` из репо. Нет list/whitelist — инвариант выполняется вакуумно. Новый скилл = auto-deploy.
- **Collision marker:** каждый деплоенный каталог содержит маркер `.maestro-deployed` (empty file). Collision detection проверяет все три целевых каталога: `skills/`, `commands/`, `agents/`. Если пользовательский скилл/команда/агент имеет маркер — HITL: пропустить, rename (suffix `-user-`), или overwrite (только с явного разрешения).
- **Config layering v1 (hybrid):** non-memory keys = replace (один файл); memory.* = soft-merge (global.memory.* + project.namespace). Parse error fallback: broken root → .maestro/ → global → `{}`. Global не содержит: namespace, communication, feedback_report (по умолчанию "manual"), trust, sanitizer_whitelist.

## 6. Открытые вопросы (не блокирующие, но требующие решения в спеке)

| # | Вопрос | Варианты | Влияние |
|---|---|---|---|
| O1 | **Superpowers в глобальной раскатке?** | **Включать по умолчанию (все 15 скиллов)** | wholesale copy из superpowers → все скиллы. Закрываем как решённый вопрос. Определяет контекстное загрязнение всех проектов; Superpowers «use when starting any conversation» может быть шумным в не-maestro проектах. |
| O2 | **Auto-derive namespace для проектов без `.maestro/maestro.json`?** | **Решено: auto-derive v1 — Вариант A (git-based) + fallback C.** Если нет git → `parent_dir.project_dir.local`. 3 сегмента, pad/truncate до 3. Override в конфиге > auto-derive. | Без namespace memory disabled с `namespace_missing`. Auto-derive решает это: namespace из git remote (`github.wad-jet.shop-frontend`), fallback — из path проекта. Пользователь может override явно. |
| O3 | **Пиннинг по умолчанию?** | **Решено: `latest` по умолчанию** (как сейчас), `--pin <sha>` — опция | Security vs UX. При pin-по-умолчанию — пользователи с `latest` пишут `maestro-update.sh --pin latest`. |

## 7. Негативные требования (не делать)

- **НЕ** доставлять скиллы через `skills`-массив `opencode.json` (приоритет выше проектного — сломает mixed-mode).
- **НЕ** писать в системный каталог; **НЕ** требовать sudo.
- **НЕ** использовать agpack (удалён полностью).
- **НЕ** трогать `~/.config/agpack/agpack.yml` пользователя (нет agpack).
- **НЕ** автоматизировать удаление/замену конфигов без HITL-подтверждения; **НЕ** silent self-update.
- **НЕ** использовать full layer merge в v1 (только hybrid: non-memory replace, memory soft-merge). Полный merge слоёв → v2.
- **НЕ** использовать `cp -R` без collision detection — пользовательский скилл может быть перезаписан без предупреждения.
- **НЕ** использовать `MAESTRO_CONFIG` env в CI/automation (security boundary — полностью заменяет все слои конфига).

## 8. Список изменений в существующих файлах

### Файлы для изменения (плагин):

| Файл | Изменение |
|---|---|
| `plugins/maestro-bootstrap/core.js` | `loadMaestroConfig`: новый резолв 4 слоёв. `resolveConfigFile`: поддержка root > .maestro/ > global. Добавить `isMaestroConfigPath` в masker. Добавить `confidential.paths` auto-включение активного конфига. |
| `plugins/maestro-bootstrap/core.js` | `maestro_config`-тул: показывать `path` активного конфига (как есть, без изменений). |
| `plugins/maestro-bootstrap/memory/config.js` | Проверить резолв namespace (берётся из parsed maestro.json — не меняется). |
| `plugins/maestro-bootstrap/backup-cli.js` | Синхронизировать резолв с `loadMaestroConfig` (сейчас `join(root, "maestro.json")` — игнорирует env и global). |
| `plugins/maestro-bootstrap/README.md` | Обновить секции install, MAESTRO_CONFIG, maestro.json locations. |

### Файлы для изменения (scripts):

| Файл | Изменение |
|---|---|
| `maestro-install.sh` | **Перенос из корня в `maestro-install/`**. Удалить agpack-preflight (~45 строк). Добавить `--global` режим: clone + cp wholesale + manifest + plugin reg. |
| `maestro-update.sh` | **Перенос из корня в `maestro-install/`**. Удалить merge-add Python-блок (~100 строк), agpack sync. Добавить `--global` режим: clone + manifest diff + cp wholesale. |
| `maestro-install/agpack.yml` | **Удалить** (agpack удалён полностью). |

### Файлы для удаления:

| Файл | Причина |
|---|---|
| `maestro-install/agpack.yml` | agpack удалён, канон больше не нужен (wholesale copy заменяет). |
| `maestro-install/agpack-coverage.test.mjs` | Инвариант «все скиллы в репо деплоятся» выполняется вакуумно — список не нужен, тест не нужен. |

### how-to: структура обновлений

Существующие how-to файлы получают **Вариант A** — глобальный путь (agpack больше не упомянут).

**`manual_docs/how-to/install-maestro.md`** — Вариант A заменяет Вариант B (проектный):

> **Вариант A — глобальная установка (рекомендуется)**
>
> Одна команда раскатывает скиллы/команды/агенты и плагин на всю машину. Скиллы доступны во всех проектах без `.opencode/` зеркала. В git проекта не попадает ни одного maestro-файла.
>
> ```bash
> curl -fsSL https://raw.githubusercontent.com/wad-jet/maestro/main/maestro-install.sh -o maestro-install.sh
> bash maestro-install.sh --global    # опции: --help, --migrate
> ```
>
> Предусловия: bash (macOS/Linux), git, curl/wget, python3 (любой версии — для JSON-регистрации плагина).
> После — перезапустить OpenCode и выполнить `/maestro-setup` (auto-derive namespace из git remote, память включается per-project).
>
> **Обновление** после установки — `maestro-update.sh --global` (см. Обновление maestro).

**`manual_docs/how-to/update-maestro.md`** — Обновление:

> **Глобальное обновление**
>
> Одна команда обновляет скиллы/команды/агенты и плагин на всю машину.
>
> ```bash
> bash maestro-update.sh --global              # опции: --pin <sha>, --prune, --help
> ```
>
> Последовательность: определение версии → clone → manifest diff → prune HITL → wholesale copy → очистка кэша плагина → HITL-рестарт службы (с предупреждением о влиянии на все проекты).
> После — перезапустить OpenCode и выполнить `/maestro-version` для контроля.

> **Проектное обновление** (legacy — для тех, кто держит agpack в своих проектах)
>
> ```bash
> bash maestro-update.sh              # опции: --pin <sha>, --help
> ```
> Последовательность: self-check → clone → manifest diff → prune HITL → wholesale copy → cache clean.
> После — перезапустить OpenCode и выполнить `/maestro-version`.

### Файлы для обновления (доки) — полный список

**How-to (2 файла):**
| Файл | Изменение |
|---|---|
| `how-to/install-maestro.md` | Вариант A — глобальная установка без agpack. Ссылка на `maestro-install.sh --global`. |
| `how-to/update-maestro.md` | Глобальное обновление без agpack. Ссылка на `maestro-update.sh --global`. |

**Справочник (3 файла):**
| Файл | Изменение |
|---|---|
| `reference/config.md` | Config locations: 4 слоя резолва, порядок приоритетов (root > .maestro/ > global > env), .maestro/ вне git. MAESTRO_CONFIG — replace всего (debug). |
| `reference/memory.md` | Секция «Конфигурация (memory)»: namespace может быть в root или .maestro/, global НЕ содержит namespace. |
| `reference/commands.md` | Если есть раздел по установке команд — глобальные команды из `~/.config/opencode/commands/`. |

**Объяснение (3 файла):**
| Файл | Изменение |
|---|---|
| `explanation/agents-and-trust.md` (~540 строк) | **Самый тяжёлый:** §2 «trust-config → maestro.json» описывает maestro.json как **единый** источник. Нужны: multi-layer резолв, порядок приоритетов, «root выигрывает», .maestro/ не в git, global как дефолт. Также §2.4 — маска confidential.paths (теперь auto-добавляется активный конфиг). **agpack упоминается только как удалённый.** |
| `explanation/plain-language.md` | Ссылка на `maestro.json → communication` — теперь communication может прийти из любого слоя. |
| `explanation/pipeline-overview.md` | Минорная: reference на feedback_report (пока не трогать, семантика не меняется). |

**Обзор (1 файл):**
| Файл | Изменение |
|---|---|
| `overview/quick-start.md` | Минорная: reference на feedback_report (пока не трогать). |

**Внутренние (3 файла):**
| Файл | Изменение |
|---|---|
| `AGENTS.md` | Секция доставки: global install через bash+git+wholesale-copy, agpack удалён. Правила синхронизации manual_docs/ (принцип: все изменения скилла → all manual_docs/ файлы). Удалить упоминания agpack. |
| `SECURITY.md` | Раздел 4.8+ «Global Installation Trust» (trust boundary, masker глобального конфига, blast radius). Удалить agpack-ссылки. |
| `skills/maestro/SKILL.md` | Gate 0: «конфиг найден в любом из слоёв», описание maestro.json locations (root, .maestro/, global). |

**На merge (AGENTS.md требование):**
| Файл | Изменение |
|---|---|
| `docs/roadmap.md` | Обновить статус issue — «глобальная установка реализована». Версия 5.0.0. |
| `TODO.md` | Обновить отметку — аналогично. |

**Тесты:**
| Файл | Изменение |
|---|---|
| `maestro-install/docs-drift.test.mjs` | Удалить проверки agpack.yml, добавить проверки wholesale-copy (список скриптов, путь до каталога, отсутствие агpack-упоминаний в доках). |

## 9. План тестирования

### Unit-тесты (plugin):

| Тест | Что проверяет |
|---|---|
| `resolveConfigFile` — глобальный только | Возвращает global path, если нет root/.maestro/ |
| `resolveConfigFile` — .maestro/ только | Возвращает .maestro/ path |
| `resolveConfigFile` — root только | Возвращает root path |
| `resolveConfigFile` — все три + env | Возвращает env (замена всего) |
| `resolveConfigFile` — root + .maestro/ | Возвращает root (root побеждает) |
| `resolveConfigFile` — root + .maestro/ + global | Возвращает root |
| `resolveConfigFile` — none | Возвращает null |
| `loadWhitelist` при сломанном файле | Возвращает `{}`, warning |
| `loadMaestroConfig` — невалидный JSON в root | Fallback к .maestro/, затем к global — не abort, не пустой конфиг |
| `loadMaestroConfig` — невалидный JSON | `{}`, без выброса |
| `loadMaestroConfig` — hybrid merge | non-memory keys из одного файла; memory soft-merge (global.enabled + project.namespace) |
| `loadMaestroConfig` — memory.enabled: false override | Проект setting `memory.enabled: false` блокирует global `enabled: false` |
| `loadMaestroConfig` — memory.embedding.model override | Проект override global default model |

### Integration-тесты:

| Тест | Что проверяет |
|---|---|
| G0 — проект без конфига | Гейт 0 пропускается, плагин тихий |
| G1 — проект с global только | Гейт 0 проходит, memory disabled (enabled=false global, проект не включил memory) |
| G2 — проект с .maestro/ только | Гейт 0 проходит, memory enabled (namespace есть) |
| G3 — проект с root только | Гейт 0 проходит, memory enabled (namespace есть) |
| G4 — проект с root + .maestro/ | Используется root (replace) |
| G5 — глобальная установка | wholesale copy → скиллы/команды/агенты в ~/.config/opencode/ |
| G6 — глобальный апдейт | clone → manifest diff → prune HITL → cp → cache clean |
| G7 — duplicate plugin ID | Дедуп из обоих конфигов |
| G8 — stale-переименование | `--prune` показывает, что удалить |
| VX — memory drift post-migration | `memory_search` возвращает те же сессии после миграции проект → глобал (namespace не менялся) |

### E2E-тесты:

| Тест | Что проверяет |
|---|---|
| E1 — полный цикл | Установить → `/maestro-setup` → `/maestro-init` → завершить → удалить → переустановить |
| E2 — миграция | Проектная установка → глобальная (ручной чек-лист) → проверить |
| E3 — smoke post-update | `/maestro-version` = новая версия; memory работает; команды доступны |
| E4 — deinstall --preserve | Удалить всё кроме whitelist-файлов |
| E5 — migration read-only agpack | Agpack.yml read-only → warn HITL → cleanup continue |

## 8b. Документация (дополнительно, из аудита grep)

**Следующие файлы содержат agpack-упоминания и НЕ были в первоначальном списке секции 8:**

**How-to (дополнительно):**
| Файл | Изменение |
|---|---|
| `how-to/enable-memory.md` | **Критично:** утверждает «agpack не включает memory» — переписать. Namespace auto-derive, global config enablement, `/maestro-setup` flow |
| `how-to/keep-docs-up-to-date.md` | Содержит само правило agpack-sync доставки — переписать delivery rule |
| `how-to/customize-maestro.md` | Удалить agpack-упоминания |
| `how-to/memory-backup-restore.md` | agpack-упоминание + update resolver sync (backup-cli.js) |

**Обзор (дополнительно):**
| Файл | Изменение |
|---|---|
| `overview/what-is-maestro.md` | agpack-упоминания |
| `overview/changelog.md` | **Добавить entry 5.0.0 (breaking):** agpack удалён, wholesale-copy, global install |
| `index.md` | agpack-упоминания в навигации |

**Skills/commands (дополнительно):**
| Файл | Изменение |
|---|---|
| `skills/maestro-setup/SKILL.md` | **Критично:** 0 namespace упоминаний. Добавить auto-derive logic, memory enable flow, config layering awareness |
| `skills/maestro-memory/SKILL.md` | Memory skill — 4.15.0. Проверяет `memory.enabled` из конфига. Не меняется (config resolver уже обновляет), но проверить compatibility |
| `skills/maestro-references/artifact-review.md` | agpack-упоминания |
| `skills/manual-docs/SKILL.md` | agpack-упоминания |
| `commands/maestro-version.md` | Глобальный install: plugin-version из global `.maestro/plugin-version` + fallback к project |

**Корневые файлы (дополнительно):**
| Файл | Изменение |
|---|---|
| `README.md` | agpack-упоминания в инструкции установки |
| `docs/project-context.md` | agpack-упоминание в контексте проекта |

**Тесты (дополнительно):**
| Файл | Изменение |
|---|---|
| `maestro-install/commands-skill-coverage.test.mjs` | **Сломается при удалении agpack.yml!** Текущий файл читает `maestro-install/agpack.yml` и корневой `agpack.yml`. Удалить или переписать на wholesale-copy (не требуется — wholesale = vacuum invariant, тест не нужен, аналогично agpack-coverage) |
| `agpack.yml` (root, dogfooding) | **Удалить** — аналогично maestro-install/agpack.yml. Удалить `.agpack.lock.yml` тоже |
