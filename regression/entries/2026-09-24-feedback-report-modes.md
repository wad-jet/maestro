# Regression — feedback-report modes

- **version:** 1
- **feature:** режимы отчёта ретроспективы `feedback_report` (manual/auto/disable) в `maestro.json` — шаг 18.5 пайплайна; плагин `plugins/maestro-bootstrap/feedback-report.js` + `loadFeedbackReportConfig` (core.js) + wiring (fbHooks, chainHooks 3-й источник)
- **added:** 2026-09-24
- **status:** active
- **last_full_pass:** —
- **risk:** LOW
- **category:** pipeline step 18.5 — system-context directive injection для auto-отчётов (fail-soft при сбое skill-вызова)
- **scenarios:**
  - **unit-тесты фичи** (8 parser + 15 модуль + 3 wiring = 26 новых):
    - run: `node --test plugins/maestro-bootstrap/index.test.js`
    - workdir: `/Users/odemidov/Documents/dev/github/maestro-agent`
  - **memory-тесты** (коэксистенция хуков `system.transform` (communication + feedback-report) / `chat.message` (memory)):
    - run: `npm run test:memory`
    - workdir: `/Users/odemidov/Documents/dev/github/maestro-agent`
  - **[Manual] режим и поведение:**
    | Значение | Поведение на шаге 18.5 |
    |---|---|
    | `"manual"` (дефолт / отсутствует ключ) | Одна строка БЕЗ вопроса: «Для сбора отчёта ретроспективы выполните `@maestro-feedback-report`» |
    | `"auto"` | `skill maestro-feedback-report` с промпт-override: Гейт 0 и HITL-подтверждения подавлены, сессию выбирает оркестратор; fail-soft при стопе/сбое |
    | `"disable"` | Ничего видимого — шаг пропускается |
  - **[Manual] директива только non-manual:** `maestro.json → feedback_report: "auto"` + рестарт → в новой top-level-сессии system-контекст содержит строку `maestro.json → feedback_report: auto`; при `manual`/отсутствии ключа — строки нет.
  - **[Manual] guard — task-сессия (субагент):** директива НЕ инжектится (guard top-level primary: `!data.parentID`).
  - **[Manual] guard — [maestro-memory] / системные:** директива НЕ инжектится (guard: `!title.startsWith("[maestro-memory]")`).
  - **[Manual] лог directive_injected:** при успешной инъекции в primary — `feedback_report:directive_injected` (debug).
  - **[Manual] смена режима:** правка `maestro.json → feedback_report` без рестарта — без эффекта; после рестарта opencode — новый режим активен.
- **regressions:** ⚑1–4 не затрагиваются; `/maestro-setup` не генерирует и не спрашивает `feedback_report`; команда `@maestro-feedback-report` всегда интерактивна (режим влияет только на авто-вызов на шаге 18.5).
- **plugin-version:** 4.8.0
- **tests_total:** плагин 236 (210 baseline + 26 новых) / memory 809 pass (2 skip на Bun)
- **links:** spec `docs/superpowers/specs/2026-09-24-feedback-report-modes-design.md` | plan `docs/superpowers/plans/2026-09-24-feedback-report-modes-plan.md` | changelog `[Unreleased]` → `4.8.0`
