# Работа с реестром регрессии

[Назад к оглавлению](../index.md)

## 🎯 Назначение

Реестр регрессии (`regression/`) фиксирует, какие модули под риском при
изменении кодовой базы и какими сценариями это проверяется. Это cross-feature
агрегация рисков — см. команду `@regression`.

## 📖 Структура реестра

```
$REGISTRY_DIR = $(git rev-parse --show-toplevel)/regression
├── cancelled-features.md            ← решения об отменах
├── entries/YYYY-MM-DD-<feature>.md     ← active/verified (1 файл = 1 фича)
└── released/YYYY-MM-DD-<feature>.md    ← released/cancelled (архив)
```

Реестр закоммичен в git (корень репо). Per-worktree остаются только эфемерные
файлы в `.maestro/` (sdd/, sanitizer-log, last-run) — они в `.gitignore`.

## 📖 Как это встраивается в pipeline

| Хук | Шаг | Что происходит |
|---|---|---|
| Анализ | шаг 11 | Оркестратор определяет risk-модули и сценарии по матрице риска |
| Запись | шаг 12a | Создаётся `entries/YYYY-MM-DD-<feature>.md` (без HITL) |
| Reconciliation | шаг 13f | После реализации сценарии сверяются с кодом |

**Матрица риска (анализ на шаге 11):**
- Migration / Breaking change → HIGH
- Cross-layer (≥3) / Public API → MEDIUM
- Ни один сигнал → entry не создаётся

## 📖 Команды `@regression`

| Команда | Назначение |
|---|---|
| `@regression smoke` | Быстрый прогон (статусы не меняет) |
| `@regression full` | Полный прогон — единственный авторитет для статуса `verified` |
| `@regression release` | Перевод verified-фич в `released/` |
| `@regression purge [days]` | Удаление старых `released/`-записей |
| `@regression purge preview` | Предпросмотр того, что будет удалено |

**Жизненный цикл статусов:**
```
active ── full, все pass ──→ verified   (остаётся в entries/)
verified ── full, любой fail ──→ active  (демоция)
verified ── @regression release ──→ released
```

## 💡 Формат entry

```md
# version: 1
- feature: etl-retry
- added: 2026-07-31
- status: active
- risk:
  - ETL Engine: HIGH
- scenarios:
  - `src/.../etl.processor.spec.ts:95` — retry при таймауте
    run: npm run test:unit -- --testPathPattern=etl.processor.spec.ts
    workdir: .
```

- `[Manual]` — ручная проверка, автоматически не выполняется.
- Регрессия **не** запускается автоматически на шаге 15 — только standalone
  по явному запросу `@regression`.

## 🔗 Связанные разделы

- [Команды](../reference/commands.md)
- [Устройство pipeline](../explanation/pipeline-overview.md)