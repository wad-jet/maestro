# Regression — memory-audit-log

- **version:** 1
- **feature:** memory layer audit log (dedicated maestro-memory-*.log, aggregates-only whitelist)
- **added:** 2026-09-08
- **status:** active
- **risk:** MEDIUM
- **category:** memory plugin
- **scenarios:**
  - **core.js makeLogger** (`plugins/maestro-bootstrap/core.js` — новая опция `logDir` не должна сломать bootstrap/audit-логи):
    - run: `node --test plugins/maestro-bootstrap/index.test.js`
    - workdir: `/Users/odemidov/Documents/dev/github/maestro-agent`
  - **registerMemoryHooks signature** (`plugins/maestro-bootstrap/memory/index.js` — опц. `memoryLog`, fallback на log; carve-out `memory: disabled`/`init failed` в bootstrap-логе):
    - run: `node --test plugins/maestro-bootstrap/memory/index.test.js`
    - workdir: `/Users/odemidov/Documents/dev/github/maestro-agent`
  - **storage timed-обёртки** (`plugins/maestro-bootstrap/memory/storage.js` + backends — log/timed не меняют поведение):
    - run: `npm run test:memory`
    - workdir: `/Users/odemidov/Documents/dev/github/maestro-agent`
  - **[Manual] SEC-4b:** после работы памятью — ни одна строка `.maestro/logs/maestro-memory-*.log` не содержит текста записей/запросов, confidential-путей, `base_url`, raw branch с ticket-кодом (`docs/testing/maestro-sandbox-checklist.md`)