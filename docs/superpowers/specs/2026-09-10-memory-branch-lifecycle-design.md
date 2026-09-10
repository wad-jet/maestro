# Design: Branch-governed lifecycle для maestro memory (v5)

Дата: 2026-09-10
Статус: draft
Категория: архитектурная
Scope: `plugins/maestro-bootstrap/memory/`, `commands/`, `manual_docs/`, версия дистрибутива

## 1. Контекст и проблема

Memory layer хранит одну запись на opencode-сессию (PK = `session_id`), а жизненным
циклом записи управляет **сессия**: событие `session.deleted` → `storage.delete(sessionID)`
(индексер `onSessionDeleted`). Это наследие v1 (приватность: «удалил сессию → её нет в
памяти»), не пересмотренное в v3 (branch-aware), чья философия — не-деструктивная,
ориентированная на git-историю база знаний.

Разногласия текущего решения (зафиксированы анализом):
1. **v1 vs v3:** v3-спека явно отклонила авто-вычистку для удалённых веток
   («записи остаются, данные живы, не-деструктивно»), но `session.deleted` →
   `storage.delete` пережил v3 незамеченным и уничтожает знание (включая уже
   промоученные `merged=1` записи) при удалении сессии.
2. **«Идентичность записи — по коммиту (head)»** (AGENTS.md, memory.md, v3-спека)
   — завышение: фактически PK — `session_id`, `head` — лишь критерий матчинга/промоции.
   Время жизни записи привязано к сессии, а не к git.
3. **Dead-тир** обещает персистентность (виден в `scope: project`, считается в
   `@maestro-memory`), но существует ровно пока жив объект сессии.
4. **«Нет тихих удалений»** (retention_days default off, `memory_forget` permission-gated)
   против ungated тихого `storage.delete` на `session.deleted`.
5. **Командная память:** на общих бэкендах (qdrant/pgvector) локальное удаление сессии
   одним участником сносит знание для всей команды.
6. **Squash-merge** делает head-недостижимость неоднозначной.

## 2. Цели и Non-goals

### Цели
- Жизненный цикл записей управляется **git-якорем (head/ветка)**, не opencode-сессией.
- Удаление сессии не стирает знание по умолчанию; знание переживает сессии и
  промотируется при мерже ветки.
- Явный write-gate: без git-якоря запись не создаётся.
- Надёжный сигнал существования знания — «уехало в remote» (PUSH).
- Ручная HITL-команда утилизации брошенных/unknown-записей.
- Документация актуализирована, важные изменения подсвечены, минор-версия 3.2.0.

### Non-goals
- Авто-TTL/авто-prune брошенных веток (отклонено — «нет тихих удалений»).
- Эвристики squash-merge по имени ветки (отклонено — хрупко).
- Агрегация записей на ветку (гранулярность остаётся «запись на сессию»).
- Сложные миграции существующих данных (memory layer — beta, без гарантии обратной
  совместимости).

## 3. Решения (все — HITL-зафиксированы)

### 3.1 Драйвер жизненного цикла — git-якорь
Знание живёт «при HEAD». Сессия — локальный provenance-указатель, не ключ хранения.
`session_id` остаётся PK (гранулярность «одна запись на сессию»), но **перестаёт быть
драйвером удаления**.

### 3.2 `session.deleted` — запись выживает
- По умолчанию запись **не удаляется**: сессия удалена → знание остаётся (в т.ч.
  `merged=1`), становится **терминальным** (re-summarize невозможен — сессии нет).
- Runtime-очистка выполняется **всегда**: debounce-таймер, очередь, sticky branch/head,
  строки state.json.
- Конфиг-флаг `memory.delete_on_session_delete: false` (default) — opt-in для
  чисто-локальных workflow (полная локальная работа, где проще поддерживать актуальное
  состояние). При `true` — удаление записи при `session.deleted` (поведение v1).
- **Init-warn при `delete_on_session_delete: true` + централизованный бэкенд**
  (qdrant/pgvector): локальное удаление сессии сносит командное знание (прецедент:
  `unmasked_branch_metadata` warn при init). В `manual_docs/reference/config.md` пометка:
  флаг рекомендуется только для sqlite.
- Privacy-инвариант v1 официально retiring: единственный путь стирания — `memory_forget`
  (permission-gated) + `memory_prune`.

### 3.3 Write-gate по `head`
- Резолв branch/head переносится **до** вызова summarize (сейчас — после, в `_run`).
- `head === ''` → запись **не создаётся**, summarize не вызывается (без LLM-затрат),
  в state не помечается (транзиентный сбой самоизлечится на следующем re-summarize).
- Аудит-событие `memory:index_unattributed` (debug/info).
- Якорь = **head** (commit sha). detached HEAD допустим (head записывается); имя ветки —
  опционально (display/stats). Соответствует v3: «имя ветки — только display».
- **Sticky-кэш фикс:** пустой резолв не кэшируется; re-resolve при следующей
  re-summarization, пока сессия жива.
- **Head-preserve:** re-summarize при сбойном резолве не затирает `head`/`branch`
  уже заякоренной записи пустотой (guard: использовать существующий head, если
  резолв пуст).

### 3.4 Non-git проекты — инертны (область определена)
Область инертности — **индексер** (запись новых сессий), НЕ весь модуль: recall,
`memory_search`/`memory_forget`/`memory_export` и кросс-проектный поиск продолжают
работать по существующим записям. Существующие записи остаются читаемыми даже после
утраты git (проект «был» репо → `.git` удалён).

Разделять два вида недоступности якоря:
- **Структурная** (нет `.git` / нет git-бинарника / не-репо): warn при init
  (`memory: git anchor unavailable`), индексер off (записи не создаются), tools/recall живы.
- **Транзиентная** (резолв не удался: lock при rebase, git недоступен временно):
  warn, per-run gate по §3.3 (самоизлечение на следующем re-summarize); модуль НЕ
  отключается до рестарта.

Существующие unknown-записи (head='') не мигрируются — убираются через
`/maestro-memory-prune` (кандидаты 1-го класса).

### 3.5 Provenance: поле `host`
- В запись добавляется `host` (hostname, `os.hostname()`).
- Назначение: (а) «где лежит полный контекст» (сессия локальна, другой ПК не имеет
  транскрипта); (б) якорь владения для листинга prune.
- Схема экспорта: поле optional (толерантное чтение; старые экспорты импортируются,
  label v3 сохраняется).

### 3.6 `/maestro-memory-prune` — HITL-команда утилизации
- Команда: `commands/maestro-memory-prune.md` + tool `memory_prune` (permission **ask**).
- Механика:
  1. `git fetch --prune` (делает «ветку удалили в remote» наблюдаемой; операция
     read-only network; выполняется с согласия в команде).
  2. Листинг по категориям надёжности якоря:
     - `remote-merged`: head ∈ mainline (local или origin/mainline) → влито, надёжно, **не предлагается**.
     - `remote-alive`: head ∈ refs/remotes/* (не mainline) → запушено, надёжно, **не предлагается**.
     - `local-only`: head достижим только из refs/heads/* → живая, «только локально, <host>» (показ, не кандидат).
     - `dead`: head недостижим из всех refs → брошенная → **кандидат**.
     - `unknown`: head='' → **кандидат 1-го класса**.
  3. HITL-подтверждение: выборочно (session_ids / heads / category) или все.
  4. **Удаление — только по явному набору session_ids/heads.** Category/«все»
     резолвятся на уровне tool-слоя в явный список session_ids/heads **после**
     применения host-guard (хост-исключение не может выполняться в storage-слое:
     reachability/host-логика живёт plugin-side). Равность «подтверждено = удалено»
     гарантируется: удаление исполняется строго по снапшоту листинга, а не
     пере-резолвится в момент delete (защита от гонки между листингом и
     подтверждением на централизованных бэкендах). Raw category pass-through в
     `deleteByFilter` не используется (только явные session_ids / heads).
- Хост-относительность `dead`: недостижимость оценивается по refs **этого** хоста.
  В листинге `dead`-кандидатов показывать `host` записи. Записи с `host ≠ <текущий хост>`
  на централизованных бэкендах (qdrant/pgvector) помечать предупреждением
  «недостижимость оценена по refs этого хоста» и исключать из batch-`all`-удаления
  (остаётся выбор по явным session_ids/heads).
- Squash-предупреждение в выводе: head-недостижимость ≠ ветка не влита (squash-merge
  тоже даёт недостижимость); человек решает.
- Знание, уехавшее в remote (`remote-*`), защищено от удаления по умолчанию.
- Листинг честен настолько, насколько свеж последний fetch: показывать
  «по состоянию refs на <host>, fetch: <ts>».

### 3.7 Обратная совместимость — не гарантируется (beta)
- Только **тривиальный guard-ALTER** для колонки `host` (sqlite/pgvector:
  `ALTER TABLE ... ADD COLUMN host TEXT DEFAULT ''` под проверкой существования;
  qdrant — payload-поле, ничего не нужно).
- Никаких трансформаций данных: существующие записи несут head/branch → вписываются
  в новую модель as-is; существующие unknown — через prune.
- export/import: `host` optional, label v3 сохраняется (толерантное чтение).

## 4. Изменения конфига

| Ключ | Дефолт | Описание |
|---|---|---|
| `memory.delete_on_session_delete` | `false` | Удалять запись при `session.deleted` (v1-приватность для локальных workflow) |

Валидация: boolean. Валидность в `classifyMemoryConfig` (иначе — disabled_reason
`delete_on_session_delete_invalid`).

## 5. Изменения кода (по файлам)

### `memory/indexer.js`
- `onSessionDeleted`: очистка timers + **queue** + sticky branch/head + state-строки
  (новый `state.delete(id)`); `storage.delete` только при `delete_on_session_delete`;
  tombstone-Set + post-upsert recheck (race-guard для режима флага).
- Аудит-фикс: `memory:session_deleted` логируется **только при успешном** delete;
  при выживании записи — `memory:session_closed` (info).
- Write-gate: `_resolveBranchContext` до `summarize`; `head===''` → return без записи.
- Sticky-фикс: не кэшировать пустой резолв.
- Head-preserve: не затирать существующий head/branch пустым резолвом.
- `entry.host = os.hostname()`.

### `memory/state.js`
- Новый метод `delete(id)` — удалить session-строку.

### `memory/config.js`
- `DEFAULTS.delete_on_session_delete`, валидатор, `classifyMemoryConfig`.

### `memory/storage/{sqlite,pgvector,qdrant}.js`
- Колонка/поле `host` (upsert/get/scan/export); guard-ALTER.

### `memory/{export,import}` (schema)
- `host` optional в схеме v3; толерантное чтение.

### `memory/git.js`
- Хелперы множеств достижимости: локальные (`--branches`), remote (`--remotes`),
  исключить теги (для prune-категорий).

### `memory/index.js`
- Tool `memory_prune` (permission ask): `action: list | delete`, выбор по
  `session_ids | heads | category(dead|unknown)`; category/«все» резолвятся tool-слоем
  в явный набор session_ids/heads после host-guard (см. §3.6).
- Init-warn: `delete_on_session_delete: true` + централизованный бэкенд (прецедент
  `unmasked_branch_metadata`, эмиссия в init).

### `commands/maestro-memory-prune.md`
- Slash-команда (фронтматтер по паттерну `maestro-memory.md`).

## 6. Изменения документации и версии

- `package.json` version `3.1.0` → `3.2.0` (единый источник; синхронно `README.md`,
  `docs/project-context.md`).
- `manual_docs/overview/changelog.md`: запись `[2026-09-10]` — секция
  «Изменено / без обратной совместимости» с подсветкой важных моментов:
  1. `session.deleted` больше не удаляет запись по умолчанию (флаг
     `delete_on_session_delete`, privacy-сценарии v1 — включать флагом);
  2. non-git проекты не получают память (write-gate по head);
  3. write-gate: сессии без git-якоря не суммаризируются;
  4. новый `/maestro-memory-prune` (HITL), поле `host`.
- `manual_docs/reference/memory.md`: callout «Изменение жизненного цикла (3.2.0)»,
  переписанные §«Удаление сессии», идентичность записи, секция prune.
- `manual_docs/how-to/enable-memory.md`: предупреждение о non-git.
- `manual_docs/reference/config.md`: ключ `delete_on_session_delete`.
- `manual_docs/reference/commands.md`: `@maestro-memory-prune`.
- Корневой `AGENTS.md`: уточнение «идентичность записи» (head — lifecycle/промоция,
  session_id — ключ хранения, lifecycle — ветка).
- `plugins/maestro-bootstrap/README.md`, `SECURITY.md` (пути удаления: `memory_forget`
  + `memory_prune` + опц. флаг).
- **Канон permission/config-правил (source of truth — `skills/maestro-setup/`, НЕ
  `maestro-new/`):**
  - `skills/maestro-setup/SKILL.md` — permission-правило для новых сетапов:
    `permission: { ..., memory_prune: "ask" }` (без него новый tool получает
    ungated-доступ по дефолту OpenCode);
  - `skills/maestro-assistant/SKILL.md` — канон нового конфиг-ключа
    `delete_on_session_delete` и правила `memory_prune: "ask"` (single source of
    config rules);
  - `manual_docs/explanation/agents-and-trust.md` + `reference/config.md` +
    `how-to/enable-memory.md` — permission-канон write/boundary-tools: добавить
    `memory_prune` в сниппеты «write/boundary-tools → permission `ask`» (обязательно
    по правилу AGENTS.md «изменения SECURITY.md → manual_docs»).
- **Changelog action item для существующих сетапов:** установленная база (repo/agpack)
  не получает правило автоматически — добавить в changelog строку: «для существующих
  сетапов добавьте `memory_prune: "ask"` в `permission`».
- Memory layer внутренняя версия: changelog-метка v5 (branch-governed lifecycle).

## 7. Безопасность

- Пути удаления записей: `memory_forget` (permission ask), `memory_prune` (permission
  ask), опц. `delete_on_session_delete`. Тихого авто-удаления по умолчанию нет.
- Маскирование контента не меняется (maskTranscript + maskEntry, defense-in-depth).
- `host` (hostname) — низкая чувствительность; на централизованном бэкенде — как
  git-метаданные (правила SECURITY.md §5a). Учитывать в рисках unmasked git-метаданных.
- Write-gate сокращает поверхность хранения (без якоря ничего не пишется).
- Аудит-интегрити: событие удаления логируется только по факту успеха.

## 8. Регрессионные риски

- Breaking change дефолтного поведения `session.deleted` → HIGH (privacy-ожидания v1).
- Изменение схемы (колонка host) → MEDIUM.
- Cross-layer (indexer/storage/config/tool/command) → MEDIUM.
- Промоция/init-механика и recall не меняются → LOW.

## 9. Верификация (DoD)

- **`session.deleted` — verification item → DoD.** Верифицировать в pinned-версии
  opencode издателей события (server delete-handler vs cleanup/GC-путь) и пройти
  ручную матрицу TUI-delete / API-delete / GC. Рамка риска:
  - дефолт `false` — непопадание события безвредно (запись выживает по дизайну;
    остаётся только stale runtime-state: таймеры чистятся в `dispose`, sticky-Map
    bounded, state-строки — `state.prune` по окну);
  - `true` — privacy-гэп, но паритет с текущим v1 (удаление и сейчас чисто событийное);
  - события не доставляются между процессами: удаления из другого инстанса/во время
    офлайна плагин не видит никогда → флаг документируется как best-effort/event-driven.
- Regression-запись `regression/entries/2026-09-10-memory-branch-lifecycle.md` с
  manual-сценариями: TUI-delete → запись выживает; prune happy-path; squash-предупреждение;
  флаг `delete_on_session_delete: true`.

<!-- maestro:sanitize status: CLEAN date: 2026-09-10 hash: 9fcbd0c6959b4a7d6b46fe87991088c94d2e75a3cc95216eee52ca30911c055d -->

<!-- maestro:review reviewer: opus date: 2026-09-10 verdict: approve hash: 9fcbd0c6959b4a7d6b46fe87991088c94d2e75a3cc95216eee52ca30911c055d -->
