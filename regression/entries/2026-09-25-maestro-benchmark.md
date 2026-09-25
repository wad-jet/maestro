# Regression — maestro-benchmark

- **version:** 1
- **feature:** benchmark для maestro — фиксированное задание в песочнице, отчёт прогона, сверка с прошлыми результатами
- **added:** 2026-09-25
- **status:** active
- **risk:** MEDIUM
- **category:** process tooling
- **scenarios:**
  - **sandbox --benchmark** (`maestro-sandbox.sh`):
    - run: `node --test skills/maestro-benchmark/sandbox-smoke.test.mjs`
    - workdir: `/Users/odemidov/Documents/dev/github/maestro-agent`
  - **diff.mjs** (`skills/maestro-benchmark/diff.mjs`):
    - run: `node --test skills/maestro-benchmark/diff.test.mjs`
    - workdir: `/Users/odemidov/Documents/dev/github/maestro-agent`
  - **plugin без регрессий** (`plugins/maestro-bootstrap/`):
    - run: `node --test plugins/maestro-bootstrap/index.test.js`
    - workdir: `/Users/odemidov/Documents/dev/github/maestro-agent`
  - **[Manual] Benchmark E2E G1–G6** (opencode, песочница): run → прогон → report → diff (`docs/testing/maestro-sandbox-checklist.md`)
- **regressions:** ⚑1–4 не затрагиваются; benchmark — процессный инструмент, не меняет пайплайн maestro, plugin hooks, observability, memory; `.maestro/benchmark-reports/` — эфемерное (gitignored). Non-goals: интеграция в стандартный пайплайн maestro, изменение скиллов/команд/агентов maestro
