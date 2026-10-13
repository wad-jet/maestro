---
title: Feedback-report: V2-совместимость timeline.mjs + fail-loud + верификация записи отчёта
date: 2026-10-13
author: maestro-auto
status: draft
---

# Feedback-report: V2-экспорт, fail-loud и верификация записи

## Суть

Три правки по итогам инцидента 2026-10-13 (сессия `ses_ecc3d07abffe4V02dMS2B62lsb`,
репорт-фактура зафиксирована в `.maestro/feedback-reports/report-ses_ecc3d07abffe4V02dMS2B62lsb-2026-10-13.md`):

1. `timeline.mjs` — поддержка V2-экспорта opencode (команда + формат) + fail-loud guard
   против молчаливых пустых агрегатов.
2. SKILL.md — обязательная верификация факта записи файла отчёта до сообщения
   «Отчёт сохранён» (закрывает симуляцию).
3. SKILL.md — канон-правило silent-empty (защитный слой агента поверх fail-loud).

## Проблемы

**P1 — timeline.mjs несовместим с V2-экспортом сессии (падение молча):**
- Команда: скрипт вызывает `opencode export <Session ID>` (строки 69, 117, 123) — на
  V2 CLI это «Unexpected positional argument» → exit 1. Правильная команда:
  `opencode session export <Session ID>`.
- Формат: парсер ждёт V1-структуру (`msg.info.role`, `msg.info.time.created`,
  `msg.parts[].type === "tool"`, `p.tool`, тайминги в `state.time.{start,end}`),
  а V2-экспорт плоский: `msg.type` ("user"/"assistant"), `msg.time.created`,
  `msg.content[].type === "tool"`, `c.name`, `c.state` — и **пер-тул тайминги на
  самом content-item** `c.time.{created, ran, completed}` (проверено на реальном
  экспорте инцидентной сессии: 587/587 tool-элементов; ручная агрегация в отчёте
  искала их в `state` и пропустила).
- Итог при обходе команды (2-й аргумент — готовый export JSON): **exit 0 с нулевыми
  агрегатами** (`toolOps: 0`, `userMessages: 0`, `start: null`) — падение незаметно,
  отчёт собирается вручную.
- V2-различия, которые надо покрыть: tool `shell` (было `bash`), диспатч `subagent`
  с `input.agent` (было `task` + `input.subagent_type`), `metadata.sessionID`
  (было `metadata.sessionId`), review-тайтл в `input.description` (было
  `state.title`), tokens/cost на самом assistant-сообщении (`msg.tokens`,
  `msg.cost`), `info.time.updated` для конца сессии, пер-тул тайминги в
  `c.time` (см. выше).

**P2 — SKILL.md не требует верификации записи (симуляция):**
- Секция «Завершение» (4b): «Сообщи: „Отчёт сохранён в `<путь>`"» — без требования
  проверить фактическое существование файла. 2026-10-13: два ответа подряд заявили
  сохранение без файла; поймал пользователь («Не нахожу файл»), не процесс.

**P3 — нет правила silent-empty:**
- Fallback 3c перечисляет только `{"error":"invalid_export"}` / `{"error":"export_failed"}`
  (сбой, exit 1). Случай «скрипт успешен, но агрегаты нули при реальной активности»
  не описан — агент примет пустую сессию за факт.

## Изменения

### timeline.mjs

1. **Команда экспорта — V2-first с legacy-fallback**
   - Канон: `opencode session export <Session ID>`; при сбое (non-zero exit / error)
     — fallback на legacy `opencode export <Session ID>` (V1 CLI).
   - Выбор кэшируется после первого успеха (модульный флаг) — child-fanout
     (до 100 диспатчей) не спамит двойными вызовами.
   - Применяется в обоих путях: primary-экспорт (без 2-го аргумента) и child-экспорт
     (`exportSession`). Fixture-режим `MAESTRO_TIMELINE_EXPORT_DIR` не меняется.
   - Промежуточный сбой V2-команды перед успешным legacy-fallback — без stderr-шума
     (контракт «одна диагностическая строка при итоговом сбое» сохраняется).
   - Мёртвый shim-код (строки 111–119: создаётся и удаляется, никогда не
     выполняется) — удалить (мусор после прошлого рефакторинга).

2. **Нормализация двойного формата (V1 + V2)**
   - `normalizeMessage(m)` → `{ role, ts, parts, tokens, cost, toolTimes } | null`:
     - V1: `m.info.role`, `m.info.time.created`, `m.parts`
       (tool-часть: `{type:"tool", tool, state}`, длительность
       `state.time.{start,end}`), `m.info.tokens/cost`.
     - V2: `m.type` (user/assistant), `m.time.created`, `m.content[]`
       (tool-часть: `{type:"tool", tool: c.name, state: c.state}`, длительность
       `c.time.{ran, completed}`), `m.tokens/m.cost` (assistant-сообщения).
   - Все три прохода (основная агрегация, metrics, child-fanout) используют
     нормализатор — V1-парсинг не дублируется.
   - Маппинг tool-имён: `bash` (V1) и `shell` (V2) → обе идут в bash-агрегацию по
     первому слову команды; диспатчи: `task`|`subagent`, agent-ключ =
     `input.subagent_type` (V1) `|| input.agent` (V2); child sessionID =
     `metadata.sessionId` (V1) `|| metadata.sessionID` (V2).
   - reviewCycles: тайтл = `state.title` (V1) `|| state.input.description` (V2).

3. **Тайминги — полный учёт в обоих форматах**
   - V1: длительность tool-операции = `state.time.end − state.time.start` (как
     сейчас).
   - V2: длительность = `c.time.completed − c.time.ran` (исполнение; семантика V1
     `start/end`). Если `ran` отсутствует — fallback `completed − created`
     (весь спан операции). Dispatch-задержка (`created → ran`) остаётся в остатке
     блока и попадает в инференс — консистентно с V1-учётом пробелов между
     tool-вызовами.
   - Инференс: прежняя формула V1 (span блока − toolMs блока) — работает для обоих
     форматов одинаково; `toolTimeMs`, `top_ops`, длительности в таблицах
     tools/bash/agents доступны и на V2. Поле `timing` НЕ вводится (данные полные).
   - Session start/end: min/max по меткам сообщений; для **V2-детектированных**
     экспортов — слияние с `info.time` (`created` → старт; `updated` → конец, max).
     V1-поведение не меняется (существующие тесты — без правок); экспорт без
     сообщений — как сегодня (start/end = null).

4. **Fail-loud guard формата**
   - После нормализации: `messages.length > 0` И распознано 0 сообщений с ролью
     user/assistant → stdout `{"error":"format_unrecognized"}` + exit 1, **до**
     записи `history.jsonl` (мусорные метрики не пишутся).
   - Guard считает сообщения с распознанной ролью (независимо от наличия ts —
     V1-сообщение с ролью, но без timestamp не триггерит guard).
   - Обоснование порога: экспорт реальной сессии всегда содержит user/assistant;
     ноль при ненулевых messages = формат не распознан (инцидент 2026-10-13).

### SKILL.md (feedback-report)

1. **3c — актуализация команды и fallback**
   - `opencode export` → `opencode session export` (2 места: описание источника,
     «скрипт сам вызывает…»).
   - Fallback-список дополнить `{"error":"format_unrecognized"}`.
   - **Правило silent-empty (P3):** скрипт успешен (exit 0), но `totals.toolOps = 0`
     И `totals.userMessages = 0` при наличии активности в сессии → трактовать как
     «Нет данных по таймлайну: формат не распознан», не как пустую сессию.

2. **4b «Завершение» — верификация записи (P2)**
   - Новый пункт перед «Сообщи»: обязательная проверка через bash `ls -la <путь>` —
     файл существует И размер > 0. Только тогда «Отчёт сохранён в `<путь>`».
   - Если файл не существует или пуст — НЕ сообщать «сохранён»: честно отчитаться
     о сбое записи, разобраться в причине, перезаписать и верифицировать повторно.
   - Формулировка-принцип: «путь без улики существования не сообщается».

### Версия и доки

- `package.json` → **5.6.6** (патч; источник версии плагина — pkg.version, код
  плагина не меняется).
- `manual_docs/overview/changelog.md` — entry 5.6.6.
- AGENTS.md + `docs/project-context.md` — маркеры версии 5.6.5 → 5.6.6 (docs-drift).
- `manual_docs/reference/commands.md` § `/maestro-feedback-report`:
  - `opencode export` → `opencode session export`;
  - bullet в стиле U1/U4/U5: **U6 (2026-10-13): верификация записи** — путь отчёта
    сообщается только после bash-проверки существования файла.

## Мои решения (builder's calls, по итогам builder-check)

- **Двойной формат (V1+V2), не V2-only:** целевые приложения могут стоять на старом
  CLI; нормализация дешёвая, регрессия исключается существующими тестами.
- **Длительность tool в V2 = `ran → completed` (не `created → completed`):** это
  семантический аналог V1 `state.time.start/end` (исполнение); dispatch-задержка
  `created → ran` уходит в инференс-остаток блока — так же V1 учитывал пробелы
  между tool-вызовами. (Проверено на реальном экспорте: медианы subagent — dispatch
  8.8 с, исполнение 9.3 мин.)
- **Слияние `info.time` — только для V2-детектированных экспортов:** иначе ломаются
  два существующих теста (fixture `formatMs`: `info.time.end` больше последнего
  сообщения; пустой fixture: `messages: []` + `info.time` → null-инвариант).
- **`format_unrecognized` — exit 1** (как у существующих ошибок экспорта), а не
  exit 0 с error-JSON: единый контракт ошибок.
- **Поле `timing` не вводится:** V2-тайминги полные (587/587 в реальном экспорте);
  схема `history.jsonl` не меняется.

## Безопасность

- SEC-4b без изменений: только агрегаты; `format_unrecognized`-выход не содержит
  содержимого сессии.
- Fail-loud не расширяет поверхность данных: те же поля, что при успехе.

## Тесты (`skills/maestro-feedback-report/timeline.test.mjs`)

1. **V2-фикстура (полная):** user + assistant (content: reasoning/text/tool),
   tools `shell`/`subagent`/`question` с `c.time.{created,ran,completed}`,
   `input.agent`, `metadata.sessionID`, assistant `tokens`/`cost`,
   `info.time.{created,updated}`, модель `{providerID, id}` → тоталы, agents (по
   `input.agent`), tools, bash-первые слова, метрики tokens/cost, session
   start/end (слияние info.time).
2. **V2-тайминги:** длительности из `c.time` (`ran→completed`), `top_ops` не пуст,
   `toolTimeMs` > 0, инференс = span − toolMs; tool без `ran` → спан
   `created→completed`.
3. **Fail-loud:** export с нераспознаваемыми сообщениями → exit 1,
   `{"error":"format_unrecognized"}`, `history.jsonl` не тронут.
4. **Регрессия V1:** все существующие фикстуры проходят без изменений.
5. **Команда экспорта — fallback:** существующие fake-`opencode` shim-тесты
   адаптируются под сдвиг аргументов (`export <id>` → `session export <id>`,
   `$2`→`$3`); добавляется порядок «V2-first, legacy-fallback» (shim: session
   export падает → export ок).

## Зависимости / риски

- Не breaking: V1-поведение сохранено, схема результатов не меняется (новых полей
  нет — `timing` решено не вводить).
- Риск: V2-формат может снова измениться в будущих версиях CLI — mit: fail-loud
  guard превращает молчание в явную ошибку «Нет данных» (канон 3c).
- `history.jsonl`: старые записи остаются валидными (schema не меняется).
