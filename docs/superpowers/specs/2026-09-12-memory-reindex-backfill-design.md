# Spec: reindex & history backfill для memory layer (3.5.0)

## 1. Контекст и проблема

`artifacts[]` (v5.2, 3.4.0) связывает записи памяти с файлами спеков/планов, но
ссылки формируются только при индексации сессии. Два пробела:

1. **Старые записи** (сессии, проиндексированные до v5.2) имеют `artifacts: []` —
   ре-индексация не происходит: гейт G1 (`min_new_messages`) пропускает сессии
   без новых сообщений, а полный `_run` стоит дорого (summarize = LLM-вызов,
   embed) и пересчитывает `head`/`merged` (риск искажения identity: запись
   брошенной ветки может ошибочно попасть в merged-tier).
2. **История до memory layer** — фичи, у которых есть спеки и коммиты, но нет
   записей в memory (память включена позже; сессии удалены/старше окна).
   История теряется для recall.

## 2. Goals / Non-goals

**Goals**
- G1: бэкфилл `artifacts[]` по существующим записям **без LLM** (light-путь).
- G2: синтез записей памяти по git-истории (спеки + коммиты) для фич без
  записей — **селективно**: сначала список, затем выбор «всё» или «часть».
- G3: один HITL-инструмент `memory_reindex` + команда `@maestro-memory-reindex`
  (паттерн `memory_prune`: list → снапшот → run по явным ID или всё, с cap).
- G4: 0 миграций схемы записей, 0 изменений `indexer.js`.

**Non-goals**
- Авто-бэкфилл при старте плагина (по аналогии с I6) — только явный HITL-вызов.
- Ре-саммаризация контента существующих записей (title/summary/decisions).
- Бэкфилл для сессий без записей (полный индекс через LLM) — остаётся на
  natural-пути (≥3 новых сообщения / startup-бэкфилл).
- Удалённые из дерева спеки и не-в-git файлы (нет `git log`, нет existsSync).
- Центральный storage (qdrant/pgvector) — как и сейчас, записи локальны
  effectiveKey; scan по ключу.

## 3. Решения (согласовано с пользователем, 2026-09-12)

| # | Решение |
|---|---|
| D1 | Два источника, **один** инструмент `memory_reindex` (`source: sessions \| git`) |
| D2 | Light-путь (сессии): 0 LLM — детерминированное извлечение + union |
| D3 | Git-история: LLM-summarize спеки (1 вызов/фича, `summarizeSession` + маскирование) |
| D4 | Селективность: `list` готовит снапшот с dry-run превью → `run` по явным ID **или** всё (только по свежему снапшоту), cap 20/вызов на источник |
| D5 | Синтетические записи: `author: "git-backfill"` (маркер provenance), `session_id = "git-" + sha256(commitSha + "\|" + specPath).slice(0,12)` (RI-1) |
| D6 | `memory.history_globs` — optional, default = inherit `artifact_globs`; невалидное → fallback + warn (мягко, память не отключается) |
| D7 | Версия плагина 3.4.0 → **3.5.0** (новый инструмент = minor) |
| D8 | Для этого репо в `maestro.json`: `history_globs: ["docs/superpowers/**", "specs/**"]` (legacy-спеки в историю) |

## 4. Дизайн

### 4.1 Конфиг (`memory/config.js`)

- `DEFAULTS.history_globs: null` — null означает **inherit** `artifact_globs`
  (резолв на use-site, не в `DEFAULTS`, чтобы канон дефолта остался одним).
- Валидация (как `artifact_globs`): array строк ≤ 16; trim + unique
  (normalization). `[]` = **off** (кандидатов нет). **Ненормативное**
  (non-array ИЛИ не-строки в массиве) → fallback на `artifact_globs` +
  warn-лог (`memory:config_fallback`, поле `history_globs`), память НЕ
  отключается, нового `disabled_reason` нет (RI-8).

### 4.2 Новый модуль `memory/backfill.js` (+ co-located тесты)

Функции с инжекцией зависимостей (без привязки к инстансам плагина):

#### 4.2.1 `reindexSessionArtifacts(deps, sessionID)` — light-путь

deps: `{ client, storage, root, key, artifactGlobs, artifactConfidentialPatterns
(resolved), confidentialPatterns (raw), embedModelId }`.

Пайплайн:
1. `SESSIONS.has(sessionID)` → `skip_service` (служебные сессии).
2. Запись — через `storage.scan({ key, fields: [session_id, head, branch,
   time_last, author, artifacts, model_id, embedding] })`, filter по
   session_id (C1: `storage.get` затирает `embedding: undefined` на всех
   бэкендах; embedding — opt-in поле scan). sqlite возвращает Buffer →
   нормализация в Float32Array (нормализатор сейчас приватен в `memory/
   index.js` — вынести в общий модуль или продублировать локально в
   `backfill.js`, решение на плане). Нет записи → `skip_no_record`.
3. `existing.model_id !== embedModelId` → `skip_model_mismatch`
   (смешение эмбеддингов разных моделей в одном бакете ломает поиск;
   upsert при dim-расхождении бросит; пере-embed = уже полный путь).
4. `existing.embedding` пуст/пустая длина → `skip_no_embedding`.
5. `client.session.messages({id})` → ошибка/пусто → `skip_messages_unavailable`.
6. `extractArtifacts(messages, { root, globs: artifactGlobs,
   confidentialPatterns: artifactConfidentialPatterns })` (resolved-набор —
   как в indexer).
7. **Union D6**: `[...extracted, ...existing.artifacts]`, dedup
   `String(p).toLowerCase()`, extracted-first, cap 8.
8. **No-op guard (RI-7)**: case-insensitive set-равенство **post-mask
   union** (`union`, отфильтрованной resolved-набором — тем же фильтром, что
   `maskEntry` применяет к `artifacts`) и **сохранённых** `existing.artifacts`
   → `no_change` (upsert НЕ выполняется). Guard по pre-mask union запрещён:
   при no-delta (extracted пусто) и stale-пути в сохранённой записи,
   матчащем ужесточенный resolved-набор, post-mask union ≠ сохранённым
   `existing.artifacts` → upsert чистит запись (stale-purge работает и в
   no-delta случае — key-review T2, 2026-09-12).
9. Иначе: `entry = { ...existing, artifacts: union,
   version: existing.version + 1 }` → **`maskEntry` на всю запись перед
   upsert (G2-parity: artifacts — resolved-набор, текст — raw)** — чистит
   stale-пути из `existing.artifacts` под текущим конфигом →
   `storage.upsert([entry])` → `updated`.

**Не меняется** (RI-3): title/summary/decisions/embedding/model_id/
head/branch/merged/time_*/key/origin_*/prefixes — спред из `existing`
(оговорка: текст может сузиться при ужесточении raw-набора — maskEntry
G2-parity, п.9; embedding и identity-поля сохранены).
**Не пишется** (RI-4): `state` не трогаем (no `setSummarized`/`recordFail`) —
natural-ре-индекс при ≥3 новых сообщений работает как раньше.

Возврат: `{ status, artifacts }` (status enum: `updated | no_change |
skip_no_record | skip_model_mismatch | skip_messages_unavailable |
skip_no_embedding | skip_service`).

#### 4.2.2 `scanHistory(deps)` — перепись git-истории

deps: `{ root, historyGlobs, git, mainline, records,
artifactConfidentialPatterns (resolved) }` (records — результат
`storage.scan({ key, fields: [artifacts] })`).

Алгоритм:
1. Кандидаты: файлы в текущем дереве, матчащие `historyGlobs` (глоб-матчер
   `confGlobMatch` из `core.js`, тот, что использует `artifacts.js`),
   **кроме plan-путей** (`isPlanPath`: basename `-plan.md`
   или parent-каталог `plans`) — план НЕ фича, а спутник спеки: пара
   spec+plan = одна фича (1 LLM-вызов, I3). **Confidential-исключение
   (fail-closed):** кандидат, матчащий **resolved-набор**
   (`confidential.paths` + default + builtin, как `extractArtifacts`) →
   skip `skip_confidential` — содержимое под confidential не читается, не
   summarize'ится и не индексируется вовсе (SECURITY.md §5a; контроль,
   сохраняющий допущение Z3 «файл — двухролевой, не confidential»).
2. Для каждого: `git log --diff-filter=A --format="%H %ct" --reverse --
   <path>` → первая строка = старейший добавивший коммит (SHA) + unix-время;
   нет в истории → skip `not_in_git`.
3. **Coverage-guard (RI-2)** — спека покрыта, если путь (lowercase) ∈
   ⋃ `record.artifacts` существующих записей. (Предковость по `record.head`
   НЕ используется: любой свежий `head` на mainline покрывает всю историю —
   guard блокировал бы мотивационный кейс D8. Дубли при запуске git-источника
   до light-пути ограничены и допустимы — см. §7; идемпотентность — RI-7.)
4. Непокрываемые фичи:
   - `specPath` (repo-relative), `planPath`: конвенция-сосед
     (`specs/X-design.md` → `plans/X-plan.md`; legacy `specs/X.md` →
     `specs/X-plan.md`) если existsSync, иначе **только plan-подобные** файлы
     того же добавляющего коммита (basename `-plan.md`/каталог `plans`);
     при >1 совпадении — ассоциация пропускается (консервативно,
     `artifacts: [specPath]`).
   - `commitSha` (добавивший), `branch`: если коммит-merge — из сообщения
     (`Merge branch 'x'` regex), иначе `""`.
   - `merged`: `git.isAncestor(root, commitSha, mainline)` → yes/no; null → 0
     (git-сбой — фича всё равно входит в листинг с пометкой).
   - `title`: первая H1 спеки (`# …`); fallback `Spec: <basename>`.
   - `time_first = time_last` = unix-время добавляющего коммита (×1000 → ms).
5. Возврат: `{ features: [...], considered, covered: { by_artifacts, not_in_git, skip_confidential, plan_excluded }, gitErrors }`.

#### 4.2.3 `synthesizeGitEntry(deps, feature, llm)` — синтез записи

deps: `{ client, storage, root, key, projectHash, originRemote, embedModelId,
embeddings, confidentialPatterns (raw), artifactConfidentialPatterns
(resolved) }`. llm: результат summarize (см. 4.2.4) — аргумент функции, не
зависимость.

1. **Idempotency (RI-7)**: `session_id = "git-" + sha256(commitSha + "|" +
   specPath).slice(0,12)`; `storage.get(session_id)` → существует →
   `already_indexed` (ничего не перезаписываем).
2. Запись (без embedding): `session_id`, `key`, `origin_project_hash:
   projectHash`, `title: feature.title`, `summary`/`decisions` из llm,
   `model_id: embedModelId`, `author: "git-backfill"` (RI-6),
   `time_first/time_last: feature`, `version: 1`, `branch`, `head:
   commitSha`, `merged: feature.merged`, `host: hostname()`, `origin_remote`,
   `prefixes: prefixesOf(key)`.
3. `artifacts`: `[specPath, planPath?]` → existsSync (повторная проверка на
   момент run) + resolved confidential-фильтр (`confGlobMatch`) +
   repo-relative + dedup lowercase + cap 8.
4. **Re-mask ДО записи (SECURITY.md §5a, как в indexer G2):** `maskEntry` на
   всю запись — title/summary/decisions — raw-набор (текст), artifacts —
   resolved-набор (drop, не replacement). LLM-вывод ВСЕГДА re-mask'ится:
   модель может воспроизвести фрагменты, не попавшие в pre-LLM-маскирование.
5. **Embed только ПОСЛЕ маски (I1):** `embedding =
   embeddings.embed(maskedTitle + "\n" + maskedSummary + "\n" +
   maskedDecisions.join("\n"))`.
6. upsert → `indexed`.

#### 4.2.4 Summarize спеки

- Контент спеки маскируется **до** summarize: `maskTranscript(specText,
  { confidentialPatterns: raw })` (I2: текст — на raw-наборе).
- Реиспользуем `summarizeSession` (сервис-сессия `[maestro-memory] git-<sha7>`,
  авто-исключение из индексации через SESSIONS-set).
- **Минимальное расширение `summarizeSession`**: опциональный параметр
  `instructions` (дополнение к промпту: «текст — спецификация фичи, а не
  транскрипт сессии; извлеки summary (≤150 слов) и decisions (список ключевых
  решений из секции решений/инвариантов); **верни `"title": ""`** — title
  задан отдельно и не извлекается»). Контракт `title: ""` обязателен:
  `parseSummary` требует `title: string` (I4 — отсутствие ключа → throw →
  потерянный LLM-вызов). Без `instructions` промпт побайтово неизменён
  (backward-compat, regression-тест).
- `model: null` (исходной сессии нет), `summarizer_model` — из конфига.
- **I1-guard:** `summarizeSession` бросает «cannot resolve summarizer model»
  при `summarizerModel == null && model == null`; git-путь всегда
  `model: null` → при дефолтном конфиге (`summarizer_model: null`) каждая
  фича молча skip'нулась бы. Поэтому: list-секция B печатает флаг
  `summarizer_model_missing` (конфиг не задан), а `run(source: git)` —
  **hard guard** с actionable-сообщением «задайте `memory.summarizer_model`»
  (батч не стартует).
- Timeout: `summarize_timeout_ms` (existing).

### 4.3 Инструмент `memory_reindex` (`memory/index.js`, permission: ask)

args:
- `action: "list" | "run"`
- `source: "sessions" | "git"` (обязателен для run)
- `session_ids: string?` (запятая) — sessions
- `all_empty: boolean?` — sessions, только по снапшоту
- `specs: string?` (repo-relative, запятая) — git
- `all: boolean?` — git, только по снапшоту
- `max: number?` (default **20**) — cap на источник за вызов

**list:**
- Секция A (sessions): `storage.scan` по effectiveKey, fields:
  `[session_id, head, branch, time_last, author, artifacts, model_id]` →
  кандидаты с пустыми `artifacts`; для каждого — **dry-run превью** (0 LLM):
  `client.session.messages` + `extractArtifacts` + existsSync-фильтр → пути,
  которые будут связаны; флаги: `model_mismatch`, `messages_unavailable`.
- Секция B (git): `scanHistory` → метаданные фич (spec, plan, head7, branch,
  merged, даты, title) + превью `artifacts`. LLM в list НЕ вызывается (RI-5);
  флаг `summarizer_model_missing`, если `summarizer_model` не задан (I1).
- **Снапшот** (одиночная per-init переменная, перезаписываемая каждым list —
  как `pruneSnapshot` в `memory_prune`): `{ ts, sessions: Map, git: Map }` —
  run с `all_*` резолвится строго по нему.

**run:**
- guards: `SESSIONS.has(ctx.sessionID)` → отказ; память off → инструмент
  не зарегистрирован; `source: git` при `summarizer_model` не задан →
  отказ с actionable-сообщением (I1).
- sessions: явные `session_ids` ∪ (all_empty → снапшот A) → cap `max` →
  `reindexSessionArtifacts` на каждый; fail-soft по элементу (RI-9).
- git: явные `specs` ∪ (all → снапшот B) → cap → для каждой: маскирование →
  `summarizeSession` → `synthesizeGitEntry` → upsert; fail-soft (сбой
  summarize → skip с причиной, партия продолжается).
- Ответ: агрегаты `{ selected, updated|indexed, no_change|already_indexed,
  skipped: {reason: n} }` + строки по элементам.
- Телеметрия: `memory:reindex.sessions` / `memory:reindex.git` — **aggregates-only**
  (status/счётчики/spec-пути; текстовые поля записей в лог НЕ попадают — SEC-4b)
  — event-имена в whitelist логов.

### 4.4 Команда `@maestro-memory-reindex` (NEW `commands/`)

Frontmatter: `description: HITL-бэкфилл памяти — список на индексацию (dry-run превью) → выбор → reindex/синтез` (как у `maestro-memory-prune.md`).
HITL-шаги по паттерну `maestro-memory-prune`:
1. Доступность (память включена, плагин жив).
2. `list` (оба источника) → показать.
3. HITL выбор: что и сколько (всё/подмножество/по источнику/отмена).
4. `run` (source + selection + cap).
5. Итоговый отчёт (агрегаты, без раскрытия содержимого — SEC-4b).

### 4.5 Маэстро-слой (skills/commands/docs)

- `skills/maestro-assistant/SKILL.md` — канон `memory`: `history_globs`
  (inherit-семантика, ≤16, fallback — мягко).
- `manual_docs/reference/memory.md` — ключ + инструмент + секция
  «Бэкфилл» (light-путь vs git-история, cost-модель, RI-инварианты кратко).
- `manual_docs/reference/config.md` — строка `history_globs` в таблице.
- `manual_docs/reference/commands.md` — команда (если страница есть).
- `manual_docs/overview/changelog.md` — 3.5.0.
- `commands/maestro-memory.md` — `history_globs` в таблице дефолтов.
- `AGENTS.md` — строка memory-модуля: +3.5.0 (reindex & history backfill).
- `SECURITY.md` — пункт (Z3-adjacent): summarize спеки — LLM-вызов по
  репозиторному файлу (git, двухролевой, allowlist-глобы, маскирование до
  summarize, **re-mask LLM-вывода до записи**, маркер `git-backfill`,
  `skip_confidential`-guard (resolved-набор) сохраняет допущение «файл не
  confidential»); инкрементальный риск низкий — принято. **Plus:** новые
  event-имена (`memory:reindex.sessions`, `memory:reindex.git`,
  `memory:config_fallback`) — в SEC-4b aggregates-only whitelist.
- `manual_docs/explanation/agents-and-trust.md` — mirror (правило AGENTS.md).

### 4.6 Версия

Корневой `package.json`: `3.4.0` → `3.5.0` (единственный источник версии).

## 5. Инварианты

| # | Инвариант |
|---|---|
| RI-1 | Синтетический `session_id` детерминирован (`git-<sha12(sha\|path)>`), стабилен между запусками; не коллидирует с реальными (`ses_*`) и spec/plan одного коммита |
| RI-2 | Coverage-guard: спека, путь которой ∈ ⋃ `record.artifacts` существующих записей, НЕ синтезируется повторно (предковость по head — НЕ сигнал, см. §4.2.2 п.3); идемпотентность на уровне записи — RI-7 |
| RI-3 | Light-путь меняет только `artifacts` + `version`; head/branch/merged/embedding/контент — нет (identity не искажается) |
| RI-4 | Light-путь не пишет в `state` (no `setSummarized`/`recordFail`) — natural-ре-индекс работает как раньше |
| RI-5 | Cost: list — 0 LLM; run(sessions) — 0 LLM; run(git) — ≤N summarize + ≤N embed; cap 20/вызов |
| RI-6 | Спека маскируется до summarize (raw-набор); **LLM-вывод re-mask'ится (maskEntry) до embed и upsert** (SECURITY.md §5a); artifact-пути — resolved-набор + existsSync + repo-relative; кандидат под `confidential.paths` → `skip_confidential` (fail-closed, §5a); `author: "git-backfill"` виден в recall/search/export |
| RI-7 | Идемпотентность: git-run по existing session_id → `already_indexed`; light-run при неизменном **post-mask** union (по отношению к сохранённым `existing.artifacts`) → `no_change` (без upsert); stale-purge — только через upsert (§4.2.1 п.8) |
| RI-8 | Невалидное `history_globs` → fallback на `artifact_globs` + warn; память не отключается |
| RI-9 | Fail-soft по элементу: сбой одного element → skip с причиной, партия продолжается; upsert атомен per record |

## 6. План тестов (node:test, co-located)

- `backfill.test.js`:
  - `reindexSessionArtifacts`: источник — `storage.scan` c opt-in `embedding`
    (Buffer → F32-нормализация); union (cap 8, case-insensitive,
    extracted-first); maskEntry перед upsert (G2-parity, stale-пути из
    existing чистятся); сохранение полей (embedding/model_id/head/branch/
    merged/title/summary) + version+1; no-op guard (без upsert, post-mask);
    extracted ⊆ existing при неизменном конфиге → `no_change` (триггер
    upsert — set-дельта post-mask, а не непустой extracted);
    **stale-purge no-delta** (extracted пусто, existing содержит путь из
    resolved-набора → upsert 1 раз, `artifacts` очищены, `updated`);
    skip_no_record / skip_model_mismatch / skip_messages_unavailable /
    skip_no_embedding / skip_service; state не вызывается (spy).
  - `scanHistory`: глоб-матчинг; **plan-исключение** (кандидаты без plan-путей,
    `plan_excluded`); **skip_confidential (resolved-набор, включая default —
    при пустом user-`confidential.paths`)**; coverage by artifacts;
    not_in_git; plan-ассоциация (конвенция + same-commit только plan-подобные);
    title из H1; merged по isAncestor; `%ct` → time; git-сбой → fail-soft
    (gitErrors).
  - `synthesizeGitEntry`: детерминированный session_id (RI-1); author-маркер;
    форма записи; artifacts-фильтр (existsSync/resolved/cap); **re-mask
    LLM-вывода до embed (записан embedding — от маскированного контента)**;
    idempotency (already_indexed, без перезаписи).
- `summarize.test.js`: `instructions` — промпт расширен; без параметра —
  промпт побайтово как до изменения (regression).
- `config.test.js`: `history_globs` — absent → inherit (use-site); array →
  trim/unique; non-array → fallback + warn (память активна).
- `index.test.js`: list (секции A/B, снапшот, dry-run превью, 0 LLM, флаг
  `summarizer_model_missing`); run sessions (явные ID; all_empty без снапшота
  → отказ; cap); run git (явные specs; all; cap; already_indexed;
  summarize-fail → skip, партия живёт; **hard guard при absent
  summarizer_model**); service-session guard; телеметрия (event-имена +
  поля, aggregates-only).

## 7. Риски и принятые ограничения

- **Удалённые/не-в-git спеки** — вне скоупа (нет файла/истории); листинг
  показывает только candidates в дереве.
- **Качество LLM-summary спеки** — спеки сами являются конспектами качества;
  промпт расширен `instructions`; one-off стоимость, cap 20/вызов.
- **Суммаризация через сервис-сессии** — уже существующий механизм indexer
  (SESSIONS-set, авто-исключение), новый вызыватель, не новый путь.
- **Дублирование с light-путём (trade-off после отказа от ancestor-coverage,
  C2):** если git-источник запущен ДО light-бэкфилла, для фич, у которых есть
  реальная запись с пустыми `artifacts`, возможна пара (реальная +
  синтетическая) — ограниченная, обе записи полезны, удаление через
  `memory_prune`. Рекомендованный порядок в команде: сначала sessions
  (light), затем git. После light-бэкфилла coverage по artifacts работает
  полностью (RI-2).
- **Legacy `specs/**`** — по default (`artifact_globs`) не покрывается;
  для этого репо — `history_globs` в `maestro.json` (D8), канон задокументирован.

## 8. Открытые вопросы

Не блокирующих нет — все решения зафиксированы (D1–D8).
<!-- maestro:sanitize
status: CLEAN
date: 2026-09-12
hash: 1e566a648fbcd5c88c3f1af6204817f24a647a443a8b912b70036304843caae0
-->
<!-- maestro:review
reviewer: opus
date: 2026-09-12
verdict: approve
hash: 1e566a648fbcd5c88c3f1af6204817f24a647a443a8b912b70036304843caae0
-->
