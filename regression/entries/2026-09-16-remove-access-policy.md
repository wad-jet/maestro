# Regression — удаление access_policy (2026-09-16)

- **version:** 1
- **feature:** feature/remove-access-policy
- **added:** 2026-09-16
- **status:** active
- **risk:** HIGH (maestro.json/.maestro) + MEDIUM (удаление секции)
- **scenarios:**
  - **Нативный deny read maestro.json/.maestro:** (`.opencode/opencode.json` deny-правила):
    - run: read `maestro.json` через read-тул → блокируется нативно (deny)
    - run: read `.maestro/plugin-version` → работает (allow-исключение)
    - workdir: корень целевого приложения
  - **/maestro-version после рестарта:**
    - run: "/maestro-version" → version отображается
    - workdir: корень целевого приложения
  - **/maestro-feedback-report:**
    - run: "/maestro-feedback-report" → отчёт в `.maestro/feedback-reports/`
    - workdir: корень целевого приложения
  - confidential-доступ trusted-агентов (custodian/sanitizer):
    - run: custodian/sanitizer выполняют работу с confidential-данными → работает
    - workdir: корень целевого приложения
  - **sanitizer (Mask):**
    - run: Ур.1 и Ур.2 маскируют промпты → pass
    - workdir: корень целевого приложения
  - **AC9 — edit maestro.json из untrusted-сабагента:**
    - run: untrusted-сабагент правит `maestro.json` → ask-HITL или deny/error
      (fail-closed, НЕ auto-allow)
    - workdir: корень целевого приложения
