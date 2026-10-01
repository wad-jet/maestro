# Spec: Sanitizer Hardening (4.21.0)

**Issue:** эскалация #117-разбора (H-4/H-5 + H-1/H-2/H-3) — HITL-решение 2026-10-01 (панель: «всё одной фичей сейчас»).
**Основание:** `docs/superpowers/analysis/2026-10-01-sanitizer-whitelist.md` (находки H-1…H-13, runtime-evidence, направление §6.1–6.2).
**Категория:** Medium (плагин-код `core.js` + тесты + docs; config-схема не меняется — breaking-переименование отложено в 5.0).
**Цель:** убрать два сценария «полная потеря защиты без сигнала» (H-4 fail-open, H-5 тихий bypass) и три
активных ограничения Level-1 (H-1 unquoted PII, H-2 JSON-auth-заголовки, H-3 ENCRYPTED-PEM).

## D1. Валидация `sanitizer_whitelist` (закрывает триггеры H-4, H-5, H-7)

Строгая типизация при резолве (`loadWhitelist`/`resolveSanitizeOptions`), невалидное **отбрасывается с
warn** `sanitizer.invalid_config` (bootstrap-лог, при init — как SEC-6; в значениях warn только
**имена полей и типы**, не содержимое — элементы могут быть чувствительными):

- `rules` — только объект; ключи только из 7 известных имён; значения только `boolean`.
  Не-объект (строка/число) → вся секция игнорируется (дефолты ON) + warn.
  Неизвестный ключ / не-boolean значение → элемент игнорируется (дефолт ON) + warn.
  → закрывает H-7 (мусорный truthy-ключ больше не попадает в `rules`, SEC-7 не подавляется).
- `by_agent` — объект agent → массив известных имён правил (строки). Не-строка/неизвестное имя →
  элемент игнорируется + warn.
- `patterns` / `extra_fields` / `extra_uri_schemes` — массивы **строк**. Не-строки (числа, массивы,
  объекты) → элемент отбрасывается + warn. → закрывает H-5 (`patterns: [[]]` → `[]`, маскирование
  работает) и триггеры H-4 (`"bad("`, `[123]` не доходят до `new RegExp`/`escapeRegex`).
- Валидация идиоматична репозиторию (soft-fallback-паттерн `memory:config_fallback`/`communication`),
  но для security-mechanism warn обязан быть явным (не молча).

## D2. Fail-closed на ошибке `sanitize()` при диспатче (закрывает H-4, defense-in-depth)

После D1 сбой `sanitize()` на диспатче практически недостижим (валидация отбрасывает
throw-триггеры) — остаточный случай (regression в regex, непредвиденный ввод) обязан быть
**видим и блокирующим**, не fail-open:

- В `tool.execute.before` (task-ветка, untrusted): `sanitize` в try/catch; ошибка →
  audit-лог `sanitizer.failed` (SEC-событие, как `confidential.access`) + bootstrap-warn +
  **throw** с сообщением `[sanitizer:failed] Маскирование не выполнено — диспатч в <agent>
  заблокирован. Проверьте `sanitizer_whitelist` в maestro.json` (паритет с confidential-deny:
  security-ошибка блокирует, не проглатывается).
- Точки, где блокировка неуместна, **не** меняют семантику: `tool.execute.after` (title-лог) —
  ошибка → title не логируется (заглушка `<unavailable>`), сессия не ломается; memory
  `maskTranscript` — существующий fail-soft паттерн (не в scope).
- Known: до фикса ошибка проглатывалась catch `tool.execute.before` (L1209–1219) — промпт шёл
  несанитизированным; после фикса — блок.

## D3. Расширение regex-покрытия (закрывает H-1, H-2, H-3)

Только три утверждённые формы; H-10 (oracle/rediss-схемы, 2-seg JWT, XML, multi-line, отрицательные
суммы) и H-9 (context-less секреты) — **не** в scope (5.0 / known limitations, фиксируются в доках):

- **H-3** `PRIVATE_KEY` (L204–205): альтернация типов + `ENCRYPTED ` →
  `-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY-----`.
- **H-2** `AUTH_HEADER` (L210–211): допустить кавычки JSON-обёртки — между именем и `:` и перед
  значением: `\b(?:Authorization|X-API-Key|Proxy-Authorization|X-Auth-Token)["']?\s*:\s*["']?(?:Bearer\s+|Basic\s+|Token\s+)?[^\s,;]+`
  → `"Authorization": "Bearer ghp_…"` маскируется (имя сохраняется, значение — `<redacted>`).
  Существующие формы (заголовок без кавычек, `,`-разделители) — не ругрессия (тесты).
- **H-1** `buildDataFieldsRegex` (L145–148): value-альтернация + unquoted-токен:
  `("[^"]*"|'[^']*'|\d[\d.,]*|[^\s"'<>|,;]+)` — при совпадении **имени** поля (email/phone/iban/…)
  маскируется значение-токен до пробела/кавычки/разделителя: `email: john@doe.com` ✓,
  `phone: +7-900-…` ✓, `iban: DE89…` ✓. FP-обоснование: имена в `DEFAULT_SENSITIVE_FIELDS`
  кураторские (чувствительные по определению) — маскирование их word-значений консистентно с
  `SECRET_COLON` (который уже принимает `[^\\s,;]+` для keyword-имён). Значения `null`/`true`
  тоже маскируются — принимается (лучше лишний `<redacted>` у кураторского поля).
- Регрессии-гарант: существующий SEC-1/SEC-1b-сьют (quoted-значения, `KEY=value`, `key: value`,
  URI, PEM, JWT, `password=`) остаётся зелёным.

## D4. Тесты (acceptance-criteria из анализа)

`plugins/maestro-bootstrap/index.test.js` — новые кейсы (все: до фикса красный, после — зелёный):
1. H-1: `email: john@doe.com` → masked; `phone: +7-900-123-45-67` → masked;
   `iban: DE89370400440532013000` → masked; quoted-варианты — по-прежнему masked.
2. H-2: `"Authorization": "Bearer ghp_abc123def456"` → masked;
   `Authorization: Bearer tok, X: y` → только токен (нет over-mask).
3. H-3: `-----BEGIN ENCRYPTED PRIVATE KEY-----…` → masked; стандартные PEM — по-прежнему.
4. H-5: `patterns: [[]]` → элемент отброшен (warn), `POSTGRES_PASSWORD=x` маскируется.
5. H-4-триггеры: `extra_uri_schemes: ["bad("]` → отброшен, `sanitize` не бросает;
   `extra_fields: [123]` → отброшен.
6. H-7: `rules: {auth_headers: true}` (typo) → отброшен; 7×false + мусорный ключ →
   `allRulesDisabled=true` (SEC-7 работает).
7. Fail-closed: диспатч с принудительной ошибкой sanitize → throw + `sanitizer.failed`
   (паттерн существующих hook-тестов; confidential-deny-тесты как образец).
8. Title-ветка: ошибка sanitize в `after` → `<unavailable>`, без throw.
9. Интеграция: `npm test` — 266+ новых, 0 fail.

## D5. Документация и синхронизация

- `manual_docs/reference/config.md` § `sanitizer_whitelist`: (а) валидация — невалидные значения
  отбрасываются + warn `sanitizer.invalid_config` (с примером); (б) fail-closed — сбой
  маскирования блокирует диспатч (не проглатывается); (в) known limitations — H-9/H-10 список
  (context-less секреты, XML, 2-seg JWT, `oracle://` и пр. — зона Level-2 / 5.0);
  (г) расширенное покрытие: unquoted-значения PII-полей, JSON-auth-заголовки, ENCRYPTED-PEM.
  Полный «понимания-слой» (сценарии+примеры+принципы) — отдельная docs-фича (решение Q2 2026-10-01).
- `plugins/maestro-bootstrap/README.md` — sync sanitizer-секции (валидация + fail-closed).
- `SECURITY.md` — короткая пометка в § Security Review: Level-1 fail-closed (валидация конфига +
  блокировка диспатча при ошибке маскирования) — семантика изменена с fail-open.
- Changelog `4.21.0` (minor: новая security-семантика + расширение детекции), regression entry
  `regression/entries/2026-10-01-sanitizer-hardening.md`, roadmap: у #117-разбора —
  «эскалация выполнена (4.21.0)», TODO.md — пометка.

## Non-goals

- Переименование `sanitizer_whitelist` → `sanitizer` / `patterns` → `allow_values` — **5.0** (breaking).
- H-8 (trust-expansion warn), H-9 (context-less standalone-правило), H-10 (схемы/JWT/XML/суммы),
  H-6 (общность patterns) — 5.0 по §6.3 анализа.
- Pre-work notice (шаг 0) — отдельная bounded-фича (решение Q2 2026-10-01).
- Публичная explanation-страница — docs-фича.
<!-- maestro:sanitize
status: CLEAN
date: 2026-10-01
hash: 695d4cec784f6a0b6520bfae34739583ef668968225be30369166ce36e2acf77
-->
