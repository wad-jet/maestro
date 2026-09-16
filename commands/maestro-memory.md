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
   `storage.pgvector.text_search_config`, `embedding`, `probe_cooldown_min`, `artifact_globs`) → соответствующий код (`*_invalid`);
   централизованный бэкенд без identity → `centralized_identity_missing`;
   env-зависимые причины (`qdrant` без `url`/`api_key_env` → `qdrant_config_invalid`;
   `pgvector` без `connection_string_env` → `pgvector_config_invalid`);
   embedder-причины: невалидная секция `embedding` (в т.ч. отсутствие `api_key_env` в конфиге) → `embedding_invalid`;
   `embedding.provider: openai` с `api_key_env` в конфиге, но без значения в env → `embedding_api_key_env_missing`;
   невалидный `probe_cooldown_min` → `probe_cooldown_min_invalid`;
   стартовый probe завершился hard-fail (ключ/модель/размерность) → `embedder_probe_hard_fail`.

   **Диагностика в off-состоянии:** инструмент `memory_probe` доступен в
   off-состоянии **только** при `disabled_reason: embedder_probe_hard_fail`
   (стартовый probe hard-fail оставляет диагностический тул). В этом случае
   вызови `memory_probe` (live-проверка embedder, минуя cooldown) и покажи
   результат + рекомендации:
   - `FAIL (конфигурация)` — проверь `embedding.api_key_env`/ключ, `embedding.model`, `embedding.dim` в `maestro.json`;
   - `FAIL` (soft) — сеть/таймаут провайдера; проверь `embedding.base_url` и доступность эндпоинта;
   - `OK` — embedder доступен; причина off — в другом `disabled_reason` (см. выше).
   Для прочих `disabled_reason` (`no_memory_section`, `explicitly_disabled`,
   `*_invalid`, `centralized_identity_missing`, `qdrant_config_invalid`,
   `pgvector_config_invalid`, `embedding_api_key_env_missing`,
   `namespace_missing`, `namespace_invalid`, `related_invalid`, `domain_recall_invalid`)
   `memory_probe` **не зарегистрирован** — диагностика только по конфигу (см. выше).
   При `namespace_missing` — напомнить: «Задайте memory.namespace (формат: a.b.c,
   1–3 сегмента, lowercase) — см. manual_docs/how-to/enable-memory.md.»

3. Если инструмент вернул данные → продолжи к Шагу 2.

## Шаг 2. Прочитать конфигурацию памяти

1. Прочитай `maestro.json` (файл в корне проекта) через **bash** (`cat`/`sed`) —
   нативный permission-слой deny-ит `read`-тул по `maestro.json`.
2. Извлеки секцию `memory`. Если секция отсутствует → используй значения по умолчанию:

   | Параметр            | Значение по умолчанию                                        |
   | ---                 | ---                                                          |
   | `top_k`             | `3`                                                          |
   | `min_score`         | `0.35`                                                       |
   | `idle_debounce_min` | `10`                                                         |
   | `embedding_model`   | `Xenova/paraphrase-multilingual-MiniLM-L12-v2`               |
   | `storage.type`      | `sqlite`                                                     |
   | `retention_days`    | `null` (выключено)                                           |
   | `artifact_globs`    | `["docs/superpowers/specs/**", "docs/superpowers/plans/**"]` |
   | `history_globs`     | `null` (inherit `artifact_globs`)                          |

3. Зафиксируй фактические значения (файла или дефолты).

## Шаг 3. Сформировать и вывести отчёт

Выведи агрегированный отчёт (без раскрытия содержимого записей, SEC-4b):

```
## Память maestro — статус

**Бэкенд:** <sqlite | qdrant | pgvector>
**Модель:** <provider>: <model> (для `openai` — `openai: <model>@<base_url>`; для `local` — имя ONNX-модели)
**Проверка embedder:** <OK | FAIL (конфигурация)> (<detail>, <ISO-время>)
**Активный key:** <effective key из отчёта>

**Ключ:**
  - **namespace:** <значение memory.namespace>
  - **Домен** (последний префикс): <last domain prefix>
  - **Related-цели:** <список memory.related, или «не заданы»>
  - **Проекты в бакете:** <по origin_remote, диагностика коллизий>

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
- `unmasked_branch_metadata` — централизованный бэкенд + непустые `confidential.paths` (имена веток уходят на сервер);
- `external_embedder_unmasked_queries` — внешний embedder + непустые `confidential.paths` (запросы/контент уходят внешнему вендору).

**Аудит-лог memory layer:** для root-cause/эффективности/латентности укажи файл
`.maestro/logs/maestro-memory-<дата>.log` (JSONL; lifecycle/эффективность — `info`,
перф/root-cause — `debug`, поднимается `MAESTRO_MEMORY_LOG_LEVEL=debug`). Грепы:
`memory:search.no_hits` (причины пустого поиска), `memory:recall.injected`
(работает ли авто-вспоминание), `memory:backfill`/`memory:storage.stats`
(покрытие), `duration_ms` (латентность).

Если строка **Проверка embedder:** отсутствует или статус `FAIL` — вызови инструмент
`memory_probe` (live-проверка, минуя cooldown) и покажи результат + рекомендации:
- `FAIL (конфигурация)` — проверь `embedding.api_key_env`/ключ, `embedding.model`, `embedding.dim` в `maestro.json`;
- `FAIL` (soft) — сеть/таймаут провайдера; проверь `embedding.base_url` и доступность эндпоинта;
- `OK` — embedder доступен; если память всё ещё off — причина в другом `disabled_reason` (см. Шаг 1).

Если в отчёте `memory_stats_detail` нет данных по кластерам/графу — напиши:
`«Данные по кластерам/графу отсутствуют»`.
