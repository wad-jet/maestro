# Команды

[Назад к оглавлению](../index.md)

## 🎯 Назначение

Справочник доступных `@command` для работы со скиллом `maestro`. Конфиги живут
в `commands/*.md` (authoring-репо); доставляются в целевое приложение
штатным механизмом: `maestro-install.sh` / `maestro-update.sh`
(wholesale copy из git-репозитория) или вручную из удалённого репозитория.
При **глобальной установке** OpenCode загружает команды из
`~/.config/opencode/commands/` (доступны во всех проектах); при проектной —
из `.opencode/commands/` проекта.

## 📖 Команды

### `/maestro-init`

Вход в pipeline: загружает скилл `maestro` и следует pipeline из SKILL.md.
Работает в любой primary-сессии (привязки к агенту нет).

**Режимы запуска** (per-run флаг, не персистится):

```
/maestro-init                                # manual — задача из контекста сессии
/maestro-init "задача"                        # manual — задача в параметре (обратная совместимость)
/maestro-init --auto-answer                  # auto-answer (-aa): полный флоу, задача из контекста
/maestro-init --auto-answer "задача"          # auto-answer (-aa): полный флоу, задача в параметре
/maestro-init --auto-ai                      # auto-ai (-ai): ИИ решает сам с доп. анализом (ralph loop)
/maestro-init --no-auto "задача"              # явный manual
/maestro-init --plain                         # простой язык (без задачи)
/maestro-init --plain "задача"                # простой язык (с задачей)
```

Если `@maestro-init` вызван **без задачи** — пайплайн загружается, затем оркестратор анализирует контекст текущей сессии, формулирует задачу и показывает её для HITL-подтверждения. Если контекста нет — обсуждение задачи начинается с нуля (brainstorming-путь).

**Обратная совместимость:** все вызовы с текстом задачи (`@maestro-init "текст"`) работают как раньше.

**`--plain`:** не режим запуска (ортогонален флагам режимов). Включает простой
язык на этот запуск; флаг > конфиг `maestro.json` (`communication`).
Канон — SKILL.md, секция «Простой язык»; ключ — [Конфигурация](config.md).

Подробнее о поведении гейтов по режимам — [HITL-гейты](hitl-gates.md).

**Memory layer:** в Plan mode (ресеч, обсуждение фичи/багфикса, подготовка
spec) и на ресече bugfix — сначала `memory_search` по теме задачи (канон —
`skills/maestro/references/memory-layer.md`, детали —
[Память maestro](memory.md)); память не включена → молча пропуск.

### `/regression`

Регрессионный прогон по реестру рисков (`regression/`, в git). Standalone —
**не** часть pipeline шага 15. Подробнее — [Работа с реестром регрессии](../how-to/use-regression-registry.md).

```
/regression smoke                    # HIGH: active + verified, статусы не меняет
/regression smoke active             # HIGH: только active
/regression full                     # всё: active + verified
/regression full active              # всё: только active
/regression full --timeout 300       # глобальный timeout (дефолт 120с)
/regression release                  # ВСЕ verified → released (строгий гейт)
/regression purge [days=30]          # ротация архива (HITL)
/regression purge preview            # предпросмотр удаляемого
```

### `/maestro-setup`

Быстрый старт: проверка предусловий, конфигурация (`maestro.json` + permissions
+ модели + `.gitignore` + `regression/`), структура каталогов. `docs/project-context.md`
(14 категорий из `init-context.md`) — **опциональный** финальный шаг (может быть
создан позже через `/maestro-design`). Использует скилл `maestro-setup`.
Проверяет: `AGENTS.md` (встроенный `/init`), скилы superpowers (предлагает
установку через HITL), плагин `maestro-bootstrap` (не блокер).

**Глобальная установка** (`maestro-install.sh --global`): создаёт
`.maestro/maestro.json` с `memory.enabled: true` + auto-derive namespace из
git remote (1–3 сегмента; см. [Память maestro](memory.md) → «Auto-derive
namespace»); по умолчанию **не** создаёт root `maestro.json` и `.opencode/`
зеркало (скиллы глобальные); модели агентов — в глобальном
`~/.config/opencode/opencode.json`.

### `/maestro-design`

Дизайн/архитектура, scaffold и roadmap — после `/maestro-setup` или самостоятельно
(project-context.md может отсутствовать; будет warning, но не блокировка):
- (a) spec через **primary brainstorm (superpowers:brainstorming) + custodian Q/A (trusted)** → spec пишет primary → `docs/superpowers/specs/YYYY-MM-DD-<project>-design.md`; опц. spec-review (`opus`).
- (b) scaffold — каркас кода через `implementer-prompt.md` (TDD), диспатч `haiku`/`sonnet`.
- (c) `docs/roadmap.md` (MVP + этапы).
Модели агентов наследуются из `.opencode/opencode.json` или global (не переспрашивает).
Если `project-context.md` отсутствует — шаг «Project Context» (опциональный) для создания; pipeline продолжает работу.

### `/maestro-feedback-report`

Сбор фактуры по прошлым процессам maestro **в текущей сессии** для последующей
ретроспективы (что было хорошо / плохо / с какими проблемами). Использует скилл
`maestro-feedback-report`. Отчёт —
`.maestro/feedback-reports/report-<Session ID>-<YYYY-MM-DD>.md`.

**U1 (2026-10-04): Одна сессия = один файл.** При повторной генерации отчёта
для той же сессии:
- предыдущий срез перемещается в `.maestro/feedback-reports/archive/`
- в архивный файл добавляется marker `<!-- superseded → <путь> -->`
- `## Пользовательский фидбек` переносится verbatim из старого отчёта
- Новый срез получает номер `Slice: <date> #<N>` (N++ при регенерациях)

**U5 (2026-10-04): Heartbeat аудит-лога.** При чтении audit-log:
- проверяется существование файла (`maestro-audit-YYYY-MM-DD.log`)
- если файл не найден → warning "аудит-лог не создан"
- если файл пуст → "аудит-лог пуст (нет confidential-событий)"
- секция "Безопасность" показывает статус heartbeat

**U6 (2026-10-13): Верификация записи.** Перед сообщением «Отчёт сохранён в
`<путь>`» — обязательная bash-проверка существования файла (`ls -la`, размер > 0);
путь без подтверждённого файла не сообщается.

**U4 (2026-10-04): Неблокирующий фидбек.** Info-line при завершении:
- `> 💡 Для комментариев напишите ответ в эту сессию.`
- не блокирует (нет HITL-вопроса)
- пользователь сам пишет или пропускает

Основной источник — диалог сессии; дополняется данными из логов плагина
(`maestro-bootstrap-*.log`) при наличии записей по `sessionID`. Отдельно
фиксируются нарушения инвариантов ⚑1–4 (секция «Нарушения инвариантов ⚑1–4»;
канон — `skills/maestro/invariants.md`). Отчёт содержит секцию «Таймлайн и
длительности операций» — сокращённый таймлайн сессии и длительности отдельных
операций (task-диспатчи по агентам, tools, bash-команды, дольшие операции и
паузы; источник — данные opencode-сессии через `opencode session export` +
helper `timeline.mjs` скилла). После генерации
отчёта — HITL-гейт: пользователь может оставить комментарии/рекомендации, которые
записываются в секцию `## Пользовательский фидбек` отчёта. Автокоммит не требуется.
Отдельная секция `## Memory layer usage`: статус памяти (подключена/нет),
обращения `memory_search` (точка, число найдено, оценка эффективности) и
**статус обязательных точек** (старт Plan-фазы, ресеч bugfix D1–D2): выполнена
/ НЕ выполнена + причина («memory layer не подключен» / «точка не достигнута»
— информационно / «пересмотр» — нарушение); только агрегаты (SEC-4b).
**Метрики пайплайна и Effort** (4.10.0): итоговая статистика запуска —
токены (primary-сессия + по сабагентам через child-сессии), cost (— при
отсутствии прайсинга), активное время (wall − user_wait), HITL-гейты,
retry, циклы ревью (механический ориентир + нарратив); методология Effort —
без числового score (статистика + факторы влияния). Механика — `timeline.mjs`
(0 LLM, concurrency 4 / cap 100 / таймаут 30 c, fail-soft); накопительная
история — `.maestro/metrics/history.jsonl` (эфемерное, gitignored).
  Fast mode `--no-children` (запуск ~5 c, без атрибуции по агентам;
  `metrics.children: "skipped"`).
Режим пайплайна (`maestro.json → feedback_report`: `manual` дефолт / `auto` /
`disable`) управляет авто-вызовом на шаге 18.5; сама команда всегда
интерактивна. Смена режима — перезапуск opencode.

### `/test-agents`

Проверка всех сабагентов maestro **реальным диспатчем**: каждой из 7 моделей
(`custodian`, `haiku`, `sonnet`, `opus`, `fable`, `reviewer`, `sanitizer`)
даётся одинаковая тривиальная тестовая задача («Верни OK. Не используй
инструменты.») через `subagent` tool. Возвращает сводную таблицу статусов
с колонками: `Модель (факт)` — из `info.model` child-сессии
(`opencode session export`), `Variant` — из `info.model.variant`
(если поле отсутствует — `—`), `Причина`. Конфиги не читаются —
проверяется реальная работа модели.

Колонка `Self-report` удалена: self-report моделей эмпирически ненадёжен
(прогон 2026-10-19 — 4/7 искажений: haiku «unknown-model», reviewer — имя
агента «assistant», sonnet/fable — эхо метки primary-сессии). Факт модели —
только из session export.

**Почему в таблице нет Temperature.**
OpenCode не экспонирует applied temperature: нет ни в `opencode session export`
(там `providerID`/`id`/`variant`), ни в bootstrap-логах. Модель не знает свою
temperature — это параметр сэмплирования, невидимый для модели (аналогично
тому, как `max_tokens` или `seed` не являются частью контекста). Self-report
температуры — галлюцинация.
Поэтому:
- **Тестовая задача** — тривиальная («Верни OK»), чтобы минимизировать
  влияние temperature на результат проверки (проверяется доступность модели,
  а не качество генерации).
- **Вывод в таблицу** — только фактические поля (model/variant), доступные
  из session export.
Это не баг команды — это ограничение OpenCode, а не задача maestro.

Дополнительно проверяется **confidential-инвариант** (P1/P3, `SECURITY.md`):
trusted-агенты (`custodian`, `sanitizer`) читают `docs/confidential/**`, а
primary-сессия при чтении того же файла получает `deny`. Статус инварианта —
`PASS` / `FAIL` (утечка → СТОП) / `skipped` (нет `docs/confidential/**`).

### `/maestro-version`

Показать фактическую версию плагина `maestro-bootstrap`, подключённого в текущей
сессии. Читает `.maestro/plugin-version` (пишется при инициализации плагина);
при **глобальной установке** — fallback на глобальный
`~/.config/opencode/.maestro/plugin-version` (пишут
`maestro-install.sh --global` / `maestro-update.sh --global`). Если обоих
файлов нет — сообщает, что плагин не инициализирован или версия неизвестна
(признак сбоя init плагина).

### `/maestro-assistant`

Консультации и настройка maestro-конфигурации/структуры/контекста в течение жизни
проекта. Загружает скилл `maestro-assistant` (tool: skill) и применяет его к запросу HITL.
Обрабатывает: `maestro.json` (trust/confidential/sanitizer_whitelist;
чтение параметров — плагин-тулом `maestro_config`),
`.opencode/opencode.json` / global (плагин, модели), структуру каталогов,
актуализацию `project-context.md`, консультации по
правилам работы maestro. Плагин-гейт не требуется. Если запрос требует изменения кода/spec/плана
или запуска pipeline — редирект на `@maestro-init`/`/maestro-design`/`@regression`.

### `@maestro-memory`

Статус memory layer плагина `maestro-bootstrap`: бэкенд, модель, активный `key`,
число записей (по авторам и датам), кластеры/граф, подсказки по тюнингу
(`top_k`, `min_score`, `retention_days`). Данные — из `memory_stats_detail` +
секция `memory` плагин-тулом `maestro_config` (тул недоступен —
«перезапустите opencode / обновите плагин», конфиг не читается). Только
агрегаты (SEC-4b). При недоступном
`memory_stats_detail` команда различает: «память выключена» (`memory.enabled:
false`), «конфиг-невалиден» (честная причина по `disabled_reason`) и «плагин
недоступен» (`enabled: true` + инструмент недоступен → перезапустить opencode).
Блок **«Не индексированные сессии: N»** — cap 20 строк; N>0 — предложить
`@maestro-memory-reindex` (явные session_id из списка). Реализация — скилл
`maestro-memory` (tool: skill): ядро (канон гейта доступности) +
`references/status.md`. Подробнее — [Память](../reference/memory.md).

### `@maestro-memory-report`

Генерация самодостаточного статического HTML-отчёта по memory layer
(агрегаты, timeline-гистограмма, кластеры, commit-граф по head с тирами; SEC-4b) в
`.maestro/memory-report-<YYYYMMDD-HHMMSS>.html` с авто-preview в браузере (отключается `memory.report.preview: false`). При отсутствии секции `Узлы графа (M):` в выводе `memory_stats_detail` (устаревший плагин) — предупреждение и упрощённый session-level граф. При недоступном `memory_stats_detail` команда ветвится по секции `memory`, прочитанной плагин-тулом `maestro_config` (сам тул недоступен → «перезапустите opencode / обновите плагин (≥ 4.9.0)», конфиг не читается, bash-fallback запрещён): `enabled: false` → «Память выключена»; `enabled: true` + конфиг-невалиден → честная причина по `disabled_reason`; `enabled: true` + sqlite + плагин загружен/актуален → **fallback** на прямое чтение sqlite (упрощённый HTML с плашкой «Плагин недоступен», только агрегаты, `include_text` не поддерживается); `enabled: true` + qdrant/pgvector → «Плагин недоступен; бэкенд централизованный — fallback невозможен». Реализация — скилл
`maestro-memory` (tool: skill): ядро (канон гейта доступности) +
`references/report.md`. Подробнее — [Память](../reference/memory.md).

### `@maestro-memory-prune`

HITL-утилизация брошенных/unknown записей памяти: листинг по категориям
надёжности git-якоря (remote-merged/remote-alive/local-only/dead/unknown) →
подтверждение → удаление строго по явным `session_ids`/`heads` (host-guard на
централизованных бэкендах). Permission `ask`. Реализация — скилл
`maestro-memory` (tool: skill): ядро (канон гейта доступности) +
`references/prune.md`. Подробнее — [Память](../reference/memory.md).

### `@maestro-memory-reindex`

HITL-бэкфилл памяти (v3.5.0, fail-loud 4.7.1): листинг кандидатов на индексацию
(dry-run превью, 0 LLM) — секция A (sessions с пустыми `artifacts`) + секция B
(git-история по `history_globs`) → HITL-выбор источника и объёма →
`memory_reindex` `run` (light-путь sessions / LLM-синтез git) → агрегатный
отчёт (SEC-4b). Рекомендованный порядок: сначала sessions, затем git.
**Полный re-index (full-reindex):** явный `session_id` с отсутствующей/stale-
записью → LLM-summarize из сессии + сброс permanent-skip; статусы:
`indexed`/`unattributed`/`no_new_messages`/`not_found`/`skip_service`/
`failed: <класс>`. Permission `ask`. Реализация — скилл
`maestro-memory` (tool: skill): ядро (канон гейта доступности) +
`references/reindex.md`. Подробнее — [Память](../reference/memory.md).

### `@maestro-memory-backup`

HITL-бэкап и восстановление данных memory layer (v1, sqlite): `memory_backup`
`list` → показ списка (файл, ts, size, статус jsonl/манифеста) → HITL-выбор:
backup / restore (merge, дефолт) / restore --replace (аварийно: явное
предупреждение + отдельное HITL-подтверждение; удаление всей памяти — только
после успешной fail-closed-валидации бэкапа) / отмена. Команда не вызывает
CLI через bash — при запросе восстановления без opencode показывает
инструкцию ручного запуска (`backup-cli.js`). Permission `ask`. Реализация — скилл
`maestro-memory` (tool: skill): ядро (канон гейта доступности) +
`references/backup.md`. Подробнее — [Память](../reference/memory.md) и
[Бэкап и восстановление памяти](../how-to/memory-backup-restore.md).

### `@maestro-benchmark`

Benchmark: фиксированное задание в песочнице, отчёт прогона, сверка с
прошлыми результатами. Фазы: `run` / `report [session-id]` / `diff [old.json]`.
Отчёты — `.maestro/benchmark-reports/` (эфемерные). **Статус: alpha** — не для
широкого использования. Подробности — [how-to: benchmark](../how-to/benchmark.md).

## 💡 Примечания

- Все HITL-вопросы и сообщения пользователю — только на русском.
- Команды, привязанные к конкретному агенту, указывают его в поле `agent:`
  (например `/maestro-design` → flow primary brainstorm + custodian Q/A). `/test-agents` — общая команда,
  привязки к агенту нет.

## 🔗 Связанные разделы

- [Работа с реестром регрессии](../how-to/use-regression-registry.md)
- [Кастомизация скилла](../how-to/customize-maestro.md)