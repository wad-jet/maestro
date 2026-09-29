# Regression — skillmd-skeleton-hygiene (4.14.1)

- **version:** 1
- **feature:** гигиена скелета SKILL.md — дедуп/растворение дубликатов, rationale → manual_docs
- **added:** 2026-09-29
- **status:** active
- **risk:** LOW
- **category:** pipeline spec hygiene
- **scenarios:**
  - **(auto) `npm test` — references-coverage + plugin:** 258 pass (детерминированная проверка канона + ESM bootstrap)
  - **(auto) `wc -l skills/maestro/SKILL.md` ≤ 1300:** скелет сокращён (~1160)
  - **[Manual] Dogfood: OP-5 из Overview.** Прогон пайплайна — `maestro-assistant` загружается по правилу в required skills-листе (description), работает корректно.
  - **[Manual] Dogfood: таблица «Обработка сбоев» целостна.** Оркестратор читает merged-секцию сходов/расхождений без путаницы между Step 15 и 15a.
- **regressions:** ⚑1–4 не затрагиваются (0 изменений поведения; security-правила и гейты untouched); дедуп — union фактов из обоих экземпляров, механика сохранена

## Follow-up

- FU1: слово «структуры» в триггерах OP-5 — `maestro-assistant` покрывается по своему description (автозагрузка при вопросе настройки); дополнить осознанно при желании (не баг).
- FU2: `git-commit` в каноне — фантомное имя (скилл/команда не существует, устаревшая ссылка из скелета); удалено вместе с дублем.

- **links:** spec — нет (простая фича, короткий дизайн в чате 2026-09-29) | plan — нет
