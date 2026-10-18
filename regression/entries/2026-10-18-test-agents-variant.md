# Regression — /test-agents: variant + факт-модель (#112)

- **version:** 1
- **feature:** расширение /test-agents: колонки `Модель (факт)` и `Variant` из `opencode session export`, self-report сверка, temperature не экспонируется
- **added:** 2026-10-18
- **status:** active
- **risk:** LOW — новая колонка меняет output формат, fallback legacy `opencode export` на случай V1; temperature не добавляется (документировано почему).
- **category:** command output format (/test-agents)
- **scenarios:**
  - **unit:** `npm test` — все тесты зелёные
  - **[Manual] E2E V2 export:** `opencode session export <id>` → `info.model` содержит variant → таблица заполнена корректно
  - **[Manual] E2E legacy fallback:** `opencode session export` fail → `opencode export <id>` fallback → таблица заполнена
  - **[Manual] E2E variant absent:** модель без variant → колонка `—`
  - **[Manual] E2E self-report mismatch:** модель врёт о себе → ⚠ в self-report, статус OK
