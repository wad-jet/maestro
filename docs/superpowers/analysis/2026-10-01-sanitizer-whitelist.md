# Анализ `sanitizer_whitelist` (#117-разбор)

**Дата:** 2026-10-01 · **Статус:** завершён · **Вердикт:** архитектура состоятельна; 2 активных
ограничения + 2 footgun-обхода требуют решения (эскалация / 5.0) · **Основание для:** #117-изменения (5.0)

Метод: opus security-аудит (статическая трасса `plugins/maestro-bootstrap/core.js` + `SECURITY.md`
+ `manual_docs/reference/config.md` + `index.test.js`) + **runtime-проверка** adversarial-проб
(`/tmp/whitelist-verify.mjs`, `/tmp/whitelist-probes.mjs`, прогон в сессии 2026-10-01 — evidence ниже).

---

## 1. Механизм

```
task-диспатч (tool.execute.before, core.js L1171–1197)
  └─ agent = subagent_type || model || "unknown"
  └─ trusted (trust: true)? → sanitize ПОЛНЫЙ SKIP (по дизайну — trusted видит raw)
  └─ untrusted → resolveSanitizeOptions(whitelist, agent) → sanitize()
       ├─ 7 категорий (DEFAULT_RULES, L90) в фикс. порядке:
       │   env_secret(=) → data_field → env_file → db_credential
       │   → private_key → auth_header(+JWT) → SECRET_COLON (последний)
       ├─ knobs: rules (глоб. off) · by_agent (per-agent off, только ослабление) ·
       │   patterns (литералы-исключения, isProtected = fragment.includes(p)) ·
       │   extra_fields (+ data_field) · extra_uri_schemes (+ db_credential)
       └─ { text, count }; count>0 → подмена промпта + warn `sanitizer.redacted`
```

Точки применения: (1) `task`-промпт — untrusted only; (2) `task`-`title` в лог — **все** агенты
(SEC-4, L1236–1240), но правилами **того же** агента; (3) memory `maskTranscript` — все правила,
без by_agent. Guards: SEC-6 (patterns-секретоподобие → warn при init), SEC-7 (all-rules-off →
warn на диспатч), fail-open при ошибке sanitize (L1209–1219 — промпт проходит несанитизированным).
Конфиг читается один раз при старте.

**Ключевая асимметрия:** confidential-контроль при ошибке **бросает** (deny), sanitize —
**проглатывает** (fail-open). Единственный security-механизм плагина с fail-open-семантикой.

## 2. Сценарии использования (по knob)

| Knob | Сценарий (кто/зачем) | Неверная настройка | Footgun |
|---|---|---|---|
| `rules` | Снизить FP-шум: проект без PII выключает `data_field` | Typo → silent no-op; `"false"` строкой → правило ON | Все-off — только SEC-7 **warn**; мусорный truthy-ключ подавляет SEC-7 (H-7) |
| `by_agent` | `reviewer` ревьюит финлогику — `data_field` off только для него | Typo имени правила → silent no-op | Частичное отключение **не логируется нигде**; для trusted-агента — мёртвый конфиг |
| `patterns` | Тестовые литералы (`test-token-12345`) без масок | Подстрочная семантика: `"test"` защищает `PASSWORD=test123` | Короткие/общие паттерны массово отключают маскирование, warn нет (H-6); `[[]]` — тотальный silent bypass (H-5) |
| `extra_fields` | Доменные PII (`internal_ssn`) | Не-строка → TypeError → **fail-open** (H-4) | Ошибка одного элемента отключает всю защиту |
| `extra_uri_schemes` | Свои протоколы (`kafka://`) | Regex-метасимвол → SyntaxError → **fail-open** (H-4) | То же |
| `trust` (байпас) | `custodian`/`sanitizer` — trusted по роли | `haiku: true` снимает Level-1 (+Level-2) **без warn** (H-8) | Контроль — только git-ревью `maestro.json` |

## 3. Находки

Классы: **А** — активная (секрет доходит до untrusted при in-the-box настройках/потоках),
**О** — ограничение/footgun (требует неверной настройки), **Д** — документационный дрейф.

| # | Sev | Класс | Суть | Evidence (runtime, 2026-10-01) |
|---|---|---|---|---|
| H-1 | IMPORTANT | А* | `data_field` маскирует только quoted/числовые значения: `email: john@doe.com`, `phone: +7…` проходят | `count=0 → PASS (дыра)` |
| H-2 | IMPORTANT | А* | JSON-стиль auth-заголовков: `"Authorization": "Bearer ghp_…"` — кавычка между именем и `:` ломает матч | `count=0 → PASS (дыра)` |
| H-3 | IMPORTANT | А* | PEM `ENCRYPTED PRIVATE KEY` (стандартный PKCS#8) — альтернация типов без `ENCRYPTED` | `count=0 → PASS (дыра)` |
| H-4 | IMPORTANT | О | Fail-open: `extra_uri_schemes:["bad("]` → SyntaxError, `extra_fields:[123]` → TypeError → промпт несанитизированный **на каждом диспатче**, без dedicated-события | THROWS: SyntaxError / TypeError — подтверждено |
| H-5 | IMPORTANT | О | `patterns: [[]]` → `includes([])` = `includes("")` = always true → **тотальный тихий bypass**, `count=0`, warn-ов нет | `count=0 text=несанитизированный` — подтверждено |
| H-6 | MINOR | О | Подстрочная/кейс-семантика `patterns`: `"sk-test-"` защищает `sk-test-PROD-abc`; SEC-6 не детектирует «общность» | статика (L265–270) |
| H-7 | MINOR | О | `rules:"yes"` → spread по символам (fail-safe, правила ON), но `allDisabled=false`; 7×false + мусорный truthy-ключ → SEC-7 подавлен | `allDisabled=false` — подтверждено |
| H-8 | MINOR | О | Расширение `trust` — без сигнала (симметричного SEC-7 нет) | статика |
| H-9 | MINOR | А* | Context-less секреты (AIza…, xoxb-/xapp-, AWS secret key, Telegram, npm_, sk-proj-) — Level-1 слеп; асимметрия: SECRET_VALUE-детектор (SEC-6) знает больше семейств, чем сам sanitize | `count=0 → PASS (дыра)` |
| H-10 | MINOR | А* | Пробелы: схемы без `mariadb/oracle/snowflake/rediss`; XML `<password>`; 2-сегментный JWT; multi-line `KEY=abc\ndef`; `amount: -100` | `count=0 → PASS (дыра)` ×4 (oracle, 2-seg JWT, neg amount, bare) |
| H-11 | MINOR | Д | agents-and-trust.md L477–491: маркеры `<redacted:env.NAME>` и т.п. — реализация всегда `<redacted>` + имя | статика |
| H-12 | NOTE | — | Санизируется только `args.prompt` из текстов task-аргументов; title — правилами того же агента | статика |
| H-13 | NOTE | — | Пропущенные Level-1 фрагменты в title оседают в `.maestro/logs/` (gitignored) — принятый residual | статика |

\* «Активная» с оговоркой: в **default-режиме** (manual/auto-answer) эти дыры компенсируются
Level-2 (sanitizer-LLM на каждом untrusted-диспатче). Сквозные там, где Level-2 выключен/пропущен:
**hybrid-режим** (`MAESTRO_SANITIZER_MODE=hybrid` — Level-2 только если Level-1 нашёл) и
**opus-циклы Revise (10b)** — Level-2 не запускается никогда (trust-and-security.md L249–256).

## 4. Оценка bypass-матрицы (runtime-прогон)

| Проба | Level-1 |
|---|---|
| Unquoted PII (`email:`, `phone: +7…`) | ✗ |
| `"Authorization": "Bearer ghp_…"` (JSON) | ✗ |
| PEM `ENCRYPTED PRIVATE KEY` | ✗ |
| Bare `sk-proj-…` / `AIza…` / `xoxb-…` / AWS secret key | ✗ |
| `oracle://user:pass@` · 2-seg JWT · `amount: -100` | ✗ |
| 3-seg JWT · `postgres://u:p@` · PEM (стандартные) | ✓ masked |

**~93% standalone-проб проходят без маскирования.** Интерпретация: Level-1 — это
**контекстный детектор** (надёжен там, где есть маркер `=`/`:`/scheme/PEM/заголовок), а не
детектор секретов. Покрытие **внутри** заявленных классов плотное (регрессионные тесты
SEC-1/SEC-1b в `index.test.js`).

## 5. Вердикт

**Approve с условиями (ревизия к 5.0).** Архитектура двух уровней + guards SEC-6/SEC-7
состоятельны; in-the-box **критических сквозных дыр нет** (каждая находка либо компенсируется
Level-2 в default-режиме, либо требует неверной настройки). Обязательные кандидаты на исправление
(превращают «best-effort» в «полное отсутствие защиты» без сигнала): **H-4** (fail-open) и
**H-5** (тихий bypass `[[]]`). Активные ограничения **H-1/H-2/H-3** — сквозные на hybrid и 10b-потоках.

## 6. Направление для 5.0 (#117-изменения)

1. **Fail-closed + валидация конфига** (закрывает H-4, H-5, H-7): dedicated warn `sanitizer.failed`
   (audit-лог), опционально — блокировка диспатча (паритет с confidential-deny); строгая типизация
   knobs (bool по известным именам; patterns/extra_fields/extra_uri_schemes — только строки).
2. **Точечное расширение regex** (H-1, H-2, H-3, H-10): `ENCRYPTED` в PEM; кавычка в AUTH_HEADER;
   `mariadb/oracle/snowflake/rediss`; взвесить unquoted PII против FP.
3. **Симметрия observability** (H-6, H-8, H-9): SECRET_VALUE-семейства → standalone-правило
   Level-1 либо явно «context-less = зона Level-2»; warn на «общие» patterns; warn на
   trust-expansion; init-событие о частичных by_agent-выключениях.
4. **Документация** (H-6, H-11): маркеры agents-and-trust.md → к реализации; семантика `patterns`
   + рекомендация длинных уникальных тест-значений; границы Level-1 — known limitations.
5. **Упрощение knobs**: удалить `ledger_entry` (no-op — оператор думает, что управляет проводками);
   переименование `patterns` → `allow_values` (точнее «whitelist»).
6. **Регрессионные тесты** на H-1…H-5, H-10 (готовый accept-criteria).

## 7. Эскалация (по решению HITL)

Кандидаты на **отдельный фикс вне роадмапа** (не ждать 5.0): H-4 + H-5 (fail-closed + валидация —
единственные, где «настроено как в доках + одна опечатка/ошибка» = полная потеря защиты без сигнала).
H-1/H-2/H-3 — решение: фикс сейчас (точечные regex-правки) vs 5.0 (п.2). — **ждёт HITL-решения.**
