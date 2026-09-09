# Внешний OpenAI-совместимый embedder для memory layer — Design

> Статус: **черновик (draft)**. Дата: 2026-09-08. Ветка: `feature/external-embedder`.
> Категория фичи: **сложная** (полный pipeline; Spec Review — рекомендован).

## 1. Цель и мотивация

Memory layer (`plugins/maestro-bootstrap/memory/`) использует локальную модель
эмбеддингов `Xenova/paraphrase-multilingual-MiniLM-L12-v2` (transformers.js, ONNX,
dim 384, RU+EN, q8 ~120 МБ, кэш локально). Цель фичи — добавить **опциональный
внешний embedder через любой OpenAI-совместимый `/embeddings` API** (OpenAI,
совместимые шлюзы LiteLLM/one-api, self-hosted vLLM и т.п.):

- более высокое качество recall (крупные провайдерские модели сильнее MiniLM-384);
- снятие локального бюджета (нет инференса в процессе opencode, нет 120 МБ загрузки);
- гибкость размерности (конфигурируемый `dim` вместо захардкоженного 384).

Локальный embedder остаётся **дефолтом** (privacy/offline-инвариант);
внешний — **осознанный opt-in**.

Второй блок фичи — **проверка работоспособности (probe)** модели эмбеддингов:
стартовый + on-demand чек доступности, ключа, модели, размерности, сети.

## 2. Конфигурация

### 2.1 Блок `memory.embedding`

Новый структурный блок (backward-compatible):

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

| Ключ | Тип | Default | Обязателен для `openai` | Семантика |
|---|---|---|---|---|
| `embedding.provider` | `string` | `local` | — | `local` \| `openai` |
| `embedding.model` | `string` | `null` | да | local: имя ONNX-модели; openai: id модели API |
| `embedding.base_url` | `string` | `https://api.openai.com/v1` | — | Базовый URL OpenAI-совместимого API; trailing-slash нормализуется |
| `embedding.api_key_env` | `string` | `null` | да | **Имя env-переменной** с ключом; никогда plaintext |
| `embedding.dim` | `number` (int > 0) | `null` | да | Размерность векторов; storage создаётся до первого embed → dim обязан быть известен из конфига |

- `memory.embedding_model` — **legacy-алиас** для `embedding.model` (только при
  `provider: local`); для `openai` `model` берётся строго из `embedding.model`
  (legacy-алиас не подставляется).
- **Приоритет:** при `provider: local` и одновременно заданных `embedding.model`
  и `embedding_model` — приоритет у `embedding.model`. Для `openai` действует
  только `embedding.model`.
- **`embedding.dim` — только для `openai`.** При `provider: local` ключ
  игнорируется (storage остаётся dim 384); поведение документируется, не
  отвергается валидацией.
- **Тип-валидация блока:** `embedding` обязан быть объектом (не `null`/не
  массив/не скаляр); `provider`/`model`/`base_url`/`api_key_env` — строки;
  `dim` — целое > 0. Нарушение → `embedding_invalid`.
- Валидация в `classifyMemoryConfig` (zero-dep гейт): невалидный блок →
  `disabled_reason: "embedding_invalid"` (память off).
- Отсутствие `process.env[embedding.api_key_env]` — runtime-проверка в
  `registerMemoryHooks` ДО создания storage → `log` + память off
  (`reason: "embedding_api_key_env_missing"`), паттерн qdrant/pgvector.

### 2.2 `probe_cooldown_min`

Новый ключ `memory.probe_cooldown_min` (default `30`): интервал в минутах между
live-probe на старте (кэш результата в `state.json`). Валидация: число > 0 →
иначе `disabled_reason: "probe_cooldown_min_invalid"`.

## 3. Архитектура

### 3.1 Интерфейс embedder (единый)

Оба провайдера реализуют одинаковый интерфейс (существующий у `Embedder`):

- `async init(): Promise<this>` — локальный: ленивая загрузка пайплайна (warmup);
  openai: no-op.
- `async embed(text): Promise<Float32Array>` — вектор размерности `dim`.
- `get dim(): number`
- `get modelId(): string` — идентичность модели в storage/экспорте/импорте:
  - local: имя модели;
  - openai: канонический `openai:${model}@${base_url}` (без сети; смена
    провайдера/модели/URL → другой `model_id` → переиндексация).
- `async probe(): Promise<{ ok: boolean, hard: boolean, detail: string }>`
  — см. §4.

### 3.2 `OpenAiEmbedder` (новый файл `memory/embeddings-openai.js`)

- Конструктор: `{ model, baseUrl, apiKey, dim, apiKeyEnv, timeoutMs = 15000,
  fetchImpl = globalThis.fetch, cache = makeBoundedMap(256) }`.
- `embed`: POST `${baseUrl}/embeddings`, `{ model, input: text }`, заголовок
  `Authorization: Bearer <apiKey>`, AbortController + `timeoutMs`.
  - не-ok → throw (в recall/indexer — fail-soft через существующие catch);
  - dim ответа ≠ конфигурируемому → throw с actionable-сообщением, включающим
    фактический dim из ответа API (напр. `dimension mismatch (api=1536,
    config=512)`);
  - кэш повторов текста (bounded, из `core.js makeBoundedMap`).
- **Класс ошибок `EmbedRetryableError`** (в `embeddings-openai.js`): сетевая
  ошибка, timeout, 5xx (временные/soft-класс). Остальные ошибки (dim-mismatch,
  401/403/404) — обычный `Error` (детерминированные; ловятся probe → память off).
- **Взаимодействие с skip-after-3 индексатора:** в `indexer.js` при провале
  embed-вызова ошибка класса `EmbedRetryableError` **НЕ** считает в `recordFail`
  (лог-warn; сессия перепробуется в следующем цикле backfill) — иначе
  продолжительный сбой провайдера безвозвратно теряет память сессий
  (skip-after-3 в `state.js`). Ошибки прочих классов — как сегодня (`recordFail`).
- **Без новых зависимостей**: только глобальный `fetch` (Node 18+/Bun);
  `provision.js DEPS` не меняется.

### 3.3 Диспатч в `registerMemoryHooks`

- `isOpenai = config.embedding.provider === "openai"`.
- `modelId`/`dim` для `createStorage`:
  - openai: `openai:${model}@${base_url}` и `config.embedding.dim`;
  - local: `config.embedding.model ?? config.embedding_model` и `384`.
- Конструирование: `deps.embeddings ?? (isOpenai ? new OpenAiEmbedder(...)
  : new Embedder(...))` (тестовая инъекция сохраняется).
- **Инвариант mergedConfig:** `DEFAULTS.embedding.model` обязан оставаться
  `null` (НЕ MiniLM-именем) — иначе `config.embedding.model ?? config.embedding_model`
  в этом пункте затенял бы legacy-ключ `embedding_model` при локальном провайдере.
  Значение по умолчанию для local подставляется как `config.embedding.model ??
  config.embedding_model ?? DEFAULTS.embedding_model` в момент диспатча.
- Проверка ключа (openai) — до создания storage, как в §2.1.

### 3.4 Маскирование recall-запросов (всегда)

Три call-site эмбеддят пользовательский текст:

| Call-site | Файл:строка | Что эмбеддится |
|---|---|---|
| auto-recall | `recall.js:24` | user-сообщение |
| `memory_search` | `index.js:409` | `args.query` |
| `memory_recall_preview` | `index.js:609` | `args.query` |

Все три **всегда** маскируют запрос через `maskTranscript(text,
{ confidentialPatterns })` перед `embed` (defense-in-depth, независимо от
провайдера). `searchOpts.query` (FTS/hybrid) остаётся **исходным** — маскируется
только вход эмбеддинга. Примечание (существующий egress, не создаваемый фичей):
на централизованных бэкендах (qdrant/pgvector) `searchOpts.query` уходит на
сервер в исходном виде — это текущее поведение full-text поиска, вне scope фичи.

**Short-circuit пустого запроса:** если после `maskTranscript` текст пуст
(`""` — полностью замаскированный запрос), `embed` **не вызывается** (пустой
вход дал бы 400 от API): recall возвращает пустой результат, `memory_search`/
`memory_recall_preview` — «Ничего не найдено».

`Recall` получает `confidentialPatterns` (из `maestroConfig.confidential.paths`,
уже вычисляется в `index.js:344`).

### 3.5 Storage и миграция

- `model_id`/`dim` для openai — из конфига (§3.3); существующие проверки
  `storage.js` (model/dimension mismatch) работают без изменений.
- Смена модели/провайдера → **переиндексация** (как при смене локальной модели);
  миграция через `memory_export`/`memory_import` не поддерживается для разных
  `model_id` (валидация — существующая).

## 4. Проверка работоспособности (probe)

### 4.1 Интерфейс

`probe(): Promise<{ ok, hard, detail }>` — non-throwing.

- `hard: true` — детерминированная конфиг-ошибка (не само-залечится): нет
  зависимости (local), 401/403 (ключ), 404 (модель/URL), dim-mismatch.
- `hard: false` — временная/сетевая ошибка: 5xx, timeout, network error, offline.

### 4.2 Локальный probe (лёгкий чек)

`Embedder.probe()` — **не форсирует загрузку/скачивание модели**:
проверяет только импортируемость `@huggingface/transformers` из `module_dir`
(`hard` при отсутствии + actionable `npm install`); полный warmup остаётся
ленивым (первый embed). Загрузка ~120 МБ не происходит на старте.

### 4.3 Внешний probe

`OpenAiEmbedder.probe()` — один POST `/embeddings` с warmup-строкой `"probe"`:

| Ответ | `ok` | `hard` | detail |
|---|---|---|---|
| 200, dim == config | true | false | `OK (dim N)` |
| 200, dim ≠ config | false | true | dimension mismatch (actionable) |
| 401/403 | false | true | ключ отклонён (env `apiKeyEnv`) |
| 404 | false | true | модель/URL не найдены |
| прочие не-ok (5xx) | false | false | API временно недоступен |
| timeout/network | false | false | сетевая ошибка |

### 4.4 Стартовый probe + cooldown (гибрид)

В `registerMemoryHooks`, **ДО создания storage** (порядок: проверка ключа →
конструирование embeddings → probe → `createStorage`/`init` → остальное;
конструирование embeddings побочных эффектов не имеет, probe hard-fail не
оставляет мусора в qdrant/pgvector).

- Результат probe персистится в `state.json` (`embedderProbe: { at, modelId,
  dim, apiKeyEnv, ok, hard, detail }`; методы `getEmbedderProbe`/
  `setEmbedderProbe`).
- **Ключ кэша — identity embedder'а:** `modelId` + `dim` + `apiKeyEnv`. Любое
  несовпадение с текущим конфигом → cache miss (live-probe). Это исключает
  межпроектное заражение: `state.json` — один файл на машину, а probe зависит
  от конфига конкретного проекта.
- Валидность кэша: identity совпал И `Date.now() - at < probe_cooldown_min * 60_000`:
  - cached `ok` → info-лог, live-вызов не делается;
  - cached `soft` → warn-лог, live-вызов не делается (память остаётся, fail-soft;
    не бьём API на каждом рестарте при сбое провайдера);
  - cached `hard` → **НЕ шорт-кейтится** — live-re-probe (hard-классы 401/404/dim
    возвращаются за миллисекунды; авто-восстановление при исправлении конфига
    без ручных действий). Если live снова hard → память off.
- Иначе live-probe (страховочный timeout ~5s; при срабатывании страховки в кэш
  пишется `{ ok:false, hard:false, detail:"probe timeout (guard)" }`):
  - `ok` → info;
  - `hard` → память off + actionable (`reason: "embedder_probe_hard_fail"`);
  - `soft` → warn + **fail-soft** (память остаётся; первый embed упадёт per-call).
- **Восстановление из off-состояния:** авто (исправление конфига → следующий
  старт live-re-probe, т.к. cached hard не шорт-кейтится). Ручное — удалить
  запись `embedderProbe` из `state.json` или снизить `probe_cooldown_min`;
  документируется в how-to.
- Провайдеры сами держат таймаут (внешний 15s); страховка — для нестандартных
  `deps.embeddings`.

### 4.5 On-demand

- Tool `memory_probe` (read-only, без permission-правила): live-probe (минуя
  cooldown), обновляет `state.json`, возвращает строку статуса. Недоступен в
  служебных сессиях (SESSIONS-guard, как остальные memory-tools).
- `memory_stats_detail` выводит последний cached-статус probe (если есть).
- `@maestro-memory`: строка «Проверка embedder» из статуса; при FAIL/нет
  данных — вызвать `memory_probe` и показать результат + рекомендации.

## 5. ИБ (SECURITY.md §5a)

### 5.1 Инвариант сохраняется

- **Контент записей:** embed вызывается строго по post-mask тексту (как сегодня:
  `maskEntry` → embed в `indexer.js:224`). Класс гарантии внешнего embedder для
  контента = класс гарантии удалённого бэкенда хранения → жёсткий инвариант
  «raw-confidential и секреты не попадают на удалённый сервер» **сохранён**.
- **Query-путь:** best-effort маскирование (line-level по `confidential.paths`) —
  тот же класс, что существующий egress в фоновый саммаризатор (уже
  задокументирован). Внешний embedder **не создаёт новый класс egress**, а
  дублирует существующий. Residual-классы (free-text без format-сигнатуры,
  mid-line контент, парафразы, presence-сигнал `[confidential]`) — принимаются
  политикой (по решению пользователя — контур (a), см. §5.2).

### 5.2 Контур (a): best-effort + init-warn

Для проектов с непустыми `confidential.paths` + внешним провайдером —
**init-warn-диагностика** по паттерну `unmasked_branch_metadata`:

- при старте: `log.warn("memory: external_embedder_unmasked_queries")` — запросы
  и контент (замаскированные best-effort) уходят генерическому внешнему вендору;
- диагностика дублируется в выдаче `@maestro-memory` / `memory_stats_detail`
  (без логов);
- внешний провайдер — **явный opt-in** (конфиг) + документирован в
  how-to/trust-документации как осознанный выбор.

### 5.3 Ключи и данные

- API-ключ — только через `api_key_env` (ссылка на env), никогда plaintext в
  `maestro.json` (канон §5a).
- «Локальность» §5a переформулируется: локальные эмбеддинги — в процессе,
  единственный сетевой вызов — загрузка модели; **опциональный внешний
  embedder — документированный opt-in** с маскированием и init-warn.
- Уровень данных: эмбеддинг = пост-mask текст; probe-строка не-confidential.

## 6. Документация

Синхронно с кодом (правило AGENTS.md):

- `SECURITY.md` §5a — переформулировка «Локальности», новый egress-класс,
  init-warn.
- `skills/maestro-assistant/SKILL.md` — **канон конфигурации**: блок
  `memory.embedding` + legacy-алиас + `probe_cooldown_min` (обязательно по
  конвенции v2/v3).
- `manual_docs/reference/config.md` — таблица `memory.embedding` + legacy-алиас +
  `probe_cooldown_min`.
- `manual_docs/reference/model-selection.md` — блок «Внешний embedder (opt-in)».
- `manual_docs/reference/memory.md` — конфиг-таблица, `model_id` для openai.
- `manual_docs/how-to/enable-memory.md` — подраздел «Внешний embedder
  (OpenAI-совместимый API)» + probe-диагностика + ссылка на how-to.
- **Новый** `manual_docs/how-to/choose-embedding-model.md` — критерии выбора,
  настройка, замена (переиндексация), проверка доступности. Ссылки из
  `index.md` и `enable-memory.md`.
- `manual_docs/explanation/agents-and-trust.md` — memory-раздел: локальность по
  умолчанию, внешний провайдер opt-in (trust-модель не меняется).
- `manual_docs/overview/changelog.md` — запись о фиче (обновлялся во всех
  прошлых memory-фичах).
- `plugins/maestro-bootstrap/README.md` — пример конфига с `embedding`-блоком.
- `commands/maestro-memory.md` — вывод провайдера/модели + строка «Проверка
  embedder» + маппинг новых `disabled_reason` в шаге 1: `embedding_invalid`,
  `embedding_api_key_env_missing`, `probe_cooldown_min_invalid`,
  `embedder_probe_hard_fail`.
- `docs/project-context.md` §3/§5 — описание memory layer (external embedder +
  probe) и перечень tools (`memory_probe`).

## 7. Тесты

- `config.test.js`: блок `embedding` (defaults, legacy-алиас, openai-требования,
  `embedding_invalid`, trailing-slash, `probe_cooldown_min`).
- `embeddings-openai.test.js`: embed (auth, URL, body, Float32Array, dim-mismatch,
  не-ok, кэш), probe (200/401/404/5xx/dim-mismatch).
- `embeddings.test.js`: `probe` (ok/hard).
- `embeddings-openai.test.js`: `EmbedRetryableError` для network/timeout/5xx и
  обычный `Error` для dim-mismatch/401/404.
- `state.test.js`: `getEmbedderProbe`/`setEmbedderProbe`.
- `recall.test.js`: маскирование запроса (confidential-запрос → mask,
  обычный → без изменений); пустой замаскированный запрос → без вызова embed.
- `index.test.js`: диспатч провайдера (ключ → off; ключ+inject → hooks);
  стартовый probe (hard → off; soft → fail-soft; cooldown-cache; **кэш
  ключуется по identity** — другой project/modelId/dim/apiKeyEnv → cache miss и
  live-probe; **cached hard → live re-probe**; инвалидация при исправлении dim);
  порядок probe до createStorage (hard-fail не создаёт storage);
  `memory_probe`; маскирование в `memory_search`/`memory_recall_preview`;
  init-warn `external_embedder_unmasked_queries` (openai + confidential.paths);
  retryable-embed-ошибка не считает в skip (indexer).
- Docs — ручная сверка (diff-verification, шаг 14).

## 8. Non-goals / открытые вопросы

- **Не** добавляются: batching запросов, retry-логика embed, выбор нескольких
  провайдеров одновременно (один `embedding` блок), авто-определение `dim`
  для external (без сети storage не создать), **Matryoshka-усечение** через
  параметр `dimensions` API — `dim` обязан равняться **нативной** размерности
  модели (иначе dim-mismatch hard-fail); конфигурируемый `dim` для `local`
  (игнорируется, остаётся 384).
- Контур (b) fail-closed и (c) запрет внешнего провайдера при confidential —
  отклонены (выбрано (a)); могут быть follow-up.
- Внешний embedder для проектов с реальным наполнением `docs/confidential/**` —
  отдельный ре-ресеч custodian в целевом репо (здесь confidential пуст).

<!-- maestro:sanitize status: CLEAN date: 2026-09-08 hash: cd807adb19f7acce98e3a35ccd35eb2cedfc6c6081b407020d1b70ec6e99c579 -->

<!-- maestro:review reviewer: opus date: 2026-09-08 verdict: approve hash: cd807adb19f7acce98e3a35ccd35eb2cedfc6c6081b407020d1b70ec6e99c579 -->