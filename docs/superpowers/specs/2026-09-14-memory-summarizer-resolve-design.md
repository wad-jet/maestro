# Spec: Zero-key резолв модели саммаризации для memory layer (4.0.0)

## 1. Контекст и проблема

Ключ `memory.summarizer_model` в `maestro.json` содержит строку `"provider/model"` —
идентификатор модели, специфичный для окружения разработчика. При этом
`maestro.json` **коммитится в git**: в ходе сессии 2026-09-13 значение
`akash/Qwen/Qwen3.8-27B` попало в коммит (позднее отменено `git reset`).

Принцип пользователя: **модели указываются в opencode.json** (глобальный
`~/.config/opencode/opencode.json` или проектный `.opencode/opencode.json` —
локальные/gitignored файлы) и **в коммит не попадают**.

Связанный прецедент — SECURITY.md P2: «модель — атрибут имени» (trust-архитектура
привязывает доверие к имени агента, модель задаётся в merge-конфиге). Для
саммаризатора мы идём дальше: модель вообще не задаётся в maestro.json.

Проверенные факты (opencode v1.18.30, типы `@opencode-ai/sdk` + эмпирика
`opencode debug config` / `opencode debug agent`):

- `PluginInput` = `{ client, project, directory, worktree, serverUrl, $ }` —
  opencode-конфиг в инициализацию плагина **не передаётся** (core.js:922).
- `SessionPromptData.body`: `model?: {providerID, modelID}` (optional) —
  саммаризатор передаёт именно `model`, НЕ `agent` (инвариант I2').
- `client.config.get({ query: { directory } })` → `GET /config` → полный
  merged-конфиг: `model?: string`, `small_model?: string` («Small model to use
  for tasks like title generation»), `agent?: { [name]: AgentConfig }`,
  `AgentConfig.model?: string`.
- Файловые агенты (`.opencode/agent/*.md`) присутствуют в `agent`-секции
  резолвленного конфига со строкой model (эмпирика: `custodian` →
  `"akash/Qwen/Qwen3.8-27B"`).
- `splitModel` (memory/summarize.js) делит по **первому** `/` — modelID сам
  может содержать `/` (`Qwen/Qwen3.8-27B`) — корректно.

## 2. Goals / Non-goals

**Goals:**
- Полностью убрать `memory.summarizer_model` из схемы конфига памяти;
  **заменного ключа нет** (zero-key).
- Наблюдаемый резолв модели саммаризации из opencode-конфига через
  `client.config.get()`.
- I1 (fail-closed) для git-пути: батч стартует только при резолвленной модели;
  причины — enum; guard — до батча (0 LLM).
- Сохранить детерминизм служебного промпта саммаризации (`model`, не `agent`).
- Без обратной совместимости: миграционных кодов нет; если старый ключ
  остался в конфиге — молчаливый игнор (подтверждено пользователем).

**Non-goals:**
- Omit-model (промпт без `model` в body) — семантика сервера не верифицирована;
  possible follow-up (однонаправленная эволюция цепочки).
- `agent` в body `session.prompt` (вариант B1) — отклонён: подмешивание
  system-prompt/tools агента ломает JSON-контракт `parseSummary`.
- Нейтральный селектор `memory.summarizer: "small" | "main"` — YAGNI.
- `summarizer_model` как рабочий override — нет (цель — убрать model-ID из
  коммитимого файла).
- Любая специальная обработка legacy-ключа (warn, детект, миграция) — нет
  (обратная совместимость не предусматривается).

## 3. Решения (согласовано с пользователем, 2026-09-14)

- **D-1 (zero-key).** Заменного ключа в maestro.json нет. Источник модели —
  opencode-конфиг. (Выбор пользователя: «D: zero-key».)
- **D-2 (основная цепочка).** `small_model → model` — та же деградация, что
  применяет сам opencode для фоновых задач (title generation).
- **D-3 (git-путь: расширенная цепочка + guard).**
  `small_model → model → agent.maestro?.model → agent.build?.model → guard`.
  (Выбор пользователя: «Цепочка + guard» вместо omit-model.)
- **D-4 (sessions-путь).** `small_model → model → модель саммаризируемой
  сессии` (последний шаг — текущее поведение, сохраняется побайтово).
- **D-5 (полный ренейм = удаление, без обратной совместимости).** BREAKING,
  версия **4.0.0 (major)** — semver + прецедент репо (v2.0.0 —
  переименование команд → major). Legacy-ключ не читается: нет warn,
  детекта и миграции — остаток в старых конфигах молчаливо игнорируется
  (подтверждено пользователем 2026-09-14; вариант 4.0.0 зафиксирован на
  spec gate 2026-09-14).
- **D-6 (guard по резолву).** Guard проверяет **резолв**, а не наличие ключа;
  причины — enum (`no_model_resolved | config_get_failed |
  invalid_model_ref`); невалидная строка модели не может дойти до
  `session.prompt` (B-2).
- **D-7 (без init-кэша).** Резолв per-call / per-batch (M-1): конфиг живой;
  стоимость GET /config ничтожна на фоне LLM-вызова.
- **D-8 (summarize.js без изменений).** Принимает resolved-строку
  `"provider/model"` как сегодня; в `session.prompt` — `model`, не `agent`
  (оправдание зафиксировано: B1 отклонён).

Дизайн-ревью: opus (сессия 2026-09-14), verdict Revise → правки B-1…B-4,
M-1…M-4 учтены в настоящей спеке.

## 4. Дизайн

### 4.1 Конфиг (`memory/config.js`)

- `DEFAULTS.summarizer_model` — **удалить** (ключ исчезает из схемы).
- Никакой специальной обработки legacy-ключа: остаток в maestro.json не
  читается никем (безопасный passthrough через spread), warn/детекта нет —
  обратная совместимость не предусматривается (D-5).
- `classifyMemoryConfig` — без изменений.

### 4.2 Новый модуль `memory/resolve-model.js` (+ co-located тесты)

```js
resolveSummarizerModel({ client, root, timeoutMs = 5000, chain = "full" })
  → { model: string|null,
      source: "small_model"|"model"|"agent_maestro"|"agent_build"|null,
      error: "config_get_failed"|"invalid_model_ref"|"no_model_resolved"|null }
```

- **`chain`** (уточнение Ruling 1, 2026-09-14): `"full"` (default) — все 4
  кандидата (git-путь, D-3); `"core"` — только `small_model` + `model`
  (sessions-путь, D-4 — agent-шаги недостижимы, fallback на модель сессии).

- Вызов: `client.config.get({ query: { directory: root } })` → unwrap
  `resp?.data ?? resp` (паттерн summarize.js:37).
- **Цепочка** (первый валидный кандидат побеждает):
  `cfg.small_model` → `cfg.model` → `cfg.agent?.maestro?.model` →
  `cfg.agent?.build?.model`.
- **Валидация кандидата:** строка приводится к trim; валиден,
  если: `typeof === "string"`, не пуст после trim, `indexOf("/") > 0` И обе
  части вокруг **первого** `/` непустые после trim (providerID и modelID;
  degenerate-ссылки вида `"prov/"` отклоняются — пустой modelID не должен
  дойти до `session.prompt`).
- **Результат резолва — trimmed-строка** (используется как есть в
  `splitModel`).
- Невалидный кандидат — **пропустить** (fail-soft) и продолжить цепочку; если
  хотя бы один кандидат был невалидным, а резолва не случилось — финальная
  ошибка `invalid_model_ref`; резолва нет и невалидных не было —
  `no_model_resolved`.
- Любой сбой вызова (сеть, таймаут, отсутствие `client.config` — включая
  **синхронный** `TypeError`) — `config_get_failed` (B-3). Таймаут 5 с —
  симметрия **механизма** с `probeWithGuard` (там guard 20 с; для локального
  GET /config значение меньше).
- **Без кэша** (I4/D-7).

### 4.3 Sessions-путь (`memory/indexer.js`)

- Перед саммаризацией: `const r = await resolveSummarizerModel({ client, root, chain: "core" })`;
  в `summarize(...)` передаётся `summarizerModel: r.model` (вместо
  `this.config.summarizer_model ?? null`).
- `r.model === null` → текущая семантика: fallback на модель саммаризируемой
  сессии (внутри summarize.js, без изменений).
- Любой `error` (`config_get_failed | no_model_resolved |
  invalid_model_ref`) на sessions-пути — fail-soft: warn
  `memory:summarizer_unavailable` (reason enum; симметрично — в т.ч.
  `invalid_model_ref`, misrepresented-конфиг наблюдаем) + продолжение с
  моделью сессии.
- `memory:summarize.duration`: поле `model` — **effective-модель**
  саммаризации (resolved-модель, либо модель сессии при fallback — сейчас в
  индексе модель сессии, indexer.js:266); добавить поле `model_source`
  (enum на sessions-пути: `small_model | model | session` — core-цепочка,
  D-4; `agent_*` недостижимы).

### 4.4 Git-путь (`memory_reindex`, `memory/index.js`)

- **`action: "list"`:** один резолв на list. Заменить флаг
  `summarizer_model_missing` (строки 1261–1262):
  - резолв есть → строка `Модель саммаризации: <model> (source: <source>)`;
  - резолва нет → строка `Модель саммаризации: не резолвлена (<reason>) —
    run(source: git) недоступен` + warn `memory:summarizer_unavailable`
    (reason enum).
- **`action: "run", source: "git"`:** резолв **до батча** (B-2, I1'):
  - резолв есть → `summarizerModel: resolved.model` для синтеза (строка 1376);
  - резолва нет → hard guard (0 summarize, actionable):
    `memory_reindex: модель саммаризации не резолвлена (<reason>). Задайте
    small_model или model в opencode.json (глобальный ~/.config/opencode/opencode.json
    или проектный .opencode/opencode.json)`.
- **`action: "run", source: "sessions"`** — без изменений (light-путь, 0 LLM).

### 4.5 Миграция

- Authoring-репо: убрать dirty-ключ `summarizer_model` из `maestro.json`
  (рабочее дерево).
- Target-приложения: если старый ключ остался — молчаливый игнор (без
  обратной совместимости); guard/list-сообщения указывают на
  **opencode.json**, не на старый ключ.
- Миграционных скриптов нет (удаление ключа, данных нет).

### 4.6 Маэстро-слой (docs/skills/SECURITY)

- `manual_docs/reference/memory.md` — **все 6 вхождений**
  `summarizer_model`: 41 (JSON-пример конфига), 91 (таблица ключей),
  508/513 (секция `memory_reindex`: «Требует `memory.summarizer_model`» +
  флаг `summarizer_model_missing`), 743 (цепочка sessions-пути
  «`summarizer_model` ?? модель сессии»), 794 («Требует
  `memory.summarizer_model` (иначе — hard guard)») — все описывают старую
  семантику guard'а; заменить на семантику резолва (цепочка, источники,
  guard, причины) + обновить описание выходных строк list/run. Whitelist-таблица
  событий (~977): в строку `memory:summarize.duration` добавить `model_source`
  (effective `model`), добавить строку `memory:summarizer_unavailable`
  (reason enum).
- `manual_docs/reference/config.md` — убрать строку ключа.
- `manual_docs/reference/model-selection.md` — переписать раздел: цепочка
  резолва + рекомендация (small_model — дешёвый саммаризатор; не задавать —
  качество main-модели).
- `plugins/maestro-bootstrap/README.md` — секция конфига memory.
- `skills/maestro-assistant/SKILL.md` — канон: убрать ключ, добавить цепочку
  резолва (отдельно от И-1 allowlist провайдеров — не смешивать контексты).
- `SECURITY.md` — SEC-4b: в whitelist event-имён добавить
  `memory:summarizer_unavailable` (warn, reason enum); поле `model_source`
  (enum) в `memory:summarize.duration`; переформулировка I1-формулировки
  памяти: «наблюдаемый резолв из opencode-конфига; fail-closed при
  нерезолве» (аккуратно: I1-раздел `maestro-assistant` про allowlist
  провайдеров — не смешивать).
- `AGENTS.md` — строка memory-модуля: **добавить** упоминание цепочки
  резолва модели саммаризации (в текущей строке ключ не упоминается;
  4.0.0).
- `TODO.md` (строка 69) — исходный пункт фичи («summarizer_model попала
  в коммит…») закрыть: ✅ реализовано (4.0.0) + ссылка на spec/plan.
- `manual_docs/overview/changelog.md` — **4.0.0 (BREAKING)**: удалить ключ;
  новая семантика резолва; **смена модели саммаризации на sessions-пути**
  (D-4) явно в записи changelog, не только в спеке.

### 4.7 Версия

`package.json` → `4.0.0` (major, BREAKING).

## 5. Инварианты

- **I1'**: git-батч не стартует без резолвленной модели (guard до батча,
  0 LLM); причины — enum; сообщение actionable.
- **I2'**: промпт саммаризации побайтово не изменяется; в `session.prompt` —
  `model` (не `agent`); system-prompt/tools агента не подмешиваются.
- **I3'**: плагин не хранит креды провайдеров (auth — на стороне
  opencode-сервера); резолв — только `GET /config` (в ответе нет секретов).
- **I4**: без init-кэша; резолв per-call/per-batch.
- **I5**: legacy-ключ `summarizer_model` не читается плагином и не влияет на
  поведение (обратная совместимость не предусматривается; нет warn/детекта).
- **I6**: невалидная строка модели (не-строка, пустая после trim, без `/`,
  пустой providerID или modelID вокруг первого `/`) никогда не доходит до
  `session.prompt` (валидация в резолвере).

## 6. План тестов (node:test, co-located)

Новый `memory/resolve-model.test.js`:
- цепочка: задан `small_model` (побеждает) / только `model` / только
  `agent.maestro.model` / только `agent.build.model` / всё пусто →
  `no_model_resolved`;
- unwrap: `{ data: cfg }` и raw `cfg`;
- `config.get` reject → `config_get_failed`; отсутствие `client.config`
  (TypeError) → `config_get_failed`; таймаут (injected) → `config_get_failed`;
- невалидный: `small_model: "noslash"` + валидный `model` → `model`
  (skip); все невалидные → `invalid_model_ref`; degenerate: `"prov/"` (пустой
  modelID) и `"/m1"` (пустой providerID) отклоняются; whitespace-only
  `"   "` отклоняется; non-string кандидат (number/object) отклоняется
  (typeof-guard); trim-поведение: `"  prov/m1  "` → резолв `"prov/m1"`;
- модель с `/` в modelID (`akash/Qwen/Qwen3.8-27B`) → корректный splitModel.

`memory/indexer.test.js` (и секция indexer в `index.test.js`):
- sessions-путь с `small_model` заданным → prompt идёт на ней (mock client);
- пустой резолв → модель сессии (текущее поведение, побайтово);
- `config_get_failed` → warn + модель сессии (fail-soft, саммаризация
  продолжается);
- `model_source` в `memory:summarize.duration` (enum).

`memory/index.test.js` (memory_reindex):
- list: строка с моделью+source; нерезолв → строка с reason (заменяет
  `summarizer_model_missing`);
- run git: guard для каждой причины (0 summarize, 0 LLM); резолв есть →
  summarize вызывается с resolved-моделью;
- legacy-ключ в конфиге → не влияет на поведение (модель — только из
  opencode-резолва; нет warn/специальной обработки).

Регрессия: существующие ~9 тестов `summarizer_model`
(`index.test.js` ~4546–4982) переписать на новую семантику.

## 7. Риски и принятые ограничения

- `config.get` per-call — локальный HTTP; пренебрежимо на фоне LLM-вызова и
  idle-debounce (10 мин).
- `small_model` — глобальный (влияет и на title generation) — принято: это
  семантика «фоновая модель» opencode; пользователь управляет качеством
  выбором small_model.
- `agent.maestro`/`agent.build` в цепочке — только **источник model-строки**;
  эти агенты НЕ используются для саммаризации (фикс m-5, зафиксировано в
  доках).
- `GET /config` не возвращает встроенный дефолт opencode (при обоих
  `model`/`small_model` unset) → guard в «вообще ничего не настроено»
  окружении — принято (редкий случай, actionable-сообщение; omit-model —
  follow-up).
- Изменение поведения sessions-пути: при заданном `small_model`/`model`
  саммаризация сессий теперь идёт на нём, а не на модели сессии — осознанно
  (D-4, единая семантика «фоновая модель»).

## 8. Открытые вопросы

Нет — все решения зафиксированы в сессии 2026-09-14.

Follow-ups (не блокируют):
- omit-model как 5-й шаг цепочки git-пути (после верификации семантики
  промпта без `model` в body);
- нейтральный селектор `memory.summarizer: "small" | "main"` для отдельной
  модели саммаризации, отличной от small_model.

<!-- maestro:sanitize
status: CLEAN
date: 2026-09-14
hash: 5e32a502fa25040d2835bd5d9870b31cdd429730dac73511a8fc2f94c72ffc0f
-->

<!-- maestro:review
reviewer: opus
date: 2026-09-14
verdict: approve
hash: dd4838611aefe2de112994c375babb4b48f05b9127636d4b9022509290706518
-->
