---
title: "Merge-guard (5.6.0) - механический гард ⚑1: git merge/push-mainline без маркера гейта 17"
date: 2026-10-05
type: feature
severity: high
scope: plugins/maestro-bootstrap, skills/maestro, manual_docs
fixed: true
---

# Merge-guard (5.6.0)

## Суть

R3 (roadmap #29): механический enforce инварианта ⚑1 (PR/мерж — только
человек, после явного гейта 17). Плагин `maestro-bootstrap` блокирует
bash-команды агента `git merge` (любая) и `git push` в mainline
(`main`/`master`) до маркера явного HITL-аппрува гейта 17:
`.maestro/gates/merge-<sessionID>.json` (`{"sessionID", "ts", "gate": 17,
"decision": "a"}`, TTL 600 с, `merge_guard.ttlSec`). Fail-closed: нет маркера /
просрочен / чужой sessionID / аномалия проверки → deny (`[merge-guard:deny]`,
bash-вызов блокируется). Конфиг `merge_guard: {enabled, ttlSec}` (defaults
true/600; opt-out — explicit, warn `merge_guard.disabled` при init). Carve-out
(by construction): человек в своём терминале не затрагивается (плагин видит
только tool-вызовы агентов). Обоснование: инцидент auto-merge без гейта 17
(нарушение ⚑1, 2026-10-05) закрыт на уровне правил в 5.3.0; механический гард
— отдельно.

## Сценарии воспроизведения/проверки

- a) `npm test` → 0 fail (merge-guard.test.js зарегистрирован в `scripts.test`)
- b) `node --test plugins/maestro-bootstrap/merge-guard.test.js` → 29/29
- c) `grep -c "merge_guard" plugins/maestro-bootstrap/core.js` ≥ 2
- d) `grep -c "merge-<sessionID>\|merge-guard" skills/maestro/SKILL.md` ≥ 1
- e) ручной (целевой проект, плагин подключён): `git merge` без маркера →
  `[merge-guard:deny]`; после маркера (свежий) → allow + лог `merge_guard`
- f) версии 5.6.0 синхронны: `grep "5.6.0" package.json docs/project-context.md AGENTS.md docs/roadmap.md` → совпадения во всех 4 файлах

## Изменённые файлы

- `plugins/maestro-bootstrap/merge-guard.js` — чистые функции:
  `detectGuardCommand`, `checkMergeMarker` (fail-closed),
  `resolveMergeGuardConf` (`027c499`)
- `plugins/maestro-bootstrap/merge-guard.test.js` — 29 unit-тестов
  (детекция, маркер, conf, fail-closed) (`027c499`)
- `plugins/maestro-bootstrap/core.js` — гард в `tool.execute.before` (до
  confidential-ветки), логи `merge_guard` (`027c499`)
- `package.json` — `merge-guard.test.js` в `scripts.test` (`027c499`)
- `skills/maestro/SKILL.md` — гейт 17: обязательный шаг «после явного (a) —
  создать маркер аппрува до выполнения merge»
- `SECURITY.md` — P9: механический enforce ⚑1 (merge-guard)
- `manual_docs/reference/config.md` — секция `merge_guard`
- `manual_docs/explanation/agents-and-trust.md` — merge-guard как enforcement
  ⚑1 (гейт 17)
- `manual_docs/overview/changelog.md` — секция 5.6.0
- `regression/entries/2026-10-05-merge-guard.md` — этот entry
- версия 5.6.0: `package.json`, `package-lock.json`, `docs/project-context.md`,
  `AGENTS.md` (версия + ~1210 строк + описание плагина), `docs/roadmap.md`
  (Текущая версия + закрытый пункт #29), `TODO.md`

## Версия

5.6.0 (коммиты `804aa5d`, `027c499` + этот docs/bump-коммит)
