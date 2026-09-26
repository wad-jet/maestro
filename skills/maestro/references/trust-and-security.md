# Trust Model, Context Sanitizer и Security Review (глава)

> Канон: trust-and-security. Грузится из `skills/maestro/SKILL.md` на security-точки: шаги 8.6, 9, 16; trusted/untrusted-диспатчи.
> Читается оркестратором (имеющим SKILL.md в контексте); внутри главы
> допускаются ссылки «см. SKILL.md, <секция скелета>» и на другие главы.

## Trust Model

Оркестратор работает в primary-сессии дефолтной модели — **НЕ доверен**:
доступ к `confidential/**` для него закрыт (плагин deny'ит root/primary,
инвариант конфига; см. `SECURITY.md` → P1).
Любой сабагент — отдельный инференс/сессия; данные покидают контекст
оркестратора. Поэтому **по умолчанию все сабагенты untrusted**.

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
| **trusted** | Указан в `maestro.json` со значением `true` | **Skip** sanitize промпта — данные передаются как есть; файл-доступ — по нативным permissions opencode |
| **untrusted** | Не указан в `maestro.json` или значение ≠ `true` | Перед диспатчем — Security Review (sanitizer); во время работы — нативный permission-слой opencode |

### Subagent Trust Matrix

| Сабагент | Trust по умолчанию | Примечание |
|---|---|---|
| `haiku` | untrusted | |
| `sonnet` | untrusted | |
| `opus` | untrusted | Spec review + правки на Revise. **Если указан trusted (`trust.opus: true`)** — Слои 2 (маскирование промпта) и 3-5 (confidential-deny / нативный permission-слой / Ур.1) для него НЕ действуют: opus получает промпт как есть и доступ к файлам по конфигу; гарантия «opus не видит confidential» снимается. Это осознанное решение конфигурации (пользователь расширил доверие). Рекомендация — не помечать opus trusted; при необходимости фиксировать с пониманием последствий. |
| `code-reviewer` | untrusted | |
| `fable` | untrusted | |
| `custodian` | **trusted** | Q/A-брокер по confidential (шаг 8): читает confidential-источники, отвечает primary агрегатами (тип/ограничение/чувствительность/связь) БЕЗ raw-значений. Его промпт при диспатче не санизируется. Если `trust: false`/absent — агент **non-functional** (confidential deny + sanitize промпта); не fallback, а блокировка роли. |
| `sanitizer` | **trusted** | Security review: единственный, кому разрешено видеть сырые данные (чтобы пометить). Его промпт при диспатче не санизируется — рекурсии нет. Если `trust: false`/absent — агент **non-functional** (рекурсия: промпт санизируется до него); не fallback. |

Значение по умолчанию для любого сабагента — **untrusted**, кроме `custodian` и
`sanitizer` (trusted по своей роли). Меняется только через `maestro.json`
(см. ниже). От модели в merge-конфиге (`.opencode/opencode.json` или global)
trust не зависит.

### Управление: maestro.json

Файл `maestro.json` в корне проекта — консолидированный
конфиг: три секции (`trust`, `confidential`, `sanitizer_whitelist`). Секция
`trust` перечисляет **только trusted** сабагентов. Всё, чего нет в секции —
untrusted.

```json
{
  "trust": {
    "custodian": true,
    "sanitizer": true
  },
  "confidential": { ... },
  "sanitizer_whitelist": { ... }
}
```

- **Ключ в `trust`:** имя сабагента (`custodian`, `sanitizer`, `haiku`, `sonnet`, `opus` и т.д.)
- **Значение:** только `true` = trusted. Любое другое значение → untrusted
- Если файла `maestro.json` нет → **все сабагенты untrusted** (безопасное значение по умолчанию)
- Файл коммитится в git — trust-level + security policy проекта
- `maestro.json` — единственный источник конфигурации. Старые `trust-config.json`,
  `.maestro/sanitizer-whitelist.json` больше
  **не читаются** плагином.

**Как применять:**

1. Оркестратор читает `maestro.json` **один раз за сессию** — на шаге 0 (Load
   Project Context) — **плагин-тулом `maestro_config`** (native `ask`;
   `read`-тул нативно denied, bash-чтение запрещено правилом R6). Кэширует для
   всех последующих диспатчей. Тул недоступен — конфиг не читается: «перезапустите
   opencode / обновите плагин (≥ 4.9.0)»; bash-fallback запрещён.
2. При каждом диспатче сабагента (шаги 8, 9, 13, 16): проверить кэш. Если
   сабагент есть в секции `trust` с `true` → trusted, иначе → untrusted
3. Изменения в `maestro.json` вступают в силу со следующей сессии
4. Файл обязателен к проверке — игнорировать его нельзя

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
Trust-уровень определяется по `maestro.json` (`references/trust-and-security.md`):

| Шаг | Сабагент | Security Review |
|---|---|---|
| Шаг 8 — Custodian Q/A | `custodian` | **Skip** (trusted — видит полный контекст для агрегации по confidential) |
| Шаг 9 — Spec Review | `opus` | Применяется (untrusted) |
| Шаг 13 — SDD implementer | `haiku` / `sonnet` | Применяется (untrusted) |
| Шаг 13 — SDD task-reviewer | `sonnet` | Применяется (untrusted) |
| Шаг 16 — Code Review | `code-reviewer` | Применяется (untrusted) |
| (внутри Security Review) | `sanitizer` | **Skip** (trusted — видит сырые данные для пометок) |

Если сабагент отмечен как trusted в `maestro.json` — sanitize промпта
**не проводится** (риск принят пользователем).

### Правила применения

1. Уровень 1 (плагин, Этап 2) — авто-маскирование, **без HITL**
2. Уровень 2 (сабагент `sanitizer`) — пометки, при находке → HITL
   (Трактовка Y, `references/trust-and-security.md`)
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
  trust check (maestro.json)
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
  `<!-- maestro:sanitize -->` (см. «Подписи spec-файла»).
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

Файл-доступ сабагентов и primary-сессии регулируется **нативным permission-слоем
opencode** (`.opencode/opencode.json` или global), а не плагином: `read`/`glob`/
`grep` deny `maestro.json`/`.maestro/**`, `read`-allow `.maestro/plugin-version`,
`edit`-ask `maestro.json`, confidential-deny — см. канон нативных permissions
в `maestro-assistant`. Плагин `maestro-bootstrap` file-тулы не перехватывает.

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
