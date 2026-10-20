# Retire `confidential`: нативные permissions как единственный барьер доступа

## Статус

- Дата: 2026-10-20. Версия: 3. Тип: **spec** (architectural feature).
- Репо: `maestro-agent` (authoring).
- Основано на: `specs/native-permissions-rebalance.md` (Этап A реализован; V1
  merge-семантики подтверждена 2026-09-20), решении пользователя о полном уходе
  от функционала `confidential` (вариант B) и дизайн-сессии 2026-10-19/20
  (решения D1–D8 ниже, HITL).
- **Revise v2 (по spec review + углублённому анализу trust):** решение по
  trust финализировано как **B** (секция `trust` полностью убирается из схемы);
  закрыты Important-находки I1–I4 (sandbox `secrets/**`, порядок миграции,
  manual_docs-покрытие, SEC-5-канал git-backfill) и Minor M1–M10.
- **Revise v3 (контрольный review, раунд 2):** закрыты N1–N7 — B×D5:
  потеря плагинного файлового доступа custom-trusted агентами происходит
  **с обновления плагина 6.4.0, в любом режиме** (не «при миграции»);
  генерируемые конфиги (setup-шаблон + sandbox-фикстура) — без `trust`;
  SECURITY.md §2 «Модель доверия» включён в rewrite; N4–N7 — scope
  docs-drift, edit-deny `secrets/**`, model-selection «Отношение к
  trust-модели», trust-and-security «Как применять».
- Выходит за рамки Этапа B исходной спеки: помимо удаления enforcement
  (R2-enforcement/R9) — удаление **data-source** (секции `confidential` из
  `maestro.json`), отказ от memory-маскирования (B3) и **удаление секции
  `trust`** (B).

## 1. Intent и почему

Секция `confidential` в `maestro.json` сегодня играет две роли:

1. **Источник enforcement** — плагин гейтит `read`/`write`/`edit` по
   `confidential.paths` + built-in + активному конфиг-слою (P6).
2. **Знание оркестратора** — список для confidential-notice (шаг 0),
   маршрутизации вопросов через custodian (шаг 8) и маркера `из confidential`
   в спеке.

Роль 1 дублирует нативные permissions OpenCode, которые уже генерируются
`/maestro-setup` (Этап A: R1+R2-конфиг+R4): deny `read`/`edit`/`glob`/`grep` +
per-agent allow `custodian`/`sanitizer`. Нативный слой надёжнее: fail-closed в
ядре (не зависит от наличия плагина — снимает fail-open риск P5), настоящий
per-call HITL через `ask`, V1-верифицированный allow-внутри-deny.

Роль 2 остаётся после переноса enforcement — решена решением D2 (гибрид).

**Цель фичи:** единый барьер доступа (нативные permissions), единый источник
путей (нативный конфиг), упрощённый плагин (observability + sanitizer +
shadow-аудит), честная security-модель (документированные residual-риски
вместо «двух замков»).

## 2. Goals / Non-goals

**Goals**

- G1. Файловый access-control — только нативные permissions OpenCode
  (project `.opencode/opencode.json` + global; agent rules take precedence).
- G2. Удаление секции `confidential` из схемы `maestro.json` и канона
  `maestro-assistant` (для новых проектов/инициализаций).
- G3. Оркестратор узнаёт restricted-пути из плагинной директивы (D2) и
  сохраняет процесс custodian Q/A + маркер `из confidential`.
- G4. Memory layer работает без confidential-механики (D3), риски
  задокументированы (SEC-5 rewrite).
- G5. Безопасная миграция существующих проектов без fail-open окна (D5,
  dual mode).
- G6. Синхронизация `SECURITY.md`, `manual_docs/`, sandbox/benchmark,
  регрессионный entry, bump 6.4.0.

**Non-goals**

- NG1. Удаление legacy-enforcement кода из плагина — отдельный будущий релиз
  «retire legacy enforcement» (после миграции проектов; dual mode, D5).
- NG2. Изменение `sanitizer_whitelist` (Ур.1) — ортогональная механика,
  остаётся.
- NG3. Trust-механика **заменяется** решением D6 (B): секция `trust`
  убирается из схемы; стандартная ростер-семёрка — по ролям; кастомные
  агенты — всегда untrusted для U1. (Санитайзер-механика U1 сама —
  без изменений, NG2.)
- NG4. Изменение `maestro_config`-тула (sanctioned channel, P6).
- NG5. Защита bash-вызовов от секретов — не улучшается и не ухудшается
  (parity: ни плагин, ни нативный слой bash не перехватывают содержимое).

**Anti-goals (что бы сделало фичу неудачной)**

- Fail-open окно при обновлении плагина на существующих проектах (D5
  исключает; regression entry проверяет).
- Тише-тише деградация custodian (D6 исключает: role-trusted).
- Дрейф «оркестратор не знает о confidential» → потеря процесса custodian Q/A
  (D2 закрывает).

## 3. Дизайн-решения (HITL, 2026-10-19/20)

- **D1. Нативный барьер.** Единственный access-control — нативные
  permissions. Плагин не бросает `[confidential:deny]` (кроме legacy-режима,
  D5).
- **D2. Знание оркестратора — гибрид (a+b).** Плагин при init выводит
  restricted-набор из нативных конфигов и инжектит директиву в system-контекст
  top-level primary-сессий (паттерн `communication`/`feedback_report`).
  `docs/project-context.md` §12 ведёт строку-зеркало как
  **человеческую документацию** (не процессный источник). **Канонический
  формат строки (M2):** `**Confidential-данные:** <p1, p2, …>` — одна строка,
  repo-relative пути, через запятую; ассистент-воркфлоу пишет ровно этот
  формат. При старте — сверка директивы с §12 → warn при расхождении
  (детектор дрейфа, в т.ч. нарушенного порядка миграции — D5/I2).
- **D3. Memory: удаление механики.** confidential-маскирование транскриптов,
  artifact-drop, `skip_confidential` git-backfill, confidential-часть
  double-masking бэкапов — удаляются. Остаётся generic-sanitize (технические
  секреты: key=value, .env, PEM, PII — те же regex Ур.1). **У memory-механики
  нет dual mode** (M5) — поведение одинаково в legacy и new-режимах;
  принятие риска распространяется и на проекты в legacy-режиме. Риск утечки
  бизнес-данных через память (recognition-каналы: (a) ответ custodian с
  значением, (b) реплика пользователя, (c) черновик спеки, (d) **git-backfill**
  — файл из git-истории, прочитанный по allowlist-глобам
  (`history_globs`/`artifact_globs`) и отправленный в LLM-саммаризатор, I4) —
  **документированное принятие риска** (SEC-5).
- **D4. P6 — residual-риск.** Нативный канон покрывает root-слои
  (`maestro.json`, `.maestro/**`). Глобальный слой
  (`~/.config/opencode/.maestro/maestro.json`) и `MAESTRO_CONFIG` (debug) —
  residual-риск, паритет с уже принятым residual (`bash cat maestro.json`);
  нативный default `external_directory: ask` (per-call промпт на чтения вне
  проекта) residual-окно немного сужает (M6 — отметить в P6-rewrite).
  Документировать в SECURITY.md P6. Новая механика не вводится.
- **D5. Миграция — dual mode.** Пока секция `confidential` **есть** в
  `maestro.json` — плагин исполняет legacy-enforcement как сегодня
  (fail-closed, без окна; для кастомных ключей `trust` — §4.1, B/N1: deny
  с обновления 6.4.0). Секции **нет** — только нативный слой + директива
  + shadow-аудит. Legacy-код отмирает в будущем релизе.
- **D6. Trust (P4a) — удаление секции (вариант B, финализирован 2026-10-20
  после углублённого анализа).** `custodian`/`sanitizer` всегда trusted
  **по роли** (hardcoded role-set в плагине, не конфигурируется). Секция
  `trust` **полностью убирается из схемы** и канона: любой ключ `trust` в
  старом `maestro.json` (штатные имена и кастомные — без различия) → warn
  `trust:deprecated_key` (однократно при init, со списком проигнорированных
  ключей) + игнор значения. U1-маскирование task-промпта применяется ко
  **всем** диспатчам кроме role-trusted — **включая кастомных агентов**.
  **Принятое ограничение:** кастомный агент не может быть освобождён от
  маскирования промпта; обходные пути — `sanitizer_whitelist.by_agent`
  (выключение правил на агента, OP-4 HITL) для ложных срабатываний и
  `allow_values` для известных значений. Файловый доступ кастомного агента
  не затрагивается решением по U1 (последствие для legacy-плагинного
  доступа — legacy-note B/N1; нативный per-agent allow — отдельно).
  P4-check ассистента
  переписывается в безусловный role-based вид (предотвращение тихой утраты
  P4-предупреждений); «non-functional mode» P4a становится недостижимым.
- **D7. Shadow-аудит остаётся.** Плагин логирует **попытки** доступа к
  derived restricted-набору (существующие хуки `tool.execute.before/after`):
  `confidential.access` с полями tool, sessionID, agent, target (sanitized),
  `outcome: allow|deny|unknown` (best-effort зеркало: per-agent allow виден в
  том же нативном конфиге → allow; нет → deny; нерезолвимо → unknown).
  **target = `basename`** (M3, прецедент: текущий аудит-лог; полный
  repo-relative путь раскрывает расположение confidential-материала —
  дисциплина SEC-4b). **Ограничение best-effort-зеркала (M4):** per-agent
  allow берётся только из JSON-конфигов; frontmatter агентов не учитывается.
  Документировать как mirror, не ground truth.
- **D8. Benchmark/sandbox.** `sandbox-smoke` проверяет **статически**:
  сгенерированный `.opencode/opencode.json` содержит нативные deny +
  per-agent allow (уже частично проверяется) и fixture `maestro.json` НЕ
  содержит ключа `confidential`. Leak-статус (values из confidential в
  spec/plan/коде) — основной security-контур, остаётся. Live-проверка
  «primary получил deny» — в `docs/testing/maestro-sandbox-checklist.md`
  (ручной чеклист), не в smoke.

## 4. Детали по модулям

### 4.1. Плагин core (`plugins/maestro-bootstrap/core.js`)

**Новое:**

- `loadNativeRestrictedSet(root)` — читает нативные конфиги в порядке
  precedence (global XDG `~/.config/opencode/opencode.json[c]` → root
  `opencode.json[c]` → `.opencode/opencode.json[c]`; каждый — опционален),
  извлекает `permission.read` (и per-agent `agent.*.permission.read`) deny-
  паттерны. Результат: `{ dataPaths: string[], agentAllows: Map<agent,
  string[]> }`. **Выбор извлекать только `read` (M1):** директива и
  custodian Q/A-маршрутизация — про чтения; ограничение — асимметричный
  конфиг (deny только `edit`/`write`) не попадёт в dataPaths/shadow-аудит
  (документировать). **Исключение из `dataPaths`** (защита-конфиг/ядро, не
  «данные»): точные `maestro.json`, `.maestro/**`, built-in секреты ядра
  (`*.env`, `*.env.*`, `*.pem`, `*.key`, `*.crt`, `*.p12`, `*.pfx`).
  Мерж слоёв: на уровне «tool → pattern» последний слой побеждает
  (key-level override); deny в любом слое без override в более высоком →
  в набор. **Консервативная over-аппроксимация допустима** (больше путей в
  наборе → больше custodian-маршрутизации, утечки нет).
- **Директива (D2).** Инжект в system-контекст top-level primary-сессий
  (паттерн `communication.js`/`feedback-report.js`):
  `restricted-data paths: <p1, p2, …>` (только при непустом наборе; пустой →
  директивы нет; канон SKILL определяет: «нет директивы — confidential-данных
  нет, кроме built-in секретов: `.env`/`.env.*` — дефолт ядра OpenCode;
   `*.pem`/`*.key`/`*.crt`/`*.p12`/`*.pfx` — init-базелин при наличии в
   нативном конфиге (M7, точная формулировка)»).
  **Legacy-режим (D5):** набор = union(native-derived, legacy
  `confidential.paths`) — чтобы оркестратор на немигрированном проекте
  всё равно знал пути (в т.ч. если нативных deny ещё нет).
- **Shadow-аудит (D7).** В существующем `execute.before/after`-хуке: tool ∈
  `{read, edit, write, glob, grep}` + target/path-аргумент матчит `dataPaths`
  → `auditLog` `confidential.access { tool, sessionID, agent, target,
  outcome }`. Target = `basename` (M3; SEC-4b: не раскрывать содержимое и
  расположение — полный путь в лог не пишется).
- **Trust (D6, вариант B).** `loadTrustConfig`: role-set
  `{custodian, sanitizer}` — всегда trusted (hardcoded, не конфигурируется;
  тест: набор = role-set при любом конфиге). Секция `trust` в конфиге
  **не читается**: любой ключ → warn `trust:deprecated_key` (однократно при
  init, со списком проигнорированных ключей) + игнор. U1: role-trusted →
  промпт raw; все остальные (стандартная пятёрка и кастомные агенты) →
  sanitize до диспатча. **Файловый доступ не привязан к trust** — только
  нативный конфиг (per-agent allow). **Legacy-note (B, N1):** плагинный
  файловый доступ custom-trusted агентов **не сохраняется**: с обновления
  плагина 6.4.0 секция `trust` не читается **в любом режиме**, и кастомные
  агенты теряют плагинный файловый доступ **немедленно** (направление
  fail-closed — утечки нет). Warn `trust:deprecated_key` содержит подсказку:
  «кастомные агенты из `trust` теряют плагинный файловый доступ — при
  необходимости добавить нативный per-agent allow (HITL)».
- **Init-warn legacy (D5):** секция `confidential` найдена → warn
  `confidential:legacy_active` (однократно) — «legacy-enforcement активен;
  секция игнорируется в будущем релизе; миграция — `/maestro-assistant`».

**Legacy-режим (D5) — что остаётся за условием «секция есть»:**

- существующий enforcement (`isConfidentialTarget` +
  `resolveIsTrustedSubagent` + throw `[confidential:deny]`) — без изменений
  для стандартного ростера и primary; кастомные агенты из секции `trust` —
  deny с обновления 6.4.0 (B/N1: секция не читается);
- P6 «активный конфиг в контуре» — только в legacy-режиме (в new-режиме —
  residual по D4);
- built-in-защита секретов — только в legacy-режиме (в new-режиме built-in —
  за ядром OpenCode и нативным каноном).

**New-режим (секции нет) — что выключается:** enforcement-throw,
`isConfidentialTarget`-контур, P6-auto-контур. **`confGlobMatch` остаётся**
(используется shadow-аудитом и `loadNativeRestrictedSet`-матчингом).

### 4.2. Memory module (`plugins/maestro-bootstrap/memory/`)

- `mask.js`: `maskTranscript(text, { confidentialPatterns })` → параметр
  больше не передаётся вызывающими (signature можно оставить для
  backward-compat с тестами, но production-вызовы — без него); line-level
  confidential-фильтр (maskLines) **удаляется**; `sanitize()` (generic)
  остаётся. `maskEntry`: artifact-drop по confidential-паттернам **удаляется**
  (allowlist `artifact_globs` не меняется).
- `indexer.js`/`recall.js`/`memory_search` (tool в `index.js`): убрать
  `confidentialPatterns` из pipeline (запрос маскируется только generic
  sanitize).
- git-backfill (`memory_reindex`): `skip_confidential` **удаляется** —
  кандидаты только по `history_globs`/`artifact_globs` (allowlist).
- backup/restore (`memory_backup`): `maskPatterns.confidential`/`artifacts`
  **удаляются**; остаётся generic-sanitize записи (SEC-4b/SEC-5).
- init-warn'ы, связанные с `confidential.paths` (centralized backend,
  openai embedder, `memory:log_confidential_note`) — **удаляются**;
  риск централизованных бэкендов документирован в SEC-5 (не warn).
- `@maestro-memory` status (skills/maestro-memory/references/status.md):
  убрать упоминание confidential-набора из диагностики.

### 4.3. Канон скиллов (`skills/`)

- **`maestro/SKILL.md`:**
  - шаг 0 «Confidential notice (pre-work)» — источник: **плагинная
    директива** (не `maestro_config → confidential`); формулировка:
    «В проекте restricted-данные (N путей: …). Доступ — только через
    trusted-агентов (custodian Q/A); primary/untrusted — нативный deny.
    Legacy-режим (директива + warn legacy_active) — защита как раньше».
    Определение «trusted» в шаге 0 — **по роли** (custodian/sanitizer);
    секция `trust` не читается (B).
  - шаг 8 custodian Q/A: `{confidential_paths}` — из директивы (legacy:
    union по D2);
  - **зачистка dead-веток (B):** строка шага 9 «Trusted opus (если есть в
    maestro.json) → skip U1» и special case шага 10b «(a) opus-trusted
    (B-5)» — удалить/переписать (trust — по роли; opus всегда untrusted);
  - таблица «Обработка сбоев», строка `confidential:deny` — пометка
    «legacy-режим (секция есть)»; в new-режиме deny приходит нативно
    (permission error) — canonical-описание обработки.
- **`maestro/references/trust-and-security.md`:** переписать: Точка 1 =
  нативные permissions (fail-closed, не плагином); shadow-аудит (D7) —
  observability, не enforcement; dual mode (D5); trust (D6, B) — секция
  удалена, role-set `{custodian, sanitizer}` hardcoded; **Trust Matrix**
  (строка opus и остальных стандартных: всегда untrusted для U1, файловый
  доступ — нативно) и таблица уровней доверия — переписать; подсекция
  «Как применять» (steps 1–2: «прочитать `maestro.json` на шаге 0» /
  «при каждом диспатче — проверить секцию `trust`» — мертвы под B, N7) —
  переписать; P4a «non-functional mode» — недостижим.
- **`maestro/references/hitl-gate-protocol.md`, `model-selection.md`,
  `example-workflow.md`:** точечные правки упомянований confidential
  (по grep; смысл: источник путей = директива/нативный конфиг).
- **`maestro/invariants.md`** (строка 34): «механический пол (Ур.1
  маскирование task-промптов и confidential-deny…)» → «Ур.1 маскирование
  task-промптов + нативная файловая защита (permissions ядра)».
- **`maestro/custodian-prompt.md`:** параметр `{confidential_paths}` —
  пометка источника (оркестратор передаёт из директивы); тело промпта
  без изменений (self-contained сохранён).
- **`maestro-assistant/SKILL.md`:**
  - канон `maestro.json` (inline JSON): **без секций `confidential` и
    `trust`** (B); docs-drift D-проверка покрывает оба ключа;
  - правило по удалённой секции `trust`: «любая `trust` в старых конфигах —
    warn + игнор; trusted — custodian/sanitizer по роли; файловый доступ
    кастомных агентов — нативный per-agent allow, не trust»;
  - **P4-check переписать в безусловный role-based вид** (не зависит от
    trust-ключей в конфиге — предотвращение тихой утраты P4-предупреждений,
    углублённый анализ); ⚠️-блок P4a и правила вывода trust — переписать по
    B;
  - удалить: секция «Правка `confidential.paths` (IMP-3)», sync-правило I3 в
    старой форме;
  - новый воркфлоу **«Настройка restricted-путей»**: одна операция пишет
    (a) нативные deny `read`/`edit`/`glob`/`grep` в merge-config + per-agent
    allow custodian/sanitizer, (b) каноническую строку «Confidential-данные:
    …» в project-context §12 (формат D2/M2); HITL-гейт с diff; снятие с
    защиты — адресный diff + отдельное HITL (аналог IMP-3, но для нативных
    правил);
  - **воркфлоу «Миграция legacy → new» (I2, зафиксированный порядок):**
    (1) написать нативные deny + per-agent allow + строку §12 (одна
    операция) → (2) restart + **live-проверка нативного deny** →
    (3) **только затем** удалить секцию `confidential` (адресный diff +
    отдельное HITL) → (4) restart + проверка директивы/new-режима.
    Предпроверка удаления секции = наличие нативных deny для всех путей §12;
    warn D2 — детектор нарушенного порядка. **Предпроверка (шаг 0, ДО
    обновления плагина, N1):** если в `maestro.json` есть `trust.<custom>` —
    эти агенты теряют плагинный файловый доступ с обновления 6.4.0 (в любом
    режиме); при необходимости — сначала добавить нативный per-agent allow
    (отдельное HITL);
  - **канон-строка (I4):** «restricted-пути не добавляются в
    `memory.history_globs`/`memory.artifact_globs`» (git-backfill-канал не
    попадает в allowlist);
  - детектор дрейфа (консультация, шаг 2): сверка нативных deny ↔ §12
    (warn «расходятся — перегенерирую»).
- **`maestro-setup/SKILL.md`:** init-генерация — нативные deny как в Этапе A
  (без изменений) + строка §12 в генерируемом project-context; `maestro.json`
  генерируется **без** `confidential` **и `trust`** (N2: текущий шаблон
  выводит `trust.custodian/sanitizer: true` — убрать); warn 6.1.0
  «non-memory ключи (включая trust/confidential/…)» — переформулировать;
  P4-check setup (текущий: «если `trust.custodian`/`trust.sanitizer`
  включены») — безусловный role-based вид, как у ассистента (B).
- **`maestro-memory/references/*.md`:** убрать упоминания confidential
  (status.md — диагностика).
- **`maestro-feedback-report/SKILL.md`:** секция «confidential.access» →
  «N попыток (M от trusted, K unknown)» (по shadow-аудиту, D7).
- **`maestro-benchmark/SKILL.md`:** security-контур: нативные правила
  (статика) + leak-статус; `confidentialAccess` в JSON-отчёте →
  `{ attempts: N, byTrusted: M, unknown: K }` (alpha-модуль, breaking
  допустим; diff.mjs — обновить сравнение поля; byTrusted = role-set).
- **`agents/custodian.md`, `agents/sanitizer.md`:** убрать stale-формулы
  `trust.X` из тел промптов (доверие — по роли, не по ключу конфига).

### 4.4. `SECURITY.md` (source of truth)

- **§2 «Модель доверия»** переписать (B, N3): trust = role-set по роли,
  секции в конфиге нет; fail-closed — по роли (role-set trusted **и при
  отсутствии** `maestro.json` — hardcoded); барьер для primary — нативный
  (new-режим) / плагинный (legacy). Текущий §2 («trust привязан к имени
  агента (`maestro.json → trust)», «отсутствие `maestro.json` → все
  untrusted», «плагин deny'ит root/primary») вступает в прямое противоречие
  с P4a после B.
- **P1** переписать: доступ к confidential-данным — нативные permissions
  (deny + per-agent allow); плагин — observability (shadow-аудит), не
  enforcement (кроме legacy-режима).
- **P4a** переписать (B): секция `trust` удалена из схемы; trusted =
  role-set `{custodian, sanitizer}` (hardcoded); «non-functional mode»
  недостижим; P4-check ассистента — безусловный role-based вид; кастомные
  агенты всегда U1-masked (принятое ограничение + обходные пути
  `by_agent`/`allow_values`); снятие доступа custodian — только нативный
  конфиг (per-agent allow).
- **P5** смягчить: файловая защита не зависит от плагина (нативный
  fail-closed); плагин обязателен для U1-sanitize, merge-guard,
  observability, memory.
- **P6** residual: root-слои — нативный канон; глобальный слой +
  `MAESTRO_CONFIG` — документированный residual (parity с `bash cat`).
- **SEC-5** переписать: memory **не маскирует** бизнес-confidential
  (только generic-секреты); каналы признанного риска: (a) ответ custodian с
  значением, (b) реплика пользователя, (c) черновик спеки, (d) **git-backfill**
  — файл из git-истории, прочитанный по allowlist-глобам
  (`history_globs`/`artifact_globs`) и отправленный в LLM-саммаризатор (I4);
  митигации: локальный embedder + sqlite по умолчанию, allowlist артефактов,
  канон-строка ассистента «restricted-пути не в globs» (I4);
  централизованные бэкенды — осознанный выбор.
- **§4 контрмеры:** нативный permission-бастион — основной; плагин —
  U1-sanitize (fail-closed), shadow-аудит, merge/commit-guard, observability;
  legacy-режим — до миграции.
- **§5 ограничения:** обновить (fail-open → снимается для файлового слоя;
  residual по P6/SEC-5/BAU).
- **Тест-гарды инвариантов (обязательно):** (i) new-режим (секции нет) —
  read-вызов к restricted-пути primary **не** блокируется плагином (тест
  «no plugin file-access enforcement in new mode»); (ii) legacy-режим —
  блокируется (существующие тесты сохраняются под условием); (iii) директива
  инжектится для top-level primary при непустом наборе и не инжектится в
  task-сессиях (паттерн communication-тестов); (iv) **B-pin:** trusted-набор
  = role-set `{custodian, sanitizer}` при любом конфиге (ключи `trust.*`
  не изменяют набор), кастомный агент всегда U1-masked независимо от
  конфига, warn `trust:deprecated_key` на любой ключ секции (со списком).

### 4.5. `manual_docs/` (sync по правилу AGENTS.md)

- `reference/config.md`: секция `confidential` → «Restricted-данные:
  нативные permissions (источник) + project-context §12 (документация)»;
  секция `trust` — **удалена** (B): «доверие по роли; любой `trust` в
  конфиге — warn + игнор».
- `explanation/agents-and-trust.md`: модель доверия — переписать (барьер =
  нативный; custodian — Q/A-брокер по нативному allow; U1 — отдельный слой;
  trust = роль, секции нет; кастомные агенты — обходные пути
  `by_agent`/`allow_values`).
- `reference/memory.md`: маскирование — только generic; SEC-5-риск
  (каналы a–d, вкл. git-backfill); backup — без confidential-double-masking.
- `reference/model-selection.md`: P4a-строка (role-trusted, B) + строка
  U1-семантики для всех агентов вне role-set; блок «Отношение к trust-модели»
  (lines 94–107: «Trust определяется в `maestro.json → trust»`, «trusted
  (в `maestro.json`)») — переписать (N6).
- `overview/changelog.md`: секция релиза 6.4.0 (при bump, шаг 18) с
  breaking-строкой по схеме (удалены секции `confidential` и `trust`).
- **Файлы со сменой семантики (I3, не grep-правки):**
  - `how-to/manage-confidential-paths.md` — **полная переписка** в how-to
    «Настройка restricted-путей» (старый механизм — правка
    `confidential.paths` + sync-правило I3 — удалён);
  - `explanation/pipeline-overview.md` — строка шага 0: источник
    confidential-notice = **плагинная директива** (не `confidential.paths`
    из `maestro.json`);
  - `tutorials/setup-project.md` (строка «Проверка confidential-инварианта»)
    — live-чек в new-режиме = **нативный permission error** (не
    `[confidential:deny]`; последний — только legacy-режим).
- `overview/what-is-maestro.md`, `index.md`, остальные `tutorials/*`,
  `reference/hitl-gates.md`, `reference/commands.md`,
  `how-to/memory-backup-restore.md`: точечные правки по grep `confidential`
  + `trust`.
- `README.md` (корень, по факту): строки 150–156/193–194 (trust-матрица,
  confidential-инвариант) — обновить (B).

### 4.6. Sandbox / benchmark / чеклист

- `maestro-sandbox.sh`: генерация fixture `maestro.json` — **без** секций
  `confidential` и `trust` (N2: текущая фикстура несёт `trust`); fixture
  `docs/confidential/`, `.env` — без изменений.
  **Фикстура `secrets/` (I1):** в генерируемый `.opencode/opencode.json`
  песочницы **добавляются** нативные deny `secrets/**` (read/edit/glob/grep —
  тот же набор, что и в воркфлоу «Настройка restricted-путей», N5) +
  per-agent allow custodian/sanitizer — корректное представление миграции
  (без этого фикстура в new-режиме не защищена никем: плагин выключен, а
  прежние правила её не покрывали). Сгенерированные комментарии
  (шапка `maestro-sandbox.sh`, строки project-context, README песочницы:
  «закрыт `confidential.paths`») → «закрыт нативным deny».
- `skills/maestro-benchmark/sandbox-smoke.test.mjs`: +assertion
  `!("confidential" in cfg.maestro.json)` **и** `!("trust" in
  cfg.maestro.json)` (N2); существующие assertions нативных deny/allow —
  сохраняются, +assertion нативного deny `secrets/**` (read/edit/glob/grep,
  I1/N5).
- `skills/maestro-benchmark/diff.test.mjs` + `SKILL.md`: поле
  `security.confidentialAccess` → `{ attempts, byTrusted, unknown }`
  (byTrusted = role-set).
- `docs/testing/maestro-sandbox-checklist.md`: строка D2 («primary не читает
  `.env`/`secrets/`») — переформулировать: «нативный deny (ядро +
  сгенерированное правило)»; live-инвариант («trusted читает / primary —
  нативный deny») — помечен как ручная проверка.

### 4.7. Тесты и drift-проверки

- `plugins/maestro-bootstrap/index.test.js`:
  - блок «confidential config» — переделать: legacy-режим (секция есть →
    enforcement как сейчас) + new-режим (секции нет → нет
    `[confidential:deny]`, директива, shadow-аудит);
  - новые: `loadNativeRestrictedSet` (мерж слоёв, exclusion, per-agent
    allows), директива (top-level yes / task-session no),
    `trust:deprecated_key` warn (любой ключ секции, список игнорируемых),
    `confidential:legacy_active` warn;
  - **B-pin:** role-set = `{custodian, sanitizer}` при любом конфиге; ключ
    `trust.<custom>: true` НЕ отключает U1-маскирование для кастомного
    агента (диспатч маскируется);
- `plugins/maestro-bootstrap/memory/mask.test.js`: удалить
  confidential-lines тесты; generic-sanitize тесты сохраняются; **M9:**
  artifact-drop при импорте живёт в `memory/validation.js`
  (`validateImportEntry`), call-site маскирования query в
  `memory_recall_preview` — `memory/index.js` (файлы названы явно, чтобы
  drop не остался висячим);
- `maestro-install/docs-drift.test.mjs`: **D-проверка (новая)**: inline-
  канон `maestro.json` в `skills/maestro-assistant/SKILL.md` НЕ содержит
  ключи `"confidential"` и `"trust"` (предотвращение канон-дрейфа).
- `npm test` (все) — зелёный как gate.

### 4.8. Версионирование

- Bump **6.3.0 → 6.4.0** (minor: новая фича/процессное правило; breaking
  для схемы `maestro.json` — но migration-safe через dual mode, D5).
- Changelog `## [YYYY-MM-DD]` + `> **Версия 6.4.0** — …`; `[Unreleased]`
  переезжает в секцию релиза; sync ссылок на версию (package.json,
  project-context §3, README по факту).

## 5. V-checks (верификация)

- **V1** (done, 2026-09-20): нативный allow-внутри-deny (agent rules take
  precedence) — подтверждён.
- **V2 (после реализации, dogfooding):** после рестарта opencode в авторском
  репо (где `.opencode/opencode.json` имеет deny-паттерны) — строка
  `restricted-data paths: …` присутствует в system-контексте top-level
  primary-сессии и отсутствует в task-сессиях сабагентов. Примечание (M8):
  авторское репо само несёт секцию `confidential` в своём `maestro.json` →
  остаётся в legacy-режиме до само-миграции (follow-up-задача, не эта
  фича); V2 в первую очередь верифицирует legacy-директиву (union).
- **V3:** derived-набор (директива) сверить с фактическим поведением
  нативных permissions в dogfooding-проекте (ручная проверка: orchestrator
  «читает» listed-путь → нативный deny; unlisted → allow). При расхождении —
  фикс правила мержа в `loadNativeRestrictedSet`.
- **V4:** dual mode — fixture со старой секцией: legacy-enforcement работает
  (тесты), fixture без секции: плагин не блокирует (тесты).
- **V5 (E2E-критерий, `[Manual]`):** sandbox-чеклист — live «custodian
  читает / primary — deny» на нативном слое после реализации.

## 6. Риски

| Риск | Митигация |
|---|---|
| File-reading `loadNativeRestrictedSet` ≠ runtime-merged config (edge-кейсы мержа слоёв) | Консервативная over-аппроксимация безопасна (больше restricted → больше custodian-маршрутизации, утечки нет); V3 сверка; drift-warn §12↔direct |
| Legacy-код живёт дольше плана (NG1) | Отслеживание: roadmap-задача «retire legacy enforcement» (создать entry в roadmap при merge); dual mode не расширяется |
| SEC-5: утечка бизнес-данных через память (recognition-каналы) | Принято HITL (D3); митигации: локальный embedder+sqlite по умолчанию, generic-sanitize, allowlist артефактов; риск задокументирован |
| §12-документация дрейфует от нативного конфига | Cross-check warn при старте плагина (D2); ассистент-воркфлоу пишет обе части одной операцией |
| Benchmark JSON-схема меняется (alpha) | Модуль alpha — breaking допустим; diff.mjs обновляется в той же фиче |
| Окно миграции: секция удалена, а нативные deny не записаны (I2) | Зафиксированный порядок ассистент-воркфлоу (deny → live-проверка → удаление секции) + warn D2 как детектор нарушенного порядка |
| Тихая утрата P4-check ассистента (rewrite по B не сделан) | Безусловный role-based rewrite в спеке (B) + ревью-точка AC 7; D-проверка — только отсутствие ключа `trust` в каноне (N4: семантику прозы docs-drift не проверяет) |
| Custom-trusted агенты теряют плагинный файловый доступ **с обновления 6.4.0, в любом режиме** (N1) | Legacy-note в D6/B + подсказка в warn `trust:deprecated_key` + предпроверка миграционного воркфлоу (шаг 0, до обновления); при необходимости — нативный per-agent allow |
| Старые `maestro.json` с `trust.*` (штатные + кастомные ключи) | warn `trust:deprecated_key` + игнор (B): role-set неизменяем; для кастомных агентов — см. строку выше (потеря плагинного файлового доступа) |

## 7. Acceptance criteria

1. `npm test` зелёный (вкл. docs-drift, sandbox-smoke, memory-тесты).
2. New-режим: файл `docs/confidential/*` защищён **только** нативным
   permission-слоем (V3/V4); плагин не бросает `[confidential:deny]`.
3. Директива видна в system-контексте top-level primary (V2); §12-строка
   ведётся ассистентом в каноническом формате (D2/M2).
4. Memory: индексация/recall/backup без confidential-механики (тесты +
   smoke).
5. `SECURITY.md` §2/P1/P4a/P5/P6/SEC-5 (каналы a–d)/§4/§5 актуальны;
   тест-гарды инвариантов (i–iv, вкл. B-pin) на месте.
6. `manual_docs/` синхронизированы (правило AGENTS.md), включая
   семантические файлы (I3: `manage-confidential-paths.md` — переписан,
   `pipeline-overview.md`, `setup-project.md`); README по факту.
7. **B (trust):** секция `trust` отсутствует в схеме/каноне (docs-drift),
   B-pin-тесты + warn на месте, P4-check ассистента — безусловный
   role-based вид.
8. **Sandbox (I1):** сгенерированный конфиг песочницы содержит нативные
   deny `secrets/**` + per-agent allow; сгенерированные комментарии и
   строка D2 чеклиста обновлены.
9. **Миграция (I2):** ассистент-воркфлоу «Миграция legacy → new» с
   зафиксированным порядком, предпроверкой удаления секции и предпроверкой
   `trust.<custom>` ДО обновления плагина (шаг 0, N1).
10. Sandbox-чеклист обновлён (live-инвариант = [Manual]).
11. Version 6.4.0 + changelog (шаг 18) с breaking-строкой (удалены секции
    `confidential` и `trust`).

## 8. Что оставляется строителю (my calls, не HITL)

- Имена функций/полей (`loadNativeRestrictedSet`, `dataPaths`,
  `confidential:legacy_active`, `trust:deprecated_key`,
  `restricted-data paths:`) — могут быть изменены при реализации, канон —
  строка директивы и имена warn'ов (фиксируются в тестах/docs-drift).
- Формат строки директивы: `restricted-data paths: p1, p2` (одна строка,
  без значения, repo-relative).
- Формат строки §12 (M2): `**Confidential-данные:** p1, p2` — одна строка,
  repo-relative, через запятую.
- Shadow-аудит target (M3): `basename` (прецедент текущего аудит-лога).
- `maskTranscript` signature — решение строителя (удалить параметр vs
  оставить no-op), при условии removal production-вызовов.
- Порядок задач плана — строителю (plan step 11).

<!-- maestro:sanitize
status: CLEAN
date: 2026-10-20
reviewer: sanitizer
hash: dd2e7ede06fad31760129dc7cf35bb7188d964f5034c6ad0af29886c45d1823e
-->

<!-- maestro:review
reviewer: opus
date: 2026-10-20
verdict: approve
hash: 2c6d0960d1d893dbf6bd4d0393205c60f6aa80e31de636496f7b9fae80cdb6dc
-->
