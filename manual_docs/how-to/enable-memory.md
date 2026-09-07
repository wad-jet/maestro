# Как включить память maestro

[Назад к оглавлению](../index.md)

## 🎯 Назначение

Пошаговое включение и настройка **memory layer** — опциональной векторной памяти
сессий плагина `maestro-bootstrap` (авто-саммаризация, `memory_search`,
авто-вспоминание). Полный справочник конфигурации — в
[Память maestro (reference)](../reference/memory.md).

Память — **не обязательная часть maestro**: стандартная установка
(`maestro-install.sh`, agpack) её не включает. Включается **по запросу**.

## ✅ Краткая инструкция (default — локальный sqlite)

1. В `maestro.json` добавить секцию:

   ```json
   {
     "memory": { "enabled": true }
   }
   ```

   > Альтернатива: при установке maestro ответить «да» на опциональный шаг
   > `maestro-install.sh` «Подключить memory layer? (y/N)» — скрипт поставит
   > файл-маркер `<data-dir>/maestro/memory/enabled.flag`, который учтёт
   > `/maestro-new` при генерации `maestro.json` (секция `memory` появится
   > автоматически).

2. Запустить opencode один раз — плагин выполнит **self-provisioning**: создаст
   `<data-dir>/maestro/memory/module/`, запишет `package.json` (манифест
   опциональных зависимостей; single-writer — только плагин) и скопирует
   исходники модуля.

3. Установить опциональные зависимости:

   ```bash
   npm install   # в каталоге <data-dir>/maestro/memory/module/
   ```

   > `<data-dir>`: `$XDG_DATA_HOME` → macOS `~/Library/Application Support` →
   > `~/.local/share`; далее `/maestro/memory/module`. Если задан
   > `memory.module_dir` — каталог из конфига.

4. Перезапустить opencode. Память работает локально: default-модель
    эмбеддингов, auto-recall включён, поиск через `memory_search`. Модель
   загружается один раз (~120 МБ, кэш).

Проверка: в новой сессии задайте вопрос по прошлой работе — в system prompt
появится блок `## Контекст из памяти maestro`; либо вызовите инструмент
`memory_search`.

## 📖 Полная инструкция

### Выбор бэкенда (`storage.type`)

| Бэкенд | Когда | Конфигурация |
|---|---|---|
| `sqlite` (default) | Личный, локальный | ничего не нужно |
| `qdrant` | Централизованный (команда) | `url` + `api_key_env` (имя env-переменной с API-ключом; **никогда** plaintext в `maestro.json`) |
| `pgvector` | Есть центральный Postgres | `connection_string_env` (имя env-переменной с DSN) |

```json
{
  "memory": {
    "enabled": true,
    "storage": {
      "type": "qdrant",
      "qdrant": {
        "url": "https://qdrant.internal:6333",
        "api_key_env": "MAESTRO_MEMORY_QDRANT_KEY",
        "collection": "maestro_memory"
      },
      "centralized_confidential": "forbid"
    }
  }
}
```

```json
{
  "memory": {
    "enabled": true,
    "storage": {
      "type": "pgvector",
      "pgvector": {
        "connection_string_env": "MAESTRO_MEMORY_PG_DSN",
        "table": "maestro_memory"
      },
      "centralized_confidential": "forbid"
    }
  }
}
```

Требования к централизованным бэкендам:

- **Identity обязательна** (иначе память off + лог): `identity` → `identity_env`
  → git `user.name`. Identity — подпись записей (`author`), **не access-control**:
  любой член команды с ключом читает всю память проекта. Per-account RBAC —
  server-side задача, вне scope плагина.
- **`centralized_confidential`:** `forbid` (default) — проект с
  `confidential.paths` пишет память **только в локальный sqlite** (failover +
  warning в лог); `allow` — разрешить централизованный бэкенд (осознанный риск,
  только с identity и маскированием).

> **Переключение бэкенда не мигрирует данные.** Ручное средство: удалить
> каталог `<data-dir>/maestro/memory/<hash>/` (sqlite) или коллекцию/таблицу
> (qdrant/pgvector) и включить память заново — начнётся backfill.

### Командная память: identity и namespace

- **`identity_env`** — имя env-переменной с identity (per-machine, не в общем
  `maestro.json` — иначе вечные merge-конфликты per-user значения). Fallback —
  git `user.name`, затем OS username. `identity` в `maestro.json` — только явный
  override (напр. сервисный аккаунт).
- **`namespace`** — переопределяет ключ памяти `key`:
  - **Monorepo** (один remote, несколько подпроектов): общий `namespace` →
    общая память подпроектов.
  - **Связанные репозитории** команды: одинаковый `namespace` в каждом → общая
    память.
  - Без `namespace` `key = project_hash` (стабильный hash от git remote `origin`;
    нет remote — hash абсолютного пути).
  - ⚠️ **Смена namespace = потеря доступа к старым записям** (миграции нет).

### Offline: предзагрузка модели эмбеддингов

Default-модель `Xenova/paraphrase-multilingual-MiniLM-L12-v2` (dim 384, RU+EN,
q8 ~120 МБ, ONNX) загружается однократно с HuggingFace и кэшируется локально.
После загрузки работает офлайн. Для полностью offline-машины — предзагрузите
модель заранее (при наличии сети) или укажите альтернативную
`memory.embedding_model`. При недоступности сети и отсутствии кэша — память off
с логом-инструкцией (сессии работают).

> ⚠️ **Смена `embedding_model` требует переиндексации** (вектора старой модели
> несовместимы с новой): удалить каталог/коллекцию и включить заново.

### Границы удаления

| Что удалить | Что произойдёт |
|---|---|
| `<data-dir>/maestro/memory/enabled.flag` | Маркер install.sh снят; последующие `/maestro-new` не добавляют секцию `memory` (уже добавленная секция в `maestro.json` остаётся) |
| `module_dir` (`<data-dir>/maestro/memory/module/`) | Удаляется код модуля + `node_modules` (переустановка deps). **Данные не трогаются** |
| `<data-dir>/maestro/memory/<hash>/memory.db` | Удаляется локальная память проекта (sqlite) |
| `<data-dir>/maestro/memory/state.json` | Сбрасывается retry/skip/first-run состояние (backfill-окно отсчитывается заново) |
| Коллекция/таблица (qdrant/pgvector) | Удаляется централизованная память |

Полное отключение памяти: убрать секцию `memory` из `maestro.json` (или
`enabled: false`) и перезапустить opencode — хуки не регистрируются, зависимости
не загружаются.

### Обновления

- `maestro-update.sh` очищает кэш плагина, но **не трогает**
  `<data-dir>/maestro/memory/` — код модуля обновляется в lockstep с плагином
  (self-provision ре-синкает код при смене версии), `node_modules` и данные
  переживают обновления.
- После обновления maestro, если манифест поднял версии deps, а `node_modules`
  старый → память off + лог «повторите `npm install` в module_dir».

## 🛠️ Диагностика

| Симптом | Причина / действие |
|---|---|
| Память не работает, в логе `memory: disabled` с `reason` | Конфигурация невалидна (см. `disabled_reason`: `storage_type_invalid`, `centralized_identity_missing`, `qdrant_config_invalid`, `pgvector_config_invalid`, `centralized_confidential_invalid`) |
| В логе `memory: transformers not installed — run npm install in <module_dir>` | Не выполнена установка deps (шаг 3 краткой инструкции) |
| В логе `memory: init failed` | Ошибка инициализации (бэкенд недоступен, модель не загрузилась и т.п.) — сессии работают |
| Блок `## Контекст из памяти maestro` не появляется | Модель эмбеддингов ещё прогревается (первый запуск), либо нет записей выше `min_score`, либо сессия не top-level primary |
| `memory_search` возвращает «Ничего не найдено» | Память пуста (backfill ещё не прошёл) или запрос ниже порога `min_score` |

## 🔗 Связанные разделы

- [Память maestro (reference)](../reference/memory.md) — полная схема конфигурации
- [Конфигурация](../reference/config.md) — секция `memory` в maestro.json
- [Агенты и модель доверия](../explanation/agents-and-trust.md) — memory и confidential
- [Выбор моделей](../reference/model-selection.md) — модели памяти
- [Обновление maestro](update-maestro.md)