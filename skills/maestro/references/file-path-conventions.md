# File Path Conventions (глава)

> Канон: file-path-conventions. Грузится из `skills/maestro/SKILL.md` на шаги 8/11 (создание spec/plan/регресс-артефактов).
> Читается оркестратором (имеющим SKILL.md в контексте); внутри главы
> допускаются ссылки «см. SKILL.md, <секция скелета>» и на другие главы.

## File Path Conventions

- Spec файлы: `docs/superpowers/specs/YYYY-MM-DD-<feature-name>-design.md`
- Plan файлы: `docs/superpowers/plans/YYYY-MM-DD-<feature-name>-plan.md`
- Roadmap: `docs/roadmap.md` (MVP + этапы развития; создаётся `/maestro-design`
  для новых проектов) — вход для планирования спринтов
- SDD progress: `.maestro/sdd/progress.md` (в `.gitignore`, весь `.maestro/`)
- Regression registry: `regression/entries/YYYY-MM-DD-<feature-name>.md`
  (в git, `references/regression-registry.md`)

### Git: design-документы (spec + plan + regression entry)

`superpowers` (SDD) не коммитит spec/plan — это артефакты **до** SDD, и их
коммит — зона ответственности `maestro`. SDD ожидает чистый BASE-коммит
перед стартом (он отмеряет code-коммиты от него), поэтому к шагу 13 working
tree должен быть чистым.

- **Когда:** после gate шага 12 (plan утверждён). Spec, plan и regression
  entry коммитятся **одним коммитом**, до старта SDD.
- **Сообщение:** `docs: design + plan for <feature-name>` (или `docs: spec + plan
  for <feature-name>`).
- **Почему одним, а не двумя:** spec, plan и entry — связанная группа
  дизайн-артефактов (entry — сценарии рисков из плана, шаг 12a); отдельные
  коммиты дают историю без дополнительной ценности. Code-коммиты (по
  task) делает уже SDD — их не дублируем.
- **BASE для SDD:** последний коммит (этот design+plan). SDD отмеряет от него
  свои per-task code-коммиты.
- **Простые фичи** (шаг 7b — spec не создаётся): если план пишется, коммитить
  его тем же правилом; если и план пропущен (trivial fix) — design-коммита нет,
  SDD стартует от текущего HEAD.
- **Отмена (10c/12c):** cleanup ветки/worktree (см. «Gate: отмена» в таблице
  «Обработка сбоев») — design-коммит уходит вместе с веткой.
