# Regression — maestro-memory-skill (4.15.0)

- **version:** 1
- **feature:** скилл `maestro-memory` — канон промтов команд `@maestro-memory*` (гейт доступности → ядро, тела → 5 references, команды → тонкие лоадеры)
- **added:** 2026-09-30
- **status:** active
- **risk:** LOW
- **category:** prompt reorganization (commands → skill + references)
- **scenarios:**
  - **(auto) `npm test`:** 264 pass / 0 fail (включая `maestro-install/commands-skill-coverage.test.mjs` — команда → скилл + свой reference + оба agpack.yml; и `skills/maestro-memory/references-coverage.test.mjs` — указатели/сироты/лимит ядра ≤ 120)
  - **(auto) паритет (one-shot, эфемерный скрипт):** 405 base-строк (`e346a23:commands/maestro-memory*.md`), 39 исключений (19 гейт→ядро, 17 переприцеленные ссылки, 3 дедуп в ядро; классы шапки/glue/нормализации — 0: frontmatter/Язык сохранены дословно в лоадерах), 0 ошибок (результат: `.maestro/parity/parity-memory-skill-result.txt`; скрипт: `.maestro/parity/parity-memory-skill.mjs`)
  - **(auto) sweep:** `grep -rn 'см. `@maestro-memory`\|@maestro-memory шаг' commands/ skills/` (кроме 5 лоадеров) → 0
  - **[Manual] Dogfood: `@maestro-memory` + `@maestro-memory-report`, включая off-путь.** Post-merge + push + `agpack sync`: команды загружают скилл, гейт доступности (config-first) ветвится на практике, off-секции выводят текущие формулировки. **Обязателен до закрытия TODO:81**
- **file-в-файл маппинг (base `e346a23` → target):**
  - `commands/maestro-memory*.md` (5, 527 строк) → 5 тонких лоадеров (frontmatter **без изменений**; тело — «загрузи skill `maestro-memory`» + свой `references/<x>.md`)
  - Шаг 1 (status) + шаг 1.1 (report) — гейт доступности → ядро `skills/maestro-memory/SKILL.md` («Гейт доступности» 1.1–1.4, config-first, устойчивая нумерация как якорь)
  - Тела (шаги, таблица дефолтов, SQL/HTML-fallback, preview, HITL-флоу, аварийный CLI) → `skills/maestro-memory/references/{status,report,prune,reindex,backup}.md` (внутренняя нумерация сохранена; off-секция — первая)
  - «см. `@maestro-memory`» / «@maestro-memory шаг 1.2» (prune/reindex/backup/report) → «Гейт доступности, п. 1.3 (ядро скилла `maestro-memory`)» / «ядро» (висячие кросс-ссылки стали резолвимыми)
- **regressions:** ⚑1–4 не затрагиваются (0 изменений поведения: имена команд, frontmatter, выводные форматы, off-сообщения status/report — без изменений; SEC-4b — одно общее правило в ядре + enforcement в report.md); no-bash-fallback сохранён — **примечание:** grep-цель сценария no-bash-fallback entry `2026-09-24-maestro-config-read-tool.md` смещается с `commands/*.md` на `skills/maestro-memory/**` (для будущих прогонов `@regression`)

## Follow-up

- FU1: `skills/maestro-memory/references-coverage.test.mjs` — dead code (неиспользуемый `refs`-объект, строка 12) + добавить тест «шапки глав» (4 строки, по образцу `skills/maestro/references-coverage.test.mjs`).
- FU2: off-секции prune/reindex/backup — явно выделить ветку «плагин недоступен» (сообщение уже выводит гейт 1.1; буквальное следование шаблону может дублировать вывод) — 4.16.

- **links:** spec `docs/superpowers/specs/2026-09-30-maestro-memory-skill-design.md` | plan `docs/superpowers/plans/2026-09-30-maestro-memory-skill-plan.md` | changelog `[2026-09-30]`
