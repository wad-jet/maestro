# Spec: переименование команд `maestro-init` → `maestro-new` и `maestro` → `maestro-init`

Дата: 2026-09-01
Статус: черновик (до Spec Review)
Ветка: `feature/rename-commands-maestro-new`

## 1. Проблема

Названия двух команд maestro не соответствуют сути и путают:

- `/maestro-init` — фактически **bootstrap нового проекта** (project-context, конфиг, каталоги). Имя «init» здесь двусмысленно: соседствует со встроенным `/init` opencode (создаёт AGENTS.md) и не отражает «новый проект».
- `/maestro` — вход в **пайплайн фич/багфиксов**. Имя не отражает действие и неоднородно с остальными командами (`/maestro-design`, `/maestro-assistant`, `/maestro-version`).

Задача (TODO.md:53): переименовать команды так, чтобы название соответствовало сути:
- `maestro-init` → `maestro-new` (новый проект)
- `maestro` → `maestro-init` (инициализация скила maestro — загрузка скилла и запуск pipeline в сессии)

## 2. Цели

- Имена команд соответствуют сути.
- Единообразие: `/maestro-init` становится частью семейства `/maestro-*`.
- Полный каскадный рефакторинг: переименование должно затронуть команды, скиллы, скрипты, agpack-пути, документацию — без «висящих» ссылок.
- Безопасная миграция существующих целевых проектов (agpack-записи).

## 3. Non-goals

- НЕ переименовывается скилл `maestro` (ядро pipeline). Команда `/maestro-init` (пайплайн) грузит скилл `maestro` — конвенция «имя команды = имя скилла» здесь осознанно нарушается (прецедент: `/regression`, `/test-agents` без одноимённых скиллов).
- НЕ вводится переходный стаб-команда `/maestro` — чистый разрыв.
- НЕ переписываются исторические записи `manual_docs/overview/changelog.md` и исторические `specs/*` (фиксируют прошлые состояния). `TODO.md` (в `.gitignore`, рабочий журнал) тоже трактуется как исторический — не переписывается, кроме закрытия строки 53 (источник этой задачи).
- **Код плагина `maestro-bootstrap` почти не затрагивается** — только комментарий в `plugins/maestro-bootstrap/core.js:5` (упоминает `@maestro`). Логика и тесты (176/176) не меняются.

## 4. Решение

### 4.1 Маппинг переименований

| Было | Стало | Суть |
|---|---|---|
| `commands/maestro-init.md` | `commands/maestro-new.md` | bootstrap нового проекта |
| `skills/maestro-init/` (name: `maestro-init`) | `skills/maestro-new/` (name: `maestro-new`) | скилл bootstrap'а |
| `commands/maestro.md` (`# @maestro`) | `commands/maestro-init.md` (`# @maestro-init`) | вход в пайплайн (грузит скилл `maestro`) |
| `maestro-init.sh` | `maestro-install.sh` | скрипт установки инструмента |
| `maestro-init/` (канон agpack.yml) | `maestro-install/` | канонический agpack.yml |

Порядок `git mv` при свапе (чтобы избежать коллизии путей):
1. `commands/maestro-init.md` → `commands/maestro-new.md`
2. `commands/maestro.md` → `commands/maestro-init.md`
3. `skills/maestro-init/` → `skills/maestro-new/`
4. `maestro-init.sh` → `maestro-install.sh`
5. `maestro-init/` → `maestro-install/`

### 4.2 Контент переименованных файлов

- **commands/maestro-new.md**: `Загрузи skill maestro-new …` (из `skills/maestro-new/`); все `/maestro-init` → `/maestro-new`. Заметка «НЕ системный `/init` opencode» остаётся здесь (актуальна для bootstrap).
- **commands/maestro-init.md**: заголовок `# @maestro-init`; описание «вход в pipeline maestro — сквозная реализация фич/багфиксов»; загрузка скилла `maestro`; «Связанные команды» → `@regression`, `@maestro-new`.
- **skills/maestro-new/SKILL.md**: frontmatter `name: maestro-new`; все `maestro-init` → `maestro-new`; ссылки на `/maestro-new`.
- **skills/maestro-new/init-context.md**: `maestro-init` → `maestro-new`.

### 4.3 Скрипты и agpack

- **maestro-install.sh** (экс maestro-init.sh): брендинг `[maestro-init]` → `[maestro-install]` (все `say/info/warn/die`); self-URL `raw.githubusercontent.com/.../maestro-install.sh`; heredoc-agpack.yml: `skills/maestro-init` → `skills/maestro-new`; финальная инструкция: `"/maestro-new"` (setup) и `"/maestro-init \"задача\""` (фича). **Текстовые формы (M-8):** usage/help-блок (стр. 3, 43, 46 — «maestro-init — подготовка проекта…», «bash maestro-init.sh [--global]») и python-префиксы сообщений heredoc-а (стр. 203–221 — «maestro-init: …») → `maestro-install`.
  - **Миграционный шаг (до `agpack sync`):** санитизировать `agpack.yml` проекта:
    - заменить устаревшую запись `(wad-jet/maestro, skills/maestro-init)` на `skills/maestro-new`;
    - это обязательное условие — проверено на agpack 0.3.1: если манифест ссылается на удалённый из источника путь, `agpack sync` падает с `FetchError` («Path '...' not found»).
    - Идемпотентно, только если `agpack.yml` существует.
  - **Очистка stale-артефактов (после `agpack sync`):** agpack 0.3.1 **не удаляет** stale-файлы, исчезнувшие из источника (проверено на scratch: `one.md` остаётся после удаления из репо; lock-запись гаснет, файл остаётся). Поэтому явно удалить в проекте:
    - `.opencode/commands/maestro.md` (старый вход пайплайна → `/maestro` не должен жить);
    - `.opencode/skills/maestro-init/` (старый bootstrap-скилл).
- **maestro-update.sh**: путь канона `maestro-init/agpack.yml` → `maestro-install/agpack.yml` (2 места: `--pin` git show, ветвь `cat`); текстовые упоминания (стр. 89 коммент, стр. 186 info); переименовать переменную `MAESTRO_INIT_AGPACK` → `MAESTRO_INSTALL_AGPACK`; финальное сообщение «выполните /maestro-init» → `/maestro-new`.
  - **Rename-aware merge (одно точное правило):** всегда удалять устаревшую запись `skills/maestro-init`
    из `dependencies.skills` целевого `agpack.yml` (безусловно, независимо от содержимого канона и режима
    `--pin`), затем добавлять `skills/maestro-new`, если её ещё нет. Сейчас merge add-only — требуется
    замена. Правило применяется и к `--pin` (M-5): канон из старого коммита не «воскрешает»
    `skills/maestro-init` рядом с `skills/maestro-new` (M-9).
  - **Очистка stale-артефактов (после `agpack sync`):** как в maestro-install.sh — удалить `.opencode/commands/maestro.md` и `.opencode/skills/maestro-init/`.
- **agpack.yml** (репо): `path: skills/maestro-init` → `skills/maestro-new`.
- **maestro-install/agpack.yml** (канон): то же.

### 4.4 Каскадные ссылки

| Файл | Правки |
|---|---|
| `skills/maestro/SKILL.md` | стр. 80 `@maestro`→`@maestro-init`; стр. 153–154: `skills/maestro-init/init-context.md`→`skills/maestro-new/init-context.md`, `/maestro-init`→`/maestro-new` + **фикс устаревшей семантики** («создаёт context + дизайн + scaffold + roadmap» → «создаёт context + конфиг; дизайн/scaffold/roadmap — /maestro-design»); стр. 1550 `/maestro-init`→`/maestro-new` + **семантический фикс** (roadmap создаёт `/maestro-design`, не `/maestro-new` — M-7) |
| `skills/maestro-design/SKILL.md` (10) | `/maestro-init`→`/maestro-new`; **удалить ссылку** на `specs/maestro-init-tasks-plan.md` (стр. 50) |
| `commands/maestro-design.md` (5) | `/maestro-init`→`/maestro-new` |
| `skills/maestro-assistant/SKILL.md` (3+3+1) | description стр. 3: «loaded by maestro-init»→`maestro-new` **и** «and maestro (pipeline config questions)»→`and maestro-init` (I-6); `/maestro-init`→`/maestro-new` (стр. 21, 82); `maestro-update.sh / /maestro-init`→`/maestro-new`; **`@maestro`→`@maestro-init`** (стр. 22, 38, 159 — вход в пайплайн) |
| `skills/maestro-feedback-report/SKILL.md` (3) | списки `<@maestro, @maestro-init, @maestro-design>`→`<@maestro-init, @maestro-new, @maestro-design>`; `skills/maestro-init/SKILL.md`→`maestro-new` |
| `skills/maestro-init/SKILL.md` (экс) | **удалить ссылки на исторические спеки** `specs/maestro-init-tasks-plan.md` (стр. 19) и `specs/init-idempotency-plan.md` (стр. 107) — промпты становятся самодостаточными (закрывает TODO.md:59), блочный replace не переписывает имена исторических спек |
| `agents/sanitizer.md` (1) | `(/maestro-init)`→`(/maestro-new)` |
| `commands/test-agents.md` (1) | `создаётся /maestro-init`→`/maestro-new` |
| `commands/maestro-assistant.md` (1) | redirect `@maestro`→`@maestro-init` (пайплайн) |
| `AGENTS.md` | стр. 8 `@maestro`→`@maestro-init`; стр. 9 `@maestro`→`@maestro-init`; стр. 11 `skills/maestro-init/{...}`→`skills/maestro-new/{...}` и `/maestro-init`→`/maestro-new`; стр. 13 (I-6): «loaded by init (tasks 2/3/3a) and maestro (pipeline config questions)»→«loaded by `/maestro-new` (tasks 2/3/3a) and `/maestro-init` (pipeline config questions)»; стр. 21 `/maestro-init`→`/maestro-new`, `@maestro`→`@maestro-init` |
| `plugins/maestro-bootstrap/core.js` (1) | комментарий стр. 5 «команду `@maestro`»→`@maestro-init` (только коммент, логика/тесты не меняются) |
| `README.md` (12 + /maestro) | таблица команд, флоу «/maestro-new → /maestro-design → /maestro-init», curl-URL скрипта → `maestro-install.sh`, секция структуры |
| `SECURITY.md` (1) | P5 «гейт на входе `/maestro`»→`/maestro-init` |
| `docs/project-context.md` (4) | списки команд и каталогов |
| `plugins/maestro-bootstrap/README.md` (1) | стр. 5 «команду `/maestro`»→`/maestro-init` |

### 4.5 manual_docs/ (13+ файлов)

Полный проход всех упоминаний `/maestro`, `/maestro-init`, `@maestro`, `maestro-init.sh`, `skills/maestro-init` **и path-формы `commands/maestro.md`** (M-10: `how-to/customize-maestro.md:44` «правьте `commands/maestro.md`» → `commands/maestro-init.md`):
`reference/commands.md`, `tutorials/setup-project.md`, `tutorials/run-first-feature.md`,
`how-to/install-maestro.md`, `how-to/update-maestro.md`, `how-to/keep-docs-up-to-date.md`,
`how-to/customize-maestro.md`, `overview/quick-start.md`, `overview/what-is-maestro.md`,
`explanation/pipeline-overview.md`, `explanation/agents-and-trust.md`,
`explanation/project-context.md`, `reference/config.md`, `reference/model-selection.md`,
`reference/hitl-gates.md`, `index.md`.

**Правила:**
- Исторические записи changelog не переписываются — только новая секция `[2026-09-01]`.
- По AGENTS.md: изменения команд/скиллов обязаны отражаться в manual_docs/ (критерий приёмки).

### 4.6 Версии

- `package.json`: 1.2.2 → **2.0.0** (по semver: breaking rename команд — мажорный bump; `expected_version` сверяется на равенство, функционального влияния нет, но разрыв совместимости зафиксирован корректно).
- `maestro.json`: `expected_version` → 2.0.0 (конвенция `chore(version)` + `chore(config)`).
- Changelog: секция «Изменено» + «Миграция» с предупреждением о семантическом свапе (UX-риск M-3).

## 5. Миграция существующих целевых проектов

После публикации (push в `main`) у целевых проектов `agpack sync` с устаревшей записью
`skills/maestro-init` упадёт с FetchError. Пути миграции (задокументировать в changelog + README):

1. Скачать заново `maestro-install.sh` и перезапустить (идемпотентен, **санитизирует agpack.yml перед sync**), **или**
2. Скачать/обновить `maestro-update.sh` (**rename-aware merge** заменяет запись `skills/maestro-init` → `skills/maestro-new`), **или**
3. Вручную заменить в `agpack.yml`: `path: skills/maestro-init` → `skills/maestro-new`.

**Очистка stale-артефактов (обязательно, agpack 0.3.1 не прунит):** после любого пути миграции удалить
`.opencode/commands/maestro.md` и `.opencode/skills/maestro-init/` (если есть) — скрипты делают это автоматически.

**Секвенсинг (self-hosted, M-4):** в авторском репо локальный `agpack sync` после переименования
упадёт (локальный agpack.yml уже ссылается на `skills/maestro-new`, которого нет на remote `main`).
Правило: **сначала push в `main`, затем `agpack sync`**. Порядок применяется и к самой разработке
(см. план — проверка миграции на scratch-проекте, не в авторском `.opencode/`).

**UX-предупреждение (M-3):** у пользователей с привычкой `/maestro-init` = bootstrap после обновления
команда попадёт в пайплайн фич; `/maestro` исчезает. Громкое предупреждение в changelog-секции
«Миграция» и README.

**Rollback (M-9):** `maestro-update.sh --pin <pre-rename-sha>` (например откат на 1.2.2) — канон
читается из нового пути `maestro-install/agpack.yml`, которого в старом коммите нет → `|| true` →
merge-блок (и rename-aware drop) пропускается целиком. `skills/maestro-init` при этом не воскрешается
(нет канона), но и `skills/maestro-new` не добавляется; `agpack sync` после отката упадёт с FetchError
на `skills/maestro-new` (нет в старом репо). Обход — ручной путь 3 (вернуть `path: skills/maestro-init`).
Документировать в changelog.

**Self-hosted stale-очистка (M-11):** после push→sync в авторском `.opencode/` останутся stale
`commands/maestro.md` и `skills/maestro-init/` (скрипты очистки нацелены на целевые проекты, авторский
репо синкается напрямую). Применить ту же очистку вручную к авторскому `.opencode/` после sync.

## 6. Критерии приёмки

- [ ] Нет ни одной ссылки на старое «setup-значение» `maestro-init` вне исторических записей (changelog, `specs/*`, `TODO.md` — трактуются как исторические; строка 53 TODO.md закрыта как реализованная).
- [ ] `node --test plugins/maestro-bootstrap/index.test.js` — 176/176 pass. Изменение плагина — только комментарий `core.js:5`.
- [ ] `bash -n maestro-install.sh maestro-update.sh` — синтаксис ок.
- [ ] Контрольный grep: `maestro-init` (пайплайн) и `maestro-new` (setup) расставлены корректно; `/maestro` как вход пайплайна не осталось (допускаются исторические записи и корректные упоминания скилла `maestro`). **Дополнительно (I-6):** нет bare-слов `init`/`maestro` в значении команд вне исторических записей (например в description-фронтматтере скиллов и AGENTS.md).
- [ ] manual_docs/ синхронизированы (AGENTS.md правило).
- [ ] **Runtime-проверка в песочнице** (`maestro-sandbox.sh` + чеклист): команды `/maestro-new`, `/maestro-design`, `/maestro-init` резолвятся; скилл `maestro-new` в списке `skill` tool; `/maestro` отсутствует. (Сам файл чеклиста имён команд не содержит — проверка рантаймовая.)
- [ ] Миграция проверена на scratch-проекте: старый agpack.yml → новый `maestro-update.sh` → запись `skills/maestro-init` заменена, **реальный** `agpack sync` (не только `--dry-run`) без ошибок; stale `.opencode/commands/maestro.md` и `.opencode/skills/maestro-init/` удалены.

## 7. Открытые вопросы

Базовые решения согласованы с пользователем (Q&A в сессии):
1. Скилл `maestro-init` переименовывается вместе с командой → `maestro-new`. ✅
2. Скилл `maestro` остаётся без изменений; команда `/maestro-init` грузит его. ✅
3. Скрипт и каталог → `maestro-install.sh` / `maestro-install/`. ✅
4. Миграция — rename-aware `maestro-update.sh`. ✅
5. Без стаба `/maestro` — чистый разрыв. ✅

**Revise-цикл (Spec Review, opus, 2026-09-01):** замечания I-1..I-5 + Minor учтены:
- I-1 каскад дополнен (`maestro-assistant` `@maestro`, полный AGENTS.md) ✅
- I-2 ссылки на исторические спеки удалены из скиллов (самодостаточность, закрыт TODO.md:59) ✅
- I-3 TODO.md трактуется исторически, стр. 53 закрывается ✅
- I-4 правка комментария `core.js:5` (логика/тесты не меняются) ✅
- I-5 prune-семантика agpack проверена эмпирически (не прунит) → очистка stale-артефактов в скриптах ✅
- Minor: версия 2.0.0, UX-предупреждение, секвенсинг push→sync, `--pin`-защита, переформулирован runtime-критерий ✅

**Revise-цикл 2 (Spec Review, opus, 2026-09-01):** закрыт I-6 + M-7..M-11:
- I-6 bare-слова в AGENTS.md:13 и maestro-assistant/SKILL.md:3 (description) → полные имена команд; проверка bare-слов добавлена в критерий 4 ✅
- M-7 roadmap создаёт `/maestro-design` (семантический фикс SKILL.md:1550) ✅
- M-8 usage/help + python-префиксы maestro-install.sh перечислены явно ✅
- M-9 rename-aware-правило переформулировано однозначно + rollback `--pin` документирован ✅
- M-10 path-форма `commands/maestro.md` (customize-maestro.md:44) в паттерн-листе ✅
- M-11 self-hosted очистка stale `.opencode/` ✅

<!-- maestro:review
reviewer: opus
date: 2026-09-01
verdict: approve
-->
<!-- maestro:sanitize
status: CLEAN
date: 2026-09-01 (refreshed after Revise-cycles 1-2; content has no sensitive data)
-->