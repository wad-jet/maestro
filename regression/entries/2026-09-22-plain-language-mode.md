# Regression — plain-language-mode

- **version:** 1
- **feature:** режим «простой язык»: communication-ключ (дефолт plain) + флаг --plain + инъекция директивы плагина
- **added:** 2026-09-22
- **status:** active
- **last_full_pass:** —
- **risk:** MEDIUM
- **category:** plugin hook-wiring (communication + memory coexistence) + флип дефолта коммуникации
- **scenarios:**
  - **unit-тесты фичи** (`loader` / `detectPlainFlag` / лейблы / hook-матрица / wiring):
    - run: `node --test plugins/maestro-bootstrap/index.test.js`
    - workdir: `/Users/odemidov/Documents/dev/github/maestro-agent`
  - **memory-тесты** (коэксистенция хуков `chat.message` / `system.transform`):
    - run: `npm run test:memory`
    - workdir: `/Users/odemidov/Documents/dev/github/maestro-agent`
  - **[Manual] инъекция только в primary:** в новой сессии (дефолтный конфиг) system-контекст содержит директиву «простой язык»; в task-сессиях субагентов и `[maestro-memory]`-саммаризатора её нет (проверка: качество саммари памяти не деградирует; log `communication:directive_injected` — только primary sessionID).
  - **[Manual] флаг против professional:** `maestro.json → communication: "professional"` + рестарт + `@maestro-init --plain "…"` → простой язык активен, директива с пометкой «переопределяет»; без флага — технический язык.
  - **[Manual] смена режима через /maestro-assistant:** после правки без рестарта эффект отсутствует; после рестарта opencode — меняется (лог `communication:config_fallback` при невалидном значении).
