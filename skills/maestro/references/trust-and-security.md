# Trust Model, Context Sanitizer и Security Review (глава)

> Канон: trust-and-security. Грузится из `skills/maestro/SKILL.md` на security-точки: шаги 8.6, 9, 16; trusted/untrusted-диспатчи.
> Читается оркестратором (имеющим SKILL.md в контексте); внутри главы
> допускаются ссылки «см. SKILL.md, <секция скелета>» и на другие главы.

## Trust Model

Два **независимых** контура защиты, не смешивать:

1. **Файловый доступ** — только **нативные permissions OpenCode**
   (`.opencode/opencode.json` или global): для restricted-путей
   (напр. `docs/confidential/**`) deny `read`/`edit`/`glob`/`grep` +
   per-agent allow `custodian`/`sanitizer` (agent rules имеют приоритет
   над top-level deny). **Fail-closed в ядре**: барьер не зависит от
   плагина `maestro-bootstrap` (см. `SECURITY.md` → P1, P5).
2. **Ур.1 маскирование промптов** (Context Sanitizer) — **по роли**:
   trusted role-set захардкожен в плагине — `{custodian`, `sanitizer}`;
   все остальные сабагенты (стандартные и кастомные) — untrusted:
   промпт санируется перед диспатчем.

Оркестратор работает в primary-сессии дефолтной модели — **НЕ доверен**
на обоих контурах: файловый доступ к restricted-путям закрывают
нативные permissions, Ур.1-маскирование применяется ко всем диспатчам
вне role-set. Любой сабагент — отдельный инференс/сессия; данные
покидают контекст оркестратора. Поэтому **по умолчанию все сабагенты
untrusted** (для Ур.1).

### Dual mode (legacy/new)

С 6.4.0 плагин работает в **dual mode** (D5):

- **Legacy-режим** — секция `confidential` **есть** в `maestro.json`
  (объект): legacy-enforcement плагина активен, как раньше —
  `[confidential:deny]` на доступ к confidential-путям
  (`confidential.paths` + built-in-секреты + активный конфиг), trusted —
  role-set. Init-warn `confidential:legacy_active`.
- **New-режим** — секции **нет**: плагин файлы не гейтит (нет
  `[confidential:deny]`, нет built-in-гейта, нет P6-контура) — барьер
  только нативные permissions. Плагин ведёт shadow-аудит (observability,
  ниже).

Секция `trust` не читается в обоих режимах (role-set). Legacy-код
отмирает в будущем релизе («retire legacy enforcement»); миграция —
`/maestro-assistant` (воркфлоу «Миграция legacy → new»).

### Shadow-аудит (observability)

В new-режиме плагин логирует **попытки** доступа к derived
restricted-набору (из нативных конфигов): `confidential.access` с полями
tool, sessionID, agent, target, `action: allow|deny|unknown`. Это
**best-effort зеркало, не ground truth**: per-agent allow берётся только
из JSON-конфигов (frontmatter агентов не учитывается); нерезолвимо —
`unknown`. Target — `basename` (полный путь в лог не пишется — SEC-4b).
Аудит ничего не блокирует — барьер нативный.

### Недоступность модели trusted-агента (P3, см. `SECURITY.md`)

При недоступности/ошибке модели trusted-агента (`custodian`/`sanitizer`):

- **Запрещено** подставлять другой `subagent_type` или модель для продолжения
  работы с конфиденциальным контекстом.
- Допустимы ТОЛЬКО:
  - (a) HITL с пояснением статуса и вариантами,
  - (b) ретрай той же пары `(subagent_type, задача)` (бюджет повторов 3 — для проверки доступности модели; отдельно от лимита 1 на пустой/бессодержательный результат в anti-loop),
  - (c) стоп.
- Автоматического fallback на не-trusted агента/модель не существует и **не
  допускается**.

### Trust levels

| Уровень | Описание | Контроль |
|---|---|---|
| **trusted** | Role-set `{custodian`, `sanitizer}` (hardcoded в плагине; секция `trust` в `maestro.json` не читается) | **Skip** sanitize промпта — данные передаются как есть; файл-доступ — по нативным permissions opencode (per-agent allow) |
| **untrusted** | Все остальные сабагенты (стандартные и кастомные), по умолчанию | Перед диспатчем — Security Review (sanitizer); во время работы — нативный permission-слой opencode |

«Non-functional mode» P4a (custodian/sanitizer untrusted) **недостижим**
с 6.4.0: доверие — по роли, не по ключу конфига (D6, вариант B) —
состояния, в котором `custodian`/`sanitizer` non-functional из-за
недоверия, не существует.

### Subagent Trust Matrix

| Сабагент | Trust для Ур.1 | Примечание |
|---|---|---|
| `haiku` | untrusted | |
| `sonnet` | untrusted | |
| `opus` | untrusted | Spec review + правки на Revise. **Всегда untrusted — исключений нет**: ключи `trust.opus` и др. не читаются (секция удалена), Ур.1-маскирование и гарантия «opus не видит confidential» сохраняются. Файл-доступ — по нативным permissions. |
| `reviewer` | untrusted | |
| `fable` | untrusted | |
| `custodian` | **trusted** (по роли) | Q/A-брокер по confidential (шаг 8): читает confidential-источники, отвечает primary агрегатами (тип/ограничение/чувствительность/связь) БЕЗ raw-значений. Его промпт при диспатче не санизируется. Файл-доступ к confidential-путям — нативный per-agent allow. |
| `sanitizer` | **trusted** (по роли) | Security review: единственный, кому разрешено видеть сырые данные (чтобы пометить). Его промпт при диспатче не санизируется — рекурсии нет. |

Значение по умолчанию для любого сабагента — **untrusted** (для Ур.1),
кроме role-set `custodian`/`sanitizer` (trusted по своей роли). Доверие
**не меняется через конфиг**: любой ключ `trust.*` в `maestro.json`
(штатные имена и кастомные — без различия) → warn `trust:deprecated_key`
(однократно при init, со списком проигнорированных ключей) + игнор
значения. От модели в merge-конфиге (`.opencode/opencode.json` или
global) trust не зависит.

**Принятое ограничение (D6):** кастомный агент не может быть освобождён
от маскирования промпта; обходные пути — `sanitizer_whitelist.by_agent`
(выключение правил на агента, OP-4 HITL) для ложных срабатываний и
`allow_values` для известных значений. Файловый доступ кастомного агента
не привязан к Ур.1 — только нативный per-agent allow.

**Legacy-note (N1):** с обновления плагина 6.4.0 секция `trust` не
читается **в любом режиме** — кастомные trusted-агенты **немедленно**
теряют плагинный файловый доступ (направление fail-closed — утечки
нет). При необходимости — нативный per-agent allow (HITL).

### Управление: нативный конфиг (role-set не конфигурируется)

С 6.4.0 секция `trust` **убрана из схемы** `maestro.json` (не читается),
`confidential` — только legacy-режим (dual mode, D5). Файловый доступ к
restricted-путям настраивается в **нативном конфиге OpenCode**
(merge-config `.opencode/opencode.json` или global) — deny
`read`/`edit`/`glob`/`grep` + per-agent allow `custodian`/`sanitizer`:

```json
{
  "permission": {
    "read": { "*": "allow", "docs/confidential/**": "deny" },
    "edit": { "*": "allow", "docs/confidential/**": "deny" },
    "glob": { "*": "allow", "docs/confidential/**": "deny" },
    "grep": { "*": "allow", "docs/confidential/**": "deny" }
  },
  "agent": {
    "custodian": { "permission": { "read": { "docs/confidential/**": "allow" } } },
    "sanitizer": { "permission": { "read": { "docs/confidential/**": "allow" } } }
  }
}
```

- **Deny-тулы** на restricted-пути: `read`/`edit`/`glob`/`grep`;
  **per-agent allow** — `custodian`/`sanitizer` (agent rules имеют
  приоритет над top-level deny).
- `maestro.json` сохраняет остальные секции (`sanitizer_whitelist`,
  `memory`, `review`, `merge_guard`, …) и остаётся единственным
  источником конфига плагина; секция `trust` — warn + игнор.
- Изменения нативного конфига вступают в силу со следующего перезапуска
  opencode.

**Как применять:**

1. **Ур.1 (маскирование промпта) — по роли:** `custodian`/`sanitizer` →
   промпт не санируется; любой другой сабагент (вкл. `opus` и
   кастомные) — sanitize перед диспатчем. Читать `maestro.json` для
   этого не нужно — role-set захардкожен в плагине.
2. **Файловый доступ — нативный конфиг:** решение принимает ядро
   OpenCode по permissions `.opencode/opencode.json`/global; в
   new-режиме плагин файлы не гейтит (в legacy-режиме —
   `[confidential:deny]`, как раньше).
3. Warn `confidential:drift` в логе плагина (строка-зеркало §12
   `**Confidential-данные:** …` в `docs/project-context.md` расходится с
   фактическим набором) — сообщить пользователю, исправить через
   `/maestro-assistant` (детектор миграционного окна).
4. Warn `confidential:legacy_active` — проект не мигрирован
   (legacy-режим); миграционный воркфлоу — `/maestro-assistant`.

---

## Context Sanitizer (правила детекта)

Правила детекта чувствительных данных — основа для пометок (сабагент
`sanitizer`) и маскирования (плагин `maestro-sanitizer`, Этап 2). Сама
процедура security review описана в секции [Security Review](#security-review)
ниже — два уровня (плагин + сабагент), HITL-гейт.

### Что фильтруется

1. **Secrets из окружения:** переменные (case-insensitive: `API_KEY`,
   `apiKey`, `api_key`) с keywords `SECRET`, `KEY`, `TOKEN`, `PASSWORD`,
   `CREDENTIAL`, `PASS`, `AUTH`, `DSN`, `CERT`, `SALT`, `SIGNATURE`, `NONCE`
   — заменяются на `<redacted:env.NAME>`.
2. **Чувствительные поля данных:** в примерах данных, JSON-samples,
   test fixtures — финансовые (`amount`, `salary`, `iban`, `card_number`,
   `cvv`, `vat`, `total_amount`, `balance`, `account_number` и т.д.) и PII
   (`phone`, `email`, `inn`, `snils`, `passport`, `birth_date` и т.д.) поля
   заменяются на `<redacted>`. Детект **регистронезависим** (`Amount`,
   `AMOUNT`); суффиксы (`amountValue`, `amount_value`) и camelCase-варианты
   snake-полей (`cardNumber`) покрываются автоматически. Список расширяем
   через `extra_fields` в секции `sanitizer_whitelist` файла `maestro.json`.
3. **Файлы .env / .env.\*:** если упоминаются в контексте — заменяются
   на `<redacted:.env file>`.
4. **SFTP/DB credentials:** строки вида `sftp://...`, `postgresql://...`,
   `mysql://...`, `ssh://...`, `ldap://...`, `clickhouse://...` с встроенными
   credentials, а также connection-string params `password=...`, `pwd=...`
   — заменяются на `<redacted:connection>`. Детект регистронезависим
   (`POSTGRES://`). Схемы расширяемы через `extra_uri_schemes`.
5. **Private keys:** PEM-блоки `-----BEGIN ... PRIVATE KEY-----`
   (регистронезависимо) — заменяются на `<redacted>`.
6. **Auth headers:** `Authorization: Bearer ...`, `X-API-Key: ...` —
   заменяются на `<redacted>`.
7. **Raw ledger entries:** если контекст содержит неанонимизированные
   проводки — применяется маскинг полей из п.2.

### Ограничения детекта (regex-Ур.1)

- Multi-line/heredoc значения (`API_KEY=\nsecret`) не покрываются (I7).
- CamelCase-префиксы базовых полей без явной записи (например, `netAmount`
  для поля `amount`) — частично: покрываются только явные префиксные варианты
  (`total_amount`, `net_amount`, `gross_amount`); остальное ловит Ур.2.
- Короткие поля (`pan`, `inn`, `ssn`) маскируются только на границах слова —
  снижает false positives (`company`, `japan` не маскируются).
- Подход: **false positives > false negatives** — лишняя маскировка безопаснее
  пропуска; подавляется через `patterns` в whitelist.
- Entropy-детект (неизвестные форматы токенов) не реализован намеренно —
  ловит Ур.2 (LLM).

### Что НЕ фильтруется

- Агрегированные данные (итоги, суммы отчётов) — не содержат деталей проводок
- Схемы БД без данных (Prisma schema, DTO без инстансов)
- Код и конфиги (кроме `.env`)
- Имена таблиц/колонок (метаданные, не данные)

### Когда применяется

На всех шагах, где происходит диспатч untrusted сабагента.
Trust-уровень определяется **по роли** (см. § Trust Model):

| Шаг | Сабагент | Security Review |
|---|---|---|
| Шаг 8 — Custodian Q/A | `custodian` | **Skip** (trusted — видит полный контекст для агрегации по confidential) |
| Шаг 9 — Spec Review | `opus` | Применяется (untrusted) |
| Шаг 13 — SDD implementer | `haiku` / `sonnet` | Применяется (untrusted) |
| Шаг 13 — SDD task-reviewer | `sonnet` | Применяется (untrusted) |
| Шаг 16 — Artifact Review | `reviewer` | Применяется (untrusted) |
| (внутри Security Review) | `sanitizer` | **Skip** (trusted — видит сырые данные для пометок) |

Если сабагент входит в role-set (`custodian`/`sanitizer`) — sanitize
промпта **не проводится** (trusted по роли, не конфигурируется).

### Правила применения

1. Уровень 1 (плагин, Этап 2) — авто-маскирование, **без HITL**
2. Уровень 2 (сабагент `sanitizer`) — пометки, при находке → HITL
   (Трактовка Y, см. § Security Review)
3. Оригинальный контекст оркестратора **не изменяется** — санитайзер
   создаёт копию промпта для untrusted сабагента
4. Аудит-лог: плагин пишет события sanitizer в общий лог
   `.maestro/logs/maestro-bootstrap-<date>.log` с маркером `sanitizer.redacted`
   (что замаскировано, без содержимого):
   - timestamp
   - сабагент / sessionID
   - что замаскировано (без содержимого)

---

## Security Review

Двухуровневая защита чувствительных данных перед диспатчем в untrusted сабагенты
+ нативный permission-слой opencode во время работы. Цель: субагенты не должны
получить чувствительные данные; минимум данных доходит даже до trusted-модели
sanitizer.

### Архитектура

```
Диспатч в сабагента:
  trust check (роль: role-set {custodian, sanitizer})
    │
    ├── trusted → SKIP sanitize → диспатч как есть (файл-доступ — по нативным permissions)
    │
    └── untrusted →
         [УРОВЕНЬ 1] maestro-sanitizer (плагин, Этап 2) ── авто, БЕЗ HITL
            regex-детект + маскирование по правилам Context Sanitizer
            нет находок → промпт уходит
            ▼
         [УРОВЕНЬ 2] сабагент sanitizer (trusted, read-only) ── всегда, доп. слой
            находит и ПОМЕЧАЕТ чувствительные данные (не вычищает)
            пометки есть → HITL до clean:
            ▼
         [HITL] (a) вычистить и продолжить / (b) продолжить как есть (принять риск) / (c) стоп
            │
         [FILE ACCESS] — файл-доступ: нативный permission-слой opencode
            (read/glob/grep deny без HITL; edit-ask — прямой промпт пользователя)
```

### Точки встраивания в pipeline

- **Точка 1 — Spec security review:** после шага 8 (spec), до шага 9 (Spec
  Review) и планирования. Сабагент `sanitizer` проверяет spec на чувствительные
  данные. Только для фич, где есть spec (сложные/архитектурные). **Перезапуск
  на каждый Revise-цикл** (шаг 10 → Revise → шаг 8 → повторный прогон sanitizer).
  В fast-track (шаг 7d) для всех 7d-входов выполняется всегда, кроме явного
  HITL-заверения доверия к источнику при валидной (не stale) sanitize-подписи
  (`status: CLEAN`); после прогона оркестратор штампует подпись
  `<!-- maestro:sanitize -->` (см. `references/spec-review.md`).
- **Точка 2 — Перед диспатчем untrusted:** перед каждой отправкой промпта в
  untrusted субагентов (шаги 9/13/16). Выполняется всегда. Trusted сабагенты
  пропускают (skip sanitize).

### Роль сабагента sanitizer

- Trusted (видит сырые данные), read-only (`edit: deny`, `bash: deny`),
  `task: deny`.
- **Помечает** чувствительные данные (где, что, почему) — не вычищает.
- **Оркестратор вычищает** промпт по пометкам (если пользователь выбрал (a)).
- Формат выхода — structured-блок `SANITIZER FINDINGS` (см. `agents/sanitizer.md`):
  `location / type / reason / snippet_hint` + `STATUS: CLEAN | FINDINGS_FOUND`.

### HITL-гейт при находке (Трактовка Y)

При `STATUS: FINDINGS_FOUND` оркестратор показывает находки пользователю и
запрашивает решение **до** clean:

- `(a) вычистить и продолжить` — оркестратор вычищает по пометкам, диспатчит
  очищенный промпт.
- `(b) продолжить как есть (принять риск)` — диспатч с sensitive-данными; явное
  решение пользователя.
- `(c) стоп` — остановить процесс.

В сообщении гейта — строка о потоке данных (информационно, не решение):
«Спека содержит N чувствительных фрагментов; после гейта текст уйдёт
untrusted-сабагентам (модель <модель>) в замаскированном виде (Ур.1)».

Утечка sensitive в untrusted возможна только по выбору (b).

### Когда запускать Уровень 2 (sanitizer-сабагент)

- **По умолчанию — всегда** (на каждом untrusted-диспатче + на spec review).
- Опция (env/конфиг `MAESTRO_SANITIZER_MODE=hybrid`) переключает на гибрид:
  spec review всегда + диспатч только если Уровень 1 что-то нашёл или недоступен.
- **Исключение — обычные opus-циклы Revise (OQ-2, шаг 10b):** Ур.2-сабагент
  НЕ запускается (полный 8.6 не выполняется). Полный формат пометок
  `location: <секция/строка>` используется ТОЛЬКО в случаях вовлечения
  trusted-контура (полный 8.6). На opus-циклах защита — Ур.1 (Слой 5 при
  применении правки) + маскирование входа opus (Слой 2). Вопрос «полный vs
  diff» снимается: на opus-циклах прогона sanitizer нет.

### Файл-доступ (нативный permission-слой opencode)

Файл-доступ сабагентов и primary-сессии регулируется **нативным
permission-слоем opencode** (`.opencode/opencode.json` или global) — в
new-режиме это **единственный барьер** (fail-closed в ядре, не зависит
от плагина): доступ к restricted-путям (напр. `docs/confidential/**`) —
deny `read`/`edit`/`glob`/`grep` + per-agent allow `custodian`/
`sanitizer`; `read`/`glob`/`grep` deny `maestro.json`/`.maestro/**`,
`read`-allow `.maestro/plugin-version`, `edit`-ask `maestro.json` — см.
канон нативных permissions в `maestro-assistant`. В legacy-режиме
(секция `confidential` есть) плагин дополнительно исполняет
`[confidential:deny]`, как раньше (dual mode, D5). В new-режиме плагин
`maestro-bootstrap` file-тулы не перехватывает — только shadow-аудит
(observability).

### Этапность

- **Этап 1 (сделан):** сабагент `sanitizer` (Уровень 2) + HITL-гейт + правила.
  Sanitizer там **primary**.
- **Этап 2 (сделан):** в плагине `maestro-bootstrap` реализованы Уровень 1
  (авто-маскирование промптов task) + whitelist. Сабагент остаётся доп. слоем
  (Уровень 2).

### Known gaps Этапа 1 (закрыты на Этапе 2)

- **Принцип «минимум данных до trusted sanitizer»** — закрыт: Уровень 1 (плагин)
  маскирует промпт до sanitizer-сабагента.
- **Этап 1 модель-зависим** — закрыт: плагин санизирует промпт автоматически
  при каждом task-диспатче.
