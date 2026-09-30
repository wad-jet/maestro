# Regression — review-by-artifact-type (#107, 4.16.0)

- **version:** 1
- **feature:** шаг 16 — ревью по типу артефакта: типы `code`/`docs`/`config`/`sql` (механический детект дифа по закрытым спискам, приоритет `sql` → `config` → `docs` → `code`), built-in-критерии + override `project-context.md` §9 (по-пунктный merge, приоритет §9), бинарный HITL-гейт D5 (allowlist текстовых расширений, deny-by-default), параллельное первое ревью — только `code`; новая 11-я глава канона `skills/maestro/references/artifact-review.md`; **rename `code-reviewer` → `reviewer`** (D8). Плагин — без изменений
- **added:** 2026-09-30
- **status:** active
- **risk:** LOW
- **category:** скилл `maestro` (SKILL.md шаг 16 + `references/artifact-review.md` + `agents/reviewer.md` + `agents/sonnet.md` + `maestro-setup`-шаблон; process rules, 0 строк плагина)
- **scenarios:**
  - **(auto) `npm test`:** 0 fail (включая anti-orphan/coverage-тесты глав `references/` — новая глава покрыта)
  - **Сценарии детекта (детерминированные):**
    | Диф | Ожидание |
    |---|---|
    | `*.md` (любой путь) | `docs` |
    | `*.sql` | `sql` |
    | `maestro.json` | `config` |
    | `Dockerfile` | `config` |
    | `*.test.json` в `tests/` | `code` (test-фикстуры вне `config`) |
    | `LICENSE` | текстовый (allowlist D5) → детект по типу |
    | `foo.bin` (вне allowlist) | бинарный → HITL-гейт D5 |
    | `docs/superpowers/specs/*.md` | вне детекта (не влияет на набор) |
    | смешанный (напр. `.ts` + `*.md` + `*.json`) | набор {code, docs, config} |
    | пустой/неопределим | `code` (консервативный дефолт) |
  - **sweep (rename):** `grep -rn "code-reviewer"` по живым поверхностям (skills/, commands/, agents/, manual_docs/, plugins/maestro-bootstrap/README.md, README.md, AGENTS.md, docs/project-context.md, maestro.json, *.sh) → 0, кроме migration-note-упоминаний вида «code-reviewer → reviewer» (changelog 4.16.0, `update-maestro.md`), исторических changelog-секций до 4.16.0 и тест-фикстуры `plugins/maestro-bootstrap/index.test.js`
  - **Анонс/диспатч:** строки «Тип артефакта: <набор> (правило: <сводно>)» и «Параллельное ревью: да/нет — причина: <…>» (причина — тип артефакта); блок «Тип артефакта: …; Активные критерии: …» в промптах `reviewer` и `sonnet`
- **regressions:** ⚑1–4 не затрагиваются; механика #95 (verdict-формат, P1.1, M3, fix-loop, secret-scan SEC-3) не меняется; guard «одна модель» читает `agent.reviewer.model`; плагин — 0 строк
- **links:** spec `docs/superpowers/specs/2026-09-30-review-by-artifact-type-design.md` | plan `docs/superpowers/plans/2026-09-30-review-by-artifact-type-plan.md` | changelog `[2026-09-30]` (4.16.0)

## Follow-up

- FU1: расширение allowlist бинарных/списков детекта по реальным прогонам (канон — `references/artifact-review.md`).
- FU2: семантика `none` в слоте «Миграции (каталоги)» (`init-context.md` кат. 3) — канон-глава определяет тользадан → пути / иначе дефолт-глобы»; поведение при явном `none` + реальном `migrations/`-каталоге не задано (task-review T3, Minor).

## Dogfooding

_(заполнит оркестратор после шага 16: анонс набора типов, dispatch parallel/single, блок активных критерий в промптах)_
