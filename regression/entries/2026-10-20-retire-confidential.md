# Regression — Retire Confidential (native barrier, trust B)

- **version:** 1
- **feature:** уход от `confidential`/`trust` в `maestro.json`: нативные permissions как единственный барьер доступа, dual mode (D5), role-set trust (B), memory без confidential-механики (D3), плагинная директива restricted-путей (D2), shadow-аудит (D7)
- **added:** 2026-10-20
- **anchor:** 9d5d74bf661158a85e1cc32a58b2c71691e5f117 (HEAD при записи)
- **status:** active
- **risk:** HIGH — breaking схемы `maestro.json` (удалены секции `confidential`/`trust`); миграция существующих проектов (окно «секции нет + нативных deny нет»); потеря плагинного файлового доступа custom-trusted агентами **с обновления 6.4.0, в любом режиме** (N1, fail-closed); тихая утрата P4-check ассистента; SEC-5: бизнес-confidential не маскируется памятью (принятый риск, каналы a–d).
- **category:** security architecture (native permissions, role-trust, dual mode, memory, orchestrator directive)
- **scenarios:**
  - **unit:** `node --test plugins/maestro-bootstrap/index.test.js` — все PASS (B-pin role-set, dual mode new/legacy, директива top-level/task-session, shadow-аудит, warn'ы `trust:deprecated_key`/`confidential:legacy_active`/`confidential:drift`)
  - **unit:** `npm run test:memory` — все PASS (memory без confidential-механики: mask/backup/backfill/import)
  - **unit:** `node --test maestro-install/docs-drift.test.mjs` — D-проверка: inline-канон `maestro.json` без ключей `"confidential"`/`"trust"`
  - **unit:** `node --test skills/maestro-benchmark/sandbox-smoke.test.mjs` — fixture без `confidential`/`trust`, нативные deny `secrets/**` (read/edit/glob/grep) + per-agent allow
  - **[Manual] live-инвариант (V5):** sandbox-чеклист — custodian/sanitizer читает restricted-путь, primary получает **нативный permission error** (в new-режиме `[confidential:deny]` не ожидается; последний — legacy-режим)
  - **[Manual] negative — порядок миграции (I2):** удаление секции `confidential` до записи нативных deny → warn `confidential:drift` при старте + предпроверка ассистента блокирует удаление
  - **[Manual] negative — N1 (custom trust):** проект с `trust.<custom>: true` после обновления 6.4.0 — кастомный агент получает deny на confidential-чтения (в любом режиме) + warn `trust:deprecated_key` со списком ключей и подсказкой про нативный per-agent allow
  - **[Manual] V2 (dogfooding):** после рестарта — строка `restricted-data paths: …` в system-контексте top-level primary и отсутствует в task-сессиях сабагентов
  - **[Manual] V3 (dogfooding):** derived-набор (директива) сверен с фактическим поведением нативных permissions (listed → deny, unlisted → allow)
