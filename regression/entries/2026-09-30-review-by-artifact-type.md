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
     | `LICENSE` / `LICENSE.MIT` | текстовый (allowlist D5: name-паттерн `LICENSE.*`) |
     | `Dockerfile` / `Makefile` (без точки) | текстовые (безрасширенный перечень D5) → `config` по D2 |
    | `foo.bin` (вне allowlist) | бинарный → HITL-гейт D5 |
    | `docs/superpowers/specs/*.md` | вне детекта (не влияет на набор) |
    | смешанный (напр. `.ts` + `*.md` + `*.json`) | набор {code, docs, config} |
    | пустой/неопределим | `code` (консервативный дефолт) |
   - **sweep (rename):** `grep -rn "code-reviewer"` по живым поверхностям (skills/, commands/, agents/, manual_docs/, plugins/maestro-bootstrap/README.md, README.md, AGENTS.md, docs/project-context.md, maestro.json, *.sh) → 0, кроме: исторических changelog-секций до 4.16.0; тест-фикстуры `plugins/maestro-bootstrap/index.test.js`; migration-note-упоминаний вида «code-reviewer → reviewer» (changelog 4.16.0, `update-maestro.md`, `docs/project-context.md` §8 «(ex code-reviewer)»); stale-очистки в `maestro-install.sh`/`maestro-update.sh`; ссылки на внешний шаблон superpowers `requesting-code-review/code-reviewer.md` (`references/model-selection.md`, pre-existing — файл внешнего пакета)
  - **Анонс/диспатч:** строки «Тип артефакта: <набор> (правило: <сводно>)» и «Параллельное ревью: да/нет — причина: <…>» (причина — тип артефакта); блок «Тип артефакта: …; Активные критерии: …» в промптах `reviewer` и `sonnet`
- **regressions:** ⚑1–4 не затрагиваются; механика #95 (verdict-формат, P1.1, M3, fix-loop, secret-scan SEC-3) не меняется; guard «одна модель» читает `agent.reviewer.model`; плагин — 0 строк
- **links:** spec `docs/superpowers/specs/2026-09-30-review-by-artifact-type-design.md` | plan `docs/superpowers/plans/2026-09-30-review-by-artifact-type-plan.md` | changelog `[2026-09-30]` (4.16.0)

## Follow-up

- FU1: расширение allowlist бинарных/списков детекта по реальным прогонам (канон — `references/artifact-review.md`).
- FU2: семантика `none` в слоте «Миграции (каталоги)» (`init-context.md` кат. 3) — канон-глава определяет только «задан → пути / иначе дефолт-глобы»; поведение при явном `none` + реальном `migrations/`-каталоге не задано (task-review T3, Minor).

## Dogfooding

Финальное ревью этой ветки (шаг 16, 2026-09-30) проведено по новым правилам:

- **Детект:** диф `d183da9..HEAD` — набор **{code, config, docs}** (`*.sh` → code; `maestro.json` → config; `*.md` → docs; вне детекта — `docs/superpowers/{specs,plans}`, changelog, `regression/**`, правило 6); бинарных файлов нет → D5-гейт не сработал.
- **Диспатч:** параллельный путь #95 (категория Сложная; guard «одна модель» не сработал: `agent.sonnet.model` ≠ `agent.reviewer.model`). Senior-роль — `opus` (тип `reviewer` активируется после перезапуска opencode — ограничение сессии, не отклонение от канона).
- **Блок активных критерий** (built-in code/docs/config + §9 override: «указатели/ссылки в manual_docs резолвятся по имени файла») передан в оба промпта.
- **Результат:** 2×`Needs fixes` (union: 0C/2I) → fix-loop (D5-кромка Dockerfile/Makefile/LICENSE.*, sweep-исключения, Minor) → контрольный раунд.
