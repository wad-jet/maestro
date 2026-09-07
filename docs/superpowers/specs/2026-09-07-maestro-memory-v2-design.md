# Maestro Memory Layer v2 — Design

- **Дата:** 2026-09-07
- **Фича:** Memory Layer v2 — управление, качество поиска, эксплуатация, визуализация
- **Категория:** Сложная
- **Ветка:** `feature/maestro-memory-v2` (стек от `feature/maestro-memory`)
- **База:** v1 (реализован, 174+129 тестов; ветка v2 поверх неё)
- **Статус:** черновик (после gate 10 — approve)

## 1. Обзор

Расширение реализованного memory layer (v1) четырьмя направлениями. **Без изменения
схемы данных** (одна запись на сессию остаётся; гранулярность decisions — v3,
миграционным путём станет экспорт/импорт из C1).

1. **Управление (A):** команда `@maestro-memory` (статус/здоровье), инструмент
   `memory_forget` (right-to-erasure), dry-run recall (предпросмотр того, что
   вспомнится для запроса).
2. **Качество поиска (B):** гибридный поиск FTS5+вектор (sqlite), фильтры
   `date_from/date_to/author/project` (кросс-проектный — opt-in).
3. **Эксплуатация (C):** экспорт/импорт JSONL, ретеншен-политика (default off),
   удаление неиспользуемой зависимости sqlite-vec, реальный Bun E2E, кэш git-config.
4. **Визуализация (D):** `@maestro-memory-report` — статический HTML-отчёт из агрегатов
   (SEC-4b), граф похожести сессий.

## 2. Архитектура и потоки

### 2.1 Управление (A)

**A1. Команда `@maestro-memory`** (`commands/maestro-memory.md`) — статус/здоровье памяти:
- Бэкенд (`storage.type`), модель эмбеддингов, число записей — **key-scoped**
  (`stats(key)`: qdrant count с key-filter, pg `COUNT WHERE key`; не вся
  коллекция/таблица).
- Последняя проиндексированная сессия, ошибки из state.json (count), последний
  retry/skip.
- Пути: data-dir, module-dir, активный key (project_hash/namespace).
- Тюнинг-подсказки: текущие `top_k`/`min_score`/`idle_debounce_min` из конфига.
- **Канал данных:** `@maestro-memory` получает данные через **tool-агрегат**
  (`memory_stats_detail`), не чтением файлов вне проекта (external_directory
  friction).
- Вывод — обезличенные агрегаты (SEC-4b), без содержимого записей.

**A2. Инструмент `memory_forget`** (tool hook, `@opencode-ai/plugin`):
```
memory_forget({ session_id?, author?, before? }) → результат
```
- Удаление записей по `session_id` / `author` / `before` (дата) — все 3 бэкенда
  (`storage.deleteByFilter`).
- Доступ через permission-гейт: **merge-config пишет `permission: { memory_forget: "ask",
  memory_export: "ask", memory_import: "ask" }`** (opencode default для новых тулов —
  allow, поэтому правило обязательно). Канон правила — maestro-assistant SKILL.md +
  `manual_docs/reference/config.md`; включение памяти v2 без правила —
  документированный обязательный шаг.
- **`deleteByFilter` действует строго в пределах активного key** (на shared-бэкендах
  qdrant/pg общая коллекция/таблица — фильтр включает key-условие; удаление вне
  ключа — вне scope, v3).
- При `author` — фильтр по метаданным (identity — атрибуция, не access-control,
  custodian Q/A #1); прав на особый gate не требуется.
- Возврат: количество удалённых записей (агрегат).

**A3. Dry-run recall** (`memory_recall_preview` tool, опционально встроен в
`@maestro-memory`):
- Для запроса `query` — вернуть top-k записей со скорами и источниками (title,
  дата, автор — без summary-текста в команде; в tool — с summary, т.к. это
  рабочий инструмент агента, не файл-артефакт).
- Назначение: тюнинг `top_k`/`min_score` без угадывания.

### 2.2 Качество поиска (B)

**B1. Гибридный поиск (sqlite):** FTS5-таблица `memory_fts` (title+summary+decisions —
  decisions индексируются `join(" ")`, не JSON-строкой) + векторный KNN. Fusion —
  RRF (Reciprocal Rank Fusion, `k = 60`): `score = Σ 1/(k+rank)` для обоих списков.
  Порог `min_score` применяется к векторному скору; FTS-совпадения (ранг)
  добавляются в fusion независимо. **FTS-синхронизация при ВСЕХ путях записи и
  удаления:** upsert (добавить/обновить), delete, deleteByFilter, prune,
  replace-импорт. **Backfill существующих v1-БД:** при init —
  `CREATE VIRTUAL TABLE IF NOT EXISTS` + one-time backfill из `memory` (лог
  количества проиндексированных) — без этого гибрид тихо деградирует в
  vector-only на всех существующих БД. FTS5 unicode61 без русской морфологии —
  лексическое совпадение токенов (документируется). Для qdrant/pgvector — остаётся
  векторный поиск (payload text-match — v3).

**B2. Фильтры `memory_search`:**
```
memory_search(query, { limit?, date_from?, date_to?, author?, project? })
```
- `date_from`/`date_to` — фильтр по `time_last`.
- `author` — фильтр по атрибуции.
- `project` — **кросс-проектный opt-in** (custodian Q/A #5): поиск по записям
  других проектов, показывая `[проект]` в выдаче. Только когда задан явно
  (не default); данные маскированы.
- **Семантика `project`:** принимает namespace, git-remote/URL (канонизация как в
  `project.js` → hash) или готовый project_hash. `@maestro-memory` показывает активный key
  (ориентир для значений).
- **Реализация (sqlite):** sibling-БД `<data-dir>/maestro/memory/*/memory.db`
  перечисляются (read-only, фильтр по `key`); **ИЛИ** кросс-поиск только для
  centralized-бэкендов (qdrant/pg — единая коллекция/таблица с key-фильтром).
  Выбор на этапе плана; для sqlite предпочтителен centralized-only (кросс-поиск
  между per-key файлами — открытие нескольких БД, новая поверхность
  конкурентного доступа).

### 2.3 Эксплуатация (C)

**C1. Экспорт/импорт JSONL** (`memory_export` / `memory_import` tools):
- `memory_export({ path?, include_decisions? })` — записать все записи активного
  key в JSONL. **Состав записи = полная схема v1**, включая `embedding` (массив
  float) и `model_id` — экспорт/импорт служит миграцией между бэкендами.
  По умолчанию путь — локальный (`<data-dir>/memory/export-<sanitizeDirName(key)>-<ts>.jsonl`);
  путь наружу машины — осознанный выбор пользователя (tool выводит путь).
  Имя файла — `sanitizeDirName(key)` (16 hex), не сырой 64-hex hash.
- `memory_import({ path, replace? })` — прочитать JSONL, **валидировать** записи
  (схема v1, включая `model_id`/`dim` — несовпадение → **атомарная ошибка, ничего
  не импортируется**, с инструкцией), **повторно маскировать каждую запись**
  (`sanitize()` + confidential path-фильтр — тот же double-masking, что в
  индексаторе v1), затем upsert. Коллизия `session_id` — upsert поверх (version
  из файла); `replace: true` — очистить активный key перед импортом
  (deleteByFilter по key).
- **Локальная граница (custodian Q/A #3):** для проекта с `confidential.paths`
  экспорт печатает предупреждение «данные замаскированы, но могут покинуть
  машину — осознанный выбор»; импорт в централизованный бэкенд подчиняется
  обычным требованиям (identity — уже enforced при init storage).
- Миграция между бэкендами: экспорт из A (с embedding), импорт в B (покрывает
  phase-2 «переиндексация»).

**C2. Ретеншен:** `memory.retention_days: null` (default off — данные не удаляются
молча). При явной настройке — `onStartup` вызывает `storage.prune(olderThanDays)`
(удаление записей старше N дней по `time_last`), лог количества удалённых.

**C3. Удалить sqlite-vec:** убрать из `package.json` devDeps, манифеста
`provision.js`, `provision.test.js`, доков (reference/memory.md, how-to). Бэкенд
остаётся brute-force cosine (заявленные объёмы — тысячи записей, достаточно).

**C4. Реальный Bun E2E:** чек-лист в `docs/testing/maestro-sandbox-checklist.md` —
живая сессия opencode с `memory.enabled: true` (запуск opencode в sandbox-проекте,
одна сессия, проверка `memory.db` создан, `memory_search` возвращает результат).
Закрывает критерий приёмки v1 (§3.5 «E2E в реальном рантайме»).

**C5. Кэш git-config:** дедупликация `execSync("git config ...")` — сейчас 3 вызова
при init (core `user.name` + memory `user.name`/`remote.origin.url`); свести к
одному вызову, кэшировать в замыкании.

### 2.4 Визуализация (D)

**D1. Команда `@maestro-memory-report`** (`commands/maestro-memory-report.md`): агент генерирует
статический HTML-отчёт через данные `memory_stats_detail` (tool-агрегат) → сохраняет
в `.maestro/memory-report-<key>-<ts>.html`. **Только агрегаты (SEC-4b, custodian
Q/A #4):**
- Таймлайн: количество записей по датам (гистограмма).
- Кластеры тем: **кластеризация и pairwise-cosine вычисляются в `memory_stats_detail`**
  (storage `scan(key, {fields})` → embedding; O(n²) cosine в tool, не в LLM).
  Тема-метка кластера генерируется LLM из **маскированных `title` участников**
  кластера (класс экспозиции = `memory_search`, не summary), как **агрегат-описание**
  («решения по конфигурации»).
- Топ-решения: как **частоты/темы**, БЕЗ встраивания summary/decisions текста.
- Статистика: по авторам, по бэкенду, модель, число записей (key-scoped).
- `memory_report.include_text: false` (default) — при `true` (осознанный opt-in)
  в отчёт попадают маскированные саммари/заголовки (документируется как
  понижение уровня безопасности). При `false` тексты в HTML не попадают вовсе.

**D2. Граф похожести:** в том же отчёте — вершины-сессии, рёбра = cosine > порога
(`memory.similarity_threshold`, default 0.7); рендер без текста (узлы по session_id,
тайтл-подписи только при `include_text: true`).

## 3. Конфигурация (maestro.json, дополнения к секции `memory`)

```json
"memory": {
  "enabled": true,
  ... (ключи v1 без изменений),
  "retention_days": null,
  "similarity_threshold": 0.7,
  "report": { "include_text": false }
}
```

- `retention_days`: `null` (default) — отключено; число — TTL записей, prune при старте.
- `similarity_threshold`: порог для кластеров/графа в отчёте.
- `report.include_text`: `false` (default) — только агрегаты; `true` — маскированные
  значения в HTML-артефакт (осознанное понижение, документируется).

## 4. Безопасность (SECURITY.md)

- **A2 `memory_forget`:** операция над замаскированными записями, нейтральна к
  границе доверия (custodian #1); author — метаданные, не access-контроль;
  permission `ask` (обязательное правило в merge-config).
- **C1 экспорт/импорт:** пересекает локальную границу данных — прецедент
  `centralized_confidential`: default stay-local; для confidential-проектов —
  предупреждение; импорт в centralized — стандартные требования (identity).
- **C1 `memory_import` — второй write-path в память:** обязательны (а) **повторное
  маскирование каждой записи перед записью** (инвариант §5a SECURITY.md —
  double-masking как в индексаторе v1), (б) **permission `ask`** — импорт без
  подтверждения не выполняется (защита от poison-JSONL в shared-бэкенд:
  injection-текст в summary не попадает в system-prompt сокомандников).
- **D1 `@maestro-memory-report`:** файл-артефакт — **только агрегаты** (SEC-4b);
  `include_text: true` — явный opt-in, документируется как понижение.
- **B2 кросс-проектный поиск:** opt-in (не default), данные маскированы;
  прецедент — `namespace` (осознанный шаринг). Остаточный риск prompt-injection
  сохраняется (mitigated framing из v1).
- **C2 ретеншен:** default off (нет тихих удалений); маскированные данные при
  TTL — Level-1, не confidential.
- **Write/boundary-tools канон:** правило для будущих тулов — новые
  write/boundary-tools → permission `ask` (канон в maestro-assistant).
- Остальные инварианты v1 без изменений (masking до/после LLM, confidential не
  индексируется, messages.transform undefined).

## 5. Ошибки и деградация

| Сбой | Поведение |
|---|---|
| FTS5-таблица не построена / backfill пуст | Гибрид деградирует до векторного поиска + лог; поиск работает |
| FTS MATCH syntax error / невалидный запрос | Fallback vector-only + лог (не падение) |
| Экспорт: нет записей / путь невалиден | Память off не включается; tool возвращает понятную ошибку |
| Импорт: невалидный JSONL / несовпадение model_id/dim | Ошибка с указанием строки; ничего не импортируется (атомарно по файлу) |
| Prune: бэкенд недоступен | Лог, без тихого пропуска |
| Кластеры: мало записей (<2) | Отчёт показывает статистику без графа/кластеров |

Все хуки — глобальные try/catch-guarded (инвариант). Инвариант
`experimental.chat.messages.transform === undefined` сохраняется.

## 6. Тестирование

- storage: `deleteByFilter` (session_id/author/before, **key-scoped**) на
  sqlite/qdrant/pgvector; `prune`; FTS5-таблица (**backfill из существующих записей,
  sync при delete/deleteByFilter/prune/replace-импорт**); гибридный поиск (RRF
  fusion k=60, фильтры date/author/project); `stats(key)` key-scoped; `scan(key)`.
- tools: `memory_forget` (агрегат-количество, permission `ask` без подтверждения —
  блок), `memory_export/import` (JSONL round-trip с embedding, replace, валидация
  model_id/dim, **confidential-паттерн в JSONL → замаскирован в БД**, import без
  подтверждения — блок), `memory_recall_preview`.
- commands: `@maestro-memory` (статус-агрегаты через tool), `@maestro-memory-report` (HTML только
  агрегаты; include_text: false не содержит summary-текста).
- config: retention_days валидация, report.include_text.
- **Новые tools недоступны сессиям саммаризатора `[maestro-memory]`** (как
  `memory_search`); регистрируются только при `memory.enabled === true`
  (zero-dep инвариант).
- E2E: чек-лист реального Bun-прогона (C4) + **ask-гейт срабатывает для
  memory_forget**.
- Инварианты: hooks глобальные; messages.transform undefined (уже есть).

## 7. Документация (критерий приёмки)

- `manual_docs/reference/memory.md` — новые tools (`memory_forget`, `memory_export/import`,
  `memory_recall_preview`), команды `@maestro-memory`/`@maestro-memory-report`, конфиг (retention,
  similarity_threshold, report), гибридный поиск, фильтры.
- `manual_docs/how-to/enable-memory.md` — ретеншен, экспорт/импорт, отчёт, тюнинг через dry-run.
- `manual_docs/reference/config.md` — новые ключи `memory` + **правило permission
  (`memory_forget/export/import: "ask"`)**.
- `skills/maestro-assistant/SKILL.md` — канон (новые ключи + правило
  «write/boundary-tools → ask»).
- `commands/maestro-memory.md`, `commands/maestro-memory-report.md` — новые команды.
- `README.md`, `plugins/maestro-bootstrap/README.md`, `SECURITY.md` (§5a — экспорт
  граница, отчёт-агрегаты, кросс-проект opt-in), `AGENTS.md`, changelog.
- `docs/project-context.md` — команды `@maestro-memory`/`@maestro-memory-report`, новые ключи.

## 8. Изменения контекста (pending)

- `docs/project-context.md` §5 — команды памяти; §14 — новые команды.

## 9. Вне scope (v3)

- Гранулярность decisions (отдельные вектора) — требует миграции схемы (путь: экспорт/импорт C1).
- Qdrant/pgvector payload text-match гибрид.
- Пер-account RBAC (server-side, вне клиентского плагина).
- Web-интерфейс поверх отчёта.

<!-- maestro:sanitize -->
status: CLEAN
date: 2026-09-07
hash: dcf9f5954d374415b7d367d10f202253705cea5d964847fe0c552bb64572524b

<!-- maestro:review -->
reviewer: opus
date: 2026-09-07
verdict: approve
hash: dcf9f5954d374415b7d367d10f202253705cea5d964847fe0c552bb64572524b