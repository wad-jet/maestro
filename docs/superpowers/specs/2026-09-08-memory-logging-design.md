# Аудит-лог memory layer (отдельный `maestro-memory-<дата>.log`) — Design

> Статус: **черновик (draft)**. Дата: 2026-09-08. Ветка: `feature/memory-logging`.
> Категория фичи: **сложная** (полный pipeline; Spec Review — рекомендован).

## 1. Цель и мотивация

Memory layer пишет в тот же bootstrap-лог (`.maestro/logs/maestro-bootstrap-<дата>.log`)
через объект `log`, переданный в `registerMemoryHooks`. Текущее покрытие минимально
(init/probe/diagnostics/ошибки индексатора), **storage-бэкенды не логируют вовсе**,
нет lifecycle-аудита, root-cause-событий и метрик производительности.

Цель фичи — **отдельный аудит-лог** `.maestro/logs/maestro-memory-<дата>.log`
(JSONL) для:

- **lifecycle/аудит** (приоритет): что/когда индексировалось, retention, промоции,
  backfill, удаления;
- **root-cause**: почему search пуст, где упал storage, статусы HTTP внешнего
  embedder, fallback'и, состояние state.json;
- **производительность**: латентности embed/summarize/storage/recall, cache-hit.

Жёсткая дисциплина — **aggregates-only field whitelist** (SEC-4b+, §3).

## 2. Инфраструктура логирования

### 2.1 Отдельный файл через reuse `makeLogger`

`makeLogger` в `core.js` поддерживает `filePrefix` + `filterEnv` (аудит-лог создан
так же, включая `logDirEnv: "MAESTRO_AUDIT_LOG_DIR"` — существующий паттерн
переопределения каталога второго лога). **`makeLogger` расширяется опцией
`logDir`** (явный каталог, fallback — `logDirEnv`/directory). В `core.js`:

```js
const memoryLog = makeLogger(directory, {
  logDir: process.env.MAESTRO_MEMORY_LOG_DIR || log.logDir, // env переопределяет следование за bootstrap-логом
  filePrefix: "maestro-memory",
  filterEnv: "MAESTRO_MEMORY",
});
```

- Приоритет каталога: `MAESTRO_MEMORY_LOG_DIR` (env) > каталог bootstrap-лога
  (`log.logDir`) > `<root>/.maestro/logs` (directory). При env-first следование за
  bootstrap-каталогом отключается — документируется.

- Файл: `.maestro/logs/maestro-memory-<дата>.log`.
- Env: `MAESTRO_MEMORY_LOG_LEVEL` (default `info`), `MAESTRO_MEMORY_LOG_MASK`
  (опц.), `MAESTRO_MEMORY_LOG_DIR` (опц., default = каталог bootstrap-лога).
- Формат/механика — тот же JSONL, что у bootstrap-лога (единый logger).
- **Zero-dep:** новых зависимостей нет; `provision.js DEPS` не меняется.

### 2.2 Проброс в memory-модуль

- `core.js:1189` — `registerMemoryHooks({ client, config, log, memoryLog, root })`.
- `registerMemoryHooks` принимает опц. `memoryLog`; внутренние хелперы
  `logInfo/logDebug/logWarn/logError` пишут в `memoryLog ?? log` (backward compat,
  тесты/без memoryLog — события остаются в bootstrap-логе).
- **Carve-out:** `memory: disabled` и `memory: init failed` пишутся **внутри**
  `memory/index.js` через параметр `log` (bootstrap) — эти строки остаются на
  `log` **напрямую** (не через хелперы `logInfo/…`), чтобы не уехать в memoryLog:
  они нужны в общей картине плагина (HITL-гейт «плагин работает»). core.js также
  логирует `memory: init failed` в свой catch (bootstrap) — не дублируется.
- Security-diagnostics (`unmasked_branch_metadata`, `external_embedder_unmasked_queries`)
  переезжают на `memoryLog`, но **видимость сохраняется** через дублирование в
  выдаче `@maestro-memory` / `memory_stats_detail` (уже реализовано в прошлой фиче).

### 2.3 Storage-бэкенды

`createStorage({ type, options, modelId, dim, textSearchConfig, log })` — `log`
прокидывается **явно в каждой ветке** бэкенда (sqlite: `dbPath/moduleDir`;
qdrant: `client/collection`; pgvector: `pool/table` — в эти options добавляется
`log`). Общий хелпер `timed(log, tag, fn)` для duration + error-class
логирования операций (`upsert/search/get/candidates/delete/init`).

## 3. Field whitelist (SEC-4b+)

Лог — **aggregates-only**: enum + числа + ограниченный набор идентификаторов.
Ниже — разрешённые поля и жёсткие запреты.

| Поле | Допустимо | Примечание |
|---|---|---|
| `sessionID` | да (plain) | уже в отчётах SEC-4b; JOIN-ключ |
| `projectKey` (hash) | да | one-way sha256 |
| `author` | да (plain) | как в отчётах SEC-4b; PII-корреляция — doc-note |
| `branch` | **нормализованный** | стрип ticket-кодов (`[A-Z]+-\d+` → `*`) перед записью; doc-note (локальный лог может покинуть машину через шеринг/бэкап) |
| `provider` | да (flag `local`/`external`) | без `base_url`/хоста |
| `model` | да (имя модели) | для openai — без `@base_url` (эндпоинт не логируется) |
| `dim` | да | число |
| `counts`, `timestamps`, `duration_ms` | да | числа |
| `min_score`, `top_k` | да | числа |
| `len` | биннинг | бакеты (напр. `<100`, `100-500`, `500-2000`, `>2000`), не точное значение |
| `error_class` / `http_status_class` | да (enum) | только класс: `http_5xx`, `timeout`, `network`, `dim_mismatch`, `storage_error`, `auth` … |
| stage/lifecycle enum | да | `indexed`, `skipped`, `promoted`, … |

**Запрещено всегда (SEC-4b):**
- текст `query`/`summary`/`title`/`decisions` записей;
- пути (в т.ч. confidential) и тела ошибок — `Error.message`/`.stack`/HTTP-body
  только в виде `error_class` enum;
- `base_url`/эндпоинты (openai `model_id` содержит хост → логировать только имя модели);
- raw free-text `branch` (только нормализованный);
- значения секретов/ключей (никогда; env-имена допустимы).

**Hard-disable при непустых `confidential.paths` — НЕ вводится** (custodian):
аудит нужен в confidential-проектах сильнее всего; жёсткое отключение ломает
bootstrap-лог и HITL-гейт «плагин работает». Вместо этого — **doc-note**
(`memory:log_confidential_note`, warn, при непустых `confidential.paths`):
локальный лог может покинуть машину через шеринг/бэкап; author/branch-корреляция.

## 4. События

Префикс `memory:` (grep-совместимость с bootstrap-логом).

### 4.1 Lifecycle / аудит (info)
| Событие | Поля |
|---|---|
| `memory:indexed` / `memory:reindexed` | sessionID, projectKey, author, version |
| `memory:index_skipped` (warn) | sessionID, fails |
| `memory:index_retryable` (debug) | sessionID |
| `memory:index_error` (error) | sessionID, error_class |
| `memory:session_deleted` | sessionID |
| `memory:forgotten` | count, filters (массив enum: `session_id` / `author` / `before` — комбинация возможна), без значений |
| `memory:backfill` | considered, indexed, skipped |
| `memory:backfill.done` | duration_ms |
| `memory:retention_pruned` | count, older_than_days |
| `memory:promoted` | count, branches (нормализованные), mainline (нормализованный) |
| `memory:mainline_resolved` (info) / `_unresolved` (warn) | branch (нормализованный) |
| `memory:storage_init` | type |
| `memory:storage_mismatch` (error) | type, model (только имя, без `@base_url`), dim expected/actual |
| `memory:log_confidential_note` (warn) | — |

### 4.2 Root-cause (warn/error + debug)
| Событие | Поля |
|---|---|
| `memory:search.no_hits` (warn) | reason (enum: `no_candidates` / `mainline_unresolved` / `min_score` / `fts_empty`) |
| `memory:storage.error` (error) | type, op, error_class |
| `memory:http.error` (warn) | http_status_class, retryable (bool) |
| `memory:fts.fallback` (debug) | backend, fallback |
| `memory:state.corrupt` (warn) | reason (enum: `parse_error` / `enoent_first_run`) — ENOENT не варн для нового проекта |
| `memory:probe.retry` (info) | cached-hard → live re-probe |
| `memory:cross_project_miss` (debug) | reason (enum), projectKey (hash соседнего проекта) |

### 4.3 Производительность (debug; агрегаты info)
| Событие | Поля |
|---|---|
| `memory:embed.duration` | provider, duration_ms, len_bucket; `cache_hit` — только для openai (локальный Embedder текстового кэша не имеет) |
| `memory:embed.cache_stats` (info, openai) | hit_rate, cache_size |
| `memory:summarize.duration` | sessionID, duration_ms, model |
| `memory:storage.<op>.duration` | type, op, duration_ms, counts |
| `memory:recall.duration` | duration_ms, hits, top_k, min_score, scope |

### 4.4 Эффективность (benefit) — сравнение с «всё в файлах»

Память (авто-поддерживаемый исторический контекст сессий) vs файлы проекта
(курируемый статический контекст, `project-context.md`/docs/, ручное ведение).
Преимущество памяти = релевантный прошлый контекст (решения/откаты/причины),
которого НЕТ в файлах, подмешивается без ручной работы. Показатели в логах:

| Событие | Уровень | Что показывает |
|---|---|---|
| `memory:recall.injected` | info | авто-recall добавил N записей в system-block сессии; >0 и растёт → память реально подмешивает контекст |
| `memory:recall.hits` | debug | найдено N релевантных записей (до порога) — полнота прошлого контекста |
| `memory:backfill` | info | considered/indexed/skipped per окно — полнота захвата истории |
| `memory:storage.stats` | info | cumulative: `entries` (из `storage.stats()`) + tier-счётчики `merged`/`experience` (дешёвые запросы/`candidates()`); **без by-author** (требует расширения бэкендов — non-goal). `experience` = `head != '' && merged == 0` (аппроксимация тира, не точный git-ancestry — фиксируется, чтобы не расходиться с `memory_stats_detail`) |
| `memory:reindexed` | info | пере-саммаризация повторно посещённой сессии — знания «живые», уточняются |
| `memory:promoted` | info | темы перешли в mainline (merged 0→1) — дурабельные, повторяющиеся знания |

> `reuse` отклонена (избыточна: авто-recall-хиты по определению из прошлых сессий).
> `coverage` как отдельное cumulative-событие заменено на `backfill` + `storage.stats`.

## 5. Интеграция (файлы)

- `plugins/maestro-bootstrap/core.js` — создать `memoryLog`, передать в
  `registerMemoryHooks`.
- `plugins/maestro-bootstrap/memory/index.js` — сигнатура `registerMemoryHooks`
  (+`memoryLog`), хелперы `logInfo/…`, перевод существующих событий на `memoryLog`,
  `log_confidential_note`, `probe.retry`, `storage_init/mismatch`, `backfill`,
  `retention_pruned`, `promoted`, `mainline_resolved/_unresolved`, `state.corrupt`,
  `search.no_hits` (в `memory_search`/`memory_recall_preview`), `recall.duration`,
  `fts.fallback`.
- `plugins/maestro-bootstrap/memory/indexer.js` — `indexed/reindexed/index_skipped/
  index_retryable/index_error/session_deleted/summarize.duration/backfill/backfill.done`.
- `plugins/maestro-bootstrap/memory/recall.js` — `recall.duration`, `search.no_hits`,
  `recall.injected` (systemBlock: число записей, попадающих в system-prompt), `recall.hits`.
- `plugins/maestro-bootstrap/memory/embeddings.js` — `embed.duration` (local, без
  cache_hit).
- `plugins/maestro-bootstrap/memory/embeddings-openai.js` — `embed.duration`
  (external, с cache_hit), `embed.cache_stats`, `http.error`.
- `plugins/maestro-bootstrap/memory/storage.js` + `storage/{sqlite,qdrant,pgvector}.js`
  — `log` в createStorage/бэкенды (явно в каждой ветке), `timed()`-хелпер,
  `storage.<op>.duration`, `storage.error`, `cross_project_miss`.
- `plugins/maestro-bootstrap/memory/state.js` — (нет событий; `state.corrupt`
  логируется в index.js при parse-fallback, ENOENT-first-run не варн).
- `memory:storage.stats` (info, периодически) — `entries` из `storage.stats()` +
  tier-счётчики `merged`/`experience` через `storage.candidates()` — в `index.js`
  (backfill-цикл или interval).

## 6. ИБ (SECURITY.md §5a)

- Новый пункт «Логирование memory layer»: отдельный файл; **aggregates-only field
  whitelist** (§3); запрет текста записей/путей/тел ошибок; enum-only ошибки;
  нормализация branch; `base_url`/эндпоинты не логируются; `.maestro/` gitignored
  (по умолчанию не покидает машину), но doc-note о шеринг/бэкап; hard-disable не
  вводится (аудит confidential-проектов).
- Синхронизация manual_docs (правило AGENTS.md).

## 7. Документация

- `manual_docs/reference/memory.md` — секция «Логирование» (файл, env, уровни,
  события, field whitelist) + секция **«Оценка эффективности»**: на что смотреть
  в `maestro-memory-*.log` (грепы по `recall.injected`, `backfill`,
  `storage.stats`, `promoted`, `no_hits`), интерпретация, чек-лист «память
  работает / память молчит / память дорогая»; сравнение с файлами проекта
  (что память даёт сверх статического контекста).
- `manual_docs/how-to/enable-memory.md` — диагностика: где логи, греп по
  sessionID/`duration_ms`, чтение root-cause-событий, определение проблем
  (no_hits-причины, coverage, латентность).
- `SECURITY.md` §5a — пункт про лог-дисциплину (§6).
- `commands/maestro-memory.md` — упоминание файла лога в диагностике.
- `manual_docs/overview/changelog.md` — запись о фиче.
- `docs/project-context.md` — §3 memory layer bullet (аудит-лог).
- `manual_docs/reference/config.md` — env `MAESTRO_MEMORY_LOG_LEVEL/_MASK/_DIR`
  (секция env, рядом с bootstrap-логом).

## 8. Тесты

- `core.js`/index.test.js: `memoryLog` создаётся с `filePrefix: "maestro-memory"`;
  уровень фильтруется `MAESTRO_MEMORY_LOG_LEVEL`.
- `index.test.js`: события init/probe/retention/promoted/mainline/no_hits/state.corrupt
  пишутся в memoryLog (при передаче) / fallback на log; `log_confidential_note`
  при непустых confidential.paths; branch нормализован.
- `indexer.test.js`: lifecycle-события (indexed/reindexed/skipped/retryable/error/
  deleted/summarize.duration/backfill/**backfill.done**).
- `storage.test.js` + backend-тесты: `storage.<op>.duration`, `storage.error`,
  `cross_project_miss`, `storage_mismatch`.
- `embeddings(-openai).test.js`: `embed.duration`, cache_stats, http.error.
- `recall.test.js`: `recall.duration`, `search.no_hits` (причины), `recall.injected`
  (число записей в systemBlock), `recall.hits`.
- `index.test.js`: `storage.stats` (entries + tier-счётчики merged/experience),
  `memory:forgotten` (count/filter enum), carve-out (`memory: disabled` остаётся в
  bootstrap-логе при переданном memoryLog — анти-дубликат).
- **SEC-4b-тест:** прогнать фикстуры через память; ни одна строка
  `maestro-memory-*.log` не содержит query/summary-текста, confidential-путей,
  `base_url`, raw branch с ticket-кодом.
- Env-покрытие: `MAESTRO_MEMORY_LOG_DIR`/`_MASK`; `state.corrupt` — ENOENT (первый
  запуск) vs parse_error (не варн на новом проекте).

## 9. Non-goals / открытые вопросы

- НЕ добавляются: отдельная команда просмотра логов (греп/`@maestro-memory`-подсказка
  достаточно); ротация/архивация (как у bootstrap-лога — по дате); логирование в
  удалённый сборщик; per-record чувствительные идентификаторы (опт-ин — future);
  **by-author в `storage.stats`** (требует расширения бэкендов — future);
  `memory_forget` — НЕ non-goal, аудитируется (`memory:forgotten`, §4.1).
- Открыто: точный regex стрипа ticket-кодов для branch; бакеты `len`; нужен ли
  `author` salt-хэш (пока plain, как в отчётах).

<!-- maestro:sanitize status: CLEAN date: 2026-09-08 hash: f16bdbc9f195bb1cacc30805145dd6770f88cf4580182c721ecf1234478172c1 -->

<!-- maestro:review reviewer: opus date: 2026-09-08 verdict: approve hash: f16bdbc9f195bb1cacc30805145dd6770f88cf4580182c721ecf1234478172c1 -->