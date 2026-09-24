# Spec: метрики пайплайна и Effort в `@maestro-feedback-report` (#109 + #115)

Дата: 2026-09-24. Маршрут: feature (Сложная). Режим: auto-answer.
Основание: TODO-пункты «Итоговая статистика… где фиксировать?» (#109) и
«Замер/Оценка Effort, уточнить методологию…» (#115); роадмап Волна 2
(`docs/roadmap.md`: «#109 + #115 — единый блок метрик пайплайна в
feedback-report: циклы (в т.ч. циклы ревью), токены, длительности (переиспользовать
4.5.0-таймлайн: `opencode export` + `timeline.mjs`, 0 LLM) + методология Effort и
факторы влияния»).

## Проблема

`@maestro-feedback-report` (4.5.0) собирает таймлайн/длительности, но не
покрывает «итоговую статистику» запуска: токены (в т.ч. по сабагентам), cost,
количество циклов (в т.ч. циклов ревью), HITL-активность, нормализованное
активное время. Нет зафиксированной методологии Effort (что влияет на effort
положительно/отрицательно) и места накопительной фиксации метрик между
запусками (для будущей статистики, в т.ч. #89).

## Решение

Единый блок «Метрики пайплайна и Effort» в feedback-report: **механика — 0 LLM**
(расширение helper `timeline.mjs`, тот же источник — `opencode export`),
**нарратив — LLM** (раздел «Факторы влияния»). Фиксация — раздел отчёта +
накопительная JSONL-история `.maestro/metrics/history.jsonl`.

### 1. Расширение `skills/maestro-feedback-report/timeline.mjs`

Новый блок в stdout-JSON: **`metrics`** (существующие ключи
`session/totals/agents/tools/bash/top_ops/gaps/timeline` — без изменений,
backward-compat).

- **`metrics.tokens`** (primary-сессия): `{ input, output, reasoning,
  cacheRead, cacheWrite, cost }` — сумма `info.tokens` по assistant-сообщениям
  (совпадает с `info.tokens` экспорта); `cost` — сумма `info.cost`,
  **`null` при отсутствии прайсинга** (все `cost` = 0/absent → `null`;
  валидное число > 0 → число).
- **`metrics.tokensByAgent`** (по `subagent_type`): `{ count, input, output,
  reasoning, cacheRead, cacheWrite, skipped, failed }` — токены child-сессий
  сабагентов: для каждой `task`-части `state.metadata.sessionId` → отдельный
  `opencode export <childSessionId>` → `info.tokens`. Детерминированная
  атрибуция: child-ID берётся только из metadata (не из output).
  - **Стратегия child-экспорта (A1):** concurrency **4** (фиксировано для
    детерминизма; согласованный диапазон 4–5), **cap 100**
    child-экспортов на запуск; over-cap и
    неуспевшие — `skipped`, ошибки экспорта (сбой/`invalid_export`) —
    `failed`. **Fail-soft:** любой сбой child не блокирует основной вывод.
  - `task`-части без `metadata.sessionId` — не попадают ни в count, ни в
    счётчики (исключение не считается).
  - Пересчёт дублей: если один child-`sessionId` встречается в нескольких
    `task`-частях — токены учитываются **один раз** (unique по sessionId),
    `count` — количество task-частей.
- **`metrics.activeMs`** — `session.durationMs − totals.idleWaitMs`
  (активное время без ожидания пользователя; floor 0; `null`, если
  `session.durationMs` — `null`).
- **`metrics.questionCount`** — количество `question`-tool-частей (HITL-гейты).
- **`metrics.reviewDispatches`** — количество `task`-частей, чей
  `state.title` матчит `/review|ревью/i` (case-insensitive). **Только
  счётчик** — title не выводится в stdout-JSON (SEC-4b); title уже
  санирован плагином (Level 1) до диспатча. Хэвистика задокументирована:
  ложные срабатывания/пропуски допустимы (агрегат-ориентир, не истина).
- **JSONL-история (A2):** helper **сам** пишет строку в
  `.maestro/metrics/history.jsonl` (каталог создаётся; одна JSON-строка на
  запуск): `{ sessionID, date (YYYY-MM-DD), metrics }` (metrics — тот же
  блок, что в stdout, без `timeline`). **Upsert по `sessionID`**: при
  повторном запуске для той же сессии старая строка заменяется новой
  (идемпотентность регенерации отчёта). **Fail-soft:** отсутствие/недоступность
  `.maestro/` → строка не пишется, вывод в stdout не меняется (stderr —
  опциональный диагностический log).
- **Fallback:** `export_failed`/`invalid_export` — поведение без изменений
  (stderr-код, как сейчас); `metrics` в этом случае не выводится (нет данных).

### 2. Новый раздел отчёта `skills/maestro-feedback-report/SKILL.md`

После «Таймлайн и длительности операций» (B1) — раздел **«Метрики пайплайна и
Effort»**:

- **Источники:** `metrics`-блок `timeline.mjs` (механика) + bootstrap-лог
  (retry — уже в 3a) + ход диалога (LLM: циклы, факторы).
- **Итоговая статистика** (таблицы/буллеты, только агрегаты — SEC-4b):
  - Токены: total (input/output/reasoning/cache) + cost (`—` при `null`);
  - Токены по агентам: таблица `subagent_type | диспатчей | input/output |
    skipped/failed` (при `skipped`/`failed` > 0 — пометка
    «атрибуция неполная: N пропущено/сбой»);
  - Активное время: `activeMs` (wall − user_wait) + доля от wall;
  - HITL: `questionCount` (+ retry из 3a);
  - Циклы ревью: `reviewDispatches` (механический ориентир) + LLM-нарратив
    «сколько фактических циклов ревью/фиксов было и почему» (из диалога).
- **Методология Effort (#115, D3 — без числового score):**
  - Effort — это **итоговая статистика + нормализованное активное время +
    факторы влияния**; числового балла/шкалы нет (YAGNI; калибровка по базе
    запусков — задача #89, отдельный research).
  - **Факторы влияния (+/−):** LLM-разбор по собранным данным (паттерн 3c
    «Что повлияло»): что определяло длительность/токены (агенты, циклы
    ревью, паузы, stop-and-fix), что помогло/вредило; формулировки
    обезличенные (SEC-4b).
- **Fallback:** `metrics` отсутствует (export сбой/нет) →
  «Нет данных по метрикам: <причина>» (паттерн 3c, pipeline не блокируется).
- **JSONL-история** — упоминается в разделе одной строкой («механика пишет
  `.maestro/metrics/history.jsonl` (upsert по sessionID); эфемерное, gitignored»)
  — пользователю, без инструкций по анализу (агрегатор — non-goal).

### 3. Что НЕ меняется (non-goals, B3)

- **#89** (майк-оценки), **#95** (сокращение ревью), **#107** (типы
  артефактов) — не затрагиваются.
- Кросс-сессийный **агрегатор** по `history.jsonl` — не строится
  (файл — накопительная база для будущих потребителей, в т.ч. #89).
- **Пайплайн maestro** (`skills/maestro/SKILL.md`) — без изменений: режимы
  шага 18.5 (#113), гейты, промпты — как есть. Изменения — только
  feedback-report-скилл + helper + доки.
- **Числовой Effort-score** — не вводится.
- `maestro.json` — новых ключей нет.
- Экспортируемая форма `timeline.mjs` (args, temp-файл экспорта, fallback-коды)
  — без изменений; только добавление блока `metrics` + JSONL-запись.

## Файлы

| Файл | Изменение |
|---|---|
| `skills/maestro-feedback-report/timeline.mjs` | блок `metrics`, child-экспорт (concurrency 4–5, cap 100, fail-soft), JSONL upsert |
| `skills/maestro-feedback-report/timeline.test.mjs` | новые тесты (baseline 11) |
| `skills/maestro-feedback-report/SKILL.md` | раздел «Метрики пайплайна и Effort» + шаблон отчёта |
| `manual_docs/reference/commands.md` | синк описания `@maestro-feedback-report` (новый раздел) |
| `manual_docs/overview/changelog.md` | `[Unreleased]` → буллит фичи |
| `docs/project-context.md` | §10 (число timeline-тестов), при необходимости §14 |
| `docs/roadmap.md` | #109/#115 → выполнено (4.10.0) |
| `regression/entries/2026-09-24-pipeline-metrics-effort.md` | новая entry |

## Тестирование

- **`timeline.test.mjs`** (baseline 11, extend):
  - `metrics.tokens` — агрегация по assistant-сообщениям; cost: 0/absent →
    `null`, > 0 → число;
  - `tokensByAgent` — атрибуция по child-экспорту (mock-экспорт: fixture-JSON
    файла, 2-й аргумент-механизм расширить на child? — **нет**: child-экспорт
    тестируется через фикстуру + monkey-patch spawn или вынос функции
    `exportSession()` в экспорт-модуль для unit-теста — решение в плане),
    unique по sessionId (дубль → 1 учёт), over-cap → `skipped`, сбой →
    `failed`, без `metadata.sessionId` → игнор;
  - `activeMs` (floor 0), `questionCount`, `reviewDispatches` (title-матч,
    регистр, кириллица);
  - JSONL: запись строки, upsert по sessionID (повторная запись → одна
    строка), fail-soft (недоступный путь → stdout не меняется);
  - **backward-compat**: существующие ключи stdout-JSON идентичны
    (отдельный тест-ассерт на ключи/структуру).
- **Плагин:** `node --test plugins/maestro-bootstrap/index.test.js` — без
  регрессий (baseline 250) — плагин не меняется, контроль регресса.
- **E2E-смоук:** `./maestro-sandbox.sh` (чеклист) — без изменений поведения
  feedback-report в сценариях чеклиста.

## Риски

1. **Производительность child-экспорта** — до cap 100 × ~1–2 c (concurrency
   4–5 → до ~25–40 c в худшем случае). Митигация: cap + fail-soft; отчёт
   собирается после завершения пайплайна (не в критическом пути).
2. **`reviewDispatches` — хэвистика** — ложные срабатывания/пропуски.
   Митигация: пометка «механический ориентир» + LLM-нарратив как истина.
3. **Дрейф формата `opencode export`** — новые/переименованные поля
   (`info.tokens`, `state.metadata.sessionId`). Митигация: fail-soft
   (отсутствие поля → 0/null/skipped), backward-compat-тест на ключи.
4. **SEC-4b** — child-транскрипты читаются helper'ом полностью. Митигация: в
   stdout/JSONL/отчёт — только агрегаты; temp-файлы экспортов удаляются
   (как у primary); title не выводится.
5. **Версия** — 4.10.0 (B2): main 4.9.0, фича → minor; роадмап-метка волны
   «4.8.x» — историческая (зафиксировать пометку в roadmap, паттерн #113).

## Ключевые решения

| # | Решение | Источник |
|---|---|---|
| D1 | Токены: primary + child-сессии сабагентов (fail-soft → primary-only) | HITL (plan-консультация) |
| D2 | Циклы: механика (счётчики) + LLM-нарратив | HITL (plan-консультация) |
| D3 | Effort: метрики + активное время + факторы; без числового score | HITL (plan-консультация) |
| D4 | Фиксация: раздел отчёта + `.maestro/metrics/history.jsonl` | HITL (plan-консультация) |
| A1 | Child-экспорт: concurrency 4–5, cap 100, fail-soft | HITL (brainstorm, пакет A) |
| A2 | JSONL пишет helper (upsert по sessionID) | HITL (brainstorm, пакет A) |
| A3 | `reviewDispatches` — title-хэвистика в helper (только счёт) + LLM-нарратив | HITL (brainstorm, пакет A) |
| B1 | Отдельный раздел после «Таймлайн и длительности» | HITL (brainstorm, пакет B) |
| B2 | Версия 4.10.0 (minor, фича; main = 4.9.0) | HITL (brainstorm, пакет B) |
| B3 | Минимальный scope (non-goals — §3) | HITL (brainstorm, пакет B) |
| D-O1 | Тестирование child-экспорта — через вынос `exportSession()` в тестируемую форму (решение в плане) | оркестратор (auto-answer) |

## Acceptance Criteria

1. `timeline.mjs` выводит блок `metrics` (§1) при валидном экспорте;
   существующие ключи не изменены (тест backward-compat).
2. Числа в разделе «Метрики пайплайна и Effort» отчёта совпадают с
   `metrics`-блоком (0 LLM в механике).
3. JSONL: одна строка на sessionID, повторный запуск — замена строки.
4. Отчёт и JSONL не содержат title/текстов/путей (SEC-4b).
5. Все fail-soft-сценарии (нет `.maestro/`, сбой child-экспорта, over-cap,
   отсутствие `metadata.sessionId`, `cost` без прайсинга) — pipeline и вывод
   не блокируются.
6. Тесты: `timeline.test.mjs` зелёные (11 baseline + новые), плагин 250/250,
   `./maestro-sandbox.sh` без деградаций.
7. Доки синхронизированы (manual_docs, project-context, roadmap, regression
   entry) — DoD волны.
