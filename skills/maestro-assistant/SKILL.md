---
name: maestro-assistant
description: Use when the user asks for help configuring maestro, organizing project structure/context, or wants to consult the rules of maestro (trust, access_policy, confidential, sanitizer_whitelist, opencode.json models, project-context, pipeline structure). Also loaded by maestro-init (tasks 2/3/3a) and maestro (pipeline config questions). Not for feature implementation.
---

# Maestro Assistant — конфигурация, структура и консультации по maestro

## Overview

`maestro-assistant` — общий источник правил конфигурации/процессов maestro и лёгкая точка
входа для настройки и консультаций в течение жизни проекта. Скилл **самодостаточен**:
канон правил живёт здесь, не ссылается на `manual_docs/` для исполнения (загружается в
изоляции: консультации, init, maestro).

**Язык:** все HITL-вопросы, варианты и сообщения пользователю — только на русском.

## Когда использовать

- Пользователь вызывает `/maestro-assistant <запрос>` для настройки конфигурации maestro,
  организации структуры/контекста, консультации по правилам.
- `/maestro-init` (задачи 2/3/3а) загружает этот скилл и следует его правилам.
- `@maestro` по ходу pipeline загружает этот скилл при вопросах конфигурации/процессов.

## Полномочия и границы

- **Может напрямую редактировать** `maestro.json`, `opencode.json`, `project-context.md`,
  структуру каталогов по запросу HITL. Идемпотентно, с HITL-гейтом на approve/правки/отмена
  и показом diff-merge перед записью.
- **НЕ реализует фичи** — не запускает pipeline, не пишет spec/plan/код.
- **Trust/security — только через HITL**, сам вопросы безопасности не решает.
- **Доступ к `docs/confidential/**` — закрыт** (primary-сессия, всегда deny). Не читать/не
  править содержимое confidential; запросы на работу с confidential — только через допустимый
  канал (trusted-агент), не в обход.
- **Плагин-гейт НЕ требуется** для консультаций (правит конфиг, не гоняет confidential
  через pipeline).
- **Редирект (MIN-4):** если запрос требует изменения кода/spec/плана или запуска pipeline →
  `@maestro` (фича/багфикс/SDD), `/maestro-design` (дизайн/scaffold/roadmap), `@regression`
  (регрессия). Только конфиг/структура/контекст/консультация обрабатываются здесь.

## Канон `maestro.json` (источник истины)

Полный JSON-канон (эталон формата, который правит/генерирует assistant) — **inline здесь**.
Держать синхронно с правилами парсинга плагина (`loadMaestroConfig`/`loadWhitelist`/
`loadAccessPolicy`/`loadConfidentialConfig`). Контроль дрейфа — конвенцией.

```json
{
  "trust": { "design": true, "sanitizer": true },
  "access_policy": {
    "version": 1,
    "default": "ask",
    "allow": ["src/**", "test/**", "packages/**", "*.{ts,js,py,go,rs}"],
    "ask": ["docs/**", "specs/**", "manual_docs/**", "*.{md,mdx}", "*.config.*"],
    "deny": ["*.env", "*.env.*", "*.{pem,key,cert,secret}"]
  },
  "confidential": {
    "version": 1,
    "paths": ["docs/confidential/**"],
    "trusted": { "read": "allow", "write": "deny", "edit": "deny" }
  },
  "sanitizer_whitelist": {
    "rules": { "env_secret": true, "data_field": true, "env_file": true, "db_credential": true, "ledger_entry": true, "private_key": true, "auth_header": true },
    "by_agent": { "code-reviewer": [] },
    "patterns": [],
    "extra_fields": [],
    "extra_uri_schemes": []
  }
}
```

### Секции (семантика)

- **`trust`** — только trusted сабагенты (`true`). `design` и `sanitizer` — trusted по роли.
  Остальные — untrusted (default). Файл коммитится в git.
- **`access_policy`** — file access control для untrusted через `read` (`allow`/`ask`/`deny`;
  приоритет deny > ask > allow; default `ask`). Покрывает только `read`; bash/glob/grep — нативные permissions.
- **`confidential`** — защита конфиденциальных путей (жёстче access_policy). Дефолт
  `paths: ["docs/confidential/**"]`; trusted читает по умолчанию, запись/редактирование deny
  (выдаются явно). Primary/untrusted — всегда deny.
- **`confidential.paths`** — принимает папки, отдельные файлы по полному имени
  и по маске, включая корневую папку. Сегментная семантика: `**` = 0+ сегментов
  (покрывает корень), `*`/`?` — в пределах сегмента (не через `/`), маска без `/`
  (напр. `*.env`) закрывает только корневые файлы. Контроль — `read`/`write`/`edit`;
  `bash`/`glob`/`grep` не перехватываются (fail-open).
- **`sanitizer_whitelist`** — правила маскирования чувствительных данных перед untrusted-диспатчем.

### Правила вывода (из контекста §3/§5/§12)

- **`trust`:** всегда `design: true`, `sanitizer: true`. Другие — не добавлять, если HITL не просит.
- **`access_policy.allow`:** из §3 (стек) + §5 (домены): каталоги исходников + расширения языков.
- **`access_policy.deny`:** секреты (`*.env`, `*.env.*`, `*.{pem,key,cert,secret}`).
- **`sanitizer_whitelist`:** по §12; `extra_uri_schemes` из §3.

## Операционные гарантии (OP)

- **OP-1 — перезапуск после правки `maestro.json`:** после записи любых изменений
  `maestro.json` сообщить HITL: «изменения вступят в силу после перезапуска opencode»
  (плагин читает конфиг один раз при старте). Предложить рестарт/отложить. Критично для
  `trust`/`access_policy`/`confidential`/`sanitizer_whitelist`.
- **OP-4 — адресный diff + HITL для ослабления security-слоёв:** при правке
  `access_policy.deny→allow` (ослабление) и `sanitizer_whitelist.rules→false` (отключение
  защиты) — показать адресный diff (стало vs было) и получить явное HITL-подтверждение,
  как для `confidential.paths`.
- **OP-7 — граница «схема vs наполнение» project-context:** схема 14 категорий — канон в
  `init-context.md` (не менять); assistant правит только **наполнение** (актуализацию §3/§5/§12/§14).
- **OP-3 — канон inline:** канон `maestro.json` хранится inline в этом SKILL.md; держать
  синхронно с правилами парсинга плагина (конвенцией, без авто-теста).

## Правка `confidential.paths` (жёсткий контроль, IMP-3)

- **Снятие с защиты (удаление пути) — ЖЁСТКИЙ БЛОК по умолчанию.** Не инициировать/не
  выполнять удаление/ослабление сам. Снятие — только по явному запросу HITL и при этом:
  (а) адресный diff «папка X будет исключена из `confidential.paths`, данные станут доступны
  untrusted/primary (с учётом fail-open плагина)»; (б) явный отдельный approve HITL.
- **Merge — только консервативное дополнение.** При повторном прогоне только добавлять пути,
  не удалять/изменять существующие без явного HITL-гейта с дифф-показом.
- **Адресный показ:** при любом изменении `confidential.paths` — отдельный diff (стало vs было).

## Консультационные воркфлоу

### 1. Объяснение правил (read-only)

Пользователь спрашивает «как работает X» (trust, access_policy, confidential, sanitizer,
14 категорий, структура). Ответить на основе канона выше + краткая сводка. Не менять файлы.

### 2. Настройка конфигурации (правка)

1. Прочитать текущий артефакт (`maestro.json` / `opencode.json` / `project-context.md`).
2. Сформировать diff-merge (идемпотентно, сохраняя пользовательские правки).
3. **HITL-гейт:** «(a) approve — (b) правки — (c) отмена» + показ diff-merge.
4. Для `confidential.paths` / `access_policy.deny→allow` / `sanitizer_whitelist.rules→false` —
   адресный diff + явное HITL-подтверждение (IMP-3, OP-4).
5. Записать. **OP-1:** сообщить о необходимости перезапуска opencode.

### 3. Актуализация project-context (наполнение)

Править **наполнение** секций (не схему). Секция 14 Commands — как в каноне `init-context.md`
(явная команда / `auto` / `none`). После правки — HITL-гейт approve/правки/отмена.

### 4. Организация структуры каталогов

Проверить/создать (идемпотентно): `.maestro/`, `docs/superpowers/{specs,plans}/`,
`docs/confidential/`, `regression/{entries,released}/`. `.gitignore` — `.maestro/`
целиком (только эфемерное); конфиг проекта — только `maestro.json` в корне,
не в `.maestro/`.

## Обработка сбоев

| Ситуация | Действие |
|---|---|
| Запрос требует реализации кода/spec/плана | Редирект: `@maestro` / `/maestro-design` / `@regression` (MIN-4) |
| Запрос на работу с содержимым `docs/confidential/**` | Отказ: доступ закрыт для primary; через trusted-агент |
| Плагин не загружен | Работаем (гейт не требуется); при правке security-секций — напоминание о fail-open (см. OP-1/IMP-3) |
| `maestro.json` правился | Сообщить о перезапуске (OP-1) |