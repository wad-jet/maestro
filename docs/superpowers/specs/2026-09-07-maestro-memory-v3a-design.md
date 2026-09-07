# Memory Layer v3a — Backend Parity

## 1. Обзор

Цель — **сценарный паритет** трёх бэкендов памяти (`sqlite` / `qdrant` / `pgvector`): два разрыва поведения,
оставшиеся после v2, выравниваются:

1. **Гибридный текстовый поиск** — сейчас FTS5+RRF только в sqlite; qdrant/pgvector — vector-only
   (текстовый аргумент `query` в `memory_search` на них молча игнорируется).
2. **Кросс-проектный поиск** — сейчас только centralized (qdrant/pg, key-set); sqlite бросает
   `кросс-проектный поиск доступен только для централизованных бэкендов`.

Policy-асимметрии **НЕ выравниваются** (by design, security-инварианты): identity на centralized,
`centralized_confidential` политика, ANN vs brute-force внутренности движка, слабость ранжирования
текстовой ветки qdrant (документируется).

Категория: **Сложная**. Без изменения схемы записей (одна запись на сессию сохраняется; гранулярность
decisions — вне scope, v3). Изменения схем бэкендов — аддитивные и неразрушающие (pg generated-колонка +
GIN; qdrant payload-поле + index); миграция экспорт/импорт не требуется.

## 2. Целевая паритет-матрица

| Сценарий | sqlite | qdrant | pgvector |
|---|---|---|---|
| Гибридный текстовый поиск (`query`) | ✅ FTS5+RRF (уже) | ✅ **новое**: payload full-text + RRF | ✅ **новое**: tsvector + ts_rank + RRF |
| Кросс-проектный поиск (`project`) | ✅ **новое**: read-only соседняя БД | ✅ key-set (уже) | ✅ key-set (уже) |
| Fallback при ошибке текстовой ветки → vector-only | ✅ (уже) | ✅ **новое** | ✅ **новое** |
| Морфология | unicode61 (без стемминга) | токенизация word | `russian` (стеммер) — конфигурируемо |
| Ранжирование текстовой ветки | bm25 (ASC) | ограничено: filter-leg без bm25-порядка | ts_rank |
| Изменения схем | — | payload `text` + index | generated `fts` + GIN |

## 3. Дизайн

### 3.1 Общий RRF-хелпер

Вынести фузию Reciprocal Rank Fusion (k=60) из `storage/sqlite.js` в общий модуль
`storage/rrf.js` — единый код фузии для трёх бэкендов.

- `fuseRrf(vectorHits, textHitLists, { K = 60, fetchEntry }) → Array<{ entry, score, rrf }>`
  — принимает **один** косин-ранжированный список векторных хитов и **массив** текстовых списков
  (по одному на ключ/бэкенд). Ранги для RRF: позиция в соответствующем списке.
- Логика переносится из sqlite как есть (RRF-сумма `1/(K+rank)`, text-only хит — score 0.5).
- **Единая семантика порядка:** итоговый порядок результатов — по `rrf` (не по `score`). `score` остаётся
  display-метрикой (косинус / 0.5). Это устраняет несогласованность «rrf внутри ключа → score снаружи» (§3.4).
- `sqlite.js` рефакторится на хелпер (поведение одного ключа не меняется; тесты гибрида sqlite переиспользуются).

### 3.2 pgvector — текстовая ветка

`init()`:
- `ALTER TABLE <t> ADD COLUMN IF NOT EXISTS fts tsvector GENERATED ALWAYS AS
  (to_tsvector(<config>, coalesce(title,'') || ' ' || coalesce(summary,'') || ' ' || coalesce(decisions,''))) STORED`
- `CREATE INDEX IF NOT EXISTS <t>_fts_idx ON <t> USING gin(fts)`
- **Авто-бэкфилл** старых строк (generated-колонка вычисляется при ALTER); **sync на upsert контента не нужен**
  (STORED-колонка пересчитывается движком на INSERT/UPDATE, включая `ON CONFLICT DO UPDATE`).
  Оговорка: sync относится к контенту; **смена конфига** требует пересоздания колонки (см. ниже).
- **Сверка конфига с колонкой при init:** конфиг запекается в generated-выражение в момент ALTER;
  `ADD COLUMN IF NOT EXISTS` не пересоздаёт её. При каждом init сверять **эффективный** `text_search_config`
  (значение после pg_catalog-fallback, §4) с фактическим выражением колонки (`pg_get_expr(adbin, adrelid)`
  из `pg_attribute` для колонки `fts`). Сверка — по наличию подстроки `'<config>'::regconfig` в выводе
  `pg_get_expr` (формат нормализации варьируется между версиями PG; ложное несовпадение безопасно —
  лишний recreate дёшев). При несовпадении — `DROP COLUMN fts` + `ADD COLUMN` + `CREATE INDEX` **одной
  транзакцией** (не оставлять таблицу без `fts` при падении ADD) + лог. **Эффективный конфиг используется
  единообразно** в DDL, сверке выражения и `plainto_tsquery($1, …)` в search — сырое значение в DDL/сверке
  не участвует (иначе: перманентный DROP+ADD на каждом init для невалидного на уровне PG конфига, либо
  потеря `fts`-колонки).
- `<config>` — интерполированный идентификатор конфига морфологии (см. §4).
- **Операционные оговорки:** `ALTER ... ADD COLUMN ... STORED` — table rewrite + ACCESS EXCLUSIVE lock
  (для локального масштаба — секунды; отметить в docs для shared-серверов).

`search(embedding, { query, … })`:
- При текстовом `query` — вторая ветка:
  `SELECT session_id, ts_rank(fts, plainto_tsquery($1, $2)) AS rank
   FROM <t> WHERE key=… AND fts @@ plainto_tsquery($1, $2) [date/author] ORDER BY rank LIMIT top_k`
  (date/author фильтры применяются; `plainto_tsquery` — безопасно, без операторов; имя конфига — $1 bound-параметр).
- Текстовая ветка + векторная ветка → общий `fuseRrf`.
- Ошибка текстовой ветки (invalid config-имя, синтаксис) → vector-only fallback (log, как sqlite `MATCH` error).
- `get()`/`scan()` переходят на **явный список колонок** (без `SELECT *`), чтобы производная `fts`-колонка
  не попадала в entry-объекты (иначе tsvector-сериализация в данных).

### 3.3 qdrant — текстовая ветка

`upsert(entries)`:
- payload добавляет поле `text = [title, summary, decisions.join(" ")].join(" ")` — **пересчитывается при каждом
  upsert**, включая re-mask-записи через `memory_import` (иначе stale-производная).

`init()`:
- создать payload index на `text`: `field_schema: { type: "text", tokenizer: "word", min_token_len: 2 }`
  (идемпотентно: try/catch — на серверах < 1.10 создание индекса упадёт, но `full_text_match` работает и без
  индекса (per-payload scan); при отказе фильтра срабатывает §3.5 vector-only fallback).
- **Бэкфилл** существующих точек: `scroll` по `text is_empty: true` с **пагинацией `next_page_offset`**
  (один scroll-вызов возвращает ≤10 точек) → per-point `setPayload(collection, { payload: { text }, points: [id] })`
  (реальный API: `payload` — один объект, `points` — список id; per-point вызовы + try/catch → лог, init не ломается).
  Самопроверка (нет точек с пустым text → skip), флаг не нужен.
- **Дублирование текста** в payload (~2× от title+summary+decisions) — принимается и документируется (индексная цена).
- **Оговорка токенизации:** `min_token_len: 2` отбрасывает односимвольные токены — отметить в паритет-матрице docs.

`search(embedding, { query, … })`:
- При `query` — вторая ветка: **filter-only запрос БЕЗ `query`-ключа и БЕЗ `nearest`** (у `Query` enum нет
  `FilterQuery`-варианта — сервер вернул бы 400; корректная форма — top-level `filter`):
  `filter: { must: [key-set, full_text_match({key:"text", text: query}), date/author] }, limit: top_k`
  → textHits (порядок — как вернёт сервер; ранг по позиции). → `fuseRrf`.
- **Ограничение ранжирования** (документируется): filter-leg не даёт bm25-порядка — текстовая ветка даёт
  лексическое совпадение (всплывает через RRF), но не точный bm25-ранг.
- Ошибка → vector-only fallback.

### 3.4 sqlite — кросс-проектный поиск (read-only)

Убрать throw (`sqlite.js` `search`, `project`):

- `resolveSearchKeys({key, project})` → ключи. Для каждого доп. ключа `k`:
  - путь `dataDir/maestro/memory/<sanitizeDirName(k)>/memory.db`;
  - открыть **read-only**: `new Database(path, { readonly: true, fileMustExist: false })`; файла нет → пропуск ключа;
  - **НЕ проходить через `init()`** (там write-операции: CREATE TABLE, FTS-backfill, запись meta);
  - **Fail-soft:** любая ошибка open/search соседней БД (WAL-recovery после упавшего писателя → `SQLITE_CANTOPEN`,
    занятость, повреждение, старая схема без FTS-таблицы/`meta`) → **skip ключа + лог** (зеркалит §3.5).
    НЕ роняет поиск активного ключа;
  - **Сверка модели:** read-only `SELECT value FROM meta WHERE name='model_id'` → несовпадение с активной
    моделью эмбеддинга → skip + лог (иначе «косинусы сравнимы» не обеспечено);
  - тот же поиск по ключу: векторная ветка + (если в соседней БД есть FTS-таблица и задан `query`) FTS-ветка;
    отсутствие FTS-таблицы у старой БД → vector-only (try/catch);
  - соединение закрыть после поиска (без кэша/локов).
- **Слияние результатов:** векторные хиты всех ключей объединяются в один косин-ранжированный список
  (модель сверена, скоры сравнимы), текстовые списки — по-ключевые → **один `fuseRrf`**; итоговый порядок — по `rrf`
  (единая семантика §3.1), дедуп по `session_id`, `LIMIT top_k`.
- Read-only не расширяет write-поверхность.

**Удаления остаются single-key:** `delete`/`deleteByFilter`/`prune` действуют строго в пределах активного key
(не кросс-проектно) — документируется. Кросс-проект — только чтение через `project`-параметр.

**Латентное допущение модели на centralized** (вне scope, документировать в §6 п.3): в одной qdrant-коллекции /
pg-таблице могут лежать записи разных проектов с разными `model_id`; плагин не сверяет их при поиске —
несовместимые эмбеддинги дадут мусорное ранжирование молча (известное ограничение).

**Провенанс sqlite-sibling хитов:** схема sqlite-записей содержит `origin_project_hash` (колонка в `memory`),
поэтому framing в выдаче + `origin_project_hash` работают для соседних БД как и для активного ключа;
дополнительно в выдаче помечать source-key соседней БД (откуда пришёл хит).

### 3.5 Fallback-паритет

Во всех бэкендах ошибка текстовой ветки (invalid query/config/syntax) → vector-only fallback с логом
(как sqlite `MATCH` error). Единое поведение.

### 3.6 Производное текстовое поле и scan/export

Производные поля (`fts` pg, `text` qdrant) **НЕ добавляются** в дефолтный набор `scan`/`export`-полей
(custodian Q1c) — не создаётся второй read-path на тот же контент. Экспорт/импорт-схема не меняется.

## 4. Конфигурация

Новый ключ: `storage.pgvector.text_search_config` (string, default `"russian"`).

- Валидация в `classifyMemoryConfig` (zero-dep гейт): `/^[a-z][a-z0-9_]*$/` **и длина ≤ 63** байт
  (PG-ограничение идентификатора; cap чтобы validated == used). Invalid → `disabled_reason` (`pgvector_text_search_config_invalid`).
  **Область валидации:** ключ проверяется только при `storage.type === "pgvector"` — нерелевантный ключ в
  sqlite/qdrant-конфиге не отключает память.
- Валидируется именно интерполируемая строка (lowercase-only, без нормализации case/trim между проверкой и использованием).
- При `init()` дополнительно сверяется с `pg_catalog.pg_ts_config` (`SELECT 1 FROM pg_ts_config WHERE cfgname = $1`);
  отсутствие → fallback на дефолт `russian` (лог), не ошибка включения.
- query-текст (`plainto_tsquery` второй аргумент) — только bound-параметр, никогда не интерполируется.

## 5. Безопасность

- **Исправление рационала `centralized_confidential` (cross-cutting).** Формулировка в
  `SECURITY.md:109` («Level-1-санизированные данные на стороннем сервере — вне текущей модели доверия») и
  зеркалах неверна. Корректный принцип: **raw-confidential не покидает машину в полном виде и не передаётся
  открыто untrusted LLM; санизированные (после маскирования) данные могут храниться/читаться где угодно.**
  `centralized_confidential: forbid` остаётся консервативным local-first дефолтом с `allow`-opt-in, но
  рационал переформулируется. Файлы: `SECURITY.md` §5a, `manual_docs/reference/memory.md`,
  `manual_docs/explanation/agents-and-trust.md`, `plugins/maestro-bootstrap/README.md`,
  `manual_docs/reference/config.md`.
- **Кросс-проект sqlite — санизированный контент.** Память всегда маскирована до записи (двойное
  маскирование + re-mask в import); чтение соседа не раскрывает raw-confidential. По исправленной политике —
  чтение санизированного разрешено. Гейт: reader opt-in (`project`-параметр, не default) + framing в выдаче
  + `origin_project_hash` (провенанс). Writer-маркер **не** вводится (решение: полный паритет).
  **Остаточный риск prompt-injection от локально подложенной sibling-БД** (атакующему нужен write в
  пользовательский data-dir — уже сильная позиция): митигируется framing (§5a SECURITY.md), документируется
  в §6 п.3.
- **SQL-инъекции:** `plainto_tsquery` (без операторов); имя конфига — whitelist + length-cap + pg_catalog-сверка.
- **Производное текстовое поле** — чистая функция уже маскированных полей; не в дефолтном scan/export.
- **Read-only соседняя БД** — без write-операций (`readonly: true`, не через `init()`).

Инварианты сохраняются: key-scoping удалений, zero-dep гейт, `messages.transform === undefined`,
hooks global try/catch, маскирование до записи, `centralized_confidential` поведение.

## 6. Cross-cutting изменения (pending)

1. Рационал `centralized_confidential` — см. §5. Sync-список (AGENTS.md rule + single-source-of-config):
   `SECURITY.md` §5a, `manual_docs/reference/memory.md`, `manual_docs/explanation/agents-and-trust.md`,
   `manual_docs/reference/model-selection.md`, `manual_docs/reference/config.md`,
   `plugins/maestro-bootstrap/README.md`.
2. Новый ключ `storage.pgvector.text_search_config` (конфиг-канон): `skills/maestro-assistant/SKILL.md`
   (single source config-правил) + `manual_docs/reference/config.md` +
   `manual_docs/how-to/enable-memory.md` (таблица `disabled_reason` — новое значение
   `pgvector_text_search_config_invalid`).
3. Документация паритета: `manual_docs/reference/memory.md` (паритет-матрица, морфология `russian` vs
   unicode61, qdrant-ограничение ранжирования, токенизация `min_token_len: 2`, table-rewrite/lock оговорка,
   **известные ограничения:** латентное допущение model_id на centralized, остаточный prompt-injection
   sibling-БД), `docs/project-context.md` §5.
4. Sandbox E2E-чеклист: `docs/testing/maestro-sandbox-checklist.md` — **F9** (pgvector hybrid),
   **F10** (qdrant hybrid), **F11** (sqlite cross-project read-only).
5. `manual_docs/overview/changelog.md` — запись v3a (по конвенции).

## 7. Изменения контекста (pending)

`docs/project-context.md` §5 — уточнение паритета бэкендов (гибрид/cross-project на всех); §14 не меняется.

## 8. Вне scope (v3)

- Гранулярность decisions (отдельные вектора) — миграция схемы (путь: экспорт/импорт C1).
- Сервер-side полноценное bm25-ранжирование qdrant (зависит от версии сервера/клиента; см. §3.3 ограничение).
- Per-account RBAC (server-side, вне плагина).
- Web-интерфейс поверх отчёта.

<!-- maestro:sanitize -->
status: CLEAN
date: 2026-09-07
hash: 96fe2c3c1e931f9f0df5ddbbcaeca445af32bf2eeaf79d3682aa2153182b7913

<!-- maestro:review -->
reviewer: opus
date: 2026-09-07
verdict: approve
hash: 96fe2c3c1e931f9f0df5ddbbcaeca445af32bf2eeaf79d3682aa2153182b7913
