# План: защита чувствительных данных субагентов (sanitizer)

> Статус: **зафиксирован, реализация НЕ начата**.
> Дата: 2026-08-18. Репо: `maestro-agent` (authoring).
> Ревью от 2026-08-18: решения C1–C3, I1–I7, M1–M3 + дополнения (file access
> control, trusted skip) учтены.

## Постановка

До планирования спецификация должна пройти проверку безопасности. Задачи,
решаемые сабагентами, не должны получить чувствительные данные. Плюс —
проверка диспатча в untrusted субагенты выполняется всегда. **Дополнительно:**
доступ untrusted сабагентов к файлам (любым) — только с подтверждения HITL;
trusted сабагенты пропускают санитайзинг при диспатче.

**Текущий разрыв:** Context Sanitizer описан в `skills/maestro/SKILL.md` как
спецификация, но **не реализован** (ни в плагине, ни скриптом, ни тестом —
проверено grep'ом). Санитайзер полностью ручной — оркестратор-модель по
инструкции редактирует промпт перед диспатчем. Надёжность не гарантирована.
File access control для untrusted сабагентов не описан вовсе.

## Архитектура (двухуровневый sanitize + file access control)

```
Диспатч в сабагента:
  trust check (trust-config.json)
    │
    ├── trusted → SKIP sanitizing + SKIP file access control → диспатч как есть
    │
    └── untrusted →
         [УРОВЕНЬ 1] maestro-sanitizer (плагин) ── авто, БЕЗ HITL-гейта
            │  regex-детект + маскирование по правилам Context Sanitizer
            │  нет находок → промпт уходит
            ▼
         [УРОВЕНЬ 2] сабагент sanitizer (trusted, read-only) ── всегда, доп. слой
            │  находит и ПОМЕЧАЕТ чувствительные данные (не вычищает)
            │  пометки есть → HITL до clean:
            ▼
         [HITL] (a) вычистить и продолжить / (b) продолжить как есть (принять риск) / (c) стоп
            │
         [FILE ACCESS CONTROL] — во время работы сабагента:
            untrusted пытается Read/Glob/Grep/Bash-read → HITL: (a) разрешить / (b) запретить
```

**Принципы:**
- **Trust check управляет обоими измерениями:** trusted → skip sanitize + skip
  file access control; untrusted → sanitize + file access HITL.
- Уровень 1 (плагин) — максимально ранний перехват, до любой модели.
- Уровень 2 (сабагент sanitizer) — всегда доп. слой: на этапе 1 — единственный,
  на этапе 2 — поверх плагина; fallback при отключённом плагине.
- Минимум чувствительных данных доходит даже до trusted-модели sanitizer.

## Подтверждённые решения

1. **Этап 2:** плагин (уровень 1) всегда первым → сабагент (уровень 2) всегда
   доп. слой поверх.
2. **Trust:** сабагент `sanitizer` — trusted, read-only, единственный кому
   разрешено видеть сырые данные (чтобы пометить).
3. **HITL-гейт при находке (Трактовка Y):** HITL **до** clean —
   `(a) вычистить и продолжить` / `(b) продолжить как есть (принять риск)` /
   `(c) стоп`. Пользователь явно выбирает; утечка возможна только по его выбору.
4. **Spec security review:** где есть spec (сложные/архитектурные фичи).
   **Проверка диспатча** в сабагентов — всегда, при каждой отправке в untrusted.
5. **Trusted skip:** если сабагент в `trust-config.json` = `true` → санитайзинг
   промпта **не проводится** при диспатче.
6. **File access control:** untrusted сабагенты — доступ к файлам (любым) только
   с подтверждения HITL. Trusted сабагенты — без ограничений.
7. **Чек-лист «Data Sensitivity» в spec-review-prompt.md (Опция P):** не
   добавляем; sanitizer — единственный security-гейт для spec. `spec-review-prompt.md`
   не трогаем.
8. **Когда запускать Ур.2 (sanitizer-сабагент):** **(a) всегда** по умолчанию.
   Опция (env/конфиг) переключает на гибрид: spec review всегда + диспатч только
   если Ур.1 нашёл или недоступен.
9. **False positives Ур.1 (плагин):** **(a) Whitelist** —
   `.maestro/sanitizer-whitelist.json` (пути/паттерны, где маскирование пропускается).
10. **Формат выхода sanitizer (I6):** Structured-блок
    `SANITIZER FINDINGS` (location/type/reason/snippet_hint) +
    `STATUS: CLEAN | FINDINGS_FOUND`.
11. **Перезапуск sanitizer после revision spec (I7):** **(c) на каждый
    Revise-цикл** (возврат с шага 10 → шаг 8 → повторный прогон sanitizer).

## Точки встраивания в pipeline

- **Точка 1 — Spec security review:** после шага 8 (spec), до планирования и
  Spec Review (шаг 9). Сабагент sanitizer проверяет spec на чувствительные
  данные. Только для фич, где есть spec. Перезапуск на каждый Revise-цикл
  (шаг 10 → Revise → шаг 8 → повтор).
- **Точка 2 — Перед диспатчем untrusted:** перед каждой отправкой промпта в
  untrusted субагентов (шаги 9/13/16). Выполняется всегда. Trusted сабагенты
  пропускают (skip sanitize).
- **Точка 3 — File access control (новое):** во время работы untrusted сабагента
  — перехват Read/Glob/Grep/Bash-read, HITL на каждый доступ к файлу. Trusted
  сабагенты — без ограничений.

## Роль сабагента sanitizer

- Trusted (видит сырые данные), read-only (`edit: deny`, `bash: deny`),
  `task: deny`.
- **Помечает** чувствительные данные (где, что, почему) — не вычищает.
- **Оркестратор вычищает** промпт по пометкам (если пользователь выбрал (a)).
- При находке → HITL-гейт (Трактовка Y): (a) вычистить и продолжить /
  (b) продолжить как есть (принять риск) / (c) стоп.

### Формат выхода (structured-блок)

```
SANITIZER FINDINGS:
- location: <путь/строка/поле>
  type: <env_secret | data_field | env_file | db_credential | ledger_entry>
  reason: <почему чувствительное>
  snippet_hint: <краткая подсказка без содержимого, напр. "POSTGRES_PASSWORD в .env">
STATUS: CLEAN | FINDINGS_FOUND
```

- `STATUS: CLEAN` — промпт уходит как есть.
- `STATUS: FINDINGS_FOUND` → оркестратор показывает находки → HITL (a/b/c).
- `snippet_hint` без самого sensitive-содержимого — чтобы не утекло в лог/отчёт.

## Trust model (расширенная)

| Сабагент | Sanitize промпта | File access control |
|---|---|---|
| trusted (`trust-config.json` = `true`) | **skip** | **skip** (без ограничений) |
| untrusted (default) | Ур.1 + Ур.2 | HITL на каждый доступ к файлу |

- `sanitizer` сабагент — trusted (видит сырые данные для пометок), но его
  собственный промпт при диспатче не санизируется (он сам доверенный).
- Изменение trust-статуса сабагента в `trust-config.json` вступает в силу со
  следующей сессии (как сейчас).

## Этап 1 — только сабагент (первый PR)

| # | Компонент | Действие |
|---|---|---|
| 1 | `agents/sanitizer.md` | Новый сабагент: trusted, read-only (`edit: deny`, `bash: deny`), `task: deny`. Промпт — найти и пометить чувствительные данные по правилам Context Sanitizer (не вычищать; выход — structured-блок `SANITIZER FINDINGS`). |
| 2 | `trust-config.json` (guidance для target repo) | Добавить `"sanitizer": true`. Файл живёт в **целевом репо**, не в authoring — зафиксировать как инструкцию, не создавать здесь. |
| 3 | `skills/maestro/SKILL.md` | Раздел «Security Review»: две точки встраивания (spec review + диспатч), роль sanitizer (помечает) → HITL (Трактовка Y) → оркестратор вычищает. Trusted skip. File access control для untrusted (на Этапе 1 — инструкция в промпте, enforcement на Этапе 2). Fallback-логика. |
| 4 | `skills/maestro/implementer-prompt.md` | Запрет запрашивать/использовать чувствительные данные вне task-scope. Запрет читать файлы вне task-scope без подтверждения (на Этапе 1 — инструктивно). |
| 5 | `manual_docs/` | Обновить `explanation/agents-and-trust.md` (trust model расширенная, file access control), `reference/model-selection.md` (sanitizer в таблице), `reference/hitl-gates.md` (новые гейты), `how-to/keep-docs-up-to-date.md`. |
| 6 | `AGENTS.md` | Синхронизация `agents/sanitizer.md` → `.opencode/agents/`. |
| 7 | Smoke-тест-кейс (M2) | Зафиксировать в `agents/sanitizer.md` пример: промпт с `POSTGRES_PASSWORD` → ожидаемый `SANITIZER FINDINGS` с `type: env_secret`. |

## Уход от агента `maestro` (предпосылка Этапа 2)

> **Решение (2026-08-18):** планы — полностью уйти от агента `maestro`, оставить
> только скилл. Это меняет роль плагина и является предпосылкой для sanitizer.

### Влияние

- **Bootstrap-инжекция** директивы скилла: **убрать** (скилл вызывается явно
  через `@maestro`, агент-фильтр исчезает).
- **Observability**: **сократить** до нужного — `task`-диспатчи (аудит-лог
  sanitizer) + ошибки. Убрать детальное bash/skill-логирование.
- **Sanitizer (Ур.1)**: **добавить**, глобально на все `task`-диспатчи (без
  агент-фильтра).
- **File access control**: нативные permissions (не плагин).
- Плагин из «bootstrap + observability для агента» превращается в
  «глобальный sanitizer + минимальный аудит-лог + обработка ошибок».

### Прочие компоненты «ухода от агента»

- **Команда `@maestro` (новая, вход):** создать `commands/maestro.md`, которая в
  любой сессии инструктирует «загрузи skill maestro и следуй pipeline».
  Заменяет агента как точку входа. Поле `agent:` — без привязки к агенту.
- `agents/maestro.md` — удалить (primary-агента нет).
- `commands/regression.md`, `commands/maestro-init.md` — перепривязать: убрать
  `agent: maestro` (работают в любой сессии).
- `commands/test-maestro.md` — удалить (агента больше нет).
- `SKILL.md` — модель оркестратора: не агент, а скилл в primary-сессии.
- `manual_docs/`, `AGENTS.md`, README, `plugins/maestro-bootstrap/README.md` —
  синхронизация.

### Порядок

1. Сначала «уход от агента» (пересмотр плагина + удаление агента + команда входа).
2. Затем Этап 2 sanitizer поверх новой архитектуры плагина.

## Этап 2 — пересмотр плагина + реализация (второй PR)

| # | Компонент | Действие | Тип |
|---|---|---|---|
| 8 | Пересмотр `maestro-bootstrap` | Согласовать назначение/функции плагина. **Решение:** sanitizer реализуется **внутри** `maestro-bootstrap` (не отдельным плагином). File access control — нативные permissions (Путь A). | — |
| 9 | `plugins/maestro-bootstrap/` — sanitize | В `index.js`: функция `sanitize(prompt, rules, whitelist)` по правилам Context Sanitizer. Хук `tool.execute.before` на `task`: `output.args.prompt = sanitize(...)` (Уровень 1, авто без HITL). | Код |
| 10 | File access control | **Нативные permissions** (Путь A): в `agents/*.md` untrusted сабагентов `read/grep/glob/list/bash: ask` + `external_directory: ask`. OpenCode сам показывает HITL (`once/always/reject`). НЕ код плагина. | Конфиг |
| 11 | Whitelist (I4) | `.maestro/sanitizer-whitelist.json` — полный: `rules` (вкл/выкл категорий), `by_agent`, `patterns`. В authoring-репо — пример; реальный — в целевом. | Конфиг |
| 12 | Аудит-лог | `.maestro/sanitizer-log.md` (что замаскировано, без содержимого; что файл-доступ запрошен/разрешён/запрещён — через `permission.asked/replied`). | Код |
| 13 | Регистрация | `maestro-bootstrap` уже зарегистрирован в `opencode.json` целевого репо — sanitizer подхватится автоматически. | Док |
| 14 | Тесты | Расширить `index.test.js` тестами sanitize-функции. | Код |

## Подтверждённые решения Этапа 2 (ревью 2026-08-18)

1. **File access control — Путь A (нативные permissions)**, не код плагина.
2. **Trust-реконсиляция — Вариант 1 (статичный конфиг):** доверие на уровне
   конфига агента (`allow`-permissions = trusted, `ask` = untrusted). trust-config.json
   — только для sanitizer.
3. **Ур.1 (плагин):** санитайзинг промпта `task`-тула (`output.args.prompt = sanitize(...)`),
   авто без HITL.
4. **Ур.2 (сабагент sanitizer):** всегда, доп. слой поверх плагина (видит
   уже_замаскированный промпт — осознанный трейд-офф).
5. **Whitelist — полный:** категории вкл/выкл + per-subagent + паттерны-исключения.
6. **Плагин:** sanitizer внутри `maestro-bootstrap` (не отдельный модуль).
7. **Аудит-лог:** `.maestro/sanitizer-log.md`.

## Порядок реализации

- **Этап 1** — сделан (PR `c8247b2`): сабагент + правила + гейт + docs.
- **Уход от агента** — предпосылка: команда `@maestro` (вход), удаление
  `agents/maestro.md`, перепривязка команд, пересмотр плагина (инжекция/observability).
- **Этап 2** — sanitizer в плагине + нативные permissions + whitelist + аудит-лог + docs.

## Known gaps Этапа 1 (закрываются на Этапе 2)

- **Принцип «минимум данных до trusted sanitizer» не выполняется (I2):** на
  Этапе 1 нет Уровня 1, sanitizer (trusted) видит все raw-промпты. Закроется
  плагином на Этапе 2.
- **Этап 1 модель-зависим (C4):** оркестратор должен вручную диспатчить sanitizer
  перед каждым untrusted-диспатчем. Модель может забыть/пропустить. Закроется
  плагином на Этапе 2.
- **File access control не enforced (дополнение):** на Этапе 1 — только
  инструкция в промпте untrusted сабагенту «не читать файлы без подтверждения».
  Реальный enforcement — плагин на Этапе 2 (перехват tools).

## Правила Context Sanitizer (из SKILL.md, основа для пометок/маскирования)

1. **Secrets из окружения** — имена с `SECRET`, `KEY`, `TOKEN`, `PASSWORD`,
   `CREDENTIAL`, `PASS`, `AUTH` → `<redacted:env.NAME>`.
2. **Чувствительные поля данных** — `amount`, `currency`, `article_code`,
   `counterparty_id` → `<redacted>`.
3. **Файлы .env / .env.\*** → `<redacted:.env file>`.
4. **SFTP/DB credentials** — `sftp://`, `postgresql://`, `mongodb://` с
   credentials → `<redacted:connection>`.
5. **Raw ledger entries** — маскинг полей из п.2.

**НЕ фильтруется:** агрегированные данные, схемы БД без данных, код и конфиги
(кроме `.env`), имена таблиц/колонок.

## Открытые вопросы (решить до/на Этапе 2)

- **M1 — Технический verify:** может ли `tool.execute.before` модифицировать
  input `task`-тула (prompt) до ухода в сабагента? Существующий плагин в
  `tool.execute.before` только логирует. Нужно verify в OpenCode, иначе Уровень 1
  нереализуем на этом хуке.
- **File access control — хук:** какой хук перехватывает Read/Glob/Grep внутри
  сабагента? `tool.execute.before` работает на tool calls сабагента? Verify.
- Точные правила детекта секретов по regex (без ложных срабатываний на
  легитимных данных) — калибровка с whitelist.