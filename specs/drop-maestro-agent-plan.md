# Plan: уход от агента `maestro`, оставить только скилл

> Статус: для разработки. Дата: 2026-08-18. Репо: `maestro-agent`.
> Spec: `specs/drop-maestro-agent.md`. Масштаб: архитектурный рефакторинг.

## Краткое описание

Убрать агента `maestro` (primary). Вход в pipeline — команда `@maestro` в любой
primary-сессии. Плагин `maestro-bootstrap` перестаёт фильтровать по агенту,
становится глобальным (инжекция убирается, observability сокращается). Sanitizer
в плагине — отдельная задача (Этап 2), в этот план не входит.

## Task 1: Команда `@maestro` (вход)

Создать `commands/maestro.md`:
- frontmatter: `description`, без `agent:` (или generic).
- Тело: «Загрузи skill `maestro` (tool: skill) и следуй pipeline из SKILL.md.»
- Ключевые правила входа (как в старом `agents/maestro.md`): HITL-гейты,
  русский язык, коммиты, финальное ревью.

Проверка: файл существует, frontmatter валиден, без `agent: maestro`.

## Task 2: Удалить `agents/maestro.md`

- `git rm agents/maestro.md`.

Проверка: файла нет.

## Task 3: Перепривязать команды, удалить `test-maestro`

- `commands/regression.md`: убрать `agent: maestro`.
- `commands/maestro-init.md`: убрать `agent: maestro`.
- `commands/test-maestro.md`: `git rm` (агента нет).

Проверка: ни одна команда не ссылается на `agent: maestro`.

## Task 4: Пересмотреть плагин `maestro-bootstrap`

В `plugins/maestro-bootstrap/index.js`:

**Убрать:**
- `experimental.chat.messages.transform` (инжекция) — удалить хук и `BOOTSTRAP`,
  `MARKER`, `sessionIDOf`.
- `agentBySession`-маппинг и фильтрацию `agent === "maestro"` во всех хуках.
- Детальное `tool.execute.before/after` логирование bash/skill (оставить только
  `task`-аудит + `empty_result`).

**Оставить/сократить:**
- `makeLogger` (логер с level/mask) — сохранить.
- `makeBoundedMap` — сохранить (для трекинга, если нужно).
- `event` — `session.error`, `session.status.retry` (глобально, без агент-фильтра).
- `tool.execute.after.empty_result` — глобально.
- Логирование `task`-диспатча — для будущего аудит-лога sanitizer.

**Обновить:**
- Заголовочный комментарий (роль плагина).
- `log.info("plugin initialized", ...)` — без `agent: "maestro"`.

В `index.test.js`:
- Переписать тесты, которые полагаются на агент-фильтр (`maestro session`,
  `non-maestro session`) — теперь плагин глобальный.
- Убрать тесты инжекции (`transform`).
- Оставить тесты `makeLogger`, `makeBoundedMap`, log mask.

Проверка: `node --test plugins/maestro-bootstrap/index.test.js` — все зелёные.

## Task 5: Обновить SKILL.md

- Модель оркестратора: не агент, а скилл в primary-сессии (шаг 1, When to Use).
- Упоминания «агент maestro» → «скилл maestro / команда @maestro».
- Шаг 1: загрузка скилла через `@maestro` (команду) в любой сессии.

Проверка: в SKILL.md нет ссылок на агента `maestro` как на вход.

## Task 6: Обновить документацию

- `README.md` — агент удалён, вход `@maestro`, плагин глобальный.
- `AGENTS.md` — `agents/maestro.md` убрать из структуры; команда `@maestro`;
  плагин роль.
- `plugins/maestro-bootstrap/README.md` — инжекция убрана, observability
  сокращена, плагин глобальный.
- `manual_docs/` — `overview/what-is-maestro.md` (вход через команду),
  `how-to/customize-maestro.md` (агент удалён), `overview/changelog.md`,
  `explanation/agents-and-trust.md` (роль плагина), `reference/model-selection.md`
  (агент maestro нет), `reference/commands.md` (@maestro команда).
- `security-review-plan.md` — отметить, что уход от агента сделан (галочки).

Проверка: все относительные ссылки в `manual_docs/` резолвятся; нигде нет
ссылок на `agents/maestro.md` как на актуальный.

## Верификация

1. `node --test plugins/maestro-bootstrap/index.test.js` — все зелёные.
2. `grep -rln "agent: maestro\|agent maestro\|agents/maestro" .` — пусто
   (кроме исторических упоминаний в changelog/SECURITY).
3. `manual_docs/` ссылки резолвятся.
4. Команды без `agent: maestro`.

## Порядок

Task 1→2→3 (вход и удаление) → Task 4 (плагин) → Task 5 (SKILL) → Task 6 (docs).

## Вне scope

- Sanitizer-функция в плагине (`sanitize` + whitelist + аудит-лог) — Этап 2
  (см. `security-review-plan.md`).
- Нативные permissions (file access control) — Этап 2.