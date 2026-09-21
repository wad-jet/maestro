# План: версионирование в project-context.md

- **Дата:** 2026-09-21
- **Ветка:** `feature/versioning-in-project-context`
- **Спека:** `docs/superpowers/specs/2026-09-21-versioning-in-project-context-design.md`

## Задачи

1. **Spec + plan** (этот документ + спека). Commit:
   `docs: design + plan for versioning-in-project-context`.

2. **`docs/project-context.md`** §3 — заменить буллит «Текущая версия
   дистрибутива» на блок «Версионирование»: да; semver; версия — корневой
   `package.json → version` (единая для скиллов и плагина); маппинг: новая
   фича/процессное правило → minor, багфикс/патч → patch, memory layer в beta →
   дистрибутивная версия не бампается; релиз: changelog `## [YYYY-MM-DD]` +
   строка «Версия X.Y.Z», синхронизация ссылок (package.json,
   project-context.md, README по факту), отдельный коммит
   `chore: bump version to X.Y.Z — <содержание> (changelog/version)` после merge
   на base-ветке (до push, если не выполнен).

3. **`skills/maestro-setup/init-context.md`** — категория 3: строка
   «Версионирование: да/нет + схема, где живёт версия, маппинг типа изменения
   → уровень, действия при релизе (changelog, синхронизация версий)».

4. **`skills/maestro/SKILL.md`**:
   - шаг 0: в блок извлечения — «правила версионирования (если поле есть в
     §3) — в PROJECT_CONTEXT (bump при релизе по гейту 17/шагу 18)»;
   - гейт 17: перед ВАРИАНТАМИ — «**Версия (если в project context есть
     версионирование):** показать `Версия: <текущая> → <предлагаемая> (правило:
     <тип изменения → уровень>)`; bump выполняется на шаге 18 после merge»;
   - шаг 18: — «**Bump версии (если на гейте 17 была строка версии):**
     выполнить по правилам project context (новая версия, changelog-секция,
     синхронизация ссылок, отдельный коммит `chore: bump version to …`)».

5. **`manual_docs/`**:
   - `explanation/project-context.md` — в таблице обязательных секций,
     категория 3: добавить «версионирование» (схема, где версия, маппинг,
     релиз-действия);
   - `overview/changelog.md` — `[Unreleased]` → «Добавлено»: буллит про поле
     «Версионирование» в project-context + pipeline-hook (гейт 17/шаг 18).

## Коммиты

- Task 1 → `docs: design + plan for versioning-in-project-context`
- Task 2 → `docs: project-context — блок "Версионирование"`
- Task 3 → `docs(maestro-setup): init-context — категория 3, версионирование`
- Task 4 → `docs(maestro): SKILL.md — versioning hook (шаг 0, гейт 17, шаг 18)`
- Task 5 → `docs: manual_docs sync — версионирование в project-context`

## Верификация

- `rg "Версионирование" docs/project-context.md skills/maestro-setup/init-context.md manual_docs/explanation/project-context.md`
- `rg "bump|Версия:" skills/maestro/SKILL.md` — хуки в шагах 0/17/18.
- Язык: русский. Diff-сверка с manual_docs.

## Завершение

- Финальное ревью — `code-reviewer`.
- Гейт 17 (HITL): показать предлагаемую версию **4.3.0 → 4.4.0** (minor, новая
  фича — догфудинг правила).
- После merge: bump 4.3.0 → 4.4.0 (package.json, project-context.md, changelog:
  буллит из `[Unreleased]` **переезжает** в новую секцию `## [2026-09-21]`
  (вторая за день; секция 4.3.0 не переписывается — она уже выпущена) со
  строкой `> **Версия 4.4.0** — <кратко>`; `[Unreleased]` очищается) + push +
  `agpack sync`.
