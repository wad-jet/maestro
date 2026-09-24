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
  - **memory-тесты** (коэксистенция хуков `chat.message` / `system.transform` / `system.transform` от feedback-report):
    - run: `npm run test:memory`
    - workdir: `/Users/odemidov/Documents/dev/github/maestro-agent`
  - **[Manual] manual-режим (дефолт):** в новой сессии без `feedback_report` в `maestro.json` — system-контекст не содержит директивы; primary видит однострочную подсказку в каноне, не задаёт вопросов; `/maestro-feedback-report` интерактивен.
  - **[Manual] auto-режим:** `maestro.json → feedback_report: "auto"` + рестарт → директива «auto» в system-контексте primary; после шага 18 — `skill maestro-feedback-report` с промпт-override (гейт подтверждения подавлен); при отсутствии скилла — fail-soft, пайплайн не блокируется.
  - **[Manual] disable-режим:** `maestro.json → feedback_report: "disable"` + рестарт → директива «disable»; на шаге 18.5 — пропускается.
  - **[Manual] смена режима:** правка `maestro.json → feedback_report` без рестарта — без эффекта; после рестарта opencode — новый режим активен.
