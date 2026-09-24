# Команды

[Назад к оглавлению](../index.md)

## 🎯 Назначение

Справочник доступных `@command` для работы со скиллом `maestro`. Конфиги живут
в `commands/*.md` (authoring-репо); доставляются в целевое приложение штатным механизмом
(вручную из удалённого репозитория или через `agpack`).

## 📖 Команды

### `/maestro-init`

Вход в pipeline: загружает скилл `maestro` и следует pipeline из SKILL.md.
Работает в любой primary-сессии (привязки к агенту нет).

**Режимы запуска** (per-run флаг, не персистится):

```
/maestro-init "задача"                        # manual — все гейты вручную (по умолчанию)
/maestro-init --auto-answer "задача"          # auto-answer (-aa): полный флоу, рекомендации на рутинных гейтах — авто
/maestro-init --auto-ai "задача"              # auto-ai (-ai): ИИ решает сам с доп. анализом (ralph loop)
/maestro-init --no-auto "задача"              # явный manual
/maestro-init --plain "задача"                # простой язык на этот запуск (не режим; комбинируется: --auto-answer --plain)
```

**`--plain`:** не режим запуска (ортогонален флагам режимов). Включает простой
язык на этот запуск; флаг > конфиг `maestro.json` (`communication`).
Канон — SKILL.md, секция «Простой язык»; ключ — [Конфигурация](config.md).

Подробнее о поведении гейтов по режимам — [HITL-гейты](hitl-gates.md).

**Memory layer:** в Plan mode (ресеч, обсуждение фичи/багфикса, подготовка
spec) и на ресече bugfix — сначала `memory_search` по теме задачи (канон —
SKILL.md, секция «Memory layer (memory_search)», детали —
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

Setup-фаза bootstrap нового проекта: `docs/project-context.md` (14 категорий),
конфигурация maestro (`maestro.json`, плагин+модели в `.opencode/opencode.json`
или global, `.gitignore` — весь `.maestro/` и `.opencode/`), каталоги pipeline
(`.maestro/` — весь в `.gitignore`,
`docs/superpowers/{specs,plans}/`),
`regression/` структура. Использует скилл `maestro-setup`.
Проверяет предусловия: `AGENTS.md` (встроенный `/init`), скилы superpowers
(предлагает установку через HITL), плагин `maestro-bootstrap` (не блокер).

### `/maestro-design`

Дизайн/архитектура, scaffold и roadmap после `/maestro-setup`:
- (a) spec через **primary brainstorm (superpowers:brainstorming) + custodian Q/A (trusted)** → spec пишет primary → `docs/superpowers/specs/YYYY-MM-DD-<project>-design.md`; опц. spec-review (`opus`).
- (b) scaffold — каркас кода через `implementer-prompt.md` (TDD), диспатч `haiku`/`sonnet`.
- (c) `docs/roadmap.md` (MVP + этапы).
Модели агентов наследуются из `.opencode/opencode.json` или global (не переспрашивает).

### `/maestro-feedback-report`

Сбор фактуры по прошлым процессам maestro **в текущей сессии** для последующей
ретроспективы (что было хорошо / плохо / с какими проблемами). Использует скилл
`maestro-feedback-report`. Отчёт —
`.maestro/feedback-reports/report-<Session ID>-<YYYY-MM-DD>.md`. Основной
источник — диалог сессии; дополняется данными из логов плагина
(`maestro-bootstrap-*.log`) при наличии записей по `sessionID`. Отдельно
фиксируются нарушения инвариантов ⚑1–4 (секция «Нарушения инвариантов ⚑1–4»;
канон — `skills/maestro/invariants.md`). Отчёт содержит секцию «Таймлайн и
длительности операций» — сокращённый таймлайн сессии и длительности отдельных
операций (task-диспатчи по агентам, tools, bash-команды, дольшие операции и
паузы; источник — данные opencode-сессии через `opencode export` + helper
`timeline.mjs` скилла). После генерации
отчёта — HITL-гейт: пользователь может оставить комментарии/рекомендации, которые
записываются в секцию `## Пользовательский фидбек` отчёта. Автокоммит не требуется.
Отдельная секция `## Memory layer usage`: статус памяти (подключена/нет),
обращения `memory_search` (точка, число найдено, оценка эффективности) и
**статус обязательных точек** (старт Plan-фазы, ресеч bugfix D1–D2): выполнена
/ НЕ выполнена + причина («memory layer не подключен» / «точка не достигнута»
— информационно / «пересмотр» — нарушение); только агрегаты (SEC-4b).

### `/test-agents`

Проверка всех сабагентов maestro **реальным диспатчем**: каждой из 7 моделей
(`custodian`, `haiku`, `sonnet`, `opus`, `fable`, `code-reviewer`, `sanitizer`)
даётся одинаковая тривиальная тестовая задача через `task` tool. Возвращает
сводную таблицу статусов (OK/FAIL с причиной). Конфиги не читаются — проверяется
реальная работа модели: невалидное имя модели или недоступный провайдер
проявятся как FAIL при диспатче.

Дополнительно проверяется **confidential-инвариант** (P1/P3, `SECURITY.md`):
trusted-агенты (`custodian`, `sanitizer`) читают `docs/confidential/**`, а
primary-сессия при чтении того же файла получает `deny`. Статус инварианта —
`PASS` / `FAIL` (утечка → СТОП) / `skipped` (нет `docs/confidential/**`).

### `/maestro-version`

Показать фактическую версию плагина `maestro-bootstrap`, подключённого в текущей
сессии. Читает `.maestro/plugin-version` (пишется при инициализации плагина). Если
файла нет — сообщает, что плагин не инициализирован или версия неизвестна
(признак сбоя init плагина).

### `/maestro-assistant`

Консультации и настройка maestro-конфигурации/структуры/контекста в течение жизни
проекта. Загружает скилл `maestro-assistant` (tool: skill) и применяет его к запросу HITL.
Обрабатывает: `maestro.json` (trust/confidential/sanitizer_whitelist),
`.opencode/opencode.json` / global (плагин, модели), структуру каталогов,
актуализацию `project-context.md`, консультации по
правилам работы maestro. Плагин-гейт не требуется. Если запрос требует изменения кода/spec/плана
или запуска pipeline — редирект на `@maestro-init`/`/maestro-design`/`@regression`.

### `@maestro-memory`

Статус memory layer плагина `maestro-bootstrap`: бэкенд, модель, активный `key`,
число записей (по авторам и датам), кластеры/граф, подсказки по тюнингу
(`top_k`, `min_score`, `retention_days`). Данные — из `memory_stats_detail` +
чтение `maestro.json`. Только агрегаты (SEC-4b). При недоступном
`memory_stats_detail` команда различает: «память выключена» (`memory.enabled:
false`), «конфиг-невалиден» (честная причина по `disabled_reason`) и «плагин
недоступен» (`enabled: true` + инструмент недоступен → перезапустить opencode).
Блок **«Не индексированные сессии: N»** — cap 20 строк; N>0 — предложить
`@maestro-memory-reindex` (явные session_id из списка).
Подробнее — [Память](../reference/memory.md).

### `@maestro-memory-report`

Генерация самодостаточного статического HTML-отчёта по memory layer
(агрегаты, timeline-гистограмма, кластеры, commit-граф по head с тирами; SEC-4b) в
`.maestro/memory-report-<YYYYMMDD-HHMMSS>.html` с авто-preview в браузере (отключается `memory.report.preview: false`). При отсутствии секции `Узлы графа (M):` в выводе `memory_stats_detail` (устаревший плагин) — предупреждение и упрощённый session-level граф. При недоступном `memory_stats_detail` команда ветвится по `maestro.json`: `enabled: false` → «Память выключена»; `enabled: true` + конфиг-невалиден → честная причина по `disabled_reason`; `enabled: true` + sqlite → **fallback** на прямое чтение sqlite (упрощённый HTML с плашкой «Плагин недоступен», только агрегаты, `include_text` не поддерживается); `enabled: true` + qdrant/pgvector → «Плагин недоступен; бэкенд централизованный — fallback невозможен». Подробнее —
[Память](../reference/memory.md).

### `@maestro-memory-prune`

HITL-утилизация брошенных/unknown записей памяти: листинг по категориям
надёжности git-якоря (remote-merged/remote-alive/local-only/dead/unknown) →
подтверждение → удаление строго по явным `session_ids`/`heads` (host-guard на
централизованных бэкендах). Permission `ask`. Подробнее —
[Память](../reference/memory.md).

### `@maestro-memory-reindex`

HITL-бэкфилл памяти (v3.5.0, fail-loud 4.7.1): листинг кандидатов на индексацию
(dry-run превью, 0 LLM) — секция A (sessions с пустыми `artifacts`) + секция B
(git-история по `history_globs`) → HITL-выбор источника и объёма →
`memory_reindex` `run` (light-путь sessions / LLM-синтез git) → агрегатный
отчёт (SEC-4b). Рекомендованный порядок: сначала sessions, затем git.
**Полный re-index (full-reindex):** явный `session_id` с отсутствующей/stale-
записью → LLM-summarize из сессии + сброс permanent-skip; статусы:
`indexed`/`unattributed`/`no_new_messages`/`not_found`/`skip_service`/
`failed: <класс>`. Permission `ask`. Подробнее — [Память](../reference/memory.md).

### `@maestro-memory-backup`

HITL-бэкап и восстановление данных memory layer (v1, sqlite): `memory_backup`
`list` → показ списка (файл, ts, size, статус jsonl/манифеста) → HITL-выбор:
backup / restore (merge, дефолт) / restore --replace (аварийно: явное
предупреждение + отдельное HITL-подтверждение; удаление всей памяти — только
после успешной fail-closed-валидации бэкапа) / отмена. Команда не вызывает
CLI через bash — при запросе восстановления без opencode показывает
инструкцию ручного запуска (`backup-cli.js`). Permission `ask`. Подробнее —
[Память](../reference/memory.md) и
[Бэкап и восстановление памяти](../how-to/memory-backup-restore.md).

## 💡 Примечания

- Все HITL-вопросы и сообщения пользователю — только на русском.
- Команды, привязанные к конкретному агенту, указывают его в поле `agent:`
  (например `/maestro-design` → flow primary brainstorm + custodian Q/A). `/test-agents` — общая команда,
  привязки к агенту нет.

## 🔗 Связанные разделы

- [Работа с реестром регрессии](../how-to/use-regression-registry.md)
- [Кастомизация скилла](../how-to/customize-maestro.md)