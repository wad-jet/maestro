---
name: maestro-assistant
description: Use when the user asks for help configuring maestro, organizing project structure/context, or wants to consult the rules of maestro (restricted-data/native permissions, role-based trust, sanitizer_whitelist, opencode.json models, project-context, pipeline structure). Also loaded by maestro-setup (tasks 2/3/3a) and maestro-init (pipeline config questions). Not for feature implementation.
---

# Maestro Assistant — конфигурация, структура и консультации по maestro

## Overview

`maestro-assistant` — общий источник правил конфигурации/процессов maestro и лёгкая точка
входа для настройки и консультаций в течение жизни проекта. Скилл **самодостаточен**:
канон правил живёт здесь, не ссылается на `manual_docs/` для исполнения (загружается в
изоляции: консультации, init, maestro).

**Язык:** все HITL-вопросы, варианты и сообщения пользователю — только на русском.

## Когда использовать

- Пользователь вызывает `/maestro-assistant <запрос>` для настройки конфигурации maestro,
  организации структуры/контекста, консультации по правилам.
- `/maestro-setup` (задачи 2/3/3а) загружает этот скилл и следует его правилам.
- `@maestro-init` по ходу pipeline загружает этот скилл при вопросах конфигурации/процессов.

## Полномочия и границы

- **Может напрямую редактировать** `maestro.json`, `.opencode/opencode.json` (или
  global-конфиг), `project-context.md`,
  структуру каталогов по запросу HITL. Идемпотентно, с HITL-гейтом на approve/правки/отмена
  и показом diff-merge перед записью.
- **НЕ реализует фичи** — не запускает pipeline, не пишет spec/plan/код.
- **Security — только через HITL**, сам вопросы безопасности не решает (trust — по роли,
  не конфигурируется).
- **Доступ к restricted-путям — закрыт** для primary (new-режим: нативный deny ядра;
  legacy-режим: плагинный deny). Не читать/не править содержимое restricted-путей
  (плагинная директива `restricted-data paths: …`, строка §12); запросы на работу с
  confidential-данными — только через допустимый канал (trusted-агент `custodian`/
  `sanitizer` по роли), не в обход.
- **Плагин-гейт НЕ требуется** для консультаций (правит конфиг, не гоняет confidential
  через pipeline).
- **Редирект (MIN-4):** если запрос требует изменения кода/spec/плана или запуска pipeline →
  `@maestro-init` (фича/багфикс/SDD), `/maestro-design` (дизайн/scaffold/roadmap), `@regression`
  (регрессия). Только конфиг/структура/контекст/консультация обрабатываются здесь.

## Канон `maestro.json` (источник истины)

Полный JSON-канон (эталон формата, который правит/генерирует assistant) — **inline здесь**.
Держать синхронно с правилами парсинга плагина (`loadMaestroConfig`/`loadWhitelist`/
`loadConfidentialConfig` — legacy-режим). Контроль дрейфа: docs-drift D-проверка
(inline-канон **не содержит** секций `confidential`/`trust` — 6.4.0, B) + конвенция с
кодом.
```json
{
  "sanitizer_whitelist": {
    "rules": { "env_secret": true, "data_field": true, "env_file": true, "db_credential": true, "ledger_entry": true, "private_key": true, "auth_header": true },
    "by_agent": { "reviewer": [] },
    "patterns": [],
    "extra_fields": [],
    "extra_uri_schemes": []
  },
  "memory": {
    "enabled": true,
    "auto_recall": true,
    "embedding_model": "Xenova/paraphrase-multilingual-MiniLM-L12-v2",
    "identity": null,
    "identity_env": null,
    "namespace": null,
    "module_dir": null,
    "idle_debounce_min": 10,
    "min_new_messages": 3,
    "backfill_window_days": 30,
    "backfill_max_per_start": 5,
    "retry_interval_min": 60,
    "top_k": 3,
    "min_score": 0.35,
    "similarity_threshold": 0.7,
    "retention_days": null,
    "summarize_timeout_ms": 120000,
    "report": { "include_text": false, "preview": true },
    "embedding": {
      "provider": "local",
      "model": null,
      "base_url": "https://api.openai.com/v1",
      "api_key_env": null,
      "dim": null
    },
    "probe_cooldown_min": 30,
    "artifact_globs": ["docs/superpowers/specs/**", "docs/superpowers/plans/**"],
    "history_globs": null,
    "backup": { "path": ".maestro/memory/backup", "retention": 3 },
    "storage": {
      "type": "sqlite",
      "qdrant": { "url": "https://qdrant.internal:6333", "api_key_env": "MAESTRO_MEMORY_QDRANT_KEY", "collection": "maestro_memory" },
      "pgvector": { "connection_string_env": "MAESTRO_MEMORY_PG_DSN", "table": "maestro_memory" }
    }
  }
}
```

### Секции (семантика)

- **`sanitizer_whitelist`** — правила маскирования чувствительных данных перед untrusted-диспатчем.
- **`memory`**, **`communication`**, **`feedback_report`** — см. ниже. Файл коммитится в git
  (project-режим).

### Удалённые секции (6.4.0, B/D5)

- **`trust` (удалена)** — любая `trust` в старых конфигах → warn `trust:deprecated_key`
  (однократно при init, со списком проигнорированных ключей) + **игнор значения**.
  Trusted — `custodian`/`sanitizer` **по роли** (hardcoded role-set в плагине, не
  конфигурируется); остальные агенты (стандартная пятёрка и кастомные) — untrusted
  (U1-маскирование task-промпта). Файловый доступ кастомных агентов — **нативный
  per-agent allow** (опционально, HITL), не trust.
- **`confidential` (legacy → удалена)** — dual mode (D5): пока секция есть в
  `maestro.json` — плагин исполняет legacy-enforcement как раньше (fail-closed, warn
  `confidential:legacy_active` при init). В new-режиме (секции нет) источник
  restricted-путей — **нативные permissions** (merge-config/global) + строка-зеркало
  §12; плагин — директива `restricted-data paths: …` + shadow-аудит. Миграция —
  воркфлоу «Миграция legacy → new».

### Правила вывода (из контекста §3/§5/§12)

- **`trust` (секция выводится никогда):** ключ не добавляется; при правке старого
  конфига с `trust` — секция **не переносится** (warn `trust:deprecated_key` + игнор,
  см. «Удалённые секции»). Trusted — по роли (role-set `{custodian, sanitizer}`).
  > ⚠️ (P4a, legacy) «non-functional mode» (снятие `custodian`/`sanitizer` из
  > `trust` делает агента неработоспособным) — **недостижим с 6.4.0**: role-set
  > не конфигурируется, доверие не снимается. Снятие файлового доступа
  > trusted-агента — только правка нативного per-agent allow (OP-4).
- **`sanitizer_whitelist`:** по §12; `extra_uri_schemes` из §3.

### Секция `memory` (опциональный memory layer)

**Опциональный модуль** плагина (векторная память сессий). НЕ часть стандартной
установки; включается только по явному запросу HITL (per-project opt-in через
`/maestro-setup`: `memory.enabled: true` в project-слое конфига). **Default:**
секции нет / `enabled: false`
→ память полностью off (хуки не регистрируются, зависимости не загружаются,
LLM-вызовов нет). Канон JSON — inline выше (поле `memory`).

Семантика ключей (полный справочник — `manual_docs/reference/memory.md`):

- **`enabled`** — единственный выключатель. `true` → плагин при старте
  self-provisions `module_dir` (создаёт каталог, пишет `package.json`
  single-writer, копирует исходники); пользователь выполняет `npm install` в
  `module_dir` и перезапускает opencode.
- **`auto_recall`** — авто-вспоминание (первое сообщение top-level primary
  сессии → блок `## Контекст из памяти maestro` в system prompt). `false` —
  только ручной `memory_search`.
- **`embedding_model`** — **legacy-алиас** для `embedding.model` (только при
  `provider: local`). Локальная модель эмбеддингов (transformers.js, dim 384,
  RU+EN, q8 ~120 МБ, кэш). Смена → переиндексация. Для `openai` `model` берётся
  строго из `embedding.model` (legacy-алиас не подставляется).
- **`embedding`** — блок конфигурации embedder (backward-compatible):
  - `embedding.provider` — `local` (default) | `openai` (внешний
    OpenAI-совместимый `/embeddings` API, осознанный opt-in).
  - `embedding.model` — `null` (default); local: имя ONNX-модели (fallback на
    `embedding_model`); openai: id модели API (**обязателен**).
  - `embedding.base_url` — `https://api.openai.com/v1` (default); базовый URL
    OpenAI-совместимого API; trailing-slash нормализуется.
  - `embedding.api_key_env` — `null` (default); **имя env-переменной** с ключом
    (никогда plaintext); **обязателен** для `openai`.
  - `embedding.dim` — `null` (default); размерность векторов; **обязателен** для
    `openai` (нативная dim модели, без Matryoshka-усечения); для `local`
    игнорируется (остаётся 384).
  - Приоритет: при `provider: local` и одновременно заданных `embedding.model`
    и `embedding_model` — приоритет у `embedding.model`. Для `openai` действует
    только `embedding.model`. Валидация блока: объект; `provider`/`model`/
    `base_url`/`api_key_env` — строки; `dim` — целое > 0; нарушение →
    `embedding_invalid` (память off). Отсутствие `process.env[api_key_env]` при
    `openai` → память off (`embedding_api_key_env_missing`).
- **`probe_cooldown_min`** — интервал в минутах между live-probe модели на
  старте (кэш результата в `state.json`), default `30`. Валидация: число > 0;
  иначе → `probe_cooldown_min_invalid` (память off).
- **`artifact_globs`** — allowlist-глобы артефактов (спеки/планы): пути из
  `write`/`edit` сессии, матчащие глобы, попадают в поле записи `artifacts[]`
  (v5.2, artifact-links). Default — маэстро-набор
  `["docs/superpowers/specs/**", "docs/superpowers/plans/**"]`; `[]` — явный
  off. Валидация: массив ≤16 непустых строк; иначе → `artifact_globs_invalid`
  (память off). После правки — OP-1 (перезапуск opencode).
- **`history_globs`** — allowlist-глобы для **git-history backfill**
  (`memory_reindex`, v3.5.0): repo-relative пути спек в git-истории —
  кандидаты на синтез записей. **Inherit-семантика:** `null`/absent →
  наследует `artifact_globs` (резолв на use-site, не в дефолтах); `[]` = off
  (кандидатов нет). Валидный массив: ≤16 непустых строк (trim + unique).
  **Невалидное** (non-array / не-строки / >16) → **soft fallback** на
  `artifact_globs` + однократный warn `memory:config_fallback` — память НЕ
  отключается, нового `disabled_reason` нет (в отличие от
  `artifact_globs_invalid`). После правки — OP-1 (перезапуск opencode).
- **`backup`** — бэкап/restore памяти (4.7.0; v1 — только sqlite; tool
  `memory_backup` + команда `@maestro-memory-backup`):
  - `backup.path` — каталог бэкапов, default `.maestro/memory/backup`
    (repo-relative, от git-корня; абсолютный допустим). Дефолт — под
    `.maestro/` (gitignored): бэкапы не коммитятся; коммит — только осознанно
    (override пути / gitignore-исключение) и **только в приватные репо**
    (C3). WARN при каждом бэкапе, пока каталог не gitignored.
  - `backup.retention` — сколько последних пар хранить, default `3`;
    `0` = без ограничений (off).
  - Невалидная секция (path — не строка; retention — не целое ≥ 0) →
    **soft fallback** на дефолты + warn `memory:config_fallback` — память
    НЕ отключается (как `history_globs`). После правки — OP-1.
- **Модель саммаризации (4.0.0, zero-key)** — ключа `summarizer_model`
  нет; резолв из opencode-конфига: `small_model` → `model` →
  `agent.maestro.model` → `agent.build.model`; sessions-путь — fallback
  на модель сессии, git-путь (`memory_reindex`) — guard при нерезолве
  (причины enum). Отдельно от И-1 allowlist провайдеров.
- **`identity` / `identity_env`** — подпись записей (`author`), **не
  access-control**. Источник: `identity_env` (env-переменная, per-machine) → git
  `user.name` → OS username. `identity` в `maestro.json` — только явный override
  (сервисный аккаунт). Не класть per-user значения в коммитимый `maestro.json`.
- **`namespace`** — переопределяет ключ памяти `key` (monorepo / связанные
  репозитории). Смена namespace = потеря доступа к старым записям.
- **`module_dir`** — каталог кода модуля; `null` → `<data-dir>/maestro/memory/module`.
- **`storage.type`** — `sqlite` (default, локальный) | `qdrant` | `pgvector`
  (централизованные). Централизованные требуют **резолвнутую identity** (иначе
  память off + лог) и `url`+`api_key_env` (qdrant) / `connection_string_env`
  (pgvector). API-ключ — только через ссылку на env, никогда plaintext.
  Решение «локально vs удалённо» — только `storage.type`.
- **`branch_context`** — branch-scoped recall (default `true`): членство записей
  по git-истории (тиры general/experience); `false` → flat project recall
  (дефолтный scope = `project`). Валидация: boolean; иначе — память off + лог
  (`branch_context_invalid`).
- **`mainline`** — основная ветка для промоции (default `null` → авто-детект из
  git: remote HEAD → `init.defaultBranch` → резерв `main`/`master`/`develop`).
  Явный override авторитетен; несуществующее имя → `mainline_unresolved`
  (branch-context flat + warn). Валидация: `null` или строка
  `/^[a-zA-Z0-9_\/.-]+$/`, длина ≤ 100; иначе — память off + лог
  (`mainline_invalid`). Gitflow-guidance: `memory.mainline: "develop"` (общий
  контекст = интегрированная разработка) или `"main"` (только выпущенная
  истина).
- **`storage.pgvector.text_search_config`** — Postgres text-search конфигурация
  для гибридного поиска, default `"russian"` (стеммер). Только при
  `type: pgvector`. Валидация: `/^[a-z][a-z0-9_]*$/`, ≤63 символа; на кастомных
  PG без `russian`-конфига — fail-loud.
- **`retention_days`** — TTL записей: `null` (default) — выключено (данные не
  удаляются молча); положительное число — prune при старте (записи старше N
  дней по `time_last`). Некорректное значение → память off + лог.
- **`delete_on_session_delete`** — удалять запись при `session.deleted`
  (default `false` — запись выживает, жизненный цикл по git-якорю v5).
  `true` возвращает v1-приватность; рекомендуется только для sqlite — на
  централизованных бэкендах удаление сессии сносит командное знание
  (init-warn `delete_on_session_delete_centralized`). Валидация: boolean; иначе
  — память off + лог (`delete_on_session_delete_invalid`).
- **`similarity_threshold`** — порог косинусной близости для кластеров тем и
  графа похожести (`memory_stats_detail` / отчёт), default `0.7`, диапазон
  `[0, 1]`; вне диапазона → память off + лог.
- **`report.include_text`** — `false` (default): HTML-отчёт `@maestro-memory-report`
  содержит **только агрегаты** (SEC-4b); `true` — осознанный opt-in на вставку
  замаскированных заголовков/summary (документированное понижение).
- **`report.preview`** — `true` (default): `@maestro-memory-report` сам запускает
  локальный preview-сервер (bind `127.0.0.1`, TTL 60 мин); `false` — только HTML-файл.
- **`namespace`** — обязателен при `enabled: true`; формат `a.b.c` (1–3 сегмента,
  lowercase, точка-разделитель); нормализация: trim + lowercase; absent/невалидный →
  память off (`namespace_missing` / `namespace_invalid`).
- **`related`** — список namespace-prefix целей для кросс-доменной интеграции
  (merged-only, предпочтение точный leaf 1:1, ≤16 записей).
- **`domain_recall`** — boolean, default `true`; `false` = off-switch домен-ног.
- **`memory_migrate`** (from: `auto` | `namespace` | `hash`) — инструмент миграции;
  permission ask перед запуском. Изменения memory — config-as-code (часть task-ветки)
  + opencode restart.

Правила вывода (для `/maestro-setup` и консультаций):

- Секция `memory` добавляется в `maestro.json` **только** если пользователь
  явно запросил память (per-project opt-in через `/maestro-setup`,
  `memory.enabled: true` в project-слое конфига).
  Без этого — секцию НЕ добавлять (никакого silent opt-in).
- При добавлении — минимальный канон `{ "enabled": true }` (все остальные ключи
  — дефолты); расширять только по запросу HITL (бэкенд, namespace, identity_env,
  модели, retention_days, report).
- `branch_context`/`mainline` — только по запросу HITL (branch-aware дефолты
  включены и без них); squash/rebase-heavy флоу → рекомендация
  `branch_context: false`.
- `identity_env` — имя env-переменной (напр. `MAESTRO_MEMORY_IDENTITY`), не
  значение; `identity` — только для сервисных аккаунтов.
- **I4 (restricted-пути и memory):** restricted-пути не добавляются в
  `memory.history_globs`/`memory.artifact_globs` — git-backfill-канал (файлы из
  git-истории → LLM-саммаризатор) не должен покрывать confidential-данные
  (SEC-5, принятый риск; митигация — allowlist).
- **Write/boundary-tools → permission `ask` (обязательное правило).** При
  включении памяти в merge-config (`.opencode/opencode.json` или global)
  добавляется нативное правило `permission: { memory_forget: "ask",
  memory_export: "ask", memory_import: "ask", memory_migrate: "ask",
  memory_prune: "ask", memory_reindex: "ask", memory_backup: "ask" }` (opencode
  default для новых тулов — allow, поэтому правило обязательно). Канон для
  будущих тулов: **новые write/boundary-tools → permission `ask`**.
- **Онбординг memory (явная последовательность):** после добавления секции
  `memory` в `maestro.json` — (1) рестарт opencode → плагин self-provision'ит
  `module_dir` (создаёт каталог + `package.json`); (2) `npm install` в
  `module_dir`; (3) рестарт №2 (активация; cached hard-fail → live re-probe при
  старте); (4) верификация — probe-лог (`memory: embedder probe OK`, отсутствие
  `memory: init failed`), `@maestro-memory`, блок «Контекст из памяти maestro»
  в system prompt. Полная инструкция — `manual_docs/how-to/enable-memory.md`.
  После правки `memory` — **OP-1** (перезапуск opencode).

### Ключ `communication` (простой язык)

- Значения: `"plain"` (дефолт — простой язык в диалогах) | `"professional"`
  (технический язык). Невалидное → плагин делает soft fallback в `plain`
  + warn в лог (`communication:config_fallback`).
- Область: только диалог с пользователем (все top-level primary-сессии);
  артефакты (спецы/планы/код/доки) и субагенты не затрагиваются. Флаг
  `@maestro-init --plain` — per-run, приоритетнее конфига (даже
  `professional`).
- **Процедура смены режима:** чтение `maestro.json` — плагин-тул
  `maestro_config` (arg `section: "communication"`; native ask), правка —
  `edit` (нативный ask → HITL-подтверждение), затем **обязательно сообщить о
  перезапуске opencode** (конфиг плагина читается один раз при init — без
  рестарта эффект не наступит). Объяснить последствия: дефолт `plain`,
  приоритет флага, область действия.

### Ключ `feedback_report` (режим отчёта ретроспективы)

- Значения: `"manual"` (дефолт — отчёт вручную `@maestro-feedback-report`;
  пайплайн на шаге 18.5 показывает однострочную подсказку) | `"auto"`
  (пайплайн автоматически собирает отчёт после шага 18, без HITL) |
  `"disable"` (отчёта нет, подсказки нет). Невалидное значение → soft
  fallback в `manual` + warn в лог плагина (`feedback_report:config_fallback`);
  в чате уведомление не выдаётся (как у `communication`).
- Область: только хук пайплайна (шаг 18.5; маршруты feature + bugfix, spike —
  не применяется). Прямой вызов `@maestro-feedback-report` — всегда
  интерактивен (HITL-фидбек), режим не влияет.
- **Механика:** плагин читает ключ при init и при явном non-manual инжектит
  строку-директиву `maestro.json → feedback_report: <mode>` в system-контекст
  top-level primary-сессии (паттерн ключа `communication`). Нет директивы →
  `manual` (безопасный дефолт: ключ отсутствует / `manual` / невалидное /
  старая версия плагина).
- **Процедура смены режима:** правка `maestro.json` (нативный ask →
  HITL-подтверждение) + **обязателен перезапуск opencode** (плагин читает
  конфиг при init — как `communication`).
- **`/maestro-setup` НЕ генерирует ключ и НЕ спрашивает про него** —
  отсутствие = `manual` (no-silent-opt-in, паттерн секции `memory`).

## Канон нативных permissions OpenCode (R6)

Второй слой защиты — **нативные permissions OpenCode** в merge-config
(`.opencode/opencode.json` или global `~/.config/opencode/opencode.json`). Канон
инline здесь (как и канон `maestro.json`), чтобы assistant мог генерировать/чинить
нативный слой последовательно. Идемпотентно: только добавлять, не перезаписывать.

### Семантика (ключевые отличия от плагина)

- **`*` пересекает `/`** (в отличие от сегментной `confGlobMatch` плагина):
  `docs/confidential/*` покрывает вложенные пути.
- **Last-match-wins:** порядок правил критичен — catch-all (`"*"`) **первым**,
  специфичные правила **после** (иначе catch-all перекроет deny).
- Нативный `edit` gates `write`/`edit`/`apply_patch`; `read` gates `read` — основной
  fail-closed барьер (не зависит от плагина).
- Нативный `ask` промптит пользователя напрямую (настоящий per-call HITL) — в
  отличие от плагинового паттерна «error → оркестратор решает».
- **`glob`/`grep` матчат аргумент-паттерн, не пути-результаты.** `glob` — по
  glob-паттерну, `grep` — по regex-аргументу. Deny-правило `docs/confidential/*`
  блокирует только прямое указание паттерна; широкие паттерны-обход
  (`glob("docs/**/*.md")`, `grep("secret","docs/")`) не блокируются. Это
  **best-effort слой**; основной fail-closed — `read`/`edit`.
- **Не вводить глобальный `"*": "ask"` для `bash`** — эскалирует каждый bash-вызов
  в per-call HITL (противоречит не-форсированию плагина). Только точечные deny.
- **Bash-паттерны по слову — запрещены** (напр. `*cat*confidential*`): они не
  защищают реальные restricted-пути (произвольные пути) и блокируют служебные
  команды (агрегация аудит-лога). Защита bash от секретов — через `read`/`edit`
  deny по реальным путям + санитайзер промптов; bash — best-effort слой.

- **Чтение параметров `maestro.json`** — только через плагин-тул `maestro_config`
  (native `ask`, только top-level primary-сессии; сабагенты — per-agent deny, см.
  Per-agent exceptions). Чтение через `read`/`glob`/`grep` и bash
  (`cat`/`sed`/`node -e`/иные) — запрещено. Исключение: existence-only
  `test -f maestro.json` (1 бит, без раскрытия параметров). Тул недоступен
  (плагин не загружен / устарел) — конфиг не читается: сообщение
  «перезапустите opencode / обновите плагин»; bash-fallback запрещён.

### Глобальные deny (R1+R4) — эталон конфигурации init

Генерируется `/maestro-setup`; assistant поддерживает/чинит:

```json
{
  "permission": {
    "read": { "*": "allow", "maestro.json": "deny", ".maestro/**": "deny", ".maestro/plugin-version": "allow", "docs/confidential/*": "deny", "*.env": "deny", "*.env.*": "deny", "*.env.example": "allow", "*.pem": "deny", "*.key": "deny", "*.crt": "deny", "*.p12": "deny", "*.pfx": "deny" },
    "edit": { "*": "allow", "maestro.json": "ask", "docs/confidential/*": "deny", "*.env": "deny", "*.env.*": "deny", "*.env.example": "allow", "*.pem": "deny", "*.key": "deny", "*.crt": "deny", "*.p12": "deny", "*.pfx": "deny" },
    "bash": { "*": "allow" },
    "glob": { "*": "allow", "maestro.json": "deny", ".maestro/**": "deny", "docs/confidential/*": "deny" },
    "grep": { "*": "allow", "maestro.json": "deny", ".maestro/**": "deny", "docs/confidential/*": "deny" },
    "maestro_config": "ask"
  }
}
```

### Per-agent exceptions

- **Механика тулов** — нативные per-agent permissions (`agent.<name>.permission` или
  frontmatter `permission:`): `edit`/`bash`/`task`/`webfetch` per роль (канон в
  `manual_docs/reference/config.md`, «Агенты: модели»).
- **Trusted-исключения по данным** (allow-внутри-deny для role-set `custodian`/
  `sanitizer` к restricted-путям, напр. `docs/confidential/*`): per-agent
  `read`/`glob`/`grep` allow поверх глобального deny (agent rules take precedence —
  V1, верифицирован 2026-09-20). Двухканально:
  - **frontmatter** агентов `agents/custodian.md`, `agents/sanitizer.md` (доставляются
    как часть скилла) — `permission.read/glob/grep: {"docs/confidential/*": "allow"}`;
  - **merge-config** — init пишет эквивалент в `agent.<name>.permission`.
  **Файловый доступ = нативный конфиг** (source of truth); плагинный enforcement
  поверх — только legacy-режим (dual mode, пока секция `confidential` есть в
  `maestro.json`). Файловый доступ кастомных агентов (вне role-set) — нативный
  per-agent allow по запросу HITL, не trust.

- **`maestro_config`:** per-agent `deny` для **всех** сабагентов (untrusted и
  trusted) — тул доступен только в top-level primary-сессиях (native ask +
  плагинный fail-closed guard).

### Правила вывода

- **Единый источник restricted-путей (new-режим, 6.4.0):** нативные
  `permission.read`/`edit`/`glob`/`grep` deny (merge-config/global) — **source of
  truth**; плагинная директива `restricted-data paths: …` (из нативного конфига при
  init) и строка-зеркало §12 (`docs/project-context.md`, формат M2) — **производные**:
  строку §12 пишет ассистент **одной операцией** с нативными deny (воркфлоу «Настройка
  restricted-путей»). Дрейф недопустим; детектируется warn'ом плагина
  `confidential:drift` при init и при консультации (шаг 2 воркфлоу «Настройка
  конфигурации»). Legacy (dual mode): до миграции `maestro.json → confidential.paths`
  остаётся процессным источником плагинного enforcement; нативные deny + строка §12
  пишутся наравне в шаге 1 миграции.
- **Не добавлять** `docs/superpowers/{specs,plans}/*` в deny (двухролевые).
- **Policies (P4, R5):** `experimental.policies` (`provider.use`) — глобальный
  deny/allow провайдеров; global приоритетнее project; не перезаписывать.
  **Кросс-проверка (I1):** allowlist провайдеров должен ⊇ провайдеров всех
  выбранных `agent.*.model` (иначе deny ломает агента); policies глобальны — не
  выражают «trusted — локальные, untrusted — внешние».

- **P4-check (гигиена моделей, безусловный role-based):** после выбора/
  актуализации моделей (`agent.*.model`) — если модель trusted-агента role-set
  (`custodian`/`sanitizer` — trusted **по роли**, всегда, без условия на конфиг)
  совпадает с моделью любого untrusted-агента (`haiku`/`sonnet`/`opus`/`fable`/
  `reviewer`, кастомные) → **неблокирующее предупреждение** в сводке: «P4:
  trusted-агент <имя> на той же модели, что untrusted <имя(а)>; рекомендуется
  изолированная/локальная модель (SECURITY.md P4)». Предупреждение не останавливает
  поток. (6.4.0: условие «если `trust.custodian` включены» убрано — role-set не
  конфигурируется, P4-предупреждения не теряются.)
- **OP-1:** после правки native-permission конфига — рестарт opencode.
- **OP-4:** ослабление security-слоя (deny→allow в нативном конфиге) — адресный
  diff + явное HITL-подтверждение.

## Операционные гарантии (OP)

- **OP-1 — перезапуск после правки `maestro.json`:** после записи любых изменений
  `maestro.json` сообщить HITL: «изменения вступят в силу после перезапуска opencode»
  (плагин читает конфиг один раз при старте). Предложить рестарт/отложить. Критично для
  `sanitizer_whitelist`/`communication`/`feedback_report`/`memory`; в legacy-режиме
  (секция `confidential` есть) — также для `confidential`.
- **OP-4 — адресный diff + HITL для ослабления security-слоёв:** при правке
  `sanitizer_whitelist.rules→false` (отключение защиты) — показать адресный diff (стало vs было) и получить явное HITL-подтверждение,
  как для снятия restricted-пути с защиты (воркфлоу «Настройка restricted-путей»).
- **OP-7 — граница «схема vs наполнение» project-context:** схема 14 категорий — канон в
  `init-context.md` (не менять); assistant правит только **наполнение** (актуализацию §3/§5/§12/§14).
- **OP-3 — канон inline:** канон `maestro.json` хранится inline в этом SKILL.md; держать
  синхронно с правилами парсинга плагина (конвенцией + docs-drift D-проверка: inline-канон
  не несёт `confidential`/`trust`).

## Консультационные воркфлоу

### 1. Объяснение правил (read-only)

Пользователь спрашивает «как работает X» (restricted-данные/нативные permissions,
role-trust, sanitizer, 14 категорий, структура). Ответить на основе канона выше +
краткая сводка. Не менять файлы.

### 2. Настройка конфигурации (правка)

1. Прочитать текущий артефакт (`maestro.json` — плагин-тул `maestro_config`
   (native ask; `read` нативно denied, bash-чтение запрещено правилом R6);
   `.opencode/opencode.json` / `project-context.md`). Тул недоступен — конфиг
   не читать: «перезапустите opencode / обновите плагин».
2. **Детектор дрейфа:** сверить нативные deny (read/edit/glob/grep) в
   `.opencode/opencode.json` со строкой-зеркалом §12 (`**Confidential-данные:** …`)
   в `docs/project-context.md` (источник — нативный конфиг; §12 — документация).
   При расхождении — предупредить «нативные deny и §12 расходятся — перегенерирую»
   (включается в HITL-гейт шага 4). Плагин дублирует сверку warn'ом
   `confidential:drift` при init.
3. Сформировать diff-merge (идемпотентно, сохраняя пользовательские правки).
4. **HITL-гейт:** «(a) approve — (b) правки — (c) отмена» + показ diff-merge.
5. Для снятия restricted-пути с защиты / `sanitizer_whitelist.rules→false` —
   адресный diff + явное HITL-подтверждение (OP-4; снятие — только по явному
   запросу, см. «Настройка restricted-путей»).
6. **Изменение restricted-путей — воркфлоу «Настройка restricted-путей»**
   (одна операция: нативные deny + per-agent allow + строка §12).
7. Записать. **OP-1:** сообщить о необходимости перезапуска opencode.

### 3. Актуализация project-context (наполнение)

Править **наполнение** секций (не схему). Секция 14 Commands — как в каноне `init-context.md`
(явная команда / `auto` / `none`). Строка §12 `**Confidential-данные:** …` (формат M2)
ведётся **только** воркфлоу «Настройка restricted-путей» (одной операцией с нативными
deny), свободной правкой не менять. После правки — HITL-гейт approve/правки/отмена.

### 4. Организация структуры каталогов

Проверить/создать (идемпотентно): `.maestro/`, `docs/superpowers/{specs,plans}/`,
`docs/confidential/`, `regression/{entries,released}/`. `.gitignore` — `.maestro/`
и `.opencode/` целиком (эфемерное/доставляемое); конфиг проекта — только
`maestro.json` в корне, не в `.maestro/`.

### 5. Настройка restricted-путей (6.4.0)

Изменение набора restricted-путей (добавление/расширение/снятие) — **одна
операция** пишет обе части (source of truth + зеркало):

1. Прочитать нативный конфиг (`.opencode/opencode.json` / global) и строку §12.
2. **Одним diff-merge** (идемпотентно) записать:
   - **(a)** нативные deny `read`/`edit`/`glob`/`grep` в merge-config
     (`.opencode/opencode.json`) по каждому пути + per-agent allow `custodian`/
     `sanitizer` (read/glob/grep) на те же пути (agent rules take precedence);
   - **(b)** строку §12 в `docs/project-context.md` (канонический формат M2:
     `- **Confidential-данные:** p1, p2` — одна строка, repo-relative пути, через
     запятую; пути — зеркалируют нативные deny-паттерны read).
   - Канон-строка I4: restricted-пути не добавляются в
     `memory.history_globs`/`memory.artifact_globs`.
3. **HITL-гейт** с diff: «(a) approve — (b) правки — (c) отмена».
4. Записать. **OP-1:** рестарт opencode (плагин перечитывает нативный конфиг при
   init и сверяет §12 warn'ом `confidential:drift`).
5. **Сверка нативных deny ↔ §12** (детектор дрейфа): после записи и при каждой
   консультации (шаг 2 воркфлоу «Настройка конфигурации») — расхождение
   недопустимо, перегенерация одной операцией.

**Снятие с защиты (удаление/ослабление пути) — жёсткий блок по умолчанию**
(аналог IMP-3, для нативных правил):

- Не инициировать/не выполнять снятие сам — только по явному запросу HITL.
- (а) адресный diff «путь X исключается из нативных deny: данные станут
  доступны primary/untrusted» (+ удаление пути из строки §12); (б) явное
  **отдельное** approve HITL (OP-4).
- **Merge — только консервативное дополнение:** при повторном прогоне только
  добавлять пути, не удалять/изменять существующие без явного HITL-гейта.
- **Адресный показ:** при любом изменении — отдельный diff (стало vs было).

### 6. Миграция legacy → new (6.4.0, I2 — зафиксированный порядок)

Проект в legacy-режиме (секция `confidential` есть в `maestro.json`, warn
`confidential:legacy_active`) мигрируется в new-режим **только в этом порядке**
(нарушение порядка = окно без файловой защиты; warn `confidential:drift` —
детектор нарушенного порядка):

- **Шаг 0 — предпроверка trust (ДО обновления плагина, N1):** если в
  `maestro.json` есть `trust.<custom>` (кастомные агенты) — уведомить: с
  6.4.0 секция `trust` не читается **в любом режиме** — кастомные агенты
  **немедленно** теряют плагинный файловый доступ (fail-closed). При
  необходимости — сначала добавить нативный per-agent allow (отдельное
  HITL-решение, воркфлоу «Настройка restricted-путей»).
- **(1)** Одна операция (HITL-гейт с diff): нативные deny `read`/`edit`/
  `glob`/`grep` + per-agent allow `custodian`/`sanitizer` на **все** пути из
  legacy `confidential.paths` + строка §12 (формат M2) — по воркфлоу «Настройка
  restricted-путей».
- **(2)** Restart + **live-проверка нативного deny:** primary — нативный
  permission error при чтении restricted-пути; `custodian`/`sanitizer` — чтение
  работает (per-agent allow).
- **(3) Только затем** — удалить секцию `confidential` из `maestro.json`
  (адресный diff + **отдельное** HITL-подтверждение). **Предпроверка удаления:
  нативные deny на все пути §12** (иначе — окно без файловой защиты, fail-open).
- **(4)** Restart + проверка new-режима: в system-контексте top-level
  primary-сессии — директива `restricted-data paths: …`; warn'ов
  `confidential:legacy_active` нет; плагин не бросает `[confidential:deny]`
  (deny приходят нативно).

## Обработка сбоев

| Ситуация | Действие |
|---|---|
| Запрос требует реализации кода/spec/плана | Редирект: `@maestro-init` / `/maestro-design` / `@regression` (MIN-4) |
| Запрос на работу с restricted-путями | Отказ: доступ закрыт для primary (new-режим: нативный deny; legacy: плагинный deny); через trusted-агент (role-set `custodian`/`sanitizer`) |
| Плагин не загружен | Работаем: файловый барьер — нативный (не зависит от плагина); U1-маскирование/директива/shadow-аудит — выключены до перезапуска (OP-1) |
| `maestro.json` правился | Сообщить о перезапуске (OP-1) |
| Нативные deny ↔ строка §12 расходятся | Warn + перегенерация одной операцией (воркфлоу «Настройка restricted-путей»; плагин дублирует warn'ом `confidential:drift`) |
