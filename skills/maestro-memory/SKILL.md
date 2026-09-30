---
name: maestro-memory
description: Канон промтов команд `@maestro-memory*` (статус/отчёт/prune/reindex/backup). Загружается командами; из пайплайна maestro не загружается
---

# Maestro Memory (канон команд `@maestro-memory*`)

Канон тел 5 команд memory layer (плагин `maestro-bootstrap`): статус
(`@maestro-memory`), HTML-отчёт (`@maestro-memory-report`), prune, reindex, backup.
Тела команд — тонкие лоадеры (таблица указателей ниже).

**Порядок (fail-fast):** сначала Гейт доступности (ниже) → затем reference-флоу
своей команды. Память off → основной reference-флоу НЕ выполняется; из
`references/<x>.md` читается только off-секция — первая `##`-секция каждого
reference (конвенция).

**Финальные off-сообщения НЕ в ядре:** ядро определяет состояние
(enabled/disabled + reason-код); off-сообщение выводит off-секция reference
своей команды.

**Язык:** все сообщения пользователю — только на русском.

## Гейт доступности (config-first; устойчивая нумерация 1.1–1.4)

### 1.1 Гейт `maestro_config`

Плагин-тул `maestro_config` (native `ask`). Если **недоступен** →
вывод «Перезапустите opencode / обновите плагин
maestro-bootstrap (≥ 4.9.0)» (дистинкция по `.maestro/plugin-version`:
`< 4.9.0` → «плагин устарел — обновите и перезапустите opencode»; свежей
init-записи в `.maestro/logs/` нет → «плагин не загружен — перезапустите
opencode»). **Конфиг НЕ читать (bash-fallback запрещён).** Состояние —
«плагин недоступен» (off-секция reference). Если доступен → 1.2.

### 1.2 Единственное чтение секции `memory` (union)

Прочитай секцию `memory` **один раз** (плагин-тул `maestro_config`,
`section: "memory"`, native `ask`): `memory.enabled`, `memory.storage.type`,
`memory.module_dir` (`module_dir` — для sqlite-fallback отчёта). Чтение
выполняется **всегда** — включая enabled-путь (config-first): reference
опираются на «секцию, прочитанную гейтом». Повторное чтение конфига
запрещено (single-read; один `ask` в happy-path).

### 1.3 Классификация `disabled_reason` (только при disabled)

`memory.enabled: false` → состояние «disabled» (`explicitly_disabled`).
`memory.enabled: true` + конфиг-невалиден → состояние «disabled», честная
причина по `disabled_reason`.

Причину (`disabled_reason`) определи по секции `memory`, прочитанной в 1.2: отсутствие секции `memory` →
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

Для прочих `disabled_reason` (`no_memory_section`, `explicitly_disabled`,
`*_invalid`, `centralized_identity_missing`, `qdrant_config_invalid`,
`pgvector_config_invalid`, `embedding_api_key_env_missing`,
`namespace_missing`, `namespace_invalid`, `related_invalid`, `domain_recall_invalid`)
`memory_probe` **не зарегистрирован** — диагностика только по конфигу (см. выше).

При `namespace_missing` — напомнить: «Задайте memory.namespace (формат: a.b.c,
1–3 сегмента, lowercase) — см. manual_docs/how-to/enable-memory.md.»

### 1.4 `memory_probe`-диагностика (off-состояние)

Инструмент `memory_probe` доступен в off-состоянии **только** при
`disabled_reason: embedder_probe_hard_fail` (стартовый probe hard-fail
оставляет диагностический тул). В этом случае вызови `memory_probe`
(live-проверка embedder, минуя cooldown) и покажи результат + рекомендации:
- `FAIL (конфигурация)` — проверь `embedding.api_key_env`/ключ, `embedding.model`, `embedding.dim` в `maestro.json`;
- `FAIL` (soft) — сеть/таймаут провайдера; проверь `embedding.base_url` и доступность эндпоинта;
- `OK` — embedder доступен; причина off — в другом `disabled_reason` (см. 1.3).

**Итог гейта (состояние):**
- `maestro_config` недоступен (1.1) → «плагин недоступен» (сообщение уже
  выведено в 1.1) → off-секция reference.
- `memory.enabled: false` (1.3) → «disabled» (`explicitly_disabled`) →
  off-секция reference.
- `memory.enabled: true` + конфиг-невалиден (1.3) → «disabled» (+ reason-код
  из 1.3, диагностика 1.4) → off-секция reference.
- `memory.enabled: true` + конфиг валиден → вызови `memory_stats_detail`
  (без параметров) — данные нужны reference-флоу: вернул данные → состояние
  `enabled` → reference-флоу своей команды; недоступен → «плагин недоступен»
  (НЕ «память выключена») → off-секция reference.

## SEC-4b (общее правило)

Агрегаты-only: числа, имена авторов, даты, имена веток, тиры, head-хеши
commit, session_id; тексты записей (titles/summary/decisions) — нигде.
Enforcement-детали HTML-отчёта — `references/report.md` (SEC-4b
enforcement).

## Таблица указателей (команда → reference)

| Команда | Канон |
|---|---|
| `@maestro-memory` | `references/status.md` |
| `@maestro-memory-report` | `references/report.md` |
| `@maestro-memory-prune` | `references/prune.md` |
| `@maestro-memory-reindex` | `references/reindex.md` |
| `@maestro-memory-backup` | `references/backup.md` |

**Правило:** тела команд — тонкие лоадеры (загружают этот скилл и следуют
своему reference-файлу); канон флоу в командах не дублируется.
