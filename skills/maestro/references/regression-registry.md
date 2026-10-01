# Regression Registry (глава)

> Канон: regression-registry. Грузится из `skills/maestro/SKILL.md` на шаги 0/11/13f/15/17.
> Читается оркестратором (имеющим SKILL.md в контексте); внутри главы
> допускаются ссылки «см. SKILL.md, <секция скелета>» и на другие главы.

## Regression Registry

Реестр рисков регрессии: что под риском при изменении кодовой базы, в каких
модулях, какими сценариями это проверяется. Cross-feature агрегация —
через команду `@regression` (см. `commands/regression.md`).

**Канон** — эта глава. Pipeline встраивает 3 хука: анализ (шаг 11), запись
(шаг 12a), reconciliation (шаг 13f).

### Структура (реестр в git)

```
$REGISTRY_DIR = $(git rev-parse --show-toplevel)/regression
├── cancelled-features.md            ← решения об отменах (в git)
├── entries/YYYY-MM-DD-<feature>.md     ← active/verified (1 файл = 1 фича)
└── released/YYYY-MM-DD-<feature>.md    ← released/cancelled (архив)
```

- Реестр закоммичен в git (корень репо). Per-worktree остаётся `.maestro/`
   (в `.gitignore` целиком)
- `1 файл = 1 фича` — sharded append-only: конфликт параллельных pipeline
  маловероятен по построению (исключение — cross-entry reconciliation 13f,
  обновляющий чужой entry; при merge-конфликте — повторная reconciliation
  после мержа), flock не нужен
- Параллельные worktree: каждая фича коммитит свой entry в свою ветку;
  `@regression full/release` корректен на main после мержа веток
- Статус-мутации (`verified`/демоция/release/purge/cancel) → авто-коммит
  из `@regression`: `git add <entry> && git commit -m "chore(regression): ..."`
  (только конкретный путь, не `git add -A`); при неудаче — dirty + warning

### Формат entry

```md
# version: 1
- feature: etl-retry
- added: 2026-07-31
- status: active            # active / verified / released / cancelled
- last_full_pass:           # дата последнего зелёного full (пусто = не был)
- released:                 # дата перехода в released/cancelled (для purge)
- risk:
  - ETL Engine: HIGH
  - Webhook dispatcher: MEDIUM
- scenarios:
  - `src/ai-worker/processors/etl.processor.spec.ts:95` — retry при таймауте
    run: npm run test:unit -- --testPathPattern=etl.processor.spec.ts
    workdir: .
  - [Manual] Экспорт CSV 50k строк
```

- `path:line` — локатор для человека/отчёта; `run:` — что исполняется;
  `workdir:` — из какого каталога (резолв при записи, шаг 11). Опционально
  `timeout: <сек>` — per-scenario override дефолта 120с
- `[Manual]` — ручная проверка, автоматически не выполняется, release
  не блокирует (предупреждение в выводе)
- Матрица риска (анализ на шаге 11 по плану):
  Migration / Breaking change → HIGH; Cross-layer (≥3) / Public API → MEDIUM.
  Ни один сигнал → entry не создаётся

### Жизненный цикл (без git-детекта)

```
active ── full, все pass ──→ verified   (остаётся в entries/)
verified ── full, любой fail ──→ active  (демоция, last_full_pass очищается)
verified ── @regression release ──→ released
active ── отмена (Gate: отмена) ──→ released (status: cancelled)
```

- Cross-entry-обновления (13f, #103): `active` — только сценарии
  (локации/команды/ожидания), статусы не меняются (carve-out: empty-entry →
  `cancelled` через HITL); `verified` — read-only чек (расхождения — в отчёт
  13f), мутации — только через `@regression`
- `full` — единственный авторитет для `verified`; `smoke` статусы не меняет
- `full` на entry **без automated-сценариев** не верифицирует: статус не
  меняется, предупреждение в выводе (vacuous-full guard)
- Прогон и релиз развязаны: `full` ставит `verified`, перенос — только
  явный `@regression release`
- Проект на паузе: `entries/` не трогается никогда; purge работает только
  с `released/` (по возрасту от поля `released:`)
- Семантика статусов — без git (нет детекта мержей/diff). Персистентность —
  в git: каждая мутация статуса коммитится авто-коммитом


### Команда

`@regression smoke|full [active] [--timeout <сек>] | release | purge [days=30] | purge preview`
— подробности в `commands/regression.md`.

### Cross-entry reconciliation (13f) (#103, 4.19.0)

#### Selection (шаг 11)

- Источник — `regression/entries/`: `active` — мутации, `verified` —
  read-only чек; entry текущей фичи — исключена
- **Цель сценария** (repo-relative) — каскад:
  1. `path` (файл-часть, без `:line`);
  2. иначе file-аргумент `run:` (`grep`/`sed` — **последний** file-аргумент,
     не паттерн; `node --test <file>` — файл; `npm run <script>` — манифест
     сервиса/корня);
  3. ни `path`, ни file-аргумент — сценарий не выбирается (prose — known
     limitation); module-хинты «`(SKILL.md):`» не матчатся
- Пересечение с file-set плана (файлы задач + `## Project Context Changes` +
  path-резолвящиеся risk-модули); каталог-префиксы допустимы; пересечений нет → no-op
- **Cap ≤ 5** (порядок: число пересекающихся сценариев desc, тир `added` desc);
  остаток — в вывод 13f + progress-лог, не блокирует
- Результат — секция `## Cross-Entry Reconciliation` в плане (видна на гейте 12)

#### Сверка (шаг 13f)

- Пересечение пересчитывается по фактическому диффу; берётся **union** со
  списком плана (защита от дрейфа имплементации)
- **Existence — по ВСЕМ automated-сценариям** выбранного entry: цель —
  `test -f`; отсутствует → **A** (локус/цель отсутствует)
- **Diff-условные — по пересекающимся** (файл цели в диффе):
  - `path:line` — строка ≠ описанию (дрейф; **LLM-суждение** оркестратора,
    помечено) → **A**
  - числовое ожидание `→ N pass` / `→ N fail` / `→ 0` → **B** (stale)
- **0 запусков чужих тестов** (граница M6); carve-out — bounded-запуск
  одного сценария при решении (a)

#### HITL (решение)

- Факт расхождения — без HITL. Решение — **один гейт на все entries**
  (entry → сценарий → категория → a/b/c):
  - **(a)** обновить — локация: перегенерация **чтением файла**; число:
    **один bounded-запуск** этого сценария (carve-out); `run:` — по новой локации
  - **(b)** `[Manual]`; **(c)** удалить сценарий
- Auto-режимы: manual/auto-answer — гейт; auto-ai — решение ИИ с журналом
  (неуверенность → (a) + запись в журнал)
- **Пустой active-entry запрещён** — HITL: (a) перенос в `released/` со
  `status: cancelled` + `released: <дата>` (+ `cancelled-features.md`,
  формат гейта отмены) — единственный статус-переход хука

#### Границы мутации

- Только локации/команды/ожидания сценариев; НЕ: `status`, `last_full_pass`,
  `released`, `added`, `risk`, `version`, `feature` (новых полей нет)
- `verified` — read-only: расхождения — в отчёт 13f, без HITL/мутаций
- Авто-коммит — только путь entry: `chore(regression): <feature> entry
  reconciled by <текущая-фича>`; no-op: пустой список selection
