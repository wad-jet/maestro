# Regression — memory fail-loud (#77)

- **version:** 1
- **feature:** fail-loud memory — уведомление в сессию при сбое индексирования; full-reindex через memory_reindex; unindexed-блок в memory_stats_detail / @maestro-memory
- **added:** 2026-09-24
- **status:** active
- **risk:** HIGH — повторная ТИХАЯ потеря данных сессий при недоступном хранилище (уведомление не доходит / восстановление не работает); пользователь продолжает «рассуждать о памяти проекта» как об актуальной.
- **category:** vector memory persistence (fail-loud, unsaved-notice, full-reindex, unindexed-stats)
- **scenarios:**
  - **unit-тесты фичи** (index.test.js — T3-x, T4-x, T5-x, T6-x, T7-x, E2E #77):
    - run: `npm run test:memory`
    - workdir: `/Users/odemidov/Documents/dev/github/maestro-agent`
  - **core-тесты плагина:**
    - run: `npm test`
    - workdir: `/Users/odemidov/Documents/dev/github/maestro-agent`
  - **[Manual] E2E unsaved-notice:** имитация недоступности хранилища → сессия получает system-notice «данные НЕ сохранены» → `@maestro-memory` показывает unindexed N>0 → `memory_reindex` full-reindex по session_id → запись восстановлена, skip сброшен
  - **[Manual] E2E process-level notice:** бэкенд down при старте плагина → process-level notification на каждой top-level сессии → восстановление бэкенда → перезапуск opencode → память возвращается
  - **[Manual] E2E permanent-skip reset:** сессия в permanent-skip → `memory_reindex` по явному session_id → skip сброшен, запись создана
  - **[Manual] E2E unindexed-block:** `memory_stats_detail` содержит «Не индексированные сессии: N» с cap 20 → для каждой строки — session_id, skip, fails, reason, last_attempt
