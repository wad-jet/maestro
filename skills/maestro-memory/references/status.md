# Статус памяти (глава)

> Канон: status. Грузится командой `@maestro-memory` (тонкий лоадер).
> Ядро скилла `maestro-memory` в контексте: Гейт доступности (п. 1.1–1.4)
> пройден, состояние памяти (enabled/disabled + reason-код) известно, секция
> `memory` прочитана гейтом.

Покажи текущий статус **memory layer** (опциональной векторной памяти сессий плагина `maestro-bootstrap`).

## Если память off / плагин недоступен

Гейт доступности (ядро скилла `maestro-memory`) определил состояние. По
состоянию:

- «disabled» + `explicitly_disabled` (`memory.enabled: false`) → выведи
  «Память maestro выключена — включите memory.enabled: true».
- «disabled» + прочие `disabled_reason` (конфиг-невалиден) → выведи честную
  причину по reason-коду (Гейт доступности, п. 1.3, ядро: namespace, embedder,
  mainline и т.п.) + `memory_probe`-диагностику (п. 1.4, ядро) при
  `embedder_probe_hard_fail`.
- «Плагин недоступен» (`maestro_config` недоступен) → сообщение уже выведено
  гейтом (п. 1.1, ядро); завершение.
- «Плагин недоступен» (`memory_stats_detail` недоступен, `enabled: true` +
  конфиг валиден) → выведи «Плагин maestro-bootstrap недоступен — перезапустите
  opencode». НЕ «память выключена».

В любом из состояний выше — основной флоу (Шаг 2 и далее) НЕ выполняется.

## Шаг 2. Прочитать конфигурацию памяти

1. Возьми значения из секции `memory`, прочитанной гейтом доступности (ядро
   скилла `maestro-memory`) — повторное чтение конфига запрещено
   (single-read). Если секция отсутствует → используй значения по умолчанию:

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

2. Зафиксируй фактические значения (файла или дефолты).

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

**Не индексированные сессии**

`memory_stats_detail` показывает блок «Не индексированные сессии: N» — сессии,
данные которых НЕ сохранены в памяти (сбой индексирования). Для каждой —
reason-класс, skip-флаг, время последней попытки. 0 — «все сессии
проиндексированы». Если N > 0 — предложить пользователю восстановление через
`@maestro-memory-reindex` (явные session_id из списка).

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
- `OK` — embedder доступен; если память всё ещё off — причина в другом `disabled_reason` (см. Гейт доступности, ядро).

Если в отчёте `memory_stats_detail` нет данных по кластерам/графу — напиши:
`«Данные по кластерам/графу отсутствуют»`.
