---
description: HITL-бэкап и восстановление данных memory layer (list → выбор → backup/restore)
---

# @maestro-memory-backup

Бэкап и восстановление данных **memory layer** с HITL-подтверждением.

**Язык:** все сообщения пользователю — только на русском.

## Шаг 1. Доступность

Если `memory_backup` tool недоступен (память не включена) — сообщить и завершить.

## Шаг 2. Листинг

Вызвать `memory_backup` с `action: "list"`. Показать список (файл, ts, size, статус jsonl/манифеста).

## Шаг 3. Действие (HITL)

Вопрос: (a) backup — (b) restore (выбрать файл из листинга; merge по умолчанию) — (c) restore --replace (аварийно) — (d) отмена.

- (a) → `memory_backup` `action: "backup"` → показать вывод (в т.ч. WARN про gitignore).
- (b) → `memory_backup` `action: "restore", file: <выбранный>` → показать счёт (перезаписано/добавлено).
- (c) → **явное предупреждение**: «будет удалена ВСЯ память проекта, затем восстановлена из <файл>» → отдельное HITL-подтверждение → `memory_backup` `action: "restore", file: <файл>, replace: true` (нативный `ask` сработает дополнительно).
- (d) → завершить.

## Аварийный CLI (без opencode)

Команда НЕ вызывает CLI через bash. При запросе пользователя на восстановление без
opencode — показать инструкцию:

```
node <путь к плагину maestro-bootstrap>/memory/backup-cli.js list
node <путь к плагину maestro-bootstrap>/memory/backup-cli.js restore --file <путь> [--replace]
```

(путь к плагину — из merge-конфига `plugins`; replace — только из интерактивного терминала.)
