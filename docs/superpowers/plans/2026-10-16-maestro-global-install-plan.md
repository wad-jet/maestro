# Maestro Global Install — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Глобальная установка/обновление maestro (скиллы/команды/агенты/плагин) через bash + git clone + wholesale copy + трёхслойный hybrid-конфиг; полный отказ от agpack; версия 6.0.0.

**Architecture:** Два скрипта-входные-точки (`maestro-install.sh` / `maestro-update.sh` в корне репо) с режимами `--project` (default) / `--global`: shallow-clone → collision detection → staging-cp → атомарный manifest → idempotent-регистрация плагина. Плагин: `resolveConfigFile` с 4-слойным резолвом (env > root > .maestro/ > global) и `loadMaestroConfig` с hybrid-мержем (non-memory = replace, `memory.*` = soft-merge global.base + active.namespace). Namespace auto-derive — в `/maestro-setup` (persist в `.maestro/maestro.json`), не в runtime.

**Tech Stack:** bash (macOS-default 3.2 — без `flock`, mkdir-lock), git, python3 (любой — только JSON-регистрация плагина), Node.js (node:test, 0 зависимостей).

**Spec:** `docs/superpowers/specs/2026-10-16-maestro-global-install-design.md`

## Global Constraints

- **Версия:** `package.json` 5.6.10 → **6.0.0** (major/breaking: agpack удалён). Везде в доках — 6.0.0. (Спека написала «5.0.0» — stale-номер; см. D3.)
- **Язык:** все сообщения пользователю, тексты скиллов/команд/доков — только русский.
- **0 новых зависимостей** (node:test; в scripts — только git/curl-wget/python3).
- **agpack нигде нет**: не в scripts, доках, тестах, AGENTS.md. Исторические упоминания (`specs/`, `regression/`, `.maestro/`, `.superpowers/`) не трогаются.
- **XDG:** все глобальные пути — через единую функцию `resolveGlobalDir()` = `path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), "opencode", ".maestro")`. Хардкод `~/.config/` запрещён (V4, V11).
- **Без sudo, без системных каталогов.** Clone только `https://` (http — abort, V22).
- **HITL:** все destructive-операции (prune, deinstall, удаление agpack-файлов, de-dup плагина в проекте) — только с подтверждением.
- **`MAESTRO_CONFIG`** — debug-only, полный override; в CI/automation не использовать (spec §7).
- **Гарантии надёжности (spec §3.1):** clone-first, staging+atomic-mv, атомарный manifest (tmp+mv), lock (stale >30 мин → warning), trap-cleanup, collision detection во всех 3 каталогах (`skills/`, `commands/`, `agents/`) по маркеру `.maestro-deployed`.

## Review Focus

1. **Пользовательский скилл/команда/агент в целевом каталоге без маркера `.maestro-deployed`** → не затирать молча, HITL (overwrite/rename/skip). — зафиксировано тестом в Task 3, Step 5.
2. **Параллельные запуски скрипта** (две установки одновременно) → lock сериализует; второй — ожидание/abort c сообщением. — Task 3, Step 6.
3. **Прерывание установки** (kill между cp и manifest-write) → повторный запуск восстанавливает консистентное состояние (атомарный manifest + staging). — Task 3, Step 7.
4. **Сломанный JSON в любом слое конфига** → fallback к следующему слою с warning, плагин не падает, не «память выключена». — Task 1, Step 1 (unit-тесты).
5. **Двойная регистрация плагина** (глобальная + локальная `.opencode/opencode.json`) → duplicate plugin ID; user получает warning + инструкцию (v1: без auto-removal). — Task 4, Step 5.

## План-уровневые решения (корректируют спеку)

- **D1. Скрипты остаются в корне репо** (`maestro-install.sh`, `maestro-update.sh`). Спека §8 писала «перенос в `maestro-install/`» — противоречит собственному how-to-сниппету спеки (curl-URL `main/maestro-install.sh`) и принципу минимальной сложности. URL пользователя не меняется.
- **D2. Manifest = JSON.** `manifest.json` = `{"version":"6.0.0","sha_m":"<sha>","sha_s":"<sha>","deployed":["skills/maestro","commands","agents",…]}`. Псевдокод спеки (§3.1, `echo "$NEW_SHA_M $NEW_SHA_S"`) противоречит Q8 («manifest хранит список развёрнутых путей») — JSON-схема закрывает оба.
- **D3. Версия 6.0.0** (не «5.0.0» из спеки): `package.json` сейчас 5.6.10; breaking → major.
- **D4. Путь backup-cli:** `plugins/maestro-bootstrap/memory/backup-cli.js` (в спеке было `plugins/maestro-bootstrap/backup-cli.js`).

---

### Task 1: Plugin — 4-слойный резолв конфига + hybrid merge (core.js)

**Files:**
- Modify: `plugins/maestro-bootstrap/core.js:186-197` (замена `loadMaestroConfig` + `resolveConfigFile`)
- Test: `plugins/maestro-bootstrap/index.test.js`

**Interfaces:**
- Consumes: `plugins/maestro-bootstrap/memory/config.js` → `DEFAULTS.embedding_model` (line 27, `Xenova/paraphrase-multilingual-MiniLM-L12-v2`).
- Produces (используют Task 2, memory-модуль, все калл-сайты `loadMaestroConfig(undefined, root)` — signature НЕ меняется):
  - `resolveGlobalDir() → string` — состояние глобальной установки (`…/opencode/.maestro`).
  - `resolveConfigFile(root, globalDir?) → string | null` — **первый парсируемый** конфиг по приоритету: `MAESTRO_CONFIG` env > `<root>/maestro.json` > `<root>/.maestro/maestro.json` > `<globalDir>/maestro.json`. Сломанный JSON слоя → warning + переход к следующему; `globalDir` по умолчанию `resolveGlobalDir()`.
  - `loadMaestroConfig(file?, dir?) → object` — hybrid effective-конфиг: non-memory ключи — из активного файла; `memory.*` — soft-merge (см. формулу ниже).

**Формула hybrid merge (pin-решение):**

```js
// active = первый парсируемый слой (см. resolveConfigFile); globalBase = парсинг глобального файла ({} при отсутствии/сбое)
const aMem = active.memory && typeof active.memory === "object" ? active.memory : {};
const gMem = globalBase.memory && typeof globalBase.memory === "object" ? globalBase.memory : {};
merged = { ...active };
merged.memory = {
  ...aMem,                                   // остальные memory-ключи (storage, top_k, retention_days, related, mainline…) — replace из активного
  embedding: { ...gMem.embedding, ...aMem.embedding,
               model: aMem.embedding?.model ?? gMem.embedding?.model ?? DEFAULTS.embedding_model },
  enabled:   aMem.enabled ?? gMem.enabled ?? false,
  namespace: aMem.namespace ?? null,         // глобальный НЕ содержит namespace (Q6)
};
```

- [ ] **Step 1: Написать failing-тесты** (в `index.test.js`, временные каталоги через `fs.mkdtempSync`; env/`globalDir` — инъекцией через аргумент, без глобального загрязнения)

Тесты `resolveConfigFile`:
- `env override wins over all files` → `resolveConfigFile(root, gd) === envPath` при заданном `MAESTRO_CONFIG`
- `root beats .maestro and global` (все 3 на диске → root)
- `.maestro beats global` (root отсутствует)
- `global only → global path`
- `none → null`
- `broken root JSON → .maestro path` (root содержит `{invalid`)
- `all broken → null` + не выбрасывает

Тесты `loadMaestroConfig` (hybrid):
- `non-memory keys from active file only` (root: `{"communication":"professional"}` + global: `{"communication":"plain"}` → effective `communication === "professional"`)
- `memory soft-merge: global enabled + project namespace` (global `{"memory":{"enabled":true,"embedding":{"model":"M1"}}}`, `.maestro/` `{"memory":{"namespace":"a.b.c"}}` → `enabled===true`, `namespace==="a.b.c"`, `embedding.model==="M1"`)
- `project enabled:false blocks global true` → `enabled===false`
- `embedding model: project overrides global` (project `M2` → `M2`)
- `no memory anywhere → enabled:false, namespace:null, model===DEFAULTS.embedding_model`
- `broken root → non-memory fallback к .maestro/` (root `{invalid`, `.maestro/` `{"feedback_report":"auto"}` → `feedback_report==="auto"`)
- `active file without memory section inherits global memory` (root `{"communication":"x"}`, global `{"memory":{"enabled":true}}` → `enabled===true`, `namespace===null`)

- [ ] **Step 2: Запустить тесты — убедиться в FAIL**

Run: `node --test plugins/maestro-bootstrap/index.test.js 2>&1 | tail -5`
Expected: FAIL (новые тесты — `resolveGlobalDir is not exported` / assertions).

- [ ] **Step 3: Реализовать в `core.js`** `resolveGlobalDir()`, `resolveConfigFile(root, globalDir?)`, заменить тело `loadMaestroConfig` по формуле выше. Парсинг — существующий safe-reader (read + JSON.parse в try/catch, warning в лог при сломанном слое).

- [ ] **Step 4: Запустить тесты — PASS**

Run: `node --test plugins/maestro-bootstrap/index.test.js`
Expected: PASS (все старые + новые).

- [ ] **Step 5: Полная проверка**

Run: `npm test`
Expected: PASS (memory-тесты не затрагиваются: `loadMaestroConfig` signature и калл-сайт `core.js:700` не меняются).

- [ ] **Step 6: Commit**

```bash
git add plugins/maestro-bootstrap/core.js plugins/maestro-bootstrap/index.test.js
git commit -m "feat(plugin): 4-layer config resolve + hybrid memory merge (6.0.0)"
```

---

### Task 2: Plugin — masker активного конфига + backup-cli sync + plugin README

**Files:**
- Modify: `plugins/maestro-bootstrap/core.js` (новый `isMaestroConfigPath` рядом с `isPluginMetaFile` line 412; авто-добавление активного конфига в confidential-паттерны при резолве)
- Modify: `plugins/maestro-bootstrap/memory/backup-cli.js:215-225` (резолв конфига: сейчас `join(root, "maestro.json")` — заменить на общий 4-слойный резолв; при отсутствии всех слоёв — текущая ошибка-сообщение, расширенное списком проверенных путей)
- Modify: `plugins/maestro-bootstrap/README.md` (секции: install, MAESTRO_CONFIG, maestro.json locations — 4 слоя)
- Test: `plugins/maestro-bootstrap/index.test.js` (isMaestroConfigPath), `npm run test:memory` (backup-cli)

**Interfaces:**
- Consumes: Task 1 — `resolveConfigFile`, `resolveGlobalDir`.
- Produces: `isMaestroConfigPath(root, target) → boolean` — true для активного конфиг-файла и `~/.config/opencode/.maestro/maestro.json` (маскирование в sanitize, P6: активный конфиг — confidential).

- [ ] **Step 1: Failing-тесты `isMaestroConfigPath`**
  - `true для .maestro/maestro.json` (локальный слой)
  - `true для root maestro.json` (активный)
  - `true для глобального конфига` (absolute path из `resolveGlobalDir()`)
  - `false для обычного файла` (`docs/specs/x.md`)
- [ ] **Step 2: Запустить — FAIL** (функция не экспортирована)
- [ ] **Step 3: Реализовать `isMaestroConfigPath`; подключить в sanitize-цепочку** (те же точки, где проверяется `isPluginMetaFile`/confidential-паттерны)
- [ ] **Step 4: backup-cli — заменить резолв** на `resolveConfigFile(root, resolveGlobalDir())`; сохранить fail-сообщение со списком проверенных слоёв
- [ ] **Step 5: Обновить `plugins/maestro-bootstrap/README.md`** (4 слоя, MAESTRO_CONFIG debug-only, global dir)
- [ ] **Step 6: Запустить** `npm test && npm run test:memory` → PASS
- [ ] **Step 7: Commit**

```bash
git add plugins/maestro-bootstrap/
git commit -m "feat(plugin): mask active config path; backup-cli 4-layer resolve"
```

---

### Task 3: Script — `maestro-install.sh` (перезапись: --project/--global, lock, staging, manifest, plugin reg)

**Files:**
- Modify: `maestro-install.sh` (полная перезапись — текущий agpack-flow заменяется; D1: остаётся в корне)

**Interfaces:**
- Produces (контракт для Task 4, доков, E2E):
  - Аргументы: `--project` (default), `--global`, `--pin <sha>`, `--dry-run`, `--migrate`, `--deinstall [--preserve <csv>]`, `--help`. Exit: 0 ok, 1 fail (die с сообщением), 2 usage.
  - Глобальное состояние: `$GLOBAL_DIR/manifest.json` (схема D2), `$GLOBAL_DIR/maestro.json` (создаётся при `--global`, если отсутствует: `{"memory":{"enabled":false,"embedding":{"model":"Xenova/paraphrase-multilingual-MiniLM-L12-v2"}}}`), lock `$GLOBAL_DIR/.install.lock`.
  - Проектное состояние: `<project>/.maestro/manifest.json`.
  - Целевые каталоги: global — `~/.config/opencode/{skills,commands,agents}/`; project — `.opencode/{skills,commands,agents}/`. Каждый развёрнутый каталог получает маркер `.maestro-deployed` (пустой файл).
  - Плагин: entry `maestro-bootstrap@git+https://github.com/wad-jet/maestro.git`; de-dup = filter `is_ours()` + append (idempotent); JSON-регистрация через python3 (любой).
  - Reuse: алгоритм collision/lock/staging/manifest — spec §3.1 (псевдокод), надёжность — spec §3.1 «Надёжность», deinstall — spec §3.8, migration — spec §3.5.
- Consumes: клонируемые репо `github.com/wad-jet/maestro` + superpowers (URLs как в текущем скрипте).

- [ ] **Step 1: Написать `maestro-install.sh`** по spec §3.1–3.3, §3.5, §3.8. Ключевые решения (pin):
  - lock: `mkdir`-based (macOS-совместимо, V18): `mkdir "$LOCK" 2>/dev/null || { stale-check (>30 мин → warning + takeover) || die; }`; cleanup в `trap EXIT` (rm staging + lock).
  - clone: `git clone --depth 1 https://…` **до** любых destructive-действий; fail-fast abort.
  - collision: цикл по всем 3 каталогам (`skills commands agents`); пользовательский каталог без маркера → HITL (overwrite/rename `-user`-suffix/skip).
  - copy: staging `.deploy-staging/` → per-dir `rm -rf target/$dir && mv staging/$dir target/$dir` (atomic rename, same-fs).
  - manifest: write tmp + `mv` (D2-схема JSON через python3).
  - `--dry-run`: clone + diff (текущий manifest ↔ новый clone + collision-лист) — 0 мутаций.
  - `--deinstall --preserve <csv>`: whitelist-файлы сохраняются (spec §3.8).
  - `--migrate`: spec §3.5 (авто-derive namespace bash-эквивалентом алгоритма spec §3.2.3 — тот же вывод, что даёт `/maestro-setup`; cross-check — Task 9).
- [ ] **Step 2: Syntax check**

Run: `bash -n maestro-install.sh`
Expected: без ошибок.

- [ ] **Step 3: Dry-run smoke (0 мутаций)**

```bash
T=$(mktemp -d); XDG_CONFIG_HOME="$T" bash maestro-install.sh --global --dry-run; find "$T" -type f | wc -l
```
Expected: план-вывод (clone sha, diff, 0 конфликтов); в `$T` — **0 файлов**.

- [ ] **Step 4: Живой install в изолированный XDG**

```bash
XDG_CONFIG_HOME="$T" bash maestro-install.sh --global
```
Expected: `skills/` (включая `maestro*`, `maestro-setup`, superpowers), `commands/`, `agents/` с маркерами `.maestro-deployed`; `manifest.json` (D2-схема); `maestro.json` (global default, `enabled:false`); `opencode.json` с одним плагином.

- [ ] **Step 5: Collision (Review Focus #1)** — в `$T/opencode/skills/my-skill/` (без маркера) положить файл; повторный install → HITL-warning, файл НЕ затёрт до подтверждения.
- [ ] **Step 6: Lock (Review Focus #2)** — `mkdir "$T/opencode/.maestro/.install.lock"` вручную; запуск install → abort с сообщением о lock; lock старше 30 мин (touch -t) → warning + takeover.
- [ ] **Step 7: Прерывание (Review Focus #3)** — `kill` скрипта на полпути (после cp, до manifest); повторный запуск → финальное состояние консистентно (manifest либо старого, либо нового состояния, без «половины»).
- [ ] **Step 8: Deinstall + https-only** — `--deinstall --preserve maestro.json` (конфиг остался, skills/commands/agents/manifest удалены); clone с `http://` URL → abort (V22 — через тестовую подмену URL-переменной/функции, если параметризована).
- [ ] **Step 9: Commit**

```bash
git add maestro-install.sh
git commit -m "feat(install): global/project install via git+wholesale-copy+manifest, no agpack"
```

---

### Task 4: Script — `maestro-update.sh` (перезапись: --global/--project, self-check, prune, de-dup)

**Files:**
- Modify: `maestro-update.sh` (полная перезапись; удалить merge-add Python-блок и agpack sync текущего)

**Interfaces:**
- Consumes: manifest-схема D2 и lock/staging-контракт Task 3.
- Produces: аргументы `--project` (default), `--global`, `--pin <sha>`, `--prune`, `--dry-run`, `--help`; последовательность — spec §3.4 (self-check → clone → manifest diff → prune HITL JSON → staging cp → cache clean `~/.cache/opencode/npm/git-maestro-*` → plugin re-reg idempotent → HITL-рестарт «прервёт все проекты»); prune-формат JSON: `[{"path":"…","reason":"removed_from_repo|renamed_to_…" }]`.

- [ ] **Step 1: Написать `maestro-update.sh`** по spec §3.4 (lock + clone-first + staging + атомарный manifest — как в Task 3).
- [ ] **Step 2: Syntax check** — `bash -n maestro-update.sh` → OK.
- [ ] **Step 3: Dry-run smoke** — `XDG_CONFIG_HOME=$T bash maestro-update.sh --global --dry-run` → 0 мутаций, план-вывод.
- [ ] **Step 4: No-op update (тот же sha)** → «актуальная версия», manifest не меняется; **prune-прогон**: удалить из каталога один задекларированный в manifest путь + положить stale-каталог с маркером → `--prune` показывает JSON-листинг, удаление — только после HITL (V6).
- [ ] **Step 5: Duplicate plugin (Review Focus #5)** — в `$T/opencode/opencode.json` плагин + в test-проекте `.opencode/opencode.json` тоже `is_ours` entry → warning + инструкция по удалению дубликата (v1: без auto-removal).
- [ ] **Step 6: Self-check (V21)** — расхождение локального update-скрипта с версией из коммита → HITL-сообщение о самообновлении.
- [ ] **Step 7: Commit**

```bash
git add maestro-update.sh
git commit -m "feat(update): global/project update via manifest diff + prune, self-check"
```

---

### Task 5: Удаление agpack + bump версии 6.0.0

**Files:**
- Delete: `maestro-install/agpack.yml`, `maestro-install/agpack-coverage.test.mjs`, `maestro-install/commands-skill-coverage.test.mjs`, `agpack.yml` (root), `.agpack.lock.yml` (root)
- Modify: `maestro-install/docs-drift.test.mjs` (удалить agpack-паттерны/проверки; добавить: скрипты существуют в корне, `agpack` отсутствует в `manual_docs/**`, `README.md`, `AGENTS.md`, `SECURITY.md`, scripts)
- Modify: `package.json` (version → `6.0.0`; проверить, что `scripts.test` не ссылается на удалённые тесты явно)

**Interfaces:**
- Produces: зелёный `npm test` с 6.0.0 — precondition для Task 7/8 (docs-версии).

- [ ] **Step 1: Удалить 5 agpack-файлов**
- [ ] **Step 2: Обновить `docs-drift.test.mjs`** (паттерны из Step в Files; fixture-секции теста поправить под новые проверки)
- [ ] **Step 3: Bump** `package.json` → `"version": "6.0.0"`
- [ ] **Step 4: Запустить** `npm test` → PASS
- [ ] **Step 5: Grep-контроль** — `grep -ril agpack --include='*.md' --include='*.sh' --include='*.yml' . | grep -v node_modules | grep -vE '\.(maestro|opencode|sandbox|superpowers)/|specs/|regression/|docs/superpowers/'` → пусто
- [ ] **Step 6: Commit**

```bash
git add -A maestro-install/ agpack.yml .agpack.lock.yml package.json maestro-install/docs-drift.test.mjs
git commit -m "chore: remove agpack entirely; bump 6.0.0 (breaking)"
```

---

### Task 6: Skills — `/maestro-setup` auto-derive + Gate 0 + `/maestro-version`

**Files:**
- Modify: `skills/maestro-setup/SKILL.md` (сейчас 0 упоминаний namespace — добавить: global-режим flow spec §3.6, auto-derive алгоритм spec §3.2.3 (Вариант A: парсинг SSH/HTTPS/ssh://, monorepo `owner.repo.segment` при project dir ≠ git root, fallback C `parent_dir.project_dir.local`, нормализация pad/truncate до 3 сегментов, validation, edge cases: self-hosted single-component → `domain.unknown.repo`), запись `memory: {"enabled":true,"namespace":<derive>}` в `.maestro/maestro.json`, правило «не перезаписывать существующий namespace», добавление `.maestro/` в `.gitignore`)
- Modify: `skills/maestro/SKILL.md` (Gate 0: «проект под maestro» = резолвер нашёл конфиг в любом из слоёв (root, `.maestro/`, global, `MAESTRO_CONFIG`) — spec §3.7; описание locations maestro.json)
- Modify: `commands/maestro-version.md` (fallback: если `.maestro/plugin-version` в проекте отсутствует — проверить глобальный `~/.config/opencode/.maestro/plugin-version`… по факту — путь, который пишет глобально загруженный плагин; при отсутствии обоих — текущее сообщение «не инициализирован»)

**Interfaces:**
- Consumes: spec §3.2.3 (алгоритм — единственный источник истины; bash-эквивалент в `maestro-install.sh --migrate` обязан давать тот же вывод — сверка в Task 9).
- Produces: `.maestro/maestro.json` c `memory.enabled:true` + namespace (контракт Task 9 E2E).

- [ ] **Step 1: `skills/maestro-setup/SKILL.md`** — добавить блок global-режима + auto-derive (точные значения: 3 сегмента, домен без TLD, `unknown`-padding, monorepo-триггер, edge cases — из spec §3.2.3 без сокращений).
- [ ] **Step 2: `skills/maestro/SKILL.md` Gate 0** — обновить формулировку «конфиг в любом из слоёв» + locations (root в git, `.maestro/` не в git, global дефолт, env debug).
- [ ] **Step 3: `commands/maestro-version.md`** — global fallback.
- [ ] **Step 4: Проверить** `npm test` (docs-drift) → PASS; `grep -c 'namespace' skills/maestro-setup/SKILL.md` → > 0.
- [ ] **Step 5: Commit**

```bash
git add skills/maestro-setup/SKILL.md skills/maestro/SKILL.md commands/maestro-version.md
git commit -m "feat(skills): /maestro-setup auto-derive namespace; Gate 0 multi-layer; version global fallback"
```

---

### Task 7: Docs — how-to + reference (10 файлов)

**Files:**
- Modify: `manual_docs/how-to/install-maestro.md` (Вариант A — глобальная установка, текст из spec §8; вариант проектной установки без agpack)
- Modify: `manual_docs/how-to/update-maestro.md` (глобальное обновление + проектное; опции `--pin`, `--prune`, `--dry-run`)
- Modify: `manual_docs/how-to/enable-memory.md` (**переписать**: «стандартная установка память не включает» — теперь: global default `enabled:false`, включение через `/maestro-setup` per-project (auto-derive namespace) или ручной `memory.enabled:true`; убрать «agpack не включает»)
- Modify: `manual_docs/how-to/keep-docs-up-to-date.md` (правило доставки — wholesale copy, без agpack-sync)
- Modify: `manual_docs/how-to/customize-maestro.md` (удалить agpack-упоминания; конфиг — 4 слоя)
- Modify: `manual_docs/how-to/memory-backup-restore.md` (agpack-упоминание; резолв конфига — 4 слоя, backup-cli)
- Modify: `manual_docs/reference/config.md` (4 слоя + приоритеты + hybrid: non-memory replace, memory soft-merge; parse-error fallback; `MAESTRO_CONFIG` debug-only; `.maestro/` вне git)
- Modify: `manual_docs/reference/memory.md` (секция «Конфигурация (memory)»: namespace — только project-слои (root/`.maestro/`), global НЕ содержит; auto-derive; enabled soft-merge)
- Modify: `manual_docs/reference/commands.md` (глобальные команды из `~/.config/opencode/commands/`)
- Modify: `manual_docs/index.md` (agpack-упоминания в навигации)

**Interfaces:**
- Consumes: Task 5 (версия 6.0.0 в `package.json` — все версионные факты в этих файлах), Task 3/4 (опции скриптов), Task 6 (поведение `/maestro-setup`).

- [ ] **Step 1: `install-maestro.md` + `update-maestro.md`** — Вариант A глобальный (рекомендуемый) + проектный; curl-URL корневого скрипта (D1); опции; post-install: `/maestro-setup` + перезапуск.
- [ ] **Step 2: `enable-memory.md`** — переписать под hybrid (global `enabled:false` default → per-project opt-in).
- [ ] **Step 3: `keep-docs-up-to-date.md`, `customize-maestro.md`, `memory-backup-restore.md`, `index.md`** — убрать agpack, добавить факты доставки/слоёв.
- [ ] **Step 4: `reference/config.md`, `reference/memory.md`, `reference/commands.md`** — 4 слоя/hybrid/auto-derive.
- [ ] **Step 5: Запустить** `npm test` (docs-drift: версии, отсутствие agpack) → PASS.
- [ ] **Step 6: Commit**

```bash
git add manual_docs/how-to/ manual_docs/reference/ manual_docs/index.md
git commit -m "docs: global install how-to, 4-layer config reference, memory auto-derive"
```

---

### Task 8: Docs — explanation/overview/root (AGENTS, SECURITY, README, changelog, roadmap, TODO)

**Files:**
- Modify: `manual_docs/explanation/agents-and-trust.md` (самый тяжёлый: §2 multi-layer резолв, приоритеты, «root выигрывает», `.maestro/` вне git, global как дефолт, §2.4 маска confidential.paths — авто-добавление активного конфига; agpack — только как «удалён в 6.0.0»)
- Modify: `manual_docs/explanation/plain-language.md` (`maestro.json → communication` может прийти из любого слоя)
- Modify: `manual_docs/overview/what-is-maestro.md` (agpack-упоминания)
- Modify: `manual_docs/overview/changelog.md` (entry `## [6.0.0]` + дата: **Major** — глобальная установка, wholesale delivery, полный отказ от agpack, 3-layer hybrid config, namespace auto-derive, deinstall/prune)
- Modify: `README.md` (инструкция установки → Вариант A глобальный; agpack-упоминания)
- Modify: `AGENTS.md` (секция доставки: bash + git clone + wholesale copy + manifest, agpack удалён; скрипты в корне; обновить список файлов `maestro-install/`; корневой `agpack.yml` — удалён)
- Modify: `SECURITY.md` (новый раздел 4.8+ «Global Installation Trust»: trust boundary глобального каталога, masker активного конфига (P6), blast radius «рестарт прервёт все проекты», https-only clone, `MAESTRO_CONFIG` debug-only, HITL на destructive)
- Modify: `docs/roadmap.md`, `TODO.md` (статус «глобальная установка» — реализовано (6.0.0))

**Interfaces:**
- Consumes: всё выше; D4-проверка docs-drift: «реализовано (6.0.0)» в roadmap/TODO ↔ entry в changelog.

- [ ] **Step 1: `agents-and-trust.md`** — multi-layer резолв + masker (по Task 1/2 фактам).
- [ ] **Step 2: `plain-language.md`, `what-is-maestro.md`, `README.md`** — убрать agpack, обновить flow.
- [ ] **Step 3: `changelog.md`** — entry 6.0.0 (формат как у 5.6.8: `> **Версия 6.0.0** — Major: …` + «### Изменено/Удалено/Добавлено»).
- [ ] **Step 4: `AGENTS.md`** — секция доставки (wholesale, 2 скрипта в корне, `maestro-install/` = тесты; удалить агpack-правила sync).
- [ ] **Step 5: `SECURITY.md`** — раздел 4.8+ (доказать соответствие: каждый пункт → где реализован (Task 1/2/3/4)).
- [ ] **Step 6: `roadmap.md` + `TODO.md`** — статус 6.0.0.
- [ ] **Step 7: Запустить** `npm test` (D1 версии, D4 roadmap↔changelog) → PASS.
- [ ] **Step 8: Commit**

```bash
git add manual_docs/ README.md AGENTS.md SECURITY.md docs/roadmap.md TODO.md
git commit -m "docs: 6.0.0 changelog, SECURITY global-install trust, AGENTS delivery rewrite"
```

---

### Task 9: E2E release-верификация (V-чеклист + живой цикл)

**Files:** не создаются — только верификация (и финальный commit при необходимости).

**Interfaces:**
- Consumes: все предыдущие task'и.

- [ ] **Step 1: Полный test-прогон**

Run: `npm test && npm run test:memory`
Expected: PASS (0 fail).

- [ ] **Step 2: Изолированный E2E-цикл** (сэндбокс-`HOME`/`XDG_CONFIG_HOME`, тестовый git-проект с `origin`-remote `https://github.com/wad-jet/example.git`):
  1. `maestro-install.sh --global` → проверить: skills/commands/agents + маркеры, `manifest.json` (D2), global `maestro.json` (`enabled:false`), `opencode.json` (1 плагин).
  2. В тестовом проекте: `/maestro-setup` (эмуляция по канону Task 6) → `.maestro/maestro.json` = `{"memory":{"enabled":true,"namespace":"github.wad-jet.example"}}`.
  3. **Cross-check auto-derive:** bash-эквивалент из `--migrate` и алгоритм из `skills/maestro-setup/SKILL.md` дают **один** namespace для одного remote.
  4. `maestro-update.sh --global` (no-op, тот же sha) → «актуальная версия».
  5. `/maestro-version` (эмуляция) → версия из global plugin-version.
  6. `maestro-install.sh --deinstall --preserve maestro.json` → конфиг на месте, остальное удалено, `opencode.json` очищен от нашего entry.
- [ ] **Step 3: V-чеклист (spec §5):** V1 (блокер — OpenCode V2 грузит глобальные commands/agents; если не проходит — остановить и эскалировать), V2, V3, V4, V5, V13–V17, V18–V23 — поочерёдно, результаты записать в `regression/entries/`-заметку при отклонениях.
- [ ] **Step 4: Fallback-сценарии (V13, V23):** root `{invalid` → fallback + warning; global `enabled:true` + нет проектного конфига → `namespace_missing`; `/maestro-setup` → memory works.
- [ ] **Step 5: Финальный commit** (при правках по итогам верификации): `chore: release verification fixes (6.0.0)`

---

## Self-Review (выполнено автором плана)

**1. Spec coverage:** §3.1 install (T3), §3.2 config layers (T1), §3.3 plugin reg/de-dup (T3/T4), §3.4 update (T4), §3.5 migration (T3 `--migrate` + T9), §3.6 /maestro-setup (T6), §3.7 Gate 0 (T6), §3.8 deinstall (T3), §4 security (T2 masker + T8 SECURITY.md), §5 V-чеклист (T9), §8 doc-список (T7/T8/T5), §9 unit/integration/E2E (T1–T4 unit/integration, T9 E2E). Gap'ов нет.
**2. Step scan:** каждый step — одно действие с проверяемым результатом; bash-алгоритмы делегированы спеке (псевдокод §3.1–3.5), план фиксирует интерфейсы и pin-решения, не транскрипцию.
**3. Type consistency:** `resolveGlobalDir`/`resolveConfigFile(root, globalDir?)`/`isMaestroConfigPath` — имена едины в T1→T2; manifest-схема D2 единая в T3→T4; `DEFAULTS.embedding_model` — единственный источник default-модели.
**4. Review Focus:** 5 строк — каждая закреплена за step (T1S1, T3S5–S7, T4S5).
**5. Proportion:** план ~430 строк при спеке 738 — план короче спеки (алгоритмы в спеке, решения в плане).
