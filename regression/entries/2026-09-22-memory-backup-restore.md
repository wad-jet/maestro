# Regression — memory backup/restore

- **version:** 1
- **feature:** backup/restore memory layer (tool memory_backup + backup-cli.js + @maestro-memory-backup; spec docs/superpowers/specs/2026-09-22-memory-backup-restore-design.md)
- **added:** 2026-09-22
- **status:** active
- **risk:** HIGH
- **category:** vector memory persistence (sqlite-only v1; double-masking, fail-closed manifest, retention)
- **scenarios:**
  - **unit-тесты фичи** (backup.test.js — fail-closed manifest, double-masking, retention, ordering delete→upsert, SCAN_FIELDS):
    - run: `npm run test:memory`
    - workdir: `/Users/odemidov/Documents/dev/github/maestro-agent`
  - **core-тесты плагина:**
    - run: `npm test`
    - workdir: `/Users/odemidov/Documents/dev/github/maestro-agent`
  - **[Manual] E2E backup → restore:** `memory_backup action=backup` → файл `.maestro/memory/backup/backup-<key>-*.jsonl` + `.manifest.json`; затем `memory_backup action=restore` на тот же key → данные восстановлены, double-masking applied
  - **[Manual] E2E CLI restore:** `node plugins/maestro-bootstrap/memory/backup-cli.js restore <path>` — подтверждение через HITL, fail-closed на sha256/model_id/dim/schema_fields

</content>