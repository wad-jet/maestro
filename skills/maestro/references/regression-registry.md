# Regression Registry (глава)

> Канон: regression-registry. Грузится из `skills/maestro/SKILL.md` на шаги 0/15/17.
> Читается оркестратором (имеющим SKILL.md в контексте); внутри главы
> допускаются ссылки «см. SKILL.md, <секция скелета>» и на другие главы.

## Regression Registry

Реестр рисков регрессии: что под риском при изменении кодовой базы, в каких
модулях, какими сценариями это проверяется. Cross-feature агрегация —
через команду `@regression` (см. `commands/regression.md`).

**Дизайн:** `docs/regression-flow.md` (источник истины). Pipeline встраивает
3 хука: анализ (шаг 11), запись (шаг 12a), reconciliation (шаг 13f).

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
  невозможен по построению, flock не нужен
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

- `full` — единственный авторитет для `verified`; `smoke` статусы не меняет
- Прогон и релиз развязаны: `full` ставит `verified`, перенос — только
  явный `@regression release`
- Проект на паузе: `entries/` не трогается никогда; purge работает только
  с `released/` (по возрасту от поля `released:`)
- Семантика статусов — без git (нет детекта мержей/diff). Персистентность —
  в git: каждая мутация статуса коммитится авто-коммитом

### Команда

`@regression smoke|full [active] [--timeout <сек>] | release | purge [days=30] | purge preview`
— подробности в `commands/regression.md`.
