# Агенты и модель доверия

[Назад к оглавлению](../index.md)

## 🎯 Назначение

Как устроены роли агентов и модель доверия в скилле `maestro`: почему субагенты
по умолчанию untrusted, как работает security review (sanitizer) и file access
control.

## 📖 Роли агентов

| Агент | Роль | Изменяет файлы? |
|---|---|---|
| `maestro` | Оркестратор (primary) — загружает скилл, ведёт pipeline | да |
| `haiku` | Механические задачи | да |
| `sonnet` | Интеграционные задачи | да |
| `opus` | Архитектурные решения, Spec Review | нет (read-only) |
| `fable` | Примеры, метафоры | нет (read-only) |
| `code-reviewer` | Финальное ревью ветки | нет (только git diff/log) |
| `sanitizer` | Security review — поиск и пометка чувствительных данных | нет (read-only) |

## 📖 Модель доверия

Оркестратор работает в сессии дефолтной модели — считается **доверенным**.
Любой субагент — отдельный инференс/сессия; данные покидают контекст
оркестратора. Поэтому **по умолчанию все субагенты untrusted** (кроме `sanitizer`).

Trust-статус управляет **двумя** измерениями защиты:

| Уровень | Sanitize промпта | File access control |
|---|---|---|
| **trusted** (`trust-config.json` = `true`) | **skip** | **skip** (без ограничений) |
| **untrusted** (default) | Security Review (Ур.1 + Ур.2) | HITL на каждый доступ к файлу |

### trust-config.json

Файл в корне проекта (рядом с `opencode.json`). Перечисляет **только trusted**
сабагентов. Всё, чего нет в файле — untrusted. Если файла нет — все untrusted.

```json
{
  "sanitizer": true
}
```

- Ключ — имя сабагента; значение только `true` = trusted.
- Файл коммитится в git — trust-level policy проекта.
- Оркестратор читает его один раз на шаге 0 и кэширует.
- `sanitizer` — trusted по роли (видит сырые данные, чтобы пометить).

## 📖 Security Review (двухуровневая защита)

Защита чувствительных данных перед диспатчем в untrusted сабагенты + file
access control. Два уровня + HITL-гейт:

```
untrusted диспатч →
  [Ур.1] maestro-sanitizer (плагин, Этап 2) — авто-маскирование, без HITL
  [Ур.2] сабагент sanitizer (trusted, read-only) — пометки, не вычищает
  пометки есть → HITL: (a) вычистить и продолжить / (b) продолжить как есть / (c) стоп
  → во время работы: file access control (HITL на доступ к файлу)
```

**Роль сабагента `sanitizer`:** trusted, read-only. Находит и **помечает**
чувствительные данные (где, что, почему) — не вычищает. Оркестратор вычищает
по пометкам. Выход — structured-блок `SANITIZER FINDINGS` + `STATUS: CLEAN |
FINDINGS_FOUND`.

**Trusted skip:** если сабагент в `trust-config.json` = `true` — sanitize промпта
и file access control **не применяются** (данные передаются как есть, доступ к
файлам свободен).

**File access control:** untrusted сабагент при попытке Read/Glob/Grep/Bash-read
любого файла → HITL: `(a) разрешить` / `(b) запретить`. На Этапе 1 — инструктивно
в промпте; enforcement — плагин на Этапе 2.

**Точки встраивания:**
- **Spec security review** (шаг 8.6) — для фич со spec (сложные/архитектурные),
  до Spec Review и планирования. Перезапуск на каждый Revise-цикл.
- **Перед диспатчем untrusted** (шаги 9/13/16) — всегда.

**Правила детекта (Context Sanitizer):**
1. **Secrets из окружения** — `SECRET`, `KEY`, `TOKEN`, `PASSWORD`,
   `CREDENTIAL`, `PASS`, `AUTH` → `<redacted:env.NAME>`.
2. **Чувствительные поля данных** — `amount`, `currency`, `article_code`,
   `counterparty_id` → `<redacted>`.
3. **Файлы .env / .env.\*** → `<redacted:.env file>`.
4. **SFTP/DB credentials** — `sftp://`, `postgresql://`, `mongodb://` с
   credentials → `<redacted:connection>`.
5. **Raw ledger entries** → маскинг полей.

Что **не** фильтруется: агрегированные данные, схемы БД без данных, код и
конфиги (кроме `.env`), имена таблиц/колонок.

**Аудит-лог:** `.maestro/sanitizer-log.md` (что отфильтровано, без содержимого;
что файл-доступ запрошен/разрешён/запрещён).

## 🔗 Связанные разделы

- [Выбор моделей](../reference/model-selection.md)
- [Справочник HITL-гейтов](../reference/hitl-gates.md)
- [Устройство pipeline](pipeline-overview.md)
- [Кастомизация скилла](../how-to/customize-maestro.md)