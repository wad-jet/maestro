# Как включить память maestro

[Назад к оглавлению](../index.md)

## 🎯 Назначение

Пошаговое включение и настройка **memory layer** — опциональной векторной памяти
сессий плагина `maestro-bootstrap` (авто-саммаризация, `memory_search`,
авто-вспоминание). Полный справочник конфигурации — в
[Память maestro (reference)](../reference/memory.md).

Память — **не обязательная часть maestro**: стандартная установка
(`maestro-install.sh`, agpack) её не включает. Включается **по запросу**.

> **Статус: beta.** Memory layer — экспериментальный функционал: API
> инструментов/команд, схема записей и конфигурация могут меняться между
> версиями без обратной совместимости; данные (вектора, `state.json`) не
> гарантируют миграцию при обновлении. См.
> [Память maestro (reference)](../reference/memory.md).

## ✅ Краткая инструкция (default — локальный sqlite)

1. В `maestro.json` добавить секцию:

   ```json
   {
     "memory": { "enabled": true }
   }
   ```

   > Альтернатива: при установке maestro ответить «да» на опциональный шаг
   > `maestro-install.sh` «Подключить memory layer? (y/N)» — скрипт поставит
   > файл-маркер `<data-dir>/maestro/memory/enabled.flag`, который учтёт
   > `/maestro-setup` при генерации `maestro.json` (секция `memory` появится
   > автоматически).

   > **Канонический способ настройки — через `/maestro-assistant`.** Ручное
   > редактирование `maestro.json` допустимо, но конфигурация памяти (включение,
   > выбор бэкенда, `identity_env`/`namespace`, `retention_days`, `report`,
   > внешний embedder) штатно выполняется `/maestro-assistant` — он читает канон
   > скилла `maestro-assistant`, сформирует diff-merge, добавит обязательное
   > нативное permission-правило и пройдёт HITL-гейт. Подробнее — раздел
   > «Настройка через `/maestro-assistant`» ниже.

2. Запустить opencode один раз — плагин выполнит **self-provisioning**: создаст
   `<data-dir>/maestro/memory/module/`, запишет `package.json` (манифест
   опциональных зависимостей; single-writer — только плагин) и скопирует
   исходники модуля.

3. Установить опциональные зависимости:

   ```bash
   npm install   # в каталоге <data-dir>/maestro/memory/module/
   ```

   > `<data-dir>`: `$XDG_DATA_HOME` → macOS `~/Library/Application Support` →
   > `~/.local/share`; далее `/maestro/memory/module`. Если задан
   > `memory.module_dir` — каталог из конфига.

   > **Время установки:** при первой установке `npm install` может занять больше
   > 5 минут (тяжёлые нативные deps: `better-sqlite3`, `@huggingface/transformers`).
   > Если процесс оборвался по таймауту — просто повторите команду (npm-кэш
   > ускоряет повторный запуск).

4. Перезапустить opencode. Память работает локально: default-модель
    эмбеддингов, auto-recall включён, поиск через `memory_search`. Модель
   загружается один раз (~120 МБ, кэш).

Проверка: в новой сессии задайте вопрос по прошлой работе — в system prompt
появится блок `## Контекст из памяти maestro`; либо вызовите инструмент
`memory_search`.

> **Рантайм:** opencode исполняет плагины под Bun, где нативный `better-sqlite3`
> не поддерживается. Под Bun sqlite-бэкенд автоматически использует встроенный
> `bun:sqlite` — отдельная установка не требуется. Под Node.js (dev/тесты)
> по-прежнему используется `better-sqlite3`.

## 📖 Полная инструкция

### Настройка через `/maestro-assistant`

Канонический способ включить и настроить memory layer — команда
`/maestro-assistant` (консультации и правка `maestro.json`; полный JSON-канон
секции `memory` живёт в скилле `maestro-assistant` — см.
[Команды](../reference/commands.md) и [Конфигурация](../reference/config.md)).

1. Запросите `/maestro-assistant` с конкретной задачей, например:
   - «включить memory layer (локальный sqlite)»;
   - «настроить командную память на qdrant» / «перевести на pgvector»;
   - «задать identity_env / namespace для командной памяти»;
   - «установить retention_days 90»;
   - «подключить внешний embedder (OpenAI-совместимый)».
2. Ассистент прочитает текущий `maestro.json`, сформирует diff-merge
   (идемпотентно, с сохранением пользовательских правок) и покажет
   HITL-гейт: (a) approve — (b) правки — (c) отмена.
3. Ассистент следует канону: при включении добавляет **минимальную** секцию
   `{ "enabled": true }`; остальные ключи (бэкенд, `namespace`, `identity_env`,
   модели, `retention_days`, `report`) — только по явному запросу HITL.
4. При включении памяти ассистент **автоматически** добавит в merge-config
   нативное правило `permission: { memory_forget: "ask", memory_export: "ask",
   memory_import: "ask", memory_prune: "ask" }` (opencode default для новых
   инструментов — allow, поэтому правило обязательно).
5. После правки — напоминание про **онбординг**: рестарт opencode (OP-1) →
   self-provision `module_dir` → `npm install` в `module_dir` → рестарт №2 →
   верификация (`@maestro-memory`, блок «Контекст из памяти maestro»).

> Полную последовательность онбординга см. в каноне скилла
> `maestro-assistant` (раздел «Секция `memory`»). Далее в этой инструкции —
> справочник ключей конфигурации и конкретные бэкенды.

### Выбор бэкенда (`storage.type`)

| Бэкенд | Когда | Конфигурация |
|---|---|---|
| `sqlite` (default) | Личный, локальный | ничего не нужно |
| `qdrant` | Централизованный (команда) | `url` + `api_key_env` (имя env-переменной с API-ключом; **никогда** plaintext в `maestro.json`) |
| `pgvector` | Есть центральный Postgres | `connection_string_env` (имя env-переменной с DSN) |

```json
{
  "memory": {
    "enabled": true,
    "storage": {
      "type": "qdrant",
      "qdrant": {
        "url": "https://qdrant.internal:6333",
        "api_key_env": "MAESTRO_MEMORY_QDRANT_KEY",
        "collection": "maestro_memory"
      }
    }
  }
}
```

```json
{
  "memory": {
    "enabled": true,
    "storage": {
      "type": "pgvector",
      "pgvector": {
        "connection_string_env": "MAESTRO_MEMORY_PG_DSN",
        "table": "maestro_memory"
      }
    }
  }
}
```

Требования к централизованным бэкендам:

- **Identity обязательна** (иначе память off + лог): `identity` → `identity_env`
  → git `user.name`. Identity — подпись записей (`author`), **не access-control**:
  любой член команды с ключом читает всю память проекта. Per-account RBAC —
  server-side задача, вне scope плагина.
- **Решение «локально vs удалённо» — только `storage.type`** (`sqlite` =
  локально; `qdrant`/`pgvector` = удалённо). Ключ `centralized_confidential`
  **удалён** (v3): его назначение (страховка от утечки) обеспечено
  маскированием — raw-confidential и секреты не попадают в контент записей в
  принципе; санизированные данные могут храниться/читаться где угодно.

> **Переключение бэкенда не мигрирует данные автоматически.** Миграция — через
> `memory_export` → `memory_import` (JSONL полной схемы v3, включая embedding;
> см. «Миграция между бэкендами» ниже). Ручное средство без миграции: удалить
> каталог `<data-dir>/maestro/memory/<hash>/` (sqlite) или коллекцию/таблицу
> (qdrant/pgvector) и включить память заново — начнётся backfill.

### Миграция между бэкендами (экспорт/импорт)

`memory_export` / `memory_import` — штатный путь переноса памяти между бэкендами
(например, sqlite → qdrant для командной памяти) и резервного копирования:

1. **Экспорт** из исходного бэкенда: `memory_export` (путь по умолчанию —
   `<data-dir>/maestro/memory/export-<key16hex>-<ts>.jsonl`; можно задать явный
   `path`). Файл — JSONL полной схемы v3 (включая `embedding`, `model_id` и
   git-метаданные `branch`/`head`/`merged`).
   Для проекта с `confidential.paths` инструмент выведет предупреждение о
   локальной границе (данные замаскированы, но могут покинуть машину).
2. **Импорт** в целевой бэкенд: `memory_import({ path })`. Валидация всех строк
   атомарна (схема v3 + `model_id`/размерность + `key` активного проекта;
   git-метаданные `branch`/`head`/`merged` при импорте необязательны);
   каждая запись **повторно маскируется** перед записью. `replace: true` —
   очистить активный `key` перед импортом.
3. **Permission:** `memory_export`/`memory_import` требуют правила `"ask"` в
   merge-config (см. [Конфигурация](../reference/config.md)).

> ⚠️ Экспорт/импорт работают **в пределах одного `key`** (активного проекта).
> Для переноса в другой `namespace`/проект — сначала импорт в тот же key, затем
> смена namespace через `memory_migrate` (пере-keying, см. ниже).

### Ретеншен (TTL записей)

`memory.retention_days` — TTL записей: при старте плагина удаляются записи с
`time_last` старше N дней (лог количества удалённых). **Default `null` —
выключено** (данные не удаляются молча):

```json
{
  "memory": {
    "enabled": true,
    "retention_days": 90
  }
}
```

Ретеншен применяется к замаскированным данным (Level-1, не confidential).
Точечное удаление — через `memory_forget` (по `session_id`/`author`/`before`).

### Отчёт по памяти (`@maestro-memory-report`)

Команда `@maestro-memory-report` генерирует **самодостаточный статический
HTML-отчёт** (inline CSS/JS, без внешних зависимостей) в
`.maestro/memory-report-<YYYYMMDD-HHMMSS>.html`: summary (бэкенд/модель/записей),
timeline-гистограмма по датам, кластеры тем, авторы, граф похожести по
commit-узлам (head-хеши, ветки, тиры).

- **Только агрегаты (SEC-4b):** при `memory.report.include_text: false` (default)
  в HTML не попадают никакие тексты записей (title/summary/decisions) — только
  числа, имена авторов, даты, размеры кластеров, aggregate-label тем, session_id
  в графе.
- `include_text: true` — осознанный opt-in на вставку **замаскированных**
  заголовков/summary (документированное понижение уровня безопасности).
- Статус без файла — `@maestro-memory` (агрегаты в чат).

### Тюнинг поиска (dry-run)

`memory_recall_preview({ query })` — **dry-run авто-вспоминания**: тот же путь,
что у recall (embed → search), возвращает top-k записей со скорами, автором,
датой, проектом. Назначение — подбор `top_k`/`min_score` без угадывания:

- Слишком много нерелевантных хитов → поднять `min_score`.
- Не хватает контекста → увеличить `top_k`.
- Параметры меняются в секции `memory` `maestro.json` (после правки — перезапуск
  opencode, OP-1).

### Командная память: identity и namespace

- **`identity_env`** — имя env-переменной с identity (per-machine, не в общем
  `maestro.json` — иначе вечные merge-конфликты per-user значения). Fallback —
  git `user.name`, затем OS username. `identity` в `maestro.json` — только явный
  override (напр. сервисный аккаунт).
- **`namespace`** — **обязателен** (v5.1): ключ изоляции памяти. Формат
  `microservices.sales.pay` — 1–3 сегмента, lowercase, разделитель `.`;
  нормализация trim+lowercase. Примеры:
  - **Monorepo** (один remote, несколько подпроектов): общий `namespace` →
    общая память подпроектов (напр. `microservices.sales` для всех подпроектов
    sales).
  - **Связанные репозитории** команды: одинаковый `namespace` в каждом → общая
    память.
  - **Домены:** сегменты образуют иерархию — `microservices.sales.orders` и
    `microservices.sales.web` в домене `sales` merged-видят друг друга
    (авто-related); кросс-доменные связи — через `related`
    (напр. `microservices.checkout.notifications` →
    `related: ["microservices.sales.orders"]`).
  - Без `namespace` память **disabled** (`namespace_missing`).
  - **Upgrading-путь (v5.1):** задать `namespace` → `memory_migrate from:auto`
    (легаси hash-бакет переносится в namespace-бакет; max-version-wins на
    sqlite). Смена namespace — через `memory_migrate`, не потеря доступа.

### Branch-aware память (тиры и диагностика)

С v3 память привязана к git-истории: идентичность записи (критерий
матчинга/промоции) — по коммиту (`head`); ключ хранения — `session_id`;
жизненный цикл — по ветке/HEAD; имя ветки — только display. Recall по умолчанию
**commit-scoped** (`scope: "branch"`): общий (mainline) контекст + собственный
«опыт» (неслитые коммиты, достижимые из checkout). Тиры:

> **Память требует git-якоря (write-gate по `head`):** non-git проекты не получают
> новые записи (warn при init); существующие записи остаются читаемыми.

- **general** — запись вошла в mainline (`merged = 1` или `head` достижим из
  mainline);
- **experience** — неслитая работа текущего checkout (аннотация «⚠️ не в main»);
- **не в контексте** — чужая/удалённая/устаревшая работа (только `scope:
  project`);
- **unattributed** — `head = ''` (только `scope: project`).

`scope: "project"` — все записи ключа (плоско). `memory.branch_context: false`
задаёт дефолтный scope = `project` (явный `scope`-параметр всегда побеждает).
Промоция в general — на init по `is-ancestor(head, mainline)`, строго key-scoped;
после удалённого PR нужен локальный `git fetch`/`git pull`. Подробности —
[Память maestro (reference)](../reference/memory.md).

**Диагностика:**

- **`mainline_unresolved`** — mainline не резолвнут (override именует
  несуществующую ветку, либо ни remote HEAD, ни `init.defaultBranch`, ни резерв
  `main`/`master`/`develop` не подтвердились локально). Поведение: при **неявном**
  (дефолтном) `scope` — branch-context эффективно off, **flat recall** (идентично
  `branch_context: false`); при **явном `scope: "branch"`** — degraded-режим
  (general merged=1 + собственные unmerged experience, чужие unmerged исключены).
  В обоих случаях — warn в лог; промоушен-проход пропускается. Как диагностировать: warn
  `memory: mainline_unresolved` в `.maestro/logs/maestro-bootstrap-<дата>.log`
  и/или строка «Диагностика: mainline_unresolved» в выдаче `@maestro-memory`.
  Исправление: задать `memory.mainline` явно (см. gitflow-guidance в
  [Память maestro (reference)](../reference/memory.md)).
- **`unmasked_branch_metadata`** — централизованный бэкенд + непустые
  `confidential.paths`: имена веток (`branch`/`head`/`merged` — git-структурные
  поля, исключение из маскирования) уходят на сервер. Это документированный
  риск, не ошибка; warn дублируется в выдаче `@maestro-memory` (диагностика без
  логов).

### Offline: предзагрузка модели эмбеддингов

Default-модель `Xenova/paraphrase-multilingual-MiniLM-L12-v2` (dim 384, RU+EN,
q8 ~120 МБ, ONNX) загружается однократно с HuggingFace и кэшируется локально.
После загрузки работает офлайн. Для полностью offline-машины — предзагрузите
модель заранее (при наличии сети) или укажите альтернативную
`memory.embedding_model`. При недоступности сети и отсутствии кэша — память off
с логом-инструкцией (сессии работают).

> ⚠️ **Смена `embedding_model` требует переиндексации** (вектора старой модели
> несовместимы с новой): удалить каталог/коллекцию и включить заново.
>
> Методика выбора/замены модели — [Выбор и замена модели эмбеддингов](choose-embedding-model.md).

### Внешний embedder (OpenAI-совместимый API)

По умолчанию эмбеддинги — **локальные** (transformers.js, offline после загрузки).
Опционально можно подключить **внешний embedder** через любой OpenAI-совместимый
`/embeddings` API (`memory.embedding.provider: "openai"`). Это **осознанный opt-in**:
контент записей и recall-запросы покидают машину (маскирование best-effort), нет
offline-режима, есть стоимость вызовов.

```json
{
  "memory": {
    "enabled": true,
    "embedding": {
      "provider": "openai",
      "model": "text-embedding-3-small",
      "base_url": "https://api.openai.com/v1",
      "api_key_env": "MAESTRO_MEMORY_EMBED_KEY",
      "dim": 1536
    }
  }
}
```

Требования:

- **`embedding.dim` обязателен** и должен равняться **нативной** размерности
  модели (без Matryoshka-усечения через параметр `dimensions` — иначе
  dim-mismatch hard-fail).
- **Ключ — только через `embedding.api_key_env`** (имя env-переменной, никогда
  plaintext в `maestro.json`). Переменная должна быть задана в окружении
  opencode; иначе память off (`embedding_api_key_env_missing`).
- **Данные покидают машину** — для проектов с непустыми `confidential.paths`
  при старте выводится init-warn `external_embedder_unmasked_queries` (запросы и
  контент, замаскированные best-effort, уходят генерическому внешнему вендору).
- **Смена модели/провайдера/URL → переиндексация** (другой `model_id`; миграция
  через `memory_export`/`memory_import` для разных `model_id` не поддерживается).

### Проверка работоспособности (probe)

На старте плагин выполняет **проверку работоспособности (probe)** модели
эмбеддингов: локальный — лёгкий чек импортируемости `@huggingface/transformers`
(без форсирования загрузки ~120 МБ); внешний — один POST `/embeddings` с
warmup-строкой. Результат кэшируется в `state.json` на `probe_cooldown_min`
(default `30`) минут.

- **hard-fail** (401/403 — ключ, 404 — модель/URL, dim-mismatch) → память off
  (`embedder_probe_hard_fail`); авто-восстановление при исправлении конфига
  (cached hard не шорт-кейтится — live re-probe на следующем старте).
- **soft-fail** (5xx/timeout/network) → fail-soft: память остаётся, первый embed
  упадёт per-call; не бьём API на каждом рестарте.
- **on-demand:** инструмент `memory_probe` — live-проверка (минуя cooldown),
  обновляет `state.json`, возвращает строку статуса. Команда `@maestro-memory`
  показывает строку «Проверка embedder»; при FAIL/нет данных — вызывает
  `memory_probe` и показывает результат + рекомендации.
- **Ручное восстановление из off-состояния:** удалить запись `embedderProbe` из
  `state.json` или снизить `probe_cooldown_min`.

### Границы удаления

| Что удалить | Что произойдёт |
|---|---|
| `<data-dir>/maestro/memory/enabled.flag` | Маркер install.sh снят; последующие `/maestro-setup` не добавляют секцию `memory` (уже добавленная секция в `maestro.json` остаётся) |
| `module_dir` (`<data-dir>/maestro/memory/module/`) | Удаляется код модуля + `node_modules` (переустановка deps). **Данные не трогаются** |
| `<data-dir>/maestro/memory/<hash>/memory.db` | Удаляется локальная память проекта (sqlite) |
| `<data-dir>/maestro/memory/state.json` | Сбрасывается retry/skip/first-run состояние (backfill-окно отсчитывается заново) |
| Коллекция/таблица (qdrant/pgvector) | Удаляется централизованная память |

Полное отключение памяти: убрать секцию `memory` из `maestro.json` (или
`enabled: false`) и перезапустить opencode — хуки не регистрируются, зависимости
не загружаются.

### Обновления

- `maestro-update.sh` очищает кэш плагина, но **не трогает**
  `<data-dir>/maestro/memory/` — код модуля обновляется в lockstep с плагином
  (self-provision ре-синкает код при смене версии), `node_modules` и данные
  переживают обновления.
- После обновления maestro, если манифест поднял версии deps, а `node_modules`
  старый → память off + лог «повторите `npm install` в module_dir».

## 🛠️ Диагностика

| Симптом | Причина / действие |
|---|---|
| Память не работает, в логе `memory: disabled` с `reason` | Конфигурация невалидна (см. `disabled_reason`: `storage_type_invalid`, `centralized_identity_missing`, `qdrant_config_invalid`, `pgvector_config_invalid`, `pgvector_text_search_config_invalid`, `branch_context_invalid`, `mainline_invalid`, `retention_days_invalid`, `similarity_threshold_invalid`, `embedding_invalid`, `probe_cooldown_min_invalid`, `embedding_api_key_env_missing`, `embedder_probe_hard_fail`, `namespace_missing`, `namespace_invalid`, `related_invalid`, `domain_recall_invalid`) |
| В логе `memory: transformers not installed — run npm install in <module_dir>` | Не выполнена установка deps (шаг 3 краткой инструкции) |
| В логе `memory: init failed` | Ошибка инициализации (бэкенд недоступен, модель не загрузилась и т.п.) — сессии работают |
| Блок `## Контекст из памяти maestro` не появляется | Модель эмбеддингов ещё прогревается (первый запуск), либо нет записей выше `min_score`, либо сессия не top-level primary |
| `memory_search` возвращает «Ничего не найдено» | Память пуста (backfill ещё не прошёл) или запрос ниже порога `min_score` |
| `memory_search` с `project` на sqlite | Чтение соседней БД read-only; при недоступности/несовпадении `model_id`/dim — fail-soft пропуск + лог (не падение) |
| `memory_import` возвращает ошибку с номером строки | Невалидный JSONL / несовпадение `model_id`/размерности / чужой `key` — ничего не импортировано (атомарно) |
| `memory_forget`/`memory_export`/`memory_import` не выполняются | Не задано permission-правило `"ask"` в merge-config (см. [Конфигурация](../reference/config.md)) |

### Логирование и диагностика (аудит-лог memory layer)

Операции памяти пишутся в **отдельный аудит-лог** `.maestro/logs/maestro-memory-<дата>.log`
(JSONL, один файл на день; каталог — `MAESTRO_MEMORY_LOG_DIR`, по умолчанию
каталог bootstrap-лога). Полный список событий и field whitelist — в
[Память maestro (reference)](../reference/memory.md).

**Где смотреть:**

```bash
# Все lifecycle-события по конкретной сессии (indexed/reindexed/skipped/error/
# summarize.duration — несут sessionID; перф-события embed/storage/recall его НЕ несут):
grep '"sessionID":"<session-id>"' .maestro/logs/maestro-memory-$(date +%F).log

# Медленные операции (латентность):
grep 'duration_ms' .maestro/logs/maestro-memory-$(date +%F).log | jq -r 'select(.duration_ms > 5000) | [.msg, .duration_ms] | @tsv'

# Пустые поиски (root-cause):
grep 'memory:search.no_hits' .maestro/logs/maestro-memory-$(date +%F).log
```

**Поднятие уровня для root-cause:** по умолчанию пишутся `info`+ (lifecycle и
эффективность). Для перф-событий и debug-диагностики (`memory:index_retryable`,
`memory:cross_project_miss`, `memory:recall.duration`, `memory:embed.duration`,
`memory:storage.<op>.duration`) задайте:

```bash
export MAESTRO_MEMORY_LOG_LEVEL=debug
```

**Интерпретация `memory:search.no_hits`** (warn, поле `reason`):

| reason | Причина / действие |
|---|---|
| `no_candidates` | В branch-scope нет кандидатов (память пуста или все записи вне контекста) — проверьте `backfill`/`storage.stats` |
| `mainline_unresolved` | Mainline не резолвнут → flat recall; задайте `memory.mainline` явно |
| `min_score` | Записи есть, но ниже порога `min_score` — снизьте порог или проверьте релевантность записей |
| `fts_empty` | Лексическая ветка пуста (FTS-таблица не построена / backfill не прошёл) — гибрид деградирует до векторного поиска |

**Определение проблем:**

- **Память молчит** — `recall.injected` = 0 при `recall.hits > 0`: блок не
  попадает в system prompt (не top-level primary сессия / модель эмбеддингов
  ещё прогревается). `search.no_hits` с `no_candidates` — backfill ещё не прошёл.
  > **`recall.injected` эмитится на каждый turn** (`system.transform`), а не один
  > раз на сессию — при подсчёте учитывайте дубли per-turn.
- **Покрытие** — `memory:backfill` (considered/indexed/skipped) и
  `memory:storage.stats` (entries + merged/experience): мало `indexed` при
  большом `considered` — сессии вне окна `backfill_window_days` или уже
  заиндексированы.
- **Латентность** — большие `duration_ms` в `embed.duration`/`summarize.duration`/
  `recall.duration`; `http.error` у внешнего embedder. Митигация: `top_k`/
  `min_score`, `retention_days`, локальный embedder.

## 🔗 Связанные разделы

- [Память maestro (reference)](../reference/memory.md) — полная схема конфигурации
- [Конфигурация](../reference/config.md) — секция `memory` в maestro.json
- [Агенты и модель доверия](../explanation/agents-and-trust.md) — memory и confidential
- [Выбор моделей](../reference/model-selection.md) — модели памяти
- [Обновление maestro](update-maestro.md)