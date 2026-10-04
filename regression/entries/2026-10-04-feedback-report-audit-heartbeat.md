---
title: "P1.7 — U5: Heartbeat аудит-лога (existence/emptiness check)"
date: 2026-10-04
type: feature
severity: medium
scope: skills/maestro-feedback-report
fixed: true
---

# P1.7 — U5: Heartbeat аудит-лога

## Проблема

«аудит-лог отсутствует» ≠ «чисто»; ретроспектива confidential не отличает сломано от безопасно

## Решение

- **3b.0 Heartbeat:** проверка existence audit-log файла
- Файл НЕ найден → warning "аудит-лог не создан (plugin не подключён?)"
- Файл найден, но пуст → "аудит-лог пуст (нет confidential-событий)"
- Файл найден с записями → читать как обычно
- Секция "Из аудит-лога" показывает статус heartbeat

## Регресс-чек

- Heartbeat-проверка срабатывает при отсутствии файла
- Пустой файл корректно помечается как "пуст"
- Статус heartbeat виден в секции "Из аудит-лога"
- 285/285 тестов проходят

## Изменённые файлы

- `skills/maestro-feedback-report/SKILL.md` — Шаг 3b.0 (heartbeat), 3b.1 (чтение)
- `manual_docs/reference/commands.md` — описание U5
