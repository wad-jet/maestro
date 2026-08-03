# maestro-agent

Authoring-репозиторий системы `maestro` — агента для OpenCode, который
оркестрирует сквозную реализацию фич и багфиксов в целевом приложении
(brainstorm → spec → plan → SDD → review → docs, с HITL-гейтами).

Это репозиторий-**источник** конфигурации: здесь нет кода приложения. OpenCode
загружает runtime-копии скиллов, агентов и команд из целевого репозитория
(каталог `.opencode/`), а сюда они не копируются.

## Структура

- `skills/maestro/SKILL.md` — спецификация pipeline (фичи/багфиксы, HITL-гейты,
  реестр регрессии). Читать перед изменениями в `skills/`.
- `agents/*.md` — конфиги агентов OpenCode. `maestro.md` —
  `mode: primary`; `haiku`, `sonnet`, `opus`, `fable`, `code-reviewer` —
  субагенты, вызываются программно через `task`.
- `commands/*.md` — конфиги `@command` (`@regression`, `@test-*`).
- `skills/maestro/` — вспомогательные файлы: `implementer-prompt.md`,
  `spec-review-prompt.md`, `stack-detection.md`.
- `skills/manual-docs/SKILL.md` — скилл пользовательской документации
  (`manual_docs/`, Diátaxis).
- `plugins/maestro-bootstrap/` — ESM-плагин OpenCode, гарантирующий, что сессии
  агента `maestro` начинаются с загрузки скилла и следования pipeline.

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
`.opencode/` (`agents/maestro.md`, `skills/maestro/`) и запись `.maestro/` в
`.gitignore`.
