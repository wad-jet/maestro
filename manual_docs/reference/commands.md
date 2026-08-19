# Команды

[Назад к оглавлению](../index.md)

## 🎯 Назначение

Справочник доступных `@command` для работы со скиллом `maestro`. Конфиги живут
в `commands/*.md` (authoring-репо), runtime-копии — в `.opencode/commands/`.

## 📖 Команды

### `@maestro`

Вход в pipeline: загружает скилл `maestro` и следует pipeline из SKILL.md.
Работает в любой primary-сессии (привязки к агенту нет).

### `@regression`

Регрессионный прогон по реестру рисков (`regression/`, в git). Standalone —
**не** часть pipeline шага 15. Подробнее — [Работа с реестром регрессии](../how-to/use-regression-registry.md).

```
@regression smoke                    # HIGH: active + verified, статусы не меняет
@regression smoke active             # HIGH: только active
@regression full                     # всё: active + verified
@regression full active              # всё: только active
@regression full --timeout 300       # глобальный timeout (дефолт 120с)
@regression release                  # ВСЕ verified → released (строгий гейт)
@regression purge [days=30]          # ротация архива (HITL)
@regression purge preview            # предпросмотр удаляемого
```

### `@maestro-init`

Setup-фаза bootstrap нового проекта: `docs/project-context.md` (14 категорий),
конфигурация maestro (`maestro.json`, `opencode.json` с плагином и моделями,
`.gitignore`), каталоги pipeline (`.maestro/`, `docs/superpowers/{specs,plans}/`),
`regression/` структура. Использует скилл `maestro-init`.
Проверяет предусловия: `AGENTS.md` (встроенный `/init`), скилы superpowers
(предлагает установку через HITL), плагин `maestro-bootstrap` (не блокер).

### `@maestro-design`

Дизайн/архитектура, scaffold и roadmap после `/maestro-init`:
- (a) spec через сабагент `design` (trusted) → `docs/superpowers/specs/YYYY-MM-DD-<project>-design.md`; опц. spec-review (`opus`).
- (b) scaffold — каркас кода через `implementer-prompt.md` (TDD), диспатч `haiku`/`sonnet`.
- (c) `docs/roadmap.md` (MVP + этапы).
Модели агентов наследуются из `opencode.json` (не переспрашивает).

### `@maestro-feedback-report`

Сбор фактуры по прошлым процессам maestro **в текущей сессии** для последующей
ретроспективы (что было хорошо / плохо / с какими проблемами). Использует скилл
`maestro-feedback-report`. Отчёт —
`.maestro/feedback-reports/report-<Session ID>-<YYYY-MM-DD>.md`. Основной
источник — диалог сессии; дополняется данными из логов плагина
(`maestro-bootstrap-*.log`) при наличии записей по `sessionID`. После генерации
отчёта — HITL-гейт: пользователь может оставить комментарии/рекомендации, которые
записываются в секцию `## Пользовательский фидбек` отчёта. Автокоммит не требуется.

### `@test-<agent>`

Проверка доступности субагента и его конфига в `opencode.json`
(`agent.<name>.model`). Доступны: `@test-design`, `@test-haiku`, `@test-sonnet`,
`@test-opus`, `@test-fable`, `@test-code-reviewer`, `@test-sanitizer`.

## 💡 Примечания

- Все HITL-вопросы и сообщения пользователю — только на русском.
- Поле `agent:` в команде указывает, какой агент её исполняет.

## 🔗 Связанные разделы

- [Работа с реестром регрессии](../how-to/use-regression-registry.md)
- [Кастомизация скилла](../how-to/customize-maestro.md)