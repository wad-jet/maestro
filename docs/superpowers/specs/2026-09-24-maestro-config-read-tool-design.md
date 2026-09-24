# Spec: `maestro_config` — read-тул плагина для `maestro.json` (санкционированный канал чтения параметров конфига в сессиях)

**Дата:** 2026-09-24
**Ветка:** `feature/maestro-config-read-tool`
**Версия:** 4.8.0 → 4.9.0 (minor: новый тул плагина + процессный канон)
**Основание:** решение пользователя (2026-09-24, план-сессия): зафиксировать в
`docs/project-context.md` правило «`maestro.json` может читать только плагин;
обращений через bash/cat/иные для определения параметров быть не должно»;
направление **B** — read-тул плагина (выбран пользователем из вариантов
A — правила канона + best-effort native deny, C — только фиксация).
**auto-ai:** дизайн-вопросы Q1–Q6 решены decision-диспатчем `opus`
(2026-09-24, task `ses_f2da27d71ffeMAu7MyJiLoMjn4`); все решения —
high confidence; журнал авто-решений показан на гейте 10.

## 1. Контекст и проблема

### 1.1 Текущее поведение (факты кода)

- **Плагин — единственный процесс**, открывающий `maestro.json` в runtime:
  `loadMaestroConfig` (`plugins/maestro-bootstrap/core.js:348-357`) —
  `fs.readFileSync`, env-override `MAESTRO_CONFIG`, файл отсутствует → `{}`.
- **Нативный слой (R6-канон):** `read`/`glob`/`grep` — deny `maestro.json`;
  `edit` — ask; `bash: {"*": "allow"}` (осознанно: R6 «не вводить глобальный
  `*ask` для bash», «bash-паттерны по слову — запрещены»).
- **`SECURITY.md` P6:** нативная защита + **residual risk: «bash `cat`
  остаётся доступен untrusted (паритет с прежним access_policy)»**.
- **Канон скиллов/команд прямо предписывает** «чтение через bash (`cat`/`sed`)»
  в 8 содержательных флоу (§3.4) — санкционированный обход, противоречащий
  целевому правилу.
- **`docs/project-context.md` §12:** «`maestro.json`/`.maestro` защищены
  нативно (deny + edit-ask)» — правила «читает только плагин» нигде нет.

### 1.2 Боль

- Параметры конфига (`trust`/`confidential`/`sanitizer_whitelist`/`memory`/
  `communication`) фактически читаемы любым агентом в сессии через
  `cat maestro.json` — включая untrusted-сабагентов; процесс это предписывает
  (канон).
- Drift-детектор, setup diff-merge, статус-команды памяти работают через
  несанкционированный канал.
- Правило «в сессиях `maestro.json` читает только плагин» не имеет технической
  реализации: гарантировать его через нативные permissions нельзя (bash —
  best-effort), санкционированной альтернативы для primary нет.

### 1.3 Решено (HITL, 2026-09-24)

- **Правило** (фиксируется в `project-context.md` §6/§12): в opencode-сессиях
  параметры `maestro.json` определяются только через плагин; чтение агентами
  через read/glob/grep, bash (`cat`/`sed`/иные) запрещено.
- **Направление B:** read-тул плагина. Файл открывает только процесс плагина;
  данные агенту — через контролируемый API плагина (аналог memory-тулов).
- Файл коммитится в git и доступен владельцу **вне** сессии — правило покрывает
  in-session доступ (primary + сабагенты), не OS-доступ.

## 2. Дизайн-решения (decision-диспатч opus, auto-ai)

| # | Вопрос | Решение |
|---|---|---|
| Q1 | Имя/API тула | `maestro_config`, опц. `section` (dot-path); ответ `{exists, config, section_found?, parse_error?, path?}` |
| Q2 | Redact | **Без redact** значений (diff-merge обязан сохранять пользовательские правки, включая кастомные `sanitizer_whitelist.patterns`); защита = permissions + plugin guard |
| Q3 | Permissions | глобально `"maestro_config": "ask"` + per-agent `deny` всем сабагентам (канон boundary-tools) |
| Q4 | bash-deny | **НЕ добавлять** (консистентность R6; best-effort не поднимает уровень, паритет tamper) |
| Q5 | Карта миграции | флоу 1–8 — на тул; existence-only `test -f` — допустим; **флоу 9 (feedback_report) — не мигрируется** (по принятой спеке 2026-09-24 оркестратор ключ не читает — плагин инжектит директиву) |
| Q6 | P6 | переформулировать: санкционированный канал = тул; bash-чтение запрещено процессным каноном; **residual bash-обхода сохраняется** (паритет tamper) |

## 3. Дизайн

### 3.1 Плагин: read-only тул `maestro_config`

- Регистрируется через `tool`-хук плагина (паттерн memory-тулов,
  `memory/index.js:908+`), **бескондиционно** — независимо от
  `memory.enabled` (в отличие от memory-тулов): доступен во всех
  maestro-проектах при загруженном плагине.
- **Аргументы:** `section: string` — опциональный dot-path до секции
  (`"memory"`, `"sanitizer_whitelist"`, вложенный `"memory.embedding.model"`).
  Без аргумента — весь конфиг.
- **Ответ** (строка, JSON — как у memory-тулов):
  - весь конфиг: `{ "exists": true, "config": {...}, "path": "<resolved>" }`;
  - секция найдена: `{ "exists": true, "config": <значение>, "section_found": true, "path": "..." }`;
  - секции нет: `{ "exists": true, "config": null, "section_found": false, "path": "..." }`;
  - файла нет: `{ "exists": false, "config": {}, "path": "..." }` (паритет `loadMaestroConfig`);
  - невалидный JSON: `{ "exists": true, "config": {}, "parse_error": true, "path": "..." }`
    (диагностика @maestro-memory: «битый конфиг» ≠ «нет секции»).
- **Валидация `section`:** непустая строка, сегменты непустые, без
  ведущей/хвостовой точки; невалидно → человекочитаемое сообщение об ошибке
  (не исключение, не частичная выдача).
- **`path`** — резолвлённый путь (с учётом `MAESTRO_CONFIG`) — прозрачность
  override в диагностике.
- **Plugin-side guard (fail-closed): только top-level primary-сессии.**
  - Определение типа сессии — `client.session.get({ path: { id: ctx.sessionID } })`
    (паттерн `communication.js:96-115`: `resp?.data ?? resp`, bounded-cache
    cap 1024 → clear).
  - **Deny-условия → reason-enum (полный маппинг):** `parentID` задан
    (task-сессия сабагента) → `task_session`; `title` начинается с
    `[maestro-memory]` (сервис-сессия) → `service_session`;
    `ctx.sessionID` ∈ SESSIONS-множеству plugin-сессий (fast-чек, паттерн
    `memory/index.js:1048`; служебные сессии плагина) → `service_session`;
    сессия недоступна/ошибка получения ИЛИ `ctx.sessionID` отсутствует
    (консервативно, fail-closed) → `session_unavailable`.
  - **Поведение deny:** возврат сообщения (рабочие сообщения плагина —
    русские; прецедент: «Инструмент недоступен для служебных сессий»,
    `memory/index.js:927`): `maestro_config: инструмент доступен только
    в top-level primary-сессии` + аудит-строка
    `maestro_config:access_denied` (sessionID, reason-enum:
    `task_session` | `service_session` | `session_unavailable`) — **без
    данных конфига**.
- **Аудит-лог** (bootstrap-лог, `info`): `maestro_config:read` — sessionID,
  имя запрошенной секции (без значений), результат-класс
  (`ok` | `section_missing` | `file_missing` | `parse_error` |
  `access_denied`).
- Без новых зависимостей; семантика `loadMaestroConfig` (env-override
  `MAESTRO_CONFIG`, дефолт `<root>/maestro.json`, `{}` при отсутствии)
  не меняется. Тул читает файл **сам** (`existsSync` → `readFileSync` →
  `JSON.parse`, тот же резолв пути): `loadMaestroConfig` схлопывает
  «файла нет»/«битый JSON» в `{}` (`core.js:349-357`) — явные
  `exists`/`parse_error` поверх неё не построить.

### 3.2 Без redact значений (Q2)

Diff-merge (`/maestro-setup`) обязан сохранять пользовательские правки,
включая кастомные `sanitizer_whitelist.patterns` (мастер-сетап: «merge
сохраняет пользовательские правки»); OP-4 — адресный diff «стало vs было»
для `sanitizer_whitelist.rules→false`. Redact привёл бы к **молчаливому
затиранию** пользовательских security-правок при merge — регрессия
одновременно функциональная и ИБ. Экспозиция untrusted закрыта
пермишенами (Q3) + plugin guard (§3.1); residual bash-обход — паритет P6.

### 3.3 Нативные permissions (R6-канон)

- **Глобально (эталон R6):** `"maestro_config": "ask"` — канон «новые
  write/boundary-tools → permission `ask`»; прецедент: все memory
  boundary-тулы глобально `"ask"`.
- **Per-agent:** `agent.<name>.permission.maestro_config: "deny"` для всех
  сабагентов — канон-набор `custodian`, `sanitizer`, `haiku`, `sonnet`,
  `opus`, `fable`, `code-reviewer`; кастомные агенты — deny при генерации
  `/maestro-setup`. Исключений для custodian/sanitizer **нет**.
- **Без** нативного bash-deny (Q4).
- Зоны влияния: эталон R6 в `skills/maestro-assistant/SKILL.md`; генерация
  merge-config в `skills/maestro-setup/SKILL.md`; локальный
  `.opencode/opencode.json` (dogfooding) — идемпотентно «только добавлять».
- OP-1: после правки merge-config — рестарт opencode.

### 3.4 Миграция флоу (канон скиллов/команд)

| # | Флоу (место) | Было | Станет |
|---|---|---|---|
| 1 | Шаг 0 trust-кэш — `skills/maestro/SKILL.md:1629-1635` | bash `cat`/`sed` | `maestro_config` (весь конфиг), один вызов за сессию + кэш |
| 2 | Assistant-воркфлоу «Настройка конфигурации» шаг 1+2 (чтение + drift-детектор) — `skills/maestro-assistant/SKILL.md:434` | bash | `maestro_config` + нативный read `.opencode/opencode.json` |
| 3 | Assistant «Процедура смены режима» (`communication`) — `skills/maestro-assistant/SKILL.md:291` | bash | `maestro_config` `section: "communication"` |
| 4 | `/maestro-setup` задача 3, diff-merge существующего конфига — `skills/maestro-setup/SKILL.md:150-152`, `init-context.md:149` | bash | `maestro_config` (весь конфиг) |
| 5 | `/maestro-design` проверка наличия — `skills/maestro-design/SKILL.md:13,73` | bash `cat`/`test` | `test -f maestro.json` (existence-only — допустим: 1 бит, без раскрытия параметров; работает без плагина — до инициализации maestro и в non-maestro-проектах; при global-регистрации плагина эквивалентен ответу тула `exists: false`) |
| 6 | `@maestro-memory` — `commands/maestro-memory.md:15,54` | bash | Шаг 2 (стр. 54) — `maestro_config` `section: "memory"`; Шаг 1.2 (стр. 15) — перестраивается по §3.4a: `maestro_config` доступен → ветвление по секции `memory`, прочитанной тулом (`enabled: false` → «выключена»; `disabled_reason` → честная причина; валиден + `memory_stats_detail` недоступен → «перезапустите»); недоступен → сообщение о перезапуске/обновлении (§3.4a), конфиг не читается |
| 7 | `@maestro-memory-report` — `commands/maestro-memory-report.md:15,80` | bash | Шаг 1 (стр. 15) — сначала гейт `maestro_config`: доступен → читать секцию `memory` тулом (`enabled`, `storage.type`, `module_dir`) и ветвиться по §3.4a; недоступен → сообщение о перезапуске/обновлении (§3.4a), конец. Шаг 2 (стр. 80) — `report.include_text` из того же вызова тула. Шаг 1a — сужение по §3.4a (только при доступном `maestro_config` + `storage.type: sqlite`) |
| 8 | Описания команд — `commands/maestro-assistant.md:11-12`, `commands/maestro-setup.md:20`, `commands/maestro-design.md:12` | «чтение через bash (`cat`/`sed`)» | «чтение через тул `maestro_config`» |

- **Флоу 9 (feedback_report, шаг 18.5) — не мигрируется:** по принятой спеке
  `docs/superpowers/specs/2026-09-24-feedback-report-modes-design.md`
  оркестратор/bash ключ не читают (плагин инжектит директиву при init).
- Чтение `.maestro/logs/*` через bash — **не меняется** (логи — вывод
  плагина, не параметры конфига).
- **Новая строка канона** (R6 + в каждом затронутом файле; самодостаточная,
  без ссылок на спеку): «Чтение параметров `maestro.json` в сессиях — только
  через тул плагина `maestro_config`. Чтение через read/glob/grep, bash
  (`cat`/`sed`/`node -e`/иные) запрещено. Исключение: existence-only
  проверка `test -f` (без раскрытия содержимого). Если тул недоступен
  (плагин не загружен или устарел) — конфиг не читается вообще: вывести
  сообщение о перезапуске opencode / обновлении плагина; bash-fallback
  запрещён.»

### 3.4a Правило вывода при недоступности `maestro_config` (диагностические/fallback-ветки флоу 6–7)

`maestro_config` регистрируется бескондиционно (§3.1), поэтому его
доступность = «плагин загружен И версия ≥ 4.9.0». Диагностические ветки
«memory-тул недоступен» (флоу 6–7) НЕ мигрируются дословной заменой
bash → тул: ветка, срабатывающая при недоступности memory-тулов, не может
полагаться на `maestro_config` как на данный (иначе — неисполнимая ветка).

- **Правило вывода.** `maestro_config` недоступен → плагин не загружен ИЛИ
  устарел (< 4.9.0) → базовое сообщение «Перезапустите opencode / обновите
  плагин maestro-bootstrap (≥ 4.9.0)», **конфиг не читается** (bash-fallback
  запрещён каноном §3.4). Различение причин — по гейту «плагин работает»
  (best-effort; при неоднозначности — базовое сообщение):
  - `.maestro/plugin-version` (read-allow, семантика `/maestro-version`:
    файл пишется только при успешной init плагина) содержит версию < 4.9.0
    → «плагин устарел — обновите maestro-bootstrap (≥ 4.9.0) и перезапустите
    opencode»;
  - `.maestro/plugin-version` отсутствует/пуст и/или нет свежего
    bootstrap-лога (`.maestro/logs/maestro-bootstrap-<дата>.log`; чтение
    логов через bash разрешено — §3.4) → «плагин не загружен — перезапустите
    opencode».
- **`maestro_config` доступен, memory-тулы недоступны** → конфиг читается
  тулом (секция `memory`), ветвление по значениям: `enabled: false` →
  «память выключена — включите memory.enabled: true»; конфиг-невалиден →
  честная причина (`disabled_reason`, классификация `@maestro-memory`
  Шаг 1.2); `enabled: true` + валиден + `memory_stats_detail` недоступен →
  сбой init memory-модуля → «Перезапустите opencode» (для
  `@maestro-memory-report` при `storage.type: sqlite` → Шаг 1a).
- **`@maestro-memory-report` Шаг 1a (sqlite-fallback) — сужение:**
  выполняется только при «`maestro_config` доступен (плагин загружен и
  актуален) + `memory.enabled: true` + конфиг валиден + memory-тулы не
  зарегистрированы (сбой init memory-модуля) + `storage.type: sqlite`.
  Сценарий «плагин не загружен / устарел» fallback больше НЕ покрывает
  (конфиг не читается — правило вывода выше): выводится сообщение о
  перезапуске/обновлении, отчёт не генерируется. `memory.module_dir` и
  `namespace` для fallback читаются через `maestro_config`.

### 3.5 `SECURITY.md` P6 (переформулирование)

Новый текст (консолидация в P6, без новых P-номеров):

> **P6.** `maestro.json` (в т.ч. `sanitizer_whitelist.patterns`) защищается
> **нативно** — deny `read`/`glob`/`grep` + edit-ask в
> `.opencode/opencode.json`; не плагином. **Санкционированный канал чтения
> параметров в сессиях — read-тул плагина `maestro_config`** (permission
> `ask`; только top-level primary-сессии; сабагенты — per-agent deny +
> plugin fail-closed guard). Чтение конфига через bash запрещено
> процессным каноном (скиллы/команды мигрированы на тул; existence-only
> `test -f` — допустим). Residual risk: bash `cat`/`sed`/`node -e`
> технически остаётся доступен (документированный обход, паритет с tamper
> `.opencode/opencode.json` — не закрывается в scope); tamper
> `.opencode/opencode.json` — parity, усиление — вне scope. Предупреждение
> о версии (`/maestro-version`) использует только `.maestro/plugin-version`
> (semver-only) и НЕ ослабляет доступ к конфигу.

Синхронизация зеркал по правилу репозитория: `manual_docs/`
(`explanation/agents-and-trust.md`, `reference/model-selection.md`,
`reference/config.md`) — строки, описывающие P6/bash-чтение (diff-сверка).

### 3.6 `skills/maestro-assistant/SKILL.md` (канон)

- **Эталон R6:** добавить `"maestro_config": "ask"` + per-agent deny;
  строка правила (§3.4).
- **Воркфлоу «Настройка конфигурации» шаг 1:** «Прочитать текущий артефакт
  (`maestro.json` — через тул `maestro_config`; read-тул нативно deny,
  bash — запрещён правилом)».
- **«Процедура смены режима» (`communication`):** чтение — через тул.
- OP-1 сохраняется (правки `maestro.json` — рестарт opencode).

### 3.7 `docs/project-context.md` (context changes, шаг 12a)

- **§6** (новый буллит): «Все доработки (скиллы/команды/плагин) обязаны
  учитывать правило „чтение `maestro.json` в сессиях — только плагин" (§12);
  новых флоу „чтение через bash" не вводить.»
- **§12** (новый буллит): «**`maestro.json` — читает только плагин.** В
  opencode-сессиях параметры `maestro.json` определяются только через плагин
  (для primary — read-тул `maestro_config`; для сабагентов — deny). Чтение
  агентами через read/glob/grep, bash (`cat`/`sed`/иные) запрещено;
  исключение — existence-only `test -f`. Файл коммитится в git и доступен
  владельцу вне сессии — правило покрывает in-session доступ. Residual
  риски — `SECURITY.md` P6.»
- **§3** (версия): обновляется в составе step-18 bump
  (4.8.0 → 4.9.0) по правилу версионирования «синхронизация всех файлов,
  ссылающихся на текущую версию».

### 3.8 `manual_docs/` (шаг 14)

- `reference/config.md` — эталон R6: `maestro_config` (`ask` + per-agent
  deny) + строка правила.
- `reference/commands.md` — `@maestro-memory` / `@maestro-memory-report` /
  `@maestro-setup` / `@maestro-assistant`: строки «чтение через bash» → тул.
- `reference/memory.md` — шаги команд памяти, читающие `maestro.json`.
- `explanation/agents-and-trust.md` — строки P6 (при наличии).
- `overview/changelog.md` — секция 4.9.0 (step 18).

### 3.9 Реестр регрессии

Новая запись в `regression/entries/` — файл
`2026-09-24-maestro-config-read-tool.md` (конвенция `<date>-<topic>.md`):
риск «misconfig `maestro_config` (stale merge-config / обход plugin guard) →
сабагент читает параметры конфига» + митигация (`ask` + per-agent deny +
fail-closed plugin guard + аудит `maestro_config:access_denied`) +
тесты-проверки (§4, п. 7–10).

## 4. Тесты

`plugins/maestro-bootstrap/index.test.js` (TDD, red→green в составе план-
задач; паттерны фэйков — существующие: `fakeClient`, tmp-dir конфиг):

1. Весь конфиг: `exists: true`, `config` deep-equal записанному, `path` —
   резолвлённый; аудит `maestro_config:read` (`ok`).
2. `section` top-level (`memory`) и вложенный dot-path
   (`memory.embedding.model`).
3. Секции нет → `section_found: false`, `config: null`; аудит
   (`section_missing`).
4. Файла нет → `{exists: false, config: {}}`; аудит (`file_missing`).
5. Невалидный JSON → `parse_error: true`; аудит (`parse_error`).
6. Невалидный `section` (пустая / ведущая точка / пустой сегмент) →
   сообщение об ошибке, без выброса.
7. Guard: task-сессия (`parentID` задан) → deny-сообщение + аудит
   `maestro_config:access_denied` (`task_session`), в выдаче нет данных.
8. Guard: сервис-сессия (title `[maestro-memory] …`) → deny
   (`service_session`).
9. Guard: `ctx.sessionID` ∈ SESSIONS-множеству plugin-сессий (fast-чек,
   без `client.session.get`) → deny (`service_session`).
10. Guard: ошибка `client.session.get` / отсутствие `ctx.sessionID` →
    deny (`session_unavailable`) — fail-closed.
11. Guard: primary-сессия (нет `parentID`, обычный title) → ok.
12. Тул зарегистрирован **без** секции `memory` (бескондиционно) — в tool-хуке
    плагина присутствует `maestro_config`.
13. `MAESTRO_CONFIG` env-override — `path` в ответе = переопределённый.

Гейт: `node --test plugins/maestro-bootstrap/index.test.js` — зелёный
(baseline 236 + новые).

`docs/testing/maestro-sandbox-checklist.md` — строка проверки: канон
скиллов/команд не содержит «чтение через bash» для `maestro.json`;
`maestro_config` в primary работает; сабагент — deny; диагностические
ветки недоступности (@maestro-memory Шаг 1.2, @maestro-memory-report
Шаг 1/1a) конфиг не читают и не вызывают `maestro_config` в состоянии
«тул отсутствует» (сообщение о перезапуске/обновлении, §3.4a).

## 5. Версия

- 4.8.0 → **4.9.0** (minor: новая фича — тул плагина + процессный канон).
- Changelog: `## [2026-09-24]` → `> **Версия 4.9.0** — Minor-релиз: read-тул
  плагина `maestro_config` — санкционированный канал чтения параметров
  конфига в сессиях (правило «`maestro.json` читает только плагин»); P6
  переформулирован.»
- Step 18 (после merge): bump `package.json`, `project-context.md` §3,
  README (по факту наличия) + отдельный коммит `chore: bump version to
  4.9.0 — <содержание> (changelog/version)`.

## 6. Вне scope

- Нативный bash-deny по строгим командам (Q4: value/cost, консистентность R6).
- Элевация правила до инварианта ⚑5 в `skills/maestro/invariants.md` —
  только явное решение человека (invariants.md:66-68); ИИ не инициирует.
- Контур `docs/confidential/**` (custodian) — не меняется.
- Чтение `.maestro/logs/*` через bash — не меняется.
- `.opencode/`-mirror (dogfooding) — `agpack sync` после push; не часть
  изменения репозитория.
- Семантика `loadMaestroConfig` (env-override, `{}` при отсутствии) —
  сохраняется.
- `feedback_report` — не мигрируется (уже не читает `maestro.json`).

## 7. Критерии приёмки

1. Read-only тул `maestro_config` (§3.1): регистрация бескондиционная,
   fail-closed top-level primary guard, аудит-строки.
2. Канон R6 + 8 флоу (skills/commands): «чтение через bash» для
   `maestro.json` отсутствует; existence-only `test -f` задокументирован;
   диагностические/fallback-ветки «тул недоступен» не читают конфиг и не
   вызывают `maestro_config` в состоянии «тул отсутствует» (правило
   вывода §3.4a); `@maestro-memory-report` Шаг 1a сужен (§3.4a).
3. Нативные permissions: `"maestro_config": "ask"` + per-agent deny —
   эталон R6, генерация `/maestro-setup`, локальный dogfooding-конфиг.
4. `SECURITY.md` P6 переформулирован (§3.5) + зеркала `manual_docs/` синхрон.
5. `project-context.md`: §6/§12 — правило; §3 — версия (step 18).
6. Regression entry заведена.
7. Тесты зелёные (`node --test`); sandbox-чеклист обновлён.
8. Версия 4.9.0 + changelog (step 18).

## 8. Риски

- **Stale merge-config** (тул отсутствует в permission-карте) → opencode
  default-allow для нового тула: покрывается plugin guard (fail-closed) +
  идемпотентная доборка «только добавлять» (setup/assistant).
- **`ask` на каждый вызов** — UX-цена boundary-доступа (паритет edit-ask);
  смягчена формой Q1(a): 1–2 вызова за сессию (full-config одним вызовом).
  Авто-режимы (`--auto-answer`/`--auto-ai`, P8) ask-промпт не авточинят —
  нативный ask есть per-call HITL: авто-ран останавливается на первом
  вызове тула до ответа человека.
- **Residual bash-обход** — задокументирован (P6), не закрыт (паритет tamper).
- **Dogfooding-запаздывание:** правило вступает в силу для локальных сессий
  после `agpack sync` + рестарта opencode (плагин грузится из remote-кэша).

<!-- maestro:sanitize
status: CLEAN
date: 2026-09-24
hash: 1232a46d2688ed1914d3cf84d3f668416772bac2e90dbe4cb328e25429e46eb1
-->

<!-- maestro:review
reviewer: opus
date: 2026-09-24
verdict: approve
hash: 16979a6bb055d061456552ee05ba632bb439040723ae97cc35efdc2d7dcdae0e
-->
