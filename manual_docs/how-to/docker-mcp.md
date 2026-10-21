# Подключение MCP-серверов в Docker

[Назад к оглавлению](../index.md)

## 🎯 Назначение

Как добавить MCP-сервер в изолированный `opencode serve`-контейнер: когда нужно,
как объявить и разрешить, защита от name-hijack и отладка.

> **Важно:** пайплайн maestro **не требует MCP**. Все шаги пайплайна работают
> без внешних MCP-серверов. MCP нужен только если целевое приложение
> нуждается во внешних инструментах (не из коробки opencode).

---

## Когда MCP нужен / не нужен

| Сценарий | Нужен MCP? |
|---|---|
| Пайплайн maestro (brainstorm → spec → plan → SDD → review) | **Нет** |
| Целевое приложение использует внешние LLM-инструменты (API, БД) | **Да** |
| Простые задачи (документация, рефакторинг, багфиксы) | **Нет** |
| Требуется взаимодействие с конкретной внешней системой | **Да** |

---

## Объявление сервера

### Шаг 1: Declare в managed-слое

MCP-сервер объявляется в `/etc/opencode/opencode.json` (managed layer —
**самый высокий приоритет**, не может быть подменён committed файлом).

```jsonc
{
  // В секцию policies добавить allow для конкретного сервера:
  "policies": [
    // deny всех MCP по умолчанию (уже есть в baseline)
    { "action": "integration.use", "resource": "mcp:*", "effect": "deny" },
    // allow для конкретного объявленного сервера
    { "action": "integration.use", "resource": "mcp:my-service", "effect": "allow" }
  ]
}
```

> **Почему в managed-слое:** `/etc/opencode/` имеет высший приоритет среди
> файловых слоёв. Committed `opencode.json` в репо **не может** ослабить deny
> и подменить сервер — это закрывает name-hijack.

### Шаг 2: Bind-mount managed-слоя (без пересборки)

Чтобы изменить managed-слой без пересборки образа — смонтируйте свою версию:

```bash
docker run -d \
  -v ~/maestro-config/<project>/etc-opencode.json:/etc/opencode/opencode.json:ro \
  maestro-opencode:6.x
```

Или через named volume (требует seeding entrypoint'ом при первом запуске):

```bash
docker run -d \
  -v oc-conf:/etc/opencode \
  maestro-opencode:6.x
```

---

## Name-hijack защита

**Риск:** если MCP-сервер объявлен в committed конфиге, а оператор не контролирует
managed-слой — злонамеренный коммит может подменить объявление на вредоносный
сервер с тем же именем.

**Защита:**
1. **Managed-слой выше committed:** `/etc/opencode/` имеет высший приоритет
   файловой precedence. `policies` в managed-слое переопределяют repo-конфиг.
2. **Same-name override:** если в managed-слое объявлен `mcp:my-service`,
   тот же `mcp:my-service` в committed конфиге — игнорируется (не используется).
3. **Deny по умолчанию:** `mcp:*` denied — разрешается только явный
   `mcp:<имя>` после deny-правила.

---

## HTTP/SSE vs stdio

| Тип | Как работает в Docker | Класс риска |
|---|---|---|
| **HTTP/SSE** | Сервер на хосте → URL в конфиге | Низкий: сетевой вызов, нет кода в процессе |
| **stdio** | Процесс запускается **внутри контейнера** | **Высокий**: тот же класс, что плагин (произвольный код) |

> **stdio = код в процессе контейнера.** MCP-сервер на stdio запускается как
> subprocess внутри контейнера — полный доступ к файловой системе и сети
> контейнера. Рассматривайте как equivalent plugin (код в процессе opencode-сервера).
> Разрешайте только доверенные серверы из проверенных источников.

**Рекомендация:** для MCP-серверов с доступом к внешним системам используйте
HTTP/SSE (запуск на хосте, контейнер подключается по сети). Stdio — только для
доверенных инструментов с проверенным кодом.

---

## Debug-чеклист

| Проблема | Действие |
|---|---|
| MCP не подключается | Проверьте `policies` в `/etc/opencode/`: есть ли `allow mcp:<имя>` после `deny mcp:*` |
| Ошибка доступа к ресурсу | stdio-сервер — subprocess в контейнере, проверьте права на файлы внутри контейнера |
| Сервер не видит файлы репо | Подключите volume с workspace к stdio-серверу, либо используйте HTTP/SSE |
| Имя сервера конфликтует | Проверьте managed-слой: `docker exec <container> cat /etc/opencode/opencode.json` |
| MCP подключается, но инструменты не работают | Проверьте `tool.use` policies: `webfetch:*`/`websearch:*` — deny по default в managed-слое |

---

## 🔗 Связанные разделы

- [Docker-serve residuals](../explanation/docker-residuals.md) — ограничения docker-serve
- [Конфигурация](config.md) — переменные окружения и managed-слой
- [Пайплайн overview](../explanation/pipeline-overview.md) — why maestro doesn't need MCP
