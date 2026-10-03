# Regression: trusted_paths security guard (5.1)

> **Дата:** 2026-10-03
> **Фича:** 5.1 (L21) — trusted paths вне проекта

## Описание

Guard в `tool.execute.before` блокирует `read`/`write`/`edit` для:
- Персональных путей (`~/...`)
- Системных путей (`/etc`, `/private`)
- Пользовательских `custom` путей

**Только `custodian`** (trusted subagent) получает `allow`. Все остальные → `deny`.

## Trigger

Primary-сессия или untrusted subagent вызывает `read`/`write`/`edit` на путь `~/...`, `/etc/...`, `/private/...`.

## Expected

Ошибка: `[trusted-path:deny] Доступ к "..." запрещён...`

## Actual (пройдено)

- `read ~/secrets/keys.txt` от root → deny ✓
- `read ~/secrets/keys.txt` от custodian → allow ✓
- `read ~/secrets/keys.txt` от haiku → deny ✓
- `read src/app.ts` → allow (не blocked) ✓
- trusted_paths disabled → no blocking ✓
- `read /etc/passwd` от root → deny ✓
- `read /private/tmp` от root → deny ✓
- `read /tmp/test.txt` → allow (не в default-классах) ✓
- `.maestro/plugin-version` → exempt (не блокируется) ✓

## Regression test

`plugins/maestro-bootstrap/index.test.js` — `describe("maestro-bootstrap trusted_paths enforcement")` и `describe("maestro-bootstrap trusted_paths classification")`.
