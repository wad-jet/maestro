# Retire `confidential`: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Нативные permissions OpenCode — единственный барьер доступа к restricted-данным; секции `confidential` и `trust` удаляются из схемы `maestro.json`; memory работает без confidential-механики; dual mode без fail-open окна.

**Architecture:** Плагин перестаёт гейтить файлы в new-режиме (секция `confidential` отсутствует): enforcement-throw, built-in-гейт и P6-контур выключаются, остаются observability (shadow-аудит) и U1-sanitize. Новое: `loadNativeRestrictedSet` (derived-набор из нативных конфигов), плагинная директива `restricted-data paths: …` в system-контексте top-level primary, role-set `{custodian, sanitizer}` вместо секции `trust`. Legacy-режим (секция есть) — поведение как сегодня, кроме N1 (кастомные trusted-агенты lose плагинный файловый доступ — секция `trust` не читается).

**Tech Stack:** Node (built-in test runner, без новых зависимостей), ESM-модули `plugins/maestro-bootstrap/`, markdown-каноны `skills/`/`manual_docs/`, bash-генератор песочницы `maestro-sandbox.sh`.

**Spec:** `docs/superpowers/specs/2026-10-20-retire-confidential-design.md` (Версия 3, verdict approve). План аргументируется из спеки — исполнитель читает оба документа.

## Global Constraints

- Тесты — Node built-in test runner: `node --test plugins/maestro-bootstrap/index.test.js` (плагин), `npm run test:memory` (memory), `npm test` (полный набор, вкл. docs-drift, sandbox-smoke, diff).
- Все plugin-хуки — `try/catch`-обёрнуты, fail-soft (глобальный инвариант bootstrap-плагина).
- Рабочий язык — русский: warn-сообщения, доки, каноны, комментарии user-facing.
- **Никакого version bump в этом плане** — 6.3.0 → 6.4.0 делает оркестратор на шаге 18 после merge (spec §4.8).
- Legacy-enforcement код **не удаляется** (spec NG1 — будущий релиз); он работает под условием «секция есть» (dual mode, D5).
- Строка `[confidential:deny]` остаётся **только** для legacy-режима.
- F-нумерация спеки: I1–I4/M1–M10/N1–N7 — findings ревью; D1–D8 — решения; NG1–NG5 — non-goals.

## Review Focus

1. **Мерж нативных слоёв не так, как runtime** (edge: один pattern с разными actions в разных слоях) → derived-набор обязан быть ⊇ эффективного (over-аппроксимация безопасна, under-аппроксимация — нет); человек ожидает: путь под deny не исчезнет из директивы. → Тест в Task 2 (deny в любом слое без override → в набор; aсимметричный edit-only deny не попадает).
2. **Окно миграции (I2):** секция `confidential` удалена, а нативных deny ещё нет → ноль файловой защиты до обнаружения. Человек ожидает: drift-warn при старте плагина + предпроверку ассистента. → Тест drift-warn в Task 4; предпроверка — Task 8 (доки).
3. **Обновление проекта с `trust.<custom>: true` (N1):** кастомный агент теряет плагинный файловый доступ немедленно, в любом режиме. Человек ожидает: fail-closed deny без краха + warn `trust:deprecated_key` со списком ключей и подсказкой. → Тесты в Task 1 (B-pin) и Task 3 (legacy custom → deny).
4. **Сломанный/отсутствующий нативный конфиг** (нет файла, битый JSON, нет ключа `permission`) → пустой набор, без директивы, без краша плагина. → Тест в Task 2 (fail-soft).
5. **Строка §12 отсутствует/испорчена** (ручная правка project-context) → warn, директива всё равно инжектится из нативного конфига (source of truth). Человек ожидает: warn, а не ошибку. → Тест в Task 4.

---

## Task-карта и зависимости

| # | Task | Файлы (ядро) | Model | Зависимости |
|---|---|---|---|---|
| 1 | Trust: role-set (D6/B) | core.js, index.test.js | **opus** (key) | — |
| 2 | `loadNativeRestrictedSet` (D2/M1) | core.js, index.test.js | **opus** (key) | — |
| 3 | Dual mode + warn'ы (D5/N1) | core.js, index.test.js | **opus** (key) | 1, 2 |
| 4 | Директива + drift (D2/M2/M7) | restricted-data.js (new), core.js, index.test.js | **opus** (key) | 2, 3 |
| 5 | Shadow-аудит (D7/M3/M4) | core.js, index.test.js | **opus** (key) | 2, 3 |
| 6 | Memory: удаление confidential-механики (D3/M5/M9) | memory/*.js | **opus** (key) | — |
| 7 | Канон пайплайна (SKILL + references + invariants + custodian-prompt) | skills/maestro/** | sonnet | 1–5 (семантика) |
| 8 | Канон assistant + setup + docs-drift D-check (B/N2/I2/I4) | skills/maestro-assistant, skills/maestro-setup, maestro-install/docs-drift.test.mjs | sonnet | 7 |
| 9 | Вспомогательные каноны (memory/feedback-report/agents) | skills/maestro-memory, skills/maestro-feedback-report, agents/*.md | haiku | — |
| 10 | SECURITY.md (source of truth, N3) | SECURITY.md | **opus** (key) | 1–6 |
| 11 | manual_docs sync (I3) | manual_docs/**, README.md | sonnet | 10 |
| 12 | Sandbox / benchmark / чеклист (I1/N2/N5) | maestro-sandbox.sh, skills/maestro-benchmark/*, docs/testing/ | sonnet | 3, 5 |
| 13 | Финальный gate: полный набор + остаточный grep | — | haiku | 1–12 |

Task 1–5 последовательно (один файл core.js). Task 6 параллелен 1–5 (отдельный модуль). Task 7–9 — доки (параллельно между собой после 1–5). Task 10–13 последовательно.

---

### Task 1: Trust — role-set (D6/B)

**Files:**
- Modify: `plugins/maestro-bootstrap/core.js` (`loadTrustConfig` ~line 377; sanitize-блок `tool.execute.before` ~line 1027 — без изменений, работает с новым set)
- Test: `plugins/maestro-bootstrap/index.test.js`

**Interfaces:**
- Produces: `loadTrustConfig(config: object) -> Set<string>` — **всегда** `new Set(["custodian", "sanitizer"])` независимо от `config.trust` (секция не читается). Новый экспорт `deprecatedTrustKeys(config: object) -> string[]` — ключи секции `trust` (для warn-а при init).
- Consumes: — (не зависит от других tasks).
- Используется в: Task 3 (legacy-enforcement получает role-set), Task 4 (feedback-report `byTrusted`), Task 5 (shadow-аудит agent).

- [ ] **Step 1: Написать failing-тесты** (новый `describe("trust role-set (B)")` в `index.test.js`):
  - `loadTrustConfig({})` → `{"custodian","sanitizer"}`;
  - `loadTrustConfig({ trust: { custodian: false, sanitizer: true, custom: true } })` → тот же набор (значение игнорируется);
  - `deprecatedTrustKeys({ trust: { a: true, b: false } })` → `["a","b"]`; `deprecatedTrustKeys({})` → `[]`;
  - **B-pin U1:** диспатч в кастомного агента с `trust: { custom: true }` — промпт **маскируется** (reuse harness блока «Sanitize subagent prompt»: assert `sanitizer.redacted` / `res.count > 0`);
  - **warn при init:** plugin-init с `trust: { custom: true }` → `log.warn("trust:deprecated_key", …)` один раз, аргумент содержит список `["custom"]` (reuse harness инициализации плагина из существующих init-тестов).
- [ ] **Step 2: Запустить, убедиться что падают**

Run: `node --test plugins/maestro-bootstrap/index.test.js`
Expected: FAIL (новые тесты; `loadTrustConfig` ещё читает `config.trust`)

- [ ] **Step 3: Реализовать в `core.js`**
  - `const ROLE_TRUSTED_AGENTS = new Set(["custodian", "sanitizer"]);`
  - `loadTrustConfig` → возвращает `new Set(ROLE_TRUSTED_AGENTS)` (тело без чтения `config.trust`).
  - `export function deprecatedTrustKeys(config)` → `Object.keys(config?.trust ?? {})`.
  - В init-контуре плагина (`createBootstrapPlugin`, рядом с `loadConfidentialConfig`): если `deprecatedTrustKeys(config).length > 0` → `log.warn("trust:deprecated_key", { keys, hint: "кастомные агенты из trust теряют плагинный файловый доступ — при необходимости нативный per-agent allow" })` (однократно на init).
- [ ] **Step 4: Запустить тесты**

Run: `node --test plugins/maestro-bootstrap/index.test.js`
Expected: PASS (в т.ч. существующие sanitize-тесты — role-set ⊇ старых дефолтов для custodian/sanitizer)

- [ ] **Step 5: Commit**

```bash
git add plugins/maestro-bootstrap/core.js plugins/maestro-bootstrap/index.test.js
git commit -m "feat(trust): role-set {custodian, sanitizer} instead of trust section (B)"
```

---

### Task 2: `loadNativeRestrictedSet` (D2/M1)

**Files:**
- Modify: `plugins/maestro-bootstrap/core.js` (новый экспорт, рядом с `isConfidentialTarget`)
- Test: `plugins/maestro-bootstrap/index.test.js`

**Interfaces:**
- Produces: `loadNativeRestrictedSet(root: string) -> { dataPaths: string[], agentAllows: Map<string, string[]> }`
  - Слои (порядок, каждый опционален): global XDG `~/.config/opencode/opencode.json[c]` → root `opencode.json[c]` → `.opencode/opencode.json[c]`.
  - Извлекает **только `read`** (M1): `permission.read` (deny-паттерны → `dataPaths`) и `agent.*.permission.read` (deny → `dataPaths`, allow → `agentAllows.get(agent).push(pattern)`). Асимметричный конфиг (deny только `edit`) не попадает.
  - Мерж: на уровне «tool → pattern» последний (более близкий) слой побеждает; deny в любом слое без override в более высоком → в набор.
  - Exclusion из `dataPaths`: точные `maestro.json`, `.maestro/**`, built-in (`.env`, `.env.*`, `*.pem`, `*.key`, `*.crt`, `*.p12`, `*.pfx`).
  - Сломанный/отсутствующий файл — пропускается (fail-soft, без throw).
- Consumes: — (автономен; использует `fs`/`path`, `confGlobMatch` не требуется).
- Используется в: Task 3 (mode-данные), Task 4 (директива + drift), Task 5 (shadow-аудит).

- [ ] **Step 1: Написать failing-тесты** (новый `describe("loadNativeRestrictedSet")`; конфиги — во временных каталогах, global-слой — monkeypatch XDG-пути через helper или фиксированный temp-дом):
  - deny `read` в одном слое → паттерн в `dataPaths`;
  - override тем же pattern в более высоком слое → паттерн **не** в `dataPaths` (key-level override);
  - deny в низком слое без override в высоком → в набор;
  - per-agent allow `agent.custodian.permission.read: { "docs/confidential/*": "allow" }` → `agentAllows.get("custodian")` содержит паттерн;
  - exclusion: deny `maestro.json`, `.maestro/**`, `*.env` → не в `dataPaths`;
  - edit-only deny → **не** в `dataPaths` (M1);
  - битый JSON / отсутствующий файл → пустой результат, без throw;
  - нет ни одного конфига → `{ dataPaths: [], agentAllows: new Map() }`.
- [ ] **Step 2: Запустить, убедиться что падают**

Run: `node --test plugins/maestro-bootstrap/index.test.js`
Expected: FAIL («loadNativeRestrictedSet is not a function»)

- [ ] **Step 3: Реализовать `loadNativeRestrictedSet(root)` в `core.js`**

Подход: один `readJsonLayer(file)` (fail-soft) → итерация слоёв global→root→.opencode с накоплением `Map<pattern, { action, agent? }>` (последний слой перезаписывает entry) → фильтрация deny → exclusion → `{ dataPaths, agentAllows }`. Global-путь — через `os.homedir()` + `.config/opencode/` с возможностью override для тестов (например, аргумент `{ home }` в ops-объекте — решение строителя, пин — имя функции и контракт возврата).

- [ ] **Step 4: Запустить тесты**

Run: `node --test plugins/maestro-bootstrap/index.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugins/maestro-bootstrap/core.js plugins/maestro-bootstrap/index.test.js
git commit -m "feat(restricted): loadNativeRestrictedSet — derived set from native configs"
```

---

### Task 3: Dual mode + warn'ы (D5/N1)

**Files:**
- Modify: `plugins/maestro-bootstrap/core.js` (блок «Confidential control» ~line 994–1021; init-контур)
- Test: `plugins/maestro-bootstrap/index.test.js` (блок `describe("maestro-bootstrap confidential config")` ~line 1236)

**Interfaces:**
- Consumes: `loadTrustConfig`/role-set (Task 1), `loadNativeRestrictedSet` (Task 2).
- Produces: поведение по режимам — legacy (секция `confidential` есть в конфиге): существующий enforcement без изменений для стандартного ростера и primary; new (секции нет): **нет** enforcement-throw, нет built-in-гейта, нет P6-гейта (shadow-аудит — Task 5). Init-warn `confidential:legacy_active` (legacy, однократно).
- N1: в legacy-режиме кастомные агенты из `trust` — untrusted (role-set) → deny на чтениях (тест).

- [ ] **Step 1: Написать failing-тесты**
  - **Тест-гард (i) new-режим:** конфиг **без** `confidential`-секции; read-вызов primary к `docs/confidential/x.md` (нативный deny) → **не** бросается `[confidential:deny]` (test «no plugin file-access enforcement in new mode»);
  - **Тест-гард (ii) legacy-режим:** конфиг **с** `confidential: { paths: ["docs/confidential/**"] }` → primary получает `[confidential:deny]`, trusted (custodian) — allow (существующие тесты блока переносятся под условие «секция есть»);
  - **N1:** legacy + `trust: { custom: true }` → диспатч read кастомного агента на confidential-путь → deny;
  - built-in (`.env`) и P6 (`maestro.json`): legacy → гейтится; **new-режим → не гейтится плагином** (нативно — за ядром);
  - warn: legacy → `log.warn("confidential:legacy_active")` один раз; new → warn'а нет.
  - Существующие тесты блока, ожидающие enforcement, **получают** `confidential`-секцию в конфиге (legacy-условие).
- [ ] **Step 2: Запустить, убедиться что падают**

Run: `node --test plugins/maestro-bootstrap/index.test.js`
Expected: FAIL (new-режим ещё гейтит; warn'ов нет)

- [ ] **Step 3: Реализовать в `core.js`**
  - `const isLegacy = Boolean(config?.confidential && typeof config.confidential === "object");`
  - Блок «Confidential control»: `if (isLegacy) { …существующая логика… }` (enforcement + built-in + P6 без изменений; trustedAgents = role-set из Task 1); в new-режиме блок заменяется placeholder-комментарием (shadow-аудит подключается в Task 5).
  - Init: `if (isLegacy) log.warn("confidential:legacy_active", { hint: "legacy-enforcement активен; секция игнорируется в будущем релизе; миграция — /maestro-assistant" })`.
- [ ] **Step 4: Запустить тесты**

Run: `node --test plugins/maestro-bootstrap/index.test.js`
Expected: PASS (legacy-тесты — прежний набор под условием; new-тесты — зелёные)

- [ ] **Step 5: Commit**

```bash
git add plugins/maestro-bootstrap/core.js plugins/maestro-bootstrap/index.test.js
git commit -m "feat(confidential): dual mode — legacy enforcement only when section present"
```

---

### Task 4: Директива + drift-сверка (D2/M2/M7)

**Files:**
- Create: `plugins/maestro-bootstrap/restricted-data.js`
- Modify: `plugins/maestro-bootstrap/core.js` (init-контур: регистрация хуков + drift-сверка), `plugins/maestro-bootstrap/index.js` (re-export, если по паттерну communication)
- Test: `plugins/maestro-bootstrap/index.test.js` (новый `describe("restricted-data directive")`, паттерн communication-тестов)

**Interfaces:**
- Produces:
  - `restrictedDirectiveText(paths: string[]) -> string` → `"restricted-data paths: p1, p2"` (одна строка, repo-relative, через запятую — формат из spec §8).
  - `registerRestrictedDataHooks({ client, log, getDataPaths }) -> { "experimental.chat.system.transform", dispose }` — паттерн `communication.js`: V2 `client.session.hook("context", …)` + V1 `system.transform`; isEligible = top-level (`!data.parentID`) + не service-сессия (`SERVICE_TITLE_PREFIX`); дедуп по маркеру `restricted-data paths:`; пустой набор → не инжектить; legacy: `getDataPaths()` возвращает union(native, `confidential.paths`) (колбэк из core).
  - Drift-сверка при init: читать `docs/project-context.md` (root), искать строку-зеркало регуляркой `/\*\*Confidential-данные:\*\*\s*(.+)/` (строка — буллет внутри §12); разобрать пути (через запятую); расхождение с `dataPaths` (включая отсутствие строки при непустом наборе и битую строку) → `log.warn("confidential:drift", { directive, section12 })` (имя warn'а — фиксировано тестом; spec §8 допускает смену, но тесты фиксируют текущее).
- Consumes: `loadNativeRestrictedSet` (Task 2), mode (Task 3).

- [ ] **Step 1: Написать failing-тесты**
  - `restrictedDirectiveText(["a/b", "c/d"])` → `"restricted-data paths: a/b, c/d"`;
  - **тест-гард (iii):** top-level primary-сессия → директива в `event.system`; task-сессия (с `parentID`) → **нет** директивы; service-сессия → нет;
  - пустой набор → нет директивы;
  - legacy: union — набор = native ∪ `confidential.paths` (тест с оба);
  - дедуп: повторный вызов хука на той же сессии — одна строка;
  - **drift:** (a) §12 = набору → warn'а нет; (b) расхождение → warn `confidential:drift`; (c) строки нет (набор непуст) → warn; (d) project-context.md отсутствует/битый → warn, без throw, директива всё равно инжектится;
  - fail-soft: сбой в хуке не роняет сессию (try/catch).
- [ ] **Step 2: Запустить, убедиться что падают**

Run: `node --test plugins/maestro-bootstrap/index.test.js`
Expected: FAIL (модуль не существует)

- [ ] **Step 3: Реализовать `restricted-data.js` + регистрацию в core**
  - Структура хуков — копия `registerCommunicationHooks` (isEligible + inject + V1/V2), за исключением label-логики communication.
  - Drift-сверка — отдельная функция в `restricted-data.js` (`checkSection12Drift(root, dataPaths, log)`), вызывается из init core после `loadNativeRestrictedSet`.
  - `getDataPaths` в core: `() => isLegacy ? union(nativeSet.dataPaths, confidential.paths) : nativeSet.dataPaths`.
- [ ] **Step 4: Запустить тесты**

Run: `node --test plugins/maestro-bootstrap/index.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugins/maestro-bootstrap/restricted-data.js plugins/maestro-bootstrap/core.js plugins/maestro-bootstrap/index.js plugins/maestro-bootstrap/index.test.js
git commit -m "feat(restricted-data): directive for top-level primary + section-12 drift check"
```

---

### Task 5: Shadow-аудит (D7/M3/M4)

**Files:**
- Modify: `plugins/maestro-bootstrap/core.js` (new-режимная ветка блока «Confidential control», placeholder из Task 3)
- Test: `plugins/maestro-bootstrap/index.test.js`

**Interfaces:**
- Consumes: `loadNativeRestrictedSet` (`dataPaths`, `agentAllows`, Task 2), `confGlobMatch` (существующий, line 450).
- Produces: new-режим: tool ∈ `{read, edit, write, glob, grep}` + target (path-аргумент) матчит `dataPaths` (confGlobMatch по какому-либо паттерну) → `auditLog.info("confidential.access", { sessionID, callID, tool, action: outcome, agent, target: path.basename(target) })`. `outcome`: agent имеет per-agent allow на матч-паттерн (`agentAllows`) → `"allow"`; agent нерезолвимо (нет agent-информации) → `"unknown"`; иначе → `"deny"`. **Нет throw**, event не модифицируется. Frontmatter агентов не учитывается (M4 — только JSON-конфиги).
- Legacy-режим: существующий аудит (action allow/deny) без изменений.

- [ ] **Step 1: Написать failing-тесты**
  - new-режим, read к `docs/confidential/x.md`, agent `custodian` с нативным allow → `confidential.access` c `action: "allow"`, `target: "x.md"` (basename, **не** полный путь);
  - agent без allow → `action: "deny"`; без agent-информации → `action: "unknown"`;
  - tool `glob`/`grep` с path-аргументом под `dataPaths` → логируется;
  - путь вне `dataPaths` → нет записи;
  - **нет** `[confidential:deny]` в любом из случаев (throw отсутствует);
  - legacy-режим → аудит как раньше (action allow/deny по `resolveConfidentialAction`).
- [ ] **Step 2: Запустить, убедиться что падают**

Run: `node --test plugins/maestro-bootstrap/index.test.js`
Expected: FAIL (new-режим не логирует)

- [ ] **Step 3: Реализовать new-режимную ветку в «Confidential control»**
  - `filePathOf` расширить/проверить для `glob`/`grep` path-аргументов (решение строителя — как извлекать path из `event.input` у этих тулов; пин — поведение по тестам).
  - Outcome-логика по `agentAllows` (Map из Task 2); `trustInfo.agent` — из `resolveIsTrustedSubagent` (кэшированный, как в legacy).
- [ ] **Step 4: Запустить тесты**

Run: `node --test plugins/maestro-bootstrap/index.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugins/maestro-bootstrap/core.js plugins/maestro-bootstrap/index.test.js
git commit -m "feat(audit): shadow-audit for restricted paths in new mode (mirror, not enforcement)"
```

---

### Task 6: Memory — удаление confidential-механики (D3/M5/M9/I4)

**Files:**
- Modify: `plugins/maestro-bootstrap/memory/mask.js`, `artifacts.js`, `indexer.js`, `recall.js`, `index.js`, `backfill.js`, `backup.js`, `backup-cli.js`, `config.js`, `validation.js`
- Test: `plugins/maestro-bootstrap/memory/mask.test.js`, `backfill.test.js`, `backup.test.js`, `index.test.js`, `artifacts.test.js`, `indexer.test.js`, `recall.test.js`, `config.test.js`, `validation.test.js`

**Interfaces:**
- Produces: memory-pipeline без `confidentialPatterns`/`maskLines`/`skip_confidential`/`maskPatterns.confidential`/artifact-drop по confidential-паттернам. Остаётся generic `sanitize()` (regex Ур.1: key=value, .env, PEM, PII).
- Детали (spec §4.2 + M9):
  - `mask.js`: удалить `maskLines`; production-вызовы `maskTranscript` — без `confidentialPatterns` (signature — решение строителя: убрать параметр или no-op, spec §8); `maskEntry` — без confidential-artifact-drop.
  - `indexer.js`/`recall.js`/`index.js` (tool `memory_search`): `confidentialPatterns` не передаётся; query маскируется только generic `sanitize`.
  - `index.js`: call-site `memory_recall_preview` — без confidential-маскирования query.
  - `backfill.js` (`memory_reindex` git-история): удалить `skip_confidential` — кандидаты только по `history_globs`/`artifact_globs`.
  - `backup.js`/`backup-cli.js`: удалить `maskPatterns.confidential`/`artifacts`; остаётся generic-sanitize записи + manifest-проверки.
  - `validation.js` (`validateImportEntry`): удалить CR-3 confidential-artifact-drop.
  - `config.js`: удалить init-warn'ы по `confidential.paths` (centralized backend, openai embedder, `memory:log_confidential_note`).
- Consumes: — (изолирован от Task 1–5; общий `sanitize` не меняется).

- [ ] **Step 1: Написать/обновить тесты (failing)**
  - `mask.test.js`: удалить confidential-lines тесты; добавить/сохранить generic-sanitize тесты (key=value, PEM, PII маскируются; бизнес-текст без секретов — не маскируется);
  - `backfill.test.js`: кандидаты под `history_globs` проходят **без** skip (в т.ч. файл, имя которого матчит старый confidential-паттерн — теперь допустим по allowlist);
  - `backup.test.js`: manifest без `maskPatterns.confidential`/`artifacts`; restore — generic-sanitize;
  - `validation.test.js`: импорт записи с artifact-путём, матчащим confidential-паттерн, — **принимается** (CR-3 drop удалён);
  - `indexer.test.js`/`recall.test.js`/`index.test.js`: `confidentialPatterns` не фигурирует; query в `memory_recall_preview` — generic sanitize.
  - Существующие тесты, завязанные на confidential-механику, — удалить/переписать по grep `confidential` в `memory/*.test.js`.
- [ ] **Step 2: Запустить, убедиться что падают**

Run: `npm run test:memory`
Expected: FAIL (механика ещё работает/тесты новые)

- [ ] **Step 3: Удалить механику** (по пунктам Interfaces; grep `confidential` в `plugins/maestro-bootstrap/memory/*.js` — остаток только легитимный: generic-комментарии, имена переменных без semantics)
- [ ] **Step 4: Запустить тесты**

Run: `npm run test:memory`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugins/maestro-bootstrap/memory/
git commit -m "feat(memory): remove confidential masking mechanics (generic sanitize only)"
```

---

### Task 7: Канон пайплайна (SKILL + references + invariants + custodian-prompt)

**Files:**
- Modify: `skills/maestro/SKILL.md`, `skills/maestro/references/trust-and-security.md` (переписать), `skills/maestro/references/hitl-gate-protocol.md`, `skills/maestro/references/model-selection.md`, `skills/maestro/references/example-workflow.md` (точечные по grep), `skills/maestro/invariants.md` (line 34), `skills/maestro/custodian-prompt.md` (пометка источника `{confidential_paths}`)

**Interfaces:**
- Consumes: семантика Task 1–5 (role-set, dual mode, директива, shadow-аудит).
- Produces: канон-тексты (используются Task 8/10/11 как источник формулировок).
- Детали (spec §4.3):
  - `SKILL.md` шаг 0: источник = **плагинная директива**; «нет директивы — confidential-данных нет, кроме built-in секретов: `.env`/`.env.*` — дефолт ядра; `*.pem/…` — init-базелин (M7)»; определение trusted — **по роли**;
  - шаг 8: `{confidential_paths}` — из директивы (legacy: union);
  - **dead-ветки:** строка шага 9 «Trusted opus (если есть в maestro.json) → skip U1» (~line 594) и special case шага 10b «(a) opus-trusted (B-5)» — удалить/переписать;
  - таблица «Обработка сбоев»: строка `confidential:deny` — пометка «legacy-режим (секция есть)»; в new-режиме — нативный permission error (canonical-описание);
  - `trust-and-security.md` — переписать: Точка 1 = нативные permissions (fail-closed); shadow-аудит — observability; dual mode; trust B (секции нет, role-set); **Trust Matrix** (стандартные — always untrusted для U1, файловый доступ нативно); таблица уровней; подсекция **«Как применять»** (dead steps 1–2: per-dispatch trust-lookup — переписать: решение U1 по роли); P4a non-functional — недостижим;
  - `hitl-gate-protocol.md`, `model-selection.md`, `example-workflow.md` — точечные правки по grep `confidential`/`trust` (смысл: источник путей = директива/нативный конфиг);
  - `invariants.md` line 34: «механический пол (Ур.1 маскирование task-промптов и confidential-deny…)» → «Ур.1 маскирование task-промптов + нативная файловая защита (permissions ядра)»;
  - `custodian-prompt.md`: параметр `{confidential_paths}` — пометка «оркестратор передаёт из плагинной директивы»; тело self-contained без изменений.

- [ ] **Step 1: grep-инвентаризация**

Run: `grep -rn "confidential\|trust\." skills/maestro/SKILL.md skills/maestro/references/ skills/maestro/invariants.md skills/maestro/custodian-prompt.md`
Expected: список строк для правок (согласовать с деталями выше)

- [ ] **Step 2: Применить правки** (по пунктам; `trust-and-security.md` — целенаправленная переписка главы)
- [ ] **Step 3: Проверка остатков**

Run: `grep -rn "trust\.custodian\|trust\.sanitizer\|confidential\.paths" skills/maestro/`
Expected: только легитимные упоминания (legacy-пометки, маркер «из confidential», historical-контекст)

- [ ] **Step 4: Проверка целостности канонов**

Run: `node --test skills/maestro/references-coverage.test.mjs`
Expected: PASS (указатели references не сломаны)

- [ ] **Step 5: Commit**

```bash
git add skills/maestro/
git commit -m "docs(skills): pipeline canon — native barrier, role-trust, directive source"
```

---

### Task 8: Канон assistant + setup + docs-drift D-check (B/N2/I2/I4)

**Files:**
- Modify: `skills/maestro-assistant/SKILL.md`, `skills/maestro-setup/SKILL.md`, `maestro-install/docs-drift.test.mjs`
- Test: `maestro-install/docs-drift.test.mjs` (новая D-проверка)

**Interfaces:**
- Produces: канон `maestro.json` без секций `confidential` и `trust`; P4-check в безусловном role-based виде; воркфлоу «Настройка restricted-путей» и «Миграция legacy → new».
- Consumes: Task 7 (формулировки), Task 1–5 (семантика).
- Детали (spec §4.3):
  - **assistant** inline-канон JSON: убрать `"confidential"` и `"trust"`; правило: «любая `trust` в старых конфигах — warn + игнор; trusted — custodian/sanitizer по роли; файловый доступ кастомных агентов — нативный per-agent allow, не trust»; ⚠️-блок P4a и правила вывода trust — переписать; **P4-check — безусловный role-based** (без «если `trust.custodian` включены»);
  - удалить секцию «Правка `confidential.paths` (IMP-3)» и sync-правило I3 в старой форме;
  - новый воркфлоу **«Настройка restricted-путей»**: одна операция пишет (a) нативные deny `read`/`edit`/`glob`/`grep` в merge-config + per-agent allow custodian/sanitizer, (b) строку `**Confidential-данные:** p1, p2` в project-context §12 (канонический формат M2); HITL-гейт с diff; снятие с защиты — адресный diff + отдельное HITL;
  - новый воркфлоу **«Миграция legacy → new»** (I2, зафиксированный порядок): **шаг 0 (ДО обновления плагина, N1):** если есть `trust.<custom>` — уведомить о немедленной потере плагинного файлового доступа + при необходимости нативный per-agent allow (отдельное HITL) → (1) нативные deny + allow + строка §12 (одна операция) → (2) restart + **live-проверка нативного deny** → (3) **только затем** удалить секцию (адресный diff + отдельное HITL) → (4) restart + проверка директивы/new-режима. Предпроверка удаления секции = нативные deny на все пути §12; warn `confidential:drift` — детектор нарушенного порядка;
  - **канон-строка (I4):** «restricted-пути не добавляются в `memory.history_globs`/`memory.artifact_globs`»;
  - детектор дрейфа (консультация, шаг 2): сверка нативных deny ↔ §12.
  - **setup**: генерируемый `maestro.json` — **без** `confidential` и `trust` (N2: убрать `trust.custodian/sanitizer: true` из шаблона); warn 6.1.0 «non-memory ключи (включая trust/confidential/…)» — переформулировать; P4-check setup — безусловный role-based; + строка §12 в генерируемый project-context.
- **D-проверка (docs-drift):** inline-канон `maestro.json` в `skills/maestro-assistant/SKILL.md` НЕ содержит ключи `"confidential"` и `"trust"`.

- [ ] **Step 1: Написать failing D-проверку** в `maestro-install/docs-drift.test.mjs` (паттерн существующих D-проверок: parse inline-JSON-блока канона, assert `!("confidential" in canon)` и `!("trust" in canon)`)
- [ ] **Step 2: Запустить, убедиться что падает**

Run: `node --test maestro-install/docs-drift.test.mjs`
Expected: FAIL (канон ещё несёт оба ключа)

- [ ] **Step 3: Переписать каноны** (assistant + setup по деталям выше)
- [ ] **Step 4: Запустить тесты**

Run: `node --test maestro-install/docs-drift.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add skills/maestro-assistant/SKILL.md skills/maestro-setup/SKILL.md maestro-install/docs-drift.test.mjs
git commit -m "docs(canon): assistant/setup — no confidential/trust sections, migration workflow, D-check"
```

---

### Task 9: Вспомогательные каноны (memory / feedback-report / agents)

**Files:**
- Modify: `skills/maestro-memory/references/status.md` (+ остальные `skills/maestro-memory/references/*.md` по grep), `skills/maestro-feedback-report/SKILL.md`, `agents/custodian.md`, `agents/sanitizer.md`

**Interfaces:**
- Consumes: Task 6 (memory-семантика), Task 5 (shadow-аудит-поля).
- Produces: — (листовые каноны).
- Детали:
  - `maestro-memory/references/status.md` (+ grep-остатки): убрать упоминание confidential-набора из диагностики;
  - `maestro-feedback-report/SKILL.md`: секция «confidential.access» → «N попыток (M от trusted, K unknown)» (по shadow-аудиту, поля `action: allow|deny|unknown`);
  - `agents/custodian.md`/`agents/sanitizer.md`: убрать stale-формулы `trust.X: false → untrusted`, «Доверие определяется конфигом, не этим промптом» → «доверие — по роли (hardcoded role-set)».

- [ ] **Step 1: grep-инвентаризация**

Run: `grep -rn "confidential\|trust" skills/maestro-memory/ skills/maestro-feedback-report/ agents/`
Expected: список для правок

- [ ] **Step 2: Применить правки** (по деталям)
- [ ] **Step 3: Проверка**

Run: `node --test skills/maestro-memory/references-coverage.test.mjs`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add skills/maestro-memory/ skills/maestro-feedback-report/ agents/
git commit -m "docs(canon): memory/feedback-report/agents — role-trust, shadow-audit shape"
```

---

### Task 10: SECURITY.md (source of truth, N3)

**Files:**
- Modify: `SECURITY.md` (§2, P1, P4a, P5, P6, SEC-5, §4, §5)

**Interfaces:**
- Consumes: итоговая семантика Task 1–6.
- Produces: актуальный ИБ-стандарт (используется Task 11 для manual_docs).
- Детали (spec §4.4):
  - **§2 «Модель доверия»:** trust = role-set по роли, секции в конфиге нет; fail-closed — по роли (role-set trusted **и при отсутствии** `maestro.json`); барьер для primary — нативный (new) / плагинный (legacy); удалить «trust привязан к имени агента (maestro.json → trust)», «отсутствие maestro.json → все untrusted», «плагин deny'ит root/primary»;
  - **P1:** доступ к confidential-данным — нативные permissions (deny + per-agent allow); плагин — observability (shadow-аудит), не enforcement (кроме legacy);
  - **P4a:** секция `trust` удалена; trusted = role-set (hardcoded); non-functional mode недостижим; P4-check ассистента — безусловный; кастомные агенты всегда U1-masked (принятое ограничение + обходные пути `by_agent`/`allow_values`); снятие доступа custodian — только нативный конфиг;
  - **P5:** файловая защита не зависит от плагина (нативный fail-closed); плагин обязателен для U1-sanitize, merge-guard, observability, memory;
  - **P6:** root-слои — нативный канон; глобальный слой + `MAESTRO_CONFIG` — документированный residual (parity с `bash cat`); отметить `external_directory: ask` (сужает residual);
  - **SEC-5:** memory не маскирует бизнес-confidential (только generic); каналы (a)–(d), включая **git-backfill** (I4); митигации: локальный embedder+sqlite по умолчанию, allowlist, канон-строка «restricted-пути не в globs»; централизованные бэкенды — осознанный выбор;
  - **§4 контрмеры:** нативный permission-бастион — основной; плагин — U1 (fail-closed), shadow-аудит, merge/commit-guard, observability; legacy — до миграции;
  - **§5 ограничения:** fail-open → снимается для файлового слоя; residual по P6/SEC-5/BAU.

- [ ] **Step 1: Применить переписку** (разделы по деталям; сохранить структуру/нумерацию требований P-серии)
- [ ] **Step 2: Сверка с планом-спекой**

Run: `grep -n "trust\|confidential" SECURITY.md | head -40`
Expected: противоречий с P4a/§2 нет (trust — только в формулировках role-set/legacy)

- [ ] **Step 3: Commit**

```bash
git add SECURITY.md
git commit -m "docs(security): native barrier as source of truth — role-trust, SEC-5 channels a-d"
```

---

### Task 11: manual_docs sync (I3)

**Files:**
- Modify: `manual_docs/reference/config.md`, `manual_docs/explanation/agents-and-trust.md`, `manual_docs/reference/memory.md`, `manual_docs/reference/model-selection.md`, `manual_docs/how-to/manage-confidential-paths.md` (**полная переписка**), `manual_docs/explanation/pipeline-overview.md`, `manual_docs/tutorials/setup-project.md`, `manual_docs/overview/what-is-maestro.md`, `manual_docs/index.md`, остальные `manual_docs/tutorials/*`, `manual_docs/reference/hitl-gates.md`, `manual_docs/reference/commands.md`, `manual_docs/how-to/memory-backup-restore.md`, `README.md` (строки 150–156/193–194)

**Interfaces:**
- Consumes: Task 10 (SECURITY-формулировки), Task 8 (имена воркфлоу).
- Produces: синхронные user-доки (AC 6).
- Детали (spec §4.5):
  - `config.md`: секция `confidential` → «Restricted-данные: нативные permissions (источник) + project-context §12 (документация)»; `trust` — удалена («доверие по роли; любой `trust` — warn + игнор»);
  - `agents-and-trust.md`: переписать модель доверия (барьер = нативный; custodian — Q/A-брокер по нативному allow; U1 — отдельный слой; кастомные — обходные пути);
  - `memory.md`: маскирование только generic; SEC-5-риск (каналы a–d); backup без confidential-double-masking;
  - `model-selection.md`: P4a-строка (role-trusted) + U1-семантика вне role-set + блок «Отношение к trust-модели» (lines 94–107) — переписать (N6);
  - **`manage-confidential-paths.md` — полная переписка** в how-to «Настройка restricted-путей» (воркфлоу из Task 8; старый механизм — удалён);
  - `pipeline-overview.md`: строка шага 0 — источник = плагинная директива;
  - `setup-project.md` («Проверка confidential-инварианта»): live-чек в new-режиме = **нативный permission error** (не `[confidential:deny]`; последний — legacy);
  - grep-свип остальных файлов по `confidential` + `trust`;
  - `README.md`: trust-матрица + confidential-инвариант — обновить (B).

- [ ] **Step 1: grep-инвентаризация**

Run: `grep -rln "confidential\|trust" manual_docs/ README.md`
Expected: полный список файлов для правок (совпадает с Files)

- [ ] **Step 2: Применить правки** (семантические файлы — по деталям; grep-файлы — точечно)
- [ ] **Step 3: Проверка остатков**

Run: `grep -rn "confidential\.paths\|trust\.custodian\|trust\.sanitizer" manual_docs/ README.md`
Expected: только legacy-контекст (пометки «legacy-режим»)

- [ ] **Step 4: Commit**

```bash
git add manual_docs/ README.md
git commit -m "docs(manual): sync to native barrier, role-trust, restricted-paths how-to"
```

---

### Task 12: Sandbox / benchmark / чеклист (I1/N2/N5)

**Files:**
- Modify: `maestro-sandbox.sh`, `skills/maestro-benchmark/sandbox-smoke.test.mjs`, `skills/maestro-benchmark/diff.mjs`, `skills/maestro-benchmark/diff.test.mjs`, `skills/maestro-benchmark/SKILL.md`, `docs/testing/maestro-sandbox-checklist.md`

**Interfaces:**
- Consumes: Task 3/5 (new-режим: плагин не гейтит → песочница должна представлять корректную миграцию), Task 1 (byTrusted = role-set).
- Produces: benchmark-песочница как эталон «мигрированного проекта».
- Детали (spec §4.6):
  - `maestro-sandbox.sh`: fixture `maestro.json` — **без** `confidential` и `trust` (N2); fixture `docs/confidential/`, `.env` — без изменений; генерируемый `.opencode/opencode.json` песочницы — **добавить** deny `secrets/**` (read/edit/glob/grep, N5) + per-agent allow custodian/sanitizer; сгенерированные комментарии (шапка скрипта, строки project-context, README песочницы: «закрыт `confidential.paths`») → «закрыт нативным deny»;
  - `sandbox-smoke.test.mjs`: +assertion `!("confidential" in cfg.maestro.json)` **и** `!("trust" in cfg.maestro.json)`; +assertion нативного deny `secrets/**` (read/edit/glob/grep) в сгенерированном конфиге; существующие assertions — сохраняются;
  - `diff.mjs` + `SKILL.md`: поле `security.confidentialAccess` → `{ attempts, byTrusted, unknown }` (byTrusted = role-set; alpha — breaking допустим); `diff.test.mjs` — обновить сравнение поля;
  - `docs/testing/maestro-sandbox-checklist.md`: строка D2 («primary не читает `.env`/`secrets/`») → «нативный deny (ядро + сгенерированное правило)»; live-инвариант («trusted читает / primary — нативный deny») — пометить [Manual].

- [ ] **Step 1: Обновить `sandbox-smoke.test.mjs` (failing)** — новые assertions
- [ ] **Step 2: Запустить, убедиться что падают**

Run: `node --test skills/maestro-benchmark/sandbox-smoke.test.mjs`
Expected: FAIL (фикстура ещё несёт `trust`/`confidential`; deny `secrets/**` отсутствует)

- [ ] **Step 3: Обновить `maestro-sandbox.sh`** (fixture + генерируемый конфиг + комментарии)
- [ ] **Step 4: Обновить `diff.mjs` + `diff.test.mjs` + `SKILL.md`** (схема `confidentialAccess`)
- [ ] **Step 5: Запустить тесты**

Run: `node --test skills/maestro-benchmark/sandbox-smoke.test.mjs skills/maestro-benchmark/diff.test.mjs`
Expected: PASS

- [ ] **Step 6: Обновить чеклист** (`docs/testing/maestro-sandbox-checklist.md`)
- [ ] **Step 7: Commit**

```bash
git add maestro-sandbox.sh skills/maestro-benchmark/ docs/testing/maestro-sandbox-checklist.md
git commit -m "feat(benchmark): sandbox as migrated-project fixture — native deny secrets/**, no confidential/trust"
```

---

### Task 13: Финальный gate — полный набор + остаточный grep

**Files:** — (только проверки; правки — если grep найдёт остатки)

**Interfaces:**
- Consumes: Task 1–12.
- Produces: зелёный `npm test` + `npm run test:memory` — gate перед финальным ревью (pipeline шаг 15).

- [ ] **Step 1: Полный набор**

Run: `npm test`
Expected: PASS (все файлы: index.test.js, pipeline-status, docs-drift, references-coverage ×2, timeline, diff, sandbox-smoke, test-coverage, merge-guard)

- [ ] **Step 2: Memory-набор**

Run: `npm run test:memory`
Expected: PASS

- [ ] **Step 3: Остаточный grep по репо (вне legacy-контекста)**

Run: `grep -rn "confidential\.paths\|trust\.custodian\|trust\.sanitizer" --include="*.md" --include="*.js" --include="*.json" . | grep -v "node_modules\|docs/superpowers/specs\|regression/\|specs/"`
Expected: только легитимные места (legacy-пометки в каноно-деталях, `loadConfidentialConfig` в legacy-ветке, маркер «из confidential», historical `specs/native-permissions-rebalance.md`)

- [ ] **Step 4: При находках — правки + повтор Step 1–2; commit:**

```bash
git add -A
git commit -m "chore: final sweep — stale confidential/trust references"
```

(Если правок нет — commit не создаётся, зафиксировать в task-отчёте «clean».)

---

## Project Context Changes

При Approve гейта 12 — применить к `docs/project-context.md`: **полная замена §12 «Безопасность»** (текущий текст lines 220–241) на:

```markdown
## 12. Безопасность

- **Барьер доступа:** единственный барьер — нативные permissions OpenCode
  (deny `read`/`edit`/`glob`/`grep` + per-agent allow `custodian`/`sanitizer`
  в `.opencode/opencode.json`); плагин — shadow-аудит (observability), не
  enforcement (кроме legacy-режима: пока секция `confidential` есть в
  `maestro.json` — dual mode, 6.4.0).
- **Trust:** по роли — `custodian`/`sanitizer` trusted (hardcoded role-set,
  не конфигурируется; секция `trust` удалена из схемы в 6.4.0, старые ключи →
  warn + игнор). U1-маскирование task-промптов — для всех агентов вне
  role-set (вкл. кастомные).
- **Confidential-данные:** docs/confidential/**
- **Секреты:** `.env`, `*.env.*` — дефолт ядра OpenCode; `*.pem`/`*.key`/
  `*.crt`/`*.p12`/`*.pfx` — init-базелин (при наличии в нативном конфиге).
- **File-доступ — нативный:** deny/ask в `.opencode/opencode.json`
  (read/glob/grep); `maestro.json`/`.maestro` защищены нативно
  (deny + edit-ask).
- **`maestro_config`** — read-only плагин-тул для параметров `maestro.json`
  (global `ask`; только top-level primary — сабагенты per-agent `deny` +
  плагинный fail-closed guard; bash-чтение запрещено процессным каноном;
  4.9.0).
- **Санитайзинг:** маскировка чувствительных данных перед untrusted-диспатчем
  (`sanitizer_whitelist`); role-trusted агенты — raw-промпт.
- **Память (memory layer):** generic-маскирование `sanitize()` (технические
  секреты) до и после саммаризации; бизнес-confidential НЕ маскируется
  (SEC-5, принятый риск: каналы a–d); git-backfill — только allowlist-глобы
  (restricted-пути не добавляются в `history_globs`/`artifact_globs`).
- Источник истины — `SECURITY.md`.
```

(Строка `**Confidential-данные:**` — канонический формат M2; ведётся воркфлоу «Настройка restricted-путей».)

## Cross-Entry Reconciliation

«Под угрозой» entries (`regression/entries/`), чьи сценарии пересекаются с file-set плана (cap 5; порядок: число пересечений desc → `added` desc). Пересечения найдены: 24 entries; все — через Task 6 (удаление confidential-механики из `plugins/maestro-bootstrap/memory/`) и Task 1–5 (`index.test.js`).

| # | Entry | Пересечения | Почему под угрозой | Как сохраняется |
|---|---|---|---|---|
| 1 | `2026-09-12-memory-artifact-links.md` | 11 (`artifacts.js`, `config.js`, `indexer.js`, `recall.js`, `index.js` + тесты) | Task 6 трогает все эти файлы (artifact-drop по confidential-паттернам — в `validation.js`/`artifacts.js`) | Allowlist `artifact_globs` **не меняется** (spec §4.2); поведение artifact-links идентично; сценарные тесты прогоняются Task 6 Step 4 (`npm run test:memory`) и Task 13 (`npm test`) |
| 2 | `2026-09-12-memory-reindex-backfill.md` | 10 (`backfill.js`, `config.js`, `index.js`, `summarize.js` + тесты) | Task 6 удаляет `skip_confidential` из `backfill.js` | Кандидаты — только по `history_globs`/`artifact_globs` (allowlist не меняется); `summarize.js` не трогается; сценарий «git-backfill работает» сохраняется (теперь без skip) — проверяется обновлённым `backfill.test.js` (Task 6 Step 1) + `npm run test:memory` |
| 3 | `2026-09-14-memory-summarizer-resolve.md` | 9 (`config.js`, `indexer.js`, `index.js`, `resolve-model.js` + тесты) | Task 6 трогает `config.js` (init-warn'ы), `indexer.js`, `index.js` | `resolve-model.js` не трогается; removal init-warn'ов не меняет resolve-цепочку (`small_model → model → agent.maestro/build`); сценарные тесты — Task 6 Step 4 |
| 4 | `2026-09-11-memory-search-hybrid.md` | 9 (`recall.js`, `indexer.js`, `index.js`, `storage/sqlite.js` + тесты) | Task 6 убирает `confidentialPatterns` из pipeline `indexer.js`/`recall.js`/`memory_search` | Hybrid search (FTS5 + vector) не меняется; маскирование запроса — только generic `sanitize` (тест в Task 6 Step 1); `storage/sqlite.js` не трогается; сценарные тесты — Task 6 Step 4 |
| 5 | `2026-09-10-memory-branch-lifecycle.md` | 6 (`config.js`, `index.js`, `indexer.js` + тесты) | Task 6 трогает `config.js`/`index.js`/`indexer.js` | Branch-aware lifecycle (head/commit-идентичность, promotion) не меняется; removal — только confidential-фильтрация; сценарные тесты — Task 6 Step 4 + Task 13 |

Вывод: угроза — **regression-риск Task 6** (удаление механики в 9+ memory-файлах). Митигация: TDD (сначала обновление тестов, включая сценарные entries), `npm run test:memory` — gate каждого шага, Task 13 — полный набор. Остальные 19 entries (через `index.test.js`/SKILL-канон) — пересечение через общий test-file, не через сценарную семантику; их покрывает Task 13 (`npm test`).

## Spec Coverage Matrix

| Spec-требование | Task |
|---|---|
| D1 (нативный барьер, плагин не бросает deny в new) | 3, 12 |
| D2 (директива, §12-зеркало, формат M2, drift) | 2, 4, 8, 11 |
| D3 (memory без confidential, каналы a–d, нет dual mode) | 6, 10, 11 |
| D4 (P6 residual, external_directory: ask) | 10 |
| D5 (dual mode, legacy-режим, порядок миграции I2) | 3, 4, 8 |
| D6 (B: trust удалён, role-set, warn, принятые ограничения) | 1, 7, 8, 10, 11 |
| D7 (shadow-аудит, basename M3, frontmatter M4) | 5, 9 |
| D8 (benchmark-статика, leak-статус, V5 [Manual]) | 12 |
| §4.1 core (loadNativeRestrictedSet M1, директива M7, init-warn'ы) | 2, 4, 3 |
| §4.2 memory (mask/indexer/recall/backfill/backup/validation M9) | 6 |
| §4.3 канон скиллов (SKILL dead-ветки, trust-and-security, invariants, custodian-prompt, assistant, setup, agents) | 7, 8, 9 |
| §4.4 SECURITY.md (§2 N3, P1, P4a, P5, P6, SEC-5, §4, §5, тест-гарды i–iv) | 10 (гарды: 1/3/4/5) |
| §4.5 manual_docs (I3: manage-confidential-paths, pipeline-overview, setup-project; config/agents-and-trust/memory/model-selection N6; README) | 11 |
| §4.6 sandbox (I1: deny secrets/**, N2, N5; smoke; diff; чеклист) | 12 |
| §4.7 тесты (B-pin, D-check оба ключа, npm test gate) | 1, 3, 8, 13 |
| §4.8 версионирование (6.4.0, changelog) | **вне плана** — оркестратор, шаг 18 после merge |
| V1–V5 (V2 dogfooding, V3 сверка, V5 [Manual]) | 13 ([Manual] — чеклист, Task 12) |
| AC 1–11 | 1–13 по строкам выше (AC 8/9 → 12/8, AC 11 → шаг 18) |

## Self-Review (5 проверок writing-plans)

1. **Spec coverage:** все пункты §4.1–§4.8 и D1–D8 покрыты задачами (матрица выше); §4.8 — осознанно вне плана (шаг 18). Пропусков нет.
2. **Step scan:** каждый шаг — одно действие с проверяемым результатом (failing test / команда+ожидаемый вывод / commit); body-код не транскрибируется, кроме зафиксированных спекой строк (директива, §12-строка, warn-имена). Task 2 Step 3 — единственный «подход без полного тела» (алгоритм мержа определяется тестами + контрактом возврата).
3. **Type consistency:** `loadNativeRestrictedSet -> { dataPaths, agentAllows }` используется в Task 3/4/5 единообразно; `loadTrustConfig -> Set`, `deprecatedTrustKeys -> string[]` — Task 1; `restrictedDirectiveText(paths) -> string`, `registerRestrictedDataHooks({client, log, getDataPaths})` — Task 4, потребители (Task 9 feedback-report, Task 12 byTrusted) ссылаются на те же поля (`action: allow|deny|unknown`, `target` basename).
4. **Review Focus:** 5 пунктов (merge-edge, миграционное окно, N1-обновление, сломанный конфиг, §12 drift) — каждый привязан тестом к owning-task (T2, T4+T8, T1+T3, T2, T4).
5. **Proportion:** план ~1.3× объёма спеки; преобладание — шаги TDD + интерфейсы, не body-код. Допустимо для security-фичи с 13 задачами и строгими канон-зависимостями.
