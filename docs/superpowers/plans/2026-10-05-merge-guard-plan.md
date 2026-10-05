---
title: Implementation plan — merge-guard (5.6.0)
date: 2026-10-05
author: maestro-auto
---

# Implementation Plan: merge-guard (R3, roadmap #29)

## Файлы

- `plugins/maestro-bootstrap/merge-guard.js` — **новый** (чистые функции + конфиг)
- `plugins/maestro-bootstrap/merge-guard.test.js` — **новый** (в `npm test`)
- `plugins/maestro-bootstrap/core.js` — интеграция в `tool.execute.before`
- `package.json` — регистрация `merge-guard.test.js` в `scripts.test`
- `skills/maestro/SKILL.md` — гейт 17: шаг маркера (line-count → AGENTS.md)
- `SECURITY.md` — механический enforce ⚑1
- `manual_docs/reference/config.md`, `manual_docs/explanation/agents-and-trust.md`,
  `manual_docs/overview/changelog.md`
- версия 5.5.1 → 5.6.0: package.json, package-lock.json, docs/project-context.md,
  AGENTS.md, docs/roadmap.md (#29 закрыт), TODO.md
- `regression/entries/2026-10-05-merge-guard.md` — **новый**

## Задачи

### T1: merge-guard.js + тесты + интеграция в core.js

**Файлы:** `merge-guard.js`, `merge-guard.test.js`, `core.js`, `package.json`

1. `merge-guard.js` (ESM, без зависимостей, стиль core.js):
   - `detectGuardCommand(command)` → `{ kind: "merge" | "push-mainline" } | null`:
     - merge: `/git\s+merge\b/` (в т.ч. multi-command)
     - push-mainline: `git push` + аргумент-ветка `main`/`master`
       (`<remote> main`, `HEAD:main`, `+main`, `origin/main`; без аргументов —
       null: bare `git push` не детектируется, ограничение задокументировать)
   - `checkMergeMarker(root, sessionID, nowMs, conf)` → `{ allow, reason }`:
     - читает `<root>/.maestro/gates/merge-<sessionID>.json`;
     - reasons: `marker_ok` / `no_marker` / `marker_expired` /
       `marker_session_mismatch` (поле sessionID ≠ текущему) / `marker_bad_json`
     - TTL из `conf.ttlSec` (default 600); `nowMs` — параметр (детерминизм тестов)
     - любой throw внутри → `{ allow: false, reason: "guard_error" }` (fail-closed)
   - `resolveMergeGuardConf(maestroConf)` → `{ enabled: true, ttlSec: 600 }`
     (невалидное → default; enabled:false — explicit opt-out)
2. `core.js`: в `tool.execute.before` (рядом с confidential-блоком, ПЕРЕД
   sanitizer-веткой — guard выше санитайзера, т.к. блокирует до исполнения):
   ```
   if (input.tool === "bash" && mergeGuardConf.enabled) {
     const kind = detectGuardCommand(output?.args?.command || "");
     if (kind) {
       const res = checkMergeMarker(root, input.sessionID, Date.now(), mergeGuardConf);
       log.info/warn("merge_guard", { action, kind, reason: res.reason, sessionID });
       if (!res.allow) throw new Error("[merge-guard:deny] ..."); // текст по спеке
     }
   }
   ```
   Весь блок — в try/catch наружного (не роняет хук); конфиг резолвится в init.
3. `merge-guard.test.js` (node:test, паттерн index.test.js):
   - детекция: `git merge --ff-only X` → merge; `git checkout main && git merge
     --ff-only` → merge; `git push origin main` / `HEAD:main` / `+refs/heads/main`
     → push-mainline; `git push origin feature/x` → null; `git commit -m x` →
     null; bare `git push` → null; `echo git merge` (в кавычках/echo) → null
     (не детектить в аргументах echo — по крайней мере `echo "git merge"`).
   - маркер: tmpdir-файлы — ok / absent / expired (now > ts+ttl) / чужой
     sessionID / broken JSON / guard_error (unreadable dir) — fail-closed.
   - conf: default, enabled:false, невалидный ttlSec → default.
4. `package.json`: добавить `plugins/maestro-bootstrap/merge-guard.test.js` в
   `scripts.test` (урок 5.4.0: guard test-coverage ловит пропуск).

**Валидация:** `node --test plugins/maestro-bootstrap/merge-guard.test.js` +
`npm test` — 0 fail.
**Коммит:** `feat(merge-guard): bash guard на git merge/push-mainline (5.6.0)`

### T2: SKILL.md гейт 17 + SECURITY.md + docs + bump 5.6.0

**Файлы:** SKILL.md, SECURITY.md, manual_docs (config.md, agents-and-trust.md,
changelog), версия, roadmap, TODO.md, regression entry

1. `SKILL.md` гейт 17 (поиск «17.»): после описания явного (a) — обязательный
   шаг: «создай маркер `.maestro/gates/merge-<sessionID>.json`
   `{sessionID, ts: Date.now(), gate: 17, decision: "a"}` — без маркера
   merge-guard плагина заблокирует `git merge/push` (fail-closed)».
   При изменении line-count — обновить AGENTS.md.
2. `SECURITY.md`: новый подпункт в разделе инвариантов/⚑1 (или требований
   P-серии — по структуре файла): «Механический enforce ⚑1 (merge-guard,
   5.6.0)» — scope (merge + push mainline), fail-closed, TTL 600 с,
   carve-out (человек в терминале), opt-out `merge_guard.enabled: false`.
3. `manual_docs/reference/config.md` — секция `merge_guard` (enabled/ttlSec,
   defaults, поведение).
4. `manual_docs/explanation/agents-and-trust.md` — параграф: merge-guard как
   механический enforce ⚑1 (в связке с HITL-гейтами).
5. `changelog.md` — секция **5.6.0**.
6. Bump 5.5.1 → 5.6.0 (package.json, package-lock.json, project-context,
   AGENTS.md (версия + line-count + строка про плагин — добавить merge-guard в
   описание плагина), roadmap: #29 «решено (5.6.0, 2026-10-05)» + «Текущая
   версия»), TODO.md (отметить пункт merge-guard, если есть).
7. `regression/entries/2026-10-05-merge-guard.md`: сценарии —
   a) `npm test` 0 fail (merge-guard.test.js зарегистрирован)
   b) `grep -c "merge_guard" plugins/maestro-bootstrap/core.js` ≥ 1
   c) `grep -c "merge-<sessionID>\|merge-guard" skills/maestro/SKILL.md` ≥ 1
   d) ручной: в пайплайне гейт 17 (a) → маркер → merge проходит; без маркера —
      deny (проверять в целевом проекте с подключённым плагином)
   e) версии 5.6.0 синхронны.

**Коммит:** `chore: bump 5.6.0 + merge-guard docs (SECURITY.md, config, SKILL.md)`

## Порядок

1. T1 → task review (sonnet) + evidence-проверка
2. T2 → evidence-проверка (docs, npm test)
3. Final review (reviewer) — с акцентом на СЕКЮРИТИ (fail-closed, scope,
   bypass-возможности)
4. Гейт 17 (HITL STOP) → merge ff → ветка удаляется
   (ирония: сам merge этой ветки — под merge-guard; маркер создаётся оркестратором
   после явного (a) — догфудинг фичи на себе)

## Валидация

- `npm test` — 0 fail
- Догфудинг: merge ветки merge-guard выполняется ТОЛЬКО через маркер гейта 17
