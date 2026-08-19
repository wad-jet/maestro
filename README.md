# maestro-agent

Authoring-репозиторий системы `maestro` — скилла для OpenCode, который
оркестрирует сквозную реализацию фич и багфиксов в целевом приложении
(design → spec → plan → SDD → review → docs, с HITL-гейтами).

Это репозиторий-**источник** конфигурации: здесь нет кода приложения. OpenCode
загружает runtime-копии скиллов, агентов и команд из целевого репозитория
(каталог `.opencode/`), а сюда они не копируются.

## Структура

- `skills/maestro/SKILL.md` — спецификация pipeline (фичи/багфиксы, HITL-гейты,
  реестр регрессии). Читать перед изменениями в `skills/`.
- `agents/*.md` — конфиги субагентов OpenCode: `design`, `haiku`, `sonnet`,
  `opus`, `fable`, `code-reviewer`, `sanitizer` — вызываются программно через
  `task`. `design` (spec formation) и `sanitizer` (security review) — trusted
  по умолчанию. Отдельного primary-агента `maestro` нет — вход через команду
  `@maestro`.
- `commands/*.md` — конфиги `@command` (`@maestro` — вход, `@regression`,
  `@maestro-init`, `@test-*`).
- `skills/maestro/` — вспомогательные файлы: `design-prompt.md`,
  `implementer-prompt.md`, `spec-review-prompt.md`, `stack-detection.md`.
- `skills/manual-docs/SKILL.md` — скилл пользовательской документации
  (`manual_docs/`, Diátaxis).
- `plugins/maestro-bootstrap/` — ESM-плагин OpenCode: глобальная observability
  (логирование `task`-диспатчей и ошибок сессий).

## Синхронизация с целевым репо

`skills/`, `agents/` и `commands/` здесь — источник истины; runtime-копии живут
в приложении. При правке файла обновлять и копию:

- `agents/*.md` → `.opencode/agents/*.md`
- `commands/*.md` → `.opencode/commands/*.md`
- любой скилл в `skills/` → `.opencode/skills/<name>/SKILL.md`

Подробнее — в `AGENTS.md` (раздел «Скиллы / Skills»).

## Тестирование плагина

Встроенный test runner Node, без зависимостей:

```bash
node --test plugins/maestro-bootstrap/index.test.js
# или: cd plugins/maestro-bootstrap && npm test
```

## История переименования

Агент назывался `feature-agent` и был переименован в `maestro` (2026-08-03).
Приложение должно быть обновлено в том же шаге: ключи `agent.maestro` и путь
плагина `plugins/maestro-bootstrap/index.js` в `opencode.json`, зеркала
`.opencode/` (`agents/maestro.md`, `skills/maestro/`) и запись в `.gitignore`
**конкретных путей** `.maestro/` (`.maestro/sdd/`, `.maestro/last-run.md`,
`.maestro/maestro-bootstrap-*.log`, `.maestro/feedback-reports/` — НЕ весь `.maestro/`).

## Уход от агента (2026-08-18)

Primary-агент `maestro` удалён. Осталась команда `@maestro` (вход) + скилл.
Приложение должно быть обновлено в том же шаге: удалить `agent.maestro` и
`agents/maestro.md` из `opencode.json`/`.opencode/`, добавить команду
`@maestro`, убрать `agent: maestro` у `@regression`/`@maestro-init`.
