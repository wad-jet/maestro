# Spec: Деградация memory при недоступности хранилища — «громкий fail» + восстановление по требованию (#77)

**Дата:** 2026-09-23
**Ветка:** `feature/memory-fail-loud`
**Версия:** 4.7.0 → 4.7.1 (Wave 1, 4.7.x по `docs/roadmap.md`)
**Основание:** TODO (пункт «memory layer: если удаленная векторная БД недоступна…») + роадмап
Волна 1 #77 + дизайн-гейт C4 (`docs/roadmap.md`: sqlite-fallback **vs** fail-closed).
**Решение C4 (HITL, 2026-09-23): fail-closed «громкий»** — sqlite-fallback (staging +
sync-back) зафиксирован как non-goal / follow-up. Обсуждение вариантов — см. §1.4.

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
| `memory/index.js` | (1) в catch init-fail (`:1831`) вместо `return {}` — сокращённый набор хуков с notice-инъекцией; (2) notice-хук `experimental.chat.system.transform` в полный набор хуков; (3) флаг-реестр unsaved-сессий (bounded, in-memory); (4) `memory_reindex`: новый режим full-reindex; (5) `@maestro-memory`-статус: unindexed-список |
| `memory/indexer.js` | (1) после `recordFail` — установка unsaved-флага (reason-класс); (2) после успешного `setSummarized` — снятие флага |
| `memory/state.js` | (1) `clearSkip(id)` (сброс `skip` + `fails`); (2) `recordFail(id, errorClass)` — дополнительно хранит `lastErrorClass`; (3) `unindexed()` — read-all: сессии с `fails > 0` / `skip` / (`lastAttempt` без `lastSummarized`) → `{id, fails, skip, lastAttempt, lastSummarized, lastErrorClass}` |
| `memory/indexer.js` | (доп.) полный re-index отсутствующей записи по session_id: экспорт метода (напр. `reindexSession(id)`), вызывающего `_run` (summarize → embed → upsert) из tool-контекса — без новых LLM-механизмов; `backfill.js` **не меняется** (artifacts-путь — регрессия) |
| `memory/index.test.js` / `indexer.test.js` / `state.test.js` | тесты §9 |
| `commands/maestro-memory.md`, `commands/maestro-memory-reindex.md` | сценарии «не индексированные сессии» / «восстановить отсутствующую запись» |
| `manual_docs/` (reference/memory.md, how-to, commands.md), `AGENTS.md`, `changelog.md`, `regression/entries/` | §10 |

**НЕ меняются:** `SECURITY.md` (данные никуда не переносятся),
`skills/maestro/SKILL.md` (пайплайн не затрагивается), storage-бэкенды.

## 4. Уведомление (G1, G4)

### 4.1 Триггер

Установка unsaved-флага (`sessionID → reason`):
- **per-session:** `recordFail` в `indexer._run` (hard-fail upsert/summarize/
  embed-не-ретрайабл). Reason-класс (enum, SEC-4b): `storage_error` /
  `embedder_error` / `index_error`.
- **process-level (init-fail):** память off на процесс → отдельный флаг
  «память не работает» (reason: `init_failed` / `probe_hard_fail`).
- **НЕ триггер:** retryable-ошибки (openai сеть/5xx — `memory:index_retryable`),
  намеренное отключение по конфигу, disabled-причины валидации.

### 4.2 Доставка

- Хук `experimental.chat.system.transform` (прецедент `communication.js:135`):
  при установленном флаге — `out.system.push(<одна строка>)`. Инжектится пока
  флаг установлен (стабильно за сессию, как communication-директива).
- **Guard** (паритет `communication.js isEligible`): только top-level сессии
  (без `parentID`), без сервис-сессий `[maestro-memory]`. Fail-soft (try/catch,
  ошибка → без инъекции).
- **Инициализация-фол:** при init-fail `registerMemoryHooks` возвращает
  **сокращённый** набор `{ "experimental.chat.system.transform": noticeHook }`
  (вместо `{}`) — память не работает, но уведомление доходит. Все остальные
  хуки/tools не регистрируются (инвариант «fail → нет memory-поверхности»
  сохранён).
- **Снятие:** успешное `setSummarized` для сессии (per-session флаг) / новый
  успешный init в новом процессе (process-level — флаг in-memory, живёт
  столько, сколько процесс). In-memory реестр — bounded (cap 1024 → clear,
  прецедент `makeBoundedMap`).

### 4.3 Текст (RU, самодостаточный, без данных сессии — SEC-4b)

- per-session: `«maestro memory: данные этой сессии НЕ сохранены в памяти
  (причина: <класс>). Не рассуждай о «памяти проекта» как о актуальной по этой
  теме. Восстановление: @maestro-memory-reindex (по требованию) или
  автоматический повтор при перезапуске opencode.»`
- process-level: `«maestro memory: не работает в этом процессе (причина:
  <класс>) — данные сессий не сохраняются, поиск по памяти недоступен.
  Проверьте доступность хранилища; после перезапуска opencode сохранение
  восстановится.»`

Тексты — канон в JSDoc/константе модуля; тесты ассертят по ключевым маркерам
(«НЕ сохранены», «@maestro-memory-reindex»).

## 5. Восстановление по требованию (G2, G3)

### 5.1 `memory_reindex` — расширение

Существующий tool (permission `ask`, args: `action/source/session_ids/specs/…`).
Расширение semantics для `source: "sessions"` + явные `session_ids`:

1. Запись **существует** → текущее поведение (artifacts top-up, 0 LLM).
2. Записи **нет** (или `skip = true`) → **полный re-index**:
   `clearSkip(id)` → `indexer._run(id)` (summarize → embed → upsert).
   LLM-затраты — как у штатного индексирования (один summarize на сессию).
3. Сессии нет в opencode (`client.session.get` → не найдена) → `not_found`.

Результат — per-session статусы: `indexed` / `updated` (artifacts) /
`not_found` / `failed: <класс>`. Аудит: существующие события `memory:reindex*`
+ новый результат `full_index` в enum.

**Сброс skip** (`clearSkip`): `skip = false, fails = 0`, `lastAttempt`
сохраняется (аудит). Вызывается только внутри full-reindex по явному ID —
авто-сбросов нет.

### 5.2 `@maestro-memory` — статус

Новый блок: «Не индексированные сессии: N» — список (session_id, причина-класс,
последняя попытка) из `state.unindexed()`. 0 → строка «все сессии
проиндексированы». Ограничение вывода — cap 20 строк + «…(+N ещё)» (прецедент
report-капов).

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
| `memory:unsaved_notice` | info | установка unsaved-флага (1× per session per process) | `sessionID`, `reason` (enum §4.1) или `scope: "process"`, `reason: "init_failed"\|"probe_hard_fail"` |
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
- Masking: full-reindex идёт через штатный `indexer._run` → `maskEntry`
  применяет текущий confidential-набор (расширение `confidential.paths`
  постфактум **отражается** — побочная польза, задокументировать).

## 9. Тесты (`npm run test:memory` + `npm test`)

1. `recordFail` (upsert-throw) → unsaved-флаг установлен →
   `system.transform` инжектит notice (top-level сессия); после успешного
   re-index флаг снят (инъекции нет).
2. Guard: task-сессия (с `parentID`) и `[maestro-memory]`-сессия — без
   инъекции (паритет communication-guard).
3. Retryable-ошибка эмбеддера (`EmbedRetryableError`) → флага **нет**.
4. Init-fail (storage.init throw) → `registerMemoryHooks` возвращает
   сокращённый набор (только notice-хук; tools отсутствуют) → notice
   инжектится; bootstrap-лог `memory: init failed` — без изменений.
5. Память disabled по конфигу → хуки не регистрируются, инъекций нет
   (регрессия).
6. `memory_reindex` full-reindex: отсутствующая запись + явный ID →
   summarize/embed/upsert вызваны, `skip` сброшен, результат `indexed`.
7. Регрессия: существующая запись → artifacts top-up (0 LLM), результат
   `updated` (существующие тесты не ломаются).
8. `clearSkip`: `skip=true, fails=3` → после full-reindex `skip=false,
   fails=0`, `lastAttempt` сохранён.
9. Сессия не найдена в opencode → `not_found`, без броска.
10. `state.unindexed()`: сессии с `fails>0`, `skip`, `lastAttempt` без
    `lastSummarized` — перечислены (в т.ч. `lastErrorClass` из `recordFail`);
    чистые — нет. Cap-вывод `@maestro-memory` — 20 строк.

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
