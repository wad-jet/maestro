# Regression — отказоустойчивость сабагентов (2026-09-18)

- **version:** 1
- **feature:** feature/subagent-resilience
- **added:** 2026-09-18
- **status:** active
- **risk:** LOW
- **scenarios:**
  - **session.error с деталями:** (core.js):
    - run: форсированное прерывание диспатча (Esc) → `.maestro/logs` содержит `session.error` с `aborted: true`
    - run: `node --test plugins/maestro-bootstrap/index.test.js` → 171 pass
  - **anti-loop 1 повтор:** (SKILL.md):
    - run: grep -in "3 попыток" skills/maestro/SKILL.md → 0
    - run: grep -in "сразу HITL" skills/maestro/SKILL.md → 0
  - **SCOPE NOTE:** (SDD SKILL.md + review-package):
    - run: review-package выводит секцию "Auxiliary commits (out of scope)"
  - **feedback-report:** aborted-прерывания не в счётчике ошибок
  - **confidential-доступ trusted-агентов (custodian/sanitizer):**
    - run: custodian/sanitizer выполняют работу с confidential-данными → работает
    - workdir: корень целевого приложения
