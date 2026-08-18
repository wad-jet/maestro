# Журнал изменений

[Назад к оглавлению](../index.md)

Формат основан на [Keep a Changelog](https://keepachangelog.com/ru/1.0.0/).

> Хронология составлена по истории authoring-репо `maestro-agent`. Даты
> приблизительные (по коммитам).

## [2026-08-18]

### Изменено
- Скилл `maestro`: применены уроки ретроспективы feature-pipeline:
  - чек-лист отчёта имплементера (`TEST_OUTPUT` в `implementer-prompt.md`);
  - правило «build перед тестами» при тестах против артефактов сборки;
  - фиксация отклонений от плана в момент выявления (шаг 13d);
  - запрет `git stash` в manual-проверках оркестратора;
  - учёт всех моделей контура при подсчёте LLM-вызовов в псевдокоде тестов;
  - проверка `git status`/`git diff` при пустом отчёте субагента до редиспатча.
- Добавлена пользовательская документация `manual_docs/` по использованию скилла.

## [Unreleased]

### Изменено
- **Уход от агента `maestro`**: primary-агент удалён. Вход — команда `@maestro`
  в любой primary-сессии. `@regression`/`@maestro-init` больше не привязаны к
  агенту. Плагин `maestro-bootstrap` — глобальная observability (инжекция
  директивы и агент-фильтр удалены). `@test-maestro` удалён.

### Добавлено
- **Security Review** (Этап 1): сабагент `sanitizer` (trusted, read-only) —
  поиск и пометка чувствительных данных в spec/промпте перед диспатчем в
  untrusted сабагенты.
  - Spec security review (шаг 8.6) для фич со spec; перезапуск на каждый Revise-цикл.
  - Проверка диспатча untrusted (шаги 9/13/16) — всегда.
  - HITL-гейт при находке (Трактовка Y): (a) вычистить и продолжить /
    (b) продолжить как есть (принять риск) / (c) стоп.
  - Trusted skip: trusted сабагенты пропускают sanitize и file access control.
  - File access control для untrusted (на Этапе 1 — инструктивно в промпте;
    enforcement — плагин на Этапе 2).
- **Security Review (Этап 2):** реализация в плагине `maestro-bootstrap`:
  - **Уровень 1** — санитайзинг промптов `task` (маскирование env-secrets,
    полей данных, `.env`, DB/SFTP credentials, ledger) по правилам Context
    Sanitizer + whitelist (`sanitizer-whitelist.json`).
  - **File access control** — перехват `read` по `.maestro/access-policy.json`
    (`allow`/`ask`/`deny`; приоритет deny > ask > allow). Файл формирует
    сабагент `sanitizer` или вручную.
  - **Trusted skip** — плагин читает `trust-config.json`, trusted сабагенты
    пропускают sanitize промпта.
- **Ревью Этапа 2 (2026-08-18):** исправлены замечания ревью — access-policy
  покрывает только `read` (bash/glob/grep — нативные permissions), приоритет
  `resolveFileAccess` исправлен (deny > ask > allow), удалён мёртвый код,
  аудит-лог — в общем bootstrap-логе.
- **Расширение покрытия sanitize (2026-08-19):** регулярные выражения
  Уровня 1 закрывают заметно больше кейсов:
  - `data_field` — расширенный список полей (финансовые + PII + бизнес),
    суффиксы (`amountValue`, `amount_value`), camelCase-варианты snake-полей
    (`cardNumber`), расширяемость через `extra_fields` в whitelist;
  - `db_credential` — больше URI-схем (`ssh`, `ldap`, `clickhouse`, ...) +
    connection-string params (`password=...`, `pwd=...`), расширяемость через
    `extra_uri_schemes`;
  - `env_secret` — case-insensitive (`apiKey`, `api_key`) + keywords
    (`DSN`, `CERT`, `SALT`, `SIGNATURE`, `NONCE`);
  - новые правила `private_key` (PEM-блоки) и `auth_header`
    (`Authorization: Bearer ...`, `X-API-Key: ...`);
  - `ledger_entry` — маркер (покрывается `data_field`, дублирование убрано);
  - детект регистронезависим по всем правилам (`Amount`, `POSTGRES://`,
    `-----BEGIN rsa private key-----`);
  - документированы ограничения regex-детекта (multi-line, camelCase-префиксы;
    остальное ловит Ур.2-сабагент).
- **Команда `@test-sanitizer`:** проверка доступности сабагента `sanitizer` +
  `agent.sanitizer` из `opencode.json` и trusted-статуса в `trust-config.json`
  (по аналогии с `@test-code-reviewer`, плюс trusted-проверка).
- **AGENTS.md:** правило синхронизации `manual_docs/` при изменениях скилла.

## [2026-08-03]

### Изменено
- Переименование агента `feature-agent` → `maestro` (обновляются ключи
  `opencode.json`, пути плагина, зеркала `.opencode/`, записи `.gitignore`).

## [2026-08-17]

### Добавлено
- Anti-loop guard для диспатча субагентов (пустые/ошибочные результаты).

## [Ранее]

### Добавлено
- Команда `/maestro-init` и скилл `init` (bootstrap новых проектов).
- Соглашение об именовании веток (`feature/`, `fix/`, `hotfix/`).
- Плагин `maestro-bootstrap` (ESM, встраивание bootstrap-директивы).
- Настройки уровня лога плагина (`MAESTRO_BOOTSTRAP_LOG_LEVEL`,
  `MAESTRO_BOOTSTRAP_LOG_MASK`).

---

## 🔗 Связанные разделы

- [Что такое maestro](what-is-maestro.md)
- [Поддержание документации в актуальном состоянии](../how-to/keep-docs-up-to-date.md)