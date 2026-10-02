# Spec: Sanitizer Hardening (4.21.0)

**Issue:** эскалация #117-разбора (H-4/H-5 + H-1/H-2/H-3) — HITL-решение 2026-10-01 (панель: «всё одной фичей сейчас»).
**Основание:** `docs/superpowers/analysis/2026-10-01-sanitizer-whitelist.md` (находки H-1…H-13, runtime-evidence, направление §6.1–6.2, HITL-решения §8).
**Категория:** Medium (плагин-код `core.js` + тесты + docs; config-схема не меняется — breaking-переименование отложено в 5.0).
**Цель:** убрать два сценария «полная потеря защиты без сигнала» (H-4 fail-open, H-5 тихий bypass) и три
активных ограничения Level-1 (H-1 unquoted PII, H-2 JSON-auth-заголовки, H-3 ENCRYPTED-PEM).

## D1. Валидация `sanitizer_whitelist` (закрывает триггеры H-4, H-5, H-7)

Строгая типизация. **Валидация — один раз при init** (после `loadWhitelist`, рядом с SEC-6, core.js
~L1048–1059; отдельный чистый хелпер `validateWhitelist(section)` + warn-обвязка в init): невалидное
**отбрасывается с warn** `sanitizer.invalid_config` (bootstrap-лог; в warn только **имена полей и
типы**, не содержимое — элементы могут быть чувствительными, SEC-4b). `resolveSanitizeOptions`
остаётся чистым резолвером по **провалидированным** данным (не дублирует валидацию — warn строго
один при init, не на каждом диспатче L1174/L1238):

- `rules` — только объект; ключи только из 7 известных имён; значения только `boolean`.
  Не-объект (строка/число) → секция игнорируется (дефолты ON) + warn.
  Неизвестный ключ / не-boolean значение → элемент игнорируется (дефолт ON) + warn.
  → закрывает H-7 (мусорный truthy-ключ больше не попадает в `rules`, SEC-7 не подавляется).
- `by_agent` — только объект; value каждого агента — только массив строк из известных имён правил.
  Не-объект / не-массив value / не-строка / неизвестное имя → элемент(ы) игнорируются + warn.
- `patterns` / `extra_fields` / `extra_uri_schemes` — только массивы **строк**; **пустые строки
  отбрасываются** + warn (footgun: пустая альтернатива в regex = mass-over-mask).
  Не-строки (числа, массивы, объекты) → элемент отбрасывается + warn.
  → закрывает H-5 (`patterns: [[]]` → `[]`, маскирование работает).
- Валидация идиоматична репозиторию (soft-fallback-паттерн `memory:config_fallback`/`communication`),
  но для security-mechanism warn обязан быть явным (не молча).
- Существующие тесты `loadWhitelist` (index.test.js ~L598–635) — только валидные входы → совместимы.

## D2. Fail-closed на ошибке `sanitize()` при диспатче (закрывает H-4, defense-in-depth)

После D1+D3(s) сбой `sanitize()` на диспатче практически недостижим — остаточный случай обязан быть
**видим и блокирующим**, не fail-open:

- В `tool.execute.before` (task-ветка, untrusted): `sanitize` в try/catch; ошибка → аудит-лог
  `sanitizer.failed` (**audit-only** — конвенция core.js L1152: security-события только в audit,
  без дублей в bootstrap; видимый пользователю сигнал даёт сам throw) + **throw** с пометкой
  `err.sanitizerFailed = true` и сообщением `[sanitizer:failed] Маскирование не выполнено —
  диспатч в <agent> заблокирован. Проверьте `sanitizer_whitelist` в maestro.json`.
- **Внешний catch** (`tool.execute.before`, core.js L1209–1219) расширяется: rethrow-условие
  `err?.confidential` → `err?.confidential || err?.sanitizerFailed` (паритет с confidential-deny
  L1157–1162). Без расширения throw проглатывался бы — fail-open сохранялся.
- Точки, где блокировка неуместна, **не** меняют семантику: `tool.execute.after` (title-лог) —
  ошибка → title не логируется (заглушка `<unavailable>`), сессия не ломается; memory
  `maskTranscript` — существующий fail-soft паттерн (не в scope).
- Known: до фикса ошибка проглатывалась catch L1209–1219 — промпт шёл несанитизированным;
  после фикса — блок.

## D3. Расширение regex-покрытия (закрывает H-1, H-2, H-3)

Только три утверждённые формы; H-10 (oracle/rediss-схемы, 2-seg JWT, XML, multi-line) и H-9
(context-less секреты) — **не** в scope (5.0 / known limitations, фиксируются в доках):

- **H-3** `PRIVATE_KEY` (L204–205): `ENCRYPTED ` добавляется в альтернацию типов **в обеих половинах**
  (BEGIN и END): `-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY-----`.
- **H-2** `AUTH_HEADER` (L210–211): допустить кавычки JSON-обёртки — между именем и `:` и перед
  значением: `\b(?:Authorization|X-API-Key|Proxy-Authorization|X-Auth-Token)["']?\s*:\s*["']?(?:Bearer\s+|Basic\s+|Token\s+)?[^\s,;]+`
  → `"Authorization": "Bearer ghp_…"` маскируется. **Семантика замены — без изменений** (`redact()`
  заменяет весь матч: имя заголовка НЕ сохраняется — это текущее поведение, менять replacer не
  планируем). Существующие формы (заголовок без кавычек, `,`-разделители — over-mask не растёт) —
  не ругрессия (тесты).
- **H-1** `buildDataFieldsRegex` (L145–148): value-альтернация + unquoted-токен:
  `("[^"]*"|'[^']*'|\d[\d.,]*|[^\s"'<>|,;]+)` — при совпадении **имени** поля (email/phone/iban/…)
  маскируется значение-токен до пробела/кавычки/разделителя: `email: john@doe.com` ✓,
  `phone: +7-900-…` ✓, `iban: DE89…` ✓. FP-обоснование: имена в `DEFAULT_SENSITIVE_FIELDS`
  кураторские (чувствительные по определению) — маскирование их word-значений согласуется с
  `SECRET_COLON` (который для keyword-имён уже принимает `[^\\s,;]+`). Значения `null`/`true` тоже
  маскируются — принимается (лучше лишний `<redacted>` у кураторского поля). Побочно закрывается
  `amount: -100` (H-10-фрагмент) — безвредный бонус.
- **D3(s) — `escapeScheme` (L183): полный escape.** Сейчас экранируется только `?` →
  `extra_uri_schemes: ["bad("]` строит невалидный regex (SyntaxError). Замена на существующий
  `escapeRegex` (L124) — любой строковый элемент строит валидный regex-литерал (просто не матчит
  ничего). Закрывает оставшийся SyntaxError-триггер H-4 (типовая валидация D1 строку не отбрасывает —
  `bad(` **строка**, и спека не утверждает обратного).
- Регрессии-гарант: существующий SEC-1/SEC-1b-сьют (quoted-значения, `KEY=value`, `key: value`,
  URI, PEM, JWT, `password=`) остаётся зелёным.

## D4. Тесты (acceptance-criteria из анализа)

`plugins/maestro-bootstrap/index.test.js` — новые кейсы (все: до фикса красный, после — зелёный):
1. H-1: `email: john@doe.com` → masked; `phone: +7-900-123-45-67` → masked;
   `iban: DE89370400440532013000` → masked; quoted-варианты — по-прежнему masked.
2. H-2: `"Authorization": "Bearer ghp_abc123def456"` → masked (весь матч, имя не сохраняется —
   ассерт по фактической семантике); `Authorization: Bearer tok, X: y` → только токен (no over-mask).
3. H-3: `-----BEGIN ENCRYPTED PRIVATE KEY-----…-----END ENCRYPTED PRIVATE KEY-----` → masked;
   стандартные PEM — по-прежнему.
4. H-5: `patterns: [[]]` → элемент отброшен (warn), `POSTGRES_PASSWORD=x` маскируется.
5. H-4-триггеры: `extra_uri_schemes: ["bad("]` → строка, провалидирована, regex строится (D3(s)),
   `sanitize` не бросает; `extra_fields: [123]` → отброшен; `extra_fields: [""]` → отброшен.
6. H-7: `rules: {auth_headers: true}` (typo) → отброшен; 7×false + мусорный ключ →
   `allRulesDisabled=true` (SEC-7 работает); `by_agent: {haiku: "data_field"}` (не-массив) → warn.
7. **Fail-closed:** диспатч с ошибкой sanitize → throw (`assert.rejects`, по образцу
   confidential-deny-тестов) + ассерт записи `sanitizer.failed` в audit-файле
   `maestro-audit-*.log`. Механизм форсирования — **test-seam**: фабрика
   `MaestroBootstrapPlugin` получает опциональный `sanitizeImpl` (default `sanitize`) — инъекция
   бросающей реализации (прецедент injectable-швов: `getGitConfig(root, exec)`).
8. Title-ветка: ошибка sanitize в `after` → `<unavailable>`, без throw.
9. Валидация: warn `sanitizer.invalid_config` **ровно один** при init (не на диспатче).
10. Итог: `npm test` — 266 + N новых, 0 fail.

## D5. Документация и синхронизация

Синк по правилу AGENTS.md (изменение SECURITY.md → обязательные manual_docs):

- `SECURITY.md` — **§4** «Реализованные контрмеры» (Level-1: fail-closed — валидация конфига +
  блокировка диспатча при ошибке маскирования; семантика изменена с fail-open; расширенное
  покрытие) + **§5** «Известные ограничения» (H-1/H-2/H-3 закрыты; H-9/H-10 — зона Level-2 / 5.0).
- `manual_docs/explanation/agents-and-trust.md` — sync: «Правила детекта» (L475–495: новые формы
  H-1/H-2/H-3), «Аудит-лог» (новые события `sanitizer.invalid_config`/`sanitizer.failed`,
  fail-closed), **и заодно fix дрейфа H-11** — маркеры `<redacted:env.NAME>` и т.п. привести к
  реализации (всегда `<redacted>` + сохранённое имя).
- `manual_docs/reference/model-selection.md` — проверить и **явно пометить «не затронут»**, если
  неприменимо (категорическое правило AGENTS.md).
- `manual_docs/reference/config.md` § `sanitizer_whitelist`: (а) валидация — невалидные значения
  отбрасываются + warn `sanitizer.invalid_config` (пример); (б) fail-closed — сбой маскирования
  блокирует диспатч; (в) known limitations — H-9/H-10 список (context-less секреты, XML, 2-seg JWT,
  `oracle://` и пр. — зона Level-2 / 5.0); (г) расширенное покрытие (unquoted PII, JSON-auth,
  ENCRYPTED-PEM); (д) таблица событий (L254–256) — два новых события.
  Полный «понимания-слой» (принципы §8.2 анализа (а)(б)(г): сценарии+примеры, ослабление/trusted,
  точность имени) — отдельная docs-фича по решению HITL-панели 2026-10-01 (Q2: docs-артефакты
  после hardening); known limitations (в) — здесь, в D5(в).
- `plugins/maestro-bootstrap/README.md` — sync sanitizer-секции (валидация + fail-closed).
- Changelog `4.21.0` (minor: новая security-семантика fail-closed + расширение детекции;
  формулировка «осознанное изменение» по прецеденту 4.20.0), regression entry
  `regression/entries/2026-10-01-sanitizer-hardening.md`, roadmap: у #117-разбора —
  «эскалация выполнена (4.21.0)», TODO.md — пометка.

## Non-goals

- Переименование `sanitizer_whitelist` → `sanitizer` / `patterns` → `allow_values` **и удаление
  no-op `ledger_entry`** — **5.0** (breaking; §8.1 анализа, HITL 2026-10-01).
- H-8 (trust-expansion warn), H-9 (context-less standalone-правило), H-10 (схемы/JWT/XML/multi-line),
  H-6 (общность patterns) — 5.0 по §6.2/§6.3 анализа.
- Pre-work notice (шаг 0) — отдельная bounded-фича (решение HITL-панели 2026-10-01).
- «Понимания-слой» config.md — отдельная docs-фича (см. D5).
<!-- maestro:sanitize
status: CLEAN
date: 2026-10-01
hash: a627154eab6b9bdcc9ee748bec74e48a852938c1ea034b55b971212eb14ee0dc
-->
