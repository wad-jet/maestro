# Сравнение подходов обеспечения безопасности: Claude Code, OpenCode, Maestro

> Статус: справочный документ (research/comparison). Дата: 2026-09-02.
> Назначение: зафиксировать трёхстороннее сравнение подходов безопасности между
> Claude Code Permissions, OpenCode Permissions+Policies и пайплайном `maestro`.
> Основано на официальных доках и реализации плагина `maestro-bootstrap`.

## 1. Цель и область

Документ сравнивает, как три системы решают задачи обеспечения безопасности при
работе агентного ИИ с кодом: контроль доступа к действиям, защита
конфиденциальных данных и удержание человека в цикле (HITL). Сравнение полезно
как ориентир при развитии `SECURITY.md` и пайплайна `maestro`.

Три системы не являются взаимозаменяемыми:

- **Claude Code Permissions** — автономный нативный механизм контроля действий.
- **OpenCode Permissions + Policies** — автономный нативный механизм контроля
  действий + ресурсов (LLM-провайдеров).
- **Maestro** — **надстройка** над нативным permission-слоем OpenCode: плагин
  `maestro-bootstrap` добавляет уровень доверия к данным и санитайзинг поверх
  нативных permissions, не отключая их.

## 2. Три модели в двух словах

### Claude Code Permissions

Единая модель «что тул может делать». Permission-правила вида `Tool(specifier)`
резолвятся в `allow` / `ask` / `deny`. **Приоритет: deny → ask → allow**
(deny-first) — deny побеждает даже более конкретный allow, порядок правил не
важен. Enforcement — в ядре Claude Code, нативный, fail-closed. Уровни доверия
между primary и субагентами по данным не различаются. Режимы: `manual`,
`acceptEdits`, `plan`, `auto` (classifier), `dontAsk`, `bypassPermissions`.
Защита секретов сводится к deny-правилам на чтение путей (`.env` и т.п.).

### OpenCode Permissions + Policies

Две отдельные оси:

- **Permissions** контролируют «что тулы могут делать во время сессии».
  Правила ключуются по имени тула (`read`, `edit`, `bash`, `task`, `skill`,
  `webfetch`…). **Порядок матчинга — last-match-wins** (последнее подходящее
  правило побеждает). Default-ы **permissive** (почти всё `allow`), но `read`
  для `.env`/`.env.*` — **deny по умолчанию**. Есть per-agent override
  (`agent.<name>.permission`). `ask` в UI — это `once` / `always` (на сессию) /
  `reject`.
- **Policies** контролируют «может ли OpenCode использовать ресурс» (пока —
  LLM-провайдеры через `action: provider.use`). Last-match-wins; global-конфиг
  приоритетнее project-конфига. Заменяют устаревшие
  `disabled_providers`/`enabled_providers`.

### Maestro

Надстройка над нативным permission-слоем OpenCode. Плагин
`plugins/maestro-bootstrap/index.js` возвращает `config: async () => ({})` —
сознательно **НЕ** форсирует `file_access: "allow"`, чтобы не отключать нативные
permissions OpenCode (`edit: ask`, `bash: ask`). Поверх них плагин добавляет:

- **`access_policy`** — HITL-контроль `read` по путям (allow/ask/deny).
- **`confidential`-границу** — жёсткий deny для untrusted/primary по
  конфиденциальным путям (read/write/edit).
- **Санитайзер промптов** — двухуровневое маскирование чувствительных данных.

Ключевое отличие: **двухуровневая модель доверия** (trusted/untrusted по имени
агента в `maestro.json → trust`), при этом **primary/root-сессия считается
untrusted** к конфиденциальным данным. Fail-closed: всё, чего нет в `trust` →
untrusted.

## 3. Поаспектное сравнение

### 3.1 Модель доверия

| Система | Модель |
|---|---|
| Claude Code | Единая, по действиям. Нет различения primary/субагентов по уровню доступа к данным. |
| OpenCode | Единая, по действиям; per-agent rules (механические ограничения тулов). |
| Maestro | **Двухуровневая** (trusted/untrusted по имени), primary=untrusted к `confidential/**`. Fail-closed. |

Maestro — единственная система, которая **принципиально не доверяет primary-
сессии** конфиденциальные данные и вводит trusted-брокеров (`custodian`,
`sanitizer`), допущенных к ним по имени.

### 3.2 Матчинг правил

| Система | Семантика |
|---|---|
| Claude Code | **deny → ask → allow** (deny-first). Порядок правил не важен; deny побеждает более конкретный allow. |
| OpenCode | **last-match-wins**. Порядок правил критичен; широкий `"*"` в конце может перекрыть специфичный deny. |
| Maestro | Приоритет deny > ask > allow в `access_policy`; `confidential` выигрывает у `access_policy`; untrusted/primary → всегда deny (инвариант). |

`last-match-wins` OpenCode — **риск ошибок конфигурации**: случайный широкий
`"*": "allow"` в конце может ослабить deny. deny-first семантика Claude Code и
maestro безопаснее от опечаток в правилах.

### 3.3 Default-ы и fail-closed/fail-open

| Система | Default |
|---|---|
| Claude Code | Manual-промпты по умолчанию; permissive в `auto`-режиме. Enforcement в ядре — fail-closed. |
| OpenCode | **Permissive** (почти всё `allow`); `read` для `.env` deny; `external_directory`/`doom_loop` — `ask`. |
| Maestro | **Fail-closed по дизайну**: нет в `trust` → untrusted; отсутствие `maestro.json` → все untrusted. Но enforcement — в плагине: при отключённом плагине защита **fail-open** (признанный риск, закрывается только гейтом «плагин работает»). |

### 3.4 Защита секретов в файлах (`.env` и т.п.)

| Система | Подход |
|---|---|
| Claude Code | deny-правила `Read(.env)` / `Read(./secrets/**)` — по желанию пользователя. |
| OpenCode | **`*.env`/`*.env.*` deny по умолчанию** (`.env.example` — allow). |
| Maestro | **Built-in confidential-набор** (всегда, независимо от конфига): `.env`, `.env.*`, `*.pem`, `*.key`, `*.crt`, `*.p12`, `*.pfx` — deny для primary и untrusted. Конфигурируемый `confidential.paths` расширяет, а не заменяет. |

Maestro и OpenCode пересекаются в `.env` deny; maestro расширяет набор
приватными ключами и позволяет trusted-агентам читать по
`confidential.trusted[read]` (OpenCode такого per-data исключения не даёт).

### 3.5 Per-agent контроль

| Система | Механизм |
|---|---|
| Claude Code | `Agent(AgentName)` rules (deny/ask/allow на конкретного субагента). |
| OpenCode | **`agent.<name>.permission`** в конфиге или frontmatter `permission:` в agent-файле. |
| Maestro | `maestro.json → trust` (по имени) + `confidential.trusted[read/write/edit]` (по данным). |

**Per-agent permissions OpenCode — самое близкое нативное средство к модели
доверия maestro.** Но есть принципиальная разница:

- OpenCode различает агентов по **действиям** (какие тулы субагент может
  вызывать: `edit: deny`, `webfetch: deny` у review-агента и т.п.).
- Maestro различает агентов по **доступу к данным** (кто может читать
  `confidential/**`).

> **Уточнение (2026-09-02):** «различие по действиям vs по данным» описывает
> *текущую реализацию* maestro, а не выразимость нативных средств. По докам
> OpenCode Agents agent rules **перекрывают** глобальные (agent rules take
> precedence), поэтому per-agent `permission.read` с allow-паттерном может дать
> конкретному агенту доступ к путям, deny для всех остальных (allow-внутри-deny
> выражается нативно). Точная granular-семантика мержа требует runtime-верификации
> (см. `specs/native-permissions-rebalance.md`, V1).

Идеальная комбинация: использовать `agent.<name>.permission` OpenCode для
механических правил тулов **и** для данных (в т.ч. trusted-исключений к
confidential); `trust`/`confidential` maestro — как канон/генератор этого нативного
конфига.

### 3.6 Санитайзинг чувствительных данных в промптах

| Система | Подход |
|---|---|
| Claude Code | **Нет** механизма маскирования данных перед передачей в субагента/лог. |
| OpenCode | **Нет** механизма маскирования. Защита `.env` — только от *чтения*, не от переноса уже прочитанных значений. |
| Maestro | **Двухуровневый санитайзер**: Ур.1 — regex плагина (авто, до ухода промпта в untrusted-субагента: `env_secret`, `data_field`, `db_credential`, `private_key`, `auth_header`, JWT); Ур.2 — сабагент `sanitizer` (trusted, LLM-пометки в spec). Whitelist, per-agent rules, SEC-6/SEC-7 guard-ы. Маскирует `title` отчётов субагентов (SEC-4), в аудит-лог пишет только `basename` путей (SEC-5). |

**Санитайзинг промптов — уникальная фича maestro.** Ни Claude Code, ни OpenCode
не маскируют чувствительные значения, если они уже попали в промпт или лог.
Это ядро защиты maestro от переноса секретов между контурами доверия.

### 3.7 HITL-характер

| Система | Тип gate-ов |
|---|---|
| Claude Code | Механические per-call промпты: ask/deny, "don't ask again". Автоматизируются через `auto`-режим и PreToolUse hooks. |
| OpenCode | Механические per-call промпты: `once` / `always` / `reject`. Автоматизируются через `--auto`. |
| Maestro | **Структурные pipeline-gates** на уровне пайплайна: категория фичи (шаг 7), spec review (9), spec-gate (10), plan-gate (12), pre-PR (17), security review (8.6), трактовка findings (Y), гейт «плагин работает» (Gate 0). HITL-решения — содержательные архитектурные (approve/revise/reject), не просто «разрешить команду». |

Maestro не полагается на auto-classifier: все существенные решения проходят
через HITL. OpenCode/Claude Code делегируют автоматизацию ядру.

### 3.8 Enforcement

| Система | Где enforce |
|---|---|
| Claude Code | В ядре — нативный, fail-closed. |
| OpenCode | В ядре — нативный. |
| Maestro | В **плагине** (`tool.execute.before`). Fail-open без плагина (признанный риск, §5 `SECURITY.md`). |

### 3.9 Ресурсный контроль (LLM-провайдеры)

| Система | Механизм |
|---|---|
| Claude Code | Нет явного per-provider контроля в permissions. |
| OpenCode | **Policies**: `provider.use` allow/deny по ID провайдера, last-match-wins, global > project. |
| Maestro | Merge-конфиг моделей (`agent.*.model`); требование P4 — trusted-агенты на локальной/изолированной модели, но **не enforced** в рантайме (P2: runtime-проверка модели циклическая и не защищает от компрометации конфига). |

**Policies OpenCode могли бы усилить P4 maestro** — централизованный deny/allow
провайдера, enforced на уровне ядра, что недостижимо текущим merge-конфигом.

### 3.10 Sandbox / OS-барьер

| Система | Подход |
|---|---|
| Claude Code | Нативный sandboxing (сетевая изоляция, защищённые пути, OS-барьер для subprocess). |
| OpenCode | В рассматриваемых доках нативного sandboxing не описано. |
| Maestro | Явное ограничение: защита **не является OS-барьером** (не chmod/ACL), enforcement — на уровне тулов в плагине. |

## 4. Сводная таблица

| Аспект | Claude Code Permissions | OpenCode Permissions | Maestro |
|---|---|---|---|
| Модель доверия | Единая, по действиям | Единая, по действиям; per-agent rules | **Двухуровневая** (trusted/untrusted по имени), primary=untrusted к confidential |
| Матчинг правил | deny → ask → allow (deny-first) | **last-match-wins** | Приоритет deny>ask>allow; confidential выигрывает |
| Default-ы | Manual-промпты; permissive в `auto` | **Permissive** (почти всё allow), `.env` deny | Fail-closed по дизайну; fail-open без плагина |
| Защита `.env` | deny-правила (по желанию) | **deny по умолчанию** | built-in confidential deny (всегда) |
| Per-agent контроль | `Agent(name)` rules | **`agent.<name>.permission`** | `trust` + `confidential.trusted` |
| Секреты в промптах | Нет | Нет | **Двухуровневый санитайзер** |
| HITL | per-call, автоматизируемый | per-call, автоматизируемый | **Структурные pipeline-gates** |
| Enforcement | В ядре | В ядре | В плагине (fail-open без плагина) |
| Ресурсный контроль | — | **Policies** (`provider.use`) | Merge-конфиг моделей (не enforced) |
| Sandbox/OS | Есть (нативная) | Нет (в доках) | Нет (не OS-барьер) |

## 5. Избыточность и комплементарность плагина относительно OpenCode

> **Статус реализации (2026-09-02, Этап A).** На основе рекомендаций
> `specs/native-permissions-rebalance.md` реализован Этап A: `/maestro-new` пишет
> нативный deny-baseline (`read`/`edit`) + 2-й эшелон (`bash`/`glob`/`grep`) +
> опциональные policies для P4; канон — в `maestro-assistant`. Это смягчает
> «fail-open без плагина» (см. §3.3, §3.8, §5.4): файловая защита confidential
> более не зависит исключительно от плагина. R2/R3/R7/R9 — Этап B (после V1),
> требуют runtime-верификации. Плагин остаётся владельцем sanitizer и
> trusted-исключений по данным.

Разбор механизмов плагина `maestro-bootstrap` (`core.js`, `index.js`) против
нативных возможностей OpenCode (`permission`, `policies`, агентные правила).

### 5.1 Что избыточно (дублирует OpenCode)

**Deny-часть `confidential` и built-in набор (`.env`, `.env.*`, `*.pem`…).**
OpenCode нативно deny'ит `read` для `*.env`/`*.env.*` по умолчанию и позволяет
`permission.read`/`permission.edit` deny по любым путям (включая `*.pem`,
`*.key`, `*.crt`, `*.p12`, `*.pfx`). Плагин дублирует это в
`BUILTIN_CONFIDENTIAL_PATTERNS` + `confidential.paths`.

**`access_policy` для тула `read`.** Нативный `permission.read` с паттернами
(`"*.env": "deny"`, `"docs/**": "ask"`) решает ту же задачу «кто читает какие
файлы» без кода плагина. Ценность maestro-версии — только приоритет
deny > ask > allow и интеграция с HITL-гейтами.

**Утилитарная диагностика версии** (`plugin-version`, `/maestro-version`).
Не является security-механизмом; OpenCode и так сообщает версию. Дублирование с
ограниченной ценностью (semver-only).

### 5.2 Что не избыточно (уникально / комплементарно)

**Санитайзер промптов (Ур.1 regex + Ур.2 LLM).** У OpenCode нет маскирования
содержимого: он защищает от *чтения* `.env`, но не заменяет секреты, уже
попавшие в промпт/лог. Принципиально другая ось (см. 5.3).

**Trusted-исключения по данным** (`confidential.trusted[read/write/edit]`).
Изначально считалось, что per-agent rules OpenCode не могут дать одному агенту
читать пути, deny для всех остальных. **По докам OpenCode Agents (2026-09-02)
это не так**: agent rules перекрывают глобальные (agent rules take precedence),
поэтому `agent.custodian.permission.read: {"docs/confidential/*": "allow"}` при
глобальном deny того же пути даёт allow-внутри-deny — нативно. Ценность
maestro-механизма остаётся в **каноне/генерации** этого нативного конфига
(порядок правил, сегментная семантика паттернов), а не в невозможности сделать
иначе. Точная granular-семантика мержа требует runtime-верификации (V1,
`specs/native-permissions-rebalance.md`).

**Модель trust/untrusted по имени + primary=untrusted.** OpenCode не различает
primary-сессию по доверию к данным.

**Аудит-лог** (security-фактура `confidential.access`/`access_policy.blocked`) и
**observability** (`session.error`, empty-result, длительность task). У OpenCode
нет встроенного аналога.

**HITL-интеграция.** Структурные pipeline-gates скилла поверх плагина.

### 5.3 Выявление и замена секретов — дополнение, а не дублирование

Задачи «заблокировать чтение секрета» и «выявить и заменить секрет в промпте»
**не дублируются, а дополняют друг друга**:

- `.env` deny (нативный OpenCode) закрывает **один источник** — файлы `.env`.
- Санитайзер закрывает **все остальные пути попадания секрета в промпт**:
  захардкоженные значения в коде, конфиги, вывод `bash`, логи, JWT/ключи в
  аргументах, credentials в URI и т.д.

Даже при работающем `.env` deny секреты попадают в контекст десятком других
способов. Санитайзер — **единственный механизм в трёх системах**, который это
ловит. Реальная избыточность есть только по направлению «блокировка источника»:
и built-in confidential, и `access_policy.read`, и нативный `permission.read`
решают одну задачу — здесь три слоя на одну функцию.

### 5.4 Где OpenCode и maestro дополняют друг друга

1. **Многослойная оборона (defense in depth).** Нативный `permission.read`/`edit`
   deny + `.env` default + per-agent rules — fail-closed база OpenCode; sanitizer
   + trusted-модель + confidential-граница + структурные HITL — control-слой
   maestro поверх. Каждый слой закрывает то, что не закрывает другой.

2. **Механика → OpenCode, data-level контроль → maestro.** Механические правила
   тулов (`webfetch: deny` у implementer, `edit: deny` у code-reviewer) лучше
   выражать нативным `agent.<name>.permission`. Контроль «кто видит
   конфиденциальные данные» — это `trust` + `confidential.trusted`, чего
   OpenCode не умеет.

3. **Enforcement vs изоляция.** OpenCode — нативный fail-closed enforcement в
   ядре (не зависит от загрузки плагина); maestro — плагин, **fail-open без
   плагина**. Нативные permissions должны оставаться резервной базой, а плагин
   добавляет то, чего ядро не даёт.

4. **Policies + P4.** Нативный `experimental.policies` (`provider.use` deny/allow)
   мог бы **enforce** требование P4 «trusted-агенты на изолированной модели» —
   то, чего merge-конфиг `agent.*.model` не гарантирует (не enforced в рантайме).
   Случай, когда OpenCode *усиливает* maestro.

### 5.5 Сводка по избыточности

| Механизм плагина | Статус | Комментарий |
|---|---|---|
| built-in `.env`/ключи deny | **Избыточен** (для `read`) | Дублирует `permission.read` deny + `.env` default; уникален только trusted-исключением и покрытием write/edit |
| `access_policy` (`read`) | **Избыточен** | Выражается нативным `permission.read`; ценность — приоритет deny>ask>allow + HITL |
| Sanitizer промптов | **Уникален** | Нет аналога в OpenCode/Claude Code |
| Trust-модель / primary=untrusted | **Уникален** | OpenCode не различает по данным |
| Trusted-исключения по данным | **Выразим нативно** (требует V1) | agent rules перекрывают глобальные → allow-внутри-deny возможен; ценность maestro — канон/генерация конфига |
| Аудит-лог / observability | **Комплементарен** | Нет встроенного аналога |
| plugin-version | **Утилитарный** | Низкая ценность |

## 6. Ключевые выводы

1. **Maestro — надстройка над нативным permission-слоем OpenCode**, а не
   альтернатива. Плагин сознательно не трогает `edit: ask`/`bash: ask`,
   добавляя только `read`-access_policy, confidential-границу и санитайзер.

2. **Per-agent permissions OpenCode — самое близкое нативное средство к модели
   доверия maestro.** Но OpenCode различает агентов по *действиям*, maestro —
   по *доступу к данным*. Два подхода комплементарны и могут использоваться
   вместе.

3. **`last-match-wins` в OpenCode — риск ошибок конфигурации**: широкий
   `"*": "allow"` в конце может случайно перекрыть специфичный deny. deny-first
   семантика Claude Code и maestro безопаснее.

4. **Санитайзер остаётся уникальным**: ни Claude Code, ни OpenCode не маскируют
   чувствительные данные перед диспатчем в субагента/лог. Это ядро защиты
   maestro от переноса секретов между контурами доверия.

5. **Policies OpenCode** могли бы усилить требование P4 maestro (trusted-агенты
   на изолированной модели) — enforced deny/allow провайдера глобально.

6. **HITL-характер различается**: Claude Code/OpenCode автоматизируют per-call
   разрешения (через `auto`/hooks), maestro держит содержательные решения
   (approve/revise/reject spec, security review) за структурными gates, не
   автоматизируя их.

## 7. Источники

- Claude Code Permissions: https://code.claude.com/docs/en/permissions
- OpenCode Permissions: https://opencode.ai/docs/permissions/
- OpenCode Agents: https://opencode.ai/docs/agents/
- OpenCode Policies: https://opencode.ai/docs/ru/policies/
- Внутренний стандарт ИБ maestro: `SECURITY.md`
- Реализация контрмер: `plugins/maestro-bootstrap/core.js`, `plugins/maestro-bootstrap/index.js`
- Рекомендации по изменению maestro: `specs/native-permissions-rebalance.md`