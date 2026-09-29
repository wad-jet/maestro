# Regression — skillmd-references-reorg (4.14.0)

- **version:** 1
- **feature:** реорганизация SKILL.md → скелет + references/ (10 глав канона)
- **added:** 2026-09-26
- **status:** active
- **risk:** MEDIUM
- **category:** pipeline spec restructuring
- **scenarios:**
  - **(auto) `npm test` — references-coverage:** 5 проверок (указатели/сироты/шапки/лимит ≤1300/внутренние ссылки); 258/258
  - **(auto) паритет:** 2145 base-строк, 35 исключений (inline-указатели + шапки-замещения + перелинковки глав), 0 ошибок (результат: `.maestro/parity/parity-result.txt`)
  - **[Manual] Первый прогон пайплайна на новой структуре:** оркестратор читает главы в точках использования (гейты, security-точки, диспатчи); сабагент-промты self-contained. **Обязателен до пометки roadmap-пункта «Выполнено»**
- **regressions:** ⚑1–4 не затрагиваются (скелет сохраняет все гейты, invariant-указатели, секции pipeline); ссылки на `SKILL.md` в сабагент-промтах и manual_docs обновлены на главы канона

## Follow-up

- FU1: spec §8 «27 кандидатов» → 28 (cosmetic).
- FU2: spec/plan «12 секций» → фактически 14 ##-заголовков (cosmetic).
- FU3: spec §3 trust-and-security 268 → 270 (cosmetic).
- FU4: spec «dogfood-смoke» mixed-script опечатка (cosmetic).
- FU5: invariants.md:27 «(см. skills/maestro/SKILL.md, §5)» — pre-existing битая §-ссылка (out of scope).

- **links:** spec `docs/superpowers/specs/2026-09-26-skillmd-references-reorg-design.md` | plan `docs/superpowers/plans/2026-09-26-skillmd-references-reorg-plan.md` | changelog `[2026-09-26]`
