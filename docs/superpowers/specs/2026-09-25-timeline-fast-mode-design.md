# Spec: timeline.mjs — fast-mode (`--no-children`) + чистый stderr

- **Дата:** 2026-09-25
- **Ветка:** `feature/timeline-fast-mode`
- **Целевая версия:** 4.11.0 (minor — новый CLI-флаг)
- **Происхождение:** dogfooding 4.10.0 — живой прогон на сессии с 123 task-диспатчами
  (`ses_f3815a664ffeVmICSkqQEpvxtW`): полный прогон 2 мин 38 с (100 child-экспортов,
  cap 100, concurrency 4, ~6 c на процесс) + 101 строка `Exporting session: …` в
  stderr (прогресс opencode CLI, `stdio: inherit`) — визуальное впечатление «падает
  с ошибкой» (реально exit=0). Дизайн зафиксирован рекомендацией оркестратора,
  принятой пользователем (auto-ai запуск).

## 1. Цель

Убрать ложное впечатление ошибки (stderr) и дать предсказуемый быстрый режим
(~5 с) без child-атрибуции.

## 2. Non-goals

- Кэш child-экспортов (YAGNI: рераны редки; invalidation нетривиален — resumed
  child-сессии мутятся между прогонами).
- Изменение concurrency (4 — принято в спеке #109/#115, A1) и cap/timeout.
- Dead-code shim-скрипт в primary-экспорте (строки 88–94 `timeline.mjs` — пишется,
  не используется) — follow-up отдельно.
- Streaming-чтение JSONL, Error-классы (known-accepted, 4.10.0).

## 3. Дизайн

### 3.1 Флаг `--no-children` (fast mode)

- Парсинг: флаг принимается в **любом** порядке среди аргументов; позиционные —
  `[sessionID, path-to-export.json]` (как есть). Usage:
  `Usage: timeline.mjs <sessionID> [path-to-export.json] [--no-children]`.
- Эффект: child-пул (`exportSession` по task-частям) **не запускается**;
  stdout-JSON: `metrics.tokensByAgent: {}` и новое поле
  `metrics.children: "skipped"`.
- В обычном режиме поле `metrics.children: "full"` (аддитивное, backward-compat:
  все прежние ключи/значения без изменений).
- JSONL-строка (`.maestro/metrics/history.jsonl`) включает то же поле
  `children` — upsert-семантика без изменений.
- Остальные метрики (`tokens`, `activeMs`, `questionCount`, `reviewDispatches`)
  считаются как всегда (не зависят от child-пула).

### 3.2 Чистый stderr

- Обе spawn-точки (`opencode export`: primary ~строка 99, child ~строка 50):
  `stdio: ["ignore", fd, "pipe"]` вместо `inherit`.
- `child.stderr` — в буфер с обрезкой хвоста (~500 байт, только хвост хранится).
- При **успехе** — буфер отбрасывается (в stderr ничего не пишут).
- При **сбое** (timeout / non-zero exit / parse-error / spawn error) — ОДНА
  строка в stderr: `[timeline] export failed: <sessionID> — <tail>`. Для
  child-экспорта сбой, кроме того, учитывается в `tokensByAgent.failed`
  (fail-soft, как сейчас); для primary — прежний `{"error":"export_failed"}` +
  exit 1 (диагностическая строка stderr не мешает JSON-stdout контракту).
- SEC-4b: stderr-строки — диагностика для оператора (sessionID + хвост вывода
  CLI), не попадают в отчёт и stdout-JSON.

### 3.3 SKILL.md (`skills/maestro-feedback-report/SKILL.md`)

- Секция 3c (запуск helper): строка — «сохрани stdout в temp-файл и переиспользуй
  (3c/3d/шаблон); НЕ перезапускай скрипт — полный прогон с child fanout 2–4 мин».
- Секция 3d: строка про fast mode — флаг `--no-children` (~5 с); при
  `metrics.children: "skipped"` — `tokensByAgent` пуст, атрибуция недоступна.
- Шаблон отчёта, таблица «Токены по агентам»: fallback — при
  `children: "skipped"` вместо таблицы: «Атрибуция по агентам недоступна
  (fast mode `--no-children`)».

### 3.4 DoD-волна (доки)

- `manual_docs/overview/changelog.md` — `## [Unreleased] → ### Добавлено`, буллит
  4.11.0 (fast mode + чистый stderr + known limitation полного прогона).
- `manual_docs/reference/commands.md` — в описании `@maestro-feedback-report`
  (секция «Метрики пайплайна и Effort») — одна строка про `--no-children`.
- `regression/entries/2026-09-25-timeline-fast-mode.md` — канонический формат
  (known limitation: полный прогон ~2–4 мин при cap-100 child; тесты; SEC-4b;
  non-goals из §2).
- `docs/project-context.md` §10 — счётчик timeline-тестов по факту прогона.
- `docs/roadmap.md` — НЕ меняется (не roadmap-пункт).
- `package.json` — bump на шаге 18 (не на ветке).

## 4. Тесты (TDD, `timeline.test.mjs`)

1. `--no-children`: stdout-JSON — `metrics.children === "skipped"`,
   `tokensByAgent === {}`, primary-метрики на месте (fixture mode).
2. Обычный прогон: `metrics.children === "full"` (regression-гард нового поля).
3. Flag-ordering: `--no-children` первым/последним/между позиционными — работает;
   usage-ошибка при отсутствии sessionID не изменена.
4. JSONL: строка в fast mode содержит `children: "skipped"`; upsert при повторном
   прогоне (fast после full) заменяет строку.
5. Чистый stderr (реальный spawn, не fixture): fake-`opencode` (sh-скрипт в
   temp-dir в PATH: пишет строку прогресса в stderr + JSON в stdout) — при
   успешном прогоне stderr helper пуст; при сбое fake-CLI (non-zero exit + текст
   в stderr) — ровно одна диагностическая строка с tail'ом.

Базовый прогон: существующие 24 теста — без изменений (backward-compat).

## 5. Риски / безопасность

- SEC-4b: без изменений (stdout — агрегаты; stderr — диагностика оператора,
  не в отчёте).
- Backward-compat: stdout-контракт аддитивен (`children`, `--no-children`);
  SKILL.md-инструкции и отчётный шаблон обновлены синхронно.
- Known limitation (фиксируется в regression entry): полный прогон ~2–4 мин при
  cap-100 child-сессиях — ожидаемо, есть fast mode.

## 6. Критерии приёмки

1. `--no-children` — прогон ~5 с, `children: "skipped"`, `tokensByAgent: {}`.
2. Полноценный прогон (dogfooding на сессии с child-сессиями): stderr пуст
   (успех); при искусственном сбое child — одна диагностическая строка.
3. Тесты: все зелёные (24 baseline + новые), плагин 250/250 (не тронут).
4. Доки синхронны (changelog/commands/regression/project-context).
5. Версия 4.11.0 (bump после merge).

<!-- maestro:sanitize
status: CLEAN
date: 2026-09-25
hash: 966d1e6df0dee1004e27b8a385d2c98713f26ef1192a709282d2ea10836d1551
-->
