---
description: HITL-бэкфилл памяти — список на индексацию (dry-run превью) → выбор → reindex/синтез
---

# @maestro-memory-reindex

Запусти HITL-бэкфилл памяти: покажи кандидатов на индексацию (sessions + git-история),
выполни реиндексацию/синтез с выбором и подтверждением.

**Язык:** все сообщения пользователю — только на русском.

## Шаг 1. Доступность

1. Вызови инструмент `memory_reindex` с `action: "list"`.
2. Если инструмент недоступен / память выключена → покажи причину
   (см. `@maestro-memory`).

## Шаг 2. Листинг кандидатов

Покажи обе секции из вывода `memory_reindex` `action: "list"`:

- **Секция A (sessions):** кандидаты с пустыми `artifacts` + dry-run превью
  путей (0 LLM) — `session_id`, `head`, `branch`, `author`, `time_last`,
  `model_id`, флаги `model_mismatch` / `messages_unavailable`.
- **Секция B (git):** фичи из git-истории с отсутствующей записью +
  превью spec-файлов — `spec`, `branch`, `head`, `merged`.

Обнови свежесть: предложи выполнить `git fetch --prune`, затем повторный
`list` — листинг честен по состоянию refs на текущем хосте.

## Шаг 3. HITL-выбор источника и объёма

Спроси, что индексировать:

- **Источник:** `sessions` / `git` / оба (поочерёдно).
- **Объем:** всё (`all_empty` для sessions / `all` для git) / подмножество
  (`session_ids` или `specs`) / отмена.

**Рекомендованный порядок:** сначала sessions (light, 0 LLM вызовов),
затем git (стоимость LLM-summary). Если запустить git ДО sessions,
возможны дубли: для фич с записью и пустыми `artifacts` пара
(реальная + синтетическая) — удаление через `memory_prune`.

После light-бэкфилла sessions coverage по `artifacts` работает полностью
(spec §7).

## Шаг 4. Реиндексация / синтез

Вызови `memory_reindex` с `action: "run"` по выбору:

- `source: "sessions"` — укажи `session_ids` (через запятую) или `all_empty: true`;
- `source: "git"` — укажи `specs` (repo-relative, через запятую) или `all: true`;
- `max: 20` — cap на источник за вызов (по умолчанию 20, min 1).

Если кандидатов больше cap — разбей на серии и жди HITL-подтверждения
между сериями.

## Восстановить память за сессию, которая не сохранилась

Если сессия получила уведомление «данные НЕ сохранены в памяти» (или
`@maestro-memory` показал «Не индексированные сессии > 0»):

1. `memory_reindex` `action: "list"` — ориентир (не обязателен для явных ID).
2. `memory_reindex` `action: "run", source: "sessions", session_ids: "<id из уведомления/статуса>"`.
3. Явный ID с отсутствующей или stale-записью → **полный re-index** (LLM-summarize
   из сессии; затраты — как у штатного индексирования, один summarize на сессию) +
   сброс permanent-skip. Актуальная запись → artifacts top-up (0 LLM).
4. Статусы: `indexed` (восстановлено), `unattributed` (нет git-head),
   `no_new_messages` (мало нового), `not_found`, `skip_service`,
   `failed: <класс>` (хранилище всё ещё недоступно — повторить позже).

## Шаг 5. Отчёт

Покажи агрегатный отчёт по run:

- sessions: `updated`, `no_change`, `already_indexed`, `skipped`;
- git: `indexed`, `already_indexed`, `no_change`, `skipped`.

Без раскрытия содержимого записей (SEC-4b: aggregates-only).

Предложи повторить `list` для проверки обновления снапшота.
