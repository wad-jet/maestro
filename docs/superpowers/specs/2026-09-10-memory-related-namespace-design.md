# Design: Namespace-идентичность и связи проектов (memory v5.1)

Дата: 2026-09-10
Статус: draft
Категория: архитектурная
Scope: `plugins/maestro-bootstrap/memory/`, `commands/`, `skills/`, `manual_docs/`, версия остаётся 3.2.0 (не релизилась)

## 1. Контекст и проблема

Текущая идентичность проекта в memory layer: `key = namespace ?? sha256(canonicalRemote | absPath)`.
Проблемы (зафиксированы HITL-обсуждением):
1. **Непрозрачность хэша:** проекты без namespace адресуются/отображаются как `8f3a2e91…` — нечитаемо в выдаче, отчётах, `related`.
2. **Отсутствие стабильности:** смена remote/директории меняет hash → «новый» проект, старые записи теряются.
3. **Namespace без дедупликации:** человеческий выбор не уникален глобально; два проекта, выбравшие одно имя, молча сливают бакеты.
4. **Нет декларативных связей:** кросс-проектный доступ только через явный `memory_search project:`; auto-recall между проектами невозможен.
5. **Смена namespace = тихая потеря доступа** (миграции нет).

## 2. Цели и Non-goals

### Цели
- Единая **читаемая** идентичность: namespace — единственный ключ, обязательный и валидируемый.
- Автоматические связи внутри домена (иерархический namespace) и явные (`related`) между доменами.
- Осознанная, управляемая миграция при смене namespace.
- Видимость коллизий namespace (тихое слияние становится наблюдаемым).

### Non-goals
- Глобальный реестр namespace (предотвращение коллизий) — нет центрального сервиса.
- Дефолт-ключи из canonical remote / absPath — убраны (namespace обязателен).
- `memory.name` — отдельное имя не вводится (namespace = наименование).
- Авто-миграция на init — только явный tool + init-warn (без тихих действий).

## 3. Решения (все — HITL-зафиксированы)

### 3.1 Namespace обязателен и является единственным ключом
- `key = namespace`. Без namespace память **disabled** (`disabled_reason: "namespace_missing"`).
- `memory.enabled: true` + отсутствие/невалидный namespace → disabled с причиной.
- При init: `logError("memory:namespace_missing")` (enum-only) + HITL-заметка в `/maestro-init` (шаг 0, информативная, не блокирует пайплайн).
- canonicalRemote демотируется до трёх вспомогательных ролей:
  (а) `origin_remote` — штамп канонического remote писателя в записи (provenance/диагностика коллизий);
  (б) подсказка значения namespace при сетапе (`/maestro-setup`);
  (в) `memory_migrate from:auto` — вычисление старого hash-бакета (sha256 текущего canonical remote).
- `origin_project_hash` остаётся (provenance, дедуп-детекция, легаси-миграция).

### 3.2 Формат namespace
```
^([a-z0-9]([a-z0-9-]{0,30}[a-z0-9])?)(\.[a-z0-9]([a-z0-9-]{0,30}[a-z0-9])?){0,2}$
```
- 1–3 сегмента, разделитель — точка; сегмент: латиница/цифры, дефис **внутри** (не в начале/конце), ≤32; итог ≤100.
- **Нормализация:** значение тримится; регистр приводится к нижнему; пустой/невалидный после нормализации → `namespace_invalid`. **Эффективным ключом становится нормализованное значение** (иначе `MyApp`/`myapp` разведут бакеты).
- Приоритет `disabled_reason` при нескольких проблемах конфига: `namespace_missing` > `namespace_invalid` > `related_invalid` (остальные — по существующему порядку `classifyMemoryConfig`; позиции новых причин в цепочке — в план).

### 3.3 Домен-авто-related (иерархия)
- **`prefixes`** записи = множество всех префиксов её ключа (для `microservices.sales.pay` → `["microservices","microservices.sales"]`); **домен** = последний префикс. Для namespace из 1 сегмента — префиксов/домена нет.
- Проект автоматически видит `merged=1`-записи поддерева родителя: точного родительского бакета + всех ключей с префиксом `parent.*` (братья, включая собственный бакет — дедуп).
- Своя непрошенная работа не течёт (merged-only инвариант).
- **Поддерево-оператор `subtreeLeg(T)`** (merged-only), единый для домен-авто, `related`, `memory_search project:`:
  - **pgvector**: `key = T OR key LIKE T || '.%'` (алфавит namespace без `%`/`_` → LIKE безопасен);
  - **qdrant**: payload-фильтр `key = T OR prefixes: match any [T]` (поле `prefixes`, keyword-индекс; покрывает любую глубину);
  - **sqlite**: перебор соседних БД по `meta.key` (фильтр `= T` или `LIKE 'T.%'`), кэш перечня ключей; легаси-БД без `meta.key` невидимы до открытия новой версией (задокументировано).
- **Инвариант (Minor 11):** 64-hex хэш не проходит формат namespace (сегмент ≤32) → пространства hash-ключей и namespace не пересекаются (`from:hash` однозначен).

### 3.4 `related` — явные кросс-доменные связи
- `memory.related: string[]` — цель = **namespace-префикс** (точный бакет + всё поддерево), без wildcard-синтаксиса.
  - `related: ["microservices.sales.pay"]` → бакет pay (leaf, детей нет при капе 3);
  - `related: ["microservices.sales"]` → бакет sales + все `microservices.sales.*`;
  - `related: ["microservices"]` → весь домен.
- Семантика едина с домен-авто-related: один оператор `subtreeLeg(T)` (merged-only) для: собственного домена, related-целей, `memory_search project:`.
- **Граница использования:** внутри одного домена `related` НЕ указывается (домен-авто уже связывает братьев, merged-only, симметрично); `related` — только для **кросс-доменных** связей. При `domain_recall: false` запрет внутридоменного `related` снимается: явный `related` на соседа — легальный opt-in (валидация формат-only, §4), документировать в plan.
- **Предпочтение 1:1 (Recommended):** кросс-доменная цель указывается точным leaf'ом (`related: ["microservices.sales.orders"]`), не поддеревом. Причины: наименьшие привилегии (нужны знания конкретного проекта, не всего домена), стабильность (рост домена не меняет связь), меньшее разбавление `top_k`. Поддерево (`related: ["microservices.sales"]`) — осознанный opt-in, когда нужен весь домен.
- **Дедуп ног:** собственный ключ исключается из всех leg-расширений; ноги дедуплицируются; **транзитивного замыкания related нет** (связи не наследуются).
- Валидация записей — тот же формат namespace (без wildcard/URL/hash).
- Однонаправленная связь (consumer → provider).
- Config-as-code: правка `memory.related` — часть интеграционной задачи (branch + ревью); после смены — рестарт opencode (конфиг читается при init).
- Pipeline-чек в дизайн-фазе maestro (шаг 8.5): «фича затрагивает интеграцию с другими проектами? → цель в `memory.related`? → нет → предложить правку как задачу плана».

### 3.5 Коллизии namespace — детекция (не предотвращение)
- Препятствование невозможно без глобального реестра; слияние бакетов при полном совпадении namespace — осознанная семантика.
- Детекция: записи бакета несут `origin_project_hash`; `COUNT(DISTINCT origin_project_hash) > 1` → в бакете несколько проектов.
- Семантика события (warn-on-new + persist):
  - в **per-key state-файле** (см. §3.6/§5 state.js) persist множество «виденных» чужих `origin_project_hash` для ключа;
  - появление **нового** чужого проекта → `warn("memory:namespace_shared", {count})` (однократно);
  - стабильный состав → `info`;
- **Ложные срабатывания:** смена remote меняет собственный `origin_project_hash` → прежние «свои» записи становятся «чужими» и механизм warn-once **закономерно** сработает (система не отличает «чужой» от «свой-старый»). Решение в план: либо документировать ожидаемый warn после переезда, либо persist собственного прошлого hash и классифицировать свои прежние как info.
- **Асимметрия бэкендов (документируется):** sqlite — детекция машинно-локальна (бакет = локальная БД); qdrant/pg — глобальна (командная).
- `@maestro-memory` — секция «Ключ»: namespace, домен, related-цели, **проекты в бакете** (читаемые, по `origin_remote`).
- `memory_stats_detail` — агрегат `distinct_projects`.
- Не блокирует запись, не разруливает — делает тихое видимым.

### 3.6 Миграция namespace
- **`memory_migrate` tool** (permission `ask`, HITL): `from: auto | namespace | hash`; цель — текущий effectiveKey.
  - `from:auto` = `sha256(canonicalizeRemote(текущий remote))` — старый hash-бакет текущего проекта (апгрейд-путь);
  - `from: <namespace>` / `<hash>` — явный бакет;
  - параметр `delete_source: false` (default) — удалять ли источник после переноса.
- Backend-механика `migrateKey(fromKey, toKey)`:
  - **sqlite**: открыть соседнюю БД read-only (layout известен), проверка model_id/dim (mismatch → понятная ошибка «переиндексация»), читать записи, переписать `key` → upsert в активную БД; `delete_source` → удалить файл источника;
  - **qdrant**: scroll по фильтру `key=from` → setPayload `key=to`;
  - **pgvector**: `UPDATE maestro_memory SET key=$to WHERE key=$from` (tsvector сгенерированный — обновится сам).
- `origin_project_hash`/`origin_remote` сохраняются (provenance), меняется только `key`.
- **Политика конфликта session_id (max-version-wins):** при переносе в непустой целевой бакет запись-источник НЕ затирает новую, если у существующей `version >=` источника (skip-if-existing-newer; на qdrant — чтение точки до setPayload, сравнение `version`). Защита от регресса при «сменил namespace → поработал → запустил migrate».
- **Домен/префиксы при migrate:** `prefixes` пересчитываются от нового ключа (а не переносятся из источника).
- **`delete_source` по бэкендам:** sqlite — удалить файл бакета (включая `-wal`/`-shm`); qdrant — собрать ids **до** `setPayload` (после — фильтр `key=from` пуст), удалять по ids; pg — после `UPDATE` источник уже пуст (no-op). Оговорка: источник может быть ещё открыт живым процессом.
- **`from:auto` слепые зоны:** репо без remote (бакет = hash(absPath)) и сменившийся remote → «0 записей» с подсказкой `from:<hash>`; `from:<namespace>` валидируется форматом (опечатка ≠ «0 записей»).
- Идемпотентность: повторный migrate подбирает записи, успевшие записаться в источник после первого прогона.
- Аудит `memory:migrated {count}`. Edge: `from == to` → no-op; пустой источник → «0 записей»; источника нет → fail-soft сообщение.
- **Persist-стратегия (I2 + N1):** маркеры разделены по месту:
  - **`lastKey` — в per-project файле** `<memoryDataDir>/<hash(absPath)>/state.json` (проектная идентичность, независимая от namespace: смена ключа K1→K2 не меняет путь → lastKey K1 найден → расхождение видно → `warn("memory:key_changed")` срабатывает). Пишет только процесс этого проекта → tmp+rename достаточно.
  - **seen-set чужих `origin_project_hash` — в per-key файле** `<memoryDataDir>/<hash(key)>/state.json` (свойство текущего бакета; смена ключа корректно начинает новый seen-set). Атомарная запись (tmp+rename).
  - НЕ в общем машинном state.json (неатомарная перезапись стейл-снапшотом ломала «warn-once» и роняла маркеры при интерливинге процессов). M9: соседи одного бакета на одной машине могут потерять-обновить seen-set — дублирующий warn, безвредно (merge-on-write или accept). M1: per-project lastKey привязан к `hash(absPath)` — переезд директории сбрасывает маркер (безвредно: при переезде ключ = namespace не меняется; одновременный переезд + смена namespace ускользает от warn — задокументированный edge). M2: параллельные opencode-сессии одного проекта → last-write-wins по lastKey (tmp+rename атомарен), возможен дублирующий `key_changed`, самокорректирующийся.
- Init-warn при смене ключа: расхождение `lastKey` (per-project) ≠ текущему effectiveKey → `warn("memory:key_changed", {})` + подсказка (обновить lastKey после migrate).
- `memory_import` остаётся строгим «тот же key»; migrate — единственный путь пере-keying.

### 3.7 Отображение и адресация
- Отображение проекта = namespace (читаем). Легаси-записи без origin_remote/с hash-ключом — короткая форма.
- `memory_search project:` — namespace-префикс (та же subtreeLeg-семантика); параметр нормализуется+валидируется (формат §3.2) перед `subtreeLeg`/LIKE (M4); URL/hash-формы удаляются.
- `resolveProjectKey` упрощается до валидации namespace (URL/hash формы только внутри migrate).

### 3.8 Мульти-remote и top_k
- `origin_remote`/`from:auto` используют origin (фиксировано, задокументировано).
- Мульти-ноги recall (своя + домен + related) сливаются RRF в `top_k`; ручку разбавления не вводим, мониторим `recall.hits`.

### 3.9 Обратная совместимость (beta)
- **Breaking:** обязательность namespace (существующие включения без него → disabled `namespace_missing`); удаление URL/hash-форм адресации.
- Миграция-путь: задать namespace → `memory_migrate from:auto`.
- Схема: поля `origin_remote` + `prefixes` — guard-ALTER по образцу `host` (бета, без сложных миграций).
- Экспозиция читаемых ключей на централизованных бэкендах — класс git-метаданных (SECURITY §5a), задокументировать осознанно.
- **`memory_prune` guard чужих записей (I4):** scan-поля prune-листинга включают `origin_project_hash`; записи с `origin_project_hash ≠ собственному` помечаются «чужой проект» и **исключаются из batch-удаления** (как foreign-host); удаление чужих — только по явным `session_ids`. Документировать, что `memory_forget`/`memory_export` в общем бакете захватывают и чужие записи (по ключу).

## 4. Изменения конфига

| Ключ | Дефолт | Описание |
|---|---|---|
| `memory.namespace` | — | **Обязателен** для enabled. Формат §3.2. Отсутствует → `namespace_missing`; невалиден → `namespace_invalid` |
| `memory.related` | `null` | Массив namespace-префиксов (кросс-доменные связи; merged-only). Валидность записей — формат §3.2 |
| `memory.domain_recall` | `true` | Off-switch домен-авто-ног (своя нога + `related` остаются). `false` — только собственный ключ + явный `related` |

Валидация: `namespace` — формат-чек; `related` — массив валидных namespace (≤16 записей); `domain_recall` — boolean. Оба/все в `classifyMemoryConfig`.

## 5. Изменения кода (по файлам)

### `memory/config.js`
- `namespace` обязателен: `namespaceMissing`/`namespaceValid` (формат-чек выполняется над **нормализованным** значением, F1); `relatedValid` (массив namespace, каждая запись нормализуется, формат-only — независимо от `domain_recall`, M3/M5).
- Убрать hash/path-дефолт из `resolveEffectiveKey` (ключ = namespace).

### `memory/project.js`
- `resolveProjectKey` — только валидация namespace-префикса (для related/search); URL/hash — только внутренний `legacyKey` для migrate.
- `subtreeLeg(T)`-семантика в `resolveSearchKeys({ key, related })`.

### `memory/storage/{sqlite,pgvector,qdrant}.js`
- Поля `origin_remote`, `prefixes` (upsert/get/scan/export; guard-ALTER по образцу `host`).
- sqlite: `meta.key` (для перебора соседей + кэш перечня ключей); домен/related-ноги в search (`subtreeLeg(T)`).
- qdrant: `prefixes` keyword-индексируются (создание индекса — идемпотентно/guarded на существующих коллекциях, аналог guard-ALTER); поддерево-нога — `key = T OR prefixes: match any [T]`.
- `migrateKey(from, to)` в 3 бэкендах (max-version-wins, см. §3.6).

### `memory/indexer.js`
- Штампы `origin_remote` (canonicalRemote) и `prefixes` (все префиксы namespace) в записи.

### `memory/index.js`
- init: `logError` при `namespace_missing`; `warn` `key_changed`/`namespace_shared` (warn-on-new, persist в per-key state-файле); домен+related-ноги в recall-обвязку; `memory_search project:` префикс; tool `memory_migrate`.
- `memory_prune`: scan-поля включают `origin_project_hash`; «чужой проект» (≠ собственному hash) → пометка + исключение из batch-удаления (I4).

### `memory/state.js`
- persist: **`lastKey` — per-project файл** `<memoryDataDir>/<hash(absPath)>/state.json` (независим от namespace, N1); **seen-set — per-key файл** `<memoryDataDir>/<hash(key)>/state.json`; оба — атомарная запись (tmp+rename).

### `memory/recall.js`
- Мульти-ноги: своя + домен (если `domain_recall`) + related (merged-фильтр `merged === 1 || inContext`); дедуп ног, собственный ключ исключается из расширений.
- `memory_recall_preview` — паритет ног с recall.
- Заголовок systemBlock: «прошлых сессий **этого проекта и связанных доменов**» (актуализировать текст).

### `skills/maestro/SKILL.md`
- Шаг 0: HITL-заметка при `namespace_missing`.
- Шаг 8.5: pipeline-чек related (интеграция с другими проектами → правка `memory.related` в плане).

### `skills/maestro-setup/SKILL.md`
- Namespace — обязательный вопрос (формат + подсказка из remote); вопрос про `related`.

### `skills/maestro-assistant/SKILL.md`
- Канон: обязательный namespace (формат), `related` (префикс-семантика), `memory_migrate`, config-as-code + рестарт.

### `commands/maestro-memory.md`
- Секция «Ключ» (namespace/домен/related/проекты в бакете).

## 6. Изменения документации и версии

- `docs/superpowers/specs/2026-09-10-memory-related-namespace-design.md` (этот файл) + план.
- `manual_docs/reference/memory.md`: §«Изоляция» — обязательный namespace/формат, домены, related, migrate, коллизии; сцена (API/frontend/сервис); адресация namespace-only.
- `manual_docs/reference/config.md`: ключи `namespace`/`related` + причины `namespace_missing`/`namespace_invalid`/`related_invalid`.
- `manual_docs/how-to/enable-memory.md`: namespace обязателен; upgrading (задать namespace + `memory_migrate from:auto`).
- `manual_docs/overview/changelog.md`: дополнение записи `[2026-09-10]` — breaking-подсветка (обязательный namespace, удаление URL/hash-адресации, поля origin_remote/domain).
- `manual_docs/explanation/agents-and-trust.md`: экспозиция читаемых ключей на centralized (git-метаданные, SECURITY §5a).
- Корневой `AGENTS.md`, `plugins/maestro-bootstrap/README.md`, `SECURITY.md`, `docs/project-context.md`: синхронизация.
- Версия: остаётся 3.2.0 (не релизилась).

## 7. Безопасность

- Пути удаления/миграции: `memory_forget` (ask), `memory_prune` (ask), `memory_migrate` (ask), опц. флаг. Тихого авто-удаления нет.
- Читаемые ключи/`origin_remote` на централизованных бэкендах — класс git-метаданных (URL виден в коммитах); задокументировать (SECURITY §5a).
- Коллизии namespace: детекция делает слияние видимым; разрешение — за человеком (сменить namespace / мигрировать / принять).
- **Trust-модель домен-ног (I5):** merged-записи братьев/related **автоматически** попадают в каждый auto-recall-промпт. Маскирование — writer-side (паттерны писателя применяются к его записям; паттерны consumer-а к чужим summary не применяются). Офф-свитч — `memory.domain_recall: false`. Доменная иерархия и `related` — **осознанная граница доверия по конвенции**: разделяя namespace/домен, команда принимает, что merged-знания видимы в домене. Задокументировать в `manual_docs/explanation/agents-and-trust.md`.
- Маскирование контента не меняется.

## 8. Регрессионные риски

- Breaking: обязательность namespace → HIGH (существующие включения без namespace отключаются; путь восстановления — namespace + migrate from:auto).
- Изменение схемы (origin_remote/prefixes) → MEDIUM.
- Cross-layer (config/project/storage/indexer/index/recall/tools/skills) → MEDIUM.
- Домен/related-ноги меняют recall-состав → MEDIUM (мониторинг recall.hits).
- Промоция/init-механика v3 и lifecycle v5 не меняются → LOW.

## 9. Верификация (DoD)

- namespace обязателен: enabled без namespace → disabled `namespace_missing`; невалидный формат (ведущий/хвостовой дефис, >3 сегментов, >32 в сегменте, не-латиница/цифры/дефис) → `namespace_invalid`. **Нормализация (trim+lowercase) выполняется ДО валидации (F1):** `MyApp` → валидный ключ `myapp` (позитивный кейс); пустое после нормализации → `namespace_invalid`.
- Домен/related: merged-only legs (родитель + братья / префикс-цель) в recall и memory_search; sibling-хиты не отсекаются branch-фильтром; дедуп ног; own key исключён.
- **Per-backend юнит-проверки:** `subtreeLeg` (pg LIKE / qdrant prefixes-match / sqlite meta-перебор); `migrateKey` ×3 (max-version-wins, `delete_source` по бэкендам, qdrant порядок ids→setPayload).
- Коллизии: warn-on-new (persist в per-key state-файле, атомарная запись), info для стабильных; «Проекты в ключе» в @maestro-memory; асимметрия sqlite/qdrant-pg задокументирована.
- `memory_migrate from:auto`: легаси hash-бакет переносится; model/dim mismatch → понятная ошибка; `from:<namespace>` валидируется форматом; «0 записей» при слепой зоне → подсказка `from:<hash>`.
- init-warn `key_changed` при смене namespace (persist lastKey в per-project файле, N1).
- `memory_prune`: «чужой проект» (по `origin_project_hash`) помечается и исключается из batch-удаления.
- `memory_recall_preview` — паритет ног; systemBlock-заголовок актуализирован.
- `domain_recall: false` → домен-нога отсутствует, `related`-ноги присутствуют.
- `related_invalid` (>16 записей / невалидный формат / приоритет причин) → disabled.
- Regression entry: **отдельный** `regression/entries/2026-09-10-memory-namespace-related.md` (прецедент: per-feature entries) — сценарии инкремента.
<!-- maestro:sanitize status: CLEAN date: 2026-09-10 hash: f456813b50e64fb553c435211a9cc516afabd2b2cceab895ce5790fbc782784a -->

<!-- maestro:review reviewer: opus date: 2026-09-10 verdict: approve hash: f456813b50e64fb553c435211a9cc516afabd2b2cceab895ce5790fbc782784a -->
