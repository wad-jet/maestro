# Команды

[Назад к оглавлению](../index.md)

## 🎯 Назначение

Справочник доступных `@command` для работы со скиллом `maestro`. Конфиги живут
в `commands/*.md` (authoring-репо); доставляются в целевое приложение штатным механизмом
(вручную из удалённого репозитория или через `agpack`).

## 📖 Команды

### `/maestro`

Вход в pipeline: загружает скилл `maestro` и следует pipeline из SKILL.md.
Работает в любой primary-сессии (привязки к агенту нет).

### `/regression`

Регрессионный прогон по реестру рисков (`regression/`, в git). Standalone —
**не** часть pipeline шага 15. Подробнее — [Работа с реестром регрессии](../how-to/use-regression-registry.md).

```
/regression smoke                    # HIGH: active + verified, статусы не меняет
/regression smoke active             # HIGH: только active
/regression full                     # всё: active + verified
/regression full active              # всё: только active
/regression full --timeout 300       # глобальный timeout (дефолт 120с)
/regression release                  # ВСЕ verified → released (строгий гейт)
/regression purge [days=30]          # ротация архива (HITL)
/regression purge preview            # предпросмотр удаляемого
```

### `/maestro-init`

Setup-фаза bootstrap нового проекта: `docs/project-context.md` (14 категорий),
конфигурация maestro (`maestro.json`, плагин+модели в `.opencode/opencode.json`
или global, `.gitignore` — весь `.maestro/` и `.opencode/`), каталоги pipeline
(`.maestro/` — весь в `.gitignore`,
`docs/superpowers/{specs,plans}/`),
`regression/` структура. Использует скилл `maestro-init`.
Проверяет предусловия: `AGENTS.md` (встроенный `/init`), скилы superpowers
(предлагает установку через HITL), плагин `maestro-bootstrap` (не блокер).

### `/maestro-design`

Дизайн/архитектура, scaffold и roadmap после `/maestro-init`:
- (a) spec через **primary brainstorm (superpowers:brainstorming) + custodian Q/A (trusted)** → spec пишет primary → `docs/superpowers/specs/YYYY-MM-DD-<project>-design.md`; опц. spec-review (`opus`).
- (b) scaffold — каркас кода через `implementer-prompt.md` (TDD), диспатч `haiku`/`sonnet`.
- (c) `docs/roadmap.md` (MVP + этапы).
Модели агентов наследуются из `.opencode/opencode.json` или global (не переспрашивает).

### `/maestro-feedback-report`

Сбор фактуры по прошлым процессам maestro **в текущей сессии** для последующей
ретроспективы (что было хорошо / плохо / с какими проблемами). Использует скилл
`maestro-feedback-report`. Отчёт —
`.maestro/feedback-reports/report-<Session ID>-<YYYY-MM-DD>.md`. Основной
источник — диалог сессии; дополняется данными из логов плагина
(`maestro-bootstrap-*.log`) при наличии записей по `sessionID`. После генерации
отчёта — HITL-гейт: пользователь может оставить комментарии/рекомендации, которые
записываются в секцию `## Пользовательский фидбек` отчёта. Автокоммит не требуется.

### `/test-agents`

Проверка всех сабагентов maestro **реальным диспатчем**: каждой из 7 моделей
(`custodian`, `haiku`, `sonnet`, `opus`, `fable`, `code-reviewer`, `sanitizer`)
даётся одинаковая тривиальная тестовая задача через `task` tool. Возвращает
сводную таблицу статусов (OK/FAIL с причиной). Конфиги не читаются — проверяется
реальная работа модели: невалидное имя модели или недоступный провайдер
проявятся как FAIL при диспатче.

Дополнительно проверяется **confidential-инвариант** (P1/P3, `SECURITY.md`):
trusted-агенты (`custodian`, `sanitizer`) читают `docs/confidential/**`, а
primary-сессия при чтении того же файла получает `deny`. Статус инварианта —
`PASS` / `FAIL` (утечка → СТОП) / `skipped` (нет `docs/confidential/**`).

### `/maestro-version`

Показать версию плагина `maestro-bootstrap`, подключённого в текущей сессии.
Читает `.maestro/plugin-version` (пишется при инициализации плагина). Если файла
нет — сообщает, что плагин не инициализирован или версия неизвестна (признак
сбоя init плагина).

### `/maestro-assistant`

Консультации и настройка maestro-конфигурации/структуры/контекста в течение жизни
проекта. Загружает скилл `maestro-assistant` (tool: skill) и применяет его к запросу HITL.
Обрабатывает: `maestro.json` (trust/access_policy/confidential/sanitizer_whitelist),
`.opencode/opencode.json` / global (плагин, модели), структуру каталогов,
актуализацию `project-context.md`, консультации по
правилам работы maestro. Плагин-гейт не требуется. Если запрос требует изменения кода/spec/плана
или запуска pipeline — редирект на `@maestro`/`/maestro-design`/`@regression`.

## 💡 Примечания

- Все HITL-вопросы и сообщения пользователю — только на русском.
- Команды, привязанные к конкретному агенту, указывают его в поле `agent:`
  (например `/maestro-design` → flow primary brainstorm + custodian Q/A). `/test-agents` — общая команда,
  привязки к агенту нет.

## 🔗 Связанные разделы

- [Работа с реестром регрессии](../how-to/use-regression-registry.md)
- [Кастомизация скилла](../how-to/customize-maestro.md)