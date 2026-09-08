---
description: Показать статус memory layer плагина maestro-bootstrap (бэкенд, записи, тюнинг)
---

# @maestro-memory

Покажи текущий статус **memory layer** (опциональной векторной памяти сессий плагина `maestro-bootstrap`).

**Язык:** все сообщения пользователю — только на русском.

## Шаг 1. Проверить доступность инструментов памяти

1. Попробуй вызвать инструмент `memory_stats_detail` (без параметров).
2. Если вызов не удался / инструмент недоступен / память выключена → выведи:

   ```
   Память maestro выключена (disabled_reason: <причина>).
   Включите в maestro.json: memory.enabled: true (см. manual_docs/how-to/enable-memory.md)
   ```

   Причину (`disabled_reason`) определи по `maestro.json`: отсутствие секции `memory` →
   `no_memory_section`; `memory.enabled: false` → `explicitly_disabled`; невалидные ключи
   (`retention_days`, `similarity_threshold`, `storage.type`, `branch_context`, `mainline`,
   `storage.pgvector.text_search_config`) → соответствующий код (`*_invalid`);
   централизованный бэкенд без identity → `centralized_identity_missing`;
   env-зависимые причины (`qdrant` без `url`/`api_key_env` → `qdrant_config_invalid`;
   `pgvector` без `connection_string_env` → `pgvector_config_invalid`).

3. Если инструмент вернул данные → продолжи к Шагу 2.

## Шаг 2. Прочитать конфигурацию памяти

1. Прочитай `maestro.json` (файл в корне проекта) через `read`.
2. Извлеки секцию `memory`. Если секция отсутствует → используй значения по умолчанию:

   | Параметр              | Значение по умолчанию                                           |
   |---|---|
   | `top_k`               | `3`                                                             |
   | `min_score`           | `0.35`                                                          |
   | `idle_debounce_min`   | `10`                                                            |
   | `embedding_model`     | `Xenova/paraphrase-multilingual-MiniLM-L12-v2`                  |
   | `storage.type`        | `sqlite`                                                        |
   | `retention_days`      | `null` (выключено)                                              |

3. Зафиксируй фактические значения (файла или дефолты).

## Шаг 3. Сформировать и вывести отчёт

Выведи агрегированный отчёт (без раскрытия содержимого записей, SEC-4b):

```
## Память maestro — статус

**Бэкенд:** <sqlite | qdrant | pgvector>
**Модель:** <embedding_model>
**Активный key:** <effective key из отчёта>

**Записи:** всего <N>
  По авторам: <author1>: <count>, <author2>: <count>, …
  По датам: <date1>: <count>, <date2>: <count>, …

**Тиры:** merged: <N>, experience: <N>, unknown: <N>, dead: <N>
  По веткам: <branch1>: <count>, <branch2>: <count>, …

**Кластеры / граф:** <количество кластеров>, <количество связей>

**Тюнинг:**
  top_k = <top_k> (для изменения: `top_k: <N>` в `memory` секции maestro.json)
  min_score = <min_score> (для изменения: `min_score: <value>` в `memory` секции maestro.json)
  retention_days = <retention_days или «выключено»>
```

Если в отчёте `memory_stats_detail` есть диагностические строки — выведи их как есть:
- `mainline_unresolved` — mainline не резолвнут (branch-context flat; guidance: `memory.mainline` override);
- `unmasked_branch_metadata` — централизованный бэкенд + непустые `confidential.paths` (имена веток уходят на сервер).

Если в отчёте `memory_stats_detail` нет данных по кластерам/графу — напиши:
`«Данные по кластерам/графу отсутствуют»`.
