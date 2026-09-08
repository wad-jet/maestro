# Выбор и замена модели эмбеддингов

[Назад к оглавлению](../index.md)

## 🎯 Назначение

Как выбирать, настраивать и заменять модель эмбеддингов memory layer
(`memory.embedding_model` / `memory.embedding`). Методика + механика; справочник
ключей — [Память maestro (reference)](../reference/memory.md) и
[Конфигурация (reference)](../reference/config.md).

## 📖 Критерии выбора

| Ось | Локальная (transformers.js) | Внешняя (OpenAI-совместимый API) |
|---|---|---|
| Качество recall | MiniLM-384 (RU+EN); слабее крупных провайдерских | text-embedding-3, multilingual-e5 и т.п. — обычно выше |
| Размерность | **384** (фиксирована для local; модель обязана быть 384-мерной) | **конфигурируемая** (`embedding.dim`, обязателен; равен нативной размерности модели) |
| Offline | Работает офлайн после однократной загрузки (~120 МБ кэш) | Нет: каждый embed — сетевой вызов |
| Приватность | Данные не покидают машину | Контент записей маскируется; recall-запросы маскируются всегда (best-effort); данные уходят провайдеру — осознанный opt-in (init-warn при confidential.paths) |
| Стоимость | 0 (локальный CPU/WASM) | Токены + rate-limits |

## 📖 Как настроить

Локальная (default):

```json
{ "memory": { "enabled": true, "embedding_model": "Xenova/paraphrase-multilingual-MiniLM-L12-v2" } }
```

или через блок (эквивалентно):

```json
{ "memory": { "enabled": true, "embedding": { "provider": "local", "model": "Xenova/paraphrase-multilingual-MiniLM-L12-v2" } } }
```

Внешняя:

```json
{
  "memory": {
    "enabled": true,
    "embedding": {
      "provider": "openai",
      "model": "text-embedding-3-small",
      "base_url": "https://api.openai.com/v1",
      "api_key_env": "MAESTRO_MEMORY_EMBED_KEY",
      "dim": 1536
    }
  }
}
```

Правила: `api_key_env` — имя env-переменной, никогда plaintext; `dim` обязателен
и равен **нативной** размерности модели (Matryoshka-усечение не поддерживается);
`base_url` — любой OpenAI-совместимый `/embeddings` (OpenAI, LiteLLM/one-api,
vLLM); trailing-slash нормализуется.

## 📖 Как заменить

Смена модели/провайдера → **переиндексация**: удалить
`<data-dir>/maestro/memory/<hash>/` (sqlite) или коллекцию/таблицу
(qdrant/pgvector) и включить заново (backfill). Проверка активной модели:
`@maestro-memory` (Модель: …, для внешней — `openai:<model>@<base_url>`).

> ⚠️ Локальная замена — только модели **dim 384** (например
> `Xenova/multilingual-e5-small`).

## 📖 Проверка доступности

`@maestro-memory` → строка «Проверка embedder» (последний статус) или tool
`memory_probe` (live, минуя cooldown). При `FAIL (конфигурация)` — исправить
конфиг и перезапустить opencode (авто-перепроверка на старте). Внешний
провайдер проверяется при старте не чаще `probe_cooldown_min` (default 30 мин).

## 🔗 Связанные разделы

- [Как включить память maestro](enable-memory.md)
- [Память maestro (reference)](../reference/memory.md)
- [Выбор моделей (reference)](../reference/model-selection.md)
- [SECURITY.md](../../SECURITY.md) — §5a
