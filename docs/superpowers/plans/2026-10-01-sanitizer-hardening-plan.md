# Sanitizer Hardening (4.21.0) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** убрать «полную потерю защиты без сигнала» (H-4/H-5) + три формы Level-1 (H-1/H-2/H-3).

**Architecture:** правки `plugins/maestro-bootstrap/core.js` (валидация при init, fail-closed-throw + catch, 3 regex + escape) + тесты `index.test.js`; docs-синк по D5.

**Tech Stack:** Node ESM, `node --test` (npm test), markdown-доки.

**Spec:** `docs/superpowers/specs/2026-10-01-sanitizer-hardening-design.md` (approved, гейт 10).

---

### Task 1: D1+D2 — валидация при init + fail-closed (TDD)

**Files:**
- Modify: `plugins/maestro-bootstrap/core.js`
- Modify: `plugins/maestro-bootstrap/index.test.js`

- [ ] **Step 1 (RED):** Тесты (index.test.js, паттерны существующих hook-тестов):
  - H-5: `patterns: [[]]` → элемент отброшен, `sanitize("POSTGRES_PASSWORD=x", opts)` маскирует.
  - H-4-триггеры: `extra_fields: [123]`, `extra_fields: [""]`, `extra_uri_schemes: [""]` → отброшены, `sanitize` не бросает.
  - H-7: `rules: {auth_headers: true}` (typo) → отброшен; 7×false + мусорный ключ → `allRulesDisabled === true`; `by_agent: {haiku: "data_field"}` (не-массив) → warn/игнор.
  - Fail-closed: фабрика с `sanitizeImpl: () => { throw new Error("boom") }` → `tool.execute.before` (task, untrusted) → `assert.rejects` + ассерт записи `sanitizer.failed` в audit-файле (паттерн чтения логов из confidential-deny-тестов; MAESTRO_AUDIT_LOG_DIR в tmp).
  - Title: `sanitizeImpl`-throw в `after` → title `<unavailable>`, без throw.
  - Валидация: warn `sanitizer.invalid_config` ровно один при init (init с невалидным конфигом ×N диспатчей → 1 запись).
- [ ] **Step 2:** Запуск: `node --test plugins/maestro-bootstrap/index.test.js` — новые тесты **красные**.
- [ ] **Step 3 (GREEN):** Реализация в core.js:
  - `validateWhitelist(section)` — чистый хелпер (D1: rules/by_agent/patterns/extra_fields/extra_uri_schemes; возврат {section, warnings[]}); warn-обвязка в init после `loadWhitelist` (~L1048, рядом с SEC-6 L1053): `log.warn("sanitizer.invalid_config", {fields, count})` — только имена/типы (SEC-4b).
  - Валидированный объект — в замыкание хуков; `resolveSanitizeOptions` — по провалидированным данным.
  - D2: task-ветка `tool.execute.before` — `sanitize`/`sanitizeImpl` в try/catch → `err.sanitizerFailed = true`, `auditLog.warn("sanitizer.failed", base)` (audit-only, конвенция L1152) → `throw err`; внешний catch (L1209–1219): `if (err?.confidential || err?.sanitizerFailed) throw err;`.
  - Title-ветка (after): try/catch → `extra.title = "<unavailable>"`.
  - Test-seam: фабрика `MaestroBootstrapPlugin({ directory, client, sanitizeImpl = sanitize })` — `sanitizeImpl` используется в before (L1185) и after (L1239).
- [ ] **Step 4:** `node --test plugins/maestro-bootstrap/index.test.js` — все зелёные; `npm test` — 0 fail (старые 266 не ругрессировали).
- [ ] **Step 5:** Коммит: `git add plugins/maestro-bootstrap/core.js plugins/maestro-bootstrap/index.test.js && git commit -m "feat: #117-hardening T1 — валидация sanitizer_whitelist при init + fail-closed на сбое маскирования (H-4/H-5/H-7)"`

### Task 2: D3 — расширение regex (TDD)

**Files:**
- Modify: `plugins/maestro-bootstrap/core.js`
- Modify: `plugins/maestro-bootstrap/index.test.js`

- [ ] **Step 1 (RED):** Тесты (D4.1–3):
  - H-1: `email: john@doe.com` → masked; `phone: +7-900-123-45-67` → masked; `iban: DE89370400440532013000` → masked; quoted `"email": "j@d.com"` — по-прежнему masked.
  - H-2: `"Authorization": "Bearer ghp_abc123def456"` → masked (весь матч — ассерт фактической семантики redact()); `Authorization: Bearer tok, X: y` → маскируется только токен.
  - H-3: `-----BEGIN ENCRYPTED PRIVATE KEY-----\n…\n-----END ENCRYPTED PRIVATE KEY-----` → masked; стандартные PEM — по-прежнему.
- [ ] **Step 2:** `node --test …` — новые **красные** (текущий код не маскирует).
- [ ] **Step 3 (GREEN):** core.js:
  - `PRIVATE_KEY` (L204–205): `ENCRYPTED ` в альтернацию **BEGIN и END**.
  - `AUTH_HEADER` (L210–211): `["']?\s*:\s*["']?` между именем/`:` и перед значением (replacer НЕ менять — redact() как есть).
  - `buildDataFieldsRegex` (L145–148): value-альтернация `("[^"]*"|'[^']*'|\d[\d.,]*|[^\s"'<>|,;]+)`.
  - **D3(s):** `escapeScheme` (L183) → использовать `escapeRegex` (L124) полный escape.
- [ ] **Step 4:** `node --test …` — зелёные; **SEC-1/SEC-1b-сьют не ругрессировал** (явно: quoted, `KEY=value`, `key: value`, URI, PEM, JWT, `password=`, count-кейсы L487–492/L531–635); `npm test` — 0 fail.
- [ ] **Step 5:** Коммит: `git add plugins/maestro-bootstrap/core.js plugins/maestro-bootstrap/index.test.js && git commit -m "feat: #117-hardening T2 — Level-1: unquoted PII, JSON-auth-заголовки, ENCRYPTED-PEM, полный escape схем (H-1/H-2/H-3)"`

### Task 3: D5 — docs-синхронизация + changelog/roadmap/regression/TODO

**Files:**
- Modify: `SECURITY.md`, `manual_docs/explanation/agents-and-trust.md`, `manual_docs/reference/model-selection.md`, `manual_docs/reference/config.md`, `plugins/maestro-bootstrap/README.md`, `manual_docs/overview/changelog.md`, `docs/roadmap.md`, `TODO.md` (gitignored)
- Create: `regression/entries/2026-10-01-sanitizer-hardening.md`

- [ ] **Step 1:** `SECURITY.md` — §4 «Реализованные контрмеры»: Level-1 — fail-closed (валидация конфига при init + блокировка диспатча при ошибке маскирования; семантика изменена с fail-open; расширение детекции: unquoted PII, JSON-auth, ENCRYPTED-PEM). §5 «Известные ограничения»: H-1/H-2/H-3 закрыты; H-9 (context-less секреты) и H-10 (XML, 2-seg JWT, `oracle://`-схемы, multi-line) — зона Level-2 / 5.0.
- [ ] **Step 2:** `agents-and-trust.md` — «Правила детекта» (L475–495): новые формы (H-1/H-2/H-3) + **fix дрейфа H-11** — маркеры привести к реализации (всегда `<redacted>` + сохранённое имя для env/data_field, full-`<redacted>` для остальных); «Аудит-лог» (L500): события `sanitizer.invalid_config`, `sanitizer.failed`, fail-closed-семантика.
- [ ] **Step 3:** `model-selection.md` — проверить; если не затронут — явная пометка не требуется в тексте (категорическое правило AGENTS.md выполнено проверкой; зафиксировать в regression entry).
- [ ] **Step 4:** `config.md` § `sanitizer_whitelist`: (а) валидация + warn (пример невалидного значения); (б) fail-closed (блокировка диспатча); (в) known limitations (H-9/H-10 список); (г) расширенное покрытие; (д) таблица событий (L254–256) + 2 новых. `README.md` (плагин) — sync sanitizer-секции.
- [ ] **Step 5:** Changelog `## [2026-10-01]` — `> **Версия 4.21.0** — Minor-релиз: …` (Добавлено: валидация + warn `sanitizer.invalid_config`; fail-closed `sanitizer.failed`; 3 формы детекции; Изменено: семантика fail-open → fail-closed (осознанное изменение security-поведения); known: контекст-less секреты/XML/2-seg JWT — зона Level-2 / 5.0). Roadmap: у #117-разбора — «эскалация выполнена (4.21.0, 2026-10-01): H-4/H-5 (fail-closed+валидация) + H-1/H-2/H-3 (regex) — `regression/entries/2026-10-01-sanitizer-hardening.md`». Regression entry: risk MEDIUM (security-поведение плагина), scenarios [Auto] npm test + кейсы H-1..H-5, [Manual] невалидный конфиг → warn + защита работает; сбой sanitize → блок; regressions: легитимные конфиги не ругрессируют (SEC-1/SEC-1b-сьют), trusted-skip не затронут; links: спека, анализ, changelog. TODO.md — у sanitizer-строки: пометка «эскалация выполнена (2026-10-01, 4.21.0)».
- [ ] **Step 6:** Проверка: `npm test` — 0 fail (drift D4: «Выполнено (4.21.0…» ↔ changelog; D1a/D1b — **НЕ ТРОГАТЬ**, bump на merge); `node /tmp/wall-scan.mjs` по тронутым manual_docs/.md → 0 стен (воссоздать, если нет); git status — только заявленные.
- [ ] **Step 7:** Коммит: `git add SECURITY.md manual_docs/ plugins/maestro-bootstrap/README.md docs/roadmap.md regression/entries/2026-10-01-sanitizer-hardening.md && git commit -m "docs: #117-hardening T3 — SECURITY.md/agents-and-trust(+H-11)/config/README sync, changelog 4.21.0, roadmap, regression"`

---

## Верификация (после T3)

- `npm test` — 266 + N, 0 fail; критерии D4 спеки 1–10.
- Финальное ревью (шаг 16): тип {code} → параллельное первое ревью (sonnet + code-reviewer-класс, правило #95) + критерии code.
- Merge → bump 4.21.0 (package.json, project-context §3, AGENTS-метка) → push → agpack sync → feedback (auto).
- **До merge — бамп НЕ делать** (D1a/D1b docs-drift).
