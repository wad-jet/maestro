# Regression — spec-signature-hardening

- **version:** 1
- **feature:** ужесточение обработки подписей spec (fast-track 7d): подпись = provenance-рекомендация, не авто-пропуск 8.6/9; планы не маркируются
- **added:** 2026-09-09
- **status:** active
- **last_full_pass:** —
- **risk:** MEDIUM
- **category:** pipeline spec/plan (подписи spec, fast-track re-entry, SECURITY.md P7, manual_docs)
- **scenarios:**
  - **В SKILL.md не осталось авто-skip правил по подписи для 7d-входов** (шаги 7d, 8.6, 9, Security Review Точка 1):
    - run: `rg -n 'подпись.*пропуск|пропускаются без вопроса|-> шаг 8.6 пропускается|-> шаг пропущен' skills/maestro/SKILL.md` → не должно быть совпадений, описывающих авто-пропуск 7d-входов по подписи
    - workdir: `/Users/odemidov/Documents/dev/github/maestro-agent`
  - **manual_docs не содержат старых формулировок «валидная подпись → гейт пропускается»**:
    - run: `rg -n 'валидная подпись.*пропускает|-> шаги 9/10 пропускаются без' manual_docs/` → не должно быть совпадений
    - workdir: `/Users/odemidov/Documents/dev/github/maestro-agent`
  - **Регресс плагина (не менялся, проверка целостности):**
    - run: `npm test`
    - workdir: `/Users/odemidov/Documents/dev/github/maestro-agent`
  - **[Manual] fast-track re-entry в реальной сессии:** при входе через 7d с валидной `CLEAN`-подписью оркестратор не пропускает 8.6 авто; предлагает (a)/(b) для ревью (9); HITL-заверение → skip 8.6 только при валидной `CLEAN`; `FINDINGS_ACCEPTED` → 8.6 всегда.
