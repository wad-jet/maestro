# Regression — sanitizer-hardening (4.21.0)

- **version:** 1
- **feature:** #117-эскалация (sanitizer hardening, 4.21.0): fail-closed-семантика Level-1 — валидация `sanitizer_whitelist` при init (невалидные элементы отбрасываются + warn `sanitizer.invalid_config`, SEC-4b) + блокировка диспатча при сбое маскирования (audit `sanitizer.failed`, было fail-open) + 3 формы Level-1 (unquoted PII, JSON-auth-заголовки, PEM `ENCRYPTED PRIVATE KEY`) + полный escape URI-схем. `plugins/maestro-bootstrap/core.js` + `index.test.js`; docs-синк (SECURITY.md, manual_docs, plugin README)
- **added:** 2026-10-01
- **status:** active
- **risk:** MEDIUM (security-поведение плагина меняется: fail-open → fail-closed; config-схема не изменилась — те же ключи `sanitizer_whitelist`, дефолты без изменений)
- **category:** `plugins/maestro-bootstrap/core.js` (sanitize/validateWhitelist/task-хуки), `plugins/maestro-bootstrap/index.test.js`
- **scenarios:**
  - **(auto) `npm test`:** зелёный — 285/285 (266 baseline + 19 новых: H-1/H-2/H-3, H-5 `patterns: [[]]`, H-4-триггеры, H-7, fail-closed + audit `sanitizer.failed`, title `<unavailable>`, warn-однократность при init, escape схем); drift-тест D4: «Эскалация выполнена (4.21.0, …)» ↔ changelog 4.21.0 согласовано; D1a/D1b — bump 4.21.0 на merge.
  - **[Manual] невалидный конфиг:** `sanitizer_whitelist` с мусором (напр. `extra_fields: [123]`, `patterns: [[]]`, `rules: {auth_headers: true}`) → при init warn `sanitizer.invalid_config` (ровно один), валидные правила продолжают работать — защита не сломана.
  - **[Manual] сбой маскирования:** forced sanitize-failure (test-seam `sanitizeImpl`) → task-диспатч (untrusted) заблокирован сообщением `[sanitizer:failed] …` + запись `sanitizer.failed` в аудит-лог; промпт сабагенту не уходит.
- **regressions:** ⚑1–4 не затрагиваются;
  - (a) **легитимные конфиги** — SEC-1/SEC-1b-сьют (quoted, `KEY=value`, `key: value`, URI, PEM, JWT, `password=`, count-кейсы) не ругрессирует; дефолты правил и `by_agent`-семантика без изменений;
  - (b) **trusted-skip** — trusted сабагенты получают промпт как есть (skip не затронут);
  - (c) **model-selection.md** проверен — не затронут фичей (про моделей агента sanitizer, не про Level-1-маскирование); sync-правило AGENTS.md выполнено проверкой.
- **links:** changelog `[2026-10-01]` (4.21.0) | спека `docs/superpowers/specs/2026-10-01-sanitizer-hardening-design.md` | план `docs/superpowers/plans/2026-10-01-sanitizer-hardening-plan.md` | анализ `docs/superpowers/analysis/2026-10-01-sanitizer-whitelist.md`

## Follow-up

— (known limitations, зона Level-2 / 5.0: context-less секреты, XML
`<password>`, 2-сегментный JWT, схемы oracle/rediss/mariadb/snowflake,
multi-line значения; H-8/H-6/упрощение knobs — 5.0 по §6 анализа)

## Dogfooding

— (auto-покрытие: 19 кейсов в `npm test`; первый живой прогон fail-closed —
следующий pайплайн со сбоем маскирования/невалидным конфигом)
