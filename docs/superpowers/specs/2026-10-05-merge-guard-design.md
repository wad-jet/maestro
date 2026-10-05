---
title: R3 merge-guard — механический гард гейта 17
date: 2026-10-05
author: maestro-auto
status: draft
---

# R3 merge-guard (roadmap #29, 5.6.0)

## Суть

Инвариант ⚑1 («merge/PR — только человеком, после явного гейта 17») сегодня
держится текстом SKILL.md. Инцидент среза #1 (auto-merge без гейта 17) закрыт
усилением текста (5.3.0), но механического enforce нет. Фича — **плагин-гард**
в `maestro-bootstrap`: bash-команды `git merge` / `git push` в mainline,
выполняемые агентом, блокируются, пока нет маркера явного HITL-аппрува гейта 17.

## Механизм (подтверждён по коду)

- Хук `tool.execute.before` (core.js:1256) блокирует вызов инструмента
  **бросанием Error** (паттерн `confidential:deny`, core.js:1286-1292).
- Гард вешается в тот же хук: `input.tool === "bash"` → анализ `output.args.command`.

## Детекция (scope)

- **`git merge`** — любая агентская `git merge` (субстринг-паттерн
  `/git\s+merge\b/`, включая multi-command `git checkout main && git merge ...`)
  требует маркер. Фолс-позитивы минимальны: агентский merge практически
  всегда = шаг merge пайплайна.
- **`git push`** — только push в mainline-refs: `git push <remote> main`,
  `HEAD:main`, `+main` (паттерн на аргумент-ветку `main`/`master`).
  Push feature-веток — не блокируется.
- Прочие git-команды (commit, checkout, branch, diff…) — не затрагиваются.

## Маркер аппрува

- После явного HITL (a) на гейте 17 оркестратор **пишет маркер** (обязательный
  шаг гейта 17 в SKILL.md):
  `.maestro/gates/merge-<sessionID>.json`:
  `{ "sessionID": "<id>", "ts": <epochMs>, "gate": 17, "decision": "a" }`.
- Гард: маркер существует И `now − ts ≤ ttlSec` (default 600 с) И
  `sessionID` совпадает с текущей → **allow** (без удаления: retry merge в
  пределах TTL допустим; новый гейт 17 → новый маркер).
- Нет маркера / просрочен / чужой sessionID → **deny** с ошибкой:
  `[merge-guard:deny] <команда> заблокирован: нет явного HITL-аппрува гейта 17
  (маркер .maestro/gates/merge-<sessionID>.json). Обсуди с пользователем
  гейт 17, затем создай маркер и повтори.`
- **Fail-closed:** непредвиденная ошибка при проверке маркера → deny
  (консервативно, как session-resolution в confidential-контроле).
- **Carve-out (by construction):** человек в своём терминале не затрагивается
  (плагин видит только tool-вызовы агентов).

## Конфиг (`maestro.json`)

```json
{ "merge_guard": { "enabled": true, "ttlSec": 600 } }
```

- `enabled` default `true`; `false` — гард off (explicit opt-out, логировать
  warn при init). `ttlSec` default 600.
- Невалидные значения → default + warn (soft fallback, паттерн плагина).

## Логи

- События в bootstrap-лог: `merge_guard` — `{ action: "allow"|"deny",
  kind: "merge"|"push-mainline", reason, sessionID }` (reason:
  `no_marker` / `marker_expired` / `marker_session_mismatch` /
  `guard_error` / `marker_ok`). SEC-4b: без текста команд (только kind).

## Изменения

1. `plugins/maestro-bootstrap/merge-guard.js` (новый) — чистые функции:
   `detectGuardCommand(command)` → `{kind}|null`;
   `checkMergeMarker(root, sessionID, now, conf)` → `{allow, reason}`;
   интеграция в `tool.execute.before` (core.js) + конфиг-секция + логи.
2. `plugins/maestro-bootstrap/merge-guard.test.js` (новый, в `npm test`):
   детекция (merge/push-main/feature/commit/мультикоманды), маркер
   (ok/нет/expired/чужой session/сломанный JSON), fail-closed, enabled:false.
3. `skills/maestro/SKILL.md` — гейт 17: обязательный шаг «после (a) — создать
   маркер merge» + пометка о механическом enforce (merge-guard).
4. `SECURITY.md` — механический enforce ⚑1 (merge-guard): принцип +
   требования (fail-closed, TTL, scope).
5. `manual_docs/`: `reference/config.md` (merge_guard), `explanation/
   agents-and-trust.md` (гард как enforcement ⚑1), changelog 5.6.0.
6. Bump **5.5.1 → 5.6.0**, regression entry, roadmap #29 закрыт, AGENTS.md
   (описание плагина), TODO.md.

## Ограничения (осознанные)

- Паттерн-детекция прямых команд; составные обходы (alias-скрипты,
  `git -c ...`, подпроцессы) вне scope — модель доверия: агент следует
  пайплайну, гард — backstop инварианта, не adversarial-песочница.
- Guard действует только при подключённом плагине (как и весь security-слой;
  гейт 0 требует плагин для пайплайна).

## Критерии приёмки

1. `npm test` (включая новый merge-guard.test.js) — 0 fail.
2. Ден-сценарий: `git merge` в bash-туле без маркера → deny (тест на уровне хука).
3. Allow-сценарий: свежий маркер текущего sessionID → allow, лог `merge_guard`.
4. TTL: просроченный маркер → deny.
5. Docs: config.md, SECURITY.md, changelog, AGENTS.md, roadmap #29 закрыт;
   версии 5.6.0 синхронны.
