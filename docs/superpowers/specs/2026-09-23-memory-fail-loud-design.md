# Spec: Деградация memory при недоступности хранилища — «громкий fail» + восстановление по требованию (#77)

**Дата:** 2026-09-23
**Ветка:** `feature/memory-fail-loud`
**Версия:** 4.7.0 → 4.7.1 (Wave 1, 4.7.x по `docs/roadmap.md`)
**Основание:** TODO (пункт «memory layer: если удаленная векторная БД недоступна…») + роадмап
Волна 1 #77 + дизайн-гейт C4 (`docs/roadmap.md`: sqlite-fallback **vs** fail-closed).
**Решение C4 (HITL, 2026-09-23): fail-closed «громкий»** — sqlite-fallback (staging +
sync-back) зафиксирован как non-goal / follow-up. Обсуждение вариантов — см. §1.4.
**Rev. 2 (2026-09-23):** учтено spec-ревью opus (Revise): C1 (throttle-bypass
full-reindex), C2 (синхронная семантика `reindexSession` + post-fact-статусы),
I1–I4 (auto_recall, memory_probe, классификация ошибок, «тихий off»-пути) +
minor M1–M6.
**Rev. 3 (2026-09-23):** round-2 ревью opus — все 12 замечаний подтверждены
закрытыми; учтены новые: N1 (временной критерий `unindexed()`), N2 (формулировка
теста 15), N3 (early-exit-outcomes), N4 (benign-race задокументирован),
N5 (полный process-enum в §7).
**Rev. 4 (2026-09-23):** round-3 ревью opus — N1–N5 подтверждены закрытыми;
учтены новые: F1 (диспатч §5.1 — по временному критерию, stale-record →
полный re-index), F2 (artifacts-статусы в enum), F3 (skip_service),
F4 (default-класс неклассифицированных ошибок), F5 (сброс зеркала
`indexer._fails` в `clearSkip`), F6 (пайплайн стадий в обход гардов),
F7 (порядок §4.3/§4.4, формулировка §7).
**Rev. 5 (2026-09-23):** pinpoint-ревью opus — F1–F7 подтверждены закрытыми;
закрыт R1 (тест 9 синхронизирован с §7: 1× на установку флага + re-entry
event) и nano R2 (guard-пре-чек tool'ом), R3 (`skip_no_record` race-only),
R4 (тест 8 — default-класс), R5 (тест 16 — отсутствие преждевременного
`memory:index_skipped`), полный порядок стадий §8.

## 1. Контекст и проблема

### 1.1 Текущее поведение (факты кода)

- **Бэкенд down при старте opencode** (qdrant/pgvector): `storage.init()` бросает →
  внешний catch `registerMemoryHooks` (`memory/index.js:1831-1836`) → одна строка
  `memory: init failed` в bootstrap-лог → **`return {}` — память off на весь
  процесс**. Documented-контракт: «не молчаливый fallback на sqlite»
  (прецедент I5 — failover исторически был и осознанно удалён;
  `manual_docs/reference/memory.md` «Ошибки и деградация»).
- **Бэкенд упал в середине дня**: upsert-ошибка → `state.recordFail`
  (`memory/state.js:49-56`): `fails++`, при `fails >= 3` — `skip = true`
  (**permanent-skip**). Сессия больше не индексируется (`indexer.js:193`,
  backfill `indexer.js:138`). Восстановление — только ручной правкой state-файла.
- **Данные при этом живы**: полный диалог в opencode-сессии. Startup-backfill
  (`indexer.js:115-152`) перечитывает сессии (окно `backfill_window_days`, cap
  `backfill_max_per_start`) — но: только при старте, не для skip-сессий, и
  **пользователь о потере не знает** (след — только `memory:index_error`/`memory:index_skipped`
  в логе).
- `memory_reindex` (HITL, permission `ask`): sessions-путь = дозаполнение
  `artifacts[]` по **существующим** записям (`backfill.js`); запись отсутствует →
  `skip_no_record`. Восстановление **отсутствующей** записи не умеет (non-goal
  её спеки `docs/superpowers/specs/2026-09-12-memory-reindex-backfill-design.md`).
- Retryable-ошибки эмбеддера (openai сеть/5xx) не съедают страйки и повторяются
  на следующем idle (`indexer.js:383-385`) — транзиентные сбои самоизлечаются.

### 1.2 Боль

Тихая, **необратимая** (для памяти) потеря записей при недоступности
централизованного хранилища + **невидимость** этой потери пользователю.

### 1.3 Что уже «бесплатно»

Опенкод-сессия — фактическое резервное хранение (полная версия данных).
Записи upsert'ятся по `session_id` — дедупlication встроен; повторное
индексирование «потерянной» сессии = перечитать сессию и прогнать существующий
`indexer._run` (summarize → embed → upsert). Отдельная staging-БД не требуется
для восстановления по требованию.

### 1.4 Смысловые варианты (результат обсуждения)

- **A — sqlite-staging + sync-back** («запасной блокнот»): при down БД писать в
  локальный sqlite, при восстановлении — автоматический перенос. Отклонено
  (C4): противоречит P3/I5 («нет тихих авто-fallback»), строит вторую БД +
  sync + разрешение конфликтов ради данных, которые уже живут в сессии.
  **Follow-up** — при потребности в «живости без участия пользователя».
- **B — громкий fail-closed + восстановление по требованию** (принято):
  пользователь видит потерю (в момент работы + по запросу), данные
  восстанавливаются одной HITL-командой, permanent-skip перестаёт быть вечным.

## 2. Цели / Non-goals

**Цели**

- **G1. Громкость, слой 1 — в момент работы:** при неудачном индексировании
  сессии (hard-fail, `recordFail`) пользователь узнаёт об этом в текущей
  сессии: одна строка в system-контекст (механика `experimental.chat.system.transform`,
  прецедент communication-директивы 4.6.0) — AI сам сообщает своими словами.
  При init-fail (память off процесс целиком) — аналогичное уведомление
  «память не работает (причина)» из сокращённого набора хуков.
- **G2. Громкость, слой 2 — по запросу:** `@maestro-memory` показывает список
  «не индексированные сессии: N» с причинами (из state-файла).
- **G3. Восстановимость по требованию:** `memory_reindex` (permission `ask`,
  команда `@maestro-memory-reindex`) получает режим полного re-index
  **отсутствующих** записей по явным session_id (LLM-summarize из сессии)
  + **сброс permanent-skip** для этих сессий.
- **G4. Автоматическое снятие уведомления** при успешном индексировании.
- **G5. DoD волны:** manual_docs-синк + regression entry + changelog.

**Non-goals**

- sqlite-staging / автоматический fallback / sync-back (вариант A) — follow-up.
- Live-ре-проба упавшего бэкенда в пределах процесса (восстановление =
  перезапуск opencode или команда re-index по требованию).
- Изменения политик эмбеддингов, доверия (P3), формата хранения, recall-пути.
- «Пересобрать всё» без явных session_id (YAGNI; весь `memory_reindex` —
  по явным ID).
- Уведомление при **намеренно** отключённой памяти (конфиг) — это выбор
  пользователя, не сбой.

## 3. Артефакты

| Файл | Изменение |
|---|---|
| `memory/index.js` | (1) **все** «тихий off»-пути init (§4.4) — вместо `return {}` сокращённый набор хуков с notice (состав — §4.4); (2) notice-хук `experimental.chat.system.transform` в полный набор хуков, **независимо от `auto_recall`** (I1); (3) флаг-реестр unsaved-сессий (bounded, in-memory, cap 1024 → clear); (4) `memory_reindex`: новый режим full-reindex (вызов `indexer.reindexSession`); (5) `memory_stats_detail`: unindexed-блок (§5.2) |
| `memory/backfill.js` | **не меняется** (artifacts-путь — регрессия) |
| `memory/indexer.js` | (1) после `recordFail` — установка unsaved-флага (reason-класс, §4.1); (2) после успешного `setSummarized` — снятие флага; (3) `reindexSession(id)` — экспорт метода полного re-index, §5.1; (4) классификация ошибки по стадиям (таблица §4.1) — try/catch на каждой стадии (summarize/embed/upsert); (5) unsaved-реестр получает в конструкторе (deps: `setUnsaved(id, reason)` / `clearUnsaved(id)`) — владение реестром — index.js (M1) |
| `memory/state.js` | (1) `clearSkip(id)` (сброс `skip` + `fails` + `lastAttempt → null`); (2) `recordFail(id, errorClass)` — дополнительно хранит `lastErrorClass`; (3) `unindexed()` — read-all, **временной** критерий (N1): `skip === true` **или** (`lastAttempt != null` и (`lastSummarized == null` или `lastAttempt > lastSummarized`)) → `{id, fails, skip, lastAttempt, lastSummarized, lastErrorClass}`. Самовосстановившаяся сессия (`lastSummarized > lastAttempt`) — **не** в списке, даже с персистентным `fails > 0` (`setSummarized` не сбрасывает `fails` — `state.js:45-48`) |
| `memory/index.test.js` / `indexer.test.js` / `state.test.js` | тесты §9 |
| `commands/maestro-memory.md`, `commands/maestro-memory-reindex.md` | сценарии «не индексированные сессии» / «восстановить отсутствующую запись» |
| `manual_docs/` (reference/memory.md, how-to, commands.md), `AGENTS.md`, `changelog.md`, `regression/entries/` | §10 |

**НЕ меняются:** `SECURITY.md` (данные никуда не переносятся),
`skills/maestro/SKILL.md` (пайплайн не затрагивается), storage-бэкенды.

## 4. Уведомление (G1, G4)

### 4.1 Триггер

Установка unsaved-флага (`sessionID → reason`):
- **per-session:** `recordFail` в `indexer._run` (hard-fail). Классификация —
  **детерминированный маппинг по стадии** (I3): `indexer._run` оборачивает
  каждую стадию в собственный try/catch, `errorClass` вычисляется в indexer
  (передаётся в `recordFail(id, errorClass)` и в unsaved-реестр):

  | Стадия / источник ошибки | errorClass |
  |---|---|
  | `storage.upsert` (любая ошибка storage-бэкенда) | `storage_error` |
  | embed, **non-retryable** (plain Error: local embedder down, 401/403, dim mismatch) | `embedder_error` |
  | summarize (LLM-ошибка / невалидный JSON / timeout) | `index_error` |
  | прочее: ошибки `client.session.get/messages`, fallback внешнего `withTimeout` (зависший upsert и т.п. — ошибки, не отнесённые к стадиям выше), F4 | `index_error` (default) |

- **process-level («память не работает в процессе»):** все ранние `return {}`-
  пути init, §4.4. Reason-enum: `init_failed` / `config_invalid` /
  `client_not_installed` / `api_key_env_missing` / `probe_hard_fail`.
- **НЕ триггер:** retryable-ошибки (openai сеть/5xx — `memory:index_retryable`),
  намеренное отключение по конфигу (`no_memory_section`,
  `explicitly_disabled`) и static-валидация (`classifyMemoryConfig`).

### 4.2 Доставка

- Хук `experimental.chat.system.transform` (прецедент `communication.js:135`):
  при установленном флаге — `out.system.push(<одна строка>)`. Инжектится пока
  флаг установлен (стабильно за сессию, как communication-директива).
- **Независимость от `auto_recall` (I1):** notice-хук регистрируется
  **независимо** от `config.auto_recall` — уведомление о потере данных, а не
  функция recall. В текущем коде transform-хук живёт внутри условия
  `auto_recall !== false` (`index.js:1781-1810`) — notice выносится из него.
- **Guard** (паритет `communication.js isEligible`): только top-level сессии
  (без `parentID`), без сервис-сессий `[maestro-memory]`. Fail-soft (try/catch,
  ошибка → без инъекции).
- **Состав сокращённого набора — по пути (§4.4):**
  - `storage.init()` throw / static-config off-пути →
    `{ "experimental.chat.system.transform": noticeHook }` — tools отсутствуют
    (инвариант «fail → нет memory-поверхности» сохранён);
  - `probe_hard_fail` →
    `{ tool: { memory_probe }, "experimental.chat.system.transform": noticeHook }`
    — диагностический tool `memory_probe` **сохраняется** (I2, существующее
    поведение `index.js:577-581` не регрессирует).
- **Снятие:** успешное `setSummarized` для сессии (per-session флаг,
  `clearUnsaved`) / новый успешный init в новом процессе (process-level —
  флаг in-memory, живёт столько, сколько процесс). In-memory реестр —
  bounded (cap 1024 → clear, прецедент `makeBoundedMap`); владение —
  `index.js`, indexer получает `setUnsaved`/`clearUnsaved` конструктором (M1).

### 4.3 Текст (RU, самодостаточный, без данных сессии — SEC-4b)

- per-session: `«maestro memory: данные этой сессии НЕ сохранены в памяти
  (причина: <класс>). Не рассуждай о «памяти проекта» как о актуальной по этой
  теме. Восстановление: @maestro-memory-reindex (по требованию); при
  перезапуске opencode повтор возможен, пока сессия не ушла в skip
  (3 неудачи).»` (M6: не обещать авто-повтор для skip-сессий — backfill их
  не берёт, `indexer.js:138`).
- process-level: `«maestro memory: не работает в этом процессе (причина:
  <класс>) — данные сессий не сохраняются, поиск по памяти недоступен.
  Проверьте доступность хранилища; после перезапуска opencode сохранение
  восстановится.»`

Тексты — канон в JSDoc/константе модуля; тесты ассертят по ключевым маркерам
(«НЕ сохранены», «@maestro-memory-reindex»).

### 4.4 «Тихий off»-пути init (I4 — поимённо)

Все пути, где память **настроена, но не работает** (среда/конфиг, не
намеренный выбор), возвращают сокращённый набор хуков с process-level
notice (reason в скобках) вместо `return {}`:

| Путь (index.js) | reason |
|---|---|
| `storage.init()` throw (catch `:1831`) | `init_failed` |
| `qdrant_config_invalid` (`:437-443`) / `pgvector_config_invalid` (`:444-450`) | `config_invalid` |
| `embedding_api_key_env_missing` (`:454-458`) | `api_key_env_missing` |
| `memory:client_not_installed` (qdrant/pg, `:496-520`) | `client_not_installed` |
| probe hard-fail (`:576-581`) | `probe_hard_fail` (состав — §4.2) |

НЕ уведомляем: `no_memory_section`, `explicitly_disabled`, static-
`classifyMemoryConfig`-причины (намеренное отключение).

## 5. Восстановление по требованию (G2, G3)

### 5.1 `memory_reindex` — расширение

Существующий tool (permission `ask`, args: `action/source/session_ids/specs/…`).
Расширение semantics для `source: "sessions"` + явные `session_ids`.
**Диспатч — по временному критерию N1** (тот же, что у `unindexed()`, F1):

1. Запись **существует и актуальна** (`lastSummarized >= lastAttempt` или
   `lastAttempt == null`) → текущее поведение (artifacts top-up, 0 LLM) →
   `updated` (плюс статусы artifacts-пути, F2).
2. Записи **нет**, **или stale** (`skip === true` **или**
   `lastAttempt > lastSummarized`) → **полный re-index** через
   `indexer.reindexSession(id)` (§5.1.1) → пост-факт-статус (§5.1.2).
   LLM-затраты — как у штатного индексирования (один summarize на сессию).
3. Сессии нет в opencode (`client.session.get` → не найдена) → `not_found`.
4. Task/сервис-сессия (guard-выходы `_run`: `parentID` / `SESSIONS`,
   `indexer.js:196-200`) → `skip_service` (F3, прецедент artifacts-пути).

**Cap:** наследует существующий `max` (20/вызов) — LLM-затраты (M2).

**Сброс skip** (`clearSkip`): `skip = false, fails = 0`; `lastAttempt`
**сбрасывается в null** (C1: иначе `_run` уйдёт по retry-throttle
`retry_interval_min` — `indexer.js:187-191` — молча, и восстановление
не произойдёт). **Сбрасывается также локальное зеркало `indexer._fails`**
(`indexer.js:57-60` — источник `memory:index_skipped`): иначе после
full-reindex с повторным страйком warn сработает преждевременно
(state=1, local ≥ 3) (F5). Вызывается только внутри full-reindex по
явному ID — авто-сбросов нет.

#### 5.1.1 `reindexSession(id)` — семантика (C1, C2)

- **Синхронная для tool'а:** метод **не** идёт через fire-and-forget
  running-queue (`indexer.js:178-183`) и не гардится
  `this.running === true` — выполняется в tool-контексе до ответа;
  retry-throttle **не применяется** (последствие сброса `lastAttempt` в
  `clearSkip`, C1).
- **Свежие данные сессии:** `client.session.get/messages` перечитываются
  (не кэш) — как штатный `_run`.
- **Post-fact-критерий результата (C2):** после выполнения tool проверяет
  факт записи (scan/get по `session_id` — есть во всех трёх бэкендах) —
  это **финальный арбитр** для `indexed`.
- **Early-exit-outcomes (N3):** `reindexSession` возвращает исход ранних
  выходов стадии (`unattributed` / `no_new_messages`) — они **не выводятся**
  из post-fact «записи нет» (он их не различает); post-fact + outcome
  вместе дают честный статус. **Guard-исходы (`not_found`, `skip_service`)
  пре-чекает tool до вызова `reindexSession`** (R2: `client.session.get`
  для `not_found` вызывается всё равно — `parentID` читается из того же
  результата, `SESSIONS` — Set-лукап (`indexer.js:196`)); `reindexSession` гарды повторно не проверяет.
- **Стадии и классификация** — те же, что у `_run` (§4.1); ошибки стадий →
  `failed: <класс>` + `recordFail` (повторный страйк после clearSkip —
  осознанно: хранилище всё ещё лежит → сессия честно уходит в skip-цикл).
- **Гонка с in-flight `_run` (N4) — осознанный benign-race:** пересечение
  с idle-индексированием той же сессии → возможный двойной summarize
  (LLM-стоимость) и двойной version-bump; данные безопасны (upsert по
  `session_id`), статус честен (post-fact). Guard **не** добавляется
  (YAGNI; вероятность мала — HITL-вызов во время idle-окна).

#### 5.1.2 Статусы (per-session, enum)

| Статус | Когда |
|---|---|
| `indexed` | post-fact: запись в storage (создана/перезаписана) |
| `updated` | запись существовала → artifacts top-up (0 LLM) |
| `not_found` | сессия отсутствует в opencode |
| `unattributed` | write-gate: `head === ''` — запись **не** создаётся (`indexer.js:246-250`) |
| `no_new_messages` | `min_new_messages` / пустой транскрипт (включая edge: запись удалена `memory_forget`, в сессии мало нового — M4) |
| `skip_service` | task/сервис-сессия — guard-выходы `_run` (`indexer.js:196-200`), F3 |
| `failed: <класс>` | ошибка стадии (§4.1) |
| (artifacts-статусы) | п.1 диспатча возвращает **без изменений** статусы существующего
  artifacts-пути (`no_change`, `skip_model_mismatch`, `skip_messages_unavailable`,
  `skip_no_embedding`, `skip_service`; `skip_no_record` — race-only при новом
  диспатче — `backfill.js:50-51`), F2/R3 |

Аудит: существующие события `memory:reindex*` + новый результат `full_index`
в enum (попытка), финальный статус — в ответе tool'а (HITL-вывод).

### 5.2 `@maestro-memory` — статус (M5: точка встраивания)

Новый блок в выводе **`memory_stats_detail`** (tool, на котором работает
`@maestro-memory`, `index.js:1656+`): «Не индексированные сессии: N» —
список (session_id, reason-класс из `lastErrorClass`, skip-флаг, последняя
попытка) из `state.unindexed()`. 0 → строка «все сессии проиндексированы».
Ограничение вывода — cap 20 строк + «…(+N ещё)» (прецедент report-капов).
SEC-4b: session_id + enum/числа — допустимо (паритет существующего вывода).

### 5.3 Команда `@maestro-memory-reindex`

Дополнить сценарий: «восстановить память за сессию, которая не сохранилась»
(явные session_id; HITL-подтверждение — permission ask tool'а; LLM-затраты
указываются в описании сценария).

## 6. Конфиг

Новых ключей `maestro.json` **нет** (уведомление — always-on: это факт о
потере данных, не настройка; HITL-решение принято в обсуждении).

## 7. Лог-события (whitelist из logging-spec расширяется)

| Событие | Уровень | Когда | Поля (enum/числа, SEC-4b) |
|---|---|---|---|
| `memory:unsaved_notice` | info | установка unsaved-флага (1× на установку флага; повторный вход в unsaved после clear + новый fail — новый event) | `sessionID`, `reason` (enum §4.1: `storage_error`\|`embedder_error`\|`index_error`) или `scope: "process"`, `reason` (enum §4.4: `init_failed`\|`config_invalid`\|`client_not_installed`\|`api_key_env_missing`\|`probe_hard_fail`) |
| `memory:unsaved_cleared` | debug | снятие флага успешным индексированием | `sessionID` |
| (существующие) `memory:index_error` / `memory:index_skipped` / `memory:reindex*` | — | без изменений; `memory:reindex*` — расширение result-enum на `full_index` | |

Тела ошибок, пути, тексты сессий — НЕ в логи (существующий SEC-4b).

## 8. Security

- Данные **не переносятся** и не дублируются: full-reindex читает ту же
  opencode-сессию, что и штатное индексирование, запись идёт в тот же
  бэкенд через тот же `upsert` (с тем же write-gate: `head === ''` → не
  создавать). P3, доверие, confidential-модель — **не меняются**;
  `SECURITY.md` не изменяется.
- Уведомления и статусы — только reason-классы/enum (SEC-4b): содержимое
  сессий, пути, тексты ошибок — не наружу.
- Full-reindex — HITL (permission `ask`), по явным ID; auto-paths не
  получают новых прав.
- Masking: full-reindex переиспользует **пайплайн стадий `_run`**
  (transcript → `maskTranscript` → summarize → `maskEntry` → embed → upsert)
  через `reindexSession` —
  в обход running/queue/throttle-гардов (§5.1.1, F6), но стадийная
  логика и маскирование идентичны штатному `_run`: `maskEntry` применяет
  текущий confidential-набор (расширение `confidential.paths` постфактум
  **отражается** — побочная польза, задокументировать).

## 9. Тесты (`npm run test:memory` + `npm test`)

**Уведомление**

1. `recordFail` (upsert-throw) → unsaved-флаг (`storage_error`) →
   `system.transform` инжектит notice (top-level сессия); после успешного
   re-index флаг снят (инъекции нет).
2. Guard: task-сессия (с `parentID`) и `[maestro-memory]`-сессия — без
   инъекции (паритет communication-guard).
3. Retryable-ошибка эмбеддера (`EmbedRetryableError`) → флага **нет**.
4. Init-fail (storage.init throw) → сокращённый набор (notice-хук, tools
   отсутствуют, reason `init_failed`) → notice инжектится; bootstrap-лог
   `memory: init failed` — без изменений.
5. **`auto_recall: false`** + init-fail → notice-хук **всё равно**
   зарегистрирован и инжектит (I1).
6. **`probe_hard_fail`** → сокращённый набор = `{ tool: { memory_probe },
   transform: noticeHook }` — `memory_probe` на месте (I2), notice
   инжектится.
7. Notice fail-soft: бросок в guard (session.get throw) → без инъекции,
   без броска наружу.
8. Маппинг §4.1: summarize-ошибка → `index_error`; non-retryable embed →
   `embedder_error`; upsert → `storage_error` (по одному тесту на стадию);
   ошибки `client.session.get/messages` (default-класс, F4) → `index_error`.
9. Log-события: `memory:unsaved_notice` (**1× на установку флага; повторная
   установка после clear + новый fail — новый event**, §7; поля enum) при
   установке; `memory:unsaved_cleared` при снятии. Re-entry: fail → clear →
   fail → второй `memory:unsaved_notice` (в пределах одного процесса).
10. Память disabled по конфигу (`no_memory_section`/`explicitly_disabled`) →
    хуки не регистрируются, инъекций нет (регрессия).
11. Статические off-пути (config_invalid / api_key_env_missing /
    client_not_installed) → сокращённый набор + reason по таблице §4.4.

**Восстановление (full-reindex)**

12. Отсутствующая запись + явный ID, **свежий** `lastAttempt` (C1: только что
    был страйк) → summarize/embed/upsert вызваны, `skip` сброшен,
    `lastAttempt` был сброшен в null, post-fact `indexed`.
13. `clearSkip`: `skip=true, fails=3, lastAttempt=T` → после full-reindex
    `skip=false, fails=0, lastAttempt=null` (C1).
13a. **Stale-record (F1):** запись существует, `fails=1`,
    `lastAttempt > lastSummarized` (не-skip) + reindex → summarize **вызван**
    (не artifacts top-up), post-fact `indexed`.
14. Write-gate: сессия с `head === ''` → статус `unattributed`, запись не
    создана (post-fact), без ложного `indexed` (C2).
15. `min_new_messages`/пустой транскрипт → `no_new_messages` (включая edge:
    запись удалена `memory_forget` — **state при этом не чистится**,
    `lastSummarized` сохранён, в сессии мало нового — M4/N2).
16. Хранилище **всё ещё лежит** при full-reindex → `failed: storage_error` +
    повторный `recordFail` (счётчик идёт с 0 после clearSkip); **после
    clearSkip + ровно одного нового страйка `memory:index_skipped` НЕ
    возникает** (зеркало `indexer._fails` сброшено, F5/R5).
17. Сессия не найдена в opencode → `not_found`, без броска.
18. Cap: >20 session_ids → cap 20/вызов (M2), остаток — в ответе.
19. Регрессия: существующая запись → artifacts top-up (0 LLM), `updated`
    (существующие тесты `memory_reindex` не ломаются).

**State**

20. `state.unindexed()` (временной критерий, N1): в списке — `skip` и
    (`lastAttempt` после `lastSummarized` или без неё); **НЕ в списке** —
    самовосстановившаяся сессия (`fails=1`, `lastSummarized > lastAttempt`)
    и чистые. Поля — в т.ч. `lastErrorClass` из `recordFail(id, class)`.
    Cap-вывод `memory_stats_detail` — 20 строк + «…(+N ещё)».

## 10. Документация (критерий приёмки, AGENTS.md)

- `manual_docs/reference/memory.md`:
  - «Ошибки и деградация» — обновить строки: «Бэкенд недоступен (при старте)»
    → + «уведомление в сессию (system-notice)»; новая строка «Сбой индексации
    во время работы» → уведомление + восстановление по требованию;
    «skip after 3» → «сбрасывается `memory_reindex` (full-reindex)»;
  - `memory_reindex` — новый режим (full-reindex, LLM-затраты, сброс skip);
  - `@maestro-memory` — блок «не индексированные сессии»;
- `manual_docs/how-to/` — новая инструкция (короткая): «Память сессии не
  сохранилась — как восстановить» (уведомление → `@maestro-memory-reindex`);
- `manual_docs/reference/commands.md` — оба command'а; `AGENTS.md` —
  memory-строка (уведомление + full-reindex); `changelog.md` — 4.7.1;
- `docs/roadmap.md` — #77 → закрыт (после merge); `regression/entries/` —
  новый entry (риск: повторная тихая потеря данных при недоступном
  хранилище; триггер: notice не инжектится / full-reindex не снимает skip).

## 11. Acceptance criteria (DoD)

- [ ] Тесты §9 зелёные; `npm test` и `npm run test:memory` — 0 fail.
- [ ] Уведомление в момент работы работает для обоих сценариев (per-session
      hard-fail, init-fail) и снимается после восстановления.
- [ ] Full-reindex восстанавливает отсутствующую запись (E2E-тест с реальным
      sqlite + mock-LLM) и снимает permanent-skip.
- [ ] Docs §10 синхронизированы (grep-верификация по канон-точкам).
- [ ] Regression entry + changelog 4.7.1 + version bump.
- [ ] Spec-ревью (sanitizer + opus) + HITL-утверждение; план — через
      writing-plans.

<!-- maestro:sanitize
status: CLEAN
date: 2026-09-23
reviewer: sanitizer
hash: 7422e4d07f935dc007773a9558930d4312b5a26a326f62a310faa0f85c142fb9
-->

<!-- maestro:review
reviewer: opus
date: 2026-09-23
verdict: approve
hash: 7422e4d07f935dc007773a9558930d4312b5a26a326f62a310faa0f85c142fb9
-->
