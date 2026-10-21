# Pipeline Isolation & Merge-Scope Hardening

> **Дата:** 2026-10-21  
> **Автор:** primary (оркестратор)  
> **Стейт:** черновик  
> **Репозиторий:** maestro-agent (authoring)  
> **Версия:** 1.0.0-draft

---

## 1. Problem

Пайплайн maestro не различает «мы изолированы» и «workspace занят чужой активной фичей». Класс инцидентов, где задача стартует на занятом workspace → ветка задачи создаётся от чужого HEAD → merge в mainline протаскивает незавершённую чужую работу в обход её собственного гейта 17.

### Пример инцидента (2026-10-21)

1. Текущая ветка: `feature/docker-serve-design` — чужая активная фича (3 незавершённых коммита, не прошедших свой гейт 17).
2. Оператор создал ветку `fix/maestro-config-migration` от `feature/docker-serve-design` HEAD (вместо mainline).
3. Merge в main (fast-forward) протащил **4 коммита** вместо 1: 3 чужих docker-serve (1126 строк спеки) + 1 config-fix.
4. Merge-guard (P9) проверял только наличие маркера гейта 17 — не содержимое merge.

**Корневые причины:**
- Pre-flight не детектирует «workspace занят чужой фичей» (шаг 3 SKILL.md);
- Шаг 6 не предлагает выбор изоляции (worktree vs ветка); `using-git-worktrees` не загружается до выбора;
- Ветка задачи ветвится от текущего HEAD, а не от mainline;
- Гейт 17 подтверждается без показа merge-scope (user says «merge» без знания, что вольётся).

## 2. Goals

1. **Детект занятости workspace** (шаг 3): текущая ветка ≠ mainline и матчит паттерн task-ветки → сигнал «workspace занят чужой фичей» → рекомендация worktree.
2. **Изоляция как явный HITL** (шаг 6): выбор (a) worktree / (b) plain branch / (c) cancel; `using-git-worktrees` загружается **до** выбора.
3. **Базирование ветки задачи — всегда от mainline**: `git worktree add -b <branch> <dir> <mainline>` / `git checkout -b <branch> <mainline>`; запись `BRANCH_BASE_SHA` в переменные сессии.
4. **Гейт 17 = ревью merge-scope**: обязательный показ `git log --oneline mainline..HEAD` + `git diff --stat mainline...HEAD`; чужие коммиты в scope → hard stop.
5. **Механические гарды плагина** (закрывают класс даже при пропуске инструкций LLM):
   - **Branch-base guard**: `git checkout -b`/`git worktree add -b` без явного base при не-mainline текущей ветке → warn (default) / deny (`branch_base_guard: "deny"` в `maestro.json`).
   - **Head-pin маркера гейта 17**: маркер дополняется `head: <SHA>`; при merge — HEAD обязан совпадать с зааппрувленным (пост-аппрув мутации scope).

## 3. Non-goals

- Блокировка двух параллельных пайплайнов на одном репо (workspace-locking) — вне scope;
- Изменение дефолтов merge-guard TTL/семантики для существующих флоу;
- Восстановление текущего инцидента (откат main) — отдельная операционная задача (уже выполнена);
- Cross-repo сценарии (polyrepo уже имеет свой канон).

## 4. Design

### 4.1. Шаг 3 — Workspace occupancy check (new)

**Где:** `skills/maestro/SKILL.md`, шаг 3 (Pre-flight диагностика).

Новый блок после стандартных сигналов pre-flight:

```
🟡  3. [agent] Pre-flight: диагностика состояния
...
— **Workspace occupancy (новый):**
   - `git branch --show-current` ≠ mainline (main/master/develop, auto-детект)
     И ветка матчит паттерн `feature/*|fix/*|hotfix/*` → **SIGNAL: workspace occupied by foreign feature**
     (показать имя ветки) → isolation recommendation = **worktree**
   - `git branch --show-current` ≠ mainline, other pattern → сигнал + явный HITL
   - `git branch --show-current` == mainline → "free workspace"
```

**Результат в сессию:** одно предложение — «Предуведомление: текущий workspace занят веткой `<name>` (чужая активная фича). Рекомендуется worktree.»

### 4.2. Шаг 6 — Isolation HITL (modified)

**Где:** `skills/maestro/SKILL.md`, шаг 6 (Изоляция).

Модификация: шаг 6 получает явный HITL-гейт (вместо implicit действия). `using-git-worktrees` загружается ДО гейта.

```
🟢  6. [agent] Загрузить `using-git-worktrees`
      -- HITL GATE: выбрать изоляцию --
      (a) worktree [рекомендуется, если workspace occupied]
          `git worktree add -b <branch> <dir> <mainline>`
      (b) plain branch
          `git checkout -b <branch> <mainline>`
          Только при mainline + clean tree
      (c) отмена
      Примечание:
        - База ВСЕГДА <mainline> — явный, не implicit HEAD
        - Исключение (stacked на чужую фичу): только явный HITL
          «Я знаю, что делаю: стекаю поверх <branch>» — с предупреждением о рисках
        - Записать в session vars: BRANCH_BASE_SHA, BRANCH_NAME
        - При worktree: вызвать `tools.opencode.session_move` к worktree-dir
```

**Правило базы:** `<mainline>` всегда явный аргумент. Исключение — user HITL.

**Stacked-исключение** — не рекомендуется, но легально по запросу. Предупреждение: «Стекинг поверх чужой фичи создаёт риск merge-scope contamination; при merge в mainline будет проверяться чужой контент».

### 4.3. Шаг 17 — Merge-scope review (modified)

**Где:** `skills/maestro/SKILL.md`, гейт 17 (pre-PR).

Новый пред-гейт шаг перед маркером:

```
-- HITL GATE: ревью merge-scope --
Оркестратор обязан показать:
  $ git log --oneline <mainline>..HEAD
  $ git diff --stat <mainline>...HEAD
— и сравнить с ожидаемыми коммитами пайплайна (design+plan + SDD tasks).

Если в scope обнаружены коммиты, не созданные этим пайплайном
(до шага 6, или чужая ветка):
  **HARD STOP**: «Merge scope содержит N чужих коммитов»
  (a) rebase fix branch onto mainline и продолжить
  (b) продолжить с явным acknowledge: «я осознаю, что мержит чужую работу»
  (c) отмена

Если scope чист — продолжить к маркеру гейта 17.
```

**Механический индикатор:** merge-base(mainline, HEAD) должно == BRANCH_BASE_SHA (записано при создании ветки). Расхождение = сигнал «scope загрязнён».

### 4.4. Плагин: branch-base guard

**Где:** `plugins/maestro-bootstrap/merge-guard.js`, `core.js`.

Новый guard детектит bash-команды:
- `git checkout -b <name>` (без `--orphan`/`-t`)
- `git worktree add -b <name> <dir>`

И проверяет:
1. Текущая ветка == mainline (main/master/develop, auto-детект)?
2. Если нет → есть ли явный base-аргумент. **Детекция base — по числу токенов** (`command.trim().split(/\s+/)`), устойчиво к дополнительным флагам:
   - `git checkout -b <name>` — 4 токена → base нет; 5+ токенов → base есть;
   - `git worktree add -b <name> <dir>` — 6 токенов → base нет; 7+ токенов → base есть;
   - `--orphan` → guard не применяется.
3. Нет base + не mainline → **warn** (default) / **deny** (`branch_base_guard: "deny"` в `maestro.json`).

**Конфиг:** `merge_guard.branch_base_guard: "warn" | "deny" | "off"` (default `"warn"`).

**Результат:** warn — log + one-time session notice; deny — throw blocks bash call.

### 4.5. Плагин: head-pin маркера гейта 17

**Где:** `plugins/maestro-bootstrap/merge-guard.js`.

Модификация `checkMergeMarker`:

1. **Порядок создания маркера (строгий):**
   1. Merge-scope review (HITL-гейт выше) пройден, scope чист;
   2. `head = git rev-parse HEAD` — **снимок HEAD сразу после аппрува, до любых дальнейших действий**;
   3. Запись маркера v2: `{ sessionID, ts, gate: 17, decision: "a", head }`;
   4. Выполнение merge/push.
   
   Любой коммит между шагами 2–4 меняет HEAD → маркер невалиден → merge-guard deny.

2. При проверке (при `git merge`/`git push mainline`):
   - Читаем `head` из маркера.
   - `git rev-parse HEAD` текущего времени.
   - **HEAD не совпадает** → deny: `reason: "marker_head_mismatch"`.

**Обратная совместимость:** маркеры v1 (без `head`) → игнорируем head-pin (прежнее поведение). Old-marker + head-mismatch = allow (no-break). New-marker = enforced.

**Правило:** `head_pin: true | false` в `maestro.json → merge_guard` (default `false` для обратной совместимости).

### 4.6. Тесты

**Unit (`merge-guard.test.js`):**
- `describe("merge-guard detectCheckoutCommand")` — детект `checkout -b` / `worktree add -b` (вкл. `--orphan` skip, `echo` skip, без `-b` → null);
- `describe("merge-guard checkBranchBaseGuard")` — mainline base / explicit base / warn / deny / guard_error (fail-closed при deny);
- `describe("merge-guard checkMergeMarker: head-pin (v2)")` — HEAD==marker.head / HEAD≠marker.head / v1-marker backward compat / head_pin=false / execGit throw;
- `describe("merge-guard resolveMergeGuardConf")` — новые ключи `branch_base_guard`, `head_pin` + дефолты.

**Integration (`index.test.js`):** hook в core.js — warn-path (log + notice, без throw) и deny-path (throw блокирует bash-вызов).

**Docs-drift:** `maestro-install/docs-drift.test.mjs` (версии, пути SKILL.md).

### 4.7. Документация

- `manual_docs/reference/skills.md` — обновление SKILL.md ссылок (steps 3, 6, 17);
- `manual_docs/how-to/update-maestro.md` — changelog entry;
- `SECURITY.md` — запись в §7 (open questions / hardening);
- Changelog `manual_docs/overview/changelog.md` — секция `## [date]`, bullet `> **Версия X.Y.Z** — pipeline isolation hardening (branch-base guard, head-pin merge marker, merge-scope review gate 17)`;
- Regression registry: entry LOW priority для инцидента 2026-10-21 → resolved.

## 5. Decisions (HITL-утверждены)

| # | Вопрос | Решение | Обоснование |
|---|--------|---------|-------------|
| 1 | Scope механических гардов | **Полный** (branch-base guard + head-pin) | branch-base ловит инцидент механически; head-pin — смежный подкласс (пост-аппрув мутации) |
| 2 | Правило базы ветки | **Default mainline + HITL-исключение** | Stacked-ветки редки, но легитимны; default mainline предотвращает инцидент по умолчанию |
| 3 | Foreign commits на гейте 17 | **Hard stop + HITL escape** | «Warn-only» не сработал в инциденте; hard stop требует явного acknowledge |
| 4 | Версия | **minor** | Process rule change (SKILL.md) + plugin feature |
| 5 | Категория фичи | **Архитектурная** | 5+ файлов, cross-layer (SKILL.md + plugin code + tests + docs), Spec Review обязателен |

## 6. Implementation plan (оценка)

| Task | Файл(ы) | Оценка |
|------|---------|--------|
| 1. Шаг 3: workspace occupancy | SKILL.md (шаг 3) | ~0.5h |
| 2. Шаг 6: isolation HITL + base rule | SKILL.md (шаг 6) | ~0.5h |
| 3. Шаг 17: merge-scope review | SKILL.md (гейт 17) | ~0.5h |
| 4. Plugin: branch-base guard | merge-guard.js, core.js | ~1h |
| 5. Plugin: head-pin маркера | merge-guard.js | ~0.5h |
| 6. Тесты (plugin) | index.test.js | ~1h |
| 7. Docs sync | SKILL.md, manual_docs/, changelog, SECURITY.md | ~0.5h |
| 8. regression registry | regression/entries/ | ~0.25h |

**Итого:** ~4.25h

## 7. Risks

- **Breaking change:** backward compatibility для маркера v1 (head-pin optional) — минимальный blast radius;
- **Plugin deploy:** изменения merge-guard.js require plugin update + opencode restart (OP-1);
- **User friction:** hard stop на чужих коммитах может заблокировать легитимные workflows (stacked PRs); mitigation — HITL escape hatch (опция b: «я осознаю»);
- **Stacked-ветки:** правило «base = mainline» ломает stacked-branch workflow (фича A → фича B на базе A); mitigation — явный HITL-исключение с предупреждением.

## 8. References

- Incident 2026-10-21: config-fix pipeline на занятом workspace (эта сессия);
- `references/hitl-gate-protocol.md` — гейты;
- `references/memory-layer.md` — memory search requirement (шаг 0);
- `references/file-path-conventions.md` — пути артефактов;
- `references/regression-registry.md` — реестр рисков;
- `invariants.md` — ⚑1 (merge guard), ⚑2 (spec gate).

---

> **Spec review:** required (Architectural category). Spec review signature: pending.
