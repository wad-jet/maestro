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

Bootstrap нового проекта: `docs/project-context.md` (14 категорий), дизайн и
архитектура, scaffold, `docs/roadmap.md` (MVP + этапы). Использует скилл `init`.

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