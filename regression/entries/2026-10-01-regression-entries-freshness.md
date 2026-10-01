# Regression — regression-entries-freshness (4.19.0)

- **version:** 1
- **feature:** cross-entry reconciliation (4.19.0): пайплайн (шаги 11/13f) поддерживает актуальность чужих regression-entries — шаг 11: cross-entry selection («под угрозой» entries: цели сценариев `path` → file-аргумент `run:` ∩ file-set плана, cap ≤ 5); шаг 13f: сверка (existence + diff-условные: дрейф `path:line` — категория A, числовые ожидания `→ N pass/fail/0` — категория B); `active` — обновление через HITL, `verified` — read-only чек; 0 запусков чужих тестов (carve-out — bounded-запуск одного сценария). Плагин — без изменений
- **added:** 2026-10-01
- **status:** active
- **risk:** LOW (каноны доков: скелет SKILL.md + глава `references/regression-registry.md` + `commands/regression.md` + 2 страницы manual_docs; плагин, конфиг, pipeline-код не затронуты)
- **category:** `skills/maestro/SKILL.md` (шаги 11/13f), `skills/maestro/references/regression-registry.md`, `commands/regression.md`
- **scenarios:**
  - **(auto) `npm test`:** зелёный — 266/266; drift-тест D4: «Выполнено (4.19.0, …)» в roadmap и «реализовано (2026-10-01, 4.19.0, #103)» в TODO ↔ changelog 4.19.0 согласовано; `changelog.md` исключён из D1c (история версий); STALE_NAMES отсутствуют.
  - **[Manual] cross-entry 13f end-to-end:** прогон фичи, дифф которой трогает файл-цель сценария чужого entry (напр. grep по `skills/maestro/SKILL.md`) → шаг 11: селекция «под угрозой» (cap ≤ 5, секция `## Cross-Entry Reconciliation` в плане, видна на гейте 12) → 13f: сверка по фактическому диффу (existence + diff-условные, категории A/B) → один HITL-гейт на все entries (a/b/c: обновить / `[Manual]` / удалить) → авто-коммит обновлённого entry (`chore(regression): <feature> entry reconciled by <текущая-фича>`, только путь entry).
- **regressions:** ⚑1–4 не затрагиваются; плагин и конфиг не изменены;
  - (a) **шардинг-конфликт** — коммит чужого entry из ветки текущей фичи делает инвариант «1 файл = 1 фича, конфликт параллельных pipeline невозможен по построению» маловероятным, а не невозможным; mitigation: при merge-конфликте entry — повторная reconciliation после мержа (канон уточнён в главе `regression-registry.md`);
  - (b) **vacuous-full / пустой entry** — `full` на entry без automated-сценариев не верифицирует (guard: статус не меняется, предупреждение «skipped: no automated scenarios»); пустой active-entry запрещён (HITL: → `released/` со `status: cancelled` — единственный статус-переход хука).
- **links:** changelog `[2026-10-01]` (4.19.0) | `manual_docs/how-to/keep-docs-up-to-date.md` | спека `docs/superpowers/specs/2026-10-01-regression-entries-freshness-design.md` | план `docs/superpowers/plans/2026-10-01-regression-entries-freshness-plan.md`

## Follow-up

— (FU из спеки нет; known limitations — prose-сценарии без машинных целей и verified best-effort — зафиксированы как ограничения, не задачи)

## Dogfooding

Baseline-кейс (оркестратор-чекпоинт после T3, критерий 5 спеки): entry
`2026-09-19-process-rules.md` — сценарий «Прерванное ревью возобновляется»
(`grep "≠ отказ от ревью" … → ≥1`) имел цель `skills/maestro/SKILL.md`, а
после 4.14.0 reorg текст перенесён в `references/model-selection.md`
(дрейф локации — категория A). 13f этой фичи зафиксировал расхождение,
HITL-обновление (a) — цель → `skills/maestro/references/model-selection.md`,
авто-коммит `chore(regression): process-rules entry reconciled by
regression-entries-freshness` (c106090). Числовой кейс «171 pass»
(`2026-09-18-subagent-resilience.md`) — пересечения не дал, как ожидалось:
цель `index.test.js` вне диффа 4.19.0 (diff-условие D2).
